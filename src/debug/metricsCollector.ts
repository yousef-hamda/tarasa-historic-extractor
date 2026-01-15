/**
 * Advanced Metrics Collector
 * Collects system metrics, performance data, and event loop statistics
 */

import os from 'os';
import { SystemMetrics } from './types';
import logger from '../utils/logger';

// Event loop latency tracking
let lastLoopTime = process.hrtime.bigint();
let eventLoopLatency = 0;
let isEventLoopBlocked = false;

// Set up event loop monitoring
const EVENT_LOOP_CHECK_INTERVAL = 100; // ms
const EVENT_LOOP_BLOCK_THRESHOLD = 100; // ms

setInterval(() => {
  const now = process.hrtime.bigint();
  const delta = Number(now - lastLoopTime) / 1e6; // Convert to ms
  eventLoopLatency = Math.max(0, delta - EVENT_LOOP_CHECK_INTERVAL);
  isEventLoopBlocked = eventLoopLatency > EVENT_LOOP_BLOCK_THRESHOLD;
  lastLoopTime = now;
}, EVENT_LOOP_CHECK_INTERVAL).unref();

// CPU usage tracking
let lastCpuUsage = process.cpuUsage();
let lastCpuCheck = Date.now();
let cpuUsagePercent = 0;

const updateCpuUsage = (): void => {
  const now = Date.now();
  const elapsed = now - lastCpuCheck;

  if (elapsed > 0) {
    const currentUsage = process.cpuUsage(lastCpuUsage);
    const totalUsage = (currentUsage.user + currentUsage.system) / 1000; // Convert to ms
    cpuUsagePercent = Math.min(100, (totalUsage / elapsed) * 100);

    lastCpuUsage = process.cpuUsage();
    lastCpuCheck = now;
  }
};

// Update CPU every second
setInterval(updateCpuUsage, 1000).unref();

/**
 * Collect current system metrics
 */
export const collectMetrics = (): SystemMetrics => {
  const memoryUsage = process.memoryUsage();
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;

  return {
    timestamp: new Date().toISOString(),
    cpu: {
      usage: cpuUsagePercent,
      cores: os.cpus().length,
      loadAverage: os.loadavg(),
    },
    memory: {
      total: totalMem,
      used: usedMem,
      free: freeMem,
      heapUsed: memoryUsage.heapUsed,
      heapTotal: memoryUsage.heapTotal,
      external: memoryUsage.external,
      rss: memoryUsage.rss,
      usagePercent: (usedMem / totalMem) * 100,
    },
    process: {
      pid: process.pid,
      uptime: process.uptime(),
      version: process.version,
      platform: process.platform,
      arch: process.arch,
    },
    eventLoop: {
      latency: eventLoopLatency,
      isBlocked: isEventLoopBlocked,
    },
  };
};

// Metrics history for trend analysis
const MAX_HISTORY = 360; // 1 hour at 10s intervals
const metricsHistory: SystemMetrics[] = [];

/**
 * Record metrics to history
 */
export const recordMetrics = (): void => {
  const metrics = collectMetrics();
  metricsHistory.push(metrics);

  // Trim history
  while (metricsHistory.length > MAX_HISTORY) {
    metricsHistory.shift();
  }
};

/**
 * Get metrics history
 */
export const getMetricsHistory = (limit = 60): SystemMetrics[] => {
  return metricsHistory.slice(-limit);
};

/**
 * Calculate average metrics over a time period
 */
export const getAverageMetrics = (minutes = 5): {
  avgCpuUsage: number;
  avgMemoryUsage: number;
  avgEventLoopLatency: number;
  peakCpuUsage: number;
  peakMemoryUsage: number;
} => {
  const samplesNeeded = (minutes * 60) / 10; // Samples at 10s intervals
  const relevantSamples = metricsHistory.slice(-samplesNeeded);

  if (relevantSamples.length === 0) {
    return {
      avgCpuUsage: 0,
      avgMemoryUsage: 0,
      avgEventLoopLatency: 0,
      peakCpuUsage: 0,
      peakMemoryUsage: 0,
    };
  }

  const sum = relevantSamples.reduce(
    (acc, m) => ({
      cpu: acc.cpu + m.cpu.usage,
      mem: acc.mem + m.memory.usagePercent,
      latency: acc.latency + m.eventLoop.latency,
    }),
    { cpu: 0, mem: 0, latency: 0 }
  );

  const peaks = relevantSamples.reduce(
    (acc, m) => ({
      cpu: Math.max(acc.cpu, m.cpu.usage),
      mem: Math.max(acc.mem, m.memory.usagePercent),
    }),
    { cpu: 0, mem: 0 }
  );

  return {
    avgCpuUsage: sum.cpu / relevantSamples.length,
    avgMemoryUsage: sum.mem / relevantSamples.length,
    avgEventLoopLatency: sum.latency / relevantSamples.length,
    peakCpuUsage: peaks.cpu,
    peakMemoryUsage: peaks.mem,
  };
};

/**
 * Check if system is under stress
 */
export const isSystemUnderStress = (): {
  stressed: boolean;
  reasons: string[];
} => {
  const metrics = collectMetrics();
  const reasons: string[] = [];

  if (metrics.cpu.usage > 80) {
    reasons.push(`High CPU usage: ${metrics.cpu.usage.toFixed(1)}%`);
  }

  if (metrics.memory.usagePercent > 85) {
    reasons.push(`High memory usage: ${metrics.memory.usagePercent.toFixed(1)}%`);
  }

  if (metrics.eventLoop.isBlocked) {
    reasons.push(`Event loop blocked: ${metrics.eventLoop.latency.toFixed(1)}ms latency`);
  }

  const heapUsagePercent = (metrics.memory.heapUsed / metrics.memory.heapTotal) * 100;
  if (heapUsagePercent > 90) {
    reasons.push(`High heap usage: ${heapUsagePercent.toFixed(1)}%`);
  }

  return {
    stressed: reasons.length > 0,
    reasons,
  };
};

/**
 * Format bytes to human readable string
 */
export const formatBytes = (bytes: number): string => {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let unitIndex = 0;
  let value = bytes;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }

  return `${value.toFixed(2)} ${units[unitIndex]}`;
};

/**
 * Format duration to human readable string
 */
export const formatDuration = (ms: number): string => {
  if (ms < 1000) return `${ms.toFixed(0)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3600000) return `${(ms / 60000).toFixed(1)}m`;
  return `${(ms / 3600000).toFixed(1)}h`;
};

// Start recording metrics every 10 seconds
let metricsInterval: NodeJS.Timeout | null = null;

export const startMetricsCollection = (): void => {
  if (metricsInterval) return;

  logger.info('Starting metrics collection');
  metricsInterval = setInterval(recordMetrics, 10000);
  recordMetrics(); // Record immediately
};

export const stopMetricsCollection = (): void => {
  if (metricsInterval) {
    clearInterval(metricsInterval);
    metricsInterval = null;
    logger.info('Stopped metrics collection');
  }
};

// Auto-start metrics collection
startMetricsCollection();
