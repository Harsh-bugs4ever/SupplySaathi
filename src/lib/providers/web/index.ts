import type { AppConfig } from '../../config/load';
import { log } from '../../security/redact';
import type {
  FetchOutcome,
  ProviderHealth,
  SearchResult,
  WebResearchProvider,
} from '../types';
import { AnakinProvider } from './anakin';
import { FixtureWebProvider } from './fixture';

/**
 * Composite WebResearchProvider.
 *
 * Tries each configured provider in order and falls through on failure, so one
 * provider's outage does not end a research run another could serve. Only
 * Anakin ships today, but the seam is the reason swapping or adding a provider
 * touches nothing outside this directory. Two rules hold it together:
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
    const failures: FetchOutcome[] = [];

    for (const p of this.providers) {
      const outcome = await p.fetchPage(url, opts);
      if (outcome.ok) return outcome;

      failures.push(outcome);
      // A blocked URL or a 404 will fail identically everywhere; only fall
      // through when the failure looks provider-specific.
      if (!outcome.failure.retryable) return outcome;
      log.info(`${p.kind} could not retrieve ${url}; trying next provider.`);
    }

    // Report the most informative failure, not simply the last one. A trailing
    // "not configured" from an unconfigured fallback would otherwise mask the
    // real cause — say, a rate limit — and send the user to fix the wrong thing.
    const informative = failures.find((f) => !isConfigurationFailure(f));
    return informative ?? failures[0];
  }
}

/**
 * A failure caused by the provider having no credentials, rather than by
 * anything about the page. These say nothing useful about why a retrieval
 * failed when another provider actually tried and was rejected.
 */
function isConfigurationFailure(outcome: FetchOutcome): boolean {
  if (outcome.ok) return false;
  return /is not configured|is not set/i.test(outcome.failure.reason);
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

export { AnakinProvider, FixtureWebProvider };
