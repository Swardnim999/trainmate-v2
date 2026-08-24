import { z } from 'zod';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Zod schema for sending a companion request (POST /requests).
 * Accepts both camelCase and snake_case properties from clients.
 */
export const createRequestSchema = z
  .object({
    toUserId: z.string().regex(UUID_REGEX, 'toUserId must be a valid UUID').optional(),
    to_user_id: z.string().regex(UUID_REGEX, 'to_user_id must be a valid UUID').optional(),
    fromName: z
      .string()
      .trim()
      .max(100, 'fromName must be at most 100 characters')
      .optional()
      .nullable(),
    from_name: z
      .string()
      .trim()
      .max(100, 'from_name must be at most 100 characters')
      .optional()
      .nullable(),
    toName: z
      .string()
      .trim()
      .max(100, 'toName must be at most 100 characters')
      .optional()
      .nullable(),
    to_name: z
      .string()
      .trim()
      .max(100, 'to_name must be at most 100 characters')
      .optional()
      .nullable(),
    trainNumber: z
      .string()
      .trim()
      .max(20, 'trainNumber must be at most 20 characters')
      .optional()
      .nullable(),
    train_number: z
      .string()
      .trim()
      .max(20, 'train_number must be at most 20 characters')
      .optional()
      .nullable(),
    travelDate: z.string().min(1, 'Travel date is required').optional(),
    travel_date: z.string().min(1, 'travel_date is required').optional(),
    boardingStation: z
      .string()
      .trim()
      .max(200, 'boardingStation must be at most 200 characters')
      .optional()
      .nullable(),
    boarding_station: z
      .string()
      .trim()
      .max(200, 'boarding_station must be at most 200 characters')
      .optional()
      .nullable(),
    destinationStation: z
      .string()
      .trim()
      .max(200, 'destinationStation must be at most 200 characters')
      .optional()
      .nullable(),
    destination_station: z
      .string()
      .trim()
      .max(200, 'destination_station must be at most 200 characters')
      .optional()
      .nullable(),
    status: z.literal('pending').optional(),
  })
  .superRefine((data, ctx) => {
    const toId = data.toUserId ?? data.to_user_id;
    if (!toId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['toUserId'],
        message: 'Recipient toUserId is required',
      });
    }

    const rawDate = data.travelDate ?? data.travel_date;
    if (!rawDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['travelDate'],
        message: 'Travel date is required',
      });
      return;
    }

    const cleanDate = rawDate.split('T')[0] ?? '';
    if (!DATE_REGEX.test(cleanDate)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['travelDate'],
        message: 'travelDate must be formatted as YYYY-MM-DD',
      });
    }
  })
  .transform((data) => {
    const targetToUserId = (data.toUserId ?? data.to_user_id)!;
    const rawDate = (data.travelDate ?? data.travel_date)!;
    const cleanDate = rawDate.split('T')[0] ?? '';

    return {
      toUserId: targetToUserId,
      fromName: data.fromName ?? data.from_name ?? null,
      toName: data.toName ?? data.to_name ?? null,
      trainNumber: (data.trainNumber ?? data.train_number)?.trim() || null,
      travelDate: cleanDate,
      boardingStation: (data.boardingStation ?? data.boarding_station)?.trim() || null,
      destinationStation: (data.destinationStation ?? data.destination_station)?.trim() || null,
    };
  });

/**
 * Zod schema for updating request status (PATCH /requests/:id).
 * Restricts transitions strictly to 'accepted' or 'rejected'.
 */
export const updateRequestStatusSchema = z.object({
  status: z.enum(['accepted', 'rejected'], {
    errorMap: () => ({ message: "Status must be either 'accepted' or 'rejected'" }),
  }),
});

/**
 * Zod schema for URL parameter validating request ID.
 */
export const requestIdParamSchema = z.object({
  id: z.string().regex(UUID_REGEX, 'Request ID must be a valid UUID'),
});

/**
 * Zod schema for listing requests query parameters (GET /requests/me?type=).
 */
export const listRequestsQuerySchema = z.object({
  type: z.enum(['all', 'sent', 'received']).default('all'),
});

/**
 * Zod schema for expired pending requests cleanup (POST /requests/cleanup-expired).
 */
export const cleanupExpiredRequestsSchema = z
  .object({
    cutoffDate: z.string().regex(DATE_REGEX, 'cutoffDate must be YYYY-MM-DD').optional(),
    cutoff_date: z.string().regex(DATE_REGEX, 'cutoff_date must be YYYY-MM-DD').optional(),
  })
  .transform((data) => ({
    cutoffDate: data.cutoffDate ?? data.cutoff_date,
  }));

export type CreateRequestInput = z.infer<typeof createRequestSchema>;
export type UpdateRequestStatusInput = z.infer<typeof updateRequestStatusSchema>;
export type ListRequestsQueryInput = z.infer<typeof listRequestsQuerySchema>;
export type CleanupExpiredRequestsInput = z.infer<typeof cleanupExpiredRequestsSchema>;
