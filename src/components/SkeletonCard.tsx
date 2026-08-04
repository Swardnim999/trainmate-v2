import { Skeleton } from '@/components/ui/skeleton';

export const SkeletonCard = () => (
  <div className="glass-card-hover p-6 relative z-10">
    <div className="flex justify-between items-start">
      <div className="space-y-3 flex-1">
        <Skeleton className="h-5 w-32 bg-muted/30" />
        <Skeleton className="h-4 w-48 bg-muted/20" />
        <Skeleton className="h-4 w-24 bg-muted/20" />
      </div>
      <Skeleton className="h-8 w-8 rounded-full bg-muted/30" />
    </div>
  </div>
);

export const SkeletonMessage = ({ isOwn }: { isOwn?: boolean }) => (
  <div className={`flex ${isOwn ? 'justify-end' : 'justify-start'}`}>
    <Skeleton className={`h-12 w-48 rounded-lg ${isOwn ? 'bg-primary/20' : 'bg-muted/20'}`} />
  </div>
);

export const SkeletonJourneyCard = () => (
  <div className="glass-card-hover p-5 animate-pulse relative z-10">
    <div className="flex items-start gap-3 mb-4">
      <Skeleton className="h-10 w-10 rounded-xl bg-muted/30" />
      <div className="flex-1 space-y-2">
        <Skeleton className="h-5 w-32 bg-muted/30" />
        <Skeleton className="h-3 w-24 bg-muted/20" />
      </div>
    </div>
    <div className="space-y-2.5">
      <Skeleton className="h-4 w-40 bg-muted/20" />
      <Skeleton className="h-4 w-32 bg-muted/20" />
      <Skeleton className="h-4 w-48 bg-muted/20" />
    </div>
    <Skeleton className="h-10 w-full mt-4 rounded-xl bg-accent-blue/10" />
  </div>
);
