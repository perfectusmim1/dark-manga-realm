import type { Manga, Chapter } from '@/lib/types';

export type SeriesLanguage = 'tr' | 'en' | 'raw';

export interface SeriesLanguageInfo {
  code: string;
  language: string;
  label: string;
  shortLabel: string;
  flag: string;
  badgeClass: string;
  badgeClassName: string;
  pillClassName: string;
}

const RAW_LANGUAGE_CONFIG: Record<string, Omit<SeriesLanguageInfo, 'code' | 'badgeClass'>> = {
  tr: {
    language: 'tr',
    label: 'Türkçe',
    shortLabel: 'TR',
    flag: '🇹🇷',
    badgeClassName: 'border-emerald-500/35 bg-emerald-500/12 text-emerald-400',
    pillClassName: 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30',
  },
  en: {
    language: 'en',
    label: 'İngilizce',
    shortLabel: 'EN',
    flag: '🇬🇧',
    badgeClassName: 'border-sky-500/40 bg-sky-500/15 text-sky-400',
    pillClassName: 'bg-sky-500/15 text-sky-400 border border-sky-500/30',
  },
  es: {
    language: 'es',
    label: 'İspanyolca',
    shortLabel: 'ES',
    flag: '🇪🇸',
    badgeClassName: 'border-amber-500/40 bg-amber-500/15 text-amber-400',
    pillClassName: 'bg-amber-500/15 text-amber-400 border border-amber-500/30',
  },
  'pt-br': {
    language: 'pt-br',
    label: 'Portekizce',
    shortLabel: 'PT',
    flag: '🇧🇷',
    badgeClassName: 'border-lime-500/40 bg-lime-500/15 text-lime-400',
    pillClassName: 'bg-lime-500/15 text-lime-400 border border-lime-500/30',
  },
  ru: {
    language: 'ru',
    label: 'Rusça',
    shortLabel: 'RU',
    flag: '🇷🇺',
    badgeClassName: 'border-indigo-500/40 bg-indigo-500/15 text-indigo-400',
    pillClassName: 'bg-indigo-500/15 text-indigo-400 border border-indigo-500/30',
  },
  fr: {
    language: 'fr',
    label: 'Fransızca',
    shortLabel: 'FR',
    flag: '🇫🇷',
    badgeClassName: 'border-blue-500/40 bg-blue-500/15 text-blue-400',
    pillClassName: 'bg-blue-500/15 text-blue-400 border border-blue-500/30',
  },
  id: {
    language: 'id',
    label: 'Endonezce',
    shortLabel: 'ID',
    flag: '🇮🇩',
    badgeClassName: 'border-rose-500/40 bg-rose-500/15 text-rose-400',
    pillClassName: 'bg-rose-500/15 text-rose-400 border border-rose-500/30',
  },
  ar: {
    language: 'ar',
    label: 'Arapça',
    shortLabel: 'AR',
    flag: '🇸🇦',
    badgeClassName: 'border-teal-500/40 bg-teal-500/15 text-teal-400',
    pillClassName: 'bg-teal-500/15 text-teal-400 border border-teal-500/30',
  },
  de: {
    language: 'de',
    label: 'Almanca',
    shortLabel: 'DE',
    flag: '🇩🇪',
    badgeClassName: 'border-yellow-500/40 bg-yellow-500/15 text-yellow-400',
    pillClassName: 'bg-yellow-500/15 text-yellow-400 border border-yellow-500/30',
  },
  it: {
    language: 'it',
    label: 'İtalyanca',
    shortLabel: 'IT',
    flag: '🇮🇹',
    badgeClassName: 'border-cyan-500/40 bg-cyan-500/15 text-cyan-400',
    pillClassName: 'bg-cyan-500/15 text-cyan-400 border border-cyan-500/30',
  },
  pl: {
    language: 'pl',
    label: 'Lehçe',
    shortLabel: 'PL',
    flag: '🇵🇱',
    badgeClassName: 'border-pink-500/40 bg-pink-500/15 text-pink-400',
    pillClassName: 'bg-pink-500/15 text-pink-400 border border-pink-500/30',
  },
  vi: {
    language: 'vi',
    label: 'Vietnamca',
    shortLabel: 'VI',
    flag: '🇻🇳',
    badgeClassName: 'border-orange-500/40 bg-orange-500/15 text-orange-400',
    pillClassName: 'bg-orange-500/15 text-orange-400 border border-orange-500/30',
  },
  th: {
    language: 'th',
    label: 'Tayca',
    shortLabel: 'TH',
    flag: '🇹🇭',
    badgeClassName: 'border-fuchsia-500/40 bg-fuchsia-500/15 text-fuchsia-400',
    pillClassName: 'bg-fuchsia-500/15 text-fuchsia-400 border border-fuchsia-500/30',
  },
  ja: {
    language: 'ja',
    label: 'Japonca',
    shortLabel: 'JA',
    flag: '🇯🇵',
    badgeClassName: 'border-purple-500/40 bg-purple-500/15 text-purple-400',
    pillClassName: 'bg-purple-500/15 text-purple-400 border border-purple-500/30',
  },
  ko: {
    language: 'ko',
    label: 'Korece',
    shortLabel: 'KO',
    flag: '🇰🇷',
    badgeClassName: 'border-violet-500/40 bg-violet-500/15 text-violet-400',
    pillClassName: 'bg-violet-500/15 text-violet-400 border border-violet-500/30',
  },
  zh: {
    language: 'zh',
    label: 'Çince',
    shortLabel: 'ZH',
    flag: '🇨🇳',
    badgeClassName: 'border-red-500/40 bg-red-500/15 text-red-400',
    pillClassName: 'bg-red-500/15 text-red-400 border border-red-500/30',
  },
  raw: {
    language: 'raw',
    label: 'RAW (Orijinal)',
    shortLabel: 'RAW',
    flag: 'RAW',
    badgeClassName: 'border-purple-500/40 bg-purple-500/15 text-purple-400',
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
  if (code === 'tr' || code === 'tr-tr' || code === 'tur' || code === 'turkish' || code === 'türkçe' || code === 'turkce') return 'tr';
  if (code === 'en' || code === 'en-us' || code === 'en-gb' || code === 'eng' || code === 'english' || code === 'ingilizce') return 'en';
  if (code === 'es' || code === 'es-la' || code === 'es-es' || code === 'es-419' || code === 'spa' || code === 'esp' || code === 'spanish' || code === 'español' || code === 'espanol' || code === 'ispanyolca') return 'es';
  if (code === 'pt' || code === 'pt-br' || code === 'pt_br' || code === 'por' || code === 'portuguese' || code === 'português' || code === 'portugues' || code === 'portekizce') return 'pt-br';
  if (code === 'fr' || code === 'fr-fr' || code === 'fre' || code === 'fra' || code === 'french' || code === 'français' || code === 'francais' || code === 'fransızca') return 'fr';
  if (code === 'de' || code === 'de-de' || code === 'ger' || code === 'deu' || code === 'german' || code === 'deutsch' || code === 'almanca') return 'de';
  if (code === 'it' || code === 'it-it' || code === 'ita' || code === 'italian' || code === 'italiano' || code === 'italyanca') return 'it';
  if (code === 'pl' || code === 'pl-pl' || code === 'pol' || code === 'polish' || code === 'polski' || code === 'lehçe') return 'pl';
  if (code === 'ru' || code === 'ru-ru' || code === 'rus' || code === 'russian' || code === 'русский' || code === 'rusça') return 'ru';
  if (code === 'vi' || code === 'vi-vn' || code === 'vie' || code === 'vietnamese' || code === 'tiếng việt' || code === 'tieng viet' || code === 'vietnamca') return 'vi';
  if (code === 'id' || code === 'id-id' || code === 'ind' || code === 'indo' || code === 'indonesian' || code === 'bahasa' || code === 'bahasa indonesia' || code === 'endonezce') return 'id';
  if (code === 'th' || code === 'th-th' || code === 'tha' || code === 'thai' || code === 'tayca') return 'th';
  if (code === 'ar' || code === 'ar-sa' || code === 'ara' || code === 'arabic' || code === 'arapça' || code === 'العربية') return 'ar';
  if (code === 'zh' || code === 'cn' || code === 'chi' || code === 'zho' || code === 'zh-hk' || code === 'zh-cn' || code === 'zh-tw' || code === 'chinese' || code === 'çince') return 'zh';
  if (code === 'jp' || code === 'ja' || code === 'ja-jp' || code === 'jpn' || code === 'japanese' || code === 'japonca') return 'ja';
  if (code === 'kr' || code === 'ko' || code === 'ko-kr' || code === 'kor' || code === 'korean' || code === 'korece') return 'ko';
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
    flag: short,
    badgeClass: badgeClassName,
    badgeClassName,
    pillClassName: 'bg-slate-500/15 text-slate-300 border border-slate-500/30',
  };
}

const TITLE_TAG_TO_LANG: ReadonlyArray<readonly [RegExp, string]> = [
  [/^(?:raw|raw\s+scan|original|orijinal)$/iu, 'raw'],
  [/^(?:tr|türkçe(?:\s+çeviri)?|turkce(?:\s+ceviri)?|turkish)$/iu, 'tr'],
  [/^(?:en|eng|english|ingilizce(?:\s+çeviri)?|ingilizce\s+ceviri)$/iu, 'en'],
  [/^(?:es|esp|es-la|es-419|spa|español|espanol|spanish|ispanyolca)$/iu, 'es'],
  [/^(?:pt|pt-br|pt_br|por|português|portugues|portuguese|portekizce)$/iu, 'pt-br'],
  [/^(?:fr|fra|fre|français|francais|french|fransızca)$/iu, 'fr'],
  [/^(?:de|ger|deu|deutsch|german|almanca)$/iu, 'de'],
  [/^(?:it|ita|italiano|italian|italyanca)$/iu, 'it'],
  [/^(?:pl|pol|polski|polish|lehçe)$/iu, 'pl'],
  [/^(?:ru|rus|русский|russian|rusça)$/iu, 'ru'],
  [/^(?:vi|vie|tiếng\s*việt|tieng\s*viet|vietnamese|vietnamca)$/iu, 'vi'],
  [/^(?:id|ind|indo|indonesian|bahasa(?:\s+indonesia)?|endonezce)$/iu, 'id'],
  [/^(?:th|tha|thai|tayca|ไทย)$/iu, 'th'],
  [/^(?:ar|ara|arabic|arapça|العربية)$/iu, 'ar'],
  [/^(?:ja|jp|jpn|japanese|japonca|日本語)$/iu, 'ja'],
  [/^(?:ko|kr|kor|korean|korece|한국어)$/iu, 'ko'],
  [/^(?:zh|cn|chi|zho|zh-cn|zh-tw|zh-hk|chinese|çince|中文)$/iu, 'zh'],
];

function detectExplicitLanguageInTitle(rawTitle?: string | null): string | null {
  const title = String(rawTitle || '').trim();
  if (!title) return null;

  // 1. Parantez/köşeli parantez içindeki etiketler: [TR], (Türkçe), [EN], [RAW], (PT-BR) vb.
  const bracketMatches = title.matchAll(/[\[({]\s*([^\]\)}]{1,40})\s*[\])}]/gu);
  for (const m of bracketMatches) {
    const inner = (m[1] || '').trim();
    for (const [pattern, code] of TITLE_TAG_TO_LANG) {
      if (pattern.test(inner)) return code;
    }
  }

  // 2. Satır sonu ayıraçlı kısa kod/isim: "Bölüm 12 - TR", "Chapter 5 | EN", "Ch 3 - RAW", "Bölüm 8 Türkçe"
  const sepCodeMatch = title.match(/(?:^|\s|[-–—|/])[-–—|/]\s*([a-zA-Z]{2,5}(?:-[a-zA-Z]{2,4})?)\s*$/u);
  if (sepCodeMatch) {
    const tok = sepCodeMatch[1].trim();
    for (const [pattern, code] of TITLE_TAG_TO_LANG) {
      if (pattern.test(tok)) return code;
    }
  }

  const trailingWordMatch = title.match(
    /(?:^|[\s\-–—|/])(raw|türkçe(?:\s+çeviri)?|turkish|ingilizce(?:\s+çeviri)?|english|español|spanish|português|portuguese|français|french|deutsch|german|italiano|italian|polski|polish|русский|russian|tiếng\s*việt|vietnamese|indonesian|arabic|japanese|japonca|korean|korece|chinese|çince)\s*$/iu,
  );
  if (trailingWordMatch) {
    const tok = trailingWordMatch[1].trim();
    for (const [pattern, code] of TITLE_TAG_TO_LANG) {
      if (pattern.test(tok)) return code;
    }
  }

  return null;
}

export function resolveChapterLanguageCode(
  chapter?: string | Partial<Chapter> | { title?: string | null; pages?: string[]; language?: string | null } | null,
  fallbackSeriesLang?: string | null,
): string {
  if (!chapter) return normalizeLanguageCode(fallbackSeriesLang || 'tr');
  const title = typeof chapter === 'string' ? chapter : String(chapter.title || '');
  const titleTagLang = detectExplicitLanguageInTitle(title);
  if (titleTagLang) {
    return titleTagLang;
  }
  const explicitLang = typeof chapter === 'object' && chapter !== null ? (chapter as any).language : undefined;
  if (typeof explicitLang === 'string' && explicitLang.trim()) {
    return normalizeLanguageCode(explicitLang);
  }
  return normalizeLanguageCode(fallbackSeriesLang || 'tr');
}

export function getChapterLanguageInfo(
  chapter?: string | Partial<Chapter> | { title?: string | null; pages?: string[]; language?: string | null } | null,
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
  const titleTagLang = detectExplicitLanguageInTitle(manga.title);

  // 1. RAW / explicit language check by title or slug
  if (
    titleTagLang === 'raw' ||
    titleLower.includes('(raw)') ||
    titleLower.includes('[raw]') ||
    titleLower.includes(' raw') ||
    titleLower.endsWith('-raw') ||
    slugLower.endsWith('-raw')
  ) {
    return 'raw';
  }
  if (titleTagLang === 'en') return 'en';
  if (titleTagLang === 'tr') return 'tr';

  // 2. Explicit metadata details.language or availableLanguages
  const detailsObj = (manga.details as any) || {};
  const detailsLang = String(
    detailsObj.language || (manga as any)?.language || (manga as any)?.mangaLanguage || '',
  ).toLowerCase();
  if (detailsLang === 'raw') return 'raw';
  if (detailsLang === 'en') return 'en';
  if (detailsLang === 'tr') return 'tr';

  const availLangs: string[] = Array.isArray(detailsObj.availableLanguages)
    ? detailsObj.availableLanguages.map((l: any) => String(l || '').toLowerCase())
    : [];
  if (availLangs.length > 0 && !availLangs.includes('tr')) {
    return availLangs.includes('raw') ? 'raw' : 'en';
  }

  const primarySource = String(detailsObj.primarySource || '').toLowerCase();
  const turkishSources = new Set([
    'webtoonhatti',
    'siyahmelek',
    'okutoon',
    'golgebahcesi',
    'dxdfansub',
    'hentaiturk',
    'mangacix',
    'hattorimanga',
  ]);

  // 3. Primary Source
  if (turkishSources.has(primarySource)) {
    return 'tr';
  }
  if (primarySource === 'mangadass') {
    return titleLower.includes('raw') ? 'raw' : 'en';
  }
  if (
    primarySource === 'madaradex' ||
    primarySource === 'mgread' ||
    primarySource === 'ezmanga'
  ) {
    return 'en';
  }

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
