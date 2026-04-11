import "dotenv/config";

import { z } from "zod";
import { db } from "../db/client.js";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const DEFAULT_MODEL = process.env.OPENAI_SUMMARY_MODEL ?? "gpt-4o-mini";

const DeepSummarySchema = z.object({
  suitability: z.enum(["recommended", "maybe", "not_recommended"]),
  overallScore: z.number().min(0).max(10),
  strengths: z.array(z.string()).min(1).max(6),
  concerns: z.array(z.string()).max(6),
  evidence: z
    .array(
      z.object({
        question: z.string(),
        quote: z.string(),
        note: z.string().optional()
      })
    )
    .max(6),
  nextSteps: z.array(z.string()).min(1).max(6)
});

export type DeepInterviewSummary = z.infer<typeof DeepSummarySchema> & {
  model: string;
};

function truncate(text: string, max: number) {
  const normalized = String(text ?? "").replace(/\s+/g, " ").trim();
  if (normalized.length <= max) return normalized;
  return normalized.slice(0, max) + "...";
}

function buildPrompt(payload: {
  interviewId: number;
  jobTitle: string;
  companyName?: string;
  requiredSkills: string[];
  candidateName: string;
  answers: Array<{ question: string; transcript: string; sentiment: string; score: number | null }>;
}) {
  const answers = payload.answers.map((a, idx) => ({
    n: idx + 1,
    question: truncate(a.question, 220),
    transcript: truncate(a.transcript, 900),
    sentiment: a.sentiment ?? "neutral",
    score: a.score
  }));

  return [
    "You are a senior technical recruiter writing a decision-ready interview assessment.",
    "Be concise, specific, and evidence-based.",
    "Use ONLY the provided answers; do not invent facts.",
    "Return ONLY valid JSON matching the requested schema (no markdown).",
    "",
    `InterviewId: ${payload.interviewId}`,
    `Candidate: ${payload.candidateName}`,
    `Role: ${payload.jobTitle}${payload.companyName ? ` @ ${payload.companyName}` : ""}`,
    `RequiredSkills: ${payload.requiredSkills.join(", ") || "N/A"}`,
    "",
    "Answers:",
    JSON.stringify(answers, null, 2),
    "",
    "JSON schema keys:",
    JSON.stringify(
      {
        suitability: "recommended|maybe|not_recommended",
        overallScore: "0-10 number",
        strengths: "string[]",
        concerns: "string[]",
        evidence: [{ question: "string", quote: "string", note: "string(optional)" }],
        nextSteps: "string[]"
      },
      null,
      2
    )
  ].join("\n");
}

async function callOpenAIJson(model: string, prompt: string) {
  if (!OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is required for deep summaries.");
  }

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model,
      input: prompt,
      // Ask for deterministic-ish output.
      temperature: 0.2
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Deep summary failed (status ${response.status}): ${errorText}`);
  }

  const data = (await response.json()) as any;
  // Best-effort extraction of plain text output. SDK formats may vary slightly.
  const text: string =
    data?.output_text ??
    data?.output?.[0]?.content?.map((c: any) => c?.text).filter(Boolean).join("\n") ??
    "";

  return text.trim();
}

export async function generateAndStoreDeepInterviewSummary(input: {
  interviewId: number;
  model?: string;
}): Promise<DeepInterviewSummary> {
  const interviewId = input.interviewId;
  const model = input.model ?? DEFAULT_MODEL;

  const contextRow = db
    .prepare(
      `
      SELECT i.id AS interview_id,
             j.title AS job_title,
             j.company_name AS company_name,
             j.required_skills AS required_skills,
             cu.name AS candidate_name
      FROM interviews i
      JOIN jobs j ON j.id = i.job_id
      JOIN users cu ON cu.id = i.candidate_id
      WHERE i.id = ?
    `
    )
    .get(interviewId) as
    | {
        interview_id: number;
        job_title: string;
        company_name: string | null;
        required_skills: string;
        candidate_name: string;
      }
    | undefined;

  if (!contextRow) {
    throw new Error("Interview not found.");
  }

  const requiredSkills = (() => {
    try {
      const parsed = JSON.parse(contextRow.required_skills ?? "[]");
      return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
    } catch {
      return [];
    }
  })();

  const answers = db
    .prepare(
      `
      SELECT question, transcript, sentiment, score
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
  }>;

  if (!answers.length) {
    throw new Error("No interview answers found to summarize.");
  }

  const prompt = buildPrompt({
    interviewId,
    jobTitle: contextRow.job_title,
    companyName: contextRow.company_name ?? undefined,
    requiredSkills,
    candidateName: contextRow.candidate_name,
    answers
  });

  const raw = await callOpenAIJson(model, prompt);

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    // Store raw output for debugging.
    db.prepare(
      `
      INSERT INTO interview_reports_llm (interview_id, model, report_json)
      VALUES (?, ?, ?)
      ON CONFLICT(interview_id) DO UPDATE SET
        model = excluded.model,
        report_json = excluded.report_json,
        created_at = CURRENT_TIMESTAMP
    `
    ).run(interviewId, model, JSON.stringify({ error: "non_json_output", raw }));

    throw new Error(`Deep summary returned non-JSON output: ${(error as Error).message}`);
  }

  const validated = DeepSummarySchema.parse(parsed);

  db.prepare(
    `
    INSERT INTO interview_reports_llm (interview_id, model, report_json)
    VALUES (?, ?, ?)
    ON CONFLICT(interview_id) DO UPDATE SET
      model = excluded.model,
      report_json = excluded.report_json,
      created_at = CURRENT_TIMESTAMP
  `
  ).run(interviewId, model, JSON.stringify(validated));

  return { ...validated, model };
}

