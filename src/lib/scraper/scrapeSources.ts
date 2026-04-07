import type { Manga } from '@/lib/types';

export type ScrapeSource = 'hayalistic' | 'webtoonhatti';

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
  value === 'hayalistic' || value === 'webtoonhatti'
);

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

  if (normalized.includes('webtoonhatti.club')) {
    return 'webtoonhatti';
  }

  if (normalized.includes('hayalistic.com') || normalized.includes('hayalistic.net')) {
    return 'hayalistic';
  }

  return null;
};

export const normalizeScrapeUrl = (source: ScrapeSource, value?: string | null) => (
  normalizeUrl(SOURCE_CONFIG[source].baseUrl, value)
);

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
    return '';
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
    image?.getAttribute('src'),
  );
};

const extractDescription = (doc: Document, source: ScrapeSource) => {
  const selectors = source === 'webtoonhatti'
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

  for (const selector of selectors) {
    const value = normalizeScrapedText(doc.querySelector(selector)?.textContent);
    if (value) {
      return value;
    }
  }

  return '';
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

const extractGenres = (doc: Document, fallbackGenres: string[]) => {
  const genreElements = doc.querySelectorAll('.genres-content a, .summary-content a[href*="/webtoon-tur/"]');
  const genres = Array.from(genreElements)
    .map((genre) => normalizeScrapedText(genre.textContent))
    .filter(Boolean);

  return genres.length > 0 ? genres : fallbackGenres;
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

export const extractScrapedChapterLinks = (doc: Document, source: ScrapeSource) => {
  const chapters: ScrapedChapter[] = [];

  for (const element of doc.querySelectorAll('.wp-manga-chapter')) {
    const linkEl = element.querySelector('a') as HTMLAnchorElement | null;

    if (!linkEl) {
      continue;
    }

    const name = normalizeScrapedText(linkEl.textContent);
    const link = normalizeUrl(SOURCE_CONFIG[source].baseUrl, linkEl.href || linkEl.getAttribute('href'));
    const numberMatch = `${name} ${link}`.match(/(\d+(?:\.\d+)?)/);
    const number = numberMatch ? parseFloat(numberMatch[1]) : 0;

    if (!name || !link) {
      continue;
    }

    chapters.push({
      name,
      link,
      number,
    });
  }

  return chapters.sort((a, b) => a.number - b.number);
};

export const extractScrapedMangaDetail = (
  doc: Document,
  source: ScrapeSource,
  fallbackCard: ScrapedMangaCard,
): ScrapedMangaDraft => {
  const detailTitle = extractDetailTitle(doc);
  const detailCover = extractDetailCover(doc, source);
  const genres = extractGenres(doc, fallbackCard.genres);
  const title = sanitizeDetailTitleText(detailTitle || fallbackCard.title);
  const chapters = extractScrapedChapterLinks(doc, source);

  return {
    title,
    alternativeTitles: extractAlternativeTitles(doc, title),
    description: extractDescription(doc, source),
    cover: detailCover || fallbackCard.cover || '',
    banner: detailCover || fallbackCard.cover || '',
    author: extractDetailAuthors(doc, ['yazar', 'author', 'yazarlar', 'yazar(lar)'], ''),
    artist: extractDetailAuthors(doc, ['çizer', 'artist', 'çizerler', 'çizer(ler)'], '') || undefined,
    status: extractDetailStatus(doc),
    type: inferMangaType(doc, genres, fallbackCard.genres),
    genres,
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

  return sanitizeChapterPageUrls(images);
};
