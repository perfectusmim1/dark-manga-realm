import React, { useEffect, useMemo, useState } from 'react';
import { ExternalLink, ImageIcon, Link2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface SupportImageAttachmentProps {
  url: string;
  alt: string;
  className?: string;
  initialPreview?: boolean;
  previewClassName?: string;
  variant?: 'default' | 'adminCompact';
}

const normalizeSupportImageUrl = (value?: string | null) => {
  const input = value?.trim();
  if (!input) {
    return null;
  }

  try {
    const parsed = new URL(input);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }

    return parsed.href;
  } catch {
    return null;
  }
};

const SupportImageAttachment: React.FC<SupportImageAttachmentProps> = ({
  url,
  alt,
  className,
  initialPreview = false,
  previewClassName = 'max-h-72 w-full object-cover',
  variant = 'default',
}) => {
  const normalizedUrl = useMemo(() => normalizeSupportImageUrl(url), [url]);
  const [showPreview, setShowPreview] = useState(initialPreview);

  useEffect(() => {
    setShowPreview(initialPreview);
  }, [initialPreview, normalizedUrl]);

  if (!normalizedUrl) {
    return null;
  }

  const hostLabel = (() => {
    try {
      return new URL(normalizedUrl).hostname;
    } catch {
      return normalizedUrl;
    }
  })();

  return (
    <div className={cn('space-y-3', className)}>
      {variant === 'adminCompact' ? (
        <div className="rounded-[1.15rem] border border-border/70 bg-background/60 p-3">
          <div className="flex min-w-0 items-center gap-2">
            <p className="shrink-0 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Görsel bağlantısı</p>
            <span className="truncate text-xs text-foreground/80" title={normalizedUrl}>{hostLabel}</span>
          </div>
          <div className="mt-3 flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="min-w-0 flex-1 justify-center rounded-xl border-border/70 bg-background/70"
              onClick={() => setShowPreview((current) => !current)}
            >
              <ImageIcon className="h-4 w-4" />
              {showPreview ? 'Önizlemeyi Gizle' : 'Önizlemeyi Yükle'}
            </Button>
            <Button
              asChild
              type="button"
              variant="outline"
              size="icon"
              className="h-9 w-9 shrink-0 rounded-xl border-border/70 bg-background/70"
            >
              <a href={normalizedUrl} target="_blank" rel="noreferrer noopener" aria-label="Yeni sekmede aç">
                <ExternalLink className="h-4 w-4" />
              </a>
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3 rounded-2xl border border-border/70 bg-background/60 p-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">Görsel bağlantısı</p>
            <div className="mt-1 flex min-w-0 items-center gap-2 text-sm text-foreground">
              <Link2 className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="truncate">{hostLabel}</span>
            </div>
          </div>
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap sm:justify-end">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-full sm:w-auto"
              onClick={() => setShowPreview((current) => !current)}
            >
              <ImageIcon className="mr-2 h-4 w-4" />
              {showPreview ? 'Önizlemeyi Gizle' : 'Önizlemeyi Yükle'}
            </Button>
            <Button asChild type="button" variant="ghost" size="sm" className="w-full sm:w-auto">
              <a href={normalizedUrl} target="_blank" rel="noreferrer noopener">
                <ExternalLink className="mr-2 h-4 w-4" />
                Yeni Sekmede Aç
              </a>
            </Button>
          </div>
        </div>
      )}

      {showPreview && (
        <div className="overflow-hidden rounded-2xl border border-border/70 bg-background/60">
          <img
            src={normalizedUrl}
            alt={alt}
            className={previewClassName}
            loading="lazy"
            referrerPolicy="no-referrer"
          />
        </div>
      )}
    </div>
  );
};

export default SupportImageAttachment;
