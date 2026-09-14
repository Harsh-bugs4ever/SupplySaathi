/**
 * Browser-side API client.
 *
 * The UI and the API deploy separately: the interface goes to Vercel, the API
 * and the agent worker stay on one Render instance beside the SQLite file.
 *
 * Requests are made to a *relative* path on purpose. Vercel rewrites `/api/*`
 * to the Render service at the platform edge, which means:
 *
 *   - the browser only ever talks to one origin, so there is no CORS to
 *     configure and no preflight on every call;
 *   - HTTP Basic auth works, because the browser sees a single origin and
 *     replays credentials to it;
 *   - no API hostname or credential is ever compiled into the client bundle.
 *
 * Set NEXT_PUBLIC_API_BASE_URL only if you deliberately want the browser to
 * call the API host directly. That reintroduces CORS and cross-origin auth, so
 * it is off by default.
 */

const BASE = (process.env.NEXT_PUBLIC_API_BASE_URL ?? '').replace(/\/+$/, '');

export function apiUrl(path: string): string {
  const clean = path.startsWith('/') ? path : `/${path}`;
  return BASE ? `${BASE}${clean}` : clean;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly payload?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
}

export async function api<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const res = await fetch(apiUrl(path), {
    method: opts.method ?? 'GET',
    headers: opts.body ? { 'Content-Type': 'application/json' } : undefined,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    signal: opts.signal,
    // Carry the auth cookie when the API is on another origin.
    credentials: BASE ? 'include' : 'same-origin',
    cache: 'no-store',
  });

  const text = await res.text();
  let payload: unknown;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { raw: text.slice(0, 300) };
  }

  if (!res.ok) {
    // A 401 from the API means the gate is on and the browser has not
    // authenticated — worth naming, because it otherwise looks like a bug.
    const message =
      res.status === 401
        ? 'Not authorised. Reload the page and enter the workspace password.'
        : ((payload as { error?: string })?.error ??
          `Request failed (${res.status}).`);
    throw new ApiError(message, res.status, payload);
  }

  return payload as T;
}

/** SSE endpoint URL, resolved the same way as everything else. */
export function streamUrl(caseId: string, lastSeq: number): string {
  return apiUrl(`/api/cases/${caseId}/stream?lastSeq=${lastSeq}`);
}
