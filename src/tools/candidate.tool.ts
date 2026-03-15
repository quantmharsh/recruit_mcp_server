import { tool, RunContext } from "@openai/agents";
import { z } from "zod";
import type { AppContext } from "../context/app.context.js";

type DbJobRow = {
  id: number;
  company_name: string | null;
  title: string;
  description: string;
  required_skills: string | null;
  salary_range: string | null;
  location: string | null;
  employment_type: string | null;
  experience_level: string | null;
  remote_friendly: number | null;
  contact_email: string | null;
  created_at: string | null;
};

type DbResumeRow = {
  id: number;
  skills: string | null;
  years_of_experience: number | null;
  education: string | null;
  summary: string | null;
  certifications: string | null;
  links: string | null;
  name: string | null;
  email: string | null;
};

type ResumeUpdateInput = Partial<{
  summary: string;
  certifications: string[];
  links: string[];
  skills: string[];
  yearsOfExperience: number;
  education: string[];
  name: string;
  email: string;
}>;

// Ensures that the caller is an authenticated candidate before running a tool.
function assertCandidate(ctx?: RunContext<AppContext>): asserts ctx is RunContext<AppContext> {
  if (!ctx?.context.userId) {
    throw new Error("UNAUTHORIZED: Please login as a candidate first.");
  }
  if (ctx.context.authStatus !== "AUTHENTICATED") {
    throw new Error("Please complete authentication before performing candidate actions.");
  }
  if (ctx.context.role !== "candidate") {
    throw new Error("Candidate role required for this action.");
  }
}

// Normalize skills for consistent, case-insensitive comparisons.
function normalizeSkills(skills: string[]): string[] {
  return skills.map((skill) => skill.toLowerCase().trim()).filter(Boolean);
}

// Safely parse JSON-serialized skill lists stored in the database.
function parseSkills(raw?: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export const listAvailableJobsTool = tool({
  name: "list_available_jobs",
  description: "Show candidate-friendly job listings with optional skill filtering.",
  parameters: z.object({
    skillFilters: z.array(z.string()).optional().default([]),
    keyword: z.string().optional().default(""),
    limit: z.number().int().positive().default(10)
  }),
  execute: async ({ skillFilters, keyword, limit }, ctx?: RunContext<AppContext>) => {
    assertCandidate(ctx);

    const rows = ctx.context.db
      .prepare("SELECT * FROM jobs ORDER BY created_at DESC")
      .all() as DbJobRow[];

    const normalizedFilters = normalizeSkills(skillFilters ?? []);
    const matches = rows.filter((job) => {
      const titleText = job.title ?? "";
      const titleMatches = keyword
        ? titleText.toLowerCase().includes(keyword.toLowerCase())
        : true;
      if (!titleMatches) return false;

      if (!normalizedFilters.length) return true;
      const jobSkills = normalizeSkills(parseSkills(job.required_skills));
      return normalizedFilters.some((filter) => jobSkills.includes(filter));
    });

    const jobs = matches.slice(0, limit).map((job) => ({
      id: job.id,
      companyName: job.company_name ?? "",
      title: job.title,
      description: job.description,
      requiredSkills: parseSkills(job.required_skills),
      salaryRange: job.salary_range ?? "",
      location: job.location ?? "",
      employmentType: job.employment_type ?? "",
      experienceLevel: job.experience_level ?? "",
      remoteFriendly: Boolean(job.remote_friendly),
      contactEmail: job.contact_email ?? "",
      postedAt: job.created_at ?? ""
    }));

    return {
      totalJobs: matches.length,
      jobs
    };
  }
});

export const getJobDetailsTool = tool({
  name: "get_job_details",
  description: "Fetch full details for a specific job so candidates can review before applying.",
  parameters: z.object({
    jobId: z.number().int().positive()
  }),
  execute: async ({ jobId }, ctx?: RunContext<AppContext>) => {
    assertCandidate(ctx);

    const job = ctx.context.db
      .prepare(
        `
        SELECT id, company_name, title, description, location, required_skills, salary_range,
               employment_type, experience_level, remote_friendly, contact_email, created_at
        FROM jobs
        WHERE id = ?
      `
      )
      .get(jobId) as DbJobRow | undefined;

    if (!job) {
      throw new Error("Job not found.");
    }

    return {
      id: job.id,
      companyName: job.company_name ?? "",
      title: job.title,
      description: job.description,
      location: job.location ?? "",
      requiredSkills: parseSkills(job.required_skills),
      salaryRange: job.salary_range ?? "",
      employmentType: job.employment_type ?? "",
      experienceLevel: job.experience_level ?? "",
      remoteFriendly: Boolean(job.remote_friendly),
      contactEmail: job.contact_email ?? "",
      postedAt: job.created_at ?? ""
    };
  }
});

// Apply the authenticated candidate's resume to a job while avoiding duplicates.
export const applyToJobTool = tool({
  name: "apply_to_job",
  description: "Apply a candidate resume to a specific job and prevent duplicate applications.",
  parameters: z.object({
    jobId: z.number().int().positive(),
    coverLetter: z.string().default("").describe("Cover letter text; empty string means none.")
  }),
  execute: async ({ jobId, coverLetter }, ctx?: RunContext<AppContext>) => {
    assertCandidate(ctx);

    const job = ctx.context.db
      .prepare("SELECT * FROM jobs WHERE id = ?")
      .get(jobId);

    if (!job) {
      throw new Error("Job not found.");
    }

    const resume = ctx.context.db
      .prepare("SELECT id FROM resumes WHERE user_id = ?")
      .get(ctx.context.userId) as { id: number } | undefined;

    if (!resume) {
      throw new Error("Please upload your resume before applying.");
    }

    const existing = ctx.context.db
      .prepare("SELECT status FROM applications WHERE job_id = ? AND resume_id = ?")
      .get(jobId, resume.id) as { status: string } | undefined;

    if (existing) {
      return {
        message: "You already applied to this job.",
        currentStatus: existing.status
      };
    }

    const result = ctx.context.db
      .prepare(
        "INSERT INTO applications (resume_id, job_id, status, cover_letter) VALUES (?, ?, 'applied', ?)"
      )
      .run(resume.id, jobId, coverLetter || "");

    // Persist the candidate's cover letter so the recruiter can see the additional context.

    return {
      message: "Application submitted successfully.",
      applicationId: result.lastInsertRowid,
      status: "applied"
    };
  }
});

export const listMyApplicationsTool = tool({
  name: "list_my_applications",
  description: "Show jobs the candidate has applied to with current status and details.",
  parameters: z.object({
    limit: z.number().int().positive().default(20)
  }),
  execute: async ({ limit }, ctx?: RunContext<AppContext>) => {
    assertCandidate(ctx);

    const resume = ctx.context.db
      .prepare("SELECT id FROM resumes WHERE user_id = ?")
      .get(ctx.context.userId) as { id: number } | undefined;

    if (!resume) {
      throw new Error("Upload your resume before viewing applications.");
    }

    const rows = ctx.context.db
      .prepare(
        `
        SELECT
          a.id              AS application_id,
          a.status          AS application_status,
          a.created_at      AS applied_at,
          a.cover_letter    AS cover_letter,
          j.id              AS job_id,
          j.company_name    AS company_name,
          j.title           AS title,
          j.description     AS description,
          j.location        AS location,
          j.required_skills AS required_skills,
          j.salary_range    AS salary_range,
          j.employment_type AS employment_type,
          j.experience_level AS experience_level,
          j.remote_friendly AS remote_friendly,
          j.contact_email   AS contact_email,
          j.created_at      AS job_created_at
        FROM applications a
        JOIN jobs j ON a.job_id = j.id
        WHERE a.resume_id = ?
        ORDER BY a.created_at DESC
        LIMIT ?
      `
      )
      .all(resume.id, limit) as Array<{
        application_id: number;
        application_status: string;
        applied_at: string;
        cover_letter: string;
        job_id: number;
        company_name: string | null;
        title: string;
        description: string;
        location: string | null;
        required_skills: string | null;
        salary_range: string | null;
        employment_type: string | null;
        experience_level: string | null;
        remote_friendly: number | null;
        contact_email: string | null;
        job_created_at: string | null;
      }>;

    return rows.map((row) => ({
      applicationId: row.application_id,
      status: row.application_status,
      appliedAt: row.applied_at,
      coverLetter: row.cover_letter ?? "",
      job: {
        id: row.job_id,
        companyName: row.company_name ?? "",
        title: row.title,
        description: row.description,
        location: row.location ?? "",
        requiredSkills: parseSkills(row.required_skills),
        salaryRange: row.salary_range ?? "",
        employmentType: row.employment_type ?? "",
        experienceLevel: row.experience_level ?? "",
        remoteFriendly: Boolean(row.remote_friendly),
        contactEmail: row.contact_email ?? "",
        postedAt: row.job_created_at ?? ""
      }
    }));
  }
});

// Recommend jobs that align with the candidate's stored skills.
export const recommendJobsTool = tool({
  name: "recommend_jobs",
  description: "Recommend jobs that best match the logged-in candidate's resume.",
  parameters: z.object({
    minMatchPercent: z.number().min(0).max(100).default(30),
    limit: z.number().int().positive().default(5)
  }),
  execute: async ({ minMatchPercent, limit }, ctx?: RunContext<AppContext>) => {
    assertCandidate(ctx);

    const resume = ctx.context.db
      .prepare("SELECT skills FROM resumes WHERE user_id = ?")
      .get(ctx.context.userId) as { skills: string | null } | undefined;

    if (!resume) {
      throw new Error("Upload your resume first so we can match your skills.");
    }

    const candidateSkillsNormalized = normalizeSkills(parseSkills(resume.skills));

    const jobs = ctx.context.db
      .prepare("SELECT * FROM jobs ORDER BY created_at DESC")
      .all() as DbJobRow[];

    // Score each job by skill overlap and surface missing skills for upskilling ideas.
    const recommendations = jobs
      .map((job) => {
        const required = normalizeSkills(parseSkills(job.required_skills));
        const overlap = required.filter((skill) => candidateSkillsNormalized.includes(skill));
        const matchPercent = required.length === 0 ? 0 : Math.round((overlap.length / required.length) * 100);

        const missingSkills = required.filter((skill) => !candidateSkillsNormalized.includes(skill));

        return {
          jobId: job.id,
          companyName: job.company_name ?? "",
          title: job.title,
          description: job.description,
          location: job.location ?? "",
          matchPercent,
          requiredSkills: parseSkills(job.required_skills),
          matchedSkills: overlap,
          missingSkills,
          quickUpskill: missingSkills.slice(0, 3),
          salaryRange: job.salary_range ?? "",
          employmentType: job.employment_type ?? "",
          experienceLevel: job.experience_level ?? "",
          remoteFriendly: Boolean(job.remote_friendly),
          contactEmail: job.contact_email ?? "",
          postedAt: job.created_at ?? ""
        };
      })
      .filter((item) => item.matchPercent >= minMatchPercent)
      .sort((a, b) => b.matchPercent - a.matchPercent)
      .slice(0, limit);

    return {
      summary: `Found ${recommendations.length} jobs with at least ${minMatchPercent}% skill overlap.`,
      recommendations
    };
  }
});

// Let candidates tweak optional resume sections without requiring a file upload.
export const updateResumeProfileTool = tool({
  name: "update_resume_profile",
  description: "Update optional resume sections such as summary, certifications, or links.",
  parameters: z.object({
    updatesJson: z
      .string()
      .describe("JSON string describing the updates to apply.")
      .default("{}")
  }),
  execute: async ({ updatesJson }, ctx?: RunContext<AppContext>) => {
    assertCandidate(ctx);

    let updates: ResumeUpdateInput | null = null;
    try {
      updates = JSON.parse(updatesJson) as ResumeUpdateInput;
    } catch {
      throw new Error("Invalid updatesJson payload. Please provide valid JSON.");
    }

    if (!updates || Object.keys(updates).length === 0) {
      throw new Error("Provide at least one field to update.");
    }

    const existing = ctx.context.db
      .prepare("SELECT * FROM resumes WHERE user_id = ?")
      .get(ctx.context.userId) as DbResumeRow | undefined;

    if (!existing) {
      throw new Error("Upload your resume before updating the profile.");
    }

    const mergedSkills = updates.skills ?? parseSkills(existing.skills);
    const mergedEducation = updates.education ?? parseSkills(existing.education);
    // Merge incoming updates with stored values so we only overwrite fields the user touched.
    const mergedSummary = updates.summary ?? existing.summary ?? "";
    const mergedCertifications =
      updates.certifications ?? parseSkills(existing.certifications);
    const mergedLinks = updates.links ?? parseSkills(existing.links);
    const mergedYears = updates.yearsOfExperience ?? existing.years_of_experience ?? 0;
    const mergedName = updates.name ?? existing.name ?? "";
    const mergedEmail = updates.email ?? existing.email ?? "";

    ctx.context.db
      .prepare(`
        UPDATE resumes
        SET name = ?, email = ?, skills = ?, years_of_experience = ?, education = ?, summary = ?, certifications = ?, links = ?
        WHERE user_id = ?
      `)
      .run(
        mergedName,
        mergedEmail,
        JSON.stringify(mergedSkills),
        mergedYears,
        JSON.stringify(mergedEducation),
        mergedSummary,
        JSON.stringify(mergedCertifications),
        JSON.stringify(mergedLinks),
        ctx.context.userId
      );

    return {
      message: "Resume profile updated.",
      updatedFields: {
        summary: mergedSummary,
        certifications: mergedCertifications,
        links: mergedLinks,
        skills: mergedSkills,
        yearsOfExperience: mergedYears,
        education: mergedEducation
      }
    };
  }
});
