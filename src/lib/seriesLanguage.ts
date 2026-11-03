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

  const detailsLang = (manga.details as any)?.language;
  if (detailsLang === 'raw') return 'raw';
  if (detailsLang === 'en') return 'en';
  if (detailsLang === 'tr') return 'tr';

  const titleLower = (manga.title || '').toLowerCase();
  const slugLower = ((manga as any)?.slug || '').toLowerCase();

  if (
    titleLower.includes('(raw)') ||
    titleLower.includes(' raw') ||
    titleLower.endsWith('-raw') ||
    slugLower.endsWith('-raw')
  ) {
    return 'raw';
  }

  const sources = manga.sourceLinks || [];
  const hasRawSource = sources.some(
    (s) =>
      s.source?.toLowerCase() === 'mangadass' &&
      (s.url.includes('/raw-manhwa') || s.url.includes('-raw')),
  );
  if (hasRawSource) return 'raw';

  const hasEnglishSource = sources.some((s) => {
    const src = (s.source || '').toLowerCase();
    return (
      src.includes('asura') ||
      src.includes('madaradex') ||
      src.includes('mgread') ||
      src.includes('mangadex') ||
      src.includes('mangafreak')
    );
  });
  if (hasEnglishSource) return 'en';

  return 'tr';
}

/**
 * Belirli bir bölümün veya serinin dil yapılandırmasını döner.
 */
export function getSeriesLanguageInfo(manga?: Partial<Manga> | null): SeriesLanguageInfo {
  const lang = getSeriesLanguage(manga);
  return LANGUAGE_CONFIG[lang];
}
