import cron from 'node-cron';
import prisma from '../database/prisma';
import logger from '../utils/logger';
import { logSystemEvent } from '../utils/systemLog';
import { withLock } from '../utils/cronLock';

// Run daily at 3 AM - clean up old system logs
const LOG_CLEANUP_SCHEDULE = process.env.LOG_CLEANUP_CRON_SCHEDULE || '0 3 * * *';

// Default retention: 30 days
const LOG_RETENTION_DAYS = Number(process.env.LOG_RETENTION_DAYS) || 30;

cron.schedule(LOG_CLEANUP_SCHEDULE, () => {
  (async () => {
    try {
      await withLock('log-cleanup', async () => {
        const cutoffDate = new Date(Date.now() - LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000);

        logger.info(`Cleaning up system logs older than ${LOG_RETENTION_DAYS} days (before ${cutoffDate.toISOString()})`);

        const deleted = await prisma.systemLog.deleteMany({
          where: { createdAt: { lt: cutoffDate } },
        });

        if (deleted.count > 0) {
          logger.info(`Deleted ${deleted.count} old system log entries`);
          await logSystemEvent('admin', `Auto-purge: removed ${deleted.count} system logs older than ${LOG_RETENTION_DAYS} days`);
        } else {
          logger.info('No old system logs to clean up');
        }
      });
    } catch (error) {
      logger.error(`Log cleanup cron error: ${(error as Error).message}`);
    }
  })();
});

logger.info(`Log cleanup cron registered (schedule: ${LOG_CLEANUP_SCHEDULE}, retention: ${LOG_RETENTION_DAYS} days)`);
