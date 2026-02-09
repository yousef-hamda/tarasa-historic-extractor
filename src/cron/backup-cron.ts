/**
 * Automatic Backup Cron Job
 * Schedules and executes automatic database backups
 */

import cron from 'node-cron';
import {
  createFullBackup,
  createIncrementalBackup,
  cleanupOldBackups,
  getBackupConfig,
  getBackupStats,
} from '../backup/backupManager';
import logger from '../utils/logger';
import { logSystemEvent } from '../utils/systemLog';
import { debugEventEmitter } from '../debug/eventEmitter';
import { withLock } from '../utils/cronLock';

let backupTask: cron.ScheduledTask | null = null;

/**
 * Execute backup job (with distributed lock protection)
 */
const executeBackup = async (): Promise<void> => {
  await withLock('backup', async () => {
    const startTime = Date.now();

    try {
    logger.info('Starting scheduled backup job');
    debugEventEmitter.emitDebugEvent('backup', { action: 'cron_started' });

    const config = getBackupConfig();
    const stats = getBackupStats();

    // Determine backup type based on config and last backup
    let backupType: 'full' | 'incremental' = 'full';

    // If we have recent backups and auto-backup is configured for incremental
    if (stats.lastBackup) {
      const lastBackupAge = Date.now() - new Date(stats.lastBackup).getTime();
      const oneDayMs = 24 * 60 * 60 * 1000;

      // Do incremental if last full backup was within a week
      if (lastBackupAge < 7 * oneDayMs && stats.totalBackups > 0) {
        // Every 7th backup is full, otherwise incremental
        if (stats.totalBackups % 7 !== 0) {
          backupType = 'incremental';
        }
      }
    }

    // Execute backup
    if (backupType === 'full') {
      logger.info('Creating full backup');
      await createFullBackup(config.includeLogs);
    } else {
      logger.info('Creating incremental backup');
      await createIncrementalBackup();
    }

    // Cleanup old backups
    const deletedCount = await cleanupOldBackups();
    if (deletedCount > 0) {
      logger.info(`Cleaned up ${deletedCount} old backups`);
    }

    const duration = Date.now() - startTime;
    logger.info(`Backup job completed in ${duration}ms`);

    await logSystemEvent('admin', `Scheduled ${backupType} backup completed in ${duration}ms`);
    debugEventEmitter.emitDebugEvent('backup', {
      action: 'cron_completed',
      type: backupType,
      duration,
    });
    } catch (error) {
      const errorMessage = (error as Error).message;
      logger.error(`Backup job failed: ${errorMessage}`);

      await logSystemEvent('error', `Scheduled backup failed: ${errorMessage}`);
      debugEventEmitter.emitDebugEvent('backup', {
        action: 'cron_failed',
        error: errorMessage,
      });
    }
  });
};

/**
 * Start the backup cron job
 */
export const startBackupCron = (): void => {
  const config = getBackupConfig();

  if (!config.autoBackup) {
    logger.info('Automatic backups disabled');
    return;
  }

  // Stop existing task if any
  if (backupTask) {
    backupTask.stop();
  }

  // Validate cron schedule
  if (!cron.validate(config.schedule)) {
    logger.error(`Invalid backup cron schedule: ${config.schedule}`);
    return;
  }

  // Schedule the backup job
  backupTask = cron.schedule(config.schedule, executeBackup, {
    scheduled: true,
    timezone: process.env.TZ || 'UTC',
  });

  logger.info(`Backup cron job scheduled: ${config.schedule}`);
  debugEventEmitter.emitDebugEvent('backup', {
    action: 'cron_scheduled',
    schedule: config.schedule,
  });
};

/**
 * Stop the backup cron job
 */
export const stopBackupCron = (): void => {
  if (backupTask) {
    backupTask.stop();
    backupTask = null;
    logger.info('Backup cron job stopped');
  }
};

/**
 * Reschedule backup cron with new schedule
 */
export const rescheduleBackupCron = (schedule: string): boolean => {
  if (!cron.validate(schedule)) {
    logger.error(`Invalid cron schedule: ${schedule}`);
    return false;
  }

  stopBackupCron();
  startBackupCron();
  return true;
};

/**
 * Manually trigger backup
 */
export const triggerBackup = async (): Promise<void> => {
  await executeBackup();
};

/**
 * Get backup cron status
 */
export const getBackupCronStatus = async (): Promise<{
  enabled: boolean;
  running: boolean;
  schedule: string;
  lastRun?: string;
  nextRun?: string;
}> => {
  const config = getBackupConfig();
  const stats = getBackupStats();
  const { isLocked } = await import('../utils/cronLock');

  return {
    enabled: backupTask !== null && config.autoBackup,
    running: await isLocked('backup'),
    schedule: config.schedule,
    lastRun: stats.lastBackup,
  };
};
