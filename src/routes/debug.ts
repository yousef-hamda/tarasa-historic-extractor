/**
 * Debug API Routes
 * Comprehensive debugging endpoints for the admin dashboard
 */

import { Router, Request, Response } from 'express';
import { collectMetrics, getMetricsHistory, getAverageMetrics, isSystemUnderStress, formatBytes, formatDuration } from '../debug/metricsCollector';
import { getRecentRequests, getRequestStats, getRouteMetrics, getSlowRequests, getFailedRequests } from '../debug/requestTracker';
import { getErrorLogs, getErrorStats, resolveError, clearResolvedErrors, trackError } from '../debug/errorTracker';
import { getSelfHealingStatus, getHealthIssues, getHealingActions, getCircuitBreakers, runHealingChecks, resolveHealthIssue, startSelfHealing, stopSelfHealing } from '../debug/selfHealing';
import { getConnectedClients } from '../debug/websocket';
import { getEventHistory } from '../debug/eventEmitter';
import { runFullDiagnostics, getLastDiagnosticResult, setLastDiagnosticResult, DiagnosticResult } from '../debug/diagnostics';
import logger from '../utils/logger';
import { apiKeyAuth } from '../middleware/apiAuth';

const router = Router();

// Use centralized auth middleware for all debug routes
router.use('/api/debug', apiKeyAuth);

/**
 * GET /api/debug/overview
 * Complete debug dashboard overview
 */
router.get('/api/debug/overview', async (req: Request, res: Response) => {
  try {
    const metrics = collectMetrics();
    const stressStatus = isSystemUnderStress();
    const requestStats = getRequestStats(5);
    const errorStats = getErrorStats();
    const healingStatus = getSelfHealingStatus();

    res.json({
      timestamp: new Date().toISOString(),
      system: {
        metrics,
        stressStatus,
        formatted: {
          memory: `${formatBytes(metrics.memory.used)} / ${formatBytes(metrics.memory.total)}`,
          heapUsage: `${formatBytes(metrics.memory.heapUsed)} / ${formatBytes(metrics.memory.heapTotal)}`,
          uptime: formatDuration(metrics.process.uptime * 1000),
          eventLoopLatency: `${metrics.eventLoop.latency.toFixed(1)}ms`,
        },
      },
      requests: {
        stats: requestStats,
        slowCount: getSlowRequests().length,
        failedCount: getFailedRequests().length,
      },
      errors: {
        stats: errorStats,
        unresolved: getErrorLogs({ resolved: false }).length,
      },
      healing: {
        ...healingStatus,
        activeIssues: getHealthIssues(false),
      },
      websocket: {
        connectedClients: getConnectedClients(),
      },
    });
  } catch (error) {
    logger.error('Debug overview error', { error: (error as Error).message });
    res.status(500).json({ error: 'Failed to get debug overview' });
  }
});

/**
 * GET /api/debug/metrics
 * Current system metrics
 */
router.get('/api/debug/metrics', (req: Request, res: Response) => {
  const metrics = collectMetrics();
  res.json({
    current: metrics,
    formatted: {
      cpu: `${metrics.cpu.usage.toFixed(1)}%`,
      memory: `${metrics.memory.usagePercent.toFixed(1)}%`,
      heap: `${((metrics.memory.heapUsed / metrics.memory.heapTotal) * 100).toFixed(1)}%`,
    },
  });
});

/**
 * GET /api/debug/metrics/history
 * Historical metrics data
 */
router.get('/api/debug/metrics/history', (req: Request, res: Response) => {
  const limit = parseInt(req.query.limit as string) || 60;
  const minutes = parseInt(req.query.minutes as string) || 5;

  res.json({
    history: getMetricsHistory(limit),
    averages: getAverageMetrics(minutes),
  });
});

/**
 * GET /api/debug/requests
 * Request tracking data
 */
router.get('/api/debug/requests', (req: Request, res: Response) => {
  const limit = parseInt(req.query.limit as string) || 100;
  const filter: { method?: string; path?: string; minStatus?: number } = {};

  if (req.query.method) filter.method = req.query.method as string;
  if (req.query.path) filter.path = req.query.path as string;
  if (req.query.minStatus) filter.minStatus = parseInt(req.query.minStatus as string);

  res.json({
    requests: getRecentRequests(limit, Object.keys(filter).length > 0 ? filter : undefined),
    stats: getRequestStats(5),
    routes: getRouteMetrics(),
  });
});

/**
 * GET /api/debug/requests/slow
 * Slow requests
 */
router.get('/api/debug/requests/slow', (req: Request, res: Response) => {
  const threshold = parseInt(req.query.threshold as string) || 1000;
  res.json({
    requests: getSlowRequests(threshold),
    threshold,
  });
});

/**
 * GET /api/debug/requests/failed
 * Failed requests
 */
router.get('/api/debug/requests/failed', (req: Request, res: Response) => {
  const limit = parseInt(req.query.limit as string) || 50;
  res.json({
    requests: getFailedRequests(limit),
  });
});

/**
 * GET /api/debug/errors
 * Error logs
 */
router.get('/api/debug/errors', (req: Request, res: Response) => {
  const type = req.query.type as string | undefined;
  const resolved = req.query.resolved === 'true' ? true : req.query.resolved === 'false' ? false : undefined;

  res.json({
    errors: getErrorLogs({ type: type as any, resolved }),
    stats: getErrorStats(),
  });
});

/**
 * POST /api/debug/errors/:id/resolve
 * Mark error as resolved
 */
router.post('/api/debug/errors/:id/resolve', (req: Request, res: Response) => {
  const { id } = req.params;
  const { resolutionMethod } = req.body;

  const success = resolveError(id, resolutionMethod);

  if (success) {
    res.json({ success: true, message: 'Error resolved' });
  } else {
    res.status(404).json({ error: 'Error not found' });
  }
});

/**
 * DELETE /api/debug/errors/resolved
 * Clear resolved errors
 */
router.delete('/api/debug/errors/resolved', (req: Request, res: Response) => {
  const cleared = clearResolvedErrors();
  res.json({ success: true, cleared });
});

/**
 * GET /api/debug/healing
 * Self-healing status
 */
router.get('/api/debug/healing', (req: Request, res: Response) => {
  res.json({
    status: getSelfHealingStatus(),
    issues: getHealthIssues(req.query.includeResolved === 'true'),
    actions: getHealingActions(parseInt(req.query.limit as string) || 50),
    circuitBreakers: getCircuitBreakers(),
  });
});

/**
 * POST /api/debug/healing/run
 * Manually trigger healing checks
 */
router.post('/api/debug/healing/run', async (req: Request, res: Response) => {
  try {
    await runHealingChecks();
    res.json({ success: true, message: 'Healing checks completed' });
  } catch (error) {
    res.status(500).json({ error: 'Healing checks failed', details: (error as Error).message });
  }
});

/**
 * POST /api/debug/healing/issues/:id/resolve
 * Manually resolve a health issue
 */
router.post('/api/debug/healing/issues/:id/resolve', (req: Request, res: Response) => {
  const { id } = req.params;
  const success = resolveHealthIssue(id);

  if (success) {
    res.json({ success: true, message: 'Issue resolved' });
  } else {
    res.status(404).json({ error: 'Issue not found' });
  }
});

/**
 * POST /api/debug/healing/start
 * Start self-healing engine
 */
router.post('/api/debug/healing/start', (req: Request, res: Response) => {
  const interval = parseInt(req.body.interval) || 30000;
  startSelfHealing(interval);
  res.json({ success: true, message: 'Self-healing started', interval });
});

/**
 * POST /api/debug/healing/stop
 * Stop self-healing engine
 */
router.post('/api/debug/healing/stop', (req: Request, res: Response) => {
  stopSelfHealing();
  res.json({ success: true, message: 'Self-healing stopped' });
});

/**
 * GET /api/debug/circuit-breakers
 * Circuit breaker status
 */
router.get('/api/debug/circuit-breakers', (req: Request, res: Response) => {
  res.json({
    circuitBreakers: getCircuitBreakers(),
  });
});

/**
 * GET /api/debug/events
 * Event history
 */
router.get('/api/debug/events', (req: Request, res: Response) => {
  const type = req.query.type as string | undefined;
  const limit = parseInt(req.query.limit as string) || 100;

  res.json({
    events: getEventHistory(type as any, limit),
  });
});

/**
 * POST /api/debug/gc
 * Trigger garbage collection (if --expose-gc flag is set)
 */
router.post('/api/debug/gc', (req: Request, res: Response) => {
  if (global.gc) {
    const before = process.memoryUsage().heapUsed;
    global.gc();
    const after = process.memoryUsage().heapUsed;
    const freed = before - after;

    res.json({
      success: true,
      before: formatBytes(before),
      after: formatBytes(after),
      freed: formatBytes(freed),
    });
  } else {
    res.status(400).json({
      error: 'Garbage collection not available',
      hint: 'Start Node.js with --expose-gc flag',
    });
  }
});

/**
 * GET /api/debug/stress-test
 * System stress test results
 */
router.get('/api/debug/stress-test', (req: Request, res: Response) => {
  const stress = isSystemUnderStress();
  res.json({
    stressed: stress.stressed,
    reasons: stress.reasons,
    metrics: collectMetrics(),
  });
});

/**
 * GET /api/debug/diagnostics
 * Get last diagnostic result
 */
router.get('/api/debug/diagnostics', (req: Request, res: Response) => {
  const lastResult = getLastDiagnosticResult();
  res.json({
    hasResult: !!lastResult,
    result: lastResult,
  });
});

/**
 * GET /api/debug/diagnostics/stream
 * Run full diagnostics with Server-Sent Events for real-time progress
 */
router.get('/api/debug/diagnostics/stream', async (req: Request, res: Response) => {
  // Set up SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering

  // Send initial connection event
  res.write(`event: connected\ndata: ${JSON.stringify({ status: 'connected' })}\n\n`);

  let lastResult: DiagnosticResult | null = null;

  try {
    // Run diagnostics with progress callback
    const result = await runFullDiagnostics((progress) => {
      lastResult = progress;
      // Send progress update
      res.write(`event: progress\ndata: ${JSON.stringify(progress)}\n\n`);
    });

    // Store result for future retrieval
    setLastDiagnosticResult(result);

    // Send completion event
    res.write(`event: complete\ndata: ${JSON.stringify(result)}\n\n`);
  } catch (error) {
    logger.error('Diagnostics stream error', { error: (error as Error).message });

    // Send error event
    res.write(`event: error\ndata: ${JSON.stringify({
      error: (error as Error).message,
      partialResult: lastResult
    })}\n\n`);
  } finally {
    res.end();
  }
});

/**
 * POST /api/debug/diagnostics/run
 * Run full diagnostics (non-streaming version)
 */
router.post('/api/debug/diagnostics/run', async (req: Request, res: Response) => {
  try {
    const result = await runFullDiagnostics((progress) => {
      // Progress callback - not used in non-streaming version
    });

    setLastDiagnosticResult(result);
    res.json(result);
  } catch (error) {
    logger.error('Diagnostics run error', { error: (error as Error).message });
    res.status(500).json({
      error: 'Diagnostics failed',
      details: (error as Error).message
    });
  }
});

export default router;
