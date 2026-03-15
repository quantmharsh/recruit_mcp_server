import type { Database } from "better-sqlite3";

// This draft lives only for the current CLI process and helps us finish recruiter
// job creation across multiple chat turns without losing already supplied fields.
export interface RecruiterJobDraft {
  title?: string;
  description?: string;
  companyName?: string;
  location?: string;
  requiredSkills?: string[];
  salaryRange?: string;
  employmentType?: "full_time" | "part_time" | "contract" | "internship" | "temporary" | "freelance";
  experienceLevel?: "entry" | "mid" | "senior" | "lead" | "director";
  remoteFriendly?: boolean;
  contactEmail?: string;
}

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

  // Multi-turn recruiter job posting is staged here until every required field
  // has been collected and we can create the job deterministically.
  recruiterJobDraft?: RecruiterJobDraft;
}
