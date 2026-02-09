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
  MagnifyingGlassIcon,
  LinkIcon,
  UsersIcon,
  ClockIcon,
  BoltIcon,
  SparklesIcon,
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

// Stat Card Component
const StatCard: React.FC<{
  title: string;
  value: string | number;
  icon: React.ReactNode;
  trend?: string;
}> = ({ title, value, icon, trend }) => (
  <div className="bg-white border border-slate-200 rounded-xl p-5 transition-colors hover:border-slate-300">
    <div className="flex items-center justify-between">
      <div>
        <p className="text-sm font-medium text-slate-500">{title}</p>
        <p className="text-2xl font-semibold text-slate-900 mt-1">{value}</p>
        {trend && (
          <p className="text-xs text-slate-400 mt-1">{trend}</p>
        )}
      </div>
      <div className="w-10 h-10 rounded-lg bg-slate-100 flex items-center justify-center">
        {icon}
      </div>
    </div>
  </div>
);

// Group Type Badge
const GroupTypeBadge: React.FC<{ type: string }> = ({ type }) => {
  const config = {
    public: {
      icon: <GlobeAltIcon className="h-3.5 w-3.5" />,
      bg: 'bg-emerald-50',
      text: 'text-emerald-700',
      label: 'Public',
    },
    private: {
      icon: <LockClosedIcon className="h-3.5 w-3.5" />,
      bg: 'bg-amber-50',
      text: 'text-amber-700',
      label: 'Private',
    },
    unknown: {
      icon: <ExclamationTriangleIcon className="h-3.5 w-3.5" />,
      bg: 'bg-slate-100',
      text: 'text-slate-600',
      label: 'Unknown',
    },
  }[type] || { icon: null, bg: 'bg-slate-100', text: 'text-slate-600', label: 'Unknown' };

  return (
    <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium ${config.bg} ${config.text}`}>
      {config.icon}
      {config.label}
    </span>
  );
};

// Access Method Badge
const AccessBadge: React.FC<{ method: string; accessible: boolean }> = ({ method, accessible }) => {
  if (!accessible) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium bg-red-50 text-red-700">
        <XCircleIcon className="h-3.5 w-3.5" />
        Inaccessible
      </span>
    );
  }

  const config = {
    apify: {
      icon: <BoltIcon className="h-3.5 w-3.5" />,
      bg: 'bg-slate-100',
      text: 'text-slate-700',
      label: 'Apify',
    },
    playwright: {
      icon: <SparklesIcon className="h-3.5 w-3.5" />,
      bg: 'bg-slate-100',
      text: 'text-slate-700',
      label: 'Playwright',
    },
    none: {
      icon: <ClockIcon className="h-3.5 w-3.5" />,
      bg: 'bg-slate-100',
      text: 'text-slate-500',
      label: 'Pending',
    },
  }[method] || { icon: null, bg: 'bg-slate-100', text: 'text-slate-600', label: 'Pending' };

  return (
    <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium ${config.bg} ${config.text}`}>
      {config.icon}
      {config.label}
    </span>
  );
};

// Group Card Component
const GroupCard: React.FC<{
  group: GroupInfo;
  onReset: () => void;
  onDelete: () => void;
  isResetting: boolean;
  isDeleting: boolean;
}> = ({ group, onReset, onDelete, isResetting, isDeleting }) => {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5 transition-colors hover:border-slate-300">
      <div className="flex items-start gap-4">
        {/* Group Icon */}
        <div className={`flex-shrink-0 w-12 h-12 rounded-lg flex items-center justify-center ${
          group.isAccessible ? 'bg-slate-100' : 'bg-red-50'
        }`}>
          {group.groupType === 'public' ? (
            <GlobeAltIcon className={`h-6 w-6 ${group.isAccessible ? 'text-slate-600' : 'text-red-500'}`} />
          ) : group.groupType === 'private' ? (
            <LockClosedIcon className={`h-6 w-6 ${group.isAccessible ? 'text-slate-600' : 'text-red-500'}`} />
          ) : (
            <ExclamationTriangleIcon className={`h-6 w-6 ${group.isAccessible ? 'text-slate-600' : 'text-red-500'}`} />
          )}
        </div>

        {/* Group Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-semibold text-slate-900 truncate">
              {group.groupName || `Group ${group.groupId}`}
            </h3>
            <GroupTypeBadge type={group.groupType} />
            <AccessBadge method={group.accessMethod} accessible={group.isAccessible} />
          </div>

          <p className="text-sm text-slate-500 mt-1 font-mono">
            ID: {group.groupId}
          </p>

          {/* Stats Row */}
          <div className="flex flex-wrap gap-4 mt-3">
            {group.memberCount && (
              <div className="flex items-center gap-1.5 text-xs text-slate-500">
                <UsersIcon className="h-4 w-4" />
                <span className="font-medium">{group.memberCount.toLocaleString()}</span>
                <span>members</span>
              </div>
            )}
            {group.lastScraped && (
              <div className="flex items-center gap-1.5 text-xs text-slate-500">
                <ClockIcon className="h-4 w-4" />
                <span>Last scraped:</span>
                <span className="font-medium">{formatRelativeTime(group.lastScraped)}</span>
              </div>
            )}
          </div>

          {/* Error Message */}
          {group.errorMessage && (
            <div className="mt-3 p-2 rounded-lg bg-red-50 border border-red-100">
              <p className="text-xs text-red-600 flex items-center gap-1.5">
                <ExclamationTriangleIcon className="h-4 w-4 flex-shrink-0" />
                {group.errorMessage}
              </p>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1">
          <a
            href={`https://facebook.com/groups/${group.groupId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="p-2 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
            title="Open in Facebook"
          >
            <LinkIcon className="h-4 w-4" />
          </a>
          <button
            onClick={onReset}
            disabled={isResetting}
            className={`p-2 rounded-lg transition-colors ${
              isResetting
                ? 'text-slate-300 cursor-not-allowed'
                : 'text-slate-400 hover:text-slate-600 hover:bg-slate-100'
            }`}
            title="Reset detection cache"
          >
            <ArrowPathIcon className={`h-4 w-4 ${isResetting ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={onDelete}
            disabled={isDeleting}
            className={`p-2 rounded-lg transition-colors ${
              isDeleting
                ? 'text-slate-300 cursor-not-allowed'
                : 'text-slate-400 hover:text-red-600 hover:bg-red-50'
            }`}
            title="Remove group"
          >
            {isDeleting ? (
              <ArrowPathIcon className="h-4 w-4 animate-spin" />
            ) : (
              <TrashIcon className="h-4 w-4" />
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

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
  const [searchQuery, setSearchQuery] = useState('');

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
      const res = await apiFetch('/api/groups', {
        method: 'POST',
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
      const res = await apiFetch(`/api/groups/${groupId}`, {
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
      const res = await apiFetch(`/api/groups/${groupId}/reset`, {
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
      const res = await apiFetch('/api/groups/reset-all', {
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

  // Filter groups based on search
  const filteredGroups = groups.filter((g) =>
    g.groupName?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    g.groupId.includes(searchQuery)
  );

  // Calculate stats
  const stats = {
    total: groups.length,
    accessible: groups.filter((g) => g.isAccessible).length,
    public: groups.filter((g) => g.groupType === 'public').length,
    private: groups.filter((g) => g.groupType === 'private').length,
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-48 skeleton" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-24 skeleton" />
          ))}
        </div>
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-28 skeleton" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-slide-up">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Groups</h1>
          <p className="text-slate-500 text-sm mt-0.5">
            Manage Facebook groups ({groups.length} total)
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleResetAllGroups}
            disabled={resettingAll}
            className="btn-secondary"
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
            className="btn-secondary"
          >
            <ArrowPathIcon className="h-4 w-4" />
            Refresh
          </button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Total Groups"
          value={stats.total}
          icon={<UserGroupIcon className="h-5 w-5 text-slate-600" />}
        />
        <StatCard
          title="Accessible"
          value={stats.accessible}
          icon={<CheckCircleIcon className="h-5 w-5 text-emerald-600" />}
          trend={`${stats.total > 0 ? Math.round((stats.accessible / stats.total) * 100) : 0}% success rate`}
        />
        <StatCard
          title="Public Groups"
          value={stats.public}
          icon={<GlobeAltIcon className="h-5 w-5 text-slate-600" />}
        />
        <StatCard
          title="Private Groups"
          value={stats.private}
          icon={<LockClosedIcon className="h-5 w-5 text-slate-600" />}
        />
      </div>

      {/* Messages */}
      {error && (
        <div className="flex items-center gap-3 p-4 rounded-xl bg-red-50 border border-red-200 text-red-700">
          <XCircleIcon className="h-5 w-5 flex-shrink-0" />
          {error}
        </div>
      )}
      {success && (
        <div className="flex items-center gap-3 p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700">
          <CheckCircleIcon className="h-5 w-5 flex-shrink-0" />
          {success}
        </div>
      )}

      {/* Add Group Form */}
      <div className="bg-white border border-slate-200 rounded-xl p-6">
        <div className="flex items-center gap-4 mb-4">
          <div className="w-10 h-10 rounded-lg bg-slate-100 flex items-center justify-center">
            <PlusIcon className="h-5 w-5 text-slate-600" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-slate-900">Add New Group</h2>
            <p className="text-sm text-slate-500">Paste a Facebook group URL to start tracking</p>
          </div>
        </div>

        <form onSubmit={handleAddGroup} className="flex gap-3">
          <div className="relative flex-1">
            <LinkIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <input
              type="text"
              value={newGroupUrl}
              onChange={(e) => setNewGroupUrl(e.target.value)}
              placeholder="https://facebook.com/groups/123456789"
              className="w-full pl-10 pr-4 py-2.5 border border-slate-200 rounded-lg text-sm"
            />
          </div>
          <button
            type="submit"
            disabled={addingGroup}
            className="btn-primary"
          >
            {addingGroup ? (
              <>
                <ArrowPathIcon className="h-4 w-4 animate-spin" />
                Adding...
              </>
            ) : (
              <>
                <PlusIcon className="h-4 w-4" />
                Add Group
              </>
            )}
          </button>
        </form>
      </div>

      {/* Groups List */}
      <div className="bg-white border border-slate-200 rounded-xl">
        {/* Header with Search */}
        <div className="px-6 py-4 border-b border-slate-100">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <h2 className="text-base font-semibold text-slate-900 flex items-center gap-2">
              <UserGroupIcon className="h-5 w-5 text-slate-500" />
              Configured Groups
            </h2>
            <div className="relative">
              <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <input
                type="text"
                placeholder="Search groups..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 pr-4 py-2 border border-slate-200 rounded-lg text-sm"
              />
            </div>
          </div>
        </div>

        {/* Groups */}
        <div className="p-4">
          {filteredGroups.length === 0 ? (
            <div className="text-center py-12">
              <div className="w-12 h-12 mx-auto mb-4 rounded-lg bg-slate-100 flex items-center justify-center">
                <UserGroupIcon className="h-6 w-6 text-slate-400" />
              </div>
              <p className="text-slate-600 font-medium">
                {searchQuery ? 'No groups match your search' : 'No groups configured'}
              </p>
              <p className="text-sm text-slate-400 mt-1">
                {searchQuery ? 'Try a different search term' : 'Add a group above to get started'}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredGroups.map((group) => (
                <GroupCard
                  key={group.groupId}
                  group={group}
                  onReset={() => handleResetGroupCache(group.groupId)}
                  onDelete={() => handleDeleteGroup(group.groupId)}
                  isResetting={resettingGroup === group.groupId}
                  isDeleting={deletingGroup === group.groupId}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default GroupsPage;

export const getServerSideProps = async () => {
  return { props: {} };
};
