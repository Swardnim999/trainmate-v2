import type { Message, LastRead } from '@prisma/client';

export interface SerializedMessage {
  id: string;
  conversationId: string;
  conversation_id: string;
  senderId: string;
  sender_id: string;
  senderName: string | null;
  sender_name: string | null;
  text: string;
  attachmentUrl: string | null;
  attachment_url: string | null;
  attachmentType: string | null;
  attachment_type: string | null;
  attachmentName: string | null;
  attachment_name: string | null;
  attachmentSize: number | null;
  attachment_size: number | null;
  createdAt: string;
  created_at: string;
}

export interface SerializedLastRead {
  timestamp: string | null;
}

export interface SerializedUnreadCount {
  count: number;
}

/**
 * Serializes Message models into API responses (Spec §3.2, §6.5, §9.6; Messages-Design §11).
 * Dual camelCase and snake_case properties are emitted for full backward compatibility
 * with existing frontend hooks and components (`useChat.tsx`, `Chat.tsx`).
 *
 * Handles BigInt safely: converts `attachmentSize` to `number | null`.
 * Strictly enforces Email Privacy: NO email fields are ever included.
 */
export class MessageSerializer {
  static toResponse(message: Message): SerializedMessage {
    const sizeNumber =
      message.attachmentSize !== null && message.attachmentSize !== undefined
        ? Number(message.attachmentSize)
        : null;

    return {
      id: message.id,
      conversationId: message.conversationId,
      conversation_id: message.conversationId,
      senderId: message.senderId,
      sender_id: message.senderId,
      senderName: message.senderName,
      sender_name: message.senderName,
      text: message.text,
      attachmentUrl: message.attachmentUrl,
      attachment_url: message.attachmentUrl,
      attachmentType: message.attachmentType,
      attachment_type: message.attachmentType,
      attachmentName: message.attachmentName,
      attachment_name: message.attachmentName,
      attachmentSize: sizeNumber,
      attachment_size: sizeNumber,
      createdAt: message.createdAt.toISOString(),
      created_at: message.createdAt.toISOString(),
    };
  }

  static toResponseList(messages: Message[]): SerializedMessage[] {
    return messages.map((m) => this.toResponse(m));
  }

  static toLastReadResponse(lastRead: LastRead | null): SerializedLastRead {
    return {
      timestamp: lastRead ? lastRead.timestamp.toISOString() : null,
    };
  }

  static toUnreadCountResponse(count: number): SerializedUnreadCount {
    return {
      count,
    };
  }
}
