import { fetchScraperContent, fetchScraperJson } from '@/lib/scraperProxy';
import { extractChapterImageResult, sanitizeChapterPageUrls, ScrapeSource } from '@/lib/scraper/scrapeSources';
import {
  decodeComixResponse,
  encodeComixRequest,
  unpackComixChapterPages,
} from '@/lib/scraper/comixCrypto';
import { Chapter, Manga } from '@/lib/types';

const COMIX_CHAPTER_UUID_REGEX = /^c01c0000-[0-9a-f]{4}-4000-8000-(\d{12})$/i;

export const extractComixChapterId = (chapter?: Partial<Chapter> | null): string | null => {
  if (!chapter) return null;

  const rawId = String(chapter.id || '').trim();
  const uuidMatch = rawId.match(COMIX_CHAPTER_UUID_REGEX);
  if (uuidMatch?.[1]) {
    const parsed = String(Number(uuidMatch[1]));
    if (parsed && parsed !== '0' && parsed !== 'NaN') {
      return parsed;
    }
  }

  const comixPrefixMatch = rawId.match(/^comix-ch-(\d+)$/i);
  if (comixPrefixMatch?.[1]) {
    return comixPrefixMatch[1];
  }

  const candidateUrl = String(chapter.sourceUrl || chapter._sourceLink || (chapter as any)?.source_url || '').trim();
  if (candidateUrl.includes('comix.to')) {
    const titleChapterMatch = candidateUrl.match(/comix\.to\/title\/[^/]+\/(\d+)(?:-chapter-[^/?#]*)?/i);
    if (titleChapterMatch?.[1]) {
      return titleChapterMatch[1];
    }
    const apiChapterMatch = candidateUrl.match(/\/chapters\/(\d+)(?:[/?#]|$)/i);
    if (apiChapterMatch?.[1]) {
      return apiChapterMatch[1];
    }
  }

  return null;
};

const comixChapterPagesCache = new Map<string, string[]>();
const comixChapterPagesInFlight = new Map<string, Promise<string[]>>();

export const resolveComixChapterPagesById = async (comixChapterId: string | number): Promise<string[]> => {
  const cleanId = String(comixChapterId || '').trim();
  if (!/^\d+$/.test(cleanId)) return [];

  const cached = comixChapterPagesCache.get(cleanId);
  if (cached && cached.length > 0) {
    return cached;
  }

  const pending = comixChapterPagesInFlight.get(cleanId);
  if (pending) {
    return pending;
  }

  const promise = (async () => {
    try {
      const req = encodeComixRequest(`/chapters/${cleanId}`);
      let rawPayload: any = null;

      // 1. Primary: Direct same-origin rewrite (/comix-api-proxy -> https://comix.to/api/v1)
      if (typeof window !== 'undefined') {
        try {
          const proxyPath = req.url.replace(/^https?:\/\/comix\.to\/api\/v1/, '/comix-api-proxy');
          const directRes = await fetch(proxyPath, {
            method: 'GET',
            headers: req.headers,
            credentials: 'omit',
          });
          if (directRes.ok) {
            rawPayload = await directRes.json();
          }
        } catch {
          // fallback to structured scraper proxy
        }
      }

      // 2. Fallback: Structured scraper proxy
      if (!rawPayload) {
        rawPayload = await fetchScraperJson<any>({
          url: req.url,
          source: 'comix',
          headers: req.headers,
        });
      }

      if (!rawPayload) return [];
      const decoded = decodeComixResponse(rawPayload);
      const unpacked = unpackComixChapterPages(decoded?.data || decoded);
      const pages = sanitizeChapterPageUrls(Array.isArray(unpacked?.pages) ? unpacked.pages : []);
      if (pages.length > 0) {
        comixChapterPagesCache.set(cleanId, pages);
      }
      return pages;
    } catch (err) {
      console.warn(`[OnDemandResolver] Comix chapter ${cleanId} resolution failed:`, err);
      return [];
    } finally {
      comixChapterPagesInFlight.delete(cleanId);
    }
  })();

  comixChapterPagesInFlight.set(cleanId, promise);
  return promise;
};

export const resolveChapterPagesOnDemand = async (
  manga: Partial<Manga>,
  chapter: Partial<Chapter>,
): Promise<string[]> => {
  try {
    const comixChapterId = extractComixChapterId(chapter);
    if (comixChapterId) {
      const comixPages = await resolveComixChapterPagesById(comixChapterId);
      if (comixPages.length > 0) {
        return comixPages;
      }
    }

    const detailsAny = (manga.details || {}) as Record<string, any>;
    const primarySource = (detailsAny.primarySource || '') as ScrapeSource;
    const primarySourceUrl = String(detailsAny.primarySourceUrl || '');
    const chapterNum = chapter.number ?? 0;

    const candidateUrls: string[] = [];

    if (chapter.sourceUrl) {
      candidateUrls.push(chapter.sourceUrl);
    }
    if ((chapter as any)?._sourceLink) {
      candidateUrls.push((chapter as any)._sourceLink);
    }

    const sourceLinks = manga.sourceLinks || (manga as any)?.source_links || [];
    const sourceLinkObj = Array.isArray(sourceLinks)
      ? sourceLinks.find((s: any) => s.source === primarySource || s.url?.includes('comix.to') || s.url?.includes('siyahmelek') || s.url?.includes('webtoonhatti'))
      : null;
    const resolvedSourceUrl = primarySourceUrl || sourceLinkObj?.url || '';

    if (resolvedSourceUrl) {
      const cleanBase = resolvedSourceUrl.replace(/\/+$/, '');
      if (primarySource === 'siyahmelek' || resolvedSourceUrl.includes('siyahmelek')) {
        candidateUrls.push(`${cleanBase}/bolum-${chapterNum}/`);
        candidateUrls.push(`${cleanBase}/bolum-${chapterNum}`);
      } else if (primarySource === 'webtoonhatti' || resolvedSourceUrl.includes('webtoonhatti')) {
        candidateUrls.push(`${cleanBase}/${chapterNum}-bolum/?style=list`);
        candidateUrls.push(`${cleanBase}/${chapterNum}-bolum/`);
      } else if (primarySource === 'hattorimanga' || resolvedSourceUrl.includes('hattorimanga')) {
        candidateUrls.push(`${cleanBase}/bolum-${chapterNum}/?style=list`);
        candidateUrls.push(`${cleanBase}/bolum-${chapterNum}/`);
      } else if (primarySource === 'okutoon' || resolvedSourceUrl.includes('okutoon')) {
        candidateUrls.push(`${cleanBase}/bolum-${chapterNum}/`);
      }
    }

    const uniqueCandidates = [...new Set(candidateUrls.filter(Boolean))];
    if (uniqueCandidates.length === 0) {
      return [];
    }

    const effectiveSource: ScrapeSource =
      primarySource ||
      (resolvedSourceUrl.includes('comix.to')
        ? 'comix'
        : resolvedSourceUrl.includes('siyahmelek')
        ? 'siyahmelek'
        : 'webtoonhatti');

    for (const url of uniqueCandidates) {
      try {
        if (url.includes('comix.to')) {
          const inlineComixId = extractComixChapterId({ sourceUrl: url });
          if (inlineComixId) {
            const pages = await resolveComixChapterPagesById(inlineComixId);
            if (pages.length > 0) return pages;
          }
          continue;
        }

        const content = await fetchScraperContent(url, {
          source: effectiveSource,
        });

        if (!content || content.length < 200) {
          continue;
        }

        const parser = new DOMParser();
        const doc = parser.parseFromString(content, 'text/html');
        const result = extractChapterImageResult(doc, effectiveSource, undefined, content);

        const sanitized = sanitizeChapterPageUrls(result.images || []);
        if (sanitized.length > 0) {
          return sanitized;
        }
      } catch (attemptErr) {
        console.warn(`[OnDemandResolver] Attempt failed for ${url}:`, attemptErr);
      }
    }
  } catch (err) {
    console.error('[OnDemandResolver] Resolution error:', err);
  }

  return [];
};
