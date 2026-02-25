import { Agent } from "@openai/agents";
import type { AppContext } from "../context/app.context.js";

export const resumeAdvisorAgent = new Agent<AppContext>({
  name: "Resume Advisor Agent",

  instructions: `
You are a professional recruitment consultant.

If user asks:
- How is my resume?
- Suggest improvements
- What is my email?
- What skills do I have?

Answer naturally based on previous conversation context.
Be helpful and professional.
`,
});