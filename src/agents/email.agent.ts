import { tool } from "@openai/agents";
import { z } from "zod";
import { sendEmail } from "../services/email.service.js";

export const sendEmailTool = tool({
  name: "send_email",
  description: "Send email to a user",
  parameters: z.object({
    to: z.string().email(),
    subject: z.string(),
    html: z.string(),
  }),
  execute: async ({ to, subject, html }) => {
    try {
      await sendEmail({ to, subject, html });
      return `Email successfully sent to ${to}`;
    } catch (err: any) {
      return `Failed to send email: ${err.message}`;
    }
  },
});