/**
 * Debug System Index
 * Exports all debugging components for easy integration
 */

// Types
export * from './types';

// Event Emitter
export { debugEventEmitter, emitDebugEvent, subscribeToDebugEvents, getEventHistory } from './eventEmitter';

// Metrics Collection
export {
  collectMetrics,
  getMetricsHistory,
  getAverageMetrics,
  isSystemUnderStress,
  formatBytes,
  formatDuration,
  startMetricsCollection,
  stopMetricsCollection,
  recordMetrics,
} from './metricsCollector';

// Request Tracking
export {
  requestTrackerMiddleware,
  getRecentRequests,
  getRequestById,
  getRouteMetrics,
  getSlowRequests,
  getFailedRequests,
  getRequestStats,
  clearRequestLogs,
} from './requestTracker';

// Error Tracking
export {
  trackError,
  trackUncaughtException,
  trackUnhandledRejection,
  getErrorLogs,
  getErrorById,
  resolveError,
  getErrorStats,
  clearResolvedErrors,
  clearAllErrors,
  setupGlobalErrorHandlers,
} from './errorTracker';

// Self-Healing
export {
  registerHealthIssue,
  executeHealingAction,
  attemptCircuitBreakerRecovery,
  registerCircuitBreaker,
  updateCircuitBreaker,
  getCircuitBreakers,
  getHealthIssues,
  getHealingActions,
  resolveHealthIssue,
  runHealingChecks,
  startSelfHealing,
  stopSelfHealing,
  getSelfHealingStatus,
} from './selfHealing';

// WebSocket
export {
  initializeWebSocket,
  getConnectedClients,
  broadcastMessage,
  closeAllConnections,
} from './websocket';

/**
 * Initialize the complete debug system
 */
export const initializeDebugSystem = (): void => {
  const { setupGlobalErrorHandlers } = require('./errorTracker');
  const { startMetricsCollection } = require('./metricsCollector');
  const { startSelfHealing } = require('./selfHealing');

  // Setup global error handlers
  setupGlobalErrorHandlers();

  // Start metrics collection
  startMetricsCollection();

  // Start self-healing
  startSelfHealing();

  console.log('[Debug System] Initialized successfully');
};
