import "dotenv/config";
/**
 * Small SQL runner for when sqlite3 CLI isn't available.
 *
 * Examples:
 * - Read-only:
 *   npm run db:sql -- --sql "SELECT id, email, role FROM users LIMIT 5;"
 * - Write (requires --write):
 *   npm run db:sql -- --write --sql "UPDATE applications SET status='shortlisted' WHERE id=1;"
 */

import { db, initDB } from "../src/db/client.js";

function parseArgs(argv: string[]) {
  const out: { sql?: string; write: boolean } = { write: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--write") out.write = true;
    if (a === "--sql") out.sql = argv[i + 1];
  }
  return out;
}

function main() {
  initDB();

  const { sql, write } = parseArgs(process.argv.slice(2));
  if (!sql?.trim()) {
    console.error("Missing --sql. Example: npm run db:sql -- --sql \"SELECT * FROM users LIMIT 5;\"");
    process.exit(1);
  }

  const normalized = sql.trim().toLowerCase();
  const isSelectLike =
    normalized.startsWith("select") ||
    normalized.startsWith("pragma") ||
    normalized.startsWith("explain");

  if (!write && !isSelectLike) {
    console.error("Refusing to run non-read query without --write.");
    process.exit(1);
  }

  if (isSelectLike) {
    const rows = db.prepare(sql).all();
    console.table(rows);
    return;
  }

  const info = db.exec(sql);
  // better-sqlite3 exec returns void; just acknowledge.
  console.log("✅ SQL executed");
  void info;
}

main();

