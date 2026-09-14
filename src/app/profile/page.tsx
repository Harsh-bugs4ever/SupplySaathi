import { ProfileEditor } from '@/components/ProfileEditor';

/**
 * Business profile and memory.
 *
 * A thin shell: the editor fetches `/api/profile` and `/api/memory` from the
 * browser, because this page deploys to Vercel and the database lives beside
 * the worker on the API host.
 */
export default function ProfilePage() {
  return <ProfileEditor />;
}
