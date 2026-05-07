import { z } from 'zod';

export const SubmitSchema = z.object({
  language: z.string().min(1).max(20),
  code: z.string().min(1).max(50000),
});
