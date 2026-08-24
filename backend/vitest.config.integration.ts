import { defineConfig } from 'vitest/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: __dirname,
  test: {
    environment: 'node',
    include: ['test/integration/**/*.test.ts'],
    setupFiles: ['./test/setup.integration.ts'],
    env: {
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      JWT_SECRET: 'test-only-jwt-secret-0123456789abcdef0123456789abcdef',
      // Override DATABASE_URL for test database
      DATABASE_URL: 'postgresql://trainmate:trainmate_test@localhost:5433/trainmate_test',
    },
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.d.ts', 'src/test/**', 'test/**'],
    },
    testTimeout: 60_000,
    // Run integration tests sequentially to avoid DB contention
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
  },
});
