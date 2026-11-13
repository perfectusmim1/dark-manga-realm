import type { Bookmark } from '@/lib/types';

const BOOKMARK_META_PATTERN = /\s*\[\[tp:offset=([0-9.]+),pct=([0-9.]+)\]\]$/;

/** Encodes scroll offset and chapter percentage metadata inside a bookmark note string. */
export const encodeBookmarkNoteWithMeta = (
  note?: string | null,
  pageOffsetRatio?: number,
  progressPercent?: number,
): string | null => {
  const cleanNote = (note || '').replace(BOOKMARK_META_PATTERN, '').trim();
  const hasMeta = (typeof pageOffsetRatio === 'number' && Number.isFinite(pageOffsetRatio) && pageOffsetRatio > 0)
    || (typeof progressPercent === 'number' && Number.isFinite(progressPercent) && progressPercent >= 0);

  if (!hasMeta) {
    return cleanNote || null;
  }

  const safeOffset = typeof pageOffsetRatio === 'number' && Number.isFinite(pageOffsetRatio)
    ? Math.min(1, Math.max(0, pageOffsetRatio)).toFixed(4)
    : '0';
  const safePct = typeof progressPercent === 'number' && Number.isFinite(progressPercent)
    ? Math.min(100, Math.max(0, progressPercent)).toFixed(2)
    : '0';
  const metaTag = `[[tp:offset=${safeOffset},pct=${safePct}]]`;
  return cleanNote ? `${cleanNote} ${metaTag}` : metaTag;
};

/** Decodes embedded scroll offset and percentage metadata from a raw bookmark note string. */
export const decodeBookmarkNoteWithMeta = (rawNote?: string | null): {
  note: string | null;
  pageOffsetRatio?: number;
  progressPercent?: number;
} => {
  if (!rawNote) {
    return { note: null };
  }

  const match = rawNote.match(BOOKMARK_META_PATTERN);
  if (!match) {
    return { note: rawNote };
  }

  const cleanNote = rawNote.replace(BOOKMARK_META_PATTERN, '').trim();
  const parsedOffset = parseFloat(match[1]);
  const parsedPct = parseFloat(match[2]);

  return {
    note: cleanNote || null,
    pageOffsetRatio: Number.isFinite(parsedOffset) ? parsedOffset : undefined,
    progressPercent: Number.isFinite(parsedPct) ? parsedPct : undefined,
  };
};

/** Returns true when two bookmarks point to the same reading position (percentage-first). */
export const isSameBookmarkLocation = (
  left: Pick<Bookmark, 'mangaId' | 'chapterId' | 'page' | 'pageOffsetRatio' | 'progressPercent'>,
  right: Pick<Bookmark, 'mangaId' | 'chapterId' | 'page' | 'pageOffsetRatio' | 'progressPercent'>,
): boolean => {
  if (left.mangaId !== right.mangaId || left.chapterId !== right.chapterId) {
    return false;
  }

  const leftPct = typeof left.progressPercent === 'number' && Number.isFinite(left.progressPercent)
    ? left.progressPercent
    : undefined;
  const rightPct = typeof right.progressPercent === 'number' && Number.isFinite(right.progressPercent)
    ? right.progressPercent
    : undefined;

  if (leftPct !== undefined && rightPct !== undefined) {
    return Math.abs(leftPct - rightPct) < 0.5;
  }

  if (left.page !== right.page) {
    return false;
  }

  const leftOffset = typeof left.pageOffsetRatio === 'number' && Number.isFinite(left.pageOffsetRatio)
    ? left.pageOffsetRatio
    : 0;
  const rightOffset = typeof right.pageOffsetRatio === 'number' && Number.isFinite(right.pageOffsetRatio)
    ? right.pageOffsetRatio
    : 0;

  return Math.abs(leftOffset - rightOffset) < 0.03;
};

/** Builds a reader URL targeting a percentage position when available, falling back to page/offset. */
export const buildChapterResumePath = (target: {
  mangaId: string;
  chapterId: string;
  page?: number;
  pageOffsetRatio?: number;
  progressPercent?: number;
}): string => {
  const basePath = `/manga/${target.mangaId}/chapter/${target.chapterId}`;
  if (typeof target.progressPercent === 'number' && Number.isFinite(target.progressPercent) && target.progressPercent >= 0) {
    return `${basePath}?pct=${Math.min(100, Math.max(0, target.progressPercent)).toFixed(2)}`;
  }

  const safePage = Math.max(1, target.page || 1);
  const offsetSuffix = target.pageOffsetRatio && target.pageOffsetRatio > 0.005
    ? `&offset=${target.pageOffsetRatio.toFixed(3)}`
    : '';
  return `${basePath}?page=${safePage}${offsetSuffix}`;
};
