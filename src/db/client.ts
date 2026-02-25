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
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(resume_id) REFERENCES resumes(id),
      FOREIGN KEY(job_id) REFERENCES jobs(id)
    );
  `);

  console.log("✅ Database initialized");
}