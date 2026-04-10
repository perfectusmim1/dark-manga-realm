import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();
const OUTPUT_DIR = path.join(ROOT, 'tmp', 'chapter-pages-backfill');
const DEFAULT_PAGE_SIZE = 200;
const DEFAULT_PROGRESS_BAR_WIDTH = 24;
const INGEST_RETRY_DELAY_MS = 1200;

const incrementCount = (map, key, amount = 1) => {
  const normalizedKey = normalizeText(key);
  if (!normalizedKey) {
    return;
  }

  map.set(normalizedKey, (map.get(normalizedKey) || 0) + amount);
};

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const createBatches = (items, batchSize) => {
  const batches = [];

  for (let index = 0; index < items.length; index += batchSize) {
    batches.push({
      index,
      items: items.slice(index, index + batchSize),
    });
  }

  return batches;
};

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
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY || '';
const MEDIA_INGEST_URL = getEnvFallback('MEDIA_INGEST_URL', 'VITE_MEDIA_INGEST_URL');
const MEDIA_INGEST_TOKEN = getEnvFallback('MEDIA_INGEST_TOKEN', 'VITE_MEDIA_INGEST_TOKEN');
const MEDIA_BUCKET_URL = getEnvFallback('MEDIA_BUCKET_URL', 'VITE_MEDIA_BUCKET_URL');

const requiredEnv = [
  ['VITE_SUPABASE_URL', SUPABASE_URL],
  ['VITE_SUPABASE_ANON_KEY', SUPABASE_ANON_KEY],
  ['MEDIA_INGEST_URL', MEDIA_INGEST_URL],
  ['MEDIA_INGEST_TOKEN', MEDIA_INGEST_TOKEN],
].filter(([, value]) => !value);

if (requiredEnv.length > 0) {
  console.error(`Eksik ortam değişkenleri: ${requiredEnv.map(([key]) => key).join(', ')}`);
  process.exit(1);
}

const normalizeText = (value) => `${value || ''}`.trim();

const normalizeImageExtension = (value) => {
  const normalized = normalizeText(value).toLowerCase().replace(/^\./, '');

  if (normalized === 'jpeg') {
    return 'jpg';
  }

  return ['jpg', 'png', 'webp', 'avif'].includes(normalized) ? normalized : '';
};

const resolveSourceImageExtension = (sourceUrl) => {
  const normalized = normalizeText(sourceUrl);
  if (!normalized) {
    return 'jpg';
  }

  try {
    const parsed = new URL(normalized);
    const pathnameMatch = parsed.pathname.toLowerCase().match(/\.([a-z0-9]+)$/);
    const pathnameExtension = normalizeImageExtension(pathnameMatch?.[1] || '');
    if (pathnameExtension) {
      return pathnameExtension;
    }

    const queryExtension = normalizeImageExtension(
      parsed.searchParams.get('format')
      || parsed.searchParams.get('ext')
      || parsed.searchParams.get('fm')
      || '',
    );

    return queryExtension || 'jpg';
  } catch {
    return 'jpg';
  }
};

const formatPercent = (value) => `${Math.max(0, Math.min(100, value)).toFixed(1)}%`;

const formatNumber = (value) => Number(value || 0).toLocaleString('tr-TR');

const truncateText = (value, maxLength = 72) => {
  const normalized = normalizeText(value);
  if (!normalized || normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
};

const renderProgressBar = (current, total, width = DEFAULT_PROGRESS_BAR_WIDTH) => {
  const safeTotal = Math.max(1, Number(total) || 0);
  const safeCurrent = Math.max(0, Math.min(safeTotal, Number(current) || 0));
  const ratio = safeCurrent / safeTotal;
  const filled = Math.max(0, Math.min(width, Math.round(ratio * width)));
  return `[${'#'.repeat(filled)}${'-'.repeat(Math.max(0, width - filled))}] ${formatPercent(ratio * 100)}`;
};

const printLine = (value = '') => console.log(value);

const formatChapterLabel = (row) => {
  const seriesTitle = truncateText(row.mangaTitle || row.manga_id || 'Bilinmeyen Seri', 44) || 'Bilinmeyen Seri';
  const chapterNumber = Number.isFinite(Number(row.number)) ? Number(row.number) : row.number;
  const chapterTitle = truncateText(row.title || '', 26);
  return chapterTitle
    ? `${seriesTitle} | Bolum ${chapterNumber} | ${chapterTitle}`
    : `${seriesTitle} | Bolum ${chapterNumber}`;
};

const toSafeEntityId = (value) => normalizeText(value).replace(/[^a-zA-Z0-9_-]/g, '-');

const toPageObjectSegment = (pageIndex) => `${Math.max(0, Math.trunc(pageIndex)) + 1}`.padStart(3, '0');

const buildChapterPageObjectKey = (mangaId, chapterId, pageIndex, extension = 'webp') => (
  `manga/${toSafeEntityId(mangaId)}/chapters/${toSafeEntityId(chapterId)}/${toPageObjectSegment(pageIndex)}.${extension}`
);

const unwrapProxyUrl = (sourceUrl) => {
  const normalized = normalizeText(sourceUrl);
  if (!normalized) {
    return '';
  }

  try {
    const parsed = new URL(normalized);
    return normalizeText(parsed.searchParams.get('url')) || normalized;
  } catch {
    return normalized;
  }
};

const isStoredMediaUrl = (value) => {
  const normalized = normalizeText(value);
  if (!normalized) {
    return false;
  }

  if (MEDIA_BUCKET_URL && normalized.startsWith(MEDIA_BUCKET_URL)) {
    return true;
  }

  try {
    const parsed = new URL(normalized);
    return parsed.hostname.includes('.r2.dev') || parsed.hostname.includes('toonparrot-media');
  } catch {
    return false;
  }
};

const normalizeStoredOutputUrl = (sourceUrl) => {
  const normalized = unwrapProxyUrl(sourceUrl);
  return isStoredMediaUrl(normalized) ? normalized : normalizeText(sourceUrl);
};

const sanitizeChapterPageUrls = (images) => (
  Array.from(
    new Set(
      (Array.isArray(images) ? images : [])
        .map((image) => normalizeText(image))
        .map((image) => (image.startsWith('//') ? `https:${image}` : image))
        .filter((image) => image.startsWith('http') && !image.includes('base64')),
    ),
  )
);

const parseArgs = () => {
  const args = process.argv.slice(2);
  const options = {
    apply: false,
    mangaId: '',
    limit: 0,
    mode: 'fast',
  };

  for (const rawArg of args) {
    if (rawArg === '--apply') {
      options.apply = true;
      continue;
    }

    if (rawArg.startsWith('--manga-id=')) {
      options.mangaId = normalizeText(rawArg.split('=')[1]);
      continue;
    }

    if (rawArg.startsWith('--limit=')) {
      const parsed = Number.parseInt(rawArg.split('=')[1] || '0', 10);
      options.limit = Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
      continue;
    }

    if (rawArg.startsWith('--mode=')) {
      const parsedMode = normalizeText(rawArg.split('=')[1]).toLowerCase();
      options.mode = parsedMode === 'optimized' ? 'optimized' : 'fast';
    }
  }

  return options;
};

const options = parseArgs();

if (options.apply && !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('`--apply` icin SUPABASE_SERVICE_ROLE_KEY ortam degiskeni gerekli.');
  process.exit(1);
}

const SUPABASE_REQUEST_KEY = SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY;

const MODE_CONFIGS = {
  fast: {
    label: 'fast',
    ingestBatchSize: 10,
    ingestRequestConcurrency: 6,
    buildObjectExtension: (sourceUrl) => resolveSourceImageExtension(sourceUrl),
    transform: null,
  },
  optimized: {
    label: 'optimized',
    ingestBatchSize: 4,
    ingestRequestConcurrency: 3,
    buildObjectExtension: () => 'webp',
    transform: {
      quality: 90,
      format: 'webp',
    },
  },
};

const modeConfig = MODE_CONFIGS[options.mode] || MODE_CONFIGS.fast;

const createRestHeaders = (contentType = 'application/json') => ({
  apikey: SUPABASE_REQUEST_KEY,
  Authorization: `Bearer ${SUPABASE_REQUEST_KEY}`,
  'Content-Type': contentType,
});

const fetchChapterRows = async () => {
  const rows = [];
  let offset = 0;

  while (true) {
    const requestUrl = new URL(`${SUPABASE_URL}/rest/v1/chapters`);
    requestUrl.searchParams.set('select', 'id,manga_id,number,title,pages');
    requestUrl.searchParams.set('order', 'id.asc');
    requestUrl.searchParams.set('limit', `${DEFAULT_PAGE_SIZE}`);
    requestUrl.searchParams.set('offset', `${offset}`);

    if (options.mangaId) {
      requestUrl.searchParams.set('manga_id', `eq.${options.mangaId}`);
    }

    const response = await fetch(requestUrl, {
      headers: createRestHeaders(),
    });

    if (!response.ok) {
      throw new Error(`Supabase chapters select failed (${response.status})`);
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

const fetchMangaTitleMap = async () => {
  const titles = new Map();
  let offset = 0;

  while (true) {
    const requestUrl = new URL(`${SUPABASE_URL}/rest/v1/mangas`);
    requestUrl.searchParams.set('select', 'id,title');
    requestUrl.searchParams.set('order', 'id.asc');
    requestUrl.searchParams.set('limit', `${DEFAULT_PAGE_SIZE}`);
    requestUrl.searchParams.set('offset', `${offset}`);

    if (options.mangaId) {
      requestUrl.searchParams.set('id', `eq.${options.mangaId}`);
    }

    const response = await fetch(requestUrl, {
      headers: createRestHeaders(),
    });

    if (!response.ok) {
      throw new Error(`Supabase mangas select failed (${response.status})`);
    }

    const batch = await response.json();
    if (!Array.isArray(batch) || batch.length === 0) {
      break;
    }

    for (const row of batch) {
      titles.set(normalizeText(row.id), normalizeText(row.title));
    }

    if (batch.length < DEFAULT_PAGE_SIZE) {
      break;
    }

    offset += batch.length;
  }

  return titles;
};

const updateChapterPages = async (chapterId, pages) => {
  const requestUrl = new URL(`${SUPABASE_URL}/rest/v1/chapters`);
  requestUrl.searchParams.set('id', `eq.${chapterId}`);

  const response = await fetch(requestUrl, {
    method: 'PATCH',
    headers: {
      ...createRestHeaders(),
      Prefer: 'return=minimal',
    },
    body: JSON.stringify({ pages }),
  });

  if (!response.ok) {
    const responseText = await response.text().catch(() => '');
    throw new Error(responseText || `Supabase chapter update failed (${response.status})`);
  }
};

const updateMangaTimestamps = async (mangaIds) => {
  for (const mangaId of mangaIds) {
    const requestUrl = new URL(`${SUPABASE_URL}/rest/v1/mangas`);
    requestUrl.searchParams.set('id', `eq.${mangaId}`);

    const response = await fetch(requestUrl, {
      method: 'PATCH',
      headers: {
        ...createRestHeaders(),
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({ last_updated: new Date().toISOString() }),
    });

    if (!response.ok) {
      const responseText = await response.text().catch(() => '');
      throw new Error(responseText || `Supabase manga update failed (${response.status})`);
    }
  }
};

const buildFailedItemResults = (items, error) => items.map((item) => {
  let sourceHost = '';

  try {
    sourceHost = new URL(item.sourceUrl).hostname;
  } catch {
    sourceHost = '';
  }

  return {
    id: item.id,
    status: 'error',
    error,
    sourceHost,
  };
});

const isRetryableWorkerFailure = (responseText, status) => {
  const normalized = normalizeText(responseText).toLowerCase();
  return (
    status === 429
    || status === 500
    || status === 502
    || status === 503
    || status === 504
    || normalized.includes('worker exceeded resource limits')
    || normalized.includes('error 1102')
  );
};

const ingestBatch = async (items, attempt = 1) => {
  const response = await fetch(MEDIA_INGEST_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${MEDIA_INGEST_TOKEN}`,
    },
    body: JSON.stringify({ items }),
  });

  if (!response.ok) {
    const responseText = await response.text().catch(() => '');
    if (items.length > 1 && isRetryableWorkerFailure(responseText, response.status)) {
      const midpoint = Math.ceil(items.length / 2);
      const left = await ingestBatch(items.slice(0, midpoint), attempt + 1);
      const right = await ingestBatch(items.slice(midpoint), attempt + 1);
      return [...left, ...right];
    }

    if (items.length === 1 && attempt <= 2 && isRetryableWorkerFailure(responseText, response.status)) {
      await wait(INGEST_RETRY_DELAY_MS * attempt);
      return ingestBatch(items, attempt + 1);
    }

    return buildFailedItemResults(
      items,
      responseText || `Media ingest failed (${response.status})`,
    );
  }

  const data = await response.json();
  return Array.isArray(data?.items) ? data.items : [];
};

const materializeChapterPages = async (chapterRow, context = {}) => {
  const normalizedPages = sanitizeChapterPageUrls(chapterRow.pages || []);
  const activeModeConfig = context.modeConfig || modeConfig;
  const items = normalizedPages.flatMap((pageUrl, pageIndex) => {
    const normalizedSourceUrl = unwrapProxyUrl(pageUrl);
    if (!normalizedSourceUrl || isStoredMediaUrl(normalizedSourceUrl)) {
      return [];
    }

    return [{
      id: `${chapterRow.id}:${pageIndex}`,
      sourceUrl: normalizedSourceUrl,
      objectKey: buildChapterPageObjectKey(
        chapterRow.manga_id,
        chapterRow.id,
        pageIndex,
        activeModeConfig.buildObjectExtension(normalizedSourceUrl),
      ),
      entityType: 'chapter',
      entityId: chapterRow.id,
      variant: 'page',
      transform: activeModeConfig.transform || undefined,
    }];
  });

  if (items.length === 0) {
    return {
      pages: normalizedPages.map((pageUrl) => normalizeStoredOutputUrl(pageUrl)),
      itemCount: 0,
      storedCount: 0,
      failedCount: 0,
      failures: [],
    };
  }

  const materializedUrls = new Map();
  const failures = [];
  const batches = createBatches(items, activeModeConfig.ingestBatchSize);
  let nextBatchIndex = 0;

  const runNextBatch = async () => {
    while (true) {
      const currentBatch = batches[nextBatchIndex];
      nextBatchIndex += 1;

      if (!currentBatch) {
        return;
      }

      const results = await ingestBatch(currentBatch.items);

      for (const result of results) {
        if ((result.status === 'stored' || result.status === 'exists') && result.publicUrl) {
          materializedUrls.set(result.id, result.publicUrl);
        } else if (!['stored', 'exists'].includes(result.status)) {
          failures.push({
            id: result.id,
            status: result.status,
            error: result.error || null,
            sourceHost: normalizeText(result.sourceHost),
          });
        }
      }
    }
  };

  await Promise.all(
    Array.from(
      { length: Math.min(activeModeConfig.ingestRequestConcurrency, batches.length) },
      () => runNextBatch(),
    ),
  );

  return {
    pages: normalizedPages.map((pageUrl, pageIndex) => (
      materializedUrls.get(`${chapterRow.id}:${pageIndex}`)
      || normalizeStoredOutputUrl(pageUrl)
    )),
    itemCount: items.length,
    storedCount: materializedUrls.size,
    failedCount: Math.max(0, items.length - materializedUrls.size),
    failures,
  };
};

const main = async () => {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });

  const chapterRows = await fetchChapterRows();
  const mangaTitlesById = await fetchMangaTitleMap().catch((error) => {
    printLine(`Seri adlari alinamadi, manga id fallback kullanilacak: ${error instanceof Error ? error.message : error}`);
    return new Map();
  });
  const candidateRows = chapterRows
    .map((row) => ({
      ...row,
      mangaTitle: mangaTitlesById.get(normalizeText(row.manga_id)) || '',
      normalizedPages: sanitizeChapterPageUrls(row.pages || []),
    }))
    .filter((row) => row.normalizedPages.some((pageUrl) => !isStoredMediaUrl(unwrapProxyUrl(pageUrl))));

  const limitedCandidateRows = options.limit > 0
    ? candidateRows.slice(0, options.limit)
    : candidateRows;

  const report = {
    generatedAt: new Date().toISOString(),
    mode: options.apply ? 'apply' : 'plan',
    totalChaptersScanned: chapterRows.length,
    candidateChapterCount: limitedCandidateRows.length,
    updatedChapterCount: 0,
    touchedMangaCount: 0,
    pageCandidates: limitedCandidateRows.reduce((sum, row) => (
      sum + row.normalizedPages.filter((pageUrl) => !isStoredMediaUrl(unwrapProxyUrl(pageUrl))).length
    ), 0),
    storedPageCount: 0,
    failedPageCount: 0,
    blockedHosts: [],
    chapters: [],
  };

  printLine(
    options.apply
      ? `Basladi: ${formatNumber(limitedCandidateRows.length)} bolum, ${formatNumber(report.pageCandidates)} sayfa | mod ${modeConfig.label} | batch ${modeConfig.ingestBatchSize} | paralel ${modeConfig.ingestRequestConcurrency}`
      : `Plan hazir: ${formatNumber(limitedCandidateRows.length)} bolum, ${formatNumber(report.pageCandidates)} sayfa`,
  );

  if (!options.apply) {
    report.chapters = limitedCandidateRows.map((row) => ({
      chapterId: row.id,
      mangaId: row.manga_id,
      mangaTitle: row.mangaTitle,
      chapterNumber: row.number,
      title: row.title,
      pageCount: row.normalizedPages.length,
      pagesToMaterialize: row.normalizedPages.filter((pageUrl) => !isStoredMediaUrl(unwrapProxyUrl(pageUrl))).length,
    }));
  } else {
    const touchedMangaIds = new Set();
    const blockedHostCounts = new Map();
    let processedChapterCount = 0;

    for (const row of limitedCandidateRows) {
      const chapterIndex = processedChapterCount + 1;
      const chapterLabel = formatChapterLabel(row);
      const pagesToMaterialize = row.normalizedPages.filter((pageUrl) => !isStoredMediaUrl(unwrapProxyUrl(pageUrl))).length;

      let result;
      try {
        result = await materializeChapterPages(row, {
          modeConfig,
        });
      } catch (error) {
        result = {
          pages: row.normalizedPages,
          itemCount: row.normalizedPages.length,
          storedCount: 0,
          failedCount: row.normalizedPages.length,
          failures: [{
            id: row.id,
            status: 'error',
            error: error instanceof Error ? error.message : `${error || 'Unknown chapter error'}`,
            sourceHost: '',
          }],
        };
      }

      const changed = JSON.stringify(result.pages) !== JSON.stringify(row.normalizedPages);

      for (const failure of result.failures) {
        if (failure.status === 'blocked') {
          incrementCount(blockedHostCounts, failure.sourceHost);
        }
      }

      report.storedPageCount += result.storedCount;
      report.failedPageCount += result.failedCount;
      report.chapters.push({
        chapterId: row.id,
        mangaId: row.manga_id,
        chapterNumber: row.number,
        title: row.title,
        pageCount: row.normalizedPages.length,
        pagesToMaterialize: result.itemCount,
        storedPageCount: result.storedCount,
        failedPageCount: result.failedCount,
        updated: changed,
        failures: result.failures,
      });

      const completedPages = report.storedPageCount + report.failedPageCount;
      const doneBar = renderProgressBar(completedPages, report.pageCandidates);
      const chapterOutcome = result.failedCount > 0
        ? `ok ${formatNumber(result.storedCount)}, hata ${formatNumber(result.failedCount)}`
        : `ok ${formatNumber(result.storedCount)}`;
      printLine(`${doneBar} | ${formatNumber(completedPages)}/${formatNumber(report.pageCandidates)} sayfa | ${chapterIndex}/${limitedCandidateRows.length} bolum | ${chapterLabel} | hedef ${formatNumber(pagesToMaterialize)} | ${chapterOutcome}`);

      if (!changed) {
        processedChapterCount += 1;
        continue;
      }

      await updateChapterPages(row.id, result.pages);
      touchedMangaIds.add(row.manga_id);
      report.updatedChapterCount += 1;
      processedChapterCount += 1;
    }

    if (touchedMangaIds.size > 0) {
      await updateMangaTimestamps(Array.from(touchedMangaIds));
    }

    report.touchedMangaCount = touchedMangaIds.size;
    report.blockedHosts = Array.from(blockedHostCounts.entries())
      .sort((left, right) => right[1] - left[1])
      .map(([host, count]) => ({ host, count }));
  }

  const reportPath = path.join(OUTPUT_DIR, 'report.json');
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  printLine('');
  printLine(`Tamamlandi: ${formatNumber(report.updatedChapterCount)} bolum guncellendi, ${formatNumber(report.storedPageCount)} sayfa yazildi, ${formatNumber(report.failedPageCount)} sayfa hatali.`);
  printLine(`Rapor: ${reportPath}`);
};

await main();
