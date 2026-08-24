import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    exclude: ['test/integration/**'],
    setupFiles: ['./src/test/setup.ts'],
    env: {
      // Isolate test runs from any developer `.env`: pinned, predictable, quiet.
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      // JWT_SECRET became required in Sprint 2B M3 (env.ts validates it at
      // import time); tests pin a fixed value so runs are deterministic.
      JWT_SECRET: 'test-only-jwt-secret-0123456789abcdef0123456789abcdef',
    },
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.d.ts', 'src/test/**'],
    },
    // Integration tests are in a separate config/workspace
    testTimeout: 30_000,
  },
});
