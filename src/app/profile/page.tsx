import { config } from '@/lib/config/env';
import { db } from '@/lib/api/helpers';
import * as repo from '@/lib/db/repo';
import { createMemoryProvider } from '@/lib/providers/memory';
import { ProfileEditor } from '@/components/ProfileEditor';

export const dynamic = 'force-dynamic';

export default async function ProfilePage() {
  const database = db();
  const profile = repo.getOrCreateProfile(database);
  const notes = repo.listNotes(profile.id, database);

  const memory = createMemoryProvider(config, profile.id, database);
  // A memory outage must never block the page; it is reported, not thrown.
  const memoryUnavailable = await memory.remoteUnavailable().catch(() => true);

  return (
    <ProfileEditor
      initialProfile={profile}
      initialNotes={notes}
      cogneeConfigured={Boolean(config.cognee.apiKey && config.cognee.baseUrl)}
      memoryUnavailable={memoryUnavailable}
    />
  );
}
