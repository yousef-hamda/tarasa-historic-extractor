import React, { useEffect, useState, useCallback } from 'react';
import Pagination from '../components/Pagination';
import { PageSkeleton } from '../components/Skeleton';
import { apiFetch } from '../utils/api';
import {
  ClipboardDocumentListIcon,
  FunnelIcon,
  ArrowPathIcon,
  ClockIcon,
  ExclamationTriangleIcon,
  InformationCircleIcon,
  CheckCircleIcon,
  BugAntIcon,
  ChatBubbleLeftIcon,
  ShieldCheckIcon,
  CpuChipIcon,
  SparklesIcon,
  MagnifyingGlassIcon,
  XCircleIcon,
} from '@heroicons/react/24/outline';

interface LogEntry {
  id: number;
  type: string;
  message: string;
  createdAt: string;
}

interface PaginationState {
  total: number;
  limit: number;
  offset: number;
}

const LIMIT = 100;

// Log Type Badge Component
const LogTypeBadge: React.FC<{ type: string }> = ({ type }) => {
  const getTypeStyle = () => {
    switch (type.toLowerCase()) {
      case 'error':
        return { bg: 'bg-red-50', text: 'text-red-700', icon: ExclamationTriangleIcon };
      case 'scrape':
        return { bg: 'bg-slate-100', text: 'text-slate-700', icon: CpuChipIcon };
      case 'classify':
        return { bg: 'bg-slate-100', text: 'text-slate-700', icon: SparklesIcon };
      case 'message':
        return { bg: 'bg-emerald-50', text: 'text-emerald-700', icon: ChatBubbleLeftIcon };
      case 'auth':
        return { bg: 'bg-amber-50', text: 'text-amber-700', icon: ShieldCheckIcon };
      case 'info':
        return { bg: 'bg-slate-100', text: 'text-slate-600', icon: InformationCircleIcon };
      case 'success':
        return { bg: 'bg-emerald-50', text: 'text-emerald-700', icon: CheckCircleIcon };
      case 'debug':
        return { bg: 'bg-slate-100', text: 'text-slate-500', icon: BugAntIcon };
      default:
        return { bg: 'bg-slate-100', text: 'text-slate-600', icon: InformationCircleIcon };
    }
  };

  const style = getTypeStyle();
  const Icon = style.icon;

  return (
    <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium ${style.bg} ${style.text}`}>
      <Icon className="w-3.5 h-3.5" />
      {type.charAt(0).toUpperCase() + type.slice(1)}
    </span>
  );
};

// Stats Card Component
const StatsCard: React.FC<{
  label: string;
  value: number;
  icon: React.ComponentType<{ className?: string }>;
}> = ({ label, value, icon: Icon }) => (
  <div className="bg-white border border-slate-200 rounded-xl p-5 transition-colors hover:border-slate-300">
    <div className="flex items-center justify-between">
      <div>
        <p className="text-sm font-medium text-slate-500">{label}</p>
        <p className="text-2xl font-semibold text-slate-900 mt-1">{value.toLocaleString()}</p>
      </div>
      <div className="w-10 h-10 rounded-lg bg-slate-100 flex items-center justify-center">
        <Icon className="w-5 h-5 text-slate-600" />
      </div>
    </div>
  </div>
);

const LogsPage: React.FC = () => {
  const [data, setData] = useState<LogEntry[]>([]);
  const [pagination, setPagination] = useState<PaginationState>({ total: 0, limit: LIMIT, offset: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<string>('');
  const [searchTerm, setSearchTerm] = useState('');

  const loadLogs = useCallback(async (offset: number, type?: string) => {
    setLoading(true);
    try {
      let url = `/api/logs?limit=${LIMIT}&offset=${offset}`;
      if (type) url += `&type=${type}`;

      const res = await apiFetch(url);
      if (!res.ok) {
        throw new Error('Failed to fetch logs');
      }
      const result = await res.json();
      const logs = Array.isArray(result) ? result : (result.data || []);
      setData(logs);
      setPagination({
        total: result.pagination?.total || logs.length,
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

  useEffect(() => {
    loadLogs(0, typeFilter || undefined);
  }, [loadLogs, typeFilter]);

  const handlePageChange = (newOffset: number) => {
    loadLogs(newOffset, typeFilter || undefined);
  };

  const handleFilterChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setTypeFilter(e.target.value);
  };

  // Filter data by search term
  const filteredData = searchTerm
    ? data.filter(log =>
        log.message.toLowerCase().includes(searchTerm.toLowerCase()) ||
        log.type.toLowerCase().includes(searchTerm.toLowerCase())
      )
    : data;

  // Calculate stats from current page
  const stats = {
    errors: data.filter(l => l.type === 'error').length,
    scrapes: data.filter(l => l.type === 'scrape').length,
    messages: data.filter(l => l.type === 'message').length,
    auth: data.filter(l => l.type === 'auth').length,
  };

  if (loading && data.length === 0) {
    return <PageSkeleton />;
  }

  if (error) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">System Logs</h1>
          <p className="text-slate-500 text-sm mt-0.5">Monitor system activity and events</p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-8">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-lg bg-red-100 flex items-center justify-center">
              <ExclamationTriangleIcon className="w-6 h-6 text-red-600" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Connection Error</h2>
              <p className="text-slate-600 text-sm">{error}</p>
              <p className="text-slate-400 text-sm mt-1">Make sure the API server is running on port 4000.</p>
              <button onClick={() => loadLogs(0)} className="btn-primary mt-4">
                <ArrowPathIcon className="w-4 h-4" />
                Retry Connection
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-slide-up">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">System Logs</h1>
          <p className="text-slate-500 text-sm mt-0.5">
            {pagination.total.toLocaleString()} total entries
          </p>
        </div>
        <button
          onClick={() => loadLogs(pagination.offset, typeFilter || undefined)}
          className="btn-secondary"
        >
          <ArrowPathIcon className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatsCard label="Errors" value={stats.errors} icon={XCircleIcon} />
        <StatsCard label="Scrapes" value={stats.scrapes} icon={CpuChipIcon} />
        <StatsCard label="Messages" value={stats.messages} icon={ChatBubbleLeftIcon} />
        <StatsCard label="Auth" value={stats.auth} icon={ShieldCheckIcon} />
      </div>

      {/* Search and Filter */}
      <div className="bg-white border border-slate-200 rounded-xl p-4">
        <div className="flex flex-col sm:flex-row gap-4">
          {/* Search */}
          <div className="relative flex-1">
            <MagnifyingGlassIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-slate-400" />
            <input
              type="text"
              placeholder="Search logs by message or type..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 border border-slate-200 rounded-lg text-sm"
            />
          </div>

          {/* Filter */}
          <div className="relative min-w-[150px]">
            <FunnelIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
            <select
              value={typeFilter}
              onChange={handleFilterChange}
              className="w-full pl-10 pr-8 py-2.5 border border-slate-200 rounded-lg text-sm appearance-none cursor-pointer"
            >
              <option value="">All Types</option>
              <option value="scrape">Scrape</option>
              <option value="classify">Classify</option>
              <option value="message">Message</option>
              <option value="auth">Auth</option>
              <option value="error">Error</option>
              <option value="info">Info</option>
              <option value="debug">Debug</option>
            </select>
          </div>
        </div>
      </div>

      {/* Logs Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="px-6 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider w-32">
                  Type
                </th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  Message
                </th>
                <th className="px-6 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider w-48">
                  <div className="flex items-center gap-2">
                    <ClockIcon className="w-4 h-4" />
                    Timestamp
                  </div>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredData.length === 0 ? (
                <tr>
                  <td colSpan={3} className="px-6 py-16 text-center">
                    <div className="flex flex-col items-center gap-4">
                      <div className="w-12 h-12 rounded-lg bg-slate-100 flex items-center justify-center">
                        <ClipboardDocumentListIcon className="w-6 h-6 text-slate-400" />
                      </div>
                      <div>
                        <p className="text-slate-600 font-medium">
                          {searchTerm || typeFilter ? 'No logs match your criteria' : 'No logs found'}
                        </p>
                        <p className="text-slate-400 text-sm mt-1">
                          Try adjusting your search or filter settings
                        </p>
                      </div>
                    </div>
                  </td>
                </tr>
              ) : (
                filteredData.map((log) => (
                  <tr
                    key={log.id}
                    className={`hover:bg-slate-50 transition-colors ${
                      log.type === 'error' ? 'bg-red-50/50' : ''
                    }`}
                  >
                    <td className="px-6 py-4">
                      <LogTypeBadge type={log.type} />
                    </td>
                    <td className="px-6 py-4">
                      <p className={`text-sm ${log.type === 'error' ? 'text-red-700 font-medium' : 'text-slate-700'} leading-relaxed`}>
                        {log.message}
                      </p>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2 text-sm text-slate-500">
                        <ClockIcon className="w-4 h-4 text-slate-400" />
                        <span className="font-mono text-xs">
                          {new Date(log.createdAt).toLocaleString()}
                        </span>
                      </div>
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
    </div>
  );
};

export default LogsPage;

// Force SSR - prevent static generation
export const getServerSideProps = async () => {
  return { props: {} };
};
