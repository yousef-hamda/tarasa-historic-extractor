import React, { useEffect, useState } from 'react';
import Table from '../components/Table';

const PostsPage: React.FC = () => {
  const [data, setData] = useState<any[]>([]);

  useEffect(() => {
    fetch('/api/posts')
      .then((res) => res.json())
      .then((posts) => setData(posts));
  }, []);

  return (
    <div className="p-8 space-y-4">
      <h1 className="text-2xl font-bold">Posts</h1>
      <Table
        columns={[
          { header: 'Author', accessor: (row) => row.authorName || 'Unknown' },
          { header: 'Group', accessor: (row) => row.groupId },
          { header: 'Historic', accessor: (row) => (row.classified?.isHistoric ? 'Yes' : 'No') },
          { header: 'Confidence', accessor: (row) => row.classified?.confidence ?? '-' },
          { header: 'Text', accessor: (row) => `${row.text.slice(0, 120)}...` },
          { header: 'Scraped At', accessor: (row) => new Date(row.scrapedAt).toLocaleString() },
        ]}
        data={data}
      />
    </div>
  );
};

export default PostsPage;
