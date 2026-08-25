import { describe, expect, it } from 'vitest';
import {
  normalizeAttachmentPath,
  normalizeAvatarPath,
} from '../../src/../../migration/normalize-storage-urls.js';

describe('normalizeAvatarPath', () => {
  it('returns null for empty, null, or undefined input', () => {
    expect(normalizeAvatarPath(null)).toBeNull();
    expect(normalizeAvatarPath(undefined)).toBeNull();
    expect(normalizeAvatarPath('')).toBeNull();
    expect(normalizeAvatarPath('   ')).toBeNull();
  });

  it('normalizes legacy Supabase 1-year signed URLs', () => {
    const signedUrl =
      'https://dfkbtusmnrhzaonouhsk.supabase.co/storage/v1/object/sign/avatars/550e8400-e29b-41d4-a716-446655440000/avatar.png?token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...';
    expect(normalizeAvatarPath(signedUrl)).toBe('550e8400-e29b-41d4-a716-446655440000/avatar.png');
  });

  it('normalizes legacy Supabase public URLs', () => {
    const publicUrl =
      'https://dfkbtusmnrhzaonouhsk.supabase.co/storage/v1/object/public/avatars/user-123/profile.jpg';
    expect(normalizeAvatarPath(publicUrl)).toBe('user-123/profile.jpg');
  });

  it('preserves already-canonical relative paths', () => {
    expect(normalizeAvatarPath('550e8400-e29b-41d4-a716-446655440000/avatar.png')).toBe(
      '550e8400-e29b-41d4-a716-446655440000/avatar.png',
    );
    expect(normalizeAvatarPath('avatars/user-123/avatar.png')).toBe('user-123/avatar.png');
  });
});

describe('normalizeAttachmentPath', () => {
  it('returns null for empty, null, or undefined input', () => {
    expect(normalizeAttachmentPath(null)).toBeNull();
    expect(normalizeAttachmentPath(undefined)).toBeNull();
    expect(normalizeAttachmentPath('')).toBeNull();
  });

  it('normalizes legacy Supabase signed attachment URLs', () => {
    const signedUrl =
      'https://dfkbtusmnrhzaonouhsk.supabase.co/storage/v1/object/sign/chat-attachments/conv-abc-123/ticket.pdf?token=xyz123';
    expect(normalizeAttachmentPath(signedUrl)).toBe('conv-abc-123/ticket.pdf');
  });

  it('normalizes legacy Supabase public attachment URLs', () => {
    const publicUrl =
      'https://dfkbtusmnrhzaonouhsk.supabase.co/storage/v1/object/public/chat-attachments/conv-456/photo.png';
    expect(normalizeAttachmentPath(publicUrl)).toBe('conv-456/photo.png');
  });

  it('preserves already-canonical relative paths', () => {
    expect(normalizeAttachmentPath('conv-abc-123/ticket.pdf')).toBe('conv-abc-123/ticket.pdf');
    expect(normalizeAttachmentPath('chat-attachments/conv-abc-123/ticket.pdf')).toBe(
      'conv-abc-123/ticket.pdf',
    );
  });
});
