// saveResume.tool.ts
import { tool, RunContext } from "@openai/agents";
import { z } from "zod";
import type { AppContext } from "../context/app.context.js";

export const saveResumeTool = tool({
  name: "save_resume",
  description: "Save structured resume data into database",
  parameters: z.object({
    name: z.string(),
    email: z.string(),
    skills: z.array(z.string()),
    yearsOfExperience: z.number(),
    education: z.array(z.string())
  }),
  execute: async (data, ctx?: RunContext<AppContext>) => {
    if (!ctx?.context.userId) {
      throw new Error("UNAUTHORIZED");
    }

    const db = ctx.context.db;

    db.prepare(`DELETE FROM resumes WHERE user_id = ?`)
      .run(ctx.context.userId);

    db.prepare(`
      INSERT INTO resumes 
      (user_id, name, email, skills, years_of_experience, education)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      ctx.context.userId,
      data.name,
      data.email,
      JSON.stringify(data.skills),
      data.yearsOfExperience,
      JSON.stringify(data.education)
    );

    return "Resume saved successfully.";
  }
});