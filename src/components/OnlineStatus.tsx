import { cn } from '@/lib/utils';

interface OnlineStatusProps {
  isOnline: boolean;
  showLabel?: boolean;
  className?: string;
}

export const OnlineStatus = ({ isOnline, showLabel, className }: OnlineStatusProps) => (
  <div className={cn('flex items-center gap-1.5', className)}>
    <span 
      className={cn(
        'w-2 h-2 rounded-full',
        isOnline ? 'bg-green-500' : 'bg-muted-foreground'
      )} 
    />
    {showLabel && (
      <span className="text-xs text-muted-foreground">
        {isOnline ? 'Online' : 'Offline'}
      </span>
    )}
  </div>
);
