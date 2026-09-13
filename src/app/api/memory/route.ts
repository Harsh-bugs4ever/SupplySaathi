import { z } from 'zod';
import { config } from '@/lib/config/env';
import { db, fail, handler, ok, parseBody } from '@/lib/api/helpers';
import * as repo from '@/lib/db/repo';
import { createMemoryProvider } from '@/lib/providers/memory';

export const runtime = 'nodejs';

const RememberSchema = z.object({
  text: z.string().min(3).max(500),
  kind: z.enum(['preference', 'supplier_note', 'rejection_reason']),
  caseId: z.string().max(80).optional(),
});

export const GET = handler(async () => {
  const database = db();
  const profile = repo.getOrCreateProfile(database);
  const memory = createMemoryProvider(config, profile.id, database);

  return ok({
    notes: repo.listNotes(profile.id, database),
    // Surfaced so the UI can say "memory temporarily unavailable" rather than
    // silently showing a shorter list.
    remoteUnavailable: await memory.remoteUnavailable(),
    cogneeConfigured: Boolean(config.cognee.apiKey && config.cognee.baseUrl),
  });
});

/**
 * Save something the user explicitly confirmed.
 *
 * Only reached from an explicit "remember this" action. The agent never writes
 * memory on its own inference, because a wrong remembered preference silently
 * distorts every future case.
 */
export const POST = handler(async (req) => {
  const parsed = await parseBody(req, RememberSchema);
  if (!parsed.ok) return parsed.response;

  const database = db();
  const profile = repo.getOrCreateProfile(database);
  const memory = createMemoryProvider(config, profile.id, database);

  await memory.remember(parsed.data);

  return ok({ notes: repo.listNotes(profile.id, database) }, { status: 201 });
});

export const DELETE = handler(async (req) => {
  const url = new URL(req.url);
  const id = url.searchParams.get('id');
  if (!id) return fail('Provide the note id to delete.');

  const database = db();
  const profile = repo.getOrCreateProfile(database);
  repo.deleteNote(id, database);

  return ok({ notes: repo.listNotes(profile.id, database) });
});
