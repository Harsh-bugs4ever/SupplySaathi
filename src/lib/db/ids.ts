import { randomBytes, createHash, randomUUID } from 'node:crypto';

export function newId(prefix: string): string {
  return `${prefix}_${randomBytes(9).toString('base64url')}`;
}

export function uuid(): string {
  return randomUUID();
}

/**
 * Short, unambiguous case reference a business owner can say out loud.
 * Excludes characters that get confused when read back (0/O, 1/I).
 */
const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
export function newCaseReference(): string {
  const bytes = randomBytes(4);
  let out = '';
  for (let i = 0; i < 4; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return `SS-${out}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

/**
 * The hash an outreach approval actually signs.
 *
 * Recipient, subject and body are all included, so changing any one of them
 * after approval produces a different hash and the pending approval no longer
 * authorises the send.
 */
export function draftContentHash(parts: {
  recipientEmail: string | null;
  subject: string;
  body: string;
}): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        recipient: (parts.recipientEmail ?? '').trim().toLowerCase(),
        subject: parts.subject.trim(),
        body: parts.body.trim(),
      }),
    )
    .digest('hex');
}

/**
 * Idempotency key for an email send.
 *
 * Derived from the approval and the exact content it approved, so a retry, a
 * double-click or a worker restart all produce the same key — and the unique
 * index on `email_attempt.idempotency_key` turns the second send into a no-op.
 */
export function sendIdempotencyKey(approvalId: string, contentHash: string): string {
  return createHash('sha256').update(`${approvalId}:${contentHash}`).digest('hex').slice(0, 32);
}

/**
 * Stable identity for a product across searches, so the same listing found
 * twice collapses into one candidate. Host plus normalised path is enough:
 * query strings on supplier sites are usually tracking noise.
 */
export function dedupeKeyForUrl(rawUrl: string, title: string): string {
  try {
    const u = new URL(rawUrl);
    const path = u.pathname.replace(/\/+$/, '').toLowerCase();
    return `${u.hostname.replace(/^www\./, '')}${path}`;
  } catch {
    return title.toLowerCase().replace(/\s+/g, '-').slice(0, 80);
  }
}
