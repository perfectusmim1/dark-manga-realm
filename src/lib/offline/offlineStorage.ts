import { DBSchema, openDB } from 'idb';
import { Chapter, Character, Manga, ResolvedReaderPage } from '@/lib/types';
import {
  DownloadJob,
  OfflineChapter,
  OfflineCharacterCard,
  OfflineDownloadStatus,
  OfflineLibrarySnapshot,
  OfflineManga,
  OfflinePage,
  PendingReaderSync,
} from '@/lib/offline/types';
import {
  cachePersistentImageDataUrl,
  isPersistentImageDataUrl,
  shouldAttemptPersistentImageCache,
} from '@/lib/offline/persistentImageCache';
import { warmPersistentImageUrls } from '@/lib/offline/persistentImageWarmup';

const OFFLINE_DB_NAME = 'toonparrot-offline';
const OFFLINE_DB_VERSION = 1;
const OFFLINE_EVENT_NAME = 'toonparrot:offline-updated';

interface OfflineDbSchema extends DBSchema {
  mangas: {
    key: string;
    value: OfflineManga;
  };
  chapters: {
    key: string;
    value: OfflineChapter;
    indexes: {
      'by-mangaId': string;
      'by-status': OfflineDownloadStatus;
    };
  };
  pages: {
    key: string;
    value: OfflinePage;
    indexes: {
      'by-chapterId': string;
      'by-mangaId': string;
    };
  };
  jobs: {
    key: string;
    value: DownloadJob;
    indexes: {
      'by-status': OfflineDownloadStatus;
      'by-mangaId': string;
    };
  };
  pendingSync: {
    key: string;
    value: PendingReaderSync;
    indexes: {
      'by-type': PendingReaderSync['type'];
    };
  };
}

const dbPromise = openDB<OfflineDbSchema>(OFFLINE_DB_NAME, OFFLINE_DB_VERSION, {
  upgrade(db) {
    if (!db.objectStoreNames.contains('mangas')) {
      db.createObjectStore('mangas', { keyPath: 'mangaId' });
    }

    if (!db.objectStoreNames.contains('chapters')) {
      const chaptersStore = db.createObjectStore('chapters', { keyPath: 'chapterId' });
      chaptersStore.createIndex('by-mangaId', 'mangaId');
      chaptersStore.createIndex('by-status', 'downloadStatus');
    }

    if (!db.objectStoreNames.contains('pages')) {
      const pagesStore = db.createObjectStore('pages', { keyPath: 'id' });
      pagesStore.createIndex('by-chapterId', 'chapterId');
      pagesStore.createIndex('by-mangaId', 'mangaId');
    }

    if (!db.objectStoreNames.contains('jobs')) {
      const jobsStore = db.createObjectStore('jobs', { keyPath: 'id' });
      jobsStore.createIndex('by-status', 'status');
      jobsStore.createIndex('by-mangaId', 'mangaId');
    }

    if (!db.objectStoreNames.contains('pendingSync')) {
      const syncStore = db.createObjectStore('pendingSync', { keyPath: 'id' });
      syncStore.createIndex('by-type', 'type');
    }
  },
});

const getDb = () => dbPromise;
const mangaArtworkRepairQueue = new Map<string, Promise<void>>();

const isNonEmptyString = (value?: string | null): value is string =>
  typeof value === 'string' && value.trim().length > 0;

const resolveArtworkSourceUrl = (...values: Array<string | null | undefined>) => {
  const found = values.find(
    (value): value is string => isNonEmptyString(value) && !isPersistentImageDataUrl(value),
  );
  return typeof found === 'string' ? found.trim() : undefined;
};

const emitOfflineLibraryChange = () => {
  if (typeof window === 'undefined') {
    return;
  }

  window.dispatchEvent(new Event(OFFLINE_EVENT_NAME));
};

const getChapterPageCount = (chapter: Chapter) => (
  typeof chapter.pageCount === 'number' && chapter.pageCount > 0
    ? chapter.pageCount
    : chapter.pages.length
);

const mapChapterToOffline = (
  mangaId: string,
  chapter: Chapter,
  downloadStatus: OfflineDownloadStatus = 'queued',
): OfflineChapter => ({
  chapterId: chapter.id,
  mangaId,
  chapterNumber: chapter.number,
  title: chapter.title,
  releaseDate: chapter.releaseDate,
  pageCount: getChapterPageCount(chapter),
  sourcePageUrls: chapter.pages,
  downloadStatus,
  downloadedPages: 0,
  downloadedBytes: 0,
  isRead: false,
  maxReadPage: 0,
  readProgressPercent: 0,
});

const mapMangaToOffline = (manga: Manga): OfflineManga => ({
  mangaId: manga.id,
  title: manga.title,
  cover: manga.cover,
  coverSourceUrl: manga.cover,
  banner: manga.banner,
  bannerSourceUrl: manga.banner,
  author: manga.author,
  artist: manga.artist,
  type: manga.type,
  status: manga.status,
  description: manga.description,
  genres: manga.genres,
  chapterCount: manga.chapters.length,
  totalPages: manga.chapters.reduce((sum, chapter) => sum + getChapterPageCount(chapter), 0),
  lastUpdated: manga.lastUpdated,
  createdAt: manga.createdAt,
  downloadedAt: new Date().toISOString(),
  characters: [],
});

const mapCharactersToOffline = (characters: Character[]): OfflineCharacterCard[] => (
  characters.map((character) => ({
    id: character.id,
    name: character.name,
    imageUrl: character.imageUrl,
    imageSourceUrl: character.imageUrl,
    likesCount: character.likesCount || 0,
  }))
);

const sortChapters = (chapters: OfflineChapter[]) =>
  [...chapters].sort((a, b) => b.chapterNumber - a.chapterNumber);

const sumDownloadedBytes = (chapters: OfflineChapter[]) =>
  chapters.reduce((sum, chapter) => sum + (chapter.downloadedBytes || 0), 0);

const persistOfflineMangaArtwork = async (
  mangaId: string,
  artwork?: { coverSourceUrl?: string | null; bannerSourceUrl?: string | null },
) => {
  if (
    typeof window === 'undefined'
    || (typeof navigator !== 'undefined' && !navigator.onLine)
  ) {
    return;
  }

  const existingTask = mangaArtworkRepairQueue.get(mangaId);
  if (existingTask) {
    return existingTask;
  }

  const task = (async () => {
    const db = await getDb();
    const current = await db.get('mangas', mangaId);

    if (!current) {
      return;
    }

    const coverSourceUrl = resolveArtworkSourceUrl(
      artwork?.coverSourceUrl,
      current.coverSourceUrl,
      current.cover,
    );
    const bannerSourceUrl = resolveArtworkSourceUrl(
      artwork?.bannerSourceUrl,
      current.bannerSourceUrl,
      current.banner,
    );

    const shouldRefreshCover = Boolean(
      coverSourceUrl
      && shouldAttemptPersistentImageCache(coverSourceUrl)
      && (!isPersistentImageDataUrl(current.cover) || current.coverSourceUrl !== coverSourceUrl),
    );
    const shouldRefreshBanner = Boolean(
      bannerSourceUrl
      && shouldAttemptPersistentImageCache(bannerSourceUrl)
      && (!isPersistentImageDataUrl(current.banner) || current.bannerSourceUrl !== bannerSourceUrl),
    );

    const [nextCover, nextBanner] = await Promise.all([
      shouldRefreshCover ? cachePersistentImageDataUrl(coverSourceUrl) : Promise.resolve(undefined),
      shouldRefreshBanner ? cachePersistentImageDataUrl(bannerSourceUrl) : Promise.resolve(undefined),
    ]);

    const nextValue: OfflineManga = {
      ...current,
      cover: nextCover || current.cover,
      banner: nextBanner || current.banner,
      coverSourceUrl: coverSourceUrl || current.coverSourceUrl,
      bannerSourceUrl: bannerSourceUrl || current.bannerSourceUrl,
    };

    if (
      nextValue.cover === current.cover
      && nextValue.banner === current.banner
      && nextValue.coverSourceUrl === current.coverSourceUrl
      && nextValue.bannerSourceUrl === current.bannerSourceUrl
    ) {
      return;
    }

    await db.put('mangas', nextValue);
    emitOfflineLibraryChange();
  })().finally(() => {
    mangaArtworkRepairQueue.delete(mangaId);
  });

  mangaArtworkRepairQueue.set(mangaId, task);
  return task;
};

const queueOfflineMangaArtworkPersist = (
  mangaId: string,
  artwork?: { coverSourceUrl?: string | null; bannerSourceUrl?: string | null },
) => {
  void persistOfflineMangaArtwork(mangaId, artwork).catch(() => undefined);
};

export const subscribeOfflineLibrary = (listener: () => void) => {
  if (typeof window === 'undefined') {
    return () => undefined;
  }

  window.addEventListener(OFFLINE_EVENT_NAME, listener);
  window.addEventListener('online', listener);
  window.addEventListener('offline', listener);

  return () => {
    window.removeEventListener(OFFLINE_EVENT_NAME, listener);
    window.removeEventListener('online', listener);
    window.removeEventListener('offline', listener);
  };
};

export const cacheOfflineManga = async (manga: Manga) => {
  const db = await getDb();
  const current = await db.get('mangas', manga.id);
  const nextTotalPages = manga.chapters.reduce((sum, chapter) => sum + getChapterPageCount(chapter), 0);
  const nextValue: OfflineManga = {
    ...mapMangaToOffline(manga),
    downloadedAt: current?.downloadedAt || new Date().toISOString(),
    characters: current?.characters || [],
    cover: isPersistentImageDataUrl(current?.cover) ? current.cover : manga.cover,
    banner: isPersistentImageDataUrl(current?.banner) ? current.banner : manga.banner,
    totalPages: nextTotalPages > 0 ? nextTotalPages : current?.totalPages || 0,
  };

  await db.put('mangas', nextValue);
  queueOfflineMangaArtworkPersist(manga.id, {
    coverSourceUrl: manga.cover,
    bannerSourceUrl: manga.banner,
  });
  warmPersistentImageUrls([manga.cover, manga.banner]);
  emitOfflineLibraryChange();
};

export const cacheOfflineMangaCharacters = async (mangaId: string, characters: Character[]) => {
  const db = await getDb();
  const current = await db.get('mangas', mangaId);

  if (!current) {
    return undefined;
  }

  const persistedCharacters = await Promise.all(
    characters.map(async (character) => {
      const imageSourceUrl = resolveArtworkSourceUrl(character.imageUrl);
      const imageUrl = imageSourceUrl
        ? await cachePersistentImageDataUrl(imageSourceUrl) || character.imageUrl
        : character.imageUrl;

      return {
        id: character.id,
        name: character.name,
        imageUrl,
        imageSourceUrl,
        likesCount: character.likesCount || 0,
      } satisfies OfflineCharacterCard;
    }),
  );

  const nextValue: OfflineManga = {
    ...current,
    characters: persistedCharacters,
  };

  await db.put('mangas', nextValue);
  emitOfflineLibraryChange();
  return nextValue;
};

export const getOfflineMangaCharacters = async (mangaId: string) => {
  const manga = await getOfflineManga(mangaId);
  return manga?.characters || [];
};

export const cacheOfflineChapterMetadata = async (
  mangaId: string,
  chapter: Chapter,
  downloadStatus: OfflineDownloadStatus = 'queued',
) => {
  const db = await getDb();
  const existing = await db.get('chapters', chapter.id);
  const nextPageCount = getChapterPageCount(chapter);
  const sourcePageUrlsChanged = existing
    ? existing.pageCount !== nextPageCount
      || existing.sourcePageUrls.length !== chapter.pages.length
      || existing.sourcePageUrls.some((url, index) => url !== chapter.pages[index])
    : false;
  const nextDownloadStatus: OfflineDownloadStatus = existing
    ? existing.downloadStatus === 'completed' && !sourcePageUrlsChanged
      ? existing.downloadStatus
      : existing.downloadStatus === 'completed' && sourcePageUrlsChanged
        ? (existing.downloadedPages > 0 ? 'partial' : downloadStatus)
        : downloadStatus
    : downloadStatus;
  const nextValue: OfflineChapter = existing
    ? {
        ...existing,
        chapterNumber: chapter.number,
        title: chapter.title,
        releaseDate: chapter.releaseDate,
        pageCount: nextPageCount,
        sourcePageUrls: chapter.pages,
        downloadStatus: nextDownloadStatus,
        error: sourcePageUrlsChanged && existing.downloadStatus === 'completed'
          ? 'Bolum icerigi guncellendi. Yeniden indirme onerilir.'
          : existing.error,
      }
    : mapChapterToOffline(mangaId, chapter, downloadStatus);

  await db.put('chapters', nextValue);
  emitOfflineLibraryChange();
  return nextValue;
};

export const getOfflineManga = async (mangaId: string) => {
  const db = await getDb();
  return db.get('mangas', mangaId);
};

export const getOfflineChapter = async (chapterId: string) => {
  const db = await getDb();
  return db.get('chapters', chapterId);
};

export const getOfflineChaptersForManga = async (mangaId: string) => {
  const db = await getDb();
  const chapters = await db.getAllFromIndex('chapters', 'by-mangaId', mangaId);
  return sortChapters(chapters);
};

export const getOfflinePagesForChapter = async (chapterId: string) => {
  const db = await getDb();
  const pages = await db.getAllFromIndex('pages', 'by-chapterId', chapterId);
  return [...pages].sort((a, b) => a.pageIndex - b.pageIndex);
};

export const upsertOfflinePage = async (page: Omit<OfflinePage, 'id' | 'createdAt'>) => {
  const db = await getDb();
  const nextValue: OfflinePage = {
    ...page,
    id: `${page.chapterId}:${page.pageIndex}`,
    createdAt: new Date().toISOString(),
  };

  await db.put('pages', nextValue);
};

export const updateOfflineChapter = async (
  chapterId: string,
  updater: (current: OfflineChapter) => OfflineChapter,
) => {
  const db = await getDb();
  const current = await db.get('chapters', chapterId);
  if (!current) {
    return undefined;
  }

  const nextValue = updater(current);
  await db.put('chapters', nextValue);
  emitOfflineLibraryChange();
  return nextValue;
};

export const markOfflineChapterReadProgress = async (
  chapterId: string,
  currentPage: number,
  totalPages: number,
) => {
  if (!chapterId || !Number.isFinite(currentPage) || !Number.isFinite(totalPages) || totalPages <= 0) {
    return undefined;
  }

  return updateOfflineChapter(chapterId, (current) => {
    const nextMaxReadPage = Math.max(current.maxReadPage || 0, Math.min(currentPage, totalPages));
    const normalizedPercent = totalPages <= 1
      ? 100
      : Math.min(100, Math.max(0, Number((((nextMaxReadPage - 1) / Math.max(totalPages - 1, 1)) * 100).toFixed(2))));
    const readProgressPercent = Math.max(
      current.readProgressPercent || 0,
      normalizedPercent,
    );
    const shouldMarkRead = readProgressPercent >= 60;

    return {
      ...current,
      maxReadPage: nextMaxReadPage,
      readProgressPercent,
      isRead: current.isRead || shouldMarkRead,
      lastReadAt: new Date().toISOString(),
    };
  });
};

export const replaceOfflineJob = async (job: DownloadJob) => {
  const db = await getDb();
  await db.put('jobs', job);
  emitOfflineLibraryChange();
};

export const updateOfflineJob = async (
  jobId: string,
  updater: (current: DownloadJob) => DownloadJob,
) => {
  const db = await getDb();
  const current = await db.get('jobs', jobId);
  if (!current) {
    return undefined;
  }

  const nextValue = updater(current);
  await db.put('jobs', nextValue);
  emitOfflineLibraryChange();
  return nextValue;
};

export const getOfflineJob = async (jobId: string) => {
  const db = await getDb();
  return db.get('jobs', jobId);
};

export const getOfflineJobs = async () => {
  const db = await getDb();
  return db.getAll('jobs');
};

export const removeOfflineJob = async (jobId: string) => {
  const db = await getDb();
  await db.delete('jobs', jobId);
  emitOfflineLibraryChange();
};

export const addPendingReaderSync = async (item: PendingReaderSync) => {
  const db = await getDb();
  await db.put('pendingSync', item);
};

export const getPendingReaderSyncItems = async () => {
  const db = await getDb();
  return db.getAll('pendingSync');
};

export const removePendingReaderSyncItem = async (id: string) => {
  const db = await getDb();
  await db.delete('pendingSync', id);
};

export const deleteOfflineChapter = async (chapterId: string) => {
  const db = await getDb();
  const tx = db.transaction(['pages', 'chapters', 'jobs'], 'readwrite');
  const chapterStore = tx.objectStore('chapters');
  const pageStore = tx.objectStore('pages');
  const jobStore = tx.objectStore('jobs');

  const chapter = await chapterStore.get(chapterId);
  const pages = await pageStore.index('by-chapterId').getAll(chapterId);
  const jobs = await jobStore.getAll();

  for (const page of pages) {
    await pageStore.delete(page.id);
  }

  await chapterStore.delete(chapterId);

  for (const job of jobs) {
    if (!job.chapterIds.includes(chapterId)) {
      continue;
    }

    const nextChapterIds = job.chapterIds.filter((id) => id !== chapterId);
    if (nextChapterIds.length === 0) {
      await jobStore.delete(job.id);
      continue;
    }

    await jobStore.put({
      ...job,
      chapterIds: nextChapterIds,
      completedChapterIds: job.completedChapterIds.filter((id) => id !== chapterId),
      failedChapterIds: job.failedChapterIds.filter((id) => id !== chapterId),
      currentChapterId: job.currentChapterId === chapterId ? undefined : job.currentChapterId,
      updatedAt: new Date().toISOString(),
    });
  }

  await tx.done;

  if (chapter?.mangaId) {
    await cleanupMangaIfEmpty(chapter.mangaId);
  }

  emitOfflineLibraryChange();
};

const cleanupMangaIfEmpty = async (mangaId: string) => {
  const db = await getDb();
  const chapters = await db.getAllFromIndex('chapters', 'by-mangaId', mangaId);
  if (chapters.length > 0) {
    return;
  }

  const jobs = await db.getAllFromIndex('jobs', 'by-mangaId', mangaId);
  for (const job of jobs) {
    await db.delete('jobs', job.id);
  }

  await db.delete('mangas', mangaId);
};

export const deleteOfflineManga = async (mangaId: string) => {
  const db = await getDb();
  const chapters = await db.getAllFromIndex('chapters', 'by-mangaId', mangaId);

  for (const chapter of chapters) {
    const pages = await db.getAllFromIndex('pages', 'by-chapterId', chapter.chapterId);
    for (const page of pages) {
      await db.delete('pages', page.id);
    }
    await db.delete('chapters', chapter.chapterId);
  }

  const jobs = await db.getAllFromIndex('jobs', 'by-mangaId', mangaId);
  for (const job of jobs) {
    await db.delete('jobs', job.id);
  }

  await db.delete('mangas', mangaId);
  emitOfflineLibraryChange();
};

export const deleteReadOfflineChaptersForManga = async (mangaId: string) => {
  const chapters = await getOfflineChaptersForManga(mangaId);
  const readChapterIds = chapters
    .filter((chapter) => chapter.isRead)
    .map((chapter) => chapter.chapterId);

  for (const chapterId of readChapterIds) {
    await deleteOfflineChapter(chapterId);
  }

  return readChapterIds.length;
};

export const buildOfflineReaderPages = async (chapterId: string, expectedPageCount?: number) => {
  const [chapter, pages] = await Promise.all([
    getOfflineChapter(chapterId),
    getOfflinePagesForChapter(chapterId),
  ]);
  const storedPageCount = pages.length;
  const storedByteCount = pages.reduce((sum, page) => sum + page.byteSize, 0);
  const resolvedExpectedPageCount = Math.max(
    expectedPageCount || 0,
    chapter?.pageCount || 0,
    chapter?.sourcePageUrls?.length || 0,
    storedPageCount,
  );

  if (
    chapter
    && chapter.downloadStatus === 'completed'
    && storedPageCount < resolvedExpectedPageCount
  ) {
    await updateOfflineChapter(chapterId, (current) => ({
      ...current,
      downloadStatus: storedPageCount > 0 ? 'partial' : 'failed',
      downloadedPages: storedPageCount,
      downloadedBytes: storedByteCount,
      error: storedPageCount > 0
        ? `${resolvedExpectedPageCount - storedPageCount} sayfa eksik. Yeniden indirme onerilir.`
        : 'Cevrimdisi sayfalar bulunamadi. Yeniden indirme gerekiyor.',
      lastAttemptAt: new Date().toISOString(),
    }));
  }

  const objectUrls = pages.map((page) => URL.createObjectURL(page.blob));

  const resolvedPages: ResolvedReaderPage[] = objectUrls.map((url) => ({
    src: url,
    source: 'offline',
  }));

  return {
    pages: resolvedPages,
    storedPageCount,
    expectedPageCount: resolvedExpectedPageCount,
    isComplete: storedPageCount > 0 && storedPageCount >= resolvedExpectedPageCount,
    revoke: () => {
      objectUrls.forEach((url) => URL.revokeObjectURL(url));
    },
  };
};

export const getOfflineMangaDetail = async (mangaId: string): Promise<Manga | undefined> => {
  const [manga, chapters] = await Promise.all([
    getOfflineManga(mangaId),
    getOfflineChaptersForManga(mangaId),
  ]);

  if (!manga) {
    return undefined;
  }

  if (!isPersistentImageDataUrl(manga.cover) || (manga.banner && !isPersistentImageDataUrl(manga.banner))) {
    queueOfflineMangaArtworkPersist(manga.mangaId, {
      coverSourceUrl: manga.coverSourceUrl,
      bannerSourceUrl: manga.bannerSourceUrl,
    });
  }

  return {
    id: manga.mangaId,
    title: manga.title,
    alternativeTitles: [],
    cover: manga.cover,
    banner: manga.banner,
    author: manga.author,
    artist: manga.artist,
    status: manga.status,
    genres: manga.genres,
    description: manga.description,
    ratings: [],
    views: 0,
    chapters: chapters.map((chapter) => ({
      id: chapter.chapterId,
      number: chapter.chapterNumber,
      title: chapter.title,
      pages: chapter.sourcePageUrls,
      releaseDate: chapter.releaseDate,
      views: 0,
    })),
    lastUpdated: manga.lastUpdated,
    createdAt: manga.createdAt,
    type: manga.type,
    averageRating: 0,
    reviewCount: 0,
  };
};

export const getOfflineLibrarySnapshot = async (): Promise<OfflineLibrarySnapshot> => {
  const db = await getDb();
  const [mangas, chapters, jobs] = await Promise.all([
    db.getAll('mangas'),
    db.getAll('chapters'),
    db.getAll('jobs'),
  ]);

  let quotaEstimate: StorageEstimate | undefined;
  try {
    quotaEstimate = navigator.storage?.estimate ? await navigator.storage.estimate() : undefined;
  } catch {
    quotaEstimate = undefined;
  }
  const chaptersByManga = new Map<string, OfflineChapter[]>();
  const jobsByManga = new Map<string, DownloadJob[]>();

  for (const chapter of chapters) {
    const existing = chaptersByManga.get(chapter.mangaId) || [];
    existing.push(chapter);
    chaptersByManga.set(chapter.mangaId, existing);
  }

  for (const job of jobs) {
    const existing = jobsByManga.get(job.mangaId) || [];
    existing.push(job);
    jobsByManga.set(job.mangaId, existing);
  }

  mangas.forEach((manga) => {
    const shouldRefreshCover = !isPersistentImageDataUrl(manga.cover)
      && shouldAttemptPersistentImageCache(resolveArtworkSourceUrl(manga.coverSourceUrl, manga.cover));
    const shouldRefreshBanner = Boolean(
      manga.banner
      && !isPersistentImageDataUrl(manga.banner)
      && shouldAttemptPersistentImageCache(resolveArtworkSourceUrl(manga.bannerSourceUrl, manga.banner)),
    );

    if (shouldRefreshCover || shouldRefreshBanner) {
      queueOfflineMangaArtworkPersist(manga.mangaId, {
        coverSourceUrl: manga.coverSourceUrl,
        bannerSourceUrl: manga.bannerSourceUrl,
      });
    }
  });

  const series = mangas
    .map((manga) => {
      const mangaChapters = sortChapters(chaptersByManga.get(manga.mangaId) || []);
      const mangaJobs = [...(jobsByManga.get(manga.mangaId) || [])].sort(
        (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
      );
      const latestDownloadedAt = mangaChapters
        .map((chapter) => chapter.downloadedAt || chapter.lastAttemptAt)
        .filter(Boolean)
        .sort()
        .pop();

      return {
        manga,
        chapters: mangaChapters,
        jobs: mangaJobs,
        totalBytes: sumDownloadedBytes(mangaChapters),
        downloadedChapters: mangaChapters.filter((chapter) => chapter.downloadStatus === 'completed').length,
        latestDownloadedAt,
      };
    })
    .filter((entry) => entry.chapters.length > 0 || entry.jobs.length > 0)
    .sort((a, b) => {
      const aTime = new Date(a.latestDownloadedAt || a.manga.downloadedAt).getTime();
      const bTime = new Date(b.latestDownloadedAt || b.manga.downloadedAt).getTime();
      return bTime - aTime;
    });

  return {
    series,
    jobs: jobs.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()),
    stats: {
      usedBytes: chapters.reduce((sum, chapter) => sum + (chapter.downloadedBytes || 0), 0),
      browserUsageBytes: quotaEstimate?.usage,
      quotaBytes: quotaEstimate?.quota,
      seriesCount: series.length,
      chapterCount: chapters.filter((chapter) => chapter.downloadStatus === 'completed').length,
      activeDownloads: jobs.filter((job) => ['queued', 'running', 'paused'].includes(job.status)).length,
    },
  };
};

export const getOfflineChapterMap = async (mangaId: string) => {
  const chapters = await getOfflineChaptersForManga(mangaId);
  return chapters.reduce<Record<string, OfflineChapter>>((map, chapter) => {
    map[chapter.chapterId] = chapter;
    return map;
  }, {});
};

export const clearInterruptedJobs = async () => {
  const db = await getDb();
  const jobs = await db.getAll('jobs');

  await Promise.all(
    jobs.map(async (job) => {
      if (!['running', 'queued'].includes(job.status)) {
        return;
      }

      await db.put('jobs', {
        ...job,
        status: 'paused',
        error: job.status === 'running' ? 'Tarayici yeniden acildigi icin duraklatildi.' : job.error,
        updatedAt: new Date().toISOString(),
      });
    }),
  );

  emitOfflineLibraryChange();
};
