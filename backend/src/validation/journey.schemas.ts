import { z } from 'zod';

const TRAIN_NUMBER_REGEX = /^[A-Za-z0-9\s-]+$/;
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Validates and normalizes journey creation payloads (Spec §9.2, §10.3).
 * Supports both snake_case (API standard) and camelCase inputs.
 */
export const createJourneySchema = z
  .object({
    train_number: z.string().max(20).optional(),
    trainNumber: z.string().max(20).optional(),
    train_name: z.string().max(200).optional().nullable(),
    trainName: z.string().max(200).optional().nullable(),
    travel_date: z.string().optional(),
    travelDate: z.string().optional(),
    coach: z.string().max(50).optional().nullable(),
    boarding_station: z.string().max(200).optional().nullable(),
    boardingStation: z.string().max(200).optional().nullable(),
    destination_station: z.string().max(200).optional().nullable(),
    destinationStation: z.string().max(200).optional().nullable(),
    college: z.string().max(200).optional().nullable(),
    gender: z
      .enum(['male', 'female', 'other', 'prefer_not_to_say', 'prefer-not-to-say', ''], {
        errorMap: () => ({ message: 'Invalid gender value' }),
      })
      .optional()
      .nullable(),
    user_name: z.string().max(100).optional().nullable(),
    userName: z.string().max(100).optional().nullable(),
    is_train_verified: z.boolean().optional(),
    isTrainVerified: z.boolean().optional(),
  })
  .transform((data, ctx) => {
    const rawTrainNumber = data.train_number ?? data.trainNumber;
    if (!rawTrainNumber || !rawTrainNumber.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['train_number'],
        message: 'Train number is required',
      });
      return z.NEVER;
    }

    const trimmedTrainNumber = rawTrainNumber.trim();
    if (!TRAIN_NUMBER_REGEX.test(trimmedTrainNumber)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['train_number'],
        message: 'Train number can only contain letters, numbers, spaces, and hyphens',
      });
      return z.NEVER;
    }

    if (trimmedTrainNumber.length > 20) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['train_number'],
        message: 'Train number must not exceed 20 characters',
      });
      return z.NEVER;
    }

    const rawTravelDate = data.travel_date ?? data.travelDate;
    if (!rawTravelDate || !rawTravelDate.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['travel_date'],
        message: 'Travel date is required',
      });
      return z.NEVER;
    }

    const trimmedDate = rawTravelDate.trim().split('T')[0] ?? '';
    if (!DATE_REGEX.test(trimmedDate)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['travel_date'],
        message: 'Travel date must be in YYYY-MM-DD format',
      });
      return z.NEVER;
    }

    const parsedDate = new Date(`${trimmedDate}T00:00:00.000Z`);
    if (isNaN(parsedDate.getTime())) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['travel_date'],
        message: 'Invalid travel date',
      });
      return z.NEVER;
    }

    return {
      trainNumber: trimmedTrainNumber,
      trainName: (data.train_name ?? data.trainName)?.trim() || null,
      travelDate: trimmedDate,
      coach: data.coach?.trim() || null,
      boardingStation: (data.boarding_station ?? data.boardingStation)?.trim() || null,
      destinationStation: (data.destination_station ?? data.destinationStation)?.trim() || null,
      college: data.college?.trim() || null,
      gender: data.gender?.trim() || null,
      userName: (data.user_name ?? data.userName)?.trim() || null,
      isTrainVerified: data.is_train_verified ?? data.isTrainVerified,
    };
  });

export type ValidatedCreateJourneyInput = z.infer<typeof createJourneySchema>;

export const journeyIdParamSchema = z.object({
  id: z.string().uuid({ message: 'Invalid journey ID UUID' }),
});

export const companionParamsSchema = z.object({
  trainNumber: z
    .string()
    .min(1, { message: 'Train number is required' })
    .max(20, { message: 'Train number must not exceed 20 characters' }),
  travelDate: z
    .string()
    .min(1, { message: 'Travel date is required' })
    .refine((d) => DATE_REGEX.test(d.split('T')[0] ?? ''), {
      message: 'Travel date must be in YYYY-MM-DD format',
    }),
});
