import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
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

    const channel = supabase.channel(`presence-${conversationId}`, {
      config: { presence: { key: user.id } }
    });

    channel
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState();
        const users: PresenceState = {};
        
        Object.keys(state).forEach(key => {
          users[key] = { online: true };
        });
        
        setOnlineUsers(users);
      })
      .on('presence', { event: 'join' }, ({ key }) => {
        setOnlineUsers(prev => ({
          ...prev,
          [key]: { online: true }
        }));
      })
      .on('presence', { event: 'leave' }, ({ key }) => {
        setOnlineUsers(prev => ({
          ...prev,
          [key]: { online: false, lastSeen: new Date().toISOString() }
        }));
      })
      .on('broadcast', { event: 'typing' }, ({ payload }) => {
        if (payload.userId !== user.id) {
          setTypingUsers(prev => 
            prev.includes(payload.userId) ? prev : [...prev, payload.userId]
          );
          
          // Remove typing indicator after 3 seconds
          setTimeout(() => {
            setTypingUsers(prev => prev.filter(id => id !== payload.userId));
          }, 3000);
        }
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await channel.track({ online_at: new Date().toISOString() });
        }
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, conversationId]);

  const sendTypingIndicator = async () => {
    if (!user || !conversationId) return;

    const channel = supabase.channel(`presence-${conversationId}`);
    await channel.send({
      type: 'broadcast',
      event: 'typing',
      payload: { userId: user.id }
    });
  };

  const isUserOnline = (userId: string) => onlineUsers[userId]?.online ?? false;

  return { onlineUsers, typingUsers, sendTypingIndicator, isUserOnline };
};
