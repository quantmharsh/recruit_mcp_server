import { run } from "@openai/agents";
import { db, initDB } from "../db/client.js";

initDB();
let thread: any[] = [];
export async function runWithStreaming(agent: any, input: string) {
    const context = {
    sessionId: crypto.randomUUID(),
    storagePath: "./storage",
    startedAt: new Date(),
    db
  };
    thread.push({ role: "user", content: input });

  const result = await run(agent, thread, { stream: true , context });
  const stream = result.toTextStream();

  // for await (const event of stream) {
  //   if ((event as any).type === "raw_model_stream_event") {
  //     process.stdout.write((event as any).data.delta ?? "");
  //   }
  // }
    for await (const chunk of stream) {
    process.stdout.write(chunk);
  }

  
  thread = result.history;

  //console.log("\n\nStructured Output:\n", result.finalOutput);
}