import type { Manga } from '@/lib/types';
import { normalizeGenres } from '@/lib/mockData';
import { normalizeAdultMangaType } from '@/lib/mangaType';

const ADULT_FORMAT_GENRES = ['Yetişkin', 'Hentai', 'Webtoon Hentai'] as const;

interface AdultContentFormatOptions {
  isAdult?: boolean;
  type?: Manga['type'];
  genres?: readonly string[] | null;
}

export const getAdultContentFormatLabel = ({
  isAdult,
  type,
  genres,
}: AdultContentFormatOptions): string | null => {
  const normalizedType = normalizeAdultMangaType(type, genres, isAdult);

  if (!isAdult && normalizedType !== 'hentai' && normalizedType !== 'webtoon_hentai') {
    return null;
  }

  return normalizedType === 'webtoon_hentai' ? 'Webtoon Hentai' : 'Hentai';
};

export const syncAdultContentGenres = (
  genres: readonly string[] | null | undefined,
  options: AdultContentFormatOptions,
): string[] => {
  const normalizedGenres = normalizeGenres(genres || []);
  const cleanedGenres = normalizedGenres.filter((genre) => !ADULT_FORMAT_GENRES.includes(genre as typeof ADULT_FORMAT_GENRES[number]));

  if (!options.isAdult) {
    return cleanedGenres;
  }

  const normalizedType = normalizeAdultMangaType(options.type, genres, options.isAdult);
  const adultFormatLabel = getAdultContentFormatLabel({ ...options, type: normalizedType });
  return normalizeGenres([
    ...cleanedGenres,
    'Yetişkin',
    ...(adultFormatLabel ? [adultFormatLabel] : []),
  ]);
};
