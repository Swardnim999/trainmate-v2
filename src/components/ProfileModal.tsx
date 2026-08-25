import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { User, Building, Train, AlertTriangle, Ban, Heart, MapPin, Calendar, Loader2 } from 'lucide-react';
import { profilesApi } from '@/lib/api/profiles.api';

interface ProfileData {
  name?: string;
  college?: string;
  gender?: string;
  coach?: string;
  bio?: string;
  hobbies?: string;
  avatar_url?: string;
}

interface JourneyContext {
  trainNumber?: string;
  trainName?: string;
  travelDate?: string;
  boardingStation?: string;
  destinationStation?: string;
}

interface ProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
  profile: ProfileData | null;
  userId?: string;
  currentUserCollege?: string;
  currentUserCoach?: string;
  journeyContext?: JourneyContext;
  onBlock?: () => void;
  onReport?: () => void;
  actionButton?: React.ReactNode;
}

export const ProfileModal = ({
  isOpen,
  onClose,
  profile: initialProfile,
  userId,
  currentUserCollege,
  currentUserCoach,
  journeyContext,
  onBlock,
  onReport,
  actionButton,
}: ProfileModalProps) => {
  const [profile, setProfile] = useState<ProfileData | null>(initialProfile);
  const [loading, setLoading] = useState(false);

  // Fetch full profile data when modal opens
  // Note: We intentionally don't fetch/display email for other users' profiles
  useEffect(() => {
    const fetchFullProfile = async () => {
      if (!isOpen || !userId) return;

      setLoading(true);
      try {
        const data = await profilesApi.getUserProfile(userId);
        if (data) {
          setProfile((prev) => ({
            ...prev,
            name: data.name || prev?.name,
            college: data.college || prev?.college,
            gender: data.gender || prev?.gender,
            bio: data.bio || undefined,
            hobbies: data.hobbies || undefined,
            avatar_url: data.avatar_url || undefined,
          }));
        }
      } catch (error) {
        console.error('Error fetching profile:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchFullProfile();
  }, [isOpen, userId]);

  // Update local profile when initialProfile changes
  useEffect(() => {
    setProfile(initialProfile);
  }, [initialProfile]);

  if (!profile) return null;

  const isSameCollege =
    currentUserCollege &&
    profile.college &&
    currentUserCollege.toLowerCase() === profile.college.toLowerCase();
  const isSameCoach =
    currentUserCoach && profile.coach && currentUserCoach === profile.coach;

  const getInitials = () => {
    if (profile.name) {
      return profile.name
        .split(' ')
        .map((n) => n[0])
        .join('')
        .toUpperCase()
        .slice(0, 2);
    }
    return 'U';
  };

  const formatGender = (gender: string | null | undefined) => {
    if (!gender) return null;
    if (gender === 'prefer_not_to_say') return 'Prefer not to say';
    return gender.charAt(0).toUpperCase() + gender.slice(1);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <User className="h-5 w-5" />
            Traveler Profile
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              {/* Profile Header */}
              <div className="flex items-center gap-4">
                <Avatar className="h-16 w-16 ring-2 ring-border ring-offset-2 ring-offset-background">
                  <AvatarImage
                    src={profile.avatar_url || undefined}
                    className="object-cover"
                  />
                  <AvatarFallback className="bg-primary/10 text-primary text-lg">
                    {getInitials()}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1">
                  <h3 className="text-lg font-semibold">
                    {profile.name || 'Anonymous'}
                  </h3>
                </div>
              </div>

              {/* Bio */}
              {profile.bio && (
                <div className="p-3 rounded-lg bg-muted/50">
                  <p className="text-sm italic">"{profile.bio}"</p>
                </div>
              )}

              {/* Badges */}
              <div className="flex flex-wrap gap-2">
                {isSameCollege && (
                  <Badge
                    variant="secondary"
                    className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100"
                  >
                    <Building className="h-3 w-3 mr-1" />
                    Same College
                  </Badge>
                )}
                {isSameCoach && (
                  <Badge
                    variant="secondary"
                    className="bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-100"
                  >
                    <Train className="h-3 w-3 mr-1" />
                    Same Coach
                  </Badge>
                )}
              </div>

              {/* Journey Context */}
              {journeyContext &&
                (journeyContext.trainNumber || journeyContext.travelDate) && (
                  <div className="p-3 rounded-lg border bg-card space-y-2">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                      Journey Details
                    </p>
                    {journeyContext.trainNumber && (
                      <div className="flex items-center gap-2 text-sm">
                        <Train className="h-4 w-4 text-muted-foreground" />
                        <span>
                          {journeyContext.trainName ||
                            `Train ${journeyContext.trainNumber}`}
                        </span>
                      </div>
                    )}
                    {journeyContext.travelDate && (
                      <div className="flex items-center gap-2 text-sm">
                        <Calendar className="h-4 w-4 text-muted-foreground" />
                        <span>{journeyContext.travelDate}</span>
                      </div>
                    )}
                    {(journeyContext.boardingStation ||
                      journeyContext.destinationStation) && (
                      <div className="flex items-center gap-2 text-sm">
                        <MapPin className="h-4 w-4 text-muted-foreground" />
                        <span>
                          {journeyContext.boardingStation || 'N/A'} →{' '}
                          {journeyContext.destinationStation || 'N/A'}
                        </span>
                      </div>
                    )}
                  </div>
                )}

              {/* Profile Details */}
              <div className="space-y-2 pt-2 border-t">
                {profile.college && (
                  <div className="flex items-center gap-2 text-sm">
                    <Building className="h-4 w-4 text-muted-foreground" />
                    <span className="text-muted-foreground">College/Org:</span>
                    <span>{profile.college}</span>
                  </div>
                )}

                {profile.hobbies && (
                  <div className="flex items-start gap-2 text-sm">
                    <Heart className="h-4 w-4 text-muted-foreground mt-0.5" />
                    <span className="text-muted-foreground">Hobbies:</span>
                    <div className="flex flex-wrap gap-1">
                      {profile.hobbies.split(',').map((hobby, i) => (
                        <Badge key={i} variant="secondary" className="text-xs">
                          {hobby.trim()}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}

                {profile.gender && (
                  <div className="flex items-center gap-2 text-sm">
                    <User className="h-4 w-4 text-muted-foreground" />
                    <span className="text-muted-foreground">Gender:</span>
                    <span className="capitalize">
                      {formatGender(profile.gender)}
                    </span>
                  </div>
                )}

                {profile.coach && (
                  <div className="flex items-center gap-2 text-sm">
                    <Train className="h-4 w-4 text-muted-foreground" />
                    <span className="text-muted-foreground">Coach/Class:</span>
                    <span>{profile.coach}</span>
                  </div>
                )}
              </div>

              {/* Action Button (Send Request / Chat / etc.) */}
              {actionButton && <div className="pt-2">{actionButton}</div>}

              {/* Block/Report Actions */}
              {(onBlock || onReport) && (
                <div className="flex gap-2 pt-4 border-t">
                  {onReport && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={onReport}
                      className="text-amber-600 hover:text-amber-700"
                    >
                      <AlertTriangle className="h-4 w-4 mr-1" />
                      Report
                    </Button>
                  )}
                  {onBlock && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={onBlock}
                      className="text-destructive hover:text-destructive"
                    >
                      <Ban className="h-4 w-4 mr-1" />
                      Block
                    </Button>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};
