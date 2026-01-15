import React, { useEffect, useState, useCallback } from 'react';
import Table from '../components/Table';
import Card from '../components/Card';
import { apiFetch } from '../utils/api';
import { PlayIcon, PauseIcon } from '@heroicons/react/24/solid';

interface PostInfo {
  id: number;
  authorName?: string;
  text?: string;
}

interface QueuedMessage {
  id: number;
  postId: number;
  messageText: string;
  link: string;
  createdAt: string;
  post?: PostInfo;
}

interface SentMessage {
  id: number;
  postId: number;
  authorLink: string;
  status: string;
  sentAt: string;
  error?: string;
}

interface MessageDashboardState {
  queue: QueuedMessage[];
  sent: SentMessage[];
  stats: { queue: number; sentLast24h: number };
}

const MessagesPage: React.FC = () => {
  const [data, setData] = useState<MessageDashboardState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [messagingEnabled, setMessagingEnabled] = useState(true);
  const [togglingMessaging, setTogglingMessaging] = useState(false);

  const fetchMessagingStatus = useCallback(async () => {
    try {
      const res = await apiFetch('/api/settings/messaging');
      if (res.ok) {
        const data = await res.json();
        setMessagingEnabled(data.enabled);
      }
    } catch {
      // Default to enabled
    }
  }, []);

  const toggleMessaging = async () => {
    setTogglingMessaging(true);
    try {
      const res = await fetch('/api/settings/messaging', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !messagingEnabled }),
      });
      if (res.ok) {
        const data = await res.json();
        setMessagingEnabled(data.enabled);
      }
    } catch (err) {
      console.error('Failed to toggle messaging:', err);
    } finally {
      setTogglingMessaging(false);
    }
  };

  useEffect(() => {
    const fetchMessages = async () => {
      try {
        setLoading(true);
        setError(null);
        const res = await apiFetch('/api/messages');
        if (!res.ok) {
          throw new Error(`API error: ${res.status} ${res.statusText}`);
        }
        const payload = await res.json();
        setData(payload);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to fetch messages';
        setError(message);
      } finally {
        setLoading(false);
      }
    };
    fetchMessages();
    fetchMessagingStatus();
  }, [fetchMessagingStatus]);

  if (loading) {
    return (
      <div className="p-8">
        <p className="text-gray-600">Loading messages...</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="p-8">
        <p className="text-red-600">Error loading messages: {error || 'Unknown error'}</p>
        <p className="text-gray-500 mt-2">Make sure the API server is running on port 4000.</p>
      </div>
    );
  }

  return (
    <div className="p-8 space-y-6">
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">Messages</h1>
          {/* Messaging Toggle */}
          <button
            onClick={toggleMessaging}
            disabled={togglingMessaging}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-all ${
              messagingEnabled
                ? 'bg-green-100 text-green-700 hover:bg-green-200 border border-green-300'
                : 'bg-red-100 text-red-700 hover:bg-red-200 border border-red-300'
            }`}
          >
            {messagingEnabled ? (
              <>
                <PauseIcon className="h-5 w-5" />
                Messaging ON - Click to Pause
              </>
            ) : (
              <>
                <PlayIcon className="h-5 w-5" />
                Messaging PAUSED - Click to Resume
              </>
            )}
          </button>
        </div>

        {!messagingEnabled && (
          <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg">
            <p className="text-amber-800 font-medium">
              Messaging is currently paused. Messages will be generated and queued but NOT sent until you turn messaging back on.
            </p>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card title="Queued Messages" value={data.stats?.queue ?? 0} subtitle="Awaiting Messenger dispatch" />
          <Card title="Sent (24h)" value={data.stats?.sentLast24h ?? 0} subtitle="Rolling 24-hour window" />
        </div>
      </div>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Generated Queue</h2>
        <Table<QueuedMessage>
          columns={[
            { header: 'Post', accessor: (row) => row.post?.authorName || String(row.postId) },
            { header: 'Preview', accessor: (row) => {
              const text = row.post?.text;
              if (!text) return '-';
              return text.length > 80 ? `${text.slice(0, 80)}...` : text;
            }},
            { header: 'Link', accessor: (row) => row.link },
            { header: 'Created', accessor: (row) => new Date(row.createdAt).toLocaleString() },
          ]}
          data={data.queue || []}
        />
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Sent History</h2>
        <Table<SentMessage>
          columns={[
            { header: 'Post ID', accessor: (row) => String(row.postId) },
            { header: 'Author Link', accessor: (row) => row.authorLink },
            { header: 'Status', accessor: (row) => row.status },
            { header: 'Error', accessor: (row) => row.error || '-' },
            { header: 'Sent At', accessor: (row) => new Date(row.sentAt).toLocaleString() },
          ]}
          data={data.sent || []}
        />
      </section>
    </div>
  );
};

export default MessagesPage;

// Force SSR - prevent static generation
export const getServerSideProps = async () => {
  return { props: {} };
};
