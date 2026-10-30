import type { Manga } from '@/lib/types';
import { syncAdultContentGenres } from '@/lib/adultContentFormat';
import { normalizeAdultMangaType } from '@/lib/mangaType';
import { filterRecognizedGenres } from '@/lib/mockData';

export type ScraperSourceKey =
  | 'webtoonhatti'
  | 'okutoon'
  | 'mangacix'
  | 'golgebahcesi'
  | 'dxdfansub'
  | 'siyahmelek'
  | 'hattorimanga';

export type LegacyScrapeSource = 'hayalistic' | 'hentaiturk';
export type ScrapeSource = ScraperSourceKey | LegacyScrapeSource;

export const SCRAPER_SOURCES: readonly ScraperSourceKey[] = [
  'webtoonhatti',
  'okutoon',
  'mangacix',
  'golgebahcesi',
  'dxdfansub',
  'siyahmelek',
  'hattorimanga',
] as const;

export interface ScrapedMangaCard {
  title: string;
  link: string;
  cover: string;
  genres: string[];
  source?: ScrapeSource;
}

export interface ScrapedChapter {
  name: string;
  link: string;
  number: number;
  prefetchedImageResult?: ScrapedChapterImageResult;
}

export interface ScrapedChapterImageResult {
  status: 'ok' | 'locked' | 'error';
  images: string[];
  reason?: string;
}

export interface ChapterImageResultOptions {
  excludeSiyahMelekPromoFirstPage?: boolean;
}

export interface ScrapedMangaDraft extends Partial<Manga> {
  _rawChapters: ScrapedChapter[];
}

interface ParsedChapterImage {
  src?: string | null;
}

interface ParsedChapterDataPayload {
  images?: ParsedChapterImage[];
}

const SCRAPE_SOURCE_STORAGE_KEY = 'toonparrot:scraper-source';

export interface SourceDefinition {
  label: string;
  baseUrl: string;
  searchUrl: (query: string) => string;
  listUrl: string;
  directLinkPatterns: RegExp[];
}

export const SOURCE_CONFIG: Record<ScraperSourceKey, SourceDefinition> = {
  webtoonhatti: {
    label: 'WebtoonHattı',
    baseUrl: 'https://webtoonhatti.club',
    searchUrl: (query) => `https://webtoonhatti.club/?s=${encodeURIComponent(query)}&post_type=wp-manga`,
    listUrl: 'https://webtoonhatti.club/manga/page/1/?m_orderby=latest',
    directLinkPatterns: [
      /https?:\/\/(?:www\.)?webtoonhatti\.club\/(?:manga|webtoon)\/[^?#]+/i,
    ],
  },
  okutoon: {
    label: 'OkuToon',
    baseUrl: 'https://okutoon.com',
    searchUrl: (query) => `https://okutoon.com/tur?q=${encodeURIComponent(query)}`,
    listUrl: 'https://okutoon.com/tur?sayfa=1',
    directLinkPatterns: [
      /https?:\/\/(?:www\.)?okutoon\.com\/[^?#]+/i,
    ],
  },
  mangacix: {
    label: 'MangaCix',
    baseUrl: 'https://mangacix.net',
    searchUrl: (query) => `https://mangacix.net/secure/titles?onlyStreamable=true&page=1&perPage=24&query=${encodeURIComponent(query)}`,
    listUrl: 'https://mangacix.net/secure/titles?onlyStreamable=true&page=1&perPage=24',
    directLinkPatterns: [
      /https?:\/\/(?:www\.)?mangacix\.net\/(?:books|secure\/titles)\/[^?#]+/i,
    ],
  },
  golgebahcesi: {
    label: 'Gölge Bahçesi',
    baseUrl: 'https://golgebahcesi.com',
    searchUrl: (query) => `https://api.golgebahcesi.com/api/series?page=1&limit=24&sort=default&search=${encodeURIComponent(query)}`,
    listUrl: 'https://api.golgebahcesi.com/api/series?page=1&limit=24&sort=default',
    directLinkPatterns: [
      /https?:\/\/(?:api\.)?golgebahcesi\.com\/(?:manga|series|api\/series)\/[^?#]+/i,
    ],
  },
  dxdfansub: {
    label: 'DxDFansub',
    baseUrl: 'https://dxdfansub.com',
    searchUrl: (query) => `https://api.dxdfansub.com/api/series?page=1&limit=24&sort=default&search=${encodeURIComponent(query)}`,
    listUrl: 'https://api.dxdfansub.com/api/series?page=1&limit=24&sort=default',
    directLinkPatterns: [
      /https?:\/\/(?:api\.)?dxdfansub\.com\/(?:manga|series|api\/series)\/[^?#]+/i,
    ],
  },
  siyahmelek: {
    label: 'SiyahMelek (+18)',
    baseUrl: 'https://siyahmelek.my',
    searchUrl: (query) => `https://siyahmelek.my/?s=${encodeURIComponent(query)}`,
    listUrl: 'https://siyahmelek.my/manga/page/1/',
    directLinkPatterns: [
      /https?:\/\/(?:www\.)?siyahmelek\.(?:my|mom)\/manga\/[^?#]+/i,
    ],
  },
  hattorimanga: {
    label: 'HattoriManga (+18)',
    baseUrl: 'https://hattorimanga.net',
    searchUrl: (query) => `https://hattorimanga.net/?s=${encodeURIComponent(query)}&post_type=wp-manga`,
    listUrl: 'https://hattorimanga.net/manga/page/1/',
    directLinkPatterns: [
      /https?:\/\/(?:www\.)?hattorimanga\.net\/manga\/[^?#]+/i,
    ],
  },
};

const LEGACY_SOURCE_CONFIG: Record<LegacyScrapeSource, SourceDefinition> = {
  hayalistic: {
    label: 'Hayalistic (Eski)',
    baseUrl: 'https://hayalistic.com',
    searchUrl: (query) => `https://hayalistic.com/?s=${encodeURIComponent(query)}&post_type=wp-manga`,
    listUrl: 'https://hayalistic.com/webtoonlar/',
    directLinkPatterns: [
      /https?:\/\/(?:www\.)?hayalistic\.(?:com|net)\/(?:manga|webtoon)\/[^?#]+/i,
    ],
  },
  hentaiturk: {
    label: 'HentaiTürk (Eski)',
    baseUrl: 'https://hentaiturk.com',
    searchUrl: (query) => `https://hentaiturk.com/ara?q=${encodeURIComponent(query)}`,
    listUrl: 'https://hentaiturk.com/sayfa/1',
    directLinkPatterns: [
      /https?:\/\/(?:www\.)?hentaiturk\.com\/(?:galeri|g)\/[^?#]+/i,
    ],
  },
};

const getSourceDef = (source: ScrapeSource): SourceDefinition => {
  if (source in SOURCE_CONFIG) {
    return SOURCE_CONFIG[source as ScraperSourceKey];
  }
  if (source in LEGACY_SOURCE_CONFIG) {
    return LEGACY_SOURCE_CONFIG[source as LegacyScrapeSource];
  }
  return SOURCE_CONFIG.webtoonhatti;
};

// ---------------------------------------------------------------------------
// String & Key Helpers
// ---------------------------------------------------------------------------

const normalizeScrapedText = (value?: string | null) =>
  value?.replace(/\s+/g, ' ').trim() || '';

const toScrapedKey = (value?: string | null) =>
  normalizeScrapedText(value).toLocaleLowerCase('tr-TR');

export const normalizeSeriesMatchKey = (title: string): string => {
  if (!title) return '';
  return title
    .toLocaleLowerCase('tr-TR')
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ş/g, 's')
    .replace(/ı/g, 'i')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c')
    .replace(/\(.*?\)/g, ' ')
    .replace(/\[.*?\]/g, ' ')
    .replace(/\b(?:season\s*\d+|sezon\s*\d+|\d+\.\s*sezon|webtoon|manhwa|manhua|novel|manga)\b/gi, ' ')
    .replace(/[^a-z0-9]/gi, '')
    .trim();
};

export const areSeriesTitlesMatching = (
  a: { title: string; alternativeTitles?: string[] },
  b: { title: string; alternativeTitles?: string[] },
): boolean => {
  const getKeys = (item: { title: string; alternativeTitles?: string[] }) => {
    const allTitles = [item.title, ...(item.alternativeTitles || [])];
    return new Set(allTitles.map(normalizeSeriesMatchKey).filter((k) => k.length >= 3));
  };

  const keysA = getKeys(a);
  const keysB = getKeys(b);

  for (const keyA of keysA) {
    if (keysB.has(keyA)) {
      return true;
    }
  }
  return false;
};

const extractPrimaryScrapedPersonName = (value?: string | null) =>
  normalizeScrapedText(value);

const SCRAPED_PLACEHOLDER_PATTERNS = [
  /^[-–—\s]*$/i,
  /^(?:n\/a|na|null|undefined|\?)$/i,
  /^(?:bilinmiyor|unknown|belirtilmedi|girilmedi|girilemedi|girilmemi[sş]|yok|bulunmuyor|mevcut değil)$/i,
];

const isScrapedPlaceholderValue = (value?: string | null) => {
  const normalizedValue = normalizeScrapedText(value)
    .replace(/[.!,:;]+$/g, '')
    .toLocaleLowerCase('tr-TR');

  return SCRAPED_PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(normalizedValue));
};

const isParsedChapterDataPayload = (value: unknown): value is ParsedChapterDataPayload => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  return Array.isArray((value as ParsedChapterDataPayload).images);
};

const sanitizeAlternativeTitles = (rawText: string, mainTitle?: string) => {
  const mainKey = toScrapedKey(mainTitle);

  return Array.from(
    new Set(
      rawText
        .split(/[,;\n]/)
        .map((title) => normalizeScrapedText(title))
        .filter((title) => {
          const key = toScrapedKey(title);
          return key.length > 0 && key !== mainKey && !/g(?:ü|u)ncellenecek/i.test(key);
        }),
    ),
  );
};

const normalizeUrl = (baseUrl: string, value?: string | null) => {
  const href = normalizeScrapedText(value);

  if (!href) {
    return '';
  }

  if (/^https?:\/\//i.test(href)) {
    return href;
  }

  try {
    return new URL(href, baseUrl).href;
  } catch {
    return href;
  }
};

const normalizeSourcePathname = (source: ScrapeSource, pathname: string) => {
  const normalizedPathname = pathname.replace(/\/+$/, '');

  if (source === 'siyahmelek') {
    return normalizedPathname
      .replace(/\/bolum\/page\/\d+$/i, '')
      .replace(/\/bolum$/i, '')
      .replace(/\/bolum-[^/]+$/i, '');
  }

  return normalizedPathname;
};

const normalizeSourceUrl = (source: ScrapeSource, rawUrl: string) => {
  try {
    const parsedUrl = new URL(rawUrl);
    parsedUrl.hash = '';

    if (source === 'siyahmelek') {
      parsedUrl.search = '';
      parsedUrl.pathname = `${normalizeSourcePathname(source, parsedUrl.pathname) || '/'}/`.replace(/\/{2,}/g, '/');
    }

    return parsedUrl.href;
  } catch {
    return rawUrl;
  }
};

const ADULT_CONTENT_PATTERNS = [
  /\b18\+\b/i,
  /\+18\b/i,
  /contentrating["'\s:>]+18\+/i,
  /AdultConsideration/i,
  /audienceType["'\s:>]+adult/i,
  /b[üu]y[üu]kler i[cç]in/i,
  /\byeti[şs]kin\b/i,
  /\badult\b/i,
  /\berotik\b/i,
  /\berotica\b/i,
  /\bpornographic\b/i,
  /\bnsfw\b/i,
  /\bmature\b/i,
  /\br-?18\b/i,
  /\becchi\b/i,
  /\bsmut\b/i,
  /\bhentai\b/i,
  /badge-age/i,
  /badge-adult/i,
];

const LOCKED_CHAPTER_PATTERNS = [
  /kilitli b[öo]l[üu]m/i,
  /vip [üu]yeler bu b[öo]l[üu]m[üu]/i,
  /erken okuyabilir/i,
  /kilitli/i,
  /uk-icon.*lock/i,
];

const CHAPTER_SHORTCUT_PATTERNS = [
  /^ba[şs]tan$/i,
  /^ba[şs]tan oku$/i,
  /^okumaya ba[şs]la$/i,
  /^ilk b[öo]l[üu]m$/i,
  /^chapter start$/i,
  /^start reading$/i,
];

const DETAIL_TITLE_PREFIX_PATTERNS = [
  /^g[üu]ncel\s+/i,
  /^tamamland[ıi]\s+/i,
  /^completed\s+/i,
  /^ongoing\s+/i,
  /^devam ediyor\s+/i,
  /^yapay zeka [çc]eviri\s+/i,
  /^ai translation\s+/i,
  /^new\s+/i,
  /^hot\s+/i,
];

const sanitizeDetailTitleText = (value?: string | null) => {
  let nextValue = normalizeScrapedText(value);

  if (!nextValue) {
    return '';
  }

  let previousValue = '';
  while (nextValue && nextValue !== previousValue) {
    previousValue = nextValue;

    for (const pattern of DETAIL_TITLE_PREFIX_PATTERNS) {
      nextValue = nextValue.replace(pattern, '').trim();
    }
  }

  return nextValue;
};

const CHAPTER_TEXT_REMOVAL_SELECTORS = [
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

export const getScrapedPaginationPageNumber = (value: string) => {
  const match = value.match(/\/bolum\/page\/(\d+)\/?/i)
    || value.match(/\/page\/(\d+)\/?/i)
    || value.match(/\/sayfa\/(\d+)\/?/i)
    || value.match(/[?&]page=(\d+)/i)
    || value.match(/[?&]sayfa=(\d+)/i);
  return match ? Number(match[1]) : 1;
};

const formatScrapedChapterNumber = (value: number) => (
  Number.isInteger(value) ? String(value) : String(value)
);

const extractRawChapterText = (container: Element, anchor: HTMLAnchorElement) => {
  const directTitle = normalizeScrapedText(
    anchor.getAttribute('title')
    || anchor.querySelector('.chapter-manhwa-title, .chapter-title, .chapternum, .chapter-name, .name')?.textContent
    || container.querySelector('.chapter-manhwa-title, .chapter-title, .chapternum, .chapter-name, .name')?.textContent,
  );

  if (directTitle) {
    return directTitle;
  }

  const clonedAnchor = anchor.cloneNode(true) as Element;
  clonedAnchor.querySelectorAll(CHAPTER_TEXT_REMOVAL_SELECTORS.join(', ')).forEach((element) => element.remove());
  const anchorText = normalizeScrapedText(clonedAnchor.textContent);
  if (anchorText) {
    return anchorText;
  }

  const clonedContainer = container.cloneNode(true) as Element;
  clonedContainer.querySelectorAll(CHAPTER_TEXT_REMOVAL_SELECTORS.join(', ')).forEach((element) => element.remove());
  return normalizeScrapedText(clonedContainer.textContent);
};

export const cleanChapterTitle = (
  rawTitle?: string | null,
  chapterNumber?: number | string | null,
  seriesTitle?: string | null,
): string => {
  let text = (rawTitle || '').toString().trim();
  if (!text) {
    return chapterNumber != null && Number(chapterNumber) > 0 ? `Bölüm ${chapterNumber}` : 'Bölüm 1';
  }

  // 1. Remove drop rates & percentages
  text = text.replace(/\b\d+\s*B[ıi]rakma\s*~?\d*%?/gi, ' ');
  text = text.replace(/\bB[ıi]rakma\s*~?\d*%?/gi, ' ');
  text = text.replace(/~?\s*\d+(?:[.,]\d+)?\s*%/g, ' ');

  // 2. Remove relative dates
  text = text.replace(/\b\d+\s*(?:dakika|dak|dk|min|minute|saat|hour|g[üu]n|day|hafta|week|ay|month|y[ıi]l|sene|year)s?(?:\s*(?:önce|ago))?\b/gi, ' ');

  // 3. Remove view counters and read counts
  text = text.replace(/\b\d+(?:[.,]\d+)?\s*[kmbKMkMB]\b/g, ' ');
  text = text.replace(/\b\d+\s*(?:g[öo]r[üu]nt[üu]lenme|okunma|okuma|views?|reads?)\b/gi, ' ');
  text = text.replace(/\bburadas[ıi]n[ıi]z\b/gi, ' ');

  // 4. If series title is provided, strip it from title
  if (seriesTitle && typeof seriesTitle === 'string') {
    const escaped = seriesTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    text = text.replace(new RegExp(`^${escaped}\\s*[-–—:|]?\\s*`, 'i'), ' ');
    text = text.replace(new RegExp(`\\s*[-–—:|]?\\s*${escaped}$`, 'i'), ' ');
    text = text.replace(new RegExp(`\\b${escaped}\\b`, 'gi'), ' ');
  }

  // 5. Determine effective chapter number
  let effectiveNum = chapterNumber != null && Number(chapterNumber) > 0 ? Number(chapterNumber) : null;
  if (effectiveNum == null) {
    const match = text.match(/(?:b[öo]l[üu]m|chapter|ch\.?)\s*(\d+(?:\.\d+)?)/i) || text.match(/(\d+(?:\.\d+)?)/);
    if (match) effectiveNum = parseFloat(match[1]);
  }

  // 6. Remove trailing residue numbers if chapter number already established
  if (effectiveNum != null) {
    text = text.replace(/\s+\d{1,4}\s*$/, ' ');
  }

  // 7. Extract subtitle
  let subtitle = text
    .replace(/(?:b[öo]l[üu]m|chapter|ch\.?)\s*\.?\s*\d+(?:\.\d+)?/gi, ' ')
    .replace(/\b\d+(?:\.\d+)?\s*\.?\s*(?:b[öo]l[üu]m|chapter|ch\.?)/gi, ' ')
    .replace(/\b(?:b[öo]l[üu]m|chapter|ch\.?)\b/gi, ' ')
    .replace(/[\[({【][.\s…_—–-]+[\])}】]/g, ' ');

  const numStr = effectiveNum != null ? (Number.isInteger(effectiveNum) ? String(effectiveNum) : String(effectiveNum)) : '';
  if (numStr) {
    subtitle = subtitle.replace(new RegExp(`\\b${numStr.replace('.', '\\.')}\\b`, 'g'), ' ');
  }

  subtitle = subtitle.replace(/^[-–—:|.\s]+|[-–—:|.\s]+$/g, '').replace(/\s+/g, ' ').trim();

  // If subtitle has meaningful alphabetic text (not just punctuation, dots or chapter leftover)
  const hasLetters = /[a-zA-ZçğıöşüÇĞİÖŞÜ]{2,}/.test(subtitle);
  if (subtitle && hasLetters && !/^(?:b[öo]l[üu]m|chapter|ch|\d+)$/i.test(subtitle) && subtitle.length > 2) {
    return effectiveNum != null ? `Bölüm ${effectiveNum} - ${subtitle}` : subtitle;
  }

  return effectiveNum != null ? `Bölüm ${effectiveNum}` : (text || 'Bölüm 1');
};

const BL_REGEX = /\b(?:yaoi|shounen[\s\-_]*ai|shonen[\s\-_]*ai|boys?[\s\-_]*love|danmei|bara|erkek\s*a[sş]k[ıi]|fujoshi|fudanshi|gay)\b/iu;
const BL_GENRE_REGEX = /\b(?:bl|yaoi|shounen[\s\-_]*ai|shonen[\s\-_]*ai|boys?[\s\-_]*love|danmei|bara|erkek\s*a[sş]k[ıi]|fujoshi|fudanshi|gay)\b/iu;

export const isBLSeries = (mangaOrMetadata: any): boolean => {
  if (!mangaOrMetadata || typeof mangaOrMetadata !== 'object') return false;

  const genreList: string[] = [];
  if (Array.isArray(mangaOrMetadata.genres)) {
    genreList.push(...mangaOrMetadata.genres.map((g: any) => (typeof g === 'string' ? g : g?.name || g?.genre || '')));
  }
  if (Array.isArray(mangaOrMetadata.tags)) {
    genreList.push(...mangaOrMetadata.tags.map((t: any) => (typeof t === 'string' ? t : t?.name || t?.tag || '')));
  }
  if (Array.isArray(mangaOrMetadata.categories)) {
    genreList.push(...mangaOrMetadata.categories.map((c: any) => (typeof c === 'string' ? c : c?.name || '')));
  }

  for (const genre of genreList) {
    if (!genre) continue;
    const gLower = genre.trim().toLowerCase();
    if (gLower === 'bl' || BL_GENRE_REGEX.test(gLower)) {
      return true;
    }
  }

  const titleList: string[] = [
    mangaOrMetadata.title,
    mangaOrMetadata.name,
    mangaOrMetadata.original_title,
    mangaOrMetadata.title_english,
    mangaOrMetadata.title_japanese,
    ...(Array.isArray(mangaOrMetadata.alternativeTitles) ? mangaOrMetadata.alternativeTitles : []),
    ...(Array.isArray(mangaOrMetadata.altTitles) ? mangaOrMetadata.altTitles : []),
    ...(Array.isArray(mangaOrMetadata.synonyms) ? mangaOrMetadata.synonyms : []),
  ].filter((t): t is string => typeof t === 'string' && t.trim().length > 0);

  for (const t of titleList) {
    if (/\bBL\b/i.test(t) || BL_REGEX.test(t)) {
      return true;
    }
  }

  const desc = [
    mangaOrMetadata.description,
    mangaOrMetadata.synopsis,
    mangaOrMetadata.summary,
  ].filter((d): d is string => typeof d === 'string' && d.trim().length > 0).join(' ');

  if (desc && (BL_REGEX.test(desc) || /\bBL\s*(?:webtoon|manhwa|manhua|manga|seri|hikaye|ili[sş]ki)/iu.test(desc))) {
    return true;
  }

  return false;
};

const sanitizeScrapedChapterName = (
  value?: string | null,
  number?: number,
  seriesTitle?: string | null,
) => {
  return cleanChapterTitle(value, number, seriesTitle);
};

const decodeHtmlValue = (value: string) => {
  if (typeof document === 'undefined') {
    return value;
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(`<textarea>${value}</textarea>`, 'text/html');
  return doc.querySelector('textarea')?.value ?? value;
};

const stripHtmlTags = (value: string) => value.replace(/<[^>]+>/g, ' ');

// ---------------------------------------------------------------------------
// Source Detection, Labels & Base URLs
// ---------------------------------------------------------------------------

export const getAvailableScrapeSources = (): ScraperSourceKey[] => [...SCRAPER_SOURCES];

export const isScrapeSource = (value: string): value is ScrapeSource => (
  SCRAPER_SOURCES.includes(value as ScraperSourceKey) || value === 'hayalistic'
);

export const isAdultOnlyScrapeSource = (_source: ScrapeSource): boolean => false;

export const getScrapeSourceLabel = (source: ScrapeSource): string => getSourceDef(source).label;

export const getScrapeSourceBaseUrl = (source: ScrapeSource): string => getSourceDef(source).baseUrl;

export const getDefaultScrapeSource = (): ScrapeSource => 'webtoonhatti';

export const readPreferredScrapeSource = (): ScrapeSource => {
  if (typeof window !== 'undefined') {
    const stored = window.localStorage.getItem(SCRAPE_SOURCE_STORAGE_KEY);

    if (stored && isScrapeSource(stored)) {
      if (stored === 'hayalistic') {
        return getDefaultScrapeSource();
      }
      return stored;
    }
  }

  return getDefaultScrapeSource();
};

export const writePreferredScrapeSource = (source: ScrapeSource) => {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(SCRAPE_SOURCE_STORAGE_KEY, source);
};

export const buildScrapeSearchUrl = (source: ScrapeSource, query: string) => {
  const def = getSourceDef(source);
  return query.trim() ? def.searchUrl(query.trim()) : def.listUrl;
};

export const isDirectScrapeLink = (source: ScrapeSource, value: string) => {
  const def = getSourceDef(source);
  return def.directLinkPatterns.some((pattern) => pattern.test(value.trim()));
};

export const detectScrapeSourceFromUrl = (value: string): ScrapeSource | null => {
  const normalized = value.trim().toLocaleLowerCase('tr-TR');

  if (normalized.includes('webtoonhatti.club')) {
    return 'webtoonhatti';
  }
  if (normalized.includes('okutoon.com')) {
    return 'okutoon';
  }
  if (normalized.includes('mangacix.net')) {
    return 'mangacix';
  }
  if (normalized.includes('golgebahcesi.com')) {
    return 'golgebahcesi';
  }
  if (normalized.includes('dxdfansub.com')) {
    return 'dxdfansub';
  }
  if (normalized.includes('siyahmelek.my') || normalized.includes('siyahmelek.mom')) {
    return 'siyahmelek';
  }
  if (normalized.includes('hattorimanga.net')) {
    return 'hattorimanga';
  }
  if (normalized.includes('hayalistic.com') || normalized.includes('hayalistic.net')) {
    return 'hayalistic';
  }

  return null;
};

export const normalizeScrapeUrl = (source: ScrapeSource, value?: string | null) => {
  return normalizeUrl(getSourceDef(source).baseUrl, value);
};

export const normalizeScrapeSeriesUrl = (source: ScrapeSource, value?: string | null) => {
  const normalized = normalizeUrl(getSourceDef(source).baseUrl, value);
  return normalized ? normalizeSourceUrl(source, normalized) : '';
};

// ---------------------------------------------------------------------------
// Card Extraction & Parsers
// ---------------------------------------------------------------------------

const getSummaryField = (doc: Document, labels: string[]) => {
  const normalizedLabels = labels.map((label) => label.toLocaleLowerCase('tr-TR'));

  const matchedItem = Array.from(doc.querySelectorAll('.post-content_item, .meta-item, .info-item, .comic-info div')).find((element) => {
    const text = element.textContent?.toLocaleLowerCase('tr-TR') || '';
    return normalizedLabels.some((label) => text.includes(label));
  });

  return normalizeScrapedText(
    matchedItem?.querySelector('.summary-content, .author-content a, .artist-content a, .genres-content a, a')?.textContent ||
    matchedItem?.querySelector('.summary-content, .value')?.textContent,
  );
};

const inferMangaType = (doc: Document, genres: string[], fallbackGenres: string[]) => {
  const typeSource = [
    getSummaryField(doc, ['tip', 'type']),
    getSummaryField(doc, ['alternatif']),
    getSummaryField(doc, ['kategori', 'categories']),
    genres.join(', '),
    fallbackGenres.join(', '),
  ].join(' ');

  const normalizedSource = typeSource.toLocaleLowerCase('tr-TR');

  if (normalizedSource.includes('manhwa')) {
    return 'manhwa' as const;
  }

  if (normalizedSource.includes('manhua')) {
    return 'manhua' as const;
  }

  if (normalizedSource.includes('webtoon')) {
    return 'webtoon' as const;
  }

  return 'manga' as const;
};

// WebtoonHattı / HattoriManga (Madara) Cards
const extractMadaraCardsFromHtml = (html: string, baseUrl: string, source: ScrapeSource): ScrapedMangaCard[] => {
  const cards: ScrapedMangaCard[] = [];
  const seenKeys = new Set<string>();
  const titlePattern = /<h3[^>]*class="[^"]*h4[^"]*"[^>]*>\s*<a href="([^"]+)">([\s\S]*?)<\/a>\s*<\/h3>/gi;

  for (const match of html.matchAll(titlePattern)) {
    const link = normalizeUrl(baseUrl, decodeHtmlValue(match[1] || ''));
    const title = normalizeScrapedText(stripHtmlTags(decodeHtmlValue(match[2] || '')));

    if (!link || !title) continue;

    const key = `${title.toLocaleLowerCase('tr-TR')}|${link}`;
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);

    const snippetStart = Math.max(0, (match.index || 0) - 1800);
    const snippetEnd = Math.min(html.length, (match.index || 0) + 1800);
    const snippet = html.slice(snippetStart, snippetEnd);
    const imageMatches = Array.from(
      snippet.matchAll(/<img[^>]+(?:data-src|data-lazy-src|src)="([^"]+)"/gi),
    );
    const lastImageMatch = imageMatches.length > 0 ? imageMatches[imageMatches.length - 1] : undefined;
    const cover = normalizeUrl(baseUrl, decodeHtmlValue(lastImageMatch?.[1] || ''));
    const genres = Array.from(
      snippet.matchAll(/<a[^>]+href="[^"]*(?:\/webtoon-tur\/|\/manga-genre\/)[^"]*"[^>]*>([\s\S]*?)<\/a>/gi),
    )
      .map((genreMatch) => normalizeScrapedText(stripHtmlTags(decodeHtmlValue(genreMatch[1] || ''))))
      .filter(Boolean);

    cards.push({
      title,
      link,
      cover,
      genres,
      source,
    });
  }

  return cards;
};

// SiyahMelek Cards (init-manga)
const extractSiyahMelekCards = (doc: Document, baseUrl: string): ScrapedMangaCard[] => {
  const cards: ScrapedMangaCard[] = [];
  const seen = new Set<string>();

  const elements = Array.from(doc.querySelectorAll('a[href*="/manga/"]'));
  for (const anchor of elements) {
    const href = anchor.getAttribute('href');
    if (!href || href === '/manga/' || href.endsWith('/manga')) continue;
    const link = normalizeUrl(baseUrl, href);
    if (!link || seen.has(link)) continue;

    const container = anchor.closest('.manga-item, .comic-item, .card, div') || anchor;
    const title = normalizeScrapedText(
      anchor.getAttribute('title')
      || container.querySelector('h2, h3, h4, .comic-title, .title')?.textContent
      || anchor.textContent,
    );
    if (!title || /^(manga|tüm mangalar|katalog|anasayfa)/i.test(title)) continue;

    const img = container.querySelector('img') || anchor.querySelector('img');
    const cover = normalizeUrl(
      baseUrl,
      img?.getAttribute('data-src') || img?.getAttribute('data-original-src') || img?.getAttribute('src'),
    );

    seen.add(link);
    cards.push({
      title,
      link,
      cover,
      genres: ['+18', 'Adult'],
      source: 'siyahmelek',
    });
  }

  return cards;
};

// OkuToon Cards
const extractOkutoonCards = (doc: Document, rawHtml?: string): ScrapedMangaCard[] => {
  const cards: ScrapedMangaCard[] = [];
  const seen = new Set<string>();

  const cardAnchors = Array.from(doc.querySelectorAll('a[href]')).filter((a) => {
    const href = a.getAttribute('href') || '';
    return href.length > 1 && !href.startsWith('/tur') && !href.startsWith('/giris') && !href.startsWith('/kayit') && !href.includes('/bolum-');
  });

  for (const anchor of cardAnchors) {
    const href = anchor.getAttribute('href');
    if (!href || href === '/' || href.startsWith('#')) continue;
    const link = normalizeUrl(SOURCE_CONFIG.okutoon.baseUrl, href);
    const titleEl = anchor.querySelector('h2, h3, .font-semibold, .font-bold, span') || anchor;
    const title = normalizeScrapedText(titleEl.textContent);
    const imgEl = anchor.querySelector('img') || anchor.parentElement?.querySelector('img');
    const cover = normalizeUrl(
      SOURCE_CONFIG.okutoon.baseUrl,
      imgEl?.getAttribute('data-src') || imgEl?.getAttribute('src'),
    );

    if (title && link && !seen.has(link) && title.length > 1 && !/^(giriş|kayıt|anasayfa|türler)/i.test(title)) {
      seen.add(link);
      cards.push({
        title,
        link,
        cover,
        genres: [],
        source: 'okutoon',
      });
    }
  }

  if (cards.length === 0 && rawHtml) {
    const pattern = /<a[^>]+href="([^"]+)"[^>]*>[\s\S]*?<img[^>]+src="([^"]*covers[^"]*)"[^>]*>[\s\S]*?<h[23][^>]*>([\s\S]*?)<\/h[23]>/gi;
    for (const match of rawHtml.matchAll(pattern)) {
      const link = normalizeUrl(SOURCE_CONFIG.okutoon.baseUrl, match[1]);
      const cover = normalizeUrl(SOURCE_CONFIG.okutoon.baseUrl, match[2]);
      const title = normalizeScrapedText(stripHtmlTags(decodeHtmlValue(match[3] || '')));
      if (link && title && !seen.has(link)) {
        seen.add(link);
        cards.push({ title, link, cover, genres: [], source: 'okutoon' });
      }
    }
  }

  return cards;
};

// MangaCix Cards
interface MangaCixItem {
  id: number | string;
  name?: string;
  title?: string;
  original_title?: string;
  description?: string;
  poster?: string;
  backdrop?: string;
  adult?: boolean;
  genres?: Array<{ name?: string } | string>;
}

const extractMangaCixCards = (doc: Document, rawContent?: string): ScrapedMangaCard[] => {
  const cards: ScrapedMangaCard[] = [];
  const text = rawContent || doc.body?.textContent || '';

  try {
    const json = JSON.parse(text);
    const items: MangaCixItem[] = Array.isArray(json?.pagination?.data)
      ? json.pagination.data
      : Array.isArray(json?.data)
        ? json.data
        : Array.isArray(json)
          ? json
          : [];

    for (const item of items) {
      const title = normalizeScrapedText(item.name || item.title);
      const id = item.id;
      if (!title || !id) continue;
      const link = `https://mangacix.net/books/${id}/${encodeURIComponent(title.toLowerCase().replace(/\s+/g, '-'))}`;
      let cover = item.poster || item.backdrop || '';
      if (cover && !cover.startsWith('http')) {
        cover = cover.startsWith('/') ? `https://mangacix.net${cover}` : `https://cdn.mangacix.net/file/mangacix/${cover}`;
      }
      const genres = (item.genres || []).map((g) => (typeof g === 'string' ? g : g?.name || '')).filter(Boolean);

      cards.push({
        title,
        link,
        cover,
        genres,
        source: 'mangacix',
      });
    }
    if (cards.length > 0) return cards;
  } catch {
    // proceed to DOM
  }

  const bookElements = Array.from(doc.querySelectorAll('.book-card, a[href*="/books/"], .title-card'));
  for (const el of bookElements) {
    const anchor = (el.tagName === 'A' ? el : el.querySelector('a[href*="/books/"]')) as HTMLAnchorElement | null;
    if (!anchor) continue;
    const link = normalizeUrl(SOURCE_CONFIG.mangacix.baseUrl, anchor.getAttribute('href'));
    const title = normalizeScrapedText(el.querySelector('.title, .book-title, h3, h4')?.textContent || anchor.textContent);
    const img = el.querySelector('img');
    const cover = normalizeUrl(
      SOURCE_CONFIG.mangacix.baseUrl,
      img?.getAttribute('data-src') || img?.getAttribute('src'),
    );

    if (title && link) {
      cards.push({ title, link, cover, genres: [], source: 'mangacix' });
    }
  }

  return cards;
};

// Gölge Bahçesi & DxDFansub Cards
interface GolgeItem {
  id?: number | string;
  slug?: string;
  title?: string;
  name?: string;
  cover?: string;
  image?: string;
  description?: string;
  genres?: Array<{ name?: string; title?: string } | string>;
  status?: string;
}

const extractGolgeOrDxdCards = (doc: Document, source: 'golgebahcesi' | 'dxdfansub', rawContent?: string): ScrapedMangaCard[] => {
  const cards: ScrapedMangaCard[] = [];
  const text = rawContent || doc.body?.textContent || '';
  const def = SOURCE_CONFIG[source];
  const apiBase = source === 'golgebahcesi' ? 'https://api.golgebahcesi.com' : 'https://api.dxdfansub.com';

  try {
    const json = JSON.parse(text);
    const items: GolgeItem[] = Array.isArray(json?.data)
      ? json.data
      : Array.isArray(json?.series)
        ? json.series
        : Array.isArray(json)
          ? json
          : [];

    for (const item of items) {
      const title = normalizeScrapedText(item.title || item.name);
      const slug = item.slug || String(item.id || '');
      if (!title || !slug) continue;
      const link = `${def.baseUrl}/manga/${slug}`;
      let cover = item.cover || item.image || '';
      if (cover) {
        if (cover.startsWith('/image-proxy/') || cover.startsWith('/')) {
          cover = `${apiBase}${cover}`;
        }
      }
      const genres = (item.genres || []).map((g) => {
        if (typeof g === 'string') return g;
        return g?.name || g?.title || '';
      }).filter(Boolean);

      cards.push({
        title,
        link,
        cover,
        genres,
        source,
      });
    }
    if (cards.length > 0) return cards;
  } catch {
    // DOM parse
  }

  const elements = Array.from(doc.querySelectorAll('a[href*="/manga/"], a[href*="/series/"]'));
  const seen = new Set<string>();
  for (const anchor of elements) {
    const href = anchor.getAttribute('href');
    if (!href) continue;
    const link = normalizeUrl(def.baseUrl, href);
    const title = normalizeScrapedText(anchor.querySelector('h2, h3, h4, .title')?.textContent || anchor.textContent);
    const img = anchor.querySelector('img') || anchor.parentElement?.querySelector('img');
    let cover = img?.getAttribute('data-src') || img?.getAttribute('src') || '';
    if (cover.startsWith('/')) {
      cover = `${apiBase}${cover}`;
    }

    if (title && link && !seen.has(link)) {
      seen.add(link);
      cards.push({ title, link, cover, genres: [], source });
    }
  }

  return cards;
};

export const extractScrapedMangaCards = (doc: Document, source: ScrapeSource, rawHtml?: string): ScrapedMangaCard[] => {
  if (source === 'webtoonhatti' || source === 'hattorimanga') {
    const baseUrl = getSourceDef(source).baseUrl;
    const cards: ScrapedMangaCard[] = [];
    const seenKeys = new Set<string>();
    const elements = Array.from(doc.querySelectorAll(
      '.row.c-tabs-item__content, #loop-content > .row, .page-content-listing .row.c-tabs-item__content, .c-tabs-item__content, .page-item-detail.manga, .manga-item',
    ));

    for (const element of elements) {
      const titleLink = element.querySelector('.post-title a, .post-title h3 a, h3 a, a[href*="/webtoon/"], a[href*="/manga/"]');
      const title = normalizeScrapedText(titleLink?.textContent || element.querySelector('.post-title')?.textContent);
      const link = normalizeUrl(baseUrl, titleLink?.getAttribute('href'));

      if (!title || !link) continue;
      const key = `${title.toLocaleLowerCase('tr-TR')}|${link}`;
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);

      const img = element.querySelector('img');
      const cover = normalizeUrl(
        baseUrl,
        img?.getAttribute('data-src') || img?.getAttribute('data-lazy-src') || img?.getAttribute('src'),
      );
      const genreLinks = Array.from(element.querySelectorAll('a[href*="/webtoon-tur/"], a[href*="/manga-genre/"], .genres-content a'));
      const genres = genreLinks.map((l) => normalizeScrapedText(l.textContent)).filter(Boolean);

      cards.push({ title, link, cover, genres, source });
    }

    if (cards.length === 0 && rawHtml) {
      const htmlCards = extractMadaraCardsFromHtml(rawHtml, baseUrl, source);
      if (htmlCards.length > 0) return htmlCards.filter((c) => !isBLSeries(c));
    }
    return cards.filter((c) => !isBLSeries(c));
  }

  let cards: ScrapedMangaCard[] = [];

  if (source === 'siyahmelek') {
    cards = extractSiyahMelekCards(doc, getSourceDef(source).baseUrl);
  } else if (source === 'okutoon') {
    cards = extractOkutoonCards(doc, rawHtml);
  } else if (source === 'mangacix') {
    cards = extractMangaCixCards(doc, rawHtml);
  } else if (source === 'golgebahcesi') {
    cards = extractGolgeOrDxdCards(doc, 'golgebahcesi', rawHtml);
  } else if (source === 'dxdfansub') {
    cards = extractGolgeOrDxdCards(doc, 'dxdfansub', rawHtml);
  }

  return cards.filter((c) => !isBLSeries(c));
};

// ---------------------------------------------------------------------------
// Detail & Metadata Extraction
// ---------------------------------------------------------------------------

const extractDetailTitle = (doc: Document, source?: ScrapeSource) => {
  if (source === 'siyahmelek') {
    const el = doc.querySelector('h1.uk-heading-small, #view-comic h1, h1');
    if (el) return sanitizeDetailTitleText(el.textContent);
  }

  const titleElement = doc.querySelector('.post-title h1, .post-title .entry-title, .post-title, h1');

  if (!titleElement) {
    return sanitizeDetailTitleText(
      doc.querySelector('meta[property="og:title"]')?.getAttribute('content')
      || doc.querySelector('title')?.textContent
      || '',
    );
  }

  const clonedTitleElement = titleElement.cloneNode(true) as Element;
  clonedTitleElement
    .querySelectorAll('.manga-title-badges, .post-title-badges, .hot, .new, .status, .badge, .label, [class*="badge"], [class*="status"]')
    .forEach((badgeNode) => badgeNode.remove());

  const cleanedTitle = sanitizeDetailTitleText(clonedTitleElement.textContent);
  return cleanedTitle || sanitizeDetailTitleText(titleElement.textContent);
};

const extractDetailCover = (doc: Document, source: ScrapeSource) => {
  if (source === 'siyahmelek') {
    const img = doc.querySelector('.comic-cover img, .uk-cover img, .cover img');
    if (img) {
      return normalizeUrl(
        getSourceDef(source).baseUrl,
        img.getAttribute('data-original-src') || img.getAttribute('data-src') || img.getAttribute('src'),
      );
    }
  }

  const image = doc.querySelector('.summary_image img, .summary-image img, .post-thumbnail img, .cover img, img[src*="cover"]');

  return normalizeUrl(
    getSourceDef(source).baseUrl,
    image?.getAttribute('data-src') ||
    image?.getAttribute('data-lazy-src') ||
    image?.getAttribute('src')
    || doc.querySelector('meta[property="og:image"]')?.getAttribute('content'),
  );
};

const extractDescription = (doc: Document, source: ScrapeSource) => {
  const selectors = [
    '.manga-description',
    '.comic-description',
    '.manga-excerpt.summary__content.show-more p',
    '.summary__content.show-more p',
    '.description-summary .summary__content p',
    '.manga-excerpt p',
    '.manga-excerpt',
    '.summary__content',
    '.description',
    '.synopsis',
    '.post-content_item p',
  ];

  for (const selector of selectors) {
    const element = doc.querySelector(selector);
    const value = normalizeScrapedText(element?.textContent);
    if (value && value.length > 10) {
      return value;
    }
  }

  return normalizeScrapedText(
    doc.querySelector('meta[property="og:description"]')?.getAttribute('content')
    || doc.querySelector('meta[name="description"]')?.getAttribute('content'),
  );
};

const extractDetailStatus = (doc: Document) => {
  const statusField = Array.from(doc.querySelectorAll('.post-content_item, .meta-item, .info-item, .status, .comic-info div'))
    .find((element) => element.textContent?.toLocaleLowerCase('tr-TR').includes('durum') || element.textContent?.toLocaleLowerCase('tr-TR').includes('status'));

  const statusText = normalizeScrapedText(
    statusField?.querySelector('.summary-content, .value')?.textContent || statusField?.textContent,
  );

  if (!statusText) {
    return 'ongoing' as const;
  }

  return statusText.toLocaleLowerCase('tr-TR').includes('tamam') || statusText.toLocaleLowerCase('tr-TR').includes('fin') || statusText.toLocaleLowerCase('tr-TR').includes('completed')
    ? 'completed'
    : 'ongoing';
};

export const getScrapedStatusLabel = (status?: string | null) => {
  switch ((status || '').toLocaleLowerCase('tr-TR')) {
    case 'completed':
      return 'Bitti';
    case 'ongoing':
      return 'Devam Ediyor';
    case 'hiatus':
      return 'Ara Verildi';
    default:
      return normalizeScrapedText(status);
  }
};

const extractDetailAuthors = (doc: Document, labels: string[], fallback: string) => {
  const field = Array.from(doc.querySelectorAll('.post-content_item, .meta-item, .info-item, .comic-info div'))
    .find((element) => labels.some((label) => element.textContent?.toLocaleLowerCase('tr-TR').includes(label.toLocaleLowerCase('tr-TR'))));

  const linkedNames = Array.from(field?.querySelectorAll('.author-content a, .artist-content a, .summary-content a, a[href*="/yazar/"], a') || [])
    .map((item) => extractPrimaryScrapedPersonName(item.textContent))
    .filter(Boolean);
  const extractedName = linkedNames.length > 0
    ? linkedNames.join(', ')
    : extractPrimaryScrapedPersonName(
      normalizeScrapedText(field?.querySelector('.author-content, .artist-content, .summary-content, .value')?.textContent) || fallback,
    );

  return isScrapedPlaceholderValue(extractedName) ? '' : extractedName;
};

const extractGenres = (doc: Document, fallbackGenres: string[], source?: ScrapeSource) => {
  const genreElements = doc.querySelectorAll([
    '.genres-content a',
    '.post-content_item .summary-content a',
    '.summary-content a[href*="/webtoon-tur/"]',
    '.summary-content a[href*="/manga-genre/"]',
    '.summary-content a[href*="/tur/"]',
    'a[href*="/tur/"]',
    'a[href*="/kategoriler/"]',
    'a[href*="/etiket/"]',
    '.tagcloud a',
    '.badge',
  ].join(', '));
  const candidateGenres = Array.from(genreElements)
    .map((genre) => normalizeScrapedText(genre.textContent))
    .filter(Boolean);

  const genres = candidateGenres.length > 0 ? candidateGenres : fallbackGenres;
  if (source === 'siyahmelek' || source === 'hattorimanga') {
    if (!genres.includes('+18')) genres.unshift('+18');
  }
  return genres;
};

const extractReleaseYear = (doc: Document) => {
  const yearField = Array.from(doc.querySelectorAll('.post-content_item, .meta-item, .info-item'))
    .find((element) => {
      const text = element.textContent?.toLocaleLowerCase('tr-TR') || '';
      return text.includes('yıl') || text.includes('salınış') || text.includes('yayin') || text.includes('release');
    });

  const yearText = normalizeScrapedText(yearField?.querySelector('.summary-content, .value')?.textContent || yearField?.textContent);
  if (!yearText || isScrapedPlaceholderValue(yearText)) {
    return undefined;
  }

  const yearMatch = yearText.match(/\d{4}/);
  return yearMatch ? parseInt(yearMatch[0], 10) : undefined;
};

const extractAlternativeTitles = (doc: Document, mainTitle?: string) => {
  const altTitlesField = Array.from(doc.querySelectorAll('.post-content_item, .meta-item, .info-item, .comic-info div'))
    .find((element) => {
      const text = element.textContent?.toLocaleLowerCase('tr-TR') || '';
      return text.includes('diğer ad') || text.includes('alt isim') || text.includes('alternatif');
    });

  const altTitlesText = normalizeScrapedText(altTitlesField?.querySelector('.summary-content, .value')?.textContent || altTitlesField?.textContent);
  return sanitizeAlternativeTitles(altTitlesText, mainTitle);
};

const inferAdultContent = (doc: Document, source: ScrapeSource, genres: string[], fallbackGenres: string[]) => {
  if (isAdultOnlyScrapeSource(source)) {
    return true;
  }

  // 1. Check for explicit 18+ UI badges (Siyahmelek, Madara, Hattori, WebtoonHatti)
  const hasBadge = Boolean(
    doc.querySelector('.badge-age, .badge-adult, .badge-18, [class*="badge-age"]')
    || Array.from(doc.querySelectorAll('.badge, span[class*="badge"], div[class*="badge"]')).some(
      (el) => /\b18\+\b|\+18\b|yetişkin/i.test(el.textContent || '')
    )
  );
  if (hasBadge) {
    return true;
  }

  // 2. Check JSON-LD metadata for adult consideration or adult audience
  const scriptsText = Array.from(doc.querySelectorAll('script[type="application/ld+json"], script'))
    .map((script) => script.textContent || '')
    .join(' ');
  if (scriptsText && (scriptsText.includes('AdultConsideration') || /audienceType["'\s:>]+adult/i.test(scriptsText))) {
    return true;
  }

  // 3. Check genres and explicit tags
  const combinedGenres = [...genres, ...fallbackGenres].join(' ');
  if (ADULT_CONTENT_PATTERNS.some((pattern) => pattern.test(combinedGenres))) {
    return true;
  }

  // 4. Check title and synopsis for explicit adult flags
  const titleAndDesc = [
    extractDetailTitle(doc, source),
    doc.querySelector('.manga-excerpt, .description-summary, .manga-description, meta[property="og:description"]')?.getAttribute('content') || '',
    doc.querySelector('.manga-excerpt, .description-summary, .manga-description')?.textContent || '',
  ].join(' ');

  return /\b(?:\+18|18\+|hentai|sansürsüz|uncensored|erotik|smut)\b/i.test(titleAndDesc);
};

// ---------------------------------------------------------------------------
// Chapters & Image Parsers
// ---------------------------------------------------------------------------

export const extractScrapedChapterLinks = (doc: Document, source: ScrapeSource): ScrapedChapter[] => {
  const chapters = new Map<string, ScrapedChapter>();
  const baseUrl = getSourceDef(source).baseUrl;
  const seriesTitle = extractDetailTitle(doc, source);

  // SiyahMelek: init-manga (#chapter-list .chapter-item)
  if (source === 'siyahmelek') {
    const chapterItems = Array.from(doc.querySelectorAll('#chapter-list .chapter-item, ul.uk-list li, .chapter-list-item'));
    for (const item of chapterItems) {
      // Kilit kontrolü: Eğer kilit ikonu veya kilit metni varsa atla
      const hasLock = Boolean(
        item.querySelector('[uk-icon*="lock"]')
        || item.querySelector('.lock-icon')
        || item.querySelector('i[class*="lock"]')
        || item.querySelector('svg[class*="lock"]')
        || LOCKED_CHAPTER_PATTERNS.some((p) => p.test(item.textContent || ''))
      );
      if (hasLock) {
        continue;
      }

      const anchor = (item.tagName === 'A' ? item : item.querySelector('a[href*="/bolum-"], a[href*="/chapter-"]')) as HTMLAnchorElement | null;
      if (!anchor) continue;

      const link = normalizeUrl(baseUrl, anchor.getAttribute('href') || anchor.href);
      if (!link) continue;

      const rawName = extractRawChapterText(item, anchor);
      const numberMatch = `${rawName} ${link}`.match(/(\d+(?:\.\d+)?)/);
      const number = numberMatch ? parseFloat(numberMatch[1]) : 0;
      const name = cleanChapterTitle(rawName, number, seriesTitle);

      if (!chapters.has(link)) {
        chapters.set(link, { name, link, number });
      }
    }

    if (chapters.size > 0) {
      return [...chapters.values()].sort((a, b) => a.number - b.number);
    }
  }

  // Common chapter link selectors (Madara, OkuToon, etc.)
  const chapterSelectors = [
    '.wp-manga-chapter a',
    'ul.sub-chap-list a',
    '.listing-chapters_wrap a[href*="/bolum"]',
    'a[href*="/bolum-"]',
    'a[href*="/chapter-"]',
    '.chapter-link a',
  ];

  const linkElements = Array.from(doc.querySelectorAll(chapterSelectors.join(', ')));

  for (const el of linkElements) {
    const anchor = el as HTMLAnchorElement;
    const link = normalizeUrl(baseUrl, anchor.getAttribute('href') || anchor.href);
    if (!link) continue;

    const container = anchor.closest('.wp-manga-chapter, li, .chapter-link') || anchor;
    const rawName = extractRawChapterText(container, anchor);
    const numberMatch = `${rawName} ${link}`.match(/(\d+(?:\.\d+)?)/);
    const number = numberMatch ? parseFloat(numberMatch[1]) : 0;
    const name = cleanChapterTitle(rawName, number, seriesTitle);

    if (!chapters.has(link)) {
      chapters.set(link, {
        name,
        link,
        number,
      });
    }
  }

  return [...chapters.values()].sort((a, b) => a.number - b.number);
};

// JSON helper for detail extraction (MangaCix / Gölge / DxD)
const extractDetailFromJson = (json: Record<string, unknown>, source: ScrapeSource, fallbackCard: ScrapedMangaCard): ScrapedMangaDraft => {
  const title = normalizeScrapedText((json.title || json.name || fallbackCard.title) as string);
  const altTitle = (json.original_title || '') as string;
  const alternativeTitles = altTitle ? [altTitle] : [];
  const description = normalizeScrapedText((json.description || '') as string);
  let cover = (json.poster || json.backdrop || json.cover || json.image || fallbackCard.cover) as string;
  if (cover && !cover.startsWith('http')) {
    const apiBase = source === 'golgebahcesi' ? 'https://api.golgebahcesi.com' : source === 'dxdfansub' ? 'https://api.dxdfansub.com' : 'https://cdn.mangacix.net/file/mangacix';
    cover = `${apiBase}/${cover.replace(/^\//, '')}`;
  }

  const genresList: string[] = [];
  if (Array.isArray(json.genres)) {
    for (const g of json.genres) {
      if (typeof g === 'string') genresList.push(g);
      else if (g && typeof g === 'object' && 'name' in g) genresList.push(String(g.name));
    }
  }

  const rawChapters: ScrapedChapter[] = [];
  const episodes = Array.isArray(json.episodes) ? json.episodes : Array.isArray(json.chapters) ? json.chapters : [];
  for (const ep of episodes) {
    if (!ep || typeof ep !== 'object') continue;
    const num = Number(ep.episode_number || ep.chapter_number || ep.number || 0);
    const chName = cleanChapterTitle(String(ep.name || ep.title || ''), num, title);
    const chId = ep.id || ep.slug || num;
    const link = `${fallbackCard.link}/${chId}`;
    rawChapters.push({
      name: chName,
      link,
      number: num,
    });
  }

  const isAdult = Boolean(isAdultOnlyScrapeSource(source) || json.adult || ADULT_CONTENT_PATTERNS.some((p) => p.test(genresList.join(' '))));
  const type = normalizeAdultMangaType('webtoon', genresList, isAdult);

  return {
    title,
    alternativeTitles,
    description,
    cover: cover || '',
    banner: cover || '',
    status: (json.status === 'completed' || json.status === 'tamamlandi') ? 'completed' : 'ongoing',
    type,
    genres: syncAdultContentGenres(genresList, { isAdult, type }),
    isAdult,
    chapters: [],
    views: 0,
    ratings: [],
    _rawChapters: rawChapters.sort((a, b) => a.number - b.number),
  };
};

export const extractScrapedMangaDetail = (
  doc: Document,
  source: ScrapeSource,
  fallbackCard: ScrapedMangaCard,
  rawContent?: string,
): ScrapedMangaDraft => {
  if (rawContent && (source === 'mangacix' || source === 'golgebahcesi' || source === 'dxdfansub')) {
    try {
      const json = JSON.parse(rawContent);
      const targetObj = json.data || json.title || json.series || json;
      if (typeof targetObj === 'object' && targetObj !== null) {
        return extractDetailFromJson(targetObj as Record<string, unknown>, source, fallbackCard);
      }
    } catch {
      // proceed to DOM
    }
  }

  const detailTitle = extractDetailTitle(doc, source);
  const detailCover = extractDetailCover(doc, source);
  const genres = extractGenres(doc, fallbackCard.genres, source);
  const title = sanitizeDetailTitleText(detailTitle || fallbackCard.title);
  const chapters = extractScrapedChapterLinks(doc, source);

  const isAdult = inferAdultContent(doc, source, genres, fallbackCard.genres);
  const type = normalizeAdultMangaType(
    inferMangaType(doc, genres, fallbackCard.genres),
    genres,
    isAdult,
  );

  return {
    title,
    alternativeTitles: extractAlternativeTitles(doc, title),
    description: extractDescription(doc, source),
    cover: detailCover || fallbackCard.cover || '',
    banner: detailCover || fallbackCard.cover || '',
    author: extractDetailAuthors(doc, ['yazar', 'author', 'yazarlar', 'yazar(lar)'], ''),
    artist: extractDetailAuthors(doc, ['çizer', 'artist', 'çizerler', 'çizer(ler)'], '') || undefined,
    status: extractDetailStatus(doc),
    type,
    genres: syncAdultContentGenres(genres, { isAdult, type }),
    isAdult,
    releaseYear: extractReleaseYear(doc),
    chapters: [],
    views: 0,
    ratings: [],
    _rawChapters: chapters,
  };
};

// ---------------------------------------------------------------------------
// Image Cleaning & Page Extraction
// ---------------------------------------------------------------------------

const WEBTOONHATTI_HIDDEN_STYLE_PATTERN = /(display\s*:\s*none|visibility\s*:\s*hidden)/i;
const JUNK_URL_FRAGMENTS = [
  'whatthe',
  'plase',
  'yaaxa',
  '/wp-content/uploads/2024/02/tr2.png',
  '/wp-content/uploads/2025/08/z9.jpg',
  'banner',
  'discord',
  'donate',
  'promo',
  'credit',
  'credits',
  'endcard',
  'end-card',
  'end_card',
  'mangadex-card',
  'read-on-mangadex',
  'reklam',
  'tanitim',
  'duyuru',
  'recruit',
  'warning',
  'no-cover',
  'placeholder',
  'default-cover',
];

const isElementVisuallyHidden = (element: Element | null) => {
  let current = element;

  while (current) {
    if (current.hasAttribute('hidden') || current.getAttribute('aria-hidden') === 'true') {
      return true;
    }

    const inlineStyle = normalizeScrapedText(current.getAttribute('style'));
    if (WEBTOONHATTI_HIDDEN_STYLE_PATTERN.test(inlineStyle)) {
      return true;
    }

    if (current.classList.contains('reading-content')) {
      break;
    }

    current = current.parentElement;
  }

  return false;
};

export const isJunkImageUrl = (value?: string | null): boolean => {
  if (!value || typeof value !== 'string') return true;
  const normalized = value.trim().toLocaleLowerCase('tr-TR');
  if (!normalized.startsWith('http')) return true;
  if (/\.(?:svg|ico|gif|enc)(?:\?.*)?$/i.test(normalized)) return true;
  return JUNK_URL_FRAGMENTS.some((fragment) => normalized.includes(fragment));
};

export const isJunkCoverUrl = (value?: string | null): boolean => {
  return isJunkImageUrl(value);
};

const isWebtoonHattiJunkImageUrl = (value: string) => isJunkImageUrl(value);

export const sanitizeAndDedupePageUrls = (
  urls: string[],
  sourceKey?: ScraperSourceKey | ScrapeSource,
): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const rawUrl of urls) {
    if (!rawUrl) continue;
    let url = normalizeScrapedText(rawUrl);
    if (url.startsWith('//')) {
      url = `https:${url}`;
    }
    if (!url.startsWith('http')) continue;
    if (url.includes('base64') || url.includes('data:image')) continue;
    if (/\.(?:svg|ico|gif)(?:\?.*)?$/i.test(url)) continue;
    if (isWebtoonHattiJunkImageUrl(url)) continue;

    if (!seen.has(url)) {
      seen.add(url);
      result.push(url);
    }
  }

  return result;
};

export const sanitizeChapterPageUrls = (images: string[]) => sanitizeAndDedupePageUrls(images);

const extractImageSource = (img: Element) => {
  const image = img as HTMLImageElement;
  const src = normalizeScrapedText(
    image.getAttribute('data-original-src') ||
    image.getAttribute('data-src') ||
    image.getAttribute('data-lazy-src') ||
    image.getAttribute('data-cdn') ||
    image.getAttribute('src'),
  );

  if (!src || src.includes('base64')) {
    return '';
  }

  if (src.startsWith('//')) {
    return `https:${src}`;
  }

  return src.startsWith('http') ? src : '';
};

const extractWebtoonHattiImageUrls = (doc: Document) => {
  const pageBreaks = Array.from(doc.querySelectorAll('.reading-content .page-break'));
  const orderedImages = pageBreaks.flatMap((pageBreak) => {
    if (isElementVisuallyHidden(pageBreak)) {
      return [];
    }

    return Array.from(pageBreak.querySelectorAll('img'))
      .filter((img) => !isElementVisuallyHidden(img))
      .map((img) => extractImageSource(img))
      .filter((src) => src && !isWebtoonHattiJunkImageUrl(src));
  });

  if (orderedImages.length > 0) {
    return sanitizeAndDedupePageUrls(orderedImages, 'webtoonhatti');
  }

  return sanitizeAndDedupePageUrls(
    Array.from(doc.querySelectorAll('.reading-content img'))
      .filter((img) => !isElementVisuallyHidden(img))
      .map((img) => extractImageSource(img))
      .filter((src) => src && !isWebtoonHattiJunkImageUrl(src)),
    'webtoonhatti',
  );
};

export const extractChapterImageResult = (
  doc: Document,
  source: ScrapeSource,
  options?: ChapterImageResultOptions,
  rawContent?: string,
): ScrapedChapterImageResult => {
  let images: string[] = [];

  // SiyahMelek (init-manga): data-original-src öncelikli oku
  if (source === 'siyahmelek' && images.length === 0) {
    const smImgs = Array.from(doc.querySelectorAll(
      '.reading-content img, [data-original-src*="uploads/init-manga"], img[src*="uploads/init-manga"], .reader-area img, .comic-content img',
    ));
    images = smImgs.map((img) => {
      const orig = img.getAttribute('data-original-src') || img.getAttribute('data-src') || img.getAttribute('src') || '';
      return orig.trim();
    }).filter((s) => s.startsWith('http'));
  }

  // JSON images check (Gölge, DxD, MangaCix API)
  if (images.length === 0 && rawContent) {
    try {
      const json = JSON.parse(rawContent);
      const pages = json.pages || json.images || json.data?.pages || json.data?.images;
      if (Array.isArray(pages)) {
        const apiBase = source === 'golgebahcesi' ? 'https://api.golgebahcesi.com' : source === 'dxdfansub' ? 'https://api.dxdfansub.com' : '';
        images = pages.map((p) => {
          const urlStr = typeof p === 'string' ? p : p?.url || p?.src || '';
          if (urlStr && !urlStr.startsWith('http') && apiBase) {
            return `${apiBase}/${urlStr.replace(/^\//, '')}`;
          }
          return urlStr;
        }).filter((u) => u.startsWith('http'));
      }
    } catch {
      // not JSON
    }
  }

  if (images.length === 0) {
    if (source === 'webtoonhatti' || source === 'hattorimanga') {
      images = extractWebtoonHattiImageUrls(doc);
    } else if (source === 'okutoon') {
      const readerImgs = Array.from(doc.querySelectorAll('.reader-area img, .chapter-content img, img[src*="okutoon"], img[data-src]'));
      images = readerImgs.map(extractImageSource).filter(Boolean);
    } else if (source === 'mangacix') {
      const cixImgs = Array.from(doc.querySelectorAll('div.manga-page img.manga-image, img[src*="cdn.mangacix.net"], .reading-content img'));
      images = cixImgs.map(extractImageSource).filter(Boolean);
    } else {
      const defaultImgs = Array.from(doc.querySelectorAll('.reading-content img, .page-break img, .entry-content img, #reader img, .reader-images img'));
      images = defaultImgs.map(extractImageSource).filter(Boolean);
    }
  }

  // Fallback: chapter_data script
  if (images.length === 0) {
    for (const script of Array.from(doc.querySelectorAll('script'))) {
      const content = script.textContent || '';
      if (!content.includes('chapter_data')) continue;

      try {
        const match = content.match(/chapter_data\s*=\s*({.*?});/s);
        if (!match) continue;

        const jsonData: unknown = JSON.parse(match[1]);
        if (isParsedChapterDataPayload(jsonData) && jsonData.images) {
          images = jsonData.images
            .map((img) => (typeof img.src === 'string' ? img.src.trim() : ''))
            .filter((src) => src.startsWith('http'));
        }
      } catch (error) {
        console.warn('Script parsing failed', error);
      }
    }
  }

  const finalImages = sanitizeAndDedupePageUrls(images, source);

  if (finalImages.length > 0) {
    return {
      status: 'ok',
      images: finalImages,
    };
  }

  if (source === 'siyahmelek' && doc.body?.textContent?.includes('VIP')) {
    return {
      status: 'locked',
      images: [],
      reason: 'VIP veya kilitli bölüm',
    };
  }

  return {
    status: 'error',
    images: [],
    reason: 'Sayfa görselleri bulunamadı',
  };
};

export const extractChapterImageUrls = (doc: Document, source: ScrapeSource): string[] => {
  return extractChapterImageResult(doc, source).images;
};

// ---------------------------------------------------------------------------
// Backward-Compatibility Helpers for Legacy
// ---------------------------------------------------------------------------

export const extractSiyahMelekChapterLinksFromHtml = (
  rawHtml: string,
  seriesUrl: string,
  seriesTitle?: string | null,
): ScrapedChapter[] => {
  return [];
};

export const extractSiyahMelekChapterPaginationUrlsFromHtml = (
  rawHtml: string,
  seriesUrl: string,
): string[] => {
  return [];
};

export const extractScrapedChapterPaginationUrls = (
  doc: Document,
  source: ScrapeSource,
  referenceUrl?: string,
): string[] => {
  return [];
};

export const buildScrapedChapterPaginationCandidates = (
  source: ScrapeSource,
  seriesUrl: string,
  explicitUrls: string[],
  maxProbePages = 12,
): string[] => {
  return explicitUrls;
};

export const applyChapterImageResultOptions = (
  imageResult: ScrapedChapterImageResult,
  source: ScrapeSource,
  options?: ChapterImageResultOptions,
): ScrapedChapterImageResult => {
  return imageResult;
};
