/**
 * ==============================================================================
 * TrainMate v2 — Storage URL Normalization Tool (Milestone 14)
 * ==============================================================================
 *
 * Normalizes legacy Supabase 1-year signed URLs in `profiles.avatar_url` and
 * `messages.attachment_url` to canonical storage object paths:
 *   - Legacy avatar: "https://<ref>.supabase.co/storage/v1/object/sign/avatars/<userId>/avatar.png?token=..."
 *     -> Canonical path: "<userId>/avatar.png"
 *   - Legacy attachment: "https://<ref>.supabase.co/storage/v1/object/sign/chat-attachments/<convId>/<file>?token=..."
 *     -> Canonical path: "<convId>/<file>"
 *
 * Preserves already-normalized paths and null values idempotently.
 *
 * Usage:
 *   DATABASE_URL="postgresql://..." npx tsx migration/normalize-storage-urls.ts
 */

import { PrismaClient } from '@prisma/client';

/**
 * Extracts canonical object path from a raw avatar URL or relative path.
 * Examples:
 *   "https://abc.supabase.co/storage/v1/object/sign/avatars/user-123/avatar.png?token=xyz" -> "user-123/avatar.png"
 *   "https://abc.supabase.co/storage/v1/object/public/avatars/user-123/avatar.png" -> "user-123/avatar.png"
 *   "user-123/avatar.png" -> "user-123/avatar.png"
 *   null / undefined / "" -> null
 */
export function normalizeAvatarPath(raw: string | null | undefined): string | null {
  if (!raw || raw.trim().length === 0) return null;
  const trimmed = raw.trim();

  // If already a canonical relative path (e.g. "uuid/avatar.png" or "uuid/custom.jpg")
  if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
    // Strip leading "avatars/" if present
    return trimmed.replace(/^avatars\//, '');
  }

  try {
    const url = new URL(trimmed);
    const pathname = decodeURIComponent(url.pathname);

    // Matches /storage/v1/object/(sign|public)/avatars/(.+)
    const match = pathname.match(/\/storage\/v1\/object\/(?:sign|public)\/avatars\/(.+)$/);
    if (match && match[1]) {
      return match[1];
    }

    // Matches generic /avatars/(.+)
    const fallbackMatch = pathname.match(/\/avatars\/(.+)$/);
    if (fallbackMatch && fallbackMatch[1]) {
      return fallbackMatch[1];
    }

    // If URL cannot be parsed as a known Supabase pattern, keep pathname without leading slash
    return pathname.replace(/^\//, '');
  } catch {
    return trimmed;
  }
}

/**
 * Extracts canonical object path from a raw message attachment URL or relative path.
 * Examples:
 *   "https://abc.supabase.co/storage/v1/object/sign/chat-attachments/conv-123/ticket.pdf?token=xyz" -> "conv-123/ticket.pdf"
 *   "https://abc.supabase.co/storage/v1/object/public/chat-attachments/conv-123/photo.png" -> "conv-123/photo.png"
 *   "conv-123/ticket.pdf" -> "conv-123/ticket.pdf"
 *   null / undefined / "" -> null
 */
export function normalizeAttachmentPath(raw: string | null | undefined): string | null {
  if (!raw || raw.trim().length === 0) return null;
  const trimmed = raw.trim();

  if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
    return trimmed.replace(/^chat-attachments\//, '');
  }

  try {
    const url = new URL(trimmed);
    const pathname = decodeURIComponent(url.pathname);

    const match = pathname.match(/\/storage\/v1\/object\/(?:sign|public)\/chat-attachments\/(.+)$/);
    if (match && match[1]) {
      return match[1];
    }

    const fallbackMatch = pathname.match(/\/chat-attachments\/(.+)$/);
    if (fallbackMatch && fallbackMatch[1]) {
      return fallbackMatch[1];
    }

    return pathname.replace(/^\//, '');
  } catch {
    return trimmed;
  }
}

/**
 * Normalizes all profiles.avatar_url and messages.attachment_url rows in the target DB.
 */
export async function runNormalization(prismaClient?: PrismaClient): Promise<{
  profilesUpdated: number;
  messagesUpdated: number;
}> {
  const prisma = prismaClient ?? new PrismaClient();
  let profilesUpdated = 0;
  let messagesUpdated = 0;

  try {
    console.log('[normalize-storage-urls] Fetching profiles with avatar_url...');
    const profiles = await prisma.profile.findMany({
      where: { avatarUrl: { not: null } },
      select: { id: true, avatarUrl: true },
    });

    for (const profile of profiles) {
      const normalized = normalizeAvatarPath(profile.avatarUrl);
      if (normalized !== profile.avatarUrl) {
        await prisma.profile.update({
          where: { id: profile.id },
          data: { avatarUrl: normalized },
        });
        profilesUpdated++;
      }
    }

    console.log(`[normalize-storage-urls] Normalized ${profilesUpdated} profiles.`);

    console.log('[normalize-storage-urls] Fetching messages with attachment_url...');
    const messages = await prisma.message.findMany({
      where: { attachmentUrl: { not: null } },
      select: { id: true, attachmentUrl: true },
    });

    for (const message of messages) {
      const normalized = normalizeAttachmentPath(message.attachmentUrl);
      if (normalized !== message.attachmentUrl) {
        await prisma.message.update({
          where: { id: message.id },
          data: { attachmentUrl: normalized },
        });
        messagesUpdated++;
      }
    }

    console.log(`[normalize-storage-urls] Normalized ${messagesUpdated} messages.`);
    return { profilesUpdated, messagesUpdated };
  } finally {
    if (!prismaClient) {
      await prisma.$disconnect();
    }
  }
}

// Run CLI when invoked directly
if (process.argv[1]?.endsWith('normalize-storage-urls.ts') || process.argv[1]?.endsWith('normalize-storage-urls.js')) {
  runNormalization()
    .then((res) => {
      console.log(`Normalization complete: ${res.profilesUpdated} profiles, ${res.messagesUpdated} messages.`);
      process.exit(0);
    })
    .catch((err) => {
      console.error('Normalization failed:', err);
      process.exit(1);
    });
}
