import React, { useEffect, useState } from 'react';
import Card from '../components/Card';

const Dashboard: React.FC = () => {
  const [stats, setStats] = useState({ posts: 0, messages: 0, logs: 0 });

  useEffect(() => {
    const loadStats = async () => {
      const [postsRes, messagesRes, logsRes] = await Promise.all([
        fetch('/api/posts'),
        fetch('/api/messages'),
        fetch('/api/logs'),
      ]);
      const posts = await postsRes.json();
      const messages = await messagesRes.json();
      const logs = await logsRes.json();
      setStats({ posts: posts.length, messages: messages.length, logs: logs.length });
    };
    loadStats();
  }, []);

  return (
    <div className="p-8 space-y-4">
      <h1 className="text-3xl font-bold">Tarasa Automation Dashboard</h1>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card title="Posts scraped" value={stats.posts} />
        <Card title="Messages sent" value={stats.messages} />
        <Card title="System logs" value={stats.logs} />
      </div>
    </div>
  );
};

export default Dashboard;
