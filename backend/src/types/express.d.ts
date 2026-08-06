import 'express';

/**
 * Augment Express's Request with the request id minted by the http-logger
 * middleware (`src/middleware/http-logger.ts`), so handlers and the error
 * handler can read `req.id` with types intact.
 */
declare global {
  namespace Express {
    interface Request {
      id?: string;
    }
  }
}

export {};
