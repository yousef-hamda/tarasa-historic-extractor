import prisma from '../database/prisma';
import logger from './logger';

export type LogType = 'scrape' | 'classify' | 'message' | 'auth' | 'error' | 'admin';

const VALID_LOG_TYPES: LogType[] = ['scrape', 'classify', 'message', 'auth', 'error', 'admin'];

export interface LogSystemEventOptions {
  /**
   * If true, ALSO send the event as a Telegram alert (in addition to the
   * usual DB write). Only call sites that represent critical operator-
   * actionable failures should set this — anything else would be noise.
   * Telegram delivery has a 5-minute dedup window keyed by title so
   * a failing pipeline can't spam the operator.
   */
  telegram?: boolean;
}

export const logSystemEvent = async (
  type: LogType,
  message: string,
  options?: LogSystemEventOptions,
): Promise<void> => {
  if (!VALID_LOG_TYPES.includes(type)) {
    logger.error(`Invalid log type: ${type}`);
    return;
  }

  try {
    await prisma.systemLog.create({
      data: { type, message },
    });
  } catch (error) {
    logger.error(`Failed to persist system log (${type}): ${error}`);
  }

  // Telegram alert is opt-in and best-effort. We never let a Telegram
  // failure break the calling code's flow — the DB write is the
  // authoritative record either way.
  if (options?.telegram) {
    try {
      const { sendSystemAlert } = await import('./telegram');
      // Map the systemLog type to the alert's severity level. error → 🚨,
      // auth events → ⚠️ (need attention), everything else → ℹ️.
      const severity: 'error' | 'warning' | 'info' =
        type === 'error' ? 'error' : type === 'auth' ? 'warning' : 'info';
      await sendSystemAlert(severity, message);
    } catch (err) {
      logger.warn(`[systemLog] Telegram alert failed: ${(err as Error).message}`);
    }
  }
};
