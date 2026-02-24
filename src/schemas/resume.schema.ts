import { z } from "zod";

export const ResumeSchema = z.object({
  name: z.string(),
  email: z.string().email(),
  skills: z.array(z.string()),
  yearsOfExperience: z.number(),
  education: z.array(z.string())
});

export type ResumeData = z.infer<typeof ResumeSchema>;