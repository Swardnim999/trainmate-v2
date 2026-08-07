import 'express';

/**
 * Augment Express's Request with fields the auth middleware layer populates, so
 * handlers read them with types intact:
 *  - `id`        — request id minted by the http-logger (`req.id`, echoed as
 *                  `x-request-id`), used for request-id log correlation.
 *  - `user`      — verified identity attached by `authenticate` (§9.1), shaped
 *                  like SessionUser. Only present on protected routes.
 *  - `validated` — request data parsed by the route-boundary Zod middleware
 *                  (`validateBody`/`validateQuery`); read back via
 *                  `validated<T>(req, 'body' | 'query')`.
 */
declare global {
  namespace Express {
    interface Request {
      id?: string;
      user?: { id: string; email: string };
      validated?: { body?: unknown; query?: unknown; params?: unknown };
    }
  }
}

export {};
