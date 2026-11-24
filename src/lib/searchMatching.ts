import type { Character, Manga } from '@/lib/types';
import { normalizeComparableText, normalizeLooseComparableText } from '@/lib/textMatching';

type SearchableNamedEntity = Pick<Character, 'name' | 'alternativeNames' | 'details'>;

export interface PreparedSearchQuery {
  normalized: string;
  loose: string;
  tokens: string[];
}

const NON_PRINTABLE_ASCII_PATTERN = /[^\u0020-\u007e]/;
const ASCII_TOKEN_SPLIT_PATTERN = /[^a-z0-9]+/;
const UNICODE_NON_WORD_PATTERN = /[^\p{L}\p{N}]+/gu;
const NON_LOWER_ALNUM_TEST_PATTERN = /[^a-z0-9]/;
const NON_LOWER_ALNUM_REPLACE_PATTERN = /[^a-z0-9]/g;

interface IndexedSearchField {
  norm: string;
  loose?: string;
  tokens?: string[];
}

interface IndexedMangaSearch {
  manga: Manga;
  title: IndexedSearchField | null;
  secondary?: IndexedSearchField[];
}

const normalizeSearchValue = (value?: string | null) => normalizeComparableText(value);

const tokenizeNormalizedValue = (normalizedValue: string): string[] => {
  if (!normalizedValue) {
    return [];
  }

  if (!NON_PRINTABLE_ASCII_PATTERN.test(normalizedValue)) {
    return normalizedValue.split(ASCII_TOKEN_SPLIT_PATTERN).filter(Boolean);
  }

  return normalizedValue
    .replace(UNICODE_NON_WORD_PATTERN, ' ')
    .split(' ')
    .filter(Boolean);
};

const createIndexedField = (value?: string | null): IndexedSearchField | null => {
  const norm = normalizeSearchValue(value);
  return norm ? { norm } : null;
};

const getFieldLoose = (field: IndexedSearchField): string => {
  if (field.loose === undefined) {
    field.loose = NON_LOWER_ALNUM_TEST_PATTERN.test(field.norm)
      ? field.norm.replace(NON_LOWER_ALNUM_REPLACE_PATTERN, '')
      : field.norm;
  }
  return field.loose;
};

const getFieldTokens = (field: IndexedSearchField): string[] => {
  if (!field.tokens) {
    field.tokens = tokenizeNormalizedValue(field.norm);
  }
  return field.tokens;
};

const needsTokenScan = (query: PreparedSearchQuery): boolean => (
  query.tokens.length > 1
  || (query.tokens.length === 1 && query.tokens[0] !== query.normalized)
);

const matchesIndexedField = (
  field: IndexedSearchField,
  query: PreparedSearchQuery,
  shouldCheckTokens: boolean,
): boolean => {
  if (field.norm.includes(query.normalized)) {
    return true;
  }

  if (query.loose && field.norm.length >= query.loose.length && getFieldLoose(field).includes(query.loose)) {
    return true;
  }

  if (!shouldCheckTokens || query.tokens.length === 0) {
    return false;
  }

  const valueTokens = getFieldTokens(field);
  return query.tokens.every((queryToken) => valueTokens.some((valueToken) => valueToken.includes(queryToken)));
};

const pushStringList = (target: Array<string | null | undefined>, values?: readonly (string | null | undefined)[]) => {
  if (!values || values.length === 0) {
    return;
  }
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value) {
      target.push(value);
    }
  }
};

const pushEntitySearchTerms = (
  target: Array<string | null | undefined>,
  entity: SearchableNamedEntity | undefined | null,
) => {
  if (!entity) {
    return;
  }

  if (entity.name) target.push(entity.name);
  pushStringList(target, entity.alternativeNames);

  const details = entity.details;
  if (!details) {
    return;
  }

  if (details.nativeName) target.push(details.nativeName);
  if (details.englishName) target.push(details.englishName);
  if (details.romajiName) target.push(details.romajiName);
  if (details.gender) target.push(details.gender);
  if (details.role) target.push(details.role);
  if (details.className) target.push(details.className);
  if (details.rankTitle) target.push(details.rankTitle);

  pushStringList(target, details.affiliation);
  pushStringList(target, details.relatives);
  pushStringList(target, details.genres);
  pushStringList(target, details.tags);

  const extra = details.extra;
  if (extra) {
    for (const value of Object.values(extra)) {
      if (Array.isArray(value)) {
        for (let index = 0; index < value.length; index += 1) {
          const item = value[index];
          if (typeof item === 'string' || typeof item === 'number') {
            target.push(String(item));
          }
        }
      } else if (typeof value === 'string' || typeof value === 'number') {
        target.push(String(value));
      }
    }
  }
};

const indexedEntityCache = new WeakMap<object, IndexedSearchField[]>();
const indexedMangaCache = new WeakMap<object, IndexedMangaSearch>();

const getIndexedEntityFields = (entity: SearchableNamedEntity): IndexedSearchField[] => {
  const cached = indexedEntityCache.get(entity);
  if (cached) {
    return cached;
  }

  const terms: Array<string | null | undefined> = [];
  pushEntitySearchTerms(terms, entity);

  const fields: IndexedSearchField[] = [];
  for (let index = 0; index < terms.length; index += 1) {
    const field = createIndexedField(terms[index]);
    if (field) {
      fields.push(field);
    }
  }

  indexedEntityCache.set(entity, fields);
  return fields;
};

const getIndexedMangaFields = (manga: Manga): IndexedMangaSearch => {
  const cached = indexedMangaCache.get(manga);
  if (cached) {
    return cached;
  }

  const entry: IndexedMangaSearch = {
    manga,
    title: createIndexedField(manga.title),
  };
  indexedMangaCache.set(manga, entry);
  return entry;
};

const getIndexedMangaSecondaryFields = (indexed: IndexedMangaSearch): IndexedSearchField[] => {
  if (indexed.secondary) {
    return indexed.secondary;
  }

  const { manga } = indexed;
  const secondaryRawTerms: Array<string | null | undefined> = [];
  pushStringList(secondaryRawTerms, manga.alternativeTitles);

  const seenNorms = new Set<string>(indexed.title ? [indexed.title.norm] : []);
  const secondary: IndexedSearchField[] = [];
  for (let index = 0; index < secondaryRawTerms.length; index += 1) {
    const field = createIndexedField(secondaryRawTerms[index]);
    if (field && !seenNorms.has(field.norm)) {
      seenNorms.add(field.norm);
      secondary.push(field);
    }
  }

  indexed.secondary = secondary;
  return secondary;
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

  const shouldCheckTokens = needsTokenScan(query);
  const fields = getIndexedEntityFields(entity);
  for (let index = 0; index < fields.length; index += 1) {
    if (matchesIndexedField(fields[index], query, shouldCheckTokens)) {
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

  const shouldCheckTokens = needsTokenScan(query);
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
    if (matchesIndexedField(indexed.title, query, shouldCheckTokens)) {
      return 200;
    }
  }

  const secondary = getIndexedMangaSecondaryFields(indexed);
  for (let index = 0; index < secondary.length; index += 1) {
    if (matchesIndexedField(secondary[index], query, shouldCheckTokens)) {
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
