'use client';

import { useEffect, useRef } from 'react';
import type { ResearchEvent, ResearchEventKind } from '@/lib/domain/types';
import { Card, SectionHeading, Spinner } from '../ui';

/**
 * The research timeline.
 *
 * Every entry here corresponds to a row the worker wrote after an action
 * actually completed. There is no synthetic progress, no fake typing, and no
 * chain-of-thought — just what was done, what was found, and why something was
 * ruled out.
 */

const KIND_STYLE: Record<ResearchEventKind, { dot: string; label: string }> = {
  plan: { dot: 'bg-ink-faint', label: 'Plan' },
  search: { dot: 'bg-ink-faint', label: 'Search' },
  fetch: { dot: 'bg-primary/50', label: 'Read' },
  fetch_failed: { dot: 'bg-warning', label: 'Unreadable' },
  extract: { dot: 'bg-primary/50', label: 'Extract' },
  evaluate: { dot: 'bg-primary', label: 'Match' },
  exclude: { dot: 'bg-danger', label: 'Excluded' },
  question: { dot: 'bg-warning', label: 'Question' },
  memory: { dot: 'bg-accent-deep', label: 'Memory' },
  status: { dot: 'bg-line-strong', label: 'Status' },
  warning: { dot: 'bg-warning', label: 'Warning' },
  error: { dot: 'bg-danger', label: 'Error' },
};

export function Timeline({
  events,
  running,
  pagesFetched,
  pagesFailed,
  onCancel,
}: {
  events: ResearchEvent[];
  running: boolean;
  pagesFetched: number;
  pagesFailed: number;
  onCancel?: () => void;
}) {
  const endRef = useRef<HTMLDivElement>(null);
  const count = events.length;

  // Follow the tail only while the run is live, so a user reading back through
  // history is not yanked to the bottom.
  useEffect(() => {
    if (running) endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [count, running]);

  return (
    <Card className="flex h-full flex-col overflow-hidden">
      <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
        <SectionHeading>
          <span className="flex items-center gap-2">
            {running && <Spinner className="text-primary" />}
            Activity
          </span>
        </SectionHeading>
        {running && onCancel && (
          <button
            onClick={onCancel}
            className="rounded-md px-2 py-1 text-[12px] text-danger-ink transition hover:bg-danger-wash"
          >
            Stop
          </button>
        )}
      </div>

      {(pagesFetched > 0 || pagesFailed > 0) && (
        <div className="flex gap-4 border-b border-line bg-paper px-4 py-2 text-[12px]">
          <span className="text-ink-soft">
            <span className="num font-medium text-ink">{pagesFetched}</span> read
          </span>
          {pagesFailed > 0 && (
            <span className="text-warning-ink">
              <span className="num font-medium">{pagesFailed}</span> unreadable
            </span>
          )}
        </div>
      )}

      <ol className="scroll-slim max-h-[420px] flex-1 overflow-y-auto px-4 py-3 lg:max-h-[calc(100vh-260px)]">
        {events.length === 0 && (
          <li className="py-6 text-center text-[13px] text-ink-faint">
            Nothing has happened yet.
          </li>
        )}

        {events.map((ev, i) => {
          const style = KIND_STYLE[ev.kind] ?? KIND_STYLE.status;
          const isLast = i === events.length - 1;

          return (
            <li key={ev.id} className="animate-arrive relative flex gap-3 pb-3.5">
              {!isLast && (
                <span
                  aria-hidden
                  className="absolute left-[3.5px] top-[14px] h-full w-px bg-line"
                />
              )}
              <span
                aria-hidden
                className={`relative mt-[5px] h-2 w-2 shrink-0 rounded-full ${style.dot}`}
              />
              <div className="min-w-0 flex-1">
                <p
                  className={`text-[13px] leading-snug ${
                    ev.kind === 'exclude'
                      ? 'text-danger-ink'
                      : ev.kind === 'fetch_failed' || ev.kind === 'warning'
                        ? 'text-warning-ink'
                        : 'text-ink'
                  }`}
                >
                  {ev.message}
                </p>
                {ev.detail && (
                  <p className="mt-1 whitespace-pre-line break-words text-[12px] leading-relaxed text-ink-faint">
                    {ev.detail}
                  </p>
                )}
                <time
                  className="num mt-1 block text-[10px] text-ink-faint"
                  dateTime={ev.createdAt}
                >
                  {new Date(ev.createdAt).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                  })}
                </time>
              </div>
            </li>
          );
        })}
        <div ref={endRef} />
      </ol>
    </Card>
  );
}
