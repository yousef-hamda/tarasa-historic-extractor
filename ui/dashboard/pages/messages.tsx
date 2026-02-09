import React, { useEffect, useState, useCallback } from 'react';
import { apiFetch } from '../utils/api';
import {
  PlayIcon,
  PauseIcon,
  ChatBubbleLeftRightIcon,
  PaperAirplaneIcon,
  ClockIcon,
  ExclamationTriangleIcon,
  CheckCircleIcon,
  XCircleIcon,
  InboxStackIcon,
  ArrowPathIcon,
  LinkIcon,
  UserIcon,
} from '@heroicons/react/24/outline';
import { PlayIcon as PlayIconSolid, PauseIcon as PauseIconSolid } from '@heroicons/react/24/solid';

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

// Stat Card Component
const StatCard: React.FC<{
  title: string;
  value: number | string;
  subtitle: string;
  icon: React.ReactNode;
}> = ({ title, value, subtitle, icon }) => (
  <div className="bg-white border border-slate-200 rounded-xl p-5 transition-colors hover:border-slate-300">
    <div className="flex items-center justify-between">
      <div>
        <p className="text-sm font-medium text-slate-500">{title}</p>
        <p className="text-2xl font-semibold text-slate-900 mt-1">
          {typeof value === 'number' ? value.toLocaleString() : value}
        </p>
        <p className="text-xs text-slate-400 mt-1">{subtitle}</p>
      </div>
      <div className="w-10 h-10 rounded-lg bg-slate-100 flex items-center justify-center">
        {icon}
      </div>
    </div>
  </div>
);

// Status Badge Component
const StatusBadge: React.FC<{ status: string }> = ({ status }) => {
  const getStatusStyle = () => {
    switch (status.toLowerCase()) {
      case 'sent':
      case 'success':
        return { bg: 'bg-emerald-50', text: 'text-emerald-700', icon: CheckCircleIcon };
      case 'failed':
      case 'error':
        return { bg: 'bg-red-50', text: 'text-red-700', icon: XCircleIcon };
      case 'pending':
        return { bg: 'bg-amber-50', text: 'text-amber-700', icon: ClockIcon };
      default:
        return { bg: 'bg-slate-100', text: 'text-slate-600', icon: ClockIcon };
    }
  };

  const style = getStatusStyle();
  const Icon = style.icon;

  return (
    <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium ${style.bg} ${style.text}`}>
      <Icon className="w-3.5 h-3.5" />
      {status}
    </span>
  );
};

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
      const res = await apiFetch('/api/settings/messaging', {
        method: 'POST',
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

  const fetchMessages = useCallback(async () => {
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
  }, []);

  useEffect(() => {
    fetchMessages();
    fetchMessagingStatus();
  }, [fetchMessages, fetchMessagingStatus]);

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-48 skeleton" />
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-28 skeleton" />
          ))}
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Messages</h1>
          <p className="text-slate-500 text-sm mt-0.5">Manage message queue and history</p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-8">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-lg bg-red-100 flex items-center justify-center">
              <ExclamationTriangleIcon className="w-6 h-6 text-red-600" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Connection Error</h2>
              <p className="text-slate-600 text-sm">{error || 'Unknown error'}</p>
              <button onClick={fetchMessages} className="btn-primary mt-4">
                <ArrowPathIcon className="w-4 h-4" />
                Retry Connection
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const successCount = data.sent?.filter(m => m.status.toLowerCase() === 'sent' || m.status.toLowerCase() === 'success').length || 0;
  const failedCount = data.sent?.filter(m => m.status.toLowerCase() === 'failed' || m.status.toLowerCase() === 'error').length || 0;

  return (
    <div className="space-y-6 animate-slide-up">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Messages</h1>
          <p className="text-slate-500 text-sm mt-0.5">Manage queue and monitor delivery</p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={fetchMessages}
            className="btn-secondary"
          >
            <ArrowPathIcon className="w-4 h-4" />
            Refresh
          </button>

          {/* Messaging Toggle */}
          <button
            onClick={toggleMessaging}
            disabled={togglingMessaging}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-lg font-medium transition-colors ${
              messagingEnabled
                ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                : 'bg-slate-900 hover:bg-slate-800 text-white'
            } ${togglingMessaging ? 'opacity-70 cursor-not-allowed' : ''}`}
          >
            {messagingEnabled ? (
              <>
                <PauseIconSolid className="h-4 w-4" />
                Messaging ON
              </>
            ) : (
              <>
                <PlayIconSolid className="h-4 w-4" />
                Messaging OFF
              </>
            )}
          </button>
        </div>
      </div>

      {/* Paused Warning */}
      {!messagingEnabled && (
        <div className="flex items-center gap-3 p-4 rounded-xl bg-amber-50 border border-amber-200">
          <ExclamationTriangleIcon className="w-5 h-5 text-amber-600" />
          <div>
            <p className="text-amber-800 font-medium">Messaging is Paused</p>
            <p className="text-amber-600 text-sm">Messages will be queued but NOT sent until you resume.</p>
          </div>
        </div>
      )}

      {/* Stats Overview */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Queue Size"
          value={data.stats?.queue ?? 0}
          subtitle="Awaiting dispatch"
          icon={<InboxStackIcon className="w-5 h-5 text-slate-600" />}
        />
        <StatCard
          title="Sent (24h)"
          value={data.stats?.sentLast24h ?? 0}
          subtitle="Last 24 hours"
          icon={<PaperAirplaneIcon className="w-5 h-5 text-emerald-600" />}
        />
        <StatCard
          title="Successful"
          value={successCount}
          subtitle="Delivered successfully"
          icon={<CheckCircleIcon className="w-5 h-5 text-emerald-600" />}
        />
        <StatCard
          title="Failed"
          value={failedCount}
          subtitle="Delivery failed"
          icon={<XCircleIcon className="w-5 h-5 text-red-600" />}
        />
      </div>

      {/* Queue Section */}
      <section className="space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-slate-100 flex items-center justify-center">
            <InboxStackIcon className="w-5 h-5 text-slate-600" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-slate-900">Message Queue</h2>
            <p className="text-sm text-slate-500">{data.queue?.length || 0} messages waiting</p>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="px-6 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">
                    Author
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">
                    Preview
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">
                    Link
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">
                    Created
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(!data.queue || data.queue.length === 0) ? (
                  <tr>
                    <td colSpan={4} className="px-6 py-16 text-center">
                      <div className="flex flex-col items-center gap-4">
                        <div className="w-12 h-12 rounded-lg bg-slate-100 flex items-center justify-center">
                          <InboxStackIcon className="w-6 h-6 text-slate-400" />
                        </div>
                        <div>
                          <p className="text-slate-600 font-medium">Queue is empty</p>
                          <p className="text-slate-400 text-sm mt-1">No messages waiting to be sent</p>
                        </div>
                      </div>
                    </td>
                  </tr>
                ) : (
                  data.queue.map((msg) => (
                    <tr key={msg.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-lg bg-slate-100 flex items-center justify-center">
                            <UserIcon className="w-4 h-4 text-slate-400" />
                          </div>
                          <span className="font-medium text-slate-900">
                            {msg.post?.authorName || `Post #${msg.postId}`}
                          </span>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <p className="text-sm text-slate-600 line-clamp-2 max-w-md">
                          {msg.post?.text
                            ? (msg.post.text.length > 80 ? `${msg.post.text.slice(0, 80)}...` : msg.post.text)
                            : '-'}
                        </p>
                      </td>
                      <td className="px-6 py-4">
                        <a
                          href={msg.link}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-slate-600 hover:text-slate-900 text-sm"
                        >
                          <LinkIcon className="w-4 h-4" />
                          View
                        </a>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2 text-sm text-slate-500">
                          <ClockIcon className="w-4 h-4 text-slate-400" />
                          {new Date(msg.createdAt).toLocaleString()}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* Sent History Section */}
      <section className="space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-slate-100 flex items-center justify-center">
            <PaperAirplaneIcon className="w-5 h-5 text-slate-600" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-slate-900">Sent History</h2>
            <p className="text-sm text-slate-500">{data.sent?.length || 0} messages sent</p>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="px-6 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">
                    Post ID
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">
                    Author Link
                  </th>
                  <th className="px-6 py-3 text-center text-xs font-semibold text-slate-500 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">
                    Error
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">
                    Sent At
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(!data.sent || data.sent.length === 0) ? (
                  <tr>
                    <td colSpan={5} className="px-6 py-16 text-center">
                      <div className="flex flex-col items-center gap-4">
                        <div className="w-12 h-12 rounded-lg bg-slate-100 flex items-center justify-center">
                          <PaperAirplaneIcon className="w-6 h-6 text-slate-400" />
                        </div>
                        <div>
                          <p className="text-slate-600 font-medium">No messages sent yet</p>
                          <p className="text-slate-400 text-sm mt-1">Sent messages will appear here</p>
                        </div>
                      </div>
                    </td>
                  </tr>
                ) : (
                  data.sent.map((msg) => (
                    <tr key={msg.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-6 py-4">
                        <span className="font-mono text-sm bg-slate-100 px-2 py-1 rounded">
                          #{msg.postId}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <a
                          href={msg.authorLink}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-slate-600 hover:text-slate-900 text-sm max-w-[200px] truncate"
                        >
                          <LinkIcon className="w-4 h-4 flex-shrink-0" />
                          {msg.authorLink}
                        </a>
                      </td>
                      <td className="px-6 py-4 text-center">
                        <StatusBadge status={msg.status} />
                      </td>
                      <td className="px-6 py-4">
                        {msg.error ? (
                          <span className="text-sm text-red-600 bg-red-50 px-2 py-1 rounded">
                            {msg.error}
                          </span>
                        ) : (
                          <span className="text-slate-400">-</span>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2 text-sm text-slate-500">
                          <ClockIcon className="w-4 h-4 text-slate-400" />
                          {new Date(msg.sentAt).toLocaleString()}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  );
};

export default MessagesPage;

// Force SSR - prevent static generation
export const getServerSideProps = async () => {
  return { props: {} };
};
