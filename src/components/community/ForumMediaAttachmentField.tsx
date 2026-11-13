import React, { useEffect, useState } from 'react';
import { ImagePlus, Link2, Plus, Trash2, X } from 'lucide-react';
import { toSafeHttpUrl } from '@/lib/forumMedia';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface ForumMediaAttachmentFieldProps {
  mediaUrls: string[];
  onChange: (nextUrls: string[]) => void;
  disabled?: boolean;
  compact?: boolean;
}

const ForumMediaAttachmentField: React.FC<ForumMediaAttachmentFieldProps> = ({
  mediaUrls,
  onChange,
  disabled = false,
  compact = false,
}) => {
  const [showFields, setShowFields] = useState(mediaUrls.length > 0);
  const [failedPreviewIndexes, setFailedPreviewIndexes] = useState<Record<number, boolean>>({});

  useEffect(() => {
    if (mediaUrls.length > 0) {
      setShowFields(true);
    }
  }, [mediaUrls.length]);

  const handleToggleOpen = () => {
    if (disabled) return;
    if (mediaUrls.length === 0) {
      onChange(['']);
      setShowFields(true);
      return;
    }
    setShowFields((prev) => !prev);
  };

  const handleUpdateUrl = (index: number, value: string) => {
    const next = [...mediaUrls];
    next[index] = value;
    setFailedPreviewIndexes((prev) => {
      if (!prev[index]) return prev;
      const copy = { ...prev };
      delete copy[index];
      return copy;
    });
    onChange(next);
  };

  const handleAddField = () => {
    onChange([...mediaUrls, '']);
  };

  const handleRemoveField = (index: number) => {
    const next = mediaUrls.filter((_, i) => i !== index);
    setFailedPreviewIndexes({});
    onChange(next);
    if (next.length === 0) {
      setShowFields(false);
    }
  };

  const validPreviews = mediaUrls
    .map((url, index) => ({
      index,
      safeUrl: toSafeHttpUrl(url),
    }))
    .filter((entry): entry is { index: number; safeUrl: string } => Boolean(entry.safeUrl));

  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled}
          onClick={handleToggleOpen}
          className="h-8 gap-1.5 px-2.5 text-xs text-muted-foreground hover:text-foreground"
        >
          <ImagePlus className="h-4 w-4" />
          <span>Görsel / GIF Ekle</span>
        </Button>
      </div>

      {validPreviews.length > 0 && (
        <div className="flex flex-wrap gap-2.5">
          {validPreviews.map(({ index, safeUrl }) => (
            <div
              key={`${safeUrl}-${index}`}
              className="group relative overflow-hidden rounded-xl border border-border/70 bg-background/60"
            >
              {failedPreviewIndexes[index] ? (
                <div className="flex h-20 w-44 items-center gap-2 px-3 text-xs text-muted-foreground">
                  <Link2 className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{safeUrl}</span>
                </div>
              ) : (
                <img
                  src={safeUrl}
                  alt={`Eklenen görsel ${index + 1}`}
                  onError={() =>
                    setFailedPreviewIndexes((prev) => ({
                      ...prev,
                      [index]: true,
                    }))
                  }
                  className={compact ? 'h-24 w-auto max-w-[180px] object-contain' : 'h-28 w-auto max-w-[220px] object-contain'}
                />
              )}
              <button
                type="button"
                disabled={disabled}
                onClick={() => handleRemoveField(index)}
                aria-label="Görseli kaldır"
                className="absolute right-1.5 top-1.5 inline-flex h-6 w-6 items-center justify-center rounded-full bg-background/85 text-foreground shadow-sm transition-colors hover:bg-destructive hover:text-destructive-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      {showFields && (
        <div className="space-y-2 rounded-xl border border-border/60 bg-background/35 p-3">
          {mediaUrls.map((url, index) => (
            <div key={index} className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <Input
                value={url}
                onChange={(event) => handleUpdateUrl(index, event.target.value)}
                placeholder={`Görsel veya GIF bağlantısı (https://...) #${index + 1}`}
                disabled={disabled}
                className="h-9 text-xs sm:text-sm"
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={disabled}
                onClick={() => handleRemoveField(index)}
                className="h-9 gap-1.5 text-xs text-muted-foreground hover:text-destructive self-end sm:self-auto"
              >
                <Trash2 className="h-3.5 w-3.5" />
                <span>Kaldır</span>
              </Button>
            </div>
          ))}

          {mediaUrls.length < 6 && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={disabled}
              onClick={handleAddField}
              className="h-8 gap-1.5 text-xs"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Bir Tane Daha Ekle</span>
            </Button>
          )}
        </div>
      )}
    </div>
  );
};

export default ForumMediaAttachmentField;
