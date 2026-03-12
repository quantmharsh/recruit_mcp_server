import { z } from "zod";

export const ResumeSchema = z.object({
  name: z.string(),
  email: z.string(),
  skills: z.array(z.string()),
  yearsOfExperience: z.number(),
  education: z.array(z.string()),
  summary: z.string().optional(),
  certifications: z.array(z.string()).optional(),
  links: z.array(z.string()).optional()
});

export type ResumeData = z.infer<typeof ResumeSchema>;
