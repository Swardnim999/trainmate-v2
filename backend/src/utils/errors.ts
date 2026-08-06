/**
 * Error classes shared across the app. `AppError` is the single way business
 * and middleware code signals an expected, client-relevant failure; the
 * centralized error handler maps it to the locked `{ error: {...} }` envelope.
 */
export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

/** 404 — the request path does not match any route. */
export class NotFoundError extends AppError {
  constructor(message = 'Resource not found') {
    super(404, 'NOT_FOUND', message);
    this.name = 'NotFoundError';
  }
}
