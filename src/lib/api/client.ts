/**
 * TrainMate v2 — Base HTTP API Client
 *
 * Provides typed fetch abstraction with:
 * - Automatic Authorization header injection from localStorage
 * - Unique X-Request-ID generation per request
 * - 401 Token Refresh Interceptor with queue and replay
 * - GoTrue-compatible session format in storage
 */

import { AuthSession, ApiErrorResponse } from './types';

const STORAGE_KEY = 'trainmate-auth-token';
const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000';

export class ApiError extends Error {
  code: string;
  statusCode: number;
  details?: Record<string, unknown> | Array<unknown>;

  constructor(statusCode: number, code: string, message: string, details?: Record<string, unknown> | Array<unknown>) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

// Global Refresh Lock & Queue
let isRefreshing = false;
let refreshQueue: Array<{
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
}> = [];

function processQueue(error: Error | null) {
  refreshQueue.forEach((prom) => {
    if (error) {
      prom.reject(error);
    } else {
      prom.resolve(null);
    }
  });
  refreshQueue = [];
}

export function getStoredSession(): AuthSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as AuthSession;
  } catch {
    return null;
  }
}

export function setStoredSession(session: AuthSession | null): void {
  if (session) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  } else {
    localStorage.removeItem(STORAGE_KEY);
  }
}

export async function refreshAccessToken(): Promise<AuthSession | null> {
  const session = getStoredSession();
  if (!session?.refresh_token) {
    setStoredSession(null);
    return null;
  }

  try {
    const res = await fetch(`${API_BASE}/auth/refresh`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Request-ID': crypto.randomUUID(),
      },
      body: JSON.stringify({ refresh_token: session.refresh_token }),
    });

    if (!res.ok) {
      setStoredSession(null);
      return null;
    }

    const data = await res.json();
    const newSession: AuthSession = {
      access_token: data.access_token,
      refresh_token: data.refresh_token || session.refresh_token,
      expires_in: data.expires_in,
      token_type: data.token_type,
      user: data.user || session.user,
    };
    setStoredSession(newSession);
    return newSession;
  } catch {
    setStoredSession(null);
    return null;
  }
}

export async function apiClient<T>(
  endpoint: string,
  options: RequestInit = {},
  isRetry = false,
): Promise<T> {
  const session = getStoredSession();
  const headers = new Headers(options.headers || {});

  if (!headers.has('Content-Type') && !(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }

  if (session?.access_token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${session.access_token}`);
  }

  if (!headers.has('X-Request-ID')) {
    headers.set('X-Request-ID', crypto.randomUUID());
  }

  const url = endpoint.startsWith('http') ? endpoint : `${API_BASE}${endpoint.startsWith('/') ? '' : '/'}${endpoint}`;

  const response = await fetch(url, {
    ...options,
    headers,
  });

  // Handle 401 Unauthorized with token refresh & retry queue
  if (response.status === 401 && !isRetry && !endpoint.includes('/auth/login') && !endpoint.includes('/auth/refresh')) {
    if (isRefreshing) {
      return new Promise((resolve, reject) => {
        refreshQueue.push({
          resolve: () => resolve(apiClient<T>(endpoint, options, true)),
          reject,
        });
      });
    }

    isRefreshing = true;
    try {
      const refreshed = await refreshAccessToken();
      if (refreshed) {
        processQueue(null);
        return apiClient<T>(endpoint, options, true);
      } else {
        const error = new ApiError(401, 'UNAUTHORIZED', 'Session expired. Please log in again.');
        processQueue(error);
        throw error;
      }
    } catch (err) {
      processQueue(err as Error);
      throw err;
    } finally {
      isRefreshing = false;
    }
  }

  if (!response.ok) {
    let errorData: ApiErrorResponse | null = null;
    try {
      errorData = await response.json();
    } catch {
      // Non-JSON response
    }
    const message = errorData?.message || response.statusText || 'API Request Failed';
    const code = errorData?.code || 'HTTP_ERROR';
    throw new ApiError(response.status, code, message, errorData?.details);
  }

  if (response.status === 204) {
    return undefined as unknown as T;
  }

  const contentType = response.headers.get('content-type');
  if (contentType && contentType.includes('application/json')) {
    return response.json();
  }

  return response.text() as unknown as T;
}
