import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { createConversationRouter } from '../../src/routes/conversations.routes.js';
import type { ConversationController } from '../../src/controllers/conversation.controller.js';
import { errorHandler } from '../../src/middleware/error-handler.js';
import { JwtService } from '../../src/utils/jwt.js';
import { env } from '../../src/config/env.js';

describe('Conversation Routes (Unit)', () => {
  let app: express.Express;
  let mockController: {
    getMyConversations: ReturnType<typeof vi.fn>;
    getConversationById: ReturnType<typeof vi.fn>;
    createConversation: ReturnType<typeof vi.fn>;
    softDeleteForMe: ReturnType<typeof vi.fn>;
  };

  const user1 = '00000000-0000-4000-8000-000000000001';
  const user2 = '00000000-0000-4000-8000-000000000002';
  const jwt = new JwtService(env.JWT_SECRET);
  let validToken: string;

  beforeEach(async () => {
    validToken = await jwt.sign({ id: user1, email: 'alex@example.com' }, new Date(), 900);

    mockController = {
      getMyConversations: vi.fn((_req, res) => res.status(200).json([])),
      getConversationById: vi.fn((_req, res) => res.status(200).json({ id: 'conv-1' })),
      createConversation: vi.fn((_req, res) => res.status(201).json({ id: 'conv-1' })),
      softDeleteForMe: vi.fn((_req, res) => res.status(204).send()),
    };

    app = express();
    app.use(express.json());
    app.use(
      '/conversations',
      createConversationRouter({
        conversationController: mockController as unknown as ConversationController,
      }),
    );
    app.use(errorHandler);
  });

  it('requires authentication on all routes (401 without token)', async () => {
    const res = await request(app).get('/conversations');
    expect(res.status).toBe(401);
  });

  it('GET /conversations routes to getMyConversations when authenticated', async () => {
    const res = await request(app)
      .get('/conversations')
      .set('Authorization', `Bearer ${validToken}`);

    expect(res.status).toBe(200);
    expect(mockController.getMyConversations).toHaveBeenCalled();
  });

  it('POST /conversations routes to createConversation with valid payload', async () => {
    const res = await request(app)
      .post('/conversations')
      .set('Authorization', `Bearer ${validToken}`)
      .send({
        participants: [user1, user2],
        trainNumber: '12951',
      });

    expect(res.status).toBe(201);
    expect(mockController.createConversation).toHaveBeenCalled();
  });

  it('GET /conversations/:id routes to getConversationById with valid UUID', async () => {
    const convId = 'c1111111-1111-4111-8111-111111111111';
    const res = await request(app)
      .get(`/conversations/${convId}`)
      .set('Authorization', `Bearer ${validToken}`);

    expect(res.status).toBe(200);
    expect(mockController.getConversationById).toHaveBeenCalled();
  });

  it('DELETE /conversations/:id/for-me routes to softDeleteForMe', async () => {
    const convId = 'c1111111-1111-4111-8111-111111111111';
    const res = await request(app)
      .delete(`/conversations/${convId}/for-me`)
      .set('Authorization', `Bearer ${validToken}`);

    expect(res.status).toBe(204);
    expect(mockController.softDeleteForMe).toHaveBeenCalled();
  });
});
