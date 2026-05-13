import { z } from 'zod';

const SlugSchema = z.string()
  .min(3).max(64)
  .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/, 'lowercase letters, digits, and single hyphens only');

export const CreateContestSchema = z.object({
  title: z.string().min(1).max(200),
  slug: SlugSchema,
  description: z.string().max(20000).optional(),
  startsAt: z.string().datetime({ offset: true }),
  endsAt: z.string().datetime({ offset: true }),
  freezeMinutes: z.number().int().min(0).max(1440).default(30),
  isPublic: z.boolean().default(true),
}).refine(data => new Date(data.endsAt) > new Date(data.startsAt), {
  message: 'endsAt must be after startsAt',
  path: ['endsAt'],
});

export const UpdateContestSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(20000).optional(),
  startsAt: z.string().datetime({ offset: true }).optional(),
  endsAt: z.string().datetime({ offset: true }).optional(),
  freezeMinutes: z.number().int().min(0).max(1440).optional(),
  isPublic: z.boolean().optional(),
}).refine(data => Object.keys(data).length > 0, {
  message: 'At least one field must be provided',
});

export const AttachProblemSchema = z.object({
  problemSlug: z.string().min(1).max(64),
  letter: z.string().regex(/^[A-Z]$/, 'Must be a single uppercase letter A-Z'),
});

export const ContestSubmissionSchema = z.object({
  language: z.string().min(1).max(20),
  code: z.string().min(1).max(50000),
});

export const EditorialSchema = z.object({
  content: z.string().min(1).max(100000),
});

export const StandingsQuerySchema = z.object({
  unfrozen: z.enum(['true', 'false']).optional(),
  since: z.string().datetime({ offset: true }).optional(),
});

export const ContestListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(['upcoming', 'running', 'finished']).optional(),
});
