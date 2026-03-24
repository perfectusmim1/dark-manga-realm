import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ChevronDown,
  ChevronUp,
  Download,
  HardDriveDownload,
  PauseCircle,
  PlayCircle,
  RefreshCcw,
  Trash2,
  WifiOff,
} from 'lucide-react';
import Header from '@/components/layout/Header';
import InstallAppBanner from '@/components/pwa/InstallAppBanner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { useOfflineLibrary } from '@/hooks/useOfflineLibrary';
import { OfflineChapter, OfflineDownloadStatus, OfflineMangaGroup } from '@/lib/offline/types';
import { offlineDownloadManager } from '@/lib/offline/downloadManager';
import { formatBytes, formatSpeed } from '@/lib/offline/utils';
import { Manga, Chapter } from '@/lib/types';
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

  return new Date(value).toLocaleString('tr-TR', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const Downloads: React.FC = () => {
  const { snapshot, isLoading, isOnline } = useOfflineLibrary();
  const [activeFilter, setActiveFilter] = useState<DownloadsFilter>('Tümü');
  const [expandedSeries, setExpandedSeries] = useState<Record<string, boolean>>({});

  const filteredSeries = useMemo(() => {
    return snapshot.series.filter((entry) => {
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

  const handleRetrySeries = async (entry: OfflineMangaGroup) => {
    const job = getPrimaryJob(entry);

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
  };

  const handleRetryChapter = async (entry: OfflineMangaGroup, chapter: OfflineChapter) => {
    await offlineDownloadManager.queueChapterDownload(
      buildMangaFromOffline(entry),
      buildChapterFromOffline(chapter),
    );
    toast.success(`Bölüm ${chapter.chapterNumber} tekrar kuyruğa alındı.`);
  };

  const toggleSeries = (mangaId: string) => {
    setExpandedSeries((prev) => ({
      ...prev,
      [mangaId]: !prev[mangaId],
    }));
  };

  const availableBytes = snapshot.stats.quotaBytes && snapshot.stats.browserUsageBytes
    ? Math.max(0, snapshot.stats.quotaBytes - snapshot.stats.browserUsageBytes)
    : undefined;

  return (
    <div className="min-h-screen bg-background">
      <Header />

      <main className="container pb-12 pt-24">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="flex items-center gap-2 text-primary">
              <HardDriveDownload className="h-5 w-5" />
              <span className="text-xs font-semibold uppercase tracking-[0.22em] text-primary/80">
                Çevrimdışı Okuma
              </span>
            </div>
            <h1 className="mt-2 text-3xl font-black tracking-tight md:text-4xl">İndirilenler</h1>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
              İndirdiğin serileri, aktif kuyrukları ve depolama kullanımını buradan yönetebilirsin.
            </p>
          </div>

          {!isOnline && (
            <div className="inline-flex items-center gap-2 rounded-full border border-amber-500/30 bg-amber-500/10 px-4 py-2 text-sm text-amber-200">
              <WifiOff className="h-4 w-4" />
              Çevrimdışısın. İndirilen içerikleri okuyabilirsin, yeni indirmeler bağlantı gelince devam eder.
            </div>
          )}
        </div>

        <div className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          {[
            { label: 'Toplam Boyut', value: formatBytes(snapshot.stats.usedBytes) },
            { label: 'İndirilen Seri', value: `${snapshot.stats.seriesCount}` },
            { label: 'İndirilen Bölüm', value: `${snapshot.stats.chapterCount}` },
            { label: 'Aktif İndirme', value: `${snapshot.stats.activeDownloads}` },
            { label: 'Kullanılabilir Alan', value: availableBytes ? formatBytes(availableBytes) : 'Bilinmiyor' },
          ].map((item) => (
            <div key={item.label} className="rounded-2xl border border-border bg-card/40 p-5 backdrop-blur-sm">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">{item.label}</p>
              <p className="mt-3 text-2xl font-black tracking-tight">{item.value}</p>
            </div>
          ))}
        </div>

        <p className="mt-3 text-xs text-muted-foreground">
          Kullanılabilir alan, tarayıcının bu site için verdiği tahmini kota bilgisidir. Sabit ayrılmış disk alanı değildir; cihaz ve tarayıcıya göre değişebilir.
        </p>

        <InstallAppBanner compact className="mt-6" />

        <div className="mt-8 flex flex-wrap gap-2">
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
          <div className="mt-10 rounded-2xl border border-border bg-card/40 p-8 text-muted-foreground">
            İndirilenler yükleniyor...
          </div>
        ) : filteredSeries.length === 0 ? (
          <div className="mt-10 rounded-3xl border border-dashed border-border bg-card/20 px-6 py-16 text-center">
            <Download className="mx-auto h-12 w-12 text-muted-foreground/40" />
            <h2 className="mt-4 text-xl font-bold">Henüz indirilen içerik yok</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Seri sayfasından bölüm indir veya komple seri indirerek çevrimdışı kütüphaneni oluşturmaya başlayabilirsin.
            </p>
            <Button asChild variant="glow" className="mt-6">
              <Link to="/browse">Serilere Göz At</Link>
            </Button>
          </div>
        ) : (
          <div className="mt-8 space-y-5">
            {filteredSeries.map((entry) => {
              const primaryJob = getPrimaryJob(entry);
              const canRead = entry.chapters.some((chapter) => chapter.downloadStatus === 'completed');
              const firstReadableChapter = entry.chapters
                .filter((chapter) => chapter.downloadStatus === 'completed')
                .sort((a, b) => a.chapterNumber - b.chapterNumber)[0];
              const isExpanded = expandedSeries[entry.manga.mangaId] ?? true;

              return (
                <section
                  key={entry.manga.mangaId}
                  className="overflow-hidden rounded-3xl border border-border bg-card/35 backdrop-blur-sm"
                >
                  <div className="p-5 sm:p-6">
                    <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
                      <div className="flex min-w-0 gap-4">
                        <img
                          src={entry.manga.cover}
                          alt={entry.manga.title}
                          className="h-28 w-20 rounded-2xl object-cover shadow-lg"
                        />

                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge variant="secondary" className="uppercase">{entry.manga.type}</Badge>
                            {primaryJob && (
                              <Badge variant="outline">
                                {primaryJob.status === 'running' ? 'İndiriliyor' :
                                  primaryJob.status === 'paused' ? 'Duraklatıldı' :
                                    primaryJob.status === 'completed' ? 'Tamamlandı' :
                                      primaryJob.status === 'partial' ? 'Kısmi' :
                                        primaryJob.status === 'failed' ? 'Hatalı' : 'Kuyrukta'}
                              </Badge>
                            )}
                          </div>

                          <h2 className="mt-3 text-2xl font-black tracking-tight">
                            <Link to={`/manga/${entry.manga.mangaId}`} className="hover:text-primary transition-colors">
                              {entry.manga.title}
                            </Link>
                          </h2>
                          <p className="mt-1 text-sm text-muted-foreground">{entry.manga.author}</p>

                          <div className="mt-4 flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
                            <span>{entry.downloadedChapters}/{entry.manga.chapterCount} bölüm indirildi</span>
                            <span>{formatBytes(entry.totalBytes)}</span>
                            <span>Son indirme: {formatDateTime(entry.latestDownloadedAt)}</span>
                          </div>

                          {primaryJob && (
                            <div className="mt-4 max-w-xl space-y-2">
                              <div className="flex items-center justify-between text-xs font-medium text-muted-foreground">
                                <span>
                                  {Math.round(primaryJob.progressPercent)}% tamamlandı
                                  {primaryJob.currentChapterId ? ' • aktif bölüm indiriliyor' : ''}
                                </span>
                                <span>{formatSpeed(primaryJob.speedBps)}</span>
                              </div>
                              <Progress value={primaryJob.progressPercent} className="h-2" />
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-2 lg:justify-end">
                        {canRead && firstReadableChapter && (
                          <Button asChild variant="glow">
                            <Link to={`/manga/${entry.manga.mangaId}/chapter/${firstReadableChapter.chapterId}`}>
                              Oku
                            </Link>
                          </Button>
                        )}

                        {primaryJob && primaryJob.status === 'running' && (
                          <Button variant="outline" onClick={() => offlineDownloadManager.pauseJob(primaryJob.id)}>
                            <PauseCircle className="mr-2 h-4 w-4" />
                            Duraklat
                          </Button>
                        )}

                        {primaryJob && ['paused', 'failed', 'partial', 'queued'].includes(primaryJob.status) && (
                          <Button variant="outline" onClick={() => void handleRetrySeries(entry)}>
                            <PlayCircle className="mr-2 h-4 w-4" />
                            Devam Et
                          </Button>
                        )}

                        <Button variant="outline" onClick={() => toggleSeries(entry.manga.mangaId)}>
                          {isExpanded ? <ChevronUp className="mr-2 h-4 w-4" /> : <ChevronDown className="mr-2 h-4 w-4" />}
                          Bölümler
                        </Button>

                        <Button variant="outline" onClick={() => void handleDeleteSeries(entry.manga.mangaId)}>
                          <Trash2 className="mr-2 h-4 w-4" />
                          Sil
                        </Button>
                      </div>
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="border-t border-border/80 bg-background/20">
                      <div className="divide-y divide-border/70">
                        {entry.chapters.map((chapter) => {
                          const isChapterReady = chapter.downloadStatus === 'completed';
                          const isChapterBusy = isBusyChapterStatus(chapter.downloadStatus);
                          const isChapterRecoverable = ['paused', 'failed', 'partial', 'cancelled'].includes(chapter.downloadStatus);

                          return (
                            <div key={chapter.chapterId} className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between">
                              <div className="min-w-0">
                                <p className="font-semibold">
                                  Bölüm {chapter.chapterNumber}: {chapter.title}
                                </p>
                                <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                                  <span>{formatBytes(chapter.downloadedBytes || 0)}</span>
                                  <span>{chapter.pageCount} sayfa</span>
                                  <span>{formatDateTime(chapter.downloadedAt || chapter.lastAttemptAt)}</span>
                                  <Badge variant="outline">{chapter.downloadStatus}</Badge>
                                </div>
                              </div>

                              <div className="flex flex-wrap gap-2 sm:justify-end">
                                {isChapterReady && (
                                  <Button asChild size="sm">
                                    <Link to={`/manga/${entry.manga.mangaId}/chapter/${chapter.chapterId}`}>
                                      Çevrimdışı Oku
                                    </Link>
                                  </Button>
                                )}

                                {isChapterRecoverable && (
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => void handleRetryChapter(entry, chapter)}
                                  >
                                    <RefreshCcw className="mr-2 h-4 w-4" />
                                    {chapter.downloadStatus === 'paused' ? 'Devam Et' : 'Yeniden Dene'}
                                  </Button>
                                )}

                                {!isChapterReady && isChapterBusy && (
                                  <Button variant="outline" size="sm" disabled>
                                    <Download className="mr-2 h-4 w-4" />
                                    {chapter.downloadStatus === 'queued' ? 'Kuyrukta' : 'İndiriliyor'}
                                  </Button>
                                )}

                                <Button
                                  variant="outline"
                                  size="sm"
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
                  )}
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
