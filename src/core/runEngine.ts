import { InputGuardrailTripwireTriggered, run } from "@openai/agents";
import type { AppContext } from "../context/app.context.js";
import { findUserByEmail, startOtpLogin } from "../tools/auth.tool.js";
import {
  createJobRecord,
  extractRecruiterJobDraft,
  getMissingRecruiterJobFields,
  isRecruiterJobDraftComplete,
  mergeRecruiterJobDraft
} from "../tools/recruiter.tool.js";
import {
  db,
  ensureApplicationsColumns,
  ensureJobColumns,
  ensureResumeColumns,
  initDB
} from "../db/client.js";

initDB();
ensureResumeColumns(); // Keep resume enrichment columns available on older SQLite files.
ensureApplicationsColumns(); // Keep application cover letters available on older SQLite files.
ensureJobColumns(); // Keep recruiter job metadata columns available on older SQLite files.

let thread: any[] = [];

// This object is shared by every turn in the current CLI process. The agent and the
// deterministic draft handlers both read and write here, so it is the single source
// of truth for auth state, DB access, and in-memory multi-step flows.
export const context: AppContext = {
  sessionId: crypto.randomUUID(),
  storagePath: "./storage",
  startedAt: new Date(),
  db,
  authStatus: "NOT_AUTHENTICATED"
};

function getMessageText(message: any) {
  if (typeof message?.content === "string") {
    return message.content;
  }

  if (Array.isArray(message?.content)) {
    return message.content
      .map((item: any) => {
        if (typeof item?.text === "string") return item.text;
        if (typeof item?.content === "string") return item.content;
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }

  return "";
}

function pushAssistantMessage(message: string) {
  console.log("\nAssistant:", message, "\n");

  // The OpenAI agent history expects assistant content as an array of content parts.
  // Writing plain strings here corrupts the conversation history and causes the
  // `item.content.map is not a function` crash on the next agent turn.
  thread.push({
    role: "assistant",
    content: [{ type: "output_text", text: message }]
  });
}

function hasRecruiterJobIntent(input: string) {
  return (
    /\b(post|create|add|publish)\b.*\bjobs?\b/i.test(input) ||
    /\b(post|create|add|publish)\b.*\bjob openings?\b/i.test(input) ||
    /\bi want to post jobs?\b/i.test(input)
  );
}

function wantsCurrentRecruiterEmail(input: string) {
  return /\b(use|keep|take)\b.*\bcurrent email\b/i.test(input) || /\buse current emai\w*\b/i.test(input);
}

function extractFirstEmail(input: string) {
  return input.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0];
}

function mentionsExistingRegistration(input: string) {
  return /\balready\s+(?:registered|registerd|have an account|have account)\b/i.test(input);
}

function asksForAuthOrRecruiterEntry(input: string) {
  return (
    /\b(log\s*me\s*in|login|sign\s*in)\b/i.test(input) ||
    /\b(register|sign\s*up)\b/i.test(input) ||
    /\b(post|create|add|publish)\b.*\bjobs?\b/i.test(input) ||
    /\b(post|create|add|publish)\b.*\bjob openings?\b/i.test(input) ||
    /\brecruiter\b/i.test(input)
  );
}

function formatRecruiterDraftSummary(appContext: AppContext) {
  const draft = appContext.recruiterJobDraft;
  if (!draft) return "";

  const lines: string[] = [];
  if (draft.title) lines.push(`- Job Title: ${draft.title}`);
  if (draft.description) lines.push(`- Job Description: ${draft.description}`);
  if (draft.companyName) lines.push(`- Company Name: ${draft.companyName}`);
  if (draft.location) lines.push(`- Location: ${draft.location}`);
  if (draft.requiredSkills?.length) {
    lines.push(`- Required Skills: ${draft.requiredSkills.join(", ")}`);
  }
  if (draft.salaryRange) lines.push(`- Salary Range: ${draft.salaryRange}`);
  if (draft.employmentType) lines.push(`- Employment Type: ${draft.employmentType}`);
  if (draft.experienceLevel) lines.push(`- Experience Level: ${draft.experienceLevel}`);
  if (typeof draft.remoteFriendly === "boolean") {
    lines.push(`- Remote Friendly: ${draft.remoteFriendly ? "Yes" : "No"}`);
  }
  if (draft.contactEmail) lines.push(`- Contact Email: ${draft.contactEmail}`);

  return lines.join("\n");
}

async function maybeHandleRecruiterJobDraft(input: string) {
  if (context.authStatus !== "AUTHENTICATED" || context.role !== "recruiter" || !context.userId) {
    return false;
  }

  const parsedDraft = extractRecruiterJobDraft(input);
  const hasCreateIntent = hasRecruiterJobIntent(input);
  const useCurrentEmail = wantsCurrentRecruiterEmail(input);
  const shouldHandleDraft =
    hasCreateIntent || useCurrentEmail || Object.keys(parsedDraft).length > 0;

  // Only intercept recruiter job-post turns that clearly belong to the structured
  // draft flow. Everything else should continue through the agent as before.
  if (!shouldHandleDraft) {
    return false;
  }

  context.recruiterJobDraft = mergeRecruiterJobDraft(context.recruiterJobDraft, parsedDraft);

  if (useCurrentEmail) {
    const recruiter = context.db
      .prepare("SELECT email FROM users WHERE id = ?")
      .get(context.userId) as { email: string } | undefined;
    if (recruiter?.email) {
      context.recruiterJobDraft.contactEmail = recruiter.email;
    }
  }

  // As soon as every required recruiter job field is present, bypass the model and
  // create the job directly. This prevents the agent from forgetting fields from a
  // long multi-line message that already contains the full job post.
  if (isRecruiterJobDraftComplete(context.recruiterJobDraft)) {
    const result = createJobRecord(context.db, context.userId, {
      ...context.recruiterJobDraft,
      salaryRange: context.recruiterJobDraft.salaryRange ?? "",
      contactEmail: context.recruiterJobDraft.contactEmail ?? ""
    });

    const createdMessage = [
      `Your job posting for "${context.recruiterJobDraft.title}" has been created successfully.`,
      `Job ID: ${String(result.lastInsertRowid)}`,
      `Company: ${context.recruiterJobDraft.companyName}`,
      `Location: ${context.recruiterJobDraft.location}`,
      `Required Skills: ${context.recruiterJobDraft.requiredSkills.join(", ")}`,
      `Remote Friendly: ${context.recruiterJobDraft.remoteFriendly ? "Yes" : "No"}`,
      `Contact Email: ${context.recruiterJobDraft.contactEmail || "Not provided"}`
    ].join("\n");

    delete context.recruiterJobDraft;
    pushAssistantMessage(createdMessage);
    return true;
  }

  const missingFields = getMissingRecruiterJobFields(context.recruiterJobDraft);
  const summary = formatRecruiterDraftSummary(context);
  const messageParts = ["I have saved your recruiter job draft."];

  if (summary) {
    messageParts.push("Current details:");
    messageParts.push(summary);
  }

  if (missingFields.length) {
    messageParts.push(`Still needed: ${missingFields.join(", ")}.`);
  }

  messageParts.push(
    "You can send the remaining fields in one message using labels like `Job Title:`, `Job Description:`, `Company Name:`, `Location:`, `Required Skills:`, and so on."
  );

  pushAssistantMessage(messageParts.join("\n"));
  return true;
}

async function maybeHandleDeterministicAuth(input: string) {
  if (context.authStatus === "AUTHENTICATED") {
    return false;
  }

  const email = extractFirstEmail(input);

  // A bare email should not always be intercepted. We only step in when the user is
  // clearly in an auth/recruiter-entry flow, or when the assistant already asked for
  // an email during OTP or registration.
  const shouldInspectEmail =
    !!email &&
    (
      asksForAuthOrRecruiterEntry(input) ||
      mentionsExistingRegistration(input) ||
      context.authStatus === "OTP_PENDING" ||
      thread.some(
        (message) =>
          message.role === "assistant" &&
          /email address|provide your email|complete.*registration|one-time password|otp/i.test(
            getMessageText(message)
          )
      )
    );

  if (!shouldInspectEmail || !email) {
    return false;
  }

  const existingUser = findUserByEmail(context, email);

  // Existing emails should always move into OTP login immediately. This avoids the
  // confusing "please register" response you saw for already-registered recruiters.
  if (existingUser) {
    const loginResult = await startOtpLogin(context, email);
    if (!loginResult.ok) {
      return false;
    }

    pushAssistantMessage(
      `An OTP has been sent to your email address ${email}. Please enter the 6-digit OTP here to continue.`
    );
    return true;
  }

  // Unknown emails stay on the registration path, but we preserve the email in context
  // so the later registration turn can reuse it instead of asking again.
  if (context.authStatus !== "OTP_PENDING") {
    context.pendingEmail = email;
    pushAssistantMessage(
      `I could not find an existing account for ${email}. Please share your name and phone number so I can register you first.`
    );
    return true;
  }

  return false;
}

export async function runWithoutStreaming(agent: any, input: string) {
  thread.push({ role: "user", content: input });

  // Reset transient per-turn flags before handing control to the deterministic flows or the agent.
  context.lastSavedResume = undefined;

  if (await maybeHandleDeterministicAuth(input)) {
    return;
  }

  if (await maybeHandleRecruiterJobDraft(input)) {
    return;
  }

  try {
    const result = await run(agent, thread, { context });

    console.log("DEBUG: Agent finalOutput:", result.finalOutput);

    const toolSaved = !!context.lastSavedResume;
    if (toolSaved) {
      console.log("DEBUG: Resume was already saved by save_resume tool:", context.lastSavedResume);
    }

    // Resume extraction may arrive either as a plain object or a JSON string depending
    // on how the agent returned the final output, so we normalize both cases here.
    let resume: any = null;
    if (result.finalOutput && typeof result.finalOutput === "object") {
      resume = result.finalOutput;
    } else if (typeof result.finalOutput === "string") {
      try {
        resume = JSON.parse(result.finalOutput);
      } catch {
        // Non-JSON assistant responses should continue as normal.
      }
    }

    // This fallback write protects against cases where the resume agent produced a
    // structured resume but forgot to call the persistence tool itself.
    if (resume && typeof resume === "object" && "skills" in resume && context.userId) {
      if (!toolSaved) {
        console.log("DEBUG: Performing fallback save in runEngine");
        context.db.prepare("DELETE FROM resumes WHERE user_id = ?").run(context.userId);
        context.db
          .prepare(`
            INSERT INTO resumes
            (user_id, name, email, skills, years_of_experience, education, summary, certifications, links)
            VALUES (?, ?, ?, ?, ?, ?, '', '[]', '[]')
          `)
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

      console.log("\nResume saved successfully to database.\n");
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
