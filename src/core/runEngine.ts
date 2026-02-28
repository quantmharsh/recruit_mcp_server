import { run } from "@openai/agents";
import { db, initDB } from "../db/client.js";
import type { AppContext } from "../context/app.context.js";

initDB();

let thread: any[] = [];

// IMPORTANT: Persistent context (do NOT recreate each call)
const context: AppContext = {
  sessionId: crypto.randomUUID(),
  storagePath: "./storage",
  startedAt: new Date(),
  db,
  authStatus: "NOT_AUTHENTICATED"
};

export async function runWithoutStreaming(agent: any, input: string) {

  thread.push({ role: "user", content: input });

  const result = await run(agent, thread, {
    context
  });

  console.log("\nAssistant:", result.finalOutput, "\n");

  thread = result.history;
}