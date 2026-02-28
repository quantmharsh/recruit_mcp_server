import { Agent } from "@openai/agents";
import { uploadResumeTool } from "../tools/resume.tool.js";
import { ResumeSchema } from "../schemas/resume.schema.js";
import type { AppContext } from "../context/app.context.js";

export const resumeExtractionAgent =
  new Agent<AppContext, typeof ResumeSchema>({
    name: "Resume Extraction Agent",

instructions: `
You are a resume data extraction engine.

Your job is ONLY to extract structured data from resume text.

Rules:
- Always call the "upload_resume" tool when given a file path.
- The tool will return resume text.
- Extract data strictly from the returned text.
- Do NOT hallucinate missing information.
- If a field is not found, return empty string or empty array.
- The email must be returned without labels or punctuation.
- Return ONLY valid JSON matching the schema.
- Never return explanations or conversational text.
`,

    tools: [uploadResumeTool],
    outputType: ResumeSchema,
  });