import { z } from 'zod';

export const trainSearchQuerySchema = z.object({
  q: z.string().optional().default(''),
  limit: z
    .string()
    .optional()
    .transform((val) => (val ? parseInt(val, 10) : 15))
    .pipe(z.number().int().positive().max(50)),
});

export const createUnverifiedTrainSchema = z
  .object({
    train_number: z.string().max(20).optional(),
    trainNumber: z.string().max(20).optional(),
    train_name: z.string().max(200).optional().nullable(),
    trainName: z.string().max(200).optional().nullable(),
  })
  .transform((data, ctx) => {
    const rawNumber = data.train_number ?? data.trainNumber;
    if (!rawNumber || !rawNumber.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['train_number'],
        message: 'Train number is required',
      });
      return z.NEVER;
    }

    const trimmedNumber = rawNumber.trim();
    if (trimmedNumber.length > 20) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['train_number'],
        message: 'Train number must not exceed 20 characters',
      });
      return z.NEVER;
    }

    return {
      trainNumber: trimmedNumber,
      trainName: (data.train_name ?? data.trainName)?.trim() || null,
    };
  });

export type ValidatedCreateUnverifiedTrainInput = z.infer<typeof createUnverifiedTrainSchema>;
