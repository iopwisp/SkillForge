import { z } from 'zod';

export const RegisterSchema = z.object({
  username: z.string().min(3).max(32).regex(/^[a-zA-Z0-9_-]+$/, 'letters, digits, _ or - only'),
  email: z.string().email(),
  password: z.string().min(6).max(128),
  fullName: z.string().min(1).max(80).optional(),
});

export const LoginSchema = z.object({
  emailOrUsername: z.string().min(1),
  password: z.string().min(1),
});

export const ChangePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(6).max(128),
});
