import { tool, RunContext } from "@openai/agents";
import { z } from "zod";
import type { AppContext } from "../context/app.context.js";
import { sendEmail } from "../services/email.service.js";

type DbResumeRow = {
  id: number;
  user_id: number;
  name: string | null;
  email: string | null;
  skills: string;
  years_of_experience: number | null;
  education?: string | null;
};

type DbUserRow = {
  id: number;
  name: string;
  email: string;
  role: "candidate" | "recruiter";
};

type DbJobRow = {
  id: number;
  recruiter_id: number;
  title: string;
  description: string;
  required_skills: string;
  salary_range?: string | null;
  created_at?: string;
};

function assertRecruiter(ctx?: RunContext<AppContext>): asserts ctx is RunContext<AppContext> {
  if (!ctx?.context.userId || ctx.context.authStatus !== "AUTHENTICATED") {
    throw new Error("UNAUTHORIZED: Please login first.");
  }
  if (ctx.context.role !== "recruiter") {
    throw new Error("FORBIDDEN: Recruiter access required.");
  }
}

function assertAuthenticated(ctx?: RunContext<AppContext>): asserts ctx is RunContext<AppContext> {
  if (!ctx?.context.userId || ctx.context.authStatus !== "AUTHENTICATED") {
    throw new Error("UNAUTHORIZED: Please login first.");
  }
}

export const createJobTool = tool({
  name: "create_job",
  description: "Create a new job posting as an authenticated recruiter",
  parameters: z.object({
    title: z.string().min(2),
    description: z.string().min(10),
    requiredSkills: z.array(z.string().min(1)).min(1),
    salaryRange: z
      .string()
      .describe("Salary range text. Use empty string if not specified by recruiter.")
  }),
  execute: async ({ title, description, requiredSkills, salaryRange }, ctx?: RunContext<AppContext>) => {
    assertRecruiter(ctx);

    const db = ctx.context.db;
    const result = db
      .prepare(
        `
      INSERT INTO jobs (recruiter_id, title, description, required_skills, salary_range)
      VALUES (?, ?, ?, ?, ?)
    `
      )
      .run(
        ctx.context.userId,
        title.trim(),
        description.trim(),
        JSON.stringify(requiredSkills.map((s) => s.trim()).filter(Boolean)),
        salaryRange.trim() === "" ? null : salaryRange.trim()
      );

    return {
      message: "Job created successfully.",
      jobId: result.lastInsertRowid
    };
  }
});

export const findMatchedCandidatesTool = tool({
  name: "find_matched_candidates",
  description: "Find candidate resumes that match a posted job based on required skills",
  parameters: z.object({
    jobId: z.number().int().positive(),
    minMatchPercent: z.number().min(0).max(100).default(30)
  }),
  execute: async ({ jobId, minMatchPercent }, ctx?: RunContext<AppContext>) => {
    assertRecruiter(ctx);
    const db = ctx.context.db;

    const job = db
      .prepare("SELECT * FROM jobs WHERE id = ? AND recruiter_id = ?")
      .get(jobId, ctx.context.userId) as DbJobRow | undefined;

    if (!job) {
      throw new Error("Job not found for current recruiter.");
    }

    const requiredSkills: string[] = JSON.parse(job.required_skills ?? "[]");
    const normalizedRequired = requiredSkills.map((s) => s.toLowerCase().trim()).filter(Boolean);

    const rows = db
      .prepare(
        `
      SELECT
        r.id,
        r.user_id,
        r.name,
        r.email,
        r.skills,
        r.years_of_experience
      FROM resumes r
      JOIN users u ON u.id = r.user_id
      WHERE u.role = 'candidate'
    `
      )
      .all() as DbResumeRow[];

    const matches = rows
      .map((row) => {
        const candidateSkills: string[] = JSON.parse(row.skills ?? "[]");
        const normalizedCandidate = candidateSkills.map((s) => s.toLowerCase().trim()).filter(Boolean);

        const overlap = normalizedRequired.filter((skill) => normalizedCandidate.includes(skill));
        const matchPercent =
          normalizedRequired.length === 0
            ? 0
            : Math.round((overlap.length / normalizedRequired.length) * 100);

        return {
          candidateUserId: row.user_id,
          resumeId: row.id,
          name: row.name ?? "Unknown",
          email: row.email ?? "",
          yearsOfExperience: row.years_of_experience ?? 0,
          matchedSkills: overlap,
          matchPercent
        };
      })
      .filter((item) => item.matchPercent >= minMatchPercent)
      .sort((a, b) => b.matchPercent - a.matchPercent);

    // Create/refresh shortlist rows in applications table for traceability.
    for (const item of matches) {
      const existing = db
        .prepare("SELECT id FROM applications WHERE resume_id = ? AND job_id = ?")
        .get(item.resumeId, jobId) as { id: number } | undefined;

      if (!existing) {
        db.prepare(
          `
          INSERT INTO applications (resume_id, job_id, status)
          VALUES (?, ?, 'shortlisted')
        `
        ).run(item.resumeId, jobId);
      }
    }

    return {
      job: {
        id: job.id,
        title: job.title,
        requiredSkills
      },
      totalMatches: matches.length,
      matches
    };
  }
});

export const listMyJobsTool = tool({
  name: "list_my_jobs",
  description: "List all jobs posted by currently logged-in recruiter",
  parameters: z.object({}),
  execute: async (_, ctx?: RunContext<AppContext>) => {
    assertRecruiter(ctx);
    const db = ctx.context.db;

    const jobs = db
      .prepare(
        `
      SELECT id, title, description, required_skills, salary_range, created_at
      FROM jobs
      WHERE recruiter_id = ?
      ORDER BY id DESC
    `
      )
      .all(ctx.context.userId) as DbJobRow[];

    return jobs.map((job) => ({
      id: job.id,
      title: job.title,
      description: job.description,
      requiredSkills: JSON.parse(job.required_skills ?? "[]"),
      salaryRange: job.salary_range ?? "",
      createdAt: job.created_at
    }));
  }
});

export const getCandidateDetailsTool = tool({
  name: "get_candidate_details",
  description:
    "Get detailed candidate profile for a recruiter's job using jobId and candidateUserId",
  parameters: z.object({
    jobId: z.number().int().positive(),
    candidateUserId: z.number().int().positive()
  }),
  execute: async ({ jobId, candidateUserId }, ctx?: RunContext<AppContext>) => {
    assertRecruiter(ctx);
    const db = ctx.context.db;

    const job = db
      .prepare("SELECT * FROM jobs WHERE id = ? AND recruiter_id = ?")
      .get(jobId, ctx.context.userId) as DbJobRow | undefined;
    if (!job) {
      throw new Error("Job not found for current recruiter.");
    }

    const candidate = db
      .prepare("SELECT id, name, email, role FROM users WHERE id = ?")
      .get(candidateUserId) as DbUserRow | undefined;
    if (!candidate || candidate.role !== "candidate") {
      throw new Error("Candidate not found.");
    }

    const resume = db
      .prepare(
        `
      SELECT id, user_id, name, email, skills, years_of_experience, education
      FROM resumes
      WHERE user_id = ?
    `
      )
      .get(candidate.id) as DbResumeRow | undefined;

    if (!resume) {
      return {
        candidateUserId: candidate.id,
        name: candidate.name,
        email: candidate.email,
        hasResume: false,
        message: "Candidate has not uploaded resume yet."
      };
    }

    return {
      candidateUserId: candidate.id,
      jobId: job.id,
      hasResume: true,
      profile: {
        name: resume.name ?? candidate.name,
        email: resume.email ?? candidate.email,
        skills: JSON.parse(resume.skills ?? "[]"),
        yearsOfExperience: resume.years_of_experience ?? 0,
        education: JSON.parse(resume.education ?? "[]")
      }
    };
  }
});

export const listJobCandidatesTool = tool({
  name: "list_job_candidates",
  description:
    "List all candidates linked to a recruiter's job with shortlist/interview status and matching details",
  parameters: z.object({
    jobId: z.number().int().positive()
  }),
  execute: async ({ jobId }, ctx?: RunContext<AppContext>) => {
    // Recruiter-only action: prevents candidates from accessing recruiter pipeline data.
    assertRecruiter(ctx);
    const db = ctx.context.db;

    // Ownership check is mandatory so a recruiter cannot enumerate another recruiter's job applicants.
    const job = db
      .prepare("SELECT * FROM jobs WHERE id = ? AND recruiter_id = ?")
      .get(jobId, ctx.context.userId) as DbJobRow | undefined;
    if (!job) {
      throw new Error("Job not found for current recruiter.");
    }

    const requiredSkills: string[] = JSON.parse(job.required_skills ?? "[]");
    const normalizedRequired = requiredSkills.map((s) => s.toLowerCase().trim()).filter(Boolean);

    // Read candidates from applications + resumes + users in one query so results include both
    // contact data and current hiring stage.
    const rows = db
      .prepare(
        `
      SELECT
        a.id AS application_id,
        a.status AS application_status,
        r.id AS resume_id,
        r.user_id AS candidate_user_id,
        r.name AS candidate_name,
        r.email AS candidate_email,
        r.skills AS candidate_skills,
        r.years_of_experience AS candidate_experience
      FROM applications a
      JOIN resumes r ON r.id = a.resume_id
      JOIN users u ON u.id = r.user_id
      WHERE a.job_id = ?
        AND u.role = 'candidate'
      ORDER BY a.id DESC
    `
      )
      .all(jobId) as Array<{
      application_id: number;
      application_status: string;
      resume_id: number;
      candidate_user_id: number;
      candidate_name: string | null;
      candidate_email: string | null;
      candidate_skills: string;
      candidate_experience: number | null;
    }>;

    const candidates = rows.map((row) => {
      const candidateSkills: string[] = JSON.parse(row.candidate_skills ?? "[]");
      const normalizedCandidate = candidateSkills.map((s) => s.toLowerCase().trim()).filter(Boolean);

      // Keep scoring logic consistent with find_matched_candidates so recruiter sees stable percentages.
      const overlap = normalizedRequired.filter((skill) => normalizedCandidate.includes(skill));
      const matchPercent =
        normalizedRequired.length === 0
          ? 0
          : Math.round((overlap.length / normalizedRequired.length) * 100);

      return {
        applicationId: row.application_id,
        applicationStatus: row.application_status,
        candidateUserId: row.candidate_user_id,
        resumeId: row.resume_id,
        name: row.candidate_name ?? "Unknown",
        email: row.candidate_email ?? "",
        yearsOfExperience: row.candidate_experience ?? 0,
        matchedSkills: overlap,
        matchPercent
      };
    });

    return {
      job: {
        id: job.id,
        title: job.title,
        requiredSkills
      },
      totalCandidates: candidates.length,
      candidates
    };
  }
});

export const scheduleInterviewTool = tool({
  name: "schedule_interview",
  description:
    "Schedule interview communication between recruiter and candidate by sending email to both parties (no meeting URL required)",
  parameters: z.object({
    jobId: z.number().int().positive(),
    candidateUserId: z.number().int().positive(),
    scheduledAt: z.string().describe("Interview date-time text, e.g. 2026-03-10 11:00 AM IST"),
    interviewMode: z.enum(["phone", "in_person", "video_without_link", "chat"]),
    details: z
      .string()
      .describe("Any instructions such as office address, contact person, or call number")
      .min(5)
  }),
  execute: async ({ jobId, candidateUserId, scheduledAt, interviewMode, details }, ctx?: RunContext<AppContext>) => {
    assertRecruiter(ctx);
    const db = ctx.context.db;

    const job = db
      .prepare("SELECT * FROM jobs WHERE id = ? AND recruiter_id = ?")
      .get(jobId, ctx.context.userId) as DbJobRow | undefined;
    if (!job) {
      throw new Error("Job not found for current recruiter.");
    }

    const recruiter = db
      .prepare("SELECT id, name, email, role FROM users WHERE id = ?")
      .get(ctx.context.userId) as DbUserRow | undefined;
    const candidate = db
      .prepare("SELECT id, name, email, role FROM users WHERE id = ?")
      .get(candidateUserId) as DbUserRow | undefined;

    if (!recruiter || recruiter.role !== "recruiter") {
      throw new Error("Recruiter profile not found.");
    }
    if (!candidate || candidate.role !== "candidate") {
      throw new Error("Candidate not found.");
    }

    db.prepare(
      `
      INSERT INTO interviews (job_id, recruiter_id, candidate_id, scheduled_at, mode, details, status)
      VALUES (?, ?, ?, ?, ?, ?, 'scheduled')
    `
    ).run(jobId, recruiter.id, candidate.id, scheduledAt, interviewMode, details);

    const candidateSubject = `Interview Scheduled: ${job.title}`;
    const recruiterSubject = `Interview Confirmation: ${candidate.name} for ${job.title}`;

    const candidateHtml = `
      <div style="font-family: Arial, sans-serif;">
        <h2>Interview Invitation</h2>
        <p>Hello ${candidate.name},</p>
        <p>Your interview has been scheduled for <strong>${job.title}</strong>.</p>
        <p><strong>Date/Time:</strong> ${scheduledAt}</p>
        <p><strong>Mode:</strong> ${interviewMode}</p>
        <p><strong>Interview Details:</strong> ${details}</p>
        <p>Recruiter: ${recruiter.name} (${recruiter.email})</p>
      </div>
    `;

    const recruiterHtml = `
      <div style="font-family: Arial, sans-serif;">
        <h2>Interview Scheduled Successfully</h2>
        <p>Hello ${recruiter.name},</p>
        <p>You scheduled an interview with <strong>${candidate.name}</strong> for <strong>${job.title}</strong>.</p>
        <p><strong>Date/Time:</strong> ${scheduledAt}</p>
        <p><strong>Mode:</strong> ${interviewMode}</p>
        <p><strong>Interview Details Sent:</strong> ${details}</p>
        <p>Candidate email: ${candidate.email}</p>
      </div>
    `;

    await sendEmail({ to: candidate.email, subject: candidateSubject, html: candidateHtml });
    await sendEmail({ to: recruiter.email, subject: recruiterSubject, html: recruiterHtml });

    db.prepare(
      `
      UPDATE applications
      SET status = 'interview_scheduled'
      WHERE job_id = ?
        AND resume_id IN (SELECT id FROM resumes WHERE user_id = ?)
    `
    ).run(jobId, candidate.id);

    return "Interview scheduled and email notifications sent to both recruiter and candidate.";
  }
});

export const listMyInterviewsTool = tool({
  name: "list_my_interviews",
  description: "List interviews scheduled for currently logged-in user",
  parameters: z.object({}),
  execute: async (_, ctx?: RunContext<AppContext>) => {
    assertAuthenticated(ctx);
    const db = ctx.context.db;

    if (ctx.context.role === "recruiter") {
      const interviews = db
        .prepare(
          `
        SELECT i.id, i.job_id, j.title AS job_title, i.scheduled_at, i.mode, i.details, i.status,
               u.id AS candidate_id, u.name AS candidate_name, u.email AS candidate_email
        FROM interviews i
        JOIN jobs j ON j.id = i.job_id
        JOIN users u ON u.id = i.candidate_id
        WHERE i.recruiter_id = ?
        ORDER BY i.id DESC
      `
        )
        .all(ctx.context.userId) as Array<Record<string, unknown>>;
      return { role: "recruiter", interviews };
    }

    const interviews = db
      .prepare(
        `
      SELECT i.id, i.job_id, j.title AS job_title, i.scheduled_at, i.mode, i.details, i.status,
             u.id AS recruiter_id, u.name AS recruiter_name, u.email AS recruiter_email
      FROM interviews i
      JOIN jobs j ON j.id = i.job_id
      JOIN users u ON u.id = i.recruiter_id
      WHERE i.candidate_id = ?
      ORDER BY i.id DESC
    `
      )
      .all(ctx.context.userId) as Array<Record<string, unknown>>;
    return { role: "candidate", interviews };
  }
});
