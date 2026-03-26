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
import { offlineDownloadManager } from '@/lib/offline/downloadManager';
import { DownloadJob, OfflineDownloadStatus } from '@/lib/offline/types';
import { formatBytes, formatSpeed } from '@/lib/offline/utils';
import { cn } from '@/lib/utils';

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
  const { snapshot, isOnline } = useOfflineLibrary();
  const { pathname } = useLocation();
  const [isExpanded, setIsExpanded] = useState(false);
  const [isMinimized, setIsMinimized] = useState(() => getStoredBoolean(STORAGE_KEYS.minimized, true));
  const [hiddenWhenIdle, setHiddenWhenIdle] = useState(() => getStoredBoolean(STORAGE_KEYS.hiddenWhenIdle, false));
  const previousActiveJobsCountRef = useRef(0);

  const relevantJobs = useMemo(
    () => sortJobs(snapshot.jobs.filter((job) => RELEVANT_STATUSES.includes(job.status))),
    [snapshot.jobs],
  );

  const primaryJob = relevantJobs[0];
  const hasActiveJobs = relevantJobs.some((job) => ACTIVE_STATUSES.includes(job.status));
  const hasFinishedJobs = relevantJobs.some((job) => FINISHED_STATUSES.includes(job.status));

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
  }, [hasActiveJobs, hiddenWhenIdle]);

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
    await offlineDownloadManager.resumeJob(jobId);
  };

  const handleDismiss = () => {
    setHiddenWhenIdle(true);
    setIsExpanded(false);
    setIsMinimized(true);
  };

  const handleClearCompleted = async () => {
    await offlineDownloadManager.clearCompletedJobs();
  };

  const handleToggleMinimize = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    setIsExpanded(false);
    setIsMinimized((prev) => !prev);
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
    <div className="pointer-events-none fixed bottom-5 right-5 z-[90]">
      <button
        type="button"
        onClick={() => setIsMinimized(false)}
        className={cn(
          'pointer-events-auto absolute bottom-0 right-0 flex h-[72px] w-[72px] flex-col items-center justify-between overflow-hidden rounded-[22px] border border-amber-300/30 bg-[linear-gradient(180deg,rgba(24,18,12,0.96),rgba(12,10,8,0.98))] px-3 py-3 text-amber-50 shadow-[0_20px_55px_-24px_rgba(245,158,11,0.5)] backdrop-blur-xl transform-gpu transition-all duration-260 [transition-timing-function:cubic-bezier(0.16,0.84,0.28,1)] will-change-transform hover:border-amber-200/50 sm:h-[78px] sm:w-[78px]',
          isMinimized ? 'translate-y-0 scale-100 opacity-100' : 'translate-y-1.5 scale-[0.92] opacity-0',
        )}
        aria-hidden={!isMinimized}
        aria-label="İndirme panelini büyüt"
        title="İndirme panelini büyüt"
      >
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(251,191,36,0.18),_transparent_58%)]" />
        <div className="relative mt-0.5 flex h-7 w-7 items-center justify-center rounded-[14px] bg-amber-400/12 text-amber-300 shadow-[inset_0_0_0_1px_rgba(253,186,116,0.18)] sm:h-8 sm:w-8">
          <Download className="h-4 w-4" />
          {hasActiveJobs && (
            <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-amber-300 shadow-[0_0_12px_rgba(252,211,77,0.8)] animate-pulse" />
          )}
        </div>
        <div className="relative mt-2.5 w-full space-y-1.5">
          <Progress
            value={primaryJob.progressPercent}
            className="h-1.5 bg-amber-950/40 [&>div]:bg-[linear-gradient(90deg,rgba(253,186,116,1)_0%,rgba(245,158,11,1)_100%)]"
          />
          <p className="text-center text-[10px] font-semibold text-amber-100/90">
            {Math.round(primaryJob.progressPercent)}%
          </p>
        </div>
      </button>

      <div
        className={cn(
          'absolute bottom-0 right-0 flex max-h-[calc(100vh-6rem)] w-[min(92vw,420px)] max-w-[calc(100vw-1rem)] flex-col items-end gap-3 transform-gpu transition-all duration-260 [transition-timing-function:cubic-bezier(0.16,0.84,0.28,1)] will-change-transform md:w-[min(94vw,460px)]',
          isMinimized
            ? 'pointer-events-none translate-y-2.5 scale-[0.97] opacity-0'
            : 'pointer-events-auto translate-y-0 scale-100 opacity-100',
        )}
        aria-hidden={isMinimized}
      >
        <div
          className={cn(
            'grid w-full overflow-hidden rounded-[24px] border border-amber-300/14 bg-[radial-gradient(circle_at_top,_rgba(245,158,11,0.14),_transparent_38%),linear-gradient(180deg,rgba(20,16,12,0.98)_0%,rgba(10,9,8,0.98)_100%)] shadow-[0_22px_48px_-24px_rgba(217,119,6,0.38)] backdrop-blur-xl transform-gpu transition-[grid-template-rows,opacity,transform] duration-240 [transition-timing-function:cubic-bezier(0.16,0.84,0.28,1)] will-change-transform',
            isExpanded
              ? 'grid-rows-[1fr] translate-y-0 opacity-100'
              : 'grid-rows-[0fr] translate-y-1.5 opacity-0',
          )}
        >
          <div className="min-h-0 overflow-hidden">
            <div className="max-h-[min(40vh,360px)] overflow-y-auto p-4 md:max-h-[min(52vh,480px)]">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-amber-300/90">
                  Arka Plan İndirmeleri
                </p>
                <div className="mt-1 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
                  <h3 className="text-lg font-black tracking-tight text-amber-50">
                    {relevantJobs.length} iş
                  </h3>

                  <div className="flex flex-wrap items-center gap-2">
                    {hasFinishedJobs && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 px-3 text-xs text-amber-50/90 hover:bg-amber-400/10 hover:text-amber-50"
                        onClick={() => void handleClearCompleted()}
                      >
                        Bitenleri Temizle
                      </Button>
                    )}
                    <Button
                      asChild
                      variant="outline"
                      size="sm"
                      className="border-amber-300/15 bg-amber-400/5 text-amber-50/90 hover:bg-amber-400/10 hover:text-amber-50"
                    >
                      <Link to="/downloads">İndirilenler</Link>
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-amber-50/90 hover:bg-amber-400/10 hover:text-amber-50"
                      onClick={() => setIsExpanded(false)}
                      title="Detayı kapat"
                    >
                      <ChevronDown className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>

              {!isOnline && (
                <div className="mt-3 inline-flex items-center gap-2 rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-xs text-amber-200">
                  <WifiOff className="h-3.5 w-3.5" />
                  Bağlantı yok, indirmeler internet gelince devam eder.
                </div>
              )}

              <div className="mt-4 space-y-3">
                {relevantJobs.slice(0, 4).map((job) => (
                  <div
                    key={job.id}
                    className="rounded-[18px] border border-amber-300/8 bg-[linear-gradient(180deg,rgba(19,15,11,0.82),rgba(12,10,8,0.94))] p-3 text-amber-50 transition-all duration-150"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">{job.mangaTitle}</p>
                        <p className="mt-1 text-xs text-slate-300/78">
                          {STATUS_LABELS[job.status]}
                          {job.currentChapterId ? ' • bölüm indiriliyor' : ''}
                        </p>
                      </div>

                      <div className="flex shrink-0 items-center gap-1">
                        {job.status === 'running' ? (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-amber-50/90 hover:bg-amber-400/10 hover:text-amber-50"
                            onClick={() => void handlePause(job.id)}
                            title="Duraklat"
                          >
                            <PauseCircle className="h-4 w-4" />
                          </Button>
                        ) : ['queued', 'paused', 'failed', 'partial'].includes(job.status) ? (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-amber-50/90 hover:bg-amber-400/10 hover:text-amber-50"
                            onClick={() => void handleResume(job.id)}
                            title="Devam Et"
                          >
                            <PlayCircle className="h-4 w-4" />
                          </Button>
                        ) : null}
                      </div>
                    </div>

                    <div className="mt-3 space-y-2">
                      <div className="flex items-center justify-between text-[11px] font-medium text-slate-300/78">
                        <span>{Math.round(job.progressPercent)}%</span>
                        <span>
                          {job.speedBps > 0 ? formatSpeed(job.speedBps) : formatBytes(job.downloadedBytes)}
                        </span>
                      </div>
                      <Progress
                        value={job.progressPercent}
                        className="h-1.5 bg-amber-950/40 [&>div]:bg-[linear-gradient(90deg,rgba(253,186,116,1)_0%,rgba(245,158,11,1)_100%)]"
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
            'relative w-full overflow-hidden rounded-[24px] border border-amber-300/20 bg-[radial-gradient(circle_at_top_left,_rgba(245,158,11,0.16),_transparent_28%),linear-gradient(180deg,rgba(21,16,12,0.98)_0%,rgba(12,10,8,0.98)_100%)] p-4 pr-24 text-left text-amber-50 shadow-[0_22px_52px_-24px_rgba(217,119,6,0.5)] backdrop-blur-xl transform-gpu transition-all duration-240 [transition-timing-function:cubic-bezier(0.16,0.84,0.28,1)] will-change-transform hover:border-amber-200/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300/45 focus-visible:ring-offset-2 focus-visible:ring-offset-background',
            isExpanded && 'rounded-b-xl',
          )}
        >
          <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(251,191,36,0.06),transparent_40%)]" />
          <div className="absolute right-3 top-3 z-10 flex items-center gap-1">
            <button
              type="button"
              className="rounded-lg p-1.5 text-slate-300/82 transition-colors duration-150 hover:bg-amber-400/10 hover:text-amber-50"
              onClick={handleToggleMinimize}
              aria-label="İndirme panelini küçült"
              title="Küçült"
            >
              <Minus className="h-4 w-4" />
            </button>

            {!hasActiveJobs && (
              <button
                type="button"
                className="rounded-lg p-1.5 text-slate-300/82 transition-colors duration-150 hover:bg-amber-400/10 hover:text-amber-50"
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
            <div className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-[18px] bg-amber-400/12 text-amber-300 shadow-[inset_0_0_0_1px_rgba(253,186,116,0.18)]">
              <Download className="h-4 w-4" />
              {hasActiveJobs && (
                <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-amber-300 shadow-[0_0_12px_rgba(252,211,77,0.8)] animate-pulse" />
              )}
            </div>

            <div className="min-w-0 flex-1">
              <div className="pr-2">
                <p className="truncate text-base font-semibold">{primaryJob.mangaTitle}</p>
                <p className="mt-0.5 text-xs text-slate-300/78">
                  {STATUS_LABELS[primaryJob.status]}
                  {relevantJobs.length > 1 ? ` • +${relevantJobs.length - 1} iş` : ''}
                </p>
              </div>

              <div className="mt-3 space-y-1.5">
                <div className="flex items-center justify-between text-[11px] font-medium text-slate-300/78">
                  <span>{Math.round(primaryJob.progressPercent)}%</span>
                  <span>
                    {primaryJob.speedBps > 0 ? formatSpeed(primaryJob.speedBps) : formatBytes(primaryJob.downloadedBytes)}
                  </span>
                </div>
                <Progress
                  value={primaryJob.progressPercent}
                  className="h-1.5 bg-amber-950/40 [&>div]:bg-[linear-gradient(90deg,rgba(253,186,116,1)_0%,rgba(245,158,11,1)_100%)]"
                />
              </div>
            </div>
          </div>

          <div className="mt-3 flex items-center justify-between">
            <div className="flex items-center gap-1 text-[11px] text-slate-300/72">
              {!isOnline && <WifiOff className="h-3.5 w-3.5" />}
              <span>{isExpanded ? 'Detay açık' : 'Detay için tıkla'}</span>
            </div>
            <div className="text-slate-300/78">
              {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DownloadDock;
