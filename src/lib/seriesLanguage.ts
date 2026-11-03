import type { Manga, Chapter } from '@/lib/types';

export type SeriesLanguage = 'tr' | 'en' | 'raw';

export interface SeriesLanguageInfo {
  language: SeriesLanguage;
  label: string;
  shortLabel: string;
  badgeClassName: string;
  pillClassName: string;
}

export const LANGUAGE_CONFIG: Record<SeriesLanguage, SeriesLanguageInfo> = {
  tr: {
    language: 'tr',
    label: 'Türkçe',
    shortLabel: 'TR',
    badgeClassName: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400',
    pillClassName: 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30',
  },
  en: {
    language: 'en',
    label: 'İngilizce',
    shortLabel: 'EN',
    badgeClassName: 'border-sky-500/40 bg-sky-500/15 text-sky-400 shadow-[0_0_12px_rgba(56,189,248,0.25)]',
    pillClassName: 'bg-sky-500/15 text-sky-400 border border-sky-500/30',
  },
  raw: {
    language: 'raw',
    label: 'RAW (Orijinal)',
    shortLabel: 'RAW',
    badgeClassName: 'border-purple-500/40 bg-purple-500/15 text-purple-400 shadow-[0_0_12px_rgba(168,85,247,0.25)]',
    pillClassName: 'bg-purple-500/15 text-purple-400 border border-purple-500/30',
  },
};

/**
 * Bir serinin dilini belirler (TR, EN veya RAW).
 * Mangadass raw serileri, AsuraScans / MadaraDex İngilizce serileri veya
 * metadata details.language alanı kontrol edilir.
 */
export function getSeriesLanguage(manga?: Partial<Manga> | null): SeriesLanguage {
  if (!manga) return 'tr';

  const detailsLang = (manga.details as any)?.language || (manga as any)?.language || (manga as any)?.mangaLanguage;
  if (detailsLang === 'raw') return 'raw';
  if (detailsLang === 'en') return 'en';
  if (detailsLang === 'tr') return 'tr';

  const genres = Array.isArray(manga.genres) ? manga.genres : [];
  if (genres.some((g) => String(g).toUpperCase() === 'RAW')) return 'raw';
  if (genres.some((g) => {
    const s = String(g).toLowerCase();
    return s === 'ingilizce' || s === 'i̇ngilizce' || s === 'english' || s === 'en';
  })) return 'en';

  const titleLower = (manga.title || '').toLowerCase();
  const slugLower = ((manga as any)?.slug || '').toLowerCase();

  // 1. RAW check by title or slug
  if (
    titleLower.includes('(raw)') ||
    titleLower.includes(' raw') ||
    titleLower.endsWith('-raw') ||
    slugLower.endsWith('-raw')
  ) {
    return 'raw';
  }

  // 2. Source links check
  const sources = manga.sourceLinks || (manga as any)?.source_links || [];
  const hasRawSource = sources.some(
    (s: any) =>
      (s.source || '').toLowerCase() === 'mangadass' &&
      (s.url?.includes('/raw-manhwa') || s.url?.includes('-raw')),
  );
  if (hasRawSource) return 'raw';

  const hasEnglishSource = sources.some((s: any) => {
    const src = (s.source || '').toLowerCase();
    const url = (s.url || '').toLowerCase();
    return (
      src.includes('asura') ||
      src.includes('madaradex') ||
      src.includes('mgread') ||
      src.includes('mangadex') ||
      src.includes('mangafreak') ||
      src.includes('ezmanga') ||
      (src.includes('mangadass') && !url.includes('/raw-manhwa') && !url.includes('-raw'))
    );
  });
  if (hasEnglishSource) return 'en';

  const primarySource = ((manga.details as any)?.primarySource || '').toLowerCase();
  if (primarySource === 'asurascans' || primarySource === 'madaradex' || primarySource === 'mgread' || primarySource === 'ezmanga') {
    return 'en';
  }
  if (primarySource === 'mangadass') {
    return titleLower.includes('raw') ? 'raw' : 'en';
  }

  return 'tr';
}

/**
 * Belirli bir bölümün veya serinin dil yapılandırmasını döner.
 */
export function getSeriesLanguageInfo(manga?: Partial<Manga> | null): SeriesLanguageInfo {
  const lang = getSeriesLanguage(manga);
  return LANGUAGE_CONFIG[lang];
}
