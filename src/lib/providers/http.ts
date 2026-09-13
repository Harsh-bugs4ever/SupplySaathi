import { log, redact } from '../security/redact';

/**
 * Shared HTTP behaviour for every outbound provider call.
 *
 * Timeouts and bounded retries live here rather than in each adapter, so no
 * provider can accidentally hang a research run. Retries are restricted to
 * transient conditions: a 400 means our request was wrong and repeating it just
 * burns the time budget.
 */

export interface HttpOptions {
  timeoutMs: number;
  retries?: number;
  /** Label used in logs. */
  label: string;
}

export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly retryable: boolean,
    readonly bodySnippet?: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

export async function postJson<T>(
  url: string,
  body: unknown,
  headers: Record<string, string>,
  opts: HttpOptions,
): Promise<T> {
  const retries = opts.retries ?? 2;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs);

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      const text = await res.text();

      if (!res.ok) {
        const retryable = RETRYABLE_STATUS.has(res.status);
        const err = new HttpError(
          `${opts.label} returned HTTP ${res.status}`,
          res.status,
          retryable,
          text.slice(0, 400),
        );
        if (!retryable || attempt === retries) throw err;
        lastError = err;
        await backoff(attempt);
        continue;
      }

      return parseJson<T>(text, opts.label);
    } catch (err) {
      const e = err as Error;
      if (e.name === 'AbortError') {
        const timeoutErr = new HttpError(
          `${opts.label} timed out after ${opts.timeoutMs}ms`,
          null,
          true,
        );
        if (attempt === retries) throw timeoutErr;
        lastError = timeoutErr;
        await backoff(attempt);
        continue;
      }
      if (err instanceof HttpError && !err.retryable) throw err;
      if (attempt === retries) throw err;
      lastError = e;
      await backoff(attempt);
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError ?? new Error(`${opts.label} failed`);
}

export async function getJson<T>(
  url: string,
  headers: Record<string, string>,
  opts: HttpOptions,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
  try {
    const res = await fetch(url, { headers, signal: controller.signal });
    const text = await res.text();
    if (!res.ok) {
      throw new HttpError(
        `${opts.label} returned HTTP ${res.status}`,
        res.status,
        RETRYABLE_STATUS.has(res.status),
        text.slice(0, 400),
      );
    }
    return parseJson<T>(text, opts.label);
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      throw new HttpError(`${opts.label} timed out after ${opts.timeoutMs}ms`, null, true);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function parseJson<T>(text: string, label: string): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    log.warn(`${label} returned non-JSON body`, { snippet: redact(text.slice(0, 200)) });
    throw new HttpError(`${label} returned a response that was not valid JSON`, null, false);
  }
}

/** Exponential backoff with jitter, capped so a run cannot stall on retries. */
function backoff(attempt: number): Promise<void> {
  const base = Math.min(1000 * 2 ** attempt, 8000);
  const jitter = Math.random() * 300;
  return new Promise((r) => setTimeout(r, base + jitter));
}
