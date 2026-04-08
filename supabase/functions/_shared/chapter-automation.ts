import { DOMParser } from "jsr:@b-fuze/deno-dom";
import { createServiceClient } from "./auth.ts";

export type ChapterAutomationSource = "hayalistic" | "webtoonhatti" | "siyahmelek";

export interface ScrapedAutomationChapter {
  name: string;
  link: string;
  number: number;
}

export interface AutomationChapterImageResult {
  status: "ok" | "locked" | "error";
  images: string[];
  reason?: string;
}

export interface ChapterAutomationValidationSnapshot {
  source: ChapterAutomationSource;
  sourceTitle: string;
  normalizedUrl: string;
  cover?: string | null;
  chapterCount: number;
  latestChapterNumber?: number | null;
  checkedAt: string;
}

export interface FetchedAutomationSeries {
  validation: ChapterAutomationValidationSnapshot;
  chapters: ScrapedAutomationChapter[];
}

const SCRAPER_PROXY_URL_SECRET_KEY = "scraper_proxy_url";
const SCRAPER_PROXY_TOKEN_SECRET_KEY = "scraper_proxy_token";
const ISTANBUL_OFFSET_MS = 3 * 60 * 60 * 1000;

const SOURCE_CONFIG: Record<ChapterAutomationSource, {
  label: string;
  baseUrl: string;
  canonicalHosts: string[];
  directLinkPatterns: RegExp[];
}> = {
  hayalistic: {
    label: "Hayalistic",
    baseUrl: "https://hayalistic.com",
    canonicalHosts: ["hayalistic.com", "hayalistic.net"],
    directLinkPatterns: [
      /^https?:\/\/(?:www\.)?hayalistic\.(?:com|net)\/manga\/[^?#]+$/i,
      /^https?:\/\/(?:www\.)?hayalistic\.(?:com|net)\/webtoon\/[^?#]+$/i,
    ],
  },
  webtoonhatti: {
    label: "WebtoonHattı",
    baseUrl: "https://webtoonhatti.club",
    canonicalHosts: ["webtoonhatti.club"],
    directLinkPatterns: [
      /^https?:\/\/(?:www\.)?webtoonhatti\.club\/webtoon\/[^?#]+$/i,
    ],
  },
  siyahmelek: {
    label: "SiyahMelek",
    baseUrl: "https://siyahmelek.mom",
    canonicalHosts: ["siyahmelek.mom"],
    directLinkPatterns: [
      /^https?:\/\/(?:www\.)?siyahmelek\.mom\/manga\/[^?#]+$/i,
    ],
  },
};

const normalizeText = (value?: string | null) => value?.replace(/\s+/g, " ").trim() || "";

const parseNumber = (value: string) => {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const normalizeUrl = (baseUrl: string, value?: string | null) => {
  const href = normalizeText(value);
  if (!href) {
    return "";
  }

  try {
    return new URL(href, baseUrl).href;
  } catch {
    return href;
  }
};

const ensureValidSource = (value: string): ChapterAutomationSource => {
  if (value === "hayalistic" || value === "webtoonhatti" || value === "siyahmelek") {
    return value;
  }

  throw new Error("Desteklenmeyen otomasyon kaynağı");
};

const normalizePathname = (value: string) => {
  const trimmed = value.replace(/\/+$/, "");
  return trimmed || "/";
};

const isDirectSourceLink = (source: ChapterAutomationSource, value: string) => (
  SOURCE_CONFIG[source].directLinkPatterns.some((pattern) => pattern.test(value))
);

const isAllowedSourceHost = (hostname: string, canonicalHosts: string[]) => {
  const normalizedHostname = hostname.toLowerCase().replace(/^www\./, "");
  return canonicalHosts.some((host) => normalizedHostname === host);
};

const getChapterNumber = (name: string, link: string) => {
  const match = `${name} ${link}`.match(/(\d+(?:\.\d+)?)/);
  return match ? parseNumber(match[1]) : 0;
};

const extractImageSource = (img: Element) => {
  const src = normalizeText(
    img.getAttribute("data-src")
    || img.getAttribute("data-lazy-src")
    || img.getAttribute("data-cdn")
    || img.getAttribute("src"),
  );

  if (!src || src.includes("base64")) {
    return "";
  }

  if (src.startsWith("//")) {
    return `https:${src}`;
  }

  return src.startsWith("http") ? src : "";
};

const sanitizeChapterPageUrls = (images: string[]) => Array.from(
  new Set(
    images
      .map((image) => normalizeText(image))
      .map((image) => (image.startsWith("//") ? `https:${image}` : image))
      .filter((image) => image.startsWith("http") && !image.includes("base64")),
  ),
);

const LOCKED_CHAPTER_PATTERNS = [
  /kilitli b[öo]l[üu]m/i,
  /vip [üu]yeler bu b[öo]l[üu]m[üu]/i,
  /erken okuyabilir/i,
];

const getIstanbulParts = (date: Date) => {
  const localDate = new Date(date.getTime() + ISTANBUL_OFFSET_MS);
  return {
    year: localDate.getUTCFullYear(),
    month: localDate.getUTCMonth() + 1,
    day: localDate.getUTCDate(),
  };
};

const buildUtcDateFromIstanbul = (year: number, month: number, day: number, hour: number, minute: number) => (
  new Date(Date.UTC(year, month - 1, day, hour - 3, minute, 0, 0))
);

const getNextIstanbulDay = (date: Date) => {
  const shifted = new Date(date.getTime() + ISTANBUL_OFFSET_MS + (24 * 60 * 60 * 1000));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
};

const parseTimeParts = (value: string) => {
  const [hourValue, minuteValue] = value.split(":");
  return {
    hour: Number.parseInt(hourValue || "0", 10),
    minute: Number.parseInt(minuteValue || "0", 10),
  };
};

export const normalizeCheckTimes = (times: string[]) => {
  const normalized = Array.from(
    new Set(
      (Array.isArray(times) ? times : [])
        .map((time) => normalizeText(time))
        .filter((time) => /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)),
    ),
  ).sort((left, right) => left.localeCompare(right));

  if (normalized.length === 0) {
    throw new Error("En az bir geçerli kontrol saati girilmelidir");
  }

  return normalized;
};

export const computeNextRunAt = (times: string[], referenceDate = new Date()) => {
  const normalizedTimes = normalizeCheckTimes(times);
  const today = getIstanbulParts(referenceDate);

  for (const time of normalizedTimes) {
    const { hour, minute } = parseTimeParts(time);
    const candidate = buildUtcDateFromIstanbul(today.year, today.month, today.day, hour, minute);
    if (candidate.getTime() > referenceDate.getTime()) {
      return candidate.toISOString();
    }
  }

  const nextDay = getNextIstanbulDay(referenceDate);
  const firstTime = parseTimeParts(normalizedTimes[0]);
  return buildUtcDateFromIstanbul(nextDay.year, nextDay.month, nextDay.day, firstTime.hour, firstTime.minute).toISOString();
};

export const computeNextRunAfter = (times: string[], referenceIso?: string | null) => (
  computeNextRunAt(times, referenceIso ? new Date(referenceIso) : new Date())
);

export const normalizeAutomationSourceUrl = (sourceInput: string, sourceUrl: string) => {
  const source = ensureValidSource(sourceInput);
  const config = SOURCE_CONFIG[source];
  const parsed = new URL(normalizeText(sourceUrl), config.baseUrl);
  const canonical = new URL(config.baseUrl);

  if (!isAllowedSourceHost(parsed.hostname, config.canonicalHosts)) {
    throw new Error(`${config.label} için geçerli bir seri linki girin`);
  }

  canonical.pathname = normalizePathname(parsed.pathname);
  canonical.search = "";
  canonical.hash = "";

  const normalized = canonical.toString();

  if (!isDirectSourceLink(source, normalized)) {
    throw new Error(`${config.label} için doğrudan seri linki girin`);
  }

  return normalized;
};

const loadSecretMap = async (
  serviceClient: ReturnType<typeof createServiceClient>,
  keys: string[],
) => {
  const { data, error } = await serviceClient
    .from("internal_worker_secrets")
    .select("key, value")
    .in("key", keys);

  if (error) {
    throw error;
  }

  const values = new Map<string, string>();
  for (const row of data || []) {
    values.set(normalizeText(row.key), normalizeText(row.value));
  }

  return values;
};

const loadScraperProxySecrets = async (
  serviceClient: ReturnType<typeof createServiceClient>,
) => {
  const values = await loadSecretMap(serviceClient, [
    SCRAPER_PROXY_URL_SECRET_KEY,
    SCRAPER_PROXY_TOKEN_SECRET_KEY,
  ]);

  const proxyUrl = values.get(SCRAPER_PROXY_URL_SECRET_KEY) || "";
  const proxyToken = values.get(SCRAPER_PROXY_TOKEN_SECRET_KEY) || "";

  if (!proxyUrl) {
    throw new Error("Scraper proxy URL ayarı eksik");
  }

  return {
    proxyUrl,
    proxyToken,
  };
};

export const fetchScraperHtml = async (
  serviceClient: ReturnType<typeof createServiceClient>,
  url: string,
) => {
  const { proxyUrl, proxyToken } = await loadScraperProxySecrets(serviceClient);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (proxyToken) {
    headers.Authorization = `Bearer ${proxyToken}`;
  }

  const response = await fetch(proxyUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({ url }),
  }).catch(() => null);

  if (!response) {
    throw new Error("Scraper proxy erişilemiyor");
  }

  if (!response.ok) {
    const rawBody = await response.text().catch(() => "");
    const trimmedBody = rawBody.trim();
    let upstreamMessage = trimmedBody;

    if (trimmedBody.startsWith("{")) {
      try {
        const parsedBody = JSON.parse(trimmedBody) as { error?: string; message?: string };
        upstreamMessage = parsedBody.message || parsedBody.error || trimmedBody;
      } catch {
        upstreamMessage = trimmedBody;
      }
    }

    if (response.status === 401) {
      throw new Error("Scraper proxy yetkilendirmesi reddedildi");
    }

    if (response.status === 403) {
      throw new Error("Scraper proxy istegi engelledi");
    }

    throw new Error(upstreamMessage || `Scraper proxy hatası (${response.status})`);
  }

  return await response.text();
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
  let nextValue = normalizeText(value);
  let previousValue = "";

  while (nextValue && nextValue !== previousValue) {
    previousValue = nextValue;
    for (const pattern of DETAIL_TITLE_PREFIX_PATTERNS) {
      nextValue = nextValue.replace(pattern, "").trim();
    }
  }

  return nextValue;
};

const extractDetailTitle = (doc: Document) => {
  const titleElement = doc.querySelector(".post-title h1, .post-title .entry-title, .post-title");
  if (!titleElement) {
    return "";
  }

  const cloned = titleElement.cloneNode(true) as Element;
  cloned
    .querySelectorAll(
      ".manga-title-badges, .post-title-badges, .hot, .new, .status, .badge, .label, [class*=\"badge\"], [class*=\"status\"]",
    )
    .forEach((node) => node.remove());

  return sanitizeDetailTitleText(cloned.textContent || titleElement.textContent);
};

const extractDetailCover = (doc: Document, source: ChapterAutomationSource) => {
  const image = doc.querySelector(".summary_image img, .summary-image img, .post-thumbnail img");
  return normalizeUrl(
    SOURCE_CONFIG[source].baseUrl,
    image?.getAttribute("data-src")
      || image?.getAttribute("data-lazy-src")
      || image?.getAttribute("src"),
  );
};

const extractScrapedChapterLinks = (doc: Document, source: ChapterAutomationSource) => {
  const chapters: ScrapedAutomationChapter[] = [];
  const seenLinks = new Set<string>();

  for (const element of doc.querySelectorAll(".wp-manga-chapter")) {
    const linkEl = element.querySelector("a");
    if (!linkEl) {
      continue;
    }

    const name = normalizeText(linkEl.textContent);
    const link = normalizeUrl(
      SOURCE_CONFIG[source].baseUrl,
      (linkEl as HTMLAnchorElement).href || linkEl.getAttribute("href"),
    );

    if (!name || !link || seenLinks.has(link)) {
      continue;
    }

    seenLinks.add(link);
    chapters.push({
      name,
      link,
      number: getChapterNumber(name, link),
    });
  }

  return chapters.sort((left, right) => left.number - right.number);
};

const WEBTOONHATTI_HIDDEN_STYLE_PATTERN = /(display\s*:\s*none|visibility\s*:\s*hidden)/i;
const WEBTOONHATTI_JUNK_URL_FRAGMENTS = [
  "whatthe",
  "plase",
  "yaaxa",
  "/wp-content/uploads/2024/02/tr2.png",
  "/wp-content/uploads/2025/08/z9.jpg",
];

const isElementVisuallyHidden = (element: Element | null): boolean => {
  let current = element;

  while (current) {
    if (current.hasAttribute("hidden") || current.getAttribute("aria-hidden") === "true") {
      return true;
    }

    const inlineStyle = normalizeText(current.getAttribute("style"));
    if (WEBTOONHATTI_HIDDEN_STYLE_PATTERN.test(inlineStyle)) {
      return true;
    }

    if (current.classList.contains("reading-content")) {
      break;
    }

    current = current.parentElement;
  }

  return false;
};

const isWebtoonHattiJunkImageUrl = (value: string) => {
  const normalized = value.toLocaleLowerCase("tr-TR");
  return WEBTOONHATTI_JUNK_URL_FRAGMENTS.some((fragment) => normalized.includes(fragment));
};

const extractWebtoonHattiImageUrls = (doc: Document) => {
  const pageBreaks = Array.from(doc.querySelectorAll(".reading-content .page-break"));
  const orderedImages = pageBreaks.flatMap((pageBreak) => {
    if (isElementVisuallyHidden(pageBreak)) {
      return [] as string[];
    }

    return Array.from(pageBreak.querySelectorAll("img"))
      .filter((img) => !isElementVisuallyHidden(img))
      .map((img) => extractImageSource(img))
      .filter((src) => src && !isWebtoonHattiJunkImageUrl(src));
  });

  if (orderedImages.length > 0) {
    return sanitizeChapterPageUrls(orderedImages);
  }

  return sanitizeChapterPageUrls(
    Array.from(doc.querySelectorAll(".reading-content img"))
      .filter((img) => !isElementVisuallyHidden(img))
      .map((img) => extractImageSource(img))
      .filter((src) => src && !isWebtoonHattiJunkImageUrl(src)),
  );
};

const getChapterImageElements = (doc: Document, source: ChapterAutomationSource) => {
  if (source === "webtoonhatti") {
    return Array.from(doc.querySelectorAll(".reading-content img.wp-manga-chapter-img, .reading-content .wp-manga-chapter-img"));
  }

  return Array.from(doc.querySelectorAll(".reading-content img, .wp-manga-chapter-img, .page-break img, .entry-content img"));
};

const isParsedChapterDataPayload = (value: unknown): value is { images?: Array<{ src?: string | null }> } => {
  if (!value || typeof value !== "object") {
    return false;
  }

  return Array.isArray((value as { images?: unknown[] }).images);
};

const hasLockedChapterMarkers = (doc: Document) => {
  const text = normalizeText(doc.body?.textContent || "");
  return LOCKED_CHAPTER_PATTERNS.some((pattern) => pattern.test(text));
};

export const extractChapterImageUrls = (doc: Document, source: ChapterAutomationSource) => (
  extractChapterImageResult(doc, source).images
);

export const extractChapterImageResult = (
  doc: Document,
  source: ChapterAutomationSource,
): AutomationChapterImageResult => {
  let images = source === "webtoonhatti"
    ? extractWebtoonHattiImageUrls(doc)
    : getChapterImageElements(doc, source)
      .map((img) => extractImageSource(img))
      .filter(Boolean);

  if (images.length === 0) {
    for (const script of Array.from(doc.querySelectorAll("script"))) {
      const content = script.textContent || "";
      if (!content.includes("chapter_data")) {
        continue;
      }

      try {
        const match = content.match(/chapter_data\s*=\s*({.*?});/s);
        if (!match) {
          continue;
        }

        const parsed: unknown = JSON.parse(match[1]);
        if (isParsedChapterDataPayload(parsed) && parsed.images) {
          images = parsed.images
            .map((image) => typeof image.src === "string" ? image.src.trim() : "")
            .filter((src) => src.startsWith("http"));
          break;
        }
      } catch {
        continue;
      }
    }
  }

  const sanitizedImages = sanitizeChapterPageUrls(images);

  if (sanitizedImages.length > 0) {
    return {
      status: "ok",
      images: sanitizedImages,
    };
  }

  if (source === "siyahmelek" && hasLockedChapterMarkers(doc)) {
    return {
      status: "locked",
      images: [],
      reason: "VIP veya kilitli bölüm",
    };
  }

  return {
    status: "error",
    images: [],
    reason: "Sayfa görselleri bulunamadı",
  };
};

export const fetchAutomationSeries = async (
  serviceClient: ReturnType<typeof createServiceClient>,
  sourceInput: string,
  sourceUrl: string,
): Promise<FetchedAutomationSeries> => {
  const source = ensureValidSource(sourceInput);
  const normalizedUrl = normalizeAutomationSourceUrl(source, sourceUrl);
  const html = await fetchScraperHtml(serviceClient, normalizedUrl);
  const doc = new DOMParser().parseFromString(html, "text/html");

  if (!doc) {
    throw new Error("Kaynak sayfası çözümlenemedi");
  }

  const sourceTitle = extractDetailTitle(doc);
  if (!sourceTitle) {
    throw new Error("Seri başlığı doğrulanamadı");
  }

  const chapters = extractScrapedChapterLinks(doc, source);
  const numberedChapters = chapters.filter((chapter) => chapter.number > 0);

  return {
    validation: {
      source,
      sourceTitle,
      normalizedUrl,
      cover: extractDetailCover(doc, source),
      chapterCount: chapters.length,
      latestChapterNumber: numberedChapters.length > 0 ? numberedChapters[numberedChapters.length - 1].number : null,
      checkedAt: new Date().toISOString(),
    },
    chapters,
  };
};

export const validateAutomationSource = async (
  serviceClient: ReturnType<typeof createServiceClient>,
  sourceInput: string,
  sourceUrl: string,
) => {
  const result = await fetchAutomationSeries(serviceClient, sourceInput, sourceUrl);
  return result.validation;
};

export const fetchChapterImagesForAutomation = async (
  serviceClient: ReturnType<typeof createServiceClient>,
  sourceInput: string,
  chapterUrl: string,
) => {
  const source = ensureValidSource(sourceInput);
  const normalizedUrl = normalizeUrl(SOURCE_CONFIG[source].baseUrl, chapterUrl);
  const html = await fetchScraperHtml(serviceClient, normalizedUrl);
  const doc = new DOMParser().parseFromString(html, "text/html");

  if (!doc) {
    throw new Error("Bölüm sayfası çözümlenemedi");
  }

  return extractChapterImageResult(doc, source);
};

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
