/**
 * Self-Healing Engine
 * Automatically detects and fixes common system problems
 */

import { HealingAction, HealthIssue, CircuitBreakerStatus } from './types';
import { debugEventEmitter } from './eventEmitter';
import { collectMetrics, isSystemUnderStress } from './metricsCollector';
import { getErrorStats, trackError } from './errorTracker';
import { checkDatabaseConnection } from '../database/prisma';
import logger from '../utils/logger';
import crypto from 'crypto';

// Healing actions storage
const healingActions: HealingAction[] = [];
const healthIssues: Map<string, HealthIssue> = new Map();
const MAX_HEALING_ACTIONS = 200;
const MAX_HEALTH_ISSUES = 100;

// Circuit breaker registry
const circuitBreakers: Map<string, CircuitBreakerStatus> = new Map();

// Healing cooldowns to prevent action spam
const healingCooldowns: Map<string, number> = new Map();
const DEFAULT_COOLDOWN = 60000; // 1 minute

/**
 * Generate unique ID for actions/issues
 */
const generateId = (): string => {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
};

/**
 * Check if healing action is on cooldown
 */
const isOnCooldown = (actionType: string): boolean => {
  const lastRun = healingCooldowns.get(actionType);
  if (!lastRun) return false;
  return Date.now() - lastRun < DEFAULT_COOLDOWN;
};

/**
 * Set cooldown for healing action
 */
const setCooldown = (actionType: string): void => {
  healingCooldowns.set(actionType, Date.now());
};

/**
 * Register a health issue
 */
export const registerHealthIssue = (
  type: HealthIssue['type'],
  category: HealthIssue['category'],
  message: string,
  autoHealable: boolean,
  suggestedAction?: string
): HealthIssue => {
  const id = `${category}-${crypto.createHash('md5').update(message).digest('hex').substring(0, 8)}`;

  const existing = healthIssues.get(id);
  if (existing && !existing.resolved) {
    return existing;
  }

  const issue: HealthIssue = {
    id,
    type,
    category,
    message,
    detectedAt: new Date().toISOString(),
    autoHealable,
    suggestedAction,
    resolved: false,
  };

  healthIssues.set(id, issue);
  debugEventEmitter.emitDebugEvent('healing', { action: 'issue_detected', issue });

  // Trim old issues
  while (healthIssues.size > MAX_HEALTH_ISSUES) {
    const oldest = Array.from(healthIssues.entries())
      .filter(([, i]) => i.resolved)
      .sort((a, b) => new Date(a[1].detectedAt).getTime() - new Date(b[1].detectedAt).getTime())[0];
    if (oldest) healthIssues.delete(oldest[0]);
    else break;
  }

  return issue;
};

/**
 * Execute a healing action
 */
export const executeHealingAction = async (
  problem: string,
  action: string,
  healingFn: () => Promise<string>,
  automatic = true
): Promise<HealingAction> => {
  const actionId = generateId();

  const healingAction: HealingAction = {
    id: actionId,
    timestamp: new Date().toISOString(),
    problem,
    action,
    status: 'executing',
    automatic,
  };

  healingActions.push(healingAction);
  debugEventEmitter.emitDebugEvent('healing', { action: 'started', healingAction });

  const startTime = Date.now();

  try {
    const result = await healingFn();
    healingAction.status = 'success';
    healingAction.result = result;
    healingAction.duration = Date.now() - startTime;

    logger.info(`Self-healing action succeeded: ${action}`, { result, duration: healingAction.duration });
    debugEventEmitter.emitDebugEvent('healing', { action: 'completed', healingAction });
  } catch (error) {
    healingAction.status = 'failed';
    healingAction.result = (error as Error).message;
    healingAction.duration = Date.now() - startTime;

    logger.error(`Self-healing action failed: ${action}`, { error: (error as Error).message });
    debugEventEmitter.emitDebugEvent('healing', { action: 'failed', healingAction });
  }

  // Trim old actions
  while (healingActions.length > MAX_HEALING_ACTIONS) {
    healingActions.shift();
  }

  return healingAction;
};

/**
 * Memory pressure healing
 */
const healMemoryPressure = async (): Promise<void> => {
  if (isOnCooldown('memory')) return;

  const metrics = collectMetrics();
  const heapUsage = (metrics.memory.heapUsed / metrics.memory.heapTotal) * 100;

  if (heapUsage > 85 || metrics.memory.usagePercent > 90) {
    const issue = registerHealthIssue(
      'warning',
      'memory',
      `High memory usage detected: ${metrics.memory.usagePercent.toFixed(1)}% system, ${heapUsage.toFixed(1)}% heap`,
      true,
      'Force garbage collection'
    );

    setCooldown('memory');

    await executeHealingAction(
      issue.message,
      'Force garbage collection and memory cleanup',
      async () => {
        if (global.gc) {
          global.gc();
          await new Promise((resolve) => setTimeout(resolve, 1000));
          global.gc();
        }

        const afterMetrics = collectMetrics();
        const freedMb = (metrics.memory.heapUsed - afterMetrics.memory.heapUsed) / (1024 * 1024);

        issue.resolved = true;
        issue.resolvedAt = new Date().toISOString();

        return `Freed ${freedMb.toFixed(2)} MB of memory`;
      }
    );
  }
};

/**
 * Database connection healing
 */
const healDatabaseConnection = async (): Promise<void> => {
  if (isOnCooldown('database')) return;

  const isConnected = await checkDatabaseConnection();

  if (!isConnected) {
    const issue = registerHealthIssue(
      'critical',
      'database',
      'Database connection lost',
      true,
      'Attempt to reconnect'
    );

    setCooldown('database');

    await executeHealingAction(
      issue.message,
      'Reconnect to database',
      async () => {
        // Import prisma dynamically to avoid circular dependency
        const { prisma } = await import('../database/prisma');

        // Try to disconnect and reconnect
        await prisma.$disconnect();
        await new Promise((resolve) => setTimeout(resolve, 2000));

        // Test connection
        const reconnected = await checkDatabaseConnection();

        if (reconnected) {
          issue.resolved = true;
          issue.resolvedAt = new Date().toISOString();
          return 'Database connection restored';
        } else {
          throw new Error('Failed to restore database connection');
        }
      }
    );
  }
};

/**
 * Event loop healing
 */
const healEventLoop = async (): Promise<void> => {
  if (isOnCooldown('eventloop')) return;

  const metrics = collectMetrics();

  if (metrics.eventLoop.isBlocked) {
    const issue = registerHealthIssue(
      'warning',
      'cpu',
      `Event loop blocked: ${metrics.eventLoop.latency.toFixed(1)}ms latency`,
      false,
      'Review long-running synchronous operations'
    );

    setCooldown('eventloop');

    // Log for investigation but can't auto-fix
    logger.warn('Event loop blocked - investigate long-running operations', {
      latency: metrics.eventLoop.latency,
    });

    debugEventEmitter.emitDebugEvent('healing', {
      action: 'alert',
      issue,
      note: 'Event loop blocking requires manual investigation',
    });
  }
};

/**
 * Circuit breaker recovery
 */
export const attemptCircuitBreakerRecovery = async (name: string): Promise<boolean> => {
  const breaker = circuitBreakers.get(name);
  if (!breaker || breaker.state !== 'open') return false;

  const issue = registerHealthIssue(
    'warning',
    'network',
    `Circuit breaker ${name} is open`,
    true,
    'Wait for reset timeout or manually reset'
  );

  // Check if reset timeout has passed
  if (breaker.nextAttempt && new Date() >= new Date(breaker.nextAttempt)) {
    breaker.state = 'half_open';
    debugEventEmitter.emitDebugEvent('circuit_breaker', breaker);

    issue.resolved = true;
    issue.resolvedAt = new Date().toISOString();

    return true;
  }

  return false;
};

/**
 * Register circuit breaker for monitoring
 */
export const registerCircuitBreaker = (
  name: string,
  state: CircuitBreakerStatus['state'],
  failures: number,
  resetTimeout: number
): void => {
  const breaker: CircuitBreakerStatus = {
    name,
    state,
    failures,
    successes: 0,
    resetTimeout,
    nextAttempt: state === 'open' ? new Date(Date.now() + resetTimeout).toISOString() : undefined,
  };

  circuitBreakers.set(name, breaker);
  debugEventEmitter.emitDebugEvent('circuit_breaker', breaker);
};

/**
 * Update circuit breaker status
 */
export const updateCircuitBreaker = (
  name: string,
  state: CircuitBreakerStatus['state'],
  success: boolean
): void => {
  const breaker = circuitBreakers.get(name);
  if (!breaker) return;

  breaker.state = state;

  if (success) {
    breaker.successes++;
    breaker.lastSuccess = new Date().toISOString();
  } else {
    breaker.failures++;
    breaker.lastFailure = new Date().toISOString();
  }

  if (state === 'open') {
    breaker.nextAttempt = new Date(Date.now() + breaker.resetTimeout).toISOString();
  }

  debugEventEmitter.emitDebugEvent('circuit_breaker', breaker);
};

/**
 * Get all circuit breakers
 */
export const getCircuitBreakers = (): CircuitBreakerStatus[] => {
  return Array.from(circuitBreakers.values());
};

/**
 * Get all health issues
 */
export const getHealthIssues = (includeResolved = false): HealthIssue[] => {
  return Array.from(healthIssues.values())
    .filter((i) => includeResolved || !i.resolved)
    .sort((a, b) => new Date(b.detectedAt).getTime() - new Date(a.detectedAt).getTime());
};

/**
 * Get healing actions history
 */
export const getHealingActions = (limit = 50): HealingAction[] => {
  return healingActions.slice(-limit);
};

/**
 * Resolve a health issue manually
 */
export const resolveHealthIssue = (id: string): boolean => {
  const issue = healthIssues.get(id);
  if (!issue) return false;

  issue.resolved = true;
  issue.resolvedAt = new Date().toISOString();
  return true;
};

/**
 * Run all automatic healing checks
 */
export const runHealingChecks = async (): Promise<void> => {
  try {
    await Promise.all([
      healMemoryPressure(),
      healDatabaseConnection(),
      healEventLoop(),
    ]);

    // Check all registered circuit breakers
    for (const [name] of circuitBreakers) {
      await attemptCircuitBreakerRecovery(name);
    }
  } catch (error) {
    logger.error('Error during healing checks', { error: (error as Error).message });
    trackError(error as Error, 'uncaught', { source: 'self_healing' });
  }
};

// Auto-healing interval
let healingInterval: NodeJS.Timeout | null = null;

/**
 * Start automatic self-healing
 */
export const startSelfHealing = (intervalMs = 30000): void => {
  if (healingInterval) return;

  logger.info('Starting self-healing engine');
  healingInterval = setInterval(runHealingChecks, intervalMs);
  runHealingChecks(); // Run immediately
};

/**
 * Stop automatic self-healing
 */
export const stopSelfHealing = (): void => {
  if (healingInterval) {
    clearInterval(healingInterval);
    healingInterval = null;
    logger.info('Stopped self-healing engine');
  }
};

/**
 * Get self-healing status
 */
export const getSelfHealingStatus = (): {
  enabled: boolean;
  activeIssues: number;
  resolvedIssues: number;
  actionsExecuted: number;
  successfulActions: number;
  failedActions: number;
  circuitBreakers: CircuitBreakerStatus[];
} => {
  const issues = Array.from(healthIssues.values());
  const actions = healingActions;

  return {
    enabled: healingInterval !== null,
    activeIssues: issues.filter((i) => !i.resolved).length,
    resolvedIssues: issues.filter((i) => i.resolved).length,
    actionsExecuted: actions.length,
    successfulActions: actions.filter((a) => a.status === 'success').length,
    failedActions: actions.filter((a) => a.status === 'failed').length,
    circuitBreakers: getCircuitBreakers(),
  };
};

// Auto-start self-healing
startSelfHealing();
