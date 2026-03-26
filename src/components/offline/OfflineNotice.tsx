import React from 'react';
import { Link } from 'react-router-dom';
import { WifiOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface OfflineNoticeProps {
  title?: string;
  description: string;
  className?: string;
  compact?: boolean;
  actionLabel?: string;
  actionHref?: string;
}

const OfflineNotice: React.FC<OfflineNoticeProps> = ({
  title = 'Çevrimdışısınız',
  description,
  className,
  compact = false,
  actionHref,
  actionLabel,
}) => (
  <div
    className={cn(
      'rounded-3xl border border-border/70 bg-card/45 text-center shadow-[0_24px_50px_rgba(0,0,0,0.18)] backdrop-blur-sm',
      compact ? 'px-5 py-8 sm:px-6 sm:py-9' : 'px-6 py-10 sm:px-8 sm:py-12',
      className,
    )}
  >
    <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full border border-primary/20 bg-primary/10 text-primary">
      <WifiOff className="h-6 w-6" />
    </div>
    <h2 className="mt-5 text-xl font-black tracking-tight sm:text-2xl">{title}</h2>
    <p className="mx-auto mt-3 max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">
      {description}
    </p>
    {actionHref && actionLabel && (
      <div className="mt-6">
        <Button asChild variant="outline">
          <Link to={actionHref}>{actionLabel}</Link>
        </Button>
      </div>
    )}
  </div>
);

export default OfflineNotice;
