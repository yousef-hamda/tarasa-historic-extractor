import React, { useEffect, useState, useCallback } from 'react';
import { apiFetch } from '../utils/api';
import SystemStatusCard from '../components/SystemStatusCard';
import GroupStatusTable from '../components/GroupStatusTable';
import TriggerButton from '../components/TriggerButton';
import StatusBadge from '../components/StatusBadge';
import SystemFlowDiagram from '../components/SystemFlowDiagram';
import { formatRelativeTime, formatUptime, formatDate } from '../utils/formatters';
import type { HealthStatus, SessionStatus, GroupsResponse, SystemLog, Stats } from '../types';
import {
  BoltIcon,
  SparklesIcon,
  ChatBubbleLeftRightIcon,
  ShieldCheckIcon,
  ExclamationTriangleIcon,
  ArrowPathIcon,
  DocumentTextIcon,
  Cog6ToothIcon,
  ClipboardDocumentListIcon,
  PlayIcon,
  InformationCircleIcon,
  CheckCircleIcon,
} from '@heroicons/react/24/outline';

const AdminPage: React.FC = () => {
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [session, setSession] = useState<SessionStatus | null>(null);
  const [groups, setGroups] = useState<GroupsResponse | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [recentErrors, setRecentErrors] = useState<SystemLog[]>([]);
  const [recentLogs, setRecentLogs] = useState<SystemLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastFetch, setLastFetch] = useState<Date | null>(null);
  const [triggerHistory, setTriggerHistory] = useState<Array<{ action: string; time: Date; success: boolean; message?: string }>>([]);
  const [pipelineRunning, setPipelineRunning] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const [healthRes, sessionRes, groupsRes, logsRes, errorLogsRes, statsRes] = await Promise.all([
        apiFetch('/api/health'),
        apiFetch('/api/session/status'),
        apiFetch('/api/session/groups'),
        apiFetch('/api/logs?limit=20'),
        apiFetch('/api/logs?limit=10&type=error'),
        apiFetch('/api/stats'),
      ]);

      if (healthRes.ok) setHealth(await healthRes.json());
      if (sessionRes.ok) setSession(await sessionRes.json());
      if (groupsRes.ok) setGroups(await groupsRes.json());
      if (statsRes.ok) setStats(await statsRes.json());
      if (logsRes.ok) {
        const logsData = await logsRes.json();
        setRecentLogs(logsData.data || []);
      }
      if (errorLogsRes.ok) {
        const logsData = await errorLogsRes.json();
        setRecentErrors(logsData.data || []);
      }
      setLastFetch(new Date());
    } catch (error) {
      console.error('Failed to fetch admin data:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const handleTrigger = async (endpoint: string, actionName: string): Promise<{ success: boolean; message?: string }> => {
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      const data = await res.json();

      if (!res.ok) {
        const result = { success: false, message: data.message || `Failed (${res.status})` };
        setTriggerHistory((prev) => [
          { action: actionName, time: new Date(), success: false, message: result.message },
          ...prev.slice(0, 9),
        ]);
        return result;
      }

      // Refresh data after trigger
      setTimeout(fetchData, 2000);

      setTriggerHistory((prev) => [
        { action: actionName, time: new Date(), success: true, message: 'Completed successfully' },
        ...prev.slice(0, 9),
      ]);

      return { success: true, message: 'Operation completed successfully' };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Network error';
      setTriggerHistory((prev) => [
        { action: actionName, time: new Date(), success: false, message },
        ...prev.slice(0, 9),
      ]);
      return { success: false, message };
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-gray-900">Admin Dashboard</h1>
        <div className="animate-pulse space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-48 bg-gray-200 rounded-lg" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Admin Dashboard</h1>
          <p className="text-gray-500 mt-1">System management and control center</p>
        </div>
        <div className="flex items-center gap-3">
          {lastFetch && (
            <span className="text-xs text-gray-400">
              Last updated: {formatRelativeTime(lastFetch)}
            </span>
          )}
          <button
            onClick={fetchData}
            className="flex items-center gap-2 px-3 py-1.5 text-sm text-gray-600 hover:text-gray-900 border border-gray-300 rounded-md hover:bg-gray-50"
          >
            <ArrowPathIcon className="h-4 w-4" />
            Refresh
          </button>
        </div>
      </div>

      {/* System Pipeline Diagram */}
      <SystemFlowDiagram
        healthStatus={health?.checks}
        stats={stats ? {
          postsTotal: stats.postsTotal,
          classifiedTotal: stats.classifiedTotal,
          historicTotal: stats.historicTotal,
          queueCount: stats.queueCount,
          sentLast24h: stats.sentLast24h,
        } : undefined}
      />

      {/* System Status Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {/* Overall Health */}
        <SystemStatusCard
          title="System Health"
          status={health?.status || 'unhealthy'}
          details={[
            { label: 'Database', value: health?.checks.database ?? false },
            { label: 'Facebook Session', value: health?.checks.facebookSession ?? false },
            { label: 'OpenAI API', value: health?.checks.openaiKey ?? false },
            { label: 'Apify Token', value: health?.checks.apifyToken ?? false },
          ]}
          lastUpdated={health?.timestamp}
          onRefresh={fetchData}
        />

        {/* Session Status */}
        <SystemStatusCard
          title="Facebook Session"
          status={
            session?.sessionHealth?.status === 'valid'
              ? 'ok'
              : session?.sessionHealth?.status === 'blocked'
              ? 'unhealthy'
              : 'degraded'
          }
          details={[
            { label: 'Status', value: session?.sessionHealth?.status || 'unknown' },
            { label: 'User ID', value: session?.userId || 'N/A' },
            { label: 'Private Groups', value: session?.canAccessPrivateGroups ?? false },
            { label: 'Needs Action', value: session?.requiresAction ? 'Yes' : 'No', status: session?.requiresAction ? 'warning' : 'ok' },
          ]}
          lastUpdated={session?.lastChecked}
        />

        {/* System Info */}
        <SystemStatusCard
          title="System Info"
          status="ok"
          details={[
            { label: 'Uptime', value: health?.uptime ? formatUptime(health.uptime) : 'N/A' },
            { label: 'Total Groups', value: String(groups?.summary.total || 0) },
            { label: 'Accessible', value: String(groups?.summary.accessible || 0), status: 'ok' },
            { label: 'Inaccessible', value: String(groups?.summary.inaccessible || 0), status: groups?.summary.inaccessible ? 'error' : 'ok' },
          ]}
        />
      </div>

      {/* Manual Triggers Section */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Trigger Controls */}
        <div className="lg:col-span-2 bg-white rounded-lg shadow p-6 space-y-6">
          <div className="flex items-center gap-2">
            <Cog6ToothIcon className="h-5 w-5 text-gray-600" />
            <h2 className="text-lg font-semibold text-gray-900">Manual Triggers</h2>
          </div>
          <p className="text-sm text-gray-600">
            Manually trigger system operations. These bypass the scheduled cron jobs.
          </p>

          {/* Trigger Buttons */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <TriggerButton
              label="Trigger Scrape"
              activeLabel="Scraping..."
              onClick={() => handleTrigger('/api/trigger-scrape', 'Scrape')}
              variant="primary"
              icon={<BoltIcon className="h-5 w-5" />}
            />
            <TriggerButton
              label="Trigger Classification"
              activeLabel="Classifying..."
              onClick={() => handleTrigger('/api/trigger-classification', 'Classification')}
              variant="secondary"
              icon={<SparklesIcon className="h-5 w-5" />}
            />
            <TriggerButton
              label="Trigger Messages"
              activeLabel="Sending..."
              onClick={() => handleTrigger('/api/trigger-message', 'Messages')}
              variant="success"
              icon={<ChatBubbleLeftRightIcon className="h-5 w-5" />}
            />
            <TriggerButton
              label="Validate Session"
              activeLabel="Validating..."
              onClick={() => handleTrigger('/api/session/validate', 'Session Validation')}
              variant="danger"
              icon={<ShieldCheckIcon className="h-5 w-5" />}
            />
          </div>

          {/* Quick Run All */}
          <div className="pt-4 border-t border-gray-100">
            <button
              onClick={async () => {
                if (pipelineRunning) return;
                setPipelineRunning(true);
                try {
                  await handleTrigger('/api/trigger-scrape', 'Scrape');
                  await handleTrigger('/api/trigger-classification', 'Classification');
                  await handleTrigger('/api/trigger-message', 'Messages');
                } finally {
                  setPipelineRunning(false);
                }
              }}
              disabled={pipelineRunning}
              className={`w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg font-medium transition-colors ${
                !pipelineRunning
                  ? 'bg-gradient-to-r from-blue-600 to-purple-600 text-white hover:from-blue-700 hover:to-purple-700'
                  : 'bg-gray-100 text-gray-400 cursor-not-allowed'
              }`}
            >
              {pipelineRunning ? (
                <>
                  <ArrowPathIcon className="h-5 w-5 animate-spin" />
                  Running Pipeline...
                </>
              ) : (
                <>
                  <PlayIcon className="h-5 w-5" />
                  Run Full Pipeline (Scrape + Classify + Send)
                </>
              )}
            </button>
          </div>
        </div>

        {/* Trigger History */}
        <div className="bg-white rounded-lg shadow p-6 space-y-4">
          <div className="flex items-center gap-2">
            <ClipboardDocumentListIcon className="h-5 w-5 text-gray-600" />
            <h2 className="text-lg font-semibold text-gray-900">Trigger History</h2>
          </div>
          {triggerHistory.length === 0 ? (
            <p className="text-sm text-gray-500 text-center py-8">No triggers yet this session</p>
          ) : (
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {triggerHistory.map((item, index) => (
                <div
                  key={index}
                  className={`p-3 rounded-lg border text-sm ${
                    item.success
                      ? 'bg-green-50 border-green-200'
                      : 'bg-red-50 border-red-200'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className={item.success ? 'text-green-800 font-medium' : 'text-red-800 font-medium'}>
                      {item.action}
                    </span>
                    <span className="text-xs text-gray-500">
                      {formatRelativeTime(item.time)}
                    </span>
                  </div>
                  {item.message && (
                    <p className={`text-xs mt-1 ${item.success ? 'text-green-600' : 'text-red-600'}`}>
                      {item.message}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Groups Section */}
      <div className="bg-white rounded-lg shadow p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">Facebook Groups</h2>
          {/* Capabilities */}
          {groups?.capabilities && (
            <div className="flex flex-wrap gap-2">
              <StatusBadge
                status={groups.capabilities.canScrapePublic ? 'ok' : 'error'}
                label={`Public: ${groups.capabilities.canScrapePublic ? 'Yes' : 'No'}`}
                size="sm"
              />
              <StatusBadge
                status={groups.capabilities.canScrapePrivate ? 'ok' : 'error'}
                label={`Private: ${groups.capabilities.canScrapePrivate ? 'Yes' : 'No'}`}
                size="sm"
              />
            </div>
          )}
        </div>
        <GroupStatusTable groups={groups?.groups || []} loading={loading} />
      </div>

      {/* Recent Activity Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Logs */}
        <div className="bg-white rounded-lg shadow p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
              <DocumentTextIcon className="h-5 w-5 text-blue-500" />
              Recent Logs
            </h2>
            <a href="/logs" className="text-sm text-blue-600 hover:text-blue-800">
              View All
            </a>
          </div>

          <div className="space-y-2 max-h-64 overflow-y-auto">
            {recentLogs.slice(0, 10).map((log) => (
              <div
                key={log.id}
                className="flex items-start gap-3 p-2 hover:bg-gray-50 rounded"
              >
                <span
                  className={`px-2 py-0.5 text-xs rounded font-medium ${
                    log.type === 'error'
                      ? 'bg-red-100 text-red-700'
                      : log.type === 'scrape'
                      ? 'bg-blue-100 text-blue-700'
                      : log.type === 'classify'
                      ? 'bg-purple-100 text-purple-700'
                      : log.type === 'message'
                      ? 'bg-green-100 text-green-700'
                      : 'bg-gray-100 text-gray-700'
                  }`}
                >
                  {log.type}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-gray-800 truncate">{log.message}</p>
                  <p className="text-xs text-gray-400">{formatRelativeTime(log.createdAt)}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Recent Errors */}
        <div className="bg-white rounded-lg shadow p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
              <ExclamationTriangleIcon className="h-5 w-5 text-red-500" />
              Recent Errors
            </h2>
            <a href="/logs?type=error" className="text-sm text-blue-600 hover:text-blue-800">
              View All
            </a>
          </div>

          {recentErrors.length === 0 ? (
            <div className="text-center py-8">
              <CheckCircleIcon className="h-12 w-12 text-green-500 mx-auto mb-2" />
              <p className="text-gray-500 text-sm">No recent errors</p>
            </div>
          ) : (
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {recentErrors.map((log) => (
                <div
                  key={log.id}
                  className="flex items-start gap-3 p-3 bg-red-50 rounded-lg border border-red-100"
                >
                  <ExclamationTriangleIcon className="h-5 w-5 text-red-500 flex-shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-red-800">{log.message}</p>
                    <p className="text-xs text-red-600 mt-1">
                      {formatRelativeTime(log.createdAt)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* System Information Footer */}
      <div className="bg-gradient-to-r from-gray-50 to-blue-50 rounded-lg p-6 border border-gray-200">
        <div className="flex items-center gap-2 mb-4">
          <InformationCircleIcon className="h-5 w-5 text-blue-500" />
          <h3 className="font-semibold text-gray-900">System Information</h3>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <div>
            <span className="text-gray-500">Uptime</span>
            <p className="font-medium text-gray-900">{health?.uptime ? formatUptime(health.uptime) : 'N/A'}</p>
          </div>
          <div>
            <span className="text-gray-500">Last Scrape</span>
            <p className="font-medium text-gray-900">{stats?.lastScrapeAt ? formatRelativeTime(stats.lastScrapeAt) : 'Never'}</p>
          </div>
          <div>
            <span className="text-gray-500">Last Message</span>
            <p className="font-medium text-gray-900">{stats?.lastMessageSentAt ? formatRelativeTime(stats.lastMessageSentAt) : 'Never'}</p>
          </div>
          <div>
            <span className="text-gray-500">Quota Today</span>
            <p className="font-medium text-gray-900">{stats?.sentLast24h ?? 0} / {stats?.messageLimit ?? 20}</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AdminPage;

export const getServerSideProps = async () => {
  return { props: {} };
};
