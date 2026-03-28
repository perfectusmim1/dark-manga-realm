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
    baseUrl: 'https://hayalistic.net',
    searchUrl: (query) => `https://hayalistic.net/?s=${encodeURIComponent(query)}&post_type=wp-manga`,
    listUrl: 'https://hayalistic.net/webtoonlar/',
    directLinkPatterns: [
      /https?:\/\/(?:www\.)?hayalistic\.net\/manga\/[^?#]+/i,
      /https?:\/\/(?:www\.)?hayalistic\.net\/webtoon\/[^?#]+/i,
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
  normalizeScrapedText(value).split(/[,，]/)[0]?.trim() || '';

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
    element.querySelectorAll('a[href*="/webtoon-tur/"], .list-genre a, .genres-item a, .genres-content a'),
  );

  return genreLinks
    .map((link) => normalizeScrapedText(link.textContent))
    .filter(Boolean);
};

const getSearchCardElements = (doc: Document, source: ScrapeSource) => {
  if (source === 'webtoonhatti') {
    return Array.from(doc.querySelectorAll('.c-tabs-item__content, .page-item-detail.manga'));
  }

  return Array.from(doc.querySelectorAll('.page-item-detail.manga, .c-tabs-item__content, .manga-item'));
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

  if (normalized.includes('hayalistic.net')) {
    return 'hayalistic';
  }

  return null;
};

export const normalizeScrapeUrl = (source: ScrapeSource, value?: string | null) => (
  normalizeUrl(SOURCE_CONFIG[source].baseUrl, value)
);

export const extractScrapedMangaCards = (doc: Document, source: ScrapeSource): ScrapedMangaCard[] => {
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

  return cards;
};

const extractDetailTitle = (doc: Document) => (
  normalizeScrapedText(
    doc.querySelector('.post-title h1, .post-title .entry-title, .post-title')?.textContent,
  )
);

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

const extractDetailAuthors = (doc: Document, labels: string[], fallback: string) => {
  const field = Array.from(doc.querySelectorAll('.post-content_item'))
    .find((element) => labels.some((label) => element.textContent?.toLocaleLowerCase('tr-TR').includes(label.toLocaleLowerCase('tr-TR'))));

  return extractPrimaryScrapedPersonName(
    normalizeScrapedText(field?.querySelector('.author-content a, .artist-content a, .summary-content')?.textContent) || fallback,
  );
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
  const yearMatch = yearText.match(/\d{4}/);

  return yearMatch ? parseInt(yearMatch[0], 10) : new Date().getFullYear();
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
  const title = normalizeScrapedText(detailTitle || fallbackCard.title);
  const chapters = extractScrapedChapterLinks(doc, source);

  return {
    title,
    alternativeTitles: extractAlternativeTitles(doc, title),
    description: extractDescription(doc, source),
    cover: detailCover || fallbackCard.cover || '',
    banner: detailCover || fallbackCard.cover || '',
    author: extractDetailAuthors(doc, ['yazar', 'author', 'yazarlar', 'yazar(lar)'], 'Bilinmiyor') || 'Bilinmiyor',
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

  return src.startsWith('http') ? src : '';
};

const getChapterImageElements = (doc: Document, source: ScrapeSource) => {
  if (source === 'webtoonhatti') {
    return Array.from(doc.querySelectorAll('.reading-content img.wp-manga-chapter-img, .reading-content .wp-manga-chapter-img'));
  }

  return Array.from(doc.querySelectorAll('.reading-content img, .wp-manga-chapter-img, .page-break img, .entry-content img'));
};

const extractTrailingPageNumber = (value: string) => {
  const match = value.match(/(?:^|[/_-])(0*\d+)\.(?:avif|gif|jpe?g|png|webp)(?:$|[?#])/i);
  return match ? parseInt(match[1], 10) : null;
};

export const extractChapterImageUrls = (doc: Document, source: ScrapeSource): string[] => {
  let images = getChapterImageElements(doc, source)
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

  const dedupedImages = Array.from(new Set(images.map((image) => image.trim()).filter(Boolean)));
  if (source !== 'webtoonhatti' || dedupedImages.length < 2) {
    return dedupedImages;
  }

  const firstPageNumber = extractTrailingPageNumber(dedupedImages[0]);
  const secondPageNumber = extractTrailingPageNumber(dedupedImages[1]);

  if (firstPageNumber === 1 && secondPageNumber === 2) {
    return dedupedImages.slice(1);
  }

  return dedupedImages;
};
