import type { ImageProxyTransformOptions } from './imageProxy';
import { Chapter, EntityMetadata } from './types';

export type ChapterCardImageMode = 'auto_first_page' | 'auto_random' | 'manual' | 'none';

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

  if (value === 'manual' || value === 'none' || value === 'auto_first_page' || value === 'auto_random') {
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

const chapterRandomIndexCache = new Map<string, number>();

export const clearChapterCardRandomCache = () => {
  chapterRandomIndexCache.clear();
};

const getRandomIndex = (count: number, seedKey?: string): number => {
  if (count <= 1) return 0;
  if (seedKey && chapterRandomIndexCache.has(seedKey)) {
    return chapterRandomIndexCache.get(seedKey)! % count;
  }
  const idx = Math.floor(Math.random() * count);
  if (seedKey) {
    chapterRandomIndexCache.set(seedKey, idx);
  }
  return idx;
};

/**
 * Seri sayfasındaki bölüm kartı görselini belirler:
 * - İlk (0) ve son (N - 1) sayfa ASLA seçilmez.
 * - Eğer 1 görsel varsa: mecburen o tek görsel kullanılır.
 * - Eğer 2 görsel varsa: 2 görsel arasından rastgele biri seçilir.
 * - Eğer 2'den fazla (>2) görsel varsa: ilk ve son hariç adaylar arasından rastgele biri seçilir.
 */
export const pickRandomChapterPage = (
  pages: string[],
  seedKey?: string,
): string | undefined => {
  const count = pages.length;
  if (count === 0) {
    return undefined;
  }

  // 1 görsel varsa mecburen ilk görsel
  if (count === 1) {
    return pages[0];
  }

  // 2 görsel varsa rastgele biri
  if (count === 2) {
    const selectedIndex = getRandomIndex(2, seedKey);
    return pages[selectedIndex];
  }

  // > 2 görsel: İlk (index 0) ve son (index count - 1) sayfa ASLA gösterilmez.
  // Aday sayısı: count - 2. Seçilen index: 1 + offset.
  const candidateCount = count - 2;
  const offset = getRandomIndex(candidateCount, seedKey);
  const selectedIndex = 1 + offset;
  return pages[selectedIndex];
};

export const resolveChapterCardImageUrl = (
  chapter: Pick<Chapter, 'pages' | 'cardImageUrl' | 'cardImagePage'> & { id?: string },
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
    if (!manualPage || manualPage < 1 || manualPage > normalizedPages.length) {
      return undefined;
    }

    return normalizedPages[manualPage - 1];
  }

  return pickRandomChapterPage(normalizedPages, chapter.id);
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
    const cardImageUrl = (mode === 'manual' ? imageUrlMap[chapter.id] : undefined)
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
