import { Chapter, Manga } from '@/lib/types';
import {
  cacheOfflineChapterMetadata,
  cacheOfflineManga,
  clearInterruptedJobs,
  deleteOfflineChapter,
  deleteOfflineManga,
  deleteReadOfflineChaptersForManga,
  getOfflineChapter,
  getOfflineJobs,
  getOfflinePagesForChapter,
  removeOfflineJob,
  replaceOfflineJob,
  updateOfflineChapter,
  updateOfflineJob,
  upsertOfflinePage,
} from '@/lib/offline/offlineStorage';
import {
  DownloadJob,
  OfflineChapter,
  OfflineDownloadStatus,
} from '@/lib/offline/types';
import { getOfflinePreferences } from '@/lib/offline/preferences';
import { compressOfflineImage } from '@/lib/offline/imageCompression';
import { offlineProxyConfig } from '@/lib/offline/proxyConfig';

const PAGE_DOWNLOAD_CONCURRENCY = 3;

interface DownloadedPageResult {
  blob: Blob;
  mimeType: string;
  byteSize: number;
  expectedTotalBytes?: number;
}

const nowIso = () => new Date().toISOString();

const createJobId = (prefix: string, mangaId: string) => `${prefix}:${mangaId}:${crypto.randomUUID()}`;

const calculateProgressPercent = (
  chapters: OfflineChapter[],
  downloadedBytes: number,
  totalBytes?: number,
) => {
  if (totalBytes && totalBytes > 0) {
    return Math.max(0, Math.min(100, (downloadedBytes / totalBytes) * 100));
  }

  const totalPages = chapters.reduce((sum, chapter) => sum + chapter.pageCount, 0);
  if (totalPages === 0) {
    return 0;
  }

  const downloadedPages = chapters.reduce((sum, chapter) => sum + chapter.downloadedPages, 0);
  return Math.max(0, Math.min(100, (downloadedPages / totalPages) * 100));
};

const buildJobStateFromChapters = (
  job: DownloadJob,
  chapters: OfflineChapter[],
  overrides: Partial<DownloadJob> = {},
): DownloadJob => {
  const downloadedBytes = chapters.reduce((sum, chapter) => sum + (chapter.downloadedBytes || 0), 0);
  const hasUnknownTotal = chapters.some(
    (chapter) => typeof chapter.totalBytes !== 'number' || chapter.totalBytes <= 0,
  );
  const totalBytes = hasUnknownTotal
    ? undefined
    : chapters.reduce((sum, chapter) => sum + (chapter.totalBytes || 0), 0);
  const completedChapterIds = chapters
    .filter((chapter) => chapter.downloadStatus === 'completed')
    .map((chapter) => chapter.chapterId);
  const failedChapterIds = chapters
    .filter((chapter) => ['failed', 'partial'].includes(chapter.downloadStatus))
    .map((chapter) => chapter.chapterId);

  return {
    ...job,
    downloadedBytes,
    totalBytes,
    progressPercent: calculateProgressPercent(chapters, downloadedBytes, totalBytes),
    completedChapterIds,
    failedChapterIds,
    updatedAt: nowIso(),
    ...overrides,
  };
};

const createChapterJob = (manga: Manga, chapter: Chapter): DownloadJob => ({
  id: createJobId('chapter', manga.id),
  type: 'chapter',
  mangaId: manga.id,
  mangaTitle: manga.title,
  chapterIds: [chapter.id],
  status: 'queued',
  progressPercent: 0,
  downloadedBytes: 0,
  totalBytes: undefined,
  speedBps: 0,
  completedChapterIds: [],
  failedChapterIds: [],
  createdAt: nowIso(),
  updatedAt: nowIso(),
});

const createSeriesJob = (manga: Manga, chapters: Chapter[]): DownloadJob => ({
  id: createJobId('series', manga.id),
  type: 'series',
  mangaId: manga.id,
  mangaTitle: manga.title,
  chapterIds: chapters.map((chapter) => chapter.id),
  status: 'queued',
  progressPercent: 0,
  downloadedBytes: 0,
  totalBytes: undefined,
  speedBps: 0,
  completedChapterIds: [],
  failedChapterIds: [],
  createdAt: nowIso(),
  updatedAt: nowIso(),
});

const readStreamToBlob = async (
  response: Response,
  signal: AbortSignal,
  onChunk: (delta: number) => void,
): Promise<DownloadedPageResult> => {
  if (!response.ok) {
    throw new Error(`Proxy indirme basarisiz oldu (${response.status})`);
  }

  const reader = response.body?.getReader();
  if (!reader) {
    const blob = await response.blob();
    return {
      blob,
      mimeType: blob.type || response.headers.get('content-type') || 'image/jpeg',
      byteSize: blob.size,
      expectedTotalBytes: Number(response.headers.get('content-length')) || undefined,
    };
  }

  const expectedTotalBytes = Number(response.headers.get('content-length')) || undefined;
  const chunks: Uint8Array[] = [];
  let loadedBytes = 0;

  while (true) {
    if (signal.aborted) {
      throw new DOMException('Iptal edildi', 'AbortError');
    }

    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    if (value) {
      loadedBytes += value.byteLength;
      chunks.push(value);
      onChunk(value.byteLength);
    }
  }

  const blob = new Blob(chunks as any, {
    type: response.headers.get('content-type') || 'image/jpeg',
  });

  return {
    blob,
    mimeType: blob.type || 'image/jpeg',
    byteSize: loadedBytes,
    expectedTotalBytes,
  };
};

const downloadImageViaProxy = async (
  sourceUrl: string,
  signal: AbortSignal,
  onChunk: (delta: number) => void,
) => {
  if (offlineProxyConfig.usesSupabaseAuth) {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    headers.apikey = offlineProxyConfig.supabaseAnonKey;
    headers.Authorization = `Bearer ${offlineProxyConfig.supabaseAnonKey}`;

    const response = await fetch(offlineProxyConfig.url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ url: sourceUrl }),
      signal,
    });

    return readStreamToBlob(response, signal, onChunk);
  }

  // Use a simple text/plain POST for custom proxies so the browser skips CORS preflight.
  const response = await fetch(offlineProxyConfig.url, {
    method: 'POST',
    body: sourceUrl,
    signal,
  });

  return readStreamToBlob(response, signal, onChunk);
};

class OfflineDownloadManager {
  private initialized = false;
  private processing = false;
  private activeJobId: string | null = null;
  private abortControllers = new Map<string, AbortController>();
  private stopReasons = new Map<string, 'paused' | 'deleted'>();

  async initialize() {
    if (this.initialized || typeof window === 'undefined') {
      return;
    }

    this.initialized = true;

    const jobs = await getOfflineJobs();
    const interruptedJobIds = jobs
      .filter((job) => ['running', 'queued'].includes(job.status))
      .map((job) => job.id);

    await clearInterruptedJobs();

    for (const jobId of interruptedJobIds) {
      await this.resumeJob(jobId);
    }

    window.addEventListener('online', () => {
      void this.processQueue();
    });

    void this.processQueue();
  }

  async queueChapterDownload(manga: Manga, chapter: Chapter) {
    await cacheOfflineManga(manga);
    const offlineChapter = await cacheOfflineChapterMetadata(manga.id, chapter, 'queued');

    if (offlineChapter.downloadStatus === 'completed') {
      return null;
    }

    const jobs = await getOfflineJobs();
    const existingJob = jobs.find(
      (job) =>
        job.type === 'chapter' &&
        job.chapterIds.length === 1 &&
        job.chapterIds[0] === chapter.id &&
        !['completed', 'cancelled'].includes(job.status),
    );

    if (existingJob) {
      if (['failed', 'partial', 'paused'].includes(existingJob.status)) {
        await this.resumeJob(existingJob.id);
      }
      return existingJob;
    }

    const job = createChapterJob(manga, chapter);
    await replaceOfflineJob(job);
    await this.processQueue();
    return job;
  }

  async queueSeriesDownload(manga: Manga, chapters: Chapter[]) {
    await cacheOfflineManga(manga);

    const chapterRecords = await Promise.all(
      chapters.map((chapter) => cacheOfflineChapterMetadata(manga.id, chapter, 'queued')),
    );

    const queuedChapterIds = chapterRecords
      .filter((chapter) => chapter.downloadStatus !== 'completed')
      .map((chapter) => chapter.chapterId);

    if (queuedChapterIds.length === 0) {
      return null;
    }

    const jobs = await getOfflineJobs();
    const existingSeriesJob = jobs.find(
      (job) =>
        job.type === 'series' &&
        job.mangaId === manga.id &&
        !['completed', 'cancelled'].includes(job.status),
    );

    if (existingSeriesJob) {
      const mergedChapterIds = Array.from(new Set([...existingSeriesJob.chapterIds, ...queuedChapterIds]));
      const nextJob = {
        ...existingSeriesJob,
        chapterIds: mergedChapterIds,
        status: existingSeriesJob.status === 'running' ? 'running' : 'queued',
        error: undefined,
        updatedAt: nowIso(),
      };
      await replaceOfflineJob(nextJob as any);
      await this.processQueue();
      return nextJob;
    }

    const chapterMap = new Map(chapters.map((chapter) => [chapter.id, chapter]));
    const nextChapters = queuedChapterIds
      .map((chapterId) => chapterMap.get(chapterId))
      .filter(Boolean) as Chapter[];
    const job = createSeriesJob(manga, nextChapters);

    await replaceOfflineJob(job);
    await this.processQueue();
    return job;
  }

  async pauseJob(jobId: string) {
    const controller = this.abortControllers.get(jobId);
    if (controller) {
      this.stopReasons.set(jobId, 'paused');
      controller.abort();
    }

    await updateOfflineJob(jobId, (job) => ({
      ...job,
      status: 'paused',
      speedBps: 0,
      updatedAt: nowIso(),
    }));
  }

  async resumeJob(jobId: string) {
    await updateOfflineJob(jobId, (job) => ({
      ...job,
      status: 'queued',
      error: undefined,
      updatedAt: nowIso(),
    }));

    await this.processQueue();
  }

  async retryJob(jobId: string) {
    await updateOfflineJob(jobId, (job) => ({
      ...job,
      status: 'queued',
      failedChapterIds: [],
      error: undefined,
      updatedAt: nowIso(),
    }));

    await this.processQueue();
  }

  async deleteChapterDownload(chapterId: string) {
    const jobs = await getOfflineJobs();
    const relatedJob = jobs.find((job) => job.chapterIds.includes(chapterId));

    if (relatedJob && relatedJob.id === this.activeJobId) {
      const controller = this.abortControllers.get(relatedJob.id);
      if (controller) {
        this.stopReasons.set(relatedJob.id, 'deleted');
        controller.abort();
      }
    }

    await deleteOfflineChapter(chapterId);
  }

  async deleteMangaDownload(mangaId: string) {
    const jobs = await getOfflineJobs();
    const relatedJobs = jobs.filter((job) => job.mangaId === mangaId);

    for (const job of relatedJobs) {
      if (job.id === this.activeJobId) {
        const controller = this.abortControllers.get(job.id);
        if (controller) {
          this.stopReasons.set(job.id, 'deleted');
          controller.abort();
        }
      }
    }

    await deleteOfflineManga(mangaId);
  }

  async deleteReadChaptersForManga(mangaId: string) {
    return deleteReadOfflineChaptersForManga(mangaId);
  }

  async clearCompletedJobs() {
    const jobs = await getOfflineJobs();
    const completedJobs = jobs.filter((job) =>
      ['completed', 'failed', 'partial', 'cancelled'].includes(job.status),
    );

    await Promise.all(completedJobs.map((job) => removeOfflineJob(job.id)));
  }

  private async processQueue() {
    if (this.processing || !navigator.onLine) {
      return;
    }

    const jobs = await getOfflineJobs();
    const nextJob = jobs
      .filter((job) => job.status === 'queued')
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())[0];

    if (!nextJob) {
      return;
    }

    this.processing = true;
    this.activeJobId = nextJob.id;

    const controller = new AbortController();
    this.abortControllers.set(nextJob.id, controller);

    try {
      await this.runJob(nextJob, controller.signal);
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        console.error('Offline download job error:', error);
      }
    } finally {
      this.abortControllers.delete(nextJob.id);
      this.stopReasons.delete(nextJob.id);
      this.activeJobId = null;
      this.processing = false;
      await this.processQueue();
    }
  }

  private async runJob(job: DownloadJob, signal: AbortSignal) {
    const initialChapterRecords = (
      await Promise.all(job.chapterIds.map((chapterId) => getOfflineChapter(chapterId)))
    ).filter(Boolean) as OfflineChapter[];
    const chapterState = new Map(initialChapterRecords.map((chapter) => [chapter.chapterId, chapter]));

    let currentJob = buildJobStateFromChapters(job, initialChapterRecords, {
      status: 'running',
      speedBps: 0,
      error: undefined,
    });
    await replaceOfflineJob(currentJob);

    for (const chapterId of currentJob.chapterIds) {
      if (signal.aborted) {
        throw new DOMException('Iptal edildi', 'AbortError');
      }

      const chapter = chapterState.get(chapterId);
      if (!chapter) {
        continue;
      }

      currentJob = await this.downloadSingleChapter(currentJob, chapter, chapterState, signal);
      if (signal.aborted) {
        throw new DOMException('Iptal edildi', 'AbortError');
      }
    }

    const finalChapters = Array.from(chapterState.values());
    const hasFailures = finalChapters.some((chapter) => ['failed', 'partial'].includes(chapter.downloadStatus));
    const hasCompleted = finalChapters.some((chapter) => chapter.downloadStatus === 'completed');
    const finalStatus: OfflineDownloadStatus = hasFailures
      ? hasCompleted
        ? 'partial'
        : 'failed'
      : 'completed';

    currentJob = buildJobStateFromChapters(currentJob, finalChapters, {
      status: finalStatus,
      speedBps: 0,
      error: hasFailures ? 'Bazi bolumler indirilemedi.' : undefined,
      currentChapterId: undefined,
    });
    await replaceOfflineJob(currentJob);
  }

  private async downloadSingleChapter(
    job: DownloadJob,
    chapter: OfflineChapter,
    chapterState: Map<string, OfflineChapter>,
    signal: AbortSignal,
  ) {
    const existingPages = await getOfflinePagesForChapter(chapter.chapterId);
    const downloadedIndexes = new Set(existingPages.map((page) => page.pageIndex));
    const expectedBytesByPage = new Map<number, number>(
      existingPages.map((page) => [page.pageIndex, page.byteSize]),
    );

    let downloadedPages = downloadedIndexes.size;
    let downloadedBytes = existingPages.reduce((sum, page) => sum + page.byteSize, 0);
    let lastPersistAt = performance.now();
    let lastSpeedSampleAt = performance.now();
    let speedSampleBytes = 0;

    let currentChapter = await updateOfflineChapter(chapter.chapterId, (current) => ({
      ...current,
      downloadStatus: 'running',
      downloadedPages,
      downloadedBytes,
      totalBytes: expectedBytesByPage.size === current.pageCount
        ? Array.from(expectedBytesByPage.values()).reduce((sum, value) => sum + value, 0)
        : current.totalBytes,
      lastAttemptAt: nowIso(),
      error: undefined,
    }));

    if (!currentChapter) {
      return job;
    }

    chapterState.set(chapter.chapterId, currentChapter);
    job = buildJobStateFromChapters(job, Array.from(chapterState.values()), {
      currentChapterId: chapter.chapterId,
      speedBps: 0,
      status: 'running',
    });
    await replaceOfflineJob(job);

    const queue = currentChapter.sourcePageUrls
      .map((sourceUrl, pageIndex) => ({ sourceUrl, pageIndex }))
      .filter((item) => !downloadedIndexes.has(item.pageIndex));
    const failedPages = new Set<number>();

    const persistProgress = async (force = false) => {
      const now = performance.now();
      if (!force && now - lastPersistAt < 250) {
        return;
      }

      const elapsedMs = now - lastSpeedSampleAt;
      const speedBps = elapsedMs > 0 ? (speedSampleBytes / elapsedMs) * 1000 : 0;

      currentChapter = await updateOfflineChapter(currentChapter.chapterId, (current) => ({
        ...current,
        downloadStatus: failedPages.size > 0 ? 'partial' : 'running',
        downloadedPages,
        downloadedBytes,
        totalBytes: expectedBytesByPage.size === current.pageCount
          ? Array.from(expectedBytesByPage.values()).reduce((sum, value) => sum + value, 0)
          : current.totalBytes,
        lastAttemptAt: nowIso(),
      }));

      if (!currentChapter) {
        return;
      }

      chapterState.set(currentChapter.chapterId, currentChapter);
      job = buildJobStateFromChapters(job, Array.from(chapterState.values()), {
        currentChapterId: currentChapter.chapterId,
        speedBps,
        status: 'running',
      });
      await replaceOfflineJob(job);

      lastPersistAt = now;
      lastSpeedSampleAt = now;
      speedSampleBytes = 0;
    };

    const worker = async () => {
      while (queue.length > 0) {
        if (signal.aborted) {
          throw new DOMException('Iptal edildi', 'AbortError');
        }

        const nextItem = queue.shift();
        if (!nextItem) {
          return;
        }

        try {
          const result = await downloadImageViaProxy(nextItem.sourceUrl, signal, (delta) => {
            downloadedBytes += delta;
            speedSampleBytes += delta;
            void persistProgress();
          });

          const { compressedDownloads } = getOfflinePreferences();
          const processedImage = compressedDownloads
            ? await compressOfflineImage(result.blob, result.mimeType)
            : {
              blob: result.blob,
              mimeType: result.mimeType,
              compressed: false,
            };
          const storedByteSize = (processedImage as any).storedBytes || result.byteSize;

          downloadedBytes -= result.byteSize;
          downloadedBytes += storedByteSize;

          expectedBytesByPage.set(nextItem.pageIndex, storedByteSize);
          await upsertOfflinePage({
            chapterId: currentChapter.chapterId,
            mangaId: currentChapter.mangaId,
            pageIndex: nextItem.pageIndex,
            blob: processedImage.blob,
            mimeType: processedImage.mimeType,
            byteSize: storedByteSize,
            sourceUrl: nextItem.sourceUrl,
          });
          downloadedIndexes.add(nextItem.pageIndex);
          downloadedPages = downloadedIndexes.size;
          await persistProgress(true);
        } catch (error) {
          if (signal.aborted) {
            throw error;
          }

          console.error('Offline page download error:', error);
          failedPages.add(nextItem.pageIndex);
          await persistProgress(true);
        }
      }
    };

    const workerCount = Math.min(PAGE_DOWNLOAD_CONCURRENCY, Math.max(1, queue.length));
    await Promise.all(Array.from({ length: workerCount }, () => worker()));

    if (signal.aborted) {
      const stopReason = this.stopReasons.get(job.id);
      const pausedStatus: OfflineDownloadStatus = stopReason === 'deleted' ? 'cancelled' : 'paused';

      currentChapter = await updateOfflineChapter(currentChapter.chapterId, (current) => ({
        ...current,
        downloadStatus: pausedStatus,
        downloadedPages,
        downloadedBytes,
        totalBytes: expectedBytesByPage.size === current.pageCount
          ? Array.from(expectedBytesByPage.values()).reduce((sum, value) => sum + value, 0)
          : current.totalBytes,
        lastAttemptAt: nowIso(),
      }));

      if (currentChapter) {
        chapterState.set(currentChapter.chapterId, currentChapter);
      }

      const nextStatus: OfflineDownloadStatus = stopReason === 'deleted' ? 'cancelled' : 'paused';
      await replaceOfflineJob(
        buildJobStateFromChapters(job, Array.from(chapterState.values()), {
          status: nextStatus,
          speedBps: 0,
          currentChapterId: stopReason === 'deleted' ? undefined : currentChapter?.chapterId,
        }),
      );

      if (stopReason === 'deleted') {
        await removeOfflineJob(job.id);
      }

      throw new DOMException('Iptal edildi', 'AbortError');
    }

    const totalBytes = expectedBytesByPage.size === currentChapter.pageCount
      ? Array.from(expectedBytesByPage.values()).reduce((sum, value) => sum + value, 0)
      : currentChapter.totalBytes;
    const finalStatus: OfflineDownloadStatus = failedPages.size === 0 && downloadedPages === currentChapter.pageCount
      ? 'completed'
      : downloadedPages > 0
        ? 'partial'
        : 'failed';

    currentChapter = await updateOfflineChapter(currentChapter.chapterId, (current) => ({
      ...current,
      downloadStatus: finalStatus,
      downloadedPages,
      downloadedBytes,
      totalBytes,
      downloadedAt: finalStatus === 'completed' ? nowIso() : current.downloadedAt,
      lastAttemptAt: nowIso(),
      error: finalStatus === 'completed'
        ? undefined
        : `${failedPages.size} sayfa indirilemedi.`,
    }));

    if (currentChapter) {
      chapterState.set(currentChapter.chapterId, currentChapter);
    }

    job = buildJobStateFromChapters(job, Array.from(chapterState.values()), {
      currentChapterId: undefined,
      speedBps: 0,
      status: 'running',
    });
    await replaceOfflineJob(job);
    return job;
  }
}

export const offlineDownloadManager = new OfflineDownloadManager();
