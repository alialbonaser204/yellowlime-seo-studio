// Runs before `drizzle-kit push`.
//
// drizzle-kit asks an interactive question before it adds a unique constraint
// to a table that already contains rows. On a server there is no terminal to
// answer it, so the whole schema update is aborted. This script adds those
// constraints itself when the existing rows already satisfy them, so the push
// that follows has nothing to ask. If existing rows would violate a constraint,
// it is left alone and reported, and no data is changed.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const here = path.dirname(fileURLToPath(import.meta.url));
const envFile = path.resolve(here, "../../../.env");
if (!process.env.DATABASE_URL && fs.existsSync(envFile)) process.loadEnvFile(envFile);
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set. Add it to .env or the environment.");
  process.exit(1);
}

/** Unique constraints declared in the schema that may be missing on older databases. */
const UNIQUE_CONSTRAINTS = [
  { table: "article_generations", name: "article_generations_briefing_version_unique", columns: ["briefing_id", "version_number"] },
];

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  for (const { table, name, columns } of UNIQUE_CONSTRAINTS) {
    const tableExists = await client.query("select to_regclass($1) as oid", [`public.${table}`]);
    if (!tableExists.rows[0].oid) continue;

    const existing = await client.query(
      "select 1 from pg_constraint where conname = $1 and conrelid = $2::regclass",
      [name, `public.${table}`],
    );
    if (existing.rowCount > 0) continue;

    const cols = columns.map((c) => `"${c}"`).join(", ");
    const duplicates = await client.query(
      `select count(*)::int as n from (select ${cols} from "${table}" group by ${cols} having count(*) > 1) d`,
    );
    if (duplicates.rows[0].n > 0) {
      console.warn(`Skipped ${name}: ${duplicates.rows[0].n} duplicate value(s) in ${table}. Resolve them manually.`);
      continue;
    }
    await client.query(`alter table "${table}" add constraint "${name}" unique (${cols})`);
    console.log(`Added missing constraint ${name}.`);
  }
} finally {
  await client.end();
}
