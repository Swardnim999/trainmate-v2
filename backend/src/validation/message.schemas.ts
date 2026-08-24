import { z } from 'zod';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024; // 10 MB

const ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
];

const DISALLOWED_MIME_TYPES = [
  'image/svg+xml',
  'text/html',
  'application/xhtml+xml',
  'application/javascript',
  'text/javascript',
];

/**
 * Zod schema for sending a message (POST /conversations/:id/messages).
 * Supports text-only, attachment-only (empty text), or text+attachment.
 */
export const sendMessageSchema = z
  .object({
    text: z.string().optional().default(''),
    attachment_url: z.string().url().optional().nullable(),
    attachmentUrl: z.string().url().optional().nullable(),
    attachment_type: z.string().optional().nullable(),
    attachmentType: z.string().optional().nullable(),
    attachment_name: z.string().max(255).optional().nullable(),
    attachmentName: z.string().max(255).optional().nullable(),
    attachment_size: z.number().int().nonnegative().optional().nullable(),
    attachmentSize: z.number().int().nonnegative().optional().nullable(),
  })
  .superRefine((data, ctx) => {
    const trimmedText = (data.text ?? '').trim();
    const url = data.attachment_url ?? data.attachmentUrl;
    const type = (data.attachment_type ?? data.attachmentType)?.toLowerCase().trim();
    const size = data.attachment_size ?? data.attachmentSize;

    if (!url && trimmedText.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['text'],
        message: 'Message text cannot be empty when no attachment is provided',
      });
      return;
    }

    if (trimmedText.length > 2000) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['text'],
        message: 'Message text must be at most 2000 characters',
      });
    }

    if (url) {
      if (type) {
        if (
          DISALLOWED_MIME_TYPES.includes(type) ||
          (!ALLOWED_MIME_TYPES.includes(type) && !type.startsWith('image/'))
        ) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['attachmentType'],
            message:
              'Unsupported attachment type. Allowed: Images (non-SVG), PDF, Word, Plain Text',
          });
        }
      }
      if (size !== undefined && size !== null && size > MAX_ATTACHMENT_BYTES) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['attachmentSize'],
          message: 'Attachment size exceeds maximum limit of 10 MB',
        });
      }
    }
  })
  .transform((data) => ({
    text: (data.text ?? '').trim(),
    attachmentUrl: data.attachment_url ?? data.attachmentUrl ?? null,
    attachmentType: data.attachment_type ?? data.attachmentType ?? null,
    attachmentName: data.attachment_name ?? data.attachmentName ?? null,
    attachmentSize: data.attachment_size ?? data.attachmentSize ?? null,
  }));

export const lastReadParamSchema = z.object({
  id: z.string().regex(UUID_REGEX, 'Conversation ID must be a valid UUID'),
  userId: z.string().regex(UUID_REGEX, 'User ID must be a valid UUID'),
});

export const listMessagesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional().default(100),
  before: z.string().datetime({ offset: true }).optional(),
});

export type SendMessageInput = z.infer<typeof sendMessageSchema>;
export type ListMessagesQueryInput = z.infer<typeof listMessagesQuerySchema>;
