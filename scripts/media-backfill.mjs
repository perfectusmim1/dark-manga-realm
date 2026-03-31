import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();
const OUTPUT_DIR = path.join(ROOT, 'tmp', 'media-backfill');
const DEFAULT_PAGE_SIZE = 500;
const DEFAULT_INGEST_BATCH_SIZE = 25;

const loadEnvFile = async (filePath) => {
  try {
    const content = await fs.readFile(filePath, 'utf8');
    const entries = {};

    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) {
        continue;
      }

      const separatorIndex = line.indexOf('=');
      if (separatorIndex <= 0) {
        continue;
      }

      const key = line.slice(0, separatorIndex).trim();
      const value = line.slice(separatorIndex + 1).trim();
      entries[key] = value;
    }

    return entries;
  } catch {
    return {};
  }
};

const envFromFiles = {
  ...(await loadEnvFile(path.join(ROOT, '.env'))),
  ...(await loadEnvFile(path.join(ROOT, '.env.local'))),
};

const getEnv = (key) => process.env[key] || envFromFiles[key] || '';
const getEnvFallback = (...keys) => keys.map((key) => getEnv(key)).find(Boolean) || '';

const SUPABASE_URL = getEnv('VITE_SUPABASE_URL');
const SUPABASE_ANON_KEY = getEnv('VITE_SUPABASE_ANON_KEY');
const MEDIA_INGEST_URL = getEnvFallback('MEDIA_INGEST_URL', 'VITE_MEDIA_INGEST_URL');
const MEDIA_INGEST_TOKEN = getEnvFallback('MEDIA_INGEST_TOKEN', 'VITE_MEDIA_INGEST_TOKEN');
const MEDIA_BUCKET_URL = getEnv('VITE_MEDIA_BUCKET_URL');

const requiredEnv = [
  ['VITE_SUPABASE_URL', SUPABASE_URL],
  ['VITE_SUPABASE_ANON_KEY', SUPABASE_ANON_KEY],
  ['MEDIA_INGEST_URL', MEDIA_INGEST_URL],
  ['MEDIA_INGEST_TOKEN', MEDIA_INGEST_TOKEN],
  ['VITE_MEDIA_BUCKET_URL', MEDIA_BUCKET_URL],
].filter(([, value]) => !value);

if (requiredEnv.length > 0) {
  console.error(
    `Eksik ortam değişkenleri: ${requiredEnv.map(([key]) => key).join(', ')}`,
  );
  process.exit(1);
}

const normalizeText = (value) => `${value || ''}`.trim();

const isStoredMediaUrl = (value) => {
  const normalized = normalizeText(value);
  if (!normalized) {
    return false;
  }

  if (MEDIA_BUCKET_URL && normalized.startsWith(MEDIA_BUCKET_URL)) {
    return true;
  }

  try {
    return new URL(normalized).hostname.includes('.r2.dev');
  } catch {
    return false;
  }
};

const buildObjectKey = (entityType, entityId, variant) => (
  `${entityType}/${normalizeText(entityId).replace(/[^a-zA-Z0-9_-]/g, '-')}/${variant}.webp`
);

const sqlString = (value) => `'${`${value}`.replace(/'/g, "''")}'`;

const parseArgs = () => {
  const args = process.argv.slice(2);
  const options = {
    entity: 'all',
    limit: 0,
  };

  for (const rawArg of args) {
    if (rawArg.startsWith('--entity=')) {
      options.entity = rawArg.split('=')[1] || 'all';
      continue;
    }

    if (rawArg.startsWith('--limit=')) {
      const parsed = Number.parseInt(rawArg.split('=')[1] || '0', 10);
      options.limit = Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
    }
  }

  return options;
};

const options = parseArgs();

const shouldIncludeEntity = (entity) => (
  options.entity === 'all' || options.entity === entity
);

const fetchTableRows = async (table, selectColumns) => {
  const rows = [];
  let offset = 0;

  while (true) {
    const requestUrl = new URL(`${SUPABASE_URL}/rest/v1/${table}`);
    requestUrl.searchParams.set('select', selectColumns);
    requestUrl.searchParams.set('order', 'id.asc');
    requestUrl.searchParams.set('limit', `${DEFAULT_PAGE_SIZE}`);
    requestUrl.searchParams.set('offset', `${offset}`);

    const response = await fetch(requestUrl, {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Supabase ${table} select failed (${response.status})`);
    }

    const batch = await response.json();
    if (!Array.isArray(batch) || batch.length === 0) {
      break;
    }

    rows.push(...batch);
    if (batch.length < DEFAULT_PAGE_SIZE) {
      break;
    }

    offset += batch.length;
  }

  return rows;
};

const ingestBatch = async (items) => {
  const response = await fetch(MEDIA_INGEST_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${MEDIA_INGEST_TOKEN}`,
    },
    body: JSON.stringify({ items }),
  });

  if (!response.ok) {
    throw new Error(`Media ingest failed (${response.status})`);
  }

  const data = await response.json();
  return Array.isArray(data?.items) ? data.items : [];
};

const buildMangaCandidates = (rows) => rows.flatMap((row) => {
  const items = [];

  if (!isStoredMediaUrl(row.cover) && normalizeText(row.cover)) {
    items.push({
      id: `manga:${row.id}:cover`,
      entityType: 'manga',
      variant: 'cover',
      table: 'mangas',
      rowId: row.id,
      sourceUrl: row.cover,
      objectKey: buildObjectKey('manga', row.id, 'cover'),
      transform: { width: 720, quality: 80, fit: 'cover', format: 'webp' },
    });
  }

  if (!isStoredMediaUrl(row.banner) && normalizeText(row.banner)) {
    items.push({
      id: `manga:${row.id}:banner`,
      entityType: 'manga',
      variant: 'banner',
      table: 'mangas',
      rowId: row.id,
      sourceUrl: row.banner,
      objectKey: buildObjectKey('manga', row.id, 'banner'),
      transform: { width: 1600, quality: 78, fit: 'cover', format: 'webp' },
    });
  }

  return items;
});

const buildEntityCandidates = (rows, entityType, table) => rows.flatMap((row) => {
  if (isStoredMediaUrl(row.image_url) || !normalizeText(row.image_url)) {
    return [];
  }

  const width = entityType === 'character' ? 640 : 560;

  return [{
    id: `${entityType}:${row.id}`,
    entityType,
    variant: 'profile',
    table,
    rowId: row.id,
    sourceUrl: row.image_url,
    objectKey: buildObjectKey(entityType, row.id, 'profile'),
    transform: { width, quality: 78, fit: 'cover', format: 'webp' },
  }];
});

const takeLimit = (items) => (
  options.limit > 0 ? items.slice(0, options.limit) : items
);

const writeSqlFiles = async (updatesByTable) => {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  const writtenFiles = [];

  for (const [table, statements] of Object.entries(updatesByTable)) {
    if (!Array.isArray(statements) || statements.length === 0) {
      continue;
    }

    const filePath = path.join(OUTPUT_DIR, `${table}.sql`);
    await fs.writeFile(filePath, `${statements.join('\n')}\n`, 'utf8');
    writtenFiles.push(filePath);
  }

  return writtenFiles;
};

const buildUpdateStatements = (results) => {
  const mangaUpdates = new Map();
  const entityStatements = {
    characters: [],
    authors: [],
    artists: [],
  };

  for (const result of results) {
    if (!result.publicUrl) {
      continue;
    }

    if (result.table === 'mangas') {
      const existing = mangaUpdates.get(result.rowId) || {};
      existing[result.variant] = result.publicUrl;
      mangaUpdates.set(result.rowId, existing);
      continue;
    }

    entityStatements[result.table].push(
      `update ${result.table} set image_url = ${sqlString(result.publicUrl)} where id = ${sqlString(result.rowId)};`,
    );
  }

  const mangaStatements = Array.from(mangaUpdates.entries()).map(([rowId, values]) => {
    const assignments = [];
    if (values.cover) {
      assignments.push(`cover = ${sqlString(values.cover)}`);
    }
    if (values.banner) {
      assignments.push(`banner = ${sqlString(values.banner)}`);
    }

    return `update mangas set ${assignments.join(', ')} where id = ${sqlString(rowId)};`;
  });

  return {
    mangas: mangaStatements,
    characters: entityStatements.characters,
    authors: entityStatements.authors,
    artists: entityStatements.artists,
  };
};

const main = async () => {
  const candidates = [];

  if (shouldIncludeEntity('manga')) {
    const mangas = await fetchTableRows('mangas', 'id,title,cover,banner');
    candidates.push(...buildMangaCandidates(mangas));
  }

  if (shouldIncludeEntity('character')) {
    const characters = await fetchTableRows('characters', 'id,name,image_url');
    candidates.push(...buildEntityCandidates(characters, 'character', 'characters'));
  }

  if (shouldIncludeEntity('author')) {
    const authors = await fetchTableRows('authors', 'id,name,image_url');
    candidates.push(...buildEntityCandidates(authors, 'author', 'authors'));
  }

  if (shouldIncludeEntity('artist')) {
    const artists = await fetchTableRows('artists', 'id,name,image_url');
    candidates.push(...buildEntityCandidates(artists, 'artist', 'artists'));
  }

  const limitedCandidates = takeLimit(candidates);
  const processedResults = [];

  for (let index = 0; index < limitedCandidates.length; index += DEFAULT_INGEST_BATCH_SIZE) {
    const batch = limitedCandidates.slice(index, index + DEFAULT_INGEST_BATCH_SIZE);
    const ingestResults = await ingestBatch(
      batch.map((item) => ({
        id: item.id,
        sourceUrl: item.sourceUrl,
        objectKey: item.objectKey,
        entityType: item.entityType,
        variant: item.variant,
        transform: item.transform,
      })),
    );

    const resultMap = new Map(ingestResults.map((item) => [item.id, item]));
    for (const item of batch) {
      const result = resultMap.get(item.id);
      processedResults.push({
        ...item,
        status: result?.status || 'error',
        publicUrl: result?.publicUrl,
        error: result?.error,
      });
    }
  }

  const successfulResults = processedResults.filter((item) => item.status === 'stored' || item.status === 'exists');
  const failedResults = processedResults.filter((item) => !['stored', 'exists'].includes(item.status));

  const sqlFiles = await writeSqlFiles(buildUpdateStatements(successfulResults));
  const reportPath = path.join(OUTPUT_DIR, 'report.json');

  await fs.writeFile(
    reportPath,
    JSON.stringify({
      generatedAt: new Date().toISOString(),
      totalCandidates: limitedCandidates.length,
      successful: successfulResults.length,
      failed: failedResults.length,
      failedItems: failedResults,
      sqlFiles,
    }, null, 2),
    'utf8',
  );

  console.log(JSON.stringify({
    outputDir: OUTPUT_DIR,
    totalCandidates: limitedCandidates.length,
    successful: successfulResults.length,
    failed: failedResults.length,
    sqlFiles,
    reportPath,
  }, null, 2));
};

await main();
