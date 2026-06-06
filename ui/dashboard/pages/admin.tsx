import React, { useEffect, useState, useCallback } from 'react';
import { apiFetch } from '../utils/api';
import { useLanguage } from '../contexts/LanguageContext';
import SystemStatusCard from '../components/SystemStatusCard';
import GroupStatusTable from '../components/GroupStatusTable';
import SendApprovedPostsButton from '../components/SendApprovedPostsButton';
import StatusBadge from '../components/StatusBadge';
import SystemFlowDiagram from '../components/SystemFlowDiagram';
import { formatRelativeTime, formatUptime } from '../utils/formatters';
import type { HealthStatus, SessionStatus, GroupsResponse, Stats } from '../types';
import {
  ChatBubbleLeftRightIcon,
  ArrowPathIcon,
  InformationCircleIcon,
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
    <div className="w-10 h-10 rounded-lg bg-slate-100 flex items-center justify-center">{icon}</div>
    <div>
      <p className="text-xs text-slate-500">{label}</p>
      <p className="text-sm font-semibold text-slate-900">{value}</p>
    </div>
  </div>
);

const AdminPage: React.FC = () => {
  const { t } = useLanguage();
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [session, setSession] = useState<SessionStatus | null>(null);
  const [groups, setGroups] = useState<GroupsResponse | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastFetch, setLastFetch] = useState<Date | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const [healthRes, sessionRes, groupsRes, statsRes] = await Promise.all([
        apiFetch('/api/health'),
        apiFetch('/api/session/status'),
        apiFetch('/api/session/groups'),
        apiFetch('/api/stats'),
      ]);

      if (healthRes.ok) setHealth(await healthRes.json());
      if (sessionRes.ok) setSession(await sessionRes.json());
      if (groupsRes.ok) setGroups(await groupsRes.json());
      if (statsRes.ok) setStats(await statsRes.json());
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
      {/* Header — Send approved posts lives at the TOP of the page now. */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">{t('ui.adminDashboard')}</h1>
          <p className="text-slate-500 text-sm mt-0.5">{t('ui.controlCenter')}</p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          {lastFetch && (
            <span className="text-xs text-slate-400 flex items-center gap-1">
              <ClockIcon className="h-3.5 w-3.5" />
              {t('ui.updated')} {formatRelativeTime(lastFetch)}
            </span>
          )}
          <SendApprovedPostsButton variant="compact" />
          <button onClick={fetchData} className="btn-secondary">
            <ArrowPathIcon className="h-4 w-4" />
            {t('common.refresh')}
          </button>
        </div>
      </div>

      {/* Quick Stats Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <QuickStat
          label={t('ui.uptime')}
          value={health?.uptime ? formatUptime(health.uptime) : t('common.notAvailable')}
          icon={<ServerStackIcon className="h-5 w-5 text-slate-600" />}
        />
        <QuickStat
          label={t('ui.totalGroups')}
          value={String(groups?.summary.total || 0)}
          icon={<SignalIcon className="h-5 w-5 text-slate-600" />}
        />
        <QuickStat
          label={t('ui.postsToday')}
          value={String(stats?.postsTotal || 0)}
          icon={<ChartBarIcon className="h-5 w-5 text-slate-600" />}
        />
        <QuickStat
          label={t('ui.messagesSentStat')}
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
          <h2 className="text-lg font-semibold text-slate-900">{t('ui.systemPipeline')}</h2>
        </div>
        <SystemFlowDiagram
          healthStatus={health?.checks}
          stats={
            stats
              ? {
                  postsTotal: stats.postsTotal,
                  classifiedTotal: stats.classifiedTotal,
                  historicTotal: stats.historicTotal,
                  queueCount: stats.queueCount,
                  sentLast24h: stats.sentLast24h,
                }
              : undefined
          }
        />
      </div>

      {/* System Status Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        <div className="bg-white border border-slate-200 rounded-xl transition-colors hover:border-slate-300">
          <SystemStatusCard
            title={t('ui.systemHealth')}
            status={health?.status || 'unhealthy'}
            details={[
              { label: t('ui.database'), value: health?.checks.database ?? false },
              { label: t('ui.facebookSession'), value: health?.checks.facebookSession ?? false },
              { label: t('ui.openaiApi'), value: health?.checks.openaiKey ?? false },
              { label: t('ui.apifyToken'), value: health?.checks.apifyToken ?? false },
            ]}
            lastUpdated={health?.timestamp}
            onRefresh={fetchData}
          />
        </div>

        <div className="bg-white border border-slate-200 rounded-xl transition-colors hover:border-slate-300">
          <SystemStatusCard
            title={t('ui.facebookSession')}
            status={
              session?.sessionHealth?.status === 'valid'
                ? 'ok'
                : session?.sessionHealth?.status === 'blocked'
                ? 'unhealthy'
                : 'degraded'
            }
            details={[
              { label: t('ui.status'), value: session?.sessionHealth?.status || 'unknown' },
              { label: t('ui.userId'), value: session?.userId || t('common.notAvailable') },
              { label: t('ui.privateGroups'), value: session?.canAccessPrivateGroups ?? false },
            ]}
            lastUpdated={session?.lastChecked}
          />
        </div>

        <div className="bg-white border border-slate-200 rounded-xl transition-colors hover:border-slate-300">
          <SystemStatusCard
            title={t('ui.systemInfo')}
            status="ok"
            details={[
              { label: t('ui.uptime'), value: health?.uptime ? formatUptime(health.uptime) : t('common.notAvailable') },
              { label: t('ui.totalGroups'), value: String(groups?.summary.total || 0) },
              { label: t('ui.accessible'), value: String(groups?.summary.accessible || 0), status: 'ok' },
              {
                label: t('ui.inaccessible'),
                value: String(groups?.summary.inaccessible || 0),
                status: groups?.summary.inaccessible ? 'error' : 'ok',
              },
            ]}
          />
        </div>
      </div>

      {/* Groups Section */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4 transition-colors hover:border-slate-300">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-slate-100 flex items-center justify-center">
              <SignalIcon className="h-5 w-5 text-slate-600" />
            </div>
            <h2 className="text-lg font-semibold text-slate-900">{t('ui.facebookGroups')}</h2>
          </div>
          {groups?.capabilities && (
            <div className="flex flex-wrap gap-2">
              <StatusBadge
                status={groups.capabilities.canScrapePublic ? 'ok' : 'error'}
                label={`${t('ui.publicBadge')}: ${groups.capabilities.canScrapePublic ? t('common.yes') : t('common.no')}`}
                size="sm"
              />
              <StatusBadge
                status={groups.capabilities.canScrapePrivate ? 'ok' : 'error'}
                label={`${t('ui.privateBadge')}: ${groups.capabilities.canScrapePrivate ? t('common.yes') : t('common.no')}`}
                size="sm"
              />
            </div>
          )}
        </div>
        <GroupStatusTable groups={groups?.groups || []} loading={loading} />
      </div>

      {/* System Information Footer */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 transition-colors hover:border-slate-300">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-lg bg-slate-100 flex items-center justify-center">
            <InformationCircleIcon className="h-5 w-5 text-slate-600" />
          </div>
          <h3 className="font-semibold text-slate-900">{t('ui.systemInformation')}</h3>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="p-4 rounded-lg bg-slate-50 border border-slate-100">
            <p className="text-xs text-slate-500 mb-1">{t('ui.uptime')}</p>
            <p className="text-lg font-semibold text-slate-900">{health?.uptime ? formatUptime(health.uptime) : t('common.notAvailable')}</p>
          </div>
          <div className="p-4 rounded-lg bg-slate-50 border border-slate-100">
            <p className="text-xs text-slate-500 mb-1">{t('ui.lastScrape')}</p>
            <p className="text-lg font-semibold text-slate-900">{stats?.lastScrapeAt ? formatRelativeTime(stats.lastScrapeAt) : t('ui.never')}</p>
          </div>
          <div className="p-4 rounded-lg bg-slate-50 border border-slate-100">
            <p className="text-xs text-slate-500 mb-1">{t('ui.lastMessage')}</p>
            <p className="text-lg font-semibold text-slate-900">{stats?.lastMessageSentAt ? formatRelativeTime(stats.lastMessageSentAt) : t('ui.never')}</p>
          </div>
          <div className="p-4 rounded-lg bg-slate-50 border border-slate-100">
            <p className="text-xs text-slate-500 mb-1">{t('ui.quotaToday')}</p>
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
