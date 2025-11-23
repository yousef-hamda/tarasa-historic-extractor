import React, { useEffect, useState } from 'react';
import Table from '../components/Table';
import { apiFetch } from '../utils/api';

const LogsPage: React.FC = () => {
  const [data, setData] = useState<any[]>([]);

  useEffect(() => {
    apiFetch('/api/logs')
      .then((res) => res.json())
      .then((logs) => setData(logs));
  }, []);

  return (
    <div className="p-8 space-y-4">
      <h1 className="text-2xl font-bold">Logs</h1>
      <Table
        columns={[
          { header: 'Type', accessor: (row) => row.type },
          { header: 'Message', accessor: (row) => row.message },
          { header: 'Timestamp', accessor: (row) => new Date(row.createdAt).toLocaleString() },
        ]}
        data={data}
      />
    </div>
  );
};

export default LogsPage;
