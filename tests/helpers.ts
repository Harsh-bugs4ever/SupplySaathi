import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getDb, migrate } from '@/lib/db/client';
import { loadConfig, type AppConfig } from '@/lib/config/load';
import type { Db } from '@/lib/db/sqlite';

/**
 * Each test file gets its own on-disk database.
 *
 * On disk rather than in memory, because several tests exist specifically to
 * prove that state survives being written and read back — an in-memory database
 * would quietly make those tests pass for the wrong reason.
 */

export function makeTestDb(label: string): { db: Db; cleanup: () => void; path: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `supplysaathi-${label}-`));
  const file = path.join(dir, 'test.db');

  const db = getDb(file);
  migrate(db, path.join(process.cwd(), 'migrations'));

  return {
    db,
    path: file,
    cleanup: () => {
      try {
        db.close();
      } catch {
        /* already closed */
      }
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        /* Windows sometimes holds the handle briefly; the temp dir is disposable */
      }
    },
  };
}

export function testConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  const base = loadConfig();
  return {
    ...base,
    mode: 'demo',
    // Never let a test reach a real provider, whatever is in the developer's
    // .env.local. Demo mode already routes to fixtures; blanking the keys makes
    // that guarantee independent of mode.
    deepseek: { ...base.deepseek, apiKey: '' },
    anakin: { ...base.anakin, apiKey: '' },
    cognee: { ...base.cognee, apiKey: '', baseUrl: '' },
    email: { ...base.email, provider: 'none', allowlist: [] },
    ...overrides,
  };
}

export const DEMO_BRIEF =
  'Our usual supplier cancelled. We need 500 cake boxes, 10 x 10 x 5 inches, ' +
  'suitable for direct food contact, delivered to Pune by Friday. Budget Rs 8000. ' +
  'Find alternatives and prepare quote requests.';
