import React, { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { apiFetch } from '../utils/api';
import { useAutoRefresh } from '../hooks/useAutoRefresh';
import { useLanguage } from '../contexts/LanguageContext';
import { effectivePostUrl } from '../utils/postUrl';
import { messengerLink } from '../utils/fbLinks';
import {
  PaperAirplaneIcon,
  ClockIcon,
  ExclamationTriangleIcon,
  CheckCircleIcon,
  XCircleIcon,
  InboxStackIcon,
  ArrowPathIcon,
  ArrowTopRightOnSquareIcon,
  UserIcon,
  LinkIcon,
  ChatBubbleLeftRightIcon,
} from '@heroicons/react/24/outline';
import { PlayIcon as PlayIconSolid, PauseIcon as PauseIconSolid } from '@heroicons/react/24/solid';

interface PostInfo {
  id: number;
  authorName?: string | null;
  authorPhoto?: string | null;
  authorLink?: string | null;
  postUrl?: string | null;
  fbPostId?: string | null;
  groupId?: string | null;
  text?: string | null;
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
  error?: string | null;
  messageText?: string | null;
  post?: PostInfo;
}

interface MessageDashboardState {
  queue: QueuedMessage[];
  sent: SentMessage[];
  stats: { queue: number; sentLast24h: number };
}

// Author avatar + name cell, shared by both tables. Falls back to a generic
// icon when the post has no captured profile photo (same pattern as Posts).
const AuthorCell: React.FC<{ post?: PostInfo; fallbackId: number }> = ({ post, fallbackId }) => (
  <div className="flex items-center gap-3">
    <div className="relative flex-shrink-0">
      {post?.authorPhoto ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={post.authorPhoto}
          alt={post.authorName || 'Author'}
          className="w-9 h-9 rounded-lg object-cover"
          onError={(e) => {
            const target = e.target as HTMLImageElement;
            target.style.display = 'none';
            target.nextElementSibling?.classList.remove('hidden');
          }}
        />
      ) : null}
      <div className={`w-9 h-9 rounded-lg bg-slate-100 flex items-center justify-center ${post?.authorPhoto ? 'hidden' : ''}`}>
        <UserIcon className="w-4 h-4 text-slate-400" />
      </div>
    </div>
    <div className="min-w-0">
      <span className="font-medium text-slate-900 block truncate max-w-[180px]">
        {post?.authorName || `Post #${fallbackId}`}
      </span>
      {post?.authorLink && (
        <a
          href={post.authorLink}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-slate-400 hover:text-slate-600 inline-flex items-center gap-1"
        >
          <LinkIcon className="w-3 h-3" />
          Facebook
        </a>
      )}
    </div>
  </div>
);

// Clickable "Post #id" that deep-links to the Posts page and opens the detail
// modal for that post (the Posts page reads ?postId on mount).
const PostLink: React.FC<{ postId: number; post?: PostInfo; viewLabel: string }> = ({ postId, post, viewLabel }) => {
  const fbUrl = post ? effectivePostUrl(post) : null;
  return (
    <div className="flex items-center gap-2">
      <Link
        href={`/posts?postId=${postId}`}
        className="font-mono text-sm bg-slate-100 hover:bg-slate-200 text-slate-700 px-2 py-1 rounded transition-colors"
        title={viewLabel}
      >
        #{postId}
      </Link>
      {fbUrl && (
        <a
          href={fbUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-slate-400 hover:text-blue-600"
          title="Open on Facebook"
        >
          <ArrowTopRightOnSquareIcon className="w-4 h-4" />
        </a>
      )}
    </div>
  );
};

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
      <div className="w-10 h-10 rounded-lg bg-slate-100 flex items-center justify-center">{icon}</div>
    </div>
  </div>
);

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
  const { t } = useLanguage();
  const [data, setData] = useState<MessageDashboardState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [messagingEnabled, setMessagingEnabled] = useState(false);
  const [togglingMessaging, setTogglingMessaging] = useState(false);

  const fetchMessagingStatus = useCallback(async () => {
    try {
      const res = await apiFetch('/api/settings/messaging');
      if (res.ok) {
        const d = await res.json();
        setMessagingEnabled(d.enabled);
      }
    } catch {
      /* keep last-known */
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
        const d = await res.json();
        setMessagingEnabled(d.enabled);
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
      if (!res.ok) throw new Error(`API error: ${res.status} ${res.statusText}`);
      setData(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch messages');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMessages();
    fetchMessagingStatus();
  }, [fetchMessages, fetchMessagingStatus]);

  useAutoRefresh(() => {
    fetchMessages();
    fetchMessagingStatus();
  });

  if (loading && !data) {
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

  if ((error || !data) && !data) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">{t('messages.title')}</h1>
          <p className="text-slate-500 text-sm mt-0.5">{t('ui.messagesSubtitle')}</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-8">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-lg bg-red-100 flex items-center justify-center">
              <ExclamationTriangleIcon className="w-6 h-6 text-red-600" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-slate-900">{t('ui.connectionError')}</h2>
              <p className="text-slate-600 text-sm">{error || 'Unknown error'}</p>
              <p className="text-slate-400 text-xs mt-1">{t('ui.transientHint')}</p>
              <button onClick={fetchMessages} className="btn-primary mt-4">
                <ArrowPathIcon className="w-4 h-4" />
                {t('ui.retryNow')}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const successCount =
    data.sent?.filter((m) => m.status.toLowerCase() === 'sent' || m.status.toLowerCase() === 'success').length || 0;
  const failedCount =
    data.sent?.filter((m) => m.status.toLowerCase() === 'failed' || m.status.toLowerCase() === 'error').length || 0;

  return (
    <div className="space-y-6 animate-slide-up">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">{t('messages.title')}</h1>
          <p className="text-slate-500 text-sm mt-0.5">{t('ui.messagesSubtitle')}</p>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={fetchMessages} className="btn-secondary">
            <ArrowPathIcon className="w-4 h-4" />
            {t('common.refresh')}
          </button>
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
                {t('ui.messagingOn')}
              </>
            ) : (
              <>
                <PlayIconSolid className="h-4 w-4" />
                {t('ui.messagingOff')}
              </>
            )}
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-800 flex items-center justify-between">
          <span>{error}</span>
          <button onClick={fetchMessages} className="text-amber-900 underline text-xs">
            {t('ui.retryNow')}
          </button>
        </div>
      )}

      {!messagingEnabled && (
        <div className="flex items-center gap-3 p-4 rounded-xl bg-amber-50 border border-amber-200">
          <ExclamationTriangleIcon className="w-5 h-5 text-amber-600 flex-shrink-0" />
          <div>
            <p className="text-amber-800 font-medium">{t('ui.pausedTitle')}</p>
            <p className="text-amber-600 text-sm">{t('ui.pausedBody')}</p>
          </div>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title={t('ui.queueSize')}
          value={data.stats?.queue ?? 0}
          subtitle={messagingEnabled ? t('ui.sendsNextCycle') : t('ui.pausedToggle')}
          icon={<InboxStackIcon className="w-5 h-5 text-slate-600" />}
        />
        <StatCard
          title={t('ui.sent24h')}
          value={data.stats?.sentLast24h ?? 0}
          subtitle={t('ui.last24Hours')}
          icon={<PaperAirplaneIcon className="w-5 h-5 text-emerald-600" />}
        />
        <StatCard
          title={t('ui.successful')}
          value={successCount}
          subtitle={t('ui.deliveredSuccessfully')}
          icon={<CheckCircleIcon className="w-5 h-5 text-emerald-600" />}
        />
        <StatCard
          title={t('ui.failed')}
          value={failedCount}
          subtitle={t('ui.deliveryFailed')}
          icon={<XCircleIcon className="w-5 h-5 text-red-600" />}
        />
      </div>

      {/* Queue */}
      <section className="space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-slate-100 flex items-center justify-center">
            <InboxStackIcon className="w-5 h-5 text-slate-600" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-slate-900">{t('ui.messageQueue')}</h2>
            <p className="text-sm text-slate-500">
              {data.queue?.length || 0} {t('ui.messagesWaiting')}
            </p>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="px-6 py-3 text-start text-xs font-semibold text-slate-500 uppercase tracking-wider">{t('ui.author')}</th>
                  <th className="px-6 py-3 text-start text-xs font-semibold text-slate-500 uppercase tracking-wider">{t('ui.messageColumn')}</th>
                  <th className="px-6 py-3 text-start text-xs font-semibold text-slate-500 uppercase tracking-wider">{t('ui.postColumn')}</th>
                  <th className="px-6 py-3 text-start text-xs font-semibold text-slate-500 uppercase tracking-wider">{t('ui.created')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {!data.queue || data.queue.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-6 py-16 text-center">
                      <div className="flex flex-col items-center gap-4">
                        <div className="w-12 h-12 rounded-lg bg-slate-100 flex items-center justify-center">
                          <InboxStackIcon className="w-6 h-6 text-slate-400" />
                        </div>
                        <div>
                          <p className="text-slate-600 font-medium">{t('ui.queueEmpty')}</p>
                          <p className="text-slate-400 text-sm mt-1">{t('ui.noQueueSub')}</p>
                        </div>
                      </div>
                    </td>
                  </tr>
                ) : (
                  data.queue.map((msg) => (
                    <tr key={msg.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-6 py-4">
                        <AuthorCell post={msg.post} fallbackId={msg.postId} />
                      </td>
                      <td className="px-6 py-4">
                        <p className="text-sm text-slate-600 line-clamp-2 max-w-md" dir="auto">
                          {msg.messageText
                            ? msg.messageText.length > 120
                              ? `${msg.messageText.slice(0, 120)}…`
                              : msg.messageText
                            : '—'}
                        </p>
                      </td>
                      <td className="px-6 py-4">
                        <PostLink postId={msg.postId} post={msg.post} viewLabel={t('ui.viewPost')} />
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

      {/* Sent History */}
      <section className="space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-slate-100 flex items-center justify-center">
            <PaperAirplaneIcon className="w-5 h-5 text-slate-600" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-slate-900">{t('ui.sentHistory')}</h2>
            <p className="text-sm text-slate-500">
              {data.sent?.length || 0} {t('ui.messagesSentCount')}
            </p>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="px-6 py-3 text-start text-xs font-semibold text-slate-500 uppercase tracking-wider">{t('ui.author')}</th>
                  <th className="px-6 py-3 text-start text-xs font-semibold text-slate-500 uppercase tracking-wider">{t('ui.messageColumn')}</th>
                  <th className="px-6 py-3 text-center text-xs font-semibold text-slate-500 uppercase tracking-wider">{t('ui.status')}</th>
                  <th className="px-6 py-3 text-start text-xs font-semibold text-slate-500 uppercase tracking-wider">{t('ui.chatProfile')}</th>
                  <th className="px-6 py-3 text-start text-xs font-semibold text-slate-500 uppercase tracking-wider">{t('ui.postColumn')}</th>
                  <th className="px-6 py-3 text-start text-xs font-semibold text-slate-500 uppercase tracking-wider">{t('ui.sentAt')}</th>
                  <th className="px-6 py-3 text-start text-xs font-semibold text-slate-500 uppercase tracking-wider">{t('ui.errorColumn')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {!data.sent || data.sent.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-6 py-16 text-center">
                      <div className="flex flex-col items-center gap-4">
                        <div className="w-12 h-12 rounded-lg bg-slate-100 flex items-center justify-center">
                          <PaperAirplaneIcon className="w-6 h-6 text-slate-400" />
                        </div>
                        <div>
                          <p className="text-slate-600 font-medium">{t('ui.noSentYet')}</p>
                          <p className="text-slate-400 text-sm mt-1">{t('ui.noSentSub')}</p>
                        </div>
                      </div>
                    </td>
                  </tr>
                ) : (
                  data.sent.map((msg) => {
                    const chatUrl = messengerLink(msg.authorLink || msg.post?.authorLink);
                    const profileUrl = msg.authorLink || msg.post?.authorLink || null;
                    return (
                      <tr key={msg.id} className="hover:bg-slate-50 transition-colors">
                        <td className="px-6 py-4">
                          <AuthorCell post={msg.post} fallbackId={msg.postId} />
                        </td>
                        <td className="px-6 py-4">
                          {msg.messageText ? (
                            <p className="text-sm text-slate-600 line-clamp-3 max-w-md" dir="auto">
                              {msg.messageText}
                            </p>
                          ) : (
                            <span className="text-slate-400 text-sm italic">{t('ui.noMessageText')}</span>
                          )}
                        </td>
                        <td className="px-6 py-4 text-center">
                          <StatusBadge status={msg.status} />
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex flex-col gap-1">
                            {chatUrl && (
                              <a
                                href={chatUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 text-sm text-blue-600 hover:text-blue-800"
                              >
                                <ChatBubbleLeftRightIcon className="w-4 h-4" />
                                {t('ui.openChat')}
                              </a>
                            )}
                            {profileUrl && (
                              <a
                                href={profileUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700"
                              >
                                <LinkIcon className="w-3.5 h-3.5" />
                                {t('ui.profile')}
                              </a>
                            )}
                            {!chatUrl && !profileUrl && <span className="text-slate-400">—</span>}
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <PostLink postId={msg.postId} post={msg.post} viewLabel={t('ui.viewPost')} />
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-2 text-sm text-slate-500">
                            <ClockIcon className="w-4 h-4 text-slate-400" />
                            {new Date(msg.sentAt).toLocaleString()}
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          {msg.error ? (
                            <span className="text-sm text-red-600 bg-red-50 px-2 py-1 rounded">{msg.error}</span>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })
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
