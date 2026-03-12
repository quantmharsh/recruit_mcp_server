import { tool, RunContext } from "@openai/agents";
import { z } from "zod";
import type { AppContext } from "../context/app.context.js";

interface ResumeRow {
  name: string;
  email: string;
  skills: string;
  years_of_experience: number;
  education: string;
  summary?: string | null;
  certifications?: string | null;
  links?: string | null;
}

export const fetchResumeTool = tool({
  name: "fetch_resume",
  description: "Fetch user's resume from the database.",
  parameters: z.object({}),
  execute: async (_, ctx?: RunContext<AppContext>) => {
    if (!ctx?.context.userId) {
      throw new Error("UNAUTHORIZED");
    }

    const resume = ctx.context.db
      .prepare("SELECT * FROM resumes WHERE user_id = ?")
      .get(ctx.context.userId) as ResumeRow | undefined;

    if (!resume) {
      return null;
    }

    console.log("DEBUG: Fetched Resume from DB:", resume);

    // Return structured resume data, including the newly persisted optional sections.
    return {
      name: resume.name,
      email: resume.email,
      skills: resume.skills ? JSON.parse(resume.skills) : [],
      yearsOfExperience: resume.years_of_experience,
      education: resume.education ? JSON.parse(resume.education) : [],
      summary: resume.summary ?? "",
      certifications: resume.certifications ? JSON.parse(resume.certifications) : [],
      links: resume.links ? JSON.parse(resume.links) : []
    };
  }
});
