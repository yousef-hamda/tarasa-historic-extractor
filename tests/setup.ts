/**
 * Vitest Test Setup
 *
 * Global setup for all tests including:
 * - Environment variables
 * - Mock configurations
 * - Database setup/teardown
 */

import { beforeAll, afterAll, vi } from 'vitest';

// Set test environment variables
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/tarasa_test';
process.env.REDIS_URL = 'redis://localhost:6379/1';
process.env.OPENAI_API_KEY = 'sk-test-key';
process.env.FB_EMAIL = 'test@example.com';
process.env.FB_PASSWORD = 'testpassword';
process.env.GROUP_IDS = '123456789';
process.env.API_KEY = 'test-api-key';

// Mock external services
vi.mock('../src/config/sentry', () => ({
  initSentry: vi.fn(),
  isSentryEnabled: vi.fn(() => false),
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}));

// Global setup
beforeAll(async () => {
  console.log('🧪 Test suite starting...');
});

// Global teardown
afterAll(async () => {
  console.log('✅ Test suite completed');
});
