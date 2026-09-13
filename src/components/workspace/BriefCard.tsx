'use client';

import { useState } from 'react';
import { Banner, Button, Card, RequirementChip, SectionHeading, StatePill } from '../ui';
import type { CaseSnapshot } from './types';

/**
 * The sourcing brief, rendered as a document.
 *
 * It carries the resolved deadline prominently, because "Friday" becoming a
 * specific date is a decision the agent made on the user's behalf and they must
 * be able to catch it before research spends any budget on the wrong date.
 */
export function BriefCard({
  snapshot,
  onAnswer,
  onToggleMemory,
}: {
  snapshot: CaseSnapshot;
  onAnswer: (answers: Array<{ id: string; answer: string }>) => Promise<void>;
  onToggleMemory: (id: string, accepted: boolean) => void;
}) {
  const { case: c, requirements } = snapshot;
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const musts = requirements.filter((r) => r.priority === 'must_have');
  const prefs = requirements.filter((r) => r.priority === 'preference');
  const unanswered = c.clarifications.filter((q) => !q.answer);

  const deadlineDisplay = c.resolvedDeadline
    ? new Date(`${c.resolvedDeadline}T12:00:00Z`).toLocaleDateString('en-GB', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC',
      })
    : null;

  return (
    <Card as="section" className="overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
        <div className="min-w-0">
          <div className="mb-1.5 flex items-center gap-2">
            <span className="num rounded bg-surface-sunk px-1.5 py-0.5 text-[11px] font-medium text-ink-soft">
              {c.reference}
            </span>
            <StatePill state={c.state} />
          </div>
          <h1 className="display text-[22px] leading-tight text-ink">{c.title}</h1>
        </div>
      </div>

      <div className="px-5 py-4">
        <p className="border-l-2 border-line pl-3 text-[14px] leading-relaxed text-ink-soft">
          {c.briefText}
        </p>

        {/* The resolved deadline, shown before research begins. */}
        {deadlineDisplay && (
          <div className="mt-4 flex flex-wrap items-baseline gap-x-2 gap-y-1 rounded-lg bg-paper px-3.5 py-3">
            <span className="text-[12px] text-ink-soft">Required arrival</span>
            <span className="num text-[15px] font-medium text-ink">{deadlineDisplay}</span>
            {c.deadlineSourcePhrase && (
              <span className="text-[12px] text-ink-faint">
                — resolved from “{c.deadlineSourcePhrase}” in {c.timezone}
              </span>
            )}
          </div>
        )}

        {c.originalProductUrl && (
          <p className="mt-3 truncate text-[12px] text-ink-faint">
            Original listing:{' '}
            <a
              href={c.originalProductUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="text-primary underline decoration-primary/30 underline-offset-2"
            >
              {c.originalProductUrl}
            </a>
          </p>
        )}

        <div className="mt-5">
          <SectionHeading>Requirements</SectionHeading>
          <div className="flex flex-wrap gap-1.5">
            {musts.map((r) => (
              <RequirementChip key={r.id} label={r.label} priority="must_have" />
            ))}
            {prefs.map((r) => (
              <RequirementChip key={r.id} label={r.label} priority="preference" />
            ))}
            {!requirements.length && (
              <span className="text-[13px] text-ink-faint">No requirements recorded.</span>
            )}
          </div>
        </div>

        {/* Remembered preferences are shown, attributed, and switchable. */}
        {c.appliedMemory.length > 0 && (
          <div className="mt-5">
            <SectionHeading>From your business memory</SectionHeading>
            <ul className="space-y-1.5">
              {c.appliedMemory.map((m) => (
                <li
                  key={m.id}
                  className="flex items-start justify-between gap-3 rounded-lg border border-line bg-paper px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="text-[13px] text-ink">{m.text}</p>
                    <p className="mt-0.5 text-[11px] text-ink-faint">
                      Remembered from a previous case · {m.source}
                    </p>
                  </div>
                  <label className="flex shrink-0 items-center gap-1.5 text-[12px] text-ink-soft">
                    <input
                      type="checkbox"
                      checked={m.accepted}
                      onChange={(e) => onToggleMemory(m.id, e.target.checked)}
                      className="accent-[var(--color-primary)]"
                    />
                    Apply
                  </label>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Only questions that change which products qualify. */}
        {unanswered.length > 0 && (
          <div className="mt-5 rounded-lg border border-warning/35 bg-warning-wash p-4">
            <h3 className="text-[13px] font-semibold text-warning-ink">
              {unanswered.length} answer{unanswered.length === 1 ? '' : 's'} needed before research
            </h3>
            <p className="mt-1 text-[12px] text-warning-ink/85">
              These change which products qualify, so we have not started searching.
            </p>

            <div className="mt-3 space-y-3">
              {unanswered.map((q) => (
                <div key={q.id}>
                  <label
                    htmlFor={`q-${q.id}`}
                    className="block text-[13px] font-medium text-ink"
                  >
                    {q.question}
                  </label>
                  <p className="mb-1.5 text-[12px] text-ink-soft">{q.reason}</p>
                  <input
                    id={`q-${q.id}`}
                    value={answers[q.id] ?? ''}
                    onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })}
                    className="w-full rounded-lg border border-warning/35 bg-surface px-3 py-2 text-[14px] focus:border-primary focus:outline-none"
                  />
                </div>
              ))}
            </div>

            <Button
              variant="primary"
              size="sm"
              className="mt-3"
              disabled={saving || unanswered.some((q) => !answers[q.id]?.trim())}
              onClick={async () => {
                setSaving(true);
                await onAnswer(
                  unanswered
                    .filter((q) => answers[q.id]?.trim())
                    .map((q) => ({ id: q.id, answer: answers[q.id].trim() })),
                );
                setSaving(false);
              }}
            >
              {saving ? 'Saving…' : 'Save answers'}
            </Button>
          </div>
        )}

        {c.clarifications.some((q) => q.answer) && (
          <div className="mt-4">
            <SectionHeading>Answered</SectionHeading>
            <ul className="space-y-1">
              {c.clarifications
                .filter((q) => q.answer)
                .map((q) => (
                  <li key={q.id} className="text-[13px] text-ink-soft">
                    <span className="text-ink-faint">{q.question}</span>{' '}
                    <span className="font-medium text-ink">{q.answer}</span>
                  </li>
                ))}
            </ul>
          </div>
        )}
      </div>
    </Card>
  );
}

export function ModeNotice({ mode }: { mode: 'demo' | 'live' }) {
  if (mode === 'live') return null;
  return (
    <Banner tone="warning">
      This case runs on sample supplier data. Nothing here is a real listing, and no outreach will
      leave the machine.
    </Banner>
  );
}
