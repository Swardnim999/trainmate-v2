import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    setupFiles: ['./src/test/setup.ts'],
    env: {
      // Isolate test runs from any developer `.env`: pinned, predictable, quiet.
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
    },
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.d.ts', 'src/test/**'],
    },
  },
});
