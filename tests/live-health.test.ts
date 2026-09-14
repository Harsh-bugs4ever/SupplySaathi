import { afterEach, describe, expect, it, vi } from 'vitest';
import { AnakinProvider } from '@/lib/providers/web/anakin';
import { createWebProvider } from '@/lib/providers/web';
import { testConfig } from './helpers';

afterEach(() => vi.unstubAllGlobals());
describe('live connection reporting', () => {
  const provider = () => new AnakinProvider({ apiKey: '', baseUrl: 'https://api.example.com', country: 'in', useBrowserOnRetry: false, timeoutMs: 500, maxPageBytes: 800000 });
  it('does not mistake a successful HTTP response with an upstream error for working retrieval', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: 'failed', error: 'Quota exhausted' }), { status: 200 })));
    const health = await provider().health();
    expect(health.capabilities.find((c) => c.name === 'page_retrieval')?.available).toBe(false);
  });
  it('reports readable keyless retrieval separately from unavailable search', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: 'completed', markdown: '# Real page' }), { status: 200 })));
    const health = await provider().health();
    expect(health.capabilities.find((c) => c.name === 'page_retrieval')?.available).toBe(true);
    expect(health.capabilities.find((c) => c.name === 'search')?.available).toBe(false);
  });
  it('never selects fixture data for a live case, even with no API keys', () => {
    expect(createWebProvider(testConfig(), 'live').kind).not.toBe('fixture');
    expect(createWebProvider(testConfig(), 'demo').kind).toBe('fixture');
  });
});
