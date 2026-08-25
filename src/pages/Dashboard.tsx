import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useNavigate } from 'react-router-dom';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Bell, X, MessageCircle, Calendar, Train, MapPin, ArrowRight, Users } from 'lucide-react';
import { useChat } from '@/hooks/useChat';
import { toast } from '@/hooks/use-toast';
import { journeySchema } from '@/lib/validations';
import { SkeletonJourneyCard } from '@/components/SkeletonCard';
import { EmptyState } from '@/components/EmptyState';
import { TrainAutocomplete } from '@/components/TrainAutocomplete';
import { ProfileMenu } from '@/components/ProfileMenu';
import dashboardBg from '@/assets/dashboard-bg.png';
import { requestsApi } from '@/lib/api/requests.api';
import { journeysApi } from '@/lib/api/journeys.api';
import { trainsApi } from '@/lib/api/trains.api';
import { Journey } from '@/lib/api/types';
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

type JourneyStatus = 'upcoming' | 'today' | 'past';

const getJourneyStatus = (travelDate: string): JourneyStatus => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const journeyDate = new Date(travelDate);
  journeyDate.setHours(0, 0, 0, 0);

  if (journeyDate.getTime() === today.getTime()) return 'today';
  if (journeyDate < today) return 'past';
  return 'upcoming';
};

const Dashboard = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { getTotalUnreadCount } = useChat();
  const [loading, setLoading] = useState(false);
  const [pendingRequests, setPendingRequests] = useState(0);
  const [allJourneys, setAllJourneys] = useState<Journey[]>([]);
  const [loadingJourneys, setLoadingJourneys] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'active' | 'past'>('active');

  const [formData, setFormData] = useState({
    name: '',
    trainNumber: '',
    trainName: '',
    isTrainVerified: true,
    travelDate: '',
    coach: '',
    boardingStation: '',
    destinationStation: '',
    college: '',
    gender: '',
  });
  const trainSelectionRef = useRef({
    trainNumber: '',
    trainName: '',
    isTrainVerified: true,
  });

  // Categorize journeys by status
  const categorizedJourneys = useMemo(() => {
    const upcoming: Journey[] = [];
    const today: Journey[] = [];
    const past: Journey[] = [];

    allJourneys.forEach((journey) => {
      const status = getJourneyStatus(journey.travel_date || journey.travelDate || '');
      if (status === 'upcoming') upcoming.push(journey);
      else if (status === 'today') today.push(journey);
      else past.push(journey);
    });

    return { upcoming, today, past };
  }, [allJourneys]);

  const checkPendingRequests = useCallback(async () => {
    if (!user) return;
    try {
      const count = await requestsApi.getPendingIncomingCount();
      setPendingRequests(count || 0);
    } catch (error) {
      console.error('Error checking pending requests:', error);
    }
  }, [user]);

  const loadAllJourneys = useCallback(async () => {
    if (!user) return;
    setLoadingJourneys(true);
    try {
      const data = await journeysApi.getMyJourneys();
      setAllJourneys(data || []);
    } catch (error) {
      console.error('Error loading journeys:', error);
    } finally {
      setLoadingJourneys(false);
    }
  }, [user]);

  useEffect(() => {
    if (user) {
      checkPendingRequests();
      loadAllJourneys();
    }
  }, [user, checkPendingRequests, loadAllJourneys]);

  const findCompanionsForJourney = async (journey: Journey) => {
    if (!user) return;

    const jDate = journey.travel_date || journey.travelDate || '';
    const jTrainNum = journey.train_number || journey.trainNumber || '';
    const status = getJourneyStatus(jDate);
    if (status === 'past') {
      toast({
        title: 'Cannot find companions',
        description: 'This journey has already passed.',
        variant: 'destructive',
      });
      return;
    }

    setLoading(true);

    try {
      const matches = await journeysApi.findCompanionMatches(jTrainNum, jDate);

      const formattedMatches = (matches || []).map((match) => ({
        id: match.id,
        userId: match.user_id || match.userId,
        userName: match.user_name || match.userName || '',
        trainNumber: match.train_number || match.trainNumber,
        trainName: match.train_name || match.trainName || '',
        travelDate: match.travel_date || match.travelDate,
        coach: match.coach || '',
        boardingStation: match.boarding_station || match.boardingStation || '',
        destinationStation: match.destination_station || match.destinationStation || '',
        college: match.college,
        gender: match.gender,
      }));

      const journeyData = {
        name: journey.user_name || journey.userName,
        trainNumber: journey.train_number || journey.trainNumber,
        trainName: journey.train_name || journey.trainName,
        travelDate: journey.travel_date || journey.travelDate,
        coach: journey.coach,
        boardingStation: journey.boarding_station || journey.boardingStation,
        destinationStation: journey.destination_station || journey.destinationStation,
        college: journey.college,
        gender: journey.gender,
      };

      localStorage.setItem('journeyData', JSON.stringify(journeyData));
      localStorage.setItem('matches', JSON.stringify(formattedMatches));

      toast({
        title: 'Companions found',
        description: `Found ${formattedMatches.length} potential travel companions!`,
      });

      navigate('/matched');
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Error finding companions';
      toast({
        title: 'Error',
        description: message,
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;

    const trainSelection = trainSelectionRef.current;
    const trainForSave = {
      trainNumber: trainSelection.trainNumber || formData.trainNumber,
      trainName: trainSelection.trainName || formData.trainName,
      isTrainVerified: trainSelection.isTrainVerified,
    };
    const validation = journeySchema.safeParse({
      ...formData,
      trainNumber: trainForSave.trainNumber,
    });
    if (!validation.success) {
      const firstError = validation.error.errors[0];
      toast({
        title: 'Validation Error',
        description: firstError.message,
        variant: 'destructive',
      });
      return;
    }

    const validatedData = validation.data;
    setLoading(true);

    try {
      // If train is not verified, save to unverified_trains
      if (!trainForSave.isTrainVerified && trainForSave.trainNumber) {
        const rawInput = trainForSave.trainNumber;
        await trainsApi
          .logUnverifiedTrain({
            trainNumber: trainForSave.trainNumber,
            trainName: trainForSave.trainName || null,
            enteredValue: rawInput,
          })
          .catch(() => {});
      }

      const created = await journeysApi.createJourney({
        userName: validatedData.name,
        trainNumber: trainForSave.trainNumber,
        trainName: trainForSave.trainName || null,
        travelDate: validatedData.travelDate,
        coach: validatedData.coach || null,
        boardingStation: validatedData.boardingStation || null,
        destinationStation: validatedData.destinationStation || null,
        college: validatedData.college || null,
        gender: validatedData.gender || null,
      });

      setFormData({
        name: '',
        trainNumber: '',
        trainName: '',
        isTrainVerified: true,
        travelDate: '',
        coach: '',
        boardingStation: '',
        destinationStation: '',
        college: '',
        gender: '',
      });
      trainSelectionRef.current = {
        trainNumber: '',
        trainName: '',
        isTrainVerified: true,
      };
      setShowForm(false);

      await findCompanionsForJourney(created);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Error creating journey';
      toast({
        title: 'Error',
        description: message,
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const deleteJourney = async (journeyId: string) => {
    try {
      await journeysApi.deleteJourney(journeyId);
      setAllJourneys((prev) => prev.filter((journey) => journey.id !== journeyId));

      toast({
        title: 'Journey deleted',
        description: 'Your journey has been deleted successfully!',
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Error deleting journey';
      toast({
        title: 'Error',
        description: message,
        variant: 'destructive',
      });
    }
    setDeleteConfirm(null);
  };

  const getStatusBadge = (status: JourneyStatus) => {
    const baseClass = 'status-badge';
    switch (status) {
      case 'today':
        return <span className={`${baseClass} status-badge-today`}>Today</span>;
      case 'past':
        return <span className={`${baseClass} status-badge-past`}>Past</span>;
      default:
        return <span className={`${baseClass} status-badge-active`}>Upcoming</span>;
    }
  };

  const renderJourneyCard = (journey: Journey, status: JourneyStatus) => {
    const tNum = journey.train_number || journey.trainNumber || '';
    const tName = journey.train_name || journey.trainName || '';
    const uName = journey.user_name || journey.userName || '';
    const tDate = journey.travel_date || journey.travelDate || '';
    const bStation = journey.boarding_station || journey.boardingStation || '';
    const dStation = journey.destination_station || journey.destinationStation || '';

    return (
      <div
        key={journey.id}
        className="relative p-6 animate-fade-in rounded-2xl overflow-hidden transition-all duration-300 hover:-translate-y-1"
        style={{
          zIndex: 10,
          backgroundColor: 'rgba(255, 255, 255, 0.05)',
          backdropFilter: 'blur(40px) saturate(1.5)',
          WebkitBackdropFilter: 'blur(40px) saturate(1.5)',
          border: '1px solid rgba(255, 255, 255, 0.2)',
          boxShadow: '0 20px 60px rgba(0, 0, 0, 0.35)',
        }}
      >
        {/* Delete button */}
        <button
          onClick={() => setDeleteConfirm(journey.id)}
          className="absolute top-4 right-4 p-2 rounded-lg text-white/40 hover:text-destructive hover:bg-destructive/10 transition-all duration-300 opacity-60 hover:opacity-100"
        >
          <X className="h-4 w-4" />
        </button>

        {/* Header */}
        <div className="flex items-start gap-4 mb-5 pr-8">
          <div className="p-3 rounded-xl bg-white/10 border border-white/10">
            <Train className="h-5 w-5 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-semibold text-lg text-white">
                {tName || `Train ${tNum}`}
              </h3>
              {getStatusBadge(status)}
            </div>
            {tName && (
              <p className="text-sm text-white/60 truncate mt-0.5">
                Train {tNum}
              </p>
            )}
          </div>
        </div>

        {/* Date badge */}
        <div className="flex items-center gap-2 mb-5 text-sm text-white/70">
          <Calendar className="h-4 w-4" />
          <span>
            {new Date(tDate).toLocaleDateString('en-US', {
              weekday: 'short',
              month: 'short',
              day: 'numeric',
              year: 'numeric',
            })}
          </span>
        </div>

        {/* Journey details */}
        <div className="space-y-3 mb-5">
          <div className="flex items-center gap-2 text-sm">
            <span className="text-white/50 w-14">Name:</span>
            <span className="text-white font-medium">{uName || 'Not specified'}</span>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <span className="text-white/50 w-14">Class:</span>
            <span className="text-white font-medium">{journey.coach || 'Not specified'}</span>
          </div>

          {/* Route display */}
          <div className="flex items-center gap-2 pt-2">
            <div className="flex items-center gap-1.5 text-sm">
              <MapPin className="h-3.5 w-3.5 text-green-400" />
              <span className="text-white">{bStation || 'N/A'}</span>
            </div>
            <ArrowRight className="h-4 w-4 text-white/40" />
            <div className="flex items-center gap-1.5 text-sm">
              <MapPin className="h-3.5 w-3.5 text-red-400" />
              <span className="text-white">{dStation || 'N/A'}</span>
            </div>
          </div>
        </div>

        {/* Action button */}
        {status !== 'past' && (
          <button
            onClick={() => findCompanionsForJourney(journey)}
            disabled={loading}
            className="btn-primary-glow w-full flex items-center justify-center gap-2 mt-4"
          >
            <Users className="h-4 w-4" />
            {loading ? 'Finding...' : 'Find Companions'}
          </button>
        )}
      </div>
    );
  };

  const activeJourneys = [...categorizedJourneys.today, ...categorizedJourneys.upcoming];

  // Apply background to body on mount
  useEffect(() => {
    document.body.classList.add('dashboard-body');
    document.body.style.backgroundImage = `url(${dashboardBg})`;

    return () => {
      document.body.classList.remove('dashboard-body');
      document.body.style.backgroundImage = '';
    };
  }, []);

  return (
    <div className="dashboard-bg">
      <div className="min-h-screen p-4 sm:p-6">
        <div className="max-w-2xl mx-auto">
          {/* Header */}
          <header className="flex justify-between items-center mb-8">
            <h1 className="text-2xl sm:text-3xl font-bold text-white tracking-tight drop-shadow-lg">
              TrainMate
            </h1>
            <div className="flex items-center gap-3">
              {/* Chat button */}
              <button
                onClick={() => navigate('/chats')}
                className="glass-icon-button relative"
              >
                <MessageCircle className="h-5 w-5 text-white" />
                {getTotalUnreadCount() > 0 && (
                  <span className="absolute -top-1 -right-1 bg-red-500 text-white rounded-full text-[10px] font-bold w-5 h-5 flex items-center justify-center border-2 border-black/20">
                    {getTotalUnreadCount() > 9 ? '9+' : getTotalUnreadCount()}
                  </span>
                )}
              </button>

              {/* Notifications button */}
              <button
                onClick={() => navigate('/requests')}
                className="glass-icon-button relative"
              >
                <Bell className="h-5 w-5 text-white" />
                {pendingRequests > 0 && (
                  <span className="absolute -top-1 -right-1 bg-red-500 text-white rounded-full text-[10px] font-bold w-5 h-5 flex items-center justify-center border-2 border-black/20">
                    {pendingRequests}
                  </span>
                )}
              </button>

              {/* Profile menu */}
              <ProfileMenu />
            </div>
          </header>

          {/* Tabs and Plan Journey button */}
          <div className="flex justify-between items-center mb-6 gap-4">
            {/* Glass Tabs */}
            <div className="glass-tabs">
              <button
                onClick={() => setActiveTab('active')}
                className={`glass-tab ${activeTab === 'active' ? 'glass-tab-active text-white' : 'text-white/60 hover:text-white'}`}
              >
                Active ({activeJourneys.length})
              </button>
              <button
                onClick={() => setActiveTab('past')}
                className={`glass-tab ${activeTab === 'past' ? 'glass-tab-active text-white' : 'text-white/60 hover:text-white'}`}
              >
                Past ({categorizedJourneys.past.length})
              </button>
            </div>

            {/* Plan Journey Dialog */}
            <Dialog open={showForm} onOpenChange={setShowForm}>
              <DialogTrigger asChild>
                <button className="btn-primary-glow text-sm">
                  Plan Journey
                </button>
              </DialogTrigger>
              <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto scrollbar-hide glass-card border-0">
                <DialogHeader>
                  <DialogTitle className="text-xl font-semibold">Plan New Journey</DialogTitle>
                </DialogHeader>
                <form onSubmit={handleSubmit} className="space-y-4 mt-4">
                  <div className="space-y-2">
                    <Label htmlFor="name" className="text-sm font-medium">Your Name</Label>
                    <Input
                      id="name"
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      placeholder="Enter your name"
                      required
                      className="bg-background/50 border-border/50 focus:border-accent-blue"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="trainNumber" className="text-sm font-medium">Train</Label>
                    <TrainAutocomplete
                      value={formData.trainNumber}
                      trainName={formData.trainName}
                      onChange={(trainNumber, trainName, isVerified) => {
                        trainSelectionRef.current = {
                          trainNumber,
                          trainName,
                          isTrainVerified: isVerified,
                        };
                        setFormData((prev) => ({
                          ...prev,
                          trainNumber,
                          trainName,
                          isTrainVerified: isVerified,
                        }));
                      }}
                      required
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="travelDate" className="text-sm font-medium">Travel Date</Label>
                    <Input
                      id="travelDate"
                      type="date"
                      value={formData.travelDate}
                      onChange={(e) => setFormData({ ...formData, travelDate: e.target.value })}
                      required
                      className="bg-background/50 border-border/50 focus:border-accent-blue"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="coach" className="text-sm font-medium">Coach/Class</Label>
                    <Select
                      value={formData.coach}
                      onValueChange={(value) => setFormData({ ...formData, coach: value })}
                    >
                      <SelectTrigger className="bg-background/50 border-border/50">
                        <SelectValue placeholder="Select coach/class" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="1A">1A (AC First Class)</SelectItem>
                        <SelectItem value="2A">2A (AC 2-Tier)</SelectItem>
                        <SelectItem value="3A">3A (AC 3-Tier)</SelectItem>
                        <SelectItem value="3E">3E (AC 3-Tier Economy)</SelectItem>
                        <SelectItem value="EC">EC (Executive Chair Car)</SelectItem>
                        <SelectItem value="CC">CC (AC Chair Car)</SelectItem>
                        <SelectItem value="SL">SL (Sleeper Class)</SelectItem>
                        <SelectItem value="2S">2S (Second Sitting)</SelectItem>
                        <SelectItem value="UR/GN">UR/GN (Unreserved / General)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="boardingStation" className="text-sm font-medium">Boarding Station</Label>
                    <Input
                      id="boardingStation"
                      value={formData.boardingStation}
                      onChange={(e) => setFormData({ ...formData, boardingStation: e.target.value })}
                      placeholder="e.g., New Delhi"
                      required
                      className="bg-background/50 border-border/50 focus:border-accent-blue"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="destinationStation" className="text-sm font-medium">Destination Station</Label>
                    <Input
                      id="destinationStation"
                      value={formData.destinationStation}
                      onChange={(e) => setFormData({ ...formData, destinationStation: e.target.value })}
                      placeholder="e.g., Mumbai Central"
                      required
                      className="bg-background/50 border-border/50 focus:border-accent-blue"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="college" className="text-sm font-medium">College/Organization (Optional)</Label>
                    <Input
                      id="college"
                      value={formData.college}
                      onChange={(e) => setFormData({ ...formData, college: e.target.value })}
                      placeholder="e.g., Delhi University"
                      className="bg-background/50 border-border/50 focus:border-accent-blue"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="gender" className="text-sm font-medium">Gender</Label>
                    <Select
                      value={formData.gender}
                      onValueChange={(value) => setFormData({ ...formData, gender: value })}
                    >
                      <SelectTrigger className="bg-background/50 border-border/50">
                        <SelectValue placeholder="Select gender" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="male">Male</SelectItem>
                        <SelectItem value="female">Female</SelectItem>
                        <SelectItem value="other">Other</SelectItem>
                        <SelectItem value="prefer-not-to-say">Prefer not to say</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <button type="submit" className="btn-primary-glow w-full mt-6" disabled={loading}>
                    {loading ? 'Finding companions...' : 'Find Travel Companions'}
                  </button>
                </form>
              </DialogContent>
            </Dialog>
          </div>

          {/* Journey content */}
          <div className="space-y-4">
            {activeTab === 'active' && (
              <>
                {loadingJourneys ? (
                  <>
                    <SkeletonJourneyCard />
                    <SkeletonJourneyCard />
                  </>
                ) : activeJourneys.length === 0 ? (
                  <EmptyState
                    icon={Train}
                    title="No active journeys"
                    description="Plan your first journey to find travel companions!"
                    actionLabel="Plan Journey"
                    onAction={() => setShowForm(true)}
                  />
                ) : (
                  activeJourneys.map((journey) =>
                    renderJourneyCard(journey, getJourneyStatus(journey.travel_date || journey.travelDate || '')),
                  )
                )}
              </>
            )}

            {activeTab === 'past' && (
              <>
                {loadingJourneys ? (
                  <>
                    <SkeletonJourneyCard />
                    <SkeletonJourneyCard />
                  </>
                ) : categorizedJourneys.past.length === 0 ? (
                  <EmptyState
                    icon={Calendar}
                    title="No past journeys"
                    description="Your completed journeys will appear here."
                  />
                ) : (
                  categorizedJourneys.past.map((journey) =>
                    renderJourneyCard(journey, 'past'),
                  )
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!deleteConfirm} onOpenChange={() => setDeleteConfirm(null)}>
        <AlertDialogContent className="glass-card border-0">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Journey?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete this journey. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="glass-button">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteConfirm && deleteJourney(deleteConfirm)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default Dashboard;
