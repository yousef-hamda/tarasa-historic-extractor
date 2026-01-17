/**
 * Debug Event Emitter
 * Central event bus for the debugging system
 */

import { EventEmitter } from 'events';
import { DebugEvent, DebugEventType } from './types';
import logger from '../utils/logger';

class DebugEventEmitter extends EventEmitter {
  private subscribers: Map<string, Set<(event: DebugEvent) => void>> = new Map();
  private eventHistory: DebugEvent[] = [];
  private maxHistorySize = 1000;

  constructor() {
    super();
    this.setMaxListeners(50);

    // IMPORTANT: Add a default 'error' listener to prevent Node.js from throwing
    // when emitting 'error' events with no subscribers.
    // Without this, emitting 'error' with no listeners causes an uncaught exception.
    this.on('error', () => {
      // Silently consume 'error' events - they're already logged elsewhere
    });
  }

  /**
   * Emit a debug event
   */
  emitDebugEvent(type: DebugEventType, data: unknown): void {
    const event: DebugEvent = {
      type,
      timestamp: new Date().toISOString(),
      data,
    };

    // Store in history
    this.eventHistory.push(event);
    while (this.eventHistory.length > this.maxHistorySize) {
      this.eventHistory.shift();
    }

    // Emit to all subscribers
    this.emit(type, data);
    this.emit('*', event);
  }

  /**
   * Subscribe to all events
   */
  subscribeAll(callback: (event: DebugEvent) => void): () => void {
    this.on('*', callback);
    return () => this.off('*', callback);
  }

  /**
   * Subscribe to specific event type
   */
  subscribe(type: DebugEventType, callback: (data: unknown) => void): () => void {
    this.on(type, callback);
    return () => this.off(type, callback);
  }

  /**
   * Get event history
   */
  getHistory(type?: DebugEventType, limit = 100): DebugEvent[] {
    let events = this.eventHistory;
    if (type) {
      events = events.filter((e) => e.type === type);
    }
    return events.slice(-limit);
  }

  /**
   * Clear event history
   */
  clearHistory(): void {
    this.eventHistory = [];
  }
}

// Singleton instance
export const debugEventEmitter = new DebugEventEmitter();

// Convenience methods
export const emitDebugEvent = (type: DebugEventType, data: unknown): void => {
  debugEventEmitter.emitDebugEvent(type, data);
};

export const subscribeToDebugEvents = (callback: (event: DebugEvent) => void): (() => void) => {
  return debugEventEmitter.subscribeAll(callback);
};

export const getEventHistory = (type?: DebugEventType, limit?: number): DebugEvent[] => {
  return debugEventEmitter.getHistory(type, limit);
};
