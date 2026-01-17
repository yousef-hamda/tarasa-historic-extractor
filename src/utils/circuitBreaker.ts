/**
 * Circuit Breaker Pattern Implementation
 *
 * Automatically disables failing services to prevent cascading failures
 * and allow time for recovery.
 *
 * States:
 * - CLOSED: Normal operation, requests pass through
 * - OPEN: Service disabled, requests fail fast
 * - HALF_OPEN: Testing if service has recovered
 */

import logger from './logger';
import { logSystemEvent } from './systemLog';

interface CircuitBreakerOptions {
  name: string;
  failureThreshold: number;    // Number of failures before opening circuit
  resetTimeoutMs: number;      // Time before attempting recovery
  halfOpenRequests: number;    // Number of test requests in half-open state
}

type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

interface CircuitBreakerState {
  state: CircuitState;
  failures: number;
  successes: number;
  lastFailureTime: number;
  halfOpenAttempts: number;
}

class CircuitBreaker {
  private options: CircuitBreakerOptions;
  private circuitState: CircuitBreakerState;

  constructor(options: CircuitBreakerOptions) {
    this.options = options;
    this.circuitState = {
      state: 'CLOSED',
      failures: 0,
      successes: 0,
      lastFailureTime: 0,
      halfOpenAttempts: 0,
    };
  }

  /**
   * Execute a function with circuit breaker protection
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    // Check if circuit should transition from OPEN to HALF_OPEN
    if (this.circuitState.state === 'OPEN') {
      const timeSinceFailure = Date.now() - this.circuitState.lastFailureTime;
      if (timeSinceFailure >= this.options.resetTimeoutMs) {
        this.circuitState.state = 'HALF_OPEN';
        this.circuitState.halfOpenAttempts = 0;
        logger.info(`[CircuitBreaker:${this.options.name}] Transitioning to HALF_OPEN state`);
      }
    }

    // Fail fast if circuit is OPEN
    if (this.circuitState.state === 'OPEN') {
      const remainingMs = this.options.resetTimeoutMs - (Date.now() - this.circuitState.lastFailureTime);
      throw new Error(`Circuit breaker [${this.options.name}] is OPEN. Retry in ${Math.ceil(remainingMs / 1000)}s`);
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  /**
   * Record a successful operation
   */
  private onSuccess(): void {
    if (this.circuitState.state === 'HALF_OPEN') {
      this.circuitState.halfOpenAttempts++;
      this.circuitState.successes++;

      if (this.circuitState.halfOpenAttempts >= this.options.halfOpenRequests) {
        // Enough successful requests, close the circuit
        this.circuitState.state = 'CLOSED';
        this.circuitState.failures = 0;
        this.circuitState.successes = 0;
        logger.info(`[CircuitBreaker:${this.options.name}] Circuit CLOSED - service recovered`);
        logSystemEvent('error', `Circuit breaker ${this.options.name} recovered - service restored`);
      }
    } else {
      // Reset failure count on success in CLOSED state
      this.circuitState.failures = 0;
    }
  }

  /**
   * Record a failed operation
   */
  private onFailure(): void {
    this.circuitState.failures++;
    this.circuitState.lastFailureTime = Date.now();

    if (this.circuitState.state === 'HALF_OPEN') {
      // Failed during recovery test, reopen the circuit
      this.circuitState.state = 'OPEN';
      logger.warn(`[CircuitBreaker:${this.options.name}] Recovery test failed, circuit re-OPENED`);
    } else if (this.circuitState.failures >= this.options.failureThreshold) {
      // Threshold exceeded, open the circuit
      this.circuitState.state = 'OPEN';
      logger.error(`[CircuitBreaker:${this.options.name}] Circuit OPENED after ${this.circuitState.failures} failures`);
      logSystemEvent('error', `Circuit breaker ${this.options.name} OPENED - service disabled for ${this.options.resetTimeoutMs / 1000}s`);
    }
  }

  /**
   * Check if the circuit is open (service disabled)
   */
  isOpen(): boolean {
    // Also check for timeout transition
    if (this.circuitState.state === 'OPEN') {
      const timeSinceFailure = Date.now() - this.circuitState.lastFailureTime;
      if (timeSinceFailure >= this.options.resetTimeoutMs) {
        return false; // Will transition to HALF_OPEN on next call
      }
      return true;
    }
    return false;
  }

  /**
   * Get current circuit state
   */
  getState(): CircuitState {
    return this.circuitState.state;
  }

  /**
   * Manually reset the circuit to CLOSED state
   */
  reset(): void {
    this.circuitState.state = 'CLOSED';
    this.circuitState.failures = 0;
    this.circuitState.successes = 0;
    this.circuitState.halfOpenAttempts = 0;
    logger.info(`[CircuitBreaker:${this.options.name}] Manually reset to CLOSED state`);
  }
}

// Pre-configured circuit breakers for external services
export const apifyCircuitBreaker = new CircuitBreaker({
  name: 'Apify',
  failureThreshold: 5,
  resetTimeoutMs: 60 * 60 * 1000, // 1 hour
  halfOpenRequests: 2,
});

export const openaiCircuitBreaker = new CircuitBreaker({
  name: 'OpenAI',
  failureThreshold: 10,
  resetTimeoutMs: 15 * 60 * 1000, // 15 minutes
  halfOpenRequests: 3,
});

/**
 * Reset all circuit breakers to CLOSED state
 * Useful after fixing issues that caused failures
 */
export function resetAllCircuitBreakers(): void {
  apifyCircuitBreaker.reset();
  openaiCircuitBreaker.reset();
  logger.info('All circuit breakers have been reset');
}

/**
 * Get status of all circuit breakers
 */
export function getCircuitBreakerStatus(): Record<string, { state: string; isOpen: boolean }> {
  return {
    apify: { state: apifyCircuitBreaker.getState(), isOpen: apifyCircuitBreaker.isOpen() },
    openai: { state: openaiCircuitBreaker.getState(), isOpen: openaiCircuitBreaker.isOpen() },
  };
}

export default CircuitBreaker;
