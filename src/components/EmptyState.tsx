import { LucideIcon } from 'lucide-react';
import emptyStateIllustration from '@/assets/empty-state-illustration.png';

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
  secondaryActionLabel?: string;
  onSecondaryAction?: () => void;
  showIllustration?: boolean;
}

export const EmptyState = ({
  icon: Icon,
  title,
  description,
  actionLabel,
  onAction,
  secondaryActionLabel,
  onSecondaryAction,
  showIllustration = true
}: EmptyStateProps) => (
  <div 
    className="relative text-center animate-fade-in rounded-3xl overflow-hidden min-h-[320px] flex items-center justify-center"
    style={{
      zIndex: 10,
      backgroundColor: 'rgba(255, 255, 255, 0.03)',
      backdropFilter: 'blur(60px) saturate(1.8)',
      WebkitBackdropFilter: 'blur(60px) saturate(1.8)',
      border: '1px solid rgba(120, 180, 255, 0.15)',
      boxShadow: '0 0 40px rgba(59, 130, 246, 0.08), 0 0 80px rgba(0, 0, 0, 0.4), inset 0 0 30px rgba(255, 255, 255, 0.02)'
    }}
  >
    {/* Background Illustration - blended into glass */}
    {showIllustration && (
      <div className="absolute inset-0 flex items-center justify-center">
        <img 
          src={emptyStateIllustration} 
          alt="" 
          aria-hidden="true"
          className="absolute inset-0 w-full h-full object-cover opacity-40 mix-blend-luminosity"
        />
        {/* Soft glow behind illustration */}
        <div className="absolute inset-0 bg-gradient-radial from-sky-500/10 via-transparent to-transparent" 
          style={{ background: 'radial-gradient(ellipse at center, rgba(56, 152, 236, 0.12) 0%, transparent 70%)' }}
        />
      </div>
    )}
    
    {/* Subtle overlay for readability - very light to keep transparency */}
    <div className="absolute inset-0 bg-black/30" />
    
    {/* Content overlay */}
    <div className="relative z-10 p-8">
      {/* Icon fallback when no illustration */}
      {!showIllustration && (
        <div className="relative mx-auto mb-6 w-20 h-20 rounded-2xl flex items-center justify-center bg-white/10 border border-white/10">
          <Icon className="h-10 w-10 text-white" />
          <div className="absolute inset-0 rounded-2xl bg-sky-400/10 blur-xl" />
        </div>
      )}
      
      <h3 className="text-xl font-semibold mb-2 text-white">{title}</h3>
      <p className="text-white/60 mb-6 max-w-sm mx-auto">{description}</p>
      
      {(actionLabel || secondaryActionLabel) && (
        <div className="flex gap-3 justify-center">
          {actionLabel && onAction && (
            <button onClick={onAction} className="btn-primary-glow">
              {actionLabel}
            </button>
          )}
          {secondaryActionLabel && onSecondaryAction && (
            <button onClick={onSecondaryAction} className="glass-button text-white">
              {secondaryActionLabel}
            </button>
          )}
        </div>
      )}
    </div>
  </div>
);