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

import fs from 'fs';
import http from 'http';
import logger from './logger';
import { checkDatabaseConnection, prisma } from '../database/prisma';
import { logSystemEvent } from './systemLog';
import {
  reapStrayChromium,
  countStrayChromium,
  countOpenFds,
  getOpenFdSoftLimit,
} from './browserReaper';

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

// --- Chromium / FD leak guard (the precise fingerprint of the recurring death:
// leaked chrome processes + file descriptors accumulating until fork()/accept()
// fail and the port stops answering). These are the signals the OLD watchdog was
// blind to because it only measured the Node process's RSS. ---
const MAX_CHROMIUM = Number(process.env.WATCHDOG_MAX_CHROMIUM) || 8;
const FD_RATIO =
  process.env.WATCHDOG_FD_RATIO !== undefined ? Number(process.env.WATCHDOG_FD_RATIO) : 0.8;
// How many consecutive ticks a leak signal must persist (after an attempted
// reap) before we restart. ~3 ticks ≈ 3 minutes at the default interval.
const LEAK_RESTART_TICKS = Number(process.env.WATCHDOG_LEAK_RESTART_TICKS) || 3;

// --- Internal self-probe. Railway only acts on its healthcheck at deploy time,
// so a running container that stops accepting connections (FD-starved / event
// loop wedged — the exact http_code=000 symptom) is never recycled by the
// platform. The watchdog probes its OWN /api/health/live; if the server can't
// serve that for N ticks, a restart is the only cure. ---
const SELF_PROBE = process.env.WATCHDOG_SELF_PROBE !== 'false';
const SELF_PROBE_FAILS = Number(process.env.WATCHDOG_SELF_PROBE_FAILS) || 3;
const SELF_PROBE_TIMEOUT_MS = Number(process.env.WATCHDOG_SELF_PROBE_TIMEOUT_MS) || 5_000;

let consecutiveDbFailures = 0;
let consecutiveLeakSignals = 0;
let consecutiveSelfProbeFails = 0;
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
 * Read a numeric value from the first readable path (cgroup v2 then v1).
 */
const readFirstNumberFile = (paths: string[]): number => {
  for (const p of paths) {
    try {
      const v = Number(fs.readFileSync(p, 'utf-8').trim());
      if (Number.isFinite(v) && v > 0) return v;
    } catch {
      // try next
    }
  }
  return 0;
};

/**
 * Reclaimable page-cache bytes from cgroup memory.stat. We subtract this from
 * memory.current so the watchdog never restarts on page-cache pressure the
 * kernel would simply evict before OOM.
 */
const readReclaimableCacheBytes = (): number => {
  const candidates: Array<[string, string]> = [
    ['/sys/fs/cgroup/memory.stat', 'inactive_file'], // v2
    ['/sys/fs/cgroup/memory/memory.stat', 'total_inactive_file'], // v1
  ];
  for (const [path, key] of candidates) {
    try {
      const text = fs.readFileSync(path, 'utf-8');
      const line = text.split('\n').find((l) => l.startsWith(`${key} `));
      if (line) {
        const v = Number(line.split(/\s+/)[1]);
        if (Number.isFinite(v) && v >= 0) return v;
      }
    } catch {
      // try next
    }
  }
  return 0;
};

/**
 * TRUE container memory usage (Node + all chrome children), reading the cgroup
 * and subtracting reclaimable cache. This is what the old RSS-only check could
 * not see — leaked chrome processes live here, not in process.memoryUsage().
 * Returns 0 when unavailable (non-Linux / dev).
 */
const getContainerMemoryUsageBytes = (): number => {
  const current = readFirstNumberFile([
    '/sys/fs/cgroup/memory.current',
    '/sys/fs/cgroup/memory/memory.usage_in_bytes',
  ]);
  if (current <= 0) return 0;
  const cache = readReclaimableCacheBytes();
  return Math.max(0, current - cache);
};

/**
 * Probe our own HTTP liveness endpoint over localhost. Resolves false on any
 * non-2xx, timeout, or connection error (including EMFILE when FD-starved —
 * which is exactly the condition we want to detect). Never throws.
 */
const selfProbeLive = (): Promise<boolean> =>
  new Promise((resolve) => {
    const port = process.env.PORT || '4000';
    let settled = false;
    const done = (ok: boolean) => {
      if (!settled) {
        settled = true;
        resolve(ok);
      }
    };
    try {
      const req = http.get(
        {
          host: '127.0.0.1',
          port,
          path: '/api/health/live',
          timeout: SELF_PROBE_TIMEOUT_MS,
        },
        (res) => {
          res.resume(); // drain so the socket frees
          done(res.statusCode != null && res.statusCode >= 200 && res.statusCode < 300);
        },
      );
      req.on('timeout', () => {
        req.destroy();
        done(false);
      });
      req.on('error', () => done(false));
    } catch {
      done(false);
    }
  });

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
      // Primary: TRUE container usage (Node + all chrome children, cache-subtracted).
      // This is what catches a chrome-process memory leak the old RSS-only check
      // was blind to. Fall back to Node RSS when the cgroup is unreadable.
      const containerBytes = getContainerMemoryUsageBytes();
      const usedBytes = containerBytes > 0 ? containerBytes : rssBytes;
      const usedPct = (usedBytes / limitBytes) * 100;
      if (usedPct >= RSS_LIMIT_PERCENT) {
        const limitMb = Math.round(limitBytes / (1024 * 1024));
        const usedMb = Math.round(usedBytes / (1024 * 1024));
        const src = containerBytes > 0 ? 'container' : 'node-rss';
        // A reap may clear it without a restart if the bloat is leaked chrome.
        // reapStrayChromium only kills untracked strays, so it is safe to call
        // even while a legitimate scrape/messenger browser is running. Try that
        // first; restart only if it didn't free anything.
        const killed = await reapStrayChromium();
        if (killed > 0) {
          logger.warn(
            `[Watchdog] Memory ${usedMb}MB/${limitMb}MB (${usedPct.toFixed(0)}%) — reaped ${killed} stray chrome; re-evaluating next tick.`
          );
          return;
        }
        triggerRestart(
          `${src} memory ${usedMb}MB is ${usedPct.toFixed(0)}% of container limit ${limitMb}MB (>= ${RSS_LIMIT_PERCENT}%)`
        );
        return;
      }
    }
  }

  // 2) Chromium / FD leak guard — the precise fingerprint of the recurring
  //    death. Leaked chrome processes/FDs are SEPARATE from the Node process, so
  //    they are invisible to process.memoryUsage(); this is the check the old
  //    watchdog lacked. We count only STRAY chrome (untracked main processes or
  //    init-reparented orphans) so a healthy browser's many helper processes
  //    never false-trigger, then reap (always safe) and restart only if the
  //    signal persists — i.e. the leak is faster than we can reap, or FDs are
  //    exhausted.
  try {
    const strays = await countStrayChromium();
    const fds = await countOpenFds();
    const fdSoft = await getOpenFdSoftLimit();
    const fdRatio = fds > 0 && fdSoft > 0 ? fds / fdSoft : 0;

    // Opportunistically clear any strays — cheap and never touches a live browser.
    if (strays > 0) {
      const killed = await reapStrayChromium();
      if (killed > 0) {
        logger.warn(`[Watchdog] Reaped ${killed} stray chrome process group(s).`);
      }
    }

    const strayOver = MAX_CHROMIUM > 0 && strays >= MAX_CHROMIUM;
    const fdOver = FD_RATIO > 0 && fdRatio >= FD_RATIO;

    if (strayOver || fdOver) {
      consecutiveLeakSignals += 1;
      logger.warn(
        `[Watchdog] Resource-leak signal #${consecutiveLeakSignals}: ` +
          `strayChrome=${strays}/${MAX_CHROMIUM}, ` +
          `fds=${fds}/${fdSoft} (${(fdRatio * 100).toFixed(0)}%).`
      );
      // If the signal persists despite reaping (leak outpaces reap, or FD
      // exhaustion that only a fresh container clears), restart cleanly.
      if (consecutiveLeakSignals >= LEAK_RESTART_TICKS) {
        triggerRestart(
          `resource leak persisted ${consecutiveLeakSignals} ticks ` +
            `(strayChrome=${strays}, fdRatio=${(fdRatio * 100).toFixed(0)}%)`
        );
        return;
      }
    } else if (consecutiveLeakSignals > 0) {
      logger.info('[Watchdog] Resource-leak signal cleared.');
      consecutiveLeakSignals = 0;
    }
  } catch (err) {
    logger.debug(`[Watchdog] leak-guard check failed: ${(err as Error).message}`);
  }

  // 3) Internal self-probe — can the server still serve its own liveness over
  //    localhost? A failure here means the port is not accepting connections
  //    (FD exhaustion / wedged event loop = the http_code=000 outage). Railway
  //    won't recycle a running-but-wedged container, so this is the last-resort
  //    detector that lets us self-restart out of it.
  if (SELF_PROBE) {
    const alive = await selfProbeLive();
    if (alive) {
      if (consecutiveSelfProbeFails > 0) {
        logger.info(`[Watchdog] Self-probe recovered after ${consecutiveSelfProbeFails} failure(s).`);
      }
      consecutiveSelfProbeFails = 0;
    } else {
      consecutiveSelfProbeFails += 1;
      logger.warn(
        `[Watchdog] Self-probe of /api/health/live failed ` +
          `(${consecutiveSelfProbeFails}/${SELF_PROBE_FAILS}) — server not accepting localhost connections.`
      );
      if (consecutiveSelfProbeFails >= SELF_PROBE_FAILS) {
        triggerRestart(
          `self-probe failed ${consecutiveSelfProbeFails}x — server not accepting connections`
        );
        return;
      }
    }
  }

  // 4) Database reachability — observed and recovered, but NEVER a restart
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
      `chromeLeakGuard=max${MAX_CHROMIUM}procs/fd${Math.round(FD_RATIO * 100)}% (reap-then-restart x${LEAK_RESTART_TICKS}), ` +
      `selfProbe=${SELF_PROBE ? `on(x${SELF_PROBE_FAILS})` : 'off'}, ` +
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
