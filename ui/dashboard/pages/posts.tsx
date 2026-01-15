import React, { useEffect, useState, useCallback } from 'react';
import Pagination from '../components/Pagination';
import PostDetailModal from '../components/PostDetailModal';
import { PageSkeleton } from '../components/Skeleton';
import { apiFetch } from '../utils/api';
import { formatRelativeTime, truncateText } from '../utils/formatters';
import type { Post } from '../types';
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
} from '@heroicons/react/24/outline';

interface PaginationState {
  total: number;
  limit: number;
  offset: number;
}

type FilterType = 'all' | 'historic' | 'not-historic' | 'unclassified' | 'with-link';

const LIMIT = 50;

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
const ConfidenceIndicator: React.FC<{ confidence: number }> = ({ confidence }) => {
  const getColor = (c: number) => {
    if (c >= 75) return 'text-emerald-600';
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
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, []);

  // Apply filters and search
  useEffect(() => {
    let result = [...data];

    // Apply filter
    switch (filter) {
      case 'historic':
        result = result.filter((p) => p.classified?.isHistoric === true);
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
  }, [data, filter, searchTerm]);

  useEffect(() => {
    loadPosts(0);
  }, [loadPosts]);

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

  if (loading && data.length === 0) {
    return <PageSkeleton />;
  }

  if (error) {
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
              <button
                onClick={() => loadPosts(0)}
                className="btn-primary mt-4"
              >
                <ArrowPathIcon className="w-4 h-4" />
                Retry Connection
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Stats for current page
  const pageStats = {
    total: filteredData.length,
    historic: filteredData.filter((p) => p.classified?.isHistoric).length,
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
          </p>
        </div>
        <button
          onClick={() => loadPosts(pagination.offset)}
          className="btn-secondary"
        >
          <ArrowPathIcon className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="On This Page"
          value={pageStats.total}
          icon={<DocumentTextIcon className="w-5 h-5 text-slate-600" />}
        />
        <StatCard
          title="Historic Posts"
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
          <div className="relative min-w-[180px]">
            <FunnelIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value as FilterType)}
              className="w-full pl-10 pr-8 py-2.5 border border-slate-200 rounded-lg text-sm appearance-none cursor-pointer"
            >
              <option value="all">All Posts</option>
              <option value="historic">Historic Only</option>
              <option value="not-historic">Not Historic</option>
              <option value="unclassified">Unclassified</option>
              <option value="with-link">With Profile Link</option>
            </select>
          </div>
        </div>
      </div>

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
                filteredData.map((post) => (
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
                          <div className="flex items-center gap-1 text-xs text-slate-400 mt-0.5">
                            <UserGroupIcon className="w-3 h-3" />
                            <span className="truncate max-w-[100px]">{post.groupId}</span>
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

                    {/* Classification */}
                    <td className="px-6 py-4 text-center">
                      {post.classified ? (
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium ${
                          post.classified.isHistoric
                            ? 'bg-emerald-50 text-emerald-700'
                            : 'bg-slate-100 text-slate-600'
                        }`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${post.classified.isHistoric ? 'bg-emerald-500' : 'bg-slate-400'}`} />
                          {post.classified.isHistoric ? 'Historic' : 'Not Historic'}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium bg-amber-50 text-amber-600">
                          <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                          Pending
                        </span>
                      )}
                    </td>

                    {/* Confidence */}
                    <td className="px-6 py-4 text-center">
                      {post.classified ? (
                        <ConfidenceIndicator confidence={post.classified.confidence} />
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
                    </td>
                  </tr>
                ))
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
      />
    </div>
  );
};

export default PostsPage;

// Force SSR - prevent static generation
export const getServerSideProps = async () => {
  return { props: {} };
};
