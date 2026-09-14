'use client';

import { useEffect, useMemo, useState } from 'react';
import { Banner, Button, Card, SectionHeading, Spinner } from '../ui';
import { GhostEmpty, GhostMark } from '../Logo';
import { BriefCard, ModeNotice } from './BriefCard';
import { Timeline } from './Timeline';
import { CandidateCard } from './CandidateCard';
import { Comparison } from './Comparison';
import { EvidenceDrawer } from './EvidenceDrawer';
import { OutreachTray } from './OutreachTray';
import { useCase } from './useCase';
import { apiUrl } from '@/lib/client/api';
import type { CandidateWithEvals, EvidenceTarget } from './types';

/**
 * The research workspace.
 *
 * Layout follows the shape of the work: the brief and results in the main
 * column, live activity in a right-hand rail on desktop (stacked on mobile),
 * and evidence in a drawer that opens over the top from any fact.
 */
export function Workspace({ caseId }: { caseId: string }) {
  const { snapshot, liveEvents, error, loading, refetch, isRunning } = useCase(caseId);

  const [selected, setSelected] = useState<string[]>([]);
  const [evidenceTarget, setEvidenceTarget] = useState<EvidenceTarget | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [health, setHealth] = useState<{ configured: boolean; allowlist: string[] } | null>(null);

  useEffect(() => {
    fetch(apiUrl('/api/health'), { credentials: 'include' })
      .then((r) => r.json())
      .then((h) =>
        setHealth({
          configured: Boolean(h.email?.capabilities?.[0]?.available),
          allowlist: h.email?.allowlist ?? [],
        }),
      )
      .catch(() => setHealth({ configured: false, allowlist: [] }));
  }, []);

  const candidates = snapshot?.candidates ?? [];

  const { qualifying, excluded } = useMemo(() => {
    const q: CandidateWithEvals[] = [];
    const x: CandidateWithEvals[] = [];
    for (const c of candidates) {
      (c.status === 'does_not_meet' || c.status === 'retrieval_failed' ? x : q).push(c);
    }
    return { qualifying: q, excluded: x };
  }, [candidates]);

  /**
   * The comparison headline, computed here from the same rule the ranking uses.
   * It names the comparison set and the cost basis so the claim is checkable —
   * never a bare "best supplier".
   */
  const headline = useMemo(() => {
    const eligible = qualifying.filter((c) => c.costing);
    if (eligible.length < 2) return null;

    const currencies = new Set(eligible.map((c) => c.costing!.merchandiseSubtotal.currency));
    if (currencies.size > 1) {
      return 'These options are priced in different currencies and are not directly comparable. We do not convert between them.';
    }

    const cheapest = eligible.reduce((a, b) =>
      b.costing!.merchandiseSubtotal.amount < a.costing!.merchandiseSubtotal.amount ? b : a,
    );
    const allDimsConfirmed = eligible.every((c) =>
      c.evaluations.some(
        (e) => e.requirementLabel.toLowerCase().includes('x') && e.outcome === 'met',
      ),
    );

    return `${cheapest.supplierName} has the lowest known merchandise cost ${
      allDimsConfirmed
        ? 'among candidates matching the documented dimensions'
        : `among the ${eligible.length} options not excluded`
    }. Shipping and tax are not included in that figure.`;
  }, [qualifying]);

  const openQuestions = useMemo(() => {
    const seen = new Set<string>();
    const out: Array<{ label: string; explanation: string; supplier: string }> = [];
    for (const c of qualifying) {
      for (const e of c.evaluations) {
        if (e.outcome !== 'unknown' || e.priority !== 'must_have') continue;
        const key = e.requirementLabel.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ label: e.requirementLabel, explanation: e.explanation, supplier: c.supplierName });
      }
    }
    return out;
  }, [qualifying]);

  // ── Actions ───────────────────────────────────────────────────────────────

  async function post(path: string, body?: unknown): Promise<any> {
    try {
    const res = await fetch(apiUrl(path), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'include',
    });
    return { ok: res.ok, data: await res.json().catch(() => ({})) };
    } catch {
      return { ok: false, data: { error: 'Connection interrupted. Refresh the case to check its status before trying again.' } };
    }
  }

  async function startResearch() {
    setBusy('research');
    setNotice(null);
    const { ok, data } = await post(`/api/cases/${caseId}/research`);
    if (!ok) setNotice(data.error ?? 'Could not start research.');
    await refetch();
    setBusy(null);
  }

  async function cancelResearch() {
    const result = await post(`/api/cases/${caseId}/cancel`);
    if (!result.ok) setNotice(result.data.error ?? 'Could not cancel research.');
    await refetch();
  }

  async function answerClarifications(answers: Array<{ id: string; answer: string }>) {
    const result = await post(`/api/cases/${caseId}/clarify`, { answers });
    if (!result.ok) setNotice(result.data.error ?? 'Could not save answers.');
    await refetch();
  }

  async function generateDrafts() {
    if (!selected.length) return;
    setBusy('drafts');
    setNotice(null);
    const { ok, data } = await post(`/api/cases/${caseId}/drafts`, { candidateIds: selected });
    if (!ok) setNotice(data.error ?? 'Could not prepare the quote requests.');
    await refetch();
    setBusy(null);
  }

  async function editDraft(id: string, patch: any): Promise<string | null> {
    const res = await fetch(apiUrl(`/api/drafts/${id}`), {
      credentials: 'include',
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    const data = await res.json();
    await refetch();
    return res.ok ? (data.message ?? null) : (data.error ?? 'Could not save.');
  }

  async function approveDraft(id: string, contentHash: string): Promise<string | null> {
    const { ok, data } = await post(`/api/drafts/${id}/approve`, { contentHash });
    await refetch();
    return ok ? null : (data.error ?? 'Could not approve.');
  }

  async function withdrawApproval(id: string) {
    await fetch(apiUrl(`/api/drafts/${id}/approve`), { method: 'DELETE', credentials: 'include' });
    await refetch();
  }

  async function sendDraft(id: string): Promise<string | null> {
    const { ok, data } = await post(`/api/drafts/${id}/send`);
    await refetch();
    return ok ? (data.message ?? null) : (data.error ?? 'Could not send. Check the attempt status before retrying.');
  }

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-ink-faint">
          <GhostMark size={44} className="text-line-strong" animated />
          <span className="text-[13px]">Loading case…</span>
        </div>
      </div>
    );
  }

  if (error || !snapshot) {
    return (
      <div className="mx-auto max-w-[600px] px-5 py-16">
        <Banner tone="danger">{error ?? 'Case not found.'}</Banner>
      </div>
    );
  }

  const { case: c, run } = snapshot;
  const canResearch =
    !isRunning && !c.clarifications.some((q) => !q.answer) && snapshot.requirements.length > 0;
  const hasResults = candidates.length > 0;

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6 lg:px-8">
      <div className="mb-4"><ModeNotice mode={c.mode} /></div>
      {notice && (
        <div className="mb-4">
          <Banner tone="info">{notice}</Banner>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        {/* ── Main column ─────────────────────────────────────────────────── */}
        <div className="min-w-0 space-y-6">
          <BriefCard
            snapshot={snapshot}
            onAnswer={answerClarifications}
          />

          {/* Primary action */}
          {!hasResults && (
            <Card className="p-6">
              {isRunning ? (
                <div className="flex items-center gap-3">
                  <Spinner className="text-primary" />
                  <div>
                    <p className="text-[14px] font-medium text-ink">Research in progress</p>
                    <p className="text-[12.5px] text-ink-soft">
                      Reading supplier pages. You can close this tab — progress is saved.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <p className="text-[14px] font-medium text-ink">
                      {c.state === 'NEEDS_CLARIFICATION'
                        ? 'Answer the questions above to begin'
                        : 'Ready to search for replacements'}
                    </p>
                    <p className="mt-0.5 text-[12.5px] text-ink-soft">
                      {c.mode === 'demo'
                        ? 'Runs against sample supplier pages.'
                        : 'Reads live supplier pages. Nothing is sent to anyone.'}
                    </p>
                  </div>
                  <Button variant="primary" onClick={startResearch} disabled={!canResearch || busy === 'research'}>
                    {busy === 'research' ? <Spinner /> : null}
                    Start research
                  </Button>
                </div>
              )}
            </Card>
          )}

          {/* Partial-results honesty */}
          {run?.status === 'partial' && (
            <Banner tone="warning">
              These results are incomplete
              {run.pagesFailed > 0 && `: ${run.pagesFailed} page${run.pagesFailed === 1 ? '' : 's'} could not be read`}
              . A page we could not read tells us nothing about whether that product is available.
            </Banner>
          )}

          {run?.status === 'failed' && (
            <Banner tone="danger">
              Research stopped because of an error. {run.error}
            </Banner>
          )}

          {/* Important unknowns */}
          {openQuestions.length > 0 && (
            <Card className="border-warning/30 p-4">
              <SectionHeading count={openQuestions.length}>Important unknowns</SectionHeading>
              <p className="mb-2.5 text-[12.5px] text-ink-soft">
                Nothing on the pages we read answers these. They become questions in the quote
                requests.
              </p>
              <ul className="space-y-1.5">
                {openQuestions.map((q, i) => (
                  <li key={i} className="flex gap-2 text-[13px] leading-snug text-ink">
                    <span aria-hidden className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-warning" />
                    <span>
                      <span className="font-medium">{q.label}</span>
                      <span className="block text-[12.5px] text-ink-soft">{q.explanation}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {/* Candidates */}
          {hasResults && (
            <section>
              <SectionHeading
                count={qualifying.length}
                action={
                  qualifying.length > 0 && (
                    <Button
                      size="sm"
                      variant="primary"
                      disabled={!selected.length || busy === 'drafts'}
                      onClick={generateDrafts}
                    >
                      {busy === 'drafts' ? <Spinner /> : null}
                      Prepare {selected.length || ''} quote request{selected.length === 1 ? '' : 's'}
                    </Button>
                  )
                }
              >
                Worth considering
              </SectionHeading>

              {qualifying.length === 0 ? (
                <Card>
                  <GhostEmpty
                    message="Nothing qualified against your requirements."
                    hint="Every option we read failed a hard requirement. Relaxing one — the budget or the arrival date — would widen the search. We will not change anything without you asking."
                  />
                </Card>
              ) : (
                <div className="space-y-3">
                  {qualifying.map((cand, i) => (
                    <CandidateCard
                      key={cand.id}
                      candidate={cand}
                      rank={i + 1}
                      selected={selected.includes(cand.id)}
                      onSelect={(id, next) =>
                        setSelected((s) => (next ? [...s, id] : s.filter((x) => x !== id)))
                      }
                      onEvidence={(factPath) =>
                        setEvidenceTarget({
                          candidate: cand,
                          factPath,
                          title: `${cand.supplierName} — evidence`,
                        })
                      }
                    />
                  ))}
                </div>
              )}
            </section>
          )}

          {/* Comparison */}
          {qualifying.length >= 2 && <Comparison candidates={qualifying} headline={headline} />}

          {/* Excluded */}
          {excluded.length > 0 && (
            <section>
              <SectionHeading count={excluded.length}>Ruled out</SectionHeading>
              <div className="space-y-3">
                {excluded.map((cand) => (
                  <CandidateCard
                    key={cand.id}
                    candidate={cand}
                    selected={false}
                    onEvidence={(factPath) =>
                      setEvidenceTarget({
                        candidate: cand,
                        factPath,
                        title: `${cand.supplierName} — evidence`,
                      })
                    }
                  />
                ))}
              </div>
            </section>
          )}

          {/* Outreach */}
          <OutreachTray
            drafts={snapshot.drafts}
            approvals={snapshot.approvals}
            attempts={snapshot.attempts}
            emailConfigured={health?.configured ?? false}
            allowlist={health?.allowlist ?? []}
            onEdit={editDraft}
            onApprove={approveDraft}
            onWithdraw={withdrawApproval}
            onSend={sendDraft}
          />

          {c.state === 'OUTREACH_COMPLETE' && (
            <Banner tone="success">
              Outreach stage complete. This means the requests have left — not that supply is
              secured. Track replies in your inbox.
            </Banner>
          )}
        </div>

        {/* ── Right rail ──────────────────────────────────────────────────── */}
        <aside className="lg:sticky lg:top-6 lg:h-fit">
          <Timeline
            events={liveEvents}
            running={isRunning}
            pagesFetched={run?.pagesFetched ?? 0}
            pagesFailed={run?.pagesFailed ?? 0}
            onCancel={cancelResearch}
          />

          {hasResults && !isRunning && (
            <Button className="mt-3 w-full" onClick={startResearch} disabled={busy === 'research'}>
              {busy === 'research' ? <Spinner /> : null} Re-run research
            </Button>
          )}
          {hasResults && (
            <p className="mt-2 text-[11.5px] leading-relaxed text-ink-faint">
              Prices and availability go stale. A re-run replaces this shortlist with freshly
              retrieved information rather than mixing old and new.
            </p>
          )}
        </aside>
      </div>

      <EvidenceDrawer
        target={evidenceTarget}
        evidence={snapshot.evidence}
        onClose={() => setEvidenceTarget(null)}
      />
    </div>
  );
}
