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
const START_PAGE = Math.max(1, Number(getArgValue('--start-page', 1)));
const MAX_PAGES = Number(getArgValue('--max-pages', 0)); // 0 = sonuna kadar dinamik
const LIMIT_SERIES = Number(getArgValue('--limit', 0)); // 0 = limitsiz
const SERIES_CONCURRENCY = Math.max(1, Math.min(6, Number(getArgValue('--concurrency', 3))));
const ORDER_BY = getArgValue('--order', 'follows_total');
const SHARD_SIZE = 250;

const GLOBAL_TIMEOUT_MS = Number(getArgValue('--timeout-ms', 25 * 60 * 1000));
const globalTimer = setTimeout(() => {
  console.error('[TIMEOUT] Hasat scripti azami çalışma süresini aştı, güvenli şekilde sonlandırılıyor.');
  process.exit(1);
}, GLOBAL_TIMEOUT_MS);
globalTimer.unref?.();

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

async function uploadR2SeriesJson(slug, payload) {
  const res = await fetch(`${CATALOG_WORKER_URL}/v1/admin/series/${encodeURIComponent(slug)}?onlySeries=1`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'X-Catalog-Admin-Token': CATALOG_ADMIN_TOKEN,
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(25000),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`R2 seri yazma hatası (${res.status}): ${errText}`);
  }
}

async function syncShardsToR2(shardSummariesMap) {
  const allSummaries = Object.values(shardSummariesMap);
  if (allSummaries.length === 0) return;

  // Önce mevcut R2 comix-shard-page-1 varsa oku ki önceki seriler kaybolmasın
  try {
    const existingShardRes = await fetch(`${CATALOG_WORKER_URL}/v1/catalog/series/comix-shard-page-1`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10000),
    });
    if (existingShardRes.ok) {
      const existingData = await existingShardRes.json();
      const existingList = Array.isArray(existingData?.series)
        ? existingData.series
        : Array.isArray(existingData?.items)
        ? existingData.items
        : [];
      for (const item of existingList) {
        if (item?.id && !shardSummariesMap[item.id]) {
          shardSummariesMap[item.id] = item;
        }
      }
    }
  } catch {}

  const mergedList = Object.values(shardSummariesMap);
  const shardSlugs = [];
  const totalShards = Math.max(1, Math.ceil(mergedList.length / SHARD_SIZE));

  for (let sIdx = 0; sIdx < totalShards; sIdx++) {
    const shardNum = sIdx + 1;
    const shardSlug = `comix-shard-page-${shardNum}`;
    shardSlugs.push(shardSlug);
    const slice = mergedList.slice(sIdx * SHARD_SIZE, (sIdx + 1) * SHARD_SIZE);
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

  const coverUrl = String(fullItem.poster?.large || fullItem.poster?.medium || '').trim();
  if (!coverUrl) {
    logProgress(currentIdx, totalTarget, title, 'ATLANDI: Kapak görseli yok.');
    return { status: 'skipped_no_cover' };
  }

  // AniList / MAL eşleşmesi ve karakterler
  const extIds = extractExternalIdsFromComixLinks(fullItem.links);
  const anilistMeta = await fetchAniListMetadataAndCharacters({
    anilistId: extIds.anilistId,
    malId: extIds.malId,
    searchTitles: [title, ...(fullItem.altTitles || [])],
  });

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
    maxPages: 10,
    verifySamplePages: true,
    hydrateSamplePages: true,
  });

  if (!chaptersRes.valid || chaptersRes.chapters.length === 0) {
    logProgress(currentIdx, totalTarget, title, 'ATLANDI: Çalışan bölüm sayfası doğrulanamadı.');
    return { status: 'skipped_empty' };
  }

  // Türler, format (manhwa/manga/manhua) ve +18 tespiti
  const { formatType, isAdult: comixAdult, genres } = mapComixGenresAndFormat(fullItem);
  const isAdult = Boolean(comixAdult || anilistMeta.isAdult);
  if (isAdult && !genres.includes('+18')) {
    genres.push('+18');
  }

  // Konu özetini temizle ve Türkçe'ye çevir
  const trDescription = await translateSynopsisToTurkish(fullItem.synopsis || '');

  const authorNames = (fullItem.authors || []).map((a) => a.title).filter(Boolean).join(', ') || 'Bilinmiyor';
  const artistNames = (fullItem.artists || []).map((a) => a.title).filter(Boolean).join(', ') || authorNames;

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
    ...anilistMeta.sourceLinks,
  ];

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
    description: trDescription || `${title} serisini ToonParrot üzerinden çoklu dil ve görsel çeviri desteğiyle okuyun.`,
    cover: coverUrl,
    banner: coverUrl,
    genres,
    status,
    type: formatType,
    is_public: true,
    isPublic: true,
    is_adult: isAdult,
    isAdult,
    views: 0, // Comix görüntülenme sayıları ASLA alınmaz
    release_year: fullItem.year ? Number(fullItem.year) : null,
    releaseYear: fullItem.year ? Number(fullItem.year) : null,
    source_links: sourceLinks,
    sourceLinks,
    details: {
      primarySource: 'comix',
      primarySourceUrl: `https://comix.to/title/${hid}-${slug}`,
      hid,
      availableLanguages: chaptersRes.languages,
      originalLanguage: fullItem.originalLanguage || '',
      storageTier: 'r2_only',
    },
    chapter_count: chaptersRes.chapters.length,
    chapterCount: chaptersRes.chapters.length,
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
    `R2'YE EKLENDİ [${formatType.toUpperCase()}${isAdult ? ' | +18' : ''}] -> ${chaptersRes.chapters.length} blm (${chaptersRes.languages.join(',').toUpperCase()}) | ${anilistMeta.characters.length} karakter | Views: 0`
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
  let currentPage = START_PAGE;
  let totalLastPage = null;
  let totalImported = 0;
  let totalSkipped = 0;
  let totalDuplicates = 0;
  let pagesProcessed = 0;

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
    try {
      pageRes = await fetchComixApi('/manga', {
        page: currentPage,
        limit: 20,
        [`order[${ORDER_BY}]`]: 'desc',
      });
    } catch (err) {
      console.warn(`[UYARI] Sayfa ${currentPage} çekilemedi: ${err.message}`);
      break;
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
    await syncShardsToR2(shardSummariesMap);

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
