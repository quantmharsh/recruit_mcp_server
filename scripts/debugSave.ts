import "dotenv/config";
import { initDB } from "../src/db/client.js";
import { db } from "../src/db/client.js";
import type { AppContext } from "../src/context/app.context.js";

// replicate the portion of runEngine that handles results
async function processResult(result: any, context: AppContext) {
  console.log("DEBUG: Agent finalOutput:", result.finalOutput);
  const toolSaved = !!context.lastSavedResume;
  if (toolSaved) {
    console.log("DEBUG: Resume was already saved by save_resume tool:", context.lastSavedResume);
  }

  let resume: any = null;
  if (result.finalOutput && typeof result.finalOutput === "object") {
    resume = result.finalOutput;
  } else if (typeof result.finalOutput === "string") {
    try {
      resume = JSON.parse(result.finalOutput);
    } catch (_err) {}
  }

  if (resume && typeof resume === "object" && "skills" in resume && context.userId) {
    if (!toolSaved) {
      console.log("DEBUG: Performing fallback save in runEngine");
      context.db.prepare(`DELETE FROM resumes WHERE user_id = ?`).run(context.userId);
      context.db
        .prepare(`INSERT INTO resumes (user_id, name, email, skills, years_of_experience, education) VALUES (?, ?, ?, ?, ?, ?)`)
        .run(
          context.userId,
          resume.name,
          resume.email,
          JSON.stringify(resume.skills),
          resume.yearsOfExperience,
          JSON.stringify(resume.education)
        );
      const saved = context.db
        .prepare("SELECT * FROM resumes WHERE user_id = ?")
        .get(context.userId);
      console.log("DEBUG: Fallback saved resume row:", saved);
    }
    console.log("\n✅ Resume saved successfully to database.\n");
  }
}

// helper to ensure we have a user and context
async function prepare() {
  initDB();
  const existing = db.prepare("SELECT * FROM users WHERE email = ?").get("test@example.com");
  if (!existing) {
    db.prepare("INSERT INTO users (name,email,phone,role) VALUES (?,?,?,?)").run(
      "Test User",
      "test@example.com",
      "1234567890",
      "candidate"
    );
  }
  const user = db.prepare("SELECT * FROM users WHERE email = ?").get("test@example.com") as { id: number };
  return user.id;
}

(async () => {
  const userId = await prepare();
  const { context } = await import("../src/core/runEngine.js");
  context.userId = userId;
  context.authStatus = "AUTHENTICATED";
  context.lastSavedResume = undefined;
  console.log("Using userId", userId);

  const resumeString = JSON.stringify({
    name: "Demo",
    email: "demo@example.com",
    skills: ["testing"],
    yearsOfExperience: 3,
    education: ["B.Sc"]
  });

  await processResult({ finalOutput: resumeString }, context);

  const saved = db.prepare("SELECT * FROM resumes WHERE user_id = ?").get(userId);
  console.log("Final row in DB:", saved);
})();