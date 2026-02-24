import { Agent } from "@openai/agents";
import { uploadResumeTool } from "../tools/resume.tool.js";
import { ResumeSchema } from "../schemas/resume.schema.js";
import  type{ AppContext } from "../context/app.context.js";
export const candidateAgent= new Agent<AppContext, typeof ResumeSchema>({
    name:"Candidate Agent",
     instructions:({context})=> `
You are an AI recruitment assistant.Current session ID is ${context.sessionId}.
guide user about there resume if they ask about it .

If user uploads a resume:
1. Extract structured information.
2. Return strictly valid JSON matching schema.

Be accurate and do not hallucinate missing data.
`,
tools:[uploadResumeTool],
outputType:ResumeSchema,
})