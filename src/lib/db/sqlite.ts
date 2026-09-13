import { DatabaseSync, type StatementSync } from 'node:sqlite';

/**
 * Thin adapter over Node's built-in SQLite (`node:sqlite`, stable in Node 22.5+).
 *
 * Why not better-sqlite3: it is a native addon with no prebuilt binary for
 * Node 24 on Windows, so `npm install` fails unless the user has a full MSVC
 * toolchain. For a project someone should be able to clone and run in two
 * minutes that is a poor trade. `node:sqlite` is the same SQLite engine with no
 * compile step, and this file restores the small ergonomic pieces the built-in
 * API leaves out.
 *
 * Differences papered over here:
 *   - booleans and `undefined` do not bind; they are coerced to 0/1 and NULL
 *   - statements reject unknown named parameters unless explicitly allowed
 *   - there is no `transaction()` wrapper
 */

export type SqlParams = Record<string, unknown> | unknown[];

export interface PreparedStatement {
  run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint };
  get<T = Record<string, any>>(...params: unknown[]): T | undefined;
  all<T = Record<string, any>>(...params: unknown[]): T[];
}

export interface Db {
  prepare(sql: string): PreparedStatement;
  exec(sql: string): void;
  pragma(statement: string): unknown;
  transaction<T>(fn: () => T): () => T;
  close(): void;
  readonly raw: DatabaseSync;
}

/**
 * SQLite binds only null, number, bigint, string and Uint8Array. Everything the
 * domain layer hands us must be reduced to those, and silently dropping a value
 * would corrupt a row, so unsupported types raise instead.
 */
/** Whether a value can be bound to a SQLite parameter at all. */
function isBindable(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  const t = typeof value;
  if (t === 'boolean' || t === 'number' || t === 'bigint' || t === 'string') return true;
  return value instanceof Uint8Array || value instanceof Date;
}

function coerce(value: unknown): null | number | bigint | string | Uint8Array {
  if (value === undefined || value === null) return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'number' || typeof value === 'bigint' || typeof value === 'string') {
    return value;
  }
  if (value instanceof Uint8Array) return value;
  if (value instanceof Date) return value.toISOString();
  throw new TypeError(
    `Cannot bind value of type ${typeof value} to SQLite. Serialise it before it reaches the repository.`,
  );
}

/**
 * Accept both calling conventions the repository uses:
 *   stmt.run({ id, name })      -> one object of named parameters
 *   stmt.run(id, name)          -> positional parameters
 */
function coerceParams(params: unknown[]): unknown[] {
  if (params.length === 0) return [];

  const [first] = params;
  const isNamedBag =
    params.length === 1 &&
    first !== null &&
    typeof first === 'object' &&
    !Array.isArray(first) &&
    !(first instanceof Uint8Array) &&
    !(first instanceof Date);

  if (isNamedBag) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(first as Record<string, unknown>)) {
      // Call sites spread whole domain objects, so the bag routinely carries
      // nested values (arrays, value objects) that this statement does not
      // bind. Drop them rather than throwing: SQLite ignores unknown names, and
      // if one *was* required the driver raises a clear "missing parameter".
      // Serialising them here instead would silently write JSON into a column
      // that a repository forgot to encode, which is the harder bug to find.
      if (!isBindable(v)) continue;
      out[k] = coerce(v);
    }
    return [out];
  }

  return params.map(coerce);
}

function wrapStatement(stmt: StatementSync): PreparedStatement {
  // Repository code spreads whole domain objects into `run`, which carry more
  // properties than the SQL names. Allowing the extras keeps call sites plain.
  stmt.setAllowUnknownNamedParameters(true);

  return {
    run(...params: unknown[]) {
      const res = stmt.run(...(coerceParams(params) as never[]));
      return { changes: Number(res.changes), lastInsertRowid: res.lastInsertRowid };
    },
    get<T>(...params: unknown[]) {
      const row = stmt.get(...(coerceParams(params) as never[]));
      // Rows come back with a null prototype; give them Object.prototype so
      // ordinary property access and spreading behave as expected downstream.
      return row === undefined ? undefined : ({ ...(row as object) } as T);
    },
    all<T>(...params: unknown[]) {
      return (stmt.all(...(coerceParams(params) as never[])) as object[]).map(
        (r) => ({ ...r }) as T,
      );
    },
  };
}

export function openDatabase(path: string): Db {
  const db = new DatabaseSync(path);

  const wrapper: Db = {
    prepare(sql: string) {
      return wrapStatement(db.prepare(sql));
    },
    exec(sql: string) {
      db.exec(sql);
    },
    pragma(statement: string) {
      // `PRAGMA x = y` returns no rows; `PRAGMA x` does. Try the reading form
      // and fall back, so both spellings work through one method.
      try {
        return db.prepare(`PRAGMA ${statement}`).get();
      } catch {
        db.exec(`PRAGMA ${statement}`);
        return undefined;
      }
    },
    /**
     * Transactions. Nested calls join the outer transaction rather than opening
     * a second one, which SQLite does not support.
     */
    transaction<T>(fn: () => T): () => T {
      return () => {
        if (inTransaction) return fn();
        inTransaction = true;
        db.exec('BEGIN');
        try {
          const result = fn();
          db.exec('COMMIT');
          return result;
        } catch (err) {
          try {
            db.exec('ROLLBACK');
          } catch {
            /* the transaction was already resolved */
          }
          throw err;
        } finally {
          inTransaction = false;
        }
      };
    },
    close() {
      db.close();
    },
    raw: db,
  };

  let inTransaction = false;
  return wrapper;
}
