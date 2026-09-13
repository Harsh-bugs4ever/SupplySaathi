import type { AppConfig } from '../../config/load';
import { postJson, HttpError } from '../http';
import { log } from '../../security/redact';
import type { EmailMessage, EmailProvider, EmailSendResult, ProviderHealth } from '../types';
import { TestEmailProvider } from './test';

/**
 * Email adapters.
 *
 * The distinction this module exists to preserve: a provider ACCEPTING a
 * message is not the same as the message being DELIVERED. We can observe the
 * former. We cannot observe the latter without webhooks we do not have. So the
 * result type stops at "accepted", and the UI says so.
 *
 * A third state matters just as much: "unknown". If a request times out after
 * the provider may already have queued the message, retrying could send the
 * supplier two identical enquiries. That case is recorded as unknown and left
 * for a human to reconcile, never retried automatically.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function isValidEmail(address: string): boolean {
  return EMAIL_RE.test(address.trim());
}

/** Shared allowlist enforcement, applied before any provider is called. */
function checkAllowlist(
  to: string,
  allowlist: string[],
): { ok: true } | { ok: false; result: EmailSendResult } {
  if (!allowlist.length) return { ok: true };
  if (allowlist.includes(to.trim().toLowerCase())) return { ok: true };
  return {
    ok: false,
    result: {
      status: 'failed',
      error:
        `Blocked: outgoing mail is restricted to the test allowlist and "${to}" is not on it. ` +
        `Change EMAIL_ALLOWLIST to send to other recipients.`,
      retryable: false,
    },
  };
}

// ── No provider configured: export only ─────────────────────────────────────

/**
 * The default. Refuses to send and says so clearly, so the UI can offer an .eml
 * download instead. It is important this is not silently treated as success:
 * "we exported a file" and "we contacted the supplier" are different outcomes.
 */
export class NoopEmailProvider implements EmailProvider {
  readonly kind = 'none';
  readonly allowlistActive = false;
  readonly allowlist: string[] = [];

  async health(): Promise<ProviderHealth> {
    return {
      provider: this.kind,
      configured: false,
      checkedAt: new Date().toISOString(),
      capabilities: [
        {
          name: 'send',
          available: false,
          detail:
            'No email provider configured. Quote requests can be downloaded as .eml files or copied, but not sent.',
        },
      ],
    };
  }

  async send(): Promise<EmailSendResult> {
    return {
      status: 'failed',
      error: 'No email provider is configured. Download the .eml file or copy the text instead.',
      retryable: false,
    };
  }
}

// ── SMTP ────────────────────────────────────────────────────────────────────

export class SmtpEmailProvider implements EmailProvider {
  readonly kind = 'smtp';

  constructor(private readonly cfg: AppConfig['email']) {}

  get allowlistActive(): boolean {
    return this.cfg.allowlist.length > 0;
  }
  get allowlist(): string[] {
    return this.cfg.allowlist;
  }

  private async transport() {
    // Imported lazily so the web bundle never pulls in nodemailer.
    const nodemailer = await import('nodemailer');
    return nodemailer.createTransport({
      host: this.cfg.smtp.host,
      port: this.cfg.smtp.port,
      secure: this.cfg.smtp.secure,
      auth: this.cfg.smtp.user ? { user: this.cfg.smtp.user, pass: this.cfg.smtp.pass } : undefined,
    });
  }

  async health(): Promise<ProviderHealth> {
    const checkedAt = new Date().toISOString();
    const missing: string[] = [];
    if (!this.cfg.smtp.host) missing.push('SMTP_HOST');
    if (!this.cfg.fromAddress) missing.push('EMAIL_FROM_ADDRESS');

    if (missing.length) {
      return {
        provider: this.kind,
        configured: false,
        checkedAt,
        capabilities: [
          { name: 'send', available: false, detail: `Missing configuration: ${missing.join(', ')}.` },
        ],
      };
    }

    try {
      const t = await this.transport();
      await t.verify();
      return {
        provider: this.kind,
        configured: true,
        checkedAt,
        capabilities: [
          {
            name: 'send',
            available: true,
            detail: `SMTP connection to ${this.cfg.smtp.host} verified.${
              this.allowlistActive ? ` Restricted to ${this.allowlist.length} allowlisted recipient(s).` : ''
            }`,
          },
        ],
      };
    } catch (err) {
      return {
        provider: this.kind,
        configured: true,
        checkedAt,
        error: (err as Error).message,
        capabilities: [
          { name: 'send', available: false, detail: `SMTP verification failed: ${(err as Error).message}` },
        ],
      };
    }
  }

  async send(msg: EmailMessage): Promise<EmailSendResult> {
    const gate = checkAllowlist(msg.to, this.allowlist);
    if (!gate.ok) return gate.result;

    try {
      const t = await this.transport();
      const info = await t.sendMail({
        from: `${this.cfg.fromName} <${this.cfg.fromAddress}>`,
        to: msg.to,
        replyTo: msg.replyTo || this.cfg.replyTo || undefined,
        subject: msg.subject,
        text: msg.body,
      });

      // An SMTP server that accepted for zero recipients has not accepted.
      if (info.rejected?.length && !info.accepted?.length) {
        return {
          status: 'failed',
          error: `The mail server rejected the recipient: ${info.rejected.join(', ')}`,
          retryable: false,
        };
      }

      return {
        status: 'accepted',
        providerMessageId: info.messageId ?? null,
        response: info.response ?? 'accepted',
      };
    } catch (err) {
      const e = err as Error & { responseCode?: number };
      // A timeout mid-handshake may or may not have queued the message.
      if (/timeout|ETIMEDOUT|ECONNRESET/i.test(e.message)) {
        return {
          status: 'unknown',
          detail: `The connection failed after the message may have been accepted: ${e.message}. Check the recipient's inbox before resending.`,
        };
      }
      return {
        status: 'failed',
        error: e.message,
        retryable: (e.responseCode ?? 0) >= 400 && (e.responseCode ?? 0) < 500,
      };
    }
  }
}

// ── Resend ──────────────────────────────────────────────────────────────────

export class ResendEmailProvider implements EmailProvider {
  readonly kind = 'resend';

  constructor(private readonly cfg: AppConfig['email']) {}

  get allowlistActive(): boolean {
    return this.cfg.allowlist.length > 0;
  }
  get allowlist(): string[] {
    return this.cfg.allowlist;
  }

  async health(): Promise<ProviderHealth> {
    const checkedAt = new Date().toISOString();
    const missing: string[] = [];
    if (!this.cfg.resend.apiKey) missing.push('RESEND_API_KEY');
    if (!this.cfg.fromAddress) missing.push('EMAIL_FROM_ADDRESS');

    return {
      provider: this.kind,
      configured: missing.length === 0,
      checkedAt,
      capabilities: [
        {
          name: 'send',
          available: missing.length === 0,
          detail: missing.length
            ? `Missing configuration: ${missing.join(', ')}.`
            : `Configured. Sender ${this.cfg.fromAddress} must be a verified domain in Resend.${
                this.allowlistActive ? ` Restricted to ${this.allowlist.length} allowlisted recipient(s).` : ''
              }`,
        },
      ],
    };
  }

  async send(msg: EmailMessage, idempotencyKey: string): Promise<EmailSendResult> {
    const gate = checkAllowlist(msg.to, this.allowlist);
    if (!gate.ok) return gate.result;

    if (!this.cfg.resend.apiKey) {
      return { status: 'failed', error: 'RESEND_API_KEY is not set.', retryable: false };
    }

    try {
      const res = await postJson<{ id?: string; message?: string }>(
        'https://api.resend.com/emails',
        {
          from: `${this.cfg.fromName} <${this.cfg.fromAddress}>`,
          to: [msg.to],
          subject: msg.subject,
          text: msg.body,
          reply_to: msg.replyTo || this.cfg.replyTo || undefined,
        },
        {
          Authorization: `Bearer ${this.cfg.resend.apiKey}`,
          // Resend honours this header, so a retried HTTP request cannot
          // produce a second email.
          'Idempotency-Key': idempotencyKey,
        },
        // Retries are disabled: an ambiguous send must surface as unknown
        // rather than be repeated automatically.
        { timeoutMs: 30_000, retries: 0, label: 'Resend send' },
      );

      if (!res.id) {
        return { status: 'unknown', detail: 'Resend accepted the request but returned no message id.' };
      }
      return { status: 'accepted', providerMessageId: res.id, response: JSON.stringify(res) };
    } catch (err) {
      const e = err as HttpError;
      if (e.status === null) {
        return {
          status: 'unknown',
          detail: `${e.message}. The message may or may not have been queued; check before resending.`,
        };
      }
      return {
        status: 'failed',
        error: `${e.message}${e.bodySnippet ? `: ${e.bodySnippet}` : ''}`,
        retryable: e.retryable,
      };
    }
  }
}

export function createEmailProvider(cfg: AppConfig): EmailProvider {
  switch (cfg.email.provider) {
    case 'test':
      return new TestEmailProvider(cfg.email.allowlist);
    case 'smtp':
      return new SmtpEmailProvider(cfg.email);
    case 'resend':
      return new ResendEmailProvider(cfg.email);
    default:
      return new NoopEmailProvider();
  }
}

/**
 * RFC 5322 message for download when no provider is configured.
 *
 * Labelled in the UI as an export, never as a sent message.
 */
export { TestEmailProvider };

export function buildEml(msg: EmailMessage, from: string): string {
  const encode = (s: string) =>
    /[^\x20-\x7E]/.test(s) ? `=?UTF-8?B?${Buffer.from(s, 'utf8').toString('base64')}?=` : s;

  return [
    `From: ${from}`,
    `To: ${msg.to}`,
    `Subject: ${encode(msg.subject)}`,
    msg.replyTo ? `Reply-To: ${msg.replyTo}` : '',
    `Date: ${new Date().toUTCString()}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from(msg.body, 'utf8').toString('base64').replace(/(.{76})/g, '$1\r\n'),
  ]
    .filter(Boolean)
    .join('\r\n');
}
