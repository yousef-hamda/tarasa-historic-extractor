import React, { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../utils/api';
import {
  ServerStackIcon,
  ArrowPathIcon,
  CloudArrowDownIcon,
  CloudArrowUpIcon,
  TrashIcon,
  ShieldCheckIcon,
  Cog6ToothIcon,
  ClockIcon,
  DocumentDuplicateIcon,
  FolderIcon,
  CheckCircleIcon,
  XCircleIcon,
  ExclamationTriangleIcon,
  ArchiveBoxIcon,
  PlayIcon,
} from '@heroicons/react/24/outline';

interface BackupInfo {
  id: string;
  filename: string;
  createdAt: string;
  size: number;
  type: 'full' | 'incremental' | 'config' | 'logs';
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  tables?: string[];
  recordCount?: number;
  checksum?: string;
  error?: string;
  restorable: boolean;
}

interface BackupStats {
  totalBackups: number;
  totalSize: number;
  lastBackup?: string;
  backupsByType: Record<string, number>;
}

interface BackupConfig {
  autoBackup: boolean;
  schedule: string;
  retentionDays: number;
  maxBackups: number;
  compressionLevel: number;
  includeData: boolean;
  includeLogs: boolean;
  includeConfig: boolean;
}

interface RestoreResult {
  success: boolean;
  backupId: string;
  tablesRestored: string[];
  recordsRestored: number;
  duration: number;
  errors?: string[];
}

const formatBytes = (bytes: number): string => {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let unitIndex = 0;
  let value = bytes;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }
  return `${value.toFixed(2)} ${units[unitIndex]}`;
};

const formatDate = (dateString: string): string => {
  return new Date(dateString).toLocaleString();
};

// Stat Card Component
const StatCard: React.FC<{
  title: string;
  value: string | number;
  subtitle?: string;
  icon: React.ComponentType<{ className?: string }>;
}> = ({ title, value, subtitle, icon: Icon }) => (
  <div className="bg-white border border-slate-200 rounded-xl p-5 transition-colors hover:border-slate-300">
    <div className="flex items-start justify-between">
      <div className="flex-1">
        <p className="text-sm text-slate-500 font-medium">{title}</p>
        <p className="text-2xl font-semibold text-slate-900 mt-1">{value}</p>
        {subtitle && <p className="text-xs text-slate-400 mt-1">{subtitle}</p>}
      </div>
      <div className="w-10 h-10 rounded-lg bg-slate-100 flex items-center justify-center">
        <Icon className="w-5 h-5 text-slate-600" />
      </div>
    </div>
  </div>
);

// Status Badge with Icon
const StatusBadge: React.FC<{ status: BackupInfo['status'] }> = ({ status }) => {
  const getStyle = () => {
    switch (status) {
      case 'completed':
        return { bg: 'bg-emerald-50', text: 'text-emerald-700', icon: CheckCircleIcon };
      case 'failed':
        return { bg: 'bg-red-50', text: 'text-red-700', icon: XCircleIcon };
      case 'in_progress':
        return { bg: 'bg-slate-100', text: 'text-slate-700', icon: ArrowPathIcon };
      case 'pending':
      default:
        return { bg: 'bg-slate-100', text: 'text-slate-600', icon: ClockIcon };
    }
  };

  const style = getStyle();
  const Icon = style.icon;

  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium ${style.bg} ${style.text}`}>
      <Icon className={`w-3.5 h-3.5 ${status === 'in_progress' ? 'animate-spin' : ''}`} />
      {status.replace('_', ' ')}
    </span>
  );
};

// Type Badge
const TypeBadge: React.FC<{ type: BackupInfo['type'] }> = ({ type }) => {
  const getStyle = () => {
    switch (type) {
      case 'full':
        return { bg: 'bg-slate-100', text: 'text-slate-700' };
      case 'incremental':
        return { bg: 'bg-slate-100', text: 'text-slate-700' };
      case 'config':
        return { bg: 'bg-amber-50', text: 'text-amber-700' };
      case 'logs':
      default:
        return { bg: 'bg-slate-100', text: 'text-slate-600' };
    }
  };

  const style = getStyle();

  return (
    <span className={`inline-flex items-center px-2 py-1 rounded-md text-xs font-medium ${style.bg} ${style.text}`}>
      {type}
    </span>
  );
};

export default function BackupPage() {
  const [backups, setBackups] = useState<BackupInfo[]>([]);
  const [stats, setStats] = useState<BackupStats | null>(null);
  const [config, setConfig] = useState<BackupConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [restoring, setRestoring] = useState<string | null>(null);
  const [showRestoreModal, setShowRestoreModal] = useState<BackupInfo | null>(null);
  const [showConfigModal, setShowConfigModal] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const fetchBackups = useCallback(async () => {
    try {
      const res = await apiFetch('/api/backup/list');
      if (res.ok) {
        const data = await res.json();
        setBackups(data.backups);
        setStats(data.stats);
        setConfig(data.config);
      }
    } catch (err) {
      console.error('Failed to fetch backups:', err);
      setMessage({ type: 'error', text: 'Failed to load backups' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchBackups();
  }, [fetchBackups]);

  const showMessageToast = (type: 'success' | 'error', text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 5000);
  };

  const createBackup = async (type: 'full' | 'incremental' | 'config') => {
    setCreating(true);
    try {
      const endpoint = `/api/backup/create/${type}`;
      const res = await apiFetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json();

      if (res.ok) {
        showMessageToast('success', `${type.charAt(0).toUpperCase() + type.slice(1)} backup created successfully!`);
        fetchBackups();
      } else {
        showMessageToast('error', data.error || 'Failed to create backup');
      }
    } catch (err) {
      showMessageToast('error', 'Failed to create backup');
    } finally {
      setCreating(false);
    }
  };

  const quickBackup = async () => {
    setCreating(true);
    try {
      const res = await apiFetch('/api/backup/quick', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json();

      if (res.ok) {
        showMessageToast('success', 'Quick backup completed!');
        fetchBackups();
      } else {
        showMessageToast('error', data.error || 'Backup failed');
      }
    } catch (err) {
      showMessageToast('error', 'Failed to create backup');
    } finally {
      setCreating(false);
    }
  };

  const restoreBackup = async (backupId: string, overwrite: boolean, dryRun: boolean) => {
    setRestoring(backupId);
    try {
      const res = await apiFetch('/api/backup/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ backupId, overwrite, dryRun }),
      });
      const data = await res.json();

      if (res.ok) {
        const result = data.result as RestoreResult;
        if (dryRun) {
          showMessageToast('success', `Dry run: Would restore ${result.recordsRestored} records from ${result.tablesRestored.length} tables`);
        } else {
          showMessageToast('success', `Restored ${result.recordsRestored} records from ${result.tablesRestored.length} tables`);
        }
        setShowRestoreModal(null);
        fetchBackups();
      } else {
        showMessageToast('error', data.error || 'Restore failed');
      }
    } catch (err) {
      showMessageToast('error', 'Failed to restore backup');
    } finally {
      setRestoring(null);
    }
  };

  const verifyBackup = async (backupId: string) => {
    try {
      const res = await apiFetch(`/api/backup/${backupId}/verify`, { method: 'POST' });
      const data = await res.json();

      if (data.valid) {
        showMessageToast('success', 'Backup verified successfully - integrity OK');
      } else {
        showMessageToast('error', `Backup verification failed: ${data.error}`);
      }
    } catch (err) {
      showMessageToast('error', 'Failed to verify backup');
    }
  };

  const deleteBackup = async (backupId: string) => {
    if (!confirm('Are you sure you want to delete this backup?')) return;

    try {
      const res = await apiFetch(`/api/backup/${backupId}`, { method: 'DELETE' });

      if (res.ok) {
        showMessageToast('success', 'Backup deleted');
        fetchBackups();
      } else {
        const data = await res.json();
        showMessageToast('error', data.error || 'Failed to delete backup');
      }
    } catch (err) {
      showMessageToast('error', 'Failed to delete backup');
    }
  };

  const runCleanup = async () => {
    try {
      const res = await apiFetch('/api/backup/cleanup', { method: 'POST' });
      const data = await res.json();

      if (res.ok) {
        showMessageToast('success', `Cleanup completed: ${data.deleted} backups removed`);
        fetchBackups();
      } else {
        showMessageToast('error', data.error || 'Cleanup failed');
      }
    } catch (err) {
      showMessageToast('error', 'Failed to run cleanup');
    }
  };

  const updateConfig = async (newConfig: Partial<BackupConfig>) => {
    try {
      const res = await apiFetch('/api/backup/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newConfig),
      });

      if (res.ok) {
        const data = await res.json();
        setConfig(data.config);
        showMessageToast('success', 'Configuration updated');
        setShowConfigModal(false);
      } else {
        showMessageToast('error', 'Failed to update configuration');
      }
    } catch (err) {
      showMessageToast('error', 'Failed to update configuration');
    }
  };

  if (loading) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-xl bg-slate-200" />
          <div className="space-y-2">
            <div className="h-8 w-48 bg-slate-200 rounded-lg" />
            <div className="h-4 w-64 bg-slate-100 rounded" />
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-28 bg-slate-200 rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-slide-up">
      {/* Message Toast */}
      {message && (
        <div
          className={`fixed top-24 right-4 p-4 rounded-xl shadow-lg z-50 flex items-center gap-3 animate-slide-up ${
            message.type === 'success'
              ? 'bg-emerald-600 text-white'
              : 'bg-red-600 text-white'
          }`}
        >
          {message.type === 'success' ? (
            <CheckCircleIcon className="w-5 h-5" />
          ) : (
            <XCircleIcon className="w-5 h-5" />
          )}
          {message.text}
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Backup Manager</h1>
          <p className="text-slate-500 text-sm mt-0.5">Create, manage, and restore database backups</p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowConfigModal(true)}
            className="btn-secondary"
          >
            <Cog6ToothIcon className="w-4 h-4" />
            Settings
          </button>
          <button
            onClick={fetchBackups}
            className="btn-secondary"
          >
            <ArrowPathIcon className="w-4 h-4" />
            Refresh
          </button>
        </div>
      </div>

      {/* Quick Backup Hero */}
      <div className="bg-slate-900 rounded-xl p-8">
        <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4">
          <div className="text-white">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-12 h-12 rounded-lg bg-white/10 flex items-center justify-center">
                <CloudArrowUpIcon className="w-6 h-6 text-white" />
              </div>
              <h2 className="text-2xl font-semibold">Quick Backup</h2>
            </div>
            <p className="text-slate-300">Create a full database backup with one click</p>
          </div>
          <button
            onClick={quickBackup}
            disabled={creating}
            className="flex items-center gap-2 px-8 py-4 bg-white text-slate-900 font-medium rounded-lg hover:bg-slate-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {creating ? (
              <>
                <ArrowPathIcon className="w-5 h-5 animate-spin" />
                Creating...
              </>
            ) : (
              <>
                <PlayIcon className="w-5 h-5" />
                Create Backup Now
              </>
            )}
          </button>
        </div>
      </div>

      {/* Stats Cards */}
      {stats && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            title="Total Backups"
            value={stats.totalBackups}
            icon={ArchiveBoxIcon}
          />
          <StatCard
            title="Total Size"
            value={formatBytes(stats.totalSize)}
            icon={FolderIcon}
          />
          <StatCard
            title="Last Backup"
            value={stats.lastBackup ? new Date(stats.lastBackup).toLocaleDateString() : 'Never'}
            subtitle={stats.lastBackup ? new Date(stats.lastBackup).toLocaleTimeString() : undefined}
            icon={ClockIcon}
          />
          <StatCard
            title="By Type"
            value={Object.values(stats.backupsByType).reduce((a, b) => a + b, 0)}
            subtitle={Object.entries(stats.backupsByType).map(([t, c]) => `${t}: ${c}`).join(' | ')}
            icon={DocumentDuplicateIcon}
          />
        </div>
      )}

      {/* Create Backup Options */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 transition-colors hover:border-slate-300">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-lg bg-slate-100 flex items-center justify-center">
            <CloudArrowUpIcon className="w-5 h-5 text-slate-600" />
          </div>
          <h3 className="text-lg font-semibold text-slate-900">Create New Backup</h3>
        </div>
        <div className="flex flex-wrap gap-4">
          <button
            onClick={() => createBackup('full')}
            disabled={creating}
            className="flex items-center gap-2 px-5 py-2.5 bg-slate-900 text-white rounded-lg font-medium hover:bg-slate-800 disabled:opacity-50 transition-colors"
          >
            <ArchiveBoxIcon className="w-5 h-5" />
            Full Backup
          </button>
          <button
            onClick={() => createBackup('incremental')}
            disabled={creating}
            className="flex items-center gap-2 px-5 py-2.5 bg-slate-100 text-slate-700 rounded-lg font-medium hover:bg-slate-200 disabled:opacity-50 transition-colors"
          >
            <DocumentDuplicateIcon className="w-5 h-5" />
            Incremental
          </button>
          <button
            onClick={() => createBackup('config')}
            disabled={creating}
            className="flex items-center gap-2 px-5 py-2.5 bg-slate-100 text-slate-700 rounded-lg font-medium hover:bg-slate-200 disabled:opacity-50 transition-colors"
          >
            <Cog6ToothIcon className="w-5 h-5" />
            Config Only
          </button>
          <div className="flex-1" />
          <button
            onClick={runCleanup}
            className="flex items-center gap-2 px-5 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg font-medium transition-colors"
          >
            <TrashIcon className="w-5 h-5" />
            Run Cleanup
          </button>
        </div>
      </div>

      {/* Backups List */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 bg-slate-50">
          <div className="flex items-center gap-3">
            <ArchiveBoxIcon className="w-5 h-5 text-slate-500" />
            <h3 className="text-lg font-semibold text-slate-900">Backup History</h3>
            <span className="text-sm text-slate-400">({backups.length} backups)</span>
          </div>
        </div>
        {backups.length === 0 ? (
          <div className="p-16 text-center">
            <div className="flex flex-col items-center gap-4">
              <div className="w-16 h-16 rounded-full bg-slate-100 flex items-center justify-center">
                <ArchiveBoxIcon className="w-8 h-8 text-slate-400" />
              </div>
              <div>
                <p className="text-slate-600 font-medium">No backups found</p>
                <p className="text-slate-400 text-sm mt-1">Create your first backup using the options above</p>
              </div>
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-100">
                  <th className="px-6 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">ID</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Type</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Status</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Created</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Size</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Records</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {backups.map((backup) => (
                  <tr key={backup.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-6 py-4">
                      <span className="font-mono text-sm text-slate-600 bg-slate-100 px-2 py-1 rounded">
                        {backup.id.substring(0, 12)}...
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <TypeBadge type={backup.type} />
                    </td>
                    <td className="px-6 py-4">
                      <StatusBadge status={backup.status} />
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2 text-sm text-slate-500">
                        <ClockIcon className="w-4 h-4 text-slate-400" />
                        {formatDate(backup.createdAt)}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-sm text-slate-600 font-medium">
                      {formatBytes(backup.size)}
                    </td>
                    <td className="px-6 py-4 text-sm text-slate-500">
                      {backup.recordCount?.toLocaleString() || '-'}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex gap-2">
                        {backup.restorable && backup.status === 'completed' && (
                          <button
                            onClick={() => setShowRestoreModal(backup)}
                            className="flex items-center gap-1 px-3 py-1.5 text-sm text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
                          >
                            <CloudArrowDownIcon className="w-4 h-4" />
                            Restore
                          </button>
                        )}
                        <button
                          onClick={() => verifyBackup(backup.id)}
                          className="flex items-center gap-1 px-3 py-1.5 text-sm text-emerald-600 hover:text-emerald-800 bg-emerald-50 hover:bg-emerald-100 rounded-lg transition-colors"
                        >
                          <ShieldCheckIcon className="w-4 h-4" />
                          Verify
                        </button>
                        <button
                          onClick={() => deleteBackup(backup.id)}
                          className="flex items-center gap-1 px-3 py-1.5 text-sm text-red-600 hover:text-red-800 bg-red-50 hover:bg-red-100 rounded-lg transition-colors"
                        >
                          <TrashIcon className="w-4 h-4" />
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Restore Modal */}
      {showRestoreModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl p-6 max-w-md w-full mx-4 animate-slide-up">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-12 h-12 rounded-lg bg-slate-100 flex items-center justify-center">
                <CloudArrowDownIcon className="w-6 h-6 text-slate-600" />
              </div>
              <h3 className="text-xl font-semibold text-slate-900">Restore Backup</h3>
            </div>

            <div className="space-y-3 mb-6">
              <div className="flex justify-between p-3 bg-slate-50 rounded-lg">
                <span className="text-slate-500">Backup ID</span>
                <span className="font-mono text-sm">{showRestoreModal.id.substring(0, 16)}...</span>
              </div>
              <div className="flex justify-between p-3 bg-slate-50 rounded-lg">
                <span className="text-slate-500">Created</span>
                <span>{formatDate(showRestoreModal.createdAt)}</span>
              </div>
              {showRestoreModal.tables && (
                <div className="p-3 bg-slate-50 rounded-lg">
                  <span className="text-slate-500 block mb-1">Tables</span>
                  <span className="text-sm">{showRestoreModal.tables.join(', ')}</span>
                </div>
              )}
            </div>

            <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg mb-6">
              <div className="flex items-start gap-3">
                <ExclamationTriangleIcon className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
                <p className="text-amber-800 text-sm">
                  Restoring with overwrite will delete existing data in the selected tables.
                </p>
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setShowRestoreModal(null)}
                className="flex-1 px-4 py-2.5 bg-slate-100 hover:bg-slate-200 rounded-lg font-medium transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => restoreBackup(showRestoreModal.id, false, true)}
                disabled={restoring === showRestoreModal.id}
                className="flex-1 px-4 py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-lg font-medium disabled:opacity-50 transition-colors"
              >
                Dry Run
              </button>
              <button
                onClick={() => restoreBackup(showRestoreModal.id, true, false)}
                disabled={restoring === showRestoreModal.id}
                className="flex-1 px-4 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium disabled:opacity-50 transition-colors"
              >
                {restoring === showRestoreModal.id ? 'Restoring...' : 'Restore'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Config Modal */}
      {showConfigModal && config && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl p-6 max-w-md w-full mx-4 animate-slide-up">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-12 h-12 rounded-lg bg-slate-100 flex items-center justify-center">
                <Cog6ToothIcon className="w-6 h-6 text-slate-600" />
              </div>
              <h3 className="text-xl font-semibold text-slate-900">Backup Settings</h3>
            </div>

            <div className="space-y-4 mb-6">
              <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                <label className="text-slate-700 font-medium">Auto Backup</label>
                <input
                  type="checkbox"
                  checked={config.autoBackup}
                  onChange={(e) => updateConfig({ autoBackup: e.target.checked })}
                  className="rounded text-slate-600 w-5 h-5"
                />
              </div>

              <div className="p-3 bg-slate-50 rounded-lg">
                <label className="text-slate-700 font-medium block mb-2">Schedule (cron)</label>
                <input
                  type="text"
                  value={config.schedule}
                  onChange={(e) => setConfig({ ...config, schedule: e.target.value })}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-slate-500"
                />
              </div>

              <div className="p-3 bg-slate-50 rounded-lg">
                <label className="text-slate-700 font-medium block mb-2">Retention Days</label>
                <input
                  type="number"
                  value={config.retentionDays}
                  onChange={(e) => setConfig({ ...config, retentionDays: parseInt(e.target.value) })}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-slate-500"
                />
              </div>

              <div className="p-3 bg-slate-50 rounded-lg">
                <label className="text-slate-700 font-medium block mb-2">Max Backups</label>
                <input
                  type="number"
                  value={config.maxBackups}
                  onChange={(e) => setConfig({ ...config, maxBackups: parseInt(e.target.value) })}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-slate-500"
                />
              </div>

              <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                <label className="text-slate-700 font-medium">Include System Logs</label>
                <input
                  type="checkbox"
                  checked={config.includeLogs}
                  onChange={(e) => setConfig({ ...config, includeLogs: e.target.checked })}
                  className="rounded text-slate-600 w-5 h-5"
                />
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setShowConfigModal(false)}
                className="flex-1 px-4 py-2.5 bg-slate-100 hover:bg-slate-200 rounded-lg font-medium transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => updateConfig(config)}
                className="flex-1 px-4 py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-lg font-medium transition-colors"
              >
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
