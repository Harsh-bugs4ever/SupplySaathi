import { db, fail, handler, ok, paramOf } from '@/lib/api/helpers';
import * as repo from '@/lib/db/repo';

export const runtime = 'nodejs';

/**
 * Full case snapshot.
 *
 * One request returns everything the workspace renders, so a page refresh
 * restores the exact state — including a run still in progress. The client does
 * not have to stitch several endpoints together to know where a case is.
 */
export const GET = handler(async (_req, ctx) => {
  const id = await paramOf(ctx, 'id');
  const database = db();

  const sourcingCase = repo.getCase(id, database);
  if (!sourcingCase) return fail('Case not found.', 404);

  const candidates = repo.listCandidates(sourcingCase.id, database);
  const evaluations = repo.listEvaluations(sourcingCase.id, database);
  const run = repo.latestRun(sourcingCase.id, database);

  return ok({
    case: sourcingCase,
    requirements: repo.listRequirements(sourcingCase.id, database),
    candidates: candidates.map((c) => ({
      ...c,
      evaluations: evaluations.filter((e) => e.candidateId === c.id),
    })),
    evidence: repo.listEvidence(sourcingCase.id, undefined, database),
    run,
    events: repo.listEvents(sourcingCase.id, 0, undefined, database),
    drafts: repo.listDrafts(sourcingCase.id, database),
    approvals: repo.listApprovals(sourcingCase.id, database),
    attempts: repo.listAttempts(sourcingCase.id, database),
    profile: repo.getOrCreateProfile(database),
  });
});
