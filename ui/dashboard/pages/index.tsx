import React, { useEffect, useState, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { apiFetch } from '../utils/api';
import { formatRelativeTime, formatUptime } from '../utils/formatters';
import type { Stats, HealthStatus, Post, SystemLog } from '../types';
import {
  ArrowPathIcon,
  CheckCircleIcon,
  XCircleIcon,
  ChartBarIcon,
  BoltIcon,
  SparklesIcon,
  ChatBubbleLeftRightIcon,
  ExclamationTriangleIcon,
  ServerIcon,
  CpuChipIcon,
  CircleStackIcon,
  DocumentDuplicateIcon,
  PaperAirplaneIcon,
  ArrowUpRightIcon,
} from '@heroicons/react/24/outline';

// Dynamically import charts to avoid SSR issues
const ClassificationPieChart = dynamic(
  () => import('../components/charts/ClassificationPieChart'),
  { ssr: false, loading: () => <div className="h-64 skeleton" /> }
);

const ConfidenceDistribution = dynamic(
  () => import('../components/charts/ConfidenceDistribution'),
  { ssr: false, loading: () => <div className="h-48 skeleton" /> }
);

const ActivityChart = dynamic(
  () => import('../components/charts/ActivityChart'),
  { ssr: false, loading: () => <div className="h-72 skeleton" /> }
);

interface ActivityData {
  date: string;
  posts: number;
  classified: number;
  messages: number;
}

interface DashboardData {
  stats: Stats | null;
  health: HealthStatus | null;
  recentPosts: Post[];
  recentLogs: SystemLog[];
  confidenceData: { low: number; medium: number; high: number };
  activityData: ActivityData[];
}

// Stat Card Component - Clean & Professional
const StatCard: React.FC<{
  title: string;
  value: number | string;
  subtitle?: string;
  icon: React.ElementType;
}> = ({ title, value, subtitle, icon: Icon }) => (
  <div className="bg-white border border-slate-200 rounded-xl p-5 hover:border-slate-300 transition-colors">
    <div className="flex items-start justify-between">
      <div>
        <p className="text-sm font-medium text-slate-500">{title}</p>
        <p className="text-2xl font-semibold text-slate-900 mt-1">
          {typeof value === 'number' ? value.toLocaleString() : value}
        </p>
        {subtitle && <p className="text-xs text-slate-400 mt-1">{subtitle}</p>}
      </div>
      <div className="w-10 h-10 rounded-lg bg-slate-100 flex items-center justify-center">
        <Icon className="w-5 h-5 text-slate-600" />
      </div>
    </div>
  </div>
);

// Progress Bar Component
const ProgressBar: React.FC<{ value: number; max: number; label: string }> = ({ value, max, label }) => {
  const percentage = Math.min((value / max) * 100, 100);
  return (
    <div className="space-y-2">
      <div className="flex justify-between text-sm">
        <span className="text-slate-600">{label}</span>
        <span className="text-slate-900 font-medium">{value} / {max}</span>
      </div>
      <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
        <div
          className="h-full bg-slate-900 rounded-full transition-all duration-300"
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
};

// Status Item Component
const StatusItem: React.FC<{ label: string; status: boolean; icon: React.ElementType }> = ({
  label,
  status,
  icon: Icon,
}) => (
  <div className="flex items-center justify-between py-2.5 border-b border-slate-100 last:border-0">
    <div className="flex items-center gap-2.5">
      <Icon className="w-4 h-4 text-slate-400" />
      <span className="text-sm text-slate-600">{label}</span>
    </div>
    {status ? (
      <CheckCircleIcon className="w-5 h-5 text-emerald-500" />
    ) : (
      <XCircleIcon className="w-5 h-5 text-red-500" />
    )}
  </div>
);

const Dashboard: React.FC = () => {
  const [data, setData] = useState<DashboardData>({
    stats: null,
    health: null,
    recentPosts: [],
    recentLogs: [],
    confidenceData: { low: 0, medium: 0, high: 0 },
    activityData: [],
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);


  const fetchData = useCallback(async () => {
    try {
      const [statsRes, healthRes, postsRes, logsRes, activityRes] = await Promise.all([
        apiFetch('/api/stats'),
        apiFetch('/api/health'),
        apiFetch('/api/posts?limit=500'),
        apiFetch('/api/logs?limit=500'),
        apiFetch('/api/stats/activity?days=7'),
      ]);

      let stats: Stats | null = null;
      let health: HealthStatus | null = null;
      let recentPosts: Post[] = [];
      let recentLogs: SystemLog[] = [];
      let activityData: ActivityData[] = [];

      if (statsRes.ok) stats = await statsRes.json();
      if (healthRes.ok) health = await healthRes.json();
      if (postsRes.ok) {
        const postsData = await postsRes.json();
        recentPosts = postsData.data || [];
      }
      if (logsRes.ok) {
        const logsData = await logsRes.json();
        recentLogs = logsData.data || [];
      }
      if (activityRes.ok) {
        activityData = await activityRes.json();
      }

      const confidenceData = { low: 0, medium: 0, high: 0 };
      recentPosts.forEach((post) => {
        if (post.classified) {
          const conf = post.classified.confidence;
          if (conf >= 75) confidenceData.high++;
          else if (conf >= 50) confidenceData.medium++;
          else confidenceData.low++;
        }
      });

      setData({ stats, health, recentPosts, recentLogs, confidenceData, activityData });
      setError(null);
      setLastRefresh(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
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
        <div className="h-8 w-48 skeleton" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-28 skeleton" />
          ))}
        </div>
        <div className="h-72 skeleton" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-8">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-lg bg-red-100 flex items-center justify-center">
            <ExclamationTriangleIcon className="w-6 h-6 text-red-600" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Connection Error</h2>
            <p className="text-slate-600 text-sm">{error}</p>
          </div>
        </div>
        <button onClick={fetchData} className="btn-primary mt-6">
          <ArrowPathIcon className="w-4 h-4" />
          Retry
        </button>
      </div>
    );
  }

  const { stats, health, confidenceData, activityData, recentLogs } = data;
  const recentErrors = recentLogs.filter((log) => log.type === 'error').slice(0, 3);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Dashboard</h1>
          <p className="text-slate-500 text-sm mt-0.5">Overview of your automation system</p>
        </div>
        <button onClick={fetchData} className="btn-secondary">
          <ArrowPathIcon className="w-4 h-4" />
          Refresh
        </button>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Posts Scraped"
          value={stats?.postsTotal ?? 0}
          subtitle="Total collected"
          icon={CircleStackIcon}
        />
        <StatCard
          title="AI Classified"
          value={stats?.classifiedTotal ?? 0}
          subtitle={`${stats?.postsTotal ? Math.round((stats.classifiedTotal / stats.postsTotal) * 100) : 0}% complete`}
          icon={SparklesIcon}
        />
        <StatCard
          title="Historic Posts"
          value={stats?.historicTotal ?? 0}
          subtitle={`${stats?.classifiedTotal ? Math.round((stats.historicTotal / stats.classifiedTotal) * 100) : 0}% of classified`}
          icon={DocumentDuplicateIcon}
        />
        <StatCard
          title="In Queue"
          value={stats?.queueCount ?? 0}
          subtitle="Awaiting dispatch"
          icon={PaperAirplaneIcon}
        />
      </div>

      {/* Activity Chart */}
      <div className="bg-white border border-slate-200 rounded-xl p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-slate-900">Activity Overview</h2>
          <span className="text-xs text-slate-400">Last 7 days</span>
        </div>
        <ActivityChart data={activityData} height={280} />
      </div>

      {/* Charts Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-6">
          <h2 className="text-base font-semibold text-slate-900 mb-4">Classification Results</h2>
          <ClassificationPieChart
            historic={stats?.historicTotal ?? 0}
            nonHistoric={(stats?.classifiedTotal ?? 0) - (stats?.historicTotal ?? 0)}
          />
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-6">
          <h2 className="text-base font-semibold text-slate-900 mb-4">Confidence Distribution</h2>
          <ConfidenceDistribution
            low={confidenceData.low}
            medium={confidenceData.medium}
            high={confidenceData.high}
          />
        </div>
      </div>

      {/* Bottom Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Message Quota */}
        <div className="bg-white border border-slate-200 rounded-xl p-6">
          <div className="flex items-center gap-3 mb-5">
            <div className="w-9 h-9 rounded-lg bg-slate-100 flex items-center justify-center">
              <ChatBubbleLeftRightIcon className="w-5 h-5 text-slate-600" />
            </div>
            <h2 className="text-base font-semibold text-slate-900">Messages</h2>
          </div>

          <div className="space-y-4">
            <ProgressBar
              value={stats?.sentLast24h ?? 0}
              max={stats?.messageLimit ?? 20}
              label="Daily quota"
            />

            <div className="grid grid-cols-2 gap-3 pt-2">
              <div className="p-3 bg-slate-50 rounded-lg">
                <p className="text-xs text-slate-500">Sent today</p>
                <p className="text-lg font-semibold text-slate-900">{stats?.sentLast24h ?? 0}</p>
              </div>
              <div className="p-3 bg-slate-50 rounded-lg">
                <p className="text-xs text-slate-500">Remaining</p>
                <p className="text-lg font-semibold text-slate-900">{stats?.quotaRemaining ?? 0}</p>
              </div>
            </div>
          </div>
        </div>

        {/* System Health */}
        <div className="bg-white border border-slate-200 rounded-xl p-6">
          <div className="flex items-center gap-3 mb-5">
            <div className="w-9 h-9 rounded-lg bg-slate-100 flex items-center justify-center">
              <ServerIcon className="w-5 h-5 text-slate-600" />
            </div>
            <h2 className="text-base font-semibold text-slate-900">System Health</h2>
          </div>

          <div className="space-y-1">
            <StatusItem label="Database" status={health?.checks.database ?? false} icon={CircleStackIcon} />
            <StatusItem label="Facebook Session" status={health?.checks.facebookSession ?? false} icon={BoltIcon} />
            <StatusItem label="OpenAI API" status={health?.checks.openaiKey ?? false} icon={SparklesIcon} />
            <StatusItem label="Apify Token" status={health?.checks.apifyToken ?? false} icon={CpuChipIcon} />
          </div>

          {health?.uptime && (
            <div className="flex justify-between text-sm mt-4 pt-4 border-t border-slate-100">
              <span className="text-slate-500">Uptime</span>
              <span className="font-medium text-slate-900">{formatUptime(health.uptime)}</span>
            </div>
          )}
        </div>

        {/* Recent Activity */}
        <div className="bg-white border border-slate-200 rounded-xl p-6">
          <div className="flex items-center gap-3 mb-5">
            <div className="w-9 h-9 rounded-lg bg-slate-100 flex items-center justify-center">
              <ChartBarIcon className="w-5 h-5 text-slate-600" />
            </div>
            <h2 className="text-base font-semibold text-slate-900">Recent Activity</h2>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
              <div className="flex items-center gap-2.5">
                <BoltIcon className="w-4 h-4 text-slate-500" />
                <span className="text-sm text-slate-600">Last scrape</span>
              </div>
              <span className="text-sm font-medium text-slate-900">
                {stats?.lastScrapeAt ? formatRelativeTime(stats.lastScrapeAt) : 'Never'}
              </span>
            </div>

            <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
              <div className="flex items-center gap-2.5">
                <ChatBubbleLeftRightIcon className="w-4 h-4 text-slate-500" />
                <span className="text-sm text-slate-600">Last message</span>
              </div>
              <span className="text-sm font-medium text-slate-900">
                {stats?.lastMessageSentAt ? formatRelativeTime(stats.lastMessageSentAt) : 'Never'}
              </span>
            </div>

            {lastRefresh && (
              <p className="text-xs text-slate-400 text-center pt-2">
                Updated {formatRelativeTime(lastRefresh)}
              </p>
            )}
          </div>

          {/* Quick Links */}
          <div className="grid grid-cols-2 gap-2 mt-4 pt-4 border-t border-slate-100">
            <a href="/admin" className="btn-primary text-center justify-center text-sm py-2">
              Admin
              <ArrowUpRightIcon className="w-3.5 h-3.5" />
            </a>
            <a href="/logs" className="btn-secondary text-center justify-center text-sm py-2">
              Logs
              <ArrowUpRightIcon className="w-3.5 h-3.5" />
            </a>
          </div>
        </div>
      </div>

      {/* Recent Errors */}
      {recentErrors.length > 0 && (
        <div className="bg-white border border-red-200 rounded-xl p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-9 h-9 rounded-lg bg-red-100 flex items-center justify-center">
              <ExclamationTriangleIcon className="w-5 h-5 text-red-600" />
            </div>
            <h2 className="text-base font-semibold text-slate-900">Recent Errors</h2>
            <span className="text-xs text-slate-400 ml-auto">{recentErrors.length} errors</span>
          </div>

          <div className="space-y-2">
            {recentErrors.map((error) => (
              <div key={error.id} className="flex items-start gap-3 p-3 bg-red-50 rounded-lg">
                <span className="text-xs text-red-600 whitespace-nowrap font-medium">
                  {formatRelativeTime(error.createdAt)}
                </span>
                <span className="text-sm text-red-700">{error.message}</span>
              </div>
            ))}
          </div>

          <a href="/logs?type=error" className="inline-flex items-center gap-1 mt-4 text-sm text-red-600 hover:text-red-700 font-medium">
            View all errors
            <ArrowUpRightIcon className="w-3.5 h-3.5" />
          </a>
        </div>
      )}
    </div>
  );
};

export default Dashboard;

export const getServerSideProps = async () => {
  return { props: {} };
};
