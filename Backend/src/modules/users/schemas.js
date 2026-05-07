import { z } from 'zod';

export const UpdateProfileSchema = z.object({
  fullName: z.string().min(1).max(80).optional(),
  bio: z.string().max(500).optional(),
  location: z.string().max(80).optional(),
  website: z.string().url().or(z.literal('')).optional(),
  avatarUrl: z.string().url().or(z.literal('')).optional(),
  theme: z.enum(['dark', 'light']).optional(),
});
