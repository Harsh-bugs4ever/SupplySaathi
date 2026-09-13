import { z } from 'zod';
import { config } from '@/lib/config/env';
import { db, fail, handler, ok, parseBody, paramOf } from '@/lib/api/helpers';
import * as repo from '@/lib/db/repo';
import { draftQuotesForCase } from '@/lib/agent/outreach';

export const runtime = 'nodejs';

const GenerateSchema = z.object({
  candidateIds: z.array(z.string().max(80)).min(1).max(10),
});

/**
 * Generate quote requests for the selected candidates.
 *
 * Drafting is fast enough to do inside the request, unlike research. Nothing
 * here contacts a supplier: it produces editable text and stops.
 */
export const POST = handler(async (req, ctx) => {
  const id = await paramOf(ctx, 'id');
  const parsed = await parseBody(req, GenerateSchema);
  if (!parsed.ok) return parsed.response;

  const database = db();
  const sourcingCase = repo.getCase(id, database);
  if (!sourcingCase) return fail('Case not found.', 404);

  // Refuse to draft for an excluded candidate: writing to a supplier whose
  // product we know is wrong wastes their time and the user's credibility.
  const excluded = parsed.data.candidateIds.filter((cid) => {
    const c = repo.getCandidate(cid, database);
    return c?.status === 'does_not_meet' || c?.status === 'retrieval_failed';
  });
  if (excluded.length) {
    return fail(
      'One or more selected options do not meet your requirements. Remove them before drafting.',
      409,
      { excluded },
    );
  }

  const drafts = await draftQuotesForCase(sourcingCase.id, parsed.data.candidateIds, {
    cfg: config,
    db: database,
  });

  return ok({ drafts, case: repo.getCase(sourcingCase.id, database) }, { status: 201 });
});
