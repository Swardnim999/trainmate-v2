import { useEffect, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ArrowLeft, Check, X, Inbox, Send, Train, Calendar, MapPin, User } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { useRequests } from '@/hooks/useRequests';
import { useChat } from '@/hooks/useChat';
import { EmptyState } from '@/components/EmptyState';
import { SkeletonCard } from '@/components/SkeletonCard';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import dashboardBg from '@/assets/dashboard-bg.png';
import { supabase } from '@/integrations/supabase/client';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

const Requests = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { 
    loading, 
    getPendingIncoming, 
    getPendingOutgoing, 
    acceptRequest, 
    rejectRequest, 
    cancelRequest,
    cleanupExpiredRequests,
    fetchRequests
  } = useRequests();
  const { createConversation } = useChat();
  
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [cancelConfirmId, setCancelConfirmId] = useState<string | null>(null);

  const pendingIncoming = getPendingIncoming();
  const pendingOutgoing = getPendingOutgoing();

  // Apply same background as Dashboard
  useEffect(() => {
    document.body.classList.add('dashboard-body');
    document.body.style.backgroundImage = `url(${dashboardBg})`;
    
    return () => {
      document.body.classList.remove('dashboard-body');
      document.body.style.backgroundImage = '';
    };
  }, []);

  // Cleanup expired requests on mount
  useEffect(() => {
    if (user) {
      cleanupExpiredRequests();
    }
  }, [user, cleanupExpiredRequests]);

  const handleAccept = async (request: any) => {
    if (!user) return;
    
    setProcessingId(request.id);
    
    const success = await acceptRequest(request.id);
    if (success) {
      try {
        const { data: meProfile } = await supabase
          .from('profiles')
          .select('name')
          .eq('id', user.id)
          .maybeSingle();
        const myDisplayName = meProfile?.name || 'You';

        const conversationId = await createConversation(
          [user.id, request.from_user_id],
          { 
            [user.id]: myDisplayName, 
            [request.from_user_id]: request.from_name || 'User' 
          },
          request.train_number,
          request.travel_date
        );
        
        toast({
          title: "Request accepted",
          description: "You can now chat with your travel companion!",
        });
        
        navigate(`/chat/${conversationId}`, {
          state: {
            otherUser: { 
              id: request.from_user_id, 
              name: request.from_name, 
              email: request.from_email 
            },
            trainNumber: request.train_number,
            travelDate: request.travel_date
          }
        });
      } catch (error) {
        toast({
          title: "Error",
          description: "Request accepted but failed to create chat. Go to Chats to start messaging.",
          variant: "destructive",
        });
      }
    } else {
      toast({
        title: "Error",
        description: "Failed to accept request",
        variant: "destructive",
      });
    }
    
    setProcessingId(null);
  };

  const handleReject = async (requestId: string) => {
    setProcessingId(requestId);
    
    const success = await rejectRequest(requestId);
    if (success) {
      toast({
        title: "Request rejected",
      });
    } else {
      toast({
        title: "Error",
        description: "Failed to reject request",
        variant: "destructive",
      });
    }
    
    setProcessingId(null);
  };

  const handleCancel = async () => {
    if (!cancelConfirmId) return;
    
    setProcessingId(cancelConfirmId);
    
    const success = await cancelRequest(cancelConfirmId);
    if (success) {
      toast({
        title: "Request cancelled",
      });
    } else {
      toast({
        title: "Error",
        description: "Failed to cancel request",
        variant: "destructive",
      });
    }
    
    setCancelConfirmId(null);
    setProcessingId(null);
  };

  const getInitials = (name?: string, email?: string) => {
    if (name) return name.slice(0, 2).toUpperCase();
    if (email) return email.slice(0, 2).toUpperCase();
    return 'U';
  };

  if (loading) {
    return (
      <div className="dashboard-bg">
        <div className="min-h-screen p-4 md:p-6">
          <div className="max-w-2xl mx-auto">
            <div className="flex items-center gap-4 mb-8">
              <button
                onClick={() => navigate('/dashboard')}
                className="glass-icon-button mr-2"
              >
                <ArrowLeft className="h-5 w-5 text-white/80" />
              </button>
              <h1 className="text-2xl md:text-3xl font-bold text-white">Travel Requests</h1>
            </div>
            <div className="space-y-4">
              <SkeletonCard />
              <SkeletonCard />
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="dashboard-bg">
      <div className="min-h-screen p-4 md:p-6">
        <div className="max-w-2xl mx-auto">
          {/* Header */}
          <div className="flex items-center gap-4 mb-8">
            <button
              onClick={() => navigate('/dashboard')}
              className="glass-icon-button mr-2"
            >
              <ArrowLeft className="h-5 w-5 text-white/80" />
            </button>
            <div>
              <h1 className="text-2xl md:text-3xl font-bold text-white">Travel Requests</h1>
              <p className="text-sm text-white/60 mt-1">Manage your companion requests</p>
            </div>
          </div>

          <Tabs defaultValue="incoming" className="w-full">
            {/* Glass Segmented Tabs */}
            <TabsList className="w-full h-14 p-1.5 rounded-2xl bg-white/5 backdrop-blur-xl border border-white/10 mb-8">
              <TabsTrigger 
                value="incoming" 
                className="flex-1 h-full rounded-xl text-white/60 hover:text-white hover:bg-white/10 transition-all duration-300 data-[state=active]:bg-white/12 data-[state=active]:text-white data-[state=active]:shadow-[0_0_12px_rgba(217,217,255,0.3)] data-[state=active]:border data-[state=active]:border-white/20"
              >
                <Inbox className="h-4 w-4 mr-2" />
                Incoming
                {pendingIncoming.length > 0 && (
                  <Badge className="ml-2 h-5 min-w-5 px-1.5 bg-white/20 text-white border-none text-xs">
                    {pendingIncoming.length}
                  </Badge>
                )}
              </TabsTrigger>
              <TabsTrigger 
                value="outgoing"
                className="flex-1 h-full rounded-xl text-white/60 hover:text-white hover:bg-white/10 transition-all duration-300 data-[state=active]:bg-white/12 data-[state=active]:text-white data-[state=active]:shadow-[0_0_12px_rgba(217,217,255,0.3)] data-[state=active]:border data-[state=active]:border-white/20"
              >
                <Send className="h-4 w-4 mr-2" />
                Outgoing
                {pendingOutgoing.length > 0 && (
                  <Badge className="ml-2 h-5 min-w-5 px-1.5 bg-accent-blue/30 text-white border-none text-xs">
                    {pendingOutgoing.length}
                  </Badge>
                )}
              </TabsTrigger>
            </TabsList>
            
            <TabsContent value="incoming" className="space-y-4 mt-0">
              {pendingIncoming.length === 0 ? (
                <EmptyState
                  icon={Inbox}
                  title="No incoming requests"
                  description="When someone wants to travel with you, their request will appear here."
                  showIllustration={true}
                />
              ) : (
                <div className="space-y-4">
                  {pendingIncoming.map((request) => (
                    <div 
                      key={request.id}
                      className="group relative p-5 rounded-2xl transition-all duration-300 hover:-translate-y-1"
                      style={{
                        backgroundColor: 'rgba(255, 255, 255, 0.05)',
                        backdropFilter: 'blur(40px) saturate(1.5)',
                        WebkitBackdropFilter: 'blur(40px) saturate(1.5)',
                        border: '1px solid rgba(255, 255, 255, 0.1)',
                        boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3)'
                      }}
                    >
                      {/* Hover glow effect */}
                      <div className="absolute inset-0 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none"
                        style={{
                          boxShadow: '0 0 40px rgba(59, 130, 246, 0.15), inset 0 0 20px rgba(255, 255, 255, 0.02)'
                        }}
                      />
                      
                      <div className="relative flex items-start gap-4">
                        <Avatar className="h-12 w-12 border-2 border-white/20 shrink-0">
                          <AvatarImage src={undefined} />
                          <AvatarFallback className="bg-accent-blue/20 text-white font-medium">
                            {getInitials(request.from_name, request.from_email)}
                          </AvatarFallback>
                        </Avatar>
                        
                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-3 mb-2">
                            <div>
                              <p className="font-semibold text-white truncate">
                                {request.from_name || request.from_email || 'Unknown User'}
                              </p>
                              <Badge className="mt-1 bg-amber-500/20 text-amber-300 border-amber-500/30 text-xs">
                                Pending
                              </Badge>
                            </div>
                          </div>
                          
                          <div className="space-y-1.5 mt-3">
                            <div className="flex items-center gap-2 text-sm text-white/60">
                              <Train className="h-3.5 w-3.5" />
                              <span>Train {request.train_number}</span>
                              <span className="text-white/30">•</span>
                              <Calendar className="h-3.5 w-3.5" />
                              <span>{request.travel_date}</span>
                            </div>
                            <div className="flex items-center gap-2 text-sm text-white/60">
                              <MapPin className="h-3.5 w-3.5" />
                              <span className="truncate">{request.boarding_station} → {request.destination_station}</span>
                            </div>
                          </div>
                          
                          <div className="flex gap-3 mt-4">
                            <Button
                              onClick={() => handleAccept(request)}
                              size="sm"
                              disabled={processingId === request.id}
                              className="flex-1 bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/30 hover:border-emerald-500/50 hover:shadow-[0_0_20px_rgba(16,185,129,0.2)] transition-all duration-300"
                            >
                              <Check className="h-4 w-4 mr-1.5" />
                              Accept
                            </Button>
                            <Button
                              onClick={() => handleReject(request.id)}
                              size="sm"
                              variant="ghost"
                              disabled={processingId === request.id}
                              className="flex-1 bg-red-500/10 hover:bg-red-500/20 text-red-300 border border-red-500/20 hover:border-red-500/40 hover:shadow-[0_0_20px_rgba(239,68,68,0.15)] transition-all duration-300"
                            >
                              <X className="h-4 w-4 mr-1.5" />
                              Reject
                            </Button>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </TabsContent>
            
            <TabsContent value="outgoing" className="space-y-4 mt-0">
              {pendingOutgoing.length === 0 ? (
                <EmptyState
                  icon={Send}
                  title="No outgoing requests"
                  description="Requests you send to travel companions will appear here."
                  showIllustration={true}
                />
              ) : (
                <div className="space-y-4">
                  {pendingOutgoing.map((request) => (
                    <div 
                      key={request.id}
                      className="group relative p-5 rounded-2xl transition-all duration-300 hover:-translate-y-1"
                      style={{
                        backgroundColor: 'rgba(255, 255, 255, 0.05)',
                        backdropFilter: 'blur(40px) saturate(1.5)',
                        WebkitBackdropFilter: 'blur(40px) saturate(1.5)',
                        border: '1px solid rgba(255, 255, 255, 0.1)',
                        boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3)'
                      }}
                    >
                      <div className="absolute inset-0 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none"
                        style={{
                          boxShadow: '0 0 40px rgba(59, 130, 246, 0.15), inset 0 0 20px rgba(255, 255, 255, 0.02)'
                        }}
                      />
                      
                      <div className="relative flex items-start gap-4">
                        <Avatar className="h-12 w-12 border-2 border-white/20 shrink-0">
                          <AvatarImage src={undefined} />
                          <AvatarFallback className="bg-accent-blue/20 text-white font-medium">
                            {getInitials(request.to_name, request.to_email)}
                          </AvatarFallback>
                        </Avatar>
                        
                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-3 mb-2">
                            <div>
                              <p className="text-xs text-white/50 mb-0.5">Sent to</p>
                              <p className="font-semibold text-white truncate">
                                {request.to_name || request.to_email || 'Unknown User'}
                              </p>
                              <Badge className="mt-1 bg-sky-500/20 text-sky-300 border-sky-500/30 text-xs">
                                Awaiting Response
                              </Badge>
                            </div>
                          </div>
                          
                          <div className="space-y-1.5 mt-3">
                            <div className="flex items-center gap-2 text-sm text-white/60">
                              <Train className="h-3.5 w-3.5" />
                              <span>Train {request.train_number}</span>
                              <span className="text-white/30">•</span>
                              <Calendar className="h-3.5 w-3.5" />
                              <span>{request.travel_date}</span>
                            </div>
                            <div className="flex items-center gap-2 text-sm text-white/60">
                              <MapPin className="h-3.5 w-3.5" />
                              <span className="truncate">{request.boarding_station} → {request.destination_station}</span>
                            </div>
                          </div>
                          
                          <div className="mt-4">
                            <Button
                              onClick={() => setCancelConfirmId(request.id)}
                              size="sm"
                              variant="ghost"
                              disabled={processingId === request.id}
                              className="w-full bg-white/5 hover:bg-white/10 text-white/70 hover:text-white border border-white/10 hover:border-white/20 transition-all duration-300"
                            >
                              <X className="h-4 w-4 mr-1.5" />
                              Cancel Request
                            </Button>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </TabsContent>
          </Tabs>
        </div>
      </div>

      {/* Cancel Confirmation Dialog */}
      <AlertDialog open={!!cancelConfirmId} onOpenChange={() => setCancelConfirmId(null)}>
        <AlertDialogContent className="bg-card/95 backdrop-blur-xl border-white/10">
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel Request?</AlertDialogTitle>
            <AlertDialogDescription>
              This will withdraw your travel companion request. You can send a new request later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="bg-white/5 border-white/10 hover:bg-white/10">Keep Request</AlertDialogCancel>
            <AlertDialogAction onClick={handleCancel} className="bg-red-500/20 hover:bg-red-500/30 text-red-300 border border-red-500/30">
              Cancel Request
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default Requests;
