import React, { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../utils/api';

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

const StatusBadge: React.FC<{ status: BackupInfo['status'] }> = ({ status }) => {
  const colors = {
    pending: 'bg-gray-100 text-gray-800',
    in_progress: 'bg-blue-100 text-blue-800',
    completed: 'bg-green-100 text-green-800',
    failed: 'bg-red-100 text-red-800',
  };

  return (
    <span className={`px-2 py-1 rounded-full text-xs font-medium ${colors[status]}`}>
      {status.replace('_', ' ')}
    </span>
  );
};

const TypeBadge: React.FC<{ type: BackupInfo['type'] }> = ({ type }) => {
  const colors = {
    full: 'bg-purple-100 text-purple-800',
    incremental: 'bg-blue-100 text-blue-800',
    config: 'bg-yellow-100 text-yellow-800',
    logs: 'bg-gray-100 text-gray-800',
  };

  return (
    <span className={`px-2 py-1 rounded-full text-xs font-medium ${colors[type]}`}>
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

  const showMessage = (type: 'success' | 'error', text: string) => {
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
        showMessage('success', `${type.charAt(0).toUpperCase() + type.slice(1)} backup created successfully!`);
        fetchBackups();
      } else {
        showMessage('error', data.error || 'Failed to create backup');
      }
    } catch (err) {
      showMessage('error', 'Failed to create backup');
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
        showMessage('success', 'Quick backup completed!');
        fetchBackups();
      } else {
        showMessage('error', data.error || 'Backup failed');
      }
    } catch (err) {
      showMessage('error', 'Failed to create backup');
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
          showMessage('success', `Dry run: Would restore ${result.recordsRestored} records from ${result.tablesRestored.length} tables`);
        } else {
          showMessage('success', `Restored ${result.recordsRestored} records from ${result.tablesRestored.length} tables`);
        }
        setShowRestoreModal(null);
        fetchBackups();
      } else {
        showMessage('error', data.error || 'Restore failed');
      }
    } catch (err) {
      showMessage('error', 'Failed to restore backup');
    } finally {
      setRestoring(null);
    }
  };

  const verifyBackup = async (backupId: string) => {
    try {
      const res = await apiFetch(`/api/backup/${backupId}/verify`, { method: 'POST' });
      const data = await res.json();

      if (data.valid) {
        showMessage('success', 'Backup verified successfully - integrity OK');
      } else {
        showMessage('error', `Backup verification failed: ${data.error}`);
      }
    } catch (err) {
      showMessage('error', 'Failed to verify backup');
    }
  };

  const deleteBackup = async (backupId: string) => {
    if (!confirm('Are you sure you want to delete this backup?')) return;

    try {
      const res = await apiFetch(`/api/backup/${backupId}`, { method: 'DELETE' });

      if (res.ok) {
        showMessage('success', 'Backup deleted');
        fetchBackups();
      } else {
        const data = await res.json();
        showMessage('error', data.error || 'Failed to delete backup');
      }
    } catch (err) {
      showMessage('error', 'Failed to delete backup');
    }
  };

  const runCleanup = async () => {
    try {
      const res = await apiFetch('/api/backup/cleanup', { method: 'POST' });
      const data = await res.json();

      if (res.ok) {
        showMessage('success', `Cleanup completed: ${data.deleted} backups removed`);
        fetchBackups();
      } else {
        showMessage('error', data.error || 'Cleanup failed');
      }
    } catch (err) {
      showMessage('error', 'Failed to run cleanup');
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
        showMessage('success', 'Configuration updated');
        setShowConfigModal(false);
      } else {
        showMessage('error', 'Failed to update configuration');
      }
    } catch (err) {
      showMessage('error', 'Failed to update configuration');
    }
  };

  if (loading) {
    return (
      <div className="animate-pulse">
        <div className="h-8 bg-gray-200 rounded w-1/4 mb-6"></div>
        <div className="grid grid-cols-4 gap-4 mb-6">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-24 bg-gray-200 rounded"></div>
          ))}
        </div>
        <div className="h-64 bg-gray-200 rounded"></div>
      </div>
    );
  }

  return (
    <>
      {/* Message Toast */}
      {message && (
        <div
          className={`fixed top-4 right-4 p-4 rounded-lg shadow-lg z-50 ${
            message.type === 'success' ? 'bg-green-500 text-white' : 'bg-red-500 text-white'
          }`}
        >
          {message.text}
        </div>
      )}

      {/* Header */}
      <div className="mb-6 flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Backup Manager</h1>
          <p className="text-gray-600">Create, manage, and restore database backups</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setShowConfigModal(true)}
            className="px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded text-sm"
          >
            Settings
          </button>
          <button
            onClick={fetchBackups}
            className="px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded text-sm"
          >
            Refresh
          </button>
        </div>
      </div>

      {/* Quick Backup Button */}
      <div className="mb-6 p-6 bg-gradient-to-r from-blue-500 to-blue-600 rounded-lg text-white">
        <div className="flex justify-between items-center">
          <div>
            <h2 className="text-xl font-bold">Quick Backup</h2>
            <p className="text-blue-100">Create a full database backup with one click</p>
          </div>
          <button
            onClick={quickBackup}
            disabled={creating}
            className="px-6 py-3 bg-white text-blue-600 font-bold rounded-lg hover:bg-blue-50 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {creating ? (
              <span className="flex items-center gap-2">
                <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                Creating...
              </span>
            ) : (
              'Create Backup Now'
            )}
          </button>
        </div>
      </div>

      {/* Stats Cards */}
      {stats && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-white rounded-lg shadow p-4">
            <h3 className="text-sm font-medium text-gray-500">Total Backups</h3>
            <p className="text-2xl font-bold text-gray-900">{stats.totalBackups}</p>
          </div>
          <div className="bg-white rounded-lg shadow p-4">
            <h3 className="text-sm font-medium text-gray-500">Total Size</h3>
            <p className="text-2xl font-bold text-gray-900">{formatBytes(stats.totalSize)}</p>
          </div>
          <div className="bg-white rounded-lg shadow p-4">
            <h3 className="text-sm font-medium text-gray-500">Last Backup</h3>
            <p className="text-lg font-bold text-gray-900">
              {stats.lastBackup ? new Date(stats.lastBackup).toLocaleDateString() : 'Never'}
            </p>
          </div>
          <div className="bg-white rounded-lg shadow p-4">
            <h3 className="text-sm font-medium text-gray-500">Backup Types</h3>
            <div className="flex gap-2 mt-1">
              {Object.entries(stats.backupsByType).map(([type, count]) => (
                <span key={type} className="text-sm">
                  {type}: {count}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Create Backup Options */}
      <div className="bg-white rounded-lg shadow p-4 mb-6">
        <h3 className="text-sm font-medium text-gray-500 mb-4">Create New Backup</h3>
        <div className="flex gap-4">
          <button
            onClick={() => createBackup('full')}
            disabled={creating}
            className="px-4 py-2 bg-purple-500 hover:bg-purple-600 text-white rounded disabled:opacity-50"
          >
            Full Backup
          </button>
          <button
            onClick={() => createBackup('incremental')}
            disabled={creating}
            className="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded disabled:opacity-50"
          >
            Incremental
          </button>
          <button
            onClick={() => createBackup('config')}
            disabled={creating}
            className="px-4 py-2 bg-yellow-500 hover:bg-yellow-600 text-white rounded disabled:opacity-50"
          >
            Config Only
          </button>
          <div className="flex-1" />
          <button
            onClick={runCleanup}
            className="px-4 py-2 bg-gray-500 hover:bg-gray-600 text-white rounded"
          >
            Run Cleanup
          </button>
        </div>
      </div>

      {/* Backups List */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-200">
          <h3 className="text-lg font-medium">Backup History</h3>
        </div>
        {backups.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            No backups found. Create your first backup above.
          </div>
        ) : (
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">ID</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Created</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Size</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Records</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {backups.map((backup) => (
                <tr key={backup.id}>
                  <td className="px-4 py-3 text-sm font-mono text-gray-600">
                    {backup.id.substring(0, 20)}...
                  </td>
                  <td className="px-4 py-3">
                    <TypeBadge type={backup.type} />
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={backup.status} />
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500">
                    {formatDate(backup.createdAt)}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500">
                    {formatBytes(backup.size)}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500">
                    {backup.recordCount?.toLocaleString() || '-'}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      {backup.restorable && backup.status === 'completed' && (
                        <button
                          onClick={() => setShowRestoreModal(backup)}
                          className="text-blue-600 hover:text-blue-800 text-sm"
                        >
                          Restore
                        </button>
                      )}
                      <button
                        onClick={() => verifyBackup(backup.id)}
                        className="text-green-600 hover:text-green-800 text-sm"
                      >
                        Verify
                      </button>
                      <button
                        onClick={() => deleteBackup(backup.id)}
                        className="text-red-600 hover:text-red-800 text-sm"
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Restore Modal */}
      {showRestoreModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-bold mb-4">Restore from Backup</h3>
            <p className="text-gray-600 mb-4">
              Backup: <span className="font-mono">{showRestoreModal.id.substring(0, 20)}...</span>
            </p>
            <p className="text-gray-600 mb-4">
              Created: {formatDate(showRestoreModal.createdAt)}
            </p>
            {showRestoreModal.tables && (
              <p className="text-gray-600 mb-4">
                Tables: {showRestoreModal.tables.join(', ')}
              </p>
            )}

            <div className="bg-yellow-50 border border-yellow-200 rounded p-3 mb-4">
              <p className="text-yellow-800 text-sm">
                Warning: Restoring with overwrite will delete existing data in the selected tables.
              </p>
            </div>

            <div className="flex gap-4 justify-end">
              <button
                onClick={() => setShowRestoreModal(null)}
                className="px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded"
              >
                Cancel
              </button>
              <button
                onClick={() => restoreBackup(showRestoreModal.id, false, true)}
                disabled={restoring === showRestoreModal.id}
                className="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded disabled:opacity-50"
              >
                Dry Run
              </button>
              <button
                onClick={() => restoreBackup(showRestoreModal.id, true, false)}
                disabled={restoring === showRestoreModal.id}
                className="px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded disabled:opacity-50"
              >
                {restoring === showRestoreModal.id ? 'Restoring...' : 'Restore (Overwrite)'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Config Modal */}
      {showConfigModal && config && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-bold mb-4">Backup Settings</h3>

            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <label className="text-gray-700">Auto Backup</label>
                <input
                  type="checkbox"
                  checked={config.autoBackup}
                  onChange={(e) => updateConfig({ autoBackup: e.target.checked })}
                  className="rounded"
                />
              </div>

              <div>
                <label className="text-gray-700 block mb-1">Schedule (cron)</label>
                <input
                  type="text"
                  value={config.schedule}
                  onChange={(e) => setConfig({ ...config, schedule: e.target.value })}
                  className="w-full border rounded px-3 py-2"
                />
              </div>

              <div>
                <label className="text-gray-700 block mb-1">Retention Days</label>
                <input
                  type="number"
                  value={config.retentionDays}
                  onChange={(e) => setConfig({ ...config, retentionDays: parseInt(e.target.value) })}
                  className="w-full border rounded px-3 py-2"
                />
              </div>

              <div>
                <label className="text-gray-700 block mb-1">Max Backups</label>
                <input
                  type="number"
                  value={config.maxBackups}
                  onChange={(e) => setConfig({ ...config, maxBackups: parseInt(e.target.value) })}
                  className="w-full border rounded px-3 py-2"
                />
              </div>

              <div className="flex items-center justify-between">
                <label className="text-gray-700">Include System Logs</label>
                <input
                  type="checkbox"
                  checked={config.includeLogs}
                  onChange={(e) => setConfig({ ...config, includeLogs: e.target.checked })}
                  className="rounded"
                />
              </div>
            </div>

            <div className="flex gap-4 justify-end mt-6">
              <button
                onClick={() => setShowConfigModal(false)}
                className="px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded"
              >
                Cancel
              </button>
              <button
                onClick={() => updateConfig(config)}
                className="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded"
              >
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
