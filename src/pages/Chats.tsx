import { useAuth } from '@/hooks/useAuth';
import { useNavigate } from 'react-router-dom';
import { useEffect, useMemo } from 'react';
import { MessageCircle, Train, Calendar, ArrowLeft, Ban } from 'lucide-react';
import { useChat } from '@/hooks/useChat';
import { UnreadBadge } from '@/components/UnreadBadge';
import { useAcceptedCompanions } from '@/hooks/useAcceptedCompanions';
import { useBlockedUsers } from '@/hooks/useBlockedUsers';
import { SkeletonCard } from '@/components/SkeletonCard';
import { EmptyState } from '@/components/EmptyState';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import dashboardBg from '@/assets/dashboard-bg.png';
import { supabase } from '@/integrations/supabase/client';

const Chats = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { conversations, unreadCount, loading, getTotalUnreadCount, createConversation } = useChat();
  const { companions, loading: companionsLoading } = useAcceptedCompanions();
  const { blockedUsers, unblockUser } = useBlockedUsers();

  // Blocked companions disappear from `requests` (RLS hides blocked pairs), but the
  // conversation row is still readable. Rebuild those entries from conversations.
  const listItems = useMemo(() => {
    if (!user) return [] as Array<{
      otherUserId: string;
      otherUserName?: string;
      otherUserEmail?: string;
      trainNumber?: string;
      travelDate?: string;
      blocked: boolean;
      conversationId?: string;
    }>;

    const map = new Map<string, {
      otherUserId: string;
      otherUserName?: string;
      otherUserEmail?: string;
      trainNumber?: string;
      travelDate?: string;
      blocked: boolean;
      conversationId?: string;
    }>();

    companions.forEach((c) => {
      map.set(c.otherUserId, {
        otherUserId: c.otherUserId,
        otherUserName: c.otherUserName,
        otherUserEmail: c.otherUserEmail,
        trainNumber: c.trainNumber,
        travelDate: c.travelDate,
        blocked: blockedUsers.includes(c.otherUserId),
      });
    });

    conversations.forEach((conv) => {
      if (!Array.isArray(conv.participants)) return;
      const otherId = conv.participants.find((p) => p !== user.id);
      if (!otherId) return;

      const existing = map.get(otherId);
      if (existing) {
        map.set(otherId, { ...existing, conversationId: conv.id });
        return;
      }
      if (!blockedUsers.includes(otherId)) return;

      const names = (conv.participant_names || {}) as Record<string, string>;
      map.set(otherId, {
        otherUserId: otherId,
        otherUserName: names[otherId],
        trainNumber: conv.train_number || undefined,
        travelDate: conv.travel_date || undefined,
        blocked: true,
        conversationId: conv.id,
      });
    });

    return Array.from(map.values());
  }, [user, companions, conversations, blockedUsers]);


  useEffect(() => {
    document.body.classList.add('dashboard-body');
    document.body.style.backgroundImage = `url(${dashboardBg})`;
    return () => {
      document.body.classList.remove('dashboard-body');
      document.body.style.backgroundImage = '';
    };
  }, []);

  const openChat = async (
    otherUserId: string,
    otherUserName?: string,
    trainNumber?: string,
    travelDate?: string,
    blocked?: boolean
  ) => {
    if (!user) return;

    const existing = conversations.find(
      (c) => Array.isArray(c.participants) && c.participants.includes(user.id) && c.participants.includes(otherUserId)
    );

    let conversationId = existing?.id;

    if (!conversationId) {
      // Blocked pairs cannot create conversations (enforced server-side)
      if (blocked) return;

      // Fetch current user's display name to avoid storing email in participant_names
      const { data: meProfile } = await supabase
        .from('profiles')
        .select('name')
        .eq('id', user.id)
        .maybeSingle();
      const myDisplayName = meProfile?.name || 'You';

      const participantNames: { [key: string]: string } = {
        [user.id]: myDisplayName,
        [otherUserId]: otherUserName || 'User',
      };
      conversationId = await createConversation(
        [user.id, otherUserId],
        participantNames,
        trainNumber,
        travelDate
      );
      if (!conversationId) return;
    }

    navigate(`/chat/${conversationId}`, {
      state: {
        conversationId,
        otherUser: { id: otherUserId, name: otherUserName || 'User' },
        trainNumber,
        travelDate,
      },
    });
  };

  const handleUnblock = async (otherUserId: string) => {
    const success = await unblockUser(otherUserId);
    if (success) {
      toast({ title: 'User unblocked', description: 'You can now message this user again.' });
    } else {
      toast({ title: 'Error', description: 'Failed to unblock user. Please try again.', variant: 'destructive' });
    }
  };

  const isLoading = loading || companionsLoading;

  return (
    <div className="dashboard-bg min-h-screen">
      <div className="relative z-10 container mx-auto px-4 py-8">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center gap-3 mb-8">
            <button
              onClick={() => navigate(-1)}
              className="glass-icon-button mr-2"
            >
              <ArrowLeft className="h-5 w-5 text-white/80" />
            </button>
            <div className="relative">
              <MessageCircle className="h-8 w-8 text-blue-400" />
              <UnreadBadge count={getTotalUnreadCount()} className="-top-2 -right-2" />
            </div>
            <h1 className="text-3xl font-bold text-white">My Chats</h1>
            {getTotalUnreadCount() > 0 && (
              <span className="text-sm text-white/50">
                ({getTotalUnreadCount()} unread)
              </span>
            )}
          </div>

          {isLoading ? (
            <div className="space-y-4">
              <SkeletonCard />
              <SkeletonCard />
              <SkeletonCard />
            </div>
          ) : listItems.length === 0 ? (
            <EmptyState
              icon={MessageCircle}
              title="No accepted companions yet"
              description="Once a travel request is accepted (either direction), you'll see them here."
              actionLabel="Find Companions"
              onAction={() => navigate('/matched')}
              secondaryActionLabel="View Requests"
              onSecondaryAction={() => navigate('/requests')}
            />
          ) : (
            <div className="space-y-4">
              {listItems.map((c) => {
                const existing = conversations.find(
                  (conv) => Array.isArray(conv.participants) && conv.participants.includes(user!.id) && conv.participants.includes(c.otherUserId)
                );
                const unreadForConv = existing ? (unreadCount[existing.id] || 0) : 0;
                const lastMessage = existing?.last_message;

                return (
                  <div
                    key={c.otherUserId}
                    className="glass-card-hover p-6 relative z-10 cursor-pointer rounded-2xl hover:shadow-[0_0_40px_rgba(59,130,246,0.25)] hover:-translate-y-1 transition-all duration-300"
                    onClick={() => openChat(c.otherUserId, c.otherUserName || c.otherUserEmail || 'User', c.trainNumber, c.travelDate, c.blocked)}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <h3 className="text-lg font-semibold text-white truncate">
                            {c.otherUserName || c.otherUserEmail || 'User'}
                          </h3>
                          {c.blocked && (
                            <span className="flex items-center gap-1 border border-red-400/30 bg-red-500/15 text-red-200 text-xs px-2 py-0.5 rounded-full shrink-0">
                              <Ban className="h-3 w-3" />
                              Blocked
                            </span>
                          )}
                          {unreadForConv > 0 && (
                            <span className="bg-destructive text-destructive-foreground text-xs px-2 py-0.5 rounded-full shrink-0">
                              {unreadForConv}
                            </span>
                          )}
                        </div>

                        {lastMessage && (
                          <p className="text-sm text-muted-foreground truncate mb-2">
                            {lastMessage}
                          </p>
                        )}

                        <div className="flex items-center gap-4 text-xs text-muted-foreground/70">
                          {c.trainNumber && (
                            <div className="flex items-center gap-1">
                              <Train className="h-3.5 w-3.5 shrink-0" />
                              <span>Train {c.trainNumber}</span>
                            </div>
                          )}
                          {c.travelDate && (
                            <div className="flex items-center gap-1">
                              <Calendar className="h-3.5 w-3.5 shrink-0" />
                              <span>{c.travelDate}</span>
                            </div>
                          )}
                        </div>

                        {c.blocked && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleUnblock(c.otherUserId);
                            }}
                            className="mt-3 border-white/20 bg-white/5 text-white hover:bg-white/10"
                          >
                            Unblock User
                          </Button>
                        )}
                      </div>
                      <div className="relative ml-4">
                        <div className="glass-icon-button text-blue-400">
                          <MessageCircle className="h-5 w-5" />
                          <UnreadBadge count={unreadForConv} />
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

        </div>
      </div>
    </div>
  );
};

export default Chats;

