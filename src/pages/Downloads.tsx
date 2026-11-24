import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ChevronDown,
  Download,
  HardDriveDownload,
  PauseCircle,
  PlayCircle,
  RefreshCcw,
  Trash2,
  WifiOff,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import useDocumentTitle from '@/hooks/useDocumentTitle';
import { useDeviceProfile } from '@/hooks/use-device-profile';
import Header from '@/components/layout/Header';
import InstallAppBanner from '@/components/pwa/InstallAppBanner';
import OptimizedImage from '@/components/media/OptimizedImage';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Switch } from '@/components/ui/switch';
import { useOfflineLibrary } from '@/hooks/useOfflineLibrary';
import { useOfflinePreferences } from '@/hooks/useOfflinePreferences';
import { useAuth } from '@/contexts/AuthContext';
import { formatChapterDisplayTitle, formatChapterNumberLabel } from '@/lib/chapterTitle';
import { OfflineChapter, OfflineDownloadStatus, OfflineMangaGroup } from '@/lib/offline/types';
import { isDownloadAuthRequiredError, offlineDownloadManager } from '@/lib/offline/downloadManager';
import { getOfflineDownloadStatusLabel } from '@/lib/offline/statusLabels';
import { formatBytes, formatSpeed } from '@/lib/offline/utils';
import { Manga, Chapter } from '@/lib/types';
import { getCompactMangaTypeLabel } from '@/lib/mangaType';
import { toast } from 'sonner';

const FILTERS = ['Tümü', 'İndiriliyor', 'Tamamlanan', 'Hatalı'] as const;
type DownloadsFilter = (typeof FILTERS)[number];

const isActiveStatus = (status: OfflineDownloadStatus) => ['queued', 'running', 'paused'].includes(status);
const isErrorStatus = (status: OfflineDownloadStatus) => ['failed', 'partial'].includes(status);
const isBusyChapterStatus = (status: OfflineDownloadStatus) => ['queued', 'running'].includes(status);

const buildMangaFromOffline = (entry: OfflineMangaGroup): Manga => ({
  id: entry.manga.mangaId,
  title: entry.manga.title,
  alternativeTitles: [],
  cover: entry.manga.cover,
  banner: entry.manga.banner,
  author: entry.manga.author,
  artist: entry.manga.artist,
  status: entry.manga.status,
  genres: entry.manga.genres,
  description: entry.manga.description,
  ratings: [],
  views: 0,
  chapters: entry.chapters.map((chapter) => ({
    id: chapter.chapterId,
    number: chapter.chapterNumber,
    title: chapter.title,
    pages: chapter.sourcePageUrls,
    releaseDate: chapter.releaseDate,
    views: 0,
  })),
  lastUpdated: entry.manga.lastUpdated,
  createdAt: entry.manga.createdAt,
  type: entry.manga.type,
  averageRating: 0,
  reviewCount: 0,
});

const buildChapterFromOffline = (chapter: OfflineChapter): Chapter => ({
  id: chapter.chapterId,
  number: chapter.chapterNumber,
  title: chapter.title,
  pages: chapter.sourcePageUrls,
  releaseDate: chapter.releaseDate,
  views: 0,
});

const getPrimaryJob = (entry: OfflineMangaGroup) => {
  const activeJob = entry.jobs.find((job) => isActiveStatus(job.status));
  if (activeJob) {
    return activeJob;
  }

  return entry.jobs[0];
};

const formatDateTime = (value?: string) => {
  if (!value) {
    return 'Bilinmiyor';
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return 'Bilinmiyor';
  }

  return parsed.toLocaleString('tr-TR', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const buildOfflineReaderHref = (mangaId: string, chapterId: string) => (
  `/manga/${mangaId}/chapter/${chapterId}?offline=1`
);

const SERIES_PANEL_TRANSITION =
  'transition-[grid-template-rows,opacity,transform] duration-200 [transition-timing-function:cubic-bezier(0.16,0.84,0.28,1)]';

const Downloads: React.FC = () => {
  useDocumentTitle('İndirilenler');
  const { snapshot, isLoading, isOnline } = useOfflineLibrary();
  const { preferences, updatePreferences } = useOfflinePreferences();
  const { user } = useAuth();
  const { disableHeavyEffects } = useDeviceProfile();
  const [activeFilter, setActiveFilter] = useState<DownloadsFilter>('Tümü');
  const [expandedSeries, setExpandedSeries] = useState<Record<string, boolean>>({});

  useEffect(() => {
    void offlineDownloadManager.initialize();
  }, []);

  const filteredSeries = useMemo(() => {
    const seenMangaIds = new Set<string>();
    return snapshot.series.filter((entry) => {
      if (!entry.manga.mangaId || seenMangaIds.has(entry.manga.mangaId)) {
        return false;
      }
      seenMangaIds.add(entry.manga.mangaId);

      if (activeFilter === 'Tümü') {
        return true;
      }

      if (activeFilter === 'İndiriliyor') {
        return entry.jobs.some((job) => isActiveStatus(job.status))
          || entry.chapters.some((chapter) => isActiveStatus(chapter.downloadStatus));
      }

      if (activeFilter === 'Tamamlanan') {
        return entry.downloadedChapters > 0
          && !entry.jobs.some((job) => isActiveStatus(job.status))
          && !entry.chapters.some((chapter) => isErrorStatus(chapter.downloadStatus));
      }

      return entry.jobs.some((job) => isErrorStatus(job.status))
        || entry.chapters.some((chapter) => isErrorStatus(chapter.downloadStatus));
    });
  }, [activeFilter, snapshot.series]);

  const handleDeleteSeries = async (mangaId: string) => {
    await offlineDownloadManager.deleteMangaDownload(mangaId);
    toast.success('Seri indirilenlerden kaldırıldı.');
  };

  const handleDeleteReadChapters = async (entry: OfflineMangaGroup) => {
    const deletedCount = await offlineDownloadManager.deleteReadChaptersForManga(entry.manga.mangaId);

    if (deletedCount > 0) {
      toast.success(`${deletedCount} okunan bölüm silindi.`);
      return;
    }

    toast.info('Silinecek okunan bölüm bulunamadı.');
  };

  const handleRetrySeries = async (entry: OfflineMangaGroup) => {
    if (!user) {
      toast.error('İndirmeye devam etmek için giriş yapmalısınız');
      return;
    }

    const job = getPrimaryJob(entry);

    try {
      if (job) {
        if (job.status === 'paused') {
          await offlineDownloadManager.resumeJob(job.id);
        } else {
          await offlineDownloadManager.retryJob(job.id);
        }
        return;
      }

      await offlineDownloadManager.queueSeriesDownload(
        buildMangaFromOffline(entry),
        entry.chapters.map(buildChapterFromOffline),
      );
    } catch (error) {
      toast.error(isDownloadAuthRequiredError(error) ? error.message : 'İndirme tekrar başlatılamadı');
    }
  };

  const handleRetryChapter = async (entry: OfflineMangaGroup, chapter: OfflineChapter) => {
    if (!user) {
      toast.error('İndirmeye devam etmek için giriş yapmalısınız');
      return;
    }

    try {
      await offlineDownloadManager.queueChapterDownload(
        buildMangaFromOffline(entry),
        buildChapterFromOffline(chapter),
      );
      toast.success(`Bölüm ${formatChapterNumberLabel(chapter.chapterNumber)} tekrar sıraya alındı.`);
    } catch (error) {
      toast.error(isDownloadAuthRequiredError(error) ? error.message : 'Bölüm yeniden sıraya alınamadı');
    }
  };

  const toggleSeries = (mangaId: string) => {
    setExpandedSeries((prev) => ({
      ...prev,
      [mangaId]: !(prev[mangaId] ?? false),
    }));
  };

  const availableBytes =
    typeof snapshot.stats.quotaBytes === 'number' && typeof snapshot.stats.browserUsageBytes === 'number'
      ? Math.max(0, snapshot.stats.quotaBytes - snapshot.stats.browserUsageBytes)
      : undefined;

  return (
    <div className="min-h-screen bg-background">
      <Header />

      <main className="container pb-12 pt-16">
        <div
          className={cn(
            'flex flex-col gap-3 py-6 sm:py-8 md:flex-row md:items-end md:justify-between',
            !disableHeavyEffects && 'animate-fade-up',
          )}
        >
          <div className="flex items-center gap-3">
            <HardDriveDownload className="h-7 w-7 shrink-0 text-primary sm:h-8 sm:w-8" />
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">İndirilenler</h1>
          </div>

          {!isOnline && (
            <div className="flex items-center gap-2.5 rounded-2xl border border-amber-500/30 bg-amber-500/10 px-3.5 py-2.5 text-xs sm:text-sm text-amber-200">
              <WifiOff className="h-4 w-4 shrink-0" />
              <span>Çevrimdışısınız. İndirilen içerikleri okuyabilirsiniz, yeni indirmeler bağlantı gelince devam eder.</span>
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-2.5 sm:gap-3 xl:grid-cols-5">
          {[
            { label: 'Toplam Boyut', value: formatBytes(snapshot.stats.usedBytes), spanWide: false },
            { label: 'İndirilen Seri', value: `${snapshot.stats.seriesCount}`, spanWide: false },
            { label: 'İndirilen Bölüm', value: `${snapshot.stats.chapterCount}`, spanWide: false },
            { label: 'Aktif İndirme', value: `${snapshot.stats.activeDownloads}`, spanWide: false },
            {
              label: 'Kullanılabilir Alan',
              value: typeof availableBytes === 'number' ? formatBytes(availableBytes) : 'Bilinmiyor',
              spanWide: true,
            },
          ].map((item, index) => (
            <div
              key={item.label}
              className={cn(
                'rounded-xl border border-border/60 bg-card/75 px-3.5 py-3 sm:px-4 sm:py-3.5',
                item.spanWide && 'col-span-2 xl:col-span-1',
                !disableHeavyEffects && 'animate-fade-up',
              )}
              style={disableHeavyEffects ? undefined : { animationDelay: `${0.05 + index * 0.025}s` }}
            >
              <p className="text-xs text-muted-foreground">{item.label}</p>
              <p className="mt-1 text-lg font-bold tracking-tight tabular-nums sm:text-xl">{item.value}</p>
            </div>
          ))}
        </div>

        <section
          className={cn(
            'mt-5 rounded-2xl border border-border/60 bg-card/60 p-4 sm:p-5',
            !disableHeavyEffects && 'animate-fade-up backdrop-blur-sm',
          )}
          style={disableHeavyEffects ? undefined : { animationDelay: '0.16s' }}
        >
          <div className="flex flex-col gap-3 sm:gap-4 md:flex-row md:items-center md:justify-between">
            <div className="flex min-w-0 items-center gap-2">
              <p className="text-sm font-semibold">Sıkıştırılmış İndirme</p>
              <Badge variant="secondary">Önerilen</Badge>
            </div>

            <div className="flex w-full shrink-0 items-center justify-between gap-3 rounded-xl border border-border/70 bg-background/50 px-3.5 py-2.5 sm:w-auto">
              <p className="text-sm font-medium">
                {preferences.compressedDownloads ? 'Açık' : 'Kapalı'}
              </p>
              <Switch
                checked={preferences.compressedDownloads}
                onCheckedChange={(checked) => updatePreferences({ compressedDownloads: checked })}
                aria-label="Sıkıştırılmış indirmeyi aç veya kapat"
              />
            </div>
          </div>
        </section>

        <InstallAppBanner compact className="mt-5" />

        {!user && (
          <section className="mt-5 rounded-2xl border border-blue-500/20 bg-blue-500/10 p-4 text-sm text-blue-100">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p>
                Yeni indirme başlatmak, duraklayan indirmeyi sürdürmek ve yeniden denemek için giriş yapmalısınız.
              </p>
              <Button asChild variant="outline" className="shrink-0 border-blue-400/30 bg-transparent text-blue-50 hover:bg-blue-500/10 hover:text-white">
                <Link to="/auth">Giriş Yap</Link>
              </Button>
            </div>
          </section>
        )}

        <div className={cn('mt-6 flex flex-wrap gap-2', !disableHeavyEffects && 'animate-fade-up')}>
          {FILTERS.map((filter) => (
            <Button
              key={filter}
              variant={activeFilter === filter ? 'default' : 'outline'}
              size="sm"
              onClick={() => setActiveFilter(filter)}
            >
              {filter}
            </Button>
          ))}
        </div>

        {isLoading ? (
          <div className="mt-8 rounded-2xl border border-border/60 bg-card/40 p-8 text-muted-foreground">
            İndirilenler yükleniyor...
          </div>
        ) : filteredSeries.length === 0 ? (
          <div className="mt-8 rounded-2xl border border-dashed border-border bg-card/30 px-6 py-14 text-center">
            <Download className="mx-auto h-12 w-12 text-muted-foreground/50" />
            <h2 className="mt-4 text-xl font-bold">
              {snapshot.series.length === 0 ? 'Henüz indirilen içerik yok' : 'Bu filtrede seri bulunamadı'}
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              {snapshot.series.length === 0
                ? 'Seri sayfasından bölüm veya seri indirerek çevrimdışı kütüphanenizi oluşturabilirsiniz.'
                : 'Farklı bir filtre seçerek diğer indirilen içerikleri görüntüleyebilirsiniz.'}
            </p>
            {snapshot.series.length === 0 ? (
              <Button asChild variant="glow" className="mt-6">
                <Link to="/browse">Serilere Göz At</Link>
              </Button>
            ) : (
              <Button type="button" variant="outline" className="mt-6" onClick={() => setActiveFilter('Tümü')}>
                Tümünü Göster
              </Button>
            )}
          </div>
        ) : (
          <div className="mt-6 space-y-4">
            {filteredSeries.map((entry, index) => {
              const primaryJob = getPrimaryJob(entry);
              const uniqueChapters = Array.from(
                new Map(entry.chapters.map((chapter) => [chapter.chapterId, chapter])).values(),
              );
              const canRead = uniqueChapters.some((chapter) => chapter.downloadStatus === 'completed');
              const readChapterCount = uniqueChapters.filter((chapter) => chapter.isRead).length;
              const firstReadableChapter = uniqueChapters
                .filter((chapter) => chapter.downloadStatus === 'completed')
                .sort((a, b) => a.chapterNumber - b.chapterNumber)[0];
              const isExpanded = expandedSeries[entry.manga.mangaId] ?? false;

              return (
                <section
                  key={entry.manga.mangaId}
                  className={cn(
                    'overflow-hidden rounded-2xl border border-border/60 bg-card/60',
                    !disableHeavyEffects && 'animate-fade-up backdrop-blur-sm',
                  )}
                  style={disableHeavyEffects ? undefined : { animationDelay: `${0.06 + Math.min(index, 8) * 0.03}s` }}
                >
                  <div className="p-4 sm:p-5">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                      <div className="flex min-w-0 gap-3 sm:gap-4">
                        <Link to={`/manga/${entry.manga.mangaId}`} className="shrink-0">
                          {entry.manga.cover ? (
                            <OptimizedImage
                              src={entry.manga.cover}
                              alt={entry.manga.title}
                              allowProxy
                              transform={{ width: 160, quality: 85, format: 'webp', fit: 'cover' }}
                              containerClassName="h-24 w-[4.5rem] overflow-hidden rounded-xl ring-1 ring-border/50 sm:h-28 sm:w-20"
                              placeholderClassName="rounded-xl p-1 text-[8px] leading-tight"
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            <div className="flex h-24 w-[4.5rem] items-center justify-center rounded-xl bg-gradient-to-br from-primary/20 via-secondary/50 to-background text-xl font-bold text-muted-foreground ring-1 ring-border/50 sm:h-28 sm:w-20">
                              {(entry.manga.title || '?').slice(0, 1).toLocaleUpperCase('tr-TR')}
                            </div>
                          )}
                        </Link>

                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge variant="secondary">{getCompactMangaTypeLabel(entry.manga.type)}</Badge>
                            {primaryJob && (
                              <Badge variant="outline">
                                {getOfflineDownloadStatusLabel(primaryJob.status)}
                              </Badge>
                            )}
                          </div>

                          <h2 className="mt-2 line-clamp-2 text-lg font-bold leading-snug tracking-tight sm:text-xl">
                            <Link to={`/manga/${entry.manga.mangaId}`} className="transition-colors hover:text-primary">
                              {entry.manga.title}
                            </Link>
                          </h2>
                          {entry.manga.author && (
                            <p className="mt-0.5 line-clamp-1 text-xs sm:text-sm text-muted-foreground">{entry.manga.author}</p>
                          )}

                          <div className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs text-muted-foreground sm:flex sm:flex-wrap sm:items-center sm:gap-x-4 sm:text-sm">
                            <span>{entry.downloadedChapters}/{entry.manga.chapterCount} bölüm indirildi</span>
                            <span>{readChapterCount} okundu</span>
                            <span>{formatBytes(entry.totalBytes)}</span>
                            <span>Son indirme: {formatDateTime(entry.latestDownloadedAt)}</span>
                          </div>

                          {primaryJob && (
                            <div className="mt-3 max-w-xl space-y-1.5">
                              <div className="flex items-center justify-between gap-3 text-[11px] font-medium text-muted-foreground sm:text-xs">
                                <span>
                                  %{Math.round(primaryJob.progressPercent)} tamamlandı
                                  {primaryJob.currentChapterId ? ' · bölüm indiriliyor' : ''}
                                </span>
                                <span>{formatSpeed(primaryJob.speedBps)}</span>
                              </div>
                              <Progress value={primaryJob.progressPercent} className="h-2" />
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap lg:justify-end">
                        {canRead && firstReadableChapter && (
                          <Button asChild variant="glow" className="h-10 text-sm sm:h-10">
                            <Link
                              to={
                                isOnline
                                  ? `/manga/${entry.manga.mangaId}/chapter/${firstReadableChapter.chapterId}`
                                  : buildOfflineReaderHref(entry.manga.mangaId, firstReadableChapter.chapterId)
                              }
                            >
                              Oku
                            </Link>
                          </Button>
                        )}

                        {primaryJob && primaryJob.status === 'running' && (
                          <Button variant="outline" onClick={() => offlineDownloadManager.pauseJob(primaryJob.id)} className="h-10 text-sm">
                            <PauseCircle className="mr-2 h-4 w-4" />
                            Duraklat
                          </Button>
                        )}

                        {primaryJob && ['paused', 'failed', 'partial', 'queued'].includes(primaryJob.status) && (
                          <Button variant="outline" onClick={() => void handleRetrySeries(entry)} className="h-10 text-sm">
                            <PlayCircle className="mr-2 h-4 w-4" />
                            Devam Et
                          </Button>
                        )}

                        <Button
                          variant="outline"
                          onClick={() => toggleSeries(entry.manga.mangaId)}
                          aria-expanded={isExpanded}
                          className="h-10 text-sm"
                        >
                          <ChevronDown
                            className={cn(
                              'mr-2 h-4 w-4',
                              !disableHeavyEffects && 'transition-transform duration-200',
                              isExpanded ? 'rotate-180' : 'rotate-0',
                            )}
                          />
                          Bölümler
                        </Button>

                        {readChapterCount > 0 && (
                          <Button variant="outline" onClick={() => void handleDeleteReadChapters(entry)} className="h-10 text-sm">
                            <Trash2 className="mr-2 h-4 w-4" />
                            Okunanları Sil
                          </Button>
                        )}

                        <Button variant="outline" onClick={() => void handleDeleteSeries(entry.manga.mangaId)} className="h-10 text-sm">
                          <Trash2 className="mr-2 h-4 w-4" />
                          Sil
                        </Button>
                      </div>
                    </div>
                  </div>

                  <div
                    className={cn(
                      'grid border-t border-border/80 bg-background/20',
                      !disableHeavyEffects && SERIES_PANEL_TRANSITION,
                      isExpanded
                        ? 'grid-rows-[1fr] opacity-100 translate-y-0'
                        : 'grid-rows-[0fr] opacity-0 -translate-y-1 pointer-events-none',
                    )}
                  >
                    <div className="min-h-0 overflow-hidden">
                      <div className="divide-y divide-border/70">
                        {uniqueChapters.map((chapter) => {
                          const isChapterReady = chapter.downloadStatus === 'completed';
                          const isChapterBusy = isBusyChapterStatus(chapter.downloadStatus);
                          const isChapterRecoverable = ['paused', 'failed', 'partial', 'cancelled'].includes(chapter.downloadStatus);

                          return (
                            <div key={chapter.chapterId} className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between sm:p-4">
                              <div className="min-w-0">
                                <p className={cn('font-semibold', chapter.isRead && 'text-emerald-400')}>
                                  {formatChapterDisplayTitle(chapter.chapterNumber, chapter.title)}
                                </p>
                                <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] text-muted-foreground sm:flex sm:flex-wrap sm:items-center sm:gap-3 sm:text-xs">
                                  <span>{formatBytes(chapter.downloadedBytes || 0)}</span>
                                  <span>{chapter.pageCount} sayfa</span>
                                  <span>{formatDateTime(chapter.downloadedAt || chapter.lastAttemptAt)}</span>
                                  <Badge variant="outline">{getOfflineDownloadStatusLabel(chapter.downloadStatus)}</Badge>
                                </div>
                              </div>

                              <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:justify-end">
                                {isChapterReady && (
                                  <Button asChild size="sm" className="h-9 text-xs sm:text-sm">
                                    <Link to={buildOfflineReaderHref(entry.manga.mangaId, chapter.chapterId)}>
                                      Çevrimdışı Oku
                                    </Link>
                                  </Button>
                                )}

                                {isChapterRecoverable && (
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-9 text-xs sm:text-sm"
                                    onClick={() => void handleRetryChapter(entry, chapter)}
                                  >
                                    <RefreshCcw className="mr-2 h-4 w-4" />
                                    {chapter.downloadStatus === 'paused' ? 'Devam Et' : 'Yeniden Dene'}
                                  </Button>
                                )}

                                {!isChapterReady && isChapterBusy && (
                                  <Button variant="outline" size="sm" className="h-9 text-xs sm:text-sm" disabled>
                                    <Download className="mr-2 h-4 w-4" />
                                    {getOfflineDownloadStatusLabel(chapter.downloadStatus)}
                                  </Button>
                                )}

                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="h-9 text-xs sm:text-sm"
                                  onClick={() => void offlineDownloadManager.deleteChapterDownload(chapter.chapterId)}
                                >
                                  <Trash2 className="mr-2 h-4 w-4" />
                                  Sil
                                </Button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
};

export default Downloads;
