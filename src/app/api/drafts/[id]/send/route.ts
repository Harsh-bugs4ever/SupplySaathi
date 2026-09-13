import { config } from '@/lib/config/env';
import { db, fail, handler, ok, paramOf } from '@/lib/api/helpers';
import * as repo from '@/lib/db/repo';
import { sendApprovedDraft } from '@/lib/agent/outreach';

export const runtime = 'nodejs';

/**
 * Execute an approved send.
 *
 * All the real guards live in `sendApprovedDraft`, which re-reads the approval,
 * the content hash and the recipient from the database. Nothing the client
 * sends can widen what is permitted here.
 */
export const POST = handler(async (_req, ctx) => {
  const id = await paramOf(ctx, 'id');
  const database = db();

  const draft = repo.getDraft(id, database);
  if (!draft) return fail('Draft not found.', 404);

  const result = await sendApprovedDraft(id, { cfg: config, db: database });

  return ok(
    {
      ...result,
      draft: repo.getDraft(id, database),
      attempts: repo.listAttempts(draft.caseId, database).filter((a) => a.draftId === id),
      case: repo.getCase(draft.caseId, database),
    },
    { status: result.ok ? 200 : result.duplicate ? 200 : 422 },
  );
});
