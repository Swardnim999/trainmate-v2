import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

interface Request {
  id: string;
  from_user_id: string;
  from_email: string | null;
  from_name: string | null;
  to_user_id: string;
  to_email: string | null;
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
      const { data, error } = await supabase
        .from('requests')
        .select('*')
        .or(`from_user_id.eq.${user.id},to_user_id.eq.${user.id}`)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setRequests(data || []);
    } catch (error) {
      console.error('Error fetching requests:', error);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    fetchRequests();
  }, [fetchRequests]);

  // Get request status between current user and another user for a specific journey
  const getRequestStatus = useCallback((
    otherUserId: string, 
    trainNumber?: string, 
    travelDate?: string
  ): { status: RequestStatus; request: Request | null } => {
    if (!user) return { status: 'none', request: null };

    // Find request matching the user pair and optionally journey
    const request = requests.find(r => {
      const isMatch = (
        (r.from_user_id === user.id && r.to_user_id === otherUserId) ||
        (r.to_user_id === user.id && r.from_user_id === otherUserId)
      );
      
      if (!isMatch) return false;
      
      // If train/date provided, also match those
      if (trainNumber && travelDate) {
        return r.train_number === trainNumber && r.travel_date === travelDate;
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
  }, [requests, user]);

  const cancelRequest = async (requestId: string) => {
    try {
      const { error } = await supabase
        .from('requests')
        .delete()
        .eq('id', requestId);

      if (error) throw error;
      
      setRequests(prev => prev.filter(r => r.id !== requestId));
      return true;
    } catch (error) {
      console.error('Error canceling request:', error);
      return false;
    }
  };

  const acceptRequest = async (requestId: string) => {
    try {
      const { error } = await supabase
        .from('requests')
        .update({ status: 'accepted' })
        .eq('id', requestId);

      if (error) throw error;
      
      setRequests(prev => prev.map(r => 
        r.id === requestId ? { ...r, status: 'accepted' } : r
      ));
      return true;
    } catch (error) {
      console.error('Error accepting request:', error);
      return false;
    }
  };

  const rejectRequest = async (requestId: string) => {
    try {
      const { error } = await supabase
        .from('requests')
        .update({ status: 'rejected' })
        .eq('id', requestId);

      if (error) throw error;
      
      setRequests(prev => prev.map(r => 
        r.id === requestId ? { ...r, status: 'rejected' } : r
      ));
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
      // Get expired pending requests where current user is the sender
      const { data: expiredRequests, error: fetchError } = await supabase
        .from('requests')
        .select('id')
        .eq('from_user_id', user.id)
        .eq('status', 'pending')
        .lt('travel_date', cutoffDate);

      if (fetchError) throw fetchError;

      if (expiredRequests && expiredRequests.length > 0) {
        const ids = expiredRequests.map(r => r.id);
        const { error: deleteError } = await supabase
          .from('requests')
          .delete()
          .in('id', ids);

        if (deleteError) throw deleteError;
        
        // Update local state
        setRequests(prev => prev.filter(r => !ids.includes(r.id)));
        console.log(`Cleaned up ${ids.length} expired request(s)`);
      }
    } catch (error) {
      console.error('Error cleaning up expired requests:', error);
    }
  }, [user]);

  // Filter helpers
  const getPendingIncoming = useCallback(() => {
    if (!user) return [];
    return requests.filter(r => r.to_user_id === user.id && r.status === 'pending');
  }, [requests, user]);

  const getPendingOutgoing = useCallback(() => {
    if (!user) return [];
    return requests.filter(r => r.from_user_id === user.id && r.status === 'pending');
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
    getPendingOutgoing
  };
};
