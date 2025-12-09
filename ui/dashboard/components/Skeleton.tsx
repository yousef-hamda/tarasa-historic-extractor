import React from 'react';

interface SkeletonProps {
  className?: string;
}

export const Skeleton: React.FC<SkeletonProps> = ({ className = '' }) => (
  <div className={`animate-pulse bg-gray-200 rounded ${className}`} />
);

export const CardSkeleton: React.FC = () => (
  <div className="bg-white rounded shadow p-4 space-y-2">
    <Skeleton className="h-4 w-24" />
    <Skeleton className="h-8 w-16" />
  </div>
);

export const TableRowSkeleton: React.FC<{ columns: number }> = ({ columns }) => (
  <tr>
    {Array.from({ length: columns }).map((_, i) => (
      <td key={i} className="px-4 py-3">
        <Skeleton className="h-4 w-full" />
      </td>
    ))}
  </tr>
);

export const TableSkeleton: React.FC<{ rows?: number; columns?: number }> = ({
  rows = 5,
  columns = 4,
}) => (
  <div className="bg-white rounded shadow overflow-hidden">
    <table className="w-full">
      <thead className="bg-gray-50">
        <tr>
          {Array.from({ length: columns }).map((_, i) => (
            <th key={i} className="px-4 py-3 text-left">
              <Skeleton className="h-4 w-20" />
            </th>
          ))}
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-100">
        {Array.from({ length: rows }).map((_, i) => (
          <TableRowSkeleton key={i} columns={columns} />
        ))}
      </tbody>
    </table>
  </div>
);

export const DashboardSkeleton: React.FC = () => (
  <div className="p-8 space-y-6">
    <Skeleton className="h-8 w-64" />
    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
      <CardSkeleton />
      <CardSkeleton />
      <CardSkeleton />
      <CardSkeleton />
    </div>
    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
      <CardSkeleton />
      <CardSkeleton />
      <CardSkeleton />
      <CardSkeleton />
    </div>
  </div>
);

export const PageSkeleton: React.FC<{ title?: boolean }> = ({ title = true }) => (
  <div className="p-8 space-y-4">
    {title && <Skeleton className="h-8 w-32" />}
    <Skeleton className="h-4 w-48" />
    <TableSkeleton rows={10} columns={5} />
  </div>
);

export default Skeleton;
