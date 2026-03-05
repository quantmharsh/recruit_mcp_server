import type { Database } from "better-sqlite3";
export interface AppContext {
  sessionId: string;
  storagePath: string;
  startedAt: Date;
  db: Database;

  authStatus: "NOT_AUTHENTICATED" | "OTP_PENDING" | "AUTHENTICATED";
  pendingEmail?: string | undefined;
  userId?: number;
  role?: "candidate" | "recruiter";

  // helper property used by the engine to know if a resume
  // save operation already took place during an agent run.
  lastSavedResume?: unknown;
}