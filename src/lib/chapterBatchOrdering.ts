type ChapterBatchSortable = {
    chapterNumber?: number | null;
    mangaId?: string | null;
};

const CHAPTER_BATCH_WINDOW_IN_MS = 15_000;
const FALLBACK_CHAPTER_ORDER = Number.MAX_SAFE_INTEGER;

const getTimestamp = (value?: string | null) => {
    const parsed = Date.parse(value || '');
    return Number.isFinite(parsed) ? parsed : 0;
};

const getMinuteBucket = (value?: string | null) =>
    Math.floor(getTimestamp(value) / CHAPTER_BATCH_WINDOW_IN_MS);

const hasChapterOrder = (value?: number | null) => Number.isFinite(value);

const getChapterOrder = (value?: number | null) =>
    Number.isFinite(value) ? Number(value) : FALLBACK_CHAPTER_ORDER;

export const sortChapterBatchItems = <T extends ChapterBatchSortable>(
    items: T[],
    getCreatedAt: (item: T) => string | null | undefined,
    getStableId: (item: T) => string
) =>
    [...items].sort((left, right) => {
        const leftCreatedAt = getCreatedAt(left);
        const rightCreatedAt = getCreatedAt(right);

        const sameMangaBatch =
            Boolean(left.mangaId) &&
            left.mangaId === right.mangaId &&
            hasChapterOrder(left.chapterNumber) &&
            hasChapterOrder(right.chapterNumber) &&
            getMinuteBucket(leftCreatedAt) === getMinuteBucket(rightCreatedAt);

        if (sameMangaBatch) {
            const chapterDiff = getChapterOrder(right.chapterNumber) - getChapterOrder(left.chapterNumber);
            if (chapterDiff !== 0) {
                return chapterDiff;
            }
        }

        const timeDiff = getTimestamp(rightCreatedAt) - getTimestamp(leftCreatedAt);
        if (timeDiff !== 0) {
            return timeDiff;
        }

        const mangaDiff = (left.mangaId || '').localeCompare(right.mangaId || '');
        if (mangaDiff !== 0) {
            return mangaDiff;
        }

        const chapterDiff = getChapterOrder(right.chapterNumber) - getChapterOrder(left.chapterNumber);
        if (chapterDiff !== 0) {
            return chapterDiff;
        }

        return getStableId(left).localeCompare(getStableId(right));
    });
