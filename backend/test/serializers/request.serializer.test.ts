import { describe, it, expect } from 'vitest';
import type { Request } from '@prisma/client';
import { RequestSerializer } from '../../src/serializers/request.serializer.js';

describe('RequestSerializer', () => {
  const mockRequest: Request = {
    id: '11111111-1111-1111-1111-111111111111',
    fromUserId: 'aaaa0000-0000-0000-0000-000000000000',
    fromEmail: 'secret-sender@example.com',
    fromName: 'Aarav Sharma',
    toUserId: 'bbbb0000-0000-0000-0000-000000000000',
    toEmail: 'secret-recipient@example.com',
    toName: 'Priya Patel',
    trainNumber: '12951',
    travelDate: new Date('2026-09-15T00:00:00.000Z'),
    boardingStation: 'Mumbai Central',
    destinationStation: 'New Delhi',
    status: 'pending',
    createdAt: new Date('2026-08-24T12:00:00.000Z'),
    updatedAt: new Date('2026-08-24T12:00:00.000Z'),
  };

  it('serializes request with dual camelCase and snake_case properties', () => {
    const serialized = RequestSerializer.toResponse(mockRequest);

    expect(serialized.id).toBe(mockRequest.id);
    expect(serialized.fromUserId).toBe(mockRequest.fromUserId);
    expect(serialized.from_user_id).toBe(mockRequest.fromUserId);
    expect(serialized.fromName).toBe('Aarav Sharma');
    expect(serialized.from_name).toBe('Aarav Sharma');
    expect(serialized.toUserId).toBe(mockRequest.toUserId);
    expect(serialized.to_user_id).toBe(mockRequest.toUserId);
    expect(serialized.toName).toBe('Priya Patel');
    expect(serialized.to_name).toBe('Priya Patel');
    expect(serialized.trainNumber).toBe('12951');
    expect(serialized.train_number).toBe('12951');
    expect(serialized.travelDate).toBe('2026-09-15');
    expect(serialized.travel_date).toBe('2026-09-15');
    expect(serialized.boardingStation).toBe('Mumbai Central');
    expect(serialized.boarding_station).toBe('Mumbai Central');
    expect(serialized.destinationStation).toBe('New Delhi');
    expect(serialized.destination_station).toBe('New Delhi');
    expect(serialized.status).toBe('pending');
    expect(serialized.createdAt).toBe('2026-08-24T12:00:00.000Z');
    expect(serialized.created_at).toBe('2026-08-24T12:00:00.000Z');
    expect(serialized.updatedAt).toBe('2026-08-24T12:00:00.000Z');
    expect(serialized.updated_at).toBe('2026-08-24T12:00:00.000Z');
  });

  it('strictly enforces the Email Privacy Invariant (from_email and to_email omitted)', () => {
    const serialized = RequestSerializer.toResponse(mockRequest) as unknown as Record<
      string,
      unknown
    >;

    expect(serialized['fromEmail']).toBeUndefined();
    expect(serialized['from_email']).toBeUndefined();
    expect(serialized['toEmail']).toBeUndefined();
    expect(serialized['to_email']).toBeUndefined();
    expect(JSON.stringify(serialized)).not.toContain('secret-sender@example.com');
    expect(JSON.stringify(serialized)).not.toContain('secret-recipient@example.com');
  });

  it('serializes request with null optional fields correctly', () => {
    const nullFieldsRequest: Request = {
      ...mockRequest,
      fromName: null,
      toName: null,
      trainNumber: null,
      travelDate: null,
      boardingStation: null,
      destinationStation: null,
    };

    const serialized = RequestSerializer.toResponse(nullFieldsRequest);
    expect(serialized.fromName).toBeNull();
    expect(serialized.from_name).toBeNull();
    expect(serialized.toName).toBeNull();
    expect(serialized.to_name).toBeNull();
    expect(serialized.trainNumber).toBeNull();
    expect(serialized.train_number).toBeNull();
    expect(serialized.travelDate).toBeNull();
    expect(serialized.travel_date).toBeNull();
  });

  it('serializes a list of requests', () => {
    const list = RequestSerializer.toResponseList([mockRequest]);
    expect(list).toHaveLength(1);
    expect(list[0]?.id).toBe(mockRequest.id);
  });
});
