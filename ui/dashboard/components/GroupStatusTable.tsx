import React from 'react';
import StatusBadge from './StatusBadge';
import { formatRelativeTime } from '../utils/formatters';
import { GlobeAltIcon, LockClosedIcon } from '@heroicons/react/24/outline';
import type { GroupInfo } from '../types';

interface GroupStatusTableProps {
  groups: GroupInfo[];
  loading?: boolean;
}

const GroupStatusTable: React.FC<GroupStatusTableProps> = ({ groups, loading }) => {
  if (loading) {
    return (
      <div className="bg-white rounded-lg shadow overflow-hidden">
        <div className="animate-pulse p-4 space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-12 bg-gray-200 rounded" />
          ))}
        </div>
      </div>
    );
  }

  if (groups.length === 0) {
    return (
      <div className="bg-white rounded-lg shadow p-6 text-center text-gray-500">
        No groups configured
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow overflow-hidden">
      <table className="min-w-full divide-y divide-gray-200">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Group ID
            </th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Type
            </th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Access Method
            </th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Status
            </th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Last Scraped
            </th>
          </tr>
        </thead>
        <tbody className="bg-white divide-y divide-gray-200">
          {groups.map((group) => (
            <tr key={group.groupId} className="hover:bg-gray-50">
              <td className="px-4 py-3 text-sm font-medium text-gray-900">
                {group.groupId}
              </td>
              <td className="px-4 py-3 text-sm text-gray-600">
                <div className="flex items-center gap-1.5">
                  {group.groupType === 'public' ? (
                    <GlobeAltIcon className="h-4 w-4 text-blue-500" />
                  ) : (
                    <LockClosedIcon className="h-4 w-4 text-yellow-500" />
                  )}
                  <span className="capitalize">{group.groupType}</span>
                </div>
              </td>
              <td className="px-4 py-3 text-sm text-gray-600">
                <span className="capitalize">{group.accessMethod}</span>
              </td>
              <td className="px-4 py-3">
                <StatusBadge
                  status={group.isAccessible ? 'ok' : 'error'}
                  label={group.isAccessible ? 'Accessible' : 'Inaccessible'}
                  size="sm"
                />
              </td>
              <td className="px-4 py-3 text-sm text-gray-600">
                {group.lastScraped ? formatRelativeTime(group.lastScraped) : 'Never'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default GroupStatusTable;
