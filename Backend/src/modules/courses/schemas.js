import { z } from 'zod';

/**
 * Slug rules: lowercase alphanumeric with single hyphens, 3..64 chars.
 * Must be URL-safe and stable across catalog re-imports — see ADR 0007.
 */
const SlugSchema = z.string()
  .min(3).max(64)
  .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/,
    'lowercase letters, digits, and single hyphens only');

export const CreateCourseSchema = z.object({
  slug: SlugSchema,
  title: z.string().min(1).max(200),
  description: z.string().max(10000).optional(),
});

export const UpdateCourseSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(10000).optional(),
}).refine((d) => d.title !== undefined || d.description !== undefined, {
  message: 'At least one of title / description must be provided',
});

export const AttachProblemSchema = z.object({
  problemSlug: z.string().min(1).max(200),
  position: z.number().int().min(0).max(10000).optional(),
});
