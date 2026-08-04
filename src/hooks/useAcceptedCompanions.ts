import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
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

interface RequestDoc {
  id: string;
  from_user_id: string;
  from_email?: string | null;
  from_name?: string | null;
  to_user_id: string;
  to_email?: string | null;
  to_name?: string | null;
  status: string;
  train_number?: string | null;
  travel_date?: string | null;
  created_at?: string;
}

export const useAcceptedCompanions = () => {
  const { user } = useAuth();
  const [sentAccepted, setSentAccepted] = useState<RequestDoc[]>([]);
  const [receivedAccepted, setReceivedAccepted] = useState<RequestDoc[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      setSentAccepted([]);
      setReceivedAccepted([]);
      setLoading(false);
      return;
    }

    const fetchAcceptedRequests = async () => {
      try {
        // Fetch accepted requests I SENT
        const { data: sent, error: sentError } = await supabase
          .from('requests')
          .select('*')
          .eq('from_user_id', user.id)
          .eq('status', 'accepted');

        if (sentError) throw sentError;
        setSentAccepted(sent || []);

        // Fetch accepted requests I RECEIVED
        const { data: received, error: receivedError } = await supabase
          .from('requests')
          .select('*')
          .eq('to_user_id', user.id)
          .eq('status', 'accepted');

        if (receivedError) throw receivedError;
        setReceivedAccepted(received || []);
      } catch (error) {
        console.error('useAcceptedCompanions - Error:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchAcceptedRequests();

    // Set up realtime subscriptions for requests
    const channel = supabase
      .channel('requests-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'requests',
          filter: `from_user_id=eq.${user.id}`
        },
        () => fetchAcceptedRequests()
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'requests',
          filter: `to_user_id=eq.${user.id}`
        },
        () => fetchAcceptedRequests()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user]);

  // Merge both sent and received into a single companions array
  const companions = useMemo<AcceptedCompanion[]>(() => {
    if (!user) return [];

    const pickDate = (val: any): Date | undefined => {
      if (!val) return undefined;
      return new Date(val);
    };

    // Use Map to avoid duplicates (keyed by otherUserId)
    const map = new Map<string, AcceptedCompanion>();

    const ingest = (req: RequestDoc, direction: 'sent' | 'received') => {
      const otherUserId = direction === 'sent' ? req.to_user_id : req.from_user_id;
      const otherUserName = direction === 'sent' ? req.to_name : req.from_name;
      const otherUserEmail = direction === 'sent' ? req.to_email : req.from_email;
      const createdAt = pickDate(req.created_at);

      const current = map.get(otherUserId);
      const candidate: AcceptedCompanion = {
        otherUserId,
        otherUserName: otherUserName || undefined,
        otherUserEmail: otherUserEmail || undefined,
        trainNumber: req.train_number || undefined,
        travelDate: req.travel_date || undefined,
        latestRequestId: req.id,
        direction,
        createdAt,
      };

      if (!current) {
        map.set(otherUserId, candidate);
      } else {
        const currentTime = current.createdAt?.getTime() ?? 0;
        const candTime = candidate.createdAt?.getTime() ?? 0;
        if (candTime >= currentTime) {
          map.set(otherUserId, candidate);
        }
      }
    };

    sentAccepted.forEach((r) => ingest(r, 'sent'));
    receivedAccepted.forEach((r) => ingest(r, 'received'));

    return Array.from(map.values());
  }, [user, sentAccepted, receivedAccepted]);

  return { companions, loading };
};
