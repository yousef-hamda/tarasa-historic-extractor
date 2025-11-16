import React, { useEffect, useState } from 'react';
import Table from '../components/Table';

const MessagesPage: React.FC = () => {
  const [data, setData] = useState<any[]>([]);

  useEffect(() => {
    fetch('/api/messages')
      .then((res) => res.json())
      .then((messages) => setData(messages));
  }, []);

  return (
    <div className="p-8 space-y-4">
      <h1 className="text-2xl font-bold">Messages</h1>
      <Table
        columns={[
          { header: 'Post ID', accessor: (row) => row.postId },
          { header: 'Author Link', accessor: (row) => row.authorLink },
          { header: 'Status', accessor: (row) => row.status },
          { header: 'Error', accessor: (row) => row.error || '-' },
          { header: 'Sent At', accessor: (row) => new Date(row.sentAt).toLocaleString() },
        ]}
        data={data}
      />
    </div>
  );
};

export default MessagesPage;
