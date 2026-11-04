#!/usr/bin/env node
/**
 * ToonParrot - Comix.to Yabancı / İngilizce Bölüm Senkronizasyon & Arşiv Motoru
 *
 * Sitede / veritabanında Türkçe bölümleri bulunan tüm serileri Comix.to üzerinde
 * eşleştirir, eksik İngilizce bölümleri ve sayfalarını çeker, Cloudflare R2 ve Supabase
 * veritabanına çift dilli (TR + EN) olarak senkronize eder.
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

const RAW_LIMIT = getArgValue('--limit');
const LIMIT = RAW_LIMIT ? parseInt(RAW_LIMIT, 10) : Infinity;
const BATCH_SIZE = parseInt(getArgValue('--batch-size', '20'), 10) || 20;
const SERIES_CONCURRENCY = parseInt(getArgValue('--concurrency', '3'), 10) || 3;
const CHAPTER_CONCURRENCY = parseInt(getArgValue('--chapter-concurrency', '8'), 10) || 8;
const IS_DRY_RUN = hasFlag('--dry-run');
const IS_FORCE = hasFlag('--force');
const SKIP_SUPABASE = hasFlag('--skip-supabase');
const MAX_CHAPTERS_PER_SERIES = parseInt(getArgValue('--max-chapters', '150'), 10) || 150;

// Anti-hang safety timeout (60 minutes default)
const timeoutTimer = setTimeout(() => {
  console.error('[FATAL] Maksimum çalışma süresi aşıldı, güvenli çıkış yapılıyor.');
  process.exit(1);
}, 60 * 60 * 1000);
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

const normalizeForMatch = (str) => {
  if (!str) return '';
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .trim();
};

const isTitleMatch = (mangaTitles, itemTitles) => {
  const normSources = mangaTitles.map(normalizeForMatch).filter(Boolean);
  const normTargets = itemTitles.map(normalizeForMatch).filter(Boolean);

  for (const s of normSources) {
    for (const t of normTargets) {
      if (s === t) return true;
      if (s.length >= 6 && t.length >= 6) {
        if (s.includes(t) || t.includes(s)) {
          const minLen = Math.min(s.length, t.length);
          const maxLen = Math.max(s.length, t.length);
          if (minLen / maxLen >= 0.88) return true;
        }
      }
    }
  }
  return false;
};

// --- Checkpoint Storage ---
const loadCheckpoint = () => {
  if (!existsSync(CHECKPOINT_PATH)) {
    return { mangas: {} };
  }
  try {
    const raw = readFileSync(CHECKPOINT_PATH, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    logWarn(`Checkpoint okunamadı: ${err.message}`);
    return { mangas: {} };
  }
};

const saveCheckpoint = (state) => {
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
  logInfo(`${touchedMangas.length} güncellenmiş seri R2 ve Supabase'e senkronize ediliyor...`);

  // 1. R2 Snapshot update
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
              language: c.language || 'tr',
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
  if (!SKIP_SUPABASE && SUPABASE_URL && SUPABASE_ANON_KEY && CATALOG_ADMIN_TOKEN) {
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
        logInfo(`Supabase ikiz tablosu (${touchedMangas.length} seri) başarıyla güncellendi.`);
      }
    } catch (err) {
      logWarn(`Supabase senkronizasyon hatası: ${err.message}`);
    }
  }
};

// --- Hydrate full chapters for single series from local cache or R2 ---
const ensureFullChapters = async (manga) => {
  if (!manga || !manga.slug) return;
  const sPath = path.join(SERIES_CACHE_DIR, `${manga.slug}.json`);
  if (existsSync(sPath)) {
    try {
      const full = JSON.parse(readFileSync(sPath, 'utf8'));
      if (Array.isArray(full.chapters) && full.chapters.length > 0) {
        manga.chapters = full.chapters;
        return;
      }
    } catch {}
  }

  if (CATALOG_WORKER_URL) {
    try {
      const res = await fetch(`${CATALOG_WORKER_URL}/v1/catalog/series/${encodeURIComponent(manga.slug)}`, {
        signal: AbortSignal.timeout(10000),
      });
      if (res.ok) {
        const full = await res.json();
        if (Array.isArray(full.chapters) && full.chapters.length > 0) {
          manga.chapters = full.chapters;
        }
      }
    } catch {}
  }
};

// --- Main Engine ---
async function run() {
  console.log('============================================================================');
  console.log('   TOONPARROT - COMIX.TO ÇİFT DİL (TR + EN) ARŞİV SENKRONİZASYON MOTORU     ');
  console.log('============================================================================');

  const state = loadCheckpoint();
  const allMangas = Object.values(state.mangas || {});
  logInfo(`Katalogda toplam ${allMangas.length} seri yüklendi.`);

  // Filtre: Sitede Türkçe bölümü olan serileri tespit et
  const candidateMangas = allMangas.filter((m) => {
    const chs = Array.isArray(m.chapters) ? m.chapters : [];
    if (chs.length === 0) return false;
    const hasTr = chs.some((c) => {
      const l = (c.language || ((c.title || '').includes('[EN]') ? 'en' : 'tr')).toLowerCase();
      return l === 'tr';
    });
    if (!hasTr) return false;

    if (IS_FORCE) return true;

    // Halihazırda EN bölümleri varsa atla
    const hasEn = chs.some((c) => {
      const l = (c.language || ((c.title || '').includes('[EN]') ? 'en' : 'tr')).toLowerCase();
      return l === 'en';
    });
    return !hasEn;
  });

  const totalToProcess = Math.min(candidateMangas.length, LIMIT);
  logInfo(`Senkronize edilecek Türkçe seri sayısı: ${totalToProcess} (Toplam aday: ${candidateMangas.length})`);

  if (totalToProcess === 0) {
    logInfo('Eşleştirilecek yeni seri bulunamadı (tüm Türkçe seriler zaten İngilizce bölümlere sahip veya limit 0).');
    process.exit(0);
  }

  const touchedMangas = [];
  let processedCount = 0;
  let matchedCount = 0;
  let totalNewChapters = 0;

  for (let idx = 0; idx < totalToProcess; idx += SERIES_CONCURRENCY) {
    const chunk = candidateMangas.slice(idx, idx + SERIES_CONCURRENCY);

    await Promise.all(
      chunk.map(async (manga) => {
        processedCount++;
        const pIdx = processedCount;
        const rawTitle = manga.title || '';
        const cleanTitle = cleanSeriesTitle(rawTitle);

        // 1. Comix API'de arama yap
        let comixMatch = null;
        const searchQueries = [cleanTitle];
        if (Array.isArray(manga.alternativeTitles)) {
          for (const alt of manga.alternativeTitles.slice(0, 3)) {
            const cleanAlt = cleanSeriesTitle(alt);
            if (cleanAlt && !searchQueries.includes(cleanAlt)) searchQueries.push(cleanAlt);
          }
        }

        for (const q of searchQueries) {
          if (!q || q.length < 2) continue;
          try {
            const searchRes = await fetchComixApi('/manga', { keyword: q, limit: 5 });
            const items = searchRes?.items || (Array.isArray(searchRes) ? searchRes : []);
            const mangaTitles = [cleanTitle, ...(manga.alternativeTitles || []).map(cleanSeriesTitle)];
            for (const item of items) {
              const itemTitles = [cleanSeriesTitle(item.title), ...(item.altTitles || []).map(cleanSeriesTitle)];
              if (isTitleMatch(mangaTitles, itemTitles)) {
                comixMatch = item;
                break;
              }
            }
          } catch (err) {
            logWarn(`[Comix Arama] ${q} arama hatası: ${err.message}`);
          }
          if (comixMatch) break;
          await sleep(250);
        }

        if (!comixMatch) {
          logProgress(pIdx, totalToProcess, cleanTitle, 'Comix üzerinde eşleşen seri bulunamadı.');
          return;
        }

        const hid = comixMatch.hid || String(comixMatch.id);
        logProgress(pIdx, totalToProcess, cleanTitle, `Eşleşti -> [${hid}] ${comixMatch.title}. İngilizce bölümler çekiliyor...`);

        // 2. Comix bölümlerini çek
        let chRes = null;
        try {
          chRes = await fetchComixApi(`/manga/${hid}/chapters`, {
            limit: 100,
            page: 1,
            'order[number]': 'asc',
          });
        } catch (err) {
          logWarn(`[Comix Bölümler] ${hid} çekilemedi: ${err.message}`);
          return;
        }

        const items = chRes?.items || (Array.isArray(chRes) ? chRes : []);
        if (!items || items.length === 0) {
          logProgress(pIdx, totalToProcess, cleanTitle, 'Comix serisinde çalışan bölüm bulunamadı.');
          return;
        }

        // Mevcut tam bölümleri yükle
        await ensureFullChapters(manga);
        if (!Array.isArray(manga.chapters)) manga.chapters = [];

        const existingEnNums = new Set(
          manga.chapters
            .filter((c) => {
              const l = (c.language || ((c.title || '').includes('[EN]') ? 'en' : 'tr')).toLowerCase();
              return l === 'en';
            })
            .map((c) => Number(c.chapterNumber ?? c.number ?? 0))
        );

        // En iyi çeviri grubunu seç
        const bestChapters = new Map();
        for (const item of items) {
          const chLang = (item.language || 'en').toLowerCase();
          if (chLang !== 'en') continue;
          const chNum = Number(item.number ?? 0);
          if (existingEnNums.has(chNum)) continue;

          const votes = Number(item.votes || 0);
          if (!bestChapters.has(chNum) || bestChapters.get(chNum).votes < votes) {
            bestChapters.set(chNum, {
              id: item.id,
              number: chNum,
              groupName: item.group?.name || '',
              votes,
            });
          }
        }

        const chaptersToFetch = Array.from(bestChapters.values())
          .sort((a, b) => a.number - b.number)
          .slice(0, MAX_CHAPTERS_PER_SERIES);

        if (chaptersToFetch.length === 0) {
          logProgress(pIdx, totalToProcess, cleanTitle, 'Eklenecek yeni İngilizce bölüm yok.');
          return;
        }

        logProgress(pIdx, totalToProcess, cleanTitle, `${chaptersToFetch.length} İngilizce bölümün sayfaları indiriliyor...`);

        // 3. Bölüm sayfalarını paralel çek
        let addedInSeries = 0;
        for (let cIdx = 0; cIdx < chaptersToFetch.length; cIdx += CHAPTER_CONCURRENCY) {
          const chBatch = chaptersToFetch.slice(cIdx, cIdx + CHAPTER_CONCURRENCY);
          const results = await Promise.all(
            chBatch.map(async (chItem) => {
              try {
                const chData = await fetchComixApi(`/chapters/${chItem.id}`);
                const pageItems = chData?.pages?.items || [];
                const imgUrls = pageItems.map((p) => p.url).filter(Boolean);
                return { ...chItem, pages: imgUrls };
              } catch (err) {
                logWarn(`[Comix Sayfa] Ch ${chItem.number} (${chItem.id}) hatası: ${err.message}`);
                return { ...chItem, pages: [] };
              }
            })
          );

          for (const r of results) {
            if (r.pages && r.pages.length > 0) {
              const chTitle = r.number === 0 ? 'Bölüm 0 [EN]' : `Bölüm ${r.number} [EN]`;
              const chapterObj = {
                id: randomUUID(),
                mangaId: manga.id,
                chapterNumber: r.number,
                number: r.number,
                title: chTitle,
                language: 'en',
                groupName: r.groupName || '',
                pages: r.pages,
                releaseDate: new Date().toISOString(),
                views: 0,
                _sourceLink: `https://comix.to/chapter/${r.id}`,
              };
              manga.chapters.push(chapterObj);
              addedInSeries++;
            }
          }
          await sleep(200);
        }

        if (addedInSeries > 0) {
          manga.chapters.sort((a, b) => {
            const diff = Number(a.chapterNumber ?? a.number) - Number(b.chapterNumber ?? b.number);
            if (diff !== 0) return diff;
            return (a.language || 'tr').localeCompare(b.language || 'tr');
          });
          manga.chapterCount = manga.chapters.length;
          manga.updatedAt = new Date().toISOString();

          matchedCount++;
          totalNewChapters += addedInSeries;
          touchedMangas.push(manga);

          // R2 serisini güncelle
          await uploadSeriesToR2(manga);

          // Bellek tasarrufu için sayfaları checkpoint'te boşalt
          for (const ch of manga.chapters) {
            delete ch.pages;
          }

          logProgress(
            pIdx,
            totalToProcess,
            cleanTitle,
            `BAŞARILI: +${addedInSeries} İngilizce bölüm eklendi (Toplam bölüm: ${manga.chapterCount})`
          );
        }
      })
    );

    // Periyodik checkpoint ve R2/Supabase batch senkronizasyonu
    if (touchedMangas.length >= BATCH_SIZE) {
      saveCheckpoint(state);
      await syncBatchToR2AndSupabase(state, touchedMangas);
      touchedMangas.length = 0;
    }

    await sleep(400);
  }

  // Kalan serileri senkronize et
  if (touchedMangas.length > 0) {
    saveCheckpoint(state);
    await syncBatchToR2AndSupabase(state, touchedMangas);
  }

  console.log('============================================================================');
  logInfo(`Senkronizasyon Tamamlandı!`);
  logInfo(`İşlenen Seri      : ${processedCount}`);
  logInfo(`Eşleşen Seri      : ${matchedCount}`);
  logInfo(`Eklenen EN Bölüm  : ${totalNewChapters}`);
  console.log('============================================================================');

  process.exit(0);
}

run().catch((err) => {
  console.error('[FATAL] Script yürütme hatası:', err);
  process.exit(1);
});
