import { describe, expect, it } from 'vitest';
import { hasCredentials } from '@/lib/security/auth';
import { middleware } from '@/middleware';
import { NextRequest } from 'next/server';
import { vi, afterEach } from 'vitest';

afterEach(() => vi.unstubAllEnvs());
describe('deployment password gate', () => {
  it('accepts browser Basic authentication and rejects a wrong password', () => {
    const request = (value: string) => new Request('https://example.com/cases', { headers: { authorization: `Basic ${btoa(value)}` } });
    expect(hasCredentials(request('owner:secret:with:colons'), 'secret:with:colons')).toBe(true);
    expect(hasCredentials(request('owner:wrong'), 'secret')).toBe(false);
    expect(hasCredentials(request('secret'), 'secret')).toBe(false);
  });
  it('rejects missing and malformed credentials', () => {
    expect(hasCredentials(new Request('https://example.com'), '')).toBe(false);
    expect(hasCredentials(new Request('https://example.com', { headers: { authorization: 'Basic !!!' } }), 'secret')).toBe(false);
  });
  it('protects server-rendered pages as well as the API', () => {
    vi.stubEnv('APP_AUTH_ENABLED', 'true');
    vi.stubEnv('APP_AUTH_PASSWORD', 'secret');
    for (const path of ['/cases', '/profile', '/api/cases']) {
      const response = middleware(new NextRequest(`https://example.com${path}`));
      expect(response.status).toBe(401);
      expect(response.headers.get('www-authenticate')).toContain('Basic');
    }
    expect(middleware(new NextRequest('https://example.com/cases', { headers: { authorization: `Basic ${btoa('owner:secret')}` } })).headers.get('x-middleware-next')).toBe('1');
  });
  it('fails closed when enabled without a password', () => {
    vi.stubEnv('APP_AUTH_ENABLED', 'true');
    vi.stubEnv('APP_AUTH_PASSWORD', '');
    expect(middleware(new NextRequest('https://example.com')) .status).toBe(503);
  });
});
