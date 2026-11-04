import { fetchScraperContent } from '@/lib/scraperProxy';
import { extractChapterImageResult, sanitizeChapterPageUrls, ScrapeSource } from '@/lib/scraper/scrapeSources';
import { Chapter, Manga } from '@/lib/types';

export const resolveChapterPagesOnDemand = async (
  manga: Partial<Manga>,
  chapter: Partial<Chapter>,
): Promise<string[]> => {
  try {
    const primarySource = (manga.details?.primarySource || '') as ScrapeSource;
    const primarySourceUrl = manga.details?.primarySourceUrl || '';
    const chapterNum = chapter.number ?? 0;

    const candidateUrls: string[] = [];

    if ((chapter as any)?._sourceLink) {
      candidateUrls.push((chapter as any)._sourceLink);
    }

    const sourceLinks = manga.source_links || (manga as any)?.sourceLinks || [];
    const sourceLinkObj = Array.isArray(sourceLinks)
      ? sourceLinks.find((s: any) => s.source === primarySource || s.url?.includes('siyahmelek') || s.url?.includes('webtoonhatti'))
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

    const effectiveSource = primarySource || (resolvedSourceUrl.includes('siyahmelek') ? 'siyahmelek' : 'webtoonhatti');

    for (const url of uniqueCandidates) {
      try {
        const response = await fetchScraperContent({
          url,
          source: effectiveSource,
        });

        if (!response.content || response.content.length < 200) {
          continue;
        }

        const parser = new DOMParser();
        const doc = parser.parseFromString(response.content, 'text/html');
        const result = extractChapterImageResult(doc, effectiveSource, undefined, response.content);

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
