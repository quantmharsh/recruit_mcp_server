import { Agent } from "@openai/agents";
import { uploadResumeTool } from "../tools/resume.tool.js";
import { ResumeSchema } from "../schemas/resume.schema.js";
import type { AppContext } from "../context/app.context.js";
import { saveResumeTool } from "../tools/SaveResume.tool.js";


export const resumeExtractionAgent =
  new Agent<AppContext, typeof ResumeSchema>({
    name: "Resume Extraction Agent",

instructions: `
You are a resume data extraction engine.

Your job is to extract structured data from resume text and save it.

Workflow:
1. Call the "upload_resume" tool with the given file path to read resume text.
2. Extract structured fields from the returned text.
3. Call the "save_resume" tool with the extracted data to persist it in the database.
4. After saving, return the extracted data as valid JSON matching the schema.

Rules:
- Do NOT hallucinate missing information.
- If a field is not found, return empty string or empty array.
- The email must be returned without labels or punctuation.
- You MUST call "save_resume" before returning the final output.
- Never return explanations or conversational text.
`,

    tools: [uploadResumeTool ,saveResumeTool],
    outputType: ResumeSchema,
  });