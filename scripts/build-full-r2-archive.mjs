#!/usr/bin/env node
/**
 * toonparrot - Full R2 Archive Harvester & Browser Bridge Engine
 *
 * 1. Multi-source scraping:
 *    - WebtoonHattı (primary + +18 categories)
 *    - SiyahMelek.my (+18, unlocked chapters only)
 *    - HattoriManga.net (+18)
 *    - GölgeBahçesi, DxDFansub, MangaCix, OkuToon
 * 2. 2-Stage Persistent Queue:
 *    - Stage 1: Fast multi-threaded discovery into seriesQueue
 *    - Stage 2: High-speed parallel chapter ingestion & instant checkpoint/R2 sync
 * 3. Worker 100k quota guard + direct HTTP priority
 * 4. Multi-stage deduplication: title key + alternative titles + anilistId + malId cross-matching
 * 5. Domain-cached live verification: 20x faster page ingestion, zero broken chapters
 * 6. Rich metadata: AniList (GraphQL) + MangaDex (+18) + MyAnimeList (Jikan) + Google Translate GTX
 * 7. Direct R2 upload via toonparrot-catalog-worker with snake_case tables & full snapshot
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

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
const EXPORT_DUMP_PATH = path.join(cacheDir, 'r2-full-archive-export.json');
const SERIES_CACHE_DIR = path.join(cacheDir, 'series');
if (!existsSync(SERIES_CACHE_DIR)) {
  try {
    mkdirSync(SERIES_CACHE_DIR, { recursive: true });
  } catch {}
}

// --- Load .env into process.env ---
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

// --- Service Endpoints & Config ---
const CATALOG_WORKER_URL = (process.env.VITE_CATALOG_WORKER_URL || '').replace(/\/+$/, '');
const SCRAPER_PROXY_URLS = (process.env.VITE_SCRAPER_PROXY_URL || '')
  .split(',')
  .map((u) => u.trim().replace(/\/+$/, ''))
  .filter(Boolean);
const LOCAL_SCRAPER_URL = 'http://127.0.0.1:41113/fetch';
const CATALOG_ADMIN_TOKEN = process.env.CATALOG_ADMIN_TOKEN || '';

const ANILIST_API_URL = 'https://graphql.anilist.co';
const MANGADEX_API_URL = 'https://api.mangadex.org';
const JIKAN_API_URL = 'https://api.jikan.moe/v4/manga';

const DEFAULT_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36';

// --- CLI Arguments ---
const args = process.argv.slice(2);
const hasFlag = (flag) => args.includes(flag);
const getArgValue = (flag) => {
  const idx = args.indexOf(flag);
  return idx !== -1 && idx + 1 < args.length ? args[idx + 1] : null;
};

const IS_FULL = hasFlag('--full');
const IS_RESUME = hasFlag('--resume');
const IS_DRY_RUN = hasFlag('--dry-run');
const SKIP_IMAGES = hasFlag('--skip-images');
const RAW_LIMIT = getArgValue('--limit');
const LIMIT = RAW_LIMIT ? parseInt(RAW_LIMIT, 10) : (IS_FULL ? Infinity : Infinity);
const TARGET_SOURCE = getArgValue('--source'); // webtoonhatti, siyahmelek, hattorimanga, golgebahcesi, dxdfansub, mangacix, okutoon

// --- Concurrency Settings ---
const SERIES_CONCURRENCY = 3;
const CHAPTER_CONCURRENCY = 6;

// --- Live Terminal Progress Logger ---
const formatTime = () => {
  const d = new Date();
  return d.toTimeString().split(' ')[0];
};

const logProgress = (current, total, item, status) => {
  const totalNum = total === Infinity || total <= 0 ? 1 : total;
  const pct = total === Infinity ? '?' : ((current / totalNum) * 100).toFixed(1);
  const totalStr = total === Infinity ? '∞' : total;
  console.log(`[${formatTime()}] [${current}/${totalStr}] (${pct}%) - ${item}: ${status}`);
};

const logInfo = (message) => {
  console.log(`[${formatTime()}] [INFO] ${message}`);
};

const logWarn = (message) => {
  console.warn(`[${formatTime()}] [WARN] ${message}`);
};

const logError = (message) => {
  console.error(`[${formatTime()}] [ERROR] ${message}`);
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// --- Google Translate GTX Fallback ---
const translateTitleToEnglish = async (text) => {
  if (!text || text.length < 2) return '';
  try {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=tr&tl=en&dt=t&q=${encodeURIComponent(text)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(3500) });
    if (res.ok) {
      const json = await res.json();
      const translated = json?.[0]?.[0]?.[0];
      if (translated && typeof translated === 'string' && translated.trim().length > 2) {
        return translated.trim();
      }
    }
  } catch {}
  return '';
};

// --- Checkpoint Storage (Persistent Queue Destekli) ---
const loadCheckpoint = () => {
  if (!existsSync(CHECKPOINT_PATH)) {
    return {
      version: 2,
      lastUpdatedAt: null,
      seriesQueue: {}, // url -> { title, source, link, cover, isAdult, genres, status: 'pending'|'completed'|'failed', totalChaptersFound, completedChaptersCount, updatedAt }
      processedUrls: [],
      mangas: {},
      characters: {},
      authors: {},
      artists: {},
      tags: {},
      mangaCharacters: [],
      mangaAuthors: [],
      mangaArtists: [],
      mangaTags: [],
    };
  }

  try {
    const raw = readFileSync(CHECKPOINT_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed.seriesQueue) parsed.seriesQueue = {};
    if (parsed.mangas && typeof parsed.mangas === 'object') {
      let needsPrune = false;
      for (const [id, m] of Object.entries(parsed.mangas)) {
        if (isBLSeries(m)) {
          delete parsed.mangas[id];
          continue;
        }
        const hasPages = Array.isArray(m.chapters) && m.chapters.some((ch) => Array.isArray(ch.pages) && ch.pages.length > 0);
        if (hasPages && m.slug) {
          needsPrune = true;
          const sPath = path.join(SERIES_CACHE_DIR, `${m.slug}.json`);
          if (!existsSync(sPath)) {
            try { writeFileSync(sPath, JSON.stringify(m, null, 2), 'utf8'); } catch {}
          }
          for (const ch of m.chapters) {
            ch.pages = [];
          }
        }
      }
      if (needsPrune) {
        saveCheckpoint(parsed);
      }
    }
    if (parsed.seriesQueue && typeof parsed.seriesQueue === 'object') {
      for (const [link, item] of Object.entries(parsed.seriesQueue)) {
        if (isBLSeries(item)) delete parsed.seriesQueue[link];
      }
    }
    return parsed;
  } catch (err) {
    logWarn(`Checkpoint dosyası okunamadı: ${err.message}`);
    return {
      version: 2,
      lastUpdatedAt: null,
      seriesQueue: {},
      processedUrls: [],
      mangas: {},
      characters: {},
      authors: {},
      artists: {},
      tags: {},
      mangaCharacters: [],
      mangaAuthors: [],
      mangaArtists: [],
      mangaTags: [],
    };
  }
};

const PID_FILE = path.join(cacheDir, 'archive-harvester.pid');
const acquirePidLock = () => {
  if (existsSync(PID_FILE)) {
    try {
      const existingPid = parseInt(readFileSync(PID_FILE, 'utf8').trim(), 10);
      if (existingPid && existingPid !== process.pid) {
        try {
          process.kill(existingPid, 0);
          logWarn(`Motor zaten arka planda aktif çalışıyor (PID: ${existingPid}). İkinci bir süreç başlatılamaz.`);
          process.exit(0);
        } catch {}
      }
    } catch {}
  }
  writeFileSync(PID_FILE, String(process.pid), 'utf8');
};

const releasePidLock = () => {
  try {
    if (existsSync(PID_FILE)) {
      const stored = parseInt(readFileSync(PID_FILE, 'utf8').trim(), 10);
      if (stored === process.pid) unlinkSync(PID_FILE);
    }
  } catch {}
};

process.on('exit', releasePidLock);
process.on('SIGINT', () => { releasePidLock(); process.exit(0); });
process.on('SIGTERM', () => { releasePidLock(); process.exit(0); });

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

let totalWorkerRequests = 0;
let currentWorkerPoolIndex = 0;
const workerQuotaUsage = new Map();
const MAX_REQUESTS_PER_WORKER = 85000;
const MAX_WORKER_REQUESTS = (SCRAPER_PROXY_URLS.length || 1) * MAX_REQUESTS_PER_WORKER;

const getNextHealthyWorker = () => {
  if (SCRAPER_PROXY_URLS.length === 0) return null;
  for (let attempt = 0; attempt < SCRAPER_PROXY_URLS.length; attempt++) {
    const idx = (currentWorkerPoolIndex + attempt) % SCRAPER_PROXY_URLS.length;
    const url = SCRAPER_PROXY_URLS[idx];
    const used = workerQuotaUsage.get(url) || 0;
    if (used < MAX_REQUESTS_PER_WORKER) {
      currentWorkerPoolIndex = idx;
      return url;
    }
  }
  return null;
};

// --- Multi-Tier Network Fetcher (Doğrudan HTTP Öncelikli, Worker Kotası Tasarruflu) ---
const fetchUpstream = async (targetUrl, options = {}) => {
  const method = options.method || 'GET';
  const customHeaders = options.headers || {};
  const body = options.body;
  const timeoutMs = options.timeoutMs || 10000;

  const baseHeaders = {
    'User-Agent': DEFAULT_USER_AGENT,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7',
    'Cache-Control': 'no-cache',
    ...customHeaders,
  };

  let domain = '';
  try {
    domain = new URL(targetUrl).hostname;
  } catch {
    return { ok: false, status: 0, content: '', url: targetUrl };
  }

  const isDirectCapable = domain.includes('siyahmelek') ||
    domain.includes('golgebahcesi') ||
    domain.includes('dxdfansub') ||
    domain.includes('mangacix') ||
    domain.includes('okutoon') ||
    domain.includes('hattorimanga') ||
    domain.includes('jikan.moe') ||
    domain.includes('anilist.co') ||
    domain.includes('mangaupdates');

  // Tier 1: Doğrudan HTTP fetch (Worker kotasını korumak için doğrudan çalışan sitelerde ilk tercih)
  if (isDirectCapable) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      const directRes = await fetch(targetUrl, {
        method,
        headers: baseHeaders,
        body: body ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
        signal: controller.signal,
        redirect: 'follow',
      });
      clearTimeout(timer);

      const text = await directRes.text();
      const isBlocked = directRes.status === 403 || directRes.status === 503 ||
        text.includes('Just a moment...') || text.includes('cf-mitigated') || text.includes('challenges.cloudflare.com');

      if (directRes.ok && !isBlocked && text.length > 50) {
        return { ok: true, status: directRes.status, content: text, url: directRes.url };
      }
    } catch {}
  }

  // Tier 2: Cloudflare Scraper Proxy Worker (Edge IP bypass with 5-Worker Pool & Failover)
  const activeWorkerUrl = getNextHealthyWorker();
  if (activeWorkerUrl && totalWorkerRequests < MAX_WORKER_REQUESTS) {
    totalWorkerRequests++;
    const currentCount = (workerQuotaUsage.get(activeWorkerUrl) || 0) + 1;
    workerQuotaUsage.set(activeWorkerUrl, currentCount);

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      const proxyRes = await fetch(activeWorkerUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: targetUrl,
          method,
          headers: baseHeaders,
          body,
        }),
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (proxyRes.status === 429) {
        logWarn(`[Worker Failover] ${activeWorkerUrl} kotası doldu (HTTP 429). Sıradaki Cloudflare Worker'a geçiliyor...`);
        workerQuotaUsage.set(activeWorkerUrl, MAX_REQUESTS_PER_WORKER);
        currentWorkerPoolIndex = (currentWorkerPoolIndex + 1) % SCRAPER_PROXY_URLS.length;
      } else if (proxyRes.ok) {
        const rawText = await proxyRes.text();
        let parsed = null;
        try {
          parsed = JSON.parse(rawText);
        } catch {}

        const content = parsed && typeof parsed.content === 'string' ? parsed.content : rawText;
        const status = parsed && parsed.statusCode ? parsed.statusCode : proxyRes.status;

        const isBlocked = status === 403 || status === 503 ||
          content.includes('Just a moment...') || content.includes('cf-mitigated');

        if (!isBlocked && status < 400 && content.length > 50) {
          return { ok: true, status, content, url: targetUrl };
        }
      }
    } catch {}
  } else if (totalWorkerRequests >= MAX_WORKER_REQUESTS) {
    logWarn(`[Worker Quota Guard] Günlük ${MAX_WORKER_REQUESTS} Worker havuz limitine ulaşıldı. Doğrudan proxy istekleri durduruldu.`);
  }

  // Tier 3: Yerel Scraper Sunucusu (Fallback)
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const localRes = await fetch(LOCAL_SCRAPER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: targetUrl, method, headers: baseHeaders, body }),
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (localRes.ok) {
      const json = await localRes.json();
      if (json && json.content) {
        return { ok: true, status: json.statusCode || 200, content: json.content, url: json.finalUrl || targetUrl };
      }
    }
  } catch {}

  return { ok: false, status: 0, content: '', url: targetUrl };
};

const GENRE_ALIAS_TO_TURKISH = {
  action: 'Aksiyon',
  adventure: 'Macera',
  comedy: 'Komedi',
  drama: 'Dram',
  fantasy: 'Fantastik',
  fantezi: 'Fantastik',
  horror: 'Korku',
  mystery: 'Gizem',
  psychological: 'Psikolojik',
  romance: 'Romantik',
  romantic: 'Romantik',
  'sci-fi': 'Bilim Kurgu',
  'science fiction': 'Bilim Kurgu',
  'slice of life': 'Gündelik Yaşam',
  sports: 'Spor',
  sport: 'Spor',
  supernatural: 'Doğaüstü',
  thriller: 'Gerilim',
  suspense: 'Gerilim',
  ecchi: 'Ecchi',
  harem: 'Harem',
  isekai: 'Isekai',
  mecha: 'Meka',
  school: 'Okul Hayatı',
  'school life': 'Okul Hayatı',
  shounen: 'Shounen',
  shonen: 'Shounen',
  shoujo: 'Shoujo',
  seinen: 'Seinen',
  josei: 'Josei',
  historical: 'Tarihî',
  military: 'Askerî',
  martial: 'Dövüş Sanatları',
  'martial arts': 'Dövüş Sanatları',
  demons: 'İblis',
  demon: 'İblis',
  magic: 'Büyü',
  superpower: 'Süper Güç',
  'super power': 'Süper Güç',
  adult: 'Yetişkin',
  smut: 'Yetişkin',
  mature: 'Olgun',
  erotica: 'Yetişkin',
  tragedy: 'Trajedi',
  reincarnation: 'Reenkarnasyon',
  revenge: 'İntikam',
  survival: 'Hayatta Kalma',
  crime: 'Suç',
  webtoon: 'Webtoon',
  'long strip': 'Webtoon',
  manhwa: 'Manhwa',
  manhua: 'Manhua',
  'time travel': 'Zaman Yolculuğu',
  system: 'Sistem',
  dungeon: 'Zindan',
  tower: 'Kule',
  cultivation: 'Yetişim',
  murim: 'Murim',
  monsters: 'Canavar',
  monster: 'Canavar',
  vampire: 'Vampir',
  necromancy: 'Nekromansi',
  regression: 'Zaman Yolculuğu',
  villainess: 'Villainess',
  royalty: 'Asalet',
  nobility: 'Asalet',
  academy: 'Akademi',
};

const normalizeGenreToTurkish = (genre) => {
  if (!genre || typeof genre !== 'string') return '';
  const cleaned = genre.trim();
  if (!cleaned) return '';
  const lower = cleaned.toLocaleLowerCase('en-US').trim();
  if (GENRE_ALIAS_TO_TURKISH[lower]) return GENRE_ALIAS_TO_TURKISH[lower];
  return cleaned;
};

const cleanSeriesTitle = (title) => {
  let text = (title || '')
    .toString()
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&amp;/gi, '&')
    .replace(/&#8211;|&ndash;/gi, '-')
    .replace(/&#8212;|&mdash;/gi, '-')
    .replace(/&#8217;|&#8216;|&rsquo;|&lsquo;/gi, "'");

  // Remove leading decorative emojis, hearts, stars
  text = text.replace(/^[♥★✨🔥⭐\s]+/u, '');

  // Remove leading badges like "Yeni!", "HOT!", "GÜNCEL!", "[YENİ]", etc.
  text = text.replace(/^(?:\[?\b(?:yeni|hot|g[üu]ncel|new|t[üu]rk[çc]e|oku)\b!?\]?\s*)+/gi, '');

  // Remove trailing chapter references like ", Bölüm 0-7", "- Bölüm 1..", "(Bölüm 0-7)", "1-3. Bölümler"
  text = text.replace(/[,–—\-:|]?\s*(?:\(?[bB][öo]l[üu]m(?:ler)?\s*\d+(?:[–—\-]\d+)?\)?)\s*$/i, '');
  text = text.replace(/[,–—\-:|]?\s*(?:\(?\d+(?:[–—\-]\d+)?\.\s*[bB][öo]l[üu]m(?:ler)?\)?)\s*$/i, '');
  text = text.replace(/[,–—\-:|]?\s*(?:(?:birinci|ikinci|[iİ]lk)\s*[bB][öo]l[üu]m)\s*$/i, '');

  // Remove manga kapağı residues
  text = text
    .replace(/\s*(?:[–—\-]\s*)?manga\s*kapa[ğg][ıi]\s*$/i, '')
    .replace(/-manga-kapagi$/i, '');

  // Clean edge decorative punctuation
  text = text.replace(/^[♥★✨🔥⭐\s,:–—\-]+|[♥★✨🔥⭐\s,:–—\-]+$/gu, '');

  text = text.replace(/\s+/g, ' ').trim();

  // Tamamı küçük harf olan sitemap slug başlıklarını ("beach goddess" -> "Beach Goddess") Title Case yap
  if (text && text === text.toLocaleLowerCase('tr-TR') && /[a-zçğıöşü]/i.test(text)) {
    text = text.split(' ').map((w) => (w ? w.charAt(0).toLocaleUpperCase('tr-TR') + w.slice(1) : '')).join(' ');
  }

  return text;
};

// --- Title Normalization & Deduplication Key ---
const normalizeTitleKey = (title) => {
  if (!title) return '';
  return cleanSeriesTitle(title)
    .toLocaleLowerCase('tr-TR')
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ş/g, 's')
    .replace(/ı/g, 'i')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c')
    .replace(/\(.*?\)/g, ' ')
    .replace(/\[.*?\]/g, ' ')
    .replace(/\b(?:season\s*\d+|sezon\s*\d+|\d+\.\s*sezon|webtoon|manhwa|manhua|novel|manga)\b/gi, ' ')
    .replace(/[^a-z0-9]/gi, '')
    .trim();
};

const slugify = (text) => {
  return text
    .toString()
    .toLocaleLowerCase('tr-TR')
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ş/g, 's')
    .replace(/ı/g, 'i')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c')
    .trim()
    .replace(/[\s\W-]+/g, '-')
    .replace(/^-+|-+$/g, '');
};

const BL_REGEX = /\b(?:yaoi|shounen[\s\-_]*ai|shonen[\s\-_]*ai|boys?[\s\-_]*love|danmei|bara|erkek\s*a[sş]k[ıi]|erkek\s*erke[gğ]e|sadece[\s\-_]*erkekler|fujoshi|fudanshi|gay|gey)\b/iu;
const BL_GENRE_REGEX = /\b(?:bl|yaoi|shounen[\s\-_]*ai|shonen[\s\-_]*ai|boys?[\s\-_]*love|danmei|bara|erkek\s*a[sş]k[ıi]|erkek\s*erke[gğ]e|sadece[\s\-_]*erkekler|fujoshi|fudanshi|gay|gey)\b/iu;

const isBLSeries = (mangaOrMetadata) => {
  if (!mangaOrMetadata || typeof mangaOrMetadata !== 'object') return false;

  const genreList = [];
  if (Array.isArray(mangaOrMetadata.genres)) {
    genreList.push(...mangaOrMetadata.genres.map((g) => (typeof g === 'string' ? g : g?.name || g?.genre || '')));
  }
  if (Array.isArray(mangaOrMetadata.tags)) {
    genreList.push(...mangaOrMetadata.tags.map((t) => (typeof t === 'string' ? t : t?.name || t?.tag || '')));
  }
  if (Array.isArray(mangaOrMetadata.categories)) {
    genreList.push(...mangaOrMetadata.categories.map((c) => (typeof c === 'string' ? c : c?.name || '')));
  }

  for (const genre of genreList) {
    if (!genre) continue;
    const gLower = genre.trim().toLowerCase();
    if (gLower === 'bl' || BL_GENRE_REGEX.test(gLower)) {
      return true;
    }
  }

  const titleList = [
    mangaOrMetadata.title,
    mangaOrMetadata.name,
    mangaOrMetadata.original_title,
    mangaOrMetadata.title_english,
    mangaOrMetadata.title_japanese,
    ...(Array.isArray(mangaOrMetadata.alternativeTitles) ? mangaOrMetadata.alternativeTitles : []),
    ...(Array.isArray(mangaOrMetadata.altTitles) ? mangaOrMetadata.altTitles : []),
    ...(Array.isArray(mangaOrMetadata.synonyms) ? mangaOrMetadata.synonyms : []),
  ].filter((t) => typeof t === 'string' && t.trim().length > 0);

  for (const t of titleList) {
    if (/\bBL\b/i.test(t) || BL_REGEX.test(t)) {
      return true;
    }
  }

  const desc = [
    mangaOrMetadata.description,
    mangaOrMetadata.synopsis,
    mangaOrMetadata.summary,
  ].filter((d) => typeof d === 'string' && d.trim().length > 0).join(' ');

  if (desc && (BL_REGEX.test(desc) || /\bBL\s*(?:webtoon|manhwa|manhua|manga|seri|hikaye|ili[sş]ki)/iu.test(desc))) {
    return true;
  }

  return false;
};

const cleanChapterTitle = (rawTitle, chapterNumber, seriesTitle) => {
  let text = (rawTitle || '').toString().trim();
  if (!text) {
    return chapterNumber != null && Number(chapterNumber) > 0 ? `Bölüm ${chapterNumber}` : 'Bölüm 1';
  }

  // 1. Remove drop rates & percentages
  text = text.replace(/\b\d+\s*B[ıi]rakma\s*~?\d*%?/gi, ' ');
  text = text.replace(/\bB[ıi]rakma\s*~?\d*%?/gi, ' ');
  text = text.replace(/~?\s*\d+(?:[.,]\d+)?\s*%/g, ' ');

  // 2. Remove relative dates
  text = text.replace(/\b\d+\s*(?:dakika|dak|dk|min|minute|saat|hour|g[üu]n|day|hafta|week|ay|month|y[ıi]l|sene|year)s?(?:\s*(?:önce|ago))?\b/gi, ' ');

  // 3. Remove view counters and read counts
  text = text.replace(/\b\d+(?:[.,]\d+)?\s*[kmbKMkMB]\b/g, ' ');
  text = text.replace(/\b\d+\s*(?:g[öo]r[üu]nt[üu]lenme|okunma|okuma|views?|reads?)\b/gi, ' ');
  text = text.replace(/\bburadas[ıi]n[ıi]z\b/gi, ' ');

  // 4. If series title is provided, strip it from title
  if (seriesTitle && typeof seriesTitle === 'string') {
    const escaped = seriesTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    text = text.replace(new RegExp(`^${escaped}\\s*[-–—:|]?\\s*`, 'i'), ' ');
    text = text.replace(new RegExp(`\\s*[-–—:|]?\\s*${escaped}$`, 'i'), ' ');
    text = text.replace(new RegExp(`\\b${escaped}\\b`, 'gi'), ' ');
  }

  // 5. Determine effective chapter number
  let effectiveNum = chapterNumber != null && Number(chapterNumber) > 0 ? Number(chapterNumber) : null;
  if (effectiveNum == null) {
    const match = text.match(/(?:b[öo]l[üu]m|chapter|ch\.?)\s*(\d+(?:\.\d+)?)/i) || text.match(/(\d+(?:\.\d+)?)/);
    if (match) effectiveNum = parseFloat(match[1]);
  }

  // 6. Remove trailing residue numbers if chapter number already established
  if (effectiveNum != null) {
    text = text.replace(/\s+\d{1,4}\s*$/, ' ');
  }

  // 7. Extract subtitle
  let subtitle = text
    .replace(/(?:b[öo]l[üu]m|chapter|ch\.?)\s*\.?\s*\d+(?:\.\d+)?/gi, ' ')
    .replace(/\b\d+(?:\.\d+)?\s*\.?\s*(?:b[öo]l[üu]m|chapter|ch\.?)/gi, ' ');
  const numStr = effectiveNum != null ? (Number.isInteger(effectiveNum) ? String(effectiveNum) : String(effectiveNum)) : '';
  if (numStr) {
    subtitle = subtitle.replace(new RegExp(`\\b${numStr.replace('.', '\\.')}\\b`, 'g'), ' ');
  }

  subtitle = subtitle.replace(/^[-–—:|.\s]+|[-–—:|.\s]+$/g, '').replace(/\s+/g, ' ').trim();

  // If subtitle has meaningful text
  if (subtitle && !/^(?:b[öo]l[üu]m|chapter|ch|\d+)$/i.test(subtitle) && subtitle.length > 1) {
    return effectiveNum != null ? `Bölüm ${effectiveNum} - ${subtitle}` : subtitle;
  }

  return effectiveNum != null ? `Bölüm ${effectiveNum}` : (text || 'Bölüm 1');
};

// --- URL Junk Filtering ---
const JUNK_URL_PATTERNS = [
  'whatthe',
  'plase',
  'yaaxa',
  'tr2.png',
  'z9.jpg',
  '/wp-content/themes/',
  'cropped-',
  '-150x150',
  '-175x238',
  '-110x150',
  '-193x278',
  '-350x476',
  'avatar',
  'gravatar',
  'logo',
  'disquscdn',
  'banner',
  'discord',
  'donate',
  'promo',
  'credit',
  'credits',
  'endcard',
  'end-card',
  'end_card',
  'mangadex-card',
  'read-on-mangadex',
  'reklam',
  'tanitim',
  'duyuru',
  'recruit',
  'warning',
  'no-cover',
  'placeholder',
  'default-cover',
  'base64',
  'data:image',
];

const isJunkImageUrl = (url) => {
  if (!url || typeof url !== 'string') return true;
  const trimmed = url.trim();
  if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) return true;
  const lower = trimmed.toLowerCase();
  if (/\.(?:svg|ico|gif|enc)(?:\?.*)?$/i.test(lower)) return true;
  return JUNK_URL_PATTERNS.some((p) => lower.includes(p));
};

const isJunkCoverUrl = (url) => {
  return isJunkImageUrl(url);
};

// --- Live Image Verification Cache (Domain Hızlandırmalı - 20x Hızlı) ---
const verifiedDomainSuccessCounts = new Map();
const verifiedDomainFailureCounts = new Map();
const verifiedDomainCache = new Map();
const verifiedUrlCache = new Map();

// Bilinen güvenli CDN domain'leri doğrudan onaylı
const TRUSTED_DOMAINS = [
  'cdn-2.webtoon-oku.net',
  'cdn.mangacix.net',
  'api.golgebahcesi.com',
  'api.dxdfansub.com',
];

for (const d of TRUSTED_DOMAINS) {
  verifiedDomainCache.set(d, true);
}

const verifyImageUrl = async (url) => {
  if (isJunkImageUrl(url)) return false;
  const cleanUrl = url.trim();

  if (verifiedUrlCache.has(cleanUrl)) {
    return verifiedUrlCache.get(cleanUrl);
  }

  let domain = '';
  try {
    domain = new URL(cleanUrl).hostname;
  } catch {
    return false;
  }

  // Domain başarısız olarak işaretlendiyse doğrudan atla (Circuit Breaker)
  if (verifiedDomainCache.get(domain) === false) {
    return false;
  }

  // Domain daha önce 2 kez başarılı olduysa tekrar test etme!
  if (verifiedDomainCache.get(domain) === true) {
    return true;
  }

  if (verifiedUrlCache.size > 2000) {
    verifiedUrlCache.clear();
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3500);

    const res = await fetch(cleanUrl, {
      method: 'GET',
      headers: {
        'User-Agent': DEFAULT_USER_AGENT,
        'Range': 'bytes=0-1024',
        'Referer': `${new URL(cleanUrl).origin}/`,
      },
      signal: controller.signal,
    });
    clearTimeout(timer);

    const contentType = res.headers.get('content-type') || '';
    const isImage = (res.status === 200 || res.status === 206) &&
      (contentType.startsWith('image/') || contentType.includes('octet-stream') || res.status === 206);

    verifiedUrlCache.set(cleanUrl, isImage);

    if (isImage) {
      const count = (verifiedDomainSuccessCounts.get(domain) || 0) + 1;
      verifiedDomainSuccessCounts.set(domain, count);
      if (count >= 2) {
        verifiedDomainCache.set(domain, true);
      }
    } else {
      const failCount = (verifiedDomainFailureCounts.get(domain) || 0) + 1;
      verifiedDomainFailureCounts.set(domain, failCount);
      if (failCount >= 3) {
        verifiedDomainCache.set(domain, false);
      }
    }
    return isImage;
  } catch {
    verifiedUrlCache.set(cleanUrl, false);
    const failCount = (verifiedDomainFailureCounts.get(domain) || 0) + 1;
    verifiedDomainFailureCounts.set(domain, failCount);
    if (failCount >= 3) {
      verifiedDomainCache.set(domain, false);
    }
    return false;
  }
};

const verifyAndFilterImageUrls = async (urls) => {
  if (SKIP_IMAGES) {
    return Array.from(new Set(urls.map((u) => u.trim()).filter((u) => !isJunkImageUrl(u))));
  }

  const unique = Array.from(new Set(urls.map((u) => u.trim()).filter((u) => !isJunkImageUrl(u))));
  if (unique.length === 0) return [];

  // Fast sample check: İlk 2 görseli kontrol et, çalışmıyorsa bölüm ölüdür
  const sample = unique.slice(0, 2);
  const sampleResults = await Promise.all(sample.map((u) => verifyImageUrl(u)));
  if (!sampleResults.some(Boolean)) {
    return [];
  }

  // İlk görselin domain'i doğrulanmışsa kalan görseller aynı domainde doğrudan geçerli kabul edilir
  try {
    const firstDomain = new URL(unique[0]).hostname;
    if (verifiedDomainCache.get(firstDomain) === true) {
      return unique;
    }
  } catch {}

  const valid = [];
  const chunkSize = 10;
  for (let i = 0; i < unique.length; i += chunkSize) {
    const chunk = unique.slice(i, i + chunkSize);
    const results = await Promise.all(chunk.map((u) => verifyImageUrl(u)));
    for (let j = 0; j < chunk.length; j++) {
      if (results[j]) {
        valid.push(chunk[j]);
      }
    }
  }

  return valid;
};

const stripTags = (html) => {
  if (!html) return '';
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&#8211;|&ndash;/gi, '-')
    .replace(/&#8212;|&mdash;/gi, '-')
    .replace(/&#8217;|&#8216;|&rsquo;|&lsquo;/gi, "'")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
};

const extractRegexMatches = (html, regex) => {
  const matches = [];
  let m;
  while ((m = regex.exec(html)) !== null) {
    matches.push(m);
  }
  return matches;
};

// ============================================================================
// ADULT / +18 INTELLIGENT CONTENT DETECTION ENGINE
// ============================================================================
const ADULT_GENRE_REGEX = /\b(18\+|\+18|yeti[şs]kin|adult|erotik|erotica|pornographic|nsfw|mature|r-?18|ecchi|smut|hentai)\b/i;
const ADULT_TITLE_REGEX = /\b(\+18|18\+|hentai|sans[üu]rs[üu]z|uncensored|erotik|smut)\b/i;

const detectIsAdult = ({
  source = '',
  url = '',
  cardBlock = '',
  html = '',
  genres = [],
  title = '',
  description = '',
  fallbackIsAdult = false,
} = {}) => {
  if (url && (/\/adult\/|\/webtoon-tur\/adult\//i.test(url) || /\b18\+\b|\+18\b/i.test(url))) return true;

  if (cardBlock) {
    if (/<span class=["'][^"']*badge-age[^"']*["'][\s\S]*?18\+/i.test(cardBlock)) return true;
    if (/<span[^>]+class=["'][^"']*uk-text-small[^"']*["']>\s*18\+\s*<\/span>/i.test(cardBlock)) return true;
    if (/\/tur\/yetiskin\//i.test(cardBlock)) return true;
  }
  if (html) {
    if (/<span class=["'][^"']*badge-age[^"']*["'][\s\S]*?18\+/i.test(html)) return true;
    if (/<span[^>]+class=["'][^"']*uk-text-small[^"']*["']>\s*18\+\s*<\/span>/i.test(html)) return true;
    if (/itemprop=["']contentRating["']\s+content=["'](?:18\+|Adult)["']/i.test(html)) return true;
    if (/class=["']manga-genre["'][^>]*href="https:\/\/siyahmelek\.my\/tur\/yetiskin\/"/i.test(html)) return true;
  }

  const genreStr = (genres || []).join(' ');
  if (genreStr && ADULT_GENRE_REGEX.test(genreStr)) return true;

  if (title && ADULT_TITLE_REGEX.test(title)) return true;

  if (description && /\b(hentai|sans[üu]rs[üu]z|uncensored)\b/i.test(description)) return true;

  return Boolean(fallbackIsAdult);
};

// ============================================================================
// KAYNAK KAZIYICILARI (HARVESTERS)
// ============================================================================

// --- 1. WebtoonHattı ---
const harvestWebtoonHattiCatalog = async (maxMangas) => {
  logInfo('WebtoonHattı taranıyor (Normal + Popüler + +18 kategoriler)...');
  const seriesCards = [];
  const seenLinks = new Set();

  const listUrlsToCrawl = [
    { url: 'https://webtoonhatti.club/manga/page/1/?m_orderby=views', isAdult: false },
    { url: 'https://webtoonhatti.club/manga/page/1/?m_orderby=rating', isAdult: false },
    { url: 'https://webtoonhatti.club/manga/page/1/?m_orderby=latest', isAdult: false },
    { url: 'https://webtoonhatti.club/webtoon-tur/adult/page/1/?m_orderby=latest', isAdult: true },
    { url: 'https://webtoonhatti.club/webtoon-tur/smut/page/1/?m_orderby=latest', isAdult: true },
    { url: 'https://webtoonhatti.club/webtoon-tur/ecchi/page/1/?m_orderby=latest', isAdult: true },
    { url: 'https://webtoonhatti.club/webtoon-tur/mature/page/1/?m_orderby=latest', isAdult: true },
  ];

  const maxPagesForCategory = IS_FULL ? 200 : 10;

  for (const entry of listUrlsToCrawl) {
    if (seriesCards.length >= maxMangas) break;

    let page = 1;

    while (page <= maxPagesForCategory && seriesCards.length < maxMangas) {
      const pageUrl = entry.url.replace('/page/1/', `/page/${page}/`);
      const res = await fetchUpstream(pageUrl, { timeoutMs: 15000 });

      if (!res.ok || !res.content) break;

      const html = res.content;
      const blocks = html.split(/class=["'](?:page-item-detail|c-tabs-item__content)/i).slice(1);
      if (blocks.length === 0) break;

      let addedInPage = 0;
      for (const b of blocks) {
        const linkMatch = b.match(/href=["'](https:\/\/webtoonhatti\.club\/(?:manga|webtoon)\/[^"'\/]+(?:\/)?)["']/i);
        const titleMatch = b.match(/title=["']([^"']+)["']/i) || b.match(/<a[^>]+href=["'][^"']+["'][^>]*>([^<]+)<\/a>/i);
        const imgMatch = b.match(/(?:data-src|data-lazy-src|src)=["']([^"']+\.(?:webp|jpg|jpeg|png)[^"']*)["']/i);

        const link = linkMatch?.[1]?.trim();
        const title = titleMatch?.[1] ? stripTags(titleMatch[1]) : '';
        const cover = imgMatch?.[1]?.trim();

        if (link && title && !seenLinks.has(link)) {
          seenLinks.add(link);

          const genreRegex = /<a[^>]+href="[^"]*\/webtoon-tur\/[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;
          const genres = extractRegexMatches(b, genreRegex).map((g) => stripTags(g[1])).filter(Boolean);

          if (entry.isAdult && !genres.includes('+18')) {
            genres.push('+18');
          }

          seriesCards.push({
            source: 'webtoonhatti',
            title,
            link,
            cover,
            genres,
            isAdult: entry.isAdult,
          });
          addedInPage++;

          if (seriesCards.length >= maxMangas) break;
        }
      }

      logProgress(seriesCards.length, maxMangas, `WebtoonHattı (${entry.isAdult ? '+18' : 'Normal'}) Sayfa ${page}`, `+${addedInPage} seri bulundu`);
      if (addedInPage === 0) break;
      page++;
      await sleep(300);
    }
  }

  return seriesCards;
};

const harvestWebtoonHattiDetail = async (seriesCard) => {
  const res = await fetchUpstream(seriesCard.link, { timeoutMs: 15000 });
  if (!res.ok || !res.content) return null;

  const html = res.content;

  const descMatch = /<div class="manga-excerpt[\s\S]*?<p>([\s\S]*?)<\/p>/i.exec(html) ||
    /<div class="description-summary[\s\S]*?<p>([\s\S]*?)<\/p>/i.exec(html) ||
    /<meta property="og:description" content="([^"]+)"/i.exec(html);
  const description = descMatch ? stripTags(descMatch[1]) : '';

  const blocks = html.split(/<div class="post-content_item[^"]*">/i).slice(1);
  let alternativeTitles = [];
  let author = '';
  let artist = '';
  let status = 'ongoing';

  for (const block of blocks) {
    const headingMatch = /<div class="summary-heading[^"]*">([\s\S]*?)<\/div>/i.exec(block) ||
      /<h5[^>]*>([\s\S]*?)<\/h5>/i.exec(block);
    const headingText = headingMatch ? stripTags(headingMatch[1]).toLowerCase() : '';

    const contentMatch = /<div class="summary-content[^"]*">([\s\S]*?)<\/div>/i.exec(block);
    const contentText = contentMatch ? stripTags(contentMatch[1]) : '';

    if (headingText.includes('alternatif') || headingText.includes('alternative') || headingText.includes('diğer')) {
      if (contentText) {
        alternativeTitles = contentText
          .split(/[,;\n/|]/)
          .map((t) => t.trim())
          .filter((t) => t.length > 1 && !/g[üu]ncellenecek/i.test(t));
      }
    } else if (headingText.includes('yazar') || headingText.includes('author')) {
      if (contentText) author = contentText;
    } else if (headingText.includes('çizer') || headingText.includes('artist') || headingText.includes('cizer')) {
      if (contentText) artist = contentText;
    } else if (headingText.includes('durum') || headingText.includes('status')) {
      const lower = contentText.toLowerCase();
      if (lower.includes('tamam') || lower.includes('bitti') || lower.includes('completed')) {
        status = 'completed';
      }
    }
  }

  try {
    const slugName = seriesCard.link.split('/').filter(Boolean).pop().replace(/-/g, ' ');
    if (slugName && slugName.length > 2 && !alternativeTitles.some((t) => normalizeTitleKey(t) === normalizeTitleKey(slugName))) {
      alternativeTitles.push(slugName);
    }
  } catch {}

  const genreRegex = /<a[^>]+href="[^"]*\/webtoon-tur\/[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;
  const genres = extractRegexMatches(html, genreRegex).map((g) => stripTags(g[1])).filter(Boolean);
  if (seriesCard.isAdult && !genres.includes('+18')) {
    genres.push('+18');
  }

  const chapterRegex = /<li class="[^"]*wp-manga-chapter[^"]*">[\s\S]*?<a href="([^"]+)">([\s\S]*?)<\/a>/gi;
  const chMatches = extractRegexMatches(html, chapterRegex);
  const rawChapters = [];

  for (const ch of chMatches) {
    const chLink = ch[1].trim();
    const chText = stripTags(ch[2]);
    const numMatch = `${chText} ${chLink}`.match(/(\d+(?:\.\d+)?)/);
    const num = numMatch ? parseFloat(numMatch[1]) : 0;
    rawChapters.push({
      title: chText || `Bölüm ${num}`,
      link: chLink,
      chapterNumber: num,
    });
  }

  rawChapters.sort((a, b) => a.chapterNumber - b.chapterNumber);

  return {
    title: seriesCard.title,
    link: seriesCard.link,
    cover: seriesCard.cover,
    description,
    alternativeTitles,
    author: author || 'Bilinmiyor',
    artist: artist || undefined,
    status,
    genres: genres.length > 0 ? genres : seriesCard.genres,
    isAdult: detectIsAdult({
      source: seriesCard.source || 'webtoonhatti',
      url: seriesCard.link,
      html,
      genres,
      title: seriesCard.title,
      description,
      fallbackIsAdult: seriesCard.isAdult,
    }),
    chapters: rawChapters,
    source: seriesCard.source || 'webtoonhatti',
  };
};

const harvestWebtoonHattiChapterImages = async (chapterLink) => {
  const res = await fetchUpstream(chapterLink, { timeoutMs: 15000 });
  if (!res.ok || !res.content) return [];

  const html = res.content;
  let matches = [];

  const pageBreakRegex = /<div class="[^"]*page-break[^"]*"[\s\S]*?<\/div>/gi;
  const pageBreaks = extractRegexMatches(html, pageBreakRegex);
  if (pageBreaks.length > 0) {
    for (const pb of pageBreaks) {
      const imgs = extractRegexMatches(pb[0], /<img[^>]+(?:data-src|data-lazy-src|src)="([^"]+)"/gi);
      matches.push(...imgs);
    }
  }

  if (matches.length === 0) {
    const readingDiv = /<div class="[^"]*reading-content[^"]*"[\s\S]*?<\/div>/gi.exec(html);
    if (readingDiv) {
      matches = extractRegexMatches(readingDiv[0], /<img[^>]+(?:data-src|data-lazy-src|src)="([^"]+)"/gi);
    }
  }

  const rawUrls = matches
    .map((m) => m[1]?.trim())
    .filter((u) => u && !isJunkImageUrl(u));

  return await verifyAndFilterImageUrls(rawUrls);
};

// --- 2. SiyahMelek.my (+18) ---
const harvestSiyahMelekCatalog = async (maxMangas) => {
  logInfo('SiyahMelek.my sitemap taranıyor (556 seri)...');
  const seriesCards = [];
  const seenLinks = new Set();

  try {
    const sitemapRes = await fetchUpstream('https://siyahmelek.my/manga-sitemap.xml', { timeoutMs: 15000 });
    if (sitemapRes.ok && sitemapRes.content) {
      const urls = extractRegexMatches(sitemapRes.content, /<loc>(https:\/\/siyahmelek\.my\/manga\/[^<]+)<\/loc>/gi);
      for (const u of urls) {
        const link = u[1].trim();
        if (link && !seenLinks.has(link)) {
          seenLinks.add(link);
          const slug = link.split('/').filter(Boolean).pop();
          const title = slug ? slug.replace(/-/g, ' ') : '';
          seriesCards.push({
            source: 'siyahmelek',
            title: cleanSeriesTitle(title),
            link,
            cover: '',
            genres: [],
            isAdult: false,
          });
          if (seriesCards.length >= maxMangas) break;
        }
      }
      logInfo(`SiyahMelek: Sitemap üzerinden ${seriesCards.length} seri bulundu.`);
      return seriesCards;
    }
  } catch (err) {
    logWarn(`SiyahMelek sitemap hatası: ${err.message}, sayfalama moduna geçiliyor...`);
  }

  let page = 1;
  while (page <= (IS_FULL ? 100 : 10) && seriesCards.length < maxMangas) {
    const listUrl = `https://siyahmelek.my/manga/page/${page}/`;
    const res = await fetchUpstream(listUrl);
    if (!res.ok || !res.content) break;

    const html = res.content;
    const blocks = html.split('<div class="manga-item-grid">').slice(1);
    if (blocks.length === 0) break;

    for (const block of blocks) {
      const linkMatch = block.match(/href="(https:\/\/siyahmelek\.my\/manga\/[^"/]+\/)"/i);
      const imgMatch = block.match(/<img[^>]+src="([^"]+)"/i);
      const titleMatch = block.match(/alt="([^"]+) i[çc]in kapak g[öo]rseli"/i) || block.match(/<h[2-4][^>]*>([\s\S]*?)<\/h[2-4]>/i);
      const link = linkMatch?.[1]?.trim();
      const cover = imgMatch?.[1]?.trim() || '';
      const title = titleMatch ? stripTags(titleMatch[1]).trim() : '';

      if (link && title && !seenLinks.has(link)) {
        seenLinks.add(link);
        const isAdult = detectIsAdult({ source: 'siyahmelek', url: link, cardBlock: block, title });
        seriesCards.push({
          source: 'siyahmelek',
          title: cleanSeriesTitle(title),
          link,
          cover,
          genres: isAdult ? ['+18'] : [],
          isAdult,
        });

        if (seriesCards.length >= maxMangas) break;
      }
    }

    page++;
    await sleep(250);
  }

  return seriesCards;
};

const harvestSiyahMelekDetail = async (seriesCard) => {
  const res = await fetchUpstream(seriesCard.link);
  if (!res.ok || !res.content) return null;

  const html = res.content;
  const titleMatch = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
  const title = titleMatch ? stripTags(titleMatch[1]).trim() : seriesCard.title;

  const descMatch = /<div class="manga-description[^"]*">([\s\S]*?)<\/div>/i.exec(html);
  const description = descMatch ? stripTags(descMatch[1]).trim() : '';

  const genreRegex = /<a[^>]+href="https:\/\/siyahmelek\.my\/tur\/[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;
  const genres = extractRegexMatches(html, genreRegex)
    .map((g) => normalizeGenreToTurkish(stripTags(g[1])))
    .filter(Boolean);

  const altMatch = /id="comic-othername"[^>]*>([\s\S]*?)<\/div>/i.exec(html) || /Diğer İsimler:[\s\S]*?<div[^>]*>([\s\S]*?)<\/div>/i.exec(html);
  const alternativeTitles = altMatch
    ? stripTags(altMatch[1])
        .split(/[,;\n/|]/)
        .map((t) => t.trim())
        .filter((t) => t.length > 1 && !/g[üu]ncellenecek/i.test(t))
    : [];

  const authorMatch = /<a[^>]+href="https:\/\/siyahmelek\.my\/yazar\/[^"]*"[^>]*>([\s\S]*?)<\/a>/i.exec(html);
  const author = authorMatch ? stripTags(authorMatch[1]).trim() : 'Bilinmiyor';

  const isAdult = detectIsAdult({
    source: 'siyahmelek',
    url: seriesCard.link,
    html,
    genres,
    title,
    description,
    fallbackIsAdult: seriesCard.isAdult,
  });

  // Bölümleri çıkar ve kilitli olanları ele
  const chapterItems = html.split(/class="[^"]*chapter-item[^"]*"/i).slice(1);
  const rawChapters = [];

  for (const block of chapterItems) {
    // Kilitli (ücretli) bölümleri ATLA
    if (block.includes('icon: lock') || block.includes('icon:lock') || block.includes('kilitli')) {
      continue;
    }

    const aMatch = /<a[^>]+href="(https:\/\/siyahmelek\.my\/manga\/[^"/]+\/[^"/]+\/)"[^>]*>([\s\S]*?)<\/a>/i.exec(block);
    if (aMatch) {
      const chLink = aMatch[1].trim();
      const chTitle = stripTags(aMatch[2]);
      const numMatch = `${chTitle} ${chLink}`.match(/(\d+(?:\.\d+)?)/);
      const num = numMatch ? parseFloat(numMatch[1]) : 0;

      rawChapters.push({
        title: chTitle || `Bölüm ${num}`,
        link: chLink,
        chapterNumber: num,
      });
    }
  }

  rawChapters.sort((a, b) => a.chapterNumber - b.chapterNumber);

  return {
    title,
    link: seriesCard.link,
    cover: seriesCard.cover,
    description,
    alternativeTitles,
    author,
    artist: undefined,
    status: 'ongoing',
    genres,
    isAdult,
    chapters: rawChapters,
    source: 'siyahmelek',
  };
};

const harvestSiyahMelekChapterImages = async (chapterLink) => {
  const res = await fetchUpstream(chapterLink);
  if (!res.ok || !res.content) return [];

  const html = res.content;
  const imgs = [];

  // Match all img tags in DOM order to preserve page sequence
  const imgTagRegex = /<img[^>]+>/gi;
  const imgTags = extractRegexMatches(html, imgTagRegex);
  for (const [tag] of imgTags) {
    if (!tag.includes('/wp-content/uploads/init-manga/') && !tag.includes('data-original-src')) {
      continue;
    }
    const origSrc = /data-original-src="([^"]+)"/i.exec(tag)?.[1];
    const src = /src="([^"]+)"/i.exec(tag)?.[1];
    const chosen = origSrc || (src && !src.startsWith('data:') ? src : null);
    if (chosen && !isJunkImageUrl(chosen)) {
      imgs.push(chosen);
    }
  }

  // Fallback if DOM loop caught nothing
  if (imgs.length === 0) {
    const origMatches = extractRegexMatches(html, /data-original-src="([^"]+)"/gi);
    for (const m of origMatches) imgs.push(m[1]);
  }

  const rawUrls = imgs.filter((u) => u && !isJunkImageUrl(u));
  return await verifyAndFilterImageUrls(rawUrls);
};

// --- 3. HattoriManga.net (+18) ---
const harvestHattoriMangaCatalog = async (maxMangas) => {
  logInfo('HattoriManga.net taranıyor (+18)...');
  const seriesCards = [];
  const seenLinks = new Set();
  let page = 1;

  while (page <= (IS_FULL ? 100 : 10) && seriesCards.length < maxMangas) {
    const listUrl = `https://hattorimanga.net/manga/page/${page}/`;
    const res = await fetchUpstream(listUrl);
    if (!res.ok || !res.content) break;

    const html = res.content;
    const blocks = html.split(/class=["'](?:page-item-detail|c-tabs-item__content)/i).slice(1);
    if (blocks.length === 0) break;

    for (const b of blocks) {
      const linkMatch = b.match(/href=["'](https:\/\/hattorimanga\.net\/manga\/[^"'\/]+(?:\/)?)["']/i);
      const titleMatch = b.match(/title=["']([^"']+)["']/i) || b.match(/<a[^>]+href=["'][^"']+["'][^>]*>([^<]+)<\/a>/i);
      const imgMatch = b.match(/(?:data-src|data-lazy-src|src)=["']([^"']+\.(?:webp|jpg|jpeg|png)[^"']*)["']/i);

      const link = linkMatch?.[1]?.trim();
      const title = titleMatch?.[1] ? stripTags(titleMatch[1]) : '';
      const cover = imgMatch?.[1]?.trim();

      if (link && title && !seenLinks.has(link)) {
        seenLinks.add(link);
        const isAdult = detectIsAdult({ source: 'hattorimanga', url: link, cardBlock: b, title });
        seriesCards.push({
          source: 'hattorimanga',
          title,
          link,
          cover,
          genres: isAdult ? ['+18'] : [],
          isAdult,
        });

        if (seriesCards.length >= maxMangas) break;
      }
    }

    page++;
    await sleep(250);
  }

  return seriesCards;
};

// --- 5. GölgeBahçesi, DxDFansub, MangaCix, OkuToon ---
const harvestGolgeBahcesiCatalog = async (maxMangas) => {
  logInfo('GölgeBahçesi taranıyor...');
  const seriesList = [];
  let page = 1;

  while (seriesList.length < maxMangas) {
    const url = `https://api.golgebahcesi.com/api/series?page=${page}&limit=50&sort=default`;
    const res = await fetchUpstream(url);
    if (!res.ok || !res.content) break;

    let json;
    try {
      json = JSON.parse(res.content);
    } catch {
      break;
    }

    const items = Array.isArray(json) ? json : (Array.isArray(json?.data) ? json.data : []);
    if (items.length === 0) break;

    for (const item of items) {
      const title = item.title || item.name;
      const slug = item.slug || String(item.id || '');
      if (!title || !slug) continue;

      let cover = item.cover || item.coverImage || item.image || '';
      if (cover.startsWith('/')) {
        cover = `https://api.golgebahcesi.com${cover}`;
      }

      const genres = (item.genres || []).map((g) => (typeof g === 'string' ? g : g?.name || g?.title || '')).filter(Boolean);
      const alternativeTitles = Array.isArray(item.alternativeTitles) ? item.alternativeTitles : [];

      seriesList.push({
        source: 'golgebahcesi',
        title,
        slug,
        link: `https://golgebahcesi.com/manga/${slug}`,
        apiUrl: `https://api.golgebahcesi.com/api/series/${slug}`,
        cover,
        description: item.description || '',
        alternativeTitles,
        author: item.author || '',
        artist: item.artist || '',
        genres,
        isAdult: Boolean(item.adult || genres.includes('+18')),
      });

      if (seriesList.length >= maxMangas) break;
    }

    page++;
    await sleep(250);
  }

  return seriesList;
};

const harvestGolgeBahcesiDetail = async (seriesItem) => {
  const url = `https://api.golgebahcesi.com/api/series/${seriesItem.slug}/chapters`;
  const res = await fetchUpstream(url);
  if (!res.ok || !res.content) return null;

  let json;
  try {
    json = JSON.parse(res.content);
  } catch {
    return null;
  }

  const items = Array.isArray(json) ? json : (Array.isArray(json?.data) ? json.data : (Array.isArray(json?.chapters) ? json.chapters : []));
  const chapters = [];

  for (const ch of items) {
    if (ch.isLocked) continue;
    const num = Number(ch.chapter_number || ch.number || 0);
    const title = ch.title || `Bölüm ${num}`;
    chapters.push({
      id: ch.id,
      chapterId: ch.id,
      title,
      link: `https://golgebahcesi.com/manga/${seriesItem.slug}/bolum-${num}`,
      chapterNumber: num,
      rawPages: Array.isArray(ch.pages) ? ch.pages : [],
    });
  }

  chapters.sort((a, b) => a.chapterNumber - b.chapterNumber);

  return {
    ...seriesItem,
    status: 'ongoing',
    chapters,
  };
};

const harvestDxDFansubCatalog = async (maxMangas) => {
  logInfo('DxDFansub taranıyor...');
  const seriesList = [];
  let page = 1;

  while (seriesList.length < maxMangas) {
    const url = `https://api.dxdfansub.com/api/series?page=${page}&limit=50&sort=default`;
    const res = await fetchUpstream(url);
    if (!res.ok || !res.content) break;

    let json;
    try {
      json = JSON.parse(res.content);
    } catch {
      break;
    }

    const items = Array.isArray(json) ? json : (Array.isArray(json?.data) ? json.data : []);
    if (items.length === 0) break;

    for (const item of items) {
      const title = item.title || item.name;
      const slug = item.slug || String(item.id || '');
      if (!title || !slug) continue;

      let cover = item.cover || item.coverImage || item.image || '';
      if (cover.startsWith('/')) {
        cover = `https://api.dxdfansub.com${cover}`;
      }

      seriesList.push({
        source: 'dxdfansub',
        title,
        slug,
        link: `https://dxdfansub.com/manga/${slug}`,
        cover,
        description: item.description || '',
        alternativeTitles: Array.isArray(item.alternativeTitles) ? item.alternativeTitles : [],
        genres: (item.genres || []).map((g) => (typeof g === 'string' ? g : g?.name || '')).filter(Boolean),
        isAdult: true,
      });

      if (seriesList.length >= maxMangas) break;
    }

    page++;
    await sleep(250);
  }

  return seriesList;
};

const harvestDxDFansubDetail = async (seriesItem) => {
  const url = `https://api.dxdfansub.com/api/series/${seriesItem.slug}/chapters`;
  const res = await fetchUpstream(url);
  if (!res.ok || !res.content) return null;

  let json;
  try {
    json = JSON.parse(res.content);
  } catch {
    return null;
  }

  const items = Array.isArray(json) ? json : (Array.isArray(json?.data) ? json.data : []);
  const chapters = [];

  for (const ch of items) {
    if (ch.isLocked) continue;
    const num = Number(ch.chapter_number || ch.number || 0);
    const title = ch.title || `Bölüm ${num}`;
    chapters.push({
      id: ch.id,
      chapterId: ch.id,
      title,
      link: `https://dxdfansub.com/manga/${seriesItem.slug}/bolum-${num}`,
      chapterNumber: num,
      rawPages: Array.isArray(ch.pages) ? ch.pages : [],
    });
  }

  chapters.sort((a, b) => a.chapterNumber - b.chapterNumber);

  return {
    ...seriesItem,
    status: 'ongoing',
    chapters,
  };
};

const harvestMangaCixCatalog = async (maxMangas) => {
  logInfo('MangaCix taranıyor...');
  const seriesList = [];
  let page = 1;

  while (seriesList.length < maxMangas) {
    const url = `https://mangacix.net/secure/titles?onlyStreamable=true&page=${page}&perPage=50`;
    const res = await fetchUpstream(url, {
      headers: {
        'Referer': 'https://mangacix.net/browse',
        'X-Requested-With': 'XMLHttpRequest',
      },
    });
    if (!res.ok || !res.content) break;

    let json;
    try {
      json = JSON.parse(res.content);
    } catch {
      break;
    }

    const items = Array.isArray(json?.pagination?.data) ? json.pagination.data : (Array.isArray(json?.data) ? json.data : []);
    if (items.length === 0) break;

    for (const item of items) {
      const title = item.name || item.title;
      const id = item.id;
      if (!title || !id) continue;

      let cover = item.poster || item.backdrop || '';
      if (cover && !cover.startsWith('http')) {
        cover = `https://cdn.mangacix.net/file/mangacix/${cover.replace(/^\//, '')}`;
      }

      seriesList.push({
        source: 'mangacix',
        title,
        id,
        link: `https://mangacix.net/secure/titles/${id}`,
        cover,
        description: item.description || '',
        genres: (item.genres || []).map((g) => (typeof g === 'string' ? g : g?.name || '')).filter(Boolean),
        isAdult: Boolean(item.adult),
      });

      if (seriesList.length >= maxMangas) break;
    }

    page++;
    await sleep(250);
  }

  return seriesList;
};

const harvestMangaCixDetail = async (seriesItem) => {
  const url = `https://mangacix.net/secure/titles/${seriesItem.id}`;
  const res = await fetchUpstream(url, {
    headers: {
      'Referer': 'https://mangacix.net/browse',
      'X-Requested-With': 'XMLHttpRequest',
    },
  });
  if (!res.ok || !res.content) return null;

  let json;
  try {
    json = JSON.parse(res.content);
  } catch {
    return null;
  }

  const titleObj = json?.title || json?.data || json;
  const chapters = [];
  const episodes = Array.isArray(titleObj?.seasons?.[0]?.episodes)
    ? titleObj.seasons[0].episodes
    : (Array.isArray(titleObj?.episodes) ? titleObj.episodes : []);

  for (const ep of episodes) {
    const num = Number(ep.episode_number || ep.number || 0);
    const title = ep.name || `Bölüm ${num}`;
    chapters.push({
      title,
      link: `https://mangacix.net/secure/titles/${seriesItem.id}/episodes/${ep.id || num}`,
      chapterNumber: num,
      rawPages: Array.isArray(ep.pages) ? ep.pages : [],
    });
  }

  chapters.sort((a, b) => a.chapterNumber - b.chapterNumber);

  return {
    ...seriesItem,
    status: 'ongoing',
    alternativeTitles: titleObj.original_title ? [titleObj.original_title] : [],
    author: '',
    artist: '',
    chapters,
  };
};

const harvestOkutoonCatalog = async (maxMangas) => {
  logInfo('OkuToon taranıyor...');
  const seriesList = [];
  const seen = new Set();
  let page = 1;

  while (page <= 20 && seriesList.length < maxMangas) {
    const url = `https://okutoon.com/tur?sayfa=${page}`;
    const res = await fetchUpstream(url);
    if (!res.ok || !res.content) break;

    const html = res.content;
    const cardPattern = /<a[^>]+href="([^"]+)"[^>]*>[\s\S]*?<img[^>]+src="([^"]*covers[^"]*)"[^>]*>[\s\S]*?<h[23][^>]*>([\s\S]*?)<\/h[23]>/gi;
    const matches = extractRegexMatches(html, cardPattern);

    if (matches.length === 0) break;

    for (const match of matches) {
      const link = match[1]?.startsWith('http') ? match[1] : `https://okutoon.com${match[1]}`;
      const cover = match[2]?.startsWith('http') ? match[2] : `https://okutoon.com${match[2]}`;
      const title = stripTags(match[3]);

      if (link && title && !seen.has(link)) {
        seen.add(link);
        seriesList.push({
          source: 'okutoon',
          title,
          link,
          cover,
          genres: [],
          isAdult: false,
        });
        if (seriesList.length >= maxMangas) break;
      }
    }

    page++;
    await sleep(250);
  }

  return seriesList;
};

const harvestOkutoonDetail = async (seriesItem) => {
  const res = await fetchUpstream(seriesItem.link);
  if (!res.ok || !res.content) return null;

  const html = res.content;
  const descMatch = /<div class="summary__content[^"]*">([\s\S]*?)<\/div>/i.exec(html) ||
    /<meta property="og:description" content="([^"]+)"/i.exec(html);
  const description = descMatch ? stripTags(descMatch[1]) : '';

  const chapterRegex = /<a[^>]+href="([^"]*\/bolum-[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
  const chMatches = extractRegexMatches(html, chapterRegex);
  const chapters = [];
  const seenCh = new Set();

  for (const ch of chMatches) {
    const chLink = ch[1]?.startsWith('http') ? ch[1] : `https://okutoon.com${ch[1]}`;
    const chText = stripTags(ch[2]);
    if (seenCh.has(chLink)) continue;
    seenCh.add(chLink);

    const numMatch = `${chText} ${chLink}`.match(/(\d+(?:\.\d+)?)/);
    const num = numMatch ? parseFloat(numMatch[1]) : 0;
    chapters.push({
      title: chText || `Bölüm ${num}`,
      link: chLink,
      chapterNumber: num,
    });
  }

  chapters.sort((a, b) => a.chapterNumber - b.chapterNumber);

  return {
    ...seriesItem,
    description,
    status: 'ongoing',
    alternativeTitles: [],
    author: '',
    artist: '',
    chapters,
  };
};

// ============================================================================
// METADATA ENRICHMENT (AniList + MangaDex + MyAnimeList/Jikan)
// ============================================================================
const queryAniList = async (searchTerms = []) => {
  const query = `
    query ($search: String) {
      Page(perPage: 3) {
        media(search: $search, type: MANGA) {
          id
          idMal
          title {
            romaji
            english
            native
            userPreferred
          }
          synonyms
          description(asHtml: false)
          coverImage {
            extraLarge
            large
          }
          bannerImage
          genres
          isAdult
          tags {
            name
            rank
            isMediaSpoiler
          }
          characters(perPage: 12, sort: [ROLE, RELEVANCE]) {
            edges {
              role
              node {
                id
                name {
                  full
                  native
                }
                image {
                  large
                }
                description
              }
            }
          }
          staff(perPage: 8) {
            edges {
              role
              node {
                id
                name {
                  full
                }
              }
            }
          }
        }
      }
    }
  `;

  for (const term of searchTerms) {
    if (!term || term.length < 2) continue;
    try {
      const res = await fetch(ANILIST_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify({ query, variables: { search: term } }),
      });

      if (res.status === 429) {
        logWarn('AniList 429 rate limit, 2 saniye bekleniyor...');
        await sleep(2000);
        continue;
      }

      if (!res.ok) continue;

      const data = await res.json();
      const mediaList = data?.data?.Page?.media;
      if (Array.isArray(mediaList) && mediaList.length > 0) {
        return mediaList[0];
      }
    } catch {}
    await sleep(350);
  }

  return null;
};

const queryMangaDex = async (searchTerms = []) => {
  for (const term of searchTerms) {
    if (!term || term.length < 2) continue;
    try {
      const url = `${MANGADEX_API_URL}/manga?title=${encodeURIComponent(term)}&contentRating[]=safe&contentRating[]=suggestive&contentRating[]=erotica&contentRating[]=pornographic&includes[]=cover_art&includes[]=author&includes[]=artist&limit=3`;
      const res = await fetch(url, {
        headers: { 'User-Agent': DEFAULT_USER_AGENT },
      });

      if (!res.ok) continue;
      const json = await res.json();
      const items = json?.data;
      if (Array.isArray(items) && items.length > 0) {
        const manga = items[0];
        const coverRels = (manga.relationships || []).filter((r) => r.type === 'cover_art' && r.attributes?.fileName);
        const cleanCoverRel = coverRels.find((r) => {
          const fn = (r.attributes?.fileName || '').toLowerCase();
          const desc = (r.attributes?.description || '').toLowerCase();
          return !/promo|credit|endcard|end_card|discord|recruit|mangadex|reklam|tanitim|warning|card/i.test(fn)
            && !/promo|credit|endcard|end_card|discord|recruit|mangadex|reklam|tanitim|warning/i.test(desc);
        }) || coverRels[0];
        const coverFileName = cleanCoverRel?.attributes?.fileName;
        const coverUrl = (coverFileName && !isJunkCoverUrl(coverFileName))
          ? `https://uploads.mangadex.org/covers/${manga.id}/${coverFileName}`
          : '';

        return {
          id: manga.id,
          cover: coverUrl,
          title: manga.attributes?.title?.en || Object.values(manga.attributes?.title || {})[0],
          description: manga.attributes?.description?.en || '',
          altTitles: (manga.attributes?.altTitles || []).flatMap((t) => Object.values(t)),
        };
      }
    } catch {}
    await sleep(250);
  }
  return null;
};

const queryJikanMal = async (searchTerms = []) => {
  for (const term of searchTerms) {
    if (!term || term.length < 2) continue;
    try {
      const url = `${JIKAN_API_URL}?q=${encodeURIComponent(term)}&limit=3`;
      const res = await fetch(url, {
        headers: { 'User-Agent': DEFAULT_USER_AGENT },
      });

      if (res.status === 429) {
        await sleep(1500);
        continue;
      }

      if (!res.ok) continue;
      const json = await res.json();
      const items = json?.data;
      if (Array.isArray(items) && items.length > 0) {
        const manga = items[0];
        const malId = manga.mal_id;

        let characters = [];
        try {
          await sleep(350);
          const charRes = await fetch(`https://api.jikan.moe/v4/manga/${malId}/characters`, {
            headers: { 'User-Agent': DEFAULT_USER_AGENT },
          });
          if (charRes.ok) {
            const charJson = await charRes.json();
            if (Array.isArray(charJson?.data)) {
              characters = charJson.data.slice(0, 10).map((c) => ({
                name: c.character?.name,
                image: c.character?.images?.jpg?.image_url,
                role: c.role === 'Main' ? 'main' : 'supporting',
              }));
            }
          }
        } catch {}

        return {
          idMal: malId,
          title: manga.title,
          altTitles: [manga.title_english, manga.title_japanese, ...(manga.titles || []).map((t) => t.title)].filter(Boolean),
          description: manga.synopsis || '',
          cover: manga.images?.jpg?.large_image_url || manga.images?.jpg?.image_url || '',
          authors: (manga.authors || []).map((a) => a.name).filter(Boolean),
          characters,
        };
      }
    } catch {}
    await sleep(350);
  }
  return null;
};

// ============================================================================
// DEDUPLICATION & MERGING STORE
// ============================================================================
class CatalogArchiveStore {
  constructor(initialState = {}) {
    this.mangas = new Map(Object.entries(initialState.mangas || {}));
    this.characters = new Map(Object.entries(initialState.characters || {}));
    this.authors = new Map(Object.entries(initialState.authors || {}));
    this.artists = new Map(Object.entries(initialState.artists || {}));
    this.tags = new Map(Object.entries(initialState.tags || {}));

    this.mangaCharacters = [...(initialState.mangaCharacters || [])];
    this.mangaAuthors = [...(initialState.mangaAuthors || [])];
    this.mangaArtists = [...(initialState.mangaArtists || [])];
    this.mangaTags = [...(initialState.mangaTags || [])];

    this.titleKeyIndex = new Map();
    this.slugIndex = new Map();
    this.anilistIdIndex = new Map();
    this.malIdIndex = new Map();
    this.touchedSlugs = new Set();

    for (const [id, m] of this.mangas.entries()) {
      if (isBLSeries(m)) {
        this.mangas.delete(id);
        continue;
      }
      if (Array.isArray(m.chapters)) {
        for (const ch of m.chapters) {
          const num = Number(ch.chapterNumber ?? ch.number ?? 0);
          ch.title = cleanChapterTitle(ch.title, num, m.title);
        }
      }
      if (m.cover && isJunkCoverUrl(m.cover)) m.cover = '';
      if (m.banner && isJunkCoverUrl(m.banner)) m.banner = m.cover || '';

      const key = normalizeTitleKey(m.title);
      if (key) this.titleKeyIndex.set(key, id);
      if (m.slug) this.slugIndex.set(m.slug, id);
      for (const alt of m.alternativeTitles || []) {
        const altKey = normalizeTitleKey(alt);
        if (altKey) this.titleKeyIndex.set(altKey, id);
      }
      if (m.anilistId) this.anilistIdIndex.set(m.anilistId, id);
      if (m.malId) this.malIdIndex.set(m.malId, id);
    }
  }

  hydrateFromSnapshot(snapshot, tables = null) {
    if (!snapshot) return;
    if (Array.isArray(snapshot.mangas)) {
      for (const m of snapshot.mangas) {
        if (!m || !m.id || isBLSeries(m)) continue;
        if (!this.mangas.has(m.id)) {
          this.mangas.set(m.id, m);
          const key = normalizeTitleKey(m.title);
          if (key) this.titleKeyIndex.set(key, m.id);
          if (m.slug) this.slugIndex.set(m.slug, m.id);
          for (const alt of m.alternativeTitles || []) {
            const altKey = normalizeTitleKey(alt);
            if (altKey) this.titleKeyIndex.set(altKey, m.id);
          }
          if (m.anilistId) this.anilistIdIndex.set(m.anilistId, m.id);
          if (m.malId) this.malIdIndex.set(m.malId, m.id);

          const titleAdult = ADULT_TITLE_REGEX.test([m.title, ...(m.alternativeTitles || [])].join(' '));
          const genresClean = (m.genres || []).filter(
            (g) => !/^(?:\+18|18\+|yeti[şs]kin|adult|hentai|erotik|smut)$/i.test(g.trim())
          );
          if (!titleAdult && (m.anilistId || genresClean.length > 0)) {
            const hasRealAdultGenre = (m.genres || []).some((g) =>
              /^(?:hentai|erotik|erotica|pornographic|nsfw|smut)$/i.test(g.trim())
            );
            if (!hasRealAdultGenre) {
              m.isAdult = false;
              m.is_adult = false;
              m.genres = genresClean;
            }
          }
        }
      }
    }
    if (Array.isArray(snapshot.characters)) {
      for (const c of snapshot.characters) {
        if (c?.id && !this.characters.has(c.id)) this.characters.set(c.id, c);
      }
    }
    if (Array.isArray(snapshot.authors)) {
      for (const a of snapshot.authors) {
        if (a?.id && !this.authors.has(a.id)) this.authors.set(a.id, a);
      }
    }
    if (Array.isArray(snapshot.artists)) {
      for (const a of snapshot.artists) {
        if (a?.id && !this.artists.has(a.id)) this.artists.set(a.id, a);
      }
    }
    if (Array.isArray(snapshot.tags)) {
      for (const t of snapshot.tags) {
        if (t?.id && !this.tags.has(t.id)) this.tags.set(t.id, t);
      }
    }
    if (tables) {
      if (Array.isArray(tables.manga_characters)) {
        for (const r of tables.manga_characters) {
          if (!this.mangaCharacters.some((mc) => mc.manga_id === r.manga_id && mc.character_id === r.character_id)) {
            this.mangaCharacters.push(r);
          }
        }
      }
      if (Array.isArray(tables.manga_authors)) {
        for (const r of tables.manga_authors) {
          if (!this.mangaAuthors.some((ma) => ma.manga_id === r.manga_id && ma.author_id === r.author_id)) {
            this.mangaAuthors.push(r);
          }
        }
      }
      if (Array.isArray(tables.manga_artists)) {
        for (const r of tables.manga_artists) {
          if (!this.mangaArtists.some((mar) => mar.manga_id === r.manga_id && mar.artist_id === r.artist_id)) {
            this.mangaArtists.push(r);
          }
        }
      }
      if (Array.isArray(tables.manga_tags)) {
        for (const r of tables.manga_tags) {
          if (!this.mangaTags.some((mt) => mt.manga_id === r.manga_id && mt.tag_id === r.tag_id)) {
            this.mangaTags.push(r);
          }
        }
      }
    }
  }

  findMatchingMangaId(title, alternativeTitles = []) {
    const allTitles = [title, ...alternativeTitles];
    for (const t of allTitles) {
      const key = normalizeTitleKey(t);
      if (key && this.titleKeyIndex.has(key)) {
        return this.titleKeyIndex.get(key);
      }
    }
    return null;
  }

  mergeMangaRecords(keepMangaId, removeMangaId) {
    if (keepMangaId === removeMangaId) return this.mangas.get(keepMangaId);
    if (!this.mangas.has(keepMangaId) || !this.mangas.has(removeMangaId)) return null;

    const keep = this.mangas.get(keepMangaId);
    const remove = this.mangas.get(removeMangaId);

    const altSet = new Set([...(keep.alternativeTitles || []), remove.title, ...(remove.alternativeTitles || [])]);
    altSet.delete(keep.title);
    keep.alternativeTitles = Array.from(altSet);

    if (!keep.description && remove.description) keep.description = remove.description;
    if (!keep.cover && remove.cover) keep.cover = remove.cover;
    if ((!keep.author || keep.author === 'Bilinmiyor') && remove.author) keep.author = remove.author;
    if (!keep.artist && remove.artist) keep.artist = remove.artist;
    if (remove.isAdult) keep.isAdult = true;

    const existingChaptersMap = new Map();
    for (const ch of keep.chapters) {
      existingChaptersMap.set(ch.chapterNumber, ch);
    }

    for (const ch of remove.chapters || []) {
      if (!existingChaptersMap.has(ch.chapterNumber)) {
        ch.mangaId = keep.id;
        keep.chapters.push(ch);
        existingChaptersMap.set(ch.chapterNumber, ch);
      } else if (existingChaptersMap.get(ch.chapterNumber).pages.length === 0 && ch.pages?.length > 0) {
        existingChaptersMap.get(ch.chapterNumber).pages = ch.pages;
      }
    }

    keep.chapters.sort((a, b) => a.chapterNumber - b.chapterNumber);

    const sourcesSet = new Set([...(keep.sourceLinks || []), ...(remove.sourceLinks || [])]);
    keep.sourceLinks = Array.from(sourcesSet);

    for (const mc of this.mangaCharacters) {
      if (mc.manga_id === removeMangaId) mc.manga_id = keepMangaId;
    }
    for (const ma of this.mangaAuthors) {
      if (ma.manga_id === removeMangaId) ma.manga_id = keepMangaId;
    }
    for (const mar of this.mangaArtists) {
      if (mar.manga_id === removeMangaId) mar.manga_id = keepMangaId;
    }
    for (const mt of this.mangaTags) {
      if (mt.manga_id === removeMangaId) mt.manga_id = keepMangaId;
    }

    this.mangas.delete(removeMangaId);
    logInfo(`[Deduplication] Kopya seri birleştirildi: '${remove.title}' -> '${keep.title}'`);
    return keep;
  }

  addOrMergeSeries(scraped) {
    const existingId = this.findMatchingMangaId(scraped.title, scraped.alternativeTitles);

    if (existingId && this.mangas.has(existingId)) {
      const existing = this.mangas.get(existingId);

      const altSet = new Set([...(existing.alternativeTitles || []), ...(scraped.alternativeTitles || [])]);
      existing.alternativeTitles = Array.from(altSet).filter((t) => t && t !== existing.title);

      if (!existing.description && scraped.description) {
        existing.description = scraped.description;
      }
      if (!existing.cover && scraped.cover) {
        existing.cover = scraped.cover;
      }
      if ((!existing.author || existing.author === 'Bilinmiyor') && scraped.author) {
        existing.author = scraped.author;
      }
      if (!existing.artist && scraped.artist) {
        existing.artist = scraped.artist;
      }
      if (scraped.isAdult) {
        existing.isAdult = true;
      }

      const existingChaptersMap = new Map();
      for (const ch of existing.chapters) {
        existingChaptersMap.set(ch.chapterNumber, ch);
      }

      for (const ch of scraped.chapters || []) {
        if (!existingChaptersMap.has(ch.chapterNumber)) {
          const newCh = {
            id: randomUUID(),
            mangaId: existing.id,
            chapterNumber: ch.chapterNumber,
            title: ch.title,
            pages: ch.pages || [],
            releaseDate: new Date().toISOString(),
            views: 0,
            _sourceLink: ch.link,
          };
          existing.chapters.push(newCh);
          existingChaptersMap.set(ch.chapterNumber, newCh);
        } else if (existingChaptersMap.get(ch.chapterNumber).pages.length === 0 && Array.isArray(ch.pages) && ch.pages.length > 0) {
          existingChaptersMap.get(ch.chapterNumber).pages = ch.pages;
        }
      }

      existing.chapters.sort((a, b) => a.chapterNumber - b.chapterNumber);
      existing.updatedAt = new Date().toISOString();
      if (existing.slug) this.touchedSlugs.add(existing.slug);
      this.syncScrapedMetadata(existing.id, scraped);
      return existing;
    }

    const mangaId = randomUUID();
    let baseSlug = slugify(scraped.title);
    if (!baseSlug) baseSlug = `manga-${Date.now()}`;
    let finalSlug = baseSlug;
    let counter = 1;
    while (this.slugIndex.has(finalSlug)) {
      finalSlug = `${baseSlug}-${counter++}`;
    }

    const now = new Date().toISOString();
    const newManga = {
      id: mangaId,
      title: scraped.title,
      alternativeTitles: (scraped.alternativeTitles || []).filter((t) => t && t !== scraped.title),
      description: scraped.description || '',
      cover: scraped.cover || '',
      banner: scraped.cover || '',
      author: scraped.author || 'Bilinmiyor',
      artist: scraped.artist || undefined,
      status: scraped.status || 'ongoing',
      type: 'webtoon',
      genres: scraped.genres || [],
      isAdult: Boolean(scraped.isAdult),
      releaseYear: undefined,
      slug: finalSlug,
      views: 0,
      ratings: [],
      chapters: [],
      sourceLinks: scraped.link ? [{ source: scraped.source, url: scraped.link }] : [],
      details: {},
      createdAt: now,
      updatedAt: now,
    };

    if (Array.isArray(scraped.chapters)) {
      for (const ch of scraped.chapters) {
        newManga.chapters.push({
          id: randomUUID(),
          mangaId,
          chapterNumber: ch.chapterNumber,
          title: ch.title,
          pages: ch.pages || [],
          releaseDate: now,
          views: 0,
          _sourceLink: ch.link,
        });
      }
    }

    newManga.chapters.sort((a, b) => a.chapterNumber - b.chapterNumber);

    this.mangas.set(mangaId, newManga);
    this.slugIndex.set(finalSlug, mangaId);
    if (finalSlug) this.touchedSlugs.add(finalSlug);

    const titleKey = normalizeTitleKey(scraped.title);
    if (titleKey) this.titleKeyIndex.set(titleKey, mangaId);
    for (const alt of newManga.alternativeTitles) {
      const altKey = normalizeTitleKey(alt);
      if (altKey) this.titleKeyIndex.set(altKey, mangaId);
    }

    this.syncScrapedMetadata(mangaId, scraped);
    return newManga;
  }

  syncScrapedMetadata(mangaId, scraped) {
    if (!mangaId || !scraped) return;

    // Authors
    if (scraped.author && scraped.author !== 'Bilinmiyor') {
      const parts = scraped.author.split(/[,&/]/).map((s) => s.trim()).filter((s) => s.length > 1);
      for (const authName of parts) {
        const authKey = normalizeTitleKey(authName);
        let authorId = null;
        for (const [aId, aObj] of this.authors.entries()) {
          if (normalizeTitleKey(aObj.name) === authKey) {
            authorId = aId;
            break;
          }
        }
        if (!authorId) {
          authorId = randomUUID();
          this.authors.set(authorId, { id: authorId, name: authName });
        }
        if (!this.mangaAuthors.some((ma) => ma.manga_id === mangaId && ma.author_id === authorId)) {
          this.mangaAuthors.push({ manga_id: mangaId, author_id: authorId });
        }
      }
    }

    // Artists
    if (scraped.artist && scraped.artist !== 'Bilinmiyor') {
      const parts = scraped.artist.split(/[,&/]/).map((s) => s.trim()).filter((s) => s.length > 1);
      for (const artName of parts) {
        const artKey = normalizeTitleKey(artName);
        let artistId = null;
        for (const [arId, arObj] of this.artists.entries()) {
          if (normalizeTitleKey(arObj.name) === artKey) {
            artistId = arId;
            break;
          }
        }
        if (!artistId) {
          artistId = randomUUID();
          this.artists.set(artistId, { id: artistId, name: artName });
        }
        if (!this.mangaArtists.some((mar) => mar.manga_id === mangaId && mar.artist_id === artistId)) {
          this.mangaArtists.push({ manga_id: mangaId, artist_id: artistId });
        }
      }
    }

    // Genres -> Tags
    if (Array.isArray(scraped.genres)) {
      for (const g of scraped.genres) {
        if (!g || typeof g !== 'string') continue;
        const tagName = g.trim();
        if (tagName.length < 2) continue;
        const tagKey = normalizeTitleKey(tagName);
        let tagId = null;
        for (const [tId, tObj] of this.tags.entries()) {
          if (normalizeTitleKey(tObj.name) === tagKey) {
            tagId = tId;
            break;
          }
        }
        if (!tagId) {
          tagId = randomUUID();
          this.tags.set(tagId, { id: tagId, name: tagName });
        }
        if (!this.mangaTags.some((mt) => mt.manga_id === mangaId && mt.tag_id === tagId)) {
          this.mangaTags.push({ manga_id: mangaId, tag_id: tagId });
        }
      }
    }
  }

  enrichWithAniList(mangaId, anilistData) {
    if (!this.mangas.has(mangaId) || !anilistData) return mangaId;
    let finalId = mangaId;

    if (anilistData.id) {
      if (this.anilistIdIndex.has(anilistData.id)) {
        const existingId = this.anilistIdIndex.get(anilistData.id);
        if (existingId !== mangaId) {
          this.mergeMangaRecords(existingId, mangaId);
          finalId = existingId;
        }
      } else {
        this.anilistIdIndex.set(anilistData.id, finalId);
      }
    }

    const manga = this.mangas.get(finalId);
    if (!manga) return finalId;
    manga.anilistId = anilistData.id;

    const titles = [
      anilistData.title?.romaji,
      anilistData.title?.english,
      anilistData.title?.native,
      anilistData.title?.userPreferred,
      ...(anilistData.synonyms || []),
    ].filter(Boolean);

    const altSet = new Set([...manga.alternativeTitles, ...titles]);
    altSet.delete(manga.title);
    manga.alternativeTitles = Array.from(altSet);

    for (const t of manga.alternativeTitles) {
      const k = normalizeTitleKey(t);
      if (k) this.titleKeyIndex.set(k, finalId);
    }

    if (anilistData.coverImage?.extraLarge) {
      manga.cover = anilistData.coverImage.extraLarge;
    }
    if (anilistData.bannerImage) {
      manga.banner = anilistData.bannerImage;
    }
    if ((!manga.description || manga.description.length < 30) && anilistData.description) {
      manga.description = anilistData.description;
    }
    if (anilistData.isAdult !== undefined && anilistData.isAdult !== null) {
      if (anilistData.isAdult === true) {
        manga.isAdult = true;
        if (!manga.genres.includes('+18')) manga.genres.push('+18');
      } else {
        const titleAdult = ADULT_TITLE_REGEX.test(
          [manga.title, ...(manga.alternativeTitles || [])].join(' ')
        );
        if (!titleAdult) {
          manga.isAdult = false;
          manga.genres = (manga.genres || []).filter(
            (g) => !/^(?:\+18|18\+|yeti[şs]kin|adult|hentai|erotik|smut)$/i.test(g.trim())
          );
        }
      }
    }

    const charEdges = anilistData.characters?.edges || [];
    for (const edge of charEdges) {
      const node = edge.node;
      if (!node || !node.name?.full) continue;

      const charName = node.name.full;
      const charKey = normalizeTitleKey(charName);
      let charId = null;

      for (const [cId, cObj] of this.characters.entries()) {
        if (normalizeTitleKey(cObj.name) === charKey) {
          charId = cId;
          break;
        }
      }

      if (!charId) {
        charId = randomUUID();
        this.characters.set(charId, {
          id: charId,
          name: charName,
          alternativeName: node.name.native || undefined,
          role: edge.role === 'MAIN' ? 'main' : 'supporting',
          image: node.image?.large || undefined,
          description: node.description ? node.description.slice(0, 1000) : undefined,
        });
      }

      if (!this.mangaCharacters.some((mc) => mc.manga_id === finalId && mc.character_id === charId)) {
        this.mangaCharacters.push({
          manga_id: finalId,
          character_id: charId,
          listing_role: edge.role === 'MAIN' ? 'main' : 'supporting',
        });
      }
    }

    const staffEdges = anilistData.staff?.edges || [];
    for (const edge of staffEdges) {
      const node = edge.node;
      const role = (edge.role || '').toLowerCase();
      if (!node || !node.name?.full) continue;

      const staffName = node.name.full;
      const staffKey = normalizeTitleKey(staffName);

      if (role.includes('story') || role.includes('original') || role.includes('author')) {
        let authorId = null;
        for (const [aId, aObj] of this.authors.entries()) {
          if (normalizeTitleKey(aObj.name) === staffKey) {
            authorId = aId;
            break;
          }
        }
        if (!authorId) {
          authorId = randomUUID();
          this.authors.set(authorId, { id: authorId, name: staffName });
        }
        if (!this.mangaAuthors.some((ma) => ma.manga_id === finalId && ma.author_id === authorId)) {
          this.mangaAuthors.push({ manga_id: finalId, author_id: authorId });
        }
        if (manga.author === 'Bilinmiyor') manga.author = staffName;
      }

      if (role.includes('art') || role.includes('illustrator')) {
        let artistId = null;
        for (const [arId, arObj] of this.artists.entries()) {
          if (normalizeTitleKey(arObj.name) === staffKey) {
            artistId = arId;
            break;
          }
        }
        if (!artistId) {
          artistId = randomUUID();
          this.artists.set(artistId, { id: artistId, name: staffName });
        }
        if (!this.mangaArtists.some((mar) => mar.manga_id === finalId && mar.artist_id === artistId)) {
          this.mangaArtists.push({ manga_id: finalId, artist_id: artistId });
        }
        if (!manga.artist) manga.artist = staffName;
      }
    }

    const tagList = anilistData.tags || [];
    for (const t of tagList) {
      if (!t.name || t.rank < 30) continue;
      const tagName = t.name;
      const tagKey = normalizeTitleKey(tagName);
      let tagId = null;

      for (const [tgId, tgObj] of this.tags.entries()) {
        if (normalizeTitleKey(tgObj.name) === tagKey) {
          tagId = tgId;
          break;
        }
      }

      if (!tagId) {
        tagId = randomUUID();
        this.tags.set(tagId, { id: tagId, name: tagName });
      }

      if (!this.mangaTags.some((mt) => mt.manga_id === finalId && mt.tag_id === tagId)) {
        this.mangaTags.push({ manga_id: finalId, tag_id: tagId });
      }
    }

    return finalId;
  }

  enrichWithJikan(mangaId, jikanData) {
    if (!this.mangas.has(mangaId) || !jikanData) return mangaId;
    let finalId = mangaId;

    if (jikanData.idMal) {
      if (this.malIdIndex.has(jikanData.idMal)) {
        const existingId = this.malIdIndex.get(jikanData.idMal);
        if (existingId !== mangaId) {
          this.mergeMangaRecords(existingId, mangaId);
          finalId = existingId;
        }
      } else {
        this.malIdIndex.set(jikanData.idMal, finalId);
      }
    }

    const manga = this.mangas.get(finalId);
    if (!manga) return finalId;
    manga.malId = jikanData.idMal;

    if (jikanData.cover && (!manga.cover || manga.cover.includes('placeholder'))) {
      manga.cover = jikanData.cover;
    }
    if ((!manga.description || manga.description.length < 30) && jikanData.description) {
      manga.description = jikanData.description;
    }
    const altSet = new Set([...manga.alternativeTitles, ...(jikanData.altTitles || [])]);
    altSet.delete(manga.title);
    manga.alternativeTitles = Array.from(altSet);

    for (const t of manga.alternativeTitles) {
      const k = normalizeTitleKey(t);
      if (k) this.titleKeyIndex.set(k, finalId);
    }

    for (const char of jikanData.characters || []) {
      if (!char.name) continue;
      const charKey = normalizeTitleKey(char.name);
      let charId = null;
      for (const [cId, cObj] of this.characters.entries()) {
        if (normalizeTitleKey(cObj.name) === charKey) {
          charId = cId;
          break;
        }
      }
      if (!charId) {
        charId = randomUUID();
        this.characters.set(charId, {
          id: charId,
          name: char.name,
          role: char.role,
          image: char.image,
        });
      }
      if (!this.mangaCharacters.some((mc) => mc.manga_id === finalId && mc.character_id === charId)) {
        this.mangaCharacters.push({
          manga_id: finalId,
          character_id: charId,
          listing_role: char.role,
        });
      }
    }

    return finalId;
  }

  toSnapshotPayload() {
    const lightweightMangas = Array.from(this.mangas.values()).map((m) => {
      const { chapters, ...rest } = m;
      return {
        ...rest,
        chapters: (chapters || []).map((ch) => ({
          id: ch.id,
          chapterNumber: ch.chapterNumber ?? ch.number,
          title: ch.title,
          releaseDate: ch.releaseDate,
          views: ch.views || 0,
        })),
        chapterCount: (chapters || []).length,
      };
    });

    return {
      version: 1,
      updatedAt: new Date().toISOString(),
      mangas: lightweightMangas,
      characters: Array.from(this.characters.values()),
      authors: Array.from(this.authors.values()),
      artists: Array.from(this.artists.values()),
      tags: Array.from(this.tags.values()),
      mangaRelationships: [],
    };
  }

  toTablesPayload() {
    const now = new Date().toISOString();

    const mangasRows = Array.from(this.mangas.values()).map((m) => ({
      id: m.id,
      title: m.title,
      slug: m.slug,
      author: m.author || 'Bilinmiyor',
      artist: m.artist || m.author || 'Bilinmiyor',
      is_public: true,
      is_adult: Boolean(m.isAdult),
      description: m.description || '',
      cover: m.cover || '',
      banner: m.banner || m.cover || '',
      genres: Array.isArray(m.genres) ? m.genres : [],
      status: m.status || 'ongoing',
      type: m.type || 'webtoon',
      views: m.views || 0,
      release_year: m.releaseYear || null,
      alternative_titles: Array.isArray(m.alternativeTitles) ? m.alternativeTitles : [],
      details: m.details || {},
      source_links: Array.isArray(m.sourceLinks) ? m.sourceLinks : [],
      last_updated: m.updatedAt || now,
      created_at: m.createdAt || now,
    }));

    const chaptersRows = Array.from(this.mangas.values()).flatMap((m) =>
      (m.chapters || []).map((ch) => ({
        id: ch.id,
        manga_id: m.id,
        number: Number(ch.chapterNumber ?? ch.number ?? 0),
        title: ch.title || `Bölüm ${ch.chapterNumber ?? ch.number ?? 0}`,
        pages: [], // Sayfalar series/<slug>.json içinde tutulur
        views: ch.views || 0,
        release_date: ch.releaseDate || now,
        created_at: ch.createdAt || now,
      }))
    );

    const charactersRows = Array.from(this.characters.values()).map((entity) => ({
      id: entity.id,
      name: entity.name,
      image_url: entity.image || entity.image_url || null,
      description: entity.description || '',
      likes_count: 0,
      is_public: true,
      alternative_names: entity.alternativeName ? [entity.alternativeName] : (entity.alternative_names || []),
      details: entity.details || {},
      gallery: [],
      source_links: [],
      created_at: now,
    }));

    const authorsRows = Array.from(this.authors.values()).map((entity) => ({
      id: entity.id,
      name: entity.name,
      image_url: entity.image || entity.image_url || null,
      description: entity.description || '',
      likes_count: 0,
      is_public: true,
      alternative_names: entity.alternativeName ? [entity.alternativeName] : (entity.alternative_names || []),
      details: entity.details || {},
      gallery: [],
      source_links: [],
      created_at: now,
    }));

    const artistsRows = Array.from(this.artists.values()).map((entity) => ({
      id: entity.id,
      name: entity.name,
      image_url: entity.image || entity.image_url || null,
      description: entity.description || '',
      likes_count: 0,
      is_public: true,
      alternative_names: entity.alternativeName ? [entity.alternativeName] : (entity.alternative_names || []),
      details: entity.details || {},
      gallery: [],
      source_links: [],
      created_at: now,
    }));

    const tagsRows = Array.from(this.tags.values()).map((tag) => ({
      id: tag.id,
      name: tag.name,
      slug: slugify(tag.name),
      category: 'theme',
      is_official: true,
      created_at: now,
    }));

    return {
      mangas: mangasRows,
      chapters: chaptersRows,
      characters: charactersRows,
      authors: authorsRows,
      artists: artistsRows,
      tags: tagsRows,
      manga_characters: this.mangaCharacters,
      manga_authors: this.mangaAuthors,
      manga_artists: this.mangaArtists,
      manga_tags: this.mangaTags,
      manga_relations: [],
      character_tags: [],
      author_tags: [],
      artist_tags: [],
      chapter_automations: [],
      chapter_automation_runs: [],
    };
  }

  toState() {
    return {
      version: 2,
      mangas: Object.fromEntries(this.mangas.entries()),
      characters: Object.fromEntries(this.characters.entries()),
      authors: Object.fromEntries(this.authors.entries()),
      artists: Object.fromEntries(this.artists.entries()),
      tags: Object.fromEntries(this.tags.entries()),
      mangaCharacters: this.mangaCharacters,
      mangaAuthors: this.mangaAuthors,
      mangaArtists: this.mangaArtists,
      mangaTags: this.mangaTags,
    };
  }
}

// --- Full Series Disk Cache Helper ---
const getFullSeriesPayload = (manga) => {
  if (!manga?.slug) return manga;
  const seriesFilePath = path.join(SERIES_CACHE_DIR, `${manga.slug}.json`);
  if (existsSync(seriesFilePath)) {
    try {
      return JSON.parse(readFileSync(seriesFilePath, 'utf8'));
    } catch {}
  }
  return manga;
};

// --- R2 Upload Engine ---
const uploadToCatalogWorker = async (store, options = {}) => {
  if (!CATALOG_ADMIN_TOKEN) {
    logWarn('CATALOG_ADMIN_TOKEN .env içinde tanımlı değil, R2 yüklemesi atlanıyor.');
    return;
  }

  logInfo('R2 Catalog Worker veritabanı tabloları senkronizasyonu başlatılıyor...');
  const tablesPayload = store.toTablesPayload();

  // 1. PostgREST Tablolarını tek tek R2'ye aktar (Hafif ve sıfır 1102 / 503 garantili)
  const metaTables = [
    'mangas',
    'characters',
    'authors',
    'artists',
    'tags',
    'manga_characters',
    'manga_authors',
    'manga_artists',
    'manga_tags',
  ];

  for (const tbl of metaTables) {
    const rows = tablesPayload[tbl] || [];
    try {
      const res = await fetch(`${CATALOG_WORKER_URL}/v1/admin/table/${tbl}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-Catalog-Admin-Token': CATALOG_ADMIN_TOKEN,
        },
        body: JSON.stringify(rows),
      });
      if (res.ok) {
        logInfo(`R2 Tablo senkronize edildi: ${tbl} (${rows.length} kayıt)`);
      } else {
        logWarn(`R2 Tablo '${tbl}' yanıtı HTTP ${res.status}`);
      }
    } catch (err) {
      logError(`R2 Tablo '${tbl}' yüklenirken hata: ${err.message}`);
    }
  }

  // 2. Chapters tablosunu hafif formatta (PostgREST index) yükle
  if (Array.isArray(tablesPayload.chapters) && tablesPayload.chapters.length > 0) {
    try {
      const lightweightChapters = tablesPayload.chapters.map((ch) => ({
        id: ch.id,
        manga_id: ch.manga_id,
        number: ch.number,
        title: ch.title,
        pages: [], // Sayfalar series/<slug>.json içinde tutulur
        views: ch.views || 0,
        release_date: ch.release_date,
        created_at: ch.created_at,
      }));

      const res = await fetch(`${CATALOG_WORKER_URL}/v1/admin/table/chapters`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-Catalog-Admin-Token': CATALOG_ADMIN_TOKEN,
        },
        body: JSON.stringify(lightweightChapters),
      });
      if (res.ok) {
        logInfo(`R2 Tablo senkronize edildi: chapters (${lightweightChapters.length} bölüm indeksi)`);
      } else {
        logWarn(`R2 chapters tablosu yanıtı HTTP ${res.status}`);
      }
    } catch (err) {
      logError(`R2 chapters tablosu yüklenirken hata: ${err.message}`);
    }
  }

  // 3. Tekil Serileri (/v1/admin/series/:slug) doğrudan tam sayfalarıyla R2'ye yükle (SADECE yeni/güncellenenler)
  const allMangas = Array.from(store.mangas.values());
  const mangasToUpload = options.all
    ? allMangas
    : allMangas.filter((m) => store.touchedSlugs?.has(m.slug));

  if (mangasToUpload.length > 0) {
    logInfo(`Yeni/güncellenen seri detayları R2'ye yükleniyor (${mangasToUpload.length} seri)...`);
    for (let i = 0; i < mangasToUpload.length; i += 6) {
      const chunk = mangasToUpload.slice(i, i + 6);
      await Promise.all(chunk.map(async (m) => {
        if (!m.slug) return;
        try {
          const payload = getFullSeriesPayload(m);
          await fetch(`${CATALOG_WORKER_URL}/v1/admin/series/${m.slug}`, {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
              'X-Catalog-Admin-Token': CATALOG_ADMIN_TOKEN,
            },
            body: JSON.stringify(payload),
          });
        } catch {}
      }));
    }
    if (!options.all && store.touchedSlugs) {
      store.touchedSlugs.clear();
    }
  }

  // 4. Snapshot R2 yüklemesi
  try {
    await fetch(`${CATALOG_WORKER_URL}/v1/admin/catalog/snapshot`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'X-Catalog-Admin-Token': CATALOG_ADMIN_TOKEN,
      },
      body: JSON.stringify(store.toSnapshotPayload()),
    });
  } catch {}

  // 5. Supabase PostgreSQL Aynası
  if (process.env.VITE_SUPABASE_URL && process.env.VITE_SUPABASE_ANON_KEY && CATALOG_ADMIN_TOKEN) {
    try {
      await fetch(`${process.env.VITE_SUPABASE_URL}/rest/v1/rpc/sync_r2_catalog_to_supabase`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: process.env.VITE_SUPABASE_ANON_KEY,
          Authorization: `Bearer ${process.env.VITE_SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({
          p_admin_token: CATALOG_ADMIN_TOKEN,
          p_payload: {
            mangas: tablesPayload.mangas,
            characters: tablesPayload.characters,
            authors: tablesPayload.authors,
            artists: tablesPayload.artists,
            tags: tablesPayload.tags,
            manga_characters: tablesPayload.manga_characters,
            manga_authors: tablesPayload.manga_authors,
            manga_artists: tablesPayload.manga_artists,
            manga_tags: tablesPayload.manga_tags,
            chapter_automations: tablesPayload.chapter_automations || [],
            chapter_automation_runs: tablesPayload.chapter_automation_runs || [],
            replace_chapter_automations: true,
          },
        }),
      });
    } catch {}
  }
};

// ============================================================================
// MAIN RUNNER (2 Aşamalı Kalıcı Kuyruk Motoru)
// ============================================================================
const main = async () => {
  acquirePidLock();
  console.log('='.repeat(70));
  console.log('   TOONPARROT - PERSISTENT ARCHIVE HARVESTER & SPEED ENGINE   ');
  console.log('='.repeat(70));
  logInfo(`Mod: ${IS_FULL ? 'FULL (Tüm Arşiv)' : `LIMIT (${LIMIT})`} | Resume: ${IS_RESUME} | DryRun: ${IS_DRY_RUN}`);

  const checkpoint = loadCheckpoint();
  const store = new CatalogArchiveStore(checkpoint);
  const seriesQueue = checkpoint.seriesQueue || {};

  // Auto-Hydrate from R2 Catalog Worker (additive merge with existing remote data)
  try {
    logInfo('R2 Catalog Worker mevcut snapshot ve tablolar kontrol ediliyor...');
    const [snapRes, tablesRes] = await Promise.all([
      fetch(`${CATALOG_WORKER_URL}/v1/catalog/snapshot`, { signal: AbortSignal.timeout(8000) }),
      fetch(`${CATALOG_WORKER_URL}/v1/catalog/tables`, { signal: AbortSignal.timeout(8000) }),
    ]);
    if (snapRes.ok) {
      const snapJson = await snapRes.json();
      const tablesJson = tablesRes.ok ? (await tablesRes.json()).tables : null;
      store.hydrateFromSnapshot(snapJson, tablesJson);
      logInfo(`R2'den veriler yüklendi: ${store.mangas.size} manga, ${store.characters.size} karakter, ${store.authors.size} yazar, ${store.tags.size} etiket.`);
    }
  } catch (err) {
    logWarn(`R2 Auto-hydrate atlandı: ${err.message}`);
  }

  // ==========================================================================
  // AŞAMA 1: Katalog Keşif & İndeksleme (Kalıcı Kuyruğa Kayıt)
  // ==========================================================================
  logInfo('--- AŞAMA 1: Katalog Keşif ve Kuyruk Güncelleme ---');

  const addCardsToQueue = (cards) => {
    let newCount = 0;
    for (const c of cards) {
      if (isBLSeries(c)) continue;
      if (!seriesQueue[c.link]) {
        seriesQueue[c.link] = {
          ...c,
          isAdult: Boolean(c.isAdult),
          genres: c.genres || [],
          status: 'pending',
          totalChaptersFound: 0,
          completedChaptersCount: 0,
          updatedAt: new Date().toISOString(),
        };
        newCount++;
      }
    }
    return newCount;
  };

  const hasExistingQueue = Object.keys(seriesQueue).length > 0;
  if (IS_RESUME && hasExistingQueue) {
    logInfo(`Resume modu: Mevcut kuyruk (${Object.keys(seriesQueue).length} seri) kullanılıyor, tam katalog taraması atlandı.`);
    try {
      const smCards = await harvestSiyahMelekCatalog(LIMIT);
      const added = addCardsToQueue(smCards);
      if (added > 0) logInfo(`SiyahMelek: +${added} yeni seri kuyruğa eklendi.`);
    } catch (e) {
      logWarn(`SiyahMelek sitemap tazelenemedi: ${e.message}`);
    }
  } else {
    const discoveryTasks = [];

    if (!TARGET_SOURCE || TARGET_SOURCE === 'webtoonhatti') {
      discoveryTasks.push(harvestWebtoonHattiCatalog(LIMIT).then((c) => logInfo(`WebtoonHattı: +${addCardsToQueue(c)} yeni seri kuyruğa eklendi.`)));
    }
    if (!TARGET_SOURCE || TARGET_SOURCE === 'siyahmelek') {
      discoveryTasks.push(harvestSiyahMelekCatalog(LIMIT).then((c) => logInfo(`SiyahMelek: +${addCardsToQueue(c)} yeni seri kuyruğa eklendi.`)));
    }
    if (!TARGET_SOURCE || TARGET_SOURCE === 'hattorimanga') {
      discoveryTasks.push(harvestHattoriMangaCatalog(LIMIT).then((c) => logInfo(`HattoriManga: +${addCardsToQueue(c)} yeni seri kuyruğa eklendi.`)));
    }
    if (!TARGET_SOURCE || TARGET_SOURCE === 'golgebahcesi') {
      discoveryTasks.push(harvestGolgeBahcesiCatalog(LIMIT).then((c) => logInfo(`GölgeBahçesi: +${addCardsToQueue(c)} yeni seri kuyruğa eklendi.`)));
    }
    if (!TARGET_SOURCE || TARGET_SOURCE === 'dxdfansub') {
      discoveryTasks.push(harvestDxDFansubCatalog(LIMIT).then((c) => logInfo(`DxDFansub: +${addCardsToQueue(c)} yeni seri kuyruğa eklendi.`)));
    }
    if (!TARGET_SOURCE || TARGET_SOURCE === 'mangacix') {
      discoveryTasks.push(harvestMangaCixCatalog(LIMIT).then((c) => logInfo(`MangaCix: +${addCardsToQueue(c)} yeni seri kuyruğa eklendi.`)));
    }
    if (!TARGET_SOURCE || TARGET_SOURCE === 'okutoon') {
      discoveryTasks.push(harvestOkutoonCatalog(LIMIT).then((c) => logInfo(`OkuToon: +${addCardsToQueue(c)} yeni seri kuyruğa eklendi.`)));
    }

    await Promise.all(discoveryTasks);
  }

  // Kuyruk durumunu kaydet
  checkpoint.seriesQueue = seriesQueue;
  saveCheckpoint({ ...checkpoint, ...store.toState() });

  const totalInQueue = Object.keys(seriesQueue).length;
  const pendingSeries = Object.values(seriesQueue).filter((s) => s.status === 'pending' || s.status === 'partial');
  logInfo(`Kuyrukta toplam ${totalInQueue} seri mevcut. İşlenecek kalan seri: ${pendingSeries.length}`);

  // ==========================================================================
  // AŞAMA 2: Yüksek Hızlı Seri & Bölüm Çekimi (Paralel Worker Havuzu)
  // ==========================================================================
  logInfo(`--- AŞAMA 2: Yüksek Hızlı İndirme & Zenginleştirme (Paralel: ${SERIES_CONCURRENCY} seri x ${CHAPTER_CONCURRENCY} bölüm) ---`);

  let processedCount = totalInQueue - pendingSeries.length;

  // Dengeli dağıtım: serileri kaynaklar arasında round-robin diz
  const pendingBySource = {};
  for (const s of pendingSeries) {
    const src = s.source || 'other';
    if (!pendingBySource[src]) pendingBySource[src] = [];
    pendingBySource[src].push(s);
  }
  const balancedPending = [];
  let hasMore = true;
  let roundIdx = 0;
  while (hasMore) {
    hasMore = false;
    for (const src of Object.keys(pendingBySource)) {
      if (roundIdx < pendingBySource[src].length) {
        balancedPending.push(pendingBySource[src][roundIdx]);
        hasMore = true;
      }
    }
    roundIdx++;
  }

  const targetToProcess = balancedPending.slice(0, LIMIT === Infinity ? balancedPending.length : LIMIT);

  // Tekil Seri İşleme Fonksiyonu
  const processSeriesItem = async (card) => {
    if (isBLSeries(card)) {
      card.status = 'skipped_bl';
      card.updatedAt = new Date().toISOString();
      delete seriesQueue[card.link];
      return;
    }

    card.title = cleanSeriesTitle(card.title);
    const titleKey = normalizeTitleKey(card.title);
    const existingId = store.titleKeyIndex.get(titleKey);
    if (existingId && store.mangas.has(existingId)) {
      const existing = store.mangas.get(existingId);
      if (Array.isArray(existing.chapters) && existing.chapters.length > 0) {
        logProgress(processedCount + 1, totalInQueue, card.title, `Mevcut (${existing.chapters.length} bölüm) - Atlandı`);
        card.status = 'completed';
        delete seriesQueue[card.link];
        processedCount++;
        return;
      }
    }

    logProgress(processedCount + 1, totalInQueue, card.title, `Detay çekiliyor [${card.source}${card.isAdult ? ' / +18' : ''}]`);

    let detail = null;
    try {
      if (card.source === 'webtoonhatti') {
        detail = await harvestWebtoonHattiDetail(card);
      } else if (card.source === 'siyahmelek') {
        detail = await harvestSiyahMelekDetail(card);
      } else if (card.source === 'hattorimanga') {
        detail = await harvestWebtoonHattiDetail(card);
      } else if (card.source === 'golgebahcesi') {
        detail = await harvestGolgeBahcesiDetail(card);
      } else if (card.source === 'dxdfansub') {
        detail = await harvestDxDFansubDetail(card);
      } else if (card.source === 'mangacix') {
        detail = await harvestMangaCixDetail(card);
      } else if (card.source === 'okutoon') {
        detail = await harvestOkutoonDetail(card);
      }
    } catch (e) {
      logWarn(`${card.title} detay hatası: ${e.message}`);
    }

    if (!detail || isBLSeries(detail)) {
      if (detail && isBLSeries(detail)) {
        card.status = 'skipped_bl';
        delete seriesQueue[card.link];
      } else {
        card.status = 'failed';
        delete seriesQueue[card.link];
      }
      return;
    }

    detail.title = cleanSeriesTitle(detail.title);

    const totalChs = detail.chapters.length;
    card.totalChaptersFound = totalChs;
    const validChapters = [];

    // Bölümleri 6'lı paralel gruplarla çek
    for (let i = 0; i < totalChs; i += CHAPTER_CONCURRENCY) {
      const chunk = detail.chapters.slice(i, i + CHAPTER_CONCURRENCY);
      const results = await Promise.all(chunk.map(async (ch) => {
        let imageUrls = [];
        try {
          if ((card.source === 'webtoonhatti' || card.source === 'hattorimanga') && ch.link && !SKIP_IMAGES) {
            imageUrls = await harvestWebtoonHattiChapterImages(ch.link);
          } else if (card.source === 'siyahmelek' && ch.link && !SKIP_IMAGES) {
            imageUrls = await harvestSiyahMelekChapterImages(ch.link);
          } else if ((card.source === 'golgebahcesi' || card.source === 'dxdfansub') && ch.chapterId && !SKIP_IMAGES) {
            const apiDomain = card.source === 'golgebahcesi' ? 'api.golgebahcesi.com' : 'api.dxdfansub.com';
            const chRes = await fetchUpstream(`https://${apiDomain}/api/chapters/${ch.chapterId}`);
            if (chRes.ok && chRes.content) {
              try {
                const chData = JSON.parse(chRes.content);
                if (Array.isArray(chData.pages)) {
                  const rawPages = chData.pages.map((p) => {
                    const u = p?.url || p;
                    if (!u || typeof u !== 'string') return null;
                    return u.startsWith('http') ? u : `https://${apiDomain}${u}`;
                  }).filter(Boolean);
                  imageUrls = await verifyAndFilterImageUrls(rawPages);
                }
              } catch {}
            }
          } else if (Array.isArray(ch.rawPages) && ch.rawPages.length > 0) {
            const rawUrls = ch.rawPages.map((p) => (typeof p === 'string' ? p : p?.url || p?.src)).filter(Boolean);
            imageUrls = await verifyAndFilterImageUrls(rawUrls);
          }
        } catch {}

        if (!SKIP_IMAGES && imageUrls.length === 0) return null;
        return { ...ch, pages: imageUrls };
      }));

      for (const valid of results) {
        if (valid) validChapters.push(valid);
      }
    }

    // Hiçbir çalışan bölüm kalmadıysa seriyi kaydetme
    if (!SKIP_IMAGES && validChapters.length === 0) {
      logWarn(`Seri elendi (0 çalışan bölüm): ${card.title}`);
      card.status = 'failed';
      return;
    }

    detail.chapters = validChapters;
    card.completedChaptersCount = validChapters.length;

    // Deduplication & Birleştirme
    const manga = store.addOrMergeSeries(detail);

    // Kapak sağlamlık kontrolü
    let isCoverValid = false;
    if (manga.cover) {
      isCoverValid = await verifyImageUrl(manga.cover);
    }

    // Arama Terimleri & Fallback Çeviri
    const cleanSearchTerm = (str) => {
      if (!str) return '';
      return str
        .replace(/\b(türkçe|oku|webtoon|manhwa|manga|sansürsüz|güncel|bölüm|sezon)\b/gi, ' ')
        .replace(/[–—\-:_|]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    };

    const slugTerm = card.link.split('/').filter(Boolean).pop().replace(/-/g, ' ');
    const translatedTerm = await translateTitleToEnglish(manga.title);
    const searchTerms = [
      ...manga.alternativeTitles.map(cleanSearchTerm),
      cleanSearchTerm(translatedTerm),
      cleanSearchTerm(slugTerm),
      cleanSearchTerm(manga.title),
      manga.title,
    ].filter((t) => t && t.length > 2);

    // AniList / MangaDex / MAL Zenginleştirme
    try {
      const anilistMedia = await queryAniList(searchTerms);
      if (anilistMedia) {
        const finalMangaId = store.enrichWithAniList(manga.id, anilistMedia);
        const hasCharacters = store.mangaCharacters.some((mc) => mc.manga_id === finalMangaId);
        if (!hasCharacters) {
          const jikanMedia = await queryJikanMal(searchTerms);
          if (jikanMedia) store.enrichWithJikan(finalMangaId, jikanMedia);
        }
      } else {
        const mangadexMedia = await queryMangaDex(searchTerms);
        if (mangadexMedia) {
          if (!isCoverValid && mangadexMedia.cover) manga.cover = mangadexMedia.cover;
          if (mangadexMedia.description && !manga.description) manga.description = mangadexMedia.description;
        }
        const jikanMedia = await queryJikanMal(searchTerms);
        if (jikanMedia) store.enrichWithJikan(manga.id, jikanMedia);
      }
    } catch {}

    card.status = 'completed';
    card.updatedAt = new Date().toISOString();
    processedCount++;
    logProgress(processedCount, totalInQueue, card.title, `Tamamlandı (${validChapters.length}/${totalChs} bölüm sağlam)`);

    // Diske bağımsız tam seri dosyası olarak kaydet (.cache/series/<slug>.json)
    if (manga.slug) {
      const seriesFilePath = path.join(SERIES_CACHE_DIR, `${manga.slug}.json`);
      if (existsSync(seriesFilePath)) {
        try {
          const diskData = JSON.parse(readFileSync(seriesFilePath, 'utf8'));
          const diskChaptersMap = new Map((diskData.chapters || []).map((ch) => [ch.chapterNumber, ch]));
          for (const ch of manga.chapters || []) {
            if ((!ch.pages || ch.pages.length === 0) && diskChaptersMap.has(ch.chapterNumber)) {
              ch.pages = diskChaptersMap.get(ch.chapterNumber).pages || [];
            }
          }
        } catch {}
      }

      try {
        writeFileSync(seriesFilePath, JSON.stringify(manga, null, 2), 'utf8');
      } catch {}

      // Doğrudan R2'ye tekil seri detayını tam sayfalarıyla yükle
      if (!IS_DRY_RUN && CATALOG_ADMIN_TOKEN) {
        try {
          await fetch(`${CATALOG_WORKER_URL}/v1/admin/series/${manga.slug}`, {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
              'X-Catalog-Admin-Token': CATALOG_ADMIN_TOKEN,
            },
            body: JSON.stringify(manga),
          });
        } catch (err) {
          logWarn(`R2 seri yükleme uyarısı (${manga.slug}): ${err.message}`);
        }
      }

      // RAM optimizasyonu: R2 ve diske yazılan serinin sayfa dizilerini RAM'den boşalt
      for (const ch of manga.chapters || []) {
        ch.pages = [];
      }
      if (store.touchedSlugs) {
        store.touchedSlugs.delete(manga.slug);
      }
    }
  };

  // Paralel Seri İndirme Havuzu (Worker Pool)
  for (let i = 0; i < targetToProcess.length; i += SERIES_CONCURRENCY) {
    if (totalWorkerRequests >= MAX_WORKER_REQUESTS) {
      logWarn(`[Worker Kota Koruması] Günlük ${MAX_WORKER_REQUESTS} Worker istek limitine yaklaşıldı. Kalan ${targetToProcess.length - i} seri kuyrukta saklanarak durduruldu. Yarın tekrar devam edilebilir.`);
      break;
    }
    const chunk = targetToProcess.slice(i, i + SERIES_CONCURRENCY);
    await Promise.all(chunk.map((item) => processSeriesItem(item)));

    // Her grup bitiminde hem diske atomik checkpoint kaydedilir
    checkpoint.seriesQueue = seriesQueue;
    const currentState = store.toState();
    saveCheckpoint({ ...checkpoint, ...currentState });

    // Veritabanı tabloları ve Supabase senkronizasyonu her 30 seride bir toplu yapılır (Aşırı istek ve yükü önler)
    if (!IS_DRY_RUN && (i % 30 === 0 || i + SERIES_CONCURRENCY >= targetToProcess.length)) {
      await uploadToCatalogWorker(store);
    }
  }

  // Son R2 ve Snapshot Yüklemesi
  writeFileSync(EXPORT_DUMP_PATH, JSON.stringify(store.toSnapshotPayload(), null, 2), 'utf8');
  logInfo(`Yerel arşiv dump kaydedildi: ${EXPORT_DUMP_PATH}`);

  if (!IS_DRY_RUN) {
    await uploadToCatalogWorker(store, { all: true });
  }

  console.log('='.repeat(70));
  logInfo(`Tamamlandı! Toplam Seri: ${store.mangas.size}, Bölüm: ${store.toTablesPayload().chapters.length}, Karakter: ${store.characters.size}, Yazar: ${store.authors.size}`);
  console.log('='.repeat(70));
};

main()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    logError(`Kritik motor hatası: ${err.message}\n${err.stack}`);
    process.exit(1);
  });
