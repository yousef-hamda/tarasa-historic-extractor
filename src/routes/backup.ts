/**
 * Backup API Routes
 * Full backup management endpoints for the admin dashboard
 */

import { Router, Request, Response } from 'express';
import {
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
} from '../backup/backupManager';
import logger from '../utils/logger';
import { apiKeyAuth } from '../middleware/apiAuth';

const router = Router();

// Use centralized auth middleware for all backup routes
router.use('/api/backup', apiKeyAuth);

/**
 * GET /api/backup/list
 * Get list of all backups
 */
router.get('/api/backup/list', (req: Request, res: Response) => {
  try {
    const backups = getBackupList();
    const stats = getBackupStats();

    res.json({
      backups,
      stats,
      config: getBackupConfig(),
    });
  } catch (error) {
    logger.error('Failed to get backup list', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to get backup list' });
  }
});

/**
 * GET /api/backup/stats
 * Get backup statistics
 */
router.get('/api/backup/stats', (req: Request, res: Response) => {
  res.json(getBackupStats());
});

/**
 * GET /api/backup/config
 * Get backup configuration (must be registered before :id to avoid conflict)
 */
router.get('/api/backup/config', (req: Request, res: Response) => {
  res.json(getBackupConfig());
});

/**
 * GET /api/backup/:id
 * Get specific backup details
 */
router.get('/api/backup/:id', (req: Request, res: Response) => {
  const backup = getBackupById(req.params.id);

  if (!backup) {
    res.status(404).json({ error: 'Backup not found' });
    return;
  }

  res.json(backup);
});

/**
 * POST /api/backup/create/full
 * Create a full database backup
 */
router.post('/api/backup/create/full', async (req: Request, res: Response) => {
  try {
    const includeSystemLogs = req.body.includeSystemLogs !== false;

    logger.info('Creating full backup via API', { includeSystemLogs });
    const backup = await createFullBackup(includeSystemLogs);

    res.json({
      success: true,
      message: 'Full backup created successfully',
      backup,
    });
  } catch (error) {
    logger.error('Failed to create full backup', { error: (error as Error).message });
    res.status(500).json({
      error: 'Failed to create backup',
      details: (error as Error).message,
    });
  }
});

/**
 * POST /api/backup/create/incremental
 * Create an incremental backup
 */
router.post('/api/backup/create/incremental', async (req: Request, res: Response) => {
  try {
    const sinceBackupId = req.body.sinceBackupId;

    logger.info('Creating incremental backup via API', { sinceBackupId });
    const backup = await createIncrementalBackup(sinceBackupId);

    res.json({
      success: true,
      message: 'Incremental backup created successfully',
      backup,
    });
  } catch (error) {
    logger.error('Failed to create incremental backup', { error: (error as Error).message });
    res.status(500).json({
      error: 'Failed to create backup',
      details: (error as Error).message,
    });
  }
});

/**
 * POST /api/backup/create/config
 * Create a configuration-only backup
 */
router.post('/api/backup/create/config', async (req: Request, res: Response) => {
  try {
    logger.info('Creating config backup via API');
    const backup = await createConfigBackup();

    res.json({
      success: true,
      message: 'Config backup created successfully',
      backup,
    });
  } catch (error) {
    logger.error('Failed to create config backup', { error: (error as Error).message });
    res.status(500).json({
      error: 'Failed to create backup',
      details: (error as Error).message,
    });
  }
});

/**
 * POST /api/backup/restore
 * Restore from a backup
 */
router.post('/api/backup/restore', async (req: Request, res: Response) => {
  try {
    const { backupId, tables, overwrite = false, dryRun = false } = req.body;

    if (!backupId) {
      res.status(400).json({ error: 'backupId is required' });
      return;
    }

    logger.info('Restoring from backup via API', { backupId, tables, overwrite, dryRun });

    const result = await restoreFromBackup({
      backupId,
      tables,
      overwrite,
      dryRun,
    });

    res.json({
      success: result.success,
      message: dryRun ? 'Dry run completed' : 'Restore completed',
      result,
    });
  } catch (error) {
    logger.error('Failed to restore backup', { error: (error as Error).message });
    res.status(500).json({
      error: 'Failed to restore backup',
      details: (error as Error).message,
    });
  }
});

/**
 * POST /api/backup/:id/verify
 * Verify backup integrity
 */
router.post('/api/backup/:id/verify', async (req: Request, res: Response) => {
  try {
    const result = await verifyBackup(req.params.id);

    res.json({
      backupId: req.params.id,
      ...result,
    });
  } catch (error) {
    logger.error('Failed to verify backup', { error: (error as Error).message });
    res.status(500).json({
      error: 'Failed to verify backup',
      details: (error as Error).message,
    });
  }
});

/**
 * DELETE /api/backup/:id
 * Delete a specific backup
 */
router.delete('/api/backup/:id', (req: Request, res: Response) => {
  try {
    const success = deleteBackup(req.params.id);

    if (success) {
      res.json({ success: true, message: 'Backup deleted' });
    } else {
      res.status(404).json({ error: 'Backup not found' });
    }
  } catch (error) {
    logger.error('Failed to delete backup', { error: (error as Error).message });
    res.status(500).json({
      error: 'Failed to delete backup',
      details: (error as Error).message,
    });
  }
});

/**
 * POST /api/backup/cleanup
 * Run backup cleanup based on retention policy
 */
router.post('/api/backup/cleanup', async (req: Request, res: Response) => {
  try {
    const deleted = await cleanupOldBackups();

    res.json({
      success: true,
      message: `Cleanup completed, ${deleted} backups deleted`,
      deleted,
    });
  } catch (error) {
    logger.error('Failed to cleanup backups', { error: (error as Error).message });
    res.status(500).json({
      error: 'Failed to cleanup backups',
      details: (error as Error).message,
    });
  }
});

/**
 * PUT /api/backup/config
 * Update backup configuration
 */
router.put('/api/backup/config', (req: Request, res: Response) => {
  try {
    const config = updateBackupConfig(req.body);
    res.json({
      success: true,
      message: 'Configuration updated',
      config,
    });
  } catch (error) {
    logger.error('Failed to update backup config', { error: (error as Error).message });
    res.status(500).json({
      error: 'Failed to update configuration',
      details: (error as Error).message,
    });
  }
});

/**
 * POST /api/backup/quick
 * Quick backup button - creates full backup with default settings
 */
router.post('/api/backup/quick', async (req: Request, res: Response) => {
  try {
    logger.info('Quick backup triggered via API');
    const backup = await createFullBackup(true);

    res.json({
      success: true,
      message: 'Quick backup completed!',
      backup,
      stats: getBackupStats(),
    });
  } catch (error) {
    logger.error('Quick backup failed', { error: (error as Error).message });
    res.status(500).json({
      error: 'Backup failed',
      details: (error as Error).message,
    });
  }
});

export default router;
