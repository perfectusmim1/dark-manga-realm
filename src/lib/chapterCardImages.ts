import type { ImageProxyTransformOptions } from './imageProxy';
import { Chapter, EntityMetadata } from './types';

export type ChapterCardImageMode = 'auto_first_page' | 'manual' | 'none';

export const DEFAULT_CHAPTER_CARD_IMAGE_MODE: ChapterCardImageMode = 'auto_first_page';
export const CHAPTER_CARD_ADMIN_LIST_IMAGE_TRANSFORM = Object.freeze({
  width: 128,
  quality: 38,
  format: 'webp',
  fit: 'cover',
} satisfies ImageProxyTransformOptions);
export const CHAPTER_CARD_ADMIN_DIALOG_IMAGE_TRANSFORM = Object.freeze({
  width: 240,
  quality: 46,
  format: 'webp',
  fit: 'cover',
} satisfies ImageProxyTransformOptions);

const CHAPTER_CARD_IMAGE_MODE_KEY = 'chapterCardImageMode';
const CHAPTER_CARD_MANUAL_PAGE_MAP_KEY = 'chapterCardManualPages';
const CHAPTER_CARD_IMAGE_URL_MAP_KEY = 'chapterCardImageUrls';

const normalizeRecord = (value: unknown): Record<string, unknown> => (
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
);

const normalizePageUrl = (value: unknown) => (
  typeof value === 'string' ? value.trim() : ''
);

const normalizePages = (pages?: string[] | null) => (
  Array.isArray(pages)
    ? pages
      .map((page) => normalizePageUrl(page))
      .filter(Boolean)
    : []
);

const normalizePositiveInteger = (value: unknown) => {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue) || numericValue < 1) {
    return undefined;
  }

  return Math.round(numericValue);
};

export const getChapterCardImageMode = (details?: EntityMetadata | null): ChapterCardImageMode => {
  const extra = normalizeRecord(details?.extra);
  const value = extra[CHAPTER_CARD_IMAGE_MODE_KEY];

  if (value === 'manual' || value === 'none' || value === 'auto_first_page') {
    return value;
  }

  return DEFAULT_CHAPTER_CARD_IMAGE_MODE;
};

export const getChapterCardListImageTransform = (options?: {
  isMobile?: boolean;
  lowEnd?: boolean;
}): ImageProxyTransformOptions => {
  const isMobile = options?.isMobile === true;
  const lowEnd = options?.lowEnd === true;

  return {
    width: isMobile ? 160 : 192,
    quality: lowEnd ? 36 : isMobile ? 40 : 44,
    format: 'webp',
    fit: 'cover',
  };
};

export const getChapterCardManualPageMap = (details?: EntityMetadata | null): Record<string, number> => {
  const extra = normalizeRecord(details?.extra);
  const rawMap = normalizeRecord(extra[CHAPTER_CARD_MANUAL_PAGE_MAP_KEY]);

  return Object.entries(rawMap).reduce<Record<string, number>>((map, [chapterId, page]) => {
    const normalizedPage = normalizePositiveInteger(page);
    if (!normalizedPage) {
      return map;
    }

    map[chapterId] = normalizedPage;
    return map;
  }, {});
};

export const getChapterCardImageUrlMap = (details?: EntityMetadata | null): Record<string, string> => {
  const extra = normalizeRecord(details?.extra);
  const rawMap = normalizeRecord(extra[CHAPTER_CARD_IMAGE_URL_MAP_KEY]);

  return Object.entries(rawMap).reduce<Record<string, string>>((map, [chapterId, url]) => {
    const normalizedUrl = normalizePageUrl(url);
    if (!normalizedUrl) {
      return map;
    }

    map[chapterId] = normalizedUrl;
    return map;
  }, {});
};

export const setChapterCardImageMode = (
  details: EntityMetadata | undefined,
  mode: ChapterCardImageMode,
): EntityMetadata => ({
  ...(details || {}),
  extra: {
    ...normalizeRecord(details?.extra),
    [CHAPTER_CARD_IMAGE_MODE_KEY]: mode,
  },
});

export const resolveChapterCardImageUrl = (
  chapter: Pick<Chapter, 'pages' | 'cardImageUrl' | 'cardImagePage'>,
  mode: ChapterCardImageMode,
  manualPageOverride?: number | null,
) => {
  if (mode === 'none') {
    return undefined;
  }

  const normalizedPages = normalizePages(chapter.pages);
  if (normalizedPages.length === 0) {
    return normalizePageUrl(chapter.cardImageUrl) || undefined;
  }

  if (mode === 'manual') {
    const manualPage = normalizePositiveInteger(manualPageOverride ?? chapter.cardImagePage);
    if (!manualPage) {
      return undefined;
    }

    return normalizedPages[manualPage - 1];
  }

  return normalizedPages[0];
};

export const hydrateChaptersWithCardImageState = (
  chapters: Chapter[],
  details?: EntityMetadata | null,
): Chapter[] => {
  const mode = getChapterCardImageMode(details);
  const manualPageMap = getChapterCardManualPageMap(details);
  const imageUrlMap = getChapterCardImageUrlMap(details);

  return chapters.map((chapter) => {
    const cardImagePage = manualPageMap[chapter.id] ?? chapter.cardImagePage;
    const cardImageUrl = imageUrlMap[chapter.id]
      || resolveChapterCardImageUrl(chapter, mode, cardImagePage);

    return {
      ...chapter,
      cardImagePage: cardImagePage ?? null,
      cardImageUrl,
    };
  });
};

export const buildChapterCardImageDetails = (
  details: EntityMetadata | undefined,
  chapters: Chapter[],
): EntityMetadata => {
  const mode = getChapterCardImageMode(details);
  const manualPageMap = chapters.reduce<Record<string, number>>((map, chapter) => {
    const normalizedPages = normalizePages(chapter.pages);
    const normalizedPage = normalizePositiveInteger(chapter.cardImagePage);

    if (!normalizedPage || normalizedPages.length === 0) {
      return map;
    }

    map[chapter.id] = Math.min(normalizedPage, normalizedPages.length);
    return map;
  }, {});

  const imageUrlMap = chapters.reduce<Record<string, string>>((map, chapter) => {
    const resolvedUrl = resolveChapterCardImageUrl(chapter, mode, manualPageMap[chapter.id]);
    if (!resolvedUrl) {
      return map;
    }

    map[chapter.id] = resolvedUrl;
    return map;
  }, {});

  return {
    ...(details || {}),
    extra: {
      ...normalizeRecord(details?.extra),
      [CHAPTER_CARD_IMAGE_MODE_KEY]: mode,
      [CHAPTER_CARD_MANUAL_PAGE_MAP_KEY]: manualPageMap,
      [CHAPTER_CARD_IMAGE_URL_MAP_KEY]: imageUrlMap,
    },
  };
};
