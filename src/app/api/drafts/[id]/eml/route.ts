import { config } from '@/lib/config/env';
import { db, paramOf, requireAuth } from '@/lib/api/helpers';
import * as repo from '@/lib/db/repo';
import { buildEml } from '@/lib/providers/email';

export const runtime = 'nodejs';

/**
 * Download the draft as an .eml file.
 *
 * This is an export, not a send. Nothing is transmitted to the supplier, the
 * draft status becomes "exported", and the UI labels it that way.
 */
export async function GET(req: Request, ctx: { params: Promise<Record<string, string>> }) {
  const auth = requireAuth(req);
  if (auth) return auth;

  const id = await paramOf(ctx, 'id');
  const database = db();
  const draft = repo.getDraft(id, database);
  if (!draft) return new Response('Draft not found', { status: 404 });

  const from = config.email.fromAddress
    ? `${config.email.fromName} <${config.email.fromAddress}>`
    : config.email.fromName;

  const eml = buildEml(
    {
      to: draft.recipientEmail ?? '',
      subject: draft.subject,
      body: draft.body,
      replyTo: config.email.replyTo || undefined,
    },
    from,
  );

  // Only mark exported if it has not already been sent.
  if (draft.status === 'draft' || draft.status === 'approved') {
    repo.setDraftStatus(draft.id, 'exported', database);
  }

  const filename = `rfq-${draft.supplierName.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-${draft.id.slice(-6)}.eml`;

  return new Response(eml, {
    headers: {
      'Content-Type': 'message/rfc822',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}
