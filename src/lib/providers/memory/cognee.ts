import { postJson, HttpError } from '../http';
import { log } from '../../security/redact';
import type { MemoryItem, MemoryProvider, ProviderHealth } from '../types';

/**
 * Cognee MemoryProvider.
 *
 * API surface verified against https://docs.cognee.ai/api-reference:
 *   POST {baseUrl}/api/v1/add       ingest text into a dataset
 *   POST {baseUrl}/api/v1/cognify   build the knowledge graph over it
 *   POST {baseUrl}/api/v1/search    { query, search_type }
 *   Header: X-Api-Key
 *
 * Cognee holds contextual memory only — standing preferences, past supplier
 * experience, why something was rejected. Case state, quantities, deadlines,
 * approvals and send records stay in SQLite, which is the transactional source
 * of truth. Losing Cognee must degrade the experience, never the record.
 *
 * Accordingly every method here swallows its errors and reports unavailability
 * rather than throwing into the agent loop.
 */

export interface CogneeConfig {
  apiKey: string;
  baseUrl: string;
  dataset: string;
  timeoutMs: number;
}

interface SearchResponse {
  result?: unknown;
  results?: unknown;
  search_result?: unknown;
}

export class CogneeProvider implements MemoryProvider {
  readonly kind = 'cognee';

  constructor(private readonly cfg: CogneeConfig) {}

  private headers(): Record<string, string> {
    return { 'X-Api-Key': this.cfg.apiKey };
  }

  async health(): Promise<ProviderHealth> {
    const checkedAt = new Date().toISOString();

    if (!this.cfg.apiKey || !this.cfg.baseUrl) {
      return {
        provider: this.kind,
        configured: false,
        checkedAt,
        capabilities: [
          {
            name: 'memory',
            available: false,
            detail:
              'COGNEE_API_KEY or COGNEE_BASE_URL is not set. Preferences are still stored locally; cross-case recall is unavailable.',
          },
        ],
      };
    }

    try {
      await postJson<SearchResponse>(
        `${this.cfg.baseUrl}/api/v1/search`,
        { query: 'health check', search_type: 'CHUNKS', datasets: [this.cfg.dataset] },
        this.headers(),
        { timeoutMs: Math.min(this.cfg.timeoutMs, 20_000), retries: 0, label: 'Cognee health' },
      );
      return {
        provider: this.kind,
        configured: true,
        checkedAt,
        capabilities: [{ name: 'memory', available: true, detail: 'Cognee search responded.' }],
      };
    } catch (err) {
      const e = err as HttpError;
      return {
        provider: this.kind,
        configured: true,
        checkedAt,
        error: e.message,
        capabilities: [
          {
            name: 'memory',
            available: false,
            detail:
              e.status === 401 || e.status === 403
                ? 'Cognee rejected the API key.'
                : `Cognee is not reachable: ${e.message}. Local preferences still apply.`,
          },
        ],
      };
    }
  }

  async remember(item: { text: string; kind: MemoryItem['kind']; caseId?: string }): Promise<void> {
    if (!this.cfg.apiKey || !this.cfg.baseUrl) return;

    // Only explicitly confirmed facts reach this method, and we deliberately
    // store the preference text alone — no contact details, no prices, no
    // anything that would be sensitive sitting in a third-party graph.
    const text = `[${item.kind}] ${item.text}`;

    try {
      await postJson(
        `${this.cfg.baseUrl}/api/v1/add`,
        { data: text, datasetName: this.cfg.dataset },
        this.headers(),
        { timeoutMs: this.cfg.timeoutMs, retries: 1, label: 'Cognee add' },
      );

      // Cognify builds the graph. It is slower and non-critical: if it fails,
      // the text is still stored and will be picked up by a later run.
      await postJson(
        `${this.cfg.baseUrl}/api/v1/cognify`,
        { datasets: [this.cfg.dataset] },
        this.headers(),
        { timeoutMs: this.cfg.timeoutMs, retries: 0, label: 'Cognee cognify' },
      ).catch((err) => {
        log.warn('Cognee cognify did not complete; the note is stored but not yet indexed', {
          error: (err as Error).message,
        });
      });
    } catch (err) {
      log.warn('Cognee add failed; the note remains in the local database', {
        error: (err as Error).message,
      });
    }
  }

  async recall(query: string, limit: number): Promise<MemoryItem[]> {
    if (!this.cfg.apiKey || !this.cfg.baseUrl) return [];

    try {
      const res = await postJson<SearchResponse>(
        `${this.cfg.baseUrl}/api/v1/search`,
        {
          query,
          // CHUNKS returns the stored text rather than a generated answer, which
          // is what we want: memory should surface what the user actually said,
          // not a paraphrase of it.
          search_type: 'CHUNKS',
          datasets: [this.cfg.dataset],
        },
        this.headers(),
        { timeoutMs: this.cfg.timeoutMs, retries: 1, label: 'Cognee search' },
      );

      return normalizeResults(res).slice(0, limit);
    } catch (err) {
      // A memory outage must never fail a sourcing case.
      log.warn('Cognee recall failed; continuing without remembered context', {
        error: (err as Error).message,
      });
      return [];
    }
  }
}

/**
 * Cognee's response shape varies by search type and version, so we accept
 * several shapes rather than pinning one and breaking on upgrade.
 */
function normalizeResults(res: SearchResponse): MemoryItem[] {
  const raw = res.result ?? res.results ?? res.search_result ?? [];
  const list = Array.isArray(raw) ? raw : [raw];

  return list
    .map((entry, i): MemoryItem | null => {
      const text =
        typeof entry === 'string'
          ? entry
          : ((entry as any)?.text ?? (entry as any)?.content ?? (entry as any)?.chunk ?? null);
      if (!text || typeof text !== 'string') return null;

      const kindMatch = text.match(/^\[(preference|supplier_note|rejection_reason)\]\s*/);
      return {
        id: `cognee_${i}`,
        text: kindMatch ? text.slice(kindMatch[0].length) : text,
        kind: (kindMatch?.[1] as MemoryItem['kind']) ?? 'preference',
        source: 'cognee',
      };
    })
    .filter((x): x is MemoryItem => x !== null);
}
