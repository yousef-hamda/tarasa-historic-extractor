import React, { useEffect, useState, useCallback } from 'react';
import Table from '../components/Table';
import Pagination from '../components/Pagination';
import { PageSkeleton } from '../components/Skeleton';
import { apiFetch } from '../utils/api';

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

const LogsPage: React.FC = () => {
  const [data, setData] = useState<LogEntry[]>([]);
  const [pagination, setPagination] = useState<PaginationState>({ total: 0, limit: LIMIT, offset: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<string>('');

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

  const getTypeColor = (type: string) => {
    switch (type) {
      case 'error':
        return 'text-red-600';
      case 'scrape':
        return 'text-blue-600';
      case 'classify':
        return 'text-purple-600';
      case 'message':
        return 'text-green-600';
      case 'auth':
        return 'text-yellow-600';
      default:
        return 'text-gray-600';
    }
  };

  if (loading && data.length === 0) {
    return <PageSkeleton />;
  }

  if (error) {
    return (
      <div className="p-8">
        <h1 className="text-2xl font-bold mb-4">Logs</h1>
        <p className="text-red-500">Error: {error}</p>
        <p className="text-gray-500 mt-2">Make sure the API server is running on port 4000.</p>
      </div>
    );
  }

  return (
    <div className="p-8 space-y-4">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">Logs</h1>
        <select
          value={typeFilter}
          onChange={handleFilterChange}
          className="border rounded px-3 py-1 text-sm"
        >
          <option value="">All Types</option>
          <option value="scrape">Scrape</option>
          <option value="classify">Classify</option>
          <option value="message">Message</option>
          <option value="auth">Auth</option>
          <option value="error">Error</option>
        </select>
      </div>
      <p className="text-gray-500">Total: {pagination.total} log entries</p>
      <Table
        columns={[
          {
            header: 'Type',
            accessor: (row) => (
              <span className={`font-medium ${getTypeColor(row.type)}`}>{row.type}</span>
            ),
          },
          { header: 'Message', accessor: (row) => row.message },
          { header: 'Timestamp', accessor: (row) => new Date(row.createdAt).toLocaleString() },
        ]}
        data={data}
      />
      <Pagination
        total={pagination.total}
        limit={pagination.limit}
        offset={pagination.offset}
        onPageChange={handlePageChange}
      />
    </div>
  );
};

export default LogsPage;

// Force SSR - prevent static generation
export const getServerSideProps = async () => {
  return { props: {} };
};
