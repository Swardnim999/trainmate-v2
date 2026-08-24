import { z } from 'zod';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Zod schema for conversation creation (POST /conversations).
 * Accepts both camelCase and snake_case properties from clients.
 */
export const createConversationSchema = z
  .object({
    participants: z
      .array(z.string().regex(UUID_REGEX, 'Participant must be a valid UUID'))
      .optional(),
    participantIds: z
      .array(z.string().regex(UUID_REGEX, 'Participant must be a valid UUID'))
      .optional(),
    participant_names: z.record(z.string(), z.string().max(100)).optional(),
    participantNames: z.record(z.string(), z.string().max(100)).optional(),
    train_number: z
      .string()
      .trim()
      .max(20, 'train_number must be at most 20 characters')
      .optional()
      .nullable(),
    trainNumber: z
      .string()
      .trim()
      .max(20, 'trainNumber must be at most 20 characters')
      .optional()
      .nullable(),
    travel_date: z.string().optional().nullable(),
    travelDate: z.string().optional().nullable(),
    last_message: z.string().max(255).optional().nullable(),
    last_message_time: z.string().optional().nullable(),
  })
  .superRefine((data, ctx) => {
    const parts = data.participants ?? data.participantIds;
    if (!parts || parts.length !== 2) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['participants'],
        message: 'Conversation must have exactly 2 participants',
      });
      return;
    }
    if (parts[0] === parts[1]) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['participants'],
        message: 'Participants must be distinct users',
      });
    }
    const rawDate = data.travel_date ?? data.travelDate;
    if (rawDate) {
      const cleanDate = rawDate.split('T')[0] ?? '';
      if (!DATE_REGEX.test(cleanDate)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['travelDate'],
          message: 'travelDate must be formatted as YYYY-MM-DD',
        });
      }
    }
  })
  .transform((data) => {
    const parts = (data.participants ?? data.participantIds)!;
    const names = data.participant_names ?? data.participantNames ?? {};
    const rawDate = data.travel_date ?? data.travelDate;
    const cleanDate = rawDate ? rawDate.split('T')[0] : null;

    return {
      participants: parts,
      participantNames: names,
      trainNumber: (data.train_number ?? data.trainNumber)?.trim() || null,
      travelDate: cleanDate,
    };
  });

/**
 * Zod schema for URL parameter validating conversation ID.
 */
export const conversationIdParamSchema = z.object({
  id: z.string().regex(UUID_REGEX, 'Conversation ID must be a valid UUID'),
});

export type CreateConversationInput = z.infer<typeof createConversationSchema>;
