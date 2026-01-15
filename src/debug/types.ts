/**
 * Advanced Debugging System - Type Definitions
 * Comprehensive types for the debugging, monitoring, and self-healing system
 */

// System Metrics
export interface SystemMetrics {
  timestamp: string;
  cpu: {
    usage: number;
    cores: number;
    loadAverage: number[];
  };
  memory: {
    total: number;
    used: number;
    free: number;
    heapUsed: number;
    heapTotal: number;
    external: number;
    rss: number;
    usagePercent: number;
  };
  process: {
    pid: number;
    uptime: number;
    version: string;
    platform: string;
    arch: string;
  };
  eventLoop: {
    latency: number;
    isBlocked: boolean;
  };
}

// Request/Response Tracking
export interface RequestLog {
  id: string;
  timestamp: string;
  method: string;
  path: string;
  statusCode: number;
  responseTime: number;
  userAgent?: string;
  ip?: string;
  query?: Record<string, string>;
  body?: unknown;
  error?: string;
}

// Error Tracking
export interface ErrorLog {
  id: string;
  timestamp: string;
  type: 'uncaught' | 'unhandled' | 'api' | 'database' | 'scraper' | 'ai' | 'messenger' | 'session';
  message: string;
  stack?: string;
  context?: Record<string, unknown>;
  resolved: boolean;
  resolvedAt?: string;
  resolutionMethod?: string;
  occurrences: number;
  lastOccurrence: string;
}

// Cron Job Monitoring
export interface CronJobStatus {
  name: string;
  schedule: string;
  lastRun?: string;
  nextRun?: string;
  lastDuration?: number;
  lastStatus: 'success' | 'failed' | 'running' | 'never_run';
  lastError?: string;
  runCount: number;
  failCount: number;
  averageDuration: number;
  isLocked: boolean;
}

// Database Query Profiling
export interface QueryProfile {
  id: string;
  timestamp: string;
  query: string;
  duration: number;
  rowsAffected?: number;
  model?: string;
  operation: 'select' | 'insert' | 'update' | 'delete' | 'raw';
  slow: boolean;
}

// Self-Healing Actions
export interface HealingAction {
  id: string;
  timestamp: string;
  problem: string;
  action: string;
  status: 'pending' | 'executing' | 'success' | 'failed';
  result?: string;
  automatic: boolean;
  duration?: number;
}

// Health Issue Detection
export interface HealthIssue {
  id: string;
  type: 'critical' | 'warning' | 'info';
  category: 'memory' | 'cpu' | 'database' | 'session' | 'scraper' | 'api' | 'cron' | 'network';
  message: string;
  detectedAt: string;
  autoHealable: boolean;
  suggestedAction?: string;
  resolved: boolean;
  resolvedAt?: string;
}

// Circuit Breaker State
export interface CircuitBreakerStatus {
  name: string;
  state: 'closed' | 'open' | 'half_open';
  failures: number;
  successes: number;
  lastFailure?: string;
  lastSuccess?: string;
  resetTimeout: number;
  nextAttempt?: string;
}

// Browser Pool Status
export interface BrowserPoolStatus {
  activeInstances: number;
  maxInstances: number;
  queueLength: number;
  totalCreated: number;
  totalDestroyed: number;
  averageLifetime: number;
}

// Real-time Event Types
export type DebugEventType =
  | 'metrics'
  | 'request'
  | 'error'
  | 'log'
  | 'cron'
  | 'healing'
  | 'circuit_breaker'
  | 'session'
  | 'database'
  | 'backup';

export interface DebugEvent {
  type: DebugEventType;
  timestamp: string;
  data: unknown;
}

// Debug Dashboard State
export interface DebugDashboardState {
  connected: boolean;
  metrics: SystemMetrics | null;
  recentRequests: RequestLog[];
  recentErrors: ErrorLog[];
  cronJobs: CronJobStatus[];
  healthIssues: HealthIssue[];
  healingActions: HealingAction[];
  circuitBreakers: CircuitBreakerStatus[];
  browserPool: BrowserPoolStatus | null;
  queryProfiles: QueryProfile[];
}

// Backup Types
export interface BackupInfo {
  id: string;
  filename: string;
  createdAt: string;
  size: number;
  type: 'full' | 'incremental' | 'config' | 'logs';
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  tables?: string[];
  recordCount?: number;
  checksum?: string;
  error?: string;
  restorable: boolean;
}

export interface BackupConfig {
  autoBackup: boolean;
  schedule: string;
  retentionDays: number;
  maxBackups: number;
  compressionLevel: number;
  includeData: boolean;
  includeLogs: boolean;
  includeConfig: boolean;
}

export interface RestoreOptions {
  backupId: string;
  tables?: string[];
  overwrite: boolean;
  dryRun: boolean;
}

export interface RestoreResult {
  success: boolean;
  backupId: string;
  tablesRestored: string[];
  recordsRestored: number;
  duration: number;
  errors?: string[];
}

// Alert Configuration
export interface AlertConfig {
  enabled: boolean;
  emailEnabled: boolean;
  thresholds: {
    cpuUsage: number;
    memoryUsage: number;
    errorRate: number;
    responseTime: number;
    queueSize: number;
  };
  cooldown: number;
}

// Performance Thresholds
export interface PerformanceThresholds {
  slowQueryMs: number;
  slowRequestMs: number;
  maxMemoryPercent: number;
  maxCpuPercent: number;
  maxErrorRate: number;
  maxEventLoopLatency: number;
}

// Debug Configuration
export interface DebugConfig {
  enabled: boolean;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  maxRequestLogs: number;
  maxErrorLogs: number;
  maxQueryProfiles: number;
  sampleRate: number;
  alertConfig: AlertConfig;
  performanceThresholds: PerformanceThresholds;
  backupConfig: BackupConfig;
}
