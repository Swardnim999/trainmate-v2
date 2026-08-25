import { useState, useEffect, useCallback } from 'react';
import { conversationsApi } from '@/lib/api/conversations.api';
import { messagesApi } from '@/lib/api/messages.api';
import { socketManager } from '@/integrations/sockets/socket';
import { useAuth } from '@/hooks/useAuth';
import { messageSchema } from '@/lib/validations';
import { Message, Conversation } from '@/lib/api/types';

export type { Message, Conversation };

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
      try {
        const data = await messagesApi.getMessages(conversationId);
        setMessages(data || []);
      } catch (error) {
        console.error('Error fetching messages:', error);
      }
    };

    fetchMessages();

    socketManager.joinConversation(conversationId);

    const unsubscribe = socketManager.onMessage((newMessage: Message) => {
      const msgConvId = newMessage.conversation_id || newMessage.conversationId;
      if (msgConvId === conversationId) {
        setMessages((prev) => {
          if (prev.some((m) => m.id === newMessage.id)) return prev;
          return [...prev, newMessage];
        });
      }
    });

    return () => {
      unsubscribe();
      socketManager.leaveConversation(conversationId);
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
      try {
        const timestamp = await messagesApi.getLastRead(conversationId, otherUserId);
        if (!cancelled) setOtherUserLastRead(timestamp);
      } catch {
        if (!cancelled) setOtherUserLastRead(null);
      }
    };

    fetchLastRead();

    const unsubscribe = socketManager.onLastRead((payload) => {
      if (payload.conversationId === conversationId && payload.userId === otherUserId) {
        setOtherUserLastRead(payload.timestamp);
      }
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [conversationId, otherUserId]);

  const calculateUnreadCounts = useCallback(async (convs: Conversation[]) => {
    const counts: { [key: string]: number } = {};
    for (const conv of convs) {
      try {
        const count = await messagesApi.getUnreadCount(conv.id);
        counts[conv.id] = count;
      } catch {
        counts[conv.id] = 0;
      }
    }
    setUnreadCount(counts);
  }, []);

  const fetchConversations = useCallback(async () => {
    if (!user) return;
    try {
      const data = await conversationsApi.getConversations();
      setConversations(data || []);
      await calculateUnreadCounts(data || []);
    } catch (error) {
      console.error('Error fetching conversations:', error);
    }
  }, [user, calculateUnreadCounts]);

  // All conversations for current user
  useEffect(() => {
    if (!user) return;

    fetchConversations();

    const unsubscribe = socketManager.onConversationUpdated(() => {
      fetchConversations();
    });

    return () => {
      unsubscribe();
    };
  }, [user, fetchConversations]);

  const sendMessage = async (
    targetConvId: string,
    text: string,
    attachment?: AttachmentInput,
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
      await messagesApi.sendMessage(targetConvId, {
        text: validatedText,
        attachmentUrl: attachment?.url ?? null,
        attachmentType: attachment?.type ?? null,
        attachmentName: attachment?.name ?? null,
        attachmentSize: attachment?.size ?? null,
      });
      fetchConversations();
    } catch (error) {
      console.error('Error sending message:', error);
      throw error;
    } finally {
      setLoading(false);
    }
  };

  const uploadAttachment = useCallback(
    async (_targetConvId: string, file: File): Promise<AttachmentInput> => {
      if (!user) throw new Error('Not authenticated');
      return messagesApi.uploadAttachment(file);
    },
    [user],
  );

  const markAsRead = async (targetConvId: string) => {
    if (!user) return;
    try {
      await messagesApi.markAsRead(targetConvId);
      setUnreadCount((prev) => ({ ...prev, [targetConvId]: 0 }));
    } catch (error) {
      console.error('Error marking conversation as read:', error);
    }
  };

  const createConversation = async (
    participantIds: string[],
    participantNames: { [key: string]: string },
    trainNumber?: string,
    travelDate?: string,
  ) => {
    if (!user) return null;
    try {
      const conv = await conversationsApi.createConversation({
        participants: participantIds,
        participantNames,
        trainNumber: trainNumber || null,
        travelDate: travelDate || null,
      });
      return conv.id;
    } catch (error) {
      console.error('Error creating conversation:', error);
      throw error;
    }
  };

  const getTotalUnreadCount = () => Object.values(unreadCount).reduce((t, c) => t + c, 0);

  const deleteChat = async (targetConvId: string) => {
    if (!user) return;
    try {
      await conversationsApi.softDeleteConversation(targetConvId);
      setConversations((prev) => prev.filter((c) => c.id !== targetConvId));
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
