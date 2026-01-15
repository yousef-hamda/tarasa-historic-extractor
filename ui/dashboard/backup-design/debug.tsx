import React, { useState, useEffect, useCallback, useRef } from 'react';
import { apiFetch } from '../utils/api';
import SystemStatusIndicator from '../components/SystemStatusIndicator';

interface SystemMetrics {
  timestamp: string;
  cpu: { usage: number; cores: number; loadAverage: number[] };
  memory: {
    total: number;
    used: number;
    free: number;
    heapUsed: number;
    heapTotal: number;
    usagePercent: number;
  };
  process: { pid: number; uptime: number; version: string };
  eventLoop: { latency: number; isBlocked: boolean };
}

interface RequestLog {
  id: string;
  timestamp: string;
  method: string;
  path: string;
  statusCode: number;
  responseTime: number;
}

interface ErrorLog {
  id: string;
  timestamp: string;
  type: string;
  message: string;
  occurrences: number;
  resolved: boolean;
}

interface HealthIssue {
  id: string;
  type: 'critical' | 'warning' | 'info';
  category: string;
  message: string;
  detectedAt: string;
  autoHealable: boolean;
  resolved: boolean;
}

interface HealingAction {
  id: string;
  timestamp: string;
  problem: string;
  action: string;
  status: 'pending' | 'executing' | 'success' | 'failed';
  result?: string;
}

interface CircuitBreaker {
  name: string;
  state: 'closed' | 'open' | 'half_open';
  failures: number;
  successes: number;
}

interface DebugOverview {
  timestamp: string;
  system: {
    metrics: SystemMetrics;
    stressStatus: { stressed: boolean; reasons: string[] };
    formatted: {
      memory: string;
      heapUsage: string;
      uptime: string;
      eventLoopLatency: string;
    };
  };
  requests: {
    stats: {
      totalRequests: number;
      requestsPerMinute: number;
      avgResponseTime: number;
      errorRate: number;
    };
    slowCount: number;
    failedCount: number;
  };
  errors: {
    stats: {
      total: number;
      unresolved: number;
      last24Hours: number;
    };
  };
  healing: {
    enabled: boolean;
    activeIssues: HealthIssue[];
    actionsExecuted: number;
    successfulActions: number;
    failedActions: number;
  };
  websocket: { connectedClients: number };
}

const formatBytes = (bytes: number): string => {
  const units = ['B', 'KB', 'MB', 'GB'];
  let unitIndex = 0;
  let value = bytes;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }
  return `${value.toFixed(1)} ${units[unitIndex]}`;
};

const formatDuration = (seconds: number): string => {
  if (seconds < 60) return `${seconds.toFixed(0)}s`;
  if (seconds < 3600) return `${(seconds / 60).toFixed(1)}m`;
  if (seconds < 86400) return `${(seconds / 3600).toFixed(1)}h`;
  return `${(seconds / 86400).toFixed(1)}d`;
};

const StatusBadge: React.FC<{ status: string; type?: 'health' | 'circuit' | 'action' }> = ({ status, type }) => {
  const getColor = () => {
    if (type === 'circuit') {
      switch (status) {
        case 'closed': return 'bg-green-100 text-green-800';
        case 'open': return 'bg-red-100 text-red-800';
        case 'half_open': return 'bg-yellow-100 text-yellow-800';
      }
    }
    if (type === 'action') {
      switch (status) {
        case 'success': return 'bg-green-100 text-green-800';
        case 'failed': return 'bg-red-100 text-red-800';
        case 'executing': return 'bg-blue-100 text-blue-800';
        case 'pending': return 'bg-gray-100 text-gray-800';
      }
    }
    switch (status) {
      case 'critical': return 'bg-red-100 text-red-800';
      case 'warning': return 'bg-yellow-100 text-yellow-800';
      case 'info': return 'bg-blue-100 text-blue-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  return (
    <span className={`px-2 py-1 rounded-full text-xs font-medium ${getColor()}`}>
      {status}
    </span>
  );
};

export default function DebugPage() {
  const [overview, setOverview] = useState<DebugOverview | null>(null);
  const [requests, setRequests] = useState<RequestLog[]>([]);
  const [errors, setErrors] = useState<ErrorLog[]>([]);
  const [healingActions, setHealingActions] = useState<HealingAction[]>([]);
  const [circuitBreakers, setCircuitBreakers] = useState<CircuitBreaker[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'requests' | 'errors' | 'healing'>('overview');
  const [autoRefresh, setAutoRefresh] = useState(true);
  const wsRef = useRef<WebSocket | null>(null);

  const fetchOverview = useCallback(async () => {
    try {
      const res = await apiFetch('/api/debug/overview');
      if (res.ok) {
        const data = await res.json();
        setOverview(data);
      }
    } catch (err) {
      console.error('Failed to fetch debug overview:', err);
    }
  }, []);

  const fetchRequests = useCallback(async () => {
    try {
      const res = await apiFetch('/api/debug/requests?limit=50');
      if (res.ok) {
        const data = await res.json();
        setRequests(data.requests);
      }
    } catch (err) {
      console.error('Failed to fetch requests:', err);
    }
  }, []);

  const fetchErrors = useCallback(async () => {
    try {
      const res = await apiFetch('/api/debug/errors?resolved=false');
      if (res.ok) {
        const data = await res.json();
        setErrors(data.errors);
      }
    } catch (err) {
      console.error('Failed to fetch errors:', err);
    }
  }, []);

  const fetchHealing = useCallback(async () => {
    try {
      const res = await apiFetch('/api/debug/healing');
      if (res.ok) {
        const data = await res.json();
        setHealingActions(data.actions);
        setCircuitBreakers(data.circuitBreakers);
      }
    } catch (err) {
      console.error('Failed to fetch healing data:', err);
    }
  }, []);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    await Promise.all([fetchOverview(), fetchRequests(), fetchErrors(), fetchHealing()]);
    setLoading(false);
  }, [fetchOverview, fetchRequests, fetchErrors, fetchHealing]);

  // WebSocket connection for real-time updates
  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.hostname}:4000/debug/ws`;

    const connectWs = () => {
      const ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        console.log('Debug WebSocket connected');
        ws.send(JSON.stringify({ type: 'get_dashboard_state' }));
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'metrics_update' && autoRefresh) {
            fetchOverview();
          }
        } catch (err) {
          console.error('WebSocket message error:', err);
        }
      };

      ws.onerror = (err) => {
        console.error('WebSocket error:', err);
      };

      ws.onclose = () => {
        console.log('WebSocket disconnected, reconnecting in 5s...');
        setTimeout(connectWs, 5000);
      };

      wsRef.current = ws;
    };

    connectWs();

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [autoRefresh, fetchOverview]);

  useEffect(() => {
    fetchAll();
    const interval = autoRefresh ? setInterval(fetchAll, 10000) : null;
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [fetchAll, autoRefresh]);

  const triggerGC = async () => {
    try {
      const res = await apiFetch('/api/debug/gc', { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        alert(`GC completed! Freed: ${data.freed}`);
        fetchOverview();
      } else {
        alert(data.error || 'GC failed');
      }
    } catch (err) {
      alert('Failed to trigger GC');
    }
  };

  const triggerHealing = async () => {
    try {
      const res = await apiFetch('/api/debug/healing/run', { method: 'POST' });
      if (res.ok) {
        alert('Healing checks completed');
        fetchHealing();
      }
    } catch (err) {
      alert('Failed to trigger healing');
    }
  };

  const resolveError = async (id: string) => {
    try {
      const res = await apiFetch(`/api/debug/errors/${id}/resolve`, { method: 'POST' });
      if (res.ok) {
        fetchErrors();
      }
    } catch (err) {
      console.error('Failed to resolve error:', err);
    }
  };

  if (loading && !overview) {
    return (
      <div className="animate-pulse">
        <div className="h-8 bg-gray-200 rounded w-1/4 mb-6"></div>
        <div className="grid grid-cols-4 gap-4 mb-6">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-24 bg-gray-200 rounded"></div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="mb-6 flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Debug Console</h1>
          <p className="text-gray-600">Real-time system monitoring and diagnostics</p>
        </div>
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              className="rounded"
            />
            <span className="text-sm text-gray-600">Auto-refresh</span>
          </label>
          <button
            onClick={fetchAll}
            className="px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded text-sm"
          >
            Refresh
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200 mb-6">
        <nav className="flex space-x-8">
          {['overview', 'requests', 'errors', 'healing'].map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab as typeof activeTab)}
              className={`py-2 px-1 border-b-2 font-medium text-sm capitalize ${
                activeTab === tab
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {tab}
            </button>
          ))}
        </nav>
      </div>

      {/* Overview Tab */}
      {activeTab === 'overview' && overview && (
        <div className="space-y-6">
          {/* Main Status Indicator - Only shows REAL problems */}
          <SystemStatusIndicator
            status={
              !overview ? 'offline' :
              overview.requests.stats.errorRate > 20 ? 'critical' :
              overview.system.stressStatus.stressed ? 'critical' :
              overview.requests.stats.errorRate > 5 ? 'degraded' :
              'healthy'
            }
            title={
              !overview ? 'System Offline' :
              overview.requests.stats.errorRate > 20 ? 'High Error Rate' :
              overview.system.stressStatus.stressed ? 'System Issue' :
              overview.requests.stats.errorRate > 5 ? 'Some Errors' :
              'All Systems Operational'
            }
            subtitle={
              !overview ? 'Unable to connect to server' :
              overview.requests.stats.errorRate > 5 ? `${overview.requests.stats.errorRate.toFixed(1)}% of requests failing` :
              overview.system.stressStatus.stressed ? overview.system.stressStatus.reasons.join(', ') :
              `Uptime: ${formatDuration(overview.system.metrics.process.uptime)} | ${overview.requests.stats.requestsPerMinute.toFixed(0)} req/min | ${overview.requests.stats.avgResponseTime.toFixed(0)}ms avg`
            }
          />

          {/* System Status Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white rounded-lg shadow p-4">
              <h3 className="text-sm font-medium text-gray-500">CPU Usage</h3>
              <div className="mt-2 flex items-baseline">
                <span className="text-2xl font-bold text-gray-900">
                  {overview.system.metrics.cpu.usage.toFixed(1)}%
                </span>
                <span className="ml-2 text-sm text-gray-500">
                  ({overview.system.metrics.cpu.cores} cores)
                </span>
              </div>
              <div className="mt-2 h-2 bg-gray-200 rounded">
                <div
                  className={`h-2 rounded ${
                    overview.system.metrics.cpu.usage > 80 ? 'bg-red-500' : 'bg-green-500'
                  }`}
                  style={{ width: `${Math.min(100, overview.system.metrics.cpu.usage)}%` }}
                />
              </div>
            </div>

            <div className="bg-white rounded-lg shadow p-4">
              <h3 className="text-sm font-medium text-gray-500">App Memory</h3>
              <div className="mt-2 flex items-baseline">
                <span className="text-2xl font-bold text-gray-900">
                  {formatBytes(overview.system.metrics.memory.heapUsed)}
                </span>
                <span className="ml-2 text-xs text-gray-400">used</span>
              </div>
              <p className="text-sm text-gray-500">{overview.system.formatted.heapUsage}</p>
              <div className="mt-2 h-2 bg-gray-200 rounded">
                <div
                  className="h-2 rounded bg-blue-500"
                  style={{ width: `${Math.min(100, overview.system.metrics.memory.usagePercent)}%` }}
                />
              </div>
            </div>

            <div className="bg-white rounded-lg shadow p-4">
              <h3 className="text-sm font-medium text-gray-500">Heap Usage</h3>
              <div className="mt-2 flex items-baseline">
                <span className="text-2xl font-bold text-gray-900">
                  {overview.system.formatted.heapUsage}
                </span>
              </div>
              <p className="text-sm text-gray-500">
                {formatBytes(overview.system.metrics.memory.heapUsed)} used
              </p>
            </div>

            <div className="bg-white rounded-lg shadow p-4">
              <h3 className="text-sm font-medium text-gray-500">Uptime</h3>
              <div className="mt-2 flex items-baseline">
                <span className="text-2xl font-bold text-gray-900">
                  {formatDuration(overview.system.metrics.process.uptime)}
                </span>
              </div>
              <p className="text-sm text-gray-500">PID: {overview.system.metrics.process.pid}</p>
            </div>
          </div>

          {/* Event Loop & Stress Status */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-white rounded-lg shadow p-4">
              <h3 className="text-sm font-medium text-gray-500 mb-2">Event Loop</h3>
              <div className="flex items-center gap-2">
                <span className={`w-3 h-3 rounded-full ${
                  overview.system.metrics.eventLoop.isBlocked ? 'bg-red-500' : 'bg-green-500'
                }`} />
                <span className="text-lg font-medium">
                  {overview.system.metrics.eventLoop.latency.toFixed(1)}ms latency
                </span>
              </div>
              {overview.system.metrics.eventLoop.isBlocked && (
                <p className="mt-2 text-sm text-red-600">Event loop is blocked!</p>
              )}
            </div>

            <div className="bg-white rounded-lg shadow p-4">
              <h3 className="text-sm font-medium text-gray-500 mb-2">System Stress</h3>
              <div className="flex items-center gap-2">
                <span className={`w-3 h-3 rounded-full ${
                  overview.system.stressStatus.stressed ? 'bg-red-500' : 'bg-green-500'
                }`} />
                <span className="text-lg font-medium">
                  {overview.system.stressStatus.stressed ? 'Under Stress' : 'Normal'}
                </span>
              </div>
              {overview.system.stressStatus.reasons.length > 0 && (
                <ul className="mt-2 text-sm text-red-600">
                  {overview.system.stressStatus.reasons.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {/* Request Stats */}
          <div className="bg-white rounded-lg shadow p-4">
            <h3 className="text-sm font-medium text-gray-500 mb-4">Request Statistics (last 5 min)</h3>
            <div className="grid grid-cols-4 gap-4">
              <div>
                <p className="text-2xl font-bold">{overview.requests.stats.totalRequests}</p>
                <p className="text-sm text-gray-500">Total Requests</p>
              </div>
              <div>
                <p className="text-2xl font-bold">{overview.requests.stats.requestsPerMinute.toFixed(1)}</p>
                <p className="text-sm text-gray-500">Requests/min</p>
              </div>
              <div>
                <p className="text-2xl font-bold">{overview.requests.stats.avgResponseTime.toFixed(0)}ms</p>
                <p className="text-sm text-gray-500">Avg Response Time</p>
              </div>
              <div>
                <p className="text-2xl font-bold">{overview.requests.stats.errorRate.toFixed(1)}%</p>
                <p className="text-sm text-gray-500">Error Rate</p>
              </div>
            </div>
          </div>

          {/* Quick Actions */}
          <div className="bg-white rounded-lg shadow p-4">
            <h3 className="text-sm font-medium text-gray-500 mb-4">Quick Actions</h3>
            <div className="flex gap-4">
              <button
                onClick={triggerGC}
                className="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded"
              >
                Trigger GC
              </button>
              <button
                onClick={triggerHealing}
                className="px-4 py-2 bg-green-500 hover:bg-green-600 text-white rounded"
              >
                Run Healing Checks
              </button>
            </div>
          </div>

          {/* Active Issues */}
          {overview.healing.activeIssues.length > 0 && (
            <div className="bg-white rounded-lg shadow p-4">
              <h3 className="text-sm font-medium text-gray-500 mb-4">Active Health Issues</h3>
              <div className="space-y-2">
                {overview.healing.activeIssues.map((issue) => (
                  <div key={issue.id} className="flex items-center justify-between p-2 bg-gray-50 rounded">
                    <div className="flex items-center gap-2">
                      <StatusBadge status={issue.type} type="health" />
                      <span className="text-sm">{issue.message}</span>
                    </div>
                    {issue.autoHealable && (
                      <span className="text-xs text-blue-600">Auto-healable</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Requests Tab */}
      {activeTab === 'requests' && (
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Time</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Method</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Path</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Duration</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {requests.map((req) => (
                <tr key={req.id}>
                  <td className="px-4 py-2 text-sm text-gray-500">
                    {new Date(req.timestamp).toLocaleTimeString()}
                  </td>
                  <td className="px-4 py-2 text-sm font-medium">{req.method}</td>
                  <td className="px-4 py-2 text-sm text-gray-700 truncate max-w-xs">{req.path}</td>
                  <td className="px-4 py-2">
                    <span className={`px-2 py-1 rounded text-xs ${
                      req.statusCode < 400 ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                    }`}>
                      {req.statusCode}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-sm text-gray-500">{req.responseTime.toFixed(0)}ms</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Errors Tab */}
      {activeTab === 'errors' && (
        <div className="bg-white rounded-lg shadow overflow-hidden">
          {errors.length === 0 ? (
            <div className="p-8 text-center text-gray-500">No unresolved errors</div>
          ) : (
            <div className="divide-y divide-gray-200">
              {errors.map((err) => (
                <div key={err.id} className="p-4">
                  <div className="flex justify-between items-start">
                    <div>
                      <div className="flex items-center gap-2">
                        <StatusBadge status={err.type} />
                        <span className="font-medium">{err.message}</span>
                      </div>
                      <p className="text-sm text-gray-500 mt-1">
                        {err.occurrences} occurrences | Last: {new Date(err.timestamp).toLocaleString()}
                      </p>
                    </div>
                    <button
                      onClick={() => resolveError(err.id)}
                      className="px-3 py-1 bg-gray-100 hover:bg-gray-200 rounded text-sm"
                    >
                      Resolve
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Healing Tab */}
      {activeTab === 'healing' && (
        <div className="space-y-6">
          {/* Circuit Breakers */}
          <div className="bg-white rounded-lg shadow p-4">
            <h3 className="text-sm font-medium text-gray-500 mb-4">Circuit Breakers</h3>
            {circuitBreakers.length === 0 ? (
              <p className="text-gray-500">No circuit breakers registered</p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {circuitBreakers.map((cb) => (
                  <div key={cb.name} className="p-3 bg-gray-50 rounded">
                    <div className="flex justify-between items-center">
                      <span className="font-medium">{cb.name}</span>
                      <StatusBadge status={cb.state} type="circuit" />
                    </div>
                    <div className="mt-2 text-sm text-gray-500">
                      Failures: {cb.failures} | Successes: {cb.successes}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Healing Actions */}
          <div className="bg-white rounded-lg shadow p-4">
            <h3 className="text-sm font-medium text-gray-500 mb-4">Recent Healing Actions</h3>
            {healingActions.length === 0 ? (
              <p className="text-gray-500">No healing actions recorded</p>
            ) : (
              <div className="space-y-2">
                {healingActions.map((action) => (
                  <div key={action.id} className="p-3 bg-gray-50 rounded">
                    <div className="flex justify-between items-start">
                      <div>
                        <div className="flex items-center gap-2">
                          <StatusBadge status={action.status} type="action" />
                          <span className="font-medium">{action.action}</span>
                        </div>
                        <p className="text-sm text-gray-500 mt-1">Problem: {action.problem}</p>
                        {action.result && (
                          <p className="text-sm text-gray-600 mt-1">Result: {action.result}</p>
                        )}
                      </div>
                      <span className="text-xs text-gray-400">
                        {new Date(action.timestamp).toLocaleTimeString()}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
