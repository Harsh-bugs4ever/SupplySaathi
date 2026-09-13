import { z } from 'zod';
import { db, fail, handler, ok, parseBody, paramOf } from '@/lib/api/helpers';
import * as repo from '@/lib/db/repo';
import { isValidEmail } from '@/lib/providers/email';

export const runtime = 'nodejs';

const UpdateSchema = z.object({
  recipientEmail: z.string().max(200).nullable().optional(),
  subject: z.string().min(1).max(300).optional(),
  body: z.string().min(1).max(20000).optional(),
});

export const GET = handler(async (_req, ctx) => {
  const id = await paramOf(ctx, 'id');
  const database = db();
  const draft = repo.getDraft(id, database);
  if (!draft) return fail('Draft not found.', 404);
  return ok({ draft, approval: repo.getLiveApproval(draft.id, database) });
});

/**
 * Edit a draft.
 *
 * Any change invalidates a standing approval — see `repo.updateDraft`, which
 * does both in one transaction so there is no moment where an old approval
 * covers new text.
 */
export const PATCH = handler(async (req, ctx) => {
  const id = await paramOf(ctx, 'id');
  const parsed = await parseBody(req, UpdateSchema);
  if (!parsed.ok) return parsed.response;

  const database = db();
  const existing = repo.getDraft(id, database);
  if (!existing) return fail('Draft not found.', 404);

  if (existing.status === 'sending') {
    return fail('This request is being sent and cannot be edited.', 409);
  }
  if (existing.status === 'accepted_by_provider') {
    return fail('This request has already been sent and cannot be edited.', 409);
  }

  const recipient = parsed.data.recipientEmail;
  if (recipient !== undefined && recipient !== null && recipient !== '') {
    if (!isValidEmail(recipient)) return fail('That is not a valid email address.');
  }

  const hadApproval = Boolean(repo.getLiveApproval(id, database));

  const updated = repo.updateDraft(
    id,
    {
      ...parsed.data,
      recipientEmail: recipient === '' ? null : recipient,
      // An address the user typed is recorded as such: we distinguish it from
      // one we read off a supplier page.
      recipientSource:
        recipient !== undefined && recipient !== existing.recipientEmail
          ? 'user_entered'
          : existing.recipientSource,
    },
    database,
  );

  const stillApproved = Boolean(repo.getLiveApproval(id, database));

  return ok({
    draft: updated,
    approvalInvalidated: hadApproval && !stillApproved,
    message:
      hadApproval && !stillApproved
        ? 'Your earlier approval no longer applies because the content changed. Approve again to send.'
        : undefined,
  });
});
