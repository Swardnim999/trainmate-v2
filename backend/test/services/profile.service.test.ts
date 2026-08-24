import { describe, expect, it, vi } from 'vitest';
import { ProfileService } from '../../src/services/profile.service.js';
import type { ProfileRepository } from '../../src/repositories/profiles.repo.js';
import type { UserRepository } from '../../src/repositories/users.repo.js';
import type { AccessService } from '../../src/services/access.service.js';
import { AppError } from '../../src/utils/errors.js';

const USER_ID = '00000000-0000-4000-8000-000000000001';
const OTHER_ID = '00000000-0000-4000-8000-000000000002';
const USER_EMAIL = 'alice@example.com';

function createMocks() {
  const mockProfilesRepo = {
    findById: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    findOrCreate: vi.fn(),
    deleteById: vi.fn(),
  };

  const mockUsersRepo = {
    findById: vi.fn(),
    findByEmail: vi.fn(),
    create: vi.fn(),
    confirmEmail: vi.fn(),
  };

  const mockAccessService = {
    isBlocked: vi.fn(),
    getSymmetricBlockedUserIds: vi.fn(),
    canViewProfile: vi.fn(),
    hasSharedJourney: vi.fn(),
    hasAcceptedRequest: vi.fn(),
    hasSharedConversation: vi.fn(),
  };

  const service = new ProfileService({
    profiles: mockProfilesRepo as unknown as ProfileRepository,
    users: mockUsersRepo as unknown as UserRepository,
    access: mockAccessService as unknown as AccessService,
  });

  return { mockProfilesRepo, mockUsersRepo, mockAccessService, service };
}

describe('ProfileService', () => {
  describe('getOwnProfile', () => {
    it('returns own profile with account email', async () => {
      const { mockProfilesRepo, mockUsersRepo, service } = createMocks();
      mockUsersRepo.findById.mockResolvedValue({ id: USER_ID, email: USER_EMAIL });
      mockProfilesRepo.findOrCreate.mockResolvedValue({
        id: USER_ID,
        name: 'Alice',
        bio: 'Bio',
        hobbies: 'Chess',
        college: 'IIT',
        gender: 'female',
        avatarUrl: 'https://avatar.png',
        createdAt: new Date('2026-01-01T00:00:00Z'),
        updatedAt: new Date('2026-01-02T00:00:00Z'),
      });

      const result = await service.getOwnProfile(USER_ID);

      expect(result).toEqual({
        id: USER_ID,
        email: USER_EMAIL,
        name: 'Alice',
        bio: 'Bio',
        hobbies: 'Chess',
        college: 'IIT',
        gender: 'female',
        avatar_url: 'https://avatar.png',
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-02T00:00:00.000Z',
      });
      expect(mockUsersRepo.findById).toHaveBeenCalledWith(USER_ID);
      expect(mockProfilesRepo.findOrCreate).toHaveBeenCalledWith(USER_ID);
    });

    it('throws 404 USER_NOT_FOUND if user does not exist', async () => {
      const { mockUsersRepo, service } = createMocks();
      mockUsersRepo.findById.mockResolvedValue(null);

      await expect(service.getOwnProfile(USER_ID)).rejects.toThrow(
        new AppError(404, 'USER_NOT_FOUND', 'User not found'),
      );
    });
  });

  describe('updateOwnProfile', () => {
    it('trims fields and normalizes prefer-not-to-say to prefer_not_to_say', async () => {
      const { mockProfilesRepo, mockUsersRepo, service } = createMocks();
      mockUsersRepo.findById.mockResolvedValue({ id: USER_ID, email: USER_EMAIL });
      mockProfilesRepo.findOrCreate.mockResolvedValue({ id: USER_ID });
      mockProfilesRepo.update.mockResolvedValue({
        id: USER_ID,
        name: 'Alice',
        bio: 'My Bio',
        hobbies: 'Chess, Code',
        college: 'IIT Delhi',
        gender: 'prefer_not_to_say',
        avatarUrl: 'https://avatar.png',
        createdAt: new Date('2026-01-01T00:00:00Z'),
        updatedAt: new Date('2026-01-02T00:00:00Z'),
      });

      const result = await service.updateOwnProfile(USER_ID, {
        name: '  Alice  ',
        bio: '  My Bio  ',
        hobbies: '  Chess, Code  ',
        college: '  IIT Delhi  ',
        gender: 'prefer-not-to-say',
        avatar_url: '  https://avatar.png  ',
      });

      expect(mockProfilesRepo.update).toHaveBeenCalledWith(USER_ID, {
        name: 'Alice',
        bio: 'My Bio',
        hobbies: 'Chess, Code',
        college: 'IIT Delhi',
        gender: 'prefer_not_to_say',
        avatarUrl: 'https://avatar.png',
      });
      expect(result.gender).toBe('prefer_not_to_say');
      expect(result.email).toBe(USER_EMAIL);
    });

    it('converts empty string fields to null', async () => {
      const { mockProfilesRepo, mockUsersRepo, service } = createMocks();
      mockUsersRepo.findById.mockResolvedValue({ id: USER_ID, email: USER_EMAIL });
      mockProfilesRepo.findOrCreate.mockResolvedValue({ id: USER_ID });
      mockProfilesRepo.update.mockResolvedValue({
        id: USER_ID,
        name: null,
        bio: null,
        hobbies: null,
        college: null,
        gender: null,
        avatarUrl: null,
        createdAt: new Date('2026-01-01T00:00:00Z'),
        updatedAt: new Date('2026-01-02T00:00:00Z'),
      });

      await service.updateOwnProfile(USER_ID, {
        name: '   ',
        bio: '',
        hobbies: '   ',
        college: '',
        gender: '',
        avatar_url: '',
      });

      expect(mockProfilesRepo.update).toHaveBeenCalledWith(USER_ID, {
        name: null,
        bio: null,
        hobbies: null,
        college: null,
        gender: null,
        avatarUrl: null,
      });
    });

    it('throws 404 USER_NOT_FOUND if user does not exist', async () => {
      const { mockUsersRepo, service } = createMocks();
      mockUsersRepo.findById.mockResolvedValue(null);

      await expect(service.updateOwnProfile(USER_ID, { name: 'New' })).rejects.toThrow(
        new AppError(404, 'USER_NOT_FOUND', 'User not found'),
      );
    });
  });

  describe('getPublicProfile', () => {
    it('returns public profile without email when authorized', async () => {
      const { mockProfilesRepo, mockAccessService, service } = createMocks();
      mockAccessService.canViewProfile.mockResolvedValue(true);
      mockProfilesRepo.findById.mockResolvedValue({
        id: OTHER_ID,
        name: 'Bob',
        bio: 'Bob Bio',
        hobbies: 'Music',
        college: 'BITS',
        gender: 'male',
        avatarUrl: 'https://avatar2.png',
        createdAt: new Date('2026-01-01T00:00:00Z'),
        updatedAt: new Date('2026-01-02T00:00:00Z'),
      });

      const result = await service.getPublicProfile(USER_ID, OTHER_ID);

      expect(result).toEqual({
        id: OTHER_ID,
        name: 'Bob',
        bio: 'Bob Bio',
        hobbies: 'Music',
        college: 'BITS',
        gender: 'male',
        avatar_url: 'https://avatar2.png',
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-02T00:00:00.000Z',
      });
      // Ensure email is strictly not in output
      expect('email' in result).toBe(false);
      expect((result as Record<string, unknown>).email).toBeUndefined();
    });

    it('throws 404 USER_NOT_FOUND when canViewProfile returns false (404 masking)', async () => {
      const { mockAccessService, service } = createMocks();
      mockAccessService.canViewProfile.mockResolvedValue(false);

      await expect(service.getPublicProfile(USER_ID, OTHER_ID)).rejects.toThrow(
        new AppError(404, 'USER_NOT_FOUND', 'User not found'),
      );
    });

    it('throws 404 USER_NOT_FOUND when target profile does not exist', async () => {
      const { mockProfilesRepo, mockAccessService, service } = createMocks();
      mockAccessService.canViewProfile.mockResolvedValue(true);
      mockProfilesRepo.findById.mockResolvedValue(null);

      await expect(service.getPublicProfile(USER_ID, OTHER_ID)).rejects.toThrow(
        new AppError(404, 'USER_NOT_FOUND', 'User not found'),
      );
    });
  });

  describe('getProfileName', () => {
    it('returns { name } when authorized', async () => {
      const { mockProfilesRepo, mockAccessService, service } = createMocks();
      mockAccessService.canViewProfile.mockResolvedValue(true);
      mockProfilesRepo.findById.mockResolvedValue({
        id: OTHER_ID,
        name: 'Bob',
      });

      const result = await service.getProfileName(USER_ID, OTHER_ID);

      expect(result).toEqual({ name: 'Bob' });
    });

    it('returns { name: null } when unauthorized or blocked', async () => {
      const { mockAccessService, service } = createMocks();
      mockAccessService.canViewProfile.mockResolvedValue(false);

      const result = await service.getProfileName(USER_ID, OTHER_ID);

      expect(result).toEqual({ name: null });
    });
  });

  describe('bootstrapProfile', () => {
    it('delegates to profiles.findOrCreate', async () => {
      const { mockProfilesRepo, service } = createMocks();
      mockProfilesRepo.findOrCreate.mockResolvedValue({ id: USER_ID });

      await service.bootstrapProfile(USER_ID);

      expect(mockProfilesRepo.findOrCreate).toHaveBeenCalledWith(USER_ID);
    });
  });
});
