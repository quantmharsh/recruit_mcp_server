import Database from "better-sqlite3";
export interface AppContext {
  sessionId: string;
  storagePath: string;
  startedAt: Date;
    db: Database.Database;

  userId?: number;
  role?: "candidate" | "recruiter";
}