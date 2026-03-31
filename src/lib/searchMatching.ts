import type { Artist, Author, Character, Manga } from '@/lib/types';

type SearchableNamedEntity = Pick<Character, 'name' | 'alternativeNames' | 'details'>
  | Pick<Author, 'name' | 'alternativeNames' | 'details'>
  | Pick<Artist, 'name' | 'alternativeNames' | 'details'>;

const normalizeSearchValue = (value?: string | null) => value?.trim().toLocaleLowerCase('tr-TR') || '';

const tokenizeSearchValue = (value?: string | null) => normalizeSearchValue(value)
  .replace(/[^\p{L}\p{N}]+/gu, ' ')
  .split(' ')
  .map((token) => token.trim())
  .filter(Boolean);

const matchesValue = (value: string | null | undefined, query: string) => {
  const normalizedValue = normalizeSearchValue(value);
  if (!normalizedValue) {
    return false;
  }

  if (normalizedValue.includes(query)) {
    return true;
  }

  const queryTokens = tokenizeSearchValue(query);
  if (queryTokens.length === 0) {
    return false;
  }

  const valueTokens = tokenizeSearchValue(value);
  return queryTokens.every((queryToken) => valueTokens.some((valueToken) => valueToken.includes(queryToken)));
};

const matchesAnyValue = (values: Array<string | null | undefined> | undefined, query: string) => (
  Boolean(values?.some((value) => matchesValue(value, query)))
);

const getEntitySearchTerms = (entity: SearchableNamedEntity) => ([
  entity.name,
  ...(entity.alternativeNames || []),
  entity.details?.nativeName,
  entity.details?.englishName,
  entity.details?.romajiName,
]);

export const normalizeSearchQuery = (query: string) => normalizeSearchValue(query);

export const matchesNamedEntitySearch = (
  entity: SearchableNamedEntity,
  rawQuery: string,
) => {
  const query = normalizeSearchValue(rawQuery);
  if (!query) {
    return false;
  }

  return matchesAnyValue(getEntitySearchTerms(entity), query);
};

export const matchesCharacterSearch = (character: Character, rawQuery: string) => (
  matchesNamedEntitySearch(character, rawQuery)
);

export const matchesMangaSearch = (manga: Manga, rawQuery: string) => {
  const query = normalizeSearchValue(rawQuery);
  if (!query) {
    return false;
  }

  return matchesAnyValue([
    manga.title,
    manga.author,
    manga.artist,
    ...(manga.alternativeTitles || []),
    ...(manga.authorDetails ? getEntitySearchTerms(manga.authorDetails) : []),
    ...(manga.artistDetails ? getEntitySearchTerms(manga.artistDetails) : []),
    ...(manga.authorsDetails?.flatMap((author) => getEntitySearchTerms(author)) || []),
    ...(manga.artistsDetails?.flatMap((artist) => getEntitySearchTerms(artist)) || []),
  ], query);
};
