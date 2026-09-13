import { config } from '@/lib/config/env';
import { NewCaseForm } from '@/components/NewCaseForm';

export const dynamic = 'force-dynamic';

export default function HomePage() {
  return <NewCaseForm defaultMode={config.mode} timezone={config.timezone} />;
}
