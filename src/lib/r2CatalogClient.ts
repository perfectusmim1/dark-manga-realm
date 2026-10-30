/**
 * PostgREST-over-R2 Client Engine
 * Routes queries for the 16 catalog tables from Supabase SDK to Cloudflare R2 / Catalog Worker
 */

export const R2_CATALOG_TABLES = new Set([
  'mangas',
  'chapters',
  'characters',
  'authors',
  'artists',
  'tags',
  'manga_characters',
  'manga_authors',
  'manga_artists',
  'manga_relations',
  'manga_tags',
  'character_tags',
  'author_tags',
  'artist_tags',
  'chapter_automations',
  'chapter_automation_runs',
]);

const CATALOG_WORKER_URL = (
  (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_CATALOG_WORKER_URL) ||
  (typeof process !== 'undefined' && process.env?.VITE_CATALOG_WORKER_URL) ||
  ''
).replace(/\/+$/, '');

const CATALOG_RPCS = new Set(['increment_manga_views', 'increment_chapter_views']);

/**
 * Resolves authorization headers dynamically without hardcoded secrets
 */
export const getCatalogAdminHeaders = async (init?: RequestInit): Promise<Record<string, string>> => {
  const headers: Record<string, string> = {};

  // 1. From init.headers if provided
  if (init?.headers) {
    if (init.headers instanceof Headers) {
      const auth = init.headers.get('Authorization');
      const catToken = init.headers.get('X-Catalog-Admin-Token');
      if (auth) headers['Authorization'] = auth;
      if (catToken) headers['X-Catalog-Admin-Token'] = catToken;
    } else if (Array.isArray(init.headers)) {
      for (const [k, v] of init.headers) {
        if (k.toLowerCase() === 'authorization') headers['Authorization'] = v;
        if (k.toLowerCase() === 'x-catalog-admin-token') headers['X-Catalog-Admin-Token'] = v;
      }
    } else if (typeof init.headers === 'object') {
      for (const [k, v] of Object.entries(init.headers as Record<string, string>)) {
        if (k.toLowerCase() === 'authorization') headers['Authorization'] = v;
        if (k.toLowerCase() === 'x-catalog-admin-token') headers['X-Catalog-Admin-Token'] = v;
      }
    }
  }

  if (headers['Authorization'] || headers['X-Catalog-Admin-Token']) {
    return headers;
  }

  // 2. Node.js / script environment fallback
  if (typeof process !== 'undefined' && process.env?.CATALOG_ADMIN_TOKEN) {
    headers['X-Catalog-Admin-Token'] = process.env.CATALOG_ADMIN_TOKEN;
    return headers;
  }

  // 3. Browser environment: extract Supabase access token from localStorage
  if (typeof window !== 'undefined' && typeof window.localStorage !== 'undefined') {
    try {
      for (let i = 0; i < window.localStorage.length; i++) {
        const key = window.localStorage.key(i);
        if (key && key.includes('-auth-token')) {
          const raw = window.localStorage.getItem(key);
          if (raw) {
            const parsed = JSON.parse(raw);
            const token = parsed?.access_token || parsed?.currentSession?.access_token;
            if (token) {
              headers['Authorization'] = `Bearer ${token}`;
              return headers;
            }
          }
        }
      }
    } catch {
      // ignore JSON parse or localStorage security errors
    }
  }

  return headers;
};

// In-memory catalog table store
const tableStore = new Map<string, any[]>();
let catalogLoadPromise: Promise<void> | null = null;
let lastLoadedTime = 0;
const CACHE_TTL_MS = 60_000; // 60s memory cache TTL for read-heavy operations

/**
 * Defensive normalization: ensures both snake_case and camelCase column aliases exist
 */
const normalizeRowFields = (row: any): any => {
  if (!row || typeof row !== 'object') return row;

  // mangaId <-> manga_id
  if (row.mangaId !== undefined && row.manga_id === undefined) row.manga_id = row.mangaId;
  else if (row.manga_id !== undefined && row.mangaId === undefined) row.mangaId = row.manga_id;

  // number <-> chapterNumber
  if (row.chapterNumber !== undefined && row.number === undefined) row.number = row.chapterNumber;
  else if (row.number !== undefined && row.chapterNumber === undefined) row.chapterNumber = row.number;

  // alternativeTitles <-> alternative_titles
  if (row.alternativeTitles !== undefined && row.alternative_titles === undefined) row.alternative_titles = row.alternativeTitles;
  else if (row.alternative_titles !== undefined && row.alternativeTitles === undefined) row.alternativeTitles = row.alternative_titles;

  // isAdult <-> is_adult
  if (row.isAdult !== undefined && row.is_adult === undefined) row.is_adult = row.isAdult;
  else if (row.is_adult !== undefined && row.isAdult === undefined) row.isAdult = row.is_adult;
  else if (row.is_adult === undefined && row.isAdult === undefined && row.slug !== undefined && row.title !== undefined) {
    row.is_adult = false;
    row.isAdult = false;
  }

  // isPublic <-> is_public
  if (row.isPublic !== undefined && row.is_public === undefined) row.is_public = row.isPublic;
  else if (row.is_public !== undefined && row.isPublic === undefined) row.isPublic = row.is_public;
  else if (row.is_public === undefined && row.isPublic === undefined && (row.slug !== undefined || row.name !== undefined)) {
    row.is_public = true;
    row.isPublic = true;
  }

  // releaseYear <-> release_year
  if (row.releaseYear !== undefined && row.release_year === undefined) row.release_year = row.releaseYear;
  else if (row.release_year !== undefined && row.releaseYear === undefined) row.releaseYear = row.release_year;

  // sourceLinks <-> source_links
  if (row.sourceLinks !== undefined && row.source_links === undefined) row.source_links = row.sourceLinks;
  else if (row.source_links !== undefined && row.sourceLinks === undefined) row.sourceLinks = row.source_links;

  // last_updated <-> updatedAt / updated_at
  const updated = row.last_updated ?? row.updatedAt ?? row.updated_at;
  if (updated !== undefined) {
    if (row.last_updated === undefined) row.last_updated = updated;
    if (row.updatedAt === undefined) row.updatedAt = updated;
    if (row.updated_at === undefined) row.updated_at = updated;
  }

  // createdAt <-> created_at
  if (row.createdAt !== undefined && row.created_at === undefined) row.created_at = row.createdAt;
  else if (row.created_at !== undefined && row.createdAt === undefined) row.createdAt = row.created_at;

  // releaseDate <-> release_date
  if (row.releaseDate !== undefined && row.release_date === undefined) row.release_date = row.releaseDate;
  else if (row.release_date !== undefined && row.releaseDate === undefined) row.releaseDate = row.release_date;

  // imageUrl / image <-> image_url
  const img = row.image_url ?? row.imageUrl ?? row.image;
  if (img !== undefined) {
    if (row.image_url === undefined) row.image_url = img;
    if (row.imageUrl === undefined) row.imageUrl = img;
  }

  // alternativeNames <-> alternative_names
  if (row.alternativeNames !== undefined && row.alternative_names === undefined) row.alternative_names = row.alternativeNames;
  else if (row.alternative_names !== undefined && row.alternativeNames === undefined) row.alternativeNames = row.alternative_names;

  // characterId <-> character_id
  if (row.characterId !== undefined && row.character_id === undefined) row.character_id = row.characterId;
  else if (row.character_id !== undefined && row.characterId === undefined) row.characterId = row.character_id;

  // authorId <-> author_id
  if (row.authorId !== undefined && row.author_id === undefined) row.author_id = row.authorId;
  else if (row.author_id !== undefined && row.authorId === undefined) row.authorId = row.author_id;

  // artistId <-> artist_id
  if (row.artistId !== undefined && row.artist_id === undefined) row.artist_id = row.artistId;
  else if (row.artist_id !== undefined && row.artistId === undefined) row.artistId = row.artist_id;

  // tagId <-> tag_id
  if (row.tagId !== undefined && row.tag_id === undefined) row.tag_id = row.tagId;
  else if (row.tag_id !== undefined && row.tagId === undefined) row.tagId = row.tag_id;

  // role / listingRole <-> listing_role
  const role = row.listing_role ?? row.listingRole ?? row.role;
  if (role !== undefined) {
    if (row.listing_role === undefined) row.listing_role = role;
    if (row.listingRole === undefined) row.listingRole = role;
  }

  return row;
};

/**
 * Checks whether an incoming fetch URL targets one of the R2 catalog tables or catalog RPCs
 */
export const isR2CatalogRestRequest = (requestUrl: string, supabaseUrl: string): boolean => {
  const restPrefix = `${supabaseUrl}/rest/v1/`;
  if (!requestUrl.startsWith(restPrefix)) {
    return false;
  }

  const path = requestUrl.slice(restPrefix.length).split('?')[0].replace(/\/+$/, '');
  const segments = path.split('/');
  if (segments[0] === 'rpc' && segments[1] && CATALOG_RPCS.has(segments[1])) {
    return true;
  }

  const tableName = segments[0].trim().toLowerCase();
  return R2_CATALOG_TABLES.has(tableName);
};

// Track hydrated manga series for lazy chapter pages
const hydratedMangaIds = new Set<string>();
const seriesHydrationPromises = new Map<string, Promise<void>>();

/**
 * Loads all catalog tables from R2 catalog worker into memory
 */
export const ensureCatalogLoaded = async (force = false): Promise<void> => {
  const now = Date.now();
  if (force) {
    hydratedMangaIds.clear();
    seriesHydrationPromises.clear();
  } else if (lastLoadedTime > 0 && now - lastLoadedTime < CACHE_TTL_MS) {
    return;
  }

  if (catalogLoadPromise) {
    return catalogLoadPromise;
  }

  catalogLoadPromise = (async () => {
    try {
      const res = await fetch(`${CATALOG_WORKER_URL}/v1/catalog/tables`, {
        headers: { Accept: 'application/json' },
      });

      if (res.ok) {
        const body = await res.json();
        if (body && typeof body === 'object' && body.tables) {
          hydratedMangaIds.clear();
          seriesHydrationPromises.clear();
          for (const tbl of R2_CATALOG_TABLES) {
            const rawRows = Array.isArray(body.tables[tbl]) ? body.tables[tbl] : [];
            const rows = rawRows.map(normalizeRowFields);
            tableStore.set(tbl, rows);
          }
          lastLoadedTime = Date.now();
          return;
        }
      }
    } catch (err) {
      console.warn('Catalog tables initial load failed, initializing empty in-memory tables:', err);
    }

    // Fallback: ensure every catalog table exists as array in memory
    for (const tbl of R2_CATALOG_TABLES) {
      if (!tableStore.has(tbl)) {
        tableStore.set(tbl, []);
      }
    }
    lastLoadedTime = Date.now();
  })().finally(() => {
    catalogLoadPromise = null;
  });

  return catalogLoadPromise;
};

/**
 * Lazy chapter pages hydration: fetches individual series JSON to populate full chapter pages
 */
export const ensureSeriesChapterPagesHydrated = async (mangaId: string): Promise<void> => {
  if (!mangaId) return;
  if (hydratedMangaIds.has(mangaId)) return;

  const existingPromise = seriesHydrationPromises.get(mangaId);
  if (existingPromise) {
    return existingPromise;
  }

  const hydrationPromise = (async () => {
    try {
      const mangas = tableStore.get('mangas') || [];
      const manga = mangas.find((m) => m.id === mangaId);
      if (!manga || !manga.slug) return;

      const res = await fetch(`${CATALOG_WORKER_URL}/v1/catalog/series/${encodeURIComponent(manga.slug)}`, {
        headers: { Accept: 'application/json' },
      });

      if (!res.ok) return;

      const series = await res.json();
      if (!series || !Array.isArray(series.chapters)) return;

      if (!tableStore.has('chapters')) {
        tableStore.set('chapters', []);
      }
      const allChapters = tableStore.get('chapters')!;

      // Map series chapters by id and by chapter number
      const seriesChById = new Map<string, any>();
      const seriesChByNum = new Map<number, any>();

      for (const sc of series.chapters) {
        if (sc.id) seriesChById.set(sc.id, sc);
        const num = Number(sc.chapterNumber ?? sc.number);
        if (!isNaN(num)) seriesChByNum.set(num, sc);
      }

      // Update existing chapter rows for this manga
      const matchedSeriesChIds = new Set<string>();
      for (const row of allChapters) {
        if (row.manga_id === mangaId) {
          const seriesCh = (row.id ? seriesChById.get(row.id) : null) ??
            (row.number !== undefined ? seriesChByNum.get(Number(row.number)) : null);

          if (seriesCh) {
            matchedSeriesChIds.add(seriesCh.id);
            if (!row.pages || row.pages.length === 0) {
              row.pages = seriesCh.pages || [];
            }
          }
        }
      }

      // Add any chapter from series that is missing in tableStore
      for (const sc of series.chapters) {
        if (sc.id && !matchedSeriesChIds.has(sc.id)) {
          const exists = allChapters.some(
            (c) => c.manga_id === mangaId && (c.id === sc.id || Number(c.number) === Number(sc.chapterNumber ?? sc.number))
          );
          if (!exists) {
            const normalized = normalizeRowFields({
              id: sc.id || crypto.randomUUID(),
              manga_id: mangaId,
              number: Number(sc.chapterNumber ?? sc.number ?? 0),
              title: sc.title || '',
              pages: Array.isArray(sc.pages) ? sc.pages : [],
              release_date: sc.releaseDate || sc.release_date || new Date().toISOString(),
              created_at: sc.createdAt || sc.created_at || new Date().toISOString(),
              updated_at: sc.updatedAt || sc.updated_at || new Date().toISOString(),
            });
            allChapters.push(normalized);
          }
        }
      }

      hydratedMangaIds.add(mangaId);
    } catch (err) {
      console.warn(`Failed to hydrate chapter pages for manga ${mangaId}:`, err);
    } finally {
      seriesHydrationPromises.delete(mangaId);
    }
  })();

  seriesHydrationPromises.set(mangaId, hydrationPromise);
  return hydrationPromise;
};

/**
 * Synchronizes series JSON in R2 with full chapter pages after chapter mutations
 */
export const syncSeriesFileToR2 = async (mangaId: string, init?: RequestInit): Promise<void> => {
  if (!mangaId) return;
  const mangas = tableStore.get('mangas') || [];
  const manga = mangas.find((m) => m.id === mangaId);
  if (!manga || !manga.slug) return;

  const allChapters = (tableStore.get('chapters') || [])
    .filter((c) => c.manga_id === mangaId)
    .sort((a, b) => Number(a.number ?? a.chapterNumber ?? 0) - Number(b.number ?? b.chapterNumber ?? 0));

  const adminHeaders = await getCatalogAdminHeaders(init);
  try {
    await fetch(`${CATALOG_WORKER_URL}/v1/admin/series/${encodeURIComponent(manga.slug)}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...adminHeaders,
      },
      body: JSON.stringify({
        ...manga,
        chapters: allChapters,
        chapterCount: allChapters.length,
      }),
    });
  } catch (err) {
    console.error(`Failed to sync series ${manga.slug} to R2:`, err);
  }
};

/**
 * Direct access to in-memory table rows
 */
export const getCatalogTableRows = (tableName: string): any[] => {
  if (!tableStore.has(tableName)) {
    tableStore.set(tableName, []);
  }
  return tableStore.get(tableName)!;
};

/**
 * Exports all catalog tables for site backup
 */
export const exportAllCatalogTables = async (): Promise<Record<string, any[]>> => {
  await ensureCatalogLoaded(true);
  const result: Record<string, any[]> = {};
  for (const tbl of R2_CATALOG_TABLES) {
    result[tbl] = JSON.parse(JSON.stringify(tableStore.get(tbl) || []));
  }
  return result;
};

/**
 * Imports all catalog tables from backup into R2
 */
export const importAllCatalogTables = async (tables: Record<string, any[]>): Promise<void> => {
  const filtered: Record<string, any[]> = {};
  for (const [tbl, rows] of Object.entries(tables)) {
    if (R2_CATALOG_TABLES.has(tbl) && Array.isArray(rows)) {
      const normalized = rows.map(normalizeRowFields);
      filtered[tbl] = normalized;
      tableStore.set(tbl, normalized);
    }
  }

  const adminHeaders = await getCatalogAdminHeaders();
  await fetch(`${CATALOG_WORKER_URL}/v1/admin/catalog/tables`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      ...adminHeaders,
    },
    body: JSON.stringify({ tables: filtered }),
  });

  lastLoadedTime = Date.now();
};

// ==================== QUERY PARSING & EVALUATION ====================

interface ParsedSelectField {
  raw: string;
  isAll: boolean;
  column?: string;
  alias?: string;
  relation?: string;
  inner?: boolean;
  subFields?: ParsedSelectField[];
}

/**
 * Parses PostgREST select parameter strings with nested relations
 * e.g. "*, chapters(*)", "*, mangas:manga_characters(manga:mangas(*))", "id, mangas:manga_id!inner(id, is_public)"
 */
const parseSelectClause = (selectStr: string): ParsedSelectField[] => {
  const results: ParsedSelectField[] = [];
  let depth = 0;
  let currentToken = '';

  for (let i = 0; i < selectStr.length; i++) {
    const char = selectStr[i];
    if (char === '(') {
      depth++;
      currentToken += char;
    } else if (char === ')') {
      depth--;
      currentToken += char;
    } else if (char === ',' && depth === 0) {
      const trimmed = currentToken.trim();
      if (trimmed) results.push(parseSingleSelectField(trimmed));
      currentToken = '';
    } else {
      currentToken += char;
    }
  }

  const trimmed = currentToken.trim();
  if (trimmed) results.push(parseSingleSelectField(trimmed));
  return results;
};

const parseSingleSelectField = (field: string): ParsedSelectField => {
  if (field === '*') {
    return { raw: field, isAll: true };
  }

  const openParen = field.indexOf('(');
  if (openParen >= 0 && field.endsWith(')')) {
    const head = field.slice(0, openParen).trim();
    const body = field.slice(openParen + 1, -1).trim();

    let alias = '';
    let relationPart = head;

    const colonIdx = head.indexOf(':');
    if (colonIdx >= 0) {
      alias = head.slice(0, colonIdx).trim();
      relationPart = head.slice(colonIdx + 1).trim();
    }

    const isInner = relationPart.includes('!inner');
    const relationName = relationPart.replace('!inner', '').trim();

    return {
      raw: field,
      isAll: false,
      alias: alias || relationName,
      relation: relationName,
      inner: isInner,
      subFields: parseSelectClause(body || '*'),
    };
  }

  return {
    raw: field,
    isAll: false,
    column: field,
  };
};

/**
 * Resolves related child records from in-memory tables
 */
const resolveRelatedRows = (
  parentTable: string,
  parentRow: any,
  relationName: string
): { isSingle: boolean; rows: any[] } => {
  // Case 1: Parent has foreign key column pointing to target table
  // e.g. manga_characters.character_id -> characters.id
  // e.g. chapters.manga_id -> mangas.id
  // e.g. manga_tags.tag_id -> tags.id
  let fkCol = '';
  let targetTable = relationName;

  if (relationName === 'manga_id' || relationName === 'mangas' || relationName === 'manga') {
    targetTable = 'mangas';
    fkCol = 'manga_id';
  } else if (relationName === 'character_id' || relationName === 'characters' || relationName === 'character') {
    targetTable = 'characters';
    fkCol = 'character_id';
  } else if (relationName === 'author_id' || relationName === 'authors' || relationName === 'author') {
    targetTable = 'authors';
    fkCol = 'author_id';
  } else if (relationName === 'artist_id' || relationName === 'artists' || relationName === 'artist') {
    targetTable = 'artists';
    fkCol = 'artist_id';
  } else if (relationName === 'tag_id' || relationName === 'tags' || relationName === 'tag') {
    targetTable = 'tags';
    fkCol = 'tag_id';
  } else if (relationName === 'related_manga' || relationName === 'related_manga_id') {
    targetTable = 'mangas';
    fkCol = 'related_manga_id';
  } else if (relationName === 'source_manga' || relationName === 'source_manga_id') {
    targetTable = 'mangas';
    fkCol = 'source_manga_id';
  } else if (relationName === 'target_manga' || relationName === 'target_manga_id') {
    targetTable = 'mangas';
    fkCol = 'target_manga_id';
  }

  if (fkCol && parentRow[fkCol] !== undefined) {
    const targetStore = tableStore.get(targetTable) || [];
    const matched = targetStore.find((r) => r.id === parentRow[fkCol]);
    return { isSingle: true, rows: matched ? [matched] : [] };
  }

  // Case 2: Target table points to parent row (1-to-many reverse relation)
  // e.g. mangas -> chapters (chapter.manga_id === manga.id)
  // e.g. mangas -> manga_characters, manga_tags, manga_authors, manga_artists, manga_relations
  // e.g. characters -> manga_characters, character_tags
  const directTable = relationName;
  if (R2_CATALOG_TABLES.has(directTable)) {
    const targetStore = tableStore.get(directTable) || [];
    let parentKey = 'manga_id';

    if (parentTable === 'characters') parentKey = 'character_id';
    else if (parentTable === 'authors') parentKey = 'author_id';
    else if (parentTable === 'artists') parentKey = 'artist_id';
    else if (parentTable === 'tags') parentKey = 'tag_id';
    else if (parentTable === 'chapter_automations') parentKey = 'automation_id';

    const matched = targetStore.filter((r) => r[parentKey] === parentRow.id);
    return { isSingle: false, rows: matched };
  }

  return { isSingle: false, rows: [] };
};

/**
 * Projects a single row using parsed select fields and relations
 */
const projectRow = (
  tableName: string,
  row: any,
  parsedFields: ParsedSelectField[]
): { projected: any; innerPassed: boolean } => {
  const hasAll = parsedFields.some((f) => f.isAll);
  const out: Record<string, any> = hasAll ? { ...row } : {};
  let innerPassed = true;

  for (const field of parsedFields) {
    if (field.isAll) continue;

    if (field.column) {
      out[field.column] = row[field.column];
      continue;
    }

    if (field.relation) {
      const relationData = resolveRelatedRows(tableName, row, field.relation);
      const subFields = field.subFields || [{ raw: '*', isAll: true }];

      if (field.inner && relationData.rows.length === 0) {
        innerPassed = false;
      }

      const projectedSubRows = relationData.rows
        .map((subRow) => {
          const res = projectRow(field.relation!, subRow, subFields);
          return res.innerPassed ? res.projected : null;
        })
        .filter(Boolean);

      if (field.inner && projectedSubRows.length === 0) {
        innerPassed = false;
      }

      const key = field.alias || field.relation;
      out[key] = relationData.isSingle ? projectedSubRows[0] || null : projectedSubRows;
    }
  }

  return { projected: out, innerPassed };
};

/**
 * Matches a row value against a PostgREST operator and operand
 */
const matchCondition = (rowVal: any, op: string, operand: string): boolean => {
  if (op === 'eq') {
    if (operand === 'true') return rowVal === true;
    if (operand === 'false') return rowVal === false;
    if (operand === 'null') return rowVal == null;
    return String(rowVal ?? '') === operand;
  }
  if (op === 'neq') {
    if (operand === 'true') return rowVal !== true;
    if (operand === 'false') return rowVal !== false;
    if (operand === 'null') return rowVal != null;
    return String(rowVal ?? '') !== operand;
  }
  if (op === 'gt') {
    return Number(rowVal) > Number(operand);
  }
  if (op === 'gte') {
    if (typeof rowVal === 'string' && isNaN(Number(rowVal)) && isNaN(Number(operand))) {
      return rowVal >= operand;
    }
    return Number(rowVal) >= Number(operand);
  }
  if (op === 'lt') {
    return Number(rowVal) < Number(operand);
  }
  if (op === 'lte') {
    if (typeof rowVal === 'string' && isNaN(Number(rowVal)) && isNaN(Number(operand))) {
      return rowVal <= operand;
    }
    return Number(rowVal) <= Number(operand);
  }
  if (op === 'like') {
    const regex = new RegExp(`^${operand.replace(/%/g, '.*')}$`);
    return regex.test(String(rowVal ?? ''));
  }
  if (op === 'ilike') {
    const pattern = operand.replace(/%/g, '.*').replace(/\*/g, '.*');
    const regex = new RegExp(`^${pattern}$`, 'i');
    return regex.test(String(rowVal ?? ''));
  }
  if (op === 'is') {
    if (operand === 'null') return rowVal == null;
    if (operand === 'true') return Boolean(rowVal) === true;
    if (operand === 'false') return Boolean(rowVal) === false;
    if (operand === 'not.null') return rowVal != null;
    return rowVal == null;
  }
  if (op === 'in') {
    const clean = operand.replace(/^\(/, '').replace(/\)$/, '');
    const items = clean.split(',').map((s) => s.trim());
    return items.some((item) => String(rowVal ?? '') === item);
  }
  if (op === 'cs') {
    if (Array.isArray(rowVal)) {
      const clean = operand.replace(/^\{/, '').replace(/\}$/, '');
      const items = clean.split(',').map((s) => s.trim());
      return items.every((it) => rowVal.includes(it));
    }
    return String(rowVal ?? '').includes(operand);
  }

  return true;
};

/**
 * Evaluates row against all query parameters (including join filters like mangas.is_public)
 */
const filterRow = (row: any, searchParams: URLSearchParams): boolean => {
  for (const [key, rawValue] of searchParams.entries()) {
    if (['select', 'order', 'limit', 'offset', 'on_conflict', 'columns', 'apikey'].includes(key)) {
      continue;
    }

    if (key === 'or') {
      const clean = rawValue.replace(/^\(/, '').replace(/\)$/, '');
      const orParts = clean.split(',').map((p) => p.trim()).filter(Boolean);
      const orMatch = orParts.some((part) => {
        const dotIdx = part.indexOf('.');
        if (dotIdx === -1) return false;
        const col = part.slice(0, dotIdx);
        const rest = part.slice(dotIdx + 1);
        const secondDot = rest.indexOf('.');
        const op = secondDot >= 0 ? rest.slice(0, secondDot) : 'eq';
        const val = secondDot >= 0 ? rest.slice(secondDot + 1) : rest;
        return matchCondition(row[col], op, val);
      });
      if (!orMatch) return false;
      continue;
    }

    // Relation dot-filter: e.g. mangas.is_public=eq.true
    if (key.includes('.')) {
      const [relPrefix, relCol] = key.split('.');
      let relRow: any = null;
      if (relPrefix === 'mangas' && row.manga_id) {
        const mangas = tableStore.get('mangas') || [];
        relRow = mangas.find((m) => m.id === row.manga_id);
      }

      if (!relRow) return false;

      const dotIdx = rawValue.indexOf('.');
      const op = dotIdx >= 0 ? rawValue.slice(0, dotIdx) : 'eq';
      const operand = dotIdx >= 0 ? rawValue.slice(dotIdx + 1) : rawValue;
      if (!matchCondition(relRow[relCol], op, operand)) return false;
      continue;
    }

    // Direct column filter
    const dotIdx = rawValue.indexOf('.');
    const op = dotIdx >= 0 ? rawValue.slice(0, dotIdx) : 'eq';
    const operand = dotIdx >= 0 ? rawValue.slice(dotIdx + 1) : rawValue;

    if (!matchCondition(row[key], op, operand)) {
      return false;
    }
  }

  return true;
};

// ==================== REST REQUEST HANDLER ====================

export const handleR2CatalogRestRequest = async (
  requestUrl: string,
  init?: RequestInit,
  _input?: RequestInfo | URL
): Promise<Response> => {
  await ensureCatalogLoaded();

  const url = new URL(requestUrl);
  const path = url.pathname.replace(/^\/rest\/v1\//, '').replace(/\/+$/, '');
  const segments = path.split('/');

  // RPC handling for catalog view increments
  if (segments[0] === 'rpc') {
    const rpcName = segments[1];
    let payload: any = {};
    if (init?.body) {
      try {
        payload = typeof init.body === 'string' ? JSON.parse(init.body) : init.body;
      } catch {
        payload = {};
      }
    }

    if (rpcName === 'increment_manga_views') {
      const mangaId = payload.manga_id_param || payload.manga_id || payload.id;
      if (mangaId) {
        const mangas = tableStore.get('mangas') || [];
        const manga = mangas.find((m) => m.id === mangaId);
        if (manga) {
          manga.views = (manga.views || 0) + 1;
          getCatalogAdminHeaders(init).then((adminHeaders) => {
            fetch(`${CATALOG_WORKER_URL}/v1/admin/table/mangas/mutate`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                ...adminHeaders,
              },
              body: JSON.stringify({
                action: 'update',
                match: { id: mangaId },
                patch: { views: manga.views },
              }),
            }).catch((err) => console.error('increment_manga_views mutate error:', err));
          });
        }
      }
      return new Response(JSON.stringify(null), {
        status: 200,
        headers: { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' },
      });
    }

    if (rpcName === 'increment_chapter_views') {
      const chapterId = payload.chapter_id_param || payload.chapter_id || payload.id;
      if (chapterId) {
        const chapters = tableStore.get('chapters') || [];
        const chapter = chapters.find((c) => c.id === chapterId);
        if (chapter) {
          chapter.views = (chapter.views || 0) + 1;
          getCatalogAdminHeaders(init).then((adminHeaders) => {
            fetch(`${CATALOG_WORKER_URL}/v1/admin/table/chapters/mutate`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                ...adminHeaders,
              },
              body: JSON.stringify({
                action: 'update',
                match: { id: chapterId },
                patch: { views: chapter.views },
              }),
            }).catch((err) => console.error('increment_chapter_views mutate error:', err));
          });
        }
      }
      return new Response(JSON.stringify(null), {
        status: 200,
        headers: { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' },
      });
    }
  }

  const tableName = segments[0].trim().toLowerCase();

  const method = (init?.method || 'GET').toUpperCase();
  const headers = new Headers(init?.headers);

  if (!tableStore.has(tableName)) {
    tableStore.set(tableName, []);
  }

  const tableRows = tableStore.get(tableName)!;
  const now = new Date().toISOString();

  // 1. MUTATION: POST (Insert or Upsert)
  if (method === 'POST') {
    let payload: any = null;
    if (init?.body) {
      payload = typeof init.body === 'string' ? JSON.parse(init.body) : init.body;
    }
    const incomingRows = (Array.isArray(payload) ? payload : [payload]).filter(Boolean).map(normalizeRowFields);

    const onConflictParam = url.searchParams.get('on_conflict');
    const preferHeader = headers.get('Prefer') || '';
    const isUpsert = Boolean(onConflictParam) || preferHeader.includes('resolution=merge-duplicates');
    const conflictCols = (onConflictParam || 'id')
      .split(',')
      .map((c) => c.trim())
      .filter(Boolean);

    // If mutating chapters, hydrate first to preserve existing pages
    const affectedMangaIds = [...new Set(incomingRows.map((r: any) => r.manga_id).filter(Boolean))];
    if (tableName === 'chapters' && affectedMangaIds.length > 0) {
      await Promise.all(affectedMangaIds.map((mId) => ensureSeriesChapterPagesHydrated(mId)));
    }

    const affectedRows: any[] = [];

    for (const item of incomingRows) {
      if (isUpsert) {
        const matchIdx = tableRows.findIndex((existing) =>
          conflictCols.every((col) => existing[col] !== undefined && String(existing[col]) === String(item[col]))
        );

        if (matchIdx >= 0) {
          const merged = { ...tableRows[matchIdx], ...item, updated_at: now };
          tableRows[matchIdx] = merged;
          affectedRows.push(merged);
        } else {
          const inserted = {
            id: item.id || crypto.randomUUID(),
            ...item,
            created_at: item.created_at || now,
            updated_at: now,
          };
          tableRows.push(inserted);
          affectedRows.push(inserted);
        }
      } else {
        const inserted = {
          id: item.id || crypto.randomUUID(),
          ...item,
          created_at: item.created_at || now,
          updated_at: now,
        };
        tableRows.push(inserted);
        affectedRows.push(inserted);
      }
    }

    // Persist to R2 catalog worker with await (send pages: [] for chapters table index)
    const mutateRows = tableName === 'chapters'
      ? incomingRows.map((r: any) => ({ ...r, pages: [] }))
      : incomingRows;

    const adminHeaders = await getCatalogAdminHeaders(init);
    try {
      await fetch(`${CATALOG_WORKER_URL}/v1/admin/table/${tableName}/mutate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...adminHeaders,
        },
        body: JSON.stringify({
          action: isUpsert ? 'upsert' : 'insert',
          rows: mutateRows,
          onConflict: conflictCols.join(','),
        }),
      });
    } catch (err) {
      console.error(`R2 catalog persist failed for table ${tableName}:`, err);
    }

    // Dual-sync: update series JSON file with full chapter pages
    if (tableName === 'chapters' && affectedMangaIds.length > 0) {
      await Promise.all(affectedMangaIds.map((mId) => syncSeriesFileToR2(mId, init)));
    }

    const acceptHeader = headers.get('Accept') || '';
    const isSingle = acceptHeader.includes('application/vnd.pgrst.object+json');
    const responseData = isSingle ? affectedRows[0] || null : affectedRows;

    return new Response(JSON.stringify(responseData), {
      status: 201,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
      },
    });
  }

  // 2. MUTATION: PATCH (Update)
  if (method === 'PATCH') {
    let patch: any = {};
    if (init?.body) {
      patch = typeof init.body === 'string' ? JSON.parse(init.body) : init.body;
    }

    const matchedIndices: number[] = [];
    const affectedRows: any[] = [];

    for (let i = 0; i < tableRows.length; i++) {
      if (filterRow(tableRows[i], url.searchParams)) {
        matchedIndices.push(i);
        const updated = { ...tableRows[i], ...patch, updated_at: now };
        tableRows[i] = updated;
        affectedRows.push(updated);
      }
    }

    // If mutating chapters, hydrate first to preserve existing pages
    const affectedMangaIds = [...new Set(affectedRows.map((r: any) => r.manga_id).filter(Boolean))];
    if (tableName === 'chapters' && affectedMangaIds.length > 0) {
      await Promise.all(affectedMangaIds.map((mId) => ensureSeriesChapterPagesHydrated(mId)));
    }

    // Build match criteria for backend mutate
    const matchObj: Record<string, any> = {};
    for (const [k, v] of url.searchParams.entries()) {
      if (!['select', 'order', 'limit', 'offset', 'apikey'].includes(k)) {
        const dotIdx = v.indexOf('.');
        matchObj[k] = dotIdx >= 0 ? v.slice(dotIdx + 1) : v;
      }
    }

    const mutatePatch = (tableName === 'chapters' && 'pages' in patch)
      ? { ...patch, pages: [] }
      : patch;

    const adminHeaders = await getCatalogAdminHeaders(init);
    try {
      await fetch(`${CATALOG_WORKER_URL}/v1/admin/table/${tableName}/mutate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...adminHeaders,
        },
        body: JSON.stringify({
          action: 'update',
          match: matchObj,
          patch: mutatePatch,
        }),
      });
    } catch (err) {
      console.error(`R2 catalog patch failed for ${tableName}:`, err);
    }

    // Dual-sync: update series JSON file with full chapter pages
    if (tableName === 'chapters' && affectedMangaIds.length > 0) {
      await Promise.all(affectedMangaIds.map((mId) => syncSeriesFileToR2(mId, init)));
    }

    return new Response(JSON.stringify(affectedRows), {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
      },
    });
  }

  // 3. MUTATION: DELETE
  if (method === 'DELETE') {
    const remaining: any[] = [];
    const deleted: any[] = [];

    for (const row of tableRows) {
      if (filterRow(row, url.searchParams)) {
        deleted.push(row);
      } else {
        remaining.push(row);
      }
    }

    tableStore.set(tableName, remaining);

    // If deleting chapters, hydrate remaining first and then dual-sync series JSON
    const affectedMangaIds = [...new Set(deleted.map((r: any) => r.manga_id).filter(Boolean))];
    if (tableName === 'chapters' && affectedMangaIds.length > 0) {
      await Promise.all(affectedMangaIds.map((mId) => ensureSeriesChapterPagesHydrated(mId)));
    }

    // Cascade delete related records if deleting a manga
    if (tableName === 'mangas') {
      const deletedMangaIds = new Set(deleted.map((m) => m.id));
      const cascadeTables = [
        'chapters',
        'manga_characters',
        'manga_authors',
        'manga_artists',
        'manga_tags',
        'manga_relations',
      ];
      for (const cascTbl of cascadeTables) {
        const rows = tableStore.get(cascTbl) || [];
        const filtered = rows.filter((r) => !deletedMangaIds.has(r.manga_id));
        tableStore.set(cascTbl, filtered);
      }
    }

    const matchObj: Record<string, any> = {};
    for (const [k, v] of url.searchParams.entries()) {
      if (!['select', 'order', 'limit', 'offset', 'apikey'].includes(k)) {
        const dotIdx = v.indexOf('.');
        matchObj[k] = dotIdx >= 0 ? v.slice(dotIdx + 1) : v;
      }
    }

    const adminHeaders = await getCatalogAdminHeaders(init);
    try {
      await fetch(`${CATALOG_WORKER_URL}/v1/admin/table/${tableName}/mutate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...adminHeaders,
        },
        body: JSON.stringify({ action: 'delete', match: matchObj }),
      });
    } catch (err) {
      console.error(`R2 catalog delete failed for ${tableName}:`, err);
    }

    // Dual-sync: update series JSON file with remaining chapters
    if (tableName === 'chapters' && affectedMangaIds.length > 0) {
      await Promise.all(affectedMangaIds.map((mId) => syncSeriesFileToR2(mId, init)));
    }

    return new Response(JSON.stringify(deleted), {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
      },
    });
  }

  // 4. READ: GET or HEAD
  let matchingRows = tableRows.filter((row) => filterRow(row, url.searchParams));
  const totalCount = matchingRows.length;

  // Sorting
  const orderParam = url.searchParams.get('order');
  if (orderParam) {
    const orderDirectives = orderParam.split(',').map((d) => d.trim());
    matchingRows.sort((a, b) => {
      for (const dir of orderDirectives) {
        const parts = dir.split('.');
        const col = parts[0];
        const isDesc = parts.includes('desc');
        const nullsFirst = parts.includes('nullsfirst');

        const valA = a[col];
        const valB = b[col];

        if (valA == null && valB == null) continue;
        if (valA == null) return nullsFirst ? -1 : 1;
        if (valB == null) return nullsFirst ? 1 : -1;

        if (valA !== valB) {
          const comp = typeof valA === 'number' && typeof valB === 'number'
            ? valA - valB
            : String(valA).localeCompare(String(valB));
          return isDesc ? -comp : comp;
        }
      }
      return 0;
    });
  }

  // Pagination via Range header or limit/offset params
  let offset = 0;
  let limit = matchingRows.length;

  const rangeHeader = headers.get('Range');
  if (rangeHeader) {
    const m = rangeHeader.match(/(\d+)-(\d+)/);
    if (m) {
      const start = parseInt(m[1], 10);
      const end = parseInt(m[2], 10);
      offset = start;
      limit = end - start + 1;
    }
  } else {
    if (url.searchParams.has('offset')) {
      offset = parseInt(url.searchParams.get('offset')!, 10) || 0;
    }
    if (url.searchParams.has('limit')) {
      limit = parseInt(url.searchParams.get('limit')!, 10) || limit;
    }
  }

  const pagedRows = matchingRows.slice(offset, offset + limit);

  // Projection via select parameter
  const selectParam = url.searchParams.get('select') || '*';

  // Lazy Chapter Pages Hydration
  if (tableName === 'mangas' && selectParam.includes('chapters') && pagedRows.length <= 25) {
    await Promise.all(pagedRows.map((m) => ensureSeriesChapterPagesHydrated(m.id)));
  } else if (tableName === 'chapters' && (selectParam === '*' || selectParam.includes('pages'))) {
    const uniqueMangaIds = [...new Set(pagedRows.map((c) => c.manga_id).filter(Boolean))].slice(0, 25);
    await Promise.all(uniqueMangaIds.map((id) => ensureSeriesChapterPagesHydrated(id)));
  }

  const parsedSelect = parseSelectClause(selectParam);

  const projectedRows: any[] = [];
  for (const row of pagedRows) {
    const { projected, innerPassed } = projectRow(tableName, row, parsedSelect);
    if (innerPassed) {
      projectedRows.push(projected);
    }
  }

  // Single object header (e.g. .single() or .maybeSingle())
  const acceptHeader = headers.get('Accept') || '';
  const isSingle = acceptHeader.includes('application/vnd.pgrst.object+json');

  const preferHeader = headers.get('Prefer') || '';
  const countExact = preferHeader.includes('count=exact') || url.searchParams.has('count');

  const responseHeaders: Record<string, string> = {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Expose-Headers': 'Content-Range, Content-Length',
  };

  if (countExact) {
    const startRange = totalCount === 0 ? 0 : offset;
    const endRange = totalCount === 0 ? 0 : Math.min(offset + limit - 1, totalCount - 1);
    responseHeaders['Content-Range'] = totalCount === 0 ? '*/0' : `${startRange}-${endRange}/${totalCount}`;
  }

  if (method === 'HEAD') {
    return new Response(null, {
      status: 200,
      headers: responseHeaders,
    });
  }

  if (isSingle) {
    if (projectedRows.length === 0) {
      // PGRST116 indicates 0 rows for single/maybeSingle
      return new Response(
        JSON.stringify({
          code: 'PGRST116',
          details: 'The result contains 0 rows',
          hint: null,
          message: 'JSON object requested, multiple (or no) rows returned',
        }),
        {
          status: 406,
          headers: responseHeaders,
        }
      );
    }

    if (projectedRows.length > 1) {
      return new Response(
        JSON.stringify({
          code: 'PGRST116',
          details: `The result contains ${projectedRows.length} rows`,
          hint: null,
          message: 'JSON object requested, multiple (or no) rows returned',
        }),
        {
          status: 406,
          headers: responseHeaders,
        }
      );
    }

    return new Response(JSON.stringify(projectedRows[0]), {
      status: 200,
      headers: responseHeaders,
    });
  }

  return new Response(JSON.stringify(projectedRows), {
    status: 200,
    headers: responseHeaders,
  });
};
