import React, { useCallback, useEffect, useState } from 'react';
import Table from '../components/Table';

type PostRow = {
  id: number;
  groupId: string;
  authorName?: string | null;
  text: string;
  scrapedAt: string;
  classified?: { isHistoric: boolean; confidence: number | null } | null;
};

type PostsResponse = {
  data: PostRow[];
  pagination: { total: number; page: number; pages: number; limit: number };
};

type HistoricFilter = 'all' | 'historic' | 'non-historic' | 'pending';

const defaultResponse: PostsResponse = {
  data: [],
  pagination: { total: 0, page: 1, pages: 1, limit: 50 },
};

const PostsPage: React.FC = () => {
  const [response, setResponse] = useState<PostsResponse>(defaultResponse);
  const [groups, setGroups] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState<{ group: string; historic: HistoricFilter; page: number }>(
    { group: 'all', historic: 'all', page: 1 }
  );

  useEffect(() => {
    fetch('/api/settings')
      .then((res) => res.json())
      .then((payload) => setGroups(payload.groups || []));
  }, []);

  const fetchPosts = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams();
    params.set('page', filters.page.toString());
    params.set('limit', '25');

    if (filters.group !== 'all') {
      params.set('group', filters.group);
    }

    if (filters.historic !== 'all') {
      const mapping: Record<Exclude<HistoricFilter, 'all'>, string> = {
        historic: 'true',
        'non-historic': 'false',
        pending: 'pending',
      };
      params.set('historic', mapping[filters.historic]);
    }

    fetch(`/api/posts?${params.toString()}`)
      .then((res) => res.json())
      .then((payload) => setResponse(payload))
      .finally(() => setLoading(false));
  }, [filters]);

  useEffect(() => {
    fetchPosts();
  }, [fetchPosts]);

  const handleGroupChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    setFilters((prev) => ({ ...prev, group: event.target.value, page: 1 }));
  };

  const handleHistoricChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    setFilters((prev) => ({ ...prev, historic: event.target.value as HistoricFilter, page: 1 }));
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

  const { pagination } = response;
  const disablePrev = pagination.page <= 1;
  const disableNext = pagination.page >= pagination.pages;

  return (
    <div className="p-8 space-y-6">
      <div className="flex flex-col md:flex-row md:items-end gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-600 mb-1">Group</label>
          <select value={filters.group} onChange={handleGroupChange} className="border rounded px-3 py-2">
            <option value="all">All groups</option>
            {groups.map((group) => (
              <option key={group} value={group}>
                {group}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-600 mb-1">Historic filter</label>
          <select value={filters.historic} onChange={handleHistoricChange} className="border rounded px-3 py-2">
            <option value="all">All posts</option>
            <option value="historic">Historic only</option>
            <option value="non-historic">Non-historic</option>
            <option value="pending">Pending classification</option>
          </select>
        </div>

        <div className="flex-1 text-sm text-gray-500">
          Showing {pagination.limit} posts per page · {response.pagination.total} total matches
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={() => goToPage(-1)}
          disabled={disablePrev}
          className="px-4 py-2 bg-gray-200 rounded disabled:opacity-50"
        >
          Previous
        </button>
        <span>
          Page {pagination.page} of {pagination.pages}
        </span>
        <button
          onClick={() => goToPage(1)}
          disabled={disableNext}
          className="px-4 py-2 bg-gray-200 rounded disabled:opacity-50"
        >
          Next
        </button>
        {loading && <span className="text-sm text-gray-500">Loading…</span>}
      </div>

      <Table
        columns={[
          { header: 'Author', accessor: (row) => row.authorName || 'Unknown' },
          { header: 'Group', accessor: (row) => row.groupId },
          { header: 'Historic', accessor: (row) => (row.classified?.isHistoric ? 'Yes' : 'No') },
          { header: 'Confidence', accessor: (row) => row.classified?.confidence ?? '-' },
          { header: 'Text', accessor: (row) => `${row.text.slice(0, 120)}...` },
          { header: 'Scraped At', accessor: (row) => new Date(row.scrapedAt).toLocaleString() },
        ]}
        data={response.data}
      />
    </div>
  );
};

export default PostsPage;
