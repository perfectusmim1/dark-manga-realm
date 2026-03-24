import { Manga } from '@/lib/types';

export type OfflineDownloadStatus =
  | 'queued'
  | 'running'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'partial'
  | 'cancelled';

export interface OfflineManga {
  mangaId: string;
  title: string;
  cover: string;
  banner?: string;
  author: string;
  artist?: string;
  type: Manga['type'];
  status: Manga['status'];
  description: string;
  genres: string[];
  chapterCount: number;
  totalPages: number;
  lastUpdated: string;
  createdAt: string;
  downloadedAt: string;
}

export interface OfflineChapter {
  chapterId: string;
  mangaId: string;
  chapterNumber: number;
  title: string;
  releaseDate: string;
  pageCount: number;
  sourcePageUrls: string[];
  downloadStatus: OfflineDownloadStatus;
  downloadedPages: number;
  downloadedBytes: number;
  totalBytes?: number;
  downloadedAt?: string;
  lastAttemptAt?: string;
  error?: string;
  isRead?: boolean;
  maxReadPage?: number;
  readProgressPercent?: number;
  lastReadAt?: string;
}

export interface OfflinePage {
  id: string;
  chapterId: string;
  mangaId: string;
  pageIndex: number;
  blob: Blob;
  mimeType: string;
  byteSize: number;
  sourceUrl: string;
  createdAt: string;
}

export interface DownloadJob {
  id: string;
  type: 'chapter' | 'series';
  mangaId: string;
  mangaTitle: string;
  chapterIds: string[];
  status: OfflineDownloadStatus;
  progressPercent: number;
  downloadedBytes: number;
  totalBytes?: number;
  speedBps: number;
  currentChapterId?: string;
  completedChapterIds: string[];
  failedChapterIds: string[];
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export type PendingReaderSyncType = 'progress' | 'activity';

export interface PendingReaderProgressPayload {
  mangaId: string;
  chapterId: string;
  chapterNumber: number;
  page: number;
}

export interface PendingReaderActivityPayload {
  mangaId: string;
  chapterId: string;
  chapterNumber: number;
  secondsSpent: number;
}

export interface PendingReaderSync {
  id: string;
  type: PendingReaderSyncType;
  userId: string;
  createdAt: string;
  updatedAt: string;
  attempts: number;
  payload: PendingReaderProgressPayload | PendingReaderActivityPayload;
}

export interface OfflineMangaGroup {
  manga: OfflineManga;
  chapters: OfflineChapter[];
  jobs: DownloadJob[];
  totalBytes: number;
  downloadedChapters: number;
  latestDownloadedAt?: string;
}

export interface OfflineLibraryStats {
  usedBytes: number;
  browserUsageBytes?: number;
  quotaBytes?: number;
  seriesCount: number;
  chapterCount: number;
  activeDownloads: number;
}

export interface OfflineLibrarySnapshot {
  series: OfflineMangaGroup[];
  jobs: DownloadJob[];
  stats: OfflineLibraryStats;
}
