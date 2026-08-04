import { useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useProfile } from '@/hooks/useProfile';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { ViewProfileModal } from './ViewProfileModal';

export const ProfileMenu = () => {
  const { user } = useAuth();
  const { profile, getAvatarUrl } = useProfile();
  const [showViewProfile, setShowViewProfile] = useState(false);

  const getInitials = () => {
    if (profile?.name) {
      return profile.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
    }
    if (user?.email) {
      return user.email[0].toUpperCase();
    }
    return 'U';
  };

  return (
    <>
      <Button 
        variant="outline" 
        size="icon" 
        className="rounded-full"
        onClick={() => setShowViewProfile(true)}
      >
        <Avatar className="h-8 w-8">
          <AvatarImage 
            src={getAvatarUrl(profile?.avatar_url)} 
            alt={profile?.name || 'Profile'} 
          />
          <AvatarFallback className="bg-primary/10 text-primary text-sm">
            {getInitials()}
          </AvatarFallback>
        </Avatar>
      </Button>

      <ViewProfileModal 
        isOpen={showViewProfile} 
        onClose={() => setShowViewProfile(false)} 
      />
    </>
  );
};
