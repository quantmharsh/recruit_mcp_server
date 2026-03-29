import { randomUUID } from "node:crypto";

/**
 * Lightweight helper to mint ephemeral client secrets for the Realtime API.
 * Use this from your backend right before sending a candidate an interview link.
 *
 * The returned token is safe to hand to the browser/mobile client; it cannot
 * call the rest of the OpenAI API, only join the configured Realtime session.
 */
export interface VoiceClientSecretInput {
  candidateId: number;
  jobId: number;
  interviewId?: number;
}

export interface VoiceClientSecret {
  token: string;
  expiresAtEpochSeconds: number;
  sessionId: string;
}

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const DEFAULT_REALTIME_MODEL = process.env.OPENAI_REALTIME_MODEL ?? "gpt-realtime";

/**
 * Call OpenAI's client secret endpoint to create a short‑lived WebRTC token.
 * Throwing instead of silently failing makes CLI debugging easier.
 */
export async function createVoiceClientSecret(
  input: VoiceClientSecretInput
): Promise<VoiceClientSecret> {
  if (!OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is required to create voice client secrets.");
  }

  const sessionId = randomUUID();

  const response = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      session: {
        type: "realtime",
        model: DEFAULT_REALTIME_MODEL,
        // Keep the system prompt minimal; richer persona can be set by the client when it connects.
        instructions:
          "You are the RecruitMCP first-round screener. Confirm identity, ask job-aligned questions, keep answers concise, and summarize results."
      }
      // NOTE: Some deployments reject expires_in; rely on API defaults for now.
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Failed to create voice client secret (status ${response.status}): ${errorText}`
    );
  }

  const data = (await response.json()) as {
    value: string;
    expires_at: number;
    session: { id: string };
  };

  return {
    token: data.value,
    expiresAtEpochSeconds: data.expires_at,
    sessionId
  };
}
