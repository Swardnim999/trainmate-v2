import { z } from 'zod';

// Journey form validation schema
export const journeySchema = z.object({
  name: z.string()
    .trim()
    .min(1, 'Name is required')
    .max(100, 'Name must be less than 100 characters'),
  trainNumber: z.string()
    .trim()
    .min(1, 'Train number is required')
    .max(20, 'Train number must be less than 20 characters')
    .regex(/^[A-Za-z0-9\s-]+$/, 'Train number can only contain letters, numbers, spaces, and hyphens'),
  travelDate: z.string()
    .min(1, 'Travel date is required')
    .refine((date) => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      return new Date(date) >= today;
    }, 'Travel date cannot be in the past'),
  coach: z.string().max(10).optional().or(z.literal('')),
  boardingStation: z.string()
    .trim()
    .min(1, 'Boarding station is required')
    .max(100, 'Station name must be less than 100 characters'),
  destinationStation: z.string()
    .trim()
    .min(1, 'Destination station is required')
    .max(100, 'Station name must be less than 100 characters'),
  college: z.string()
    .trim()
    .max(200, 'College/Organization must be less than 200 characters')
    .optional()
    .or(z.literal('')),
  gender: z.enum(['male', 'female', 'other', 'prefer-not-to-say', ''])
    .optional()
    .or(z.literal(''))
});

// Message validation schema
export const messageSchema = z.object({
  text: z.string()
    .trim()
    .min(1, 'Message cannot be empty')
    .max(2000, 'Message must be less than 2000 characters')
});

// Request validation schema  
export const requestStatusSchema = z.enum(['pending', 'accepted', 'rejected']);

export type JourneyFormData = z.infer<typeof journeySchema>;
export type MessageFormData = z.infer<typeof messageSchema>;
