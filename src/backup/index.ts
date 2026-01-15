/**
 * Backup System Index
 * Exports all backup components for easy integration
 */

export {
  createFullBackup,
  createIncrementalBackup,
  createConfigBackup,
  restoreFromBackup,
  getBackupList,
  getBackupById,
  deleteBackup,
  verifyBackup,
  getBackupStats,
  getBackupConfig,
  updateBackupConfig,
  cleanupOldBackups,
  loadExistingBackups,
} from './backupManager';

/**
 * Schedule automatic backups
 */
export const scheduleAutomaticBackups = async (cron: typeof import('node-cron')): Promise<void> => {
  const { getBackupConfig, createFullBackup, cleanupOldBackups } = await import('./backupManager');
  const logger = (await import('../utils/logger')).default;

  const config = getBackupConfig();

  if (!config.autoBackup) {
    logger.info('Automatic backups are disabled');
    return;
  }

  // Schedule backup job
  cron.schedule(config.schedule, async () => {
    logger.info('Running scheduled automatic backup');
    try {
      await createFullBackup(config.includeLogs);
      await cleanupOldBackups();
      logger.info('Scheduled backup completed successfully');
    } catch (error) {
      logger.error('Scheduled backup failed', { error: (error as Error).message });
    }
  });

  logger.info(`Automatic backups scheduled: ${config.schedule}`);
};
