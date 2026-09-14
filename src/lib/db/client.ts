import { openDatabase, type Db } from './sqlite';

export type { Db };
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../config/load';

/**
 * SQLite connection.
 *
 * Two processes touch this file: the Next.js server and the worker. WAL mode
 * lets the web app keep reading a case while the worker is writing research
 * events into it, which is the whole point of the live timeline. `busy_timeout`
 * absorbs the brief writer contention that follows.
 *
 * (Chosen over an ORM deliberately — see README "Why no ORM".)
 */

let instance: Db | null = null;

export function getDb(dbPath?: string): Db {
  if (instance && !dbPath) return instance;

  const target = dbPath ?? loadConfig().databasePath;
  const dir = path.dirname(target);

  // On a deployed instance the database lives on a mounted disk, and the most
  // common failure is that the mount is owned by root while the process is not.
  // SQLite reports that as a bare "unable to open database file", which sends
  // people looking in the wrong place — so the permission problem is diagnosed
  // here, in terms of the thing that actually needs fixing.
  try {
    if (dir && dir !== '.' && !fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    // Existing-but-not-a-directory is a distinct misconfiguration (a stray file
    // where the mount should be), and `access` alone would happily pass it.
    if (!fs.statSync(dir || '.').isDirectory()) {
      throw new Error('path exists but is not a directory');
    }
    fs.accessSync(dir || '.', fs.constants.W_OK);
  } catch (err) {
    const uid = typeof process.getuid === 'function' ? process.getuid() : 'n/a';
    throw new Error(
      `Cannot write the database directory "${dir}" (process uid ${uid}): ${(err as Error).message}. ` +
        `If this is a mounted volume, it is probably owned by another user. ` +
        `Set DATABASE_PATH to a writable location, or fix the ownership of the mount.`,
    );
  }

  const db = openDatabase(target);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.pragma('synchronous = NORMAL');

  if (!dbPath) instance = db;
  return db;
}

/** Apply every migration in `migrations/` that has not run yet. */
export function migrate(db: Db, migrationsDir?: string): string[] {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migration (
      name TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);

  const dir = migrationsDir ?? path.join(process.cwd(), 'migrations');
  if (!fs.existsSync(dir)) return [];

  const applied = new Set(
    db.prepare('SELECT name FROM _migration').all().map((r) => (r as { name: string }).name),
  );

  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const ran: string[] = [];
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    // Each migration is one transaction: a half-applied schema is worse than
    // no schema, because the next run would see inconsistent state.
    db.exec('BEGIN IMMEDIATE');
    try {
      // Another process may have migrated while we waited for the write lock.
      if (db.prepare('SELECT name FROM _migration WHERE name = ?').get(file)) {
        db.exec('COMMIT');
        continue;
      }
      db.exec(sql);
      db.prepare('INSERT INTO _migration (name, applied_at) VALUES (?, ?)').run(
        file,
        new Date().toISOString(),
      );
      db.exec('COMMIT');
      ran.push(file);
    } catch (err) {
      db.exec('ROLLBACK');
      throw new Error(`Migration ${file} failed: ${(err as Error).message}`);
    }
  }
  return ran;
}

export function closeDb(): void {
  instance?.close();
  instance = null;
}
