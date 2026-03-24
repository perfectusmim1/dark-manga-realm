import { syncChapterReadProgress, updateReadingProgress } from '@/lib/storage';
import {
  addPendingReaderSync,
  getPendingReaderSyncItems,
  removePendingReaderSyncItem,
} from '@/lib/offline/offlineStorage';
import { PendingReaderActivityPayload, PendingReaderProgressPayload, PendingReaderSync } from '@/lib/offline/types';

let initialized = false;
let flushInFlight: Promise<void> | null = null;

const buildPendingId = (type: PendingReaderSync['type'], userId: string, identifier: string) =>
  `${type}:${userId}:${identifier}`;

const createPendingSync = (
  type: PendingReaderSync['type'],
  userId: string,
  identifier: string,
  payload: PendingReaderSync['payload'],
): PendingReaderSync => {
  const now = new Date().toISOString();

  return {
    id: buildPendingId(type, userId, identifier),
    type,
    userId,
    createdAt: now,
    updatedAt: now,
    attempts: 0,
    payload,
  };
};

export const queueReadingProgressSync = async (
  userId: string,
  payload: PendingReaderProgressPayload,
) => {
  const existing = (await getPendingReaderSyncItems()).find(
    (item) => item.id === buildPendingId('progress', userId, payload.mangaId),
  );

  await addPendingReaderSync(
    existing
      ? {
          ...existing,
          updatedAt: new Date().toISOString(),
          payload,
        }
      : createPendingSync('progress', userId, payload.mangaId, payload),
  );
};

export const queueReadingActivitySync = async (
  userId: string,
  payload: PendingReaderActivityPayload,
) => {
  const todayKey = new Date().toISOString().split('T')[0];
  const itemId = buildPendingId('activity', userId, `${payload.chapterId}:${todayKey}`);
  const existing = (await getPendingReaderSyncItems()).find((item) => item.id === itemId);

  await addPendingReaderSync(
    existing
      ? {
          ...existing,
          updatedAt: new Date().toISOString(),
          payload: {
            ...(existing.payload as PendingReaderActivityPayload),
            secondsSpent:
              ((existing.payload as PendingReaderActivityPayload).secondsSpent || 0) + payload.secondsSpent,
          },
        }
      : createPendingSync('activity', userId, `${payload.chapterId}:${todayKey}`, payload),
  );
};

export const flushPendingReaderSync = async () => {
  if (!navigator.onLine) {
    return;
  }

  if (flushInFlight) {
    return flushInFlight;
  }

  flushInFlight = (async () => {
    const items = await getPendingReaderSyncItems();
    const sortedItems = [...items].sort(
      (a, b) => new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime(),
    );

    for (const item of sortedItems) {
      try {
        if (item.type === 'progress') {
          const payload = item.payload as PendingReaderProgressPayload;
          await updateReadingProgress(item.userId, {
            mangaId: payload.mangaId,
            chapterId: payload.chapterId,
            chapterNumber: payload.chapterNumber,
            page: payload.page,
          });
          await syncChapterReadProgress(item.userId, {
            mangaId: payload.mangaId,
            chapterId: payload.chapterId,
            chapterNumber: payload.chapterNumber,
            page: payload.page,
            pageCount: payload.pageCount || payload.page,
          });
        } else {
          await removePendingReaderSyncItem(item.id);
          continue;
        }

        await removePendingReaderSyncItem(item.id);
      } catch (error) {
        console.error('Pending reader sync flush error:', error);
      }
    }
  })().finally(() => {
    flushInFlight = null;
  });

  return flushInFlight;
};

export const initializeOfflineReaderSync = () => {
  if (initialized || typeof window === 'undefined') {
    return;
  }

  initialized = true;
  window.addEventListener('online', () => {
    void flushPendingReaderSync();
  });

  void flushPendingReaderSync();
};
