import type { Manga, Chapter } from '@/lib/types';

export type SeriesLanguage = 'tr' | 'en' | 'raw';

export interface SeriesLanguageInfo {
  code: string;
  language: string;
  label: string;
  shortLabel: string;
  badgeClass: string;
  badgeClassName: string;
  pillClassName: string;
}

const RAW_LANGUAGE_CONFIG: Record<string, Omit<SeriesLanguageInfo, 'code' | 'badgeClass'>> = {
  tr: {
    language: 'tr',
    label: 'Türkçe',
    shortLabel: 'TR',
    badgeClassName: 'border-emerald-500/35 bg-emerald-500/12 text-emerald-400',
    pillClassName: 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30',
  },
  en: {
    language: 'en',
    label: 'İngilizce',
    shortLabel: 'EN',
    badgeClassName: 'border-sky-500/40 bg-sky-500/15 text-sky-400',
    pillClassName: 'bg-sky-500/15 text-sky-400 border border-sky-500/30',
  },
  es: {
    language: 'es',
    label: 'İspanyolca',
    shortLabel: 'ES',
    badgeClassName: 'border-amber-500/40 bg-amber-500/15 text-amber-400',
    pillClassName: 'bg-amber-500/15 text-amber-400 border border-amber-500/30',
  },
  'pt-br': {
    language: 'pt-br',
    label: 'Portekizce',
    shortLabel: 'PT',
    badgeClassName: 'border-lime-500/40 bg-lime-500/15 text-lime-400',
    pillClassName: 'bg-lime-500/15 text-lime-400 border border-lime-500/30',
  },
  ru: {
    language: 'ru',
    label: 'Rusça',
    shortLabel: 'RU',
    badgeClassName: 'border-indigo-500/40 bg-indigo-500/15 text-indigo-400',
    pillClassName: 'bg-indigo-500/15 text-indigo-400 border border-indigo-500/30',
  },
  fr: {
    language: 'fr',
    label: 'Fransızca',
    shortLabel: 'FR',
    badgeClassName: 'border-blue-500/40 bg-blue-500/15 text-blue-400',
    pillClassName: 'bg-blue-500/15 text-blue-400 border border-blue-500/30',
  },
  id: {
    language: 'id',
    label: 'Endonezce',
    shortLabel: 'ID',
    badgeClassName: 'border-rose-500/40 bg-rose-500/15 text-rose-400',
    pillClassName: 'bg-rose-500/15 text-rose-400 border border-rose-500/30',
  },
  ar: {
    language: 'ar',
    label: 'Arapça',
    shortLabel: 'AR',
    badgeClassName: 'border-teal-500/40 bg-teal-500/15 text-teal-400',
    pillClassName: 'bg-teal-500/15 text-teal-400 border border-teal-500/30',
  },
  de: {
    language: 'de',
    label: 'Almanca',
    shortLabel: 'DE',
    badgeClassName: 'border-yellow-500/40 bg-yellow-500/15 text-yellow-400',
    pillClassName: 'bg-yellow-500/15 text-yellow-400 border border-yellow-500/30',
  },
  it: {
    language: 'it',
    label: 'İtalyanca',
    shortLabel: 'IT',
    badgeClassName: 'border-cyan-500/40 bg-cyan-500/15 text-cyan-400',
    pillClassName: 'bg-cyan-500/15 text-cyan-400 border border-cyan-500/30',
  },
  pl: {
    language: 'pl',
    label: 'Lehçe',
    shortLabel: 'PL',
    badgeClassName: 'border-pink-500/40 bg-pink-500/15 text-pink-400',
    pillClassName: 'bg-pink-500/15 text-pink-400 border border-pink-500/30',
  },
  vi: {
    language: 'vi',
    label: 'Vietnamca',
    shortLabel: 'VI',
    badgeClassName: 'border-orange-500/40 bg-orange-500/15 text-orange-400',
    pillClassName: 'bg-orange-500/15 text-orange-400 border border-orange-500/30',
  },
  th: {
    language: 'th',
    label: 'Tayca',
    shortLabel: 'TH',
    badgeClassName: 'border-fuchsia-500/40 bg-fuchsia-500/15 text-fuchsia-400',
    pillClassName: 'bg-fuchsia-500/15 text-fuchsia-400 border border-fuchsia-500/30',
  },
  ja: {
    language: 'ja',
    label: 'Japonca',
    shortLabel: 'JA',
    badgeClassName: 'border-purple-500/40 bg-purple-500/15 text-purple-400',
    pillClassName: 'bg-purple-500/15 text-purple-400 border border-purple-500/30',
  },
  ko: {
    language: 'ko',
    label: 'Korece',
    shortLabel: 'KO',
    badgeClassName: 'border-violet-500/40 bg-violet-500/15 text-violet-400',
    pillClassName: 'bg-violet-500/15 text-violet-400 border border-violet-500/30',
  },
  zh: {
    language: 'zh',
    label: 'Çince',
    shortLabel: 'ZH',
    badgeClassName: 'border-red-500/40 bg-red-500/15 text-red-400',
    pillClassName: 'bg-red-500/15 text-red-400 border border-red-500/30',
  },
  raw: {
    language: 'raw',
    label: 'RAW (Orijinal)',
    shortLabel: 'RAW',
    badgeClassName: 'border-purple-500/40 bg-purple-500/15 text-purple-400 shadow-[0_0_12px_rgba(168,85,247,0.25)]',
    pillClassName: 'bg-purple-500/15 text-purple-400 border border-purple-500/30',
  },
};

export const LANGUAGE_CONFIG: Record<string, SeriesLanguageInfo> = Object.fromEntries(
  Object.entries(RAW_LANGUAGE_CONFIG).map(([k, v]) => [
    k,
    {
      ...v,
      code: v.language,
      badgeClass: v.badgeClassName,
    },
  ]),
);

export function normalizeLanguageCode(rawCode?: string | null): string {
  const code = String(rawCode || '').trim().toLowerCase();
  if (!code) return 'tr';
  if (code === 'tr' || code === 'turkish' || code === 'türkçe') return 'tr';
  if (code === 'en' || code === 'eng' || code === 'english' || code === 'ingilizce') return 'en';
  if (code === 'es' || code === 'es-la' || code === 'es-419' || code === 'spa') return 'es';
  if (code === 'pt' || code === 'pt-br' || code === 'por') return 'pt-br';
  if (code === 'zh' || code === 'zh-hk' || code === 'zh-cn' || code === 'zh-tw') return 'zh';
  if (code === 'jp' || code === 'ja') return 'ja';
  if (code === 'kr' || code === 'ko') return 'ko';
  return code;
}

export function getLanguageInfoByCode(rawCode?: string | null): SeriesLanguageInfo {
  const normalized = normalizeLanguageCode(rawCode);
  if (LANGUAGE_CONFIG[normalized]) {
    return LANGUAGE_CONFIG[normalized];
  }
  const short = normalized.slice(0, 3).toUpperCase();
  const badgeClassName = 'border-slate-500/40 bg-slate-500/15 text-slate-300';
  return {
    code: normalized,
    language: normalized,
    label: short,
    shortLabel: short,
    badgeClass: badgeClassName,
    badgeClassName,
    pillClassName: 'bg-slate-500/15 text-slate-300 border border-slate-500/30',
  };
}

export function resolveChapterLanguageCode(
  chapter?: Partial<Chapter> | { title?: string | null; pages?: string[]; language?: string | null } | null,
  fallbackSeriesLang?: string | null,
): string {
  if (!chapter) return normalizeLanguageCode(fallbackSeriesLang || 'tr');
  const explicitLang = (chapter as any).language;
  if (typeof explicitLang === 'string' && explicitLang.trim()) {
    return normalizeLanguageCode(explicitLang);
  }
  const titleLower = String(chapter.title || '').toLowerCase();
  if (titleLower.includes('[raw]') || titleLower.includes('(raw)')) {
    return 'raw';
  }
  if (titleLower.includes('[en]') || titleLower.includes('(en)') || titleLower.includes('[english]')) {
    return 'en';
  }
  if (
    Array.isArray(chapter.pages) &&
    chapter.pages.some((p) => typeof p === 'string' && (p.includes('comix') || /\/hi\/[A-Za-z0-9_-]+/.test(p)))
  ) {
    return fallbackSeriesLang && fallbackSeriesLang !== 'tr'
      ? normalizeLanguageCode(fallbackSeriesLang)
      : 'en';
  }
  return normalizeLanguageCode(fallbackSeriesLang || 'tr');
}

export function getChapterLanguageInfo(
  chapter?: Partial<Chapter> | { title?: string | null; pages?: string[]; language?: string | null } | null,
  fallbackSeriesLang?: string | null,
): SeriesLanguageInfo {
  return getLanguageInfoByCode(resolveChapterLanguageCode(chapter, fallbackSeriesLang));
}

/**
 * Bir serinin birincil dilini belirler (TR, EN veya RAW).
 */
export function getSeriesLanguage(manga?: Partial<Manga> | null): SeriesLanguage {
  if (!manga) return 'tr';

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

  const primarySource = ((manga.details as any)?.primarySource || '').toLowerCase();
  const turkishSources = new Set(['webtoonhatti', 'siyahmelek', 'okutoon', 'golgebahcesi', 'dxdfansub', 'hentaiturk', 'mangacix', 'hattorimanga']);

  // 2. Primary Source is decisive
  if (turkishSources.has(primarySource)) {
    return 'tr';
  }
  if (primarySource === 'mangadass') {
    return titleLower.includes('raw') ? 'raw' : 'en';
  }
  if (primarySource === 'comix' || primarySource === 'madaradex' || primarySource === 'mgread' || primarySource === 'ezmanga') {
    return 'en';
  }

  // 3. Metadata details.language
  const detailsLang = (manga.details as any)?.language || (manga as any)?.language || (manga as any)?.mangaLanguage;
  if (detailsLang === 'raw') return 'raw';
  if (detailsLang === 'en') return 'en';
  if (detailsLang === 'tr') return 'tr';

  // 4. Genres check
  const genres = Array.isArray(manga.genres) ? manga.genres : [];
  if (genres.some((g) => String(g).toUpperCase() === 'RAW')) return 'raw';
  if (genres.some((g) => {
    const s = String(g).toLowerCase();
    return s === 'ingilizce' || s === 'i̇ngilizce' || s === 'english' || s === 'en';
  })) return 'en';

  // 5. Source links check (only if primarySource was not set)
  const sources = manga.sourceLinks || (manga as any)?.source_links || [];
  const hasRawSource = sources.some(
    (s: any) =>
      (s.source || '').toLowerCase() === 'mangadass' &&
      (s.url?.includes('/raw-manhwa') || s.url?.includes('-raw')),
  );
  if (hasRawSource) return 'raw';

  const hasTurkishSource = sources.some((s: any) => turkishSources.has((s.source || '').toLowerCase()));
  if (hasTurkishSource) return 'tr';

  const hasEnglishSource = sources.some((s: any) => {
    const src = (s.source || '').toLowerCase();
    const url = (s.url || '').toLowerCase();
    return (
      src.includes('comix') ||
      src.includes('madaradex') ||
      src.includes('mgread') ||
      src.includes('mangadex') ||
      src.includes('mangafreak') ||
      src.includes('ezmanga') ||
      (src.includes('mangadass') && !url.includes('/raw-manhwa') && !url.includes('-raw'))
    );
  });
  if (hasEnglishSource) return 'en';

  return 'tr';
}

/**
 * Belirli bir serinin dil yapılandırmasını döner.
 */
export function getSeriesLanguageInfo(manga?: Partial<Manga> | null): SeriesLanguageInfo {
  const lang = getSeriesLanguage(manga);
  return LANGUAGE_CONFIG[lang];
}
