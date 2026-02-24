import { run } from "@openai/agents";

export async function runWithStreaming(agent: any, input: string) {
    const context = {
    sessionId: crypto.randomUUID(),
    storagePath: "./storage",
    startedAt: new Date()
  };
  const result = await run(agent, input, { stream: true , context });
  const stream = result.toTextStream();

  for await (const event of stream) {
    if ((event as any).type === "raw_model_stream_event") {
      process.stdout.write((event as any).data.delta ?? "");
    }
  }

  console.log("\n\nStructured Output:\n", result.finalOutput);
}