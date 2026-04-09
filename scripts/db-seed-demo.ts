import "dotenv/config";
/**
 * Seeds "DEMO" data into recruit.db so you can test flows quickly without typing
 * everything manually in the CLI.
 *
 * Idempotent: re-running should not create duplicates for the same demo emails/titles.
 */

import { db, initDB } from "../src/db/client.js";

type UserRole = "candidate" | "recruiter";

function getOrCreateUser(input: { name: string; email: string; role: UserRole }) {
  const existing = db
    .prepare("SELECT id, name, email, role FROM users WHERE email = ?")
    .get(input.email) as { id: number } | undefined;

  if (existing) return existing.id;

  const result = db
    .prepare(
      `
      INSERT INTO users (name, email, role, is_verified)
      VALUES (?, ?, ?, 1)
    `
    )
    .run(input.name, input.email, input.role);

  return Number(result.lastInsertRowid);
}

function ensureResumeForUser(input: {
  userId: number;
  name: string;
  email: string;
  skills: string[];
  years: number;
  education: string;
  summary: string;
}) {
  const existing = db
    .prepare("SELECT id FROM resumes WHERE user_id = ? ORDER BY id DESC LIMIT 1")
    .get(input.userId) as { id: number } | undefined;
  if (existing) return existing.id;

  const result = db
    .prepare(
      `
      INSERT INTO resumes (user_id, name, email, skills, years_of_experience, education, summary, certifications, links)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
    )
    .run(
      input.userId,
      input.name,
      input.email,
      JSON.stringify(input.skills),
      input.years,
      input.education,
      input.summary,
      JSON.stringify(["AWS CCP"]),
      JSON.stringify(["https://github.com/demo"])
    );
  return Number(result.lastInsertRowid);
}

function getOrCreateJob(input: {
  recruiterId: number;
  title: string;
  description: string;
  requiredSkills: string[];
  companyName: string;
  location: string;
  salaryRange: string;
  employmentType: string;
  experienceLevel: string;
  remoteFriendly: boolean;
  contactEmail: string;
}) {
  const existing = db
    .prepare("SELECT id FROM jobs WHERE recruiter_id = ? AND title = ?")
    .get(input.recruiterId, input.title) as { id: number } | undefined;
  if (existing) return existing.id;

  const result = db
    .prepare(
      `
      INSERT INTO jobs
        (recruiter_id, company_name, title, description, location, required_skills, salary_range,
         employment_type, experience_level, remote_friendly, contact_email)
      VALUES
        (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
    )
    .run(
      input.recruiterId,
      input.companyName,
      input.title,
      input.description,
      input.location,
      JSON.stringify(input.requiredSkills),
      input.salaryRange,
      input.employmentType,
      input.experienceLevel,
      input.remoteFriendly ? 1 : 0,
      input.contactEmail
    );

  return Number(result.lastInsertRowid);
}

function getOrCreateApplication(input: {
  resumeId: number;
  jobId: number;
  status: string;
  coverLetter: string;
}) {
  const existing = db
    .prepare("SELECT id FROM applications WHERE resume_id = ? AND job_id = ?")
    .get(input.resumeId, input.jobId) as { id: number } | undefined;
  if (existing) return existing.id;

  const result = db
    .prepare(
      `
      INSERT INTO applications (resume_id, job_id, status, cover_letter)
      VALUES (?, ?, ?, ?)
    `
    )
    .run(input.resumeId, input.jobId, input.status, input.coverLetter);
  return Number(result.lastInsertRowid);
}

function getOrCreateInterview(input: {
  jobId: number;
  recruiterId: number;
  candidateId: number;
  scheduledAt: string;
  mode: string;
  details: string;
}) {
  const existing = db
    .prepare(
      `
      SELECT id FROM interviews
      WHERE job_id = ? AND recruiter_id = ? AND candidate_id = ? AND scheduled_at = ?
      ORDER BY id DESC
      LIMIT 1
    `
    )
    .get(input.jobId, input.recruiterId, input.candidateId, input.scheduledAt) as
    | { id: number }
    | undefined;
  if (existing) return existing.id;

  const result = db
    .prepare(
      `
      INSERT INTO interviews (job_id, recruiter_id, candidate_id, scheduled_at, mode, details, status)
      VALUES (?, ?, ?, ?, ?, ?, 'scheduled')
    `
    )
    .run(
      input.jobId,
      input.recruiterId,
      input.candidateId,
      input.scheduledAt,
      input.mode,
      input.details
    );

  return Number(result.lastInsertRowid);
}

function ensureInterviewAnswers(interviewId: number) {
  const existing = db
    .prepare("SELECT id FROM interview_answers WHERE interview_id = ? LIMIT 1")
    .get(interviewId) as { id: number } | undefined;
  if (existing) return;

  const insert = db.prepare(
    `
    INSERT INTO interview_answers (interview_id, question, transcript, sentiment, score)
    VALUES (?, ?, ?, ?, ?)
  `
  );

  insert.run(
    interviewId,
    "Give me a 60-second summary of your relevant experience for this role.",
    "I have 3+ years building Node.js APIs and React frontends. I've shipped features end-to-end and improved reliability with tests and monitoring.",
    "positive",
    8.0
  );
  insert.run(
    interviewId,
    "Describe a recent project you owned end-to-end. What was your personal contribution?",
    "I owned a payments integration: designed the API, implemented webhook handling, added idempotency keys, and wrote dashboard views for ops.",
    "positive",
    8.5
  );
}

function main() {
  initDB();

  const recruiterId = getOrCreateUser({
    name: "Demo Recruiter",
    email: "recruiter.demo@example.com",
    role: "recruiter"
  });

  const c1Id = getOrCreateUser({
    name: "Demo Candidate One",
    email: "candidate1.demo@example.com",
    role: "candidate"
  });
  const c2Id = getOrCreateUser({
    name: "Demo Candidate Two",
    email: "candidate2.demo@example.com",
    role: "candidate"
  });
  const c3Id = getOrCreateUser({
    name: "Demo Candidate Three",
    email: "candidate3.demo@example.com",
    role: "candidate"
  });

  const r1 = ensureResumeForUser({
    userId: c1Id,
    name: "Demo Candidate One",
    email: "candidate1.demo@example.com",
    skills: ["node.js", "typescript", "sql", "redis", "rest"],
    years: 3,
    education: "B.Tech Computer Science",
    summary: "Backend-leaning full-stack engineer. Interested in platform and APIs."
  });
  const r2 = ensureResumeForUser({
    userId: c2Id,
    name: "Demo Candidate Two",
    email: "candidate2.demo@example.com",
    skills: ["react", "next.js", "typescript", "css", "testing"],
    years: 2,
    education: "B.Sc Computer Science",
    summary: "Frontend engineer focused on DX, UI performance, and accessibility."
  });
  const r3 = ensureResumeForUser({
    userId: c3Id,
    name: "Demo Candidate Three",
    email: "candidate3.demo@example.com",
    skills: ["python", "data", "sql", "etl", "aws"],
    years: 4,
    education: "MCA",
    summary: "Data engineer with strong SQL and pipeline experience."
  });

  const job1Id = getOrCreateJob({
    recruiterId,
    companyName: "DemoCo",
    title: "[DEMO] Backend Engineer (Node.js)",
    description:
      "Build APIs in Node.js/TypeScript, design schemas, improve reliability, and collaborate with frontend. Bonus: Redis, queues.",
    location: "Bengaluru, IN",
    requiredSkills: ["node.js", "typescript", "sql"],
    salaryRange: "12-18 LPA",
    employmentType: "full_time",
    experienceLevel: "mid",
    remoteFriendly: true,
    contactEmail: "recruiter.demo@example.com"
  });

  const job2Id = getOrCreateJob({
    recruiterId,
    companyName: "DemoCo",
    title: "[DEMO] Frontend Engineer (React/Next.js)",
    description:
      "Own UI features in React/Next.js, collaborate with backend, and ship accessible, fast experiences. Bonus: testing and design systems.",
    location: "Remote",
    requiredSkills: ["react", "next.js", "typescript"],
    salaryRange: "10-16 LPA",
    employmentType: "full_time",
    experienceLevel: "mid",
    remoteFriendly: true,
    contactEmail: "recruiter.demo@example.com"
  });

  getOrCreateApplication({
    resumeId: r1,
    jobId: job1Id,
    status: "applied",
    coverLetter: "I build reliable Node.js APIs and would love to contribute to DemoCo."
  });
  getOrCreateApplication({
    resumeId: r2,
    jobId: job2Id,
    status: "shortlisted",
    coverLetter: "I focus on Next.js performance and accessibility; excited about DemoCo."
  });
  getOrCreateApplication({
    resumeId: r3,
    jobId: job1Id,
    status: "applied",
    coverLetter: "Strong SQL + pipelines; can support data-heavy backend requirements."
  });

  const interviewId = getOrCreateInterview({
    jobId: job2Id,
    recruiterId,
    candidateId: c2Id,
    scheduledAt: "2026-04-10 11:00 AM IST",
    mode: "video_without_link",
    details: "This is a demo interview. Use the voice link to capture answers."
  });
  ensureInterviewAnswers(interviewId);

  console.log("✅ Seeded demo data");
  console.log({
    recruiterId,
    candidateIds: [c1Id, c2Id, c3Id],
    jobIds: [job1Id, job2Id],
    interviewId
  });
}

main();

