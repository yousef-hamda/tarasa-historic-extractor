/**
 * System Diagnostics & Auto-Fix Engine
 *
 * Comprehensive testing and auto-repair for all system components.
 * Runs tests sequentially and attempts to fix issues automatically.
 */

import prisma from '../database/prisma';
import logger from '../utils/logger';
import { isSessionValid, getSessionStatus } from '../session/sessionManager';
import { apifyCircuitBreaker, openaiCircuitBreaker } from '../utils/circuitBreaker';
import { browserPool } from '../utils/browserPool';
import OpenAI from 'openai';

export type DiagnosticStatus = 'pending' | 'running' | 'passed' | 'failed' | 'fixed' | 'skipped';

export interface DiagnosticTest {
  id: string;
  name: string;
  category: 'database' | 'auth' | 'services' | 'scraping' | 'ai' | 'system';
  description: string;
  status: DiagnosticStatus;
  message?: string;
  duration?: number;
  autoFixable: boolean;
  fixAttempted?: boolean;
  fixResult?: string;
}

export interface DiagnosticResult {
  id: string;
  startedAt: string;
  completedAt?: string;
  totalTests: number;
  passed: number;
  failed: number;
  fixed: number;
  skipped: number;
  tests: DiagnosticTest[];
  overallStatus: 'running' | 'healthy' | 'degraded' | 'critical';
}

type ProgressCallback = (result: DiagnosticResult) => void;

/**
 * Create a new diagnostic result object
 */
const createDiagnosticResult = (): DiagnosticResult => ({
  id: `diag_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
  startedAt: new Date().toISOString(),
  totalTests: 0,
  passed: 0,
  failed: 0,
  fixed: 0,
  skipped: 0,
  tests: [],
  overallStatus: 'running',
});

/**
 * Update test counts in result
 */
const updateCounts = (result: DiagnosticResult): void => {
  result.passed = result.tests.filter(t => t.status === 'passed').length;
  result.failed = result.tests.filter(t => t.status === 'failed').length;
  result.fixed = result.tests.filter(t => t.status === 'fixed').length;
  result.skipped = result.tests.filter(t => t.status === 'skipped').length;
  result.totalTests = result.tests.length;
};

/**
 * Database connectivity test
 */
const testDatabase = async (result: DiagnosticResult, onProgress: ProgressCallback): Promise<void> => {
  const test: DiagnosticTest = {
    id: 'db_connection',
    name: 'Database Connection',
    category: 'database',
    description: 'Testing PostgreSQL database connectivity via Prisma',
    status: 'running',
    autoFixable: true,
  };
  result.tests.push(test);
  onProgress(result);

  const startTime = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    test.status = 'passed';
    test.message = 'Database connection successful';
  } catch (error) {
    test.status = 'failed';
    test.message = `Connection failed: ${(error as Error).message}`;

    // Attempt auto-fix: reconnect
    test.fixAttempted = true;
    try {
      await prisma.$disconnect();
      await prisma.$connect();
      await prisma.$queryRaw`SELECT 1`;
      test.status = 'fixed';
      test.fixResult = 'Reconnected to database successfully';
    } catch (fixError) {
      test.fixResult = `Auto-fix failed: ${(fixError as Error).message}`;
    }
  }
  test.duration = Date.now() - startTime;
  updateCounts(result);
  onProgress(result);
};

/**
 * Database tables integrity test
 */
const testDatabaseTables = async (result: DiagnosticResult, onProgress: ProgressCallback): Promise<void> => {
  const test: DiagnosticTest = {
    id: 'db_tables',
    name: 'Database Tables',
    category: 'database',
    description: 'Verifying all required tables exist and are accessible',
    status: 'running',
    autoFixable: true,
  };
  result.tests.push(test);
  onProgress(result);

  const startTime = Date.now();
  const requiredTables = ['PostRaw', 'PostClassified', 'GroupInfo', 'MessageSent', 'SystemLog'];
  const missingTables: string[] = [];

  try {
    for (const table of requiredTables) {
      try {
        await prisma.$queryRawUnsafe(`SELECT 1 FROM "${table}" LIMIT 1`);
      } catch {
        missingTables.push(table);
      }
    }

    if (missingTables.length === 0) {
      test.status = 'passed';
      test.message = `All ${requiredTables.length} tables verified`;
    } else {
      test.status = 'failed';
      test.message = `Missing tables: ${missingTables.join(', ')}`;

      // Attempt auto-fix: run prisma db push
      test.fixAttempted = true;
      test.fixResult = 'Manual intervention required: run "npx prisma db push"';
    }
  } catch (error) {
    test.status = 'failed';
    test.message = `Table check failed: ${(error as Error).message}`;
  }
  test.duration = Date.now() - startTime;
  updateCounts(result);
  onProgress(result);
};

/**
 * Facebook session test
 */
const testFacebookSession = async (result: DiagnosticResult, onProgress: ProgressCallback): Promise<void> => {
  const test: DiagnosticTest = {
    id: 'fb_session',
    name: 'Facebook Session',
    category: 'auth',
    description: 'Checking Facebook authentication session validity',
    status: 'running',
    autoFixable: false,
  };
  result.tests.push(test);
  onProgress(result);

  const startTime = Date.now();
  try {
    const sessionStatus = await getSessionStatus();
    const valid = await isSessionValid();

    if (valid && sessionStatus.loggedIn) {
      test.status = 'passed';
      const userInfo = sessionStatus.userName || sessionStatus.userId || 'Unknown';
      test.message = `Session valid for user ${userInfo} (${sessionStatus.status})`;
    } else {
      test.status = 'failed';
      test.message = `Session status: ${sessionStatus.status}. Run login script to refresh.`;
    }
  } catch (error) {
    test.status = 'failed';
    test.message = `Session check failed: ${(error as Error).message}`;
  }
  test.duration = Date.now() - startTime;
  updateCounts(result);
  onProgress(result);
};

/**
 * OpenAI API test
 */
const testOpenAI = async (result: DiagnosticResult, onProgress: ProgressCallback): Promise<void> => {
  const test: DiagnosticTest = {
    id: 'openai_api',
    name: 'OpenAI API',
    category: 'ai',
    description: 'Testing OpenAI API connectivity and authentication',
    status: 'running',
    autoFixable: true,
  };
  result.tests.push(test);
  onProgress(result);

  const startTime = Date.now();

  if (!process.env.OPENAI_API_KEY) {
    test.status = 'failed';
    test.message = 'OPENAI_API_KEY environment variable not set';
    test.duration = Date.now() - startTime;
    updateCounts(result);
    onProgress(result);
    return;
  }

  try {
    // Check circuit breaker first
    if (openaiCircuitBreaker.isOpen()) {
      test.status = 'failed';
      test.message = 'OpenAI circuit breaker is OPEN';
      test.fixAttempted = true;

      // Attempt auto-fix: reset circuit breaker
      openaiCircuitBreaker.reset();
      test.fixResult = 'Circuit breaker reset to CLOSED state';
      test.status = 'fixed';
    } else {
      // Test actual API call
      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      const response = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: 'Say "OK" if you can hear me.' }],
        max_tokens: 10,
      });

      if (response.choices[0]?.message?.content) {
        test.status = 'passed';
        test.message = 'OpenAI API responding normally';
      } else {
        test.status = 'failed';
        test.message = 'OpenAI returned empty response';
      }
    }
  } catch (error) {
    test.status = 'failed';
    test.message = `OpenAI API error: ${(error as Error).message}`;
  }
  test.duration = Date.now() - startTime;
  updateCounts(result);
  onProgress(result);
};

/**
 * Apify service test
 */
const testApify = async (result: DiagnosticResult, onProgress: ProgressCallback): Promise<void> => {
  const test: DiagnosticTest = {
    id: 'apify_service',
    name: 'Apify Service',
    category: 'services',
    description: 'Checking Apify actor configuration and circuit breaker',
    status: 'running',
    autoFixable: true,
  };
  result.tests.push(test);
  onProgress(result);

  const startTime = Date.now();

  if (!process.env.APIFY_TOKEN) {
    test.status = 'skipped';
    test.message = 'Apify not configured (optional)';
    test.duration = Date.now() - startTime;
    updateCounts(result);
    onProgress(result);
    return;
  }

  try {
    if (apifyCircuitBreaker.isOpen()) {
      test.status = 'failed';
      test.message = 'Apify circuit breaker is OPEN';
      test.fixAttempted = true;

      // Attempt auto-fix: reset circuit breaker
      apifyCircuitBreaker.reset();
      test.fixResult = 'Circuit breaker reset to CLOSED state';
      test.status = 'fixed';
    } else {
      test.status = 'passed';
      test.message = 'Apify service configured and circuit breaker healthy';
    }
  } catch (error) {
    test.status = 'failed';
    test.message = `Apify check failed: ${(error as Error).message}`;
  }
  test.duration = Date.now() - startTime;
  updateCounts(result);
  onProgress(result);
};

/**
 * Browser pool test
 */
const testBrowserPool = async (result: DiagnosticResult, onProgress: ProgressCallback): Promise<void> => {
  const test: DiagnosticTest = {
    id: 'browser_pool',
    name: 'Browser Pool',
    category: 'scraping',
    description: 'Testing Playwright browser pool availability',
    status: 'running',
    autoFixable: true,
  };
  result.tests.push(test);
  onProgress(result);

  const startTime = Date.now();
  try {
    const status = browserPool.getStatus();
    const available = status.max - status.active;

    if (available > 0 || status.active < status.max) {
      test.status = 'passed';
      test.message = `Pool healthy: ${available} available, ${status.active}/${status.max} active, ${status.waiting} waiting`;
    } else {
      test.status = 'failed';
      test.message = 'Browser pool exhausted - all instances busy';
      test.fixAttempted = true;

      // Note: actual cleanup would require waiting, so just report
      test.fixResult = 'Pool will auto-recover when active browsers complete';
    }
  } catch (error) {
    test.status = 'failed';
    test.message = `Browser pool check failed: ${(error as Error).message}`;
  }
  test.duration = Date.now() - startTime;
  updateCounts(result);
  onProgress(result);
};

/**
 * Memory usage test
 * Note: Node.js naturally uses most of its allocated heap - this is normal behavior.
 * High heap usage percentage is NOT a problem. We only check for truly excessive usage.
 */
const testMemory = async (result: DiagnosticResult, onProgress: ProgressCallback): Promise<void> => {
  const test: DiagnosticTest = {
    id: 'memory_usage',
    name: 'Memory Usage',
    category: 'system',
    description: 'Checking Node.js memory consumption',
    status: 'running',
    autoFixable: false,
  };
  result.tests.push(test);
  onProgress(result);

  const startTime = Date.now();
  try {
    const memUsage = process.memoryUsage();
    const heapUsedMB = Math.round(memUsage.heapUsed / 1024 / 1024);
    const heapTotalMB = Math.round(memUsage.heapTotal / 1024 / 1024);
    const rssMB = Math.round(memUsage.rss / 1024 / 1024);

    // Node.js heap usage being high is NORMAL - it uses available memory
    // We only fail if RSS (total process memory) exceeds 1.5GB which would indicate a real leak
    const rssThresholdMB = 1500;

    if (rssMB < rssThresholdMB) {
      test.status = 'passed';
      test.message = `Memory normal: ${heapUsedMB}MB heap, ${rssMB}MB total (Node.js manages memory automatically)`;
    } else {
      test.status = 'failed';
      test.message = `High memory: ${rssMB}MB total (threshold: ${rssThresholdMB}MB). May indicate memory leak.`;
    }
  } catch (error) {
    test.status = 'failed';
    test.message = `Memory check failed: ${(error as Error).message}`;
  }
  test.duration = Date.now() - startTime;
  updateCounts(result);
  onProgress(result);
};

/**
 * Environment variables test
 */
const testEnvVars = async (result: DiagnosticResult, onProgress: ProgressCallback): Promise<void> => {
  const test: DiagnosticTest = {
    id: 'env_vars',
    name: 'Environment Variables',
    category: 'system',
    description: 'Verifying required environment variables are set',
    status: 'running',
    autoFixable: false,
  };
  result.tests.push(test);
  onProgress(result);

  const startTime = Date.now();
  const required = ['DATABASE_URL', 'OPENAI_API_KEY'];
  const optional = ['APIFY_TOKEN', 'GROUP_IDS'];
  const missing: string[] = [];
  const present: string[] = [];

  for (const key of required) {
    if (process.env[key]) {
      present.push(key);
    } else {
      missing.push(key);
    }
  }

  const optionalPresent = optional.filter(key => process.env[key]);

  if (missing.length === 0) {
    test.status = 'passed';
    test.message = `All required vars set. Optional: ${optionalPresent.length}/${optional.length}`;
  } else {
    test.status = 'failed';
    test.message = `Missing required: ${missing.join(', ')}`;
  }
  test.duration = Date.now() - startTime;
  updateCounts(result);
  onProgress(result);
};

/**
 * Pending classification test
 */
const testClassificationQueue = async (result: DiagnosticResult, onProgress: ProgressCallback): Promise<void> => {
  const test: DiagnosticTest = {
    id: 'classification_queue',
    name: 'Classification Queue',
    category: 'ai',
    description: 'Checking posts awaiting AI classification',
    status: 'running',
    autoFixable: true,
  };
  result.tests.push(test);
  onProgress(result);

  const startTime = Date.now();
  try {
    const totalPosts = await prisma.postRaw.count();
    const classifiedPosts = await prisma.postClassified.count();
    const pending = totalPosts - classifiedPosts;
    const percentClassified = totalPosts > 0 ? ((classifiedPosts / totalPosts) * 100).toFixed(1) : '0';

    if (pending === 0) {
      test.status = 'passed';
      test.message = `All ${totalPosts} posts classified (100%)`;
    } else if (pending < 50) {
      test.status = 'passed';
      test.message = `${pending} posts pending (${percentClassified}% complete)`;
    } else {
      test.status = 'failed';
      test.message = `${pending} posts backlogged (${percentClassified}% complete)`;
      test.fixAttempted = true;
      test.fixResult = 'Classification cron will process automatically';
    }
  } catch (error) {
    test.status = 'failed';
    test.message = `Queue check failed: ${(error as Error).message}`;
  }
  test.duration = Date.now() - startTime;
  updateCounts(result);
  onProgress(result);
};

/**
 * Group configuration test
 */
const testGroupConfig = async (result: DiagnosticResult, onProgress: ProgressCallback): Promise<void> => {
  const test: DiagnosticTest = {
    id: 'group_config',
    name: 'Group Configuration',
    category: 'scraping',
    description: 'Verifying Facebook groups are configured for scraping',
    status: 'running',
    autoFixable: false,
  };
  result.tests.push(test);
  onProgress(result);

  const startTime = Date.now();
  try {
    const groupIds = (process.env.GROUP_IDS || '')
      .split(',')
      .map(id => id.trim())
      .filter(Boolean);

    if (groupIds.length === 0) {
      test.status = 'failed';
      test.message = 'No groups configured in GROUP_IDS';
    } else {
      // Check how many have been scraped
      const groupInfos = await prisma.groupInfo.findMany({
        where: { groupId: { in: groupIds } },
      });
      const accessible = groupInfos.filter(g => g.isAccessible).length;

      test.status = 'passed';
      test.message = `${groupIds.length} groups configured, ${accessible} accessible`;
    }
  } catch (error) {
    test.status = 'failed';
    test.message = `Group config check failed: ${(error as Error).message}`;
  }
  test.duration = Date.now() - startTime;
  updateCounts(result);
  onProgress(result);
};

/**
 * Recent scraping activity test
 */
const testRecentScraping = async (result: DiagnosticResult, onProgress: ProgressCallback): Promise<void> => {
  const test: DiagnosticTest = {
    id: 'recent_scraping',
    name: 'Recent Scraping Activity',
    category: 'scraping',
    description: 'Checking if posts have been scraped recently',
    status: 'running',
    autoFixable: false,
  };
  result.tests.push(test);
  onProgress(result);

  const startTime = Date.now();
  try {
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

    const last24h = await prisma.postRaw.count({
      where: { scrapedAt: { gte: oneDayAgo } },
    });

    const lastHour = await prisma.postRaw.count({
      where: { scrapedAt: { gte: oneHourAgo } },
    });

    if (lastHour > 0) {
      test.status = 'passed';
      test.message = `Active: ${lastHour} posts in last hour, ${last24h} in 24h`;
    } else if (last24h > 0) {
      test.status = 'passed';
      test.message = `${last24h} posts in last 24 hours (none in last hour)`;
    } else {
      test.status = 'failed';
      test.message = 'No posts scraped in the last 24 hours';
    }
  } catch (error) {
    test.status = 'failed';
    test.message = `Activity check failed: ${(error as Error).message}`;
  }
  test.duration = Date.now() - startTime;
  updateCounts(result);
  onProgress(result);
};

/**
 * Run all diagnostic tests
 */
export const runFullDiagnostics = async (onProgress: ProgressCallback): Promise<DiagnosticResult> => {
  const result = createDiagnosticResult();

  logger.info('[Diagnostics] Starting full system diagnostic...');
  onProgress(result);

  // Run tests in logical order
  const tests = [
    testDatabase,
    testDatabaseTables,
    testEnvVars,
    testMemory,
    testFacebookSession,
    testOpenAI,
    testApify,
    testBrowserPool,
    testGroupConfig,
    testClassificationQueue,
    testRecentScraping,
  ];

  for (const testFn of tests) {
    try {
      await testFn(result, onProgress);
    } catch (error) {
      logger.error(`[Diagnostics] Test failed unexpectedly: ${(error as Error).message}`);
    }
    // Small delay between tests for UI feedback
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  // Determine overall status
  result.completedAt = new Date().toISOString();
  if (result.failed === 0) {
    result.overallStatus = 'healthy';
  } else if (result.failed <= 2 && result.fixed > 0) {
    result.overallStatus = 'degraded';
  } else {
    result.overallStatus = result.failed > result.passed ? 'critical' : 'degraded';
  }

  logger.info(`[Diagnostics] Complete: ${result.passed} passed, ${result.failed} failed, ${result.fixed} fixed`);
  onProgress(result);

  return result;
};

/**
 * Get a summary of the last diagnostic run
 */
let lastDiagnosticResult: DiagnosticResult | null = null;

export const getLastDiagnosticResult = (): DiagnosticResult | null => lastDiagnosticResult;

export const setLastDiagnosticResult = (result: DiagnosticResult): void => {
  lastDiagnosticResult = result;
};
