import React from 'react';
import StatusBadge from './StatusBadge';
import { formatRelativeTime } from '../utils/formatters';
import {
  CheckCircleIcon,
  XCircleIcon,
  ExclamationTriangleIcon,
} from '@heroicons/react/24/outline';

interface StatusDetail {
  label: string;
  value: string | boolean;
  status?: 'ok' | 'error' | 'warning';
}

interface SystemStatusCardProps {
  title: string;
  status: 'ok' | 'degraded' | 'unhealthy';
  details: StatusDetail[];
  lastUpdated?: string;
  onRefresh?: () => void;
}

const SystemStatusCard: React.FC<SystemStatusCardProps> = ({
  title,
  status,
  details,
  lastUpdated,
  onRefresh,
}) => {
  const getStatusIcon = (detailStatus?: 'ok' | 'error' | 'warning', value?: boolean) => {
    const iconStatus = detailStatus || (value === true ? 'ok' : value === false ? 'error' : undefined);

    if (iconStatus === 'ok') {
      return <CheckCircleIcon className="h-5 w-5 text-green-500" />;
    }
    if (iconStatus === 'error') {
      return <XCircleIcon className="h-5 w-5 text-red-500" />;
    }
    if (iconStatus === 'warning') {
      return <ExclamationTriangleIcon className="h-5 w-5 text-yellow-500" />;
    }
    return null;
  };

  return (
    <div className="bg-white rounded-lg shadow p-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
        <StatusBadge status={status} pulse />
      </div>

      <div className="space-y-3">
        {details.map((detail, index) => (
          <div key={index} className="flex items-center justify-between">
            <span className="text-sm text-gray-600">{detail.label}</span>
            <div className="flex items-center gap-2">
              {typeof detail.value === 'boolean' ? (
                getStatusIcon(detail.status, detail.value)
              ) : (
                <>
                  {detail.status && getStatusIcon(detail.status)}
                  <span className="text-sm font-medium text-gray-900">
                    {detail.value}
                  </span>
                </>
              )}
            </div>
          </div>
        ))}
      </div>

      {(lastUpdated || onRefresh) && (
        <div className="mt-4 pt-3 border-t border-gray-100 flex items-center justify-between">
          {lastUpdated && (
            <span className="text-xs text-gray-500">
              Updated {formatRelativeTime(lastUpdated)}
            </span>
          )}
          {onRefresh && (
            <button
              onClick={onRefresh}
              className="text-xs text-blue-600 hover:text-blue-800"
            >
              Refresh
            </button>
          )}
        </div>
      )}
    </div>
  );
};

export default SystemStatusCard;
