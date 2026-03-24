import React, { useEffect, useMemo, useState } from 'react';
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
  dismissedSignature: 'toonparrot_download_dock_dismissed_signature',
};

const RELEVANT_STATUSES: OfflineDownloadStatus[] = ['running', 'queued', 'paused', 'failed', 'partial', 'completed'];
const ACTIVE_STATUSES: OfflineDownloadStatus[] = ['running', 'queued', 'paused'];

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

const getStoredString = (key: string) => {
  if (typeof window === 'undefined') {
    return null;
  }

  return window.localStorage.getItem(key);
};

const setStoredBoolean = (key: string, value: boolean) => {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(key, String(value));
};

const setStoredString = (key: string, value: string | null) => {
  if (typeof window === 'undefined') {
    return;
  }

  if (value === null) {
    window.localStorage.removeItem(key);
    return;
  }

  window.localStorage.setItem(key, value);
};

const DownloadDock: React.FC = () => {
  const { snapshot, isOnline } = useOfflineLibrary();
  const { pathname } = useLocation();
  const [isExpanded, setIsExpanded] = useState(false);
  const [isMinimized, setIsMinimized] = useState(() => getStoredBoolean(STORAGE_KEYS.minimized, false));
  const [dismissedSignature, setDismissedSignature] = useState(() => getStoredString(STORAGE_KEYS.dismissedSignature));

  const relevantJobs = useMemo(
    () => sortJobs(snapshot.jobs.filter((job) => RELEVANT_STATUSES.includes(job.status))),
    [snapshot.jobs],
  );

  const primaryJob = relevantJobs[0];
  const hasActiveJobs = relevantJobs.some((job) => ACTIVE_STATUSES.includes(job.status));
  const dockSignature = useMemo(
    () => relevantJobs.map((job) => `${job.id}:${job.status}`).join('|'),
    [relevantJobs],
  );
  const isDismissed = Boolean(dockSignature) && dismissedSignature === dockSignature;

  useEffect(() => {
    setStoredBoolean(STORAGE_KEYS.minimized, isMinimized);
  }, [isMinimized]);

  useEffect(() => {
    setStoredString(STORAGE_KEYS.dismissedSignature, dismissedSignature);
  }, [dismissedSignature]);

  useEffect(() => {
    if (!relevantJobs.length && dismissedSignature) {
      setDismissedSignature(null);
    }
  }, [dismissedSignature, relevantJobs.length]);

  useEffect(() => {
    if (hasActiveJobs && dismissedSignature && dismissedSignature !== dockSignature) {
      setDismissedSignature(null);
    }
  }, [dismissedSignature, dockSignature, hasActiveJobs]);

  if (!primaryJob || isDismissed || pathname.startsWith('/downloads') || isReaderRoute(pathname)) {
    return null;
  }

  const handlePause = async (jobId: string) => {
    await offlineDownloadManager.pauseJob(jobId);
  };

  const handleResume = async (jobId: string) => {
    await offlineDownloadManager.resumeJob(jobId);
  };

  const handleDismiss = () => {
    setDismissedSignature(dockSignature);
    setIsExpanded(false);
    setIsMinimized(false);
  };

  const handleToggleMinimize = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    setIsExpanded(false);
    setIsMinimized((prev) => !prev);
  };

  if (isMinimized) {
    return (
      <div className="pointer-events-none fixed bottom-5 right-5 z-[90]">
        <button
          type="button"
          onClick={() => setIsMinimized(false)}
          className="pointer-events-auto flex h-[74px] w-[74px] flex-col items-center justify-between rounded-2xl border border-primary/30 bg-card/95 px-3 py-3 shadow-2xl shadow-primary/10 backdrop-blur-xl transition-all hover:border-primary/50"
          aria-label="İndirme panelini büyüt"
          title="İndirme panelini büyüt"
        >
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary/12 text-primary">
            <Download className="h-4 w-4" />
          </div>
          <div className="w-full">
            <Progress value={primaryJob.progressPercent} className="h-1.5 [&>div]:bg-primary" />
          </div>
        </button>
      </div>
    );
  }

  return (
    <div className="pointer-events-none fixed bottom-5 right-5 z-[90] flex w-[min(92vw,380px)] flex-col items-end gap-3">
      {isExpanded && (
        <div className="pointer-events-auto w-full rounded-2xl border border-border/70 bg-card/95 p-4 shadow-2xl shadow-black/35 backdrop-blur-xl">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary/80">
                Arka Plan İndirmeleri
              </p>
              <h3 className="mt-1 text-lg font-black tracking-tight">
                {relevantJobs.length} iş
              </h3>
            </div>

            <div className="flex items-center gap-2">
              <Button asChild variant="outline" size="sm">
                <Link to="/downloads">İndirilenler</Link>
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => setIsExpanded(false)}
                title="Detayı kapat"
              >
                <ChevronDown className="h-4 w-4" />
              </Button>
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
                className="rounded-xl border border-border/60 bg-background/45 p-3"
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
                        className="h-8 w-8"
                        onClick={() => void handlePause(job.id)}
                        title="Duraklat"
                      >
                        <PauseCircle className="h-4 w-4" />
                      </Button>
                    ) : ['queued', 'paused', 'failed', 'partial'].includes(job.status) ? (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
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
                  <Progress value={job.progressPercent} className="h-1.5" />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={() => setIsExpanded((prev) => !prev)}
        className={cn(
          'pointer-events-auto relative w-full overflow-hidden rounded-[22px] border border-primary/25 bg-card/95 p-4 pr-24 text-left shadow-2xl shadow-primary/10 backdrop-blur-xl transition-all hover:border-primary/45',
          isExpanded && 'rounded-b-xl',
        )}
      >
        <div className="absolute right-3 top-3 z-10 flex items-center gap-1">
          <button
            type="button"
            className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            onClick={handleToggleMinimize}
            aria-label="İndirme panelini küçült"
            title="Küçült"
          >
            <Minus className="h-4 w-4" />
          </button>

          {!hasActiveJobs && (
            <button
              type="button"
              className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
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
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-primary/12 text-primary">
            <Download className="h-4 w-4" />
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
              <Progress value={primaryJob.progressPercent} className="h-1.5 [&>div]:bg-primary" />
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
      </button>
    </div>
  );
};

export default DownloadDock;
