import { PrismaClient, Prisma } from '@prisma/client';
import logger from '../utils/logger';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/**
 * Prisma client configuration with proper connection pooling and timeouts.
 *
 * Connection settings are configured via DATABASE_URL query parameters:
 * - connection_limit: Max connections in pool (default: 10)
 * - pool_timeout: Wait time for connection from pool in seconds (default: 10)
 * - connect_timeout: Initial connection timeout in seconds (default: 10)
 *
 * Example DATABASE_URL with pooling:
 * postgresql://user:pass@host:5432/db?connection_limit=20&pool_timeout=10
 */

// Log level configuration
const logLevels: Prisma.LogLevel[] = process.env.NODE_ENV === 'production'
  ? ['warn', 'error']
  : ['query', 'info', 'warn', 'error'];

// Event-based logging for better observability
const logDefinition: Prisma.LogDefinition[] = [
  { level: 'query', emit: 'event' },
  { level: 'info', emit: 'stdout' },
  { level: 'warn', emit: 'stdout' },
  { level: 'error', emit: 'stdout' },
];

export const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    log: process.env.PRISMA_DEBUG === 'true' ? logDefinition : logLevels,
    // Transaction options
    transactionOptions: {
      maxWait: 5000, // 5s max wait for transaction slot
      timeout: 30000, // 30s transaction timeout
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
    },
  });

// Query logging in development (only when PRISMA_DEBUG is enabled)
if (process.env.PRISMA_DEBUG === 'true') {
  // @ts-expect-error - Prisma event typing is complex
  prisma.$on('query', (e: { query: string; params: string; duration: number }) => {
    if (e.duration > 1000) {
      logger.warn(`[Prisma] Slow query (${e.duration}ms): ${e.query.substring(0, 100)}...`);
    }
  });
}

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

/**
 * Check database connectivity with timeout
 * @param timeoutMs - Timeout in milliseconds (default: 5000)
 * @returns true if connected, false otherwise
 */
export const checkDatabaseConnection = async (timeoutMs = 5000): Promise<boolean> => {
  try {
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Database connection timeout')), timeoutMs);
    });

    const queryPromise = prisma.$queryRaw`SELECT 1`;

    await Promise.race([queryPromise, timeoutPromise]);
    return true;
  } catch (error) {
    logger.error(`Database connection check failed: ${(error as Error).message}`);
    return false;
  }
};

/**
 * Execute query with timeout
 * Wraps any Prisma operation with a timeout to prevent hanging queries
 */
export const withQueryTimeout = async <T>(
  operation: Promise<T>,
  timeoutMs = 30000,
  operationName = 'query'
): Promise<T> => {
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error(`${operationName} timed out after ${timeoutMs}ms`)), timeoutMs);
  });

  return Promise.race([operation, timeoutPromise]);
};

/**
 * Gracefully disconnect from database
 */
export const disconnectDatabase = async (): Promise<void> => {
  try {
    await prisma.$disconnect();
    logger.info('Database disconnected successfully');
  } catch (error) {
    logger.error(`Error disconnecting database: ${(error as Error).message}`);
    throw error;
  }
};

/**
 * Get connection pool statistics (if available)
 * Note: Prisma doesn't expose pool stats directly, this is a health check
 */
export const getDatabaseHealth = async (): Promise<{
  connected: boolean;
  responseTimeMs: number;
}> => {
  const start = Date.now();
  const connected = await checkDatabaseConnection();
  const responseTimeMs = Date.now() - start;

  return { connected, responseTimeMs };
};

export default prisma;
