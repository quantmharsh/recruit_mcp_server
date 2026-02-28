import readline from "node:readline/promises";
import { candidateAgent } from "./agents/candidate.agent.js";
import { recruitmentOrchestrator } from "./agents/orchestrator.agent.js";
import { runWithoutStreaming } from "./core/runEngine.js";

export async function startCLI() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  console.log("RecruitMCP Phase 1 Started 🚀");

  while (true) {
    const input = await rl.question("\n> ");
    if (input === "exit") break;

    await runWithoutStreaming(recruitmentOrchestrator, input);
  }

  rl.close();
}