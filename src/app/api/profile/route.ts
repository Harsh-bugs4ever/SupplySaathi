import { z } from 'zod';
import { db, handler, ok, parseBody } from '@/lib/api/helpers';
import * as repo from '@/lib/db/repo';

export const runtime = 'nodejs';

const ProfileSchema = z.object({
  businessName: z.string().min(1).max(120).optional(),
  city: z.string().max(80).optional(),
  postalCode: z.string().max(20).optional(),
  country: z.string().max(4).optional(),
  currency: z.string().length(3).optional(),
  timezone: z.string().max(60).optional(),
  contactEmail: z.string().max(160).optional(),
});

export const GET = handler(async () => ok({ profile: repo.getOrCreateProfile(db()) }));

export const PATCH = handler(async (req) => {
  const parsed = await parseBody(req, ProfileSchema);
  if (!parsed.ok) return parsed.response;

  const database = db();
  const current = repo.getOrCreateProfile(database);

  // A bad timezone would silently corrupt every deadline, so it is validated
  // against the platform's own IANA database rather than trusted.
  if (parsed.data.timezone) {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: parsed.data.timezone });
    } catch {
      return ok({ error: `"${parsed.data.timezone}" is not a recognised timezone.` }, { status: 400 });
    }
  }

  return ok({ profile: repo.updateProfile({ ...parsed.data, id: current.id }, database) });
});
