import { db, fail, handler, ok, paramOf } from '@/lib/api/helpers';
import * as repo from '@/lib/db/repo';

export const runtime = 'nodejs';

/**
 * Request cancellation of the active run.
 *
 * This sets a flag rather than killing anything: the worker checks it between
 * units of work and stops cleanly, keeping whatever it has already found. A
 * half-written candidate is worse than a slightly delayed stop.
 */
export const POST = handler(async (_req, ctx) => {
  const id = await paramOf(ctx, 'id');
  const database = db();

  const sourcingCase = repo.getCase(id, database);
  if (!sourcingCase) return fail('Case not found.', 404);

  const run = repo.latestRun(sourcingCase.id, database);
  if (!run) return fail('There is no run to cancel.', 409);

  if (['succeeded', 'partial', 'failed', 'cancelled'].includes(run.status)) {
    return ok({ run, message: 'That run had already finished.' });
  }

  repo.requestCancel(run.id, database);
  repo.appendEvent(
    {
      caseId: sourcingCase.id,
      runId: run.id,
      kind: 'status',
      message: 'Cancellation requested. Finishing the current page, then stopping.',
    },
    database,
  );

  return ok({ run: repo.getRun(run.id, database), message: 'Cancellation requested.' });
});
