import "dotenv/config";
/**
 * Quick DB viewer for people who don't have the sqlite3 CLI installed.
 * Prints a small snapshot of key tables from recruit.db.
 */

import { db, initDB } from "../src/db/client.js";

function count(table: string) {
  const row = db.prepare(`SELECT COUNT(1) AS c FROM ${table}`).get() as { c: number };
  return row.c;
}

function main() {
  initDB();

  const tables = ["users", "resumes", "jobs", "applications", "interviews", "interview_answers"];
  const counts: Record<string, number> = {};
  for (const t of tables) counts[t] = count(t);

  console.log("📦 recruit.db snapshot (counts)");
  console.table(counts);

  console.log("👤 Latest users");
  console.table(
    db
      .prepare(
        `SELECT id, name, email, role, is_verified, created_at
         FROM users
         ORDER BY id DESC
         LIMIT 8`
      )
      .all()
  );

  console.log("💼 Latest jobs");
  console.table(
    db
      .prepare(
        `SELECT id, recruiter_id, company_name, title, location, remote_friendly, created_at
         FROM jobs
         ORDER BY id DESC
         LIMIT 8`
      )
      .all()
  );

  console.log("📝 Latest applications");
  console.table(
    db
      .prepare(
        `SELECT id, resume_id, job_id, status, created_at
         FROM applications
         ORDER BY id DESC
         LIMIT 10`
      )
      .all()
  );

  console.log("🗓️ Latest interviews");
  console.table(
    db
      .prepare(
        `SELECT id, job_id, recruiter_id, candidate_id, scheduled_at, mode, status, created_at
         FROM interviews
         ORDER BY id DESC
         LIMIT 10`
      )
      .all()
  );

  console.log("🎙️ Latest interview answers");
  console.table(
    db
      .prepare(
        `SELECT id, interview_id, question, sentiment, score, created_at
         FROM interview_answers
         ORDER BY id DESC
         LIMIT 10`
      )
      .all()
  );
}

main();

