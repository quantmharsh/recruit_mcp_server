/**
 * Minimal HTTP API for the voice interview flow.
 * - POST /api/voice/token            -> returns an ek_* client secret for WebRTC
 * - POST /api/interviews/:id/answers -> stores one answer/transcript from the browser agent
 *
 * This keeps dependencies light (node:http only) and aims to be copy-paste debuggable.
 */

import http from "node:http";
import { URL } from "node:url";
import { db, initDB } from "./db/client.js";
import { createVoiceClientSecret } from "./voice/token.service.js";

// Initialize database when the server boots.
initDB();

const PORT = Number(process.env.PORT ?? 4000);
const HOST = process.env.HOST ?? "0.0.0.0";

type JsonValue = Record<string, unknown>;

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
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type"
      });
      return res.end();
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

    return sendJson(res, 404, { error: "Not found" });
  } catch (error) {
    console.error(error);
    return sendJson(res, 500, { error: (error as Error).message });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Voice API listening on http://${HOST}:${PORT}`);
});
