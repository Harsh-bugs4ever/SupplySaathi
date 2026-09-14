import { config } from '@/lib/config/env';
import { db, fail, handler, ok, paramOf } from '@/lib/api/helpers';
import * as repo from '@/lib/db/repo';

export const runtime = 'nodejs';

/**
 * Start a research run.
 *
 * This enqueues a job and returns immediately. The actual work happens in the
 * worker process, so the run is not tied to this HTTP connection staying open —
 * which is the whole reason a business owner can start a case and close the tab.
 */
export const POST = handler(async (_req, ctx) => {
  const id = await paramOf(ctx, 'id');
  const database = db();

  // Keep the run, queued job, shortlist reset, and state change atomic.
  return database.transaction(() => {
  const sourcingCase = repo.getCase(id, database);
  if (!sourcingCase) return fail('Case not found.', 404);

  // Refuse to start while unanswered questions would change the search.
  const unanswered = sourcingCase.clarifications.filter((c) => !c.answer);
  if (unanswered.length) {
    return fail(
      `Answer the ${unanswered.length} outstanding question${unanswered.length === 1 ? '' : 's'} first — they change which products qualify.`,
      409,
      { clarifications: unanswered },
    );
  }

  const requirements = repo.listRequirements(sourcingCase.id, database);
  if (!requirements.length) {
    return fail('This case has no requirements to search against.', 409);
  }

  // One run at a time per case: two concurrent runs would interleave events and
  // fight over the candidate dedupe index.
  const existing = repo.latestRun(sourcingCase.id, database);
  if (existing && (existing.status === 'queued' || existing.status === 'running')) {
    return ok({ run: existing, alreadyRunning: true });
  }

  const round = (existing?.round ?? 0) + 1;
  if (round > config.agent.maxRounds) {
    return fail(
      `This case has already used its ${config.agent.maxRounds} research rounds. Start a new case or relax a requirement.`,
      409,
    );
  }

  // A re-run replaces the previous shortlist rather than appending to it, so
  // prices and availability are never a mix of old and new observations.
  if (existing) {
    repo.clearCandidateData(sourcingCase.id, database);
    repo.deleteDraftsForCase(sourcingCase.id, database);
  }

  const run = repo.createRun(sourcingCase.id, sourcingCase.mode, round, database);
  repo.enqueueJob({ kind: 'research', caseId: sourcingCase.id, runId: run.id }, database);
  repo.setCaseState(sourcingCase.id, 'RESEARCHING', database);

  repo.appendEvent(
    {
      caseId: sourcingCase.id,
      runId: run.id,
      kind: 'status',
      message: 'Queued for research.',
      detail: sourcingCase.resolvedDeadline
        ? `Working to a deadline of ${sourcingCase.resolvedDeadline} (${sourcingCase.timezone}).`
        : 'No deadline set for this case.',
    },
    database,
  );

  return ok({ run, alreadyRunning: false }, { status: 202 });
  })();
});
