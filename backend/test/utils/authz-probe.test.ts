import { describe, expect, it, vi } from 'vitest';
import { AuthzCanaryProbe } from '../../src/../../monitoring/authz-probe.js';

describe('AuthzCanaryProbe', () => {
  it('passes when endpoints return expected invariant responses', async () => {
    const originalFetch = globalThis.fetch;

    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.endsWith('/health')) {
        return new Response(JSON.stringify({ status: 'ok', uptime: 123 }), { status: 200 });
      }
      if (url.endsWith('/journeys')) {
        return new Response(JSON.stringify({ error: 'UNAUTHORIZED' }), { status: 401 });
      }
      if (url.includes('/profiles/')) {
        return new Response(JSON.stringify({ error: 'UNAUTHORIZED' }), { status: 401 });
      }
      if (url.includes('/conversations/')) {
        return new Response(JSON.stringify({ error: 'UNAUTHORIZED' }), { status: 401 });
      }
      return new Response(null, { status: 404 });
    }) as unknown as typeof fetch;

    try {
      const probe = new AuthzCanaryProbe('http://localhost:3000');
      const { allPassed, results } = await probe.runAllProbes();

      expect(allPassed).toBe(true);
      expect(results.length).toBe(4);
      expect(results.every((r) => r.passed)).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('fails when health endpoint returns unhealthy status', async () => {
    const originalFetch = globalThis.fetch;

    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.endsWith('/health')) {
        return new Response(JSON.stringify({ status: 'error' }), { status: 503 });
      }
      return new Response(JSON.stringify({ error: 'UNAUTHORIZED' }), { status: 401 });
    }) as unknown as typeof fetch;

    try {
      const probe = new AuthzCanaryProbe('http://localhost:3000');
      const { allPassed, results } = await probe.runAllProbes();

      expect(allPassed).toBe(false);
      const healthResult = results.find((r) => r.invariant.includes('Health Endpoint'));
      expect(healthResult?.passed).toBe(false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
