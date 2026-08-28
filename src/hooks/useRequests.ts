import { useState, useEffect, useCallback } from 'react';
import { requestsApi } from '@/lib/api/requests.api';
import { CompanionRequest } from '@/lib/api/types';
import { useAuth } from '@/hooks/useAuth';
import { socketManager } from '@/integrations/sockets';

export interface Request {
  id: string;
  from_user_id: string;
  from_email?: string | null;
  from_name: string | null;
  to_user_id: string;
  to_email?: string | null;
  to_name: string | null;
  train_number: string | null;
  travel_date: string | null;
  boarding_station: string | null;
  destination_station: string | null;
  status: string;
  created_at: string;
}

export type RequestStatus =
  | 'none'
  | 'outgoing_pending'
  | 'incoming_pending'
  | 'accepted'
  | 'rejected';

export const useRequests = () => {
  const { user } = useAuth();
  const [requests, setRequests] = useState<Request[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchRequests = useCallback(async () => {
    if (!user) return;

    try {
      const data = await requestsApi.getMyRequests('all');
      const mapped: Request[] = data.map((r: CompanionRequest) => ({
        id: r.id,
        from_user_id: r.from_user_id || r.fromUserId || '',
        from_email: null,
        from_name: r.from_name || r.fromName || null,
        to_user_id: r.to_user_id || r.toUserId || '',
        to_email: null,
        to_name: r.to_name || r.toName || null,
        train_number: r.train_number || r.trainNumber || null,
        travel_date: r.travel_date || r.travelDate || null,
        boarding_station: r.boarding_station || r.boardingStation || null,
        destination_station: r.destination_station || r.destinationStation || null,
        status: r.status,
        created_at: r.created_at || r.createdAt || new Date().toISOString(),
      }));
      setRequests(mapped);
    } catch (error) {
      console.error('Error fetching requests:', error);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    fetchRequests();

    const unsubNew = socketManager.onRequestNew(() => {
      fetchRequests();
    });
    const unsubUpdated = socketManager.onRequestUpdated(() => {
      fetchRequests();
    });

    return () => {
      unsubNew();
      unsubUpdated();
    };
  }, [fetchRequests]);

  // Get request status between current user and another user for a specific journey
  const getRequestStatus = useCallback(
    (
      otherUserId: string,
      trainNumber?: string,
      travelDate?: string,
    ): { status: RequestStatus; request: Request | null } => {
      if (!user) return { status: 'none', request: null };

      // Find request matching the user pair and optionally journey
      const request = requests.find((r) => {
        const isMatch =
          (r.from_user_id === user.id && r.to_user_id === otherUserId) ||
          (r.to_user_id === user.id && r.from_user_id === otherUserId);

        if (!isMatch) return false;

        // If train/date provided, also match those
        if (trainNumber && travelDate) {
          const reqDate = r.travel_date ? r.travel_date.split('T')[0] : '';
          const targetDate = travelDate.split('T')[0];
          return r.train_number === trainNumber && reqDate === targetDate;
        }

        return true;
      });

      if (!request) return { status: 'none', request: null };

      if (request.status === 'accepted') {
        return { status: 'accepted', request };
      }

      if (request.status === 'rejected') {
        return { status: 'rejected', request };
      }

      // Pending request
      if (request.from_user_id === user.id) {
        return { status: 'outgoing_pending', request };
      } else {
        return { status: 'incoming_pending', request };
      }
    },
    [requests, user],
  );

  const cancelRequest = async (requestId: string) => {
    try {
      await requestsApi.cancelRequest(requestId);
      setRequests((prev) => prev.filter((r) => r.id !== requestId));
      return true;
    } catch (error) {
      console.error('Error canceling request:', error);
      return false;
    }
  };

  const acceptRequest = async (requestId: string) => {
    try {
      await requestsApi.acceptRequest(requestId);
      setRequests((prev) =>
        prev.map((r) => (r.id === requestId ? { ...r, status: 'accepted' } : r)),
      );
      return true;
    } catch (error) {
      console.error('Error accepting request:', error);
      return false;
    }
  };

  const rejectRequest = async (requestId: string) => {
    try {
      await requestsApi.rejectRequest(requestId);
      setRequests((prev) =>
        prev.map((r) => (r.id === requestId ? { ...r, status: 'rejected' } : r)),
      );
      return true;
    } catch (error) {
      console.error('Error rejecting request:', error);
      return false;
    }
  };

  // Clean up expired pending requests (journey date + 2 days)
  const cleanupExpiredRequests = useCallback(async () => {
    if (!user) return;

    const twoDaysAgo = new Date();
    twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
    const cutoffDate = twoDaysAgo.toISOString().split('T')[0];

    try {
      const res = await requestsApi.cleanupExpired(cutoffDate);
      if (res.count > 0) {
        fetchRequests();
      }
    } catch (error) {
      console.error('Error cleaning up expired requests:', error);
    }
  }, [user, fetchRequests]);

  // Filter helpers
  const getPendingIncoming = useCallback(() => {
    if (!user) return [];
    return requests.filter((r) => r.to_user_id === user.id && r.status === 'pending');
  }, [requests, user]);

  const getPendingOutgoing = useCallback(() => {
    if (!user) return [];
    return requests.filter((r) => r.from_user_id === user.id && r.status === 'pending');
  }, [requests, user]);

  return {
    requests,
    loading,
    fetchRequests,
    getRequestStatus,
    cancelRequest,
    acceptRequest,
    rejectRequest,
    cleanupExpiredRequests,
    getPendingIncoming,
    getPendingOutgoing,
  };
};
