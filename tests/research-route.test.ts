import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { makeTestDb } from './helpers';
import * as repo from '@/lib/db/repo';
import type { Db } from '@/lib/db/sqlite';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/config/env', async () => ({ config: (await import('./helpers')).testConfig({ auth: { enabled: false, password: '' } }) }));
let database: Db;
let cleanup: () => void;
vi.mock('@/lib/api/helpers', async (original) => ({ ...await original<typeof import('@/lib/api/helpers')>(), db: () => database }));
import { POST } from '@/app/api/cases/[id]/research/route';

beforeEach(() => { ({ db: database, cleanup } = makeTestDb('research-route')); });
afterEach(() => { vi.restoreAllMocks(); cleanup(); });

function createCase() {
  const profile = repo.getOrCreateProfile(database);
  const c = repo.createCase({ profileId: profile.id, title: 'Boxes', briefText: 'Need 500 boxes', originalProductUrl: null, mode: 'demo', resolvedDeadline: null, deadlineSourcePhrase: null, timezone: profile.timezone, currency: 'INR' }, database);
  repo.addRequirement({ caseId: c.id, kind: 'quantity', priority: 'must_have', label: '500 boxes', spec: { kind: 'quantity', units: 500, partialOk: false } }, database);
  return c;
}

it('rolls back the run when queue insertion fails', async () => {
  const c = createCase();
  vi.spyOn(repo, 'enqueueJob').mockImplementation(() => { throw new Error('Simulated queue failure'); });
  const response = await POST(new Request(`http://localhost:3000/api/cases/${c.id}/research`, { method: 'POST' }), { params: Promise.resolve({ id: c.id }) });
  expect(response.status).toBe(500);
  expect(repo.latestRun(c.id, database)).toBeNull();
  expect(repo.getCase(c.id, database)?.state).toBe('DRAFT');
});

it('reuses a queued run instead of creating a second job', async () => {
  const c = createCase();
  const request = () => POST(new Request(`http://localhost:3000/api/cases/${c.id}/research`, { method: 'POST' }), { params: Promise.resolve({ id: c.id }) });
  expect((await request()).status).toBe(202);
  const repeated = await request();
  expect((await repeated.json()).alreadyRunning).toBe(true);
  expect(database.prepare('SELECT COUNT(*) AS n FROM job').get()?.n).toBe(1);
});
