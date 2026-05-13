import { z } from 'zod';

const SlugSchema = z.string()
  .min(2).max(64)
  .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/,
    'lowercase letters, digits, and single hyphens only');

const IsoDateTime = z.string().datetime({ offset: true });

export const CreateExamSchema = z.object({
  slug: SlugSchema,
  title: z.string().min(1).max(200),
  description: z.string().max(10000).optional(),
  startsAt: IsoDateTime,
  endsAt: IsoDateTime,
  durationMinutes: z.number().int().min(1).max(60 * 24),
  // groupSlug is optional; null / missing means the exam is open to
  // every student enrolled in the course via any group.
  groupSlug: z.string().min(2).max(40).regex(/^[a-z0-9-]+$/).nullable().optional(),
}).refine((d) => new Date(d.endsAt) > new Date(d.startsAt), {
  message: 'endsAt must be after startsAt',
  path: ['endsAt'],
});

export const UpdateExamSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(10000).optional(),
  startsAt: IsoDateTime.optional(),
  endsAt: IsoDateTime.optional(),
  durationMinutes: z.number().int().min(1).max(60 * 24).optional(),
  groupSlug: z.string().min(2).max(40).regex(/^[a-z0-9-]+$/).nullable().optional(),
}).refine((d) => Object.keys(d).length > 0, {
  message: 'At least one field must be provided',
});

export const AttachExamProblemSchema = z.object({
  problemSlug: z.string().min(1).max(200),
  position: z.number().int().min(0).max(10000).optional(),
  points: z.number().int().min(1).max(10000).optional(),
});

export const SubmitInAttemptSchema = z.object({
  language: z.string().min(1).max(20),
  code: z.string().min(1).max(50000),
});
