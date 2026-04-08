import { normalizeGenres } from '@/lib/mockData';
import type { Manga } from '@/lib/types';

export const isAdultMangaType = (type?: Manga['type'] | null) => (
  type === 'hentai' || type === 'webtoon_hentai'
);

export const isWebtoonLikeMangaType = (type?: Manga['type'] | null) => (
  type === 'manhwa' || type === 'webtoon' || type === 'webtoon_hentai'
);

export const normalizeAdultMangaType = (
  type: Manga['type'] | null | undefined,
  genres?: readonly string[] | null,
  isAdult?: boolean,
): Manga['type'] => {
  if (isAdultMangaType(type)) {
    return type;
  }

  const fallbackType = type || 'manga';
  if (!isAdult) {
    return fallbackType;
  }

  const normalizedGenres = normalizeGenres(genres || []);
  const isWebtoonLike = (
    isWebtoonLikeMangaType(fallbackType)
    || normalizedGenres.includes('Webtoon')
    || normalizedGenres.includes('Manhwa')
  );

  return isWebtoonLike ? 'webtoon_hentai' : 'hentai';
};

export const getMangaTypeLabel = (type?: Manga['type'] | null) => {
  switch (type) {
    case 'manhwa':
      return 'Manhwa';
    case 'manhua':
      return 'Manhua';
    case 'webtoon':
      return 'Webtoon';
    case 'hentai':
    case 'webtoon_hentai':
      return 'Yetişkin';
    case 'manga':
    default:
      return 'Manga';
  }
};
