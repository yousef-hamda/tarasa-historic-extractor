import React, { useEffect, useState, useCallback } from 'react';
import dynamic from 'next/dynamic';
import Card from '../components/Card';
import StatusBadge from '../components/StatusBadge';
import { DashboardSkeleton } from '../components/Skeleton';
import { apiFetch } from '../utils/api';
import { formatDate, formatRelativeTime, formatUptime } from '../utils/formatters';
import type { Stats, HealthStatus, Post, SystemLog } from '../types';
import {
  ArrowPathIcon,
  CheckCircleIcon,
  ClockIcon,
  XCircleIcon,
  ChartBarIcon,
  BoltIcon,
  SparklesIcon,
  ChatBubbleLeftRightIcon,
  ExclamationTriangleIcon,
  ServerIcon,
  CpuChipIcon,
  CircleStackIcon,
} from '@heroicons/react/24/outline';

// Dynamically import charts to avoid SSR issues
const ClassificationPieChart = dynamic(
  () => import('../components/charts/ClassificationPieChart'),
  { ssr: false, loading: () => <div className="h-64 bg-gray-100 rounded-lg animate-pulse" /> }
);

const ConfidenceDistribution = dynamic(
  () => import('../components/charts/ConfidenceDistribution'),
  { ssr: false, loading: () => <div className="h-48 bg-gray-100 rounded-lg animate-pulse" /> }
);

const ActivityChart = dynamic(
  () => import('../components/charts/ActivityChart'),
  { ssr: false, loading: () => <div className="h-72 bg-gray-100 rounded-lg animate-pulse" /> }
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

  // Generate activity data from posts (grouped by day)
  const generateActivityData = (posts: Post[], logs: SystemLog[]): ActivityData[] => {
    const days: Record<string, ActivityData> = {};
    const today = new Date();

    // Initialize last 7 days
    for (let i = 6; i >= 0; i--) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      const dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      days[dateStr] = { date: dateStr, posts: 0, classified: 0, messages: 0 };
    }

    // Count posts by day
    posts.forEach((post) => {
      const postDate = new Date(post.scrapedAt);
      const dateStr = postDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      if (days[dateStr]) {
        days[dateStr].posts++;
        if (post.classified) {
          days[dateStr].classified++;
        }
      }
    });

    // Count messages from logs
    logs.forEach((log) => {
      if (log.type === 'message') {
        const logDate = new Date(log.createdAt);
        const dateStr = logDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        if (days[dateStr]) {
          days[dateStr].messages++;
        }
      }
    });

    return Object.values(days);
  };

  const fetchData = useCallback(async () => {
    try {
      const [statsRes, healthRes, postsRes, logsRes] = await Promise.all([
        apiFetch('/api/stats'),
        apiFetch('/api/health'),
        apiFetch('/api/posts?limit=500'),
        apiFetch('/api/logs?limit=500'),
      ]);

      let stats: Stats | null = null;
      let health: HealthStatus | null = null;
      let recentPosts: Post[] = [];
      let recentLogs: SystemLog[] = [];

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

      // Calculate confidence distribution from posts
      const confidenceData = { low: 0, medium: 0, high: 0 };
      recentPosts.forEach((post) => {
        if (post.classified) {
          const conf = post.classified.confidence;
          if (conf >= 75) confidenceData.high++;
          else if (conf >= 50) confidenceData.medium++;
          else confidenceData.low++;
        }
      });

      // Generate activity data
      const activityData = generateActivityData(recentPosts, recentLogs);

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
    return <DashboardSkeleton />;
  }

  if (error) {
    return (
      <div className="p-8">
        <h1 className="text-3xl font-bold mb-4">Tarasa Automation Dashboard</h1>
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-red-600 font-medium">Error: {error}</p>
          <p className="text-gray-600 mt-2">Make sure the API server is running on port 4000.</p>
          <button
            onClick={fetchData}
            className="mt-3 px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  const { stats, health, confidenceData, activityData, recentLogs } = data;

  // Get recent errors for quick view
  const recentErrors = recentLogs.filter((log) => log.type === 'error').slice(0, 3);

  return (
    <div className="space-y-8">
      {/* Header with Status */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Dashboard</h1>
          <p className="text-gray-600 mt-1">Tarasa Historic Content Automation</p>
        </div>
        <div className="flex items-center gap-4">
          <StatusBadge
            status={health?.status || 'unknown'}
            label={`System ${health?.status || 'Unknown'}`}
            pulse={health?.status === 'ok'}
            size="lg"
          />
          <button
            onClick={fetchData}
            className="flex items-center gap-2 px-3 py-1.5 text-sm text-gray-600 hover:text-gray-900 border border-gray-300 rounded-md hover:bg-gray-50"
          >
            <ArrowPathIcon className="h-4 w-4" />
            Refresh
          </button>
        </div>
      </div>

      {/* System Overview Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-4">
        <div className="bg-white rounded-lg shadow p-4 col-span-2">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-100 rounded-lg">
              <CircleStackIcon className="h-6 w-6 text-blue-600" />
            </div>
            <div>
              <p className="text-sm text-gray-500">Posts Scraped</p>
              <p className="text-2xl font-bold text-gray-900">{(stats?.postsTotal ?? 0).toLocaleString()}</p>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-lg shadow p-4 col-span-2">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-purple-100 rounded-lg">
              <SparklesIcon className="h-6 w-6 text-purple-600" />
            </div>
            <div>
              <p className="text-sm text-gray-500">AI Classified</p>
              <p className="text-2xl font-bold text-gray-900">{(stats?.classifiedTotal ?? 0).toLocaleString()}</p>
              <p className="text-xs text-gray-400">
                {stats?.postsTotal ? Math.round((stats.classifiedTotal / stats.postsTotal) * 100) : 0}% complete
              </p>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-lg shadow p-4 col-span-2">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-green-100 rounded-lg">
              <CheckCircleIcon className="h-6 w-6 text-green-600" />
            </div>
            <div>
              <p className="text-sm text-gray-500">Historic Posts</p>
              <p className="text-2xl font-bold text-green-600">{(stats?.historicTotal ?? 0).toLocaleString()}</p>
              <p className="text-xs text-gray-400">
                {stats?.classifiedTotal ? Math.round((stats.historicTotal / stats.classifiedTotal) * 100) : 0}% of classified
              </p>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-lg shadow p-4 col-span-2">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-orange-100 rounded-lg">
              <ChatBubbleLeftRightIcon className="h-6 w-6 text-orange-600" />
            </div>
            <div>
              <p className="text-sm text-gray-500">In Queue</p>
              <p className="text-2xl font-bold text-orange-600">{stats?.queueCount ?? 0}</p>
              <p className="text-xs text-gray-400">Awaiting dispatch</p>
            </div>
          </div>
        </div>
      </div>

      {/* Activity Chart - Full Width */}
      <ActivityChart data={activityData} height={280} />

      {/* Charts Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <ClassificationPieChart
          historic={stats?.historicTotal ?? 0}
          nonHistoric={(stats?.classifiedTotal ?? 0) - (stats?.historicTotal ?? 0)}
        />
        <ConfidenceDistribution
          low={confidenceData.low}
          medium={confidenceData.medium}
          high={confidenceData.high}
        />
      </div>

      {/* Messages & System Status */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Message Stats */}
        <div className="bg-white rounded-lg shadow p-6 space-y-4">
          <h3 className="font-semibold text-gray-900 flex items-center gap-2">
            <ChatBubbleLeftRightIcon className="h-5 w-5 text-blue-500" />
            Message Stats
          </h3>
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-gray-600">Sent (24h)</span>
              <span className="text-xl font-bold text-gray-900">{stats?.sentLast24h ?? 0}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-gray-600">Quota Remaining</span>
              <span className="text-xl font-bold text-green-600">{stats?.quotaRemaining ?? 0}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-gray-600">Daily Limit</span>
              <span className="text-xl font-bold text-gray-500">{stats?.messageLimit ?? 20}</span>
            </div>
            {/* Quota Progress Bar */}
            <div className="pt-2">
              <div className="flex justify-between text-xs text-gray-500 mb-1">
                <span>Quota Used</span>
                <span>{stats?.sentLast24h ?? 0} / {stats?.messageLimit ?? 20}</span>
              </div>
              <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${
                    ((stats?.sentLast24h ?? 0) / (stats?.messageLimit ?? 20)) >= 0.9
                      ? 'bg-red-500'
                      : ((stats?.sentLast24h ?? 0) / (stats?.messageLimit ?? 20)) >= 0.7
                      ? 'bg-yellow-500'
                      : 'bg-green-500'
                  }`}
                  style={{ width: `${Math.min(((stats?.sentLast24h ?? 0) / (stats?.messageLimit ?? 20)) * 100, 100)}%` }}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Health Checks */}
        <div className="bg-white rounded-lg shadow p-6 space-y-4">
          <h3 className="font-semibold text-gray-900 flex items-center gap-2">
            <ServerIcon className="h-5 w-5 text-green-500" />
            System Health
          </h3>
          <div className="space-y-3">
            {[
              { label: 'Database', value: health?.checks.database, icon: CircleStackIcon },
              { label: 'Facebook Session', value: health?.checks.facebookSession, icon: BoltIcon },
              { label: 'OpenAI API', value: health?.checks.openaiKey, icon: SparklesIcon },
              { label: 'Apify Token', value: health?.checks.apifyToken, icon: CpuChipIcon },
            ].map(({ label, value, icon: Icon }) => (
              <div key={label} className="flex items-center justify-between">
                <span className="text-sm text-gray-600 flex items-center gap-2">
                  <Icon className="h-4 w-4 text-gray-400" />
                  {label}
                </span>
                <span className="flex items-center gap-1">
                  {value ? (
                    <CheckCircleIcon className="h-5 w-5 text-green-500" />
                  ) : (
                    <XCircleIcon className="h-5 w-5 text-red-500" />
                  )}
                </span>
              </div>
            ))}
          </div>
          {health?.uptime && (
            <div className="pt-3 border-t border-gray-100">
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Uptime</span>
                <span className="font-medium text-gray-900">{formatUptime(health.uptime)}</span>
              </div>
            </div>
          )}
        </div>

        {/* Last Activity & Quick Actions */}
        <div className="bg-white rounded-lg shadow p-6 space-y-4">
          <h3 className="font-semibold text-gray-900 flex items-center gap-2">
            <ClockIcon className="h-5 w-5 text-indigo-500" />
            Activity Timeline
          </h3>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-600 flex items-center gap-2">
                <BoltIcon className="h-4 w-4 text-blue-500" />
                Last Scrape
              </span>
              <span className="text-sm font-medium text-gray-900">
                {stats?.lastScrapeAt ? formatRelativeTime(stats.lastScrapeAt) : 'Never'}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-600 flex items-center gap-2">
                <ChatBubbleLeftRightIcon className="h-4 w-4 text-green-500" />
                Last Message
              </span>
              <span className="text-sm font-medium text-gray-900">
                {stats?.lastMessageSentAt ? formatRelativeTime(stats.lastMessageSentAt) : 'Never'}
              </span>
            </div>
            {lastRefresh && (
              <div className="flex items-center justify-between pt-2 border-t border-gray-100">
                <span className="text-xs text-gray-500">Dashboard refresh</span>
                <span className="text-xs text-gray-500">{formatRelativeTime(lastRefresh)}</span>
              </div>
            )}
          </div>

          {/* Quick Links */}
          <div className="pt-3 border-t border-gray-100">
            <div className="grid grid-cols-2 gap-2">
              <a
                href="/admin"
                className="flex items-center justify-center gap-1 px-3 py-2 bg-blue-50 text-blue-600 rounded-lg text-sm font-medium hover:bg-blue-100 transition-colors"
              >
                <CpuChipIcon className="h-4 w-4" />
                Admin
              </a>
              <a
                href="/logs"
                className="flex items-center justify-center gap-1 px-3 py-2 bg-gray-50 text-gray-600 rounded-lg text-sm font-medium hover:bg-gray-100 transition-colors"
              >
                <ChartBarIcon className="h-4 w-4" />
                Logs
              </a>
            </div>
          </div>
        </div>
      </div>

      {/* Recent Errors Alert (if any) */}
      {recentErrors.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 space-y-3">
          <h3 className="font-semibold text-red-800 flex items-center gap-2">
            <ExclamationTriangleIcon className="h-5 w-5" />
            Recent Errors ({recentErrors.length})
          </h3>
          <div className="space-y-2">
            {recentErrors.map((error) => (
              <div key={error.id} className="flex items-start gap-2 text-sm">
                <span className="text-red-600">{formatRelativeTime(error.createdAt)}</span>
                <span className="text-red-700">{error.message}</span>
              </div>
            ))}
          </div>
          <a
            href="/logs?type=error"
            className="inline-block text-sm text-red-600 hover:text-red-800 font-medium"
          >
            View all errors
          </a>
        </div>
      )}

      {/* System Logs Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card
          title="Total Logs"
          value={stats?.logsCount ?? 0}
          subtitle="All entries"
        />
        <Card
          title="Scrape Logs"
          value={recentLogs.filter((l) => l.type === 'scrape').length}
          subtitle="From recent fetch"
        />
        <Card
          title="Classification Logs"
          value={recentLogs.filter((l) => l.type === 'classify').length}
          subtitle="From recent fetch"
        />
        <Card
          title="Error Logs"
          value={recentLogs.filter((l) => l.type === 'error').length}
          subtitle="From recent fetch"
        />
      </div>
    </div>
  );
};

export default Dashboard;

export const getServerSideProps = async () => {
  return { props: {} };
};
