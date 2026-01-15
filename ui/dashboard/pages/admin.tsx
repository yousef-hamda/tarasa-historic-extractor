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
  ClockIcon,
  ServerStackIcon,
  CpuChipIcon,
  SignalIcon,
  ChartBarIcon,
} from '@heroicons/react/24/outline';

// Quick Stat Card Component
const QuickStat: React.FC<{
  label: string;
  value: string;
  icon: React.ReactNode;
}> = ({ label, value, icon }) => (
  <div className="flex items-center gap-3 p-4 rounded-xl bg-white border border-slate-200 transition-colors hover:border-slate-300">
    <div className="w-10 h-10 rounded-lg bg-slate-100 flex items-center justify-center">
      {icon}
    </div>
    <div>
      <p className="text-xs text-slate-500">{label}</p>
      <p className="text-sm font-semibold text-slate-900">{value}</p>
    </div>
  </div>
);

// Activity Item Component
const ActivityItem: React.FC<{
  action: string;
  time: Date;
  success: boolean;
  message?: string;
}> = ({ action, time, success, message }) => (
  <div
    className={`p-3 rounded-lg border transition-colors ${
      success
        ? 'bg-emerald-50 border-emerald-200'
        : 'bg-red-50 border-red-200'
    }`}
  >
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        {success ? (
          <CheckCircleIcon className="h-4 w-4 text-emerald-500" />
        ) : (
          <ExclamationTriangleIcon className="h-4 w-4 text-red-500" />
        )}
        <span className={`font-medium text-sm ${success ? 'text-emerald-800' : 'text-red-800'}`}>
          {action}
        </span>
      </div>
      <span className="text-xs text-slate-500">
        {formatRelativeTime(time)}
      </span>
    </div>
    {message && (
      <p className={`text-xs mt-1 ${success ? 'text-emerald-600' : 'text-red-600'}`}>
        {message}
      </p>
    )}
  </div>
);

// Log Item Component
const LogItem: React.FC<{ log: SystemLog }> = ({ log }) => {
  const typeConfig = {
    error: { bg: 'bg-red-50', text: 'text-red-700', icon: ExclamationTriangleIcon },
    scrape: { bg: 'bg-slate-100', text: 'text-slate-700', icon: BoltIcon },
    classify: { bg: 'bg-slate-100', text: 'text-slate-700', icon: SparklesIcon },
    message: { bg: 'bg-emerald-50', text: 'text-emerald-700', icon: ChatBubbleLeftRightIcon },
    system: { bg: 'bg-slate-100', text: 'text-slate-700', icon: CpuChipIcon },
  }[log.type] || { bg: 'bg-slate-100', text: 'text-slate-700', icon: DocumentTextIcon };

  const Icon = typeConfig.icon;

  return (
    <div className="flex items-start gap-3 p-3 rounded-lg hover:bg-slate-50 transition-colors">
      <div className={`flex-shrink-0 w-8 h-8 rounded-lg ${typeConfig.bg} flex items-center justify-center`}>
        <Icon className={`h-4 w-4 ${typeConfig.text}`} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-slate-700 truncate">{log.message}</p>
        <p className="text-xs text-slate-400 mt-0.5">{formatRelativeTime(log.createdAt)}</p>
      </div>
    </div>
  );
};

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
        <div className="animate-pulse">
          <div className="h-8 bg-slate-200 rounded w-64 mb-2" />
          <div className="h-4 bg-slate-100 rounded w-48" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[1, 2, 3].map((i) => (
            <div key={i} className="animate-pulse">
              <div className="h-48 bg-slate-200 rounded-xl" />
            </div>
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
          <h1 className="text-2xl font-semibold text-slate-900">Admin Dashboard</h1>
          <p className="text-slate-500 text-sm mt-0.5">System management and control center</p>
        </div>
        <div className="flex items-center gap-3">
          {lastFetch && (
            <span className="text-xs text-slate-400 flex items-center gap-1">
              <ClockIcon className="h-3.5 w-3.5" />
              Updated {formatRelativeTime(lastFetch)}
            </span>
          )}
          <button
            onClick={fetchData}
            className="btn-secondary"
          >
            <ArrowPathIcon className="h-4 w-4" />
            Refresh
          </button>
        </div>
      </div>

      {/* Quick Stats Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <QuickStat
          label="Uptime"
          value={health?.uptime ? formatUptime(health.uptime) : 'N/A'}
          icon={<ServerStackIcon className="h-5 w-5 text-slate-600" />}
        />
        <QuickStat
          label="Total Groups"
          value={String(groups?.summary.total || 0)}
          icon={<SignalIcon className="h-5 w-5 text-slate-600" />}
        />
        <QuickStat
          label="Posts Today"
          value={String(stats?.postsTotal || 0)}
          icon={<ChartBarIcon className="h-5 w-5 text-slate-600" />}
        />
        <QuickStat
          label="Messages Sent"
          value={`${stats?.sentLast24h || 0}/${stats?.messageLimit || 20}`}
          icon={<ChatBubbleLeftRightIcon className="h-5 w-5 text-slate-600" />}
        />
      </div>

      {/* System Pipeline Diagram */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 transition-colors hover:border-slate-300">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-lg bg-slate-100 flex items-center justify-center">
            <CpuChipIcon className="h-5 w-5 text-slate-600" />
          </div>
          <h2 className="text-lg font-semibold text-slate-900">System Pipeline</h2>
        </div>
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
      </div>

      {/* System Status Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {/* Overall Health */}
        <div className="bg-white border border-slate-200 rounded-xl transition-colors hover:border-slate-300">
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
        </div>

        {/* Session Status */}
        <div className="bg-white border border-slate-200 rounded-xl transition-colors hover:border-slate-300">
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
        </div>

        {/* System Info */}
        <div className="bg-white border border-slate-200 rounded-xl transition-colors hover:border-slate-300">
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
      </div>

      {/* Manual Triggers Section */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Trigger Controls */}
        <div className="lg:col-span-2 bg-white border border-slate-200 rounded-xl p-6 space-y-6 transition-colors hover:border-slate-300">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-slate-100 flex items-center justify-center">
              <Cog6ToothIcon className="h-5 w-5 text-slate-600" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Manual Triggers</h2>
              <p className="text-sm text-slate-500">Bypass scheduled cron jobs and run operations manually</p>
            </div>
          </div>

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
          <div className="pt-4 border-t border-slate-100">
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
              className={`w-full flex items-center justify-center gap-3 px-6 py-4 rounded-xl font-medium transition-all ${
                !pipelineRunning
                  ? 'bg-slate-900 text-white hover:bg-slate-800'
                  : 'bg-slate-100 text-slate-400 cursor-not-allowed'
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
        <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4 transition-colors hover:border-slate-300">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center">
              <ClipboardDocumentListIcon className="h-4 w-4 text-slate-600" />
            </div>
            <h2 className="text-lg font-semibold text-slate-900">Trigger History</h2>
          </div>
          {triggerHistory.length === 0 ? (
            <div className="text-center py-8">
              <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-slate-100 flex items-center justify-center">
                <ClockIcon className="h-6 w-6 text-slate-400" />
              </div>
              <p className="text-sm text-slate-500">No triggers yet this session</p>
            </div>
          ) : (
            <div className="space-y-2 max-h-72 overflow-y-auto">
              {triggerHistory.map((item, index) => (
                <ActivityItem
                  key={index}
                  action={item.action}
                  time={item.time}
                  success={item.success}
                  message={item.message}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Groups Section */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4 transition-colors hover:border-slate-300">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-slate-100 flex items-center justify-center">
              <SignalIcon className="h-5 w-5 text-slate-600" />
            </div>
            <h2 className="text-lg font-semibold text-slate-900">Facebook Groups</h2>
          </div>
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
        <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4 transition-colors hover:border-slate-300">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-slate-100 flex items-center justify-center">
                <DocumentTextIcon className="h-5 w-5 text-slate-600" />
              </div>
              <h2 className="text-lg font-semibold text-slate-900">Recent Logs</h2>
            </div>
            <a href="/logs" className="text-sm text-slate-600 hover:text-slate-900 font-medium">
              View All
            </a>
          </div>

          <div className="space-y-1 max-h-72 overflow-y-auto">
            {recentLogs.slice(0, 10).map((log) => (
              <LogItem key={log.id} log={log} />
            ))}
          </div>
        </div>

        {/* Recent Errors */}
        <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4 transition-colors hover:border-slate-300">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-red-50 flex items-center justify-center">
                <ExclamationTriangleIcon className="h-5 w-5 text-red-600" />
              </div>
              <h2 className="text-lg font-semibold text-slate-900">Recent Errors</h2>
            </div>
            <a href="/logs?type=error" className="text-sm text-slate-600 hover:text-slate-900 font-medium">
              View All
            </a>
          </div>

          {recentErrors.length === 0 ? (
            <div className="text-center py-8">
              <div className="w-16 h-16 mx-auto mb-3 rounded-full bg-emerald-50 flex items-center justify-center">
                <CheckCircleIcon className="h-8 w-8 text-emerald-500" />
              </div>
              <p className="text-slate-600 font-medium">No recent errors</p>
              <p className="text-sm text-slate-400 mt-1">System is running smoothly</p>
            </div>
          ) : (
            <div className="space-y-2 max-h-72 overflow-y-auto">
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
      <div className="bg-white border border-slate-200 rounded-xl p-6 transition-colors hover:border-slate-300">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-lg bg-slate-100 flex items-center justify-center">
            <InformationCircleIcon className="h-5 w-5 text-slate-600" />
          </div>
          <h3 className="font-semibold text-slate-900">System Information</h3>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="p-4 rounded-lg bg-slate-50 border border-slate-100">
            <p className="text-xs text-slate-500 mb-1">Uptime</p>
            <p className="text-lg font-semibold text-slate-900">{health?.uptime ? formatUptime(health.uptime) : 'N/A'}</p>
          </div>
          <div className="p-4 rounded-lg bg-slate-50 border border-slate-100">
            <p className="text-xs text-slate-500 mb-1">Last Scrape</p>
            <p className="text-lg font-semibold text-slate-900">{stats?.lastScrapeAt ? formatRelativeTime(stats.lastScrapeAt) : 'Never'}</p>
          </div>
          <div className="p-4 rounded-lg bg-slate-50 border border-slate-100">
            <p className="text-xs text-slate-500 mb-1">Last Message</p>
            <p className="text-lg font-semibold text-slate-900">{stats?.lastMessageSentAt ? formatRelativeTime(stats.lastMessageSentAt) : 'Never'}</p>
          </div>
          <div className="p-4 rounded-lg bg-slate-50 border border-slate-100">
            <p className="text-xs text-slate-500 mb-1">Quota Today</p>
            <p className="text-lg font-semibold text-slate-900">{stats?.sentLast24h ?? 0} / {stats?.messageLimit ?? 20}</p>
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
