import React, { useEffect, useState, useCallback } from 'react';
import Table from '../components/Table';
import Pagination from '../components/Pagination';
import { PageSkeleton } from '../components/Skeleton';
import { apiFetch } from '../utils/api';

interface Post {
  id: number;
  groupId: string;
  fbPostId: string;
  authorName?: string;
  authorLink?: string;
  text: string;
  scrapedAt: string;
  classified?: {
    id: number;
    isHistoric: boolean;
    confidence: number;
    reason: string;
  };
}

interface PaginationState {
  total: number;
  limit: number;
  offset: number;
}

const LIMIT = 50;

const PostsPage: React.FC = () => {
  const [data, setData] = useState<Post[]>([]);
  const [pagination, setPagination] = useState<PaginationState>({ total: 0, limit: LIMIT, offset: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  useEffect(() => {
    loadPosts(0);
  }, [loadPosts]);

  const handlePageChange = (newOffset: number) => {
    loadPosts(newOffset);
  };

  if (loading && data.length === 0) {
    return <PageSkeleton />;
  }

  if (error) {
    return (
      <div className="p-8">
        <h1 className="text-2xl font-bold mb-4">Posts</h1>
        <p className="text-red-500">Error: {error}</p>
        <p className="text-gray-500 mt-2">Make sure the API server is running on port 4000.</p>
      </div>
    );
  }

  return (
    <div className="p-8 space-y-4">
      <h1 className="text-2xl font-bold">Posts</h1>
      <p className="text-gray-500">Total: {pagination.total} posts</p>
      <Table
        columns={[
          { header: 'Author', accessor: (row) => row.authorName || 'Unknown' },
          {
            header: 'Has Link',
            accessor: (row) => (
              <span className={row.authorLink ? 'text-green-600' : 'text-red-600'}>
                {row.authorLink ? 'Yes' : 'No'}
              </span>
            ),
          },
          {
            header: 'Historic',
            accessor: (row) => (
              <span className={row.classified?.isHistoric ? 'text-green-600 font-medium' : 'text-gray-500'}>
                {row.classified?.isHistoric ? 'Yes' : 'No'}
              </span>
            ),
          },
          {
            header: 'Confidence',
            accessor: (row) => {
              const conf = row.classified?.confidence;
              if (conf === undefined) return '-';
              const color = conf >= 75 ? 'text-green-600' : conf >= 50 ? 'text-yellow-600' : 'text-red-600';
              return <span className={color}>{conf}%</span>;
            },
          },
          { header: 'Text', accessor: (row) => `${row.text?.slice(0, 100) || ''}...` },
          { header: 'Scraped At', accessor: (row) => new Date(row.scrapedAt).toLocaleString() },
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

export default PostsPage;

// Force SSR - prevent static generation
export const getServerSideProps = async () => {
  return { props: {} };
};
