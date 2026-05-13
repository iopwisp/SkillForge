import { z } from 'zod';

export const SubmitSchema = z.object({
  language: z.string().min(1).max(20),
  code: z.string().min(1).max(50000),
});

export const RunSchema = z.object({
  language: z.string().min(1).max(20),
  code: z.string().min(1).max(50000),
  stdin: z.string().max(1024 * 1024).optional(), // max 1 MB at schema level
});
