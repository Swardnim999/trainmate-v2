import type { Request as ExpressRequest, Response } from 'express';
import { RequestService } from '../services/request.service.js';
import { RequestSerializer } from '../serializers/request.serializer.js';
import { validated } from '../middleware/validate.js';
import type {
  CreateRequestInput,
  UpdateRequestStatusInput,
  ListRequestsQueryInput,
  CleanupExpiredRequestsInput,
} from '../validation/request.schemas.js';

export interface RequestControllerDeps {
  requestService?: RequestService;
}

/**
 * Request HTTP Controller (Milestone 9).
 * Thin controller extracting parameters and delegating to RequestService.
 */
export class RequestController {
  private readonly requestService: RequestService;

  constructor(deps: RequestControllerDeps = {}) {
    this.requestService = deps.requestService ?? new RequestService();
  }

  getMyRequests = async (req: ExpressRequest, res: Response): Promise<void> => {
    const userId = req.user!.id;
    const { type } = validated<ListRequestsQueryInput>(req, 'query');
    const requests = await this.requestService.listUserRequests(userId, type);
    res.status(200).json(RequestSerializer.toResponseList(requests));
  };

  sendRequest = async (req: ExpressRequest, res: Response): Promise<void> => {
    const userId = req.user!.id;
    const input = validated<CreateRequestInput>(req, 'body');
    const request = await this.requestService.sendRequest(userId, input);
    res.status(201).json(RequestSerializer.toResponse(request));
  };

  updateRequestStatus = async (req: ExpressRequest, res: Response): Promise<void> => {
    const userId = req.user!.id;
    const { id } = validated<{ id: string }>(req, 'params');
    const { status } = validated<UpdateRequestStatusInput>(req, 'body');
    const updated = await this.requestService.updateStatus(userId, id, status);
    res.status(200).json(RequestSerializer.toResponse(updated));
  };

  cancelRequest = async (req: ExpressRequest, res: Response): Promise<void> => {
    const userId = req.user!.id;
    const { id } = validated<{ id: string }>(req, 'params');
    await this.requestService.cancelRequest(userId, id);
    res.status(204).send();
  };

  cleanupExpiredRequests = async (req: ExpressRequest, res: Response): Promise<void> => {
    const userId = req.user!.id;
    const { cutoffDate } = validated<CleanupExpiredRequestsInput>(req, 'body');
    const count = await this.requestService.cleanupExpiredRequests(userId, cutoffDate);
    res.status(200).json({ count });
  };

  getMyAcceptedRequests = async (req: ExpressRequest, res: Response): Promise<void> => {
    const userId = req.user!.id;
    const requests = await this.requestService.listAcceptedRequests(userId);
    res.status(200).json(RequestSerializer.toResponseList(requests));
  };

  getIncomingPendingCount = async (req: ExpressRequest, res: Response): Promise<void> => {
    const userId = req.user!.id;
    const count = await this.requestService.getIncomingPendingCount(userId);
    res.status(200).json({ count });
  };
}
