import { db, paramOf, refuseIfProxyRole, requireAuth } from '@/lib/api/helpers';
import * as repo from '@/lib/db/repo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Server-sent events for live research progress.
 *
 * Events are read from the database rather than pushed from the worker, which
 * means this endpoint has no shared state with the worker process and survives
 * either side restarting. A reconnecting client replays from `lastSeq`, so no
 * timeline entry is lost to a dropped connection.
 *
 * The stream closes on its own once the run reaches a terminal state, so an
 * abandoned tab does not hold a connection open indefinitely.
 */
export async function GET(req: Request, ctx: { params: Promise<Record<string, string>> }) {
  const misrouted = refuseIfProxyRole();
  if (misrouted) return misrouted;

  const auth = requireAuth(req);
  if (auth) return auth;

  const id = await paramOf(ctx, 'id');
  const database = db();

  const sourcingCase = repo.getCase(id, database);
  if (!sourcingCase) {
    return new Response('Case not found', { status: 404 });
  }

  const url = new URL(req.url);
  let lastSeq = Number(url.searchParams.get('lastSeq') ?? '0') || 0;

  const encoder = new TextEncoder();
  const POLL_MS = 700;
  const MAX_DURATION_MS = 10 * 60 * 1000;

  const stream = new ReadableStream({
    async start(controller) {
      const started = Date.now();
      let closed = false;

      const send = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          closed = true;
        }
      };

      const close = () => {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {
          /* already closed by the client */
        }
      };

      // The client aborting is the normal ending, not an error.
      req.signal.addEventListener('abort', close);

      const run = repo.latestRun(sourcingCase.id, database);
      if (!run) {
        send('status', { state: sourcingCase.state, message: 'No research run has started yet.' });
        close();
        return;
      }

      send('open', { runId: run.id, state: sourcingCase.state, status: run.status });

      while (!closed) {
        if (Date.now() - started > MAX_DURATION_MS) {
          send('timeout', { message: 'Stream closed after 10 minutes. Reload to resume.' });
          close();
          break;
        }

        const events = repo.listEvents(sourcingCase.id, lastSeq, run.id, database);
        for (const ev of events) {
          send('event', ev);
          lastSeq = ev.seq;
        }

        const current = repo.getRun(run.id, database);
        const currentCase = repo.getCase(sourcingCase.id, database);

        if (current && currentCase) {
          send('progress', {
            status: current.status,
            state: currentCase.state,
            pagesFetched: current.pagesFetched,
            pagesFailed: current.pagesFailed,
            lastSeq,
          });

          if (['succeeded', 'partial', 'failed', 'cancelled'].includes(current.status)) {
            // Flush any event written between the last poll and the status change.
            for (const ev of repo.listEvents(sourcingCase.id, lastSeq, run.id, database)) {
              send('event', ev);
              lastSeq = ev.seq;
            }
            send('done', { status: current.status, state: currentCase.state });
            close();
            break;
          }
        }

        await new Promise((r) => setTimeout(r, POLL_MS));
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Stops proxies buffering the stream into uselessness.
      'X-Accel-Buffering': 'no',
    },
  });
}
