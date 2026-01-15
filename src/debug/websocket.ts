/**
 * WebSocket Server for Real-time Debug Monitoring
 * Provides live updates for metrics, logs, errors, and system events
 */

import { Server as HttpServer } from 'http';
import { WebSocket, WebSocketServer } from 'ws';
import { debugEventEmitter } from './eventEmitter';
import { collectMetrics, getMetricsHistory, getAverageMetrics } from './metricsCollector';
import { getRecentRequests, getRequestStats, getRouteMetrics, getSlowRequests, getFailedRequests } from './requestTracker';
import { getErrorLogs, getErrorStats } from './errorTracker';
import { getSelfHealingStatus, getHealthIssues, getHealingActions, getCircuitBreakers } from './selfHealing';
import logger from '../utils/logger';

// WebSocket clients
const clients: Set<WebSocket> = new Set();

// Message types
type WSMessageType =
  | 'subscribe'
  | 'unsubscribe'
  | 'get_metrics'
  | 'get_metrics_history'
  | 'get_requests'
  | 'get_errors'
  | 'get_health'
  | 'get_healing_status'
  | 'get_dashboard_state'
  | 'ping';

interface WSMessage {
  type: WSMessageType;
  payload?: unknown;
}

interface WSResponse {
  type: string;
  payload: unknown;
  timestamp: string;
}

/**
 * Create response object
 */
const createResponse = (type: string, payload: unknown): WSResponse => ({
  type,
  payload,
  timestamp: new Date().toISOString(),
});

/**
 * Broadcast message to all connected clients
 */
const broadcast = (message: WSResponse): void => {
  const data = JSON.stringify(message);
  clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  });
};

/**
 * Send message to specific client
 */
const sendToClient = (client: WebSocket, message: WSResponse): void => {
  if (client.readyState === WebSocket.OPEN) {
    client.send(JSON.stringify(message));
  }
};

/**
 * Handle incoming WebSocket messages
 */
const handleMessage = async (client: WebSocket, data: string): Promise<void> => {
  try {
    const message: WSMessage = JSON.parse(data);

    switch (message.type) {
      case 'ping':
        sendToClient(client, createResponse('pong', { serverTime: Date.now() }));
        break;

      case 'get_metrics':
        sendToClient(client, createResponse('metrics', collectMetrics()));
        break;

      case 'get_metrics_history':
        const limit = (message.payload as { limit?: number })?.limit || 60;
        sendToClient(client, createResponse('metrics_history', {
          history: getMetricsHistory(limit),
          averages: getAverageMetrics(5),
        }));
        break;

      case 'get_requests':
        const requestFilter = message.payload as { limit?: number; filter?: Record<string, unknown> };
        sendToClient(client, createResponse('requests', {
          recent: getRecentRequests(requestFilter?.limit || 100, requestFilter?.filter as any),
          stats: getRequestStats(5),
          routes: getRouteMetrics(),
          slow: getSlowRequests(),
          failed: getFailedRequests(),
        }));
        break;

      case 'get_errors':
        const errorPayload = message.payload as { type?: string; resolved?: boolean } | undefined;
        const errorFilter: { type?: 'uncaught' | 'unhandled' | 'api' | 'database' | 'scraper' | 'ai' | 'messenger' | 'session'; resolved?: boolean } = {};
        if (errorPayload?.type) {
          errorFilter.type = errorPayload.type as any;
        }
        if (errorPayload?.resolved !== undefined) {
          errorFilter.resolved = errorPayload.resolved;
        }
        sendToClient(client, createResponse('errors', {
          logs: getErrorLogs(errorFilter),
          stats: getErrorStats(),
        }));
        break;

      case 'get_health':
        sendToClient(client, createResponse('health_issues', {
          issues: getHealthIssues(true),
          circuitBreakers: getCircuitBreakers(),
        }));
        break;

      case 'get_healing_status':
        sendToClient(client, createResponse('healing_status', {
          status: getSelfHealingStatus(),
          actions: getHealingActions(50),
        }));
        break;

      case 'get_dashboard_state':
        sendToClient(client, createResponse('dashboard_state', {
          metrics: collectMetrics(),
          metricsHistory: getMetricsHistory(30),
          averages: getAverageMetrics(5),
          requests: {
            recent: getRecentRequests(50),
            stats: getRequestStats(5),
            slow: getSlowRequests(),
            failed: getFailedRequests(),
          },
          errors: {
            logs: getErrorLogs(),
            stats: getErrorStats(),
          },
          healing: {
            status: getSelfHealingStatus(),
            issues: getHealthIssues(),
            actions: getHealingActions(20),
          },
          circuitBreakers: getCircuitBreakers(),
        }));
        break;

      default:
        sendToClient(client, createResponse('error', { message: `Unknown message type: ${message.type}` }));
    }
  } catch (error) {
    logger.error('WebSocket message handling error', { error: (error as Error).message });
    sendToClient(client, createResponse('error', { message: 'Invalid message format' }));
  }
};

/**
 * Initialize WebSocket server
 */
export const initializeWebSocket = (server: HttpServer): WebSocketServer => {
  const wss = new WebSocketServer({
    server,
    path: '/debug/ws',
  });

  wss.on('connection', (ws: WebSocket, req) => {
    logger.info('Debug WebSocket client connected', { ip: req.socket.remoteAddress });
    clients.add(ws);

    // Send initial state
    sendToClient(ws, createResponse('connected', {
      message: 'Connected to debug WebSocket',
      clientCount: clients.size,
    }));

    ws.on('message', (data: Buffer) => {
      handleMessage(ws, data.toString());
    });

    ws.on('close', () => {
      clients.delete(ws);
      logger.info('Debug WebSocket client disconnected', { remainingClients: clients.size });
    });

    ws.on('error', (error) => {
      logger.error('WebSocket error', { error: error.message });
      clients.delete(ws);
    });

    // Send periodic metrics updates
    const metricsInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        sendToClient(ws, createResponse('metrics_update', collectMetrics()));
      } else {
        clearInterval(metricsInterval);
      }
    }, 5000); // Every 5 seconds

    ws.on('close', () => clearInterval(metricsInterval));
  });

  // Subscribe to debug events and broadcast
  debugEventEmitter.subscribeAll((event) => {
    broadcast(createResponse(`event_${event.type}`, event.data));
  });

  logger.info('Debug WebSocket server initialized at /debug/ws');
  return wss;
};

/**
 * Get connected client count
 */
export const getConnectedClients = (): number => {
  return clients.size;
};

/**
 * Broadcast custom message to all clients
 */
export const broadcastMessage = (type: string, payload: unknown): void => {
  broadcast(createResponse(type, payload));
};

/**
 * Close all WebSocket connections
 */
export const closeAllConnections = (): void => {
  clients.forEach((client) => {
    client.close(1000, 'Server shutting down');
  });
  clients.clear();
};
