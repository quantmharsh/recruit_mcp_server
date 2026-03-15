import { tool, RunContext } from "@openai/agents";
import { z } from "zod";
import type { AppContext } from "../context/app.context.js";
import { generateOtpEmail } from "../helper/email.helper.js";
import { sendEmail } from "../services/email.service.js";

type DbAuthUser = {
  id: number;
  name: string;
  email: string;
  role: "candidate" | "recruiter";
};

function generateOtp() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

export function findUserByEmail(appContext: AppContext, email: string) {
  return appContext.db
    .prepare("SELECT id, name, email, role FROM users WHERE email = ?")
    .get(email) as DbAuthUser | undefined;
}

// This helper is shared by both the login tool and the deterministic engine flow.
// Keeping OTP creation in one place prevents the CLI from behaving differently
// depending on whether a login request was handled by the model or by code.
export async function startOtpLogin(appContext: AppContext, email: string) {
  const user = findUserByEmail(appContext, email);
  if (!user) {
    return {
      ok: false as const,
      reason: "USER_NOT_FOUND" as const
    };
  }

  appContext.authStatus = "OTP_PENDING";
  appContext.pendingEmail = email;

  const otp = generateOtp();
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

  appContext.db
    .prepare(
      `
      INSERT INTO login_otps (user_id, otp, expires_at)
      VALUES (?, ?, ?)
    `
    )
    .run(user.id, otp, expiresAt);

  await sendEmail({
    to: email,
    subject: "RecruitMCP Login OTP",
    html: generateOtpEmail(user.name, otp)
  });

  return {
    ok: true as const,
    user
  };
}

export const loginUserTool = tool({
  name: "login_user",
  description: "Login user by sending OTP to email",
  parameters: z.object({
    email: z.string().email()
  }),
  execute: async ({ email }, ctx?: RunContext<AppContext>) => {
    const result = await startOtpLogin(ctx!.context, email);

    if (!result.ok) {
      return "User not found. Please register first.";
    }

    return "OTP sent to your email. Please verify.";
  }
});

export const registerUserTool = tool({
  name: "register_user",
  description: "Register a new user",
  parameters: z.object({
    name: z.string(),
    email: z.string().email(),
    phone: z.string(),
    role: z.enum(["candidate", "recruiter"])
  }),
  execute: async ({ name, email, phone, role }, ctx?: RunContext<AppContext>) => {
    const db = ctx!.context.db;

    const existing = db.prepare("SELECT * FROM users WHERE email = ?").get(email);
    if (existing) {
      return "User already exists. Please login.";
    }

    db.prepare(
      `
      INSERT INTO users (name, email, phone, role)
      VALUES (?, ?, ?, ?)
    `
    ).run(name, email, phone, role);

    return "Registration successful. Please login to continue.";
  }
});

export const verifyOtpTool = tool({
  name: "verify_otp",
  description: "Verify OTP and create session",
  parameters: z.object({
    email: z.string().email(),
    otp: z.string()
  }),
  execute: async ({ email, otp }, ctx?: RunContext<AppContext>) => {
    const db = ctx!.context.db;

    const user = db
      .prepare("SELECT * FROM users WHERE email = ?")
      .get(email) as DbAuthUser | undefined;
    if (!user) return "User not found.";

    const record = db
      .prepare(
        `
        SELECT * FROM login_otps
        WHERE user_id = ?
          AND otp = ?
          AND is_used = 0
      `
      )
      .get(user.id, otp) as { id: number; otp: string; expires_at: string; is_used: number } | undefined;

    if (!record) return "Invalid OTP.";
    if (new Date(record.expires_at) < new Date()) {
      return "OTP expired.";
    }

    db.prepare("UPDATE login_otps SET is_used = 1 WHERE id = ?").run(record.id);

    const sessionId = crypto.randomUUID();
    db.prepare("INSERT INTO sessions (id, user_id) VALUES (?, ?)").run(sessionId, user.id);

    // Once OTP verification succeeds, the rest of the CLI can trust the shared
    // context instead of re-reading auth state from the database each turn.
    ctx!.context.userId = user.id;
    ctx!.context.role = user.role;
    ctx!.context.authStatus = "AUTHENTICATED";
    ctx!.context.pendingEmail = undefined;

    return `Login successful. Welcome ${user.name}!`;
  }
});
