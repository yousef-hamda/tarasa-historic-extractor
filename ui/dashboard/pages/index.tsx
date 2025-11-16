import React, { useEffect, useState } from 'react';
import Card from '../components/Card';

type StatsPayload = {
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
};

const Dashboard: React.FC = () => {
  const [stats, setStats] = useState<StatsPayload | null>(null);

  useEffect(() => {
    fetch('/api/stats')
      .then((res) => res.json())
      .then((payload) => setStats(payload));
  }, []);

  const formatDate = (value: string | null | undefined) =>
    value ? new Date(value).toLocaleString() : 'Not yet recorded';

  return (
    <div className="p-8 space-y-6">
      <h1 className="text-3xl font-bold">Tarasa Automation Dashboard</h1>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card title="Posts scraped" value={stats?.postsTotal ?? '—'} subtitle="Raw posts saved to DB" />
        <Card title="Historic posts" value={stats?.historicTotal ?? '—'} subtitle="Qualified stories" />
        <Card title="Queue depth" value={stats?.queueCount ?? '—'} subtitle="Messages awaiting send" />
        <Card title="Classified" value={stats?.classifiedTotal ?? '—'} subtitle="Posts processed by AI" />
        <Card title="Sent (24h)" value={stats?.sentLast24h ?? '—'} subtitle="Messenger quota usage" />
        <Card
          title="Quota remaining"
          value={
            stats?.quotaRemaining != null && stats?.messageLimit != null
              ? `${stats.quotaRemaining}/${stats.messageLimit}`
              : '—'
          }
          subtitle="Messages left in rolling window"
        />
        <Card title="System logs" value={stats?.logsCount ?? '—'} subtitle="Total log entries" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-white shadow rounded p-4">
          <h2 className="text-lg font-semibold mb-2">Latest Scrape</h2>
          <p>{formatDate(stats?.lastScrapeAt)}</p>
        </div>
        <div className="bg-white shadow rounded p-4">
          <h2 className="text-lg font-semibold mb-2">Last Message Sent</h2>
          <p>{formatDate(stats?.lastMessageSentAt)}</p>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
