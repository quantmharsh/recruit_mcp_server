import { tool, RunContext } from "@openai/agents";
import { z } from "zod";
import type { AppContext } from "../context/app.context.js";
import { sendEmail } from "../services/email.service.js";
import { generateOtpEmail } from "../helper/email.helper.js";

function generateOtp() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

export const loginUserTool = tool({
  name: "login_user",
  description: "Login user by sending OTP to email",
  parameters: z.object({
    email: z.string().email(),
  }),
  execute: async ({ email }, ctx?: RunContext<AppContext>) => {
    const db = ctx!.context.db;

    const user = db
      .prepare("SELECT * FROM users WHERE email = ?")
      .get(email) as { id: number; name: string; email: string } | undefined;

    if (!user) {
      return "User not found. Please register first.";
    }

    const otp = generateOtp();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

    db.prepare(`
      INSERT INTO login_otps (user_id, otp, expires_at)
      VALUES (?, ?, ?)
    `).run(user.id, otp, expiresAt);

    // 🔐 Secure OTP Email
    await sendEmail({
      to: email,
      subject: "RecruitMCP Login OTP",
      html: generateOtpEmail(user.name, otp),
    });

    return "OTP sent to your email. Please verify.";
  },
});

export const registerUserTool = tool({
  name: "register_user",
  description: "Register a new user",
  parameters: z.object({
    name: z.string(),
    email: z.string().email(),
    phone: z.string(),
    role: z.enum(["candidate", "recruiter"]),
  }),
  execute: async ({ name, email, phone, role }, ctx?: RunContext<AppContext>) => {
    const db = ctx!.context.db;

    const existing = db
      .prepare("SELECT * FROM users WHERE email = ?")
      .get(email);

    if (existing) {
      return "User already exists. Please login.";
    }

    db.prepare(`
      INSERT INTO users (name, email, phone, role)
      VALUES (?, ?, ?, ?)
    `).run(name, email, phone, role);

    return "Registration successful. Please login to continue.";
  },
});


export const verifyOtpTool = tool({
  name: "verify_otp",
  description: "Verify OTP and create session",
  parameters: z.object({
    email: z.string().email(),
    otp: z.string(),
  }),
  execute: async ({ email, otp }, ctx?: RunContext<AppContext>) => {
    const db = ctx!.context.db;

    const user = db
      .prepare("SELECT * FROM users WHERE email = ?")
      .get(email) as { id: number; name: string; email: string; role: "candidate" | "recruiter" } | undefined;

    if (!user) return "User not found.";

    const record = db
      .prepare(`
        SELECT * FROM login_otps 
        WHERE user_id = ? 
        AND otp = ? 
        AND is_used = 0
      `)
      .get(user.id, otp) as { id: number; otp: string; expires_at: string; is_used: number } | undefined;

    if (!record) return "Invalid OTP.";

    if (new Date(record.expires_at) < new Date()) {
      return "OTP expired.";
    }

    db.prepare(`
      UPDATE login_otps SET is_used = 1 WHERE id = ?
    `).run(record.id);

    const sessionId = crypto.randomUUID();

    db.prepare(`
      INSERT INTO sessions (id, user_id)
      VALUES (?, ?)
    `).run(sessionId, user.id);

    ctx!.context.userId = user.id;
    ctx!.context.role = user.role;

    return `Login successful. Welcome ${user.name}!`;
  },
});