'use client';

import { useState } from 'react';
import { Banner, Button, Card, SectionHeading, Spinner } from '../ui';
import type { EmailAttempt, OutreachApproval, QuoteDraft } from '@/lib/domain/types';

/**
 * The outreach approval tray.
 *
 * Everything about this component is built around one rule: a message leaves
 * only when the user has explicitly approved the exact text in front of them.
 * Editing after approval revokes it — visibly, with an explanation — and the
 * send button will not reappear until they approve again.
 *
 * The status vocabulary is deliberately careful. "Accepted by email provider"
 * is not "delivered", and the interface never claims otherwise.
 */

const STATUS_META: Record<
  QuoteDraft['status'],
  { label: string; cls: string; note?: string }
> = {
  draft: { label: 'Draft', cls: 'bg-surface-sunk text-ink-soft' },
  approved: { label: 'Approved — ready to send', cls: 'bg-accent/50 text-ink' },
  sending: { label: 'Sending…', cls: 'bg-primary-wash text-primary' },
  accepted_by_provider: {
    label: 'Accepted by email provider',
    cls: 'bg-primary text-paper',
    note: 'The provider accepted this message. That is not confirmation it reached the inbox.',
  },
  failed: { label: 'Failed', cls: 'bg-danger-wash text-danger-ink' },
  delivery_unknown: {
    label: 'Outcome unknown',
    cls: 'bg-warning-wash text-warning-ink',
    note: 'We could not confirm what happened. Check with the supplier before sending again.',
  },
  exported: {
    label: 'Exported as .eml',
    cls: 'bg-surface-sunk text-ink-soft',
    note: 'This was downloaded as a file. It has not been sent to anyone.',
  },
};

export function OutreachTray({
  drafts,
  approvals,
  attempts,
  emailConfigured,
  allowlist,
  onEdit,
  onApprove,
  onWithdraw,
  onSend,
}: {
  drafts: QuoteDraft[];
  approvals: OutreachApproval[];
  attempts: EmailAttempt[];
  emailConfigured: boolean;
  allowlist: string[];
  onEdit: (id: string, patch: { recipientEmail?: string; subject?: string; body?: string }) => Promise<string | null>;
  onApprove: (id: string, contentHash: string) => Promise<string | null>;
  onWithdraw: (id: string) => Promise<void>;
  onSend: (id: string) => Promise<string | null>;
}) {
  if (!drafts.length) return null;

  const approvedCount = drafts.filter((d) => d.status === 'approved').length;

  return (
    <section>
      <SectionHeading count={drafts.length}>Quote requests</SectionHeading>

      {allowlist.length > 0 && (
        <div className="mb-3">
          <Banner tone="warning">
            Outgoing mail is restricted to {allowlist.length} test address
            {allowlist.length === 1 ? '' : 'es'}: <span className="num">{allowlist.join(', ')}</span>.
            Sends to anyone else are refused.
          </Banner>
        </div>
      )}

      {!emailConfigured && (
        <div className="mb-3">
          <Banner tone="info">
            No email provider is configured, so nothing can be sent from here. You can download each
            request as an <span className="num">.eml</span> file or copy the text.
          </Banner>
        </div>
      )}

      {approvedCount > 0 && (
        <div className="mb-3">
          <Banner tone="success">
            <span className="num font-medium">{approvedCount}</span> request
            {approvedCount === 1 ? ' is' : 's are'} approved and will be sent exactly as shown.
          </Banner>
        </div>
      )}

      <div className="space-y-3">
        {drafts.map((d) => (
          <DraftRow
            key={d.id}
            draft={d}
            approval={approvals.find((a) => a.draftId === d.id && !a.invalidatedAt) ?? null}
            lastInvalidated={
              approvals.find((a) => a.draftId === d.id && a.invalidatedAt) ?? null
            }
            attempts={attempts.filter((a) => a.draftId === d.id)}
            emailConfigured={emailConfigured}
            onEdit={onEdit}
            onApprove={onApprove}
            onWithdraw={onWithdraw}
            onSend={onSend}
          />
        ))}
      </div>
    </section>
  );
}

function DraftRow({
  draft,
  approval,
  lastInvalidated,
  attempts,
  emailConfigured,
  onEdit,
  onApprove,
  onWithdraw,
  onSend,
}: {
  draft: QuoteDraft;
  approval: OutreachApproval | null;
  lastInvalidated: OutreachApproval | null;
  attempts: EmailAttempt[];
  emailConfigured: boolean;
  onEdit: (id: string, patch: any) => Promise<string | null>;
  onApprove: (id: string, contentHash: string) => Promise<string | null>;
  onWithdraw: (id: string) => Promise<void>;
  onSend: (id: string) => Promise<string | null>;
}) {
  const [open, setOpen] = useState(false);
  const [recipient, setRecipient] = useState(draft.recipientEmail ?? '');
  const [subject, setSubject] = useState(draft.subject);
  const [body, setBody] = useState(draft.body);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const meta = STATUS_META[draft.status];
  const sent = draft.status === 'accepted_by_provider';
  const locked = sent || draft.status === 'sending';

  const dirty =
    recipient !== (draft.recipientEmail ?? '') || subject !== draft.subject || body !== draft.body;

  const canApprove = Boolean(recipient.trim()) && !approval && !dirty && !locked;
  const canSend = Boolean(approval) && !dirty && !locked && emailConfigured;

  async function save() {
    setBusy('save');
    const err = await onEdit(draft.id, { recipientEmail: recipient, subject, body });
    setMessage(err ?? 'Saved. Approve the updated version to send it.');
    setBusy(null);
  }

  return (
    <Card className="overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition hover:bg-paper"
        aria-expanded={open}
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[14px] font-semibold text-ink">{draft.supplierName}</span>
            <span className={`rounded px-1.5 py-0.5 text-[11px] ${meta.cls}`}>{meta.label}</span>
            <span className="num text-[10px] text-ink-faint">v{draft.version}</span>
          </div>
          <p className="mt-0.5 truncate text-[12.5px] text-ink-soft">
            {draft.recipientEmail ? (
              <span className="num">{draft.recipientEmail}</span>
            ) : (
              <span className="text-warning-ink">No recipient address yet</span>
            )}
            {draft.recipientSource === 'sourced_from_page' && (
              <span className="ml-2 text-[11px] text-ink-faint">found on their page</span>
            )}
            {draft.recipientSource === 'user_entered' && (
              <span className="ml-2 text-[11px] text-ink-faint">entered by you</span>
            )}
          </p>
        </div>
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          aria-hidden
          className={`shrink-0 text-ink-faint transition-transform ${open ? 'rotate-180' : ''}`}
        >
          <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </button>

      {meta.note && (
        <p className="border-t border-line bg-paper px-4 py-2 text-[12px] text-ink-soft">
          {meta.note}
        </p>
      )}

      {/* Approval revoked by an edit — stated plainly, with the reason. */}
      {!approval && lastInvalidated?.invalidationReason && !sent && (
        <p className="border-t border-warning/30 bg-warning-wash px-4 py-2 text-[12px] text-warning-ink">
          Previous approval no longer applies: {lastInvalidated.invalidationReason}
        </p>
      )}

      {open && (
        <div className="animate-arrive border-t border-line px-4 py-4">
          {message && (
            <div className="mb-3">
              <Banner tone={message.toLowerCase().includes('saved') ? 'success' : 'warning'}>
                {message}
              </Banner>
            </div>
          )}

          <label className="mb-1.5 block text-[12px] font-medium text-ink-soft">Recipient</label>
          <input
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            disabled={locked}
            placeholder="purchasing@supplier.example"
            className="num w-full rounded-lg border border-line bg-surface px-3 py-2 text-[13px] focus:border-primary focus:outline-none disabled:opacity-60"
          />
          {!draft.recipientEmail && (
            <p className="mt-1.5 text-[12px] text-warning-ink">
              We could not find a contact address on their page, and we will not guess one. Enter
              the address you want to write to.
            </p>
          )}
          {draft.recipientSourceUrl && (
            <p className="mt-1.5 truncate text-[11px] text-ink-faint">
              Address found at{' '}
              <a
                href={draft.recipientSourceUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="text-primary underline underline-offset-2"
              >
                {draft.recipientSourceUrl}
              </a>
            </p>
          )}

          <label className="mb-1.5 mt-4 block text-[12px] font-medium text-ink-soft">Subject</label>
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            disabled={locked}
            className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-[13px] focus:border-primary focus:outline-none disabled:opacity-60"
          />

          <label className="mb-1.5 mt-4 block text-[12px] font-medium text-ink-soft">Message</label>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            disabled={locked}
            rows={14}
            className="w-full resize-y rounded-lg border border-line bg-surface px-3 py-2.5 text-[13px] leading-relaxed focus:border-primary focus:outline-none disabled:opacity-60"
          />

          {dirty && !locked && (
            <p className="mt-2 text-[12px] text-warning-ink">
              You have unsaved changes. Save them, then approve, before this can be sent.
            </p>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-4">
            {!locked && (
              <Button size="sm" onClick={save} disabled={!dirty || busy === 'save'}>
                {busy === 'save' ? <Spinner /> : null} Save changes
              </Button>
            )}

            {canApprove && (
              <Button
                size="sm"
                variant="primary"
                disabled={busy === 'approve'}
                onClick={async () => {
                  setBusy('approve');
                  const err = await onApprove(draft.id, draft.contentHash);
                  setMessage(err);
                  setBusy(null);
                }}
              >
                {busy === 'approve' ? <Spinner /> : null} Approve this message
              </Button>
            )}

            {approval && !sent && (
              <>
                <Button
                  size="sm"
                  variant="primary"
                  disabled={!canSend || busy === 'send'}
                  title={!emailConfigured ? 'No email provider configured' : undefined}
                  onClick={async () => {
                    setBusy('send');
                    const err = await onSend(draft.id);
                    setMessage(err);
                    setBusy(null);
                  }}
                >
                  {busy === 'send' ? <Spinner /> : null} Send to {draft.recipientEmail}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={async () => {
                    await onWithdraw(draft.id);
                    setMessage('Approval withdrawn.');
                  }}
                >
                  Withdraw approval
                </Button>
              </>
            )}

            <a
              href={`/api/drafts/${draft.id}/eml`}
              className="inline-flex items-center gap-2 rounded-lg border border-line bg-surface px-3 py-1.5 text-[13px] text-ink transition hover:border-line-strong"
              download
            >
              Download .eml
            </a>

            <Button
              size="sm"
              variant="ghost"
              onClick={async () => {
                await navigator.clipboard.writeText(`Subject: ${subject}\n\n${body}`);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
            >
              {copied ? 'Copied' : 'Copy text'}
            </Button>
          </div>

          {approval && (
            <p className="num mt-3 text-[11px] text-ink-faint">
              Approved {new Date(approval.approvedAt).toLocaleString()} · version{' '}
              {approval.draftVersion} · {approval.contentHash.slice(0, 16)}…
            </p>
          )}

          {attempts.length > 0 && (
            <div className="mt-4 border-t border-line pt-3">
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-soft">
                Send history
              </p>
              <ul className="space-y-1">
                {attempts.map((a) => (
                  <li key={a.id} className="text-[12px] text-ink-soft">
                    <span className="num">{new Date(a.createdAt).toLocaleString()}</span> —{' '}
                    <span
                      className={
                        a.status === 'accepted'
                          ? 'text-primary'
                          : a.status === 'unknown'
                            ? 'text-warning-ink'
                            : 'text-danger-ink'
                      }
                    >
                      {a.status}
                    </span>
                    {a.error && <span className="text-ink-faint"> · {a.error}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
