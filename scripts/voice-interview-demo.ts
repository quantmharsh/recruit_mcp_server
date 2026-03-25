/**
 * Illustrative browser-side bootstrap for the Realtime voice interview agent.
 * This is not wired into the CLI; it is meant as a starter snippet you can
 * paste into a small Vite/Next route. All network calls are kept explicit so
 * you can trace failures quickly while experimenting.
 */

import {
  OpenAIRealtimeWebRTC,
  RealtimeAgent,
  RealtimeSession
} from "@openai/agents/realtime";

/**
 * Minimal question set for a first-round screen. Replace with job-specific
 * content pulled from your database.
 */
const DEFAULT_QUESTIONS = [
  "Give me a 60-second summary of your relevant experience for this role.",
  "Describe a recent project you owned end-to-end. What was your personal contribution?",
  "What is your expected notice period?",
  "Are you comfortable with the location/remote policy stated in the job description?",
  "Any salary expectations or constraints we should note for the recruiter?"
];

/**
 * Build a voice agent that will run completely client-side once connected.
 * The tool sends each answer back to your API for scoring/persistence.
 */
export function createVoiceInterviewAgent(options: {
  clientSecret: string; // token from createVoiceClientSecret
  candidateName?: string;
  jobTitle?: string;
  backendSubmitUrl?: string; // e.g. /api/interviews/answers
}) {
  const agent = new RealtimeAgent({
    name: "RecruitMCP Voice Screener",
    instructions: [
      "You are the first-round HR screener.",
      "Be concise, friendly, and keep answers under 90 seconds.",
      "Confirm the candidate's name and email before starting.",
      "Ask one question at a time, wait for an answer, then paraphrase key facts.",
      "If the candidate asks to speak to a human, say you will escalate and call the handoff tool."
    ].join(" "),
    // Voice name is optional; pick a calm, neutral voice that fits your brand.
    voice: { voice: "alloy" }
  });

  // Tool used to stream answers back to your backend.
  agent.tools.define({
    name: "record_answer",
    description:
      "Persist a single interview answer along with a quick sentiment/score.",
    schema: {
      type: "object",
      properties: {
        question: { type: "string" },
        transcript: { type: "string" },
        sentiment: { type: "string", enum: ["positive", "neutral", "negative"] },
        score: { type: "number", minimum: 0, maximum: 10 }
      },
      required: ["question", "transcript"]
    },
    execute: async ({ question, transcript, sentiment, score }) => {
      if (!options.backendSubmitUrl) {
        console.warn("No backendSubmitUrl set; skipping answer submission.");
        return;
      }

      // Use fetch to send the captured answer home. Errors are swallowed to keep
      // the interview flowing; they are still logged for debugging.
      try {
        await fetch(options.backendSubmitUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            question,
            transcript,
            sentiment: sentiment ?? "neutral",
            score: score ?? null,
            candidateName: options.candidateName ?? null,
            jobTitle: options.jobTitle ?? null
          })
        });
      } catch (error) {
        console.error("Failed to POST answer to backend", error);
      }
    }
  });

  // Simple handoff hook. In production, redirect to live chat/phone queue.
  agent.tools.define({
    name: "handoff_to_human",
    description: "Escalate to a live recruiter when requested or on sensitive topics.",
    schema: { type: "object", properties: {} },
    execute: async () => {
      console.info("Human handoff requested; wire this to your escalation flow.");
    }
  });

  // Transport handles microphone/speaker in the browser.
  const transport = new OpenAIRealtimeWebRTC({
    // Use the defaults: auto-select mic and speakers.
  });

  const session = new RealtimeSession(agent, { transport });

  // Kick off once connected.
  async function start() {
    await session.connect({ clientSecret: options.clientSecret });
    // Introduce and ask the first question via text so the TTS can speak it.
    const intro = [
      `Hi ${options.candidateName ?? "there"}, I'm your RecruitMCP voice assistant.`,
      `I'll run through a quick screen for the ${options.jobTitle ?? "open role"}.`,
      "Feel free to interrupt or ask me to repeat."
    ].join(" ");

    session.sendUserMessageContent([
      { type: "input_text", text: intro },
      { type: "input_text", text: DEFAULT_QUESTIONS[0] }
    ]);
  }

  // Return handles so the caller can bind UI buttons easily.
  return {
    agent,
    session,
    transport,
    start,
    askNext: (index: number) => {
      const question = DEFAULT_QUESTIONS[index];
      if (!question) return;
      session.sendUserMessageContent([{ type: "input_text", text: question }]);
    },
    disconnect: () => session.disconnect()
  };
}
