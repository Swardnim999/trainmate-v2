import { describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
import { ProfileController } from '../../src/controllers/profile.controller.js';
import type { ProfileService } from '../../src/services/profile.service.js';

const USER_ID = '00000000-0000-4000-8000-000000000001';
const OTHER_ID = '00000000-0000-4000-8000-000000000002';

function createMockService() {
  return {
    getOwnProfile: vi.fn(),
    updateOwnProfile: vi.fn(),
    getPublicProfile: vi.fn(),
    getProfileName: vi.fn(),
    bootstrapProfile: vi.fn(),
  };
}

function createMockRes() {
  const res: Partial<Response> = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res as Response & { status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn> };
}

describe('ProfileController', () => {
  it('getOwnProfile extracts req.user.id and returns 200 with result', async () => {
    const service = createMockService();
    const controller = new ProfileController({
      profileService: service as unknown as ProfileService,
    });
    const req = {
      user: { id: USER_ID },
    } as unknown as Request;
    const res = createMockRes();
    const mockData = { id: USER_ID, email: 'a@b.com' };
    service.getOwnProfile.mockResolvedValue(mockData);

    await controller.getOwnProfile(req, res);

    expect(service.getOwnProfile).toHaveBeenCalledWith(USER_ID);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(mockData);
  });

  it('updateOwnProfile extracts req.user.id and validated body', async () => {
    const service = createMockService();
    const controller = new ProfileController({
      profileService: service as unknown as ProfileService,
    });
    const updateInput = { name: 'Updated' };
    const req = {
      user: { id: USER_ID },
      validated: { body: updateInput },
    } as unknown as Request;
    const res = createMockRes();
    const mockData = { id: USER_ID, name: 'Updated', email: 'a@b.com' };
    service.updateOwnProfile.mockResolvedValue(mockData);

    await controller.updateOwnProfile(req, res);

    expect(service.updateOwnProfile).toHaveBeenCalledWith(USER_ID, updateInput);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(mockData);
  });

  it('getPublicProfile extracts requester id and params.userId', async () => {
    const service = createMockService();
    const controller = new ProfileController({
      profileService: service as unknown as ProfileService,
    });
    const req = {
      user: { id: USER_ID },
      validated: { params: { userId: OTHER_ID } },
    } as unknown as Request;
    const res = createMockRes();
    const mockData = { id: OTHER_ID, name: 'Other' };
    service.getPublicProfile.mockResolvedValue(mockData);

    await controller.getPublicProfile(req, res);

    expect(service.getPublicProfile).toHaveBeenCalledWith(USER_ID, OTHER_ID);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(mockData);
  });

  it('getProfileName extracts requester id and params.userId', async () => {
    const service = createMockService();
    const controller = new ProfileController({
      profileService: service as unknown as ProfileService,
    });
    const req = {
      user: { id: USER_ID },
      validated: { params: { userId: OTHER_ID } },
    } as unknown as Request;
    const res = createMockRes();
    const mockData = { name: 'Other' };
    service.getProfileName.mockResolvedValue(mockData);

    await controller.getProfileName(req, res);

    expect(service.getProfileName).toHaveBeenCalledWith(USER_ID, OTHER_ID);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(mockData);
  });
});
