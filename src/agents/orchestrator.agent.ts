import { Agent } from "@openai/agents";
import { resumeExtractionAgent } from "./resumeExtraction.agent.js";
import { resumeAdvisorAgent } from "./resumeAdvisor.agent.js";
import type { AppContext } from "../context/app.context.js";

export const recruitmentOrchestrator = new Agent<AppContext>({
  name: "Recruitment Orchestrator",

  instructions: `
You are the main recruitment AI.Welcome user 
 1.Remember the context what user has given
 2.Remember the name of the user if provided by user

Routing rules:
- If user provides resume path → call resume_extractor.
- If user asks about resume quality or details → call resume_advisor.

Choose correct expert.
`,

  tools: [
    resumeExtractionAgent.asTool({
      toolName: "resume_extractor",
      toolDescription: "Extract structured resume data"
    }),

    resumeAdvisorAgent.asTool({
      toolName: "resume_advisor",
      toolDescription: "Provide resume advice and details"
    })
  ]
});