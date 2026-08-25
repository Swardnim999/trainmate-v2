import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import type { Express } from 'express';
import { JwtService } from '../../src/utils/jwt.js';
import { env } from '../../src/config/env.js';

const USER1 = '00000000-0000-4000-8000-000000000001';
const USER2 = '00000000-0000-4000-8000-000000000002';
const CONV1 = '00000000-0000-4000-8000-000000000010';
const REQ1 = '00000000-0000-4000-8000-000000000020';
const JOURNEY1 = '00000000-0000-4000-8000-000000000030';
const MSG1 = '00000000-0000-4000-8000-000000000040';

const jwt = new JwtService(env.JWT_SECRET);
async function userToken(id = USER1, email = 'u1@example.com'): Promise<string> {
  return jwt.sign({ id, email }, new Date(), 900);
}

describe('Frontend Adapter 60 Call Sites Contract Suite', () => {
  let fakeAuthService: Record<string, ReturnType<typeof vi.fn>>;
  let fakeProfileService: Record<string, ReturnType<typeof vi.fn>>;
  let fakeJourneyService: Record<string, ReturnType<typeof vi.fn>>;
  let fakeTrainService: Record<string, ReturnType<typeof vi.fn>>;
  let fakeRequestService: Record<string, ReturnType<typeof vi.fn>>;
  let fakeConversationService: Record<string, ReturnType<typeof vi.fn>>;
  let fakeMessageService: Record<string, ReturnType<typeof vi.fn>>;
  let fakeModerationService: Record<string, ReturnType<typeof vi.fn>>;
  let app: Express;
  let token: string;

  beforeEach(async () => {
    vi.restoreAllMocks();
    token = await userToken(USER1);

    fakeAuthService = {
      login: vi.fn().mockResolvedValue({
        accessToken: 'access-123',
        refreshToken: 'refresh-123',
        user: { id: USER1, email: 'u1@example.com' },
      }),
      register: vi.fn().mockResolvedValue({
        accessToken: 'access-123',
        refreshToken: 'refresh-123',
        user: { id: USER1, email: 'u1@example.com' },
      }),
      logout: vi.fn().mockResolvedValue(undefined),
      refresh: vi.fn().mockResolvedValue({
        accessToken: 'access-456',
        refreshToken: 'refresh-456',
        user: { id: USER1, email: 'u1@example.com' },
      }),
      requestPasswordReset: vi.fn().mockResolvedValue(undefined),
      resetPassword: vi.fn().mockResolvedValue(undefined),
      getSession: vi.fn().mockResolvedValue({ user: { id: USER1, email: 'u1@example.com' } }),
      getUserById: vi.fn().mockResolvedValue({ id: USER1, email: 'u1@example.com' }),
      resolveUserIdFromRefreshToken: vi.fn().mockResolvedValue(USER1),
    };

    fakeProfileService = {
      getOwnProfile: vi.fn().mockResolvedValue({
        id: USER1,
        email: 'u1@example.com',
        name: 'User One',
        bio: 'Bio',
        hobbies: 'Chess',
        college: 'IIT Delhi',
        gender: 'male',
        avatar_url: 'https://avatar.png',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }),
      updateOwnProfile: vi.fn().mockResolvedValue({
        id: USER1,
        email: 'u1@example.com',
        name: 'User One Updated',
        bio: 'Bio Updated',
        hobbies: 'Chess, Coding',
        college: 'IIT Delhi',
        gender: 'male',
        avatar_url: 'https://avatar2.png',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }),
      getPublicProfile: vi.fn().mockResolvedValue({
        id: USER2,
        name: 'User Two',
        bio: 'Bio 2',
        hobbies: 'Reading',
        college: 'IIT Bombay',
        gender: 'female',
        avatar_url: 'https://avatar2.png',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }),
      getProfileName: vi.fn().mockResolvedValue({ name: 'User Two' }),
      bootstrapProfile: vi.fn().mockResolvedValue(undefined),
    };

    fakeJourneyService = {
      listUserJourneys: vi.fn().mockResolvedValue([
        {
          id: JOURNEY1,
          userId: USER1,
          userName: 'User One',
          trainNumber: '12951',
          trainName: 'Mumbai Rajdhani',
          travelDate: new Date('2026-09-01'),
          coach: '3A',
          boardingStation: 'MMCT',
          destinationStation: 'NDLS',
          college: 'IIT Delhi',
          gender: 'male',
          createdAt: new Date(),
        },
      ]),
      createJourney: vi.fn().mockResolvedValue({
        id: JOURNEY1,
        userId: USER1,
        userName: 'User One',
        trainNumber: '12951',
        trainName: 'Mumbai Rajdhani',
        travelDate: new Date('2026-09-01'),
        coach: '3A',
        boardingStation: 'MMCT',
        destinationStation: 'NDLS',
        college: 'IIT Delhi',
        gender: 'male',
        createdAt: new Date(),
      }),
      deleteJourney: vi.fn().mockResolvedValue(undefined),
      findCompanions: vi.fn().mockResolvedValue([
        {
          id: '00000000-0000-4000-8000-000000000031',
          userId: USER2,
          userName: 'User Two',
          trainNumber: '12951',
          trainName: 'Mumbai Rajdhani',
          travelDate: new Date('2026-09-01'),
          coach: '3A',
          boardingStation: 'MMCT',
          destinationStation: 'NDLS',
          college: 'IIT Bombay',
          gender: 'female',
          createdAt: new Date(),
        },
      ]),
    };

    fakeTrainService = {
      search: vi.fn().mockResolvedValue([
        { trainNumber: '12951', trainName: 'Mumbai Rajdhani' },
      ]),
      logUnverifiedTrain: vi.fn().mockResolvedValue({
        id: 'uv-1',
        trainNumber: '99999',
        trainName: '99999 Special',
        submittedBy: USER1,
        createdAt: new Date(),
      }),
    };

    fakeRequestService = {
      sendRequest: vi.fn().mockResolvedValue({
        id: REQ1,
        fromUserId: USER1,
        toUserId: USER2,
        fromName: 'User One',
        toName: 'User Two',
        trainNumber: '12951',
        travelDate: new Date('2026-09-01'),
        boardingStation: 'MMCT',
        destinationStation: 'NDLS',
        status: 'pending',
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
      listUserRequests: vi.fn().mockResolvedValue([
        {
          id: REQ1,
          fromUserId: USER1,
          toUserId: USER2,
          fromName: 'User One',
          toName: 'User Two',
          trainNumber: '12951',
          travelDate: new Date('2026-09-01'),
          boardingStation: 'MMCT',
          destinationStation: 'NDLS',
          status: 'pending',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]),
      listAcceptedRequests: vi.fn().mockResolvedValue([
        {
          id: REQ1,
          fromUserId: USER1,
          toUserId: USER2,
          fromName: 'User One',
          toName: 'User Two',
          trainNumber: '12951',
          travelDate: new Date('2026-09-01'),
          boardingStation: 'MMCT',
          destinationStation: 'NDLS',
          status: 'accepted',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]),
      getIncomingPendingCount: vi.fn().mockResolvedValue(1),
      updateStatus: vi.fn().mockResolvedValue({
        id: REQ1,
        fromUserId: USER2,
        toUserId: USER1,
        fromName: 'User Two',
        toName: 'User One',
        trainNumber: '12951',
        travelDate: new Date('2026-09-01'),
        status: 'accepted',
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
      cancelRequest: vi.fn().mockResolvedValue(undefined),
      cleanupExpiredRequests: vi.fn().mockResolvedValue(2),
    };

    fakeConversationService = {
      listConversations: vi.fn().mockResolvedValue([
        {
          id: CONV1,
          participants: [USER1, USER2],
          participantNames: { [USER1]: 'User One', [USER2]: 'User Two' },
          trainNumber: '12951',
          travelDate: new Date('2026-09-01'),
          lastMessage: 'Hello',
          lastMessageTime: new Date(),
          deletedFor: [],
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]),
      createConversation: vi.fn().mockResolvedValue({
        id: CONV1,
        participants: [USER1, USER2],
        participantNames: { [USER1]: 'User One', [USER2]: 'User Two' },
        trainNumber: '12951',
        travelDate: new Date('2026-09-01'),
        lastMessage: null,
        lastMessageTime: null,
        deletedFor: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
      getConversation: vi.fn().mockResolvedValue({
        id: CONV1,
        participants: [USER1, USER2],
        participantNames: { [USER1]: 'User One', [USER2]: 'User Two' },
        trainNumber: '12951',
        travelDate: new Date('2026-09-01'),
        lastMessage: null,
        lastMessageTime: null,
        deletedFor: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
      softDeleteForUser: vi.fn().mockResolvedValue(undefined),
    };

    fakeMessageService = {
      listMessages: vi.fn().mockResolvedValue([
        {
          id: MSG1,
          conversationId: CONV1,
          senderId: USER1,
          senderName: 'User One',
          text: 'Hello',
          attachmentUrl: null,
          attachmentType: null,
          attachmentName: null,
          attachmentSize: null,
          createdAt: new Date(),
        },
      ]),
      sendMessage: vi.fn().mockResolvedValue({
        id: MSG1,
        conversationId: CONV1,
        senderId: USER1,
        senderName: 'User One',
        text: 'Hi there',
        attachmentUrl: null,
        attachmentType: null,
        attachmentName: null,
        attachmentSize: null,
        createdAt: new Date(),
      }),
      getUnreadCount: vi.fn().mockResolvedValue(3),
      getLastRead: vi.fn().mockResolvedValue({
        userId: USER2,
        conversationId: CONV1,
        timestamp: new Date(),
      }),
      markAsRead: vi.fn().mockResolvedValue({
        userId: USER1,
        conversationId: CONV1,
        timestamp: new Date(),
      }),
    };

    fakeModerationService = {
      getBlockedUsers: vi.fn().mockResolvedValue([
        { blocked_id: USER2, created_at: new Date().toISOString() },
      ]),
      blockUser: vi.fn().mockResolvedValue({
        blocker_id: USER1,
        blocked_id: USER2,
        created_at: new Date().toISOString(),
      }),
      unblockUser: vi.fn().mockResolvedValue(undefined),
      reportUser: vi.fn().mockResolvedValue({
        id: 'rep-1',
        reporter_id: USER1,
        reported_id: USER2,
        reason: 'Spamming',
        created_at: new Date().toISOString(),
      }),
    };

    app = createApp({
      auth: fakeAuthService as any,
      profileService: fakeProfileService as any,
      journeyService: fakeJourneyService as any,
      trainService: fakeTrainService as any,
      requestService: fakeRequestService as any,
      conversationService: fakeConversationService as any,
      messageService: fakeMessageService as any,
      moderation: fakeModerationService as any,
    });
  });

  describe('Auth & Session Contract Calls (#1 to #7)', () => {
    it('#1: POST /auth/login returns session tokens', async () => {
      const res = await request(app)
        .post('/auth/login')
        .send({ email: 'u1@example.com', password: 'password123' });
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('accessToken');
      expect(res.body).toHaveProperty('user');
    });

    it('#2: POST /auth/register creates user & returns tokens', async () => {
      const res = await request(app)
        .post('/auth/register')
        .send({ email: 'u1@example.com', password: 'password123' });
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('accessToken');
    });

    it('#3: POST /auth/logout invalidates session', async () => {
      const res = await request(app)
        .post('/auth/logout')
        .set('Authorization', `Bearer ${token}`)
        .send({ refresh_token: 'refresh-123' });
      expect(res.status).toBe(204);
    });

    it('#4: POST /auth/refresh returns rotated tokens', async () => {
      const res = await request(app)
        .post('/auth/refresh')
        .send({ refresh_token: 'refresh-123' });
      expect(res.status).toBe(200);
      expect(res.body.accessToken).toBe('access-456');
    });

    it('#5: POST /auth/password-reset/request dispatches reset email', async () => {
      const res = await request(app)
        .post('/auth/password-reset/request')
        .send({ email: 'u1@example.com' });
      expect(res.status).toBe(200);
    });

    it('#6: POST /auth/password-reset resets credentials', async () => {
      const res = await request(app)
        .post('/auth/password-reset')
        .send({ token: 'reset-token-xyz', newPassword: 'new-password-123' });
      expect(res.status).toBe(200);
    });

    it('#7: GET /auth/session returns current session user', async () => {
      const res = await request(app)
        .get('/auth/session')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.user.id).toBe(USER1);
    });
  });

  describe('Profiles Contract Calls (#8 to #11, #56, #57, #58)', () => {
    it('#8, #9: GET /profiles/me retrieves own profile', async () => {
      const res = await request(app)
        .get('/profiles/me')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.email).toBe('u1@example.com');
      expect(fakeProfileService.getOwnProfile).toHaveBeenCalled();
    });

    it('#10: PATCH /profiles/me updates profile fields', async () => {
      const res = await request(app)
        .patch('/profiles/me')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'User One Updated', bio: 'Bio Updated' });
      expect(res.status).toBe(200);
      expect(fakeProfileService.updateOwnProfile).toHaveBeenCalled();
    });

    it('#11, #58: GET /profiles/:userId retrieves stranger profile without email', async () => {
      const res = await request(app)
        .get(`/profiles/${USER2}`)
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body).not.toHaveProperty('email');
      expect(fakeProfileService.getPublicProfile).toHaveBeenCalledWith(USER1, USER2);
    });

    it('#56, #57: GET /profiles/:userId/name retrieves stranger display name', async () => {
      const res = await request(app)
        .get(`/profiles/${USER2}/name`)
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.name).toBe('User Two');
    });
  });

  describe('Journeys & Trains Contract Calls (#48 to #53, #60)', () => {
    it('#49: GET /journeys/me lists active and past journeys', async () => {
      const res = await request(app)
        .get('/journeys/me')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body[0].train_number).toBe('12951');
    });

    it('#50: GET /journeys/:trainNumber/:travelDate/companions finds companions', async () => {
      const res = await request(app)
        .get('/journeys/12951/2026-09-01/companions')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(fakeJourneyService.findCompanions).toHaveBeenCalledWith(USER1, '12951', '2026-09-01');
    });

    it('#52: POST /journeys creates new journey entry', async () => {
      const res = await request(app)
        .post('/journeys')
        .set('Authorization', `Bearer ${token}`)
        .send({
          userName: 'User One',
          trainNumber: '12951',
          trainName: 'Mumbai Rajdhani',
          travelDate: '2026-09-01',
          coach: '3A',
          boardingStation: 'MMCT',
          destinationStation: 'NDLS',
          college: 'IIT Delhi',
          gender: 'male',
        });
      expect(res.status).toBe(201);
      expect(fakeJourneyService.createJourney).toHaveBeenCalled();
    });

    it('#53: DELETE /journeys/:id deletes a journey', async () => {
      const res = await request(app)
        .delete(`/journeys/${JOURNEY1}`)
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(204);
      expect(fakeJourneyService.deleteJourney).toHaveBeenCalledWith(JOURNEY1, USER1);
    });

    it('#60: GET /trains?q= queries autocomplete directory', async () => {
      const res = await request(app)
        .get('/trains?q=Rajdhani')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(fakeTrainService.search).toHaveBeenCalledWith('Rajdhani', 15);
    });

    it('#51: POST /trains/unverified logs unverified train', async () => {
      const res = await request(app)
        .post('/trains/unverified')
        .set('Authorization', `Bearer ${token}`)
        .send({
          trainNumber: '99999',
          trainName: '99999 Special',
        });
      expect(res.status).toBe(201);
      expect(fakeTrainService.logUnverifiedTrain).toHaveBeenCalled();
    });
  });

  describe('Companion Requests Contract Calls (#12 to #17, #41, #48, #54, #55)', () => {
    it('#12, #55: GET /requests/me returns user requests list', async () => {
      const res = await request(app)
        .get('/requests/me')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    it('#54: POST /requests creates new companion request', async () => {
      const res = await request(app)
        .post('/requests')
        .set('Authorization', `Bearer ${token}`)
        .send({
          toUserId: USER2,
          fromName: 'User One',
          toName: 'User Two',
          trainNumber: '12951',
          travelDate: '2026-09-01',
          boardingStation: 'MMCT',
          destinationStation: 'NDLS',
        });
      expect(res.status).toBe(201);
      expect(fakeRequestService.sendRequest).toHaveBeenCalled();
    });

    it('#14, #15: PATCH /requests/:id updates request status', async () => {
      const res = await request(app)
        .patch(`/requests/${REQ1}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ status: 'accepted' });
      expect(res.status).toBe(200);
      expect(fakeRequestService.updateStatus).toHaveBeenCalledWith(USER1, REQ1, 'accepted');
    });

    it('#13: DELETE /requests/:id cancels pending request', async () => {
      const res = await request(app)
        .delete(`/requests/${REQ1}`)
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(204);
      expect(fakeRequestService.cancelRequest).toHaveBeenCalledWith(USER1, REQ1);
    });

    it('#48: GET /requests/incoming/pending-count returns pending count', async () => {
      const res = await request(app)
        .get('/requests/incoming/pending-count')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.count).toBe(1);
    });

    it('#41: GET /requests/me/accepted returns accepted companions', async () => {
      const res = await request(app)
        .get('/requests/me/accepted')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    it('#16, #17: POST /requests/cleanup-expired cleans up expired requests', async () => {
      const res = await request(app)
        .post('/requests/cleanup-expired')
        .set('Authorization', `Bearer ${token}`)
        .send({});
      expect(res.status).toBe(200);
      expect(res.body.count).toBe(2);
    });
  });

  describe('Conversations, Messages & Moderation Contract Calls (#18 to #37, #45 to #47, #59)', () => {
    it('#24: GET /conversations returns user conversations', async () => {
      const res = await request(app)
        .get('/conversations')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    it('#36: POST /conversations gets or creates conversation', async () => {
      const res = await request(app)
        .post('/conversations')
        .set('Authorization', `Bearer ${token}`)
        .send({
          participants: [USER1, USER2],
          participant_names: { [USER1]: 'User One', [USER2]: 'User Two' },
          train_number: '12951',
          travel_date: '2026-09-01',
        });
      expect(res.status).toBe(201);
      expect(res.body.id).toBe(CONV1);
    });

    it('#37: DELETE /conversations/:id/for-me soft-deletes conversation for caller', async () => {
      const res = await request(app)
        .delete(`/conversations/${CONV1}/for-me`)
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(204);
    });

    it('#18: GET /conversations/:id/messages lists conversation messages', async () => {
      const res = await request(app)
        .get(`/conversations/${CONV1}/messages`)
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body).toHaveLength(1);
    });

    it('#32, #33, #34: POST /conversations/:id/messages atomically sends message', async () => {
      const res = await request(app)
        .post(`/conversations/${CONV1}/messages`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          text: 'Hi there',
        });
      expect(res.status).toBe(201);
      expect(res.body.text).toBe('Hi there');
    });

    it('#27, #28, #29: GET /conversations/:id/messages/unread-count queries unread count', async () => {
      const res = await request(app)
        .get(`/conversations/${CONV1}/messages/unread-count`)
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.count).toBe(3);
    });

    it('#21: GET /conversations/:id/last-read/:userId fetches read receipt', async () => {
      const res = await request(app)
        .get(`/conversations/${CONV1}/last-read/${USER2}`)
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('timestamp');
    });

    it('#35: PUT /conversations/:id/last-read updates read receipt', async () => {
      const res = await request(app)
        .put(`/conversations/${CONV1}/last-read`)
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('timestamp');
    });

    it('#45: GET /blocked-users lists blocked users', async () => {
      const res = await request(app)
        .get('/blocked-users')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    it('#46: POST /blocked-users blocks a user', async () => {
      const res = await request(app)
        .post('/blocked-users')
        .set('Authorization', `Bearer ${token}`)
        .send({ blocked_id: USER2 });
      expect(res.status).toBe(200);
    });

    it('#47: DELETE /blocked-users/:blockedId unblocks a user', async () => {
      const res = await request(app)
        .delete(`/blocked-users/${USER2}`)
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(204);
    });

    it('#59: POST /reports submits user report', async () => {
      const res = await request(app)
        .post('/reports')
        .set('Authorization', `Bearer ${token}`)
        .send({ reported_id: USER2, reason: 'Spamming' });
      expect(res.status).toBe(201);
    });
  });
});
