#!/usr/bin/env node
/**
 * ToonParrot - Comix.to 80.000 Seri Tam Arşiv Hasat & Senkronizasyon Motoru
 *
 * Comix.to üzerindeki tüm kataloğu sayfa sayfa (100'er seri) tarar.
 * 0 bölümü olan veya çalışmayan serileri eler.
 * Kalan serilerin kapak, alternatif isim, tür, yaş derecelendirmesi (+18),
 * AniList/MAL eşleşmesi, Türkçe çeviri (GTX) ve en iyi çeviri grubu bölümlerini çeker.
 * Cloudflare R2 ve Supabase veritabanına otomatik aktarır.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import {
  fetchComixApi,
  extractComixHid,
  isAdultRating as isComixAdultRating,
  mapComixType,
} from './comix-crypto.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const cacheDir = path.join(projectRoot, '.cache');

if (!existsSync(cacheDir)) {
  try {
    mkdirSync(cacheDir, { recursive: true });
  } catch {}
}

const CHECKPOINT_PATH = path.join(cacheDir, 'r2-archive-checkpoint.json');
const HARVEST_STATE_PATH = path.join(cacheDir, 'comix-harvest-state.json');
const SERIES_CACHE_DIR = path.join(cacheDir, 'series');
if (!existsSync(SERIES_CACHE_DIR)) {
  try {
    mkdirSync(SERIES_CACHE_DIR, { recursive: true });
  } catch {}
}

// --- Load .env ---
const loadEnv = () => {
  const envPath = path.join(projectRoot, '.env');
  if (!existsSync(envPath)) return;
  try {
    const raw = readFileSync(envPath, 'utf8');
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx !== -1) {
        const k = trimmed.slice(0, eqIdx).trim();
        const v = trimmed.slice(eqIdx + 1).trim();
        if (!process.env[k]) process.env[k] = v;
      }
    }
  } catch {}
};
loadEnv();

const CATALOG_WORKER_URL = (process.env.VITE_CATALOG_WORKER_URL || process.env.CATALOG_WORKER_URL || '').replace(/\/+$/, '');
const CATALOG_ADMIN_TOKEN = process.env.CATALOG_ADMIN_TOKEN || '';
const SUPABASE_URL = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';

// --- CLI Args ---
const args = process.argv.slice(2);
const hasFlag = (f) => args.includes(f);
const getArgValue = (f, fallback = null) => {
  const i = args.indexOf(f);
  return i !== -1 && i + 1 < args.length ? args[i + 1] : fallback;
};

const START_PAGE = parseInt(getArgValue('--start-page', '1'), 10) || 1;
const MAX_PAGES = parseInt(getArgValue('--max-pages', '1000'), 10) || 1000;
const BATCH_SIZE = parseInt(getArgValue('--batch-size', '20'), 10) || 20;
const SERIES_PER_PAGE = 50;
const CHAPTER_CONCURRENCY = 8;
const IS_DRY_RUN = hasFlag('--dry-run');
const ORDER_BY = getArgValue('--order', 'follows_total'); // 'follows_total' (en popülerler önce) | 'updated_at' (günceller)

// Anti-hang safety timeout (120 minutes)
const timeoutTimer = setTimeout(() => {
  console.error('[FATAL] Maksimum çalışma süresi aşıldı, güvenli çıkış yapılıyor.');
  process.exit(1);
}, 120 * 60 * 1000);
if (typeof timeoutTimer.unref === 'function') timeoutTimer.unref();

// --- Live Terminal Progress ---
const formatTime = () => new Date().toTimeString().split(' ')[0];
const logProgress = (current, total, item, status) => {
  const totalNum = total === Infinity || total <= 0 ? 1 : total;
  const pct = total === Infinity ? '?' : ((current / totalNum) * 100).toFixed(1);
  const totalStr = total === Infinity ? '∞' : total;
  console.log(`[${formatTime()}] [${current}/${totalStr}] (${pct}%) - ${item}: ${status}`);
};

const logInfo = (msg) => console.log(`[${formatTime()}] [INFO] ${msg}`);
const logWarn = (msg) => console.warn(`[${formatTime()}] [WARN] ${msg}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const cleanSeriesTitle = (str) => {
  if (!str) return '';
  return str
    .replace(/[\(\[\{][^\)\]\}]*(?:türkçe|oku|webtoon|manga|raw|scan|color|colored|fansub)[^\)\]\}]*[\)\]\}]/gi, '')
    .replace(/\s*\|\s*.*$/g, '')
    .replace(/\s*-\s*Bölüm.*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
};

const slugify = (text) => {
  return String(text || '')
    .toLowerCase()
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ş/g, 's')
    .replace(/ı/g, 'i')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
};

// --- Google Translate GTX Fallback ---
const translateToTurkishGtx = async (text) => {
  if (!text || text.length < 3) return '';
  try {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=tr&dt=t&q=${encodeURIComponent(text.slice(0, 1800))}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
    if (res.ok) {
      const json = await res.json();
      const chunks = json?.[0] || [];
      const translated = chunks.map((c) => c?.[0] || '').join('').trim();
      if (translated && translated.length > 3) return translated;
    }
  } catch {}
  return text;
};

// --- Load / Save Harvest State ---
const loadHarvestState = () => {
  if (!existsSync(HARVEST_STATE_PATH)) {
    return { lastPage: START_PAGE - 1, processedHids: [] };
  }
  try {
    return JSON.parse(readFileSync(HARVEST_STATE_PATH, 'utf8'));
  } catch {
    return { lastPage: START_PAGE - 1, processedHids: [] };
  }
};

const saveHarvestState = (st) => {
  try {
    writeFileSync(HARVEST_STATE_PATH, JSON.stringify(st, null, 2), 'utf8');
  } catch {}
};

// --- Load / Save Main Checkpoint ---
const loadMainCheckpoint = () => {
  if (!existsSync(CHECKPOINT_PATH)) {
    return { mangas: {} };
  }
  try {
    return JSON.parse(readFileSync(CHECKPOINT_PATH, 'utf8'));
  } catch {
    return { mangas: {} };
  }
};

const saveMainCheckpoint = (state) => {
  try {
    state.lastUpdatedAt = new Date().toISOString();
    const tempPath = `${CHECKPOINT_PATH}.tmp`;
    const json = JSON.stringify(state);
    writeFileSync(tempPath, json, 'utf8');
    writeFileSync(CHECKPOINT_PATH, json, 'utf8');
  } catch (err) {
    logWarn(`Checkpoint kaydedilemedi: ${err.message}`);
  }
};

// --- R2 Upload Individual Series ---
const uploadSeriesToR2 = async (manga) => {
  if (!CATALOG_WORKER_URL || !CATALOG_ADMIN_TOKEN || !manga?.slug || IS_DRY_RUN) return;
  try {
    const sPath = path.join(SERIES_CACHE_DIR, `${manga.slug}.json`);
    writeFileSync(sPath, JSON.stringify(manga, null, 2), 'utf8');

    await fetch(`${CATALOG_WORKER_URL}/v1/admin/series/${encodeURIComponent(manga.slug)}?onlySeries=1&raw=1`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'X-Catalog-Admin-Token': CATALOG_ADMIN_TOKEN,
      },
      body: JSON.stringify(manga),
      signal: AbortSignal.timeout(30000),
    });
  } catch (err) {
    logWarn(`R2 seri yükleme uyarısı (${manga.slug}): ${err.message}`);
  }
};

// --- R2 & Supabase Batch Sync ---
const syncBatchToR2AndSupabase = async (state, touchedMangas) => {
  if (IS_DRY_RUN || touchedMangas.length === 0) return;
  logInfo(`${touchedMangas.length} yeni/güncellenmiş seri R2 ve Supabase'e senkronize ediliyor...`);

  // 1. R2 Snapshot
  if (CATALOG_WORKER_URL && CATALOG_ADMIN_TOKEN) {
    try {
      const mangasArray = Object.values(state.mangas || {});
      const snapshotPayload = {
        version: 1,
        updatedAt: new Date().toISOString(),
        mangas: mangasArray.map((m) => {
          const { chapters, ...rest } = m;
          const chList = Array.isArray(chapters) ? chapters : [];
          return {
            ...rest,
            chapterCount: chList.length,
            chapters: chList.map((c) => ({
              id: c.id,
              mangaId: m.id,
              chapterNumber: c.chapterNumber ?? c.number,
              number: c.chapterNumber ?? c.number,
              title: c.title,
              language: c.language || 'en',
              groupName: c.groupName || '',
              releaseDate: c.releaseDate || c.release_date,
              pages: [],
            })),
          };
        }),
      };

      await fetch(`${CATALOG_WORKER_URL}/v1/admin/catalog/snapshot?raw=1`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-Catalog-Admin-Token': CATALOG_ADMIN_TOKEN,
        },
        body: JSON.stringify(snapshotPayload),
        signal: AbortSignal.timeout(45000),
      });
    } catch (err) {
      logWarn(`R2 snapshot güncelleme uyarısı: ${err.message}`);
    }
  }

  // 2. Supabase Mirror
  if (SUPABASE_URL && SUPABASE_ANON_KEY && CATALOG_ADMIN_TOKEN) {
    try {
      const payloadChunk = {
        mangas: touchedMangas.map((m) => {
          const { chapters, ...rest } = m;
          return {
            ...rest,
            chapter_count: (chapters || []).length,
          };
        }),
      };

      const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/sync_r2_catalog_to_supabase`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({
          p_admin_token: CATALOG_ADMIN_TOKEN,
          p_payload: payloadChunk,
        }),
        signal: AbortSignal.timeout(60000),
      });

      if (!res.ok) {
        const txt = await res.text().catch(() => '');
        logWarn(`Supabase sync uyarısı: HTTP ${res.status}: ${txt.slice(0, 200)}`);
      } else {
        logInfo(`Supabase ikiz tablosu (${touchedMangas.length} seri) güncellendi.`);
      }
    } catch (err) {
      logWarn(`Supabase senkronizasyon hatası: ${err.message}`);
    }
  }
};

// --- Main Harvester ---
async function harvest() {
  console.log('============================================================================');
  console.log('   TOONPARROT - COMIX.TO 80.000 SERİ TAM ARŞİV HASAT & AKTARIM MOTORU       ');
  console.log('============================================================================');

  const mainState = loadMainCheckpoint();
  if (!mainState.mangas) mainState.mangas = {};
  const harvestState = loadHarvestState();
  const processedHids = new Set(harvestState.processedHids || []);

  const startPage = Math.max(START_PAGE, (harvestState.lastPage || 0) + 1);
  const endPage = startPage + MAX_PAGES - 1;

  logInfo(`Hasat Başlıyor: Sayfa ${startPage} -> ${endPage} | Sıralama: ${ORDER_BY}`);
  logInfo(`Mevcut Arşivdeki Seri: ${Object.keys(mainState.mangas).length} | Daha Önce İşlenen Comix HID: ${processedHids.size}`);

  const touchedMangas = [];
  let totalImported = 0;
  let totalSkippedEmpty = 0;

  for (let page = startPage; page <= endPage; page++) {
    logInfo(`Sayfa ${page} taranıyor...`);
    let res = null;
    try {
      res = await fetchComixApi('/manga', {
        page,
        limit: SERIES_PER_PAGE,
        [`order[${ORDER_BY}]`]: 'desc',
      });
    } catch (err) {
      logWarn(`Sayfa ${page} çekilemedi: ${err.message}`);
      await sleep(2000);
      continue;
    }

    const items = res?.items || (Array.isArray(res) ? res : []);
    if (!items || items.length === 0) {
      logInfo(`Sayfa ${page} boş, arşiv sonuna ulaşıldı.`);
      break;
    }

    logInfo(`Sayfa ${page}: ${items.length} seri bulundu. Bölümler ve metadata inceleniyor...`);

    for (const item of items) {
      const hid = item.hid || String(item.id);
      if (processedHids.has(hid)) continue;
      processedHids.add(hid);

      // KURAL: Çalışan bölümü yoksa ekleme, ele!
      if (item.hasChapters === false) {
        totalSkippedEmpty++;
        continue;
      }

      const rawTitle = item.title || '';
      const cleanTitle = cleanSeriesTitle(rawTitle);
      const isAdult = isComixAdultRating(item.contentRating);
      const formatType = mapComixType(item.type);
      const cover = item.poster?.large || item.poster?.medium || '';

      // Bölüm listesini çek
      let chRes = null;
      try {
        chRes = await fetchComixApi(`/manga/${hid}/chapters`, {
          limit: 100,
          page: 1,
          'order[number]': 'asc',
        });
      } catch (err) {
        logWarn(`[Bölüm Hatası] ${hid} ${cleanTitle}: ${err.message}`);
      }

      const chItems = chRes?.items || (Array.isArray(chRes) ? chRes : []);

      // KURAL: Gerçekte 0 bölümü varsa ele!
      if (!chItems || chItems.length === 0) {
        totalSkippedEmpty++;
        logProgress(processedHids.size, 80000, cleanTitle, '0 bölüm olduğu için elendi.');
        continue;
      }

      // En iyi çeviri gruplarını seç
      const chapterMap = new Map();
      for (const ch of chItems) {
        const num = Number(ch.number ?? 0);
        const lang = (ch.language || 'en').toLowerCase();
        const key = `${num}_${lang}`;
        const votes = Number(ch.votes || 0);

        if (!chapterMap.has(key) || chapterMap.get(key).votes < votes) {
          chapterMap.set(key, {
            id: ch.id,
            number: num,
            language: lang,
            groupName: ch.group?.name || '',
            votes,
          });
        }
      }

      const chaptersToIngest = Array.from(chapterMap.values())
        .sort((a, b) => a.number - b.number)
        .slice(0, 100);

      // İlk birkaç bölümün sayfalarını çek (veya ihtiyaç halinde tamamını)
      logProgress(processedHids.size, 80000, cleanTitle, `${chaptersToIngest.length} bölümün sayfaları indiriliyor...`);

      const finalChapters = [];
      for (let cIdx = 0; cIdx < chaptersToIngest.length; cIdx += CHAPTER_CONCURRENCY) {
        const chBatch = chaptersToIngest.slice(cIdx, cIdx + CHAPTER_CONCURRENCY);
        const results = await Promise.all(
          chBatch.map(async (chItem) => {
            try {
              const chData = await fetchComixApi(`/chapters/${chItem.id}`);
              const pageItems = chData?.pages?.items || [];
              const imgUrls = pageItems.map((p) => p.url).filter(Boolean);
              return { ...chItem, pages: imgUrls };
            } catch (err) {
              return { ...chItem, pages: [] };
            }
          })
        );

        for (const r of results) {
          if (r.pages && r.pages.length > 0) {
            finalChapters.push({
              id: randomUUID(),
              chapterNumber: r.number,
              number: r.number,
              title: r.number === 0 ? `Bölüm 0 [${r.language.toUpperCase()}]` : `Bölüm ${r.number} [${r.language.toUpperCase()}]`,
              language: r.language,
              groupName: r.groupName || '',
              pages: r.pages,
              releaseDate: new Date().toISOString(),
              views: 0,
              _sourceLink: `https://comix.to/chapter/${r.id}`,
            });
          }
        }
        await sleep(150);
      }

      if (finalChapters.length === 0) {
        totalSkippedEmpty++;
        logProgress(processedHids.size, 80000, cleanTitle, 'Çalışan görsel sayfası bulunamadığı için elendi.');
        continue;
      }

      // Açıklamayı Türkçe'ye çevir (GTX)
      let description = item.synopsis || '';
      if (description && description.length > 10) {
        description = await translateToTurkishGtx(description);
      }

      // Türler
      const genres = Array.isArray(item.genres)
        ? item.genres.map((g) => (typeof g === 'object' ? g.name : g)).filter(Boolean)
        : [];
      if (genres.length === 0) genres.push(formatType === 'manga' ? 'Manga' : 'Webtoon', 'Aksiyon');

      const mangaSlug = `${slugify(cleanTitle)}-${hid}`;
      const mangaId = randomUUID();
      const now = new Date().toISOString();

      const newManga = {
        id: mangaId,
        title: cleanTitle,
        slug: mangaSlug,
        cover,
        banner: cover,
        description,
        alternativeTitles: Array.isArray(item.altTitles) ? item.altTitles : [],
        author: 'Bilinmiyor',
        artist: 'Bilinmiyor',
        status: item.status === 'finished' ? 'completed' : 'ongoing',
        genres,
        isAdult,
        mangaType: formatType,
        rating: Number(item.ratedAvg || 0),
        views: Number(item.followsTotal || 0),
        chapterCount: finalChapters.length,
        chapters: finalChapters,
        sourceLinks: [
          { source: 'comix', url: `https://comix.to/comic/${hid}` },
          ...(item.links?.al ? [{ source: 'anilist', url: item.links.al }] : []),
          ...(item.links?.mal ? [{ source: 'myanimelist', url: item.links.mal }] : []),
          ...(item.links?.md ? [{ source: 'mangadex', url: item.links.md }] : []),
        ],
        details: {
          primarySource: 'comix',
          primarySourceUrl: `https://comix.to/comic/${hid}`,
          language: 'en',
          hid,
          lastChapterAddedAt: now,
          lastDeltaCheckAt: now,
        },
        createdAt: now,
        updatedAt: now,
      };

      mainState.mangas[mangaId] = newManga;
      touchedMangas.push(newManga);
      totalImported++;

      // R2 serisini yükle
      await uploadSeriesToR2(newManga);

      // Bellek tasarrufu için checkpoint'te pages arrayini boşalt
      for (const ch of newManga.chapters) {
        delete ch.pages;
      }

      logProgress(
        processedHids.size,
        80000,
        cleanTitle,
        `EKLENDİ: +${finalChapters.length} bölüm [${formatType.toUpperCase()}] (Katalog: ${Object.keys(mainState.mangas).length})`
      );

      // Periyodik checkpoint & senkronizasyon
      if (touchedMangas.length >= BATCH_SIZE) {
        saveMainCheckpoint(mainState);
        harvestState.lastPage = page;
        harvestState.processedHids = Array.from(processedHids);
        saveHarvestState(harvestState);
        await syncBatchToR2AndSupabase(mainState, touchedMangas);
        touchedMangas.length = 0;
      }

      await sleep(300);
    }

    harvestState.lastPage = page;
    harvestState.processedHids = Array.from(processedHids);
    saveHarvestState(harvestState);
    saveMainCheckpoint(mainState);
    await sleep(600);
  }

  if (touchedMangas.length > 0) {
    saveMainCheckpoint(mainState);
    await syncBatchToR2AndSupabase(mainState, touchedMangas);
  }

  console.log('============================================================================');
  logInfo(`Hasat Döngüsü Tamamlandı!`);
  logInfo(`Eklenen Seri         : ${totalImported}`);
  logInfo(`Elenen Boş/Ölü Seri  : ${totalSkippedEmpty}`);
  logInfo(`Toplam Arşiv Sayısı  : ${Object.keys(mainState.mangas).length}`);
  console.log('============================================================================');

  process.exit(0);
}

harvest().catch((err) => {
  console.error('[FATAL] Hasat motoru hatası:', err);
  process.exit(1);
});
