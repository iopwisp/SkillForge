import { z } from 'zod';

const SlugSchema = z.string()
  .min(2).max(40)
  .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/,
    'lowercase letters, digits, and single hyphens only');

export const CreateGroupSchema = z.object({
  slug: SlugSchema,
  title: z.string().min(1).max(120),
});

export const UpdateGroupSchema = z.object({
  title: z.string().min(1).max(120).optional(),
}).refine((d) => d.title !== undefined, {
  message: 'At least one of title must be provided',
});

export const AddMemberSchema = z.object({
  username: z.string().min(1).max(64),
});

export const JoinByInviteCodeSchema = z.object({
  code: z.string().min(4).max(20),
});
