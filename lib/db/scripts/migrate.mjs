// Applies the SQL migrations in ../migrations to the database.
//
// Databases created before migrations were introduced (with `drizzle-kit push`)
// already contain everything in the first migration, 0000_baseline. For those,
// the baseline is recorded as applied without running it, and only the newer
// migrations are executed. New, empty databases get every migration.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsFolder = path.resolve(here, "../migrations");
const envFile = path.resolve(here, "../../../.env");
if (!process.env.DATABASE_URL && fs.existsSync(envFile)) process.loadEnvFile(envFile);
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set. Add it to .env or the environment.");
  process.exit(1);
}

const MIGRATIONS_SCHEMA = "drizzle";
const MIGRATIONS_TABLE = "__drizzle_migrations";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });

async function markBaselineIfNeeded(client) {
  const journal = JSON.parse(fs.readFileSync(path.join(migrationsFolder, "meta/_journal.json"), "utf8"));
  const baseline = journal.entries[0];
  if (!baseline || !baseline.tag.endsWith("_baseline")) return;

  const tracked = await client.query("select to_regclass($1) as oid", [`${MIGRATIONS_SCHEMA}.${MIGRATIONS_TABLE}`]);
  if (tracked.rows[0].oid) return; // migrations are already being tracked
  const existing = await client.query("select to_regclass('public.partners') as oid");
  if (!existing.rows[0].oid) return; // empty database: run everything

  const sql = fs.readFileSync(path.join(migrationsFolder, `${baseline.tag}.sql`), "utf8");
  const hash = crypto.createHash("sha256").update(sql).digest("hex");
  await client.query("begin");
  try {
    await client.query(`create schema if not exists "${MIGRATIONS_SCHEMA}"`);
    await client.query(
      `create table if not exists "${MIGRATIONS_SCHEMA}"."${MIGRATIONS_TABLE}" (id serial primary key, hash text not null, created_at bigint)`,
    );
    await client.query(
      `insert into "${MIGRATIONS_SCHEMA}"."${MIGRATIONS_TABLE}" (hash, created_at) values ($1, $2)`,
      [hash, baseline.when],
    );
    await client.query("commit");
    console.log("Existing database detected: recorded the baseline migration as already applied.");
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
}

try {
  const client = await pool.connect();
  try {
    await markBaselineIfNeeded(client);
  } finally {
    client.release();
  }
  await migrate(drizzle(pool), { migrationsFolder, migrationsSchema: MIGRATIONS_SCHEMA, migrationsTable: MIGRATIONS_TABLE });
  console.log("Database is up to date.");
} catch (error) {
  console.error("Migration failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await pool.end();
}
