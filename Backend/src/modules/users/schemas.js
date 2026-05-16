import { z } from 'zod';

/**
 * Tighten `z.string().url()` so values like `javascript:alert(1)` and
 * `data:text/html;…` cannot make it through. The default `URL()`
 * constructor accepts every parseable URL — the protocol whitelist
 * here is what stops a stored XSS via a profile field rendered as
 * `<a href={website}>` on the frontend.
 */
const HttpUrlOrEmpty = z
  .union([z.string().url(), z.literal('')])
  .refine((value) => {
    if (value === '') return true;
    try {
      const u = new URL(value);
      return u.protocol === 'http:' || u.protocol === 'https:';
    } catch {
      return false;
    }
  }, { message: 'URL must use http:// or https://' });

export const UpdateProfileSchema = z.object({
  fullName: z.string().min(1).max(80).optional(),
  bio: z.string().max(500).optional(),
  location: z.string().max(80).optional(),
  website: HttpUrlOrEmpty.optional(),
  avatarUrl: HttpUrlOrEmpty.optional(),
  theme: z.enum(['dark', 'light']).optional(),
});

/** Body for `PUT /api/users/:id/role`. The closed enum keeps invalid roles
 *  out of the service entirely — see ADR 0006. */
export const UpdateRoleSchema = z.object({
  role: z.enum(['STUDENT', 'INSTRUCTOR', 'ADMIN']),
});
