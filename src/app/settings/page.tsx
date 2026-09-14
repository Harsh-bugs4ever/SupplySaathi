import { SettingsView } from '@/components/SettingsView';

/**
 * Settings.
 *
 * A thin shell. Everything shown here comes from `/api/health`, which probes
 * each provider against its real endpoint — so "search unavailable" means the
 * credentials genuinely do not grant search, not that a variable is missing.
 *
 * This page deploys to Vercel and has no server config of its own, so the API
 * reports which credentials are *present* as booleans. The values never leave
 * the API host.
 */
export default function SettingsPage() {
  return <SettingsView />;
}
