import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { messageSchema } from '@/lib/validations';

export interface Message {
  id: string;
  sender_id: string;
  sender_name: string | null;
  text: string;
  created_at: string;
  attachment_url?: string | null;
  attachment_type?: string | null;
  attachment_name?: string | null;
  attachment_size?: number | null;
}

export interface Conversation {
  id: string;
  participants: string[];
  participant_names: any;
  last_message: string | null;
  last_message_time: string | null;
  train_number: string | null;
  travel_date: string | null;
}

export interface AttachmentInput {
  url: string;
  type: string; // mime type
  name: string;
  size: number;
}

export const useChat = (conversationId?: string, otherUserId?: string) => {
  const { user } = useAuth();
  const [messages, setMessages] = useState<Message[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [unreadCount, setUnreadCount] = useState<{ [key: string]: number }>({});
  const [loading, setLoading] = useState(false);
  const [otherUserLastRead, setOtherUserLastRead] = useState<string | null>(null);

  // Messages for a specific conversation
  useEffect(() => {
    if (!conversationId || !user) return;

    const fetchMessages = async () => {
      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: true });

      if (error) {
        console.error('Error fetching messages:', error);
        return;
      }
      setMessages((data || []) as Message[]);
    };

    fetchMessages();

    const channel = supabase
      .channel(`messages-${conversationId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${conversationId}` },
        (payload) => {
          setMessages((prev) => {
            const next = payload.new as Message;
            if (prev.some((m) => m.id === next.id)) return prev;
            return [...prev, next];
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [conversationId, user]);

  // Other user's last_read for this conversation (read receipts)
  useEffect(() => {
    if (!conversationId || !otherUserId) {
      setOtherUserLastRead(null);
      return;
    }

    let cancelled = false;

    const fetchLastRead = async () => {
      const { data } = await supabase
        .from('last_read')
        .select('timestamp')
        .eq('conversation_id', conversationId)
        .eq('user_id', otherUserId)
        .maybeSingle();
      if (!cancelled) setOtherUserLastRead(data?.timestamp ?? null);
    };

    fetchLastRead();

    const channel = supabase
      .channel(`last-read-${conversationId}-${otherUserId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'last_read', filter: `conversation_id=eq.${conversationId}` },
        (payload) => {
          const row: any = payload.new || payload.old;
          if (row?.user_id === otherUserId && row?.timestamp) {
            setOtherUserLastRead(row.timestamp);
          }
        }
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [conversationId, otherUserId]);

  // All conversations for current user
  useEffect(() => {
    if (!user) return;

    const fetchConversations = async () => {
      const { data, error } = await supabase
        .from('conversations')
        .select('*')
        .contains('participants', [user.id])
        .order('last_message_time', { ascending: false });

      if (error) {
        console.error('Error fetching conversations:', error);
        return;
      }
      setConversations(data || []);
      await calculateUnreadCounts(data || []);
    };

    fetchConversations();

    const channel = supabase
      .channel(`conversations-updates-${user.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'conversations' }, () => fetchConversations())
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user]);

  const calculateUnreadCounts = async (convs: Conversation[]) => {
    if (!user) return;
    const counts: { [key: string]: number } = {};

    for (const conv of convs) {
      try {
        const { data: lastReadData } = await supabase
          .from('last_read')
          .select('timestamp')
          .eq('user_id', user.id)
          .eq('conversation_id', conv.id)
          .maybeSingle();

        const lastReadTime = lastReadData?.timestamp;

        if (!lastReadTime && conv.last_message_time) {
          const { count } = await supabase
            .from('messages')
            .select('*', { count: 'exact', head: true })
            .eq('conversation_id', conv.id)
            .neq('sender_id', user.id);
          counts[conv.id] = count || 0;
        } else if (lastReadTime && conv.last_message_time) {
          const { count } = await supabase
            .from('messages')
            .select('*', { count: 'exact', head: true })
            .eq('conversation_id', conv.id)
            .gt('created_at', lastReadTime)
            .neq('sender_id', user.id);
          counts[conv.id] = count || 0;
        } else {
          counts[conv.id] = 0;
        }
      } catch (e) {
        counts[conv.id] = 0;
      }
    }
    setUnreadCount(counts);
  };

  const sendMessage = async (
    conversationId: string,
    text: string,
    attachment?: AttachmentInput
  ) => {
    if (!user) return;

    let validatedText = text.trim();

    if (!attachment) {
      const validation = messageSchema.safeParse({ text });
      if (!validation.success) throw new Error(validation.error.errors[0].message);
      validatedText = validation.data.text;
    } else if (validatedText.length > 2000) {
      throw new Error('Message must be less than 2000 characters');
    }

    setLoading(true);
    try {
      const { data: senderProfile } = await supabase
        .from('profiles')
        .select('name')
        .eq('id', user.id)
        .maybeSingle();
      const displayName = senderProfile?.name || 'User';

      const { error: messageError } = await supabase.from('messages').insert({
        conversation_id: conversationId,
        sender_id: user.id,
        sender_name: displayName,
        text: validatedText,
        attachment_url: attachment?.url ?? null,
        attachment_type: attachment?.type ?? null,
        attachment_name: attachment?.name ?? null,
        attachment_size: attachment?.size ?? null,
      } as any);

      if (messageError) throw messageError;

      const previewBase = attachment
        ? attachment.type?.startsWith('image/')
          ? '📷 Photo'
          : `📎 ${attachment.name}`
        : validatedText;

      await supabase
        .from('conversations')
        .update({
          last_message: (validatedText || previewBase).substring(0, 255),
          last_message_time: new Date().toISOString(),
        })
        .eq('id', conversationId);
    } catch (error) {
      console.error('Error sending message:', error);
      throw error;
    } finally {
      setLoading(false);
    }
  };

  const uploadAttachment = useCallback(
    async (conversationId: string, file: File): Promise<AttachmentInput> => {
      if (!user) throw new Error('Not authenticated');
      const ext = file.name.split('.').pop() || 'bin';
      const path = `${conversationId}/${crypto.randomUUID()}.${ext}`;

      const { error } = await supabase.storage
        .from('chat-attachments')
        .upload(path, file, { contentType: file.type, upsert: false });
      if (error) throw error;

      const { data: signed, error: signErr } = await supabase.storage
        .from('chat-attachments')
        .createSignedUrl(path, 60 * 60 * 24 * 365);
      if (signErr || !signed?.signedUrl) throw signErr || new Error('Failed to sign URL');

      return {
        url: signed.signedUrl,
        type: file.type || 'application/octet-stream',
        name: file.name,
        size: file.size,
      };
    },
    [user]
  );

  const markAsRead = async (conversationId: string) => {
    if (!user) return;
    try {
      const { error } = await supabase
        .from('last_read')
        .upsert(
          { user_id: user.id, conversation_id: conversationId, timestamp: new Date().toISOString() },
          { onConflict: 'user_id,conversation_id' }
        );
      if (error) throw error;
      setUnreadCount((prev) => ({ ...prev, [conversationId]: 0 }));
    } catch (error) {
      console.error('Error marking conversation as read:', error);
    }
  };

  const createConversation = async (
    participantIds: string[],
    participantNames: { [key: string]: string },
    trainNumber?: string,
    travelDate?: string
  ) => {
    if (!user) return null;
    try {
      const { data, error } = await supabase
        .from('conversations')
        .insert({
          participants: participantIds,
          participant_names: participantNames,
          train_number: trainNumber || null,
          travel_date: travelDate || null,
          last_message: '',
          last_message_time: new Date().toISOString(),
        })
        .select()
        .single();
      if (error) throw error;
      return data.id;
    } catch (error) {
      console.error('Error creating conversation:', error);
      throw error;
    }
  };

  const getTotalUnreadCount = () => Object.values(unreadCount).reduce((t, c) => t + c, 0);

  const deleteChat = async (conversationId: string) => {
    if (!user) return;
    try {
      const { error } = await supabase.rpc('soft_delete_conversation' as any, {
        conv_id: conversationId,
        user_id_to_add: user.id,
      });
      if (error) throw error;
      setConversations((prev) => prev.filter((c) => c.id !== conversationId));
    } catch (error) {
      console.error('Error deleting chat:', error);
      throw error;
    }
  };

  return {
    messages,
    conversations,
    unreadCount,
    loading,
    otherUserLastRead,
    sendMessage,
    uploadAttachment,
    markAsRead,
    createConversation,
    getTotalUnreadCount,
    deleteChat,
  };
};
