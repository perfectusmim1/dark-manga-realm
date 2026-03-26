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
import { Switch } from '@/components/ui/switch';
import { useOfflineLibrary } from '@/hooks/useOfflineLibrary';
import { useOfflinePreferences } from '@/hooks/useOfflinePreferences';
import { useAuth } from '@/contexts/AuthContext';
import { formatChapterDisplayTitle } from '@/lib/chapterTitle';
import { OfflineChapter, OfflineDownloadStatus, OfflineMangaGroup } from '@/lib/offline/types';
import { isDownloadAuthRequiredError, offlineDownloadManager } from '@/lib/offline/downloadManager';
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
  const { preferences, updatePreferences } = useOfflinePreferences();
  const { user } = useAuth();
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
      toast.success(`Bölüm ${chapter.chapterNumber} tekrar kuyruğa alındı.`);
    } catch (error) {
      toast.error(isDownloadAuthRequiredError(error) ? error.message : 'Bölüm yeniden kuyruğa alınamadı');
    }
  };

  const toggleSeries = (mangaId: string) => {
    setExpandedSeries((prev) => ({
      ...prev,
      [mangaId]: !(prev[mangaId] ?? true),
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

        <div className="mt-8 grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-2 xl:grid-cols-5">
          {[
            { label: 'Toplam Boyut', value: formatBytes(snapshot.stats.usedBytes) },
            { label: 'İndirilen Seri', value: `${snapshot.stats.seriesCount}` },
            { label: 'İndirilen Bölüm', value: `${snapshot.stats.chapterCount}` },
            { label: 'Aktif İndirme', value: `${snapshot.stats.activeDownloads}` },
            { label: 'Kullanılabilir Alan', value: availableBytes ? formatBytes(availableBytes) : 'Bilinmiyor' },
          ].map((item, index) => (
            <div
              key={item.label}
              className="animate-fade-up aspect-[1/1] min-h-[8.25rem] rounded-2xl border border-border bg-card/40 p-4 opacity-0 backdrop-blur-sm sm:aspect-auto sm:min-h-0 sm:p-5"
              style={{ animationDelay: `${0.08 + index * 0.03}s`, animationFillMode: 'forwards' }}
            >
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground sm:text-xs">{item.label}</p>
              <p className="mt-3 text-xl font-black tracking-tight sm:text-2xl">{item.value}</p>
            </div>
          ))}
        </div>

        <p className="mt-3 text-xs text-muted-foreground">
          Kullanılabilir alan, tarayıcının bu site için verdiği tahmini kota bilgisidir. Sabit ayrılmış disk alanı değildir; cihaz ve tarayıcıya göre değişebilir.
        </p>

        <section
          className="mt-6 animate-fade-up rounded-2xl border border-border bg-card/35 p-4 opacity-0 backdrop-blur-sm sm:p-5"
          style={{ animationDelay: '0.22s', animationFillMode: 'forwards' }}
        >
          <div className="flex flex-col gap-3 sm:gap-4 md:flex-row md:items-center md:justify-between">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <p className="text-sm font-bold">Sıkıştırılmış İndirme</p>
                <Badge variant="secondary">Önerilen</Badge>
              </div>
              <p className="mt-2 hidden max-w-3xl text-sm text-muted-foreground sm:block">
                Yeni indirmelerde sayfalar kaliteyi neredeyse fark edilmeyecek seviyede koruyarak WebP olarak optimize edilir.
                Bu, özellikle uzun bölümlerde dosya boyutunu ciddi şekilde düşürür.
              </p>
              <p className="mt-2 hidden text-xs text-muted-foreground sm:block">
                Not: Bu ayar yeni indirilen sayfalara uygulanır. Mevcut indirilmiş bölümler aynı kalır.
              </p>
            </div>

            <div className="flex w-full shrink-0 items-center justify-between gap-3 rounded-full border border-border/70 bg-background/50 px-4 py-3 sm:w-auto">
              <div className="min-w-0 text-left sm:text-right">
                <p className="text-sm font-semibold">
                  {preferences.compressedDownloads ? 'Açık' : 'Kapalı'}
                </p>
                <p className="hidden text-xs text-muted-foreground sm:block">Yeni indirmelerde geçerli</p>
              </div>
              <Switch
                checked={preferences.compressedDownloads}
                onCheckedChange={(checked) => updatePreferences({ compressedDownloads: checked })}
                aria-label="Sıkıştırılmış indirmeyi aç veya kapat"
              />
            </div>
          </div>
        </section>

        <InstallAppBanner compact className="mt-6" />

        {!user && (
          <section className="mt-6 rounded-2xl border border-blue-500/20 bg-blue-500/10 p-4 text-sm text-blue-100">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p>
                Yeni indirme başlatmak, duraklayan indirmeyi sürdürmek ve yeniden denemek için giriş yapmalısın.
              </p>
              <Button asChild variant="outline" className="border-blue-400/30 bg-transparent text-blue-50 hover:bg-blue-500/10 hover:text-white">
                <Link to="/auth">Giriş Yap</Link>
              </Button>
            </div>
          </section>
        )}

        <div className="mt-8 animate-fade-up flex flex-wrap gap-2 opacity-0" style={{ animationDelay: '0.28s', animationFillMode: 'forwards' }}>
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
            {filteredSeries.map((entry, index) => {
              const primaryJob = getPrimaryJob(entry);
              const canRead = entry.chapters.some((chapter) => chapter.downloadStatus === 'completed');
              const readChapterCount = entry.chapters.filter((chapter) => chapter.isRead).length;
              const firstReadableChapter = entry.chapters
                .filter((chapter) => chapter.downloadStatus === 'completed')
                .sort((a, b) => a.chapterNumber - b.chapterNumber)[0];
              const isExpanded = expandedSeries[entry.manga.mangaId] ?? true;

              return (
                <section
                  key={entry.manga.mangaId}
                  className="animate-fade-up overflow-hidden rounded-3xl border border-border bg-card/35 opacity-0 backdrop-blur-sm"
                  style={{ animationDelay: `${0.08 + Math.min(index, 10) * 0.035}s`, animationFillMode: 'forwards' }}
                >
                  <div className="p-4 sm:p-6">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                      <div className="flex min-w-0 gap-3 sm:gap-4">
                        <img
                          src={entry.manga.cover}
                          alt={entry.manga.title}
                          className="h-24 w-[4.5rem] rounded-[1.35rem] object-cover shadow-lg sm:h-28 sm:w-20 sm:rounded-2xl"
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

                          <h2 className="mt-2 text-xl font-black leading-tight tracking-tight sm:mt-3 sm:text-2xl">
                            <Link to={`/manga/${entry.manga.mangaId}`} className="hover:text-primary transition-colors">
                              {entry.manga.title}
                            </Link>
                          </h2>
                          <p className="mt-1 line-clamp-1 text-sm text-muted-foreground">{entry.manga.author}</p>

                          <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs text-muted-foreground sm:mt-4 sm:flex sm:flex-wrap sm:items-center sm:gap-4 sm:text-sm">
                            <span>{entry.downloadedChapters}/{entry.manga.chapterCount} bölüm indirildi</span>
                            <span>{readChapterCount} okundu</span>
                            <span>{formatBytes(entry.totalBytes)}</span>
                            <span>Son indirme: {formatDateTime(entry.latestDownloadedAt)}</span>
                          </div>

                          {primaryJob && (
                            <div className="mt-3 max-w-xl space-y-2 sm:mt-4">
                              <div className="flex items-center justify-between gap-3 text-[11px] font-medium text-muted-foreground sm:text-xs">
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

                      <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap lg:justify-end">
                        {canRead && firstReadableChapter && (
                          <Button asChild variant="glow" className="h-10 text-sm sm:h-11">
                            <Link to={`/manga/${entry.manga.mangaId}/chapter/${firstReadableChapter.chapterId}`}>
                              Oku
                            </Link>
                          </Button>
                        )}

                        {primaryJob && primaryJob.status === 'running' && (
                          <Button variant="outline" onClick={() => offlineDownloadManager.pauseJob(primaryJob.id)} className="h-10 text-sm sm:h-11">
                            <PauseCircle className="mr-2 h-4 w-4" />
                            Duraklat
                          </Button>
                        )}

                        {primaryJob && ['paused', 'failed', 'partial', 'queued'].includes(primaryJob.status) && (
                          <Button variant="outline" onClick={() => void handleRetrySeries(entry)} className="h-10 text-sm sm:h-11">
                            <PlayCircle className="mr-2 h-4 w-4" />
                            Devam Et
                          </Button>
                        )}

                        <Button variant="outline" onClick={() => toggleSeries(entry.manga.mangaId)} className="h-10 text-sm sm:h-11">
                          {isExpanded ? <ChevronUp className="mr-2 h-4 w-4" /> : <ChevronDown className="mr-2 h-4 w-4" />}
                          Bölümler
                        </Button>

                        {readChapterCount > 0 && (
                          <Button variant="outline" onClick={() => void handleDeleteReadChapters(entry)} className="h-10 text-sm sm:h-11">
                            <Trash2 className="mr-2 h-4 w-4" />
                            Okunanları Sil
                          </Button>
                        )}

                        <Button variant="outline" onClick={() => void handleDeleteSeries(entry.manga.mangaId)} className="h-10 text-sm sm:h-11">
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
                            <div key={chapter.chapterId} className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between sm:p-4">
                              <div className="min-w-0">
                                <p className="font-semibold">
                                  {formatChapterDisplayTitle(chapter.chapterNumber, chapter.title)}
                                </p>
                                <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] text-muted-foreground sm:flex sm:flex-wrap sm:items-center sm:gap-3 sm:text-xs">
                                  <span>{formatBytes(chapter.downloadedBytes || 0)}</span>
                                  <span>{chapter.pageCount} sayfa</span>
                                  <span>{formatDateTime(chapter.downloadedAt || chapter.lastAttemptAt)}</span>
                                  {chapter.isRead && (
                                    <Badge variant="secondary">Okundu</Badge>
                                  )}
                                  <Badge variant="outline">{chapter.downloadStatus}</Badge>
                                </div>
                              </div>

                              <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:justify-end">
                                {isChapterReady && (
                                  <Button asChild size="sm" className="h-9 text-xs sm:text-sm">
                                    <Link to={`/manga/${entry.manga.mangaId}/chapter/${chapter.chapterId}`}>
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
                                    {chapter.downloadStatus === 'queued' ? 'Kuyrukta' : 'İndiriliyor'}
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
