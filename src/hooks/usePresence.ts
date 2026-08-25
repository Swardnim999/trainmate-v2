import { useState, useEffect } from 'react';
import { socketManager } from '@/integrations/sockets/socket';
import { PresenceUser } from '@/integrations/sockets/types';
import { useAuth } from '@/hooks/useAuth';

interface PresenceState {
  [key: string]: {
    online: boolean;
    lastSeen?: string;
  };
}

export const usePresence = (conversationId?: string) => {
  const { user } = useAuth();
  const [onlineUsers, setOnlineUsers] = useState<PresenceState>({});
  const [typingUsers, setTypingUsers] = useState<string[]>([]);

  useEffect(() => {
    if (!user || !conversationId) return;

    socketManager.joinPresence(`presence-${conversationId}`, {
      userId: user.id,
      onlineAt: new Date().toISOString(),
    });

    const unsubSync = socketManager.onPresenceSync((users: PresenceUser[]) => {
      const state: PresenceState = {};
      users.forEach((u) => {
        const uid = u.userId || u.user_id;
        if (uid) {
          state[uid] = { online: true };
        }
      });
      setOnlineUsers(state);
    });

    const unsubJoin = socketManager.onPresenceJoin((joined: PresenceUser) => {
      const uid = joined.userId || joined.user_id;
      if (uid) {
        setOnlineUsers((prev) => ({
          ...prev,
          [uid]: { online: true },
        }));
      }
    });

    const unsubLeave = socketManager.onPresenceLeave((left: PresenceUser) => {
      const uid = left.userId || left.user_id;
      if (uid) {
        setOnlineUsers((prev) => ({
          ...prev,
          [uid]: { online: false, lastSeen: new Date().toISOString() },
        }));
      }
    });

    const unsubTyping = socketManager.onTyping((payload) => {
      if (payload.conversationId === conversationId && payload.userId !== user.id) {
        if (payload.isTyping) {
          setTypingUsers((prev) => (prev.includes(payload.userId) ? prev : [...prev, payload.userId]));
          setTimeout(() => {
            setTypingUsers((prev) => prev.filter((id) => id !== payload.userId));
          }, 3000);
        } else {
          setTypingUsers((prev) => prev.filter((id) => id !== payload.userId));
        }
      }
    });

    return () => {
      unsubSync();
      unsubJoin();
      unsubLeave();
      unsubTyping();
      socketManager.leavePresence(`presence-${conversationId}`);
    };
  }, [user, conversationId]);

  const sendTypingIndicator = async () => {
    if (!user || !conversationId) return;
    socketManager.sendTyping(conversationId, true);
  };

  const isUserOnline = (userId: string) => onlineUsers[userId]?.online ?? false;

  return { onlineUsers, typingUsers, sendTypingIndicator, isUserOnline };
};
