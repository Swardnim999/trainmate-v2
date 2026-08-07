import { describe, expect, it } from 'vitest';
import { defaultRedirectOrigin } from '../../src/routes/auth.routes.js';
import { AuthService, type Session } from '../../src/services/auth.service.js';

const SESSION: Session = {
  access_token: 'access.abc',
  refresh_token: 'refresh.abc',
  expires_in: 900,
  token_type: 'bearer',
  user: { id: '00000000-0000-4000-8000-000000000001', email: 'user@example.com' },
};

/**
 * The verify-email browser fallback (route-side defaultRedirectOrigin) and the
 * service's own default origin are resolved independently (§6.4). A divergence
 * would silently desync the harmless redirect for stale links — this pins them
 * equal by observing the real service through its public redirect builder.
 */
describe('verify-email default redirect origin stays in sync with AuthService (§6.4)', () => {
  it('route fallback equals the service default in the current env', async () => {
    const service = new AuthService();
    const url = await service.buildVerificationRedirect(undefined, SESSION);
    const serviceDefault = url.slice(0, url.indexOf('/#'));
    expect(defaultRedirectOrigin()).toBe(serviceDefault);
  });
});
