import "dotenv/config";
/**
 * Minimal HTTP API for the voice interview flow.
 * - GET  /voice                      -> serves the browser client
 * - POST /api/voice/token            -> returns an ek_* client secret for WebRTC
 * - POST /api/interviews/:id/answers -> stores one answer/transcript from the browser agent
 *
 * This keeps dependencies light (node:http only) and aims to be copy-paste debuggable.
 */

import http from "node:http";
import { URL, fileURLToPath } from "node:url";
import path from "node:path";
import { readFileSync } from "node:fs";
import { db, initDB } from "./db/client.js";
import { createVoiceClientSecret } from "./voice/token.service.js";
import { sendEmail } from "./services/email.service.js";

// Initialize database when the server boots.
initDB();

const PORT = Number(process.env.PORT ?? 4000);
const HOST = process.env.HOST ?? "0.0.0.0";
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Voice page lives at project_root/public/voice-interview.html
const voicePagePath = path.join(process.cwd(), "public", "voice-interview.html");
let voiceHtml: string | null = null;
try {
  voiceHtml = readFileSync(voicePagePath, "utf8");
} catch (error) {
  console.warn("Voice page not found at", voicePagePath, error);
}

type JsonValue = Record<string, unknown>;

function parseJsonArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function safeString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function computeSuitability(avgScore: number | null, sentiments: string[]) {
  if (avgScore === null) return "maybe";
  const hasNegative = sentiments.some((s) => String(s).toLowerCase() === "negative");
  if (avgScore >= 8.0 && !hasNegative) return "recommended";
  if (avgScore >= 6.5 && !hasNegative) return "maybe";
  return "not_recommended";
}

function buildInterviewReport(interviewId: number) {
  const answers = db
    .prepare(
      `
      SELECT question, transcript, sentiment, score, created_at
      FROM interview_answers
      WHERE interview_id = ?
      ORDER BY id ASC
    `
    )
    .all(interviewId) as Array<{
    question: string;
    transcript: string;
    sentiment: string;
    score: number | null;
    created_at: string;
  }>;

  const scores = answers.map((a) => a.score).filter((s): s is number => typeof s === "number");
  const avgScore = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
  const sentiments = answers.map((a) => a.sentiment ?? "neutral");
  const suitability = computeSuitability(avgScore, sentiments);

  const highlights = answers
    .slice(0, 5)
    .map((a) => {
      const t = safeString(a.transcript).replace(/\s+/g, " ").trim();
      const preview = t.length > 180 ? `${t.slice(0, 180)}...` : t;
      return `${a.question}: ${preview}`;
    })
    .filter(Boolean);

  const summaryParts: string[] = [];
  summaryParts.push(`Answers captured: ${answers.length}`);
  if (avgScore !== null) summaryParts.push(`Average score: ${avgScore.toFixed(1)}/10`);
  summaryParts.push(`Suitability: ${suitability.replace(/_/g, " ")}`);

  return {
    answers,
    avgScore,
    suitability,
    highlights,
    summary: summaryParts.join(". ") + "."
  };
}

function getInterviewContext(interviewId: number) {
  const interview = db
    .prepare(
      `
      SELECT i.id, i.job_id, i.recruiter_id, i.candidate_id, i.scheduled_at, i.mode, i.details, i.status,
             j.title AS job_title, j.company_name AS company_name, j.location AS job_location, j.required_skills AS job_required_skills,
             ru.name AS recruiter_name, ru.email AS recruiter_email,
             cu.name AS candidate_name, cu.email AS candidate_email
      FROM interviews i
      JOIN jobs j ON j.id = i.job_id
      JOIN users ru ON ru.id = i.recruiter_id
      JOIN users cu ON cu.id = i.candidate_id
      WHERE i.id = ?
    `
    )
    .get(interviewId) as
    | {
        id: number;
        job_id: number;
        recruiter_id: number;
        candidate_id: number;
        scheduled_at: string;
        mode: string;
        details: string;
        status: string;
        job_title: string;
        company_name: string | null;
        job_location: string | null;
        job_required_skills: string;
        recruiter_name: string;
        recruiter_email: string;
        candidate_name: string;
        candidate_email: string;
      }
    | undefined;

  if (!interview) return null;

  const resume = db
    .prepare(
      `
      SELECT id, name, email, skills, years_of_experience, education, summary
      FROM resumes
      WHERE user_id = ?
      ORDER BY id DESC
      LIMIT 1
    `
    )
    .get(interview.candidate_id) as
    | {
        id: number;
        name: string | null;
        email: string | null;
        skills: string;
        years_of_experience: number | null;
        education: string | null;
        summary: string | null;
      }
    | undefined;

  const requiredSkills = parseJsonArray(interview.job_required_skills)
    .map((s) => String(s))
    .filter(Boolean);
  const resumeSkills = resume ? parseJsonArray(resume.skills).map((s) => String(s)).filter(Boolean) : [];

  return {
    interview: {
      id: interview.id,
      status: interview.status,
      scheduledAt: interview.scheduled_at,
      mode: interview.mode,
      details: interview.details
    },
    recruiter: {
      id: interview.recruiter_id,
      name: interview.recruiter_name,
      email: interview.recruiter_email
    },
    candidate: {
      id: interview.candidate_id,
      name: interview.candidate_name,
      email: interview.candidate_email
    },
    job: {
      id: interview.job_id,
      title: interview.job_title,
      companyName: interview.company_name ?? "",
      location: interview.job_location ?? "",
      requiredSkills
    },
    resume: resume
      ? {
          id: resume.id,
          summary: resume.summary ?? "",
          yearsOfExperience: resume.years_of_experience ?? null,
          education: resume.education ?? "",
          skills: resumeSkills
        }
      : null
  };
}

async function readJsonBody(req: http.IncomingMessage): Promise<JsonValue> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`Invalid JSON: ${(error as Error).message}`);
  }
}

function sendJson(res: http.ServerResponse, status: number, body: JsonValue) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*" // loosened for demo; tighten in production.
  });
  res.end(JSON.stringify(body));
}

function sendHtml(res: http.ServerResponse, status: number, body: string) {
  res.writeHead(status, {
    "Content-Type": "text/html; charset=utf-8",
    "Access-Control-Allow-Origin": "*"
  });
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  try {
    if (!req.url) {
      return sendJson(res, 400, { error: "Missing URL" });
    }

    const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);

    // Simple CORS preflight support for browser fetch.
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type"
      });
      return res.end();
    }

    if (
      req.method === "GET" &&
      (url.pathname === "/voice" || url.pathname === "/voice/" || url.pathname === "/voice-interview.html")
    ) {
      if (!voiceHtml) return sendJson(res, 500, { error: "Voice client missing on server" });
      return sendHtml(res, 200, voiceHtml);
    }

    const contextMatch = url.pathname.match(/^\/api\/interviews\/(\d+)\/context$/);
    if (req.method === "GET" && contextMatch) {
      const interviewId = Number(contextMatch[1]);
      const contextData = getInterviewContext(interviewId);
      if (!contextData) return sendJson(res, 404, { error: "Interview not found" });
      return sendJson(res, 200, contextData as unknown as JsonValue);
    }

    if (req.method === "POST" && url.pathname === "/api/voice/token") {
      const body = await readJsonBody(req);
      const candidateId = Number(body.candidateId);
      const jobId = Number(body.jobId);
      const interviewId = body.interviewId ? Number(body.interviewId) : undefined;

      if (!candidateId || !jobId) {
        return sendJson(res, 400, { error: "candidateId and jobId are required" });
      }

      const secret = await createVoiceClientSecret({ candidateId, jobId, interviewId });
      return sendJson(res, 200, secret);
    }

    const answerMatch = url.pathname.match(/^\/api\/interviews\/(\d+)\/answers$/);
    if (req.method === "POST" && answerMatch) {
      const interviewId = Number(answerMatch[1]);
      const body = await readJsonBody(req);
      const question = String(body.question ?? "");
      const transcript = String(body.transcript ?? "");
      const sentiment = (body.sentiment as string | undefined) ?? "neutral";
      const score = body.score !== undefined ? Number(body.score) : null;

      if (!question || !transcript) {
        return sendJson(res, 400, { error: "question and transcript are required" });
      }

      db.prepare(
        `
        INSERT INTO interview_answers (interview_id, question, transcript, sentiment, score)
        VALUES (?, ?, ?, ?, ?);
      `
      ).run(interviewId, question, transcript, sentiment, score);

      return sendJson(res, 200, { ok: true });
    }

    const completeMatch = url.pathname.match(/^\/api\/interviews\/(\d+)\/complete$/);
    if (req.method === "POST" && completeMatch) {
      const interviewId = Number(completeMatch[1]);
      const contextData = getInterviewContext(interviewId);
      if (!contextData) return sendJson(res, 404, { error: "Interview not found" });

      // Mark interview as completed.
      db.prepare("UPDATE interviews SET status = 'completed' WHERE id = ?").run(interviewId);

      // Mark related application as interview completed (best-effort).
      db.prepare(
        `
        UPDATE applications
        SET status = 'interview_completed'
        WHERE job_id = ?
          AND resume_id IN (SELECT id FROM resumes WHERE user_id = ?)
      `
      ).run(contextData.job.id, contextData.candidate.id);

      const report = buildInterviewReport(interviewId);

      // Upsert report (idempotent completion).
      db.prepare(
        `
        INSERT INTO interview_reports
          (interview_id, summary, suitability, overall_score, highlights, review_status, created_at, updated_at)
        VALUES
          (?, ?, ?, ?, ?, 'pending', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        ON CONFLICT(interview_id) DO UPDATE SET
          summary = excluded.summary,
          suitability = excluded.suitability,
          overall_score = excluded.overall_score,
          highlights = excluded.highlights,
          updated_at = CURRENT_TIMESTAMP
      `
      ).run(
        interviewId,
        report.summary,
        report.suitability,
        report.avgScore,
        JSON.stringify(report.highlights)
      );

      const reportRow = db
        .prepare(
          `
          SELECT emailed_to_recruiter_at, emailed_to_candidate_at
          FROM interview_reports
          WHERE interview_id = ?
        `
        )
        .get(interviewId) as
        | { emailed_to_recruiter_at: string | null; emailed_to_candidate_at: string | null }
        | undefined;

      const recruiterEmail = contextData.recruiter.email;
      const candidateEmail = contextData.candidate.email;
      const overallScoreText = report.avgScore === null ? "N/A" : `${report.avgScore.toFixed(1)}/10`;

      const recruiterHtml = `
        <div style="font-family: Arial, sans-serif;">
          <h2>Voice Interview Completed</h2>
          <p><strong>Interview ID:</strong> ${interviewId}</p>
          <p><strong>Candidate:</strong> ${contextData.candidate.name} (${candidateEmail})</p>
          <p><strong>Role:</strong> ${contextData.job.title}</p>
          <p><strong>Overall score:</strong> ${overallScoreText}</p>
          <p><strong>Suitability:</strong> ${report.suitability.replace(/_/g, " ")}</p>
          <p><strong>Summary:</strong> ${report.summary}</p>
          <h3>Highlights</h3>
          <ul>${report.highlights.map((h) => `<li>${h}</li>`).join("")}</ul>
          <p>Reply in the CLI with: <code>next round interview ${interviewId}</code> or <code>reject interview ${interviewId}</code> or <code>remind later interview ${interviewId}</code>.</p>
        </div>
      `;

      const candidateHtml = `
        <div style="font-family: Arial, sans-serif;">
          <h2>Interview Completed</h2>
          <p>Hello ${contextData.candidate.name},</p>
          <p>Thanks for taking the interview for <strong>${contextData.job.title}</strong>. Our team will review your responses and get back to you.</p>
          <p><strong>Interview ID:</strong> ${interviewId}</p>
          <h3>Your response highlights</h3>
          <ul>${report.highlights.map((h) => `<li>${h}</li>`).join("")}</ul>
        </div>
      `;

      const resendKey = process.env.RESEND_API_KEY;
      const emailed: Record<string, boolean> = { recruiter: false, candidate: false };

      if (resendKey) {
        try {
          if (!reportRow?.emailed_to_recruiter_at) {
            await sendEmail({
              to: recruiterEmail,
              subject: `Interview Completed: ${contextData.candidate.name} for ${contextData.job.title}`,
              html: recruiterHtml
            });
            emailed.recruiter = true;
            db.prepare(
              "UPDATE interview_reports SET emailed_to_recruiter_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE interview_id = ?"
            ).run(interviewId);
          }
        } catch (error) {
          console.error("Failed to email recruiter", error);
        }

        try {
          if (!reportRow?.emailed_to_candidate_at) {
            await sendEmail({
              to: candidateEmail,
              subject: `Thanks for interviewing: ${contextData.job.title}`,
              html: candidateHtml
            });
            emailed.candidate = true;
            db.prepare(
              "UPDATE interview_reports SET emailed_to_candidate_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE interview_id = ?"
            ).run(interviewId);
          }
        } catch (error) {
          console.error("Failed to email candidate", error);
        }
      }

      return sendJson(res, 200, {
        ok: true,
        interviewId,
        suitability: report.suitability,
        overallScore: report.avgScore,
        emailed
      });
    }

    return sendJson(res, 404, { error: "Not found" });
  } catch (error) {
    console.error(error);
    return sendJson(res, 500, { error: (error as Error).message });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Voice API listening on http://${HOST}:${PORT}`);
});
