// Utility functions for formatting data

export function formatDate(date: string | Date | null): string {
  if (!date) return 'Never';
  const d = new Date(date);
  return d.toLocaleString();
}

export function formatRelativeTime(date: string | Date | null): string {
  if (!date) return 'Never';

  const now = new Date();
  const then = new Date(date);
  const diffMs = now.getTime() - then.getTime();
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSecs < 60) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;

  return formatDate(date);
}

export function formatPercentage(value: number): string {
  return `${Math.round(value)}%`;
}

export function truncateText(text: string, maxLength: number): string {
  if (!text) return '';
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength).trim() + '...';
}

export function getConfidenceColor(confidence: number): string {
  if (confidence >= 75) return 'text-green-600';
  if (confidence >= 50) return 'text-yellow-600';
  return 'text-red-600';
}

export function getConfidenceBgColor(confidence: number): string {
  if (confidence >= 75) return 'bg-green-500';
  if (confidence >= 50) return 'bg-yellow-500';
  return 'bg-red-500';
}

export function getStatusColor(status: string): string {
  switch (status) {
    case 'ok':
    case 'valid':
    case 'sent':
      return 'text-green-600 bg-green-100';
    case 'degraded':
    case 'pending':
      return 'text-yellow-600 bg-yellow-100';
    case 'unhealthy':
    case 'invalid':
    case 'expired':
    case 'blocked':
    case 'error':
      return 'text-red-600 bg-red-100';
    default:
      return 'text-gray-600 bg-gray-100';
  }
}

export function getLogTypeColor(type: string): string {
  switch (type) {
    case 'error':
      return 'text-red-600';
    case 'scrape':
      return 'text-blue-600';
    case 'classify':
      return 'text-purple-600';
    case 'message':
      return 'text-green-600';
    case 'auth':
      return 'text-yellow-600';
    default:
      return 'text-gray-600';
  }
}

export function formatUptime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);

  if (hours > 24) {
    const days = Math.floor(hours / 24);
    return `${days}d ${hours % 24}h`;
  }
  if (hours > 0) {
    return `${hours}h ${mins}m`;
  }
  return `${mins}m`;
}
