import { describe, expect, it } from 'vitest';
import type { Profile } from '@prisma/client';
import { ProfileSerializer } from '../../src/serializers/profile.serializer.js';

const USER_ID = '00000000-0000-4000-8000-000000000001';
const EMAIL = 'alice@example.com';

const mockProfile: Profile = {
  id: USER_ID,
  name: 'Alice',
  bio: 'Frequent train commuter',
  hobbies: 'Reading, Chess',
  college: 'IIT Bombay',
  gender: 'female',
  avatarUrl: 'https://storage.trainmate.local/avatars/alice/avatar.jpg',
  createdAt: new Date('2026-01-01T10:00:00.000Z'),
  updatedAt: new Date('2026-01-02T12:00:00.000Z'),
};

describe('ProfileSerializer — Email Privacy Invariant (§6.12#1)', () => {
  it('toOwnProfile includes account email and all profile fields', () => {
    const serialized = ProfileSerializer.toOwnProfile(mockProfile, EMAIL);

    expect(serialized).toEqual({
      id: USER_ID,
      email: EMAIL,
      name: 'Alice',
      bio: 'Frequent train commuter',
      hobbies: 'Reading, Chess',
      college: 'IIT Bombay',
      gender: 'female',
      avatar_url: 'https://storage.trainmate.local/avatars/alice/avatar.jpg',
      created_at: '2026-01-01T10:00:00.000Z',
      updated_at: '2026-01-02T12:00:00.000Z',
    });
    expect(serialized.email).toBe(EMAIL);
  });

  it('toPublicProfile STRICTLY OMITS the email property', () => {
    const serialized = ProfileSerializer.toPublicProfile(mockProfile);

    expect(serialized).toEqual({
      id: USER_ID,
      name: 'Alice',
      bio: 'Frequent train commuter',
      hobbies: 'Reading, Chess',
      college: 'IIT Bombay',
      gender: 'female',
      avatar_url: 'https://storage.trainmate.local/avatars/alice/avatar.jpg',
      created_at: '2026-01-01T10:00:00.000Z',
      updated_at: '2026-01-02T12:00:00.000Z',
    });

    // Hard security assertions
    expect('email' in serialized).toBe(false);
    expect(Object.keys(serialized)).not.toContain('email');
    expect((serialized as Record<string, unknown>).email).toBeUndefined();
  });

  it('toNameOnly returns { name } and never contains email or other fields', () => {
    const serialized = ProfileSerializer.toNameOnly('Alice');

    expect(serialized).toEqual({ name: 'Alice' });
    expect('email' in serialized).toBe(false);
    expect(Object.keys(serialized)).toEqual(['name']);

    const nullSerialized = ProfileSerializer.toNameOnly(null);
    expect(nullSerialized).toEqual({ name: null });
    expect('email' in nullSerialized).toBe(false);
  });
});
