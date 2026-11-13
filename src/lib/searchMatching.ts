import type { Artist, Author, Character, Manga } from '@/lib/types';
import { normalizeComparableText, normalizeLooseComparableText } from '@/lib/textMatching';

type SearchableNamedEntity = Pick<Character, 'name' | 'alternativeNames' | 'details'>
  | Pick<Author, 'name' | 'alternativeNames' | 'details'>
  | Pick<Artist, 'name' | 'alternativeNames' | 'details'>;

export interface PreparedSearchQuery {
  normalized: string;
  loose: string;
  tokens: string[];
}

interface IndexedSearchField {
  norm: string;
  loose?: string;
  tokens?: string[];
}

interface IndexedMangaSearch {
  title: IndexedSearchField | null;
  secondary: IndexedSearchField[];
}

const normalizeSearchValue = (value?: string | null) => normalizeComparableText(value);

const tokenizeNormalizedValue = (normalizedValue: string) => normalizedValue
  .replace(/[^\p{L}\p{N}]+/gu, ' ')
  .split(' ')
  .map((token) => token.trim())
  .filter(Boolean);

const createIndexedField = (value?: string | null): IndexedSearchField | null => {
  const norm = normalizeSearchValue(value);
  return norm ? { norm } : null;
};

const getFieldLoose = (field: IndexedSearchField): string => {
  if (field.loose === undefined) {
    field.loose = field.norm.replace(/[^a-z0-9]/g, '');
  }
  return field.loose;
};

const getFieldTokens = (field: IndexedSearchField): string[] => {
  if (!field.tokens) {
    field.tokens = tokenizeNormalizedValue(field.norm);
  }
  return field.tokens;
};

const matchesIndexedField = (field: IndexedSearchField, query: PreparedSearchQuery): boolean => {
  if (field.norm.includes(query.normalized)) {
    return true;
  }

  if (query.loose && getFieldLoose(field).includes(query.loose)) {
    return true;
  }

  if (query.tokens.length === 0) {
    return false;
  }

  const valueTokens = getFieldTokens(field);
  return query.tokens.every((queryToken) => valueTokens.some((valueToken) => valueToken.includes(queryToken)));
};

const getEntityExtraSearchTerms = (entity: SearchableNamedEntity) => (
  Object.values(entity.details?.extra || {})
    .flatMap((value) => (Array.isArray(value) ? value : [value]))
    .map((value) => (typeof value === 'string' || typeof value === 'number' ? String(value) : undefined))
);

const getEntitySearchTerms = (entity: SearchableNamedEntity) => ([
  entity.name,
  ...(entity.alternativeNames || []),
  entity.details?.nativeName,
  entity.details?.englishName,
  entity.details?.romajiName,
  entity.details?.gender,
  entity.details?.role,
  entity.details?.className,
  entity.details?.rankTitle,
  ...(entity.details?.affiliation || []),
  ...(entity.details?.relatives || []),
  ...(entity.details?.genres || []),
  ...(entity.details?.tags || []),
  ...getEntityExtraSearchTerms(entity),
]);

const indexedEntityCache = new WeakMap<object, IndexedSearchField[]>();
const indexedMangaCache = new WeakMap<object, IndexedMangaSearch>();

const getIndexedEntityFields = (entity: SearchableNamedEntity): IndexedSearchField[] => {
  const cached = indexedEntityCache.get(entity);
  if (cached) {
    return cached;
  }

  const fields = getEntitySearchTerms(entity)
    .map(createIndexedField)
    .filter((field): field is IndexedSearchField => field !== null);

  indexedEntityCache.set(entity, fields);
  return fields;
};

const getIndexedMangaFields = (manga: Manga): IndexedMangaSearch => {
  const cached = indexedMangaCache.get(manga);
  if (cached) {
    return cached;
  }

  const title = createIndexedField(manga.title);
  const secondaryRawTerms: Array<string | null | undefined> = [
    manga.author,
    manga.artist,
    ...(manga.alternativeTitles || []),
    ...(manga.authorDetails ? getEntitySearchTerms(manga.authorDetails) : []),
    ...(manga.artistDetails ? getEntitySearchTerms(manga.artistDetails) : []),
    ...(manga.authorsDetails?.flatMap((author) => getEntitySearchTerms(author)) || []),
    ...(manga.artistsDetails?.flatMap((artist) => getEntitySearchTerms(artist)) || []),
  ];

  const seenNorms = new Set<string>(title ? [title.norm] : []);
  const secondary: IndexedSearchField[] = [];
  for (const term of secondaryRawTerms) {
    const field = createIndexedField(term);
    if (field && !seenNorms.has(field.norm)) {
      seenNorms.add(field.norm);
      secondary.push(field);
    }
  }

  const entry: IndexedMangaSearch = { title, secondary };
  indexedMangaCache.set(manga, entry);
  return entry;
};

export const prepareSearchQuery = (rawQuery: string): PreparedSearchQuery => {
  const normalized = normalizeSearchValue(rawQuery);
  if (!normalized) {
    return { normalized: '', loose: '', tokens: [] };
  }

  return {
    normalized,
    loose: normalizeLooseComparableText(normalized),
    tokens: tokenizeNormalizedValue(normalized),
  };
};

export const normalizeSearchQuery = (query: string) => normalizeSearchValue(query);

export const matchesNamedEntityPreparedSearch = (
  entity: SearchableNamedEntity,
  query: PreparedSearchQuery,
) => {
  if (!query.normalized) {
    return false;
  }

  const fields = getIndexedEntityFields(entity);
  for (let index = 0; index < fields.length; index += 1) {
    if (matchesIndexedField(fields[index], query)) {
      return true;
    }
  }
  return false;
};

export const matchesNamedEntitySearch = (
  entity: SearchableNamedEntity,
  rawQuery: string,
) => matchesNamedEntityPreparedSearch(entity, prepareSearchQuery(rawQuery));

export const matchesCharacterSearch = (character: Character, rawQuery: string) => (
  matchesNamedEntitySearch(character, rawQuery)
);

export const scoreMangaPreparedSearch = (
  manga: Manga,
  query: PreparedSearchQuery,
): number => {
  if (!query.normalized) {
    return 0;
  }

  const indexed = getIndexedMangaFields(manga);
  if (indexed.title) {
    if (indexed.title.norm === query.normalized) {
      return 500;
    }
    if (indexed.title.norm.startsWith(query.normalized)) {
      return 400;
    }
    if (indexed.title.norm.includes(query.normalized)) {
      return 300;
    }
    if (matchesIndexedField(indexed.title, query)) {
      return 200;
    }
  }

  for (let index = 0; index < indexed.secondary.length; index += 1) {
    if (matchesIndexedField(indexed.secondary[index], query)) {
      return 100;
    }
  }

  return 0;
};

export const matchesMangaPreparedSearch = (
  manga: Manga,
  query: PreparedSearchQuery,
) => scoreMangaPreparedSearch(manga, query) > 0;

export const matchesMangaSearch = (manga: Manga, rawQuery: string) => (
  matchesMangaPreparedSearch(manga, prepareSearchQuery(rawQuery))
);

export const takeTopEntityMatches = <T extends SearchableNamedEntity>(
  items: readonly T[],
  rawQuery: string,
  limit: number,
): T[] => {
  const prepared = prepareSearchQuery(rawQuery);
  if (!prepared.normalized || limit <= 0) {
    return [];
  }

  const matches: T[] = [];
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (matchesNamedEntityPreparedSearch(item, prepared)) {
      matches.push(item);
      if (matches.length >= limit) {
        break;
      }
    }
  }

  return matches;
};

export const rankTopMangaMatches = (
  items: readonly Manga[],
  rawQuery: string,
  limit?: number,
): Manga[] => {
  const prepared = prepareSearchQuery(rawQuery);
  if (!prepared.normalized) {
    return [];
  }

  const scored: Array<{ manga: Manga; score: number }> = [];
  for (let index = 0; index < items.length; index += 1) {
    const manga = items[index];
    const score = scoreMangaPreparedSearch(manga, prepared);
    if (score > 0) {
      scored.push({ manga, score });
    }
  }

  scored.sort((left, right) => {
    if (right.score !== left.score) {
      return right.score - left.score;
    }
    const leftViews = left.manga.views || 0;
    const rightViews = right.manga.views || 0;
    if (rightViews !== leftViews) {
      return rightViews - leftViews;
    }
    return left.manga.title.length - right.manga.title.length;
  });

  const sliced = typeof limit === 'number' && limit > 0 ? scored.slice(0, limit) : scored;
  return sliced.map((entry) => entry.manga);
};
