import 'server-only';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { config } from '../config/env';
import { getDb, migrate } from '../db/client';
import { log } from '../security/redact';
import { hasCredentials } from '../security/auth';

/**
 * Shared route plumbing: input validation, a consistent error envelope, and
 * the auth gate.
 *
 * Every route validates its body with a Zod schema before touching the domain.
 * The rule is that a malformed request produces a 400 with a readable message,
 * never a 500 with a stack trace, and never a partially applied write.
 */

let migrated = false;

/** Ensure the schema exists before the first query in a fresh dev server. */
export function db() {
  const database = getDb();
  if (!migrated) {
    migrate(database);
    migrated = true;
  }
  return database;
}

export function ok<T>(data: T, init?: ResponseInit): NextResponse {
  return NextResponse.json(data, init);
}

export function fail(message: string, status = 400, extra?: Record<string, unknown>): NextResponse {
  return NextResponse.json({ error: message, ...extra }, { status });
}

/**
 * Parse and validate a JSON body.
 * Returns a ready-made 400 response instead of throwing, so routes stay linear.
 */
export async function parseBody<T>(
  req: Request,
  schema: z.ZodType<T>,
): Promise<{ ok: true; data: T } | { ok: false; response: NextResponse }> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return { ok: false, response: fail('Request body must be valid JSON.') };
  }

  const result = schema.safeParse(raw);
  if (!result.success) {
    const detail = result.error.issues
      .slice(0, 6)
      .map((i) => `${i.path.join('.') || 'body'}: ${i.message}`)
      .join('; ');
    return { ok: false, response: fail(`Invalid request: ${detail}`) };
  }
  return { ok: true, data: result.data };
}

/**
 * Password gate for a publicly deployed instance.
 *
 * This app can spend API credits and send email, so a public deployment without
 * a gate is a way to hand strangers your budget. Off by default for local use;
 * `APP_AUTH_ENABLED=true` turns it on.
 */
export function requireAuth(req: Request): NextResponse | null {
  if (!config.auth.enabled) return null;

  if (!config.auth.password) {
    log.error('APP_AUTH_ENABLED is true but APP_AUTH_PASSWORD is empty; refusing all requests.');
    return fail('Server authentication is misconfigured.', 500);
  }

  if (hasCredentials(req, config.auth.password)) return null;
  return fail('Authentication required.', 401);
}

/** Wrap a handler so an unexpected throw becomes a clean 500 with a log line. */
export function handler(
  fn: (req: Request, ctx: any) => Promise<NextResponse>,
): (req: Request, ctx: any) => Promise<NextResponse> {
  return async (req, ctx) => {
    const origin = req.headers.get('origin');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && origin && origin !== new URL(req.url).origin && origin !== new URL(config.baseUrl).origin) {
      return fail('Cross-origin requests are not allowed.', 403);
    }
    const auth = requireAuth(req);
    if (auth) return auth;

    try {
      return await fn(req, ctx);
    } catch (err) {
      const e = err as Error;
      log.error(`Unhandled error in ${req.method} ${new URL(req.url).pathname}`, {
        error: e.message,
        stack: e.stack,
      });
      // Never leak internals to the client.
      return fail('Something went wrong handling that request.', 500);
    }
  };
}

/** Next 15 passes route params as a promise. */
export async function paramOf(ctx: { params: Promise<Record<string, string>> }, key: string): Promise<string> {
  const params = await ctx.params;
  return params[key];
}
