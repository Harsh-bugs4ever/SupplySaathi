'use client';

import { ConstraintChip, Field } from '../ui';
import { costLabel, formatMoney } from '@/lib/domain/costing';
import { formatDimensions } from '@/lib/domain/units';
import { STATUS_LABELS } from '@/lib/domain/constraints';
import type { CandidateStatus } from '@/lib/domain/types';
import type { CandidateWithEvals } from './types';

/**
 * A supplier option.
 *
 * The card's job is to make the honest thing the obvious thing: a candidate
 * with an unconfirmed hard requirement is visibly amber, never presented as
 * verified, and the merchandise subtotal is always labelled as excluding
 * shipping and tax so it cannot be mistaken for a quote.
 */

const STATUS_STYLE: Record<CandidateStatus, { ring: string; bar: string; text: string }> = {
  verified_match: {
    ring: 'border-primary/30',
    bar: 'bg-primary',
    text: 'text-primary',
  },
  potential_match: {
    ring: 'border-warning/40',
    bar: 'bg-warning',
    text: 'text-warning-ink',
  },
  does_not_meet: {
    ring: 'border-line',
    bar: 'bg-danger',
    text: 'text-danger-ink',
  },
  retrieval_failed: {
    ring: 'border-line',
    bar: 'bg-line-strong',
    text: 'text-ink-faint',
  },
};

export function CandidateCard({
  candidate,
  selected,
  onSelect,
  onEvidence,
  rank,
}: {
  candidate: CandidateWithEvals;
  selected: boolean;
  onSelect?: (id: string, next: boolean) => void;
  onEvidence: (factPath?: string) => void;
  rank?: number;
}) {
  const s = STATUS_STYLE[candidate.status];
  const c = candidate.costing;
  const excluded = candidate.status === 'does_not_meet' || candidate.status === 'retrieval_failed';

  const hardEvals = candidate.evaluations.filter((e) => e.priority === 'must_have');
  const prefEvals = candidate.evaluations.filter((e) => e.priority === 'preference');
  const failures = hardEvals.filter((e) => e.outcome === 'failed');
  const unknowns = hardEvals.filter((e) => e.outcome === 'unknown');

  return (
    <article
      className={`animate-arrive relative overflow-hidden rounded-xl border bg-surface paper-edge transition ${s.ring} ${
        excluded ? 'opacity-[0.82]' : ''
      } ${selected ? 'ring-2 ring-primary/40' : ''}`}
    >
      <span aria-hidden className={`absolute inset-y-0 left-0 w-[3px] ${s.bar}`} />

      <div className="flex items-start gap-3 px-4 py-3.5 pl-5">
        {onSelect && !excluded && (
          <input
            type="checkbox"
            checked={selected}
            onChange={(e) => onSelect(candidate.id, e.target.checked)}
            aria-label={`Select ${candidate.supplierName} for a quote request`}
            className="mt-1 h-4 w-4 shrink-0 accent-[var(--color-primary)]"
          />
        )}

        {candidate.imageUrl && (
          // Plain img, not next/image: this is an untrusted third-party URL and
          // we do not want our own server fetching it through the optimizer.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={candidate.imageUrl}
            alt=""
            className="h-14 w-14 shrink-0 rounded-lg border border-line object-cover"
            referrerPolicy="no-referrer"
          />
        )}

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            {rank !== undefined && !excluded && (
              <span className="num text-[11px] text-ink-faint">#{rank}</span>
            )}
            <h3 className="text-[15px] font-semibold leading-tight text-ink">
              {candidate.supplierName}
            </h3>
          </div>
          <p className="mt-0.5 line-clamp-2 text-[13px] leading-snug text-ink-soft">
            {candidate.productTitle}
          </p>

          <p className={`mt-1.5 text-[12px] font-medium ${s.text}`}>
            {STATUS_LABELS[candidate.status]}
          </p>
        </div>
      </div>

      {/* Quantities and cost. Every unknown stays visibly unknown. */}
      <div className="border-t border-line px-5 py-3">
        <dl className="grid gap-x-6 sm:grid-cols-2">
          <Field label="Pack size" value={candidate.unitsPerPack} mono onEvidence={() => onEvidence('unitsPerPack')} />
          <Field
            label="Minimum order"
            value={candidate.minOrderPacks ? `${candidate.minOrderPacks} packs` : null}
            mono
            onEvidence={() => onEvidence('minOrderPacks')}
          />
          <Field
            label="Packs needed"
            value={c ? `${c.packsNeeded}` : null}
            mono
          />
          <Field
            label="Units purchased"
            value={c ? `${c.purchasedUnits}${c.overageUnits > 0 ? ` (+${c.overageUnits})` : ''}` : null}
            mono
          />
          <Field
            label="Dimensions"
            value={candidate.dimensions ? formatDimensions(candidate.dimensions) : null}
            mono
            onEvidence={() => onEvidence('dimensions')}
          />
          <Field
            label="Price per pack"
            value={candidate.pricePerPack ? formatMoney(candidate.pricePerPack) : null}
            mono
            onEvidence={() => onEvidence('pricePerPack')}
          />
        </dl>

        <div className="mt-2.5 rounded-lg bg-paper px-3 py-2.5">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-[12px] text-ink-soft">Known merchandise cost</span>
            <span className="num text-[17px] font-semibold text-ink">
              {c ? formatMoney(c.merchandiseSubtotal) : '—'}
            </span>
          </div>
          <p className="mt-1 text-[11px] leading-snug text-ink-faint">{costLabel(c)}</p>

          <div className="mt-2 flex flex-wrap gap-1.5">
            <SmallTag
              tone={c?.shippingStatus === 'free_stated' || c?.shippingStatus === 'known' ? 'ok' : 'warn'}
              label={`Shipping: ${shippingLabel(c?.shippingStatus)}`}
            />
            <SmallTag
              tone={c?.taxStatus === 'inclusive_stated' || c?.taxStatus === 'known' ? 'ok' : 'warn'}
              label={`Tax: ${taxLabel(c?.taxStatus)}`}
            />
            <SmallTag
              tone={candidate.leadTimeInfo ? 'ok' : 'warn'}
              label={candidate.leadTimeInfo ? 'Delivery estimate stated' : 'No delivery evidence'}
            />
          </div>
        </div>

        {c && c.notes.length > 0 && (
          <ul className="mt-2 space-y-0.5">
            {c.notes.map((n, i) => (
              <li key={i} className="text-[11.5px] leading-snug text-ink-faint">
                · {n}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Constraint chips: matched, unknown, failed — each visually distinct. */}
      <div className="border-t border-line px-5 py-3">
        <div className="flex flex-wrap gap-1.5">
          {hardEvals.map((e) => (
            <ConstraintChip
              key={e.id}
              outcome={e.outcome}
              label={e.requirementLabel}
              onClick={() => onEvidence()}
              title={e.explanation}
            />
          ))}
          {prefEvals.map((e) => (
            <ConstraintChip
              key={e.id}
              outcome={e.outcome}
              label={e.requirementLabel}
              priority="preference"
              title={e.explanation}
            />
          ))}
        </div>

        {failures.length > 0 && (
          <div className="mt-2.5 rounded-lg border border-danger/25 bg-danger-wash px-3 py-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-danger-ink">
              Why this is excluded
            </p>
            <ul className="mt-1 space-y-1">
              {failures.map((f) => (
                <li key={f.id} className="text-[12.5px] leading-snug text-danger-ink">
                  {f.explanation}
                </li>
              ))}
            </ul>
          </div>
        )}

        {unknowns.length > 0 && (
          <div className="mt-2.5 rounded-lg border border-warning/30 bg-warning-wash px-3 py-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-warning-ink">
              To confirm with this supplier
            </p>
            <ul className="mt-1 space-y-1">
              {unknowns.map((u) => (
                <li key={u.id} className="text-[12.5px] leading-snug text-warning-ink">
                  {u.explanation}
                </li>
              ))}
            </ul>
          </div>
        )}

        {candidate.rationale && (
          <p className="mt-2.5 text-[12px] italic leading-snug text-ink-soft">
            {candidate.rationale}
          </p>
        )}
      </div>

      <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-line bg-paper px-5 py-2.5">
        <a
          href={candidate.sourceUrl}
          target="_blank"
          rel="noreferrer noopener"
          className="truncate text-[12px] text-primary underline decoration-primary/30 underline-offset-2"
        >
          {hostOf(candidate.sourceUrl)}
        </a>
        <div className="flex items-center gap-3">
          {candidate.retrievedAt && (
            <span className="num text-[11px] text-ink-faint">
              Checked {new Date(candidate.retrievedAt).toLocaleString([], {
                day: 'numeric',
                month: 'short',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </span>
          )}
          <button
            onClick={() => onEvidence()}
            className="text-[12px] font-medium text-primary transition hover:underline"
          >
            Evidence
          </button>
        </div>
      </footer>
    </article>
  );
}

function SmallTag({ tone, label }: { tone: 'ok' | 'warn'; label: string }) {
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-[11px] ${
        tone === 'ok' ? 'bg-primary-wash text-primary' : 'bg-warning-wash text-warning-ink'
      }`}
    >
      {label}
    </span>
  );
}

function shippingLabel(s?: string): string {
  switch (s) {
    case 'free_stated':
      return 'free (stated)';
    case 'known':
      return 'stated';
    case 'quote_required':
      return 'on quote';
    default:
      return 'not stated';
  }
}

function taxLabel(s?: string): string {
  switch (s) {
    case 'inclusive_stated':
      return 'included';
    case 'known':
      return 'stated';
    default:
      return 'not stated';
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}
