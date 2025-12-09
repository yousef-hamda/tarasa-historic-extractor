import React, { useEffect, useState } from 'react';
import Card from '../components/Card';
import { DashboardSkeleton } from '../components/Skeleton';
import { apiFetch } from '../utils/api';

interface Stats {
  postsTotal: number;
  classifiedTotal: number;
  historicTotal: number;
  queueCount: number;
  sentLast24h: number;
  quotaRemaining: number;
  messageLimit: number;
  logsCount: number;
  lastScrapeAt: string | null;
  lastMessageSentAt: string | null;
}

const Dashboard: React.FC = () => {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadStats = async () => {
      try {
        const res = await apiFetch('/api/stats');

        if (!res.ok) {
          throw new Error('Failed to fetch stats from API');
        }

        const data = await res.json();
        setStats(data);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    };
    loadStats();
  }, []);

  if (loading) {
    return <DashboardSkeleton />;
  }

  if (error) {
    return (
      <div className="p-8">
        <h1 className="text-3xl font-bold mb-4">Tarasa Automation Dashboard</h1>
        <p className="text-red-500">Error: {error}</p>
        <p className="text-gray-500 mt-2">Make sure the API server is running on port 4000.</p>
      </div>
    );
  }

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return 'Never';
    return new Date(dateStr).toLocaleString();
  };

  return (
    <div className="p-8 space-y-6">
      <h1 className="text-3xl font-bold">Tarasa Automation Dashboard</h1>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card title="Posts Scraped" value={stats?.postsTotal ?? 0} />
        <Card title="Classified" value={stats?.classifiedTotal ?? 0} />
        <Card title="Historic Posts" value={stats?.historicTotal ?? 0} />
        <Card title="In Queue" value={stats?.queueCount ?? 0} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card title="Sent (24h)" value={stats?.sentLast24h ?? 0} />
        <Card title="Quota Remaining" value={stats?.quotaRemaining ?? 0} />
        <Card title="Daily Limit" value={stats?.messageLimit ?? 20} />
        <Card title="System Logs" value={stats?.logsCount ?? 0} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm text-gray-600">
        <div className="bg-white p-4 rounded shadow">
          <span className="font-medium">Last Scrape:</span> {formatDate(stats?.lastScrapeAt ?? null)}
        </div>
        <div className="bg-white p-4 rounded shadow">
          <span className="font-medium">Last Message Sent:</span> {formatDate(stats?.lastMessageSentAt ?? null)}
        </div>
      </div>
    </div>
  );
};

export default Dashboard;

// Force SSR - prevent static generation which has issues with Next.js 14
export const getServerSideProps = async () => {
  return { props: {} };
};
