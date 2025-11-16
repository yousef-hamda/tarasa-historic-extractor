import React, { useCallback, useEffect, useState } from 'react';
import Table from '../components/Table';

type LogsResponse = {
  data: any[];
  pagination: { total: number; page: number; pages: number; limit: number };
  availableTypes: string[];
};

const defaultResponse: LogsResponse = {
  data: [],
  pagination: { total: 0, page: 1, pages: 1, limit: 50 },
  availableTypes: [],
};

const LogsPage: React.FC = () => {
  const [response, setResponse] = useState<LogsResponse>(defaultResponse);
  const [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState({ type: 'all', search: '', page: 1 });
  const [searchInput, setSearchInput] = useState('');

  const fetchLogs = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams();
    params.set('page', filters.page.toString());
    params.set('limit', '50');

    if (filters.type !== 'all') {
      params.set('type', filters.type);
    }

    if (filters.search) {
      params.set('search', filters.search);
    }

    fetch(`/api/logs?${params.toString()}`)
      .then((res) => res.json())
      .then((payload) => setResponse(payload))
      .finally(() => setLoading(false));
  }, [filters]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  const submitSearch = (event: React.FormEvent) => {
    event.preventDefault();
    setFilters((prev) => ({ ...prev, search: searchInput.trim(), page: 1 }));
  };

  const changeType = (event: React.ChangeEvent<HTMLSelectElement>) => {
    setFilters((prev) => ({ ...prev, type: event.target.value, page: 1 }));
  };

  const goToPage = (direction: number) => {
    setFilters((prev) => {
      const totalPages = response.pagination.pages || 1;
      const nextPage = Math.min(Math.max(1, prev.page + direction), totalPages);
      if (nextPage === prev.page) {
        return prev;
      }
      return { ...prev, page: nextPage };
    });
  };

  const refresh = () => {
    fetchLogs();
  };

  const types = ['all', ...response.availableTypes.filter((type) => type && type !== 'all')];

  return (
    <div className="p-8 space-y-6">
      <div className="flex flex-col md:flex-row md:items-end gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-600 mb-1">Type</label>
          <select value={filters.type} onChange={changeType} className="border rounded px-3 py-2 min-w-[180px]">
            {types.map((type) => (
              <option key={type} value={type}>
                {type === 'all' ? 'All events' : type}
              </option>
            ))}
          </select>
        </div>

        <form onSubmit={submitSearch} className="flex flex-col">
          <label className="block text-sm font-medium text-gray-600 mb-1">Search message</label>
          <div className="flex gap-2">
            <input
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Contains text…"
              className="border rounded px-3 py-2"
            />
            <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded">
              Apply
            </button>
          </div>
        </form>

        <button onClick={refresh} className="self-start px-4 py-2 bg-gray-200 rounded">
          Refresh
        </button>

        {loading && <span className="text-sm text-gray-500">Loading…</span>}
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={() => goToPage(-1)}
          disabled={response.pagination.page <= 1}
          className="px-4 py-2 bg-gray-200 rounded disabled:opacity-50"
        >
          Previous
        </button>
        <span>
          Page {response.pagination.page} of {response.pagination.pages}
        </span>
        <button
          onClick={() => goToPage(1)}
          disabled={response.pagination.page >= response.pagination.pages}
          className="px-4 py-2 bg-gray-200 rounded disabled:opacity-50"
        >
          Next
        </button>
      </div>

      <Table
        columns={[
          { header: 'Type', accessor: (row) => row.type },
          { header: 'Message', accessor: (row) => row.message },
          { header: 'Timestamp', accessor: (row) => new Date(row.createdAt).toLocaleString() },
        ]}
        data={response.data}
      />
    </div>
  );
};

export default LogsPage;
