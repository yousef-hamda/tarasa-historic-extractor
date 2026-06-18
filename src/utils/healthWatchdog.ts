/**
 * Health Watchdog — self-heal for resource-exhausted containers
 *
 * Background: on Railway the long-running container can slowly exhaust OS
 * resources (process/thread/memory). When that happens the symptoms are:
 *   - Prisma queries fail  → /api/health reports database:false, the dashboard
 *     renders all-zeros and every data API 500s.
 *   - chrome spawns fail with `spawn ... EAGAIN` (the kernel can't fork).
 * The container does not crash on its own, so it sits broken until a human
 * notices and redeploys (observed: ~hours of downtime).
 *
 * This watchdog turns that silent multi-hour outage into a self-recovery of a
 * few minutes: if the database is unreachable for several consecutive checks
 * (or RSS blows past an optional cap), the process exits non-zero so Railway
 * restarts a fresh container — exactly what manually redeploying does, but
 * automatic.
 *
 * Everything is env-tunable and the watchdog can be disabled outright. A high
 * default failure threshold avoids restarting on a transient blip.
 */

import logger from './logger';
import { checkDatabaseConnection } from '../database/prisma';
import { logSystemEvent } from './systemLog';

const DISABLED = process.env.HEALTH_WATCHDOG_DISABLED === 'true';
// How often to probe (default 60s).
const INTERVAL_MS = Number(process.env.HEALTH_WATCHDOG_INTERVAL_MS) || 60_000;
// Consecutive DB-check failures before we restart (default 5 → ~5 min of
// sustained failure at the default interval, so a one-off blip never restarts).
const DB_FAIL_THRESHOLD = Number(process.env.HEALTH_WATCHDOG_DB_FAIL_THRESHOLD) || 5;
// Optional preventive memory cap in MB. When set, the container restarts before
// RSS reaches the level where fork()/EAGAIN starts failing. Off unless set.
const RSS_LIMIT_MB = Number(process.env.HEALTH_WATCHDOG_RSS_LIMIT_MB) || 0;
// Per-probe DB timeout.
const DB_CHECK_TIMEOUT_MS = Number(process.env.HEALTH_WATCHDOG_DB_TIMEOUT_MS) || 5_000;

let consecutiveDbFailures = 0;
let timer: NodeJS.Timeout | null = null;
let restarting = false;

/**
 * Trigger a self-heal restart. Best-effort flush of the reason to logs, then a
 * hard exit(1). Railway restarts the container on non-zero exit. Cron locks
 * carry a 30-min Redis TTL so a hard exit never wedges them permanently.
 */
const triggerRestart = (reason: string): void => {
  if (restarting) return;
  restarting = true;

  logger.error(`[Watchdog] Self-heal restart triggered: ${reason}. Exiting so the platform restarts a fresh container.`);

  // Best-effort audit trail. The DB may be the very thing that's down, so guard
  // it and never let it block the exit.
  Promise.race([
    logSystemEvent('admin', `Watchdog self-heal restart: ${reason}`).catch(() => undefined),
    new Promise((resolve) => setTimeout(resolve, 1_500)),
  ]).finally(() => {
    // Small extra delay so logger transports flush before the process dies.
    setTimeout(() => process.exit(1), 250);
  });
};

const tick = async (): Promise<void> => {
  if (restarting) return;

  // 1) Optional preventive memory guard.
  if (RSS_LIMIT_MB > 0) {
    const rssMb = Math.round(process.memoryUsage().rss / (1024 * 1024));
    if (rssMb >= RSS_LIMIT_MB) {
      triggerRestart(`RSS ${rssMb}MB >= limit ${RSS_LIMIT_MB}MB`);
      return;
    }
  }

  // 2) Database reachability — the clearest signal that the site is unusable.
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
  logger.warn(`[Watchdog] Database check failed (${consecutiveDbFailures}/${DB_FAIL_THRESHOLD}).`);

  if (consecutiveDbFailures >= DB_FAIL_THRESHOLD) {
    triggerRestart(`database unreachable for ${consecutiveDbFailures} consecutive checks`);
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

  logger.info(
    `[Watchdog] Started: interval=${INTERVAL_MS}ms, dbFailThreshold=${DB_FAIL_THRESHOLD}` +
      (RSS_LIMIT_MB > 0 ? `, rssLimit=${RSS_LIMIT_MB}MB` : ', rssLimit=off')
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
