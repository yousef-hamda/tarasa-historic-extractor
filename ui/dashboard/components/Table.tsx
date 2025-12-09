import React from 'react';

type Column<T> = {
  header: string;
  accessor: (item: T) => React.ReactNode;
};

type TableProps<T> = {
  columns: Column<T>[];
  data: T[];
  getRowKey?: (item: T, index: number) => string | number;
};

function TableComponent<T>({ columns, data, getRowKey }: TableProps<T>) {
  // Default key function uses index, but can be overridden with getRowKey prop
  const rowKey = (row: T, idx: number): string | number => {
    if (getRowKey) {
      return getRowKey(row, idx);
    }
    // Try to use common ID fields if available
    const record = row as Record<string, unknown>;
    if (typeof record.id === 'number' || typeof record.id === 'string') {
      return record.id;
    }
    if (typeof record.fbPostId === 'string') {
      return record.fbPostId;
    }
    // Fallback to index
    return idx;
  };

  return (
    <table className="min-w-full divide-y divide-gray-200">
      <thead className="bg-gray-50">
        <tr>
          {columns.map((column) => (
            <th key={column.header} className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              {column.header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody className="bg-white divide-y divide-gray-200">
        {data.map((row, idx) => (
          <tr key={rowKey(row, idx)}>
            {columns.map((column) => (
              <td key={column.header} className="px-4 py-2 text-sm text-gray-700">
                {column.accessor(row)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default TableComponent;
