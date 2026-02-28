import { tool ,RunContext } from "@openai/agents";
import { z } from "zod";
import fs from "fs/promises";
import type { AppContext } from "../context/app.context.js";

export const uploadResumeTool = tool({
  name: "upload_resume",
  description: "Upload and read resume file content",
  parameters: z.object({
    path: z.string().describe("Path of resume text file")
  }),
  execute: async ({ path }, ctx?: RunContext<AppContext>) => {
if (!ctx?.context.userId) {
  throw new Error("Unauthorized: Please login before uploading resume.");
}
if (!ctx?.context.userId) {
  throw new Error("UNAUTHORIZED");
}
    console.log("Session:", ctx?.context.sessionId);

    const content = await fs.readFile(path, "utf-8");
    return content;
  }
});