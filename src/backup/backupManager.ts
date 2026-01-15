/**
 * Advanced Backup Manager
 * Full database backup, configuration backup, and restoration system
 */

import fs from 'fs';
import path from 'path';
import { createGzip, createGunzip } from 'zlib';
import { pipeline } from 'stream/promises';
import crypto from 'crypto';
import { prisma } from '../database/prisma';
import logger from '../utils/logger';
import { BackupInfo, BackupConfig, RestoreOptions, RestoreResult } from '../debug/types';
import { debugEventEmitter } from '../debug/eventEmitter';

// Backup directory
const BACKUP_DIR = process.env.BACKUP_DIR || path.resolve(process.cwd(), 'backups');

// Default backup configuration
const defaultBackupConfig: BackupConfig = {
  autoBackup: true,
  schedule: '0 2 * * *', // 2 AM daily
  retentionDays: 30,
  maxBackups: 50,
  compressionLevel: 6,
  includeData: true,
  includeLogs: true,
  includeConfig: true,
};

// Current backup configuration
let backupConfig: BackupConfig = { ...defaultBackupConfig };

// Backup registry
const backupRegistry: Map<string, BackupInfo> = new Map();

// Ensure backup directory exists
const ensureBackupDir = (): void => {
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    logger.info(`Created backup directory: ${BACKUP_DIR}`);
  }
};

/**
 * Generate unique backup ID
 */
const generateBackupId = (): string => {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const random = crypto.randomBytes(4).toString('hex');
  return `backup-${timestamp}-${random}`;
};

/**
 * Calculate file checksum
 */
const calculateChecksum = async (filePath: string): Promise<string> => {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);

    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
};

/**
 * Get all database tables data
 */
const getDatabaseData = async (): Promise<Record<string, unknown[]>> => {
  const data: Record<string, unknown[]> = {};

  // Get all data from each table
  data.PostRaw = await prisma.postRaw.findMany();
  data.PostClassified = await prisma.postClassified.findMany();
  data.MessageGenerated = await prisma.messageGenerated.findMany();
  data.MessageSent = await prisma.messageSent.findMany();
  data.SystemLog = await prisma.systemLog.findMany();
  data.SessionState = await prisma.sessionState.findMany();
  data.GroupInfo = await prisma.groupInfo.findMany();

  return data;
};

/**
 * Get record counts for all tables
 */
const getRecordCounts = async (): Promise<Record<string, number>> => {
  const [postRaw, postClassified, messageGenerated, messageSent, systemLog, sessionState, groupInfo] =
    await Promise.all([
      prisma.postRaw.count(),
      prisma.postClassified.count(),
      prisma.messageGenerated.count(),
      prisma.messageSent.count(),
      prisma.systemLog.count(),
      prisma.sessionState.count(),
      prisma.groupInfo.count(),
    ]);

  return {
    PostRaw: postRaw,
    PostClassified: postClassified,
    MessageGenerated: messageGenerated,
    MessageSent: messageSent,
    SystemLog: systemLog,
    SessionState: sessionState,
    GroupInfo: groupInfo,
  };
};

/**
 * Create a full database backup
 */
export const createFullBackup = async (includeSystemLogs = true): Promise<BackupInfo> => {
  ensureBackupDir();

  const backupId = generateBackupId();
  const filename = `${backupId}.json.gz`;
  const filePath = path.join(BACKUP_DIR, filename);

  const backup: BackupInfo = {
    id: backupId,
    filename,
    createdAt: new Date().toISOString(),
    size: 0,
    type: 'full',
    status: 'in_progress',
    tables: [],
    recordCount: 0,
    restorable: true,
  };

  backupRegistry.set(backupId, backup);
  debugEventEmitter.emitDebugEvent('backup', { action: 'started', backup });

  try {
    logger.info(`Starting full backup: ${backupId}`);

    // Get database data
    const data = await getDatabaseData();

    // Optionally exclude system logs for smaller backups
    if (!includeSystemLogs) {
      delete data.SystemLog;
    }

    // Create backup metadata
    const backupData = {
      id: backupId,
      createdAt: backup.createdAt,
      version: '1.0.0',
      type: 'full',
      tables: Object.keys(data),
      counts: Object.fromEntries(Object.entries(data).map(([key, value]) => [key, (value as unknown[]).length])),
      data,
    };

    // Write compressed backup
    const jsonString = JSON.stringify(backupData, null, 0);
    const gzip = createGzip({ level: backupConfig.compressionLevel });
    const writeStream = fs.createWriteStream(filePath);

    await pipeline(
      (async function* () {
        yield jsonString;
      })(),
      gzip,
      writeStream
    );

    // Get file size
    const stats = fs.statSync(filePath);
    backup.size = stats.size;

    // Calculate checksum
    backup.checksum = await calculateChecksum(filePath);

    // Update backup info
    backup.status = 'completed';
    backup.tables = Object.keys(data);
    backup.recordCount = Object.values(data).reduce((sum, arr) => sum + (arr as unknown[]).length, 0);

    logger.info(`Full backup completed: ${backupId}`, {
      size: backup.size,
      recordCount: backup.recordCount,
      tables: backup.tables.length,
    });

    debugEventEmitter.emitDebugEvent('backup', { action: 'completed', backup });

    // Cleanup old backups
    await cleanupOldBackups();

    return backup;
  } catch (error) {
    backup.status = 'failed';
    backup.error = (error as Error).message;

    logger.error(`Backup failed: ${backupId}`, { error: (error as Error).message });
    debugEventEmitter.emitDebugEvent('backup', { action: 'failed', backup });

    // Clean up partial file
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    throw error;
  }
};

/**
 * Create incremental backup (only changes since last backup)
 */
export const createIncrementalBackup = async (sinceBackupId?: string): Promise<BackupInfo> => {
  ensureBackupDir();

  const backupId = generateBackupId();
  const filename = `${backupId}-incremental.json.gz`;
  const filePath = path.join(BACKUP_DIR, filename);

  // Find reference point
  let referenceDate: Date;
  if (sinceBackupId) {
    const refBackup = backupRegistry.get(sinceBackupId);
    if (!refBackup) throw new Error(`Reference backup not found: ${sinceBackupId}`);
    referenceDate = new Date(refBackup.createdAt);
  } else {
    // Get last successful full backup
    const lastFull = Array.from(backupRegistry.values())
      .filter((b) => b.type === 'full' && b.status === 'completed')
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];

    if (!lastFull) {
      // No previous backup, do full backup instead
      return createFullBackup();
    }
    referenceDate = new Date(lastFull.createdAt);
  }

  const backup: BackupInfo = {
    id: backupId,
    filename,
    createdAt: new Date().toISOString(),
    size: 0,
    type: 'incremental',
    status: 'in_progress',
    tables: [],
    recordCount: 0,
    restorable: true,
  };

  backupRegistry.set(backupId, backup);
  debugEventEmitter.emitDebugEvent('backup', { action: 'started', backup });

  try {
    logger.info(`Starting incremental backup: ${backupId}`, { since: referenceDate.toISOString() });

    // Get only records created/updated since reference date
    const data: Record<string, unknown[]> = {};

    data.PostRaw = await prisma.postRaw.findMany({
      where: { scrapedAt: { gte: referenceDate } },
    });

    data.PostClassified = await prisma.postClassified.findMany({
      where: { classifiedAt: { gte: referenceDate } },
    });

    data.MessageGenerated = await prisma.messageGenerated.findMany({
      where: { createdAt: { gte: referenceDate } },
    });

    data.MessageSent = await prisma.messageSent.findMany({
      where: { sentAt: { gte: referenceDate } },
    });

    data.SystemLog = await prisma.systemLog.findMany({
      where: { createdAt: { gte: referenceDate } },
    });

    data.SessionState = await prisma.sessionState.findMany({
      where: { updatedAt: { gte: referenceDate } },
    });

    data.GroupInfo = await prisma.groupInfo.findMany({
      where: { updatedAt: { gte: referenceDate } },
    });

    // Filter out empty tables
    const filteredData = Object.fromEntries(
      Object.entries(data).filter(([, value]) => (value as unknown[]).length > 0)
    );

    // Create backup metadata
    const backupData = {
      id: backupId,
      createdAt: backup.createdAt,
      version: '1.0.0',
      type: 'incremental',
      referenceDate: referenceDate.toISOString(),
      tables: Object.keys(filteredData),
      counts: Object.fromEntries(
        Object.entries(filteredData).map(([key, value]) => [key, (value as unknown[]).length])
      ),
      data: filteredData,
    };

    // Write compressed backup
    const jsonString = JSON.stringify(backupData, null, 0);
    const gzip = createGzip({ level: backupConfig.compressionLevel });
    const writeStream = fs.createWriteStream(filePath);

    await pipeline(
      (async function* () {
        yield jsonString;
      })(),
      gzip,
      writeStream
    );

    // Get file size
    const stats = fs.statSync(filePath);
    backup.size = stats.size;
    backup.checksum = await calculateChecksum(filePath);
    backup.status = 'completed';
    backup.tables = Object.keys(filteredData);
    backup.recordCount = Object.values(filteredData).reduce((sum, arr) => sum + (arr as unknown[]).length, 0);

    logger.info(`Incremental backup completed: ${backupId}`, {
      size: backup.size,
      recordCount: backup.recordCount,
    });

    debugEventEmitter.emitDebugEvent('backup', { action: 'completed', backup });
    return backup;
  } catch (error) {
    backup.status = 'failed';
    backup.error = (error as Error).message;
    debugEventEmitter.emitDebugEvent('backup', { action: 'failed', backup });

    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    throw error;
  }
};

/**
 * Create configuration-only backup
 */
export const createConfigBackup = async (): Promise<BackupInfo> => {
  ensureBackupDir();

  const backupId = generateBackupId();
  const filename = `${backupId}-config.json.gz`;
  const filePath = path.join(BACKUP_DIR, filename);

  const backup: BackupInfo = {
    id: backupId,
    filename,
    createdAt: new Date().toISOString(),
    size: 0,
    type: 'config',
    status: 'in_progress',
    tables: ['SessionState', 'GroupInfo'],
    recordCount: 0,
    restorable: true,
  };

  backupRegistry.set(backupId, backup);

  try {
    // Only backup configuration tables
    const data = {
      SessionState: await prisma.sessionState.findMany(),
      GroupInfo: await prisma.groupInfo.findMany(),
    };

    const backupData = {
      id: backupId,
      createdAt: backup.createdAt,
      version: '1.0.0',
      type: 'config',
      data,
    };

    const jsonString = JSON.stringify(backupData, null, 0);
    const gzip = createGzip({ level: backupConfig.compressionLevel });
    const writeStream = fs.createWriteStream(filePath);

    await pipeline(
      (async function* () {
        yield jsonString;
      })(),
      gzip,
      writeStream
    );

    const stats = fs.statSync(filePath);
    backup.size = stats.size;
    backup.checksum = await calculateChecksum(filePath);
    backup.status = 'completed';
    backup.recordCount =
      (data.SessionState as unknown[]).length + (data.GroupInfo as unknown[]).length;

    logger.info(`Config backup completed: ${backupId}`);
    debugEventEmitter.emitDebugEvent('backup', { action: 'completed', backup });

    return backup;
  } catch (error) {
    backup.status = 'failed';
    backup.error = (error as Error).message;

    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    throw error;
  }
};

/**
 * Read and decompress backup file
 */
const readBackupFile = async (filename: string): Promise<Record<string, unknown>> => {
  const filePath = path.join(BACKUP_DIR, filename);

  if (!fs.existsSync(filePath)) {
    throw new Error(`Backup file not found: ${filename}`);
  }

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const readStream = fs.createReadStream(filePath);
    const gunzip = createGunzip();

    readStream.pipe(gunzip);

    gunzip.on('data', (chunk) => chunks.push(chunk));
    gunzip.on('error', reject);
    gunzip.on('end', () => {
      try {
        const data = JSON.parse(Buffer.concat(chunks).toString());
        resolve(data);
      } catch (error) {
        reject(new Error('Failed to parse backup file'));
      }
    });
  });
};

/**
 * Restore from backup
 */
export const restoreFromBackup = async (options: RestoreOptions): Promise<RestoreResult> => {
  const backup = backupRegistry.get(options.backupId);
  if (!backup) {
    throw new Error(`Backup not found: ${options.backupId}`);
  }

  if (backup.status !== 'completed') {
    throw new Error(`Cannot restore from incomplete backup: ${backup.status}`);
  }

  logger.info(`Starting restore from backup: ${options.backupId}`, { dryRun: options.dryRun });
  debugEventEmitter.emitDebugEvent('backup', { action: 'restore_started', backup, options });

  const startTime = Date.now();
  const result: RestoreResult = {
    success: false,
    backupId: options.backupId,
    tablesRestored: [],
    recordsRestored: 0,
    duration: 0,
    errors: [],
  };

  try {
    // Read backup data
    const backupData = await readBackupFile(backup.filename);
    const data = backupData.data as Record<string, unknown[]>;

    // Filter tables if specified
    const tablesToRestore = options.tables || Object.keys(data);

    if (options.dryRun) {
      // Dry run - just report what would be restored
      result.tablesRestored = tablesToRestore.filter((t) => data[t]);
      result.recordsRestored = result.tablesRestored.reduce(
        (sum, table) => sum + (data[table]?.length || 0),
        0
      );
      result.success = true;
      result.duration = Date.now() - startTime;

      logger.info(`Dry run restore completed`, { result });
      return result;
    }

    // Actual restore
    for (const table of tablesToRestore) {
      const tableData = data[table];
      if (!tableData || tableData.length === 0) continue;

      try {
        if (options.overwrite) {
          // Delete existing data
          switch (table) {
            case 'PostRaw':
              await prisma.postRaw.deleteMany();
              break;
            case 'PostClassified':
              await prisma.postClassified.deleteMany();
              break;
            case 'MessageGenerated':
              await prisma.messageGenerated.deleteMany();
              break;
            case 'MessageSent':
              await prisma.messageSent.deleteMany();
              break;
            case 'SystemLog':
              await prisma.systemLog.deleteMany();
              break;
            case 'SessionState':
              await prisma.sessionState.deleteMany();
              break;
            case 'GroupInfo':
              await prisma.groupInfo.deleteMany();
              break;
          }
        }

        // Insert backup data
        switch (table) {
          case 'PostRaw':
            await prisma.postRaw.createMany({
              data: tableData as any[],
              skipDuplicates: !options.overwrite,
            });
            break;
          case 'PostClassified':
            await prisma.postClassified.createMany({
              data: tableData as any[],
              skipDuplicates: !options.overwrite,
            });
            break;
          case 'MessageGenerated':
            await prisma.messageGenerated.createMany({
              data: tableData as any[],
              skipDuplicates: !options.overwrite,
            });
            break;
          case 'MessageSent':
            await prisma.messageSent.createMany({
              data: tableData as any[],
              skipDuplicates: !options.overwrite,
            });
            break;
          case 'SystemLog':
            await prisma.systemLog.createMany({
              data: tableData as any[],
              skipDuplicates: !options.overwrite,
            });
            break;
          case 'SessionState':
            await prisma.sessionState.createMany({
              data: tableData as any[],
              skipDuplicates: !options.overwrite,
            });
            break;
          case 'GroupInfo':
            await prisma.groupInfo.createMany({
              data: tableData as any[],
              skipDuplicates: !options.overwrite,
            });
            break;
        }

        result.tablesRestored.push(table);
        result.recordsRestored += tableData.length;
      } catch (error) {
        result.errors?.push(`Failed to restore ${table}: ${(error as Error).message}`);
        logger.error(`Failed to restore table ${table}`, { error: (error as Error).message });
      }
    }

    result.success = result.errors?.length === 0;
    result.duration = Date.now() - startTime;

    logger.info(`Restore completed`, { result });
    debugEventEmitter.emitDebugEvent('backup', { action: 'restore_completed', result });

    return result;
  } catch (error) {
    result.errors?.push((error as Error).message);
    result.duration = Date.now() - startTime;

    logger.error(`Restore failed`, { error: (error as Error).message });
    debugEventEmitter.emitDebugEvent('backup', { action: 'restore_failed', result });

    throw error;
  }
};

/**
 * Cleanup old backups based on retention policy
 */
export const cleanupOldBackups = async (): Promise<number> => {
  ensureBackupDir();

  const backups = Array.from(backupRegistry.values())
    .filter((b) => b.status === 'completed')
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  let deleted = 0;
  const cutoffDate = new Date(Date.now() - backupConfig.retentionDays * 24 * 60 * 60 * 1000);

  for (let i = 0; i < backups.length; i++) {
    const backup = backups[i];
    const shouldDelete =
      i >= backupConfig.maxBackups || new Date(backup.createdAt) < cutoffDate;

    if (shouldDelete) {
      const filePath = path.join(BACKUP_DIR, backup.filename);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        backupRegistry.delete(backup.id);
        deleted++;
        logger.info(`Deleted old backup: ${backup.id}`);
      }
    }
  }

  if (deleted > 0) {
    logger.info(`Cleanup completed: ${deleted} backups deleted`);
  }

  return deleted;
};

/**
 * Get list of all backups
 */
export const getBackupList = (): BackupInfo[] => {
  return Array.from(backupRegistry.values()).sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
};

/**
 * Get backup by ID
 */
export const getBackupById = (id: string): BackupInfo | undefined => {
  return backupRegistry.get(id);
};

/**
 * Delete a specific backup
 */
export const deleteBackup = (id: string): boolean => {
  const backup = backupRegistry.get(id);
  if (!backup) return false;

  const filePath = path.join(BACKUP_DIR, backup.filename);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }

  backupRegistry.delete(id);
  logger.info(`Deleted backup: ${id}`);
  return true;
};

/**
 * Verify backup integrity
 */
export const verifyBackup = async (id: string): Promise<{ valid: boolean; error?: string }> => {
  const backup = backupRegistry.get(id);
  if (!backup) {
    return { valid: false, error: 'Backup not found' };
  }

  const filePath = path.join(BACKUP_DIR, backup.filename);
  if (!fs.existsSync(filePath)) {
    return { valid: false, error: 'Backup file not found' };
  }

  try {
    // Verify checksum
    const currentChecksum = await calculateChecksum(filePath);
    if (backup.checksum && currentChecksum !== backup.checksum) {
      return { valid: false, error: 'Checksum mismatch - file may be corrupted' };
    }

    // Try to read the file
    await readBackupFile(backup.filename);
    return { valid: true };
  } catch (error) {
    return { valid: false, error: (error as Error).message };
  }
};

/**
 * Get backup statistics
 */
export const getBackupStats = (): {
  totalBackups: number;
  totalSize: number;
  lastBackup?: string;
  backupsByType: Record<string, number>;
} => {
  const backups = Array.from(backupRegistry.values());
  const byType: Record<string, number> = {};

  backups.forEach((b) => {
    byType[b.type] = (byType[b.type] || 0) + 1;
  });

  const lastBackup = backups
    .filter((b) => b.status === 'completed')
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];

  return {
    totalBackups: backups.length,
    totalSize: backups.reduce((sum, b) => sum + b.size, 0),
    lastBackup: lastBackup?.createdAt,
    backupsByType: byType,
  };
};

/**
 * Get current backup configuration
 */
export const getBackupConfig = (): BackupConfig => {
  return { ...backupConfig };
};

/**
 * Update backup configuration
 */
export const updateBackupConfig = (config: Partial<BackupConfig>): BackupConfig => {
  backupConfig = { ...backupConfig, ...config };
  logger.info('Backup configuration updated', { config: backupConfig });
  return backupConfig;
};

/**
 * Load existing backups from disk
 */
export const loadExistingBackups = async (): Promise<void> => {
  ensureBackupDir();

  const files = fs.readdirSync(BACKUP_DIR).filter((f) => f.endsWith('.json.gz'));

  for (const filename of files) {
    try {
      const filePath = path.join(BACKUP_DIR, filename);
      const stats = fs.statSync(filePath);

      // Extract backup ID from filename
      const idMatch = filename.match(/^(backup-[^-]+-[^-]+-[^-]+)/);
      if (!idMatch) continue;

      const backupId = idMatch[1].replace('-incremental', '').replace('-config', '');

      // Determine backup type
      let type: BackupInfo['type'] = 'full';
      if (filename.includes('-incremental')) type = 'incremental';
      else if (filename.includes('-config')) type = 'config';

      const backup: BackupInfo = {
        id: backupId,
        filename,
        createdAt: stats.mtime.toISOString(),
        size: stats.size,
        type,
        status: 'completed',
        restorable: true,
      };

      backupRegistry.set(backupId, backup);
    } catch (error) {
      logger.warn(`Failed to load backup metadata: ${filename}`, { error: (error as Error).message });
    }
  }

  logger.info(`Loaded ${backupRegistry.size} existing backups`);
};

// Auto-load existing backups on module init
loadExistingBackups().catch((err) => logger.error('Failed to load existing backups', { error: err.message }));
