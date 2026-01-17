import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    // Test environment
    environment: 'node',

    // Global test timeout
    testTimeout: 30000,
    hookTimeout: 30000,

    // Coverage configuration
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      reportsDirectory: './coverage',
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        'src/**/*.spec.ts',
        'src/types/**',
        'src/**/*.d.ts',
      ],
      thresholds: {
        statements: 50,
        branches: 50,
        functions: 50,
        lines: 50,
      },
    },

    // Test file patterns
    include: ['src/**/*.test.ts', 'src/**/*.spec.ts', 'tests/**/*.test.ts'],
    exclude: ['node_modules', 'dist', 'ui'],

    // Setup files
    setupFiles: ['./tests/setup.ts'],

    // Global variables
    globals: true,

    // Reporter
    reporters: ['verbose'],

    // Pool configuration (Vitest 4 format - top-level options)
    pool: 'threads',
    sequence: {
      concurrent: false, // Run tests sequentially for database tests
    },

    // Environment variables
    env: {
      NODE_ENV: 'test',
    },

    // Type checking
    typecheck: {
      enabled: true,
      tsconfig: './tsconfig.json',
    },
  },

  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
