import {
  extractScrapedMangaDetail,
  normalizeScrapeUrl,
  normalizeScrapeSeriesUrl,
  type ScrapedChapter,
  type ScrapedChapterImageResult,
  type ScrapedMangaCard,
  type ScrapedMangaDraft,
} from '@/lib/scraper/scrapeSources';
import { syncAdultContentGenres } from '@/lib/adultContentFormat';
import { normalizeAdultMangaType } from '@/lib/mangaType';
import { filterRecognizedGenres } from '@/lib/mockData';

const SIYAHMELEK_CAPTURE_SOURCE = 'siyahmelek' as const;
const SIYAHMELEK_CAPTURE_KIND = 'browser_capture' as const;
const SIYAHMELEK_CAPTURE_VERSION = 2 as const;

type MangaStatus = NonNullable<ScrapedMangaDraft['status']>;
type MangaType = NonNullable<ScrapedMangaDraft['type']>;

export interface SiyahMelekBrowserCapturedManga {
  title: string;
  alternativeTitles?: string[];
  description: string;
  cover: string;
  banner?: string;
  author: string;
  artist?: string;
  status: MangaStatus;
  type: MangaType;
  genres: string[];
  releaseYear?: number;
  isAdult: true;
}

export interface SiyahMelekBrowserCapturedChapter extends ScrapedChapter {
  prefetchedImageResult?: ScrapedChapterImageResult;
}

export interface SiyahMelekBrowserMetadataCapturePayload {
  source: typeof SIYAHMELEK_CAPTURE_SOURCE;
  kind: typeof SIYAHMELEK_CAPTURE_KIND;
  version: typeof SIYAHMELEK_CAPTURE_VERSION;
  mode: 'metadata';
  mangaUrl: string;
  manga: SiyahMelekBrowserCapturedManga;
  chapters: SiyahMelekBrowserCapturedChapter[];
  capturedAt: string;
}

export interface SiyahMelekBrowserChapterImageCapturePayload {
  source: typeof SIYAHMELEK_CAPTURE_SOURCE;
  kind: typeof SIYAHMELEK_CAPTURE_KIND;
  version: typeof SIYAHMELEK_CAPTURE_VERSION;
  mode: 'chapter_images';
  mangaUrl: string;
  chapters: SiyahMelekBrowserCapturedChapter[];
  capturedAt: string;
}

interface SiyahMelekLegacyBrowserCapturePayload {
  source: typeof SIYAHMELEK_CAPTURE_SOURCE;
  kind: typeof SIYAHMELEK_CAPTURE_KIND;
  version: 1;
  mangaUrl: string;
  mangaHtml: string;
  chapters: Array<ScrapedChapter & { prefetchedImageResult: ScrapedChapterImageResult }>;
  capturedAt: string;
}

export type SiyahMelekBrowserCapturePayload =
  | SiyahMelekBrowserMetadataCapturePayload
  | SiyahMelekBrowserChapterImageCapturePayload
  | SiyahMelekLegacyBrowserCapturePayload;

const normalizeText = (value?: string | null) =>
  value?.replace(/\s+/g, ' ').trim() || '';

const stripMarkdownFence = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed.startsWith('```')) {
    return trimmed;
  }

  return trimmed
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/i, '')
    .trim();
};

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const CHAPTER_SHORTCUT_PATTERNS = [
  /^ba[şs]tan$/i,
  /^ba[şs]tan oku$/i,
  /^okumaya ba[şs]la$/i,
  /^ilk b[öo]l[üu]m$/i,
  /^chapter start$/i,
  /^start reading$/i,
] as const;

const formatChapterNumber = (value?: number) => {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return '';
  }

  return Number.isInteger(value) ? String(value) : String(value);
};

const toSimpleChapterLabel = (number?: number) => (
  typeof number === 'number' && number > 0
    ? `Bölüm ${formatChapterNumber(number)}`
    : ''
);

const sanitizeCapturedChapterName = (
  value?: string | null,
  number?: number,
  seriesTitle?: string | null,
) => {
  const simpleLabel = toSimpleChapterLabel(number);
  if (simpleLabel) {
    return simpleLabel;
  }

  let nextValue = normalizeText(value);

  if (!nextValue) {
    return typeof number === 'number' && number > 0 ? `Bölüm ${formatChapterNumber(number)}`.trim() : '';
  }

  if (seriesTitle) {
    const seriesPattern = new RegExp(`^${escapeRegExp(normalizeText(seriesTitle))}\\s*[-–—:|]?\\s*`, 'i');
    nextValue = nextValue.replace(seriesPattern, '').trim();
  }

  nextValue = nextValue.replace(/^[-–—:|]+/, '').trim();
  nextValue = nextValue.replace(
    /\s+\d+\s*(?:dakika|saat|g[üu]n|hafta|ay|y[ıi]l)(?:\s+\d+(?:[.,]\d+)?\s*[kmb])?(?:\s+\d+)?$/iu,
    '',
  ).trim();
  nextValue = nextValue.replace(/\s+\d+(?:[.,]\d+)?\s*[kmb]\s+\d+$/iu, '').trim();

  const chapterMarker = nextValue.match(
    /(b[öo]l[üu]m\s*\d+(?:\.\d+)?(?:\s*[-–—:]\s*[^]+)?)$/iu,
  );

  if (chapterMarker?.[1]) {
    nextValue = chapterMarker[1].trim();
  }

  const normalizedChapterMatch = nextValue.match(/(b[öo]l[üu]m\s*\d+(?:\.\d+)?)/iu);
  if (normalizedChapterMatch?.[1]) {
    const chapterLabel = normalizedChapterMatch[1].replace(/\s+/g, ' ').trim();
    const trailingValue = nextValue
      .slice(nextValue.toLocaleLowerCase('tr-TR').indexOf(normalizedChapterMatch[1].toLocaleLowerCase('tr-TR')) + normalizedChapterMatch[1].length)
      .trim();

    if (
      !trailingValue
      || /^(?:\d+(?:[.,]\d+)?\s*[kmb]?[\s]*)+(?:buradas[ıi]n[ıi]z)?$/iu.test(trailingValue)
    ) {
      return chapterLabel;
    }
  }

  if (!nextValue || normalizeText(nextValue).length < 2) {
    return typeof number === 'number' && number > 0 ? `Bölüm ${formatChapterNumber(number)}`.trim() : '';
  }

  if (CHAPTER_SHORTCUT_PATTERNS.some((pattern) => pattern.test(nextValue))) {
    return '';
  }

  if (!/b[öo]l[üu]m/i.test(nextValue) && typeof number === 'number' && number > 0) {
    return `Bölüm ${formatChapterNumber(number)}`;
  }

  return nextValue;
};

const isScrapedChapterImageResult = (value: unknown): value is ScrapedChapterImageResult => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const candidate = value as Partial<ScrapedChapterImageResult>;
  return (
    typeof candidate.status === 'string'
    && Array.isArray(candidate.images)
    && candidate.images.every((image) => typeof image === 'string')
  );
};

const isCapturedChapter = (value: unknown): value is SiyahMelekBrowserCapturedChapter => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const candidate = value as Partial<SiyahMelekBrowserCapturedChapter>;
  return (
    typeof candidate.name === 'string'
    && typeof candidate.link === 'string'
    && typeof candidate.number === 'number'
    && (candidate.prefetchedImageResult === undefined || isScrapedChapterImageResult(candidate.prefetchedImageResult))
  );
};

const isCapturedManga = (value: unknown): value is SiyahMelekBrowserCapturedManga => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const candidate = value as Partial<SiyahMelekBrowserCapturedManga>;
  return (
    typeof candidate.title === 'string'
    && typeof candidate.description === 'string'
    && typeof candidate.cover === 'string'
    && typeof candidate.author === 'string'
    && typeof candidate.status === 'string'
    && typeof candidate.type === 'string'
    && Array.isArray(candidate.genres)
    && candidate.genres.every((genre) => typeof genre === 'string')
    && candidate.isAdult === true
  );
};

const isLegacyPayload = (
  value: unknown,
): value is SiyahMelekLegacyBrowserCapturePayload => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const candidate = value as Partial<SiyahMelekLegacyBrowserCapturePayload>;
  return (
    candidate.source === SIYAHMELEK_CAPTURE_SOURCE
    && candidate.kind === SIYAHMELEK_CAPTURE_KIND
    && candidate.version === 1
    && typeof candidate.mangaUrl === 'string'
    && typeof candidate.mangaHtml === 'string'
    && Array.isArray(candidate.chapters)
    && candidate.chapters.every((chapter) => isCapturedChapter(chapter) && isScrapedChapterImageResult(chapter.prefetchedImageResult))
    && typeof candidate.capturedAt === 'string'
  );
};

export const isSiyahMelekMetadataCapturePayload = (
  value: unknown,
): value is SiyahMelekBrowserMetadataCapturePayload => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const candidate = value as Partial<SiyahMelekBrowserMetadataCapturePayload>;
  return (
    candidate.source === SIYAHMELEK_CAPTURE_SOURCE
    && candidate.kind === SIYAHMELEK_CAPTURE_KIND
    && candidate.version === SIYAHMELEK_CAPTURE_VERSION
    && candidate.mode === 'metadata'
    && typeof candidate.mangaUrl === 'string'
    && isCapturedManga(candidate.manga)
    && Array.isArray(candidate.chapters)
    && candidate.chapters.every(isCapturedChapter)
    && typeof candidate.capturedAt === 'string'
  );
};

export const isSiyahMelekChapterImageCapturePayload = (
  value: unknown,
): value is SiyahMelekBrowserChapterImageCapturePayload => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const candidate = value as Partial<SiyahMelekBrowserChapterImageCapturePayload>;
  return (
    candidate.source === SIYAHMELEK_CAPTURE_SOURCE
    && candidate.kind === SIYAHMELEK_CAPTURE_KIND
    && candidate.version === SIYAHMELEK_CAPTURE_VERSION
    && candidate.mode === 'chapter_images'
    && typeof candidate.mangaUrl === 'string'
    && Array.isArray(candidate.chapters)
    && candidate.chapters.every((chapter) => isCapturedChapter(chapter) && isScrapedChapterImageResult(chapter.prefetchedImageResult))
    && typeof candidate.capturedAt === 'string'
  );
};

export const parseSiyahMelekBrowserCapture = (
  rawValue: string,
): SiyahMelekBrowserCapturePayload | null => {
  const normalizedValue = stripMarkdownFence(rawValue);
  if (!normalizedValue) {
    return null;
  }

  try {
    const parsed = JSON.parse(normalizedValue);

    if (isSiyahMelekMetadataCapturePayload(parsed)) {
      return parsed;
    }

    if (isSiyahMelekChapterImageCapturePayload(parsed)) {
      return parsed;
    }

    if (isLegacyPayload(parsed)) {
      return parsed;
    }

    return null;
  } catch {
    return null;
  }
};

const buildFallbackCardFromDocument = (doc: Document, mangaUrl: string): ScrapedMangaCard => {
  const title = normalizeText(
    doc.querySelector('meta[property="og:title"]')?.getAttribute('content')
    || doc.querySelector('h1')?.textContent
    || doc.title,
  );
  const cover = normalizeScrapeUrl(
    SIYAHMELEK_CAPTURE_SOURCE,
    doc.querySelector('meta[property="og:image"]')?.getAttribute('content'),
  );

  return {
    title,
    link: normalizeScrapeSeriesUrl(SIYAHMELEK_CAPTURE_SOURCE, mangaUrl),
    cover,
    genres: [],
  };
};

const normalizeCapturedChapters = (
  chapters: SiyahMelekBrowserCapturedChapter[],
  seriesTitle?: string | null,
) => chapters
  .map((chapter) => ({
    name: sanitizeCapturedChapterName(chapter.name, Number(chapter.number), seriesTitle),
    link: normalizeScrapeUrl(SIYAHMELEK_CAPTURE_SOURCE, chapter.link),
    number: Number(chapter.number),
    prefetchedImageResult: chapter.prefetchedImageResult
      ? {
        status: chapter.prefetchedImageResult.status,
        images: chapter.prefetchedImageResult.images.map((image) => normalizeText(image)).filter(Boolean),
        reason: normalizeText(chapter.prefetchedImageResult.reason) || undefined,
      }
      : undefined,
  }))
  .filter((chapter) => Boolean(chapter.name));

const normalizeCapturedGenres = (
  genres: readonly string[] | null | undefined,
  type: MangaType,
) => syncAdultContentGenres(filterRecognizedGenres((genres || []).map((genre) => normalizeText(genre)).filter(Boolean)), {
  isAdult: true,
  type,
});

export const mergeSiyahMelekBrowserCapturedChapterResults = (
  baseChapters: ScrapedChapter[],
  capturedChapters: SiyahMelekBrowserCapturedChapter[],
  seriesTitle?: string | null,
) => {
  const chapterResultsByLink = new Map(
    normalizeCapturedChapters(capturedChapters, seriesTitle).map((chapter) => [chapter.link, chapter]),
  );

  return baseChapters.map((chapter) => {
    const normalizedLink = normalizeScrapeUrl(SIYAHMELEK_CAPTURE_SOURCE, chapter.link);
    const merged = chapterResultsByLink.get(normalizedLink);
    if (!merged) {
      return chapter;
    }

    return {
      ...chapter,
      name: merged.name || chapter.name,
      prefetchedImageResult: merged.prefetchedImageResult ?? chapter.prefetchedImageResult,
    };
  });
};

export const buildSiyahMelekDraftFromBrowserCapture = (
  payload: SiyahMelekBrowserCapturePayload,
): ScrapedMangaDraft => {
  if (isLegacyPayload(payload)) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(payload.mangaHtml, 'text/html');
    const fallbackCard = buildFallbackCardFromDocument(doc, payload.mangaUrl);
    const extracted = extractScrapedMangaDetail(doc, SIYAHMELEK_CAPTURE_SOURCE, fallbackCard);

    return {
      ...extracted,
      cover: extracted.cover || fallbackCard.cover,
      banner: extracted.banner || extracted.cover || fallbackCard.cover,
      genres: normalizeCapturedGenres(extracted.genres || [], extracted.type),
      isAdult: true,
      _rawChapters: normalizeCapturedChapters(payload.chapters, extracted.title),
    };
  }

  if (payload.mode !== 'metadata') {
    throw new Error('Bu payload seri metadata içermiyor.');
  }

  const manga = payload.manga;

  return {
    title: normalizeText(manga.title),
    alternativeTitles: (manga.alternativeTitles || []).map((title) => normalizeText(title)).filter(Boolean),
    description: normalizeText(manga.description),
    cover: normalizeScrapeUrl(SIYAHMELEK_CAPTURE_SOURCE, manga.cover),
    banner: normalizeScrapeUrl(SIYAHMELEK_CAPTURE_SOURCE, manga.banner || manga.cover),
    author: normalizeText(manga.author),
    artist: normalizeText(manga.artist) || undefined,
    status: manga.status,
    type: manga.type,
    genres: normalizeCapturedGenres(manga.genres || [], manga.type),
    isAdult: true,
    releaseYear: manga.releaseYear,
    chapters: [],
    views: 0,
    ratings: [],
    _rawChapters: normalizeCapturedChapters(payload.chapters, manga.title),
  };
};

const buildMetadataScript = () => String.raw`(async () => {
  const baseUrl = 'https://siyahmelek.mom';
  const currentUrl = new URL(window.location.href);
  const wait = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));
  const normalizeText = (value) => String(value || '').replace(/\s+/g, ' ').trim();
  const normalizeUrl = (value) => {
    const href = normalizeText(value);
    if (!href) return '';
    try {
      return new URL(href, baseUrl).href;
    } catch {
      return href;
    }
  };
  const dedupe = (items) => Array.from(new Set(items.map((item) => normalizeText(item)).filter(Boolean)));
  const formatNumber = (value) => Number.isInteger(value) ? String(value) : String(value);
  const escapeRegExp = (value) => value.replace(/[.*+?^$()|[\]\\]/g, '\\$&');
  const chapterShortcutPatterns = [/^ba[şs]tan$/i, /^ba[şs]tan oku$/i, /^okumaya ba[şs]la$/i, /^ilk b[öo]l[üu]m$/i, /^chapter start$/i, /^start reading$/i];
  const sanitizeChapterName = (value, number, seriesTitle) => {
    let nextValue = normalizeText(value);

    if (!nextValue) {
      return typeof number === 'number' && number > 0 ? ('Bölüm ' + formatNumber(number)).trim() : '';
    }

    if (seriesTitle) {
      const seriesPattern = new RegExp('^' + escapeRegExp(normalizeText(seriesTitle)) + '\\s*[-–—:|]?\\s*', 'i');
      nextValue = nextValue.replace(seriesPattern, '').trim();
    }

    nextValue = nextValue.replace(/^[-–—:|]+/, '').trim();
    nextValue = nextValue.replace(/\s+\d+\s*(?:dakika|saat|g[öo]n|g[üu]n|hafta|ay|y[ıi]l)(?:\s+\d+(?:[.,]\d+)?\s*[kmb])?(?:\s+\d+)?$/iu, '').trim();
    nextValue = nextValue.replace(/\s+\d+(?:[.,]\d+)?\s*[kmb]\s+\d+$/iu, '').trim();

    const chapterMarker = nextValue.match(/(b[öo]l[üu]m\s*\d+(?:\.\d+)?(?:\s*[-–—:]\s*.+)?)$/iu);
    if (chapterMarker && chapterMarker[1]) {
      nextValue = chapterMarker[1].trim();
    }

    const normalizedChapterMatch = nextValue.match(/(b[öo]l[üu]m\s*\d+(?:\.\d+)?)/iu);
    if (normalizedChapterMatch && normalizedChapterMatch[1]) {
      const chapterLabel = normalizedChapterMatch[1].replace(/\s+/g, ' ').trim();
      const trailingValue = nextValue
        .slice(nextValue.toLocaleLowerCase('tr-TR').indexOf(normalizedChapterMatch[1].toLocaleLowerCase('tr-TR')) + normalizedChapterMatch[1].length)
        .trim();

      if (!trailingValue || /^(?:\d+(?:[.,]\d+)?\s*[kmb]?[\s]*)+(?:buradas[ıi]n[ıi]z)?$/iu.test(trailingValue)) {
        return chapterLabel;
      }
    }

    if (!nextValue) {
      return typeof number === 'number' && number > 0 ? ('Bölüm ' + formatNumber(number)).trim() : '';
    }

    if (chapterShortcutPatterns.some((pattern) => pattern.test(nextValue))) {
      return '';
    }

    if (!/b[öo]l[üu]m/i.test(nextValue) && typeof number === 'number' && number > 0) {
      return 'Bölüm ' + formatNumber(number);
    }

    return nextValue;
  };
  const chapterSelectors = [
    '.wp-manga-chapter',
    '.listing-chapters_wrap li',
    '.page-content-listing li',
    '.version-chap li',
    '.main.version-chap li',
    '.chapter-link',
    'a[href*="/bolum-"]',
  ];
  const chapterTextRemovalSelectors = [
    '.chapter-release-date',
    '.chapter-date',
    '.chapter-time',
    '.chapter-view',
    '.chapter-views',
    '.chapter-comment',
    '.chapter-comments',
    '.chapter-meta',
    '.chapter-metadata',
    '.post-on',
    '.views',
    '.comments',
    '.meta',
    'i',
    'svg',
    'time',
  ];
  const paginationSelectors = [
    '.wp-pagenavi a',
    '.wp-pagenavi span',
    '.pagination a',
    '.pagination span',
    '.page-numbers a',
    'a.page-numbers',
    '.page-numbers',
  ];
  const summaryItemSelectors = '.post-content_item';
  const buildSeriesPath = (value) => normalizeText(value)
    .replace(/\/$/, '')
    .replace(/\/bolum\/page\/\d+$/i, '')
    .replace(/\/bolum$/i, '')
    .replace(/\/bolum-[^/]+$/i, '');
  const currentSeriesPath = buildSeriesPath(currentUrl.pathname);
  const currentChapterListPath = currentSeriesPath + '/bolum';
  const getSummaryField = (labels) => {
    const normalizedLabels = labels.map((label) => label.toLocaleLowerCase('tr-TR'));
    const matchedItem = Array.from(document.querySelectorAll(summaryItemSelectors)).find((element) => {
      const text = (element.textContent || '').toLocaleLowerCase('tr-TR');
      return normalizedLabels.some((label) => text.includes(label));
    });

    if (!matchedItem) {
      return '';
    }

    return normalizeText(
      matchedItem.querySelector('.summary-content, .author-content a, .artist-content a, .genres-content a')?.textContent
      || matchedItem.querySelector('.summary-content')?.textContent
      || matchedItem.textContent,
    );
  };
  const getMeta = (selector, attr) => normalizeText(document.querySelector(selector)?.getAttribute(attr));
  const getDetailTitle = () => {
    const titleElement = document.querySelector('.post-title h1, .post-title .entry-title, .post-title');
    if (!titleElement) {
      return normalizeText(getMeta('meta[property="og:title"]', 'content')).replace(/\s*-\s*Siyah.*$/i, '');
    }

    const cloned = titleElement.cloneNode(true);
    if (cloned.querySelectorAll) {
      cloned.querySelectorAll(
        '.manga-title-badges, .post-title-badges, .hot, .new, .status, .badge, .label, [class*="badge"], [class*="status"]',
      ).forEach((node) => node.remove());
    }

    return normalizeText(cloned.textContent || titleElement.textContent).replace(/\s*-\s*Siyah.*$/i, '');
  };
  const getDescription = () => {
    const paragraphValue = normalizeText(
      Array.from(document.querySelectorAll([
        '.description-summary .summary__content.show-more p',
        '.description-summary .summary__content p',
        '.summary__content.show-more p',
        '.summary__content p',
      ].join(', ')))
        .map((element) => normalizeText(element.textContent))
        .filter(Boolean)
        .join(' '),
    );

    if (paragraphValue) {
      return paragraphValue;
    }

    const value = normalizeText(
      document.querySelector([
        '.description-summary .summary__content.show-more',
        '.description-summary .summary__content',
        '.summary__content.show-more',
        '.summary__content',
        '.manga-excerpt',
      ].join(', '))?.textContent
      || getMeta('meta[property="og:description"]', 'content')
      || getMeta('meta[name="description"]', 'content'),
    );

    return value.replace(/\s*-\s*Hentai oku.*$/i, '');
  };
  const inferStatus = () => {
    const statusText = getSummaryField(['durum', 'status']);
    const normalized = statusText.toLocaleLowerCase('tr-TR');
    if (!normalized) return 'ongoing';
    if (normalized.includes('ara') || normalized.includes('hiatus')) return 'hiatus';
    if (normalized.includes('tamam') || normalized.includes('completed') || normalized.includes('final')) return 'completed';
    return 'ongoing';
  };
  const inferType = (genres) => {
    const source = [
      getSummaryField(['tip', 'type']),
      getSummaryField(['alternatif']),
      getSummaryField(['kategori', 'categories']),
      genres.join(', '),
    ].join(' ').toLocaleLowerCase('tr-TR');
    if (source.includes('manhwa')) return 'manhwa';
    if (source.includes('manhua')) return 'manhua';
    if (source.includes('webtoon')) return 'webtoon';
    return 'manga';
  };
  const syncAdultGenres = (genres, type) => {
    const cleaned = genres.filter((genre) => !['Yetişkin', 'Hentai', 'Webtoon Hentai'].includes(genre));
    return dedupe([
      ...cleaned,
      'Yetişkin',
      type === 'webtoon' || type === 'manhwa' || type === 'webtoon_hentai' || cleaned.includes('Webtoon') || cleaned.includes('Manhwa') ? 'Webtoon Hentai' : 'Hentai',
    ]);
  };
  const getAlternativeTitles = (mainTitle) => {
    const raw = getSummaryField(['diğer ad', 'alt isim', 'alternatif']);
    if (!raw) return [];
    const mainKey = normalizeText(mainTitle).toLocaleLowerCase('tr-TR');
    return dedupe(
      raw.split(/[,\n;]/)
        .map((title) => normalizeText(title))
        .filter((title) => {
          const key = title.toLocaleLowerCase('tr-TR');
          return key && key !== mainKey && !/g(?:ü|u)ncellenecek/i.test(key);
        }),
    );
  };
  const getGenres = () => {
    const values = Array.from(document.querySelectorAll([
      '.genres-content a',
      '.post-content_item .summary-content a',
      '.summary-content a[href*="/webtoon-tur/"]',
      '.summary-content a[href*="/manga-genre/"]',
      '.summary-content a[href*="/manga-tag/"]',
      '.post-content_item.mg_genres a',
      '.tagcloud a',
    ].join(', ')))
      .map((element) => normalizeText(element.textContent))
      .filter(Boolean);
    return dedupe(values);
  };
  const getReleaseYear = () => {
    const yearText = getSummaryField(['yıl', 'salınış', 'yayın', 'release']);
    const match = yearText.match(/\d{4}/);
    return match ? Number(match[0]) : undefined;
  };
  const buildCaptureFileName = (mode) => {
    const slug = currentSeriesPath.split('/').filter(Boolean).pop() || 'series';
    return 'toonparrot-siyahmelek-' + slug + '-' + mode + '.json';
  };
  const downloadCaptureFile = (serialized, mode) => {
    const blob = new Blob([serialized], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = buildCaptureFileName(mode);
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  };
  const extractChapterLinksFromDoc = (doc, seriesTitle, chapterMap) => {
    const containers = Array.from(doc.querySelectorAll(chapterSelectors.join(', ')));
    for (const container of containers) {
      const anchor = container.tagName === 'A' ? container : container.querySelector('a[href*="/bolum-"]');
      if (!anchor) continue;

      const link = normalizeUrl(anchor.href || anchor.getAttribute('href'));
      if (!link) continue;

      let parsedUrl;
      try {
        parsedUrl = new URL(link);
      } catch {
        continue;
      }

      if (!parsedUrl.pathname.includes('/bolum-')) continue;
      if (currentSeriesPath && !parsedUrl.pathname.startsWith(currentSeriesPath + '/')) continue;

      const clonedAnchor = anchor.cloneNode(true);
      if (clonedAnchor.querySelectorAll) {
        clonedAnchor.querySelectorAll(chapterTextRemovalSelectors.join(', ')).forEach((node) => node.remove());
      }
      const clonedContainer = container.cloneNode(true);
      if (clonedContainer.querySelectorAll) {
        clonedContainer.querySelectorAll(chapterTextRemovalSelectors.join(', ')).forEach((node) => node.remove());
      }

      const rawText = normalizeText(
        anchor.getAttribute('title')
        || anchor.querySelector?.('.chapter-manhwa-title, .chapter-title, .chapternum, .chapter-name')?.textContent
        || clonedAnchor.textContent
        || container.querySelector?.('.chapter-manhwa-title, .chapter-title, .chapternum, .chapter-name')?.textContent
        || clonedContainer.textContent,
      );
      const numberMatch = (rawText + ' ' + link).match(/(\d+(?:\.\d+)?)/);
      const number = numberMatch ? Number(numberMatch[1]) : 0;
      const name = toSimpleChapterLabel(number) || sanitizeChapterName(rawText, number, seriesTitle);
      if (!name) continue;

      chapterMap.set(link, {
        name,
        link,
        number,
      });
    }
  };
  const extractPaginationUrlsFromDoc = (doc) => {
    const urls = new Set([currentUrl.origin + currentSeriesPath + '/']);
    let maxPage = 1;
    for (const element of Array.from(doc.querySelectorAll(paginationSelectors.join(', ')))) {
      const pageLabel = normalizeText(element.textContent);
      if (/^\d+$/.test(pageLabel)) {
        maxPage = Math.max(maxPage, Number(pageLabel));
      }

      const href = normalizeUrl(element.href || element.getAttribute?.('href'));
      if (!href) continue;
      try {
        const parsedUrl = new URL(href);
        const sameSeries = !currentSeriesPath || parsedUrl.pathname.startsWith(currentSeriesPath);
        const looksLikePageLink = /\/bolum\/page\/\d+\/?$/i.test(parsedUrl.pathname)
          || /\/page\/\d+\/?$/i.test(parsedUrl.pathname)
          || parsedUrl.searchParams.has('page')
          || /^\d+$/.test(pageLabel);

        if (sameSeries && looksLikePageLink) {
          urls.add(parsedUrl.href);
        }
      } catch {}
    }

    if (maxPage > 1) {
      for (let pageNumber = 2; pageNumber <= maxPage; pageNumber += 1) {
        urls.add(currentUrl.origin + currentChapterListPath + '/page/' + pageNumber + '/#chapter-list');
      }
    }

    return Array.from(urls);
  };
  const loadDocumentInFrame = (frame, url) => new Promise((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      cleanup();
      reject(new Error('Sayfa zaman aşımına uğradı: ' + url));
    }, 20000);
    const cleanup = () => {
      frame.removeEventListener('load', onLoad);
      window.clearTimeout(timeoutId);
    };
    const onLoad = () => {
      try {
        const loadedDoc = frame.contentDocument;
        if (!loadedDoc) {
          throw new Error('Yüklenen sayfa okunamadı');
        }
        cleanup();
        resolve(loadedDoc);
      } catch (error) {
        cleanup();
        reject(error);
      }
    };
    frame.addEventListener('load', onLoad, { once: true });
    frame.src = url;
  });

  if (currentUrl.hostname !== 'siyahmelek.mom' || !currentUrl.pathname.includes('/manga/')) {
    throw new Error('Bu scripti SiyahMelek seri sayfasında çalıştır.');
  }

  const title = getDetailTitle();
  const genres = getGenres();
  const chapterLinkMap = new Map();
  extractChapterLinksFromDoc(document, title, chapterLinkMap);
  const paginationUrls = extractPaginationUrlsFromDoc(document).filter((pageUrl) => pageUrl !== window.location.href);
  if (paginationUrls.length > 0) {
    const iframe = document.createElement('iframe');
    iframe.setAttribute('aria-hidden', 'true');
    iframe.style.position = 'fixed';
    iframe.style.width = '1px';
    iframe.style.height = '1px';
    iframe.style.opacity = '0';
    iframe.style.pointerEvents = 'none';
    iframe.style.bottom = '0';
    iframe.style.right = '0';
    document.body.appendChild(iframe);

    try {
      for (const pageUrl of paginationUrls) {
        try {
          const pageDoc = await loadDocumentInFrame(iframe, pageUrl);
          extractChapterLinksFromDoc(pageDoc, title, chapterLinkMap);
        } catch (error) {
          console.warn('[ToonParrot] Bölüm sayfası iframe ile alınamadı', pageUrl, error);
        }
        await wait(180);
      }
    } finally {
      iframe.remove();
    }
  }

  const chapters = Array.from(chapterLinkMap.values()).sort((left, right) => left.number - right.number);

  const inferredType = normalizeAdultMangaType(inferType(genres), genres, true);
  const payload = {
    source: 'siyahmelek',
    kind: 'browser_capture',
    version: 2,
    mode: 'metadata',
    mangaUrl: window.location.href,
    manga: {
      title,
      alternativeTitles: getAlternativeTitles(title),
      description: getDescription(),
      cover: normalizeUrl(
        document.querySelector('.summary_image img, .summary-image img, .post-thumbnail img')?.getAttribute('data-src')
        || document.querySelector('.summary_image img, .summary-image img, .post-thumbnail img')?.getAttribute('data-lazy-src')
        || document.querySelector('.summary_image img, .summary-image img, .post-thumbnail img')?.getAttribute('src')
        || getMeta('meta[property="og:image"]', 'content'),
      ),
      banner: normalizeUrl(getMeta('meta[property="og:image"]', 'content')),
      author: getSummaryField(['yazar', 'author', 'yazarlar', 'yazar(lar)']),
      artist: getSummaryField(['çizer', 'artist', 'çizerler', 'çizer(ler)']) || undefined,
      status: inferStatus(),
      type: inferredType,
      genres: syncAdultGenres(genres, inferredType),
      releaseYear: getReleaseYear(),
      isAdult: true,
    },
    chapters,
    capturedAt: new Date().toISOString(),
  };

  const serialized = JSON.stringify(payload);

  try {
    await navigator.clipboard.writeText(serialized);
    downloadCaptureFile(serialized, 'metadata');
    alert('ToonParrot: Seri bilgileri panoya kopyalandı. Admin paneline dönüp yapıştır.');
  } catch {
    downloadCaptureFile(serialized, 'metadata');
    alert('ToonParrot: Capture dosyası indirildi. Admin panelinde "Capture Dosyası" ile yükle.');
  }
})();`;

const buildChapterImageScript = (chapters: Pick<ScrapedChapter, 'name' | 'link' | 'number'>[]) => `\
(async () => {
  const baseUrl = 'https://siyahmelek.mom';
  const currentUrl = new URL(window.location.href);
  const normalizeText = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
  const normalizeUrl = (value) => {
    const href = normalizeText(value);
    if (!href) return '';
    try {
      return new URL(href, baseUrl).href;
    } catch {
      return href;
    }
  };
  const sanitizeImageUrls = (images) => Array.from(
    new Set(
      images
        .map((image) => normalizeText(image))
        .map((image) => image.startsWith('//') ? 'https:' + image : image)
        .filter((image) => /^https?:\\/\\//i.test(image) && !image.includes('base64'))
    )
  );
  const buildCaptureFileName = () => {
    const seriesPath = normalizeText(currentUrl.pathname)
      .replace(/\/$/, '')
      .replace(/\/bolum-[^/]+$/i, '');
    const slug = seriesPath.split('/').filter(Boolean).pop() || 'series';
    return 'toonparrot-siyahmelek-' + slug + '-chapter-images.json';
  };
  const downloadCaptureFile = (serialized) => {
    const blob = new Blob([serialized], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = buildCaptureFileName();
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  };
  const lockedPatterns = [
    /kilitli b[öo]l[üu]m/i,
    /vip [üu]yeler bu b[öo]l[üu]m[üu]/i,
    /erken okuyabilir/i,
  ];
  const extractImagesFromDoc = (doc) => {
    let images = Array.from(
      doc.querySelectorAll('.reading-content img, .wp-manga-chapter-img, .page-break img, .entry-content img')
    )
      .map((img) => normalizeText(
        img.getAttribute('data-src')
          || img.getAttribute('data-lazy-src')
          || img.getAttribute('data-cdn')
          || img.getAttribute('src')
      ))
      .filter(Boolean);

    if (images.length === 0) {
      for (const script of Array.from(doc.querySelectorAll('script'))) {
        const content = script.textContent || '';
        if (!content.includes('chapter_data')) continue;
        try {
          const match = content.match(/chapter_data\\s*=\\s*({[\\s\\S]*?});/);
          if (!match) continue;
          const payload = JSON.parse(match[1]);
          if (payload && Array.isArray(payload.images)) {
            images = payload.images
              .map((image) => typeof image?.src === 'string' ? image.src.trim() : '')
              .filter(Boolean);
            break;
          }
        } catch (error) {
          console.warn('[ToonParrot] chapter_data parse failed', error);
        }
      }
    }

    return sanitizeImageUrls(images);
  };
  const hasLockedMarkers = (doc) => {
    const text = normalizeText(doc.body?.textContent || '');
    return lockedPatterns.some((pattern) => pattern.test(text));
  };
  const selectedChapters = ${JSON.stringify(
    chapters.map((chapter) => ({
      name: normalizeText(chapter.name),
      link: normalizeScrapeUrl(SIYAHMELEK_CAPTURE_SOURCE, chapter.link),
      number: Number(chapter.number),
    })),
  )};

  if (currentUrl.hostname !== 'siyahmelek.mom' || !currentUrl.pathname.includes('/manga/')) {
    throw new Error('Bu scripti SiyahMelek seri sayfasında çalıştır.');
  }

  const chapters = [];
  for (let index = 0; index < selectedChapters.length; index += 1) {
    const chapter = selectedChapters[index];
    console.log('[ToonParrot] Bölüm görselleri çekiliyor', index + 1, '/', selectedChapters.length, chapter.name);

    try {
      const response = await fetch(chapter.link, {
        method: 'GET',
        credentials: 'include',
        headers: {
          'Cache-Control': 'no-cache',
        },
      });
      const html = await response.text();
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const images = extractImagesFromDoc(doc);
      const locked = images.length === 0 && hasLockedMarkers(doc);

      chapters.push({
        ...chapter,
        prefetchedImageResult: locked
          ? { status: 'locked', images: [], reason: 'VIP veya kilitli bölüm' }
          : images.length > 0
            ? { status: 'ok', images }
            : { status: 'error', images: [], reason: 'Sayfa görselleri bulunamadı' },
      });
    } catch (error) {
      chapters.push({
        ...chapter,
        prefetchedImageResult: {
          status: 'error',
          images: [],
          reason: error instanceof Error ? error.message : 'Bölüm isteği başarısız oldu',
        },
      });
    }
  }

  const payload = {
    source: 'siyahmelek',
    kind: 'browser_capture',
    version: 2,
    mode: 'chapter_images',
    mangaUrl: window.location.href,
    chapters,
    capturedAt: new Date().toISOString(),
  };

  const serialized = JSON.stringify(payload);

  try {
    await navigator.clipboard.writeText(serialized);
    downloadCaptureFile(serialized);
    alert('ToonParrot: Seçili bölüm görselleri kopyalandı ve capture dosyası indirildi.');
  } catch {
    downloadCaptureFile(serialized);
    alert('ToonParrot: Seçili bölüm görselleri için capture dosyası indirildi. Admin panelinde "Capture Dosyası" ile yükle.');
  }
})();`;

export const buildSiyahMelekBrowserCaptureScript = () => buildMetadataScript();

export const buildSiyahMelekBrowserChapterImageCaptureScript = (
  chapters: Pick<ScrapedChapter, 'name' | 'link' | 'number'>[],
) => buildChapterImageScript(chapters);
