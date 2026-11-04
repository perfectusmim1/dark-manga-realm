import React from 'react';
import { AlertTriangle, CheckCircle2, Languages, Loader2, RefreshCw, Square, X } from 'lucide-react';
import { TranslationSummary } from '@/hooks/useChapterTranslation';
import { cn } from '@/lib/utils';

interface TranslationStatusPillProps {
  summary: TranslationSummary;
  nextChapterProgress?: {
    chapterNumber: number | string;
    completedPages: number;
    totalPages: number;
    percent: number;
  } | null;
  onCancel?: () => void;
  onCancelNextChapter?: () => void;
  onRetry: () => void;
  onDismiss: () => void;
}

const TranslationStatusPill: React.FC<TranslationStatusPillProps> = ({
  summary,
  nextChapterProgress,
  onCancel,
  onCancelNextChapter,
  onRetry,
  onDismiss,
}) => {
  const {
    isBusy,
    doneCount,
    batchDone,
    batchTotal,
    activePageNumbers,
    lastFinishedPageNumber,
    lastErrorMessage,
    completedPulseAt,
    lastTimings,
    isPillDismissed,
  } = summary;

  const showError = !isBusy && Boolean(lastErrorMessage);
  const showCompleted = !isBusy && !showError && Boolean(completedPulseAt);
  const showNextChapterPretranslating =
    !isBusy &&
    !showError &&
    Boolean(nextChapterProgress) &&
    Boolean(nextChapterProgress && nextChapterProgress.completedPages < nextChapterProgress.totalPages);

  if (isPillDismissed || (!isBusy && !showError && !showCompleted && !showNextChapterPretranslating)) {
    return null;
  }

  const isMultiPageBatch = batchTotal > 1;
  const activePageText =
    activePageNumbers.length > 0 ? `Sayfa ${activePageNumbers.join(', ')}` : '';

  return (
    <div
      role="status"
      aria-live="polite"
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      className={cn(
        'pointer-events-auto w-[min(18.5rem,calc(100vw-6.5rem))] overflow-hidden rounded-2xl border bg-card/90 p-2.5 text-foreground shadow-[0_10px_32px_rgb(0,0,0,0.5)] backdrop-blur-xl animate-fade-in',
        showError
          ? 'border-destructive/45'
          : 'border-primary/35 shadow-[0_10px_32px_rgb(0,0,0,0.5),0_0_22px_hsl(var(--primary)/0.14)]',
      )}
    >
      {isBusy && (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              </span>
              <div className="min-w-0">
                <p className="truncate text-xs font-semibold leading-tight text-foreground">
                  {isMultiPageBatch
                    ? `Çevriliyor · ${batchDone}/${batchTotal} sayfa`
                    : activePageText
                      ? `Çevriliyor · ${activePageText}`
                      : 'Çevriliyor...'}
                </p>
                {lastTimings ? (
                  <p className="truncate text-[10px] font-mono leading-tight text-muted-foreground">
                    OCR: {(lastTimings.ocrMs / 1000).toFixed(1)}s
                    {lastTimings.provider === 'google' && ` · Çeviri: ${(lastTimings.transMs / 1000).toFixed(1)}s`}
                  </p>
                ) : isMultiPageBatch && activePageText ? (
                  <p className="truncate text-[11px] leading-tight text-muted-foreground">
                    {activePageText}
                  </p>
                ) : null}
              </div>
            </div>

            <div className="flex items-center gap-1">
              {onCancel && (
                <button
                  type="button"
                  onClick={onCancel}
                  title="Çeviriyi durdur"
                  aria-label="Çeviriyi durdur"
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-destructive"
                >
                  <Square className="h-3 w-3 fill-current" />
                </button>
              )}
              <button
                type="button"
                onClick={onDismiss}
                title="Kutuyu kapat (Çeviri arka planda devam eder)"
                aria-label="Kutuyu kapat"
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          <progress
            className="tp-progress block h-1.5 w-full"
            aria-label="Görsel çeviri ilerlemesi"
            max={isMultiPageBatch ? batchTotal : 1}
            value={isMultiPageBatch ? batchDone : undefined}
          />
        </div>
      )}

      {showNextChapterPretranslating && nextChapterProgress && (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-400">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              </span>
              <div className="min-w-0">
                <p className="truncate text-xs font-semibold leading-tight text-foreground">
                  Sonraki Bölüm Çevriliyor
                </p>
                <p className="truncate text-[11px] leading-tight text-muted-foreground">
                  Bölüm {nextChapterProgress.chapterNumber} · {nextChapterProgress.completedPages}/{nextChapterProgress.totalPages} sayfa
                </p>
              </div>
            </div>

            <div className="flex items-center gap-1">
              {onCancelNextChapter && (
                <button
                  type="button"
                  onClick={onCancelNextChapter}
                  title="Sonraki bölüm çevirisini durdur"
                  aria-label="Sonraki bölüm çevirisini durdur"
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-destructive"
                >
                  <Square className="h-3 w-3 fill-current" />
                </button>
              )}
              <button
                type="button"
                onClick={onDismiss}
                title="Kutuyu kapat"
                aria-label="Kutuyu kapat"
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          <progress
            className="tp-progress block h-1.5 w-full accent-emerald-500"
            aria-label="Sonraki bölüm çeviri ilerlemesi"
            max={nextChapterProgress.totalPages}
            value={nextChapterProgress.completedPages}
          />
        </div>
      )}

      {showCompleted && (
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
              <CheckCircle2 className="h-3.5 w-3.5" />
            </span>
            <p className="truncate text-xs font-semibold text-foreground">
              {doneCount > 1
                ? `Çevrildi · ${doneCount} sayfa hazır`
                : lastFinishedPageNumber
                  ? `Sayfa ${lastFinishedPageNumber} çevrildi`
                  : 'Çeviri tamamlandı'}
            </p>
          </div>
          <Languages className="h-3.5 w-3.5 shrink-0 text-primary/80" />
        </div>
      )}

      {showError && (
        <div className="space-y-2">
          <div className="flex items-start justify-between gap-2">
            <div className="flex min-w-0 items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
              <p className="text-xs leading-snug text-foreground/95">{lastErrorMessage}</p>
            </div>
            <button
              type="button"
              onClick={onDismiss}
              aria-label="Uyarıyı kapat"
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              <X className="h-3 w-3" />
            </button>
          </div>

          <button
            type="button"
            onClick={onRetry}
            className="flex h-7 w-full items-center justify-center gap-1.5 rounded-lg border border-border/70 bg-secondary/70 text-xs font-medium text-foreground transition-colors hover:border-primary/40 hover:bg-secondary"
          >
            <RefreshCw className="h-3 w-3 text-primary" />
            <span>Tekrar dene</span>
          </button>
        </div>
      )}
    </div>
  );
};

export default TranslationStatusPill;
