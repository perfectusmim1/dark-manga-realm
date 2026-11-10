/**
 * TOONPARROT - COMIX.TO R2 ARŞİV HASAT & KATEGORİZASYON MOTORU
 *
 * Kurallar:
 * - Supabase 500MB limitini korumak için Comix arşiv serileri YALNIZCA Cloudflare R2'ye
 *   (`catalog/series/<slug>.json` ve `comix-shard-page-<N>.json`) yazılır; Supabase'e YAZILMAZ.
 * - Mevcut Supabase Türkçe serileriyle 3 katmanlı tekilleştirme (AniList ID, MAL ID, Başlık + Alternatif Başlıklar)
 *   yapılır; sitede zaten olan bir seri ASLA ikinci kez oluşturulmaz.
 * - Bölümü olmayan (`hasChapters: false` / `latestChapter <= 0`) veya örnek bölüm sayfası çalışmayan ölü seriler elenir.
 * - Konu özeti temizlenip Türkçe'ye çevrilir, türler Türkçe'ye eşlenir, `manhwa`/`manga`/`manhua` ve `+18` (`isAdult`)
 *   doğru sınıflandırılır, AniList/MAL karakterleri otomatik çekilir.
 * - Comix görüntülenme/takipçi sayıları ASLA alınmaz (`views: 0`).
 * - Bölüm başlıklarına grup adı veya `[EN]` etiketi ASLA eklenmez; tüm diller (`tr`, `en`, `es`, `pt-br`, `ru`, `fr`, `id` vb.)
 *   bölüm bazlı `language` alanıyla kaydedilir.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  fetchComixApi,
  unpackManga,
  toComixSeriesUuid,
  slugifyTitle,
  normalizeTitleKey,
  areSeriesTitlesMatching,
  cleanEnglishSynopsis,
  translateSynopsisToTurkish,
  mapComixGenresAndFormat,
  extractExternalIdsFromComixLinks,
  fetchAniListMetadataAndCharacters,
  fetchBestComixChaptersByLanguage,
} from './comix-crypto.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

function loadEnv() {
  const envPath = path.join(ROOT_DIR, '.env');
  const env = { ...process.env };
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const idx = trimmed.indexOf('=');
      if (idx > 0) {
        const k = trimmed.slice(0, idx).trim();
        const v = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
        if (!env[k]) env[k] = v;
      }
    }
  }
  return env;
}

const env = loadEnv();
const SUPABASE_URL = (env.VITE_SUPABASE_URL || env.SUPABASE_URL || '').replace(/\/+$/, '');
const SUPABASE_ANON_KEY = env.VITE_SUPABASE_ANON_KEY || env.SUPABASE_ANON_KEY || '';
const CATALOG_WORKER_URL = (env.VITE_CATALOG_WORKER_URL || 'https://toonparrot-catalog-worker.caganhuseyinerdil.workers.dev').replace(/\/+$/, '');
const CATALOG_ADMIN_TOKEN = env.CATALOG_ADMIN_TOKEN || '';

if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !CATALOG_ADMIN_TOKEN) {
  console.error('[FATAL] Eksik ortam değişkeni (.env içinde VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, CATALOG_ADMIN_TOKEN gereklidir).');
  process.exit(1);
}

const args = process.argv.slice(2);
function getArgValue(flag, defaultVal = null) {
  const idx = args.indexOf(flag);
  if (idx !== -1 && idx + 1 < args.length) return args[idx + 1];
  return defaultVal;
}

const TARGET_HIDS = getArgValue('--hids', '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const EXPLICIT_START_PAGE = getArgValue('--start-page', null);
const START_PAGE = Math.max(1, Number(EXPLICIT_START_PAGE || 1));
const MAX_PAGES = Number(getArgValue('--max-pages', 0)); // 0 = sonuna kadar dinamik (limitsiz)
const LIMIT_SERIES = Number(getArgValue('--limit', 0)); // 0 = limitsiz
const SERIES_CONCURRENCY = Math.max(1, Math.min(16, Number(getArgValue('--concurrency', 8))));
const ORDER_BY = getArgValue('--order', 'follows_total');
const RESUME_MODE = args.includes('--resume');
const FORCE_MODE = args.includes('--force');
const SHARD_SIZE = 250;

// Varsayılan 0 = limitsiz arşiv modu; yalnızca --timeout-ms verilirse zamanlayıcı devreye girer
const GLOBAL_TIMEOUT_MS = Number(getArgValue('--timeout-ms', 0));
if (GLOBAL_TIMEOUT_MS > 0) {
  const globalTimer = setTimeout(() => {
    console.error('[TIMEOUT] Hasat scripti azami çalışma süresini aştı, güvenli şekilde sonlandırılıyor.');
    process.exit(1);
  }, GLOBAL_TIMEOUT_MS);
  globalTimer.unref?.();
}

const CACHE_DIR = path.join(ROOT_DIR, '.cache');
const HARVEST_STATE_FILE = path.join(CACHE_DIR, 'comix-r2-harvest-state.json');

function getTimeStr() {
  return new Date().toTimeString().split(' ')[0];
}

function logProgress(current, total, title, msg) {
  const pct = total > 0 ? ((current / total) * 100).toFixed(1) : '0.0';
  console.log(`[${getTimeStr()}] [${current}/${total}] (%${pct}) - ${title}: ${msg}`);
}

function loadHarvestState() {
  try {
    if (fs.existsSync(HARVEST_STATE_FILE)) {
      return JSON.parse(fs.readFileSync(HARVEST_STATE_FILE, 'utf8'));
    }
  } catch {}
  return { lastPage: 0, processedHids: [], shardSummaries: {} };
}

function saveHarvestState(state) {
  try {
    if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(HARVEST_STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
  } catch (err) {
    console.warn('[UYARI] Harvest state kaydedilemedi:', err.message);
  }
}

async function loadExistingSupabaseDedupeIndex() {
  const headers = {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    Accept: 'application/json',
  };

  const byAnilistId = new Map();
  const byMalId = new Map();
  const byTitleKey = new Map();
  const existingSlugs = new Set();
  const allRows = [];

  const pageSize = 1000;
  for (let page = 0; page < 50; page++) {
    const offset = page * pageSize;
    const url = `${SUPABASE_URL}/rest/v1/mangas?select=id,slug,title,alternative_titles,source_links&offset=${offset}&limit=${pageSize}`;
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
    if (!res.ok) break;
    const rows = await res.json();
    if (!Array.isArray(rows) || rows.length === 0) break;
    allRows.push(...rows);
    if (rows.length < pageSize) break;
  }

  for (const row of allRows) {
    if (row.slug) existingSlugs.add(String(row.slug).toLowerCase());
    const tKey = normalizeTitleKey(row.title);
    if (tKey) byTitleKey.set(tKey, row);

    if (Array.isArray(row.alternative_titles)) {
      for (const alt of row.alternative_titles) {
        const aKey = normalizeTitleKey(alt);
        if (aKey && !byTitleKey.has(aKey)) {
          byTitleKey.set(aKey, row);
        }
      }
    }

    const ext = extractExternalIdsFromComixLinks(null, row.source_links);
    if (ext.anilistId) byAnilistId.set(Number(ext.anilistId), row);
    if (ext.malId) byMalId.set(Number(ext.malId), row);
  }

  return {
    totalExisting: allRows.length,
    byAnilistId,
    byMalId,
    byTitleKey,
    existingSlugs,
  };
}

function findDuplicateInSupabase(unpackedComix, anilistMeta, dedupeIndex) {
  const ext = extractExternalIdsFromComixLinks(unpackedComix.links);
  const alId = ext.anilistId || anilistMeta?.anilistId;
  const malId = ext.malId || anilistMeta?.malId;

  if (alId && dedupeIndex.byAnilistId.has(Number(alId))) {
    return dedupeIndex.byAnilistId.get(Number(alId));
  }
  if (malId && dedupeIndex.byMalId.has(Number(malId))) {
    return dedupeIndex.byMalId.get(Number(malId));
  }

  const candidateTitles = [
    unpackedComix.title,
    ...(Array.isArray(unpackedComix.altTitles) ? unpackedComix.altTitles : []),
    ...(Array.isArray(anilistMeta?.altTitles) ? anilistMeta.altTitles : []),
  ].filter(Boolean);

  for (const t of candidateTitles) {
    const key = normalizeTitleKey(t);
    if (key && dedupeIndex.byTitleKey.has(key)) {
      return dedupeIndex.byTitleKey.get(key);
    }
  }

  return null;
}

async function uploadR2SeriesJson(slug, payload, maxRetries = 5) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(`${CATALOG_WORKER_URL}/v1/admin/series/${encodeURIComponent(slug)}?onlySeries=1`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-Catalog-Admin-Token': CATALOG_ADMIN_TOKEN,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(25000),
      });
      if (res.ok) {
        return;
      }
      const errText = await res.text().catch(() => '');
      if (attempt === maxRetries) {
        throw new Error(`R2 seri yazma hatası (${res.status}): ${errText}`);
      }
      const delayMs = Math.min(10000, 1000 * Math.pow(2, attempt - 1));
      console.warn(`[UYARI] R2 yazma yanıtı (${res.status}), ${delayMs}ms sonra yeniden deneniyor (${attempt}/${maxRetries}): ${slug}`);
      await sleep(delayMs);
    } catch (err) {
      if (attempt === maxRetries) {
        throw err;
      }
      const delayMs = Math.min(10000, 1000 * Math.pow(2, attempt - 1));
      console.warn(`[UYARI] R2 bağlantı sorunu (${err.message}), ${delayMs}ms sonra yeniden deneniyor (${attempt}/${maxRetries}): ${slug}`);
      await sleep(delayMs);
    }
  }
}

const uploadedFullShards = new Set();

async function syncShardsToR2(shardSummariesMap) {
  const mergedList = Object.values(shardSummariesMap);
  if (mergedList.length === 0) return;

  const shardSlugs = [];
  const totalShards = Math.max(1, Math.ceil(mergedList.length / SHARD_SIZE));

  for (let sIdx = 0; sIdx < totalShards; sIdx++) {
    const shardNum = sIdx + 1;
    const shardSlug = `comix-shard-page-${shardNum}`;
    shardSlugs.push(shardSlug);
    const slice = mergedList.slice(sIdx * SHARD_SIZE, (sIdx + 1) * SHARD_SIZE);
    const isFullShard = slice.length === SHARD_SIZE;

    // Tamamlanmış (250 elemanlı) shard'ları tekrar tekrar R2'ye yükleyip vakit ve istek harcama
    if (isFullShard && uploadedFullShards.has(shardNum)) {
      continue;
    }

    const shardPayload = {
      id: `c01c0009-0000-4000-8000-${String(shardNum).padStart(12, '0')}`,
      slug: shardSlug,
      title: `Comix Archive Shard ${shardNum}`,
      is_public: false,
      isPublic: false,
      shardPage: shardNum,
      count: slice.length,
      series: slice,
      items: slice,
      updatedAt: new Date().toISOString(),
    };

    await uploadR2SeriesJson(shardSlug, shardPayload);
    await fetch(`${CATALOG_WORKER_URL}/v1/admin/comix-shards/page-${shardNum}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'X-Catalog-Admin-Token': CATALOG_ADMIN_TOKEN,
      },
      body: JSON.stringify(shardPayload),
      signal: AbortSignal.timeout(20000),
    }).catch(() => undefined);

    if (isFullShard) {
      uploadedFullShards.add(shardNum);
    }
  }

  const manifestPayload = {
    id: 'c01c0009-0000-4000-8000-000000000000',
    slug: 'comix-shard-manifest',
    title: 'Comix Archive Shard Manifest',
    is_public: false,
    isPublic: false,
    version: 1,
    totalItems: mergedList.length,
    totalShards,
    shards: shardSlugs,
    updatedAt: new Date().toISOString(),
  };

  await uploadR2SeriesJson('comix-shard-manifest', manifestPayload);
  await fetch(`${CATALOG_WORKER_URL}/v1/admin/comix-shards/manifest`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'X-Catalog-Admin-Token': CATALOG_ADMIN_TOKEN,
    },
    body: JSON.stringify(manifestPayload),
    signal: AbortSignal.timeout(20000),
  }).catch(() => undefined);
}

async function processComixSeries(rawItem, currentIdx, totalTarget, dedupeIndex, shardSummariesMap) {
  const baseItem = unpackManga(rawItem);
  const hid = baseItem?.hid;
  if (!hid) {
    return { status: 'skipped_invalid' };
  }

  // Tam detay çek (/manga/:hid) -> özet, yazar, çizer, türler, dış linkler
  let fullItem = baseItem;
  try {
    const detailRaw = await fetchComixApi(`/manga/${hid}`);
    const unpackedDetail = unpackManga(detailRaw);
    if (unpackedDetail && unpackedDetail.hid) {
      fullItem = unpackedDetail;
    }
  } catch {}

  const title = String(fullItem.title || '').trim();
  if (!title || !fullItem.hasChapters || Number(fullItem.latestChapter || 0) <= 0) {
    logProgress(currentIdx, totalTarget, title || hid, 'ATLANDI: Bölümü olmayan / ölü seri.');
    return { status: 'skipped_empty' };
  }

  // AniList / MAL eşleşmesi, meta veriler ve karakterler
  const extIds = extractExternalIdsFromComixLinks(fullItem.links);
  const anilistMeta = await fetchAniListMetadataAndCharacters({
    anilistId: extIds.anilistId,
    malId: extIds.malId,
    searchTitles: [title, ...(fullItem.altTitles || [])],
  });

  const coverUrl = String(
    fullItem.poster?.large || fullItem.poster?.medium || anilistMeta.coverUrl || ''
  ).trim();
  if (!coverUrl) {
    logProgress(currentIdx, totalTarget, title, 'ATLANDI: Kapak görseli yok.');
    return { status: 'skipped_no_cover' };
  }
  const bannerUrl = String(anilistMeta.bannerUrl || coverUrl).trim();

  // 3 Katmanlı Tekilleştirme Kontrolü (Sitede zaten varsa ASLA mükerrer oluşturma)
  const existingMatch = findDuplicateInSupabase(fullItem, anilistMeta, dedupeIndex);
  if (existingMatch) {
    logProgress(
      currentIdx,
      totalTarget,
      title,
      `MEVCUT SERİ EŞLEŞTİ -> Sitedeki "${existingMatch.title}" (${existingMatch.slug}) ile aynı seri, mükerrer eklenmedi.`
    );
    return { status: 'duplicate_existing', existingManga: existingMatch };
  }

  let slug = slugifyTitle(title);
  if (!slug || slug.length < 2) slug = `comix-${hid}`;
  if (dedupeIndex.existingSlugs.has(slug)) {
    slug = `${slug}-${hid}`;
  }
  dedupeIndex.existingSlugs.add(slug);

  const mangaId = toComixSeriesUuid(hid);

  // Tüm dillerdeki bölümleri çek ve örnek bölümün sayfalarının çalıştığını doğrula
  const chaptersRes = await fetchBestComixChaptersByLanguage(hid, mangaId, slug, {
    maxPages: 12,
    verifySamplePages: true,
    hydrateSamplePages: false,
  });

  if (!chaptersRes.valid || chaptersRes.chapters.length === 0) {
    logProgress(currentIdx, totalTarget, title, 'ATLANDI: Çalışan bölüm sayfası doğrulanamadı.');
    return { status: 'skipped_empty' };
  }

  // Türler, format (manhwa/manga/manhua) ve +18 tespiti
  const { formatType: rawFormatType, isAdult: comixAdult, genres: comixGenres } = mapComixGenresAndFormat(fullItem);
  let formatType = rawFormatType;
  if (!fullItem.type && anilistMeta.countryOfOrigin) {
    const co = String(anilistMeta.countryOfOrigin).toUpperCase();
    if (co === 'JP') formatType = 'manga';
    else if (co === 'CN' || co === 'TW') formatType = 'manhua';
    else if (co === 'KR') formatType = 'manhwa';
  }

  const isAdult = Boolean(comixAdult || anilistMeta.isAdult);
  const genres = Array.from(
    new Set([
      ...(comixGenres || []),
      ...(anilistMeta.genres || []),
      ...(isAdult ? ['+18'] : []),
    ].filter(Boolean))
  );
  if (genres.length === 0) {
    genres.push('Aksiyon', 'Fantastik');
  }

  // Konu özetini hem İngilizce hem Türkçe olarak ayrı ayrı hazırla
  const enDescription = cleanEnglishSynopsis(fullItem.synopsis || anilistMeta.descriptionEn || '');
  const trDescription = await translateSynopsisToTurkish(enDescription);
  const fallbackDescription = `${title} serisini ToonParrot üzerinden çoklu dil ve görsel çeviri desteğiyle okuyun.`;

  const comixAuthors = (fullItem.authors || []).map((a) => a.title).filter(Boolean).join(', ');
  const comixArtists = (fullItem.artists || []).map((a) => a.title).filter(Boolean).join(', ');
  const anilistAuthors = (anilistMeta.authors || []).filter(Boolean).join(', ');
  const anilistArtists = (anilistMeta.artists || []).filter(Boolean).join(', ');

  const authorNames = comixAuthors || anilistAuthors || 'Bilinmiyor';
  const artistNames = comixArtists || anilistArtists || authorNames;
  const releaseYear = Number(fullItem.year || anilistMeta.releaseYear) || null;

  const altTitles = Array.from(
    new Set(
      [
        ...(Array.isArray(fullItem.altTitles) ? fullItem.altTitles : []),
        ...(Array.isArray(anilistMeta.altTitles) ? anilistMeta.altTitles : []),
      ]
        .map((t) => String(t || '').trim())
        .filter((t) => Boolean(t) && t.toLowerCase() !== title.toLowerCase())
    )
  ).slice(0, 25);

  const sourceLinks = [
    {
      source: 'comix',
      url: `https://comix.to/title/${hid}-${slug}`,
      externalId: hid,
      label: 'Comix',
    },
    ...(anilistMeta.sourceLinks || []),
    ...(extIds.extraLinks || []),
  ];

  const uniqueChapterNumbersCount = new Set(
    chaptersRes.chapters.map((c) => Number(c.number))
  ).size;
  const nowIso = new Date().toISOString();
  const status = fullItem.status === 'finished' || fullItem.status === 'completed' ? 'completed' : 'ongoing';
  const latestChaptersPreview = chaptersRes.chapters.slice(-2).reverse().map((c) => ({
    id: c.id,
    number: c.number,
    title: c.title,
    release_date: c.release_date,
    language: c.language,
  }));

  const r2SeriesPayload = {
    id: mangaId,
    slug,
    title,
    alternative_titles: altTitles,
    alternativeTitles: altTitles,
    author: authorNames,
    artist: artistNames,
    description: trDescription || enDescription || fallbackDescription,
    description_tr: trDescription || '',
    descriptionTr: trDescription || '',
    description_en: enDescription || '',
    descriptionEn: enDescription || '',
    cover: coverUrl,
    banner: bannerUrl,
    genres,
    status,
    type: formatType,
    is_public: true,
    isPublic: true,
    is_adult: isAdult,
    isAdult,
    views: 0, // Comix görüntülenme sayıları ASLA alınmaz
    release_year: releaseYear,
    releaseYear,
    source_links: sourceLinks,
    sourceLinks,
    details: {
      primarySource: 'comix',
      primarySourceUrl: `https://comix.to/title/${hid}-${slug}`,
      hid,
      language: chaptersRes.languages.includes('tr') ? 'tr' : (chaptersRes.languages[0] || 'en'),
      anilistId: anilistMeta.anilistId || extIds.anilistId || null,
      malId: anilistMeta.malId || extIds.malId || null,
      descriptionTr: trDescription || '',
      descriptionEn: enDescription || '',
      availableLanguages: chaptersRes.languages,
      originalLanguage: fullItem.originalLanguage || anilistMeta.countryOfOrigin || '',
      storageTier: 'r2_only',
    },
    chapter_count: uniqueChapterNumbersCount,
    chapterCount: uniqueChapterNumbersCount,
    latest_chapters: latestChaptersPreview,
    chapters: chaptersRes.chapters,
    characters: anilistMeta.characters,
    created_at: nowIso,
    createdAt: nowIso,
    last_updated: nowIso,
    updatedAt: nowIso,
  };

  await uploadR2SeriesJson(slug, r2SeriesPayload);

  // Shard özeti (hafif, chapters dizisi olmadan sadece son 2 bölüm önizlemesiyle)
  const { chapters: _fullChapters, characters: _fullChars, ...lightSummary } = r2SeriesPayload;
  shardSummariesMap[mangaId] = {
    ...lightSummary,
    characterCount: anilistMeta.characters.length,
  };

  // Dedupe indeksine ekle ki aynı çalışmada tekrar gelirse yakalansın
  dedupeIndex.byTitleKey.set(normalizeTitleKey(title), r2SeriesPayload);
  for (const alt of altTitles) {
    dedupeIndex.byTitleKey.set(normalizeTitleKey(alt), r2SeriesPayload);
  }

  logProgress(
    currentIdx,
    totalTarget,
    title,
    `R2'YE EKLENDİ [${formatType.toUpperCase()}${isAdult ? ' | +18' : ''}] -> ${chaptersRes.chapters.length} blm (${chaptersRes.languages.join(',').toUpperCase()}) | ${anilistMeta.characters.length} karakter | Konu: TR(${trDescription ? 'Var' : 'Yok'})+EN(${enDescription ? 'Var' : 'Yok'}) | Views: 0`
  );

  return { status: 'imported', manga: r2SeriesPayload };
}

async function main() {
  console.log('============================================================================');
  console.log('   TOONPARROT - COMIX.TO R2 ARŞİV HASAT & KATEGORİZASYON MOTORU            ');
  console.log('============================================================================');

  const dedupeIndex = await loadExistingSupabaseDedupeIndex();
  console.log(`[BİLGİ] Supabase tekilleştirme indeksi yüklendi: ${dedupeIndex.totalExisting} mevcut seri koruma altında.`);

  const state = loadHarvestState();
  const processedHids = new Set(state.processedHids || []);
  const shardSummariesMap = state.shardSummaries || {};

  // 1. Özel HID listesi verilmişse (--hids) doğrudan onları işle
  if (TARGET_HIDS.length > 0) {
    console.log(`[BİLGİ] Hedefli HID modu: ${TARGET_HIDS.length} seri işlenecek (${TARGET_HIDS.join(', ')})...`);
    let importedCount = 0;
    for (let i = 0; i < TARGET_HIDS.length; i++) {
      const hid = TARGET_HIDS[i];
      try {
        const res = await processComixSeries({ hid }, i + 1, TARGET_HIDS.length, dedupeIndex, shardSummariesMap);
        if (res.status === 'imported') importedCount++;
      } catch (err) {
        logProgress(i + 1, TARGET_HIDS.length, hid, `HATA: ${err.message}`);
      }
    }
    state.shardSummaries = shardSummariesMap;
    saveHarvestState(state);
    await syncShardsToR2(shardSummariesMap);
    console.log(`[TAMAMLANDI] Hedefli HID aktarımı bitti. R2'ye eklenen: ${importedCount}/${TARGET_HIDS.length}`);
    process.exit(0);
  }

  // 2. Dinamik Sayfa Tarama Modu (Sahte/manuel sayı olmadan, Comix meta.lastPage'e göre)
  let currentPage =
    RESUME_MODE && !EXPLICIT_START_PAGE && state.lastPage > 0
      ? Math.max(1, Number(state.lastPage))
      : START_PAGE;
  let totalLastPage = null;
  let totalImported = 0;
  let totalSkipped = 0;
  let totalDuplicates = 0;
  let pagesProcessed = 0;

  if (RESUME_MODE && currentPage > 1) {
    console.log(`[DEVAM MODU] Önceki oturumdan kalan Sayfa ${currentPage} üzerinden devam ediliyor (${processedHids.size} seri zaten işlenmiş)...`);
  }

  while (true) {
    if (MAX_PAGES > 0 && pagesProcessed >= MAX_PAGES) {
      console.log(`[BİLGİ] İstenen sayfa sınırına (${MAX_PAGES}) ulaşıldı.`);
      break;
    }
    if (LIMIT_SERIES > 0 && totalImported >= LIMIT_SERIES) {
      console.log(`[BİLGİ] İstenen seri sınırına (${LIMIT_SERIES}) ulaşıldı.`);
      break;
    }

    let pageRes = null;
    let pageFetchOk = false;
    let pageAttempt = 0;
    while (!pageFetchOk) {
      pageAttempt++;
      try {
        pageRes = await fetchComixApi('/manga', {
          page: currentPage,
          limit: 20,
          [`order[${ORDER_BY}]`]: 'desc',
        });
        pageFetchOk = true;
      } catch (err) {
        const waitSec = Math.min(30, pageAttempt * 5);
        console.warn(`[UYARI] Sayfa ${currentPage} çekilemedi (Deneme ${pageAttempt}: ${err.message}). İnternet/bağlantı bekleniyor, ${waitSec}sn sonra tekrar denenecek...`);
        await new Promise((resolve) => setTimeout(resolve, waitSec * 1000));
      }
    }

    const rawItems = pageRes?.items || (Array.isArray(pageRes) ? pageRes : []);
    if (!rawItems || rawItems.length === 0) {
      console.log(`[BİLGİ] Sayfa ${currentPage} boş döndü, arşivin doğal sonuna ulaşıldı.`);
      break;
    }

    if (pageRes?.meta?.lastPage) {
      totalLastPage = Number(pageRes.meta.lastPage);
    }

    const candidates = rawItems
      .map(unpackManga)
      .filter((it) => {
        if (!it || !it.hid) return false;
        if (RESUME_MODE && !FORCE_MODE && processedHids.has(it.hid)) {
          return false;
        }
        if (!it.hasChapters || Number(it.latestChapter || 0) <= 0) {
          totalSkipped++;
          return false;
        }
        return true;
      });

    const totalDisplay = LIMIT_SERIES > 0 ? LIMIT_SERIES : (totalLastPage ? totalLastPage * 20 : candidates.length);
    console.log(`[${getTimeStr()}] Sayfa ${currentPage}${totalLastPage ? `/${totalLastPage}` : ''} taranıyor (${candidates.length} aktif aday)...`);

    for (let i = 0; i < candidates.length; i += SERIES_CONCURRENCY) {
      if (LIMIT_SERIES > 0 && totalImported >= LIMIT_SERIES) break;
      const chunk = candidates.slice(i, i + SERIES_CONCURRENCY);
      const results = await Promise.all(
        chunk.map(async (item, idxOffset) => {
          const seqNum = totalImported + idxOffset + 1;
          try {
            return await processComixSeries(item, seqNum, totalDisplay, dedupeIndex, shardSummariesMap);
          } catch (err) {
            logProgress(seqNum, totalDisplay, item.title || item.hid, `HATA: ${err.message}`);
            return { status: 'error' };
          }
        })
      );

      for (let k = 0; k < results.length; k++) {
        const r = results[k];
        const hid = chunk[k]?.hid;
        if (hid) processedHids.add(hid);
        if (r?.status === 'imported') totalImported++;
        else if (r?.status === 'duplicate_existing') totalDuplicates++;
        else totalSkipped++;
      }
    }

    pagesProcessed++;
    state.lastPage = currentPage;
    state.processedHids = Array.from(processedHids);
    state.shardSummaries = shardSummariesMap;
    saveHarvestState(state);

    if (pagesProcessed % 5 === 0 || (totalLastPage && currentPage >= totalLastPage)) {
      try {
        await syncShardsToR2(shardSummariesMap);
      } catch (shardErr) {
        console.warn(`[UYARI] Shard senkronizasyon uyarısı: ${shardErr.message}`);
      }
    }

    if (totalLastPage && currentPage >= totalLastPage) {
      console.log(`[BİLGİ] Son sayfaya (${totalLastPage}) ulaşıldı.`);
      break;
    }
    currentPage++;
  }

  console.log('============================================================================');
  console.log(`[TAMAMLANDI] R2'ye Eklenen: ${totalImported} | Mevcut Seri Eşleşmesi (Atlanan): ${totalDuplicates} | Ölü/Boş Elendi: ${totalSkipped}`);
  console.log('============================================================================');
  process.exit(0);
}

main().catch((err) => {
  console.error('[FATAL] Hasat motoru hatası:', err);
  process.exit(1);
});
