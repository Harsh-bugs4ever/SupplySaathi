'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Banner, Card, Spinner, StatePill } from './ui';
import { GhostEmpty } from './Logo';
import { api } from '@/lib/client/api';
import type { SourcingCase } from '@/lib/domain/types';

/**
 * Case history.
 *
 * Every case keeps its requirements, results, timestamps, drafts and send
 * states, so reopening one months later shows exactly what was known and what
 * was decided at the time.
 */

type CaseRow = SourcingCase & {
  candidateCount: number;
  qualifyingCount: number;
  draftCount: number;
  sentCount: number;
};

export function CasesList() {
  const [cases, setCases] = useState<CaseRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    api<{ cases: CaseRow[] }>('/api/cases')
      .then((d) => active && setCases(d.cases))
      .catch((e) => active && setError((e as Error).message));
    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="mx-auto max-w-[1000px] px-5 py-10 sm:px-8">
      <header className="mb-7 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="display text-[30px] text-ink">Cases</h1>
          <p className="mt-1.5 text-[14px] text-ink-soft">
            Every sourcing case, with what was found and what was sent.
          </p>
        </div>
        <Link
          href="/"
          className="rounded-lg bg-primary px-4 py-2.5 text-[14px] font-medium text-paper transition hover:bg-primary-hover lift"
        >
          New case
        </Link>
      </header>

      {error && (
        <div className="mb-4">
          <Banner tone="danger">{error}</Banner>
        </div>
      )}

      {!cases && !error && (
        <Card className="p-6">
          <div className="flex items-center gap-2 text-[13px] text-ink-soft">
            <Spinner /> Loading cases…
          </div>
        </Card>
      )}

      {cases && cases.length === 0 && (
        <Card>
          <GhostEmpty
            message="No cases yet."
            hint="Start one when a supplier falls through — or any time you need to compare options with evidence."
          />
        </Card>
      )}

      {cases && cases.length > 0 && (
        <ul className="space-y-3">
          {cases.map((c) => (
            <li key={c.id}>
              <Link href={`/cases/${c.id}`} className="block">
                <Card className="p-4 transition hover:border-line-strong hover:lift">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="mb-1 flex flex-wrap items-center gap-2">
                        <span className="num rounded bg-surface-sunk px-1.5 py-0.5 text-[11px] text-ink-soft">
                          {c.reference}
                        </span>
                        <StatePill state={c.state} />
                        {c.mode === 'demo' && (
                          <span className="rounded border border-warning/35 bg-warning-wash px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-warning-ink">
                            demo
                          </span>
                        )}
                      </div>

                      <h2 className="text-[16px] font-semibold leading-snug text-ink">{c.title}</h2>
                      <p className="mt-1 line-clamp-1 text-[13px] text-ink-soft">{c.briefText}</p>
                    </div>

                    <dl className="flex shrink-0 gap-5 text-right">
                      <div>
                        <dt className="text-[11px] uppercase tracking-wide text-ink-faint">
                          Options
                        </dt>
                        <dd className="num text-[16px] font-semibold text-ink">
                          {c.qualifyingCount}
                          <span className="text-[12px] font-normal text-ink-faint">
                            /{c.candidateCount}
                          </span>
                        </dd>
                      </div>
                      <div>
                        <dt className="text-[11px] uppercase tracking-wide text-ink-faint">Sent</dt>
                        <dd className="num text-[16px] font-semibold text-ink">
                          {c.sentCount}
                          <span className="text-[12px] font-normal text-ink-faint">
                            /{c.draftCount}
                          </span>
                        </dd>
                      </div>
                    </dl>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t border-line pt-2.5 text-[11.5px] text-ink-faint">
                    <span className="num">
                      Created{' '}
                      {new Date(c.createdAt).toLocaleDateString('en-GB', {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                      })}
                    </span>
                    {c.resolvedDeadline && <span className="num">Deadline {c.resolvedDeadline}</span>}
                    <span className="num">
                      Updated{' '}
                      {new Date(c.updatedAt).toLocaleString([], {
                        day: 'numeric',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </div>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
