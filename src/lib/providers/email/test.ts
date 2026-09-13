import type { EmailMessage, EmailProvider, EmailSendResult, ProviderHealth } from '../types';

/**
 * Test email adapter.
 *
 * Records messages in memory instead of transmitting them. Used by the test
 * suite, and available via `EMAIL_PROVIDER=test` so the approval-to-send flow
 * can be demonstrated without an SMTP account.
 *
 * It reports `accepted`, because that is what the workflow needs to advance —
 * but every user-facing surface that reads `providerKind` must make clear no
 * message left the machine. The health detail below says so in as many words,
 * and the message id is prefixed `test-` so it can never be mistaken for a
 * real provider reference in the send history.
 */
export class TestEmailProvider implements EmailProvider {
  readonly kind = 'test';
  readonly sent: Array<EmailMessage & { idempotencyKey: string; at: string }> = [];

  constructor(
    readonly allowlist: string[] = [],
    /** Force a specific outcome, to exercise the failure and unknown branches. */
    private readonly behaviour: 'accept' | 'fail' | 'unknown' = 'accept',
  ) {}

  get allowlistActive(): boolean {
    return this.allowlist.length > 0;
  }

  async health(): Promise<ProviderHealth> {
    return {
      provider: this.kind,
      configured: true,
      checkedAt: new Date().toISOString(),
      capabilities: [
        {
          name: 'send',
          available: true,
          detail:
            'TEST ADAPTER — messages are recorded locally and are NOT delivered to anyone. ' +
            'Use SMTP or Resend for real outreach.',
        },
      ],
    };
  }

  async send(msg: EmailMessage, idempotencyKey: string): Promise<EmailSendResult> {
    if (this.allowlist.length && !this.allowlist.includes(msg.to.trim().toLowerCase())) {
      return {
        status: 'failed',
        error: `Blocked: "${msg.to}" is not on the test allowlist.`,
        retryable: false,
      };
    }

    if (this.behaviour === 'fail') {
      return { status: 'failed', error: 'Test adapter configured to fail.', retryable: false };
    }
    if (this.behaviour === 'unknown') {
      return {
        status: 'unknown',
        detail: 'Test adapter configured to return an uncertain outcome.',
      };
    }

    this.sent.push({ ...msg, idempotencyKey, at: new Date().toISOString() });
    return {
      status: 'accepted',
      providerMessageId: `test-${idempotencyKey.slice(0, 12)}`,
      response: 'Recorded by the test adapter. Nothing was transmitted.',
    };
  }
}
