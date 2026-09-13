'use client';

import { Drawer } from '../ui';
import type { Evidence, EvidenceStatus } from '@/lib/domain/types';
import type { EvidenceTarget } from './types';

/**
 * The evidence drawer.
 *
 * This is where the product's central claim is cashed out: for any fact on a
 * supplier card, the user can see the URL it came from, the verbatim excerpt,
 * when it was retrieved, and how we interpreted it — with supplier claims
 * clearly separated from things we computed ourselves.
 *
 * Excerpts are plain text. Raw retrieved HTML is never rendered here.
 */

const STATUS_META: Record<EvidenceStatus, { label: string; cls: string }> = {
  explicitly_stated: { label: 'Stated on the page', cls: 'bg-primary-wash text-primary' },
  derived: { label: 'Calculated by SupplySaathi', cls: 'bg-surface-sunk text-ink-soft' },
  unknown: { label: 'Not found', cls: 'bg-warning-wash text-warning-ink' },
  conflicting: { label: 'Page contradicts itself', cls: 'bg-danger-wash text-danger-ink' },
};

const AUTHORITY_LABEL: Record<string, string> = {
  supplier_claim: 'Supplier’s own claim',
  independent: 'Independently verified',
  user_provided: 'You told us this',
  computed: 'Computed from stated values',
};

const FACT_LABEL: Record<string, string> = {
  unitsPerPack: 'Pack size',
  pricePerPack: 'Price per pack',
  minOrderPacks: 'Minimum order',
  orderIncrementPacks: 'Order increment',
  dimensions: 'Dimensions',
  material: 'Material',
  foodContactClaim: 'Food contact',
  shippingInfo: 'Shipping',
  leadTimeInfo: 'Lead time',
  contactEmail: 'Contact address',
  'costing.merchandiseSubtotal': 'Merchandise subtotal',
};

export function EvidenceDrawer({
  target,
  evidence,
  onClose,
}: {
  target: EvidenceTarget | null;
  evidence: Evidence[];
  onClose: () => void;
}) {
  if (!target) return null;

  const forCandidate = evidence.filter((e) => e.candidateId === target.candidate.id);
  const items = target.factPath
    ? forCandidate.filter((e) => e.factPath === target.factPath)
    : forCandidate;

  // Known facts first — an "unknown" row is useful, but it is not what someone
  // opening this drawer is usually looking for.
  const ordered = [...items].sort((a, b) => {
    const rank = (s: EvidenceStatus) =>
      s === 'conflicting' ? 0 : s === 'explicitly_stated' ? 1 : s === 'derived' ? 2 : 3;
    return rank(a.status) - rank(b.status);
  });

  return (
    <Drawer
      open
      onClose={onClose}
      title={target.title}
      subtitle={target.candidate.productTitle}
    >
      <div className="mb-4 rounded-lg border border-line bg-paper px-3.5 py-3">
        <p className="text-[12px] text-ink-soft">Source</p>
        <a
          href={target.candidate.sourceUrl}
          target="_blank"
          rel="noreferrer noopener"
          className="mt-0.5 block break-all text-[12.5px] text-primary underline decoration-primary/30 underline-offset-2"
        >
          {target.candidate.sourceUrl}
        </a>
        {target.candidate.retrievedAt && (
          <p className="num mt-1.5 text-[11px] text-ink-faint">
            Retrieved {new Date(target.candidate.retrievedAt).toLocaleString()}
          </p>
        )}
      </div>

      {ordered.length === 0 && (
        <p className="py-6 text-center text-[13px] text-ink-faint">
          No evidence was recorded for this fact.
        </p>
      )}

      <ul className="space-y-3">
        {ordered.map((e) => {
          const meta = STATUS_META[e.status];
          return (
            <li key={e.id} className="rounded-lg border border-line bg-surface p-3.5">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="text-[13px] font-semibold text-ink">
                  {FACT_LABEL[e.factPath] ?? e.factPath}
                </span>
                <span className={`rounded px-1.5 py-0.5 text-[11px] ${meta.cls}`}>{meta.label}</span>
              </div>

              {e.excerpt ? (
                <blockquote className="border-l-2 border-line-strong pl-3 text-[12.5px] leading-relaxed text-ink">
                  “{e.excerpt}”
                </blockquote>
              ) : (
                <p className="text-[12.5px] italic text-ink-faint">
                  No supporting text was found on the page.
                </p>
              )}

              {e.interpretation && (
                <div className="mt-2.5 rounded bg-paper px-2.5 py-2">
                  <p className="text-[11px] uppercase tracking-wide text-ink-faint">
                    How we read it
                  </p>
                  <p className="mt-0.5 text-[12.5px] leading-relaxed text-ink-soft">
                    {e.interpretation}
                  </p>
                </div>
              )}

              <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ink-faint">
                <span>{AUTHORITY_LABEL[e.authority] ?? e.authority}</span>
                {e.retrievedAt && (
                  <span className="num">{new Date(e.retrievedAt).toLocaleString()}</span>
                )}
              </p>
            </li>
          );
        })}
      </ul>

      <p className="mt-5 border-t border-line pt-4 text-[11.5px] leading-relaxed text-ink-faint">
        A supplier stating something on their own page is a claim, not independent verification.
        Anything that matters commercially should be confirmed in writing in their quotation.
      </p>
    </Drawer>
  );
}
