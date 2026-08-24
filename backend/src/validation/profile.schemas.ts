import { z } from 'zod';

export const updateProfileSchema = z.object({
  name: z
    .string()
    .max(100, { message: 'Name must not exceed 100 characters' })
    .optional()
    .nullable(),
  bio: z.string().max(500, { message: 'Bio must not exceed 500 characters' }).optional().nullable(),
  hobbies: z
    .string()
    .max(200, { message: 'Hobbies must not exceed 200 characters' })
    .optional()
    .nullable(),
  college: z
    .string()
    .max(200, { message: 'College must not exceed 200 characters' })
    .optional()
    .nullable(),
  gender: z
    .enum(['male', 'female', 'other', 'prefer_not_to_say', 'prefer-not-to-say', ''], {
      errorMap: () => ({ message: 'Invalid gender' }),
    })
    .optional()
    .nullable(),
  avatar_url: z
    .string()
    .max(2000, { message: 'Avatar URL must not exceed 2000 characters' })
    .optional()
    .nullable(),
});

export const profileParamsSchema = z.object({
  userId: z.string().uuid({ message: 'Invalid userId UUID' }),
});
