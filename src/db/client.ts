import Database from "better-sqlite3";
import path from "path";

const dbPath = path.join(process.cwd(), "recruit.db");

export const db: Database.Database = new Database(dbPath);

export function initDB() {
  db.exec(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      phone TEXT,
      role TEXT CHECK(role IN ('candidate', 'recruiter')) NOT NULL,
      is_verified BOOLEAN DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS login_otps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      otp TEXT,
      expires_at TEXT,
      is_used BOOLEAN DEFAULT 0,
      FOREIGN KEY(user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id INTEGER,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS resumes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      name TEXT,
      email TEXT,
      skills TEXT,
      years_of_experience INTEGER,
      education TEXT,
      summary TEXT DEFAULT '',
      certifications TEXT DEFAULT '[]',
      links TEXT DEFAULT '[]',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      recruiter_id INTEGER,
      title TEXT,
      description TEXT,
      required_skills TEXT,
      salary_range TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(recruiter_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS applications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      resume_id INTEGER,
      job_id INTEGER,
      status TEXT DEFAULT 'applied',
      cover_letter TEXT DEFAULT '',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(resume_id) REFERENCES resumes(id),
      FOREIGN KEY(job_id) REFERENCES jobs(id)
    );

    CREATE TABLE IF NOT EXISTS interviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id INTEGER NOT NULL,
      recruiter_id INTEGER NOT NULL,
      candidate_id INTEGER NOT NULL,
      scheduled_at TEXT NOT NULL,
      mode TEXT NOT NULL,
      details TEXT NOT NULL,
      status TEXT DEFAULT 'scheduled',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(job_id) REFERENCES jobs(id),
      FOREIGN KEY(recruiter_id) REFERENCES users(id),
      FOREIGN KEY(candidate_id) REFERENCES users(id)
    );
  `);

  console.log("✅ Database initialized");
}

// Add optional resume columns when migrating older databases.
export function ensureResumeColumns() {
  const existingColumns = db
    .prepare("PRAGMA table_info(resumes)")
    .all()
    .map((row) => (row as { name: string }).name);

  const extraColumns = [
    { name: "summary", definition: "summary TEXT DEFAULT ''" },
    { name: "certifications", definition: "certifications TEXT DEFAULT '[]'" },
    { name: "links", definition: "links TEXT DEFAULT '[]'" }
  ];

  for (const column of extraColumns) {
    if (!existingColumns.includes(column.name)) {
      db.exec(`ALTER TABLE resumes ADD COLUMN ${column.definition};`);
    }
  }
}

// Keep the applications table in sync by adding the cover_letter column on demand.
export function ensureApplicationsColumns() {
  const appColumns = db
    .prepare("PRAGMA table_info(applications)")
    .all()
    .map((row) => (row as { name: string }).name);

  if (!appColumns.includes("cover_letter")) {
    db.exec("ALTER TABLE applications ADD COLUMN cover_letter TEXT DEFAULT '';");
  }
}
