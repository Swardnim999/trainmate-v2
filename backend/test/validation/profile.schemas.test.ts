import { describe, expect, it } from 'vitest';
import { updateProfileSchema, profileParamsSchema } from '../../src/validation/profile.schemas.js';

describe('Profile Validation Schemas', () => {
  describe('updateProfileSchema', () => {
    it('accepts valid full payload', () => {
      const valid = {
        name: 'Alex Smith',
        bio: 'Hello world',
        hobbies: 'Chess, Reading',
        college: 'IIT Bombay',
        gender: 'male',
        avatar_url: 'https://example.com/avatar.jpg',
      };
      const result = updateProfileSchema.safeParse(valid);
      expect(result.success).toBe(true);
    });

    it('accepts both prefer_not_to_say and prefer-not-to-say', () => {
      expect(updateProfileSchema.safeParse({ gender: 'prefer_not_to_say' }).success).toBe(true);
      expect(updateProfileSchema.safeParse({ gender: 'prefer-not-to-say' }).success).toBe(true);
      expect(updateProfileSchema.safeParse({ gender: 'invalid' }).success).toBe(false);
    });

    it('enforces name length <= 100', () => {
      expect(updateProfileSchema.safeParse({ name: 'a'.repeat(100) }).success).toBe(true);
      expect(updateProfileSchema.safeParse({ name: 'a'.repeat(101) }).success).toBe(false);
    });

    it('enforces bio length <= 500', () => {
      expect(updateProfileSchema.safeParse({ bio: 'a'.repeat(500) }).success).toBe(true);
      expect(updateProfileSchema.safeParse({ bio: 'a'.repeat(501) }).success).toBe(false);
    });

    it('enforces hobbies length <= 200', () => {
      expect(updateProfileSchema.safeParse({ hobbies: 'a'.repeat(200) }).success).toBe(true);
      expect(updateProfileSchema.safeParse({ hobbies: 'a'.repeat(201) }).success).toBe(false);
    });

    it('enforces college length <= 200', () => {
      expect(updateProfileSchema.safeParse({ college: 'a'.repeat(200) }).success).toBe(true);
      expect(updateProfileSchema.safeParse({ college: 'a'.repeat(201) }).success).toBe(false);
    });

    it('enforces avatar_url length <= 2000', () => {
      expect(
        updateProfileSchema.safeParse({ avatar_url: 'https://a.com/' + 'a'.repeat(1980) }).success,
      ).toBe(true);
      expect(
        updateProfileSchema.safeParse({ avatar_url: 'https://a.com/' + 'a'.repeat(2000) }).success,
      ).toBe(false);
    });

    it('accepts null/undefined for all fields', () => {
      expect(updateProfileSchema.safeParse({}).success).toBe(true);
      expect(
        updateProfileSchema.safeParse({
          name: null,
          bio: null,
          hobbies: null,
          college: null,
          gender: null,
          avatar_url: null,
        }).success,
      ).toBe(true);
    });
  });

  describe('profileParamsSchema', () => {
    it('accepts valid UUID', () => {
      expect(
        profileParamsSchema.safeParse({ userId: '00000000-0000-4000-8000-000000000001' }).success,
      ).toBe(true);
    });

    it('rejects malformed UUID', () => {
      expect(profileParamsSchema.safeParse({ userId: 'not-a-uuid' }).success).toBe(false);
      expect(profileParamsSchema.safeParse({ userId: '' }).success).toBe(false);
    });
  });
});
