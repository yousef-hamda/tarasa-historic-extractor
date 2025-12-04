import React, { useEffect, useState } from 'react';
import Card from '../components/Card';
import { apiFetch } from '../utils/api';

type DashboardStats = {
  posts: number;
  messages: number;
  logs: number;
};

const Dashboard: React.FC = () => {
  const [stats, setStats] = useState<DashboardStats>({ posts: 0, messages: 0, logs: 0 });

  useEffect(() => {
    const loadStats = async () => {
      try {
        const response = await apiFetch('/api/stats');
        const payload = await response.json();
        setStats({
          posts: payload.postsTotal ?? 0,
          messages: payload.sentLast24h ?? 0,
          logs: payload.logsCount ?? 0,
        });
      } catch (error) {
        console.error('Failed to load stats', error);
      }
    };
    loadStats();
  }, []);

  return (
    <div className="p-8 space-y-4">
      <h1 className="text-3xl font-bold">Tarasa Automation Dashboard</h1>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card title="Posts scraped" value={stats.posts} subtitle="Total posts in database" />
        <Card title="Messages sent (24h)" value={stats.messages} subtitle="Rolling 24-hour window" />
        <Card title="System logs" value={stats.logs} subtitle="All recorded events" />
      </div>
    </div>
  );
};

export default Dashboard;
