import { useState, useEffect } from 'react';
import { requestsApi } from '@/lib/api/requests.api';
import { useAuth } from '@/hooks/useAuth';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { ArrowLeft, Send, Filter, Building, Train, Users, MapPin, RotateCcw, Info, MessageCircle, Check, X, Clock } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { useBlockedUsers } from '@/hooks/useBlockedUsers';
import { useRequests } from '@/hooks/useRequests';
import { useChat } from '@/hooks/useChat';
import { ProfileModal } from '@/components/ProfileModal';
import { ReportDialog } from '@/components/ReportDialog';
import { SkeletonCard } from '@/components/SkeletonCard';
import { EmptyState } from '@/components/EmptyState';
import dashboardBg from '@/assets/dashboard-bg.png';

interface Journey {
  name: string;
  trainNumber: string;
  trainName?: string;
  travelDate: string;
  coach: string;
  boardingStation: string;
  destinationStation: string;
  college?: string;
  gender?: string;
}

interface Match {
  id: string;
  userId: string;
  userName: string;
  trainNumber: string;
  trainName?: string;
  travelDate: string;
  coach: string;
  boardingStation: string;
  destinationStation: string;
  college?: string;
  gender?: string;
}

const Matched = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { blockedUsers, blockUser } = useBlockedUsers();
  const { getRequestStatus, acceptRequest, rejectRequest, fetchRequests } = useRequests();
  const { createConversation, conversations } = useChat();
  const [journeyData, setJourneyData] = useState<Journey | null>(null);
  const [matches, setMatches] = useState<Match[]>([]);
  const [filteredMatches, setFilteredMatches] = useState<Match[]>([]);
  const [sendingRequest, setSendingRequest] = useState<string | null>(null);
  const [processingAction, setProcessingAction] = useState<string | null>(null);
  const [selectedProfile, setSelectedProfile] = useState<Match | null>(null);
  const [showReportDialog, setShowReportDialog] = useState(false);
  const [reportUserId, setReportUserId] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({
    coach: '',
    college: '',
    gender: '',
    sameCollege: false,
    sameCoach: false
  });

  useEffect(() => {
    const storedJourney = localStorage.getItem('journeyData');
    const storedMatches = localStorage.getItem('matches');
    
    if (storedJourney) {
      setJourneyData(JSON.parse(storedJourney));
    }
    
    if (storedMatches) {
      const parsedMatches = JSON.parse(storedMatches);
      setMatches(parsedMatches);
      setFilteredMatches(parsedMatches);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    let filtered = [...matches];
    
    if (filters.coach && filters.coach !== 'all') {
      filtered = filtered.filter(match => match.coach === filters.coach);
    }
    
    if (filters.college) {
      filtered = filtered.filter(match => 
        match.college?.toLowerCase().includes(filters.college.toLowerCase())
      );
    }
    
    if (filters.gender && filters.gender !== 'all') {
      filtered = filtered.filter(match => match.gender === filters.gender);
    }
    
    if (filters.sameCollege && journeyData?.college) {
      filtered = filtered.filter(match => 
        match.college?.toLowerCase() === journeyData.college?.toLowerCase()
      );
    }
    
    if (filters.sameCoach && journeyData?.coach) {
      filtered = filtered.filter(match => match.coach === journeyData.coach);
    }
    
    setFilteredMatches(filtered);
  }, [matches, filters, blockedUsers, journeyData]);

  // Apply background to body on mount (same as Dashboard)
  useEffect(() => {
    document.body.classList.add('dashboard-body');
    document.body.style.backgroundImage = `url(${dashboardBg})`;
    
    return () => {
      document.body.classList.remove('dashboard-body');
      document.body.style.backgroundImage = '';
    };
  }, []);

  const resetFilters = () => {
    setFilters({
      coach: '',
      college: '',
      gender: '',
      sameCollege: false,
      sameCoach: false
    });
  };

  const hasActiveFilters = filters.coach || filters.college || filters.gender || filters.sameCollege || filters.sameCoach;

  const sendRequest = async (matchUserId: string, matchUserName: string) => {
    if (!user || !journeyData) return;

    setSendingRequest(matchUserId);

    try {
      await requestsApi.sendRequest({
        toUserId: matchUserId,
        fromName: journeyData.name,
        toName: matchUserName,
        trainNumber: journeyData.trainNumber,
        travelDate: journeyData.travelDate,
        boardingStation: journeyData.boardingStation,
        destinationStation: journeyData.destinationStation,
      });

      toast({
        title: 'Request sent',
        description: `Travel request sent to ${matchUserName}`,
      });

      await fetchRequests();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Error sending request';
      toast({
        title: 'Error',
        description: message,
        variant: 'destructive',
      });
    } finally {
      setSendingRequest(null);
    }
  };

  const handleAcceptRequest = async (match: Match, requestId: string) => {
    if (!user || !journeyData) return;
    
    setProcessingAction(match.userId);
    
    const success = await acceptRequest(requestId);
    if (success) {
      toast({
        title: "Request accepted",
        description: `You can now chat with ${match.userName}`,
      });
      await fetchRequests();
    } else {
      toast({
        title: "Error",
        description: "Failed to accept request",
        variant: "destructive",
      });
    }
    
    setProcessingAction(null);
  };

  const handleRejectRequest = async (match: Match, requestId: string) => {
    setProcessingAction(match.userId);
    
    const success = await rejectRequest(requestId);
    if (success) {
      toast({
        title: "Request rejected",
      });
      await fetchRequests();
    } else {
      toast({
        title: "Error",
        description: "Failed to reject request",
        variant: "destructive",
      });
    }
    
    setProcessingAction(null);
  };

  const handleOpenChat = async (match: Match) => {
    if (!user || !journeyData) return;
    
    const existingConv = conversations.find(c => 
      c.participants.includes(match.userId) && 
      c.participants.includes(user.id)
    );

    let conversationId = existingConv?.id;
    
    if (!conversationId) {
      try {
        conversationId = await createConversation(
          [user.id, match.userId],
          { [user.id]: journeyData.name || '', [match.userId]: match.userName },
          journeyData.trainNumber,
          journeyData.travelDate
        );
      } catch (error) {
        toast({
          title: "Error",
          description: "Failed to create conversation",
          variant: "destructive",
        });
        return;
      }
    }

    navigate(`/chat/${conversationId}`, {
      state: {
        otherUser: { id: match.userId, name: match.userName },
        trainNumber: journeyData.trainNumber,
        travelDate: journeyData.travelDate
      }
    });
  };

  const handleBlockUser = async () => {
    if (!selectedProfile) return;
    
    const success = await blockUser(selectedProfile.userId);
    if (success) {
      toast({
        title: 'User blocked',
        description: 'You will no longer see this user in matches.'
      });
      setSelectedProfile(null);
    }
  };

  const handleReportUser = () => {
    if (!selectedProfile) return;
    setReportUserId(selectedProfile.userId);
    setSelectedProfile(null);
    setShowReportDialog(true);
  };

  const isSameCollege = (matchCollege?: string) => {
    return journeyData?.college && matchCollege && 
      journeyData.college.toLowerCase() === matchCollege.toLowerCase();
  };

  const isSameCoach = (matchCoach?: string) => {
    return journeyData?.coach && matchCoach && journeyData.coach === matchCoach;
  };

  const renderActionButton = (match: Match) => {
    const { status, request } = getRequestStatus(
      match.userId, 
      journeyData?.trainNumber, 
      journeyData?.travelDate
    );

    const isProcessing = processingAction === match.userId || sendingRequest === match.userId;

    switch (status) {
      case 'accepted':
        return (
          <Button
            onClick={(e) => {
              e.stopPropagation();
              handleOpenChat(match);
            }}
            size="sm"
            className="btn-primary-glow"
          >
            <MessageCircle className="h-4 w-4 mr-2" />
            Chat
          </Button>
        );
      
      case 'outgoing_pending':
        return (
          <Button size="sm" disabled className="bg-white/10 border border-white/20 text-muted-foreground backdrop-blur-sm">
            <Clock className="h-4 w-4 mr-2" />
            Requested
          </Button>
        );
      
      case 'incoming_pending':
        return (
          <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
            <Button
              onClick={() => handleAcceptRequest(match, request!.id)}
              size="sm"
              className="bg-emerald-500/80 hover:bg-emerald-500 text-white backdrop-blur-sm transition-all duration-200 hover:shadow-[0_0_16px_rgba(16,185,129,0.4)]"
              disabled={isProcessing}
            >
              <Check className="h-4 w-4 mr-1" />
              Accept
            </Button>
            <Button
              onClick={() => handleRejectRequest(match, request!.id)}
              size="sm"
              className="bg-white/10 border border-white/20 text-white/70 hover:bg-red-500/30 hover:border-red-500/40 backdrop-blur-sm transition-all duration-200"
              disabled={isProcessing}
            >
              <X className="h-4 w-4 mr-1" />
              Reject
            </Button>
          </div>
        );
      
      case 'rejected':
      case 'none':
      default:
        return (
          <Button
            onClick={(e) => {
              e.stopPropagation();
              sendRequest(match.userId, match.userName);
            }}
            disabled={isProcessing}
            size="sm"
            className="btn-primary-glow"
          >
            <Send className="h-4 w-4 mr-2" />
            {isProcessing ? 'Sending...' : 'Send Request'}
          </Button>
        );
    }
  };

  if (!journeyData && !loading) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <EmptyState
          icon={Train}
          title="No journey data found"
          description="Please go back to the dashboard to plan a journey first."
          actionLabel="Go to Dashboard"
          onAction={() => navigate('/dashboard')}
        />
      </div>
    );
  }

  return (
    <div className="dashboard-bg">
      <div className="min-h-screen p-4 sm:p-6 relative z-10">
        <div className="max-w-4xl mx-auto space-y-6">
          {/* Header */}
          <div className="flex items-center gap-4">
            <button
              onClick={() => navigate('/dashboard')}
              className="glass-icon-button"
            >
              <ArrowLeft className="h-5 w-5 text-white/80" />
            </button>
            <h1 className="text-2xl font-bold text-white">Travel Companions</h1>
          </div>

          <div className="grid gap-6 md:grid-cols-2">
            {/* Your Journey Card */}
            <div className="glass-subtle p-6 bg-gradient-to-br from-black/45 via-black/35 to-black/25 border border-white/30 shadow-[0_0_30px_rgba(59,130,246,0.25)] ring-1 ring-blue-400/20">
              <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                <Train className="h-5 w-5 text-blue-300" />
                Your Journey
              </h3>
              <div className="space-y-3 text-sm sm:text-[0.95rem]">
                <p><span className="text-white/85 font-medium">Train:</span> <span className="text-white font-semibold">{journeyData?.trainName || journeyData?.trainNumber}</span>
                  {journeyData?.trainName && (
                    <span className="text-white/90"> — {journeyData.trainNumber}</span>
                  )}
                </p>
                <p><span className="text-white/85 font-medium">Date:</span> <span className="text-white font-semibold">{journeyData?.travelDate}</span></p>
                <p><span className="text-white/85 font-medium">Class:</span> <span className="text-white font-semibold">{journeyData?.coach}</span></p>
                <p><span className="text-white/85 font-medium">From:</span> <span className="text-white font-semibold">{journeyData?.boardingStation}</span></p>
                <p><span className="text-white/85 font-medium">To:</span> <span className="text-white font-semibold">{journeyData?.destinationStation}</span></p>
              </div>
            </div>

            <div className="space-y-5">
              <div className="flex items-center gap-2">
                <Users className="h-5 w-5 text-blue-400" />
                <h2 className="text-lg font-semibold text-white">
                  Companions ({filteredMatches.length})
                </h2>
              </div>

              {/* Info note */}
              <div className="flex items-start gap-2 px-4 py-2.5 rounded-xl bg-black/35 backdrop-blur-md border border-white/20 text-sm text-white/85">
                <Info className="h-4 w-4 mt-0.5 shrink-0 text-blue-300" />
                <span>You are seeing travelers on the same train. Routes may differ.</span>
              </div>

              {/* Filters */}
              <div className="bg-black/35 backdrop-blur-md border border-white/20 rounded-xl p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2 text-white/95">
                    <Filter className="h-4 w-4" />
                    <span className="text-sm font-medium">Filters</span>
                  </div>
                  {hasActiveFilters && (
                    <button onClick={resetFilters} className="glass-icon-button !w-8 !h-8">
                      <RotateCcw className="h-3.5 w-3.5 text-white/85" />
                    </button>
                  )}
                </div>
                
                {/* Dropdown filters */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
                  <Select
                    value={filters.coach}
                    onValueChange={(value) => setFilters({...filters, coach: value})}
                  >
                    <SelectTrigger className="bg-black/30 border-white/20 text-white rounded-lg focus:ring-1 focus:ring-white/30">
                      <SelectValue placeholder="Coach" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Coaches</SelectItem>
                      <SelectItem value="S1">S1</SelectItem>
                      <SelectItem value="B1">B1</SelectItem>
                      <SelectItem value="A1">A1</SelectItem>
                      <SelectItem value="2A">2A</SelectItem>
                      <SelectItem value="3A">3A</SelectItem>
                      <SelectItem value="SL">SL</SelectItem>
                      <SelectItem value="CC">CC</SelectItem>
                      <SelectItem value="2S">2S</SelectItem>
                    </SelectContent>
                  </Select>
                  
                  <Input
                    placeholder="College/Org"
                    value={filters.college}
                    onChange={(e) => setFilters({...filters, college: e.target.value})}
                    className="bg-black/30 border-white/20 text-white placeholder:text-white/55 rounded-lg focus:ring-1 focus:ring-white/30"
                  />
                  
                  <Select
                    value={filters.gender}
                    onValueChange={(value) => setFilters({...filters, gender: value})}
                  >
                    <SelectTrigger className="bg-black/30 border-white/20 text-white rounded-lg focus:ring-1 focus:ring-white/30">
                      <SelectValue placeholder="Gender" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All</SelectItem>
                      <SelectItem value="male">Male</SelectItem>
                      <SelectItem value="female">Female</SelectItem>
                      <SelectItem value="other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Toggle filters */}
                <div className="flex flex-wrap gap-4">
                  <div className="flex items-center gap-2">
                    <Switch
                      id="sameCollege"
                      checked={filters.sameCollege}
                      onCheckedChange={(checked) => setFilters({...filters, sameCollege: checked})}
                      disabled={!journeyData?.college}
                      className="data-[state=checked]:bg-blue-500"
                    />
                    <Label htmlFor="sameCollege" className="text-sm cursor-pointer text-white/90">
                      Same college
                    </Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch
                      id="sameCoach"
                      checked={filters.sameCoach}
                      onCheckedChange={(checked) => setFilters({...filters, sameCoach: checked})}
                      disabled={!journeyData?.coach}
                      className="data-[state=checked]:bg-blue-500"
                    />
                    <Label htmlFor="sameCoach" className="text-sm cursor-pointer text-white/90">
                      Same coach
                    </Label>
                  </div>
                </div>
              </div>
              
              {loading ? (
                <>
                  <SkeletonCard />
                  <SkeletonCard />
                </>
              ) : filteredMatches.length === 0 ? (
                <EmptyState
                  icon={Users}
                  title={matches.length === 0 ? "No companions found" : "No matches"}
                  description={matches.length === 0 
                    ? "No matching travelers found for this journey. Check back later!"
                    : "Try adjusting your filters to see more companions."
                  }
                />
              ) : (
                filteredMatches.map((match) => (
                  <div 
                    key={match.id} 
                    className="glass-subtle-hover p-5 cursor-pointer bg-black/35 border border-white/20 hover:shadow-[0_0_30px_rgba(59,130,246,0.25)]"
                    onClick={() => setSelectedProfile(match)}
                  >
                    <div className="flex justify-between items-start">
                      <div className="space-y-2 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-semibold text-white">{match.userName || 'Anonymous'}</p>
                          {isSameCollege(match.college) && (
                            <Badge className="bg-emerald-500/25 text-emerald-200 border border-emerald-400/40 text-xs">
                              <Building className="h-3 w-3 mr-1" />
                              Same College
                            </Badge>
                          )}
                          {isSameCoach(match.coach) && (
                            <Badge className="bg-blue-500/25 text-blue-200 border border-blue-400/40 text-xs">
                              <Train className="h-3 w-3 mr-1" />
                              Same Coach
                            </Badge>
                          )}
                        </div>
                        
                        <div className="flex items-center gap-1.5 text-sm text-white/80">
                          <MapPin className="h-3.5 w-3.5" />
                          <span>{match.boardingStation || 'N/A'}</span>
                          <span>→</span>
                          <span>{match.destinationStation || 'N/A'}</span>
                          {match.coach && <span className="ml-1">• {match.coach}</span>}
                        </div>
                        
                        {match.college && (
                          <p className="text-sm text-white/80">
                            🏫 {match.college}
                          </p>
                        )}
                        {match.gender && (
                          <p className="text-sm text-white/80">
                            👤 {match.gender.charAt(0).toUpperCase() + match.gender.slice(1)}
                          </p>
                        )}
                      </div>
                      {renderActionButton(match)}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Profile Modal */}
      <ProfileModal
        isOpen={!!selectedProfile}
        onClose={() => setSelectedProfile(null)}
        profile={selectedProfile ? {
          name: selectedProfile.userName,
          college: selectedProfile.college,
          gender: selectedProfile.gender,
          coach: selectedProfile.coach
        } : null}
        userId={selectedProfile?.userId}
        currentUserCollege={journeyData?.college}
        currentUserCoach={journeyData?.coach}
        journeyContext={selectedProfile ? {
          trainNumber: selectedProfile.trainNumber,
          trainName: selectedProfile.trainName,
          travelDate: selectedProfile.travelDate,
          boardingStation: selectedProfile.boardingStation,
          destinationStation: selectedProfile.destinationStation
        } : undefined}
        onBlock={handleBlockUser}
        onReport={handleReportUser}
        actionButton={selectedProfile ? renderActionButton(selectedProfile) : undefined}
      />

      {/* Report Dialog */}
      <ReportDialog
        isOpen={showReportDialog}
        onClose={() => setShowReportDialog(false)}
        reportedUserId={reportUserId}
      />
    </div>
  );
};

export default Matched;
