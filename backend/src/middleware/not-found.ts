import { NotFoundError } from '../utils/errors.js';

/**
 * Terminal 404 for any route that didn't match. Express 5 auto-catches the
 * throw and routes it to the centralized error handler, which emits the locked
 * envelope — so unknown paths never get Express's default HTML error page.
 */
export function notFoundHandler(): never {
  throw new NotFoundError();
}
