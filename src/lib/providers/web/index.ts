import type { AppConfig } from '../../config/load';
import { log } from '../../security/redact';
import type {
  FetchOutcome,
  ProviderHealth,
  SearchResult,
  WebResearchProvider,
} from '../types';
import { AnakinProvider } from './anakin';
import { BrightDataProvider } from './brightdata';
import { FixtureWebProvider } from './fixture';

/**
 * Composite WebResearchProvider.
 *
 * Tries each configured provider in order and falls through on failure, so a
 * Bright Data outage does not end a research run that Anakin could serve (and
 * vice versa). Two rules hold this together:
 *
 *   1. The provider that actually retrieved a page is recorded on the page, so
 *      the evidence trail says where a fact came from.
 *   2. Demo mode never reaches this class. Falling back from live data to
 *      fixtures would be the worst possible failure mode, so the two are
 *      separated at construction time rather than by a runtime branch.
 */
export class CompositeWebProvider implements WebResearchProvider {
  readonly kind = 'composite';

  constructor(private readonly providers: WebResearchProvider[]) {
    if (!providers.length) {
      throw new Error('CompositeWebProvider needs at least one provider.');
    }
  }

  async health(): Promise<ProviderHealth> {
    const healths = await Promise.all(this.providers.map((p) => p.health()));
    const capabilities = healths.flatMap((h) =>
      h.capabilities.map((c) => ({ ...c, name: `${h.provider}:${c.name}` })),
    );
    return {
      provider: this.providers.map((p) => p.kind).join(' → '),
      configured: healths.some((h) => h.configured),
      capabilities,
      checkedAt: new Date().toISOString(),
    };
  }

  /** Per-provider health, for the Settings page. */
  async healthAll(): Promise<ProviderHealth[]> {
    return Promise.all(this.providers.map((p) => p.health()));
  }

  async search(query: string, limit: number): Promise<SearchResult[] | null> {
    for (const p of this.providers) {
      try {
        const results = await p.search(query, limit);
        // `null` means "no search capability here" — try the next provider.
        if (results && results.length) return results;
      } catch (err) {
        log.warn(`${p.kind} search threw`, { error: (err as Error).message });
      }
    }
    return null;
  }

  async fetchPage(url: string, opts?: { useBrowser?: boolean }): Promise<FetchOutcome> {
    let lastFailure: FetchOutcome | null = null;

    for (const p of this.providers) {
      const outcome = await p.fetchPage(url, opts);
      if (outcome.ok) return outcome;

      lastFailure = outcome;
      // A blocked URL or a 404 will fail identically everywhere; only fall
      // through when the failure looks provider-specific.
      if (!outcome.failure.retryable) return outcome;
      log.info(`${p.kind} could not retrieve ${url}; trying next provider.`);
    }

    return lastFailure!;
  }
}

/**
 * Build the web provider for a run.
 *
 * Demo mode returns the fixture provider and nothing else — there is no path
 * from here to a live network call, and none from live mode into fixtures.
 */
export function createWebProvider(cfg: AppConfig, mode: 'demo' | 'live'): WebResearchProvider {
  if (mode === 'demo') return new FixtureWebProvider();

  const byName: Record<string, () => WebResearchProvider> = {
    anakin: () =>
      new AnakinProvider({
        apiKey: cfg.anakin.apiKey,
        baseUrl: cfg.anakin.baseUrl,
        country: cfg.anakin.country,
        useBrowserOnRetry: cfg.anakin.useBrowserOnRetry,
        timeoutMs: cfg.anakin.timeoutMs,
        maxPageBytes: cfg.agent.maxPageBytes,
      }),
    brightdata: () =>
      new BrightDataProvider({
        apiKey: cfg.brightData.apiKey,
        unlockerZone: cfg.brightData.unlockerZone,
        serpZone: cfg.brightData.serpZone,
        timeoutMs: cfg.brightData.timeoutMs,
        maxPageBytes: cfg.agent.maxPageBytes,
      }),
  };

  const chosen = cfg.webProviderOrder
    .map((name) => byName[name])
    .filter(Boolean)
    .map((make) => make());

  if (!chosen.length) {
    // Anakin's keyless tier means there is always at least one usable path.
    return byName.anakin();
  }

  return new CompositeWebProvider(chosen);
}

export { AnakinProvider, BrightDataProvider, FixtureWebProvider };
