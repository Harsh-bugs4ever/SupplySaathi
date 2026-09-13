import { postJson, getJson, HttpError } from '../http';
import { checkUrl } from '../../security/urlGuard';
import { enforceByteLimit, sanitizePageContent } from '../../security/sanitize';
import { log } from '../../security/redact';
import type {
  FetchOutcome,
  ProviderCapability,
  ProviderHealth,
  SearchResult,
  WebResearchProvider,
} from '../types';

/**
 * Bright Data WebResearchProvider (fallback).
 *
 * API surface verified against https://docs.brightdata.com:
 *   POST https://api.brightdata.com/request  { zone, url, format: 'raw' }
 *   Authorization: Bearer <key>
 *   SERP results as JSON by appending `brd_json=json` to the target search URL.
 *
 * Zones matter here. A Web Unlocker zone retrieves pages; a SERP zone runs
 * searches; having one does not give you the other. `health()` probes the
 * account's active zones and reports which of the two configured zone names
 * actually exist, rather than discovering it mid-run.
 */

export interface BrightDataConfig {
  apiKey: string;
  unlockerZone: string;
  serpZone: string;
  timeoutMs: number;
  maxPageBytes: number;
}

interface ActiveZone {
  name?: string;
  type?: string;
}

export class BrightDataProvider implements WebResearchProvider {
  readonly kind = 'brightdata';

  constructor(private readonly cfg: BrightDataConfig) {}

  private headers(): Record<string, string> {
    return { Authorization: `Bearer ${this.cfg.apiKey}` };
  }

  async health(): Promise<ProviderHealth> {
    const checkedAt = new Date().toISOString();

    if (!this.cfg.apiKey) {
      return {
        provider: this.kind,
        configured: false,
        checkedAt,
        capabilities: [
          { name: 'page_retrieval', available: false, detail: 'BRIGHTDATA_API_KEY is not set.' },
          { name: 'search', available: false, detail: 'BRIGHTDATA_API_KEY is not set.' },
        ],
      };
    }

    const capabilities: ProviderCapability[] = [];

    try {
      const zones = await getJson<ActiveZone[]>(
        'https://api.brightdata.com/zone/get_active_zones',
        this.headers(),
        { timeoutMs: 20_000, label: 'Bright Data zones' },
      );
      const names = new Set((zones ?? []).map((z) => z.name).filter(Boolean) as string[]);

      capabilities.push({
        name: 'page_retrieval',
        available: Boolean(this.cfg.unlockerZone && names.has(this.cfg.unlockerZone)),
        detail: !this.cfg.unlockerZone
          ? 'BRIGHTDATA_UNLOCKER_ZONE is not set.'
          : names.has(this.cfg.unlockerZone)
            ? `Zone "${this.cfg.unlockerZone}" is active.`
            : `Zone "${this.cfg.unlockerZone}" was not found on this account. Active zones: ${[...names].join(', ') || 'none'}.`,
      });

      capabilities.push({
        name: 'search',
        available: Boolean(this.cfg.serpZone && names.has(this.cfg.serpZone)),
        detail: !this.cfg.serpZone
          ? 'BRIGHTDATA_SERP_ZONE is not set. Search falls back to the curated catalogue.'
          : names.has(this.cfg.serpZone)
            ? `SERP zone "${this.cfg.serpZone}" is active.`
            : `SERP zone "${this.cfg.serpZone}" was not found on this account.`,
      });

      return { provider: this.kind, configured: true, capabilities, checkedAt };
    } catch (err) {
      const e = err as HttpError;
      // Not being able to list zones does not prove the zones are unusable, so
      // we report it as unverified rather than as a definite failure.
      return {
        provider: this.kind,
        configured: true,
        checkedAt,
        error: e.message,
        capabilities: [
          {
            name: 'page_retrieval',
            available: Boolean(this.cfg.unlockerZone),
            detail: `Could not list zones (${e.message}). Configured zone "${this.cfg.unlockerZone}" will be tried on demand.`,
          },
          {
            name: 'search',
            available: Boolean(this.cfg.serpZone),
            detail: `Could not list zones. SERP zone "${this.cfg.serpZone || 'not set'}" unverified.`,
          },
        ],
      };
    }
  }

  async search(query: string, limit: number): Promise<SearchResult[] | null> {
    if (!this.cfg.apiKey || !this.cfg.serpZone) return null;

    const target = `https://www.google.com/search?q=${encodeURIComponent(query)}&num=${Math.min(limit, 20)}&brd_json=json`;

    try {
      const res = await postJson<any>(
        'https://api.brightdata.com/request',
        { zone: this.cfg.serpZone, url: target, format: 'raw' },
        this.headers(),
        { timeoutMs: this.cfg.timeoutMs, retries: 1, label: 'Bright Data SERP' },
      );

      // brd_json returns the parsed SERP; organic results carry link/title/description.
      const organic: any[] = res?.organic ?? res?.results?.organic ?? [];
      return organic
        .map((o) => ({
          url: o.link ?? o.url ?? '',
          title: o.title ?? '',
          snippet: o.description ?? o.snippet ?? '',
        }))
        .filter((r) => r.url && checkUrl(r.url).ok)
        .slice(0, limit);
    } catch (err) {
      log.warn('Bright Data SERP failed', { error: (err as Error).message });
      return null;
    }
  }

  async fetchPage(url: string): Promise<FetchOutcome> {
    const attemptedAt = new Date().toISOString();
    const guard = checkUrl(url);
    if (!guard.ok) {
      return {
        ok: false,
        failure: { url, reason: guard.reason!, attemptedAt, provider: this.kind, retryable: false },
      };
    }
    if (!this.cfg.apiKey || !this.cfg.unlockerZone) {
      return {
        ok: false,
        failure: {
          url,
          reason: 'Bright Data is not configured (API key or Web Unlocker zone missing).',
          attemptedAt,
          provider: this.kind,
          retryable: false,
        },
      };
    }

    try {
      // `format: 'raw'` returns the page body as text, so this call is not JSON
      // and cannot go through postJson.
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.cfg.timeoutMs);
      let body: string;
      try {
        const res = await fetch('https://api.brightdata.com/request', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...this.headers() },
          body: JSON.stringify({ zone: this.cfg.unlockerZone, url: guard.normalized, format: 'raw' }),
          signal: controller.signal,
        });
        body = await res.text();
        if (!res.ok) {
          return {
            ok: false,
            failure: {
              url,
              reason: `Bright Data returned HTTP ${res.status} while retrieving this page. The page was not read.`,
              attemptedAt,
              provider: this.kind,
              retryable: res.status >= 500 || res.status === 429,
            },
          };
        }
      } finally {
        clearTimeout(timer);
      }

      if (!body.trim()) {
        return {
          ok: false,
          failure: {
            url,
            reason: 'The page returned no content.',
            attemptedAt,
            provider: this.kind,
            retryable: true,
          },
        };
      }

      const bounded = enforceByteLimit(body, this.cfg.maxPageBytes);
      const sanitized = sanitizePageContent(htmlToText(bounded.body));

      return {
        ok: true,
        page: {
          url: guard.normalized!,
          markdown: sanitized.text,
          title: (body.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1] ?? '').trim() || null,
          retrievedAt: attemptedAt,
          provider: this.kind,
          truncated: bounded.truncated || sanitized.truncated,
          injectionFlags: sanitized.injectionFlags,
        },
      };
    } catch (err) {
      const e = err as Error;
      return {
        ok: false,
        failure: {
          url,
          reason:
            e.name === 'AbortError'
              ? `Retrieval timed out after ${this.cfg.timeoutMs}ms. The page was not read.`
              : `${e.message}. This is a retrieval failure, not evidence about the product.`,
          attemptedAt,
          provider: this.kind,
          retryable: true,
        },
      };
    }
  }
}

/**
 * Bright Data's raw format returns HTML. We reduce it to text here so that the
 * rest of the system only ever handles one content shape, and so raw HTML never
 * reaches the extraction prompt or the UI.
 */
function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n');
}
