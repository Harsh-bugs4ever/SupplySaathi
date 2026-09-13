'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { CaseSnapshot } from './types';
import type { ResearchEvent } from '@/lib/domain/types';

/**
 * Case data + live progress.
 *
 * Progress arrives over SSE, but the SSE stream is treated as a hint rather
 * than the source of truth: when the run reaches a terminal state we refetch
 * the full snapshot. That way a dropped connection, a slow client or a worker
 * restart can never leave the UI showing a state the database disagrees with.
 *
 * On reconnect we resume from the last sequence number we saw, so no timeline
 * entry is skipped or duplicated.
 */
export function useCase(caseId: string) {
  const [snapshot, setSnapshot] = useState<CaseSnapshot | null>(null);
  const [liveEvents, setLiveEvents] = useState<ResearchEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const lastSeq = useRef(0);
  const sourceRef = useRef<EventSource | null>(null);

  const refetch = useCallback(async () => {
    try {
      const res = await fetch(`/api/cases/${caseId}`, { cache: 'no-store' });
      if (!res.ok) {
        setError(res.status === 404 ? 'This case no longer exists.' : 'Could not load this case.');
        return null;
      }
      const data: CaseSnapshot = await res.json();
      setSnapshot(data);
      setLiveEvents(data.events);
      lastSeq.current = data.events.reduce((m, e) => Math.max(m, e.seq), 0);
      setError(null);
      return data;
    } catch (err) {
      setError((err as Error).message);
      return null;
    } finally {
      setLoading(false);
    }
  }, [caseId]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  const isRunning =
    snapshot?.run?.status === 'running' || snapshot?.run?.status === 'queued';

  // Open the stream only while there is something to watch.
  useEffect(() => {
    if (!snapshot || !isRunning) {
      sourceRef.current?.close();
      sourceRef.current = null;
      return;
    }
    if (sourceRef.current) return;

    const es = new EventSource(`/api/cases/${caseId}/stream?lastSeq=${lastSeq.current}`);
    sourceRef.current = es;

    es.addEventListener('event', (e) => {
      const ev: ResearchEvent = JSON.parse((e as MessageEvent).data);
      lastSeq.current = Math.max(lastSeq.current, ev.seq);
      setLiveEvents((prev) => (prev.some((p) => p.id === ev.id) ? prev : [...prev, ev]));
    });

    es.addEventListener('progress', (e) => {
      const p = JSON.parse((e as MessageEvent).data);
      setSnapshot((prev) =>
        prev
          ? {
              ...prev,
              case: { ...prev.case, state: p.state },
              run: prev.run
                ? {
                    ...prev.run,
                    status: p.status,
                    pagesFetched: p.pagesFetched,
                    pagesFailed: p.pagesFailed,
                  }
                : prev.run,
            }
          : prev,
      );
    });

    // Candidates and evaluations are only written as the run proceeds, so the
    // authoritative snapshot is pulled once it finishes.
    es.addEventListener('done', () => {
      es.close();
      sourceRef.current = null;
      void refetch();
    });

    es.onerror = () => {
      es.close();
      sourceRef.current = null;
      // Fall back to a single refetch; the effect re-opens the stream if the
      // run is still going.
      setTimeout(() => void refetch(), 1500);
    };

    return () => {
      es.close();
      sourceRef.current = null;
    };
  }, [caseId, isRunning, snapshot, refetch]);

  return { snapshot, liveEvents, error, loading, refetch, isRunning, setSnapshot };
}
