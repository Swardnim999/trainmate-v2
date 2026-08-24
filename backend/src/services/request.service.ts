import type { PrismaClient, Request } from '@prisma/client';
import { RequestRepository } from '../repositories/requests.repo.js';
import { AccessService } from './access.service.js';
import { AppError, NotFoundError } from '../utils/errors.js';
import { prisma } from '../lib/prisma.js';

export interface CreateRequestDto {
  toUserId: string;
  fromName?: string | null;
  toName?: string | null;
  trainNumber?: string | null;
  travelDate: string | Date;
  boardingStation?: string | null;
  destinationStation?: string | null;
}

export interface RequestServiceDeps {
  requests?: RequestRepository;
  access?: AccessService;
  db?: PrismaClient;
}

/**
 * RequestService — Business logic and state machine for travel companion requests
 * (Spec §3.2, §6.3, §9.4; Requests-Design §7).
 */
export class RequestService {
  private readonly requests: RequestRepository;
  private readonly access: AccessService;

  constructor(deps: Partial<RequestServiceDeps> = {}) {
    this.requests = deps.requests ?? new RequestRepository(deps.db ?? prisma);
    this.access = deps.access ?? new AccessService({ db: deps.db ?? prisma });
  }

  /**
   * Dispatches a new companion request (POST /requests).
   *
   * Business Rules:
   * 1. Rejects self-requests (fromUserId === toUserId).
   * 2. Rejects if symmetric block exists between caller and target.
   * 3. Rejects if users do not share an active journey on the specified train and date.
   * 4. Rejects if an active pending request already exists between them for this journey.
   * 5. Creates the request with status='pending'.
   */
  async sendRequest(callerId: string, input: CreateRequestDto): Promise<Request> {
    if (callerId === input.toUserId) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Cannot send a companion request to yourself');
    }

    // 1. Check symmetric blocking
    const blocked = await this.access.isBlocked(callerId, input.toUserId);
    if (blocked) {
      throw new AppError(400, 'USER_BLOCKED', 'Cannot send companion request to this user');
    }

    const travelDateObj =
      typeof input.travelDate === 'string'
        ? new Date(input.travelDate.split('T')[0] ?? input.travelDate)
        : input.travelDate;

    // 2. Validate shared journey requirement (users_share_journey)
    if (!input.trainNumber) {
      throw new AppError(
        400,
        'NO_MATCHING_JOURNEY',
        'You do not share an active journey on this train and date with this user',
      );
    }

    const sharesJourney = await this.access.usersShareJourney(
      callerId,
      input.toUserId,
      input.trainNumber,
      travelDateObj,
    );

    if (!sharesJourney) {
      throw new AppError(
        400,
        'NO_MATCHING_JOURNEY',
        'You do not share an active journey on this train and date with this user',
      );
    }

    // 3. Check for existing active pending request
    const existingPending = await this.requests.findActivePendingBetween(
      callerId,
      input.toUserId,
      input.trainNumber,
      travelDateObj,
    );

    if (existingPending) {
      throw new AppError(
        409,
        'REQUEST_ALREADY_PENDING',
        'An active companion request is already pending for this journey',
      );
    }

    return this.requests.create({
      fromUserId: callerId,
      fromName: input.fromName ?? null,
      toUserId: input.toUserId,
      toName: input.toName ?? null,
      trainNumber: input.trainNumber,
      travelDate: travelDateObj,
      boardingStation: input.boardingStation ?? null,
      destinationStation: input.destinationStation ?? null,
      status: 'pending',
    });
  }

  /**
   * Retrieves all requests for the caller, filtered by type (sent, received, or all)
   * and excluding all symmetrically blocked users (GET /requests/me).
   */
  async listUserRequests(
    callerId: string,
    type: 'all' | 'sent' | 'received' = 'all',
  ): Promise<Request[]> {
    const blockedIds = await this.access.getSymmetricBlockedUserIds(callerId);
    return this.requests.findUserRequests({
      userId: callerId,
      type,
      excludedUserIds: Array.from(blockedIds),
    });
  }

  /**
   * Retrieves all accepted requests for the caller (sent or received),
   * excluding blocked users (GET /requests/me/accepted).
   */
  async listAcceptedRequests(callerId: string): Promise<Request[]> {
    const blockedIds = await this.access.getSymmetricBlockedUserIds(callerId);
    return this.requests.findAcceptedRequestsForUser(callerId, Array.from(blockedIds));
  }

  /**
   * Returns the count of incoming pending requests for the Dashboard bell badge,
   * excluding blocked senders (GET /requests/incoming/pending-count).
   */
  async getIncomingPendingCount(callerId: string): Promise<number> {
    const blockedIds = await this.access.getSymmetricBlockedUserIds(callerId);
    return this.requests.countIncomingPending(callerId, Array.from(blockedIds));
  }

  /**
   * Updates request status to 'accepted' or 'rejected' (PATCH /requests/:id).
   *
   * Business Rules:
   * 1. Caller must be the recipient (toUserId === callerId).
   * 2. Request must currently be in 'pending' status.
   * 3. Neither user may be blocked.
   * 4. Updates status and updated_at.
   */
  async updateStatus(
    callerId: string,
    requestId: string,
    newStatus: 'accepted' | 'rejected',
  ): Promise<Request> {
    const request = await this.requests.findById(requestId);
    if (!request) {
      throw new NotFoundError('Request not found');
    }

    // Recipient check with existence masking
    if (request.toUserId !== callerId) {
      throw new NotFoundError('Request not found');
    }

    if (request.status !== 'pending') {
      throw new AppError(
        400,
        'INVALID_STATE_TRANSITION',
        'Cannot update a request that is not pending',
      );
    }

    // Check blocking
    const blocked = await this.access.isBlocked(request.fromUserId, request.toUserId);
    if (blocked) {
      throw new NotFoundError('Request not found');
    }

    const updated = await this.requests.updateStatus(requestId, newStatus, 'pending');
    if (!updated) {
      throw new AppError(
        409,
        'INVALID_STATE_TRANSITION',
        'Request status could not be updated because it is no longer pending',
      );
    }

    return updated;
  }

  /**
   * Cancels an outgoing pending companion request (DELETE /requests/:id).
   *
   * Business Rules:
   * 1. Caller must be the sender (fromUserId === callerId).
   * 2. Request must currently be in 'pending' status.
   * 3. Hard deletes the record. Returns 404 to mask existence on unauthorized attempts.
   */
  async cancelRequest(callerId: string, requestId: string): Promise<void> {
    const deleted = await this.requests.deletePendingByIdAndOwner(requestId, callerId);
    if (!deleted) {
      // Either doesn't exist, not owned by caller, or not in pending status -> 404 masks existence
      throw new NotFoundError('Request not found');
    }
  }

  /**
   * Prunes expired pending requests sent by caller (POST /requests/cleanup-expired).
   * Executes a single atomic DELETE query eliminating TOCTOU race conditions.
   */
  async cleanupExpiredRequests(callerId: string, cutoffDateStr?: string): Promise<number> {
    let cutoff: Date;
    if (cutoffDateStr) {
      cutoff = new Date(cutoffDateStr);
    } else {
      const d = new Date();
      d.setDate(d.getDate() - 2);
      d.setHours(0, 0, 0, 0);
      cutoff = d;
    }

    return this.requests.deleteExpiredPending(callerId, cutoff);
  }
}
