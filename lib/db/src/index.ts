import { AsyncLocalStorage } from "node:async_hooks";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

export type Database = NodePgDatabase<typeof schema>;

interface Connection {
  pool: pg.Pool;
  db: Database;
}

function connect(connectionString: string, max?: number): Connection {
  const pool = new Pool({ connectionString, ...(max ? { max } : {}) });
  return { pool, db: drizzle(pool, { schema }) };
}

/**
 * On a normal Node server one connection pool is shared by every request.
 *
 * Cloudflare Workers do not allow a connection that was opened for one request
 * to be used by another, so there every request gets its own small pool
 * (see `createDatabaseScope`). `db` and `pool` below always point at the right
 * one, so the rest of the code does not need to know where it runs.
 */
let shared: Connection | null = null;

function sharedConnection(): Connection {
  if (!shared) {
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error("DATABASE_URL is not set. Did you forget to provision a database?");
    }
    shared = connect(url);
  }
  return shared;
}

export interface DatabaseScope {
  readonly connection: Connection;
  close(): Promise<void>;
}

const scopes = new AsyncLocalStorage<DatabaseScope>();

/** A per-request database connection, opened the first time it is used. */
export function createDatabaseScope(connectionString: string): DatabaseScope {
  let connection: Connection | null = null;
  return {
    get connection() {
      connection ??= connect(connectionString, 3);
      return connection;
    },
    async close() {
      const open = connection;
      connection = null;
      if (open) await open.pool.end().catch(() => undefined);
    },
  };
}

/** Runs `fn` (and everything it starts) with `db` pointing at the scope's connection. */
export function runWithDatabaseScope<T>(scope: DatabaseScope, fn: () => T): T {
  return scopes.run(scope, fn);
}

function current(): Connection {
  return scopes.getStore()?.connection ?? sharedConnection();
}

function forward<T extends object>(pick: (c: Connection) => T): T {
  return new Proxy({} as T, {
    get(_target, prop) {
      const target = pick(current());
      const value = Reflect.get(target, prop, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
    has(_target, prop) {
      return Reflect.has(pick(current()), prop);
    },
  });
}

export const db: Database = forward((c) => c.db);
export const pool: pg.Pool = forward((c) => c.pool);

export * from "./schema";
