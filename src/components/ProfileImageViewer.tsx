import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';

interface ProfileImageViewerProps {
  isOpen: boolean;
  onClose: () => void;
  imageUrl: string | undefined;
  fallback?: React.ReactNode;
}

export const ProfileImageViewer = ({ 
  isOpen, 
  onClose, 
  imageUrl,
  fallback 
}: ProfileImageViewerProps) => {
  return (
    <DialogPrimitive.Root open={isOpen} onOpenChange={onClose}>
      <DialogPrimitive.Portal>
        {/* Dark overlay */}
        <DialogPrimitive.Overlay 
          className="fixed inset-0 z-50 bg-black/90 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0"
          onClick={onClose}
        />
        
        {/* Content - centered image */}
        <DialogPrimitive.Content 
          className="fixed inset-0 z-50 flex items-center justify-center p-8 pointer-events-none"
        >
          {/* Close button */}
          <DialogPrimitive.Close 
            className="absolute top-4 right-4 z-50 p-2 rounded-full bg-white/10 hover:bg-white/20 transition-colors pointer-events-auto"
            aria-label="Close"
          >
            <X className="h-6 w-6 text-white" />
          </DialogPrimitive.Close>

          {/* Image container */}
          <div 
            className="pointer-events-auto"
            onClick={(e) => e.stopPropagation()}
          >
            {imageUrl ? (
              <img
                src={imageUrl}
                alt="Profile"
                className="max-w-[85vw] max-h-[85vh] object-contain rounded-xl shadow-2xl"
              />
            ) : fallback ? (
              <div className="w-48 h-48 sm:w-64 sm:h-64 rounded-full flex items-center justify-center bg-primary/20 text-primary text-5xl sm:text-6xl font-semibold border-2 border-white/20">
                {fallback}
              </div>
            ) : null}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
};
