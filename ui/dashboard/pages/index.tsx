import React, { useCallback, useEffect, useState } from 'react';
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

type OperationKey = 'scrape' | 'classify' | 'message';

type OperationState = {
  status: 'idle' | 'running' | 'success' | 'error';
  message?: string;
};

const defaultOperationState: Record<OperationKey, OperationState> = {
  scrape: { status: 'idle' },
  classify: { status: 'idle' },
  message: { status: 'idle' },
};

const Dashboard: React.FC = () => {
  const [stats, setStats] = useState<StatsPayload | null>(null);
  const [operations, setOperations] = useState(defaultOperationState);

  const fetchStats = useCallback(() => {
    fetch('/api/stats')
      .then((res) => res.json())
      .then((payload) => setStats(payload));
  }, []);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  const setOperationState = (key: OperationKey, state: OperationState) => {
    setOperations((prev) => ({ ...prev, [key]: state }));
  };

  const triggerOperation = async (key: OperationKey, endpoint: string) => {
    setOperationState(key, { status: 'running' });
    try {
      const response = await fetch(endpoint, { method: 'POST' });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.message || 'Failed to trigger operation');
      }
      setOperationState(key, { status: 'success', message: 'Completed' });
      fetchStats();
    } catch (error) {
      setOperationState(key, { status: 'error', message: (error as Error).message });
    }
  };

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

      <section className="bg-white shadow rounded p-4 space-y-4">
        <div>
          <h2 className="text-xl font-semibold">Manual controls</h2>
          <p className="text-sm text-gray-500">Trigger automation services instantly when you need to validate behavior.</p>
        </div>
        <div className="flex flex-col md:flex-row gap-4">
          <button
            className="flex-1 px-4 py-2 bg-blue-600 text-white rounded disabled:opacity-50"
            onClick={() => triggerOperation('scrape', '/api/trigger-scrape')}
            disabled={operations.scrape.status === 'running'}
          >
            {operations.scrape.status === 'running' ? 'Scraping…' : 'Trigger scrape'}
          </button>
          <button
            className="flex-1 px-4 py-2 bg-purple-600 text-white rounded disabled:opacity-50"
            onClick={() => triggerOperation('classify', '/api/trigger-classification')}
            disabled={operations.classify.status === 'running'}
          >
            {operations.classify.status === 'running' ? 'Classifying…' : 'Trigger classification'}
          </button>
          <button
            className="flex-1 px-4 py-2 bg-green-600 text-white rounded disabled:opacity-50"
            onClick={() => triggerOperation('message', '/api/trigger-message')}
            disabled={operations.message.status === 'running'}
          >
            {operations.message.status === 'running' ? 'Sending…' : 'Trigger messaging'}
          </button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
          {(['scrape', 'classify', 'message'] as OperationKey[]).map((key) => (
            <div key={key} className="p-3 rounded border">
              <p className="font-semibold capitalize">{key}</p>
              <p>
                Status: <span className="font-mono">{operations[key].status}</span>
              </p>
              {operations[key].message && <p className="text-gray-600">{operations[key].message}</p>}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
};

export default Dashboard;
