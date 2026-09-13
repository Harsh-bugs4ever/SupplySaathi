/**
 * Credential redaction for logs.
 *
 * The agent logs a lot: request URLs, provider errors, response bodies on
 * failure. Any of those can carry a key. Everything that reaches a log goes
 * through `redact` first.
 */

const SECRET_KEY_HINTS = [
  'api_key',
  'apikey',
  'api-key',
  'authorization',
  'auth',
  'token',
  'password',
  'passwd',
  'secret',
  'x-api-key',
  'cookie',
  'set-cookie',
];

/** Long opaque strings that look like keys, redacted wherever they appear. */
const TOKEN_SHAPES: RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{16,}\b/g,
  /\bre_[A-Za-z0-9_-]{16,}\b/g,
  /\bBearer\s+[A-Za-z0-9._~+/-]{12,}=*/gi,
  /\b[A-Fa-f0-9]{32,}\b/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, // JWT
];

export function redact(input: unknown): string {
  let s = typeof input === 'string' ? input : safeStringify(input);
  for (const re of TOKEN_SHAPES) s = s.replace(re, '[redacted]');
  return s;
}

export function redactObject<T>(obj: T): T {
  return JSON.parse(redact(safeStringify(obj))) as T;
}

function safeStringify(v: unknown): string {
  const seen = new WeakSet<object>();
  return JSON.stringify(
    v,
    (key, value) => {
      if (SECRET_KEY_HINTS.includes(key.toLowerCase())) return '[redacted]';
      if (typeof value === 'object' && value !== null) {
        if (seen.has(value as object)) return '[circular]';
        seen.add(value as object);
      }
      return value;
    },
    0,
  ) ?? String(v);
}

/** Console logger that redacts every argument. Used by providers and worker. */
export const log = {
  info: (msg: string, meta?: unknown) =>
    console.log(`[supplysaathi] ${msg}${meta ? ` ${redact(meta)}` : ''}`),
  warn: (msg: string, meta?: unknown) =>
    console.warn(`[supplysaathi] ${msg}${meta ? ` ${redact(meta)}` : ''}`),
  error: (msg: string, meta?: unknown) =>
    console.error(`[supplysaathi] ${msg}${meta ? ` ${redact(meta)}` : ''}`),
};
