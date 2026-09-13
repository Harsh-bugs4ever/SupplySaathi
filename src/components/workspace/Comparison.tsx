'use client';

import { Card, SectionHeading } from '../ui';
import { formatMoney } from '@/lib/domain/costing';
import { formatDimensions } from '@/lib/domain/units';
import { STATUS_LABELS } from '@/lib/domain/constraints';
import type { CandidateWithEvals } from './types';

/**
 * Side-by-side comparison.
 *
 * Equivalent fields are aligned across suppliers so quantities and costs can be
 * read down a column. Unknowns stay visibly unknown rather than collapsing to a
 * dash that could be mistaken for zero — the whole point of the table is that
 * the gaps are as informative as the figures.
 *
 * Below ~900px this becomes a horizontally scrollable table rather than
 * shrinking the type, because a price you cannot read is worse than a scroll.
 */

interface Row {
  label: string;
  get: (c: CandidateWithEvals) => { text: string; unknown?: boolean; strong?: boolean; mono?: boolean };
}

const ROWS: Row[] = [
  {
    label: 'Status',
    get: (c) => ({ text: STATUS_LABELS[c.status] }),
  },
  {
    label: 'Dimensions',
    get: (c) =>
      c.dimensions
        ? { text: formatDimensions(c.dimensions), mono: true }
        : { text: 'Not stated', unknown: true },
  },
  {
    label: 'Pack size',
    get: (c) =>
      c.unitsPerPack
        ? { text: `${c.unitsPerPack} per pack`, mono: true }
        : { text: 'Not stated', unknown: true },
  },
  {
    label: 'Minimum order',
    get: (c) =>
      c.minOrderPacks
        ? { text: `${c.minOrderPacks} packs`, mono: true }
        : { text: 'Not stated', unknown: true },
  },
  {
    label: 'Packs needed',
    get: (c) => (c.costing ? { text: `${c.costing.packsNeeded}`, mono: true } : { text: '—', unknown: true }),
  },
  {
    label: 'Units purchased',
    get: (c) =>
      c.costing
        ? {
            text:
              c.costing.overageUnits > 0
                ? `${c.costing.purchasedUnits} (+${c.costing.overageUnits} over)`
                : `${c.costing.purchasedUnits}`,
            mono: true,
          }
        : { text: '—', unknown: true },
  },
  {
    label: 'Price per pack',
    get: (c) =>
      c.pricePerPack ? { text: formatMoney(c.pricePerPack), mono: true } : { text: 'Not stated', unknown: true },
  },
  {
    label: 'Merchandise subtotal',
    get: (c) =>
      c.costing
        ? { text: formatMoney(c.costing.merchandiseSubtotal), mono: true, strong: true }
        : { text: 'Unknown', unknown: true },
  },
  {
    label: 'Shipping',
    get: (c) =>
      c.costing?.shippingStatus === 'free_stated'
        ? { text: 'Free (stated)' }
        : c.costing?.shippingStatus === 'known'
          ? { text: 'Stated on page' }
          : c.costing?.shippingStatus === 'quote_required'
            ? { text: 'On quote', unknown: true }
            : { text: 'Not stated', unknown: true },
  },
  {
    label: 'Tax',
    get: (c) =>
      c.costing?.taxStatus === 'inclusive_stated'
        ? { text: 'Included' }
        : { text: 'Not stated', unknown: true },
  },
  {
    label: 'Landed total',
    get: (c) =>
      c.costing?.landedTotal
        ? { text: formatMoney(c.costing.landedTotal), mono: true, strong: true }
        : { text: 'Cannot be calculated', unknown: true },
  },
  {
    label: 'Delivery evidence',
    get: (c) => (c.leadTimeInfo ? { text: c.leadTimeInfo } : { text: 'None on page', unknown: true }),
  },
  {
    label: 'Food contact',
    get: (c) =>
      c.foodContactClaim ? { text: c.foodContactClaim } : { text: 'Not mentioned', unknown: true },
  },
  {
    label: 'Open questions',
    get: (c) => {
      const n = c.evaluations.filter((e) => e.outcome === 'unknown' && e.priority === 'must_have').length;
      return n === 0 ? { text: 'None' } : { text: `${n}`, unknown: true, mono: true };
    },
  },
];

export function Comparison({
  candidates,
  headline,
}: {
  candidates: CandidateWithEvals[];
  headline: string | null;
}) {
  const shown = candidates.filter((c) => c.status !== 'retrieval_failed').slice(0, 5);
  if (shown.length < 2) return null;

  return (
    <section>
      <SectionHeading count={shown.length}>Side by side</SectionHeading>

      {/* A qualified claim, never "Best supplier". */}
      {headline && (
        <p className="mb-3 rounded-lg border border-accent-deep bg-accent/35 px-3.5 py-2.5 text-[13px] leading-relaxed text-ink">
          {headline}
        </p>
      )}

      <Card className="overflow-hidden">
        <div className="scroll-slim overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-left">
            <caption className="sr-only">
              Supplier comparison across quantities, cost and unresolved questions
            </caption>
            <thead>
              <tr className="border-b border-line bg-paper">
                <th
                  scope="col"
                  className="sticky left-0 z-10 bg-paper px-4 py-3 text-[11px] font-semibold uppercase tracking-wide text-ink-soft"
                >
                  Field
                </th>
                {shown.map((c) => (
                  <th key={c.id} scope="col" className="min-w-[150px] px-4 py-3 align-bottom">
                    <span className="block text-[13px] font-semibold leading-tight text-ink">
                      {c.supplierName}
                    </span>
                    <span
                      className={`mt-1 inline-block rounded px-1.5 py-0.5 text-[10px] ${
                        c.status === 'verified_match'
                          ? 'bg-primary-wash text-primary'
                          : c.status === 'potential_match'
                            ? 'bg-warning-wash text-warning-ink'
                            : 'bg-danger-wash text-danger-ink'
                      }`}
                    >
                      {c.status === 'verified_match'
                        ? 'verified'
                        : c.status === 'potential_match'
                          ? 'to confirm'
                          : 'excluded'}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>

            <tbody>
              {ROWS.map((row, i) => (
                <tr key={row.label} className={i % 2 ? 'bg-paper/45' : ''}>
                  <th
                    scope="row"
                    className={`sticky left-0 z-10 px-4 py-2.5 text-[12px] font-medium text-ink-soft ${
                      i % 2 ? 'bg-[#f2efe6]' : 'bg-surface'
                    }`}
                  >
                    {row.label}
                  </th>
                  {shown.map((c) => {
                    const v = row.get(c);
                    return (
                      <td
                        key={c.id}
                        className={`px-4 py-2.5 text-[13px] leading-snug ${
                          v.unknown
                            ? 'italic text-warning-ink'
                            : v.strong
                              ? 'font-semibold text-ink'
                              : 'text-ink'
                        } ${v.mono ? 'num' : ''}`}
                      >
                        {v.text}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <p className="mt-2 text-[11.5px] leading-relaxed text-ink-faint">
        Subtotals cover goods only. A landed total is shown only where the page stated both shipping
        and tax. Values in amber are unknown — not zero.
      </p>
    </section>
  );
}
