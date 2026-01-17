import React, { useState, useEffect, useCallback, useRef } from 'react';
import { apiFetch } from '../utils/api';
import SystemStatusIndicator from '../components/SystemStatusIndicator';
import {
  WrenchScrewdriverIcon,
  CpuChipIcon,
  ServerStackIcon,
  ClockIcon,
  ArrowPathIcon,
  BoltIcon,
  ShieldCheckIcon,
  ExclamationTriangleIcon,
  CheckCircleIcon,
  XCircleIcon,
  ChartBarIcon,
  SignalIcon,
  BeakerIcon,
  PlayIcon,
  SparklesIcon,
  CircleStackIcon,
  KeyIcon,
  CloudIcon,
  GlobeAltIcon,
  Cog6ToothIcon,
  DocumentMagnifyingGlassIcon,
} from '@heroicons/react/24/outline';

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

interface DiagnosticTest {
  id: string;
  name: string;
  category: 'database' | 'auth' | 'services' | 'scraping' | 'ai' | 'system';
  description: string;
  status: 'pending' | 'running' | 'passed' | 'failed' | 'fixed' | 'skipped';
  message?: string;
  duration?: number;
  autoFixable: boolean;
  fixAttempted?: boolean;
  fixResult?: string;
}

interface DiagnosticResult {
  id: string;
  startedAt: string;
  completedAt?: string;
  totalTests: number;
  passed: number;
  failed: number;
  fixed: number;
  skipped: number;
  tests: DiagnosticTest[];
  overallStatus: 'running' | 'healthy' | 'degraded' | 'critical';
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

// Circular Progress Component
const CircularProgress: React.FC<{
  value: number;
  max: number;
  label: string;
  color: string;
  size?: number;
}> = ({ value, max, label, color, size = 100 }) => {
  const percentage = Math.min(100, (value / max) * 100);
  const circumference = 2 * Math.PI * 40;
  const offset = circumference - (percentage / 100) * circumference;

  return (
    <div className="flex flex-col items-center">
      <div className="relative" style={{ width: size, height: size }}>
        <svg className="w-full h-full transform -rotate-90" viewBox="0 0 100 100">
          <circle
            cx="50" cy="50" r="40"
            fill="none"
            stroke="#E2E8F0"
            strokeWidth="8"
          />
          <circle
            cx="50" cy="50" r="40"
            fill="none"
            stroke={color}
            strokeWidth="8"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            className="transition-all duration-1000"
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-xl font-semibold text-slate-900">{percentage.toFixed(0)}%</span>
        </div>
      </div>
      <p className="text-sm text-slate-500 mt-2">{label}</p>
    </div>
  );
};

// Metric Card Component
const MetricCard: React.FC<{
  title: string;
  value: string | number;
  subtitle?: string;
  icon: React.ComponentType<{ className?: string }>;
  status?: 'good' | 'warning' | 'critical';
}> = ({ title, value, subtitle, icon: Icon, status }) => (
  <div className="bg-white border border-slate-200 rounded-xl p-5 transition-colors hover:border-slate-300">
    <div className="flex items-start justify-between">
      <div className="flex-1">
        <p className="text-sm text-slate-500 font-medium">{title}</p>
        <p className={`text-2xl font-semibold mt-1 ${
          status === 'critical' ? 'text-red-600' :
          status === 'warning' ? 'text-amber-600' :
          'text-slate-900'
        }`}>
          {value}
        </p>
        {subtitle && (
          <p className="text-xs text-slate-400 mt-1">{subtitle}</p>
        )}
      </div>
      <div className="w-10 h-10 rounded-lg bg-slate-100 flex items-center justify-center">
        <Icon className="w-5 h-5 text-slate-600" />
      </div>
    </div>
    {status && (
      <div className={`mt-3 w-2 h-2 rounded-full ${
        status === 'critical' ? 'bg-red-500 animate-pulse' :
        status === 'warning' ? 'bg-amber-500' :
        'bg-emerald-500'
      }`} />
    )}
  </div>
);

// Status Badge with Icon
const StatusBadge: React.FC<{ status: string; type?: 'health' | 'circuit' | 'action' }> = ({ status, type }) => {
  const getStyle = () => {
    if (type === 'circuit') {
      switch (status) {
        case 'closed': return { bg: 'bg-emerald-50', text: 'text-emerald-700', icon: CheckCircleIcon };
        case 'open': return { bg: 'bg-red-50', text: 'text-red-700', icon: XCircleIcon };
        case 'half_open': return { bg: 'bg-amber-50', text: 'text-amber-700', icon: ExclamationTriangleIcon };
        default: return { bg: 'bg-slate-100', text: 'text-slate-600', icon: SignalIcon };
      }
    }
    if (type === 'action') {
      switch (status) {
        case 'success': return { bg: 'bg-emerald-50', text: 'text-emerald-700', icon: CheckCircleIcon };
        case 'failed': return { bg: 'bg-red-50', text: 'text-red-700', icon: XCircleIcon };
        case 'executing': return { bg: 'bg-slate-100', text: 'text-slate-700', icon: ArrowPathIcon };
        case 'pending': return { bg: 'bg-slate-100', text: 'text-slate-600', icon: ClockIcon };
        default: return { bg: 'bg-slate-100', text: 'text-slate-600', icon: SignalIcon };
      }
    }
    switch (status) {
      case 'critical': return { bg: 'bg-red-50', text: 'text-red-700', icon: XCircleIcon };
      case 'warning': return { bg: 'bg-amber-50', text: 'text-amber-700', icon: ExclamationTriangleIcon };
      case 'info': return { bg: 'bg-slate-100', text: 'text-slate-700', icon: SignalIcon };
      default: return { bg: 'bg-slate-100', text: 'text-slate-600', icon: SignalIcon };
    }
  };

  const style = getStyle();
  const Icon = style.icon;

  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium ${style.bg} ${style.text}`}>
      <Icon className="w-3.5 h-3.5" />
      {status}
    </span>
  );
};

// Tab Button Component
const TabButton: React.FC<{
  active: boolean;
  onClick: () => void;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  count?: number;
}> = ({ active, onClick, icon: Icon, label, count }) => (
  <button
    onClick={onClick}
    className={`flex items-center gap-2 px-4 py-2.5 rounded-lg font-medium text-sm transition-all ${
      active
        ? 'bg-slate-900 text-white'
        : 'bg-white text-slate-600 hover:bg-slate-50 border border-slate-200'
    }`}
  >
    <Icon className="w-4 h-4" />
    {label}
    {count !== undefined && count > 0 && (
      <span className={`px-1.5 py-0.5 rounded text-xs ${
        active ? 'bg-white/20' : 'bg-slate-100'
      }`}>
        {count}
      </span>
    )}
  </button>
);

export default function DebugPage() {
  const [overview, setOverview] = useState<DebugOverview | null>(null);
  const [requests, setRequests] = useState<RequestLog[]>([]);
  const [errors, setErrors] = useState<ErrorLog[]>([]);
  const [healingActions, setHealingActions] = useState<HealingAction[]>([]);
  const [circuitBreakers, setCircuitBreakers] = useState<CircuitBreaker[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'overview' | 'requests' | 'errors' | 'healing' | 'diagnostics'>('overview');
  const [autoRefresh, setAutoRefresh] = useState(true);
  const wsRef = useRef<WebSocket | null>(null);
  const [diagnosticResult, setDiagnosticResult] = useState<DiagnosticResult | null>(null);
  const [isDiagnosticRunning, setIsDiagnosticRunning] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);

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

  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.hostname}:4000/debug/ws`;

    const connectWs = () => {
      const ws = new WebSocket(wsUrl);

      ws.onopen = () => {
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

      ws.onclose = () => {
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

  const runDiagnostics = () => {
    if (isDiagnosticRunning) return;

    // Close any existing event source
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    setIsDiagnosticRunning(true);
    setDiagnosticResult(null);

    // Create EventSource for SSE
    const eventSource = new EventSource(`http://${window.location.hostname}:4000/api/debug/diagnostics/stream`);
    eventSourceRef.current = eventSource;

    eventSource.addEventListener('progress', (event) => {
      const data = JSON.parse(event.data);
      setDiagnosticResult(data);
    });

    eventSource.addEventListener('complete', (event) => {
      const data = JSON.parse(event.data);
      setDiagnosticResult(data);
      setIsDiagnosticRunning(false);
      eventSource.close();
    });

    eventSource.addEventListener('error', (event) => {
      console.error('Diagnostic SSE error:', event);
      setIsDiagnosticRunning(false);
      eventSource.close();
    });

    eventSource.onerror = () => {
      setIsDiagnosticRunning(false);
      eventSource.close();
    };
  };

  // Cleanup event source on unmount
  useEffect(() => {
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
    };
  }, []);

  // Fetch last diagnostic result on mount
  useEffect(() => {
    const fetchLastDiagnostic = async () => {
      try {
        const res = await apiFetch('/api/debug/diagnostics');
        if (res.ok) {
          const data = await res.json();
          if (data.hasResult) {
            setDiagnosticResult(data.result);
          }
        }
      } catch (err) {
        console.error('Failed to fetch diagnostic result:', err);
      }
    };
    fetchLastDiagnostic();
  }, []);

  if (loading && !overview) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-xl bg-slate-200" />
          <div className="space-y-2">
            <div className="h-8 w-48 bg-slate-200 rounded-lg" />
            <div className="h-4 w-64 bg-slate-100 rounded" />
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-28 bg-slate-200 rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-slide-up">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Debug Console</h1>
          <p className="text-slate-500 text-sm mt-0.5">Real-time monitoring and diagnostics</p>
        </div>

        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 px-4 py-2 bg-white rounded-lg border border-slate-200 cursor-pointer hover:bg-slate-50 transition-colors">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              className="rounded text-slate-600"
            />
            <span className="text-sm text-slate-600">Auto-refresh</span>
            {autoRefresh && <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />}
          </label>
          <button
            onClick={fetchAll}
            className="btn-secondary"
          >
            <ArrowPathIcon className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* Main Status Indicator */}
      {overview && (
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
      )}

      {/* Tabs */}
      <div className="flex flex-wrap gap-2">
        <TabButton
          active={activeTab === 'overview'}
          onClick={() => setActiveTab('overview')}
          icon={ChartBarIcon}
          label="Overview"
        />
        <TabButton
          active={activeTab === 'requests'}
          onClick={() => setActiveTab('requests')}
          icon={SignalIcon}
          label="Requests"
          count={requests.length}
        />
        <TabButton
          active={activeTab === 'errors'}
          onClick={() => setActiveTab('errors')}
          icon={ExclamationTriangleIcon}
          label="Errors"
          count={errors.length}
        />
        <TabButton
          active={activeTab === 'healing'}
          onClick={() => setActiveTab('healing')}
          icon={ShieldCheckIcon}
          label="Self-Healing"
        />
        <TabButton
          active={activeTab === 'diagnostics'}
          onClick={() => setActiveTab('diagnostics')}
          icon={SparklesIcon}
          label="Diagnostics"
        />
      </div>

      {/* Overview Tab */}
      {activeTab === 'overview' && overview && (
        <div className="space-y-6">
          {/* Metric Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <MetricCard
              title="CPU Usage"
              value={`${overview.system.metrics.cpu.usage.toFixed(1)}%`}
              subtitle={`${overview.system.metrics.cpu.cores} cores`}
              icon={CpuChipIcon}
              status={overview.system.metrics.cpu.usage > 80 ? 'critical' : overview.system.metrics.cpu.usage > 60 ? 'warning' : 'good'}
            />
            <MetricCard
              title="Memory Used"
              value={formatBytes(overview.system.metrics.memory.heapUsed)}
              subtitle={overview.system.formatted.heapUsage}
              icon={ServerStackIcon}
              status="good"
            />
            <MetricCard
              title="Event Loop"
              value={`${overview.system.metrics.eventLoop.latency.toFixed(1)}ms`}
              subtitle={overview.system.metrics.eventLoop.isBlocked ? 'Blocked!' : 'Running smoothly'}
              icon={BoltIcon}
              status={overview.system.metrics.eventLoop.isBlocked ? 'critical' : 'good'}
            />
            <MetricCard
              title="Uptime"
              value={formatDuration(overview.system.metrics.process.uptime)}
              subtitle={`PID: ${overview.system.metrics.process.pid}`}
              icon={ClockIcon}
              status="good"
            />
          </div>

          {/* Circular Progress Charts */}
          <div className="bg-white border border-slate-200 rounded-xl p-6 transition-colors hover:border-slate-300">
            <h3 className="text-lg font-semibold text-slate-900 mb-6">System Resources</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
              <CircularProgress
                value={overview.system.metrics.cpu.usage}
                max={100}
                label="CPU Usage"
                color="#475569"
              />
              <CircularProgress
                value={overview.system.metrics.memory.usagePercent}
                max={100}
                label="Memory Usage"
                color="#475569"
              />
              <CircularProgress
                value={100 - overview.requests.stats.errorRate}
                max={100}
                label="Success Rate"
                color="#10B981"
              />
              <CircularProgress
                value={Math.min(100, (overview.requests.stats.requestsPerMinute / 100) * 100)}
                max={100}
                label="Request Load"
                color="#475569"
              />
            </div>
          </div>

          {/* Request Statistics */}
          <div className="bg-white border border-slate-200 rounded-xl p-6 transition-colors hover:border-slate-300">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-lg bg-slate-100 flex items-center justify-center">
                <ChartBarIcon className="w-5 h-5 text-slate-600" />
              </div>
              <h3 className="text-lg font-semibold text-slate-900">Request Statistics</h3>
              <span className="text-sm text-slate-400">(last 5 minutes)</span>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="p-4 bg-slate-50 rounded-lg border border-slate-100">
                <p className="text-3xl font-semibold text-slate-900">{overview.requests.stats.totalRequests}</p>
                <p className="text-sm text-slate-500 mt-1">Total Requests</p>
              </div>
              <div className="p-4 bg-slate-50 rounded-lg border border-slate-100">
                <p className="text-3xl font-semibold text-slate-900">{overview.requests.stats.requestsPerMinute.toFixed(1)}</p>
                <p className="text-sm text-slate-500 mt-1">Requests/min</p>
              </div>
              <div className="p-4 bg-slate-50 rounded-lg border border-slate-100">
                <p className="text-3xl font-semibold text-slate-900">{overview.requests.stats.avgResponseTime.toFixed(0)}ms</p>
                <p className="text-sm text-slate-500 mt-1">Avg Response</p>
              </div>
              <div className={`p-4 rounded-lg border ${
                overview.requests.stats.errorRate > 5
                  ? 'bg-red-50 border-red-100'
                  : 'bg-slate-50 border-slate-100'
              }`}>
                <p className={`text-3xl font-semibold ${
                  overview.requests.stats.errorRate > 5 ? 'text-red-600' : 'text-slate-900'
                }`}>{overview.requests.stats.errorRate.toFixed(1)}%</p>
                <p className="text-sm text-slate-500 mt-1">Error Rate</p>
              </div>
            </div>
          </div>

          {/* Quick Actions */}
          <div className="bg-white border border-slate-200 rounded-xl p-6 transition-colors hover:border-slate-300">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-lg bg-slate-100 flex items-center justify-center">
                <BeakerIcon className="w-5 h-5 text-slate-600" />
              </div>
              <h3 className="text-lg font-semibold text-slate-900">Quick Actions</h3>
            </div>
            <div className="flex flex-wrap gap-4">
              <button
                onClick={triggerGC}
                className="flex items-center gap-2 px-5 py-2.5 bg-slate-900 text-white rounded-lg font-medium hover:bg-slate-800 transition-colors"
              >
                <ServerStackIcon className="w-5 h-5" />
                Trigger GC
              </button>
              <button
                onClick={triggerHealing}
                className="flex items-center gap-2 px-5 py-2.5 bg-emerald-600 text-white rounded-lg font-medium hover:bg-emerald-700 transition-colors"
              >
                <ShieldCheckIcon className="w-5 h-5" />
                Run Healing Checks
              </button>
            </div>
          </div>

          {/* Active Issues */}
          {overview.healing.activeIssues.length > 0 && (
            <div className="bg-white border border-slate-200 rounded-xl p-6 border-l-4 border-l-amber-500 transition-colors hover:border-slate-300">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-lg bg-amber-50 flex items-center justify-center">
                  <ExclamationTriangleIcon className="w-5 h-5 text-amber-600" />
                </div>
                <h3 className="text-lg font-semibold text-slate-900">Active Health Issues</h3>
              </div>
              <div className="space-y-3">
                {overview.healing.activeIssues.map((issue) => (
                  <div key={issue.id} className="flex items-center justify-between p-4 bg-slate-50 rounded-lg">
                    <div className="flex items-center gap-3">
                      <StatusBadge status={issue.type} type="health" />
                      <span className="text-sm text-slate-700">{issue.message}</span>
                    </div>
                    {issue.autoHealable && (
                      <span className="text-xs text-slate-600 bg-slate-200 px-2 py-1 rounded">Auto-healable</span>
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
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="px-6 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Time</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Method</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Path</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Status</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Duration</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {requests.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-6 py-16 text-center">
                      <div className="flex flex-col items-center gap-4">
                        <div className="w-16 h-16 rounded-full bg-slate-100 flex items-center justify-center">
                          <SignalIcon className="w-8 h-8 text-slate-400" />
                        </div>
                        <p className="text-slate-600 font-medium">No requests logged yet</p>
                      </div>
                    </td>
                  </tr>
                ) : (
                  requests.map((req) => (
                    <tr key={req.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-6 py-4 text-sm text-slate-500 font-mono">
                        {new Date(req.timestamp).toLocaleTimeString()}
                      </td>
                      <td className="px-6 py-4">
                        <span className={`px-2 py-1 rounded text-xs font-medium ${
                          req.method === 'GET' ? 'bg-slate-100 text-slate-700' :
                          req.method === 'POST' ? 'bg-emerald-50 text-emerald-700' :
                          req.method === 'PUT' ? 'bg-amber-50 text-amber-700' :
                          req.method === 'DELETE' ? 'bg-red-50 text-red-700' :
                          'bg-slate-100 text-slate-700'
                        }`}>
                          {req.method}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-sm text-slate-700 truncate max-w-xs font-mono">
                        {req.path}
                      </td>
                      <td className="px-6 py-4">
                        <span className={`px-2 py-1 rounded text-xs font-medium ${
                          req.statusCode < 400 ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'
                        }`}>
                          {req.statusCode}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-sm text-slate-500">
                        {req.responseTime.toFixed(0)}ms
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Errors Tab */}
      {activeTab === 'errors' && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          {errors.length === 0 ? (
            <div className="p-12 text-center">
              <div className="flex flex-col items-center gap-4">
                <div className="w-16 h-16 rounded-full bg-emerald-50 flex items-center justify-center">
                  <CheckCircleIcon className="w-8 h-8 text-emerald-500" />
                </div>
                <div>
                  <p className="text-slate-700 font-medium">No Unresolved Errors</p>
                  <p className="text-slate-400 text-sm mt-1">All systems running smoothly</p>
                </div>
              </div>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {errors.map((err) => (
                <div key={err.id} className="p-5 hover:bg-slate-50 transition-colors">
                  <div className="flex justify-between items-start">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <StatusBadge status={err.type} />
                        <span className="font-medium text-slate-900">{err.message}</span>
                      </div>
                      <p className="text-sm text-slate-500">
                        <span className="bg-slate-100 px-2 py-0.5 rounded">{err.occurrences} occurrences</span>
                        <span className="mx-2">|</span>
                        Last: {new Date(err.timestamp).toLocaleString()}
                      </p>
                    </div>
                    <button
                      onClick={() => resolveError(err.id)}
                      className="px-4 py-2 bg-slate-100 hover:bg-slate-200 rounded-lg text-sm font-medium transition-colors"
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
          <div className="bg-white border border-slate-200 rounded-xl p-6 transition-colors hover:border-slate-300">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-lg bg-slate-100 flex items-center justify-center">
                <BoltIcon className="w-5 h-5 text-slate-600" />
              </div>
              <h3 className="text-lg font-semibold text-slate-900">Circuit Breakers</h3>
            </div>
            {circuitBreakers.length === 0 ? (
              <p className="text-slate-500 text-center py-8">No circuit breakers registered</p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {circuitBreakers.map((cb) => (
                  <div key={cb.name} className="p-4 bg-slate-50 rounded-lg border border-slate-100">
                    <div className="flex justify-between items-center mb-3">
                      <span className="font-medium text-slate-900">{cb.name}</span>
                      <StatusBadge status={cb.state} type="circuit" />
                    </div>
                    <div className="flex gap-4 text-sm">
                      <div>
                        <span className="text-slate-500">Failures:</span>
                        <span className="ml-1 font-medium text-red-600">{cb.failures}</span>
                      </div>
                      <div>
                        <span className="text-slate-500">Successes:</span>
                        <span className="ml-1 font-medium text-emerald-600">{cb.successes}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Healing Actions */}
          <div className="bg-white border border-slate-200 rounded-xl p-6 transition-colors hover:border-slate-300">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-lg bg-slate-100 flex items-center justify-center">
                <ShieldCheckIcon className="w-5 h-5 text-slate-600" />
              </div>
              <h3 className="text-lg font-semibold text-slate-900">Recent Healing Actions</h3>
            </div>
            {healingActions.length === 0 ? (
              <p className="text-slate-500 text-center py-8">No healing actions recorded</p>
            ) : (
              <div className="space-y-3">
                {healingActions.map((action) => (
                  <div key={action.id} className="p-4 bg-slate-50 rounded-lg border border-slate-100">
                    <div className="flex justify-between items-start">
                      <div className="flex-1">
                        <div className="flex items-center gap-3 mb-2">
                          <StatusBadge status={action.status} type="action" />
                          <span className="font-medium text-slate-900">{action.action}</span>
                        </div>
                        <p className="text-sm text-slate-500">Problem: {action.problem}</p>
                        {action.result && (
                          <p className="text-sm text-slate-600 mt-1 bg-white px-2 py-1 rounded">
                            Result: {action.result}
                          </p>
                        )}
                      </div>
                      <span className="text-xs text-slate-400 font-mono">
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

      {/* Diagnostics Tab */}
      {activeTab === 'diagnostics' && (
        <div className="space-y-6">
          {/* Run Diagnostics Hero Section */}
          <div className="relative overflow-hidden bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 rounded-2xl p-8">
            {/* Animated background effect */}
            <div className="absolute inset-0 opacity-20">
              <div className="absolute top-0 left-0 w-72 h-72 bg-emerald-500 rounded-full blur-3xl animate-pulse" />
              <div className="absolute bottom-0 right-0 w-96 h-96 bg-blue-500 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '1s' }} />
            </div>

            <div className="relative z-10 flex flex-col md:flex-row items-center justify-between gap-6">
              <div className="flex-1 text-center md:text-left">
                <div className="flex items-center gap-3 justify-center md:justify-start mb-3">
                  <div className="w-12 h-12 rounded-xl bg-white/10 backdrop-blur flex items-center justify-center">
                    <SparklesIcon className="w-6 h-6 text-emerald-400" />
                  </div>
                  <h2 className="text-2xl font-bold text-white">System Diagnostics</h2>
                </div>
                <p className="text-slate-300 max-w-lg">
                  Run comprehensive tests across all system components. Auto-fix capable issues are repaired automatically during the scan.
                </p>
              </div>

              <button
                onClick={runDiagnostics}
                disabled={isDiagnosticRunning}
                className={`group relative flex items-center gap-3 px-8 py-4 rounded-xl font-semibold text-lg transition-all transform hover:scale-105 ${
                  isDiagnosticRunning
                    ? 'bg-slate-700 text-slate-400 cursor-not-allowed'
                    : 'bg-gradient-to-r from-emerald-500 to-emerald-600 text-white shadow-lg shadow-emerald-500/30 hover:shadow-emerald-500/50'
                }`}
              >
                {isDiagnosticRunning ? (
                  <>
                    <ArrowPathIcon className="w-6 h-6 animate-spin" />
                    Running Tests...
                  </>
                ) : (
                  <>
                    <PlayIcon className="w-6 h-6 group-hover:scale-110 transition-transform" />
                    Run Full Diagnostics
                  </>
                )}
              </button>
            </div>

            {/* Overall Status Indicator */}
            {diagnosticResult && (
              <div className="relative z-10 mt-6 pt-6 border-t border-white/10">
                <div className="flex flex-wrap items-center justify-center gap-6">
                  <div className={`flex items-center gap-2 px-4 py-2 rounded-lg ${
                    diagnosticResult.overallStatus === 'healthy' ? 'bg-emerald-500/20 text-emerald-400' :
                    diagnosticResult.overallStatus === 'degraded' ? 'bg-amber-500/20 text-amber-400' :
                    diagnosticResult.overallStatus === 'critical' ? 'bg-red-500/20 text-red-400' :
                    'bg-slate-500/20 text-slate-400'
                  }`}>
                    {diagnosticResult.overallStatus === 'healthy' && <CheckCircleIcon className="w-5 h-5" />}
                    {diagnosticResult.overallStatus === 'degraded' && <ExclamationTriangleIcon className="w-5 h-5" />}
                    {diagnosticResult.overallStatus === 'critical' && <XCircleIcon className="w-5 h-5" />}
                    {diagnosticResult.overallStatus === 'running' && <ArrowPathIcon className="w-5 h-5 animate-spin" />}
                    <span className="font-semibold capitalize">{diagnosticResult.overallStatus}</span>
                  </div>

                  <div className="flex items-center gap-4 text-sm">
                    <span className="text-emerald-400">
                      <CheckCircleIcon className="w-4 h-4 inline mr-1" />
                      {diagnosticResult.passed} Passed
                    </span>
                    {diagnosticResult.fixed > 0 && (
                      <span className="text-blue-400">
                        <WrenchScrewdriverIcon className="w-4 h-4 inline mr-1" />
                        {diagnosticResult.fixed} Fixed
                      </span>
                    )}
                    {diagnosticResult.failed > 0 && (
                      <span className="text-red-400">
                        <XCircleIcon className="w-4 h-4 inline mr-1" />
                        {diagnosticResult.failed} Failed
                      </span>
                    )}
                    {diagnosticResult.skipped > 0 && (
                      <span className="text-slate-400">
                        {diagnosticResult.skipped} Skipped
                      </span>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Diagnostic Test Results Grid */}
          {diagnosticResult && diagnosticResult.tests.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {diagnosticResult.tests.map((test, index) => {
                const getCategoryIcon = (category: string) => {
                  switch (category) {
                    case 'database': return CircleStackIcon;
                    case 'auth': return KeyIcon;
                    case 'services': return CloudIcon;
                    case 'scraping': return GlobeAltIcon;
                    case 'ai': return SparklesIcon;
                    case 'system': return Cog6ToothIcon;
                    default: return BeakerIcon;
                  }
                };

                const CategoryIcon = getCategoryIcon(test.category);

                return (
                  <div
                    key={test.id}
                    className={`relative overflow-hidden bg-white border rounded-xl p-5 transition-all duration-500 ${
                      test.status === 'running' ? 'border-blue-300 shadow-lg shadow-blue-100 animate-pulse' :
                      test.status === 'passed' ? 'border-emerald-200 hover:border-emerald-300' :
                      test.status === 'fixed' ? 'border-blue-200 hover:border-blue-300' :
                      test.status === 'failed' ? 'border-red-200 hover:border-red-300' :
                      test.status === 'skipped' ? 'border-slate-200' :
                      'border-slate-200'
                    }`}
                    style={{
                      animationDelay: `${index * 50}ms`,
                    }}
                  >
                    {/* Status Progress Bar */}
                    <div className={`absolute top-0 left-0 right-0 h-1 transition-all ${
                      test.status === 'running' ? 'bg-blue-500' :
                      test.status === 'passed' ? 'bg-emerald-500' :
                      test.status === 'fixed' ? 'bg-blue-500' :
                      test.status === 'failed' ? 'bg-red-500' :
                      test.status === 'skipped' ? 'bg-slate-300' :
                      'bg-slate-200'
                    }`} />

                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center gap-3">
                        <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                          test.status === 'running' ? 'bg-blue-50 text-blue-600' :
                          test.status === 'passed' ? 'bg-emerald-50 text-emerald-600' :
                          test.status === 'fixed' ? 'bg-blue-50 text-blue-600' :
                          test.status === 'failed' ? 'bg-red-50 text-red-600' :
                          'bg-slate-100 text-slate-500'
                        }`}>
                          <CategoryIcon className="w-5 h-5" />
                        </div>
                        <div>
                          <h4 className="font-semibold text-slate-900">{test.name}</h4>
                          <p className="text-xs text-slate-400 capitalize">{test.category}</p>
                        </div>
                      </div>

                      {/* Status Icon */}
                      <div className={`flex items-center justify-center w-8 h-8 rounded-full ${
                        test.status === 'running' ? 'bg-blue-100' :
                        test.status === 'passed' ? 'bg-emerald-100' :
                        test.status === 'fixed' ? 'bg-blue-100' :
                        test.status === 'failed' ? 'bg-red-100' :
                        test.status === 'skipped' ? 'bg-slate-100' :
                        'bg-slate-100'
                      }`}>
                        {test.status === 'running' && (
                          <ArrowPathIcon className="w-4 h-4 text-blue-600 animate-spin" />
                        )}
                        {test.status === 'passed' && (
                          <CheckCircleIcon className="w-5 h-5 text-emerald-600" />
                        )}
                        {test.status === 'fixed' && (
                          <WrenchScrewdriverIcon className="w-4 h-4 text-blue-600" />
                        )}
                        {test.status === 'failed' && (
                          <XCircleIcon className="w-5 h-5 text-red-600" />
                        )}
                        {test.status === 'skipped' && (
                          <div className="w-2 h-2 rounded-full bg-slate-400" />
                        )}
                        {test.status === 'pending' && (
                          <ClockIcon className="w-4 h-4 text-slate-400" />
                        )}
                      </div>
                    </div>

                    <p className="text-sm text-slate-500 mb-3">{test.description}</p>

                    {/* Result Message */}
                    {test.message && (
                      <div className={`text-sm p-3 rounded-lg ${
                        test.status === 'passed' ? 'bg-emerald-50 text-emerald-700' :
                        test.status === 'fixed' ? 'bg-blue-50 text-blue-700' :
                        test.status === 'failed' ? 'bg-red-50 text-red-700' :
                        test.status === 'skipped' ? 'bg-slate-50 text-slate-600' :
                        'bg-slate-50 text-slate-600'
                      }`}>
                        {test.message}
                      </div>
                    )}

                    {/* Fix Result */}
                    {test.fixAttempted && test.fixResult && (
                      <div className="mt-2 text-xs p-2 bg-blue-50 text-blue-700 rounded-lg border border-blue-100">
                        <span className="font-medium">Auto-fix: </span>{test.fixResult}
                      </div>
                    )}

                    {/* Duration */}
                    {test.duration !== undefined && (
                      <div className="mt-3 flex items-center justify-between text-xs text-slate-400">
                        <span className="flex items-center gap-1">
                          <ClockIcon className="w-3 h-3" />
                          {test.duration}ms
                        </span>
                        {test.autoFixable && (
                          <span className="flex items-center gap-1 text-blue-500">
                            <WrenchScrewdriverIcon className="w-3 h-3" />
                            Auto-fixable
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Empty State */}
          {!diagnosticResult && (
            <div className="bg-white border border-slate-200 rounded-xl p-12 text-center">
              <div className="flex flex-col items-center gap-4">
                <div className="w-20 h-20 rounded-full bg-slate-100 flex items-center justify-center">
                  <DocumentMagnifyingGlassIcon className="w-10 h-10 text-slate-400" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-slate-900">No Diagnostics Run Yet</h3>
                  <p className="text-slate-500 mt-1 max-w-md">
                    Click the "Run Full Diagnostics" button above to start a comprehensive system health check.
                    Tests will run automatically and any fixable issues will be repaired.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Last Run Info */}
          {diagnosticResult && diagnosticResult.completedAt && (
            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <div className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2 text-slate-500">
                  <ClockIcon className="w-4 h-4" />
                  <span>Last run: {new Date(diagnosticResult.completedAt).toLocaleString()}</span>
                </div>
                <div className="text-slate-400 font-mono text-xs">
                  ID: {diagnosticResult.id}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
