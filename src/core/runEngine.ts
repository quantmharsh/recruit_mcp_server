import { run } from "@openai/agents";
import { db, initDB, ensureResumeColumns, ensureApplicationsColumns } from "../db/client.js";
import type { AppContext } from "../context/app.context.js";
import { InputGuardrailTripwireTriggered } from "@openai/agents";

initDB();
ensureResumeColumns(); // make sure new resume columns exist before the CLI runs
ensureApplicationsColumns(); // keep cover_letter column available for application inserts

let thread: any[] = [];

// IMPORTANT: Persistent context (do NOT recreate each call)
export const context: AppContext = {
  sessionId: crypto.randomUUID(), 
  storagePath: "./storage",
  startedAt: new Date(),
  db,
  authStatus: "NOT_AUTHENTICATED"
};

export async function runWithoutStreaming(agent: any, input: string) {
 
  thread.push({ role: "user", content: input });

  // start fresh for this call – clear any previous save flag
  context.lastSavedResume = undefined;

try {
  const result = await run(agent, thread, { context });

  // always output what the agent produced so we can debug later
  console.log("DEBUG: Agent finalOutput:", result.finalOutput);

  // if the save_resume tool executed it will have stored a flag
  const toolSaved = !!context.lastSavedResume;
  if (toolSaved) {
    console.log("DEBUG: Resume was already saved by save_resume tool:", context.lastSavedResume);
  }

  // try to coerce the finalOutput into a resume object in case the
  // model returned a JSON string. this covers scenarios where the
  // agent produced valid JSON text but run() returns it as string.
  let resume: any = null;
  if (result.finalOutput && typeof result.finalOutput === "object") {
    resume = result.finalOutput;
  } else if (typeof result.finalOutput === "string") {
    try {
      resume = JSON.parse(result.finalOutput);
    } catch (_err) {
      // not JSON – ignore
    }
  }

  // if we got a resume object and the user is authenticated, persist it
  if (resume && typeof resume === "object" && "skills" in resume && context.userId) {
    if (!toolSaved) {
      // fallback save in case the agent forgot to call the tool
      console.log("DEBUG: Performing fallback save in runEngine");
      context.db.prepare(`
        DELETE FROM resumes WHERE user_id = ?
      `).run(context.userId);
      context.db.prepare(`
        INSERT INTO resumes 
        (user_id, name, email, skills, years_of_experience, education, summary, certifications, links)
        VALUES (?, ?, ?, ?, ?, ?, '', '[]', '[]')
      `).run(
        context.userId,
        resume.name,
        resume.email,
        JSON.stringify(resume.skills),
        resume.yearsOfExperience,
        JSON.stringify(resume.education),
        "",
        "[]",
        "[]"
      );

      const saved = context.db
        .prepare("SELECT * FROM resumes WHERE user_id = ?")
        .get(context.userId);
      console.log("DEBUG: Fallback saved resume row:", saved);
    }

    console.log("\n✅ Resume saved successfully to database.\n");
  }
  console.log("\nAssistant:", result.finalOutput, "\n");
  thread = result.history;
} catch (e) {
  if (e instanceof InputGuardrailTripwireTriggered) {
    console.log("\nAssistant: Sorry, I can only help with recruitment-related tasks.\n");
  } else {
    console.error(e);
  }
}
}
