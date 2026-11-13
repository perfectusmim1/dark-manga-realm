import React from 'react';
import {
  Bold,
  EyeOff,
  Hash,
  Italic,
  Link2,
  List,
  ListOrdered,
  Underline,
} from 'lucide-react';
import {
  applyTextareaInlineWrap,
  applyTextareaListPrefix,
} from '@/lib/commentContent';
import { cn } from '@/lib/utils';

interface RichTextToolbarProps {
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  value: string;
  onChange: (nextValue: string) => void;
  onTriggerSeriesTag?: () => void;
  leftSlot?: React.ReactNode;
  rightSlot?: React.ReactNode;
  className?: string;
}

/**
 * Compact shared composer formatting bar (`B`, `I`, `U`, lists, inline spoiler, link, `#` series tagger).
 */
export const RichTextToolbar: React.FC<RichTextToolbarProps> = ({
  textareaRef,
  value,
  onChange,
  onTriggerSeriesTag,
  leftSlot,
  rightSlot,
  className,
}) => {
  const applyEdit = (
    updater: (
      current: string,
      selectionStart: number,
      selectionEnd: number,
    ) => { nextValue: string; selectionStart: number; selectionEnd: number },
  ) => {
    const el = textareaRef.current;
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? value.length;
    const res = updater(value, start, end);
    onChange(res.nextValue);

    window.requestAnimationFrame(() => {
      const target = textareaRef.current;
      if (!target) return;
      target.focus();
      target.setSelectionRange(res.selectionStart, res.selectionEnd);
    });
  };

  const handleLinkInsert = () => {
    applyEdit((current, start, end) => {
      const selected = current.slice(start, end).trim();
      const label = selected || 'bağlantı metni';
      const placeholderUrl = 'https://';
      const token = `[${label}](${placeholderUrl})`;
      const nextValue = current.slice(0, start) + token + current.slice(end);
      const urlStart = start + label.length + 3;
      return {
        nextValue,
        selectionStart: urlStart,
        selectionEnd: urlStart + placeholderUrl.length,
      };
    });
  };

  const btnClass =
    'inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/50';

  return (
    <div
      className={cn(
        'flex flex-wrap items-center justify-between gap-1.5 border-b border-border/50 px-2.5 py-1.5',
        className,
      )}
    >
      <div className="flex flex-wrap items-center gap-0.5 min-w-0">
        {leftSlot && <div className="mr-1.5 flex items-center gap-1.5 min-w-0">{leftSlot}</div>}

        <button
          type="button"
          className={btnClass}
          title="Kalın (**metin**)"
          aria-label="Kalın"
          onClick={() => applyEdit((v, s, e) => applyTextareaInlineWrap(v, s, e, '**', '**', 'kalın metin'))}
        >
          <Bold className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          className={btnClass}
          title="İtalik (*metin*)"
          aria-label="İtalik"
          onClick={() => applyEdit((v, s, e) => applyTextareaInlineWrap(v, s, e, '*', '*', 'italik metin'))}
        >
          <Italic className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          className={btnClass}
          title="Altı Çizili (__metin__)"
          aria-label="Altı çizili"
          onClick={() => applyEdit((v, s, e) => applyTextareaInlineWrap(v, s, e, '__', '__', 'altı çizili'))}
        >
          <Underline className="h-3.5 w-3.5" />
        </button>

        <span className="mx-1 h-4 w-px bg-border/60" aria-hidden="true" />

        <button
          type="button"
          className={btnClass}
          title="Madde İşaretli Liste"
          aria-label="Madde işaretli liste"
          onClick={() => applyEdit((v, s, e) => applyTextareaListPrefix(v, s, e, false))}
        >
          <List className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          className={btnClass}
          title="Numaralı Liste"
          aria-label="Numaralı liste"
          onClick={() => applyEdit((v, s, e) => applyTextareaListPrefix(v, s, e, true))}
        >
          <ListOrdered className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          className={btnClass}
          title="Satır İçi Spoiler (||spoiler||)"
          aria-label="Satır içi spoiler"
          onClick={() => applyEdit((v, s, e) => applyTextareaInlineWrap(v, s, e, '||', '||', 'spoiler'))}
        >
          <EyeOff className="h-3.5 w-3.5" />
        </button>

        <span className="mx-1 h-4 w-px bg-border/60" aria-hidden="true" />

        <button
          type="button"
          className={btnClass}
          title="Bağlantı Ekle"
          aria-label="Bağlantı ekle"
          onClick={handleLinkInsert}
        >
          <Link2 className="h-3.5 w-3.5" />
        </button>
        {onTriggerSeriesTag && (
          <button
            type="button"
            className={btnClass}
            title="Seri Etiketle (#)"
            aria-label="Seri etiketle"
            onClick={onTriggerSeriesTag}
          >
            <Hash className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {rightSlot && <div className="flex items-center gap-1">{rightSlot}</div>}
    </div>
  );
};
