import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  ChevronDown,
  ChevronUp,
  Download,
  Minus,
  PauseCircle,
  PlayCircle,
  WifiOff,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { useOfflineLibrary } from '@/hooks/useOfflineLibrary';
import { isDownloadAuthRequiredError, offlineDownloadManager } from '@/lib/offline/downloadManager';
import { DownloadJob, OfflineDownloadStatus } from '@/lib/offline/types';
import { formatBytes, formatSpeed } from '@/lib/offline/utils';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

const STORAGE_KEYS = {
  minimized: 'toonparrot_download_dock_minimized',
  hiddenWhenIdle: 'toonparrot_download_dock_hidden_when_idle',
};

const RELEVANT_STATUSES: OfflineDownloadStatus[] = ['running', 'queued', 'paused', 'failed', 'partial', 'completed'];
const ACTIVE_STATUSES: OfflineDownloadStatus[] = ['running', 'queued', 'paused'];
const FINISHED_STATUSES: OfflineDownloadStatus[] = ['completed', 'failed', 'partial', 'cancelled'];

const STATUS_PRIORITY: Record<OfflineDownloadStatus, number> = {
  running: 0,
  queued: 1,
  paused: 2,
  failed: 3,
  partial: 4,
  completed: 5,
  cancelled: 6,
};

const STATUS_LABELS: Record<OfflineDownloadStatus, string> = {
  running: 'İndiriliyor',
  queued: 'Kuyrukta',
  paused: 'Duraklatıldı',
  failed: 'Hatalı',
  partial: 'Kısmi',
  completed: 'Tamamlandı',
  cancelled: 'İptal Edildi',
};

const isReaderRoute = (pathname: string) => /^\/manga\/[^/]+\/chapter\/[^/]+/.test(pathname);
const DOCK_TRANSITION_CLASS = 'transition-[opacity,transform,border-color] duration-200 ease-out';
const DOCK_PANEL_TRANSITION_CLASS = 'transition-[grid-template-rows,opacity] duration-200 ease-out';
const DOCK_EXIT_DURATION_MS = 200;
const DOCK_SNAPSHOT_THROTTLE_MS = 1000;

const sortJobs = (jobs: DownloadJob[]) => (
  [...jobs].sort((a, b) => {
    const statusDiff = STATUS_PRIORITY[a.status] - STATUS_PRIORITY[b.status];
    if (statusDiff !== 0) {
      return statusDiff;
    }

    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  })
);

const getStoredBoolean = (key: string, fallback = false) => {
  if (typeof window === 'undefined') {
    return fallback;
  }

  const raw = window.localStorage.getItem(key);
  if (raw === null) {
    return fallback;
  }

  return raw === 'true';
};

const setStoredBoolean = (key: string, value: boolean) => {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(key, String(value));
};

const DownloadDock: React.FC = () => {
  const { snapshot, isOnline } = useOfflineLibrary({ throttleMs: DOCK_SNAPSHOT_THROTTLE_MS });
  const { pathname } = useLocation();
  const [isExpanded, setIsExpanded] = useState(false);
  const [isMinimized, setIsMinimized] = useState(() => getStoredBoolean(STORAGE_KEYS.minimized, true));
  const [hiddenWhenIdle, setHiddenWhenIdle] = useState(() => getStoredBoolean(STORAGE_KEYS.hiddenWhenIdle, false));
  const [isDismissing, setIsDismissing] = useState(false);
  const previousActiveJobsCountRef = useRef(0);
  const minimizedTriggerRef = useRef<HTMLButtonElement | null>(null);
  const dismissTimeoutRef = useRef<number | null>(null);

  const relevantJobs = useMemo(
    () => sortJobs(snapshot.jobs.filter((job) => RELEVANT_STATUSES.includes(job.status))),
    [snapshot.jobs],
  );

  const primaryJob = relevantJobs[0];
  const hasActiveJobs = relevantJobs.some((job) => ACTIVE_STATUSES.includes(job.status));
  const hasFinishedJobs = relevantJobs.some((job) => FINISHED_STATUSES.includes(job.status));
  const showMinimizedTrigger = isMinimized && !isDismissing;
  const shouldHideDockSurface = isMinimized || isDismissing;

  useEffect(() => {
    setStoredBoolean(STORAGE_KEYS.minimized, isMinimized);
  }, [isMinimized]);

  useEffect(() => {
    setStoredBoolean(STORAGE_KEYS.hiddenWhenIdle, hiddenWhenIdle);
  }, [hiddenWhenIdle]);

  useEffect(() => {
    if (hasActiveJobs && hiddenWhenIdle) {
      setHiddenWhenIdle(false);
    }
    if (hasActiveJobs && isDismissing) {
      if (dismissTimeoutRef.current !== null) {
        window.clearTimeout(dismissTimeoutRef.current);
        dismissTimeoutRef.current = null;
      }
      setIsDismissing(false);
    }
  }, [hasActiveJobs, hiddenWhenIdle, isDismissing]);

  useEffect(() => (
    () => {
      if (dismissTimeoutRef.current !== null) {
        window.clearTimeout(dismissTimeoutRef.current);
      }
    }
  ), []);

  useEffect(() => {
    const activeJobsCount = relevantJobs.filter((job) => ACTIVE_STATUSES.includes(job.status)).length;
    const previousActiveJobsCount = previousActiveJobsCountRef.current;

    if (activeJobsCount > 0 && previousActiveJobsCount === 0) {
      setIsExpanded(false);
      setIsMinimized(true);
    }

    previousActiveJobsCountRef.current = activeJobsCount;
  }, [relevantJobs]);

  if (!primaryJob || ((!hasActiveJobs && hiddenWhenIdle)) || pathname.startsWith('/downloads') || isReaderRoute(pathname)) {
    return null;
  }

  const handlePause = async (jobId: string) => {
    await offlineDownloadManager.pauseJob(jobId);
  };

  const handleResume = async (jobId: string) => {
    try {
      await offlineDownloadManager.resumeJob(jobId);
    } catch (error) {
      toast.error(isDownloadAuthRequiredError(error) ? error.message : 'İndirme devam ettirilemedi');
    }
  };

  const handleDismiss = () => {
    setIsExpanded(false);
    setIsDismissing(true);

    if (dismissTimeoutRef.current !== null) {
      window.clearTimeout(dismissTimeoutRef.current);
    }

    dismissTimeoutRef.current = window.setTimeout(() => {
      setHiddenWhenIdle(true);
      setIsMinimized(true);
      setIsDismissing(false);
      dismissTimeoutRef.current = null;
    }, DOCK_EXIT_DURATION_MS);
  };

  const handleClearCompleted = async () => {
    await offlineDownloadManager.clearCompletedJobs();
  };

  const handleToggleMinimize = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    event.currentTarget.blur();
    setIsExpanded(false);
    setIsMinimized(true);
    window.requestAnimationFrame(() => {
      minimizedTriggerRef.current?.focus();
    });
  };

  const handleToggleExpanded = () => {
    setIsExpanded((prev) => !prev);
  };

  const handleExpandedKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      handleToggleExpanded();
    }
  };

  return (
    <div
      className="pointer-events-none fixed right-5 z-[90]"
      style={{ bottom: 'calc(var(--mobile-app-bottom-offset, 0px) + 1.25rem)' }}
    >
      <button
        ref={minimizedTriggerRef}
        type="button"
        onClick={() => setIsMinimized(false)}
        className={cn(
          'pointer-events-auto absolute bottom-0 right-0 flex h-[68px] w-[68px] flex-col items-center justify-between overflow-hidden rounded-2xl border border-border/70 bg-background/95 px-3 py-3 text-foreground shadow-xl sm:h-[72px] sm:w-[72px]',
          DOCK_TRANSITION_CLASS,
          showMinimizedTrigger ? 'translate-y-0 opacity-100' : 'translate-y-1 opacity-0',
        )}
        tabIndex={showMinimizedTrigger ? 0 : -1}
        disabled={!showMinimizedTrigger}
        aria-label="İndirme panelini büyüt"
        title="İndirme panelini büyüt"
      >
        <div className="relative mt-0.5 flex h-7 w-7 items-center justify-center rounded-xl bg-primary/10 text-primary sm:h-8 sm:w-8">
          <Download className="h-4 w-4" />
          {hasActiveJobs && (
            <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-primary" />
          )}
        </div>
        <div className="relative mt-2.5 w-full space-y-1.5">
          <Progress
            value={primaryJob.progressPercent}
            className="h-1.5 bg-muted [&>div]:bg-primary"
          />
          <p className="text-center text-[10px] font-semibold text-muted-foreground">
            {Math.round(primaryJob.progressPercent)}%
          </p>
        </div>
      </button>

      <div
        className={cn(
          'absolute bottom-0 right-0 flex max-h-[calc(100vh-6rem)] w-[min(92vw,420px)] max-w-[calc(100vw-1rem)] flex-col items-end gap-2.5 md:w-[min(94vw,440px)]',
          DOCK_TRANSITION_CLASS,
          shouldHideDockSurface
            ? 'pointer-events-none translate-y-2 opacity-0'
            : 'pointer-events-auto translate-y-0 opacity-100',
        )}
        aria-hidden={shouldHideDockSurface}
      >
        <div
          className={cn(
            'grid w-full overflow-hidden rounded-2xl border border-border/70 bg-card/95 shadow-xl',
            DOCK_PANEL_TRANSITION_CLASS,
            isExpanded && !isDismissing
              ? 'grid-rows-[1fr] opacity-100'
              : 'grid-rows-[0fr] opacity-0',
          )}
        >
          <div className="min-h-0 overflow-hidden">
            <div className="max-h-[min(40vh,360px)] overflow-y-auto p-4 md:max-h-[min(52vh,480px)]">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  Arka Plan İndirmeleri
                </p>
                <div className="mt-1.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
                  <h3 className="text-lg font-bold tracking-tight text-foreground">
                    {relevantJobs.length} iş
                  </h3>

                  <div className="flex flex-wrap items-center gap-2">
                    {hasFinishedJobs && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 px-3 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
                        onClick={() => void handleClearCompleted()}
                      >
                        Bitenleri Temizle
                      </Button>
                    )}
                    <Button
                      asChild
                      variant="outline"
                      size="sm"
                      className="border-border bg-background text-foreground hover:bg-muted"
                    >
                      <Link to="/downloads">İndirilenler</Link>
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:bg-muted hover:text-foreground"
                      onClick={() => setIsExpanded(false)}
                      title="Detayı kapat"
                    >
                      <ChevronDown className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>

              {!isOnline && (
                <div className="mt-3 inline-flex items-center gap-2 rounded-full border border-border bg-muted/60 px-3 py-1 text-xs text-muted-foreground">
                  <WifiOff className="h-3.5 w-3.5" />
                  Bağlantı yok, indirmeler internet gelince devam eder.
                </div>
              )}

              <div className="mt-4 space-y-3">
                {relevantJobs.slice(0, 4).map((job) => (
                  <div
                    key={job.id}
                    className="rounded-xl border border-border/70 bg-background/70 p-3 text-foreground"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">{job.mangaTitle}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {STATUS_LABELS[job.status]}
                          {job.currentChapterId ? ' • bölüm indiriliyor' : ''}
                        </p>
                      </div>

                      <div className="flex shrink-0 items-center gap-1">
                        {job.status === 'running' ? (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:bg-muted hover:text-foreground"
                            onClick={() => void handlePause(job.id)}
                            title="Duraklat"
                          >
                            <PauseCircle className="h-4 w-4" />
                          </Button>
                        ) : ['queued', 'paused', 'failed', 'partial'].includes(job.status) ? (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:bg-muted hover:text-foreground"
                            onClick={() => void handleResume(job.id)}
                            title="Devam Et"
                          >
                            <PlayCircle className="h-4 w-4" />
                          </Button>
                        ) : null}
                      </div>
                    </div>

                    <div className="mt-3 space-y-2">
                      <div className="flex items-center justify-between text-[11px] font-medium text-muted-foreground">
                        <span>{Math.round(job.progressPercent)}%</span>
                        <span>
                          {job.speedBps > 0 ? formatSpeed(job.speedBps) : formatBytes(job.downloadedBytes)}
                        </span>
                      </div>
                      <Progress
                        value={job.progressPercent}
                        className="h-1.5 bg-muted [&>div]:bg-primary"
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div
          role="button"
          tabIndex={0}
          aria-expanded={isExpanded}
          onClick={handleToggleExpanded}
          onKeyDown={handleExpandedKeyDown}
          className={cn(
            'relative w-full overflow-hidden rounded-2xl border border-border/70 bg-card/95 p-4 pr-24 text-left text-foreground shadow-xl hover:border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35 focus-visible:ring-offset-2 focus-visible:ring-offset-background',
            DOCK_TRANSITION_CLASS,
            isExpanded && 'rounded-b-lg',
          )}
        >
          <div className="absolute right-3 top-3 z-10 flex items-center gap-1">
            <button
              type="button"
              className="rounded-lg p-1.5 text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground"
              onClick={handleToggleMinimize}
              aria-label="İndirme panelini küçült"
              title="Küçült"
            >
              <Minus className="h-4 w-4" />
            </button>

            {!hasActiveJobs && (
              <button
                type="button"
                className="rounded-lg p-1.5 text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground"
                onClick={(event) => {
                  event.stopPropagation();
                  handleDismiss();
                }}
                aria-label="İndirme panelini kapat"
                title="Kapat"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          <div className="flex items-start gap-3">
            <div className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Download className="h-4 w-4" />
              {hasActiveJobs && (
                <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-primary" />
              )}
            </div>

            <div className="min-w-0 flex-1">
              <div className="pr-2">
                <p className="truncate text-base font-semibold">{primaryJob.mangaTitle}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {STATUS_LABELS[primaryJob.status]}
                  {relevantJobs.length > 1 ? ` • +${relevantJobs.length - 1} iş` : ''}
                </p>
              </div>

              <div className="mt-3 space-y-1.5">
                <div className="flex items-center justify-between text-[11px] font-medium text-muted-foreground">
                  <span>{Math.round(primaryJob.progressPercent)}%</span>
                  <span>
                    {primaryJob.speedBps > 0 ? formatSpeed(primaryJob.speedBps) : formatBytes(primaryJob.downloadedBytes)}
                  </span>
                </div>
                <Progress
                  value={primaryJob.progressPercent}
                  className="h-1.5 bg-muted [&>div]:bg-primary"
                />
              </div>
            </div>
          </div>

          <div className="mt-3 flex items-center justify-between">
            <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
              {!isOnline && <WifiOff className="h-3.5 w-3.5" />}
              <span>{isExpanded ? 'Detay açık' : 'Detay için tıkla'}</span>
            </div>
            <div className="text-muted-foreground">
              {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DownloadDock;
