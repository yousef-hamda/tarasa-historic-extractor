/**
 * Comprehensive tests for debug event emitter
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock logger
vi.mock('../src/utils/logger', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import {
  debugEventEmitter,
  emitDebugEvent,
  subscribeToDebugEvents,
  getEventHistory,
} from '../src/debug/eventEmitter';

describe('DebugEventEmitter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    debugEventEmitter.clearHistory();
  });

  describe('emitDebugEvent()', () => {
    it('should emit event with correct structure', () => {
      const callback = vi.fn();
      debugEventEmitter.subscribeAll(callback);

      emitDebugEvent('scraper', { message: 'Test' });

      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'scraper',
          data: { message: 'Test' },
          timestamp: expect.any(String),
        })
      );
    });

    it('should store event in history', () => {
      emitDebugEvent('database', { query: 'SELECT *' });

      const history = getEventHistory();
      expect(history.length).toBeGreaterThan(0);
      expect(history[history.length - 1]).toEqual(
        expect.objectContaining({
          type: 'database',
          data: { query: 'SELECT *' },
        })
      );
    });

    it('should emit to type-specific listeners', () => {
      const scraperCallback = vi.fn();
      const databaseCallback = vi.fn();

      debugEventEmitter.subscribe('scraper', scraperCallback);
      debugEventEmitter.subscribe('database', databaseCallback);

      emitDebugEvent('scraper', { test: true });

      expect(scraperCallback).toHaveBeenCalledWith({ test: true });
      expect(databaseCallback).not.toHaveBeenCalled();
    });

    it('should emit to wildcard listeners', () => {
      const callback = vi.fn();
      debugEventEmitter.subscribeAll(callback);

      emitDebugEvent('scraper', { data: 1 });
      emitDebugEvent('database', { data: 2 });
      emitDebugEvent('api', { data: 3 });

      expect(callback).toHaveBeenCalledTimes(3);
    });

    it('should handle null data', () => {
      const callback = vi.fn();
      debugEventEmitter.subscribeAll(callback);

      emitDebugEvent('scraper', null);

      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          data: null,
        })
      );
    });

    it('should handle undefined data', () => {
      const callback = vi.fn();
      debugEventEmitter.subscribeAll(callback);

      emitDebugEvent('scraper', undefined);

      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          data: undefined,
        })
      );
    });

    it('should handle complex object data', () => {
      const complexData = {
        nested: { deep: { value: 123 } },
        array: [1, 2, 3],
        date: new Date().toISOString(),
      };
      const callback = vi.fn();
      debugEventEmitter.subscribeAll(callback);

      emitDebugEvent('scraper', complexData);

      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          data: complexData,
        })
      );
    });
  });

  describe('subscribeAll()', () => {
    it('should return unsubscribe function', () => {
      const callback = vi.fn();
      const unsubscribe = debugEventEmitter.subscribeAll(callback);

      emitDebugEvent('scraper', { test: 1 });
      expect(callback).toHaveBeenCalledTimes(1);

      unsubscribe();

      emitDebugEvent('scraper', { test: 2 });
      expect(callback).toHaveBeenCalledTimes(1); // Still 1
    });

    it('should allow multiple subscribers', () => {
      const callback1 = vi.fn();
      const callback2 = vi.fn();
      const callback3 = vi.fn();

      debugEventEmitter.subscribeAll(callback1);
      debugEventEmitter.subscribeAll(callback2);
      debugEventEmitter.subscribeAll(callback3);

      emitDebugEvent('scraper', { test: true });

      expect(callback1).toHaveBeenCalled();
      expect(callback2).toHaveBeenCalled();
      expect(callback3).toHaveBeenCalled();
    });
  });

  describe('subscribe()', () => {
    it('should only receive events of specified type', () => {
      const callback = vi.fn();
      debugEventEmitter.subscribe('database', callback);

      emitDebugEvent('scraper', { data: 1 });
      emitDebugEvent('database', { data: 2 });
      emitDebugEvent('api', { data: 3 });

      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledWith({ data: 2 });
    });

    it('should return unsubscribe function', () => {
      const callback = vi.fn();
      const unsubscribe = debugEventEmitter.subscribe('database', callback);

      emitDebugEvent('database', { test: 1 });
      expect(callback).toHaveBeenCalledTimes(1);

      unsubscribe();

      emitDebugEvent('database', { test: 2 });
      expect(callback).toHaveBeenCalledTimes(1);
    });
  });

  describe('getHistory()', () => {
    it('should return empty array when no events', () => {
      const history = getEventHistory();
      expect(history).toEqual([]);
    });

    it('should return all events by default', () => {
      emitDebugEvent('scraper', { id: 1 });
      emitDebugEvent('database', { id: 2 });
      emitDebugEvent('api', { id: 3 });

      const history = getEventHistory();
      expect(history.length).toBe(3);
    });

    it('should filter by event type', () => {
      emitDebugEvent('scraper', { id: 1 });
      emitDebugEvent('database', { id: 2 });
      emitDebugEvent('scraper', { id: 3 });

      const scraperHistory = getEventHistory('scraper');
      expect(scraperHistory.length).toBe(2);
      expect(scraperHistory.every((e) => e.type === 'scraper')).toBe(true);
    });

    it('should respect limit parameter', () => {
      for (let i = 0; i < 10; i++) {
        emitDebugEvent('scraper', { id: i });
      }

      const history = getEventHistory(undefined, 5);
      expect(history.length).toBe(5);
    });

    it('should return most recent events when limited', () => {
      for (let i = 0; i < 10; i++) {
        emitDebugEvent('scraper', { id: i });
      }

      const history = getEventHistory(undefined, 3);
      expect(history[0].data).toEqual({ id: 7 });
      expect(history[1].data).toEqual({ id: 8 });
      expect(history[2].data).toEqual({ id: 9 });
    });

    it('should combine type filter and limit', () => {
      for (let i = 0; i < 5; i++) {
        emitDebugEvent('scraper', { id: i });
        emitDebugEvent('database', { id: i + 100 });
      }

      const history = getEventHistory('scraper', 3);
      expect(history.length).toBe(3);
      expect(history.every((e) => e.type === 'scraper')).toBe(true);
    });
  });

  describe('clearHistory()', () => {
    it('should clear all events', () => {
      emitDebugEvent('scraper', { id: 1 });
      emitDebugEvent('database', { id: 2 });

      expect(getEventHistory().length).toBe(2);

      debugEventEmitter.clearHistory();

      expect(getEventHistory().length).toBe(0);
    });
  });

  describe('history size limit', () => {
    it('should respect max history size', () => {
      // Emit more than maxHistorySize (1000)
      for (let i = 0; i < 1100; i++) {
        emitDebugEvent('scraper', { id: i });
      }

      const history = getEventHistory();
      expect(history.length).toBeLessThanOrEqual(1000);
    });

    it('should keep most recent events when over limit', () => {
      for (let i = 0; i < 1100; i++) {
        emitDebugEvent('scraper', { id: i });
      }

      const history = getEventHistory();
      // Should have the most recent events (ids 100-1099)
      const lastEvent = history[history.length - 1];
      expect(lastEvent.data).toEqual({ id: 1099 });
    });
  });

  describe('event timestamp', () => {
    it('should have valid ISO timestamp', () => {
      emitDebugEvent('scraper', { test: true });

      const history = getEventHistory();
      const timestamp = history[0].timestamp;

      expect(() => new Date(timestamp)).not.toThrow();
      expect(new Date(timestamp).toISOString()).toBe(timestamp);
    });

    it('should have increasing timestamps', async () => {
      emitDebugEvent('scraper', { id: 1 });

      // Small delay to ensure different timestamps
      await new Promise((resolve) => setTimeout(resolve, 5));

      emitDebugEvent('scraper', { id: 2 });

      const history = getEventHistory();
      expect(new Date(history[0].timestamp).getTime()).toBeLessThanOrEqual(
        new Date(history[1].timestamp).getTime()
      );
    });
  });

  describe('error event handling', () => {
    it('should not throw when emitting error event without listeners', () => {
      // The emitter has a default error listener to prevent crashes
      expect(() => {
        debugEventEmitter.emit('error', new Error('Test error'));
      }).not.toThrow();
    });
  });

  describe('event types', () => {
    const eventTypes = ['scraper', 'database', 'api', 'metrics', 'error'] as const;

    eventTypes.forEach((type) => {
      it(`should handle ${type} event type`, () => {
        const callback = vi.fn();
        debugEventEmitter.subscribe(type as any, callback);

        emitDebugEvent(type as any, { test: true });

        expect(callback).toHaveBeenCalled();
      });
    });
  });
});

describe('Convenience functions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    debugEventEmitter.clearHistory();
  });

  describe('subscribeToDebugEvents()', () => {
    it('should subscribe to all events', () => {
      const callback = vi.fn();
      subscribeToDebugEvents(callback);

      emitDebugEvent('scraper', { test: 1 });
      emitDebugEvent('database', { test: 2 });

      expect(callback).toHaveBeenCalledTimes(2);
    });

    it('should return unsubscribe function', () => {
      const callback = vi.fn();
      const unsubscribe = subscribeToDebugEvents(callback);

      emitDebugEvent('scraper', { test: 1 });
      unsubscribe();
      emitDebugEvent('scraper', { test: 2 });

      expect(callback).toHaveBeenCalledTimes(1);
    });
  });
});

console.log('Event emitter test suite loaded');
