import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useProfile } from '@/hooks/useProfile';
import { useTheme } from 'next-themes';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Building, Heart, Mail, Moon, LogOut, Pencil, User } from 'lucide-react';
import { EditProfileModal } from './EditProfileModal';
import { ProfileImageViewer } from './ProfileImageViewer';

interface ViewProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ViewProfileModal = ({ isOpen, onClose }: ViewProfileModalProps) => {
  const { user, logout } = useAuth();
  const { profile, getAvatarUrl } = useProfile();
  const { theme, setTheme } = useTheme();
  const navigate = useNavigate();
  const [showEditProfile, setShowEditProfile] = useState(false);
  const [showImageViewer, setShowImageViewer] = useState(false);

  const getInitials = () => {
    if (profile?.name) {
      return profile.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
    }
    if (user?.email) {
      return user.email[0].toUpperCase();
    }
    return 'U';
  };

  const formatGender = (gender: string | null) => {
    if (!gender) return null;
    if (gender === 'prefer_not_to_say') return 'Prefer not to say';
    return gender.charAt(0).toUpperCase() + gender.slice(1);
  };

  const handleLogout = async () => {
    onClose();
    await logout();
    navigate('/login');
  };

  const toggleTheme = () => {
    setTheme(theme === 'dark' ? 'light' : 'dark');
  };

  return (
    <>
      <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent className="sm:max-w-md p-0 overflow-auto border-none bg-transparent shadow-none max-h-[90vh]">
          {/* Root glass card wrapper */}
          <div className="glass-card px-6 pb-6 pt-8">
            
            {/* Avatar section - in normal flow with top margin */}
            <div className="flex justify-center mb-5 mt-2">
              <Avatar 
                className="h-28 w-28 border-4 border-background shadow-2xl cursor-pointer hover:scale-105 transition-transform duration-300"
                onClick={() => setShowImageViewer(true)}
              >
                <AvatarImage 
                  src={getAvatarUrl(profile?.avatar_url)} 
                />
                <AvatarFallback className="bg-primary/20 text-primary text-2xl font-semibold">
                  {getInitials()}
                </AvatarFallback>
              </Avatar>
            </div>

            {/* Main content container */}
            <div className="text-center space-y-5">
              
              {/* Name & Email */}
              <div>
                <h2 className="text-xl font-semibold text-foreground">
                  {profile?.name || 'No name set'}
                </h2>
                {user?.email && (
                  <div className="flex items-center justify-center gap-1.5 mt-1 text-sm text-muted-foreground">
                    <Mail className="h-3.5 w-3.5" />
                    <span>{user.email}</span>
                  </div>
                )}
              </div>

              {/* Bio section - card inside card */}
              {profile?.bio && (
                <div className="rounded-xl bg-muted/50 dark:bg-white/5 px-4 py-3 text-sm italic text-muted-foreground">
                  "{profile.bio}"
                </div>
              )}

              {/* Info grid - College + Gender */}
              {(profile?.college || profile?.gender) && (
                <div className="grid grid-cols-[3fr_2fr] gap-3">
                  {profile?.college && (
                    <div className="flex items-start gap-2.5 p-3 rounded-xl bg-muted/30 dark:bg-white/5 border border-border/20">
                      <Building className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                      <div className="min-w-0 text-left">
                        <p className="text-[10px] uppercase tracking-wider text-muted-foreground/70">College/Org</p>
                        <p className="text-sm text-foreground break-words">{profile.college}</p>
                      </div>
                    </div>
                  )}
                  {profile?.gender && (
                    <div className="flex items-start gap-2.5 p-3 rounded-xl bg-muted/30 dark:bg-white/5 border border-border/20">
                      <User className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                      <div className="min-w-0 text-left">
                        <p className="text-[10px] uppercase tracking-wider text-muted-foreground/70">Gender</p>
                        <p className="text-sm text-foreground">{formatGender(profile.gender)}</p>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Hobbies section */}
              {profile?.hobbies && (
                <div>
                  <div className="flex items-center justify-center gap-2 mb-3">
                    <Heart className="h-4 w-4 text-muted-foreground" />
                    <span className="text-xs uppercase tracking-wider text-muted-foreground/70">Hobbies</span>
                  </div>
                  <div className="flex flex-wrap justify-center gap-2">
                    {profile.hobbies.split(',').map((hobby, i) => (
                      <Badge 
                        key={i} 
                        variant="secondary" 
                        className="px-3 py-1 text-xs rounded-full bg-primary/10 text-primary border-primary/20 hover:bg-primary/20 transition-colors cursor-default"
                      >
                        {hobby.trim()}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              {/* Action section - stacked vertically */}
              <div className="pt-4 space-y-3">
                {/* Edit Profile - primary */}
                <Button 
                  className="w-full h-11 text-sm font-medium rounded-xl"
                  onClick={() => setShowEditProfile(true)}
                >
                  <Pencil className="h-4 w-4 mr-2" />
                  Edit Profile
                </Button>

                {/* Dark Mode toggle */}
                <div className="flex items-center justify-between p-3 rounded-xl bg-muted/30 dark:bg-white/5 border border-border/20">
                  <div className="flex items-center gap-2.5">
                    <Moon className="h-4 w-4 text-muted-foreground" />
                    <Label htmlFor="theme-toggle" className="text-sm text-foreground cursor-pointer">
                      Dark Mode
                    </Label>
                  </div>
                  <Switch 
                    id="theme-toggle"
                    checked={theme === 'dark'}
                    onCheckedChange={toggleTheme}
                  />
                </div>

                {/* Logout - destructive */}
                <Button 
                  variant="ghost" 
                  className="w-full h-10 text-sm text-destructive/80 hover:text-destructive hover:bg-destructive/10 rounded-xl"
                  onClick={handleLogout}
                >
                  <LogOut className="h-4 w-4 mr-2" />
                  Logout
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <EditProfileModal 
        isOpen={showEditProfile} 
        onClose={() => setShowEditProfile(false)} 
      />

      <ProfileImageViewer
        isOpen={showImageViewer}
        onClose={() => setShowImageViewer(false)}
        imageUrl={getAvatarUrl(profile?.avatar_url)}
        fallback={getInitials()}
      />
    </>
  );
};
