import { z } from 'zod';
import { db, fail, handler, ok, parseBody, paramOf } from '@/lib/api/helpers';
import * as repo from '@/lib/db/repo';
import { isValidEmail } from '@/lib/providers/email';

export const runtime = 'nodejs';

/**
 * Explicit approval to send.
 *
 * The client must echo back the content hash it displayed. If it does not match
 * what is stored, the user approved something other than what would be sent —
 * for example because another tab edited the draft — and we refuse.
 */
const ApproveSchema = z.object({
  contentHash: z.string().length(64),
});

export const POST = handler(async (req, ctx) => {
  const id = await paramOf(ctx, 'id');
  const parsed = await parseBody(req, ApproveSchema);
  if (!parsed.ok) return parsed.response;

  const database = db();
  const draft = repo.getDraft(id, database);
  if (!draft) return fail('Draft not found.', 404);

  if (!draft.recipientEmail || !isValidEmail(draft.recipientEmail)) {
    return fail('Add a valid recipient address before approving.', 409);
  }

  if (parsed.data.contentHash !== draft.contentHash) {
    return fail(
      'This draft changed since you reviewed it. Reload and check the content before approving.',
      409,
      { currentHash: draft.contentHash },
    );
  }

  const { approval, draft: updated } = repo.approveDraft(id, database);
  repo.setCaseState(draft.caseId, 'AWAITING_APPROVAL', database);

  return ok({ approval, draft: updated });
});

/** Withdraw an approval before sending. */
export const DELETE = handler(async (_req, ctx) => {
  const id = await paramOf(ctx, 'id');
  const database = db();
  const draft = repo.getDraft(id, database);
  if (!draft) return fail('Draft not found.', 404);

  if (draft.status === 'sending' || draft.status === 'accepted_by_provider') {
    return fail('This request has already been sent.', 409);
  }

  // Re-running updateDraft with identical content is a no-op, so the approval
  // is invalidated directly.
  const approval = repo.getLiveApproval(id, database);
  if (approval) {
    database
      .prepare('UPDATE outreach_approval SET invalidated_at = ?, invalidation_reason = ? WHERE id = ?')
      .run(new Date().toISOString(), 'Withdrawn by the user.', approval.id);
  }
  repo.setDraftStatus(id, 'draft', database);

  return ok({ draft: repo.getDraft(id, database), message: 'Approval withdrawn.' });
});
