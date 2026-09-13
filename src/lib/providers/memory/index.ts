import type { AppConfig } from '../../config/load';
import type { Db } from '../../db/client';
import { getDb } from '../../db/client';
import { addNote, listNotes, markNoteSynced } from '../../db/repo';
import type { MemoryItem, MemoryProvider, ProviderHealth } from '../types';
import { CogneeProvider } from './cognee';

/**
 * Local memory, backed by the application database.
 *
 * This is not a cache of Cognee — it is the durable record. Cognee adds
 * semantic recall across many cases; the rows here guarantee that a preference
 * the user typed is never lost because a third-party service was down.
 */
export class LocalMemoryProvider implements MemoryProvider {
  readonly kind = 'local';

  constructor(
    private readonly profileId: string,
    private readonly db: Db = getDb(),
  ) {}

  async health(): Promise<ProviderHealth> {
    return {
      provider: this.kind,
      configured: true,
      checkedAt: new Date().toISOString(),
      capabilities: [
        {
          name: 'memory',
          available: true,
          detail: 'Preferences and supplier notes stored in the local database.',
        },
      ],
    };
  }

  async remember(item: { text: string; kind: MemoryItem['kind']; caseId?: string }): Promise<void> {
    addNote(
      {
        profileId: this.profileId,
        kind: item.kind,
        supplierName: null,
        text: item.text,
        caseId: item.caseId ?? null,
        syncedToMemory: false,
      },
      this.db,
    );
  }

  /**
   * Keyword overlap rather than embeddings. It is crude, but it is predictable
   * and it works offline; Cognee is what provides real semantic recall when it
   * is configured.
   */
  async recall(query: string, limit: number): Promise<MemoryItem[]> {
    const notes = listNotes(this.profileId, this.db);
    const terms = query
      .toLowerCase()
      .split(/\W+/)
      .filter((t) => t.length > 3);

    const scored = notes.map((n) => {
      const hay = n.text.toLowerCase();
      const score = terms.reduce((acc, t) => acc + (hay.includes(t) ? 1 : 0), 0);
      return { note: n, score };
    });

    // Standing preferences apply broadly, so they surface even without an
    // explicit keyword hit; notes about one supplier need a reason to appear.
    return scored
      .filter((s) => s.score > 0 || s.note.kind === 'preference')
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(({ note }) => ({
        id: note.id,
        text: note.text,
        kind: note.kind,
        source: 'local' as const,
      }));
  }
}

/**
 * Composite memory.
 *
 * Writes go to both stores; the local write is what must succeed. Reads merge
 * both and de-duplicate, so a preference recorded before Cognee was configured
 * still shows up.
 */
export class CompositeMemoryProvider implements MemoryProvider {
  readonly kind = 'cognee+local';

  constructor(
    private readonly local: LocalMemoryProvider,
    private readonly remote: CogneeProvider | null,
  ) {}

  async health(): Promise<ProviderHealth> {
    if (!this.remote) return this.local.health();
    const remote = await this.remote.health();
    const local = await this.local.health();
    return {
      provider: this.kind,
      configured: true,
      checkedAt: new Date().toISOString(),
      capabilities: [
        ...remote.capabilities.map((c) => ({ ...c, name: `cognee:${c.name}` })),
        ...local.capabilities.map((c) => ({ ...c, name: `local:${c.name}` })),
      ],
      error: remote.error,
    };
  }

  async remember(item: { text: string; kind: MemoryItem['kind']; caseId?: string }): Promise<void> {
    await this.local.remember(item);
    if (this.remote) await this.remote.remember(item);
  }

  async recall(query: string, limit: number): Promise<MemoryItem[]> {
    const [local, remote] = await Promise.all([
      this.local.recall(query, limit),
      this.remote ? this.remote.recall(query, limit) : Promise.resolve([]),
    ]);

    const seen = new Set<string>();
    const merged: MemoryItem[] = [];
    for (const item of [...local, ...remote]) {
      const key = item.text.trim().toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(item);
    }
    return merged.slice(0, limit);
  }

  /** True when Cognee is configured but not currently answering. */
  async remoteUnavailable(): Promise<boolean> {
    if (!this.remote) return false;
    const h = await this.remote.health();
    return !h.capabilities.some((c) => c.available);
  }
}

export function createMemoryProvider(
  cfg: AppConfig,
  profileId: string,
  db: Db = getDb(),
): CompositeMemoryProvider {
  const local = new LocalMemoryProvider(profileId, db);
  const remote =
    cfg.cognee.apiKey && cfg.cognee.baseUrl ? new CogneeProvider(cfg.cognee) : null;
  return new CompositeMemoryProvider(local, remote);
}

export { CogneeProvider };
