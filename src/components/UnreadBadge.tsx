import React from 'react';

interface UnreadBadgeProps {
  count: number;
  className?: string;
}

export const UnreadBadge: React.FC<UnreadBadgeProps> = ({ count, className = '' }) => {
  if (count === 0) return null;

  return (
    <div className={`absolute -top-1 -right-1 ${className}`}>
      <div className="min-w-5 h-5 bg-destructive rounded-full flex items-center justify-center px-1">
        <span className="text-xs text-destructive-foreground font-bold">
          {count > 9 ? '9+' : count}
        </span>
      </div>
    </div>
  );
};