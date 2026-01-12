import React, { useEffect, useState, useCallback } from 'react';
import Pagination from '../components/Pagination';
import PostDetailModal from '../components/PostDetailModal';
import StatusBadge from '../components/StatusBadge';
import { PageSkeleton } from '../components/Skeleton';
import { apiFetch } from '../utils/api';
import { formatRelativeTime, truncateText, getConfidenceColor } from '../utils/formatters';
import type { Post } from '../types';
import {
  MagnifyingGlassIcon,
  FunnelIcon,
  UserIcon,
  LinkIcon,
  EyeIcon,
  ArrowPathIcon,
} from '@heroicons/react/24/outline';

interface PaginationState {
  total: number;
  limit: number;
  offset: number;
}

type FilterType = 'all' | 'historic' | 'not-historic' | 'unclassified' | 'with-link';

const LIMIT = 50;

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
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">Posts</h1>
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-red-600 font-medium">Error: {error}</p>
          <p className="text-gray-600 mt-2">Make sure the API server is running on port 4000.</p>
          <button
            onClick={() => loadPosts(0)}
            className="mt-3 px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700"
          >
            Retry
          </button>
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
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Posts</h1>
          <p className="text-gray-500 mt-1">
            {pagination.total.toLocaleString()} total posts
            {filter !== 'all' && ` (showing ${filteredData.length} filtered)`}
          </p>
        </div>
        <button
          onClick={() => loadPosts(pagination.offset)}
          className="flex items-center gap-2 px-3 py-1.5 text-sm text-gray-600 hover:text-gray-900 border border-gray-300 rounded-md hover:bg-gray-50"
        >
          <ArrowPathIcon className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-lg shadow p-4">
          <div className="text-sm text-gray-500">On Page</div>
          <div className="text-2xl font-bold text-gray-900">{pageStats.total}</div>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <div className="text-sm text-gray-500">Historic</div>
          <div className="text-2xl font-bold text-green-600">{pageStats.historic}</div>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <div className="text-sm text-gray-500">With Profile Link</div>
          <div className="text-2xl font-bold text-blue-600">{pageStats.withLink}</div>
        </div>
        <div className="bg-white rounded-lg shadow p-4">
          <div className="text-sm text-gray-500">Classified</div>
          <div className="text-2xl font-bold text-purple-600">{pageStats.classified}</div>
        </div>
      </div>

      {/* Search and Filter Bar */}
      <div className="flex flex-col sm:flex-row gap-4">
        {/* Search */}
        <div className="relative flex-1">
          <MagnifyingGlassIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
          <input
            type="text"
            placeholder="Search posts by text, author, or group..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>

        {/* Filter Dropdown */}
        <div className="relative">
          <FunnelIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as FilterType)}
            className="pl-10 pr-8 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent appearance-none bg-white cursor-pointer"
          >
            <option value="all">All Posts</option>
            <option value="historic">Historic Only</option>
            <option value="not-historic">Not Historic</option>
            <option value="unclassified">Unclassified</option>
            <option value="with-link">With Profile Link</option>
          </select>
        </div>
      </div>

      {/* Posts Table */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">
                  Author
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">
                  Post Preview
                </th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-gray-600 uppercase tracking-wider">
                  AI Classification
                </th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-gray-600 uppercase tracking-wider">
                  Confidence
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">
                  Scraped
                </th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-gray-600 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {filteredData.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-gray-500">
                    {searchTerm || filter !== 'all'
                      ? 'No posts match your search/filter criteria'
                      : 'No posts found'}
                  </td>
                </tr>
              ) : (
                filteredData.map((post) => (
                  <tr
                    key={post.id}
                    className="hover:bg-gray-50 cursor-pointer transition-colors"
                    onClick={() => openPostDetail(post)}
                  >
                    {/* Author */}
                    <td className="px-4 py-4">
                      <div className="flex items-center gap-3">
                        <div className="flex-shrink-0 w-10 h-10 bg-gray-200 rounded-full flex items-center justify-center">
                          <UserIcon className="h-5 w-5 text-gray-500" />
                        </div>
                        <div className="min-w-0">
                          <div className="font-medium text-gray-900 truncate max-w-[150px]">
                            {post.authorName || 'Unknown'}
                          </div>
                          <div className="flex items-center gap-1 text-xs">
                            {post.authorLink ? (
                              <span className="text-green-600 flex items-center gap-1">
                                <LinkIcon className="h-3 w-3" />
                                Has Link
                              </span>
                            ) : (
                              <span className="text-gray-400">No Link</span>
                            )}
                          </div>
                        </div>
                      </div>
                    </td>

                    {/* Post Preview */}
                    <td className="px-4 py-4">
                      <p className="text-sm text-gray-700 line-clamp-2 max-w-md">
                        {truncateText(post.text || '', 150)}
                      </p>
                      <p className="text-xs text-gray-400 mt-1">Group: {post.groupId}</p>
                    </td>

                    {/* Classification */}
                    <td className="px-4 py-4 text-center">
                      {post.classified ? (
                        <StatusBadge
                          status={post.classified.isHistoric ? 'ok' : 'degraded'}
                          label={post.classified.isHistoric ? 'Historic' : 'Not Historic'}
                          size="sm"
                        />
                      ) : (
                        <span className="inline-flex items-center px-2 py-1 rounded-full text-xs bg-gray-100 text-gray-600">
                          Pending
                        </span>
                      )}
                    </td>

                    {/* Confidence */}
                    <td className="px-4 py-4 text-center">
                      {post.classified ? (
                        <div className="flex flex-col items-center">
                          <span className={`text-lg font-bold ${getConfidenceColor(post.classified.confidence)}`}>
                            {post.classified.confidence}%
                          </span>
                          <div className="w-16 h-1.5 bg-gray-200 rounded-full mt-1 overflow-hidden">
                            <div
                              className={`h-full rounded-full ${
                                post.classified.confidence >= 75
                                  ? 'bg-green-500'
                                  : post.classified.confidence >= 50
                                  ? 'bg-yellow-500'
                                  : 'bg-red-500'
                              }`}
                              style={{ width: `${post.classified.confidence}%` }}
                            />
                          </div>
                        </div>
                      ) : (
                        <span className="text-gray-400">-</span>
                      )}
                    </td>

                    {/* Scraped Time */}
                    <td className="px-4 py-4">
                      <span className="text-sm text-gray-600">
                        {formatRelativeTime(post.scrapedAt)}
                      </span>
                    </td>

                    {/* Actions */}
                    <td className="px-4 py-4 text-center">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          openPostDetail(post);
                        }}
                        className="inline-flex items-center gap-1 px-3 py-1.5 text-sm text-blue-600 hover:text-blue-800 hover:bg-blue-50 rounded-md transition-colors"
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
      <Pagination
        total={pagination.total}
        limit={pagination.limit}
        offset={pagination.offset}
        onPageChange={handlePageChange}
      />

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
