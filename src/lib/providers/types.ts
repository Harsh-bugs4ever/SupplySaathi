/**
 * Provider ports.
 *
 * Domain logic depends only on these interfaces. Swapping DeepSeek for another
 * model, or Anakin for another web provider, must not require a change outside
 * `lib/providers/`. That is also what makes demo mode honest: the fixture
 * implementations satisfy the same contract, so the agent runs the same code
 * path either way.
 */

// ── Capability probing ──────────────────────────────────────────────────────

/**
 * What a provider can actually do with the configured credentials.
 *
 * Probed, never assumed. A scraping subscription does not imply search access,
 * and discovering that at run time inside a research loop is too late.
 */
export interface ProviderCapability {
  name: string;
  available: boolean;
  /** User-facing sentence explaining an unavailable capability. */
  detail: string;
}

export interface ProviderHealth {
  provider: string;
  configured: boolean;
  capabilities: ProviderCapability[];
  checkedAt: string;
  error?: string;
}

// ── ReasoningProvider ───────────────────────────────────────────────────────

export interface ReasoningRequest<T> {
  /** Stable name used in logs and in the research timeline. */
  task: string;
  system: string;
  user: string;
  /** JSON Schema the response must satisfy. Validated before it is trusted. */
  schemaName: string;
  validate: (raw: unknown) => { ok: true; value: T } | { ok: false; error: string };
  maxTokens?: number;
  temperature?: number;
}

export interface ReasoningResult<T> {
  value: T;
  raw: string;
  model: string;
  /** True when a schema violation forced a retry. */
  retried: boolean;
}

export interface ReasoningProvider {
  readonly kind: string;
  health(): Promise<ProviderHealth>;
  complete<T>(req: ReasoningRequest<T>): Promise<ReasoningResult<T>>;
}

// ── WebResearchProvider ─────────────────────────────────────────────────────

export interface SearchResult {
  url: string;
  title: string;
  snippet: string;
}

export interface FetchedPage {
  url: string;
  /** Cleaned markdown. Raw HTML is never returned to domain code or the UI. */
  markdown: string;
  title: string | null;
  /** When the content was actually retrieved. Drives "last checked" in the UI. */
  retrievedAt: string;
  provider: string;
  truncated: boolean;
  /** Set when the page contained agent-directed text. */
  injectionFlags: string[];
}

export interface FetchFailure {
  url: string;
  /** User-facing reason. Never phrased as "product unavailable". */
  reason: string;
  attemptedAt: string;
  provider: string;
  retryable: boolean;
}

export type FetchOutcome =
  | { ok: true; page: FetchedPage }
  | { ok: false; failure: FetchFailure };

export interface WebResearchProvider {
  readonly kind: string;
  health(): Promise<ProviderHealth>;
  /** Null return means this provider has no search capability configured. */
  search(query: string, limit: number): Promise<SearchResult[] | null>;
  fetchPage(url: string, opts?: { useBrowser?: boolean }): Promise<FetchOutcome>;
}

// ── MemoryProvider ──────────────────────────────────────────────────────────

export interface MemoryItem {
  id: string;
  text: string;
  kind: 'preference' | 'supplier_note' | 'rejection_reason';
  source: 'cognee' | 'local';
}

export interface MemoryProvider {
  readonly kind: string;
  health(): Promise<ProviderHealth>;
  /** Store a fact the user explicitly confirmed. Never called speculatively. */
  remember(item: { text: string; kind: MemoryItem['kind']; caseId?: string }): Promise<void>;
  /**
   * Retrieve context relevant to a brief. Implementations must degrade to an
   * empty list rather than throwing: a memory outage may not block a case.
   */
  recall(query: string, limit: number): Promise<MemoryItem[]>;
}

// ── EmailProvider ───────────────────────────────────────────────────────────

export interface EmailMessage {
  to: string;
  subject: string;
  body: string;
  replyTo?: string;
}

/**
 * Deliberately distinguishes "the provider accepted this" from "it arrived".
 * We can observe the former and cannot observe the latter, so we never claim it.
 */
export type EmailSendResult =
  | { status: 'accepted'; providerMessageId: string | null; response: string }
  | { status: 'failed'; error: string; retryable: boolean }
  | { status: 'unknown'; detail: string };

export interface EmailProvider {
  readonly kind: string;
  health(): Promise<ProviderHealth>;
  /** True when outgoing mail is restricted to an allowlist (demo safety). */
  readonly allowlistActive: boolean;
  readonly allowlist: string[];
  send(msg: EmailMessage, idempotencyKey: string): Promise<EmailSendResult>;
}
