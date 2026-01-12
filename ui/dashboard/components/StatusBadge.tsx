import React from 'react';
import { getStatusColor } from '../utils/formatters';

interface StatusBadgeProps {
  status: string;
  label?: string;
  pulse?: boolean;
  size?: 'sm' | 'md' | 'lg';
}

const sizeClasses = {
  sm: 'text-xs px-2 py-0.5',
  md: 'text-sm px-2.5 py-0.5',
  lg: 'text-base px-3 py-1',
};

const StatusBadge: React.FC<StatusBadgeProps> = ({
  status,
  label,
  pulse = false,
  size = 'md',
}) => {
  const colorClasses = getStatusColor(status);
  const displayText = label || status.charAt(0).toUpperCase() + status.slice(1);

  return (
    <span
      className={`inline-flex items-center gap-1.5 font-medium rounded-full ${colorClasses} ${sizeClasses[size]}`}
    >
      {pulse && (
        <span className="relative flex h-2 w-2">
          <span
            className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${
              status === 'ok' || status === 'valid' || status === 'sent'
                ? 'bg-green-400'
                : status === 'degraded' || status === 'pending'
                ? 'bg-yellow-400'
                : 'bg-red-400'
            }`}
          />
          <span
            className={`relative inline-flex rounded-full h-2 w-2 ${
              status === 'ok' || status === 'valid' || status === 'sent'
                ? 'bg-green-500'
                : status === 'degraded' || status === 'pending'
                ? 'bg-yellow-500'
                : 'bg-red-500'
            }`}
          />
        </span>
      )}
      {displayText}
    </span>
  );
};

export default StatusBadge;
