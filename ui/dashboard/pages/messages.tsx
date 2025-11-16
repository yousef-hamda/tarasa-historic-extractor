import React, { useEffect, useState } from 'react';
import Table from '../components/Table';
import Card from '../components/Card';

type MessageDashboardState = {
  queue: any[];
  sent: any[];
  stats: { queue: number; sentLast24h: number; quotaRemaining: number; messageLimit: number };
};

const defaultState: MessageDashboardState = {
  queue: [],
  sent: [],
  stats: { queue: 0, sentLast24h: 0, quotaRemaining: 0, messageLimit: 0 },
};

const MessagesPage: React.FC = () => {
  const [data, setData] = useState<MessageDashboardState>(defaultState);

  useEffect(() => {
    fetch('/api/messages')
      .then((res) => res.json())
      .then((payload) => setData(payload));
  }, []);

  return (
    <div className="p-8 space-y-6">
      <div className="flex flex-col gap-4">
        <h1 className="text-2xl font-bold">Messages</h1>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card title="Queued Messages" value={data.stats.queue} subtitle="Awaiting Messenger dispatch" />
          <Card title="Sent (24h)" value={data.stats.sentLast24h} subtitle="Rolling 24-hour window" />
          <Card
            title="Quota Remaining"
            value={`${data.stats.quotaRemaining} / ${data.stats.messageLimit || '—'}`}
            subtitle="Messages left in rolling limit"
          />
        </div>
      </div>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Generated Queue</h2>
        <Table
          columns={[
            { header: 'Post', accessor: (row) => row.post?.authorName || row.postId },
            { header: 'Preview', accessor: (row) => `${row.post?.text?.slice(0, 80) || ''}...` },
            { header: 'Link', accessor: (row) => row.link },
            { header: 'Created', accessor: (row) => new Date(row.createdAt).toLocaleString() },
          ]}
          data={data.queue}
        />
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Sent History</h2>
        <Table
          columns={[
            { header: 'Post ID', accessor: (row) => row.postId },
            { header: 'Author Link', accessor: (row) => row.authorLink },
            { header: 'Status', accessor: (row) => row.status },
            { header: 'Error', accessor: (row) => row.error || '-' },
            { header: 'Sent At', accessor: (row) => new Date(row.sentAt).toLocaleString() },
          ]}
          data={data.sent}
        />
      </section>
    </div>
  );
};

export default MessagesPage;
