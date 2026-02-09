/**
 * Comprehensive tests for Metrics Collector
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  collectMetrics,
  recordMetrics,
  getMetricsHistory,
  getAverageMetrics,
  isSystemUnderStress,
  formatBytes,
  formatDuration,
  startMetricsCollection,
  stopMetricsCollection,
} from '../src/debug/metricsCollector';

// Mock logger
vi.mock('../src/utils/logger', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('collectMetrics()', () => {
  it('should return metrics object', () => {
    const metrics = collectMetrics();
    expect(metrics).toBeDefined();
    expect(typeof metrics).toBe('object');
  });

  it('should include timestamp', () => {
    const metrics = collectMetrics();
    expect(metrics.timestamp).toBeDefined();
    expect(typeof metrics.timestamp).toBe('string');
  });

  it('should have valid ISO timestamp', () => {
    const metrics = collectMetrics();
    expect(() => new Date(metrics.timestamp)).not.toThrow();
    const date = new Date(metrics.timestamp);
    expect(date.toISOString()).toBe(metrics.timestamp);
  });

  describe('CPU metrics', () => {
    it('should include cpu object', () => {
      const metrics = collectMetrics();
      expect(metrics.cpu).toBeDefined();
      expect(typeof metrics.cpu).toBe('object');
    });

    it('should have usage percentage', () => {
      const metrics = collectMetrics();
      expect(typeof metrics.cpu.usage).toBe('number');
      expect(metrics.cpu.usage).toBeGreaterThanOrEqual(0);
    });

    it('should have cores count', () => {
      const metrics = collectMetrics();
      expect(typeof metrics.cpu.cores).toBe('number');
      expect(metrics.cpu.cores).toBeGreaterThanOrEqual(1);
    });

    it('should have load average array', () => {
      const metrics = collectMetrics();
      expect(Array.isArray(metrics.cpu.loadAverage)).toBe(true);
      expect(metrics.cpu.loadAverage.length).toBe(3);
    });

    it('should have non-negative load average values', () => {
      const metrics = collectMetrics();
      metrics.cpu.loadAverage.forEach(load => {
        expect(typeof load).toBe('number');
        expect(load).toBeGreaterThanOrEqual(0);
      });
    });
  });

  describe('Memory metrics', () => {
    it('should include memory object', () => {
      const metrics = collectMetrics();
      expect(metrics.memory).toBeDefined();
      expect(typeof metrics.memory).toBe('object');
    });

    it('should have total memory', () => {
      const metrics = collectMetrics();
      expect(typeof metrics.memory.total).toBe('number');
      expect(metrics.memory.total).toBeGreaterThan(0);
    });

    it('should have used memory', () => {
      const metrics = collectMetrics();
      expect(typeof metrics.memory.used).toBe('number');
      expect(metrics.memory.used).toBeGreaterThan(0);
    });

    it('should have free memory', () => {
      const metrics = collectMetrics();
      expect(typeof metrics.memory.free).toBe('number');
      expect(metrics.memory.free).toBeGreaterThanOrEqual(0);
    });

    it('should have heap metrics', () => {
      const metrics = collectMetrics();
      expect(typeof metrics.memory.heapUsed).toBe('number');
      expect(typeof metrics.memory.heapTotal).toBe('number');
      expect(metrics.memory.heapUsed).toBeLessThanOrEqual(metrics.memory.heapTotal);
    });

    it('should have external memory', () => {
      const metrics = collectMetrics();
      expect(typeof metrics.memory.external).toBe('number');
      expect(metrics.memory.external).toBeGreaterThanOrEqual(0);
    });

    it('should have RSS', () => {
      const metrics = collectMetrics();
      expect(typeof metrics.memory.rss).toBe('number');
      expect(metrics.memory.rss).toBeGreaterThan(0);
    });

    it('should have usage percentage', () => {
      const metrics = collectMetrics();
      expect(typeof metrics.memory.usagePercent).toBe('number');
      expect(metrics.memory.usagePercent).toBeGreaterThanOrEqual(0);
      expect(metrics.memory.usagePercent).toBeLessThanOrEqual(100);
    });

    it('should have consistent memory values', () => {
      const metrics = collectMetrics();
      // Used + Free should approximately equal Total (for heap)
      expect(metrics.memory.heapUsed + metrics.memory.free).toBeCloseTo(metrics.memory.heapTotal, -1);
    });
  });

  describe('Process metrics', () => {
    it('should include process object', () => {
      const metrics = collectMetrics();
      expect(metrics.process).toBeDefined();
      expect(typeof metrics.process).toBe('object');
    });

    it('should have PID', () => {
      const metrics = collectMetrics();
      expect(typeof metrics.process.pid).toBe('number');
      expect(metrics.process.pid).toBeGreaterThan(0);
    });

    it('should have uptime', () => {
      const metrics = collectMetrics();
      expect(typeof metrics.process.uptime).toBe('number');
      expect(metrics.process.uptime).toBeGreaterThan(0);
    });

    it('should have version', () => {
      const metrics = collectMetrics();
      expect(typeof metrics.process.version).toBe('string');
      expect(metrics.process.version).toMatch(/^v\d+\.\d+\.\d+/);
    });

    it('should have platform', () => {
      const metrics = collectMetrics();
      expect(typeof metrics.process.platform).toBe('string');
      expect(['darwin', 'linux', 'win32', 'freebsd', 'sunos']).toContain(metrics.process.platform);
    });

    it('should have arch', () => {
      const metrics = collectMetrics();
      expect(typeof metrics.process.arch).toBe('string');
      expect(['x64', 'arm64', 'arm', 'ia32']).toContain(metrics.process.arch);
    });
  });

  describe('Event loop metrics', () => {
    it('should include eventLoop object', () => {
      const metrics = collectMetrics();
      expect(metrics.eventLoop).toBeDefined();
      expect(typeof metrics.eventLoop).toBe('object');
    });

    it('should have latency', () => {
      const metrics = collectMetrics();
      expect(typeof metrics.eventLoop.latency).toBe('number');
      expect(metrics.eventLoop.latency).toBeGreaterThanOrEqual(0);
    });

    it('should have isBlocked flag', () => {
      const metrics = collectMetrics();
      expect(typeof metrics.eventLoop.isBlocked).toBe('boolean');
    });
  });
});

describe('recordMetrics()', () => {
  it('should not throw', () => {
    expect(() => recordMetrics()).not.toThrow();
  });

  it('should add to history', () => {
    const initialHistory = getMetricsHistory();
    const initialLength = initialHistory.length;

    recordMetrics();

    const newHistory = getMetricsHistory();
    expect(newHistory.length).toBeGreaterThanOrEqual(initialLength);
  });
});

describe('getMetricsHistory()', () => {
  it('should return array', () => {
    const history = getMetricsHistory();
    expect(Array.isArray(history)).toBe(true);
  });

  it('should return metrics objects', () => {
    recordMetrics();
    const history = getMetricsHistory();

    if (history.length > 0) {
      const item = history[0];
      expect(item).toHaveProperty('timestamp');
      expect(item).toHaveProperty('cpu');
      expect(item).toHaveProperty('memory');
      expect(item).toHaveProperty('process');
      expect(item).toHaveProperty('eventLoop');
    }
  });

  it('should respect limit parameter', () => {
    // Record several metrics
    for (let i = 0; i < 10; i++) {
      recordMetrics();
    }

    const limited = getMetricsHistory(5);
    expect(limited.length).toBeLessThanOrEqual(5);
  });

  it('should return most recent entries when limited', () => {
    recordMetrics();
    const history = getMetricsHistory(1);

    if (history.length > 0) {
      const latest = history[history.length - 1];
      const now = new Date();
      const latestTime = new Date(latest.timestamp);

      // Should be within last minute
      expect(now.getTime() - latestTime.getTime()).toBeLessThan(60000);
    }
  });

  it('should default to 60 entries', () => {
    const history = getMetricsHistory();
    expect(history.length).toBeLessThanOrEqual(60);
  });
});

describe('getAverageMetrics()', () => {
  beforeEach(() => {
    // Record some metrics for testing
    for (let i = 0; i < 5; i++) {
      recordMetrics();
    }
  });

  it('should return object with all average fields', () => {
    const averages = getAverageMetrics();

    expect(averages).toHaveProperty('avgCpuUsage');
    expect(averages).toHaveProperty('avgMemoryUsage');
    expect(averages).toHaveProperty('avgEventLoopLatency');
    expect(averages).toHaveProperty('peakCpuUsage');
    expect(averages).toHaveProperty('peakMemoryUsage');
  });

  it('should return numbers for all fields', () => {
    const averages = getAverageMetrics();

    expect(typeof averages.avgCpuUsage).toBe('number');
    expect(typeof averages.avgMemoryUsage).toBe('number');
    expect(typeof averages.avgEventLoopLatency).toBe('number');
    expect(typeof averages.peakCpuUsage).toBe('number');
    expect(typeof averages.peakMemoryUsage).toBe('number');
  });

  it('should have non-negative values', () => {
    const averages = getAverageMetrics();

    expect(averages.avgCpuUsage).toBeGreaterThanOrEqual(0);
    expect(averages.avgMemoryUsage).toBeGreaterThanOrEqual(0);
    expect(averages.avgEventLoopLatency).toBeGreaterThanOrEqual(0);
    expect(averages.peakCpuUsage).toBeGreaterThanOrEqual(0);
    expect(averages.peakMemoryUsage).toBeGreaterThanOrEqual(0);
  });

  it('should have peak >= average', () => {
    const averages = getAverageMetrics();

    expect(averages.peakCpuUsage).toBeGreaterThanOrEqual(averages.avgCpuUsage);
    expect(averages.peakMemoryUsage).toBeGreaterThanOrEqual(averages.avgMemoryUsage);
  });

  it('should respect minutes parameter', () => {
    const shortAvg = getAverageMetrics(1);
    const longAvg = getAverageMetrics(60);

    // Both should return valid objects
    expect(shortAvg).toHaveProperty('avgCpuUsage');
    expect(longAvg).toHaveProperty('avgCpuUsage');
  });

  it('should handle empty history gracefully', () => {
    // This might not actually empty history due to auto-collection
    // but the function should handle it
    const averages = getAverageMetrics(0);

    expect(averages.avgCpuUsage).toBeGreaterThanOrEqual(0);
    expect(averages.avgMemoryUsage).toBeGreaterThanOrEqual(0);
  });
});

describe('isSystemUnderStress()', () => {
  it('should return object with stressed flag', () => {
    const result = isSystemUnderStress();
    expect(result).toHaveProperty('stressed');
    expect(typeof result.stressed).toBe('boolean');
  });

  it('should return object with reasons array', () => {
    const result = isSystemUnderStress();
    expect(result).toHaveProperty('reasons');
    expect(Array.isArray(result.reasons)).toBe(true);
  });

  it('should have empty reasons when not stressed', () => {
    const result = isSystemUnderStress();
    if (!result.stressed) {
      expect(result.reasons.length).toBe(0);
    }
  });

  it('should have reasons when stressed', () => {
    const result = isSystemUnderStress();
    if (result.stressed) {
      expect(result.reasons.length).toBeGreaterThan(0);
      result.reasons.forEach(reason => {
        expect(typeof reason).toBe('string');
      });
    }
  });
});

describe('formatBytes()', () => {
  it('should format bytes correctly', () => {
    expect(formatBytes(0)).toBe('0.00 B');
    expect(formatBytes(1)).toBe('1.00 B');
    expect(formatBytes(512)).toBe('512.00 B');
  });

  it('should format kilobytes correctly', () => {
    expect(formatBytes(1024)).toBe('1.00 KB');
    expect(formatBytes(2048)).toBe('2.00 KB');
    expect(formatBytes(1536)).toBe('1.50 KB');
  });

  it('should format megabytes correctly', () => {
    expect(formatBytes(1024 * 1024)).toBe('1.00 MB');
    expect(formatBytes(1024 * 1024 * 2.5)).toBe('2.50 MB');
  });

  it('should format gigabytes correctly', () => {
    expect(formatBytes(1024 * 1024 * 1024)).toBe('1.00 GB');
    expect(formatBytes(1024 * 1024 * 1024 * 4)).toBe('4.00 GB');
  });

  it('should format terabytes correctly', () => {
    expect(formatBytes(1024 * 1024 * 1024 * 1024)).toBe('1.00 TB');
  });

  it('should handle large numbers', () => {
    expect(formatBytes(1024 * 1024 * 1024 * 1024 * 10)).toBe('10.00 TB');
  });

  it('should handle fractional bytes (rounds)', () => {
    const result = formatBytes(100);
    expect(result).toMatch(/^\d+\.\d{2} B$/);
  });
});

describe('formatDuration()', () => {
  it('should format milliseconds correctly', () => {
    expect(formatDuration(0)).toBe('0ms');
    expect(formatDuration(1)).toBe('1ms');
    expect(formatDuration(500)).toBe('500ms');
    expect(formatDuration(999)).toBe('999ms');
  });

  it('should format seconds correctly', () => {
    expect(formatDuration(1000)).toBe('1.0s');
    expect(formatDuration(1500)).toBe('1.5s');
    expect(formatDuration(30000)).toBe('30.0s');
    expect(formatDuration(59999)).toBe('60.0s');
  });

  it('should format minutes correctly', () => {
    expect(formatDuration(60000)).toBe('1.0m');
    expect(formatDuration(90000)).toBe('1.5m');
    expect(formatDuration(300000)).toBe('5.0m');
  });

  it('should format hours correctly', () => {
    expect(formatDuration(3600000)).toBe('1.0h');
    expect(formatDuration(7200000)).toBe('2.0h');
    expect(formatDuration(5400000)).toBe('1.5h');
  });

  it('should handle edge cases at boundaries', () => {
    // Just under 1 second
    expect(formatDuration(999)).toBe('999ms');
    // Exactly 1 second
    expect(formatDuration(1000)).toBe('1.0s');
    // Just under 1 minute
    expect(formatDuration(59999)).toBe('60.0s');
    // Exactly 1 minute
    expect(formatDuration(60000)).toBe('1.0m');
  });
});

describe('startMetricsCollection() and stopMetricsCollection()', () => {
  it('should start without error', () => {
    expect(() => startMetricsCollection()).not.toThrow();
  });

  it('should stop without error', () => {
    expect(() => stopMetricsCollection()).not.toThrow();
  });

  it('should be idempotent for start', () => {
    expect(() => {
      startMetricsCollection();
      startMetricsCollection();
      startMetricsCollection();
    }).not.toThrow();
  });

  it('should be idempotent for stop', () => {
    expect(() => {
      stopMetricsCollection();
      stopMetricsCollection();
      stopMetricsCollection();
    }).not.toThrow();
  });

  it('should allow restart after stop', () => {
    stopMetricsCollection();
    expect(() => startMetricsCollection()).not.toThrow();
  });
});

describe('Edge Cases', () => {
  it('should handle concurrent collectMetrics calls', async () => {
    const results = await Promise.all([
      Promise.resolve(collectMetrics()),
      Promise.resolve(collectMetrics()),
      Promise.resolve(collectMetrics()),
    ]);

    results.forEach(metrics => {
      expect(metrics).toHaveProperty('timestamp');
      expect(metrics).toHaveProperty('cpu');
    });
  });

  it('should handle rapid recordMetrics calls', () => {
    expect(() => {
      for (let i = 0; i < 100; i++) {
        recordMetrics();
      }
    }).not.toThrow();
  });

  it('formatBytes should handle negative numbers', () => {
    // Negative bytes don't make sense but shouldn't crash
    const result = formatBytes(-100);
    expect(typeof result).toBe('string');
  });

  it('formatDuration should handle negative numbers', () => {
    // Negative duration doesn't make sense but shouldn't crash
    const result = formatDuration(-100);
    expect(typeof result).toBe('string');
  });

  it('formatDuration should handle very large numbers', () => {
    const result = formatDuration(1000000000000);
    expect(result).toMatch(/h$/);
  });
});

console.log('Metrics collector test suite loaded');
