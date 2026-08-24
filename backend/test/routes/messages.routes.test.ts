import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { createConversationRouter } from '../../src/routes/conversations.routes.js';
import type { MessageController } from '../../src/controllers/message.controller.js';
import { errorHandler } from '../../src/middleware/error-handler.js';
import { JwtService } from '../../src/utils/jwt.js';
import { env } from '../../src/config/env.js';

describe('Message Routes (Unit)', () => {
  let app: express.Express;
  let mockMessageController: {
    listMessages: ReturnType<typeof vi.fn>;
    sendMessage: ReturnType<typeof vi.fn>;
    getUnreadCount: ReturnType<typeof vi.fn>;
    getLastRead: ReturnType<typeof vi.fn>;
    markAsRead: ReturnType<typeof vi.fn>;
  };

  const user1 = '00000000-0000-4000-8000-000000000001';
  const user2 = '00000000-0000-4000-8000-000000000002';
  const convId = 'c1111111-1111-4111-8111-111111111111';
  const jwt = new JwtService(env.JWT_SECRET);
  let validToken: string;

  beforeEach(async () => {
    validToken = await jwt.sign({ id: user1, email: 'alex@example.com' }, new Date(), 900);

    mockMessageController = {
      listMessages: vi.fn((_req, res) => res.status(200).json([])),
      sendMessage: vi.fn((_req, res) => res.status(201).json({ id: 'msg-1' })),
      getUnreadCount: vi.fn((_req, res) => res.status(200).json({ count: 2 })),
      getLastRead: vi.fn((_req, res) => res.status(200).json({ timestamp: null })),
      markAsRead: vi.fn((_req, res) =>
        res.status(200).json({ timestamp: '2026-08-24T12:00:00.000Z' }),
      ),
    };

    app = express();
    app.use(express.json());
    app.use(
      '/conversations',
      createConversationRouter({
        messageController: mockMessageController as unknown as MessageController,
      }),
    );
    app.use(errorHandler);
  });

  it('GET /conversations/:id/messages requires auth and routes to listMessages', async () => {
    const unauth = await request(app).get(`/conversations/${convId}/messages`);
    expect(unauth.status).toBe(401);

    const res = await request(app)
      .get(`/conversations/${convId}/messages`)
      .set('Authorization', `Bearer ${validToken}`);

    expect(res.status).toBe(200);
    expect(mockMessageController.listMessages).toHaveBeenCalled();
  });

  it('POST /conversations/:id/messages routes to sendMessage with valid payload', async () => {
    const res = await request(app)
      .post(`/conversations/${convId}/messages`)
      .set('Authorization', `Bearer ${validToken}`)
      .send({
        text: 'Hello on train!',
      });

    expect(res.status).toBe(201);
    expect(mockMessageController.sendMessage).toHaveBeenCalled();
  });

  it('GET /conversations/:id/messages/unread-count routes to getUnreadCount', async () => {
    const res = await request(app)
      .get(`/conversations/${convId}/messages/unread-count`)
      .set('Authorization', `Bearer ${validToken}`);

    expect(res.status).toBe(200);
    expect(mockMessageController.getUnreadCount).toHaveBeenCalled();
  });

  it('GET /conversations/:id/last-read/:userId routes to getLastRead', async () => {
    const res = await request(app)
      .get(`/conversations/${convId}/last-read/${user2}`)
      .set('Authorization', `Bearer ${validToken}`);

    expect(res.status).toBe(200);
    expect(mockMessageController.getLastRead).toHaveBeenCalled();
  });

  it('PUT /conversations/:id/last-read routes to markAsRead', async () => {
    const res = await request(app)
      .put(`/conversations/${convId}/last-read`)
      .set('Authorization', `Bearer ${validToken}`);

    expect(res.status).toBe(200);
    expect(mockMessageController.markAsRead).toHaveBeenCalled();
  });
});
