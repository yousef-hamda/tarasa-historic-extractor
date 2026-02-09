import React, { useEffect, useState, useCallback } from 'react';
import { apiFetch } from '../utils/api';
import { useLanguage } from '../contexts/LanguageContext';
import { formatRelativeTime, truncateText } from '../utils/formatters';
import Pagination from '../components/Pagination';
import PostDetailModal from '../components/PostDetailModal';
import type { Post } from '../types';
import {
  MagnifyingGlassIcon,
  FunnelIcon,
  ArrowDownTrayIcon,
  ArrowPathIcon,
  XMarkIcon,
  CalendarIcon,
  UserIcon,
  DocumentTextIcon,
  StarIcon,
  ExclamationTriangleIcon,
  UserGroupIcon,
} from '@heroicons/react/24/outline';

interface GroupOption {
  groupId: string;
  groupName: string;
  postCount: number;
}

interface SearchFilters {
  query: string;
  authorName: string;
  groupId: string;
  isHistoric: string; // 'all' | 'true' | 'false' | 'null'
  minConfidence: string;
  maxConfidence: string;
  fromDate: string;
  toDate: string;
  hasAuthorLink: string; // 'all' | 'true' | 'false'
  minRating: string;
}

const initialFilters: SearchFilters = {
  query: '',
  authorName: '',
  groupId: '',
  isHistoric: 'all',
  minConfidence: '',
  maxConfidence: '',
  fromDate: '',
  toDate: '',
  hasAuthorLink: 'all',
  minRating: '',
};

const LIMIT = 50;

const SearchPage: React.FC = () => {
  const { t } = useLanguage();
  const [results, setResults] = useState<Post[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [groups, setGroups] = useState<GroupOption[]>([]);
  const [filters, setFilters] = useState<SearchFilters>(initialFilters);
  const [appliedFilters, setAppliedFilters] = useState<SearchFilters>(initialFilters);
  const [showFilters, setShowFilters] = useState(true);
  const [selectedPost, setSelectedPost] = useState<Post | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [exporting, setExporting] = useState(false);

  // Fetch groups for dropdown
  useEffect(() => {
    const fetchGroups = async () => {
      try {
        const res = await apiFetch('/api/search/groups');
        if (res.ok) {
          const data = await res.json();
          setGroups(data);
        }
      } catch (err) {
        console.error('Failed to fetch groups:', err);
      }
    };
    fetchGroups();
  }, []);

  const performSearch = useCallback(
    async (searchFilters: SearchFilters, searchOffset: number) => {
      setLoading(true);
      setError(null);

      try {
        const params = new URLSearchParams();
        params.set('limit', LIMIT.toString());
        params.set('offset', searchOffset.toString());

        if (searchFilters.query) params.set('query', searchFilters.query);
        if (searchFilters.authorName) params.set('authorName', searchFilters.authorName);
        if (searchFilters.groupId) params.set('groupId', searchFilters.groupId);
        if (searchFilters.isHistoric !== 'all') params.set('isHistoric', searchFilters.isHistoric);
        if (searchFilters.minConfidence) params.set('minConfidence', searchFilters.minConfidence);
        if (searchFilters.maxConfidence) params.set('maxConfidence', searchFilters.maxConfidence);
        if (searchFilters.fromDate) params.set('fromDate', searchFilters.fromDate);
        if (searchFilters.toDate) params.set('toDate', searchFilters.toDate);
        if (searchFilters.hasAuthorLink !== 'all') params.set('hasAuthorLink', searchFilters.hasAuthorLink);
        if (searchFilters.minRating) params.set('minRating', searchFilters.minRating);

        const res = await apiFetch(`/api/search/posts?${params.toString()}`);
        if (!res.ok) throw new Error('Search failed');

        const data = await res.json();
        setResults(data.data || []);
        setTotal(data.pagination?.total || 0);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Search failed');
      } finally {
        setLoading(false);
      }
    },
    []
  );

  const handleSearch = useCallback(() => {
    setOffset(0);
    setAppliedFilters({ ...filters });
    performSearch(filters, 0);
  }, [filters, performSearch]);

  const handlePageChange = useCallback(
    (newOffset: number) => {
      setOffset(newOffset);
      performSearch(appliedFilters, newOffset);
    },
    [appliedFilters, performSearch]
  );

  const handleClearFilters = useCallback(() => {
    setFilters(initialFilters);
    setAppliedFilters(initialFilters);
    setResults([]);
    setTotal(0);
    setOffset(0);
  }, []);

  const handleExport = useCallback(
    async (format: 'csv' | 'json') => {
      setExporting(true);
      try {
        const params = new URLSearchParams();
        params.set('format', format);

        if (appliedFilters.query) params.set('query', appliedFilters.query);
        if (appliedFilters.groupId) params.set('groupId', appliedFilters.groupId);
        if (appliedFilters.isHistoric !== 'all') params.set('isHistoric', appliedFilters.isHistoric);
        if (appliedFilters.fromDate) params.set('fromDate', appliedFilters.fromDate);
        if (appliedFilters.toDate) params.set('toDate', appliedFilters.toDate);

        const res = await apiFetch(`/api/search/export?${params.toString()}`);
        if (!res.ok) throw new Error('Export failed');

        const blob = await res.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `posts-export-${Date.now()}.${format}`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
      } catch (err) {
        console.error('Export failed:', err);
      } finally {
        setExporting(false);
      }
    },
    [appliedFilters]
  );

  const openPostDetail = (post: Post) => {
    setSelectedPost(post);
    setIsModalOpen(true);
  };

  const closePostDetail = () => {
    setIsModalOpen(false);
    setTimeout(() => setSelectedPost(null), 200);
  };

  const activeFilterCount = Object.entries(appliedFilters).filter(
    ([key, value]) =>
      value !== '' && value !== 'all' && key !== 'query'
  ).length;

  return (
    <div className="space-y-6 animate-slide-up">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">{t('search.advancedSearch')}</h1>
          <p className="text-slate-500 text-sm mt-0.5">
            {total > 0 ? `${total.toLocaleString()} ${t('search.results')}` : t('posts.searchPlaceholder')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`btn-secondary ${showFilters ? 'bg-slate-100' : ''}`}
          >
            <FunnelIcon className="w-4 h-4" />
            {t('common.filter')}
            {activeFilterCount > 0 && (
              <span className="ml-1 px-1.5 py-0.5 bg-blue-100 text-blue-700 text-xs font-medium rounded-full">
                {activeFilterCount}
              </span>
            )}
          </button>
          {total > 0 && (
            <div className="relative">
              <button
                onClick={() => handleExport('csv')}
                disabled={exporting}
                className="btn-secondary"
              >
                {exporting ? (
                  <ArrowPathIcon className="w-4 h-4 animate-spin" />
                ) : (
                  <ArrowDownTrayIcon className="w-4 h-4" />
                )}
                {t('posts.exportToCsv')}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Search Bar */}
      <div className="bg-white border border-slate-200 rounded-xl p-4">
        <div className="flex gap-3">
          <div className="relative flex-1">
            <MagnifyingGlassIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-slate-400" />
            <input
              type="text"
              placeholder={t('posts.searchPlaceholder')}
              value={filters.query}
              onChange={(e) => setFilters({ ...filters, query: e.target.value })}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              className="w-full pl-10 pr-4 py-3 border border-slate-200 rounded-lg text-base focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
          <button onClick={handleSearch} disabled={loading} className="btn-primary px-6">
            {loading ? (
              <ArrowPathIcon className="w-5 h-5 animate-spin" />
            ) : (
              <MagnifyingGlassIcon className="w-5 h-5" />
            )}
            {t('common.search')}
          </button>
        </div>
      </div>

      {/* Filters Panel */}
      {showFilters && (
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-slate-900">{t('search.advancedSearch')}</h3>
            <button
              onClick={handleClearFilters}
              className="text-sm text-slate-500 hover:text-slate-700 flex items-center gap-1"
            >
              <XMarkIcon className="w-4 h-4" />
              {t('search.clearFilters')}
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {/* Author Name */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                <UserIcon className="w-4 h-4 inline me-1" />
                {t('search.searchByAuthor')}
              </label>
              <input
                type="text"
                value={filters.authorName}
                onChange={(e) => setFilters({ ...filters, authorName: e.target.value })}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"
                placeholder={t('posts.author')}
              />
            </div>

            {/* Group */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                <UserGroupIcon className="w-4 h-4 inline me-1" />
                {t('search.selectGroup')}
              </label>
              <select
                value={filters.groupId}
                onChange={(e) => setFilters({ ...filters, groupId: e.target.value })}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"
              >
                <option value="">{t('search.allGroups')}</option>
                {groups.map((g) => (
                  <option key={g.groupId} value={g.groupId}>
                    {g.groupName} ({g.postCount})
                  </option>
                ))}
              </select>
            </div>

            {/* Classification Status */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                <DocumentTextIcon className="w-4 h-4 inline me-1" />
                {t('search.classificationStatus')}
              </label>
              <select
                value={filters.isHistoric}
                onChange={(e) => setFilters({ ...filters, isHistoric: e.target.value })}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"
              >
                <option value="all">{t('posts.allPosts')}</option>
                <option value="true">{t('posts.historicOnly')}</option>
                <option value="false">{t('posts.notHistoric')}</option>
                <option value="null">{t('posts.unclassified')}</option>
              </select>
            </div>

            {/* From Date */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                <CalendarIcon className="w-4 h-4 inline me-1" />
                {t('search.fromDate')}
              </label>
              <input
                type="date"
                value={filters.fromDate}
                onChange={(e) => setFilters({ ...filters, fromDate: e.target.value })}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"
              />
            </div>

            {/* To Date */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                <CalendarIcon className="w-4 h-4 inline me-1" />
                {t('search.toDate')}
              </label>
              <input
                type="date"
                value={filters.toDate}
                onChange={(e) => setFilters({ ...filters, toDate: e.target.value })}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"
              />
            </div>

            {/* Confidence Range */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                {t('posts.confidence')} (%)
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={filters.minConfidence}
                  onChange={(e) => setFilters({ ...filters, minConfidence: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"
                  placeholder="Min"
                />
                <span className="text-slate-400">-</span>
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={filters.maxConfidence}
                  onChange={(e) => setFilters({ ...filters, maxConfidence: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"
                  placeholder="Max"
                />
              </div>
            </div>

            {/* Has Author Link */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                {t('posts.withProfileLink')}
              </label>
              <select
                value={filters.hasAuthorLink}
                onChange={(e) => setFilters({ ...filters, hasAuthorLink: e.target.value })}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"
              >
                <option value="all">{t('common.all')}</option>
                <option value="true">{t('common.yes')}</option>
                <option value="false">{t('common.no')}</option>
              </select>
            </div>

            {/* Min Quality Rating */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                <StarIcon className="w-4 h-4 inline me-1" />
                {t('search.minRating')}
              </label>
              <select
                value={filters.minRating}
                onChange={(e) => setFilters({ ...filters, minRating: e.target.value })}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"
              >
                <option value="">{t('common.all')}</option>
                <option value="1">1+</option>
                <option value="2">2+</option>
                <option value="3">3+</option>
                <option value="4">4+</option>
                <option value="5">5</option>
              </select>
            </div>
          </div>

          <div className="mt-4 flex justify-end">
            <button onClick={handleSearch} disabled={loading} className="btn-primary">
              {loading ? <ArrowPathIcon className="w-4 h-4 animate-spin" /> : <FunnelIcon className="w-4 h-4" />}
              {t('search.applyFilters')}
            </button>
          </div>
        </div>
      )}

      {/* Error State */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-center gap-3">
          <ExclamationTriangleIcon className="w-5 h-5 text-red-500" />
          <span className="text-red-700">{error}</span>
        </div>
      )}

      {/* Results */}
      {results.length > 0 && (
        <>
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200">
                    <th className="px-6 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">
                      {t('posts.author')}
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">
                      {t('posts.postPreview')}
                    </th>
                    <th className="px-6 py-3 text-center text-xs font-semibold text-slate-500 uppercase tracking-wider">
                      {t('posts.classification')}
                    </th>
                    <th className="px-6 py-3 text-center text-xs font-semibold text-slate-500 uppercase tracking-wider">
                      {t('posts.confidence')}
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">
                      {t('posts.scraped')}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {results.map((post) => (
                    <tr
                      key={post.id}
                      className="hover:bg-slate-50 cursor-pointer transition-colors"
                      onClick={() => openPostDetail(post)}
                    >
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 bg-slate-100 rounded-lg flex items-center justify-center">
                            <UserIcon className="h-5 w-5 text-slate-400" />
                          </div>
                          <div className="min-w-0">
                            <div className="font-medium text-slate-900 truncate max-w-[150px]">
                              {post.authorName || 'Unknown'}
                            </div>
                            <div className="text-xs text-slate-400 truncate max-w-[150px]">
                              {post.groupId}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <p className="text-sm text-slate-600 line-clamp-2 max-w-md">
                          {truncateText(post.text || '', 150)}
                        </p>
                      </td>
                      <td className="px-6 py-4 text-center">
                        {post.classified ? (
                          <span
                            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium ${
                              post.classified.isHistoric
                                ? 'bg-emerald-50 text-emerald-700'
                                : 'bg-slate-100 text-slate-600'
                            }`}
                          >
                            <span
                              className={`w-1.5 h-1.5 rounded-full ${
                                post.classified.isHistoric ? 'bg-emerald-500' : 'bg-slate-400'
                              }`}
                            />
                            {post.classified.isHistoric ? t('posts.historic') : t('posts.notHistoric')}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium bg-amber-50 text-amber-600">
                            <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                            {t('posts.pending')}
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-center">
                        {post.classified ? (
                          <span
                            className={`text-sm font-semibold ${
                              post.classified.confidence >= 75
                                ? 'text-emerald-600'
                                : post.classified.confidence >= 50
                                ? 'text-amber-600'
                                : 'text-red-600'
                            }`}
                          >
                            {post.classified.confidence}%
                          </span>
                        ) : (
                          <span className="text-slate-300">-</span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-sm text-slate-500">
                        {formatRelativeTime(post.scrapedAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Pagination */}
          <div className="bg-white border border-slate-200 rounded-xl p-4">
            <Pagination total={total} limit={LIMIT} offset={offset} onPageChange={handlePageChange} />
          </div>
        </>
      )}

      {/* Empty State */}
      {!loading && results.length === 0 && total === 0 && (
        <div className="bg-white border border-slate-200 rounded-xl p-12 text-center">
          <div className="w-16 h-16 bg-slate-100 rounded-xl flex items-center justify-center mx-auto mb-4">
            <MagnifyingGlassIcon className="w-8 h-8 text-slate-400" />
          </div>
          <h3 className="text-lg font-semibold text-slate-900 mb-2">{t('search.advancedSearch')}</h3>
          <p className="text-slate-500 text-sm max-w-md mx-auto">
            {t('posts.searchPlaceholder')}
          </p>
        </div>
      )}

      {/* Post Detail Modal */}
      <PostDetailModal post={selectedPost} isOpen={isModalOpen} onClose={closePostDetail} />
    </div>
  );
};

export default SearchPage;

export const getServerSideProps = async () => {
  return { props: {} };
};
