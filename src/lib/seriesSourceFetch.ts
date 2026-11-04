export type SeriesSourceProvider = 'anilist' | 'myanimelist';

export interface FetchedSeriesInfo {
  provider: SeriesSourceProvider;
  providerLabel: string;
  id: string;
  sourceUrl: string;
  title: string;
  alternativeTitles: string[];
  coverUrl?: string;
  description?: string;
  format?: string;
  status?: string;
  genres: string[];
  score?: number | string;
  year?: number | string;
  authors: string[];
}

const ANILIST_URL_PATTERN = /(?:https?:\/\/)?(?:www\.)?anilist\.co\/manga\/(\d+)/i;
const MAL_URL_PATTERN = /(?:https?:\/\/)?(?:www\.)?myanimelist\.net\/manga\/(\d+)/i;

const metadataCache = new Map<string, FetchedSeriesInfo>();

export const detectSeriesSource = (input: string): { provider: SeriesSourceProvider; id: string } | null => {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const aniMatch = trimmed.match(ANILIST_URL_PATTERN);
  if (aniMatch && aniMatch[1]) {
    return { provider: 'anilist', id: aniMatch[1] };
  }

  const malMatch = trimmed.match(MAL_URL_PATTERN);
  if (malMatch && malMatch[1]) {
    return { provider: 'myanimelist', id: malMatch[1] };
  }

  return null;
};

const cleanDescription = (text?: string | null): string => {
  if (!text) return '';
  return text
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?[^>]+(>|$)/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/\r\n/g, '\n')
    .trim();
};

const buildAniListQuery = (paramName: 'id' | 'idMal') => `
  query ($${paramName}: Int) {
    Media(${paramName}: $${paramName}, type: MANGA) {
      id
      idMal
      title {
        english
        romaji
        native
      }
      synonyms
      description(asHtml: false)
      format
      status
      genres
      averageScore
      startDate {
        year
      }
      coverImage {
        extraLarge
        large
        medium
      }
      staff(perPage: 6) {
        edges {
          role
          node {
            name {
              full
            }
          }
        }
      }
    }
  }
`;

const parseAniListMedia = (
  media: any,
  sourceUrl: string,
  provider: SeriesSourceProvider = 'anilist',
): FetchedSeriesInfo => {
  const primaryTitle = media.title?.english || media.title?.romaji || media.title?.native || `${provider === 'anilist' ? 'AniList' : 'MAL'} #${media.id}`;
  const alternativeTitles: string[] = [];

  if (media.title?.romaji && media.title.romaji !== primaryTitle) {
    alternativeTitles.push(media.title.romaji);
  }
  if (media.title?.english && media.title.english !== primaryTitle) {
    alternativeTitles.push(media.title.english);
  }
  if (media.title?.native && media.title.native !== primaryTitle) {
    alternativeTitles.push(media.title.native);
  }
  if (Array.isArray(media.synonyms)) {
    media.synonyms.forEach((syn: string) => {
      if (syn && !alternativeTitles.includes(syn) && syn !== primaryTitle) {
        alternativeTitles.push(syn);
      }
    });
  }

  const authors: string[] = [];
  if (media.staff?.edges) {
    media.staff.edges.forEach((edge: { role?: string; node?: { name?: { full?: string } } }) => {
      const name = edge.node?.name?.full;
      if (name && !authors.includes(name)) {
        authors.push(name);
      }
    });
  }

  const coverUrl = media.coverImage?.extraLarge || media.coverImage?.large || media.coverImage?.medium;

  return {
    provider,
    providerLabel: provider === 'anilist' ? 'AniList' : 'MyAnimeList',
    id: String(provider === 'myanimelist' && media.idMal ? media.idMal : media.id),
    sourceUrl,
    title: primaryTitle,
    alternativeTitles,
    coverUrl,
    description: cleanDescription(media.description),
    format: media.format ? String(media.format).replace(/_/g, ' ') : undefined,
    status: media.status ? String(media.status).replace(/_/g, ' ') : undefined,
    genres: Array.isArray(media.genres) ? media.genres : [],
    score: media.averageScore ? `${media.averageScore}%` : undefined,
    year: media.startDate?.year,
    authors,
  };
};

const fetchAniListSeries = async (id: string, sourceUrl: string, signal?: AbortSignal): Promise<FetchedSeriesInfo> => {
  const numericId = parseInt(id, 10);
  if (!numericId) {
    throw new Error('Geçersiz AniList ID');
  }

  const response = await fetch('https://graphql.anilist.co', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      query: buildAniListQuery('id'),
      variables: { id: numericId },
    }),
    signal,
  });

  if (!response.ok) {
    throw new Error(`AniList sunucu hatası (${response.status})`);
  }

  const result = await response.json();
  if (result.errors && result.errors.length > 0) {
    throw new Error(result.errors[0]?.message || 'AniList serisi bulunamadı');
  }

  const media = result.data?.Media;
  if (!media) {
    throw new Error('AniList seri kaydı bulunamadı');
  }

  return parseAniListMedia(media, sourceUrl, 'anilist');
};

const fetchMyAnimeListSeries = async (id: string, sourceUrl: string, signal?: AbortSignal): Promise<FetchedSeriesInfo> => {
  const numericId = parseInt(id, 10);
  if (!numericId) {
    throw new Error('Geçersiz MyAnimeList ID');
  }

  // 1. Önce Jikan REST API'sini kısa bir timeout ile dene
  try {
    const jikanController = new AbortController();
    const jikanTimeout = setTimeout(() => jikanController.abort(), 3500);

    const onParentAbort = () => jikanController.abort();
    if (signal) {
      signal.addEventListener('abort', onParentAbort);
    }

    const response = await fetch(`https://api.jikan.moe/v4/manga/${numericId}/full`, {
      headers: {
        Accept: 'application/json',
      },
      signal: jikanController.signal,
    }).finally(() => {
      clearTimeout(jikanTimeout);
      if (signal) {
        signal.removeEventListener('abort', onParentAbort);
      }
    });

    if (response.ok) {
      const result = await response.json();
      const manga = result.data;
      if (manga) {
        const primaryTitle = manga.title_english || manga.title || `MAL #${id}`;
        const alternativeTitles: string[] = [];

        if (manga.title && manga.title !== primaryTitle) {
          alternativeTitles.push(manga.title);
        }
        if (manga.title_japanese && manga.title_japanese !== primaryTitle) {
          alternativeTitles.push(manga.title_japanese);
        }
        if (Array.isArray(manga.title_synonyms)) {
          manga.title_synonyms.forEach((syn: string) => {
            if (syn && !alternativeTitles.includes(syn) && syn !== primaryTitle) {
              alternativeTitles.push(syn);
            }
          });
        }

        const genres: string[] = [];
        if (Array.isArray(manga.genres)) {
          manga.genres.forEach((g: { name?: string }) => {
            if (g.name && !genres.includes(g.name)) {
              genres.push(g.name);
            }
          });
        }
        if (Array.isArray(manga.themes)) {
          manga.themes.forEach((t: { name?: string }) => {
            if (t.name && !genres.includes(t.name)) {
              genres.push(t.name);
            }
          });
        }

        const authors: string[] = [];
        if (Array.isArray(manga.authors)) {
          manga.authors.forEach((a: { name?: string }) => {
            if (a.name && !authors.includes(a.name)) {
              authors.push(a.name);
            }
          });
        }

        const coverUrl = manga.images?.jpg?.large_image_url || manga.images?.jpg?.image_url || manga.images?.webp?.large_image_url;
        const startYear = manga.published?.from ? new Date(manga.published.from).getFullYear() : undefined;

        return {
          provider: 'myanimelist',
          providerLabel: 'MyAnimeList',
          id: String(manga.mal_id || id),
          sourceUrl,
          title: primaryTitle,
          alternativeTitles,
          coverUrl,
          description: cleanDescription(manga.synopsis),
          format: manga.type || undefined,
          status: manga.status || undefined,
          genres,
          score: manga.score ? `${manga.score} / 10` : undefined,
          year: isNaN(Number(startYear)) ? undefined : startYear,
          authors,
        };
      }
    }
  } catch {
    // Jikan timeout, rate limit veya network hatasında hızlıca AniList idMal sorgusuna geç
  }

  // 2. Fallback: AniList üzerinde idMal sorgusu (Hızlı, güvenilir, CORS destekli)
  const fallbackResponse = await fetch('https://graphql.anilist.co', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      query: buildAniListQuery('idMal'),
      variables: { idMal: numericId },
    }),
    signal,
  });

  if (!fallbackResponse.ok) {
    throw new Error(`MyAnimeList serisi sorgulanamadı (${fallbackResponse.status})`);
  }

  const fallbackResult = await fallbackResponse.json();
  const media = fallbackResult.data?.Media;
  if (!media) {
    throw new Error('MyAnimeList serisi bulunamadı');
  }

  return parseAniListMedia(media, sourceUrl, 'myanimelist');
};

export const fetchSeriesMetadataByUrl = async (
  url: string,
  signal?: AbortSignal,
): Promise<FetchedSeriesInfo | null> => {
  const detected = detectSeriesSource(url);
  if (!detected) {
    return null;
  }

  const cacheKey = `${detected.provider}:${detected.id}`;
  const cached = metadataCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  let info: FetchedSeriesInfo;
  if (detected.provider === 'anilist') {
    info = await fetchAniListSeries(detected.id, url, signal);
  } else {
    info = await fetchMyAnimeListSeries(detected.id, url, signal);
  }

  metadataCache.set(cacheKey, info);
  return info;
};

export const formatSeriesMetadataSummary = (info: FetchedSeriesInfo): string => {
  const parts: string[] = [];
  parts.push(`[${info.providerLabel}] ${info.title}`);

  if (info.format) {
    parts.push(`Tür: ${info.format}`);
  }
  if (info.year) {
    parts.push(`Yıl: ${info.year}`);
  }
  if (info.genres.length > 0) {
    parts.push(`Kategori: ${info.genres.slice(0, 4).join(', ')}`);
  }
  if (info.authors.length > 0) {
    parts.push(`Yazar: ${info.authors.slice(0, 2).join(', ')}`);
  }
  if (info.alternativeTitles.length > 0) {
    parts.push(`Alternatif İsimler: ${info.alternativeTitles.slice(0, 3).join(' / ')}`);
  }

  return parts.join(' | ');
};
