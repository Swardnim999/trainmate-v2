/**
 * TrainMate v2 — Auth API Client
 */

import { apiClient, getStoredSession, setStoredSession } from './client';
import { AuthSession, AuthStateChangeCallback, AuthChangeEvent } from './types';

const listeners = new Set<AuthStateChangeCallback>();

export function emitAuthStateChange(event: AuthChangeEvent, session: AuthSession | null): void {
  listeners.forEach((callback) => {
    try {
      callback(event, session);
    } catch (err) {
      console.error('Error in auth state change listener:', err);
    }
  });
}

export const authApi = {
  async getSession(): Promise<{ data: { session: AuthSession | null }; error: null }> {
    const session = getStoredSession();
    return { data: { session }, error: null };
  },

  onAuthStateChange(callback: AuthStateChangeCallback): { data: { subscription: { unsubscribe: () => void } } } {
    listeners.add(callback);
    // Initial emit of existing state
    const currentSession = getStoredSession();
    if (currentSession) {
      callback('SIGNED_IN', currentSession);
    }

    return {
      data: {
        subscription: {
          unsubscribe: () => {
            listeners.delete(callback);
          },
        },
      },
    };
  },

  async signInWithPassword(credentials: { email: string; password: string }): Promise<{
    data: { user: AuthSession['user'] | null; session: AuthSession | null };
    error: Error | null;
  }> {
    try {
      const res = await apiClient<AuthSession>('/auth/login', {
        method: 'POST',
        body: JSON.stringify(credentials),
      });

      setStoredSession(res);
      emitAuthStateChange('SIGNED_IN', res);
      return { data: { user: res.user, session: res }, error: null };
    } catch (err) {
      return { data: { user: null, session: null }, error: err as Error };
    }
  },

  async signUp(credentials: { email: string; password: string }): Promise<{
    data: { user: AuthSession['user'] | null; session: AuthSession | null };
    error: Error | null;
  }> {
    try {
      const res = await apiClient<{ user: AuthSession['user']; message: string; session?: AuthSession }>('/auth/register', {
        method: 'POST',
        body: JSON.stringify(credentials),
      });

      // If auto-logged-in
      if (res.session) {
        setStoredSession(res.session);
        emitAuthStateChange('SIGNED_IN', res.session);
        return { data: { user: res.user, session: res.session }, error: null };
      }

      return { data: { user: res.user, session: null }, error: null };
    } catch (err) {
      return { data: { user: null, session: null }, error: err as Error };
    }
  },

  async signOut(): Promise<{ error: Error | null }> {
    try {
      const session = getStoredSession();
      if (session?.refresh_token) {
        await apiClient('/auth/logout', {
          method: 'POST',
          body: JSON.stringify({ refresh_token: session.refresh_token }),
        }).catch(() => {});
      }
      setStoredSession(null);
      emitAuthStateChange('SIGNED_OUT', null);
      return { error: null };
    } catch (err) {
      setStoredSession(null);
      emitAuthStateChange('SIGNED_OUT', null);
      return { error: err as Error };
    }
  },

  async resetPasswordForEmail(email: string): Promise<{ error: Error | null }> {
    try {
      await apiClient('/auth/password/reset-request', {
        method: 'POST',
        body: JSON.stringify({ email }),
      });
      return { error: null };
    } catch (err) {
      return { error: err as Error };
    }
  },

  async updateUser(attributes: { password?: string }): Promise<{ error: Error | null }> {
    try {
      if (attributes.password) {
        await apiClient('/auth/password/reset', {
          method: 'POST',
          body: JSON.stringify({ newPassword: attributes.password }),
        });
      }
      const session = getStoredSession();
      emitAuthStateChange('USER_UPDATED', session);
      return { error: null };
    } catch (err) {
      return { error: err as Error };
    }
  },
};
