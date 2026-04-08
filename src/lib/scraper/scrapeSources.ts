import type { Manga, ScrapeSource as AppScrapeSource } from '@/lib/types';
import { syncAdultContentGenres } from '@/lib/adultContentFormat';
import { normalizeAdultMangaType } from '@/lib/mangaType';
import { filterRecognizedGenres } from '@/lib/mockData';

export type ScrapeSource = AppScrapeSource;

export interface ScrapedMangaCard {
  title: string;
  link: string;
  cover: string;
  genres: string[];
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

const SOURCE_CONFIG: Record<ScrapeSource, {
  label: string;
  baseUrl: string;
  searchUrl: (query: string) => string;
  listUrl: string;
  directLinkPatterns: RegExp[];
}> = {
  hayalistic: {
    label: 'Hayalistic',
    baseUrl: 'https://hayalistic.com',
    searchUrl: (query) => `https://hayalistic.com/?s=${encodeURIComponent(query)}&post_type=wp-manga`,
    listUrl: 'https://hayalistic.com/webtoonlar/',
    directLinkPatterns: [
      /https?:\/\/(?:www\.)?hayalistic\.(?:com|net)\/manga\/[^?#]+/i,
      /https?:\/\/(?:www\.)?hayalistic\.(?:com|net)\/webtoon\/[^?#]+/i,
    ],
  },
  webtoonhatti: {
    label: 'WebtoonHattı',
    baseUrl: 'https://webtoonhatti.club',
    searchUrl: (query) => `https://webtoonhatti.club/?s=${encodeURIComponent(query)}&post_type=wp-manga`,
    listUrl: 'https://webtoonhatti.club/webtoon/',
    directLinkPatterns: [
      /https?:\/\/(?:www\.)?webtoonhatti\.club\/webtoon\/[^?#]+/i,
    ],
  },
  siyahmelek: {
    label: 'SiyahMelek',
    baseUrl: 'https://siyahmelek.mom',
    searchUrl: (query) => `https://siyahmelek.mom/?s=${encodeURIComponent(query)}&post_type=wp-manga`,
    listUrl: 'https://siyahmelek.mom/manga/',
    directLinkPatterns: [
      /https?:\/\/(?:www\.)?siyahmelek\.mom\/manga\/[^?#]+/i,
    ],
  },
};

const normalizeScrapedText = (value?: string | null) =>
  value?.replace(/\s+/g, ' ').trim() || '';

const toScrapedKey = (value?: string | null) =>
  normalizeScrapedText(value).toLocaleLowerCase('tr-TR');

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

const getSummaryField = (doc: Document, labels: string[]) => {
  const normalizedLabels = labels.map((label) => label.toLocaleLowerCase('tr-TR'));

  const matchedItem = Array.from(doc.querySelectorAll('.post-content_item')).find((element) => {
    const text = element.textContent?.toLocaleLowerCase('tr-TR') || '';
    return normalizedLabels.some((label) => text.includes(label));
  });

  return normalizeScrapedText(
    matchedItem?.querySelector('.summary-content, .author-content a, .artist-content a, .genres-content a')?.textContent ||
    matchedItem?.querySelector('.summary-content')?.textContent,
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
  /contentrating["'\s:>]+18\+/i,
  /b[üu]y[üu]kler i[cç]in/i,
  /\badult\b/i,
  /\berotik\b/i,
];

const LOCKED_CHAPTER_PATTERNS = [
  /kilitli b[öo]l[üu]m/i,
  /vip [üu]yeler bu b[öo]l[üu]m[üu]/i,
  /erken okuyabilir/i,
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

const SIYAHMELEK_PAGINATION_SELECTORS = [
  '.wp-pagenavi a',
  '.wp-pagenavi span',
  '.pagination a',
  '.pagination span',
  '.page-numbers a',
  'a.page-numbers',
  '.page-numbers',
];

export const getScrapedPaginationPageNumber = (value: string) => {
  const match = value.match(/\/bolum\/page\/(\d+)\/?/i) || value.match(/\/page\/(\d+)\/?/i);
  return match ? Number(match[1]) : 1;
};

const formatScrapedChapterNumber = (value: number) => (
  Number.isInteger(value) ? String(value) : String(value)
);

const getSiyahMelekChapterLabel = (number?: number) => (
  typeof number === 'number' && number > 0
    ? `Bölüm ${formatScrapedChapterNumber(number)}`
    : ''
);

const extractRawChapterText = (container: Element, anchor: HTMLAnchorElement) => {
  const directTitle = normalizeScrapedText(
    anchor.getAttribute('title')
    || anchor.querySelector('.chapter-manhwa-title, .chapter-title, .chapternum, .chapter-name')?.textContent
    || container.querySelector('.chapter-manhwa-title, .chapter-title, .chapternum, .chapter-name')?.textContent,
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

const sanitizeScrapedChapterName = (
  value?: string | null,
  number?: number,
  seriesTitle?: string | null,
) => {
  let nextValue = normalizeScrapedText(value);

  if (!nextValue) {
    return '';
  }

  if (seriesTitle) {
    const escapedSeriesTitle = seriesTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    nextValue = nextValue.replace(new RegExp(`^${escapedSeriesTitle}\\s*[-–—:|]?\\s*`, 'i'), '').trim();
  }

  nextValue = nextValue.replace(/^[-–—:|]+/, '').trim();
  nextValue = nextValue
    .replace(/\s+\d+\s*(?:dakika|saat|g[üu]n|hafta|ay|y[ıi]l)(?:\s+\d+(?:[.,]\d+)?\s*[kmb])?(?:\s+\d+)?$/iu, '')
    .replace(/\s+\d+(?:[.,]\d+)?\s*[kmb]\s+\d+$/iu, '')
    .trim();

  const chapterMarker = nextValue.match(/(b[öo]l[üu]m\s*\d+(?:\.\d+)?(?:\s*[-–—:]\s*.+)?)$/iu);
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

  if (CHAPTER_SHORTCUT_PATTERNS.some((pattern) => pattern.test(nextValue))) {
    return '';
  }

  if (!nextValue && typeof number === 'number' && number > 0) {
    return `Bölüm ${number}`;
  }

  if (nextValue && !/b[öo]l[üu]m/i.test(nextValue) && typeof number === 'number' && number > 0) {
    return `Bölüm ${number}`;
  }

  return nextValue;
};

const stripChapterHtmlTags = (value: string) => (
  normalizeScrapedText(
    value
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&#8211;|&ndash;/gi, '-')
      .replace(/&#8212;|&mdash;/gi, '-')
      .replace(/&#39;|&apos;/gi, "'")
      .replace(/&quot;/gi, '"')
      .replace(/&amp;/gi, '&'),
  )
);

const SIYAHMELEK_CHAPTER_LINK_PATTERN = /<a\b[^>]*href=["']([^"']*\/bolum-\d+\/?)["'][^>]*>([\s\S]*?)<\/a>/gi;
const SIYAHMELEK_PAGINATION_LINK_PATTERN = /<a\b[^>]*href=["']([^"']*\/bolum\/page\/\d+\/[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;

export const extractSiyahMelekChapterLinksFromHtml = (
  rawHtml: string,
  seriesUrl: string,
  seriesTitle?: string | null,
) => {
  const normalizedSeriesUrl = normalizeScrapeSeriesUrl('siyahmelek', seriesUrl);
  if (!normalizedSeriesUrl || !rawHtml.trim()) {
    return [] as ScrapedChapter[];
  }

  let parsedSeriesUrl: URL;
  try {
    parsedSeriesUrl = new URL(normalizedSeriesUrl);
  } catch {
    return [] as ScrapedChapter[];
  }

  const seriesReferencePath = parsedSeriesUrl.pathname.replace(/\/$/, '');
  const chapters = new Map<string, ScrapedChapter>();

  for (const match of rawHtml.matchAll(SIYAHMELEK_CHAPTER_LINK_PATTERN)) {
    const href = normalizeUrl(SOURCE_CONFIG.siyahmelek.baseUrl, match[1]);
    if (!href) {
      continue;
    }

    let parsedHref: URL;
    try {
      parsedHref = new URL(href);
    } catch {
      continue;
    }

    const pathname = parsedHref.pathname.replace(/\/$/, '');
    if (!pathname.includes('/bolum-')) {
      continue;
    }

    if (seriesReferencePath && !pathname.startsWith(`${seriesReferencePath}/`)) {
      continue;
    }

    const rawName = stripChapterHtmlTags(match[2] || '');
    const numberMatch = `${rawName} ${href}`.match(/(\d+(?:\.\d+)?)/);
    const number = numberMatch ? parseFloat(numberMatch[1]) : 0;
    const name = getSiyahMelekChapterLabel(number) || sanitizeScrapedChapterName(rawName, number, seriesTitle);
    if (!name) {
      continue;
    }

    chapters.set(href, {
      name,
      link: href,
      number,
    });
  }

  return Array.from(chapters.values()).sort((left, right) => left.number - right.number);
};

export const extractSiyahMelekChapterPaginationUrlsFromHtml = (
  rawHtml: string,
  seriesUrl: string,
) => {
  const normalizedSeriesUrl = normalizeScrapeSeriesUrl('siyahmelek', seriesUrl);
  if (!normalizedSeriesUrl || !rawHtml.trim()) {
    return [] as string[];
  }

  let parsedSeriesUrl: URL;
  try {
    parsedSeriesUrl = new URL(normalizedSeriesUrl);
  } catch {
    return [] as string[];
  }

  const seriesReferencePath = parsedSeriesUrl.pathname.replace(/\/$/, '');
  const urls = new Set<string>();

  for (const match of rawHtml.matchAll(SIYAHMELEK_PAGINATION_LINK_PATTERN)) {
    const href = normalizeUrl(SOURCE_CONFIG.siyahmelek.baseUrl, match[1]);
    if (!href) {
      continue;
    }

    try {
      const parsedHref = new URL(href);
      if (!parsedHref.pathname.startsWith(seriesReferencePath)) {
        continue;
      }

      urls.add(parsedHref.href);
    } catch {
      continue;
    }
  }

  return Array.from(urls).sort((left, right) => getScrapedPaginationPageNumber(right) - getScrapedPaginationPageNumber(left));
};

const extractCardLink = (element: Element, baseUrl: string) => {
  const titleLink = element.querySelector('.post-title a, .post-title h3 a, h3 a, a[href*="/webtoon/"], a[href*="/manga/"]') as HTMLAnchorElement | null;

  return normalizeUrl(baseUrl, titleLink?.href || titleLink?.getAttribute('href'));
};

const extractCardCover = (element: Element, baseUrl: string) => {
  const image = element.querySelector('img');
  return normalizeUrl(
    baseUrl,
    image?.getAttribute('data-src') ||
    image?.getAttribute('data-lazy-src') ||
    image?.getAttribute('src'),
  );
};

const extractCardGenres = (element: Element) => {
  const genreLinks = Array.from(
    element.querySelectorAll('a[href*="/webtoon-tur/"], .list-genre a, .genres-item a, .genres-content a, .post-content_item.mg_genres a, .post-content_item.mg_genres .summary-content'),
  );

  return genreLinks
    .map((link) => normalizeScrapedText(link.textContent))
    .filter(Boolean);
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

const getSearchCardElements = (doc: Document, source: ScrapeSource) => {
  if (source === 'webtoonhatti') {
    return Array.from(doc.querySelectorAll(
      '.row.c-tabs-item__content, #loop-content > .row, .page-content-listing .row.c-tabs-item__content, .c-tabs-item__content, .page-item-detail.manga',
    ));
  }

  return Array.from(doc.querySelectorAll('.page-item-detail.manga, .c-tabs-item__content, .manga-item'));
};

const extractWebtoonHattiCardsFromHtml = (html: string): ScrapedMangaCard[] => {
  const cards: ScrapedMangaCard[] = [];
  const seenKeys = new Set<string>();
  const titlePattern = /<h3 class="h4">\s*<a href="([^"]+)">([\s\S]*?)<\/a>\s*<\/h3>/gi;

  for (const match of html.matchAll(titlePattern)) {
    const link = normalizeUrl(SOURCE_CONFIG.webtoonhatti.baseUrl, decodeHtmlValue(match[1] || ''));
    const title = normalizeScrapedText(stripHtmlTags(decodeHtmlValue(match[2] || '')));

    if (!link || !title) {
      continue;
    }

    const key = `${title.toLocaleLowerCase('tr-TR')}|${link}`;
    if (seenKeys.has(key)) {
      continue;
    }

    seenKeys.add(key);

    const snippetStart = Math.max(0, (match.index || 0) - 1800);
    const snippetEnd = Math.min(html.length, (match.index || 0) + 1800);
    const snippet = html.slice(snippetStart, snippetEnd);
    const imageMatches = Array.from(
      snippet.matchAll(/<img[^>]+(?:data-src|data-lazy-src|src)="([^"]+)"/gi),
    );
    const lastImageMatch = imageMatches.length > 0 ? imageMatches[imageMatches.length - 1] : undefined;
    const cover = normalizeUrl(
      SOURCE_CONFIG.webtoonhatti.baseUrl,
      decodeHtmlValue(lastImageMatch?.[1] || ''),
    );
    const genres = Array.from(
      snippet.matchAll(/<a[^>]+href="[^"]*\/webtoon-tur\/[^"]*"[^>]*>([\s\S]*?)<\/a>/gi),
    )
      .map((genreMatch) => normalizeScrapedText(stripHtmlTags(decodeHtmlValue(genreMatch[1] || ''))))
      .filter(Boolean);

    cards.push({
      title,
      link,
      cover,
      genres,
    });
  }

  return cards;
};

const parseWebtoonHattiSearchFallbackCard = (doc: Document): ScrapedMangaCard[] => {
  const detailUrl = normalizeUrl(
    SOURCE_CONFIG.webtoonhatti.baseUrl,
    doc.querySelector('meta[property="og:url"]')?.getAttribute('content'),
  );
  const cover = normalizeUrl(
    SOURCE_CONFIG.webtoonhatti.baseUrl,
    doc.querySelector('meta[property="og:image"]')?.getAttribute('content'),
  );
  const rawTitle = normalizeScrapedText(
    doc.querySelector('meta[property="og:title"]')?.getAttribute('content')
    || doc.querySelector('title')?.textContent,
  );
  const title = rawTitle
    .replace(/\s+için arama yaptınız.*$/i, '')
    .replace(/\s*[-|].*$/, '')
    .trim();
  const pageText = normalizeScrapedText(doc.body?.textContent || '');
  const isSearchResultPage = /için arama yapt/i.test(rawTitle) || /sonuç bulundu/i.test(pageText);
  const hasDetailMarkers = Boolean(
    doc.querySelector('.summary_image, .summary_image img, .profile-manga, .tab-summary, .post-status'),
  );

  if (!detailUrl || !title || isSearchResultPage || !hasDetailMarkers) {
    return [];
  }

  return [{
    title,
    link: detailUrl,
    cover,
    genres: [],
  }];
};

export const getAvailableScrapeSources = (): ScrapeSource[] => Object.keys(SOURCE_CONFIG) as ScrapeSource[];

export const isScrapeSource = (value: string): value is ScrapeSource => (
  value === 'hayalistic' || value === 'webtoonhatti' || value === 'siyahmelek'
);

export const isAdultOnlyScrapeSource = (source: ScrapeSource) => source === 'siyahmelek';

export const getScrapeSourceLabel = (source: ScrapeSource) => SOURCE_CONFIG[source].label;

export const getScrapeSourceBaseUrl = (source: ScrapeSource) => SOURCE_CONFIG[source].baseUrl;

export const getDefaultScrapeSource = (): ScrapeSource => 'hayalistic';

export const readPreferredScrapeSource = (): ScrapeSource => {
  if (typeof window !== 'undefined') {
    const stored = window.localStorage.getItem(SCRAPE_SOURCE_STORAGE_KEY);

    if (stored && isScrapeSource(stored)) {
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

export const buildScrapeSearchUrl = (source: ScrapeSource, query: string) => (
  query.trim()
    ? SOURCE_CONFIG[source].searchUrl(query.trim())
    : SOURCE_CONFIG[source].listUrl
);

export const isDirectScrapeLink = (source: ScrapeSource, value: string) => (
  SOURCE_CONFIG[source].directLinkPatterns.some((pattern) => pattern.test(value.trim()))
);

export const detectScrapeSourceFromUrl = (value: string): ScrapeSource | null => {
  const normalized = value.trim().toLocaleLowerCase('tr-TR');

  if (normalized.includes('siyahmelek.mom')) {
    return 'siyahmelek';
  }

  if (normalized.includes('webtoonhatti.club')) {
    return 'webtoonhatti';
  }

  if (normalized.includes('hayalistic.com') || normalized.includes('hayalistic.net')) {
    return 'hayalistic';
  }

  return null;
};

export const normalizeScrapeUrl = (source: ScrapeSource, value?: string | null) => {
  return normalizeUrl(SOURCE_CONFIG[source].baseUrl, value);
};

export const normalizeScrapeSeriesUrl = (source: ScrapeSource, value?: string | null) => {
  const normalized = normalizeUrl(SOURCE_CONFIG[source].baseUrl, value);
  return normalized ? normalizeSourceUrl(source, normalized) : '';
};

export const extractScrapedMangaCards = (doc: Document, source: ScrapeSource, rawHtml?: string): ScrapedMangaCard[] => {
  const cards: ScrapedMangaCard[] = [];
  const seenKeys = new Set<string>();

  for (const element of getSearchCardElements(doc, source)) {
    const titleLink = element.querySelector('.post-title a, .post-title h3 a, h3 a, a[href*="/webtoon/"], a[href*="/manga/"]');
    const title = normalizeScrapedText(titleLink?.textContent || element.querySelector('.post-title')?.textContent);
    const link = extractCardLink(element, SOURCE_CONFIG[source].baseUrl);

    if (!title || !link) {
      continue;
    }

    const key = `${title.toLocaleLowerCase('tr-TR')}|${link}`;
    if (seenKeys.has(key)) {
      continue;
    }
    seenKeys.add(key);

    cards.push({
      title,
      link,
      cover: extractCardCover(element, SOURCE_CONFIG[source].baseUrl),
      genres: extractCardGenres(element),
    });
  }

  if (cards.length === 0 && source === 'webtoonhatti' && rawHtml) {
    const htmlCards = extractWebtoonHattiCardsFromHtml(rawHtml);
    if (htmlCards.length > 0) {
      return htmlCards;
    }
  }

  if (cards.length === 0 && source === 'webtoonhatti') {
    return parseWebtoonHattiSearchFallbackCard(doc);
  }

  return cards;
};

const extractDetailTitle = (doc: Document) => {
  const titleElement = doc.querySelector('.post-title h1, .post-title .entry-title, .post-title');

  if (!titleElement) {
    return sanitizeDetailTitleText(
      doc.querySelector('meta[property="og:title"]')?.getAttribute('content')
      || doc.querySelector('title')?.textContent
      || '',
    ).replace(/\s*-\s*Siyah.*$/i, '');
  }

  const clonedTitleElement = titleElement.cloneNode(true) as Element;
  clonedTitleElement
    .querySelectorAll(
      '.manga-title-badges, .post-title-badges, .hot, .new, .status, .badge, .label, [class*="badge"], [class*="status"]',
    )
    .forEach((badgeNode) => badgeNode.remove());

  const cleanedTitle = sanitizeDetailTitleText(clonedTitleElement.textContent);
  if (cleanedTitle) {
    return cleanedTitle;
  }

  return sanitizeDetailTitleText(titleElement.textContent);
};

const extractDetailCover = (doc: Document, source: ScrapeSource) => {
  const image = doc.querySelector('.summary_image img, .summary-image img, .post-thumbnail img');

  return normalizeUrl(
    SOURCE_CONFIG[source].baseUrl,
    image?.getAttribute('data-src') ||
    image?.getAttribute('data-lazy-src') ||
    image?.getAttribute('src')
    || doc.querySelector('meta[property="og:image"]')?.getAttribute('content'),
  );
};

const extractTextFromSelectors = (doc: Document, selectors: string[]) => {
  for (const selector of selectors) {
    const element = doc.querySelector(selector);
    const value = normalizeScrapedText(element?.textContent);
    if (value) {
      return value;
    }
  }

  return '';
};

const extractJoinedTextFromSelectors = (doc: Document, selectors: string[]) => {
  for (const selector of selectors) {
    const elements = Array.from(doc.querySelectorAll(selector));
    const value = normalizeScrapedText(
      elements
        .map((element) => normalizeScrapedText(element.textContent))
        .filter(Boolean)
        .join(' '),
    );

    if (value) {
      return value;
    }
  }

  return '';
};

const extractDescription = (doc: Document, source: ScrapeSource) => {
  const prioritizedParagraphSelectors = source === 'siyahmelek'
    ? [
      '.description-summary .summary__content.show-more p',
      '.description-summary .summary__content p',
      '.summary__content.show-more p',
      '.summary__content p',
    ]
    : source === 'webtoonhatti'
      ? [
        '.manga-excerpt.summary__content.show-more p',
        '.summary__content.show-more p',
        '.description-summary .summary__content p',
        '.manga-excerpt p',
      ]
      : [];

  const paragraphValue = extractJoinedTextFromSelectors(doc, prioritizedParagraphSelectors);
  if (paragraphValue) {
    return paragraphValue;
  }

  const selectors = source === 'siyahmelek'
    ? [
      '.description-summary .summary__content.show-more',
      '.description-summary .summary__content',
      '.summary__content.show-more',
      '.summary__content',
      '.manga-excerpt',
      '.post-content_item p',
    ]
    : source === 'webtoonhatti'
      ? [
        '.manga-excerpt.summary__content.show-more',
        '.summary__content.show-more',
        '.description-summary .summary__content',
        '.manga-excerpt',
        '.post-content_item p',
      ]
      : [
        '.description-summary .summary__content',
        '.manga-excerpt',
        '.post-content_item p',
      ];

  const value = extractTextFromSelectors(doc, selectors);
  if (value) {
    return value;
  }

  return normalizeScrapedText(
    doc.querySelector('meta[property="og:description"]')?.getAttribute('content')
    || doc.querySelector('meta[name="description"]')?.getAttribute('content'),
  ).replace(/\s*-\s*Hentai oku.*$/i, '');
};

const extractDetailStatus = (doc: Document) => {
  const statusField = Array.from(doc.querySelectorAll('.post-content_item'))
    .find((element) => element.textContent?.toLocaleLowerCase('tr-TR').includes('durum'));

  const statusText = normalizeScrapedText(
    statusField?.querySelector('.summary-content')?.textContent || statusField?.textContent,
  );

  if (!statusText) {
    return 'ongoing' as const;
  }

  return statusText.toLocaleLowerCase('tr-TR').includes('tamam') || statusText.toLocaleLowerCase('tr-TR').includes('fin')
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
  const field = Array.from(doc.querySelectorAll('.post-content_item'))
    .find((element) => labels.some((label) => element.textContent?.toLocaleLowerCase('tr-TR').includes(label.toLocaleLowerCase('tr-TR'))));

  const linkedNames = Array.from(field?.querySelectorAll('.author-content a, .artist-content a, .summary-content a') || [])
    .map((item) => extractPrimaryScrapedPersonName(item.textContent))
    .filter(Boolean);
  const extractedName = linkedNames.length > 0
    ? linkedNames.join(', ')
    : extractPrimaryScrapedPersonName(
      normalizeScrapedText(field?.querySelector('.author-content, .artist-content, .summary-content')?.textContent) || fallback,
    );

  return isScrapedPlaceholderValue(extractedName) ? '' : extractedName;
};

const extractGenres = (doc: Document, fallbackGenres: string[], source?: ScrapeSource) => {
  const genreElements = doc.querySelectorAll([
    '.genres-content a',
    '.post-content_item .summary-content a',
    '.summary-content a[href*="/webtoon-tur/"]',
    '.summary-content a[href*="/manga-genre/"]',
    '.summary-content a[href*="/manga-tag/"]',
    '.post-content_item.mg_genres a',
    '.tagcloud a',
  ].join(', '));
  const candidateGenres = Array.from(genreElements)
    .map((genre) => normalizeScrapedText(genre.textContent))
    .filter(Boolean);

  const genres = candidateGenres.length > 0 ? candidateGenres : fallbackGenres;
  return source === 'siyahmelek' ? filterRecognizedGenres(genres) : genres;
};

const extractReleaseYear = (doc: Document) => {
  const yearField = Array.from(doc.querySelectorAll('.post-content_item'))
    .find((element) => {
      const text = element.textContent?.toLocaleLowerCase('tr-TR') || '';
      return text.includes('yıl') || text.includes('salınış') || text.includes('yayin') || text.includes('release');
    });

  const yearText = normalizeScrapedText(yearField?.querySelector('.summary-content')?.textContent || yearField?.textContent);
  if (!yearText || isScrapedPlaceholderValue(yearText)) {
    return undefined;
  }

  const yearMatch = yearText.match(/\d{4}/);

  return yearMatch ? parseInt(yearMatch[0], 10) : undefined;
};

const extractAlternativeTitles = (doc: Document, mainTitle?: string) => {
  const altTitlesField = Array.from(doc.querySelectorAll('.post-content_item'))
    .find((element) => {
      const text = element.textContent?.toLocaleLowerCase('tr-TR') || '';
      return text.includes('diğer ad') || text.includes('alt isim') || text.includes('alternatif');
    });

  const altTitlesText = normalizeScrapedText(altTitlesField?.querySelector('.summary-content')?.textContent || altTitlesField?.textContent);

  return sanitizeAlternativeTitles(altTitlesText, mainTitle);
};

const inferAdultContent = (doc: Document, source: ScrapeSource, genres: string[], fallbackGenres: string[]) => {
  if (isAdultOnlyScrapeSource(source)) {
    return true;
  }

  const contentToInspect = [
    genres.join(' '),
    fallbackGenres.join(' '),
    normalizeScrapedText(doc.body?.textContent || ''),
    Array.from(doc.querySelectorAll('script[type="application/ld+json"], script'))
      .map((script) => script.textContent || '')
      .join(' '),
  ].join(' ');

  return ADULT_CONTENT_PATTERNS.some((pattern) => pattern.test(contentToInspect));
};

export const extractScrapedChapterLinks = (doc: Document, source: ScrapeSource) => {
  const chapterSelectors = source === 'siyahmelek'
    ? [
      '.wp-manga-chapter a',
      '.listing-chapters_wrap a[href*="/bolum-"]',
      '.page-content-listing a[href*="/bolum-"]',
      '.version-chap a[href*="/bolum-"]',
      '.main.version-chap a[href*="/bolum-"]',
      '.chapter-link a[href*="/bolum-"]',
      'a[href*="/bolum-"]',
    ]
    : ['.wp-manga-chapter a'];
  const seriesReferenceUrl = normalizeUrl(
    SOURCE_CONFIG[source].baseUrl,
    doc.querySelector('meta[property="og:url"]')?.getAttribute('content')
      || doc.querySelector('link[rel="canonical"]')?.getAttribute('href'),
  );
  const seriesReferencePath = (() => {
    if (!seriesReferenceUrl) {
      return '';
    }

    try {
      return new URL(seriesReferenceUrl).pathname
        .replace(/\/$/, '')
        .replace(/\/bolum\/page\/\d+$/i, '')
        .replace(/\/bolum$/i, '')
        .replace(/\/bolum-[^/]+$/i, '');
    } catch {
      return '';
    }
  })();
  const seriesTitle = sanitizeDetailTitleText(
    doc.querySelector('.post-title h1, .post-title .entry-title, .post-title')?.textContent
    || doc.querySelector('meta[property="og:title"]')?.getAttribute('content')
    || '',
  );
  const chapters = new Map<string, ScrapedChapter>();

  for (const linkEl of Array.from(doc.querySelectorAll(chapterSelectors.join(', ')))) {
    const anchor = linkEl as HTMLAnchorElement;
    const container = anchor.closest('.wp-manga-chapter, li, .chapter-link') || anchor;
    const link = normalizeUrl(SOURCE_CONFIG[source].baseUrl, anchor.href || anchor.getAttribute('href'));
    if (!link) {
      continue;
    }

    let parsedLink: URL | null = null;
    try {
      parsedLink = new URL(link);
    } catch {
      parsedLink = null;
    }

    if (source === 'siyahmelek') {
      const pathname = parsedLink?.pathname.replace(/\/$/, '') || '';
      if (!pathname.includes('/bolum-')) {
        continue;
      }

      if (seriesReferencePath && !pathname.startsWith(`${seriesReferencePath}/`)) {
        continue;
      }
    }

    const rawName = extractRawChapterText(container, anchor);
    const numberMatch = `${rawName} ${link}`.match(/(\d+(?:\.\d+)?)/);
    const number = numberMatch ? parseFloat(numberMatch[1]) : 0;
    const name = source === 'siyahmelek'
      ? (getSiyahMelekChapterLabel(number) || sanitizeScrapedChapterName(rawName, number, seriesTitle))
      : sanitizeScrapedChapterName(rawName, number, seriesTitle);

    if (!name) {
      continue;
    }

    chapters.set(link, {
      name,
      link,
      number,
    });
  }

  return [...chapters.values()].sort((a, b) => a.number - b.number);
};

export const extractScrapedChapterPaginationUrls = (
  doc: Document,
  source: ScrapeSource,
  referenceUrl?: string,
) => {
  if (source !== 'siyahmelek') {
    return [] as string[];
  }

  const seriesReferenceUrl = normalizeUrl(
    SOURCE_CONFIG[source].baseUrl,
    referenceUrl
      || doc.querySelector('meta[property="og:url"]')?.getAttribute('content')
      || doc.querySelector('link[rel="canonical"]')?.getAttribute('href'),
  );

  if (!seriesReferenceUrl) {
    return [];
  }

  let parsedSeriesUrl: URL;
  try {
    parsedSeriesUrl = new URL(seriesReferenceUrl);
  } catch {
    return [];
  }

  const seriesReferencePath = parsedSeriesUrl.pathname
    .replace(/\/$/, '')
    .replace(/\/bolum\/page\/\d+$/i, '')
    .replace(/\/bolum$/i, '')
    .replace(/\/bolum-[^/]+$/i, '');

  const urls = new Set<string>([
    `${parsedSeriesUrl.origin}${seriesReferencePath}/`,
  ]);

  let maxPage = 1;
  for (const element of Array.from(doc.querySelectorAll(SIYAHMELEK_PAGINATION_SELECTORS.join(', ')))) {
    const pageLabel = normalizeScrapedText(element.textContent);
    if (/^\d+$/.test(pageLabel)) {
      maxPage = Math.max(maxPage, Number(pageLabel));
    }

    const href = normalizeUrl(
      SOURCE_CONFIG[source].baseUrl,
      (element as HTMLAnchorElement).href || element.getAttribute('href'),
    );

    if (!href) {
      continue;
    }

    try {
      const parsedPageUrl = new URL(href);
      const sameSeries = parsedPageUrl.pathname.startsWith(seriesReferencePath);
      const looksLikePageLink = /\/bolum\/page\/\d+\/?$/i.test(parsedPageUrl.pathname)
        || /\/page\/\d+\/?$/i.test(parsedPageUrl.pathname)
        || parsedPageUrl.searchParams.has('page')
        || /^\d+$/.test(pageLabel);

      if (sameSeries && looksLikePageLink) {
        urls.add(parsedPageUrl.href);
      }
    } catch {
      continue;
    }
  }

  if (maxPage > 1) {
    for (let pageNumber = 2; pageNumber <= maxPage; pageNumber += 1) {
      urls.add(`${parsedSeriesUrl.origin}${seriesReferencePath}/bolum/page/${pageNumber}/#chapter-list`);
    }
  }

  return Array.from(urls).sort((left, right) => getScrapedPaginationPageNumber(right) - getScrapedPaginationPageNumber(left));
};

export const buildScrapedChapterPaginationCandidates = (
  source: ScrapeSource,
  seriesUrl: string,
  explicitUrls: string[],
  maxProbePages = 12,
) => {
  if (source !== 'siyahmelek') {
    return explicitUrls;
  }

  const normalizedSeriesUrl = normalizeScrapeSeriesUrl(source, seriesUrl);
  if (!normalizedSeriesUrl) {
    return [];
  }

  const normalizedExplicitUrls = explicitUrls
    .filter((url) => url && url !== normalizedSeriesUrl)
    .sort((left, right) => getScrapedPaginationPageNumber(right) - getScrapedPaginationPageNumber(left));

  const pageUrls = new Set<string>(normalizedExplicitUrls);
  const maxExplicitPage = normalizedExplicitUrls.reduce((maxPage, url) => {
    return Math.max(maxPage, getScrapedPaginationPageNumber(url));
  }, 1);
  const seriesBase = normalizedSeriesUrl.replace(/\/$/, '');

  if (normalizedExplicitUrls.length === 0) {
    for (let pageNumber = 2; pageNumber <= maxProbePages; pageNumber += 1) {
      pageUrls.add(`${seriesBase}/bolum/page/${pageNumber}/`);
    }
  } else {
    const maxExtraProbePage = Math.min(maxProbePages, maxExplicitPage + 2);
    for (let pageNumber = maxExplicitPage + 1; pageNumber <= maxExtraProbePage; pageNumber += 1) {
      pageUrls.add(`${seriesBase}/bolum/page/${pageNumber}/`);
    }
  }

  return Array.from(pageUrls).sort((left, right) => {
    const leftPage = getScrapedPaginationPageNumber(left);
    const rightPage = getScrapedPaginationPageNumber(right);
    const leftExplicit = normalizedExplicitUrls.includes(left);
    const rightExplicit = normalizedExplicitUrls.includes(right);

    if (leftExplicit && !rightExplicit) {
      return -1;
    }

    if (!leftExplicit && rightExplicit) {
      return 1;
    }

    return rightPage - leftPage;
  });
};

export const extractScrapedMangaDetail = (
  doc: Document,
  source: ScrapeSource,
  fallbackCard: ScrapedMangaCard,
): ScrapedMangaDraft => {
  const detailTitle = extractDetailTitle(doc);
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

const extractImageSource = (img: Element) => {
  const image = img as HTMLImageElement;
  const src = normalizeScrapedText(
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

const getChapterImageElements = (doc: Document, source: ScrapeSource) => {
  if (source === 'webtoonhatti') {
    return Array.from(doc.querySelectorAll('.reading-content img.wp-manga-chapter-img, .reading-content .wp-manga-chapter-img'));
  }

  return Array.from(doc.querySelectorAll('.reading-content img, .wp-manga-chapter-img, .page-break img, .entry-content img'));
};

const WEBTOONHATTI_HIDDEN_STYLE_PATTERN = /(display\s*:\s*none|visibility\s*:\s*hidden)/i;
const WEBTOONHATTI_JUNK_URL_FRAGMENTS = [
  'whatthe',
  'plase',
  'yaaxa',
  '/wp-content/uploads/2024/02/tr2.png',
  '/wp-content/uploads/2025/08/z9.jpg',
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

const isWebtoonHattiJunkImageUrl = (value: string) => {
  const normalized = value.toLocaleLowerCase('tr-TR');
  return WEBTOONHATTI_JUNK_URL_FRAGMENTS.some((fragment) => normalized.includes(fragment));
};

export const sanitizeChapterPageUrls = (images: string[]) => (
  Array.from(
    new Set(
      images
        .map((image) => normalizeScrapedText(image))
        .map((image) => (image.startsWith('//') ? `https:${image}` : image))
        .filter((image) => image.startsWith('http') && !image.includes('base64'))
        .filter((image) => !isWebtoonHattiJunkImageUrl(image)),
    ),
  )
);

const SIYAHMELEK_INLINE_IMAGE_PATTERN = /https:\/\/s3\.melek\.lol\/api\/(?:uploads|amazon)\/[^"'\\\s<>]+\.(?:jpe?g|png|webp|gif)/gi;

const extractSiyahMelekInlineImageUrls = (doc: Document) => {
  const html = doc.documentElement?.outerHTML || '';
  if (!html) {
    return [] as string[];
  }

  return sanitizeChapterPageUrls(
    Array.from(html.matchAll(SIYAHMELEK_INLINE_IMAGE_PATTERN)).map((match) => match[0]),
  );
};

const hasLockedChapterMarkers = (doc: Document) => {
  const text = normalizeScrapedText(doc.body?.textContent || '');
  return LOCKED_CHAPTER_PATTERNS.some((pattern) => pattern.test(text));
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
    return sanitizeChapterPageUrls(orderedImages);
  }

  return sanitizeChapterPageUrls(
    Array.from(doc.querySelectorAll('.reading-content img'))
      .filter((img) => !isElementVisuallyHidden(img))
      .map((img) => extractImageSource(img))
      .filter((src) => src && !isWebtoonHattiJunkImageUrl(src)),
  );
};

export const extractChapterImageUrls = (doc: Document, source: ScrapeSource): string[] => {
  return extractChapterImageResult(doc, source).images;
};

export const applyChapterImageResultOptions = (
  imageResult: ScrapedChapterImageResult,
  source: ScrapeSource,
  options?: ChapterImageResultOptions,
): ScrapedChapterImageResult => {
  if (
    imageResult.status !== 'ok'
    || source !== 'siyahmelek'
    || options?.excludeSiyahMelekPromoFirstPage !== true
  ) {
    return imageResult;
  }

  if (imageResult.images.length <= 1) {
    return imageResult;
  }

  const trimmedImages = imageResult.images.slice(1);
  if (trimmedImages.length === 0) {
    return {
      status: 'error',
      images: [],
      reason: 'İlk reklam görseli çıkarılınca bölüm sayfası kalmadı',
    };
  }

  return {
    ...imageResult,
    images: trimmedImages,
  };
};

export const extractChapterImageResult = (
  doc: Document,
  source: ScrapeSource,
  options?: ChapterImageResultOptions,
): ScrapedChapterImageResult => {
  let images = source === 'webtoonhatti'
    ? extractWebtoonHattiImageUrls(doc)
    : getChapterImageElements(doc, source)
      .map((img) => extractImageSource(img))
      .filter(Boolean);

  if (images.length === 0) {
    for (const script of Array.from(doc.querySelectorAll('script'))) {
      const content = script.textContent || '';
      if (!content.includes('chapter_data')) {
        continue;
      }

      try {
        const match = content.match(/chapter_data\s*=\s*({.*?});/s);
        if (!match) {
          continue;
        }

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

  const sanitizedImages = sanitizeChapterPageUrls(images);
  const inlineSiyahMelekImages = source === 'siyahmelek' && sanitizedImages.length === 0
    ? extractSiyahMelekInlineImageUrls(doc)
    : [];
  const finalImages = sanitizedImages.length > 0 ? sanitizedImages : inlineSiyahMelekImages;

  if (finalImages.length > 0) {
    return applyChapterImageResultOptions({
      status: 'ok',
      images: finalImages,
    }, source, options);
  }

  if (source === 'siyahmelek' && hasLockedChapterMarkers(doc)) {
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
