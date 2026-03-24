import React from 'react';
import { Download } from 'lucide-react';
import { cn } from '@/lib/utils';
import InstallAppButton from '@/components/pwa/InstallAppButton';

interface InstallAppBannerProps {
  compact?: boolean;
  className?: string;
}

const InstallAppBanner: React.FC<InstallAppBannerProps> = ({
  compact = false,
  className,
}) => {
  return (
    <section
      className={cn(
        'rounded-3xl border border-blue-500/20 bg-gradient-to-br from-blue-500/12 via-card/80 to-card/60 backdrop-blur-sm',
        compact ? 'p-4' : 'p-6 md:p-7',
        className,
      )}
    >
      <div className={cn('flex gap-4', compact ? 'items-center justify-between' : 'flex-col md:flex-row md:items-center md:justify-between')}>
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-primary">
            <Download className="h-4 w-4" />
            <span className="text-xs font-semibold uppercase tracking-[0.22em] text-primary/80">
              Uygulama Kurulumu
            </span>
          </div>

          <h2 className={cn('mt-2 font-black tracking-tight', compact ? 'text-lg' : 'text-2xl')}>
            ToonParrot&apos;ı uygulama gibi yükle
          </h2>
          <p className={cn('mt-2 text-sm text-muted-foreground', compact ? 'max-w-xl' : 'max-w-2xl')}>
            Ana ekrana eklediğinde site daha hızlı açılır, çevrimdışı okuma testleri daha rahat yapılır ve tarayıcı sekmesi gibi kaybolmaz.
          </p>
        </div>

        <div className={cn('flex shrink-0 items-center gap-3', compact ? 'pl-4' : 'pt-1')}>
          <InstallAppButton />
        </div>
      </div>
    </section>
  );
};

export default InstallAppBanner;
