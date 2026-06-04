import React, { useEffect, useState, useCallback } from 'react';
import Pagination from '../components/Pagination';
import PostDetailModal from '../components/PostDetailModal';
import { PageSkeleton } from '../components/Skeleton';
import { apiFetch } from '../utils/api';
import { formatRelativeTime, truncateText } from '../utils/formatters';
import { effectivePostUrl } from '../utils/postUrl';
import { useAutoRefresh } from '../hooks/useAutoRefresh';
import SendApprovedPostsButton from '../components/SendApprovedPostsButton';
import type { Post, GroupInfo } from '../types';
import {
  MagnifyingGlassIcon,
  FunnelIcon,
  UserIcon,
  LinkIcon,
  EyeIcon,
  ArrowPathIcon,
  DocumentTextIcon,
  CheckBadgeIcon,
  UserGroupIcon,
  SparklesIcon,
  ClockIcon,
  ExclamationTriangleIcon,
  ArrowTopRightOnSquareIcon,
  TrashIcon,
} from '@heroicons/react/24/outline';

interface PaginationState {
  total: number;
  limit: number;
  offset: number;
}

type FilterType = 'all' | 'historic' | 'below-threshold' | 'not-historic' | 'unclassified' | 'with-link';

const LIMIT = 50;
const DEFAULT_THRESHOLD = 75;

// Threshold-aware classification check. A post is only "Historic" when the
// classifier said so AND the confidence cleared the operator-set threshold —
// otherwise we render "Below threshold" so it's visible at a glance which
// posts won't reach the messenger. This is the user-facing fix for "a 50%
// post shows as green Historic".
const isHistoricForUi = (post: Post, threshold: number): boolean =>
  Boolean(post.classified?.isHistoric && post.classified.confidence > threshold);

const isBelowThresholdHistoric = (post: Post, threshold: number): boolean =>
  Boolean(post.classified?.isHistoric && post.classified.confidence <= threshold);

// Stat Card Component
const StatCard: React.FC<{
  title: string;
  value: number | string;
  icon: React.ReactNode;
}> = ({ title, value, icon }) => (
  <div className="bg-white border border-slate-200 rounded-xl p-5 transition-colors hover:border-slate-300">
    <div className="flex items-center justify-between">
      <div>
        <p className="text-sm font-medium text-slate-500">{title}</p>
        <p className="text-2xl font-semibold text-slate-900 mt-1">
          {typeof value === 'number' ? value.toLocaleString() : value}
        </p>
      </div>
      <div className="w-10 h-10 rounded-lg bg-slate-100 flex items-center justify-center">
        {icon}
      </div>
    </div>
  </div>
);

// Confidence Indicator Component
const ConfidenceIndicator: React.FC<{ confidence: number; threshold: number }> = ({ confidence, threshold }) => {
  const getColor = (c: number) => {
    if (c > threshold) return 'text-emerald-600';
    if (c >= 50) return 'text-amber-600';
    return 'text-red-600';
  };

  return (
    <span className={`text-sm font-semibold ${getColor(confidence)}`}>
      {confidence}%
    </span>
  );
};

const PostsPage: React.FC = () => {
  const [data, setData] = useState<Post[]>([]);
  const [filteredData, setFilteredData] = useState<Post[]>([]);
  const [pagination, setPagination] = useState<PaginationState>({ total: 0, limit: LIMIT, offset: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedPost, setSelectedPost] = useState<Post | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [filter, setFilter] = useState<FilterType>('all');
  // Server-pushed threshold. Defaults to 75 (the historical default) until
  // the first response lands so the UI never renders an inconsistent badge.
  const [threshold, setThreshold] = useState<number>(DEFAULT_THRESHOLD);
  // Group name lookup for the per-row pill. Loaded once on mount.
  const [groupNames, setGroupNames] = useState<Record<string, string>>({});
  // Per-row delete UX state.
  const [deletingPostId, setDeletingPostId] = useState<number | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const loadPosts = useCallback(async (offset: number) => {
    setLoading(true);
    try {
      const res = await apiFetch(`/api/posts?limit=${LIMIT}&offset=${offset}`);
      if (!res.ok) {
        throw new Error('Failed to fetch posts');
      }
      const result = await res.json();
      const posts = Array.isArray(result) ? result : (result.data || []);
      setData(posts);
      setPagination({
        total: result.pagination?.total || posts.length,
        limit: LIMIT,
        offset,
      });
      if (typeof result.historicThreshold === 'number') {
        setThreshold(result.historicThreshold);
      }
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, []);

  // One-time fetch of group names so the per-row pill shows "History of
  // Israel" instead of "136596023614231...". Best-effort; on failure we just
  // fall back to the truncated id.
  useEffect(() => {
    apiFetch('/api/groups?t=' + Date.now())
      .then((r) => (r.ok ? r.json() : { groups: [] }))
      .then((data) => {
        const map: Record<string, string> = {};
        for (const g of (data.groups || []) as GroupInfo[]) {
          if (g.groupId && g.groupName) map[g.groupId] = g.groupName;
        }
        setGroupNames(map);
      })
      .catch(() => {/* ignore — pill falls back to id */});
  }, []);

  // Apply filters and search
  useEffect(() => {
    let result = [...data];

    switch (filter) {
      case 'historic':
        result = result.filter((p) => isHistoricForUi(p, threshold));
        break;
      case 'below-threshold':
        result = result.filter((p) => isBelowThresholdHistoric(p, threshold));
        break;
      case 'not-historic':
        result = result.filter((p) => p.classified?.isHistoric === false);
        break;
      case 'unclassified':
        result = result.filter((p) => !p.classified);
        break;
      case 'with-link':
        result = result.filter((p) => !!p.authorLink);
        break;
    }

    // Apply search
    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase();
      result = result.filter(
        (p) =>
          p.text?.toLowerCase().includes(term) ||
          p.authorName?.toLowerCase().includes(term) ||
          p.groupId?.toLowerCase().includes(term)
      );
    }

    setFilteredData(result);
  }, [data, filter, searchTerm, threshold]);

  useEffect(() => {
    loadPosts(0);
  }, [loadPosts]);

  // Auto-refresh the current page every 15s so newly scraped posts appear
  // without the user having to click Refresh. Pauses when the tab is
  // backgrounded.
  useAutoRefresh(() => {
    loadPosts(pagination.offset);
  });

  const handlePageChange = (newOffset: number) => {
    loadPosts(newOffset);
  };

  const openPostDetail = (post: Post) => {
    setSelectedPost(post);
    setIsModalOpen(true);
  };

  const closePostDetail = () => {
    setIsModalOpen(false);
    setTimeout(() => setSelectedPost(null), 200);
  };

  // Delete a single post via DELETE /api/posts/:id. Confirms in-line then
  // refreshes the current page so totals + filters stay accurate.
  const handleDeletePost = async (postId: number) => {
    const ok = typeof window !== 'undefined' && window.confirm(
      'Delete this post permanently? This also removes its classification, generated messages, and send history.'
    );
    if (!ok) return;
    setDeletingPostId(postId);
    setDeleteError(null);
    try {
      const res = await apiFetch(`/api/posts/${postId}`, { method: 'DELETE' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || body.error || `HTTP ${res.status}`);
      }
      await loadPosts(pagination.offset);
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setDeletingPostId(null);
    }
  };

  if (loading && data.length === 0) {
    return <PageSkeleton />;
  }

  // Non-blocking error: a transient API hiccup (Railway rolling deploy,
  // brief network blip) should NOT wipe the page and discard whatever data
  // we already have. Surface it as a dismissable banner above the table and
  // let auto-refresh recover automatically on the next tick.
  // If we have no data at all AND we have an error, that's the first-load
  // failure case — show the full error card so the user has a retry button.
  if (error && data.length === 0) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Posts</h1>
          <p className="text-slate-500 text-sm mt-0.5">Manage and analyze collected posts</p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-8">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-lg bg-red-100 flex items-center justify-center">
              <ExclamationTriangleIcon className="w-6 h-6 text-red-600" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Connection Error</h2>
              <p className="text-slate-600 text-sm">{error}</p>
              <p className="text-slate-400 text-xs mt-1">
                Usually transient — most often happens during a Railway redeploy. The page will auto-retry every 15 seconds.
              </p>
              <button
                onClick={() => loadPosts(0)}
                className="btn-primary mt-4"
              >
                <ArrowPathIcon className="w-4 h-4" />
                Retry now
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Stats for current page. `historic` counts only above-threshold posts so
  // it agrees with the server's `/api/stats.historicTotal`.
  const pageStats = {
    total: filteredData.length,
    historic: filteredData.filter((p) => isHistoricForUi(p, threshold)).length,
    belowThreshold: filteredData.filter((p) => isBelowThresholdHistoric(p, threshold)).length,
    withLink: filteredData.filter((p) => p.authorLink).length,
    classified: filteredData.filter((p) => p.classified).length,
  };

  return (
    <div className="space-y-6 animate-slide-up">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Posts</h1>
          <p className="text-slate-500 text-sm mt-0.5">
            {pagination.total.toLocaleString()} total posts
            {filter !== 'all' && ` (${filteredData.length} filtered)`}
            <span className="ms-2 text-slate-400">
              · Threshold: {threshold}%
            </span>
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <SendApprovedPostsButton variant="compact" />
          <button
            onClick={() => loadPosts(pagination.offset)}
            className="btn-secondary"
          >
            <ArrowPathIcon className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="On This Page"
          value={pageStats.total}
          icon={<DocumentTextIcon className="w-5 h-5 text-slate-600" />}
        />
        <StatCard
          title={`Historic (>${threshold}%)`}
          value={pageStats.historic}
          icon={<CheckBadgeIcon className="w-5 h-5 text-emerald-600" />}
        />
        <StatCard
          title="With Profile Link"
          value={pageStats.withLink}
          icon={<LinkIcon className="w-5 h-5 text-slate-600" />}
        />
        <StatCard
          title="AI Classified"
          value={pageStats.classified}
          icon={<SparklesIcon className="w-5 h-5 text-slate-600" />}
        />
      </div>

      {/* Search and Filter Bar */}
      <div className="bg-white border border-slate-200 rounded-xl p-4">
        <div className="flex flex-col sm:flex-row gap-4">
          {/* Search */}
          <div className="relative flex-1">
            <MagnifyingGlassIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-slate-400" />
            <input
              type="text"
              placeholder="Search posts by text, author, or group..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 border border-slate-200 rounded-lg text-sm"
            />
          </div>

          {/* Filter Dropdown */}
          <div className="relative min-w-[200px]">
            <FunnelIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value as FilterType)}
              className="w-full pl-10 pr-8 py-2.5 border border-slate-200 rounded-lg text-sm appearance-none cursor-pointer"
            >
              <option value="all">All Posts</option>
              <option value="historic">Historic (above threshold)</option>
              <option value="below-threshold">Below Threshold</option>
              <option value="not-historic">Not Historic</option>
              <option value="unclassified">Unclassified</option>
              <option value="with-link">With Profile Link</option>
            </select>
          </div>
        </div>
      </div>

      {/* Delete-error banner */}
      {deleteError && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
          {deleteError}
        </div>
      )}

      {/* Soft error banner — shown when a refresh fails but we still have
          stale data to display. Doesn't block interaction; clears on next
          successful auto-refresh. */}
      {error && data.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-800 flex items-center justify-between">
          <span>Refresh failed: {error}. Showing last-known data; will retry automatically.</span>
          <button
            onClick={() => loadPosts(pagination.offset)}
            className="text-amber-900 underline text-xs"
          >
            Retry now
          </button>
        </div>
      )}

      {/* Posts Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="px-6 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  Author
                </th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  Post Preview
                </th>
                <th className="px-6 py-3 text-center text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  Classification
                </th>
                <th className="px-6 py-3 text-center text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  Confidence
                </th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  Scraped
                </th>
                <th className="px-6 py-3 text-center text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredData.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-16 text-center">
                    <div className="flex flex-col items-center gap-4">
                      <div className="w-12 h-12 rounded-lg bg-slate-100 flex items-center justify-center">
                        <DocumentTextIcon className="w-6 h-6 text-slate-400" />
                      </div>
                      <div>
                        <p className="text-slate-600 font-medium">
                          {searchTerm || filter !== 'all'
                            ? 'No posts match your criteria'
                            : 'No posts found'}
                        </p>
                        <p className="text-slate-400 text-sm mt-1">
                          Try adjusting your search or filter settings
                        </p>
                      </div>
                    </div>
                  </td>
                </tr>
              ) : (
                filteredData.map((post) => {
                  const postLink = effectivePostUrl(post);
                  const groupName = post.groupId ? groupNames[post.groupId] : undefined;
                  const aboveThreshold = isHistoricForUi(post, threshold);
                  const isBelow = isBelowThresholdHistoric(post, threshold);
                  return (
                    <tr
                      key={post.id}
                      className="hover:bg-slate-50 cursor-pointer transition-colors"
                      onClick={() => openPostDetail(post)}
                    >
                      {/* Author */}
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="relative">
                            {post.authorPhoto ? (
                              <img
                                src={post.authorPhoto}
                                alt={post.authorName || 'Author'}
                                className="w-10 h-10 rounded-lg object-cover"
                                onError={(e) => {
                                  const target = e.target as HTMLImageElement;
                                  target.style.display = 'none';
                                  target.nextElementSibling?.classList.remove('hidden');
                                }}
                              />
                            ) : null}
                            <div className={`w-10 h-10 bg-slate-100 rounded-lg flex items-center justify-center ${post.authorPhoto ? 'hidden' : ''}`}>
                              <UserIcon className="h-5 w-5 text-slate-400" />
                            </div>
                            {post.authorLink && (
                              <div className="absolute -bottom-1 -right-1 w-4 h-4 bg-emerald-500 rounded-full flex items-center justify-center">
                                <LinkIcon className="w-2.5 h-2.5 text-white" />
                              </div>
                            )}
                          </div>
                          <div className="min-w-0">
                            <div className="font-medium text-slate-900 truncate max-w-[150px]">
                              {post.authorName || 'Unknown'}
                            </div>
                            {/* Group pill: prefer the human group name so the
                                author / group / post connection reads at a
                                glance instead of being a long opaque id. */}
                            <div
                              className="inline-flex items-center gap-1 text-xs text-slate-500 mt-0.5 px-1.5 py-0.5 rounded bg-slate-100 max-w-[160px]"
                              title={post.groupId}
                            >
                              <UserGroupIcon className="w-3 h-3 flex-shrink-0" />
                              <span className="truncate">{groupName || post.groupId}</span>
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* Post Preview */}
                      <td className="px-6 py-4">
                        <p className="text-sm text-slate-600 line-clamp-2 max-w-md">
                          {truncateText(post.text || '', 150)}
                        </p>
                      </td>

                      {/* Classification — threshold-aware */}
                      <td className="px-6 py-4 text-center">
                        {!post.classified ? (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium bg-amber-50 text-amber-600">
                            <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                            Pending
                          </span>
                        ) : aboveThreshold ? (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium bg-emerald-50 text-emerald-700">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                            Historic
                          </span>
                        ) : isBelow ? (
                          <span
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium bg-slate-100 text-slate-600"
                            title={`Classifier marked historic but confidence ${post.classified.confidence}% ≤ threshold ${threshold}%`}
                          >
                            <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
                            Below threshold
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium bg-slate-100 text-slate-600">
                            <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
                            Not Historic
                          </span>
                        )}
                      </td>

                      {/* Confidence */}
                      <td className="px-6 py-4 text-center">
                        {post.classified ? (
                          <ConfidenceIndicator confidence={post.classified.confidence} threshold={threshold} />
                        ) : (
                          <span className="text-slate-300">-</span>
                        )}
                      </td>

                      {/* Scraped Time */}
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2 text-sm text-slate-500">
                          <ClockIcon className="w-4 h-4 text-slate-400" />
                          {formatRelativeTime(post.scrapedAt)}
                        </div>
                      </td>

                      {/* Actions */}
                      <td className="px-6 py-4 text-center">
                        <div className="flex items-center justify-center gap-2">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              openPostDetail(post);
                            }}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
                          >
                            <EyeIcon className="h-4 w-4" />
                            View
                          </button>
                          {postLink && (
                            <a
                              href={postLink}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors"
                              title="Open on Facebook"
                            >
                              <ArrowTopRightOnSquareIcon className="h-4 w-4" />
                            </a>
                          )}
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeletePost(post.id);
                            }}
                            disabled={deletingPostId === post.id}
                            className="inline-flex items-center gap-1.5 px-2 py-1.5 text-sm font-medium text-red-600 bg-red-50 hover:bg-red-100 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                            title="Delete this post"
                          >
                            {deletingPostId === post.id ? (
                              <ArrowPathIcon className="h-4 w-4 animate-spin" />
                            ) : (
                              <TrashIcon className="h-4 w-4" />
                            )}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination */}
      <div className="bg-white border border-slate-200 rounded-xl p-4">
        <Pagination
          total={pagination.total}
          limit={pagination.limit}
          offset={pagination.offset}
          onPageChange={handlePageChange}
        />
      </div>

      {/* Post Detail Modal */}
      <PostDetailModal
        post={selectedPost}
        isOpen={isModalOpen}
        onClose={closePostDetail}
        threshold={threshold}
      />
    </div>
  );
};

export default PostsPage;

// Force SSR - prevent static generation
export const getServerSideProps = async () => {
  return { props: {} };
};
