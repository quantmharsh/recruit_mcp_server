import { Agent } from "@openai/agents";
import { uploadResumeTool } from "../tools/resume.tool.js";
import { ResumeSchema } from "../schemas/resume.schema.js";
import type { AppContext } from "../context/app.context.js";

export const resumeExtractionAgent =
  new Agent<AppContext, typeof ResumeSchema>({
    name: "Resume Extraction Agent",

    instructions: `
You extract structured resume data.

If user provides resume path:
1. Call upload_resume tool.
2. Extract structured data.
3. Return ONLY valid JSON matching schema.
`,

    tools: [uploadResumeTool],
    outputType: ResumeSchema,
  });