import { z } from 'zod';

export const blockUserSchema = z.object({
  blocked_id: z.string().uuid({ message: 'Invalid blocked_id UUID' }),
});

export const unblockParamsSchema = z.object({
  blockedId: z.string().uuid({ message: 'Invalid blockedId UUID' }),
});

export const reportUserSchema = z.object({
  reported_id: z.string().uuid({ message: 'Invalid reported_id UUID' }),
  reason: z
    .string()
    .max(2000, { message: 'Reason must not exceed 2000 characters' })
    .optional()
    .nullable(),
});
