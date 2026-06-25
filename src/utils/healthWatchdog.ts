/**
 * Health Watchdog — self-heal for resource-exhausted containers
 *
 * ---------------------------------------------------------------------------
 * DESIGN RULE (root-cause of the recurring permanent 502):
 *
 *   The watchdog must NEVER kill the process for a condition a restart cannot
 *   cure. A database outage is EXTERNAL — restarting the container does not
 *   bring Postgres back, it only burns Railway's restart-retry budget. Once
 *   that budget is exhausted Railway stops restarting and the origin port is
 *   left with nothing listening → a *permanent* Cloudflare 502 until a human
 *   redeploys.
 *
 *   The previous version exited after N failed DB checks. Combined with
 *   Railway's restart cap, a transient/external Postgres blip turned into a
 *   permanent outage: boot → up → ~5 min → exit(1) → restart → … → give up.
 *
 *   So now:
 *     • DB unreachable  → log + attempt an in-process reconnect, STAY UP
 *                          (degraded). Never exit. The HTTP server keeps
 *                          serving and recovers on its own when the DB returns.
 *     • Memory exhausted → THIS is the one failure a restart actually cures
 *                          (the slow leak that ends in fork()/EAGAIN). Restart
 *                          cleanly *before* the OS OOM-kills us, sized to the
 *                          container's real cgroup limit so it works at any
 *                          Railway plan size.
 *
 *   Two structural guards make a crash-loop impossible regardless of cause:
 *     • MIN_UPTIME_MS — never self-heal-exit during early boot, so repeated
 *       restarts can never happen fast enough to exhaust Railway's retry cap.
 *     • once-per-process — a given container self-heal-exits at most once.
 * ---------------------------------------------------------------------------
 */

import logger from './logger';
import { checkDatabaseConnection, prisma } from '../database/prisma';
import { logSystemEvent } from './systemLog';

const DISABLED = process.env.HEALTH_WATCHDOG_DISABLED === 'true';
// How often to probe (default 60s).
const INTERVAL_MS = Number(process.env.HEALTH_WATCHDOG_INTERVAL_MS) || 60_000;
// Consecutive DB-check failures before we attempt an in-process reconnect and
// emit a louder warning. This NEVER triggers a restart anymore — it only paces
// the reconnect attempt so we don't hammer a recovering DB.
const DB_FAIL_THRESHOLD = Number(process.env.HEALTH_WATCHDOG_DB_FAIL_THRESHOLD) || 5;
// Optional ABSOLUTE preventive memory cap in MB. When set (>0) it takes
// precedence over the percentage cap below. Off by default — the percentage
// cap (sized to the real container limit) is the robust default.
const RSS_LIMIT_MB = Number(process.env.HEALTH_WATCHDOG_RSS_LIMIT_MB) || 0;
// Preventive memory cap as a PERCENT of the container's cgroup memory limit.
// Default 90% — restart cleanly just before the kernel OOM-kills us (which
// would otherwise be a hard, un-graceful crash). Works at any container size
// because it reads the real limit at runtime. Set to 0 to disable.
const RSS_LIMIT_PERCENT = process.env.HEALTH_WATCHDOG_RSS_LIMIT_PERCENT !== undefined
  ? Number(process.env.HEALTH_WATCHDOG_RSS_LIMIT_PERCENT)
  : 90;
// Never self-heal-exit until the process has been up this long. This is the
// crash-loop firewall: every container lives at least this long before it can
// exit, so restarts can never come fast enough to exhaust Railway's retry cap.
const MIN_UPTIME_MS = Number(process.env.HEALTH_WATCHDOG_MIN_UPTIME_MS) || 15 * 60_000;
// Per-probe DB timeout.
const DB_CHECK_TIMEOUT_MS = Number(process.env.HEALTH_WATCHDOG_DB_TIMEOUT_MS) || 5_000;

let consecutiveDbFailures = 0;
let timer: NodeJS.Timeout | null = null;
let restarting = false;
let reconnectInFlight = false;

/**
 * The container's memory limit in bytes, read from the cgroup at runtime via
 * process.constrainedMemory() (Node 18.15+). Returns 0 when unconstrained or
 * unavailable, in which case the percentage cap is skipped.
 */
const getConstrainedMemoryBytes = (): number => {
  try {
    if (typeof process.constrainedMemory === 'function') {
      const limit = process.constrainedMemory();
      // Returns 0 / undefined when there is no limit.
      return typeof limit === 'number' && Number.isFinite(limit) && limit > 0 ? limit : 0;
    }
  } catch {
    // ignore — fall through to "unknown".
  }
  return 0;
};

/**
 * Self-heal restart for the ONE failure mode a restart actually fixes: local
 * resource (memory) exhaustion. Guarded so it can never crash-loop: it refuses
 * to fire during early boot and at most once per process.
 */
const triggerRestart = (reason: string): void => {
  if (restarting) return;

  // Crash-loop firewall: never exit while the process is still young. A fresh
  // container that is already over budget at boot would otherwise restart
  // instantly and repeatedly until Railway gives up → permanent 502.
  const uptimeMs = process.uptime() * 1000;
  if (uptimeMs < MIN_UPTIME_MS) {
    logger.warn(
      `[Watchdog] Self-heal condition met (${reason}) but process uptime ` +
        `${Math.round(uptimeMs / 1000)}s < min ${Math.round(MIN_UPTIME_MS / 1000)}s — ` +
        `holding off to avoid a restart loop.`
    );
    return;
  }

  restarting = true;
  logger.error(
    `[Watchdog] Self-heal restart triggered: ${reason}. Exiting so the platform restarts a fresh container.`
  );

  // Best-effort audit trail. Guard it and never let it block the exit.
  Promise.race([
    logSystemEvent('admin', `Watchdog self-heal restart: ${reason}`).catch(() => undefined),
    new Promise((resolve) => setTimeout(resolve, 1_500)),
  ]).finally(() => {
    setTimeout(() => process.exit(1), 250);
  });
};

/**
 * Best-effort in-process recovery when the DB is unreachable. Dropping the
 * Prisma connection pool forces a fresh connection on the next query, which
 * recovers from stale/half-open pooled connections without killing the server.
 */
const attemptDbReconnect = async (): Promise<void> => {
  if (reconnectInFlight) return;
  reconnectInFlight = true;
  try {
    logger.warn('[Watchdog] Attempting in-process DB pool reset (staying up, degraded).');
    await Promise.race([
      prisma.$disconnect(),
      new Promise((resolve) => setTimeout(resolve, 3_000)),
    ]);
    // The next query (health probe or any route) will lazily reconnect.
  } catch (err) {
    logger.error(`[Watchdog] DB pool reset failed: ${(err as Error).message}`);
  } finally {
    reconnectInFlight = false;
  }
};

const tick = async (): Promise<void> => {
  if (restarting) return;

  // 1) Preventive memory guard — the ONLY restart trigger. Restart cleanly just
  //    before OOM rather than waiting for a hard kill or fork()/EAGAIN.
  const rssBytes = process.memoryUsage().rss;
  const rssMb = Math.round(rssBytes / (1024 * 1024));

  if (RSS_LIMIT_MB > 0 && rssMb >= RSS_LIMIT_MB) {
    triggerRestart(`RSS ${rssMb}MB >= absolute limit ${RSS_LIMIT_MB}MB`);
    return;
  }

  if (RSS_LIMIT_PERCENT > 0) {
    const limitBytes = getConstrainedMemoryBytes();
    if (limitBytes > 0) {
      const usedPct = (rssBytes / limitBytes) * 100;
      if (usedPct >= RSS_LIMIT_PERCENT) {
        const limitMb = Math.round(limitBytes / (1024 * 1024));
        triggerRestart(
          `RSS ${rssMb}MB is ${usedPct.toFixed(0)}% of container limit ${limitMb}MB (>= ${RSS_LIMIT_PERCENT}%)`
        );
        return;
      }
    }
  }

  // 2) Database reachability — observed and recovered, but NEVER a restart
  //    trigger. An external DB outage must degrade the site, not kill it.
  let dbOk = false;
  try {
    dbOk = await checkDatabaseConnection(DB_CHECK_TIMEOUT_MS);
  } catch {
    dbOk = false;
  }

  if (dbOk) {
    if (consecutiveDbFailures > 0) {
      logger.info(`[Watchdog] Database recovered after ${consecutiveDbFailures} failed check(s).`);
    }
    consecutiveDbFailures = 0;
    return;
  }

  consecutiveDbFailures += 1;
  logger.warn(
    `[Watchdog] Database check failed (${consecutiveDbFailures}). Server stays UP (degraded); ` +
      `a restart cannot fix an external DB outage and would risk a permanent 502.`
  );

  // Attempt an in-process reconnect once we've crossed the threshold, then
  // every threshold-many checks thereafter — never exit.
  if (consecutiveDbFailures >= DB_FAIL_THRESHOLD && consecutiveDbFailures % DB_FAIL_THRESHOLD === 0) {
    void attemptDbReconnect();
  }
};

/**
 * Start the watchdog. No-op if disabled. Safe to call once at server startup.
 */
export const startHealthWatchdog = (): void => {
  if (DISABLED) {
    logger.info('[Watchdog] Disabled via HEALTH_WATCHDOG_DISABLED.');
    return;
  }
  if (timer) {
    return; // already started
  }

  const memMode = RSS_LIMIT_MB > 0
    ? `rssLimit=${RSS_LIMIT_MB}MB`
    : RSS_LIMIT_PERCENT > 0
    ? `rssLimit=${RSS_LIMIT_PERCENT}% of container`
    : 'rssLimit=off';

  logger.info(
    `[Watchdog] Started: interval=${INTERVAL_MS}ms, ${memMode}, ` +
      `minUptimeBeforeRestart=${Math.round(MIN_UPTIME_MS / 1000)}s, ` +
      `dbOutage=stay-up-degraded (never restarts)`
  );

  timer = setInterval(() => {
    void tick();
  }, INTERVAL_MS);
  // Don't let the watchdog interval by itself keep the event loop alive.
  if (typeof timer.unref === 'function') {
    timer.unref();
  }
};

/**
 * Stop the watchdog (used by graceful shutdown / tests).
 */
export const stopHealthWatchdog = (): void => {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
};
