import { CasesList } from '@/components/CasesList';

/**
 * Case history.
 *
 * A thin shell. The list itself is a client component that fetches
 * `/api/cases`, because this page is deployed to Vercel and has no access to
 * the database — that lives beside the worker on the API host.
 */
export default function CasesPage() {
  return <CasesList />;
}
