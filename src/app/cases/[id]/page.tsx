import { Workspace } from '@/components/workspace/Workspace';

export const dynamic = 'force-dynamic';

export default async function CasePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Workspace caseId={id} />;
}
