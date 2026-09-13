import { postJson, HttpError } from '../http';
import { checkUrl } from '../../security/urlGuard';
import { enforceByteLimit, sanitizePageContent } from '../../security/sanitize';
import { log } from '../../security/redact';
import type {
  FetchOutcome,
  ProviderHealth,
  SearchResult,
  WebResearchProvider,
} from '../types';

/**
 * Anakin WebResearchProvider (primary).
 *
 * API surface verified against https://anakin.io/docs/api-reference:
 *   POST {baseUrl}/url-scraper/scrape   { url, country, useBrowser, generateJson }
 *   POST {baseUrl}/search               { prompt, limit }
 *   Header: X-API-Key
 *
 * Capability note, confirmed by probing the live endpoints rather than assuming:
 * scrape works on the keyless tier, search requires a key. So a deployment with
 * no Anakin key still retrieves pages; only candidate discovery degrades to the
 * curated supplier catalogue. `health()` reports exactly that split.
 */

interface ScrapeResponse {
  id?: string;
  status?: string;
  url?: string;
  markdown?: string;
  cleanedHtml?: string;
  html?: string;
  error?: string | null;
  completedAt?: string;
  cached?: boolean;
}

interface SearchResponse {
  id?: string;
  results?: Array<{ url?: string; title?: string; snippet?: string }>;
  error?: string;
}

export interface AnakinConfig {
  apiKey: string;
  baseUrl: string;
  country: string;
  useBrowserOnRetry: boolean;
  timeoutMs: number;
  maxPageBytes: number;
}

export class AnakinProvider implements WebResearchProvider {
  readonly kind = 'anakin';

  constructor(private readonly cfg: AnakinConfig) {}

  private headers(): Record<string, string> {
    // The keyless tier is a real, supported mode, so an absent key is not an
    // error here — it simply omits the header.
    return this.cfg.apiKey ? { 'X-API-Key': this.cfg.apiKey } : {};
  }

  async health(): Promise<ProviderHealth> {
    const checkedAt = new Date().toISOString();
    const capabilities = [];

    // Probe scrape with a tiny, stable, well-known page.
    try {
      await postJson<ScrapeResponse>(
        `${this.cfg.baseUrl}/url-scraper/scrape`,
        { url: 'https://example.com', country: this.cfg.country },
        this.headers(),
        { timeoutMs: 30_000, retries: 0, label: 'Anakin scrape health' },
      );
      capabilities.push({
        name: 'page_retrieval',
        available: true,
        detail: this.cfg.apiKey
          ? 'Scrape endpoint responded using the configured API key.'
          : 'Scrape endpoint responded on the keyless tier. Set ANAKIN_API_KEY for higher limits.',
      });
    } catch (err) {
      capabilities.push({
        name: 'page_retrieval',
        available: false,
        detail: `Scrape endpoint unavailable: ${(err as Error).message}`,
      });
    }

    // Probe search separately — access to one endpoint says nothing about the other.
    if (!this.cfg.apiKey) {
      capabilities.push({
        name: 'search',
        available: false,
        detail:
          'Search needs ANAKIN_API_KEY. Without it, candidates come from the curated supplier catalogue and any URLs you supply.',
      });
    } else {
      try {
        await postJson<SearchResponse>(
          `${this.cfg.baseUrl}/search`,
          { prompt: 'packaging supplier', limit: 1 },
          this.headers(),
          { timeoutMs: 30_000, retries: 0, label: 'Anakin search health' },
        );
        capabilities.push({
          name: 'search',
          available: true,
          detail: 'Search endpoint responded.',
        });
      } catch (err) {
        const e = err as HttpError;
        capabilities.push({
          name: 'search',
          available: false,
          detail:
            e.status === 401 || e.status === 403
              ? 'Anakin rejected the API key for search. Falling back to the curated catalogue.'
              : `Search unavailable: ${e.message}`,
        });
      }
    }

    return {
      provider: this.kind,
      configured: true, // usable even without a key
      capabilities,
      checkedAt,
    };
  }

  async search(query: string, limit: number): Promise<SearchResult[] | null> {
    if (!this.cfg.apiKey) return null; // no capability; caller falls back

    try {
      const res = await postJson<SearchResponse>(
        `${this.cfg.baseUrl}/search`,
        { prompt: query, limit: Math.min(limit, 20) },
        this.headers(),
        { timeoutMs: this.cfg.timeoutMs, retries: 1, label: 'Anakin search' },
      );

      return (res.results ?? [])
        .filter((r): r is { url: string; title?: string; snippet?: string } => Boolean(r.url))
        // Search results are attacker-influenced input too: validate before any
        // of these reach the fetcher.
        .filter((r) => checkUrl(r.url).ok)
        .map((r) => ({
          url: r.url,
          title: r.title ?? r.url,
          snippet: r.snippet ?? '',
        }));
    } catch (err) {
      log.warn('Anakin search failed', { error: (err as Error).message });
      return null;
    }
  }

  async fetchPage(url: string, opts?: { useBrowser?: boolean }): Promise<FetchOutcome> {
    const guard = checkUrl(url);
    if (!guard.ok) {
      return {
        ok: false,
        failure: {
          url,
          reason: guard.reason ?? 'URL failed validation.',
          attemptedAt: new Date().toISOString(),
          provider: this.kind,
          retryable: false,
        },
      };
    }

    const attemptedAt = new Date().toISOString();

    try {
      const res = await postJson<ScrapeResponse>(
        `${this.cfg.baseUrl}/url-scraper/scrape`,
        {
          url: guard.normalized,
          country: this.cfg.country,
          useBrowser: opts?.useBrowser ?? false,
          generateJson: false,
        },
        this.headers(),
        { timeoutMs: this.cfg.timeoutMs, retries: 1, label: 'Anakin scrape' },
      );

      // A 202 means the job is still running. We do not poll inside a research
      // round; treating it as a soft failure keeps the time budget honest.
      if (res.status && res.status !== 'completed') {
        return {
          ok: false,
          failure: {
            url,
            reason: `The page was still being retrieved when the request timed out (status: ${res.status}). This tells us nothing about the product itself.`,
            attemptedAt,
            provider: this.kind,
            retryable: true,
          },
        };
      }

      if (res.error) {
        return {
          ok: false,
          failure: {
            url,
            reason: `The supplier page could not be retrieved: ${res.error}. This is a retrieval problem, not evidence about the product.`,
            attemptedAt,
            provider: this.kind,
            retryable: true,
          },
        };
      }

      const rawContent = res.markdown ?? res.cleanedHtml ?? '';
      if (!rawContent.trim()) {
        return {
          ok: false,
          failure: {
            url,
            reason:
              'The page returned no readable content. It may require JavaScript or be behind a login.',
            attemptedAt,
            provider: this.kind,
            retryable: Boolean(this.cfg.useBrowserOnRetry && !opts?.useBrowser),
          },
        };
      }

      const bounded = enforceByteLimit(rawContent, this.cfg.maxPageBytes);
      const sanitized = sanitizePageContent(bounded.body);

      if (sanitized.injectionFlags.length) {
        log.warn('Page contained agent-directed text', {
          url,
          flags: sanitized.injectionFlags,
        });
      }

      return {
        ok: true,
        page: {
          url: guard.normalized!,
          markdown: sanitized.text,
          title: extractTitle(rawContent),
          retrievedAt: res.completedAt ?? attemptedAt,
          provider: this.kind,
          truncated: bounded.truncated || sanitized.truncated,
          injectionFlags: sanitized.injectionFlags,
        },
      };
    } catch (err) {
      const e = err as HttpError;
      return {
        ok: false,
        failure: {
          url,
          reason: describeFetchError(e),
          attemptedAt,
          provider: this.kind,
          retryable: e.retryable ?? true,
        },
      };
    }
  }
}

/**
 * Error text a business owner can act on. Critically, none of these phrasings
 * suggest the product is unavailable — we only failed to read a page.
 */
function describeFetchError(e: HttpError): string {
  if (e.status === 401 || e.status === 403) {
    return 'The retrieval service rejected the request (authentication). No information was read from this page.';
  }
  if (e.status === 429) {
    return 'Rate limit reached while retrieving this page. It was not read.';
  }
  if (e.status === 404) {
    return 'The retrieval service reported this URL as not found. The listing may have moved.';
  }
  if (e.status === null) {
    return `${e.message}. The page was not read; this says nothing about stock or availability.`;
  }
  return `${e.message}. This is a retrieval failure, not evidence about the product.`;
}

function extractTitle(content: string): string | null {
  const h1 = content.match(/^#\s+(.+)$/m);
  if (h1) return h1[1].trim().slice(0, 200);
  const tag = content.match(/<title[^>]*>([^<]+)<\/title>/i);
  if (tag) return tag[1].trim().slice(0, 200);
  return null;
}
