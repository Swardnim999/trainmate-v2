import { useEffect, useMemo, useState } from 'react';
import { requestsApi } from '@/lib/api/requests.api';
import { CompanionRequest } from '@/lib/api/types';
import { useAuth } from '@/hooks/useAuth';

export interface AcceptedCompanion {
  otherUserId: string;
  otherUserName?: string;
  otherUserEmail?: string;
  trainNumber?: string;
  travelDate?: string;
  latestRequestId: string;
  direction: 'sent' | 'received';
  createdAt?: Date;
}

export const useAcceptedCompanions = () => {
  const { user } = useAuth();
  const [acceptedRequests, setAcceptedRequests] = useState<CompanionRequest[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      setAcceptedRequests([]);
      setLoading(false);
      return;
    }

    const fetchAccepted = async () => {
      try {
        const data = await requestsApi.getAcceptedCompanions();
        setAcceptedRequests(data);
      } catch (error) {
        console.error('useAcceptedCompanions - Error:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchAccepted();
  }, [user]);

  // Merge into a single companions array keyed by otherUserId
  const companions = useMemo<AcceptedCompanion[]>(() => {
    if (!user) return [];

    const map = new Map<string, AcceptedCompanion>();

    acceptedRequests.forEach((req) => {
      const fromId = req.from_user_id || req.fromUserId || '';
      const toId = req.to_user_id || req.toUserId || '';
      const isSent = fromId === user.id;
      const direction: 'sent' | 'received' = isSent ? 'sent' : 'received';
      const otherUserId = isSent ? toId : fromId;
      const otherUserName = isSent
        ? req.to_name || req.toName
        : req.from_name || req.fromName;
      const trainNumber = req.train_number || req.trainNumber;
      const travelDate = req.travel_date || req.travelDate;
      const createdAt = req.created_at || req.createdAt ? new Date(req.created_at || req.createdAt!) : undefined;

      const candidate: AcceptedCompanion = {
        otherUserId,
        otherUserName: otherUserName || undefined,
        otherUserEmail: undefined, // Email privacy preserved
        trainNumber: trainNumber || undefined,
        travelDate: travelDate || undefined,
        latestRequestId: req.id,
        direction,
        createdAt,
      };

      const current = map.get(otherUserId);
      if (!current) {
        map.set(otherUserId, candidate);
      } else {
        const currentTime = current.createdAt?.getTime() ?? 0;
        const candTime = candidate.createdAt?.getTime() ?? 0;
        if (candTime >= currentTime) {
          map.set(otherUserId, candidate);
        }
      }
    });

    return Array.from(map.values());
  }, [user, acceptedRequests]);

  return { companions, loading };
};
