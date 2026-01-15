import React, { useEffect, useState, useCallback } from 'react';
import { apiFetch } from '../utils/api';
import { formatRelativeTime } from '../utils/formatters';
import {
  PlusIcon,
  TrashIcon,
  ArrowPathIcon,
  UserGroupIcon,
  CheckCircleIcon,
  XCircleIcon,
  ExclamationTriangleIcon,
  GlobeAltIcon,
  LockClosedIcon,
} from '@heroicons/react/24/outline';

interface GroupInfo {
  groupId: string;
  groupName: string | null;
  groupType: 'public' | 'private' | 'unknown';
  accessMethod: 'apify' | 'playwright' | 'none';
  isAccessible: boolean;
  memberCount: number | null;
  lastScraped: string | null;
  lastChecked: string | null;
  errorMessage: string | null;
}

const GroupsPage: React.FC = () => {
  const [groups, setGroups] = useState<GroupInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [newGroupUrl, setNewGroupUrl] = useState('');
  const [addingGroup, setAddingGroup] = useState(false);
  const [deletingGroup, setDeletingGroup] = useState<string | null>(null);
  const [resettingGroup, setResettingGroup] = useState<string | null>(null);
  const [resettingAll, setResettingAll] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const fetchGroups = useCallback(async () => {
    try {
      const res = await apiFetch('/api/groups');
      if (res.ok) {
        const data = await res.json();
        setGroups(data.groups || []);
      }
    } catch (err) {
      console.error('Failed to fetch groups:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchGroups();
  }, [fetchGroups]);

  const handleAddGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newGroupUrl.trim()) {
      setError('Please enter a group URL');
      return;
    }

    setAddingGroup(true);
    setError(null);
    setSuccess(null);

    try {
      const res = await fetch('/api/groups', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ groupUrl: newGroupUrl.trim() }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.message || 'Failed to add group');
        return;
      }

      setSuccess(`Group ${data.groupId} added successfully!`);
      setNewGroupUrl('');
      fetchGroups();
    } catch (err) {
      setError('Network error. Please try again.');
    } finally {
      setAddingGroup(false);
    }
  };

  const handleDeleteGroup = async (groupId: string) => {
    if (!confirm(`Are you sure you want to remove group ${groupId}?`)) {
      return;
    }

    setDeletingGroup(groupId);
    setError(null);
    setSuccess(null);

    try {
      const res = await fetch(`/api/groups/${groupId}`, {
        method: 'DELETE',
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.message || 'Failed to delete group');
        return;
      }

      setSuccess(`Group ${groupId} removed successfully!`);
      fetchGroups();
    } catch (err) {
      setError('Network error. Please try again.');
    } finally {
      setDeletingGroup(null);
    }
  };

  const handleResetGroupCache = async (groupId: string) => {
    setResettingGroup(groupId);
    setError(null);
    setSuccess(null);

    try {
      const res = await fetch(`/api/groups/${groupId}/reset`, {
        method: 'POST',
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.message || 'Failed to reset group cache');
        return;
      }

      setSuccess(`Group ${groupId} cache reset! It will be re-detected on next scrape.`);
      fetchGroups();
    } catch (err) {
      setError('Network error. Please try again.');
    } finally {
      setResettingGroup(null);
    }
  };

  const handleResetAllGroups = async () => {
    if (!confirm('Reset all groups? This will mark all groups as accessible and clear error messages.')) {
      return;
    }

    setResettingAll(true);
    setError(null);
    setSuccess(null);

    try {
      const res = await fetch('/api/groups/reset-all', {
        method: 'POST',
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.message || 'Failed to reset all groups');
        return;
      }

      setSuccess(data.message || 'All groups reset successfully!');
      fetchGroups();
    } catch (err) {
      setError('Network error. Please try again.');
    } finally {
      setResettingAll(false);
    }
  };

  const getGroupTypeIcon = (type: string) => {
    switch (type) {
      case 'public':
        return <GlobeAltIcon className="h-5 w-5 text-green-500" />;
      case 'private':
        return <LockClosedIcon className="h-5 w-5 text-orange-500" />;
      default:
        return <ExclamationTriangleIcon className="h-5 w-5 text-gray-400" />;
    }
  };

  const getAccessBadge = (method: string, accessible: boolean) => {
    if (!accessible) {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-red-100 text-red-700">
          <XCircleIcon className="h-3 w-3" />
          Inaccessible
        </span>
      );
    }

    switch (method) {
      case 'apify':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-700">
            <CheckCircleIcon className="h-3 w-3" />
            Apify
          </span>
        );
      case 'playwright':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-purple-100 text-purple-700">
            <CheckCircleIcon className="h-3 w-3" />
            Playwright
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
            Pending
          </span>
        );
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-gray-900">Groups Management</h1>
        <div className="animate-pulse space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-20 bg-gray-200 rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Groups Management</h1>
          <p className="text-gray-500 mt-1">
            Manage Facebook groups to scrape ({groups.length} groups)
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleResetAllGroups}
            disabled={resettingAll}
            className={`flex items-center gap-2 px-3 py-1.5 text-sm rounded-md ${
              resettingAll
                ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                : 'text-green-600 hover:text-green-700 border border-green-300 hover:bg-green-50'
            }`}
          >
            {resettingAll ? (
              <ArrowPathIcon className="h-4 w-4 animate-spin" />
            ) : (
              <ArrowPathIcon className="h-4 w-4" />
            )}
            Reset All
          </button>
          <button
            onClick={fetchGroups}
            className="flex items-center gap-2 px-3 py-1.5 text-sm text-gray-600 hover:text-gray-900 border border-gray-300 rounded-md hover:bg-gray-50"
          >
            <ArrowPathIcon className="h-4 w-4" />
            Refresh
          </button>
        </div>
      </div>

      {/* Messages */}
      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
          {error}
        </div>
      )}
      {success && (
        <div className="p-4 bg-green-50 border border-green-200 rounded-lg text-green-700">
          {success}
        </div>
      )}

      {/* Add Group Form */}
      <div className="bg-white rounded-lg shadow p-6 space-y-4">
        <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
          <PlusIcon className="h-5 w-5 text-blue-500" />
          Add New Group
        </h2>

        <form onSubmit={handleAddGroup} className="flex gap-3">
          <input
            type="text"
            value={newGroupUrl}
            onChange={(e) => setNewGroupUrl(e.target.value)}
            placeholder="Paste Facebook group URL (e.g., https://facebook.com/groups/123456)"
            className="flex-1 border border-gray-300 rounded-md px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            type="submit"
            disabled={addingGroup}
            className={`flex items-center gap-2 px-4 py-2 rounded-md font-medium transition-colors ${
              addingGroup
                ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                : 'bg-blue-600 text-white hover:bg-blue-700'
            }`}
          >
            {addingGroup ? (
              <>
                <ArrowPathIcon className="h-5 w-5 animate-spin" />
                Adding...
              </>
            ) : (
              <>
                <PlusIcon className="h-5 w-5" />
                Add Group
              </>
            )}
          </button>
        </form>
      </div>

      {/* Groups List */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <UserGroupIcon className="h-5 w-5 text-purple-500" />
            Configured Groups
          </h2>
        </div>

        {groups.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            No groups configured. Add a group above to get started.
          </div>
        ) : (
          <div className="divide-y divide-gray-200">
            {groups.map((group) => (
              <div
                key={group.groupId}
                className="p-4 hover:bg-gray-50 transition-colors"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-4 flex-1 min-w-0">
                    {/* Group Icon */}
                    <div className="flex-shrink-0 w-12 h-12 bg-gray-100 rounded-lg flex items-center justify-center">
                      {getGroupTypeIcon(group.groupType)}
                    </div>

                    {/* Group Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="font-medium text-gray-900 truncate">
                          {group.groupName || `Group ${group.groupId}`}
                        </h3>
                        {getAccessBadge(group.accessMethod, group.isAccessible)}
                      </div>

                      <p className="text-sm text-gray-500 mt-1">
                        ID: {group.groupId}
                      </p>

                      <div className="flex flex-wrap gap-4 mt-2 text-xs text-gray-500">
                        <span>
                          Type:{' '}
                          <span className="font-medium capitalize">
                            {group.groupType}
                          </span>
                        </span>
                        {group.memberCount && (
                          <span>
                            Members:{' '}
                            <span className="font-medium">
                              {group.memberCount.toLocaleString()}
                            </span>
                          </span>
                        )}
                        {group.lastScraped && (
                          <span>
                            Last scraped:{' '}
                            <span className="font-medium">
                              {formatRelativeTime(group.lastScraped)}
                            </span>
                          </span>
                        )}
                      </div>

                      {group.errorMessage && (
                        <p className="text-xs text-red-600 mt-2">
                          {group.errorMessage}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2">
                    <a
                      href={`https://facebook.com/groups/${group.groupId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-md transition-colors"
                      title="Open in Facebook"
                    >
                      <GlobeAltIcon className="h-5 w-5" />
                    </a>
                    <button
                      onClick={() => handleResetGroupCache(group.groupId)}
                      disabled={resettingGroup === group.groupId}
                      className={`p-2 rounded-md transition-colors ${
                        resettingGroup === group.groupId
                          ? 'text-gray-300 cursor-not-allowed'
                          : 'text-gray-400 hover:text-green-600 hover:bg-green-50'
                      }`}
                      title="Reset detection cache"
                    >
                      {resettingGroup === group.groupId ? (
                        <ArrowPathIcon className="h-5 w-5 animate-spin" />
                      ) : (
                        <ArrowPathIcon className="h-5 w-5" />
                      )}
                    </button>
                    <button
                      onClick={() => handleDeleteGroup(group.groupId)}
                      disabled={deletingGroup === group.groupId}
                      className={`p-2 rounded-md transition-colors ${
                        deletingGroup === group.groupId
                          ? 'text-gray-300 cursor-not-allowed'
                          : 'text-gray-400 hover:text-red-600 hover:bg-red-50'
                      }`}
                      title="Remove group"
                    >
                      {deletingGroup === group.groupId ? (
                        <ArrowPathIcon className="h-5 w-5 animate-spin" />
                      ) : (
                        <TrashIcon className="h-5 w-5" />
                      )}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default GroupsPage;

export const getServerSideProps = async () => {
  return { props: {} };
};
