import type { NextFunction, Request, Response } from 'express';
import type { ZodType } from 'zod';

/**
 * Request-boundary Zod validation (Sprint 2B M4).
 *
 * The route wires `validateBody`/`validateQuery` ahead of the controller, which
 * therefore never sees unvalidated input. Parsed data is stored on `req.validated`
 * (never spread over `req.body`/`req.query`, whose Express types are loose) and
 * read back with the typed `validated<T>()` accessor. A parse failure forwards a
 * ZodError to the centralized error handler, which maps it to 400 VALIDATION_ERROR
 * with `err.flatten()` details.
 */

export type ValidatedPart = 'body' | 'query' | 'params';

/** Reads back request data parsed by the boundary middleware, typed at the call site. */
export function validated<T>(req: Request, part: ValidatedPart): T {
  return (req.validated?.[part] ?? {}) as T;
}

export function validateBody(schema: ZodType) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      // A bodyless POST (no Content-Type) leaves req.body undefined in Express 5;
      // coerce to {} so schemas with only optional fields (e.g. logout) still pass.
      req.validated = { ...req.validated, body: schema.parse(req.body ?? {}) };
      next();
    } catch (err) {
      next(err);
    }
  };
}

export function validateQuery(schema: ZodType) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      req.validated = { ...req.validated, query: schema.parse(req.query) };
      next();
    } catch (err) {
      next(err);
    }
  };
}
