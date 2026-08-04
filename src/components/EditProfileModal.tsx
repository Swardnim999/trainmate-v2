import { useState, useEffect, useRef } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useProfile } from '@/hooks/useProfile';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Camera, Loader2, X } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { ImageCropModal } from './ImageCropModal';

interface EditProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const EditProfileModal = ({ isOpen, onClose }: EditProfileModalProps) => {
  const { user } = useAuth();
  const { profile, updateProfile, uploadAvatar, fetchProfile, getAvatarUrl, refreshAvatar } = useProfile();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [localAvatarUrl, setLocalAvatarUrl] = useState<string | null>(null);
  const [cropModalOpen, setCropModalOpen] = useState(false);
  const [selectedImageSrc, setSelectedImageSrc] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    bio: '',
    hobbies: '',
    college: '',
    gender: ''
  });

  useEffect(() => {
    if (profile) {
      setFormData({
        name: profile.name || '',
        bio: profile.bio || '',
        hobbies: profile.hobbies || '',
        college: profile.college || '',
        gender: profile.gender || ''
      });
      setLocalAvatarUrl(getAvatarUrl(profile.avatar_url) || null);
    }
  }, [profile]);

  useEffect(() => {
    if (profile?.avatar_url) {
      setLocalAvatarUrl(getAvatarUrl(profile.avatar_url) || null);
    }
  }, [profile?.avatar_url, getAvatarUrl]);

  const handleAvatarClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    e.target.value = '';

    if (!file.type.startsWith('image/')) {
      toast({
        title: 'Invalid file type',
        description: 'Please upload an image file.',
        variant: 'destructive'
      });
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      toast({
        title: 'File too large',
        description: 'Please upload an image smaller than 5MB.',
        variant: 'destructive'
      });
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      setSelectedImageSrc(reader.result as string);
      setCropModalOpen(true);
    };
    reader.readAsDataURL(file);
  };

  const handleCropComplete = async (croppedBlob: Blob) => {
    const previewUrl = URL.createObjectURL(croppedBlob);
    setLocalAvatarUrl(previewUrl);

    setUploading(true);
    const file = new File([croppedBlob], 'avatar.jpg', { type: 'image/jpeg' });
    const { error, url } = await uploadAvatar(file);
    setUploading(false);

    URL.revokeObjectURL(previewUrl);

    if (error) {
      setLocalAvatarUrl(getAvatarUrl(profile?.avatar_url) || null);
      toast({
        title: 'Upload failed',
        description: 'Failed to upload profile photo.',
        variant: 'destructive'
      });
    } else {
      refreshAvatar();
      if (url) {
        setLocalAvatarUrl(`${url}?t=${Date.now()}`);
      }
      toast({
        title: 'Photo uploaded',
        description: 'Your profile photo has been updated.'
      });
      await fetchProfile();
    }

    setCropModalOpen(false);
    setSelectedImageSrc(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.name.trim()) {
      toast({
        title: 'Name required',
        description: 'Please enter your name.',
        variant: 'destructive'
      });
      return;
    }

    setSaving(true);
    const { error } = await updateProfile({
      name: formData.name.trim(),
      bio: formData.bio.trim() || null,
      hobbies: formData.hobbies.trim() || null,
      college: formData.college.trim() || null,
      gender: formData.gender || null
    });
    setSaving(false);

    if (error) {
      toast({
        title: 'Update failed',
        description: 'Failed to update profile.',
        variant: 'destructive'
      });
    } else {
      toast({
        title: 'Profile updated',
        description: 'Your profile has been saved.'
      });
      onClose();
    }
  };

  const getInitials = () => {
    if (formData.name) {
      return formData.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
    }
    if (user?.email) {
      return user.email[0].toUpperCase();
    }
    return 'U';
  };

  return (
    <>
      <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent className="sm:max-w-md p-0 overflow-hidden border-none bg-transparent shadow-none max-h-[90vh]">
          {/* Glass card wrapper matching View Profile */}
          <div className="glass-card px-6 pb-6 pt-6 max-h-[90vh] overflow-y-auto">
            
            {/* Header */}
            <div className="flex items-center justify-between pb-4 mb-5 border-b border-white/10">
              <h2 className="text-xl font-semibold text-foreground">Edit Profile</h2>
              <button
                type="button"
                onClick={onClose}
                className="glass-icon-button"
              >
                <X className="h-4 w-4 text-muted-foreground" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-5">
              {/* Avatar Upload */}
              <div className="flex justify-center mb-2">
                <div className="relative group">
                  <div className="rounded-full p-1 ring-2 ring-white/20 shadow-[0_0_20px_rgba(59,130,246,0.2)] group-hover:shadow-[0_0_28px_rgba(59,130,246,0.35)] transition-shadow duration-300">
                    <Avatar
                      className="h-24 w-24 cursor-pointer transition-transform duration-300 group-hover:scale-105"
                      onClick={handleAvatarClick}
                    >
                      <AvatarImage src={localAvatarUrl || undefined} />
                      <AvatarFallback className="bg-primary/20 text-primary text-xl font-semibold">
                        {uploading ? <Loader2 className="h-6 w-6 animate-spin" /> : getInitials()}
                      </AvatarFallback>
                    </Avatar>
                  </div>
                  <button
                    type="button"
                    onClick={handleAvatarClick}
                    disabled={uploading}
                    className="glass-icon-button absolute bottom-0 right-0 w-8 h-8 shadow-[0_0_12px_rgba(59,130,246,0.4)]"
                  >
                    {uploading ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-white" />
                    ) : (
                      <Camera className="h-3.5 w-3.5 text-white" />
                    )}
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleFileChange}
                  />
                </div>
              </div>

              {/* Name */}
              <div className="space-y-1.5">
                <Label className="text-sm text-muted-foreground">
                  Name <span className="text-destructive">*</span>
                </Label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="Your name"
                  required
                  className="w-full bg-white/5 backdrop-blur-md border border-white/10 rounded-xl px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/50 outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-white/20 transition-all duration-200"
                />
              </div>

              {/* Bio */}
              <div className="space-y-1.5">
                <Label className="text-sm text-muted-foreground">Bio</Label>
                <textarea
                  value={formData.bio}
                  onChange={(e) => setFormData({ ...formData, bio: e.target.value })}
                  placeholder="Tell others about yourself..."
                  rows={3}
                  maxLength={200}
                  className="w-full bg-white/5 backdrop-blur-md border border-white/10 rounded-xl px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/50 outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-white/20 transition-all duration-200 resize-none"
                />
                <p className="text-xs text-muted-foreground/60 text-right">
                  {formData.bio.length}/200
                </p>
              </div>

              {/* Hobbies */}
              <div className="space-y-1.5">
                <Label className="text-sm text-muted-foreground">Hobbies & Interests</Label>
                <input
                  type="text"
                  value={formData.hobbies}
                  onChange={(e) => setFormData({ ...formData, hobbies: e.target.value })}
                  placeholder="e.g. Reading, Music, Travel"
                  className="w-full bg-white/5 backdrop-blur-md border border-white/10 rounded-xl px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/50 outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-white/20 transition-all duration-200"
                />
              </div>

              {/* College */}
              <div className="space-y-1.5">
                <Label className="text-sm text-muted-foreground">College / Organization</Label>
                <input
                  type="text"
                  value={formData.college}
                  onChange={(e) => setFormData({ ...formData, college: e.target.value })}
                  placeholder="Your college or organization"
                  className="w-full bg-white/5 backdrop-blur-md border border-white/10 rounded-xl px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/50 outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-white/20 transition-all duration-200"
                />
              </div>

              {/* Gender */}
              <div className="space-y-1.5">
                <Label className="text-sm text-muted-foreground">Gender</Label>
                <Select
                  value={formData.gender}
                  onValueChange={(value) => setFormData({ ...formData, gender: value })}
                >
                  <SelectTrigger className="bg-white/5 backdrop-blur-md border-white/10 rounded-xl focus:ring-2 focus:ring-blue-500/40 focus:border-white/20 transition-all duration-200">
                    <SelectValue placeholder="Select gender" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="male">Male</SelectItem>
                    <SelectItem value="female">Female</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                    <SelectItem value="prefer_not_to_say">Prefer not to say</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Actions */}
              <div className="flex justify-end gap-3 pt-2">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={onClose}
                  className="rounded-xl text-muted-foreground hover:text-foreground hover:bg-white/10"
                >
                  Cancel
                </Button>
                <button
                  type="submit"
                  disabled={saving}
                  className="btn-primary-glow flex items-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {saving ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    'Save Changes'
                  )}
                </button>
              </div>
            </form>
          </div>
        </DialogContent>
      </Dialog>

      {selectedImageSrc && (
        <ImageCropModal
          isOpen={cropModalOpen}
          onClose={() => {
            setCropModalOpen(false);
            setSelectedImageSrc(null);
          }}
          imageSrc={selectedImageSrc}
          onCropComplete={handleCropComplete}
        />
      )}
    </>
  );
};
