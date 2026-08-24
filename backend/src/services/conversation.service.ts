import type { Conversation, PrismaClient } from '@prisma/client';
import { ConversationRepository } from '../repositories/conversations.repo.js';
import { ProfileRepository } from '../repositories/profiles.repo.js';
import { AccessService } from './access.service.js';
import { AppError, NotFoundError } from '../utils/errors.js';
import { prisma } from '../lib/prisma.js';

export interface CreateConversationDto {
  participants: string[];
  participantNames?: Record<string, string>;
  trainNumber?: string | null;
  travelDate?: string | Date | null;
}

export interface ConversationServiceDeps {
  conversations?: ConversationRepository;
  profiles?: ProfileRepository;
  access?: AccessService;
  db?: PrismaClient;
}

/**
 * ConversationService — Business logic for 1-to-1 companion chat rooms and soft-delete
 * (Spec §3.2, §6.4, §9.5; Conversations-Design §11.2).
 */
export class ConversationService {
  private readonly conversations: ConversationRepository;
  private readonly profiles: ProfileRepository;
  private readonly access: AccessService;

  constructor(deps: Partial<ConversationServiceDeps> = {}) {
    this.conversations = deps.conversations ?? new ConversationRepository(deps.db ?? prisma);
    this.profiles = deps.profiles ?? new ProfileRepository(deps.db ?? prisma);
    this.access = deps.access ?? new AccessService({ db: deps.db ?? prisma });
  }

  /**
   * Retrieves all active conversations for the authenticated caller,
   * excluding conversations soft-deleted for this user (GET /conversations).
   */
  async listConversations(callerId: string): Promise<Conversation[]> {
    return this.conversations.findUserConversations(callerId);
  }

  /**
   * Retrieves conversation details for a participant (GET /conversations/:id).
   * Masks existence with 404 for non-participants.
   */
  async getConversation(callerId: string, id: string): Promise<Conversation> {
    const conv = await this.conversations.findById(id);
    if (!conv || !conv.participants.includes(callerId)) {
      throw new NotFoundError('Conversation not found');
    }
    return conv;
  }

  /**
   * Creates or idempotently retrieves a 1-to-1 conversation room (POST /conversations).
   *
   * Business Rules:
   * 1. Exactly 2 distinct participants.
   * 2. Caller must be one of the participants.
   * 3. Neither participant is blocked (AccessService.isBlocked).
   * 4. An accepted companion request must exist between the pair (AccessService.hasAcceptedRequest).
   * 5. Idempotent: returns existing room if one already exists for this pair.
   */
  async createConversation(callerId: string, input: CreateConversationDto): Promise<Conversation> {
    if (input.participants.length !== 2 || input.participants[0] === input.participants[1]) {
      throw new AppError(
        400,
        'VALIDATION_ERROR',
        'Conversation must have exactly 2 distinct participants',
      );
    }

    if (!input.participants.includes(callerId)) {
      throw new AppError(
        400,
        'VALIDATION_ERROR',
        'Caller must be a participant in the conversation',
      );
    }

    const otherUserId = input.participants.find((id) => id !== callerId)!;

    // 1. Check symmetric blocking
    const blocked = await this.access.isBlocked(callerId, otherUserId);
    if (blocked) {
      throw new AppError(400, 'USER_BLOCKED', 'Cannot create conversation with this user');
    }

    // 2. Check accepted companion request
    const hasAccepted = await this.access.hasAcceptedRequest(callerId, otherUserId);
    if (!hasAccepted) {
      throw new AppError(
        403,
        'NO_ACCEPTED_REQUEST',
        'Conversation creation requires an accepted companion request',
      );
    }

    const travelDateObj = input.travelDate
      ? typeof input.travelDate === 'string'
        ? new Date(input.travelDate.split('T')[0] ?? input.travelDate)
        : input.travelDate
      : null;

    // 3. Idempotent check: reuse existing conversation if present
    const existing = await this.conversations.findExistingBetween(
      callerId,
      otherUserId,
      input.trainNumber,
      travelDateObj,
    );

    if (existing) {
      return existing;
    }

    // 4. Resolve display names (guaranteeing no emails are stored)
    const names: Record<string, string> = { ...input.participantNames };
    if (!names[callerId] || !names[otherUserId]) {
      const [callerProfile, otherProfile] = await Promise.all([
        this.profiles.findById(callerId),
        this.profiles.findById(otherUserId),
      ]);
      if (!names[callerId]) names[callerId] = callerProfile?.name || 'User';
      if (!names[otherUserId]) names[otherUserId] = otherProfile?.name || 'User';
    }

    return this.conversations.create({
      participants: input.participants,
      participantNames: names,
      trainNumber: input.trainNumber ?? null,
      travelDate: travelDateObj,
    });
  }

  /**
   * Soft-deletes a conversation for the authenticated caller (DELETE /conversations/:id/for-me).
   * Masks existence with 404 for non-participants.
   */
  async softDeleteForUser(callerId: string, id: string): Promise<void> {
    const conv = await this.conversations.findById(id);
    if (!conv || !conv.participants.includes(callerId)) {
      throw new NotFoundError('Conversation not found');
    }

    await this.conversations.softDeleteForUser(id, callerId);
  }
}
