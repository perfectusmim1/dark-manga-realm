#!/usr/bin/env node
/**
 * ToonParrot - 24/7 Smart Automated Scraper, Delta Chapter Checker & Multi-Source Metadata Engine
 *
 * Features:
 * 1. 4 Primary High-Quality Sources with Single-Source-per-Series Lock (Prevents 1-2 chapter shifts):
 *    - Normal: webtoonhatti (Priority 1), okutoon (Priority 2)
 *    - +18 Adult: siyahmelek (Priority 1, unlocked chapters), hattorimanga (Priority 2)
 * 2. Smart Filtering & Fast Delta Chapter Checking:
 *    - Auto-skips and prunes completed/cancelled series from chapter_automations
 *    - Auto-prunes dormant series (> 3 months / 90 days since last chapter, unless awakened on front-page feed)
 *    - Scans front-page latest feeds (pages 1-2) to immediately detect newly updated or newly added series
 *    - Fetches image URLs ONLY for newly added chapter numbers (incremental delta)
 * 3. Full Multi-Source Metadata Matching & 100% Turkish Description:
 *    - AniList (GraphQL) + MyAnimeList (Jikan v4) + MangaDex + MangaUpdates (v1 API) + Anime-Planet + aniSearch
 *    - Populates source_links (anilist, myanimelist, mangadex, mangaupdates, animeplanet, anisearch) for 100% user account sync
 *    - Guarantees 100% Turkish series descriptions (uses scraped Turkish text or translates English synopsis via GTX)
 *    - Auto-imports characters (with roles, native names, images, descriptions), authors, artists, and Turkish tags
 * 4. Dual Cloudflare R2 + Supabase PostgreSQL Mirror Sync:
 *    - Writes full catalog + chapter pages + automation-state to Cloudflare R2
 *    - Mirrors lightweight mangas, chapters (pages: '{}'), characters, authors, artists, tags, and chapter_automations to Supabase
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';

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

// --- Service Endpoints & Secrets (Zero Hardcoded Secrets) ---
const CATALOG_WORKER_URL = (process.env.VITE_CATALOG_WORKER_URL || process.env.CATALOG_WORKER_URL || '').replace(/\/+$/, '');
const SCRAPER_PROXY_URLS = (process.env.VITE_SCRAPER_PROXY_URL || process.env.SCRAPER_PROXY_URL || '')
  .split(',')
  .map((u) => u.trim().replace(/\/+$/, ''))
  .filter(Boolean);
const SUPABASE_URL = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';
const CATALOG_ADMIN_TOKEN = process.env.CATALOG_ADMIN_TOKEN || '';

const ANILIST_API_URL = 'https://graphql.anilist.co';
const MANGADEX_API_URL = 'https://api.mangadex.org';
const JIKAN_API_URL = 'https://api.jikan.moe/v4/manga';
const MANGAUPDATES_SEARCH_API_URL = 'https://api.mangaupdates.com/v1/series/search';
const ANIME_PLANET_BASE_URL = 'https://www.anime-planet.com';
const ANISEARCH_BASE_URL = 'https://www.anisearch.com';

const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36';

// --- CLI Flags & Options ---
const args = process.argv.slice(2);
const hasFlag = (flag) => args.includes(flag);
const getArgValue = (flag, fallback = null) => {
  const idx = args.indexOf(flag);
  return idx !== -1 && idx + 1 < args.length ? args[idx + 1] : fallback;
};

const parseNonNegInt = (val, fallback) => {
  const n = parseInt(val, 10);
  return Number.isFinite(n) ? Math.max(0, n) : fallback;
};

const MODE = getArgValue('--mode', 'smart'); // 'smart' | 'delta-only' | 'enrich-only' | 'discover'
const BATCH_SIZE = parseNonNegInt(getArgValue('--batch-size', '6'), 6);
const MAX_DELTA_CHECKS = parseNonNegInt(getArgValue('--max-delta-checks', '40'), 40);
const MAX_ENRICH_CHECKS = parseNonNegInt(
  getArgValue('--max-enrich-checks', MODE === 'enrich-only' ? '35' : MODE === 'delta-only' ? '0' : '12'),
  MODE === 'enrich-only' ? 35 : MODE === 'delta-only' ? 0 : 12
);
const COOLDOWN_HOURS = Math.max(0, parseFloat(getArgValue('--cooldown-hours', '6')) || 6);
const DORMANT_DAYS_LIMIT = Math.max(30, parseInt(getArgValue('--dormant-days', '90'), 10) || 90); // 3 months = 90 days
const FRONT_PAGES_TO_SCAN = Math.max(1, parseInt(getArgValue('--front-pages', '2'), 10) || 2);
const TARGET_SOURCE = getArgValue('--source', null);
const ARCHIVE_MODE = hasFlag('--archive-mode') || hasFlag('--deep') || MODE === 'archive';
const FORCE_ENRICH = hasFlag('--force-enrich');
const FORCE_DELTA = hasFlag('--force-delta');
const FULL_CHAPTERS_SYNC = hasFlag('--full-chapters-sync');
const SKIP_SUPABASE_SYNC = hasFlag('--skip-supabase-sync');
const SKIP_R2_HYDRATE = hasFlag('--skip-r2-hydrate');
const IS_DRY_RUN = hasFlag('--dry-run');
const MAX_RUNTIME_MINUTES = Math.max(5, parseInt(getArgValue('--max-runtime-minutes', '105'), 10) || 105);
const RUN_START_MS = Date.now();
const SOFT_RUNTIME_LIMIT_MS = Math.max(3, MAX_RUNTIME_MINUTES - 10) * 60 * 1000;
const isTimeBudgetExceeded = () => Date.now() - RUN_START_MS >= SOFT_RUNTIME_LIMIT_MS;

const PRIMARY_SOURCES = [
  'webtoonhatti',
  'okutoon',
  'siyahmelek',
  'hattorimanga',
  'mangadass',
  'asurascans',
  'madaradex',
];
const CHAPTER_CONCURRENCY = 6;

// Global anti-hang safety timeout
const globalTimeoutTimer = setTimeout(() => {
  console.error(`[FATAL] Maksimum çalışma süresi (${MAX_RUNTIME_MINUTES} dk) aşıldı, güvenli çıkış yapılıyor.`);
  process.exit(1);
}, MAX_RUNTIME_MINUTES * 60 * 1000);
if (typeof globalTimeoutTimer.unref === 'function') {
  globalTimeoutTimer.unref();
}

// --- Live Terminal Progress Logger ---
const formatTime = () => new Date().toTimeString().split(' ')[0];

const logProgress = (current, total, item, status) => {
  const totalNum = total <= 0 ? 1 : total;
  const pct = ((current / totalNum) * 100).toFixed(1);
  console.log(`[${formatTime()}] [${current}/${total}] (%${pct}) - ${item}: ${status}`);
};

const logInfo = (msg) => console.log(`[${formatTime()}] [INFO] ${msg}`);
const logWarn = (msg) => console.warn(`[${formatTime()}] [WARN] ${msg}`);
const logError = (msg) => console.error(`[${formatTime()}] [ERROR] ${msg}`);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Deterministic UUID v4-like generator from string key (so chapter_automations IDs are stable per mangaId)
const deterministicUuid = (namespaceKey) => {
  const hash = createHash('sha256').update(`toonparrot:${namespaceKey}`).digest('hex');
  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    `4${hash.slice(13, 16)}`,
    `a${hash.slice(17, 20)}`,
    hash.slice(20, 32),
  ].join('-');
};

// ============================================================================
// LANGUAGE, GENRE & TEXT HELPERS (100% TURKISH GUARANTEE)
// ============================================================================
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

const tokenizeComparableTitle = (title) =>
  cleanSeriesTitle(title)
    .toLocaleLowerCase('tr-TR')
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ş/g, 's')
    .replace(/ı/g, 'i')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c')
    .replace(/\b(?:season\s*\d+|sezon\s*\d+|\d+\.\s*sezon|webtoon|manhwa|manhua|novel|manga|turkce|oku)\b/gi, ' ')
    .replace(/[^a-z0-9\s]/gi, ' ')
    .split(/\s+/)
    .filter((tok) => tok.length >= 2 && !/^\d+$/.test(tok));

const isConfidentTitleMatch = (queryTerms = [], candidateTitles = []) => {
  const cleanQueries = (queryTerms || []).filter((q) => q && !/^\d+$/.test(q.trim()));
  const cleanCandidates = (candidateTitles || []).filter(Boolean);
  if (cleanQueries.length === 0 || cleanCandidates.length === 0) return false;

  for (const q of cleanQueries) {
    const qKey = normalizeTitleKey(q);
    if (!qKey || qKey.length < 3) continue;
    const qTokens = tokenizeComparableTitle(q);

    for (const cand of cleanCandidates) {
      const cKey = normalizeTitleKey(cand);
      if (!cKey || cKey.length < 3) continue;
      if (qKey === cKey) return true;

      const minLen = Math.min(qKey.length, cKey.length);
      const maxLen = Math.max(qKey.length, cKey.length);
      if (minLen >= 6 && (qKey.includes(cKey) || cKey.includes(qKey)) && minLen / maxLen >= 0.62) {
        return true;
      }

      const cTokens = tokenizeComparableTitle(cand);
      if (qTokens.length >= 2 && cTokens.length >= 2) {
        const cSet = new Set(cTokens);
        const shared = qTokens.filter((t) => cSet.has(t)).length;
        const overlap = (2 * shared) / (qTokens.length + cTokens.length);
        if (overlap >= 0.66) return true;
      }
    }
  }
  return false;
};

const deriveMangaType = ({ countryOfOrigin = '', isAdult = false, primarySource = '', fallbackType = 'manhwa', title = '', genres = [] } = {}) => {
  const co = String(countryOfOrigin || '').toUpperCase();
  const gStr = (Array.isArray(genres) ? genres : []).map((g) => (typeof g === 'string' ? g : g?.name || '')).join(' ').toLowerCase();
  const tStr = String(title || '').toLowerCase();

  if (primarySource === 'hentaiturk') return 'hentai';
  if (primarySource === 'dxdfansub') return 'manga';

  if (gStr.includes('manhua') || tStr.includes('manhua') || tStr.includes('xiuxian') || gStr.includes('cultivation') || gStr.includes('kültivasyon')) {
    return 'manhua';
  }
  if (gStr.includes('manga') || tStr.includes('manga') || /\b(?:no|wa|ni|ga|wo|san|kun|chan|sama|senpai|sensei|isekai)\b/i.test(tStr)) {
    return isAdult ? 'hentai' : 'manga';
  }
  if (gStr.includes('manhwa') || tStr.includes('manhwa') || primarySource === 'mangadass' || primarySource === 'asurascans' || primarySource === 'madaradex' || primarySource === 'golgebahcesi' || primarySource === 'siyahmelek') {
    return isAdult ? 'webtoon_hentai' : 'manhwa';
  }

  if (isAdult) {
    if (co === 'JP') return 'hentai';
    return 'webtoon_hentai';
  }
  if (co === 'JP') return 'manga';
  if (co === 'KR') return 'manhwa';
  if (co === 'CN' || co === 'TW') return 'manhua';
  return fallbackType || 'manhwa';
};

const BL_REGEX = /\b(?:yaoi|shounen[\s\-_]*ai|shonen[\s\-_]*ai|boys?[\s\-_]*love|danmei|bara|erkek\s*a[sş]k[ıi]|fujoshi|fudanshi|gay)\b/iu;
const BL_GENRE_REGEX = /\b(?:bl|yaoi|shounen[\s\-_]*ai|shonen[\s\-_]*ai|boys?[\s\-_]*love|danmei|bara|erkek\s*a[sş]k[ıi]|fujoshi|fudanshi|gay)\b/iu;

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
    return chapterNumber != null && Number.isFinite(Number(chapterNumber)) && Number(chapterNumber) >= 0
      ? `Bölüm ${chapterNumber}`
      : 'Bölüm 1';
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

  // 5. Determine effective chapter number (handles Chapter 0 / Prologue cleanly)
  let effectiveNum = chapterNumber != null && Number.isFinite(Number(chapterNumber)) && Number(chapterNumber) >= 0
    ? Number(chapterNumber)
    : null;
  if (effectiveNum == null) {
    if (/\b(?:prologue|prolog|[öo]ns[öo]z)\b/i.test(text)) {
      effectiveNum = 0;
    } else {
      const match = text.match(/(?:b[öo]l[üu]m|chapter|ch\.?)\s*(\d+(?:\.\d+)?)/i) || text.match(/(\d+(?:\.\d+)?)/);
      if (match) effectiveNum = parseFloat(match[1]);
    }
  }

  // 6. Remove trailing residue numbers if chapter number already established
  if (effectiveNum != null) {
    text = text.replace(/\s+\d{1,4}\s*$/, ' ');
  }

  // 7. Extract subtitle
  let subtitle = text
    .replace(/(?:b[öo]l[üu]m|chapter|ch\.?)\s*\.?\s*\d+(?:\.\d+)?/gi, ' ')
    .replace(/\b\d+(?:\.\d+)?\s*\.?\s*(?:b[öo]l[üu]m|chapter|ch\.?)/gi, ' ')
    .replace(/\b(?:b[öo]l[üu]m|chapter|ch\.?)\b/gi, ' ')
    .replace(/[\[({【][.\s…_—–-]+[\])}】]/g, ' ');

  const numStr = effectiveNum != null ? (Number.isInteger(effectiveNum) ? String(effectiveNum) : String(effectiveNum)) : '';
  if (numStr) {
    subtitle = subtitle.replace(new RegExp(`\\b${numStr.replace('.', '\\.')}\\b`, 'g'), ' ');
  }

  subtitle = subtitle.replace(/^[-–—:|.\s]+|[-–—:|.\s]+$/g, '').replace(/\s+/g, ' ').trim();

  // If subtitle has meaningful alphabetic text (not just punctuation, dots or chapter leftover)
  const hasLetters = /[a-zA-ZçğıöşüÇĞİÖŞÜ]{2,}/.test(subtitle);
  if (subtitle && hasLetters && !/^(?:b[öo]l[üu]m|chapter|ch|\d+)$/i.test(subtitle) && subtitle.length > 2) {
    return effectiveNum != null ? `Bölüm ${effectiveNum} - ${subtitle}` : subtitle;
  }

  return effectiveNum != null ? `Bölüm ${effectiveNum}` : (text || 'Bölüm 1');
};

const isLowResThumbnailUrl = (url) =>
  typeof url === 'string' &&
  (/(?:-\d{2,3}x\d{2,3})\.(?:jpe?g|png|webp)(?:\?.*)?$/i.test(url.trim()) ||
    /\/cover-230\.webp(?:\?.*)?$/i.test(url.trim()));

const upgradeSourceImageUrl = (url) => {
  if (!url || typeof url !== 'string') return '';
  const trimmed = url.trim();
  if (/cdn\.hentaiturk\.com\/uploads\/mangas\/\d+\/cover\/cover-230\.webp/i.test(trimmed)) {
    return trimmed.replace(/\/cover-230\.webp/i, '/cover.webp');
  }
  if (/(?:webtoonhatti|siyahmelek|hattorimanga)/i.test(trimmed)) {
    return trimmed.replace(/-\d{2,3}x\d{2,3}(\.(?:jpe?g|png|webp))(?:\?.*)?$/i, '$1');
  }
  return trimmed;
};

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
    .replace(/\b(?:season\s*\d+|sezon\s*\d+|\d+\.\s*sezon|webtoon|manhwa|manhua|novel|manga|turkce|oku)\b/gi, ' ')
    .replace(/[^a-z0-9]/gi, '')
    .trim();
};

const slugify = (text) =>
  (text || '')
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

const cleanSynopsisFooters = (text) => {
  if (!text) return '';
  return stripTags(text)
    .replace(/\(Source:\s*[^)]+\)/gi, '')
    .replace(/\[Written by [^\]]+\]/gi, '')
    .replace(/Source:\s*www\.anisearch\.[^\s]+/gi, '')
    .replace(/Original Webtoon:[\s\S]*$/i, '')
    .replace(/Official Translations:[\s\S]*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
};

const isLikelyTurkish = (text) => {
  if (!text || text.trim().length < 20) return false;
  const sample = text.trim();
  // Check common English stopwords first: if heavily English, return false
  const englishHits = (sample.match(/\b(the|and|with|from|that|this|into|after|world|when|their|his|her|who|have|been|will|would)\b/gi) || []).length;
  const turkishChars = (sample.match(/[ğüşiöçĞÜŞİÖÇ]/g) || []).length;
  const turkishWords = (
    sample.match(/\b(bir|için|olarak|olan|ancak|sonra|dünya|hayat|kendi|büyük|küçük|gün|yıl|tarafından|birlikte|karşı|ama|fakat|veya|ile|bu|şu|o|onun|kadar|gibi|daha|çok|en|her|hiç|nasıl|neden)\b/gi) || []
  ).length;
  if (englishHits >= 4 && turkishWords < englishHits) return false;
  return turkishChars >= 2 || turkishWords >= 2;
};

const translateTextGtx = async (text, sl = 'auto', tl = 'tr') => {
  const cleaned = cleanSynopsisFooters(text);
  if (!cleaned || cleaned.length < 2) return '';
  try {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${sl}&tl=${tl}&dt=t&q=${encodeURIComponent(cleaned.slice(0, 2500))}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && Array.isArray(data[0])) {
        const out = data[0]
          .filter((seg) => Array.isArray(seg) && typeof seg[0] === 'string')
          .map((seg) => seg[0])
          .join('')
          .trim();
        if (out.length > 2) return out;
      }
    }
  } catch {}
  return cleaned;
};

const ensureTurkishDescription = async (currentDesc, fallbackEnglishDesc, mangaTitle = '') => {
  const cleanCurrent = cleanSynopsisFooters(currentDesc);
  if (cleanCurrent.length >= 25 && isLikelyTurkish(cleanCurrent)) {
    return cleanCurrent;
  }
  const sourceText = cleanSynopsisFooters(fallbackEnglishDesc || cleanCurrent);
  if (sourceText.length >= 15) {
    if (isLikelyTurkish(sourceText)) return sourceText;
    const translated = await translateTextGtx(sourceText, 'auto', 'tr');
    if (translated && translated.length >= 15) {
      return translated;
    }
  }
  if (cleanCurrent.length >= 15) {
    const translated = await translateTextGtx(cleanCurrent, 'auto', 'tr');
    if (translated) return translated;
  }
  return cleanCurrent || `${mangaTitle} Türkçe webtoon ve manga serisi.`;
};

// ============================================================================
// NETWORK FETCHER & IMAGE VERIFICATION
// ============================================================================
let totalWorkerRequests = 0;
const MAX_WORKER_REQUESTS = 75000;

const fetchUpstream = async (targetUrl, options = {}) => {
  const method = options.method || 'GET';
  const customHeaders = options.headers || {};
  const body = options.body;
  const timeoutMs = options.timeoutMs || 12000;

  let domain = '';
  let originReferer = '';
  try {
    const parsedTarget = new URL(targetUrl);
    domain = parsedTarget.hostname;
    originReferer = `${parsedTarget.origin}/`;
  } catch {
    return { ok: false, status: 0, content: '', url: targetUrl };
  }

  const baseHeaders = {
    'User-Agent': DEFAULT_USER_AGENT,
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7',
    'Cache-Control': 'no-cache',
    ...(originReferer ? { Referer: originReferer } : {}),
    ...customHeaders,
  };

  const isDirectCapable =
    domain.includes('webtoonhatti') ||
    domain.includes('siyahmelek') ||
    domain.includes('okutoon') ||
    domain.includes('hattorimanga') ||
    domain.includes('mangadass') ||
    domain.includes('asurascans') ||
    domain.includes('madaradex') ||
    domain.includes('anime-planet') ||
    domain.includes('anisearch') ||
    domain.includes('mangaupdates') ||
    domain.includes('jikan.moe') ||
    domain.includes('anilist.co');

  if (isDirectCapable) {
    try {
      const directRes = await fetch(targetUrl, {
        method,
        headers: baseHeaders,
        body: body ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
        redirect: 'follow',
      });
      if (directRes.status === 404) {
        return { ok: false, status: 404, content: '', url: directRes.url };
      }
      const text = await directRes.text();
      const isBlocked =
        directRes.status === 403 ||
        directRes.status === 503 ||
        text.includes('Just a moment...') ||
        text.includes('cf-mitigated') ||
        text.includes('challenges.cloudflare.com');
      if (directRes.ok && !isBlocked && text.length > 50) {
        return { ok: true, status: directRes.status, content: text, url: directRes.url };
      }
      if (!isBlocked) {
        return { ok: false, status: directRes.status, content: text, url: directRes.url };
      }
    } catch {
      return { ok: false, status: 0, content: '', url: targetUrl };
    }
  }

  if (SCRAPER_PROXY_URLS.length > 0 && totalWorkerRequests < MAX_WORKER_REQUESTS) {
    for (let attempt = 0; attempt < SCRAPER_PROXY_URLS.length; attempt++) {
      const proxyUrl = SCRAPER_PROXY_URLS[(totalWorkerRequests + attempt) % SCRAPER_PROXY_URLS.length];
      totalWorkerRequests++;
      try {
        const proxyRes = await fetch(proxyUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            url: targetUrl,
            method,
            headers: baseHeaders,
            body,
          }),
          signal: AbortSignal.timeout(timeoutMs),
        });

        if (proxyRes.ok) {
          const rawText = await proxyRes.text();
          let parsed = null;
          try {
            parsed = JSON.parse(rawText);
          } catch {}
          const content = parsed && typeof parsed.content === 'string' ? parsed.content : rawText;
          const status = parsed && parsed.statusCode ? parsed.statusCode : proxyRes.status;
          const isBlocked =
            status === 403 ||
            status === 503 ||
            content.includes('Just a moment...') ||
            content.includes('cf-mitigated');
          if (!isBlocked && status < 400 && content.length > 50) {
            return { ok: true, status, content, url: targetUrl };
          }
        }
      } catch {}
    }
  } else if (totalWorkerRequests >= MAX_WORKER_REQUESTS) {
    logWarn(`[Worker Quota Guard] Günlük ${MAX_WORKER_REQUESTS} Worker istek limiti koruması aktif. Doğrudan proxy istekleri durduruldu.`);
  }

  return { ok: false, status: 0, content: '', url: targetUrl };
};

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
  if (isJunkImageUrl(url)) return true;
  return /uploads\.mangadex\.org/i.test(url);
};

const verifiedDomainSuccessCounts = new Map();
const verifiedDomainCache = new Map([
  ['cdn-2.webtoon-oku.net', true],
  ['cdn.mangacix.net', true],
  ['cdn.myanimelist.net', true],
  ['uploads.mangadex.org', true],
  ['cdn.okutoon.com', true],
  ['om-cdn.okutoon.com', true],
  ['cdn.asurascans.com', true],
  ['cdn.madaradex.org', true],
]);
const verifiedUrlCache = new Map();

const verifyImageUrl = async (url, options = {}) => {
  if (isJunkImageUrl(url)) return false;
  const cleanUrl = url.trim();
  const isCover = Boolean(options.isCover);
  if (verifiedUrlCache.has(cleanUrl)) return verifiedUrlCache.get(cleanUrl);

  let domain = '';
  try {
    domain = new URL(cleanUrl).hostname;
  } catch {
    return false;
  }

  // Covers must never bypass real HTTP verification via domain cache
  if (
    !isCover &&
    (verifiedDomainCache.get(domain) === true ||
      domain.includes('mangadass.com') ||
      domain.includes('asurascans.com') ||
      domain.includes('madaradex.org'))
  ) {
    return true;
  }
  if (verifiedUrlCache.size > 3000) verifiedUrlCache.clear();

  try {
    const res = await fetch(cleanUrl, {
      method: 'GET',
      headers: {
        'User-Agent': DEFAULT_USER_AGENT,
        Range: 'bytes=0-1024',
        Referer: `${new URL(cleanUrl).origin}/`,
      },
      signal: AbortSignal.timeout(4000),
    });

    const contentType = res.headers.get('content-type') || '';
    const isImage =
      (res.status === 200 || res.status === 206) &&
      (contentType.startsWith('image/') || contentType.includes('octet-stream') || res.status === 206);

    verifiedUrlCache.set(cleanUrl, isImage);
    if (isImage && !isCover) {
      const count = (verifiedDomainSuccessCounts.get(domain) || 0) + 1;
      verifiedDomainSuccessCounts.set(domain, count);
      if (count >= 2) verifiedDomainCache.set(domain, true);
    }
    return isImage;
  } catch {
    verifiedUrlCache.set(cleanUrl, false);
    return false;
  }
};

const verifyAndFilterImageUrls = async (urls) => {
  const unique = Array.from(new Set((urls || []).map((u) => (u || '').trim()).filter((u) => !isJunkImageUrl(u))));
  const valid = [];
  for (let i = 0; i < unique.length; i += 10) {
    const chunk = unique.slice(i, i + 10);
    const results = await Promise.all(chunk.map((u) => verifyImageUrl(u)));
    for (let j = 0; j < chunk.length; j++) {
      if (results[j]) valid.push(chunk[j]);
    }
  }
  return valid;
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
  // Explicit adult URL paths
  if (url && (/\/adult\/|\/webtoon-tur\/adult\//i.test(url) || /\b18\+\b|\+18\b/i.test(url))) return true;

  // 1. Check explicit adult genre badges or attributes in cardBlock or HTML metadata
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

  // 2. Check genres array
  const genreStr = (genres || []).join(' ');
  if (genreStr && ADULT_GENRE_REGEX.test(genreStr)) return true;

  // 3. Check title
  if (title && ADULT_TITLE_REGEX.test(title)) return true;

  // 4. Check description only for explicit adult keywords
  if (description && /\b(hentai|sans[üu]rs[üu]z|uncensored)\b/i.test(description)) return true;

  return Boolean(fallbackIsAdult);
};

// ============================================================================
// 4 PRIMARY SOURCE SCRAPERS (WebtoonHattı, OkuToon, SiyahMelek, HattoriManga)
// ============================================================================
const scanFrontPageFeed = async (source, maxPages = 2) => {
  const effectiveMaxPages = ARCHIVE_MODE ? Math.max(maxPages, 50) : maxPages;
  const cards = [];
  const seen = new Set();

  if (source === 'webtoonhatti') {
    for (let page = 1; page <= effectiveMaxPages; page++) {
      const pageUrl = `https://webtoonhatti.club/manga/page/${page}/?m_orderby=latest`;
      const res = await fetchUpstream(pageUrl);
      if (!res.ok || !res.content) break;
      const blocks = res.content.split(/class=["'](?:page-item-detail|c-tabs-item__content)/i).slice(1);
      if (blocks.length === 0) break;
      for (const b of blocks) {
        const linkMatch = b.match(/href=["'](https:\/\/webtoonhatti\.club\/(?:manga|webtoon)\/[^"'\/]+(?:\/)?)["']/i);
        const titleMatch = b.match(/title=["']([^"']+)["']/i) || b.match(/<a[^>]+href=["'][^"']+["'][^>]*>([^<]+)<\/a>/i);
        const imgMatch = b.match(/(?:data-src|data-lazy-src|src)=["']([^"']+\.(?:webp|jpg|jpeg|png)[^"']*)["']/i);
        const link = linkMatch?.[1]?.trim();
        const title = titleMatch?.[1] ? stripTags(titleMatch[1]) : '';
        const cover = imgMatch?.[1]?.trim() || '';
        if (link && title && !seen.has(link)) {
          seen.add(link);
          const isAdult = detectIsAdult({ source: 'webtoonhatti', url: link, cardBlock: b, title });
          cards.push({ source: 'webtoonhatti', title, link, cover, isAdult, genres: isAdult ? ['+18'] : [] });
        }
      }
    }
  } else if (source === 'okutoon') {
    for (let page = 1; page <= maxPages; page++) {
      const apiUrl = `https://okutoon.com/api/v1/series?page=${page}&limit=36&sort=newest`;
      const res = await fetchUpstream(apiUrl, { headers: { Accept: 'application/json' } });
      if (!res.ok || !res.content) break;
      let json = null;
      try {
        json = JSON.parse(res.content);
      } catch {
        break;
      }
      const items = json?.data || [];
      if (items.length === 0) break;
      for (const item of items) {
        if (!item?.slug || !item?.title) continue;
        const link = `https://okutoon.com/${item.slug}`;
        const cover = item.cover_url || item.headline_url || '';
        const title = cleanSeriesTitle(item.title);
        if (link && title && !seen.has(link)) {
          seen.add(link);
          cards.push({
            source: 'okutoon',
            title,
            link,
            slug: item.slug,
            cover,
            isAdult: false,
            genres: (item.categories || []).map((c) => normalizeGenreToTurkish(c.name)).filter(Boolean),
          });
        }
      }
    }
  } else if (source === 'siyahmelek') {
    const smFeedUrls = ['https://siyahmelek.my/'];
    for (let page = 1; page <= maxPages; page++) {
      smFeedUrls.push(page === 1 ? 'https://siyahmelek.my/manga/' : `https://siyahmelek.my/manga/page/${page}/`);
    }
    for (const pageUrl of smFeedUrls) {
      const res = await fetchUpstream(pageUrl);
      if (!res.ok || !res.content) continue;
      const blocks = res.content.split('<div class="manga-item-grid">').slice(1);
      for (const block of blocks) {
        const linkMatch = block.match(/href="(https:\/\/siyahmelek\.my\/manga\/[^"/]+\/)"/i);
        const imgMatch = block.match(/<img[^>]+src="([^"]+)"/i);
        const titleMatch = block.match(/alt="([^"]+) i[çc]in kapak g[öo]rseli"/i) || block.match(/<h[2-4][^>]*>([\s\S]*?)<\/h[2-4]>/i);
        const link = linkMatch?.[1]?.trim();
        const cover = imgMatch?.[1]?.trim() || '';
        const title = titleMatch ? stripTags(titleMatch[1]).trim() : '';
        if (link && title && !seen.has(link)) {
          seen.add(link);
          const isAdult = detectIsAdult({ source: 'siyahmelek', url: link, cardBlock: block, title });
          cards.push({ source: 'siyahmelek', title, link, cover, isAdult, genres: isAdult ? ['+18'] : [] });
        }
      }
    }
  } else if (source === 'hattorimanga') {
    for (let page = 1; page <= maxPages; page++) {
      const pageUrl = `https://hattorimanga.net/manga/page/${page}/`;
      const res = await fetchUpstream(pageUrl);
      if (!res.ok || !res.content) break;
      const blocks = res.content.split(/class=["'][^"']*(?:page-item-detail|c-tabs-item__content|badge-pos-\d+)[^"']*["']/i).slice(1);
      for (const b of blocks) {
        const linkMatch = b.match(/href=["'](https:\/\/hattorimanga\.net\/manga\/[^"'\/?#]+(?:\/)?)["']/i);
        const titleMatch = b.match(/title=["']([^"']+)["']/i) || b.match(/<a[^>]+href=["'][^"']+["'][^>]*>([^<]+)<\/a>/i);
        const imgMatch = b.match(/(?:data-src|data-lazy-src|src)=["']([^"']+\.(?:webp|jpg|jpeg|png)[^"']*)["']/i);
        const link = linkMatch?.[1]?.trim();
        const title = titleMatch?.[1] ? cleanSeriesTitle(stripTags(titleMatch[1])) : '';
        const cover = imgMatch?.[1]?.trim() || '';
        if (link && title && !seen.has(link)) {
          seen.add(link);
          const isAdult = detectIsAdult({ source: 'hattorimanga', url: link, cardBlock: b, title });
          cards.push({ source: 'hattorimanga', title, link, cover, isAdult, genres: isAdult ? ['+18'] : [] });
        }
      }
      // Fallback Madara h3.h4 parser
      const h3Matches = extractRegexMatches(
        res.content,
        /<h3[^>]*class=["'][^"']*h4[^"']*["'][^>]*>\s*<a[^>]+href=["'](https:\/\/hattorimanga\.net\/manga\/[^"'\/?#]+(?:\/)?)["'][^>]*>([\s\S]*?)<\/a>\s*<\/h3>/gi
      );
      for (const m of h3Matches) {
        const link = m[1]?.trim();
        const title = cleanSeriesTitle(stripTags(m[2] || ''));
        if (link && title && !seen.has(link)) {
          seen.add(link);
          const isAdult = detectIsAdult({ source: 'hattorimanga', url: link, cardBlock: m[0], title });
          cards.push({ source: 'hattorimanga', title, link, cover: '', isAdult, genres: isAdult ? ['+18'] : [] });
        }
      }
    }
  } else if (source === 'mangadass') {
    // Sadece +18 yetişkin ve raw manhwa kategorilerini tara
    const matureFeeds = [
      { url: 'https://mangadass.com/raw-manhwa', isRaw: true },
      { url: 'https://mangadass.com/manga-genre/mature', isRaw: false },
    ];
    for (const feed of matureFeeds) {
      for (let page = 1; page <= effectiveMaxPages; page++) {
        const pageUrl = `${feed.url}/${page}?orderby=latest`;
        const res = await fetchUpstream(pageUrl);
        if (!res.ok || !res.content) break;
        const blocks = res.content.split(/class=["'][^"']*(?:manga-listing-item|page-item-detail|grid-item|manga-item)[^"']*["']/i).slice(1);
        if (blocks.length === 0) break;
        for (const b of blocks) {
          const linkMatch = b.match(/href=["'](\/manga\/[^"'\/?#]+(?:\/)?)["']/i) || b.match(/href=["'](https?:\/\/mangadass\.com\/manga\/[^"'\/?#]+(?:\/)?)["']/i);
          const titleMatch = b.match(/title=["']([^"']+)["']/i) || b.match(/<a[^>]+href=["'][^"']+["'][^>]*>([^<]+)<\/a>/i);
          const imgMatch = b.match(/(?:data-src|data-lazy-src|src)=["']([^"']+\.(?:webp|jpg|jpeg|png)[^"']*)["']/i);
          const rawLink = linkMatch?.[1]?.trim();
          if (!rawLink || rawLink.includes('/chapter-')) continue;
          const link = rawLink.startsWith('http') ? rawLink : `https://mangadass.com${rawLink}`;
          let title = titleMatch?.[1] ? cleanSeriesTitle(stripTags(titleMatch[1])) : '';
          const cover = imgMatch?.[1]?.trim() || '';
          if (link && title && !seen.has(link)) {
            seen.add(link);
            const isRaw = feed.isRaw || title.toLowerCase().includes('(raw)') || link.includes('-raw');
            if (isRaw && !title.toLowerCase().includes('(raw)')) {
              title = `${title} (Raw)`;
            }
            cards.push({
              source: 'mangadass',
              title,
              link,
              cover,
              isAdult: true,
              genres: ['+18', 'Mature'],
              details: { language: isRaw ? 'raw' : 'en' },
            });
          }
        }
      }
    }
  } else if (source === 'asurascans') {
    // Normal İngilizce Webtoonlar
    for (let page = 1; page <= effectiveMaxPages; page++) {
      const pageUrl = page === 1 ? 'https://asurascans.com/comics' : `https://asurascans.com/comics?page=${page}`;
      const res = await fetchUpstream(pageUrl);
      if (!res.ok || !res.content) break;
      const blocks = res.content.split(/href=["'](\/comics\/[^"'\/?#]+(?:-[a-f0-9]+))["']/gi);
      for (let i = 1; i < blocks.length; i += 2) {
        const path = blocks[i]?.trim();
        const blockHtml = blocks[i + 1] || '';
        if (!path || path.includes('/chapter/')) continue;
        const link = `https://asurascans.com${path}`;
        if (seen.has(link)) continue;
        seen.add(link);
        const titleMatch = blockHtml.match(/<span[^>]*class=["'][^"']*font-bold[^"']*["'][^>]*>([^<]+)<\/span>/i) ||
                           blockHtml.match(/title=["']([^"']+)["']/i);
        const imgMatch = blockHtml.match(/(?:data-src|data-lazy-src|src)=["']([^"']+\.(?:webp|jpg|jpeg|png)[^"']*)["']/i);
        const slugWithoutHash = path.replace(/^\/comics\//, '').replace(/-[a-f0-9]+$/, '');
        const autoTitle = titleMatch?.[1]
          ? cleanSeriesTitle(stripTags(titleMatch[1]))
          : slugWithoutHash.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
        const cover = imgMatch?.[1]?.trim() || '';
        cards.push({
          source: 'asurascans',
          title: autoTitle,
          link,
          cover,
          isAdult: false,
          genres: ['Webtoon', 'Action'],
          details: { language: 'en' },
        });
      }
    }
  } else if (source === 'madaradex') {
    // +18 Yetişkin İngilizce Manhwa/Manga
    for (let page = 1; page <= effectiveMaxPages; page++) {
      const pageUrl = page === 1 ? 'https://madaradex.org/?m_orderby=latest' : `https://madaradex.org/page/${page}/?m_orderby=latest`;
      const res = await fetchUpstream(pageUrl);
      if (!res.ok || !res.content) break;
      const blocks = res.content.split(/class=["'][^"']*(?:page-item-detail|c-tabs-item__content)[^"']*["']/i).slice(1);
      for (const b of blocks) {
        const linkMatch = b.match(/href=["'](https?:\/\/madaradex\.org\/(?:title|manga)\/[^"'\/?#]+(?:\/)?)["']/i);
        const titleMatch = b.match(/title=["']([^"']+)["']/i) || b.match(/<a[^>]+href=["'][^"']+["'][^>]*>([^<]+)<\/a>/i);
        const imgMatch = b.match(/(?:data-src|data-lazy-src|src)=["']([^"']+\.(?:webp|jpg|jpeg|png)[^"']*)["']/i);
        const link = linkMatch?.[1]?.trim();
        const title = titleMatch?.[1] ? cleanSeriesTitle(stripTags(titleMatch[1])) : '';
        const cover = imgMatch?.[1]?.trim() || '';
        if (link && title && !seen.has(link)) {
          seen.add(link);
          cards.push({
            source: 'madaradex',
            title,
            link,
            cover,
            isAdult: true,
            genres: ['+18', 'Mature'],
            details: { language: 'en' },
          });
        }
      }
    }
  }

  return cards.filter((c) => !isBLSeries(c));
};

const fetchSeriesDetailFromSource = async (source, seriesUrl, fallbackTitle = '', fallbackCover = '', fallbackIsAdult = false) => {
  if (source === 'okutoon') {
    const slug = String(seriesUrl || '')
      .replace(/^https?:\/\/(?:www\.)?okutoon\.com\/?/i, '')
      .replace(/^seri\//i, '')
      .split('/')[0]
      ?.trim();
    if (!slug) return null;

    let seriesMeta = null;
    try {
      const metaRes = await fetchUpstream(`https://okutoon.com/api/v1/series/${slug}`, {
        headers: { Accept: 'application/json' },
        timeoutMs: 12000,
      });
      if (metaRes.ok && metaRes.content) {
        seriesMeta = JSON.parse(metaRes.content)?.data || null;
      }
    } catch {}

    const rawChapters = [];
    const seenCh = new Set();
    let startOffset = 0;
    let hasMore = true;

    while (hasMore) {
      const chaptersUrl = `https://okutoon.com/api/v1/series/${slug}/chapters?limit=100&offset=${startOffset}`;
      const chRes = await fetchUpstream(chaptersUrl, {
        headers: { Accept: 'application/json' },
        timeoutMs: 15000,
      });
      if (!chRes.ok || !chRes.content) break;

      let json = null;
      try {
        json = JSON.parse(chRes.content);
      } catch {
        break;
      }

      const items = json?.data || [];
      if (items.length === 0) break;

      for (const ch of items) {
        if (!ch.slug || seenCh.has(ch.slug)) continue;
        seenCh.add(ch.slug);
        const num = Number(ch.display_number || ch.number) || 0;
        rawChapters.push({
          title: cleanChapterTitle(ch.title || `Bölüm ${num}`, num, seriesMeta?.title || fallbackTitle),
          link: ch.url || `https://okutoon.com/${slug}/${ch.slug}`,
          slug: ch.slug,
          seriesSlug: slug,
          chapterNumber: num,
          releaseDate: ch.published_at || ch.created_at,
        });
      }

      if (!json.meta?.has_more) {
        hasMore = false;
      } else {
        startOffset += items.length;
      }
    }

    rawChapters.sort((a, b) => a.chapterNumber - b.chapterNumber);

    const altTitles = seriesMeta?.alt_title
      ? String(seriesMeta.alt_title).split(',').map((t) => t.trim()).filter(Boolean)
      : [];
    const genres = Array.isArray(seriesMeta?.categories)
      ? seriesMeta.categories.map((c) => normalizeGenreToTurkish(c.name)).filter(Boolean)
      : ['Webtoon'];

    const rawOkuStatus = String(seriesMeta?.status || '').toLowerCase();
    const mappedOkuStatus =
      rawOkuStatus === 'completed' || rawOkuStatus === 'finished'
        ? 'completed'
        : rawOkuStatus === 'cancelled' || rawOkuStatus === 'canceled' || rawOkuStatus === 'dropped'
        ? 'cancelled'
        : rawOkuStatus === 'hiatus' || rawOkuStatus === 'paused'
        ? 'hiatus'
        : 'ongoing';

    return {
      source: 'okutoon',
      title: cleanSeriesTitle(seriesMeta?.title || fallbackTitle || slug),
      link: `https://okutoon.com/${slug}`,
      cover: seriesMeta?.cover_url || seriesMeta?.headline_url || fallbackCover,
      description: seriesMeta?.description_text || '',
      alternativeTitles: altTitles,
      author: seriesMeta?.author || 'Bilinmiyor',
      artist: seriesMeta?.artist || undefined,
      status: mappedOkuStatus,
      genres: genres.length > 0 ? genres : ['Webtoon'],
      isAdult: false,
      chapters: rawChapters,
    };
  }

  const res = await fetchUpstream(seriesUrl, { timeoutMs: 15000 });
  if (!res.ok || !res.content) return null;
  const html = res.content;

  if (source === 'webtoonhatti' || source === 'hattorimanga' || source === 'madaradex') {
    const descMatch =
      /<div class="manga-excerpt[\s\S]*?<p>([\s\S]*?)<\/p>/i.exec(html) ||
      /<div class="description-summary[\s\S]*?<p>([\s\S]*?)<\/p>/i.exec(html) ||
      /<meta property="og:description" content="([^"]+)"/i.exec(html);
    const description = descMatch ? stripTags(descMatch[1]) : '';

    const blocks = html.split(/<div class="post-content_item[^"]*">/i).slice(1);
    let alternativeTitles = [];
    let author = '';
    let artist = '';
    let status = 'ongoing';

    for (const block of blocks) {
      const headingMatch =
        /<div class="summary-heading[^"]*">([\s\S]*?)<\/div>/i.exec(block) || /<h5[^>]*>([\s\S]*?)<\/h5>/i.exec(block);
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
        if (lower.includes('tamam') || lower.includes('bitti') || lower.includes('completed') || lower.includes('final')) {
          status = 'completed';
        } else if (
          lower.includes('iptal') ||
          lower.includes('bırak') ||
          lower.includes('birak') ||
          lower.includes('cancel') ||
          lower.includes('drop')
        ) {
          status = 'cancelled';
        } else if (lower.includes('ara') || lower.includes('hiatus')) {
          status = 'hiatus';
        }
      }
    }

    const genreRegex = /<a[^>]+href="[^"]*\/(?:webtoon-tur|manga-genre)\/[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;
    const genres = extractRegexMatches(html, genreRegex)
      .map((g) => normalizeGenreToTurkish(stripTags(g[1])))
      .filter(Boolean);

    const chapterRegex = /<li class="[^"]*wp-manga-chapter[^"]*">[\s\S]*?<a href="([^"]+)">([\s\S]*?)<\/a>/gi;
    const chMatches = extractRegexMatches(html, chapterRegex);
    const rawChapters = [];
    for (const ch of chMatches) {
      const chLink = ch[1].trim();
      const chText = stripTags(ch[2]);
      const numMatch = `${chText} ${chLink}`.match(/(\d+(?:\.\d+)?)/);
      const num = numMatch ? parseFloat(numMatch[1]) : 0;
      rawChapters.push({
        title: cleanChapterTitle(chText, num, fallbackTitle),
        link: chLink,
        chapterNumber: num,
      });
    }
    rawChapters.sort((a, b) => a.chapterNumber - b.chapterNumber);

    return {
      source,
      title: fallbackTitle || stripTags(/<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1] || ''),
      link: seriesUrl,
      cover: fallbackCover,
      description,
      alternativeTitles,
      author: author || 'Bilinmiyor',
      artist: artist || undefined,
      status,
      genres,
      isAdult: detectIsAdult({
        source,
        url: seriesUrl,
        html,
        genres,
        title: fallbackTitle,
        description,
        fallbackIsAdult,
      }),
      chapters: rawChapters,
    };
  }

  if (source === 'siyahmelek') {
    const titleMatch = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
    const title = titleMatch ? stripTags(titleMatch[1]).trim() : fallbackTitle;
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

    const h1Idx = html.indexOf('id="manga-title"');
    const smHeroHtml = h1Idx > 0 ? html.slice(Math.max(0, h1Idx - 6000), h1Idx + 4000) : html.slice(0, 45000);

    let smStatus = 'ongoing';
    if (/ribbon-completed|ribbon-finished/i.test(smHeroHtml)) {
      smStatus = 'completed';
    } else if (/ribbon-canceled|ribbon-cancelled|ribbon-dropped/i.test(smHeroHtml)) {
      smStatus = 'cancelled';
    } else if (/ribbon-hiatus|ribbon-paused/i.test(smHeroHtml)) {
      smStatus = 'hiatus';
    } else {
      const smStatusMatch =
        /<span class="manga-status-ribbon__text"[^>]*>([\s\S]*?)<\/span>/i.exec(smHeroHtml) ||
        /(?:Durum|Status)\s*:?\s*<\/[^>]+>\s*<[^>]+>([\s\S]*?)<\//i.exec(smHeroHtml) ||
        /class="[^"]*(?:manga-status|post-status|status-badge|ribbon)[^"]*"[^>]*>([\s\S]*?)<\//i.exec(smHeroHtml);
      if (smStatusMatch) {
        const smLower = stripTags(smStatusMatch[1]).toLowerCase();
        if (smLower.includes('tamam') || smLower.includes('bitti') || smLower.includes('completed') || smLower.includes('final')) {
          smStatus = 'completed';
        } else if (
          smLower.includes('iptal') ||
          smLower.includes('bırak') ||
          smLower.includes('birak') ||
          smLower.includes('cancel') ||
          smLower.includes('drop')
        ) {
          smStatus = 'cancelled';
        } else if (smLower.includes('ara') || smLower.includes('hiatus')) {
          smStatus = 'hiatus';
        }
      }
    }

    const isAdult = detectIsAdult({
      source: 'siyahmelek',
      url: seriesUrl,
      html: smHeroHtml,
      genres,
      title,
      description,
      fallbackIsAdult,
    });

    const chapterItems = html.split(/class="[^"]*chapter-item[^"]*"/i).slice(1);
    const rawChapters = [];
    for (const block of chapterItems) {
      if (block.includes('icon: lock') || block.includes('icon:lock') || block.includes('kilitli')) continue;
      const aMatch = /<a[^>]+href="(https:\/\/siyahmelek\.my\/manga\/[^"/]+\/[^"/]+\/)"[^>]*>([\s\S]*?)<\/a>/i.exec(block);
      if (aMatch) {
        const chLink = aMatch[1].trim();
        const chTitle = stripTags(aMatch[2]);
        const timeMatch = /<time[^>]+datetime="([^"]+)"/i.exec(block);
        const numMatch = `${chTitle} ${chLink}`.match(/(\d+(?:\.\d+)?)/);
        const num = numMatch ? parseFloat(numMatch[1]) : 0;
        rawChapters.push({
          title: cleanChapterTitle(chTitle, num, title),
          link: chLink,
          chapterNumber: num,
          ...(timeMatch?.[1] ? { releaseDate: timeMatch[1].trim() } : {}),
        });
      }
    }
    rawChapters.sort((a, b) => a.chapterNumber - b.chapterNumber);

    return {
      source: 'siyahmelek',
      title,
      link: seriesUrl,
      cover: fallbackCover,
      description,
      alternativeTitles,
      author,
      artist: undefined,
      status: smStatus,
      genres,
      isAdult,
      chapters: rawChapters,
    };
  }

  if (source === 'okutoon') {
    const descMatch =
      /<div class="summary__content[^"]*">([\s\S]*?)<\/div>/i.exec(html) ||
      /<meta property="og:description" content="([^"]+)"/i.exec(html);
    const description = descMatch ? stripTags(descMatch[1]) : '';
    const chapterRegex = /<a[^>]+href="([^"]*\/bolum-[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
    const chMatches = extractRegexMatches(html, chapterRegex);
    const rawChapters = [];
    const seenCh = new Set();

    for (const ch of chMatches) {
      const chLink = ch[1]?.startsWith('http') ? ch[1] : `https://okutoon.com${ch[1]}`;
      const chText = stripTags(ch[2]);
      if (seenCh.has(chLink)) continue;
      seenCh.add(chLink);
      const numMatch = `${chText} ${chLink}`.match(/(\d+(?:\.\d+)?)/);
      const num = numMatch ? parseFloat(numMatch[1]) : 0;
      rawChapters.push({
        title: cleanChapterTitle(chText, num, fallbackTitle),
        link: chLink,
        chapterNumber: num,
      });
    }
    rawChapters.sort((a, b) => a.chapterNumber - b.chapterNumber);

    return {
      source: 'okutoon',
      title: fallbackTitle || stripTags(/<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1] || ''),
      link: seriesUrl,
      cover: fallbackCover,
      description,
      alternativeTitles: [],
      author: 'Bilinmiyor',
      artist: undefined,
      status: 'ongoing',
      genres: ['Webtoon'],
      isAdult: false,
      chapters: rawChapters,
    };
  }

  if (source === 'mangadass') {
    const titleMatch = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
    const title = titleMatch ? cleanSeriesTitle(stripTags(titleMatch[1]).trim()) : fallbackTitle;
    const descMatch = /<div class="[^"]*review-content[^"]*">([\s\S]*?)<\/div>/i.exec(html) ||
                      /<meta property="og:description" content="([^"]+)"/i.exec(html);
    const description = descMatch ? stripTags(descMatch[1]).trim() : '';
    const coverMatch = /<meta property="og:image" content="([^"]+)"/i.exec(html);
    const cover = coverMatch ? coverMatch[1].trim() : fallbackCover;
    const chRegex = /href=["'](\/manga\/[^"']+\/chapter-(\d+(?:\.\d+)?))["'][^>]*>([\s\S]*?)<\/a>/gi;
    const chMatches = extractRegexMatches(html, chRegex);
    const chapterMap = new Map();
    for (const ch of chMatches) {
      const chPath = ch[1].trim();
      const num = parseFloat(ch[2]);
      const fullLink = chPath.startsWith('http') ? chPath : `https://mangadass.com${chPath}`;
      if (!chapterMap.has(num)) {
        const chText = stripTags(ch[3] || `Bölüm ${num}`);
        chapterMap.set(num, {
          title: cleanChapterTitle(chText, num, title),
          link: fullLink,
          chapterNumber: num,
        });
      }
    }
    const rawChapters = Array.from(chapterMap.values()).sort((a, b) => a.chapterNumber - b.chapterNumber);
    const isRaw = title.toLowerCase().includes('(raw)') || seriesUrl.includes('/raw-manhwa') || seriesUrl.endsWith('-raw');
    return {
      source: 'mangadass',
      title: isRaw && !title.toLowerCase().includes('(raw)') ? `${title} (Raw)` : title,
      link: seriesUrl,
      cover,
      description,
      alternativeTitles: [],
      author: 'Bilinmiyor',
      status: 'ongoing',
      genres: ['+18', 'Mature'],
      isAdult: true,
      chapters: rawChapters,
      details: { language: isRaw ? 'raw' : 'en' },
    };
  }

  if (source === 'asurascans') {
    const ogTitle = /<meta property="og:title" content="([^"]+)"/i.exec(html)?.[1];
    const title = ogTitle ? cleanSeriesTitle(ogTitle.replace(/\s*\|\s*Asura\s*Scans/i, '').trim()) : fallbackTitle;
    const descMatch = /<meta property="og:description" content="([^"]+)"/i.exec(html) ||
                      /<span class="[^"]*text-sm text-\[#A2A2A2\][^"]*">([\s\S]*?)<\/span>/i.exec(html);
    const description = descMatch ? stripTags(descMatch[1]).trim() : '';
    const coverMatch = /<meta property="og:image" content="([^"]+)"/i.exec(html);
    const cover = coverMatch ? coverMatch[1].trim() : fallbackCover;

    // Alternative Titles
    const altMatch = html.match(/id=["']alt-titles["'][^>]*>([\s\S]*?)<\/p>/i);
    const alternativeTitles = altMatch
      ? altMatch[1].split(/[•,|/]/).map((t) => stripTags(t).trim()).filter((t) => t.length > 1)
      : [];

    // Author & Artist
    const authorMatch = html.match(/href=["']\/browse\?author=([^"']+)["']/i);
    const author = authorMatch ? decodeURIComponent(authorMatch[1]).trim() : 'Bilinmiyor';
    const artistMatch = html.match(/href=["']\/browse\?artist=([^"']+)["']/i);
    const artist = artistMatch ? decodeURIComponent(artistMatch[1]).trim() : author;

    // Genres
    const genreMatches = extractRegexMatches(html, /href=["']\/browse\?genres=([^"']+)["']/gi);
    const genres = genreMatches.map((m) => normalizeGenreToTurkish(decodeURIComponent(m[1]).trim())).filter(Boolean);
    if (genres.length === 0) genres.push('Webtoon', 'Aksiyon');

    // Chapters (Deduplicated with Chapter 0 / Prologue support)
    const chapterMap = new Map();
    const chRegex = /href=["'](\/comics\/[^"']+\/chapter\/(\d+(?:\.\d+)?))["']/gi;
    const chMatches = extractRegexMatches(html, chRegex);
    for (const ch of chMatches) {
      const chPath = ch[1].trim();
      const num = parseFloat(ch[2]);
      const fullLink = `https://asurascans.com${chPath}`;
      if (!chapterMap.has(num)) {
        chapterMap.set(num, {
          title: num === 0 ? 'Bölüm 0' : `Bölüm ${num}`,
          link: fullLink,
          chapterNumber: num,
        });
      }
    }
    const prologueMatches = extractRegexMatches(html, /href=["'](\/comics\/[^"']+\/chapter\/(?:prologue|0))["']/gi);
    for (const pm of prologueMatches) {
      const pLink = `https://asurascans.com${pm[1].trim()}`;
      if (!chapterMap.has(0)) {
        chapterMap.set(0, {
          title: 'Bölüm 0',
          link: pLink,
          chapterNumber: 0,
        });
      }
    }
    const rawChapters = Array.from(chapterMap.values()).sort((a, b) => a.chapterNumber - b.chapterNumber);

    return {
      source: 'asurascans',
      title,
      link: seriesUrl,
      cover,
      description,
      alternativeTitles,
      author,
      artist,
      status: 'ongoing',
      genres,
      isAdult: false,
      chapters: rawChapters,
      details: { language: 'en' },
    };
  }

  if (source === 'madaradex') {
    const ogTitle = /<meta property="og:title" content="([^"]+)"/i.exec(html)?.[1];
    const h1Match = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
    const title = ogTitle ? cleanSeriesTitle(ogTitle.trim()) : (h1Match ? cleanSeriesTitle(stripTags(h1Match[1]).trim()) : fallbackTitle);
    const descMatch = /<div class="[^"]*description-summary[^"]*">[\s\S]*?<p>([\s\S]*?)<\/p>/i.exec(html) ||
                      /<meta property="og:description" content="([^"]+)"/i.exec(html);
    const description = descMatch ? stripTags(descMatch[1]).trim() : '';
    const coverMatch = /<meta property="og:image" content="([^"]+)"/i.exec(html);
    const cover = coverMatch ? coverMatch[1].trim() : fallbackCover;

    // Alternative Titles
    const altMatch = html.match(/class=["']summary-heading["'][^>]*>\s*<h5>\s*Alternative\s*<\/h5>\s*<\/div>\s*<div class=["']summary-content["'][^>]*>([\s\S]*?)<\/div>/i);
    const alternativeTitles = altMatch
      ? stripTags(altMatch[1]).split(/[,;\n/|•]/).map((t) => t.trim()).filter((t) => t.length > 1)
      : [];

    // Author
    const authorMatch = html.match(/href=["']https?:\/\/madaradex\.org\/manga-author\/[^"'\/?#]+\/["'][^>]*>([^<]+)<\/a>/i);
    const author = authorMatch ? stripTags(authorMatch[1]).trim() : 'Bilinmiyor';

    // Genres
    const genres = ['+18', 'Mature'];
    const genreMatches = extractRegexMatches(html, /href=["']https?:\/\/madaradex\.org\/manga-genre\/[^"'\/?#]+\/["'][^>]*>([^<]+)<\/a>/gi);
    for (const gm of genreMatches) {
      const gName = normalizeGenreToTurkish(stripTags(gm[1]).trim());
      if (gName && !genres.includes(gName)) genres.push(gName);
    }

    // Chapters
    const chapterMap = new Map();
    const chRegex = /href=["'](https?:\/\/madaradex\.org\/(?:title|manga)\/[^"']+\/chapter-(\d+(?:\.\d+)?)[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;
    const chMatches = extractRegexMatches(html, chRegex);
    for (const ch of chMatches) {
      const chUrl = ch[1].trim();
      const num = parseFloat(ch[2]);
      if (!chapterMap.has(num)) {
        chapterMap.set(num, {
          title: `Bölüm ${num}`,
          link: chUrl,
          chapterNumber: num,
        });
      }
    }
    const rawChapters = Array.from(chapterMap.values()).sort((a, b) => a.chapterNumber - b.chapterNumber);

    return {
      source: 'madaradex',
      title,
      link: seriesUrl,
      cover,
      description,
      alternativeTitles,
      author,
      artist: undefined,
      status: 'ongoing',
      genres,
      isAdult: true,
      chapters: rawChapters,
      details: { language: 'en' },
    };
  }

  return null;
};

const fetchChapterPagesFromSource = async (source, chapterLink) => {
  if (source === 'okutoon') {
    let seriesSlug = '';
    let chapterSlug = '';
    try {
      const parsed = new URL(chapterLink);
      const parts = parsed.pathname.split('/').filter(Boolean).filter((p) => p !== 'seri' && p !== 'bolum');
      seriesSlug = parts[0] || '';
      chapterSlug = parts[1] || '';
    } catch {}
    if (!seriesSlug || !chapterSlug) return [];

    const apiUrl = `https://okutoon.com/api/v1/series/${seriesSlug}/chapters/${chapterSlug}`;
    const apiRes = await fetchUpstream(apiUrl, {
      headers: { Accept: 'application/json' },
      timeoutMs: 15000,
    });
    if (!apiRes.ok || !apiRes.content) return [];
    try {
      const json = JSON.parse(apiRes.content);
      const pages = json?.data?.pages || [];
      const rawUrls = pages
        .map((p) => p?.image_url)
        .filter((u) => u && typeof u === 'string' && !isJunkImageUrl(u));
      return await verifyAndFilterImageUrls(rawUrls);
    } catch {
      return [];
    }
  }

  const res = await fetchUpstream(chapterLink, { timeoutMs: 15000 });
  if (!res.ok || !res.content) return [];
  const html = res.content;

  if (source === 'webtoonhatti' || source === 'hattorimanga' || source === 'madaradex') {
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
    const rawUrls = matches.map((m) => m[1]?.trim()).filter((u) => u && !isJunkImageUrl(u));
    return await verifyAndFilterImageUrls(rawUrls);
  }

  if (source === 'siyahmelek') {
    const imgs = [];
    const imgTags = extractRegexMatches(html, /<img[^>]+>/gi);
    for (const [tag] of imgTags) {
      if (!tag.includes('/wp-content/uploads/init-manga/') && !tag.includes('data-original-src')) continue;
      const origSrc = /data-original-src="([^"]+)"/i.exec(tag)?.[1];
      const src = /src="([^"]+)"/i.exec(tag)?.[1];
      const chosen = origSrc || (src && !src.startsWith('data:') ? src : null);
      if (chosen && !isJunkImageUrl(chosen)) imgs.push(chosen);
    }
    if (imgs.length === 0) {
      for (const m of extractRegexMatches(html, /data-original-src="([^"]+)"/gi)) {
        if (m[1] && !isJunkImageUrl(m[1])) imgs.push(m[1]);
      }
    }
    return await verifyAndFilterImageUrls(imgs);
  }

  if (source === 'okutoon') {
    const imgs = [];
    for (const m of extractRegexMatches(html, /<img[^>]+(?:data-src|src)="([^"]+)"/gi)) {
      const u = m[1]?.trim();
      if (u && (u.includes('/uploads/') || u.includes('/chapters/') || u.includes('cdn')) && !isJunkImageUrl(u)) {
        imgs.push(u.startsWith('http') ? u : `https://okutoon.com${u}`);
      }
    }
    return await verifyAndFilterImageUrls(imgs);
  }

  if (source === 'mangadass') {
    const imgs = [];
    for (const m of extractRegexMatches(html, /<img[^>]+src=["'](https?:\/\/img\d*\.mangadass\.com\/[^"']+)["']/gi)) {
      if (m[1] && !isJunkImageUrl(m[1])) imgs.push(m[1].trim());
    }
    return await verifyAndFilterImageUrls(imgs);
  }

  if (source === 'asurascans') {
    const imgs = [];
    for (const m of extractRegexMatches(html, /src=["'](https:\/\/cdn\.asurascans\.com\/asura-images\/chapters\/[^"']+)["']/gi)) {
      if (m[1] && !isJunkImageUrl(m[1])) imgs.push(m[1].trim());
    }
    return await verifyAndFilterImageUrls(imgs);
  }

  if (source === 'madaradex') {
    const imgs = [];
    for (const m of extractRegexMatches(html, /(?:data-src|data-lazy-src|src)=["']\s*(https?:\/\/cdn\.madaradex\.org\/[^"']+)["']/gi)) {
      if (m[1] && !isJunkImageUrl(m[1])) imgs.push(m[1].trim());
    }
    return await verifyAndFilterImageUrls(imgs);
  }

  return [];
};

// ============================================================================
// MULTI-SOURCE METADATA PROVIDERS (AniList, MAL, MangaDex, MangaUpdates, Anime-Planet, aniSearch)
// ============================================================================
const queryAniList = async (searchTerms = [], options = {}) => {
  const { expectedAdult = null } = options;
  const query = `
    query ($search: String) {
      Page(perPage: 5) {
        media(search: $search, type: MANGA) {
          id
          idMal
          status
          chapters
          countryOfOrigin
          startDate { year }
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
          characters(perPage: 20, sort: [ROLE, RELEVANCE]) {
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
          staff(perPage: 10) {
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
    if (!term || term.length < 2 || /^\d+$/.test(term.trim())) continue;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const res = await fetch(ANILIST_API_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ query, variables: { search: term } }),
          signal: AbortSignal.timeout(9000),
        });
        if (res.status === 429) {
          await sleep(2500 * attempt);
          continue;
        }
        if (!res.ok) break;
        const data = await res.json();
        const mediaList = data?.data?.Page?.media;
        if (Array.isArray(mediaList) && mediaList.length > 0) {
          for (const candidate of mediaList) {
            if (expectedAdult === true && candidate.isAdult !== true) continue;
            const candTitles = [
              candidate.title?.romaji,
              candidate.title?.english,
              candidate.title?.native,
              candidate.title?.userPreferred,
              ...(candidate.synonyms || []),
            ].filter(Boolean);
            if (isConfidentTitleMatch(searchTerms, candTitles)) {
              return candidate;
            }
          }
        }
        break;
      } catch {
        break;
      }
    }
    await sleep(750);
  }
  return null;
};

const queryJikanMal = async (searchTerms = [], directMalId = null) => {
  const fetchJikanJson = async (url) => {
    const res = await fetchUpstream(url, {
      timeoutMs: 7000,
      headers: { Accept: 'application/json' },
    });
    if (!res.ok || !res.content) return { status: res.status || 0, json: null };
    try {
      return { status: res.status, json: JSON.parse(res.content) };
    } catch {
      return { status: res.status, json: null };
    }
  };

  const fetchMalCharacters = async (malId) => {
    try {
      await sleep(350);
      const { json: charJson } = await fetchJikanJson(`${JIKAN_API_URL}/${malId}/characters`);
      if (Array.isArray(charJson?.data)) {
        return charJson.data.slice(0, 12).map((c) => ({
          name: c.character?.name ? c.character.name.replace(/^([^,]+),\s*(.+)$/, '$2 $1').trim() : '',
          image: c.character?.images?.jpg?.image_url,
          role: c.role === 'Main' ? 'main' : 'supporting',
        })).filter((c) => c.name);
      }
    } catch {}
    return [];
  };

  if (directMalId) {
    try {
      const { json } = await fetchJikanJson(`${JIKAN_API_URL}/${directMalId}`);
      const manga = json?.data;
      if (manga && manga.mal_id) {
        const characters = await fetchMalCharacters(manga.mal_id);
        return {
          idMal: manga.mal_id,
          url: `https://myanimelist.net/manga/${manga.mal_id}`,
          title: manga.title,
          altTitles: [manga.title_english, manga.title_japanese, ...(manga.titles || []).map((t) => t.title)].filter(Boolean),
          description: manga.synopsis || '',
          cover: manga.images?.jpg?.large_image_url || manga.images?.jpg?.image_url || '',
          authors: (manga.authors || []).map((a) => a.name).filter(Boolean),
          characters,
        };
      }
    } catch {}
  }

  for (const term of searchTerms) {
    if (!term || term.length < 2 || /^\d+$/.test(term.trim())) continue;
    try {
      const { status, json } = await fetchJikanJson(`${JIKAN_API_URL}?q=${encodeURIComponent(term)}&limit=5`);
      if (status === 429) {
        await sleep(1800);
        continue;
      }
      const items = json?.data;
      if (Array.isArray(items) && items.length > 0) {
        const manga = items.find((item) => {
          const candTitles = [item.title, item.title_english, item.title_japanese, ...(item.titles || []).map((t) => t.title)].filter(Boolean);
          return isConfidentTitleMatch(searchTerms, candTitles);
        });
        if (!manga) continue;
        const characters = await fetchMalCharacters(manga.mal_id);
        return {
          idMal: manga.mal_id,
          url: `https://myanimelist.net/manga/${manga.mal_id}`,
          title: manga.title,
          altTitles: [manga.title_english, manga.title_japanese, ...(manga.titles || []).map((t) => t.title)].filter(Boolean),
          description: manga.synopsis || '',
          cover: manga.images?.jpg?.large_image_url || manga.images?.jpg?.image_url || '',
          authors: (manga.authors || []).map((a) => a.name).filter(Boolean),
          characters,
        };
      }
    } catch {}
    await sleep(400);
  }
  return null;
};

const queryMangaDex = async (searchTerms = [], options = {}) => {
  const { expectedAdult = null } = options;
  for (const term of searchTerms) {
    if (!term || term.length < 2 || /^\d+$/.test(term.trim())) continue;
    try {
      const url = `${MANGADEX_API_URL}/manga?title=${encodeURIComponent(term)}&contentRating[]=safe&contentRating[]=suggestive&contentRating[]=erotica&contentRating[]=pornographic&includes[]=cover_art&includes[]=author&includes[]=artist&limit=5`;
      const res = await fetch(url, {
        headers: { 'User-Agent': DEFAULT_USER_AGENT },
        signal: AbortSignal.timeout(7000),
      });
      if (!res.ok) continue;
      const json = await res.json();
      const items = json?.data;
      if (Array.isArray(items) && items.length > 0) {
        const manga = items.find((item) => {
          const rating = item.attributes?.contentRating || 'safe';
          if (expectedAdult === true && !['erotica', 'pornographic'].includes(rating)) return false;
          if (expectedAdult === false && rating === 'pornographic') return false;
          const candTitles = [
            ...Object.values(item.attributes?.title || {}),
            ...(item.attributes?.altTitles || []).flatMap((t) => Object.values(t)),
          ].filter(Boolean);
          return isConfidentTitleMatch(searchTerms, candTitles);
        });
        if (!manga) continue;
        const coverRels = (manga.relationships || []).filter((r) => r.type === 'cover_art' && r.attributes?.fileName);
        const cleanCoverRel = coverRels.find((r) => {
          const fn = (r.attributes?.fileName || '').toLowerCase();
          const desc = (r.attributes?.description || '').toLowerCase();
          return !/promo|credit|endcard|end_card|discord|recruit|mangadex|reklam|tanitim|warning|card/i.test(fn)
            && !/promo|credit|endcard|end_card|discord|recruit|mangadex|reklam|tanitim|warning/i.test(desc);
        }) || coverRels[0];
        // Never use uploads.mangadex.org directly as cover/banner (hotlink protection returns "Read on MangaDex" banner)
        const coverUrl = '';
        const authors = (manga.relationships || [])
          .filter((r) => r.type === 'author' && r.attributes?.name)
          .map((r) => r.attributes.name);
        const artists = (manga.relationships || [])
          .filter((r) => r.type === 'artist' && r.attributes?.name)
          .map((r) => r.attributes.name);

        return {
          id: manga.id,
          url: `https://mangadex.org/title/${manga.id}`,
          cover: coverUrl,
          title: manga.attributes?.title?.en || Object.values(manga.attributes?.title || {})[0] || '',
          description: manga.attributes?.description?.tr || manga.attributes?.description?.en || '',
          altTitles: (manga.attributes?.altTitles || []).flatMap((t) => Object.values(t)).filter(Boolean),
          status: manga.attributes?.status || null,
          lastChapter: manga.attributes?.lastChapter || null,
          authors,
          artists,
        };
      }
    } catch {}
    await sleep(250);
  }
  return null;
};

const queryMangaUpdates = async (searchTerms = []) => {
  for (const term of searchTerms.slice(0, 3)) {
    if (!term || term.length < 2 || /^\d+$/.test(term.trim())) continue;
    try {
      const res = await fetch(MANGAUPDATES_SEARCH_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'User-Agent': DEFAULT_USER_AGENT,
        },
        body: JSON.stringify({ search: term, perpage: 5 }),
        signal: AbortSignal.timeout(7000),
      });
      if (!res.ok) continue;
      const json = await res.json();
      const results = json?.results;
      if (Array.isArray(results) && results.length > 0) {
        const matched = results.find((r) => r?.record?.title && isConfidentTitleMatch(searchTerms, [r.record.title]));
        const record = matched?.record;
        if (record && record.series_id) {
          return {
            id: String(record.series_id),
            url: record.url || `https://www.mangaupdates.com/series/${record.series_id}`,
            title: record.title || '',
            description: record.description || '',
            cover: record.image?.url?.original || record.image?.url?.thumb || '',
            year: record.year ? parseInt(String(record.year), 10) || undefined : undefined,
            genres: Array.isArray(record.genres) ? record.genres.map((g) => g?.genre).filter(Boolean) : [],
          };
        }
      }
    } catch {}
    await sleep(250);
  }
  return null;
};

const queryAnimePlanet = async (searchTerms = []) => {
  for (const term of searchTerms.slice(0, 2)) {
    if (!term || term.length < 2 || /^\d+$/.test(term.trim())) continue;
    try {
      const searchUrl = `${ANIME_PLANET_BASE_URL}/manga/all?name=${encodeURIComponent(term)}`;
      const res = await fetchUpstream(searchUrl, { timeoutMs: 8000 });
      if (!res.ok || !res.content) continue;
      const html = res.content;

      // Direct redirect to manga detail page or search result cards
      const canonicalMatch = /<link[^>]+rel=["']canonical["'][^>]+href=["'](https:\/\/www\.anime-planet\.com\/manga\/[^"'\/?#]+)["']/i.exec(html);
      if (canonicalMatch && !canonicalMatch[1].endsWith('/manga/all')) {
        const url = canonicalMatch[1];
        const slug = url.split('/manga/')[1];
        const titleMatch = /<h1[^>]*itemprop=["']name["'][^>]*>([\s\S]*?)<\/h1>/i.exec(html);
        const candTitle = titleMatch ? stripTags(titleMatch[1]) : '';
        if (candTitle && isConfidentTitleMatch(searchTerms, [candTitle])) {
          return {
            id: slug,
            url,
            title: candTitle,
          };
        }
      }

      const cardMatch = /<a[^>]+class=["'][^"']*tooltip[^"']*["'][^>]+href=["'](\/manga\/[^"'\/?#]+)["'][^>]*>[\s\S]*?<h3[^>]*class=["']cardName["'][^>]*>([\s\S]*?)<\/h3>/i.exec(html);
      if (cardMatch && !cardMatch[1].includes('/manga/all')) {
        const slug = cardMatch[1].replace('/manga/', '');
        const candTitle = stripTags(cardMatch[2]);
        if (candTitle && isConfidentTitleMatch(searchTerms, [candTitle])) {
          return {
            id: slug,
            url: `${ANIME_PLANET_BASE_URL}/manga/${slug}`,
            title: candTitle,
          };
        }
      }
    } catch {}
    await sleep(250);
  }
  return null;
};

const queryAniSearch = async (searchTerms = []) => {
  for (const term of searchTerms.slice(0, 2)) {
    if (!term || term.length < 2 || /^\d+$/.test(term.trim())) continue;
    try {
      const searchUrl = `${ANISEARCH_BASE_URL}/manga/index?char=all&text=${encodeURIComponent(term)}&smode=1`;
      const res = await fetchUpstream(searchUrl, { timeoutMs: 8000 });
      if (!res.ok || !res.content) continue;
      const match = /<a[^>]+href=["']((?:https:\/\/www\.anisearch\.com)?\/manga\/(\d+),([^"'\/?#]+))["'][^>]*>([\s\S]*?)<\/a>/i.exec(res.content);
      if (match) {
        const rawHref = match[1];
        const id = match[2];
        const slugPart = (match[3] || '').replace(/-/g, ' ');
        const linkTitle = stripTags(match[4] || '');
        if (!isConfidentTitleMatch(searchTerms, [linkTitle, slugPart].filter(Boolean))) continue;
        const url = rawHref.startsWith('http') ? rawHref : `${ANISEARCH_BASE_URL}${rawHref}`;
        return { id, url };
      }
    } catch {}
    await sleep(250);
  }
  return null;
};

// ============================================================================
// CATALOG ARCHIVE & DEDUPLICATION STORE
// ============================================================================
class SmartCatalogStore {
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
    this.chapterAutomations = new Map();
    this.chapterAutomationRuns = [];
    this.existingAutomationsByMangaId = new Map();
    this.deletedAutomationMangaIds = new Set(initialState.deletedAutomationMangaIds || []);

    this.titleKeyIndex = new Map();
    this.slugIndex = new Map();
    this.anilistIdIndex = new Map();
    this.malIdIndex = new Map();

    this.rebuildIndexes();
  }

  rebuildIndexes() {
    this.titleKeyIndex.clear();
    this.slugIndex.clear();
    this.anilistIdIndex.clear();
    this.malIdIndex.clear();

    for (const [id, m] of this.mangas.entries()) {
      // 1. BL Temizleme: Arşivden ve Store'dan derhal sil
      if (isBLSeries(m)) {
        logInfo(`[BL Filtresi] BL serisi catalog store'dan temizlendi: ${m.title} (${id})`);
        this.mangas.delete(id);
        this.chapterAutomations.delete(deterministicUuid(`automation:${id}`));
        continue;
      }

      m.title = cleanSeriesTitle(m.title);
      if (m.slug && /-manga-kapagi$/i.test(m.slug)) {
        m.slug = m.slug.replace(/-manga-kapagi$/i, '');
      }

      // 2. Bölüm başlıklarını ve bozuk (.enc) sayfaları temizle
      if (Array.isArray(m.chapters)) {
        const validChapters = [];
        for (const ch of m.chapters) {
          const num = Number(ch.chapterNumber ?? ch.number ?? 0);
          ch.title = cleanChapterTitle(ch.title, num, m.title);
          if (Array.isArray(ch.pages) && ch.pages.length > 0) {
            const cleanPages = ch.pages.filter((p) => !isJunkImageUrl(p));
            if (cleanPages.length === 0) {
              continue; // Tamamı .enc / bozuk olan bölümü atla
            }
            ch.pages = cleanPages;
          }
          validChapters.push(ch);
        }
        m.chapters = validChapters;
      }

      // 3. MangaDex promo/credit veya çöp kapakları temizle ve düşük çözünürlüklü kapakları yükselt
      if (m.cover && isLowResThumbnailUrl(m.cover)) {
        m.cover = upgradeSourceImageUrl(m.cover);
      }
      if (m.banner && isLowResThumbnailUrl(m.banner)) {
        m.banner = upgradeSourceImageUrl(m.banner);
      }
      if (m.cover && isJunkCoverUrl(m.cover)) {
        m.cover = '';
      }
      if (m.banner && isJunkCoverUrl(m.banner)) {
        m.banner = m.cover || '';
      }

      const key = normalizeTitleKey(m.title);
      if (key) this.titleKeyIndex.set(key, id);
      if (m.slug) this.slugIndex.set(m.slug, id);
      for (const alt of m.alternativeTitles || []) {
        const altKey = normalizeTitleKey(alt);
        if (altKey) this.titleKeyIndex.set(altKey, id);
      }
      const anilistLink = (m.sourceLinks || []).find((l) => l?.source === 'anilist');
      const anilistId = m.anilistId || anilistLink?.externalId || anilistLink?.url?.match(/\/manga\/(\d+)/)?.[1];
      if (anilistId) {
        m.anilistId = Number(anilistId);
        this.anilistIdIndex.set(Number(anilistId), id);
      }

      const malLink = (m.sourceLinks || []).find((l) => l?.source === 'myanimelist');
      const malId = m.malId || malLink?.externalId || malLink?.url?.match(/\/manga\/(\d+)/)?.[1];
      if (malId) {
        m.malId = Number(malId);
        this.malIdIndex.set(Number(malId), id);
      }

      // Adult / +18 sanitization: explicit hentai sources stay adult, mixed webtoon sources are sanitized
      if (m.id === 'fe8ad643-1f42-4104-a5b5-4c694ba032e7' || m.slug === 'heroes-never-rest') {
        m.isAdult = false;
        m.is_adult = false;
        m.type = 'manhwa';
        m.genres = (m.genres || []).filter(
          (g) => !/^(?:\+18|18\+|yeti[şs]kin|adult|hentai|erotik|smut)$/i.test(g.trim())
        );
      } else {
        const titleAdult = ADULT_TITLE_REGEX.test(
          [m.title, ...(m.alternativeTitles || [])].join(' ')
        );
        const hasRealAdultGenre = (m.genres || []).some((g) =>
          /^(?:hentai|erotik|erotica|pornographic|nsfw|smut|\+18|18\+|yeti[şs]kin|adult)$/i.test(g.trim())
        );
        if (m.type === 'hentai' || m.details?.primarySource === 'hentaiturk') {
          m.isAdult = true;
          m.is_adult = true;
        } else if (!hasRealAdultGenre && !titleAdult) {
          m.isAdult = false;
          m.is_adult = false;
          if (m.type === 'webtoon_hentai') m.type = 'manhwa';
          m.genres = (m.genres || []).filter(
            (g) => !/^(?:\+18|18\+|yeti[şs]kin|adult|hentai|erotik|smut)$/i.test(g.trim())
          );
        } else {
          m.isAdult = true;
          m.is_adult = true;
        }
      }
    }
  }

  hydrateFromR2(snapshot, tables = null) {
    const r2Mangas =
      Array.isArray(tables?.mangas) && tables.mangas.length > 0
        ? tables.mangas
        : Array.isArray(snapshot?.mangas)
        ? snapshot.mangas
        : null;

    if (r2Mangas) {
      const snapshotMangaMap = new Map(
        (Array.isArray(snapshot?.mangas) ? snapshot.mangas : []).filter((m) => m?.id).map((m) => [m.id, m])
      );

      for (const m of r2Mangas) {
        if (!m || !m.id || isBLSeries(m)) continue;
        const snapM = snapshotMangaMap.get(m.id);
        const rawIncomingChs = Array.isArray(m.chapters) && m.chapters.length > 0
          ? m.chapters
          : Array.isArray(snapM?.chapters)
          ? snapM.chapters
          : [];
        const cleanChs = rawIncomingChs.map((ch) => ({
          ...ch,
          title: cleanChapterTitle(ch.title, ch.chapterNumber ?? ch.number, m.title),
        }));
        const existing = this.mangas.get(m.id);
        if (!existing) {
          this.mangas.set(m.id, {
            ...m,
            isAdult: Boolean(m.isAdult ?? m.is_adult ?? false),
            releaseYear: m.releaseYear ?? m.release_year ?? undefined,
            alternativeTitles: m.alternativeTitles || m.alternative_titles || [],
            sourceLinks: m.sourceLinks || m.source_links || [],
            details: m.details || {},
            chapters: cleanChs,
          });
        } else {
          const existingValidChs = (existing.chapters || [])
            .map((ch) => {
              const filteredPages = Array.isArray(ch.pages) ? ch.pages.filter((p) => !isJunkImageUrl(p)) : [];
              return {
                ...ch,
                title: cleanChapterTitle(ch.title, ch.chapterNumber ?? ch.number, m.title),
                pages: filteredPages,
              };
            })
            .filter((ch) => Array.isArray(ch.pages) && ch.pages.length > 0);

          const incomingHasPages = cleanChs.some((ch) => Array.isArray(ch.pages) && ch.pages.some((p) => !isJunkImageUrl(p)));
          const selectedChs = incomingHasPages || existingValidChs.length === 0 ? cleanChs : existingValidChs;
          this.mangas.set(m.id, {
            ...existing,
            ...m,
            isAdult: Boolean(m.isAdult ?? m.is_adult ?? existing.isAdult ?? false),
            releaseYear: m.releaseYear ?? m.release_year ?? existing.releaseYear ?? undefined,
            alternativeTitles: Array.from(
              new Set([...(existing.alternativeTitles || []), ...(m.alternativeTitles || m.alternative_titles || [])])
            ),
            sourceLinks: this.mergeSourceLinksList(existing.sourceLinks, m.sourceLinks || m.source_links),
            details: { ...(existing.details || {}), ...(m.details || {}) },
            chapters: selectedChs,
          });
        }
      }
    }

    const r2Chars = Array.isArray(tables?.characters) && tables.characters.length > 0 ? tables.characters : snapshot?.characters || [];
    for (const c of r2Chars) {
      if (c?.id) this.characters.set(c.id, { ...(this.characters.get(c.id) || {}), ...c, image: c.image || c.image_url });
    }
    const r2Authors = Array.isArray(tables?.authors) && tables.authors.length > 0 ? tables.authors : snapshot?.authors || [];
    for (const a of r2Authors) {
      if (a?.id) this.authors.set(a.id, { ...(this.authors.get(a.id) || {}), ...a });
    }
    const r2Artists = Array.isArray(tables?.artists) && tables.artists.length > 0 ? tables.artists : snapshot?.artists || [];
    for (const a of r2Artists) {
      if (a?.id) this.artists.set(a.id, { ...(this.artists.get(a.id) || {}), ...a });
    }
    const r2Tags = Array.isArray(tables?.tags) && tables.tags.length > 0 ? tables.tags : snapshot?.tags || [];
    for (const t of r2Tags) {
      if (t?.id) this.tags.set(t.id, { ...(this.tags.get(t.id) || {}), ...t });
    }

    if (tables) {
      if (Array.isArray(tables.manga_characters)) this.mangaCharacters = [...tables.manga_characters];
      if (Array.isArray(tables.manga_authors)) this.mangaAuthors = [...tables.manga_authors];
      if (Array.isArray(tables.manga_artists)) this.mangaArtists = [...tables.manga_artists];
      if (Array.isArray(tables.manga_tags)) this.mangaTags = [...tables.manga_tags];
    }

    this.rebuildIndexes();
  }

  mergeSourceLinksList(listA = [], listB = []) {
    const merged = [];
    const seen = new Set();
    for (const item of [...(listA || []), ...(listB || [])]) {
      if (!item || typeof item !== 'object' || !item.url) continue;
      const key = `${item.source || ''}:${item.url.trim()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push({
        source: item.source,
        url: item.url.trim(),
        ...(item.externalId ? { externalId: String(item.externalId) } : {}),
        ...(item.label ? { label: item.label } : {}),
      });
    }
    return merged;
  }

  upsertSourceLink(manga, linkObj) {
    if (!manga || !linkObj || !linkObj.url || !linkObj.source) return;
    if (!Array.isArray(manga.sourceLinks)) manga.sourceLinks = [];
    const existingIdx = manga.sourceLinks.findIndex((l) => l && l.source === linkObj.source);
    const normalized = {
      source: linkObj.source,
      url: linkObj.url.trim(),
      ...(linkObj.externalId ? { externalId: String(linkObj.externalId) } : {}),
      ...(linkObj.label ? { label: linkObj.label } : {}),
    };
    if (existingIdx >= 0) {
      manga.sourceLinks[existingIdx] = { ...manga.sourceLinks[existingIdx], ...normalized };
    } else {
      manga.sourceLinks.push(normalized);
    }
  }

  getLockedPrimarySource(manga) {
    if (!manga) return null;
    const activeScraperSources = ['webtoonhatti', 'okutoon', 'siyahmelek', 'hattorimanga'];
    if (
      manga.details?.primarySource &&
      manga.details?.primarySourceUrl &&
      activeScraperSources.includes(manga.details.primarySource)
    ) {
      return {
        source: manga.details.primarySource,
        url: manga.details.primarySourceUrl,
      };
    }
    const found = (manga.sourceLinks || []).find((l) => l && activeScraperSources.includes(l.source) && l.url);
    if (found) {
      if (!manga.details) manga.details = {};
      manga.details.primarySource = found.source;
      manga.details.primarySourceUrl = found.url;
      return { source: found.source, url: found.url };
    }
    return null;
  }

  findMatchingMangaId(title, alternativeTitles = []) {
    const isTargetRaw = (title || '').toLowerCase().includes('(raw)') || (title || '').toLowerCase().includes(' raw') || (title || '').toLowerCase().endsWith('-raw');
    const allTitles = [title, ...(alternativeTitles || [])];
    for (const t of allTitles) {
      const key = normalizeTitleKey(t);
      if (key && this.titleKeyIndex.has(key)) {
        const candidateId = this.titleKeyIndex.get(key);
        const candidate = this.mangas.get(candidateId);
        if (candidate) {
          const isCandidateRaw = (candidate.title || '').toLowerCase().includes('(raw)') ||
                                 (candidate.title || '').toLowerCase().includes(' raw') ||
                                 (candidate.details?.language === 'raw');
          // Raw seriler ile çevrilmiş seriler birbirine merge edilmez, ayrı tutulur
          if (isTargetRaw !== isCandidateRaw) {
            continue;
          }
        }
        return candidateId;
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
    keep.alternativeTitles = Array.from(altSet).filter(Boolean);

    if (!keep.description && remove.description) keep.description = remove.description;
    if (!keep.cover && remove.cover) keep.cover = remove.cover;
    if ((!keep.author || keep.author === 'Bilinmiyor') && remove.author) keep.author = remove.author;
    if (!keep.artist && remove.artist) keep.artist = remove.artist;
    if (remove.isAdult) keep.isAdult = true;

    keep.sourceLinks = this.mergeSourceLinksList(keep.sourceLinks, remove.sourceLinks);

    // Only fill chapters if keep has 0 chapters (preserve single-source chapter numbering!)
    if ((!keep.chapters || keep.chapters.length === 0) && Array.isArray(remove.chapters) && remove.chapters.length > 0) {
      keep.chapters = remove.chapters.map((ch) => ({ ...ch, mangaId: keep.id }));
    }

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
    this.rebuildIndexes();
    return keep;
  }

  upsertChapter(manga, ch) {
    if (!manga) return;
    if (!Array.isArray(manga.chapters)) manga.chapters = [];
    const num = Number(ch.chapterNumber ?? ch.number ?? 0);
    const existingIdx = manga.chapters.findIndex((c) => Number(c.chapterNumber ?? c.number) === num);
    const item = {
      id: ch.id || randomUUID(),
      mangaId: manga.id,
      chapterNumber: num,
      number: num,
      title: ch.title || `Bölüm ${num}`,
      pages: ch.pages || [],
      releaseDate: ch.releaseDate || ch.release_date || new Date().toISOString(),
      views: Number(ch.views) || 0,
      _sourceLink: ch.link || ch._sourceLink,
    };
    if (existingIdx !== -1) {
      manga.chapters[existingIdx] = { ...manga.chapters[existingIdx], ...item };
    } else {
      manga.chapters.push(item);
    }
    manga.chapters.sort((a, b) => Number(a.chapterNumber ?? a.number) - Number(b.chapterNumber ?? b.number));
    manga.chapterCount = manga.chapters.length;
    manga.updatedAt = new Date().toISOString();
  }

  addOrMergeSeries(scraped) {
    if (isBLSeries(scraped)) {
      logInfo(`[BL Filtresi] BL serisi atlandı: ${scraped.title}`);
      return null;
    }

    const existingId = this.findMatchingMangaId(scraped.title, scraped.alternativeTitles);
    const now = new Date().toISOString();

    if (existingId && this.mangas.has(existingId)) {
      const existing = this.mangas.get(existingId);
      const locked = this.getLockedPrimarySource(existing);

      const altSet = new Set([...(existing.alternativeTitles || []), ...(scraped.alternativeTitles || [])]);
      altSet.delete(existing.title);
      existing.alternativeTitles = Array.from(altSet).filter(Boolean);

      if ((!existing.description || existing.description.length < 25) && scraped.description) {
        existing.description = scraped.description;
      }
      if (!existing.cover && scraped.cover && !isJunkCoverUrl(scraped.cover)) existing.cover = scraped.cover;
      if (scraped.status === 'completed' || scraped.status === 'cancelled' || scraped.status === 'hiatus') {
        existing.status = scraped.status;
      }
      if (scraped.isAdult) existing.isAdult = true;

      if (scraped.link && scraped.source) {
        this.upsertSourceLink(existing, { source: scraped.source, url: scraped.link });
      }

      // Single-Source Rule: Only merge chapters if from the locked primarySource (or if existing has 0 chapters)
      const isSamePrimarySource = !locked || locked.source === scraped.source;
      if (isSamePrimarySource && Array.isArray(scraped.chapters) && scraped.chapters.length > 0) {
        if (!existing.details) existing.details = {};
        existing.details.primarySource = scraped.source;
        existing.details.primarySourceUrl = scraped.link;

        const existingChMap = new Map();
        for (const ch of existing.chapters || []) {
          existingChMap.set(Number(ch.chapterNumber ?? ch.number ?? 0), ch);
        }

        let addedCount = 0;
        for (const ch of scraped.chapters) {
          const chNum = Number(ch.chapterNumber ?? ch.number ?? 0);
          const chTitle = cleanChapterTitle(ch.title || ch.name, chNum, existing.title);
          if (!existingChMap.has(chNum)) {
            existing.chapters.push({
              id: randomUUID(),
              mangaId: existing.id,
              chapterNumber: chNum,
              title: chTitle,
              pages: ch.pages || [],
              releaseDate: ch.releaseDate || ch.release_date || now,
              views: 0,
              _sourceLink: ch.link,
            });
            addedCount++;
          } else if (
            (!existingChMap.get(chNum).pages || existingChMap.get(chNum).pages.length === 0) &&
            Array.isArray(ch.pages) &&
            ch.pages.length > 0
          ) {
            existingChMap.get(chNum).pages = ch.pages;
          }
        }

        if (addedCount > 0) {
          existing.chapters.sort((a, b) => Number(a.chapterNumber ?? a.number) - Number(b.chapterNumber ?? b.number));
          existing.updatedAt = now;
          existing.details.lastChapterAddedAt = now;
          existing.details.lastSourceActivityAt = now;
        }
      }

      this.syncScrapedTaxonomies(existing.id, scraped);
      this.rebuildIndexes();
      return existing;
    }

    // Create brand-new series locked to this primarySource
    const mangaId = randomUUID();
    const cleanedTitle = cleanSeriesTitle(scraped.title);
    const baseSlug = slugify(cleanedTitle) || `manga-${mangaId.slice(0, 8)}`;
    let finalSlug = baseSlug;
    let counter = 2;
    while (this.slugIndex.has(finalSlug)) {
      finalSlug = `${baseSlug}-${counter++}`;
    }

    const normalizedGenres = Array.from(
      new Set((scraped.genres || []).map(normalizeGenreToTurkish).filter(Boolean))
    );

    const newManga = {
      id: mangaId,
      title: cleanedTitle,
      alternativeTitles: (scraped.alternativeTitles || []).map(cleanSeriesTitle).filter((t) => t && t !== cleanedTitle),
      description: scraped.description || '',
      cover: !isJunkCoverUrl(scraped.cover) ? upgradeSourceImageUrl(scraped.cover) : '',
      banner: !isJunkCoverUrl(scraped.cover) ? upgradeSourceImageUrl(scraped.cover) : '',
      author: scraped.author || 'Bilinmiyor',
      artist: scraped.artist || undefined,
      status: scraped.status || 'ongoing',
      type: deriveMangaType({ isAdult: Boolean(scraped.isAdult), primarySource: scraped.source }),
      genres: normalizedGenres,
      isAdult: Boolean(scraped.isAdult),
      releaseYear: undefined,
      slug: finalSlug,
      views: 0,
      ratings: [],
      chapters: (scraped.chapters || []).map((ch) => ({
        id: randomUUID(),
        mangaId,
        chapterNumber: Number(ch.chapterNumber ?? ch.number ?? 0),
        title: cleanChapterTitle(ch.title, Number(ch.chapterNumber ?? ch.number ?? 0), cleanedTitle),
        pages: ch.pages || [],
        releaseDate: ch.releaseDate || ch.release_date || now,
        views: 0,
        _sourceLink: ch.link,
      })),
      sourceLinks: scraped.link ? [{ source: scraped.source, url: scraped.link }] : [],
      details: {
        primarySource: scraped.source,
        primarySourceUrl: scraped.link,
        lastChapterAddedAt: now,
        lastSourceActivityAt: now,
        lastDeltaCheckAt: now,
      },
      createdAt: now,
      updatedAt: now,
    };

    if (isBLSeries(newManga)) {
      logInfo(`[BL Filtresi] BL serisi atlandı: ${newManga.title}`);
      return null;
    }

    newManga.chapters.sort((a, b) => a.chapterNumber - b.chapterNumber);
    this.mangas.set(mangaId, newManga);
    this.syncScrapedTaxonomies(mangaId, { ...scraped, genres: normalizedGenres });
    this.rebuildIndexes();
    return newManga;
  }

  syncScrapedTaxonomies(mangaId, scraped) {
    if (!mangaId || !scraped) return;

    if (scraped.author && scraped.author !== 'Bilinmiyor') {
      const parts = scraped.author.split(/[,&/]/).map((s) => s.trim()).filter((s) => s.length > 1);
      for (const authName of parts) {
        const authKey = normalizeTitleKey(authName);
        if (!authKey) continue;
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

    if (scraped.artist && scraped.artist !== 'Bilinmiyor') {
      const parts = scraped.artist.split(/[,&/]/).map((s) => s.trim()).filter((s) => s.length > 1);
      for (const artName of parts) {
        const artKey = normalizeTitleKey(artName);
        if (!artKey) continue;
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

    if (Array.isArray(scraped.genres)) {
      for (const rawGenre of scraped.genres) {
        const tagName = normalizeGenreToTurkish(rawGenre);
        if (!tagName || tagName.length < 2) continue;
        const tagKey = normalizeTitleKey(tagName);
        if (!tagKey) continue;
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

  async enrichSeriesAllProviders(mangaId) {
    const manga = this.mangas.get(mangaId);
    if (!manga || isBLSeries(manga)) {
      if (manga && isBLSeries(manga)) {
        logInfo(`[BL Filtresi] BL serisi zenginleştirmeden elendi: ${manga.title} (${mangaId})`);
        this.mangas.delete(mangaId);
      }
      return null;
    }

    const cleanSearchTerm = (str) => {
      if (!str) return '';
      return str
        .replace(/\b(türkçe|oku|webtoon|manhwa|manga|sansürsüz|güncel|bölüm|sezon)\b/gi, ' ')
        .replace(/[–—\-:_|]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    };

    const locked = this.getLockedPrimarySource(manga);
    const rawSlugTail = locked?.url
      ? locked.url.split('/').filter(Boolean).pop()?.replace(/-/g, ' ') || ''
      : (manga.slug || '').replace(/-/g, ' ');
    const slugTerm = /^\d+$/.test(rawSlugTail.trim()) ? '' : rawSlugTail;
    const translatedTitle = await translateTextGtx(manga.title, 'tr', 'en');
    const expectedAdult = Boolean(manga.isAdult);

    const searchTerms = Array.from(
      new Set(
        [
          ...(manga.alternativeTitles || []).map(cleanSearchTerm),
          cleanSearchTerm(translatedTitle),
          cleanSearchTerm(slugTerm),
          cleanSearchTerm(manga.title),
          manga.title,
        ].filter((t) => t && t.length > 2 && !/^\d+$/.test(t.trim()))
      )
    ).slice(0, 6);

    let finalId = manga.id;
    let englishSynopsisCandidate = '';

    // 1. AniList
    const anilistData = await queryAniList(searchTerms, { expectedAdult });
    if (anilistData) {
      if (anilistData.id && this.anilistIdIndex.has(anilistData.id)) {
        const existingId = this.anilistIdIndex.get(anilistData.id);
        if (existingId !== finalId && this.mangas.has(existingId)) {
          this.mergeMangaRecords(existingId, finalId);
          finalId = existingId;
        }
      }
      const target = this.mangas.get(finalId);
      if (target) {
        target.anilistId = anilistData.id;
        this.anilistIdIndex.set(anilistData.id, finalId);
        this.upsertSourceLink(target, {
          source: 'anilist',
          url: `https://anilist.co/manga/${anilistData.id}`,
          externalId: String(anilistData.id),
          label: 'AniList',
        });

        if (anilistData.idMal) {
          target.malId = anilistData.idMal;
          this.malIdIndex.set(anilistData.idMal, finalId);
          this.upsertSourceLink(target, {
            source: 'myanimelist',
            url: `https://myanimelist.net/manga/${anilistData.idMal}`,
            externalId: String(anilistData.idMal),
            label: 'MyAnimeList',
          });
        }

        const titles = [
          anilistData.title?.romaji,
          anilistData.title?.english,
          anilistData.title?.native,
          anilistData.title?.userPreferred,
          ...(anilistData.synonyms || []),
        ].filter(Boolean);
        const altSet = new Set([...(target.alternativeTitles || []), ...titles]);
        altSet.delete(target.title);
        target.alternativeTitles = Array.from(altSet);

        if (anilistData.coverImage?.extraLarge && !isJunkCoverUrl(anilistData.coverImage.extraLarge)) {
          target.cover = anilistData.coverImage.extraLarge;
        }
        if (anilistData.bannerImage && !isJunkCoverUrl(anilistData.bannerImage)) {
          target.banner = anilistData.bannerImage;
        } else if (!target.banner || isJunkCoverUrl(target.banner) || isLowResThumbnailUrl(target.banner)) {
          target.banner = target.cover;
        }
        if (anilistData.startDate?.year && !target.releaseYear) target.releaseYear = anilistData.startDate.year;
        if (anilistData.description) englishSynopsisCandidate = anilistData.description;

        if (anilistData.status === 'CANCELLED' && target.status !== 'completed') {
          target.status = 'cancelled';
        } else if (anilistData.status === 'HIATUS' && target.status === 'ongoing') {
          target.status = 'hiatus';
        } else if (
          anilistData.status === 'FINISHED' &&
          Number(anilistData.chapters) > 0 &&
          (target.chapters || []).length >= Number(anilistData.chapters)
        ) {
          target.status = 'completed';
        }

        if (anilistData.isAdult !== undefined && anilistData.isAdult !== null) {
          if (anilistData.isAdult === true) {
            target.isAdult = true;
            if (!target.genres.includes('Yetişkin')) target.genres.push('Yetişkin');
          } else {
            // AniList confirms clean (non-adult) series: enforce clean unless title has explicit adult keywords
            const titleAdult = ADULT_TITLE_REGEX.test(
              [target.title, ...(target.alternativeTitles || [])].join(' ')
            );
            if (!titleAdult) {
              target.isAdult = false;
              target.genres = (target.genres || []).filter(
                (g) => !/^(?:\+18|18\+|yeti[şs]kin|adult|hentai|erotik|smut)$/i.test(g.trim())
              );
            }
          }
        }

        target.type = deriveMangaType({
          countryOfOrigin: anilistData.countryOfOrigin,
          isAdult: target.isAdult,
          primarySource: locked?.source,
          fallbackType: target.type,
        });

        const mappedGenres = (anilistData.genres || []).map(normalizeGenreToTurkish).filter(Boolean);
        target.genres = Array.from(new Set([...(target.genres || []), ...mappedGenres]));
        this.syncScrapedTaxonomies(finalId, { genres: mappedGenres });

        // Characters
        for (const edge of anilistData.characters?.edges || []) {
          const node = edge?.node;
          if (!node?.name?.full) continue;
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
            const rawDesc = cleanSynopsisFooters(node.description || '').slice(0, 600);
            const trCharDesc = rawDesc ? await translateTextGtx(rawDesc, 'auto', 'tr') : '';
            this.characters.set(charId, {
              id: charId,
              name: charName,
              alternativeName: node.name.native || undefined,
              role: edge.role === 'MAIN' ? 'main' : 'supporting',
              image: node.image?.large || undefined,
              description: trCharDesc || undefined,
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

        // Staff
        for (const edge of anilistData.staff?.edges || []) {
          const node = edge?.node;
          const role = (edge?.role || '').toLowerCase();
          if (!node?.name?.full) continue;
          const staffName = node.name.full;
          if (role.includes('story') || role.includes('original') || role.includes('author')) {
            this.syncScrapedTaxonomies(finalId, { author: staffName });
            if (target.author === 'Bilinmiyor') target.author = staffName;
          }
          if (role.includes('art') || role.includes('illustrator')) {
            this.syncScrapedTaxonomies(finalId, { artist: staffName });
            if (!target.artist) target.artist = staffName;
          }
        }

        // Tags
        const trTags = (anilistData.tags || [])
          .filter((t) => t?.name && (t.rank || 0) >= 40 && !t.isMediaSpoiler)
          .map((t) => normalizeGenreToTurkish(t.name));
        this.syncScrapedTaxonomies(finalId, { genres: trTags });
      }
    }

    const currentManga = this.mangas.get(finalId);
    if (!currentManga) return null;

    // 2. MyAnimeList (Jikan)
    const directMalId = currentManga.malId || anilistData?.idMal || null;
    const hasCharacters = this.mangaCharacters.some((mc) => mc.manga_id === finalId);
    if (!currentManga.malId || !hasCharacters) {
      const jikanData = await queryJikanMal(searchTerms, directMalId);
      if (jikanData && jikanData.idMal) {
        currentManga.malId = jikanData.idMal;
        this.malIdIndex.set(jikanData.idMal, finalId);
        this.upsertSourceLink(currentManga, {
          source: 'myanimelist',
          url: `https://myanimelist.net/manga/${jikanData.idMal}`,
          externalId: String(jikanData.idMal),
          label: 'MyAnimeList',
        });

        const altSet = new Set([...(currentManga.alternativeTitles || []), ...(jikanData.altTitles || [])]);
        altSet.delete(currentManga.title);
        currentManga.alternativeTitles = Array.from(altSet);

        if (!englishSynopsisCandidate && jikanData.description) {
          englishSynopsisCandidate = jikanData.description;
        }
        if ((!currentManga.cover || isJunkCoverUrl(currentManga.cover) || !(await verifyImageUrl(currentManga.cover, { isCover: true }))) && jikanData.cover && !isJunkCoverUrl(jikanData.cover)) {
          currentManga.cover = jikanData.cover;
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
      }
    }

    // 3. MangaDex
    const mdData = await queryMangaDex(searchTerms.slice(0, 3), { expectedAdult });
    if (mdData && mdData.id) {
      this.upsertSourceLink(currentManga, {
        source: 'mangadex',
        url: mdData.url,
        externalId: mdData.id,
        label: 'MangaDex',
      });
      const altSet = new Set([...(currentManga.alternativeTitles || []), ...(mdData.altTitles || [])]);
      altSet.delete(currentManga.title);
      currentManga.alternativeTitles = Array.from(altSet);
      if (!englishSynopsisCandidate && mdData.description) {
        englishSynopsisCandidate = mdData.description;
      }
      if (mdData.status === 'cancelled' && currentManga.status === 'ongoing') {
        currentManga.status = 'cancelled';
      } else if (
        mdData.status === 'completed' &&
        Number(mdData.lastChapter) > 0 &&
        (currentManga.chapters || []).length >= Number(mdData.lastChapter)
      ) {
        currentManga.status = 'completed';
      }
      if (isLowResThumbnailUrl(currentManga.cover)) {
        const upgraded = upgradeSourceImageUrl(currentManga.cover);
        if (upgraded && upgraded !== currentManga.cover && (await verifyImageUrl(upgraded, { isCover: true }))) {
          currentManga.cover = upgraded;
        }
      }
      if ((!currentManga.cover || isJunkCoverUrl(currentManga.cover) || isLowResThumbnailUrl(currentManga.cover)) && mdData.cover && !isJunkCoverUrl(mdData.cover)) {
        currentManga.cover = mdData.cover;
      }
      if (!currentManga.banner || isJunkCoverUrl(currentManga.banner) || isLowResThumbnailUrl(currentManga.banner)) {
        const upgradedBanner = upgradeSourceImageUrl(currentManga.banner);
        if (upgradedBanner && upgradedBanner !== currentManga.banner && (await verifyImageUrl(upgradedBanner, { isCover: true }))) {
          currentManga.banner = upgradedBanner;
        } else {
          currentManga.banner = currentManga.cover;
        }
      }
      if (mdData.authors?.length && currentManga.author === 'Bilinmiyor') {
        currentManga.author = mdData.authors[0];
        this.syncScrapedTaxonomies(finalId, { author: mdData.authors.join(', ') });
      }
      if (mdData.artists?.length && !currentManga.artist) {
        currentManga.artist = mdData.artists[0];
        this.syncScrapedTaxonomies(finalId, { artist: mdData.artists.join(', ') });
      }
    }

    // 4. MangaUpdates (Official V1 API)
    const muData = await queryMangaUpdates(searchTerms);
    if (muData && muData.id) {
      this.upsertSourceLink(currentManga, {
        source: 'mangaupdates',
        url: muData.url,
        externalId: muData.id,
        label: 'MangaUpdates',
      });
      if (!englishSynopsisCandidate && muData.description) {
        englishSynopsisCandidate = muData.description;
      }
      if (!currentManga.releaseYear && muData.year) {
        currentManga.releaseYear = muData.year;
      }
      if (muData.genres?.length) {
        const mapped = muData.genres.map(normalizeGenreToTurkish).filter(Boolean);
        currentManga.genres = Array.from(new Set([...(currentManga.genres || []), ...mapped]));
        this.syncScrapedTaxonomies(finalId, { genres: mapped });
      }
    }

    // 5. Anime-Planet
    const apData = await queryAnimePlanet(searchTerms);
    if (apData && apData.url) {
      this.upsertSourceLink(currentManga, {
        source: 'animeplanet',
        url: apData.url,
        externalId: apData.id,
        label: 'Anime-Planet',
      });
    }

    // 6. aniSearch
    const asData = await queryAniSearch(searchTerms);
    if (asData && asData.url) {
      this.upsertSourceLink(currentManga, {
        source: 'anisearch',
        url: asData.url,
        externalId: asData.id,
        label: 'AniSearch',
      });
    }

    // 7. Guarantee 100% Turkish Description
    currentManga.description = await ensureTurkishDescription(
      currentManga.description,
      englishSynopsisCandidate,
      currentManga.title
    );

    if (!currentManga.details) currentManga.details = {};
    currentManga.details.enrichedAt = new Date().toISOString();

    this.rebuildIndexes();
    return currentManga;
  }

  getSeriesLastActivityTs(m, fallbackMs = Date.now()) {
    const explicitDates = [
      Date.parse(m?.details?.lastChapterAddedAt || ''),
      Date.parse(m?.details?.lastSourceActivityAt || ''),
    ].filter((ts) => Number.isFinite(ts) && ts > 0);

    if (explicitDates.length > 0) {
      return Math.max(...explicitDates);
    }

    const latestChapterDates = (m?.chapters || [])
      .map((c) => Date.parse(c.releaseDate || c.release_date || ''))
      .filter((ts) => Number.isFinite(ts) && ts > 0);
    if (latestChapterDates.length > 0) {
      return Math.max(...latestChapterDates);
    }

    return Date.parse(m?.updatedAt || m?.createdAt || '') || fallbackMs;
  }

  buildAutomationsPayload() {
    const now = new Date().toISOString();
    const nowMs = Date.now();
    const dormantLimitMs = DORMANT_DAYS_LIMIT * 24 * 3600 * 1000;
    const automations = [];
    const runs = [];
    const pruneAutomationIds = [];

    for (const m of this.mangas.values()) {
      const existingAuto = this.existingAutomationsByMangaId?.get(m.id) || null;
      const isAdminOwned = Boolean(existingAuto && (existingAuto.created_by || existingAuto.updated_by));
      const isPausedByAdmin =
        m.details?.automationPausedByAdmin === true || (isAdminOwned && existingAuto?.is_active === false);
      const locked = this.getLockedPrimarySource(m);
      const effectiveSource = isAdminOwned && existingAuto.source ? existingAuto.source : locked?.source;
      const effectiveUrl = isAdminOwned && existingAuto.source_url ? existingAuto.source_url : locked?.url;

      const isCompletedOrCancelled = m.status === 'completed' || m.status === 'cancelled';
      const isUnsupportedSource =
        !effectiveSource || !effectiveUrl || effectiveSource === 'hentaiturk' || effectiveSource === 'hattorimanga';
      const isDisabled =
        m.details?.automationDisabled === true ||
        Boolean(this.deletedAutomationMangaIds && this.deletedAutomationMangaIds.has(m.id));

      const lastActivityTs = this.getSeriesLastActivityTs(m, nowMs);
      const isDormantOrHiatus = m.status === 'hiatus' || nowMs - lastActivityTs > dormantLimitMs;

      if (isDisabled) {
        if (existingAuto?.id) {
          pruneAutomationIds.push(existingAuto.id);
        }
        continue;
      }

      if (!isAdminOwned && !isPausedByAdmin && (isCompletedOrCancelled || isUnsupportedSource || isDormantOrHiatus)) {
        if (existingAuto?.id) {
          pruneAutomationIds.push(existingAuto.id);
        }
        continue;
      }

      if (!effectiveSource || !effectiveUrl) continue;

      const autoId = existingAuto?.id || deterministicUuid(`automation:${m.id}`);
      const isActive = isAdminOwned ? Boolean(existingAuto.is_active) : !isPausedByAdmin;

      const realDeltaCheckAt = m.details?.lastDeltaCheckAt || null;
      const lastAddedCount = Number(
        realDeltaCheckAt ? m.details?.lastAddedChapterCount || 0 : existingAuto?.last_added_chapter_count || 0
      );
      const lastStatus = realDeltaCheckAt ? m.details?.lastRunStatus || 'no_changes' : 'idle';

      automations.push({
        id: autoId,
        automation_type: 'chapter',
        manga_id: m.id,
        source: effectiveSource,
        source_url: effectiveUrl,
        proxy_provider: existingAuto?.proxy_provider || 'cloudflare',
        check_times:
          Array.isArray(existingAuto?.check_times) && existingAuto.check_times.length > 0
            ? existingAuto.check_times
            : ['13:00'],
        schedule_timezone: existingAuto?.schedule_timezone || 'Europe/Istanbul',
        is_active: isActive,
        validation_snapshot: {
          source: effectiveSource,
          sourceTitle: m.title,
          normalizedUrl: effectiveUrl,
          cover: m.cover || null,
          chapterCount: (m.chapters || []).length,
          latestChapterNumber:
            (m.chapters || []).length > 0
              ? Math.max(...m.chapters.map((c) => Number(c.chapterNumber ?? c.number ?? 0)))
              : null,
          checkedAt: realDeltaCheckAt || m.updatedAt || now,
        },
        next_run_at: isActive ? new Date(nowMs + 2 * 3600 * 1000).toISOString() : null,
        last_run_status: lastStatus,
        last_run_started_at: realDeltaCheckAt,
        last_run_finished_at: realDeltaCheckAt,
        last_run_error: null,
        last_added_chapter_count: lastAddedCount,
        created_at: existingAuto?.created_at || m.createdAt || now,
        updated_at: realDeltaCheckAt || existingAuto?.updated_at || m.updatedAt || now,
      });

      if (realDeltaCheckAt) {
        runs.push({
          id: deterministicUuid(`automation_run:${m.id}:${realDeltaCheckAt.slice(0, 13)}`),
          automation_id: autoId,
          status: lastStatus === 'idle' ? 'no_changes' : lastStatus,
          started_at: realDeltaCheckAt,
          finished_at: realDeltaCheckAt,
          chapters_added: lastAddedCount,
          source_chapter_count: (m.chapters || []).length,
          new_chapter_count: lastAddedCount,
          error_message: null,
          details: {
            primarySource: effectiveSource,
            mode: 'github_actions_smart_sync',
          },
        });
      }
    }

    return { automations, runs, pruneAutomationIds };
  }

  toSnapshotPayload() {
    const now = new Date().toISOString();
    const lightweightMangas = Array.from(this.mangas.values()).map((m) => {
      const { chapters, ...rest } = m;
      const isAdult = Boolean(m.isAdult ?? m.is_adult ?? false);
      const createdAt = m.createdAt || m.created_at || now;
      const updatedAt = m.updatedAt || m.last_updated || now;
      return {
        ...rest,
        is_public: true,
        isPublic: true,
        is_adult: isAdult,
        isAdult,
        created_at: createdAt,
        createdAt,
        last_updated: updatedAt,
        updatedAt,
        release_year: m.releaseYear ?? m.release_year ?? null,
        alternative_titles: Array.isArray(m.alternativeTitles) ? m.alternativeTitles : [],
        source_links: Array.isArray(m.sourceLinks) ? m.sourceLinks : [],
        chapters: (chapters || []).map((ch) => ({
          id: ch.id,
          chapterNumber: Number(ch.chapterNumber ?? ch.number ?? 0),
          title: ch.title,
          releaseDate: ch.releaseDate || ch.release_date,
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
    const { automations, runs, pruneAutomationIds } = this.buildAutomationsPayload();

    const sanitizePersonField = (val, fallback = 'Bilinmiyor') => {
      if (!val || typeof val !== 'string') return fallback;
      const cleaned = val
        .split(',')
        .map((p) => p.trim())
        .filter((p) => p && !/^(?:girilmedi\.{0,3}|bilinmiyor|unknown|n\/a|-+|\?+)$/i.test(p))
        .join(', ');
      return (cleaned || fallback).slice(0, 95);
    };

    const sanitizeDescField = (val) => {
      if (!val || typeof val !== 'string') return '';
      return val
        .replace(/<\s*br\s*\/?\s*>/gi, '\n')
        .replace(/\bbr\s*>/gi, '\n')
        .replace(/<\/?\s*(?:p|div|span|strong|em|b|i)\b[^>]*>/gi, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    };

    const mangasRows = Array.from(this.mangas.values()).map((m) => {
      const cleanAuthor = sanitizePersonField(m.author, 'Bilinmiyor');
      const cleanArtist = sanitizePersonField(m.artist || cleanAuthor, cleanAuthor);
      const sortedCh = [...(m.chapters || [])].sort(
        (a, b) => Number(b.chapterNumber ?? b.number ?? 0) - Number(a.chapterNumber ?? a.number ?? 0)
      );
      return {
        id: m.id,
        title: m.title,
        slug: m.slug,
        author: cleanAuthor,
        artist: cleanArtist,
        is_public: true,
        is_adult: Boolean(m.isAdult),
        description: sanitizeDescField(m.description),
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
        chapter_count: sortedCh.length,
        latest_chapters: sortedCh.slice(0, 2).map((ch) => ({
          id: ch.id,
          number: Number(ch.chapterNumber ?? ch.number ?? 0),
        })),
        last_updated: m.updatedAt || m.createdAt || now,
        created_at: m.createdAt || now,
      };
    });

    const chaptersRows = Array.from(this.mangas.values()).flatMap((m) =>
      (m.chapters || []).map((ch) => ({
        id: ch.id,
        manga_id: m.id,
        number: Number(ch.chapterNumber ?? ch.number ?? 0),
        title: ch.title || `Bölüm ${ch.chapterNumber ?? ch.number ?? 0}`,
        pages: [],
        views: ch.views || 0,
        release_date: ch.releaseDate || ch.release_date || now,
        created_at: ch.createdAt || ch.created_at || now,
      }))
    );

    const charactersRows = Array.from(this.characters.values()).map((entity) => ({
      id: entity.id,
      name: entity.name,
      image_url: entity.image_url || entity.imageUrl || entity.image || null,
      description: entity.description || '',
      likes_count: 0,
      is_public: true,
      alternative_names: entity.alternativeName ? [entity.alternativeName] : entity.alternative_names || [],
      details: entity.details || {},
      gallery: [],
      source_links: [],
      created_at: now,
    }));

    const isPlaceholderName = (n) => !n || /^(?:girilmedi\.{0,3}|bilinmiyor|unknown|n\/a|-+|\?+)$/i.test(String(n).trim());

    const authorsRows = Array.from(this.authors.values())
      .filter((entity) => !isPlaceholderName(entity.name))
      .map((entity) => ({
        id: entity.id,
        name: entity.name,
        image_url: entity.image_url || entity.imageUrl || entity.image || null,
        description: entity.description || '',
        likes_count: 0,
        is_public: true,
        alternative_names: entity.alternativeName ? [entity.alternativeName] : entity.alternative_names || [],
        details: entity.details || {},
        gallery: [],
        source_links: [],
        created_at: now,
      }));

    const artistsRows = Array.from(this.artists.values())
      .filter((entity) => !isPlaceholderName(entity.name))
      .map((entity) => ({
        id: entity.id,
        name: entity.name,
        image_url: entity.image_url || entity.imageUrl || entity.image || null,
        description: entity.description || '',
        likes_count: 0,
        is_public: true,
        alternative_names: entity.alternativeName ? [entity.alternativeName] : entity.alternative_names || [],
        details: entity.details || {},
        gallery: [],
        source_links: [],
        created_at: now,
      }));

    const validAuthorIds = new Set(authorsRows.map((a) => a.id));
    const validArtistIds = new Set(artistsRows.map((a) => a.id));

    const tagUsageMap = new Map();
    const normalizedMangaTags = this.mangaTags.map((rel) => {
      if (rel?.tag_id) {
        tagUsageMap.set(rel.tag_id, (tagUsageMap.get(rel.tag_id) || 0) + 1);
      }
      return {
        ...rel,
        is_discoverable: true,
        status: rel.status || 'accepted',
        created_at: rel.created_at || now,
      };
    });

    const tagsRows = Array.from(this.tags.values()).map((tag) => ({
      id: tag.id,
      name: tag.name,
      slug: slugify(tag.slug || tag.name) || 'general',
      category: tag.category || 'theme',
      is_official: true,
      community_approved: true,
      usage_count: tagUsageMap.get(tag.id) || 0,
      created_at: tag.created_at || now,
    }));

    return {
      mangas: mangasRows,
      chapters: chaptersRows,
      characters: charactersRows,
      authors: authorsRows,
      artists: artistsRows,
      tags: tagsRows,
      manga_characters: this.mangaCharacters,
      manga_authors: this.mangaAuthors.filter((ma) => validAuthorIds.has(ma.author_id)),
      manga_artists: this.mangaArtists.filter((mar) => validArtistIds.has(mar.artist_id)),
      manga_tags: normalizedMangaTags,
      manga_relations: [],
      character_tags: [],
      author_tags: [],
      artist_tags: [],
      chapter_automations: automations,
      chapter_automation_runs: runs,
      prune_automation_ids: pruneAutomationIds,
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

// ============================================================================
// PERSISTENT STATE & DUAL R2 + SUPABASE SYNC
// ============================================================================
const loadLocalCheckpoint = () => {
  if (!existsSync(CHECKPOINT_PATH)) {
    return { version: 2, seriesQueue: {}, mangas: {}, characters: {}, authors: {}, artists: {}, tags: {} };
  }
  try {
    const parsed = JSON.parse(readFileSync(CHECKPOINT_PATH, 'utf8'));
    if (parsed.mangas && typeof parsed.mangas === 'object') {
      for (const [id, m] of Object.entries(parsed.mangas)) {
        if (isBLSeries(m)) {
          delete parsed.mangas[id];
          continue;
        }

        // Clean title
        if (m.title) m.title = cleanSeriesTitle(m.title);

        // Fix broken covers
        if (id === '1dc0da7f-ca55-44f1-a7ae-23825a89aef6') {
          m.cover = 'https://s4.anilist.co/file/anilistcdn/media/manga/cover/medium/b170724-ZRBQGuYBi3nU.png';
          m.banner = m.cover;
        } else if (id === '13949589-ce07-40e2-a789-c0c8b0bea4d8') {
          m.cover = 'https://cdn.mangaupdates.com/image/i513504.jpg';
          m.banner = m.cover;
        }

        // Fix Heroes Never Rest false positive
        if (id === 'fe8ad643-1f42-4104-a5b5-4c694ba032e7' || m.slug === 'heroes-never-rest') {
          m.isAdult = false;
          m.is_adult = false;
          m.type = 'manhwa';
          m.genres = (m.genres || []).filter(
            (g) => !/^(?:\+18|18\+|yeti[şs]kin|adult|hentai|erotik|smut)$/i.test(g.trim())
          );
        }
      }
    }
    if (parsed.seriesQueue && typeof parsed.seriesQueue === 'object') {
      for (const [link, item] of Object.entries(parsed.seriesQueue)) {
        if (isBLSeries(item)) {
          delete parsed.seriesQueue[link];
        }
      }
    }
    return parsed;
  } catch {
    return { version: 2, seriesQueue: {}, mangas: {}, characters: {}, authors: {}, artists: {}, tags: {} };
  }
};

const saveLocalCheckpoint = (state) => {
  try {
    state.lastUpdatedAt = new Date().toISOString();
    const tmp = `${CHECKPOINT_PATH}.tmp`;
    const raw = JSON.stringify(state);
    writeFileSync(tmp, raw, 'utf8');
    writeFileSync(CHECKPOINT_PATH, raw, 'utf8');
    try {
      unlinkSync(tmp);
    } catch {}
  } catch (err) {
    logWarn(`Yerel checkpoint kaydedilemedi: ${err.message}`);
  }
};

const ensureSingleSeriesHydratedFromR2 = async (manga) => {
  if (!manga || !manga.slug || manga._hydratedFullChapters || !CATALOG_WORKER_URL) return;
  const hasAllPages =
    Array.isArray(manga.chapters) &&
    manga.chapters.length > 0 &&
    manga.chapters.every((ch) => Array.isArray(ch.pages) && ch.pages.length > 0);
  if (hasAllPages) {
    manga._hydratedFullChapters = true;
    return;
  }
  try {
    const sRes = await fetch(`${CATALOG_WORKER_URL}/v1/catalog/series/${encodeURIComponent(manga.slug)}`, {
      signal: AbortSignal.timeout(10000),
    });
    if (sRes.ok) {
      const fullSeries = await sRes.json();
      if (Array.isArray(fullSeries?.chapters) && fullSeries.chapters.length > 0) {
        const pageMapByNum = new Map();
        const pageMapById = new Map();
        for (const rCh of fullSeries.chapters) {
          const pages = Array.isArray(rCh.pages) ? rCh.pages.filter((p) => !isJunkImageUrl(p)) : [];
          if (pages.length > 0) {
            if (rCh.id) pageMapById.set(rCh.id, pages);
            pageMapByNum.set(Number(rCh.chapterNumber ?? rCh.number ?? 0), pages);
          }
        }
        if (!Array.isArray(manga.chapters) || manga.chapters.length === 0) {
          manga.chapters = fullSeries.chapters;
        } else {
          for (const ch of manga.chapters) {
            if (!Array.isArray(ch.pages) || ch.pages.length === 0) {
              const num = Number(ch.chapterNumber ?? ch.number ?? 0);
              const restored = (ch.id && pageMapById.get(ch.id)) || pageMapByNum.get(num);
              if (restored) ch.pages = restored;
            }
          }
        }
      }
    }
  } catch {}
  manga._hydratedFullChapters = true;
};

const uploadSeriesFileToR2 = async (manga) => {
  if (!CATALOG_WORKER_URL || !CATALOG_ADMIN_TOKEN || !manga?.slug || IS_DRY_RUN) return;
  await ensureSingleSeriesHydratedFromR2(manga);
  const { _hydratedFullChapters, ...cleanManga } = manga;
  try {
    await fetch(`${CATALOG_WORKER_URL}/v1/admin/series/${encodeURIComponent(manga.slug)}?onlySeries=1&raw=1`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'X-Catalog-Admin-Token': CATALOG_ADMIN_TOKEN,
      },
      body: JSON.stringify(cleanManga),
      signal: AbortSignal.timeout(20000),
    });
  } catch (err) {
    logWarn(`Seri R2 yükleme uyarısı (${manga.slug}): ${err.message}`);
  }
};

const HOTLINK_BLOCKED_COVER_REGEX = /(?:webtoonhatti|workers\.dev|mangadex\.org|mangaupdates\.com|siyahmelek)/i;
const IMAGE_PROXY_FALLBACK_URL = 'https://toonparrot-offline-image-proxy.caganhuseyinerdil.workers.dev';

const ensureStaticR2Covers = async (store, touchedSlugs = new Set(), touchedMangaIds = new Set()) => {
  if (!CATALOG_WORKER_URL || !CATALOG_ADMIN_TOKEN) return;
  let updatedCount = 0;

  for (const m of store.mangas.values()) {
    if (m.cover && HOTLINK_BLOCKED_COVER_REGEX.test(m.cover)) {
      const rawCover = m.cover.includes('?url=')
        ? decodeURIComponent(m.cover.split('?url=')[1].split('&')[0])
        : m.cover;
      const fetchUrl = rawCover.startsWith('http')
        ? `${IMAGE_PROXY_FALLBACK_URL}/?url=${encodeURIComponent(rawCover)}`
        : m.cover;
      try {
        const imgRes = await fetch(fetchUrl, { signal: AbortSignal.timeout(10000) });
        if (imgRes.ok) {
          const contentType = imgRes.headers.get('content-type') || 'image/jpeg';
          const ext = contentType.includes('webp') ? 'webp' : contentType.includes('png') ? 'png' : 'jpg';
          const buffer = await imgRes.arrayBuffer();
          const upRes = await fetch(`${CATALOG_WORKER_URL}/v1/admin/cover/${m.id}.${ext}`, {
            method: 'PUT',
            headers: {
              'Content-Type': contentType,
              'X-Catalog-Admin-Token': CATALOG_ADMIN_TOKEN,
            },
            body: buffer,
            signal: AbortSignal.timeout(10000),
          });
          if (upRes.ok) {
            const upJson = await upRes.json();
            if (upJson?.publicUrl) {
              m.cover = upJson.publicUrl;
              touchedSlugs.add(m.slug);
              touchedMangaIds.add(m.id);
              updatedCount++;
            }
          }
        }
      } catch (err) {
        logWarn(`Kapak R2 CDN'e taşınamadı (${m.title}): ${err.message}`);
      }
    }
    if (m.banner && HOTLINK_BLOCKED_COVER_REGEX.test(m.banner)) {
      m.banner = m.cover || '';
      touchedSlugs.add(m.slug);
      touchedMangaIds.add(m.id);
    }
  }

  if (updatedCount > 0) {
    logInfo(`${updatedCount} hotlink korumalı kapak statik R2 CDN (.r2.dev/covers/) üzerine taşındı.`);
  }
};

const syncAllToR2AndSupabase = async (store, seriesQueue, touchedSlugs = new Set(), touchedMangaIds = new Set()) => {
  if (IS_DRY_RUN) {
    logInfo('[DryRun] R2 ve Supabase senkronizasyonu atlandı.');
    return;
  }

  await ensureStaticR2Covers(store, touchedSlugs, touchedMangaIds);
  const tablesPayload = store.toTablesPayload();
  const snapshotPayload = store.toSnapshotPayload();

  // 1. Sync to Cloudflare R2 Catalog Worker (using ?raw=1 zero-CPU streaming)
  if (CATALOG_WORKER_URL && CATALOG_ADMIN_TOKEN) {
    logInfo('Cloudflare R2 katalog tabloları ve otomasyon durumu güncelleniyor...');
    const tableNames = [
      'mangas',
      'chapters',
      'characters',
      'authors',
      'artists',
      'tags',
      'manga_characters',
      'manga_authors',
      'manga_artists',
      'manga_tags',
      'chapter_automations',
      'chapter_automation_runs',
    ];

    for (const tbl of tableNames) {
      const rows = tablesPayload[tbl] || [];
      try {
        const res = await fetch(`${CATALOG_WORKER_URL}/v1/admin/table/${tbl}?raw=1`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'X-Catalog-Admin-Token': CATALOG_ADMIN_TOKEN,
          },
          body: JSON.stringify(rows),
          signal: AbortSignal.timeout(30000),
        });
        if (!res.ok) {
          logWarn(`R2 tablo yanıt uyarısı (${tbl}): HTTP ${res.status}`);
        }
      } catch (err) {
        logWarn(`R2 tablo hatası (${tbl}): ${err.message}`);
      }
    }

    // Update catalog/index.json directly via raw stream
    try {
      const nowIso = new Date().toISOString();
      const indexMangas = snapshotPayload.mangas.map((m) => {
        const { chapters, ...rest } = m;
        const chList = Array.isArray(chapters) ? chapters : [];
        const latestCh = chList.length > 0 ? chList[chList.length - 1] : null;
        return {
          ...rest,
          chapterCount: chList.length,
          latestChapter: latestCh
            ? {
                id: latestCh.id,
                chapterNumber: latestCh.chapterNumber ?? latestCh.number,
                title: latestCh.title,
                releaseDate: latestCh.releaseDate || latestCh.release_date,
              }
            : null,
        };
      });
      await fetch(`${CATALOG_WORKER_URL}/v1/admin/catalog/index`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-Catalog-Admin-Token': CATALOG_ADMIN_TOKEN,
        },
        body: JSON.stringify({
          version: 1,
          updatedAt: nowIso,
          mangas: indexMangas,
        }),
        signal: AbortSignal.timeout(30000),
      });
    } catch (err) {
      logWarn(`R2 index hatası: ${err.message}`);
    }

    // Update snapshot.json via raw stream
    try {
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
      logWarn(`R2 snapshot hatası: ${err.message}`);
    }

    // Upload ONLY touched individual series files
    const mangasToUpload = Array.from(store.mangas.values()).filter((m) => touchedSlugs.has(m.slug));
    if (mangasToUpload.length > 0) {
      logInfo(`R2'ye güncellenen ${mangasToUpload.length} serinin detay dosyası yükleniyor...`);
      for (let i = 0; i < mangasToUpload.length; i += 3) {
        const chunk = mangasToUpload.slice(i, i + 3);
        await Promise.all(chunk.map((m) => uploadSeriesFileToR2(m)));
      }
    }

    // Save persistent automation-state.json in R2
    try {
      await fetch(`${CATALOG_WORKER_URL}/v1/admin/catalog/automation-state`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-Catalog-Admin-Token': CATALOG_ADMIN_TOKEN,
        },
        body: JSON.stringify({
          version: 2,
          updatedAt: new Date().toISOString(),
          seriesQueue,
          deletedAutomationMangaIds: store.deletedAutomationMangaIds ? Array.from(store.deletedAutomationMangaIds) : [],
        }),
        signal: AbortSignal.timeout(25000),
      });
    } catch (err) {
      logWarn(`R2 automation-state kayıt uyarısı: ${err.message}`);
    }
  }

  // 2. Mirror to Supabase PostgreSQL via chunked sync_r2_catalog_to_supabase RPC
  if (!SKIP_SUPABASE_SYNC && SUPABASE_URL && SUPABASE_ANON_KEY && CATALOG_ADMIN_TOKEN) {
    logInfo('Supabase PostgreSQL ikiz katalog senkronizasyonu başlatılıyor...');
    const callSupabaseRpc = async (payloadChunk) => {
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
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
            const errText = await res.text().catch(() => '');
            throw new Error(`HTTP ${res.status}: ${errText.slice(0, 200)}`);
          }
          return await res.json();
        } catch (err) {
          if (attempt === 3) throw err;
          await sleep(1500 * attempt);
        }
      }
    };

    const syncTableInChunks = async (key, rows, chunkSize, extraPayload = {}) => {
      if (!Array.isArray(rows) || rows.length === 0) return;
      for (let i = 0; i < rows.length; i += chunkSize) {
        const chunk = rows.slice(i, i + chunkSize);
        await callSupabaseRpc({
          [key]: chunk,
          ...(i === 0 ? extraPayload : {}),
        });
      }
    };

    try {
      // Sync only touched mangas if we are in a normal incremental run and < 200 mangas were touched; otherwise sync all mangas in chunks
      const mangasToSync =
        !FULL_CHAPTERS_SYNC && touchedMangaIds.size > 0 && touchedMangaIds.size < 250
          ? tablesPayload.mangas.filter((m) => touchedMangaIds.has(m.id))
          : tablesPayload.mangas;

      await syncTableInChunks('mangas', mangasToSync, 400);
      await syncTableInChunks('characters', tablesPayload.characters, 600);
      await syncTableInChunks('authors', tablesPayload.authors, 600);
      await syncTableInChunks('artists', tablesPayload.artists, 600);
      await syncTableInChunks('tags', tablesPayload.tags, 600);
      await syncTableInChunks('manga_characters', tablesPayload.manga_characters, 1500);
      await syncTableInChunks('manga_authors', tablesPayload.manga_authors, 1500);
      await syncTableInChunks('manga_artists', tablesPayload.manga_artists, 1500);
      await syncTableInChunks('manga_tags', tablesPayload.manga_tags, 1500);

      const callAutomationBatchRpc = async (payloadChunk) => {
        for (let attempt = 1; attempt <= 3; attempt++) {
          try {
            const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/sync_chapter_automations_batch`, {
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
              const errText = await res.text().catch(() => '');
              throw new Error(`HTTP ${res.status}: ${errText.slice(0, 200)}`);
            }
            return await res.json();
          } catch (err) {
            if (attempt === 3) throw err;
            await sleep(1500 * attempt);
          }
        }
      };

      const pruneIds = tablesPayload.prune_automation_ids || [];
      for (let i = 0; i < pruneIds.length; i += 400) {
        await callSupabaseRpc({ delete_automation_ids: pruneIds.slice(i, i + 400) });
      }

      const autoRows = tablesPayload.chapter_automations || [];
      for (let i = 0; i < autoRows.length; i += 500) {
        await callAutomationBatchRpc({ chapter_automations: autoRows.slice(i, i + 500) });
      }

      const runRows = tablesPayload.chapter_automation_runs || [];
      for (let i = 0; i < runRows.length; i += 500) {
        await callAutomationBatchRpc({ chapter_automation_runs: runRows.slice(i, i + 500) });
      }

      // Persist details & status patches (lastDeltaCheckAt, lastSourceActivityAt, lastChapterAddedAt) even if last_updated is unchanged
      if (touchedMangaIds.size > 0) {
        const statePatches = Array.from(touchedMangaIds)
          .map((id) => store.mangas.get(id))
          .filter(Boolean)
          .map((m) => ({
            id: m.id,
            status: m.status || 'ongoing',
            details_patch: m.details || {},
          }));
        for (let i = 0; i < statePatches.length; i += 500) {
          await fetch(`${SUPABASE_URL}/rest/v1/rpc/patch_mangas_automation_state_batch`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              apikey: SUPABASE_ANON_KEY,
              Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
            },
            body: JSON.stringify({
              p_admin_token: CATALOG_ADMIN_TOKEN,
              p_items: statePatches.slice(i, i + 500),
            }),
            signal: AbortSignal.timeout(45000),
          }).catch(() => {});
        }
      }

      logInfo(
        `Supabase ana tablolar senkronize edildi: ${mangasToSync.length} manga, ${tablesPayload.characters.length} karakter, ${autoRows.length} aktif otomasyon (${pruneIds.length} tamamlanan/>3 ay inaktif/silinen otomasyondan çıkarıldı).`
      );

      // Step B: Sync chapters (incremental for touchedMangaIds by default, or full if --full-chapters-sync)
      const chaptersToSync = FULL_CHAPTERS_SYNC
        ? tablesPayload.chapters || []
        : (tablesPayload.chapters || []).filter((ch) => touchedMangaIds.has(ch.manga_id));

      if (chaptersToSync.length > 0) {
        let syncedChaptersTotal = 0;
        const chunkSize = 2500;
        for (let i = 0; i < chaptersToSync.length; i += chunkSize) {
          const chChunk = chaptersToSync.slice(i, i + chunkSize);
          const chRes = await callSupabaseRpc({ chapters: chChunk });
          syncedChaptersTotal += Number(chRes?.chapters_synced || chChunk.length);
        }
        logInfo(`Supabase bölüm indeksleri senkronize edildi: ${syncedChaptersTotal} bölüm (pages='{}').`);
      }

      // Step C: Refresh precomputed chapter_count & latest_chapters on mangas when chapters or mangas changed
      if (chaptersToSync.length > 0 || touchedMangaIds.size > 0 || FULL_CHAPTERS_SYNC) {
        await fetch(`${SUPABASE_URL}/rest/v1/rpc/refresh_all_manga_chapter_stats`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            apikey: SUPABASE_ANON_KEY,
            Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
          },
          body: '{}',
          signal: AbortSignal.timeout(45000),
        }).catch(() => {});
        logInfo('Supabase manga bölüm istatistikleri (chapter_count & latest_chapters) güncellendi.');
      }
    } catch (err) {
      logError(`Supabase senkronizasyon hatası: ${err.message}`);
    }
  }
};

// ============================================================================
// MAIN ORCHESTRATOR
// ============================================================================
const main = async () => {
  console.log('='.repeat(76));
  console.log('   TOONPARROT - 7/24 AKILLI OTOMASYON, DELTA BÖLÜM & METADATA MOTORU   ');
  console.log('='.repeat(76));
  logInfo(
    `Mod: ${MODE} | Yeni Seri Batch: ${BATCH_SIZE} | Delta Kontrol: ${MAX_DELTA_CHECKS} | Zenginleştirme Batch: ${MAX_ENRICH_CHECKS} | İnaktif Sınır: ${DORMANT_DAYS_LIMIT} gün`
  );

  const checkpoint = loadLocalCheckpoint();
  const store = new SmartCatalogStore(checkpoint);
  let seriesQueue = checkpoint.seriesQueue || {};
  const touchedSlugs = new Set();
  const touchedMangaIds = new Set();

  // 1. Hydrate from R2 Catalog Worker (fast snapshot + tables, lazy per-series pages)
  if (CATALOG_WORKER_URL && !SKIP_R2_HYDRATE) {
    try {
      logInfo('Cloudflare R2 mevcut katalog ve otomasyon kuyruğu yükleniyor...');
      const [snapRes, tablesRes, autoStateRes] = await Promise.all([
        fetch(`${CATALOG_WORKER_URL}/v1/catalog/snapshot`, { signal: AbortSignal.timeout(20000) }),
        fetch(`${CATALOG_WORKER_URL}/v1/catalog/tables?exclude=chapters`, { signal: AbortSignal.timeout(20000) }),
        fetch(`${CATALOG_WORKER_URL}/v1/catalog/automation-state`, { signal: AbortSignal.timeout(15000) }),
      ]);

      if (snapRes.ok) {
        const snapJson = await snapRes.json();
        const tablesJson = tablesRes.ok ? (await tablesRes.json()).tables : null;
        store.hydrateFromR2(snapJson, tablesJson);
      }

      if (autoStateRes.ok) {
        const autoStateJson = await autoStateRes.json();
        if (autoStateJson?.seriesQueue && Object.keys(autoStateJson.seriesQueue).length > 0) {
          seriesQueue = { ...autoStateJson.seriesQueue, ...seriesQueue };
        }
        if (Array.isArray(autoStateJson?.deletedAutomationMangaIds)) {
          store.deletedAutomationMangaIds = new Set(autoStateJson.deletedAutomationMangaIds);
        }
      }

      logInfo(
        `Katalog yüklendi: ${store.mangas.size} seri, ${store.characters.size} karakter, ${store.authors.size} yazar, ${store.tags.size} etiket.`
      );
    } catch (err) {
      logWarn(`R2 başlangıç yükleme uyarısı: ${err.message}`);
    }
  }

  // 1b. Hydrate Admin Panel automation overrides & activity timestamps from Supabase so manual edits/pauses/deletes are 100% respected
  if (!SKIP_SUPABASE_SYNC && SUPABASE_URL && SUPABASE_ANON_KEY && CATALOG_ADMIN_TOKEN) {
    try {
      const rpcHeaders = {
        'Content-Type': 'application/json',
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      };
      const [autoRes, overrideRes] = await Promise.all([
        fetch(`${SUPABASE_URL}/rest/v1/rpc/list_chapter_automations_for_sync`, {
          method: 'POST',
          headers: rpcHeaders,
          body: JSON.stringify({ p_admin_token: CATALOG_ADMIN_TOKEN }),
          signal: AbortSignal.timeout(25000),
        }),
        fetch(`${SUPABASE_URL}/rest/v1/rpc/list_manga_automation_overrides_for_sync`, {
          method: 'POST',
          headers: rpcHeaders,
          body: JSON.stringify({ p_admin_token: CATALOG_ADMIN_TOKEN }),
          signal: AbortSignal.timeout(25000),
        }),
      ]);

      if (overrideRes.ok) {
        const overrideRows = await overrideRes.json();
        if (Array.isArray(overrideRows)) {
          for (const ov of overrideRows) {
            if (!ov?.id || !store.mangas.has(ov.id)) continue;
            const targetManga = store.mangas.get(ov.id);
            if (ov.status && ['completed', 'cancelled', 'hiatus'].includes(ov.status)) {
              targetManga.status = ov.status;
            }
            if (ov.details && typeof ov.details === 'object') {
              targetManga.details = { ...(targetManga.details || {}), ...ov.details };
              if (ov.details.automationDisabled === true) {
                store.deletedAutomationMangaIds.add(ov.id);
              }
            }
          }
        }
      }

      if (autoRes.ok) {
        const autoRows = await autoRes.json();
        if (Array.isArray(autoRows)) {
          for (const row of autoRows) {
            if (!row?.manga_id) continue;
            if (!store.existingAutomationsByMangaId.has(row.manga_id)) {
              store.existingAutomationsByMangaId.set(row.manga_id, row);
            }
            if ((row.created_by || row.updated_by) && store.mangas.has(row.manga_id)) {
              const targetManga = store.mangas.get(row.manga_id);
              if (!targetManga.details) targetManga.details = {};
              if (row.source && row.source_url) {
                targetManga.details.primarySource = row.source;
                targetManga.details.primarySourceUrl = row.source_url;
              }
              targetManga.details.automationDisabled = false;
              targetManga.details.automationPausedByAdmin = !row.is_active;
              store.deletedAutomationMangaIds.delete(row.manga_id);
            }
          }
          logInfo(`Supabase otomasyon tablosu yüklendi: ${store.existingAutomationsByMangaId.size} kayıt.`);
        }
      }
    } catch (err) {
      logWarn(`Supabase otomasyon yükleme uyarısı: ${err.message}`);
    }
  }

  // ==========================================================================
  // FAZ 1: 4 Ana Kaynakta Vitrin (Son Güncellenenler) Taraması
  // ==========================================================================
  const hotUpdatedMangaIds = new Set();
  if (MODE !== 'enrich-only' && (MAX_DELTA_CHECKS > 0 || BATCH_SIZE > 0)) {
    logInfo(`--- FAZ 1: 4 Ana Kaynak Vitrin Taraması (${PRIMARY_SOURCES.join(', ')}) ---`);
    const sourcesToScan = TARGET_SOURCE ? [TARGET_SOURCE] : PRIMARY_SOURCES;

    let newQueuedFromFrontPage = 0;
    for (const src of sourcesToScan) {
      if (isTimeBudgetExceeded()) break;
      const frontCards = await scanFrontPageFeed(src, FRONT_PAGES_TO_SCAN);
      for (const card of frontCards) {
        const matchedId = store.findMatchingMangaId(card.title);
        if (matchedId && store.mangas.has(matchedId)) {
          const existing = store.mangas.get(matchedId);
          const locked = store.getLockedPrimarySource(existing);
          if (!locked || locked.source === card.source) {
            hotUpdatedMangaIds.add(matchedId);
          } else {
            store.upsertSourceLink(existing, { source: card.source, url: card.link });
          }
        } else if (!seriesQueue[card.link]) {
          seriesQueue[card.link] = {
            ...card,
            priority: 1,
            status: 'pending',
            totalChaptersFound: 0,
            completedChaptersCount: 0,
            updatedAt: new Date().toISOString(),
          };
          newQueuedFromFrontPage++;
        }
      }
      logInfo(`[Vitrin] ${src}: ${frontCards.length} güncel seri kontrol edildi.`);
    }
    logInfo(
      `Vitrin özeti: ${hotUpdatedMangaIds.size} mevcut seride sıcak güncelleme sinyali, +${newQueuedFromFrontPage} yeni seri kuyruğa eklendi.`
    );
  }

  // ==========================================================================
  // FAZ 2: Akıllı Filtreli Delta Bölüm Kontrolü (Tamamlanan & >4 Ay İnaktif Skip)
  // ==========================================================================
  if (MODE !== 'enrich-only' && MAX_DELTA_CHECKS > 0 && !isTimeBudgetExceeded()) {
    logInfo('--- FAZ 2: Akıllı Filtreli Delta Bölüm Kontrolü ---');
    let skippedCompleted = 0;
    let skippedDormant = 0;
    let skippedPaused = 0;
    let skippedCooldown = 0;
    let skippedUnsupported = 0;

    const eligibleForDelta = [];
    const nowMs = Date.now();
    const dormantLimitMs = DORMANT_DAYS_LIMIT * 24 * 3600 * 1000;
    const cooldownLimitMs = COOLDOWN_HOURS * 3600 * 1000;

    for (const manga of store.mangas.values()) {
      const isHot = hotUpdatedMangaIds.has(manga.id);
      const existingAuto = store.existingAutomationsByMangaId.get(manga.id) || null;
      const isAdminOwned = Boolean(existingAuto && (existingAuto.created_by || existingAuto.updated_by));

      if (
        manga.details?.automationDisabled === true ||
        (store.deletedAutomationMangaIds && store.deletedAutomationMangaIds.has(manga.id))
      ) {
        skippedPaused++;
        continue;
      }

      if (
        !FORCE_DELTA &&
        (manga.details?.automationPausedByAdmin === true || (isAdminOwned && existingAuto.is_active === false))
      ) {
        skippedPaused++;
        continue;
      }

      if (
        (manga.status === 'completed' || manga.status === 'cancelled') &&
        (manga.chapters || []).length > 0 &&
        !isAdminOwned &&
        !FORCE_DELTA
      ) {
        skippedCompleted++;
        continue;
      }

      const rawLocked = store.getLockedPrimarySource(manga);
      const locked =
        isAdminOwned && existingAuto.source && existingAuto.source_url
          ? { source: existingAuto.source, url: existingAuto.source_url }
          : rawLocked;
      if (!locked || !PRIMARY_SOURCES.includes(locked.source)) {
        skippedUnsupported++;
        continue;
      }

      if (TARGET_SOURCE && locked.source !== TARGET_SOURCE) {
        continue;
      }

      const lastActivityTs = store.getSeriesLastActivityTs(manga, nowMs);

      if (!isHot && !isAdminOwned && !FORCE_DELTA && (manga.status === 'hiatus' || nowMs - lastActivityTs > dormantLimitMs)) {
        skippedDormant++;
        continue;
      }

      const lastCheckTs = Date.parse(manga.details?.lastDeltaCheckAt || '') || 0;
      if (!isHot && !FORCE_DELTA && lastCheckTs > 0 && nowMs - lastCheckTs < cooldownLimitMs) {
        skippedCooldown++;
        continue;
      }

      eligibleForDelta.push({
        manga,
        locked,
        isHot,
        lastCheckTs,
      });
    }

    eligibleForDelta.sort((a, b) => {
      if (a.isHot !== b.isHot) return a.isHot ? -1 : 1;
      return a.lastCheckTs - b.lastCheckTs;
    });

    const targetDeltaList = eligibleForDelta.slice(0, MAX_DELTA_CHECKS);
    logInfo(
      `Filtreleme Raporu -> Atlanan Tamamlanmış/İptal: ${skippedCompleted} | Atlanan >3 Ay İnaktif: ${skippedDormant} | Duraklatılan: ${skippedPaused} | Cooldown: ${skippedCooldown} | Şimdi Kontrol Edilecek: ${targetDeltaList.length}`
    );

    let deltaIdx = 0;
    for (const item of targetDeltaList) {
      if (isTimeBudgetExceeded()) {
        logInfo('Çalışma süresi bütçesi doldu, delta kontrol döngüsü güvenli sonlandırılıyor...');
        break;
      }
      deltaIdx++;
      const { manga, locked } = item;
      const checkTimeIso = new Date().toISOString();
      if (!manga.details) manga.details = {};
      manga.details.lastDeltaCheckAt = checkTimeIso;
      touchedMangaIds.add(manga.id);

      const detail = await fetchSeriesDetailFromSource(locked.source, locked.url, manga.title, manga.cover, manga.isAdult);
      if (!detail || !Array.isArray(detail.chapters)) {
        manga.details.lastRunStatus = 'error';
        logProgress(deltaIdx, targetDeltaList.length, manga.title, `Kaynak okunamadı (${locked.source})`);
        continue;
      }

      if (detail.status === 'completed' || detail.status === 'cancelled' || detail.status === 'hiatus') {
        manga.status = detail.status;
      }

      const upstreamDates = detail.chapters
        .map((ch) => Date.parse(ch.releaseDate || ch.release_date || ''))
        .filter((ts) => Number.isFinite(ts) && ts > 0);
      if (upstreamDates.length > 0) {
        manga.details.lastSourceActivityAt = new Date(Math.max(...upstreamDates)).toISOString();
      }

      const existingNums = new Set((manga.chapters || []).map((c) => Number(c.chapterNumber ?? c.number ?? 0)));
      const missingChapters = detail.chapters.filter((ch) => !existingNums.has(Number(ch.chapterNumber)));

      if (missingChapters.length === 0) {
        manga.details.lastRunStatus = 'no_changes';
        manga.details.lastAddedChapterCount = 0;
        logProgress(deltaIdx, targetDeltaList.length, manga.title, `Güncel (${manga.chapters.length} bölüm, yeni bölüm yok)`);
        continue;
      }

      logProgress(
        deltaIdx,
        targetDeltaList.length,
        manga.title,
        `${missingChapters.length} YENİ BÖLÜM bulundu, görseller doğrulanıyor...`
      );

      await ensureSingleSeriesHydratedFromR2(manga);

      const newValidChapters = [];
      for (let i = 0; i < missingChapters.length; i += CHAPTER_CONCURRENCY) {
        const chunk = missingChapters.slice(i, i + CHAPTER_CONCURRENCY);
        const results = await Promise.all(
          chunk.map(async (ch) => {
            const pages = await fetchChapterPagesFromSource(locked.source, ch.link);
            if (pages.length === 0) return null;
            return {
              id: randomUUID(),
              mangaId: manga.id,
              chapterNumber: Number(ch.chapterNumber),
              title: cleanChapterTitle(ch.title, Number(ch.chapterNumber), manga.title),
              pages,
              releaseDate: ch.releaseDate || ch.release_date || checkTimeIso,
              views: 0,
              _sourceLink: ch.link,
            };
          })
        );
        for (const r of results) {
          if (r) newValidChapters.push(r);
        }
      }

      if (newValidChapters.length > 0) {
        manga.chapters.push(...newValidChapters);
        manga.chapters.sort((a, b) => Number(a.chapterNumber ?? a.number) - Number(b.chapterNumber ?? b.number));
        manga.updatedAt = checkTimeIso;
        manga.details.lastChapterAddedAt = checkTimeIso;
        manga.details.lastSourceActivityAt = checkTimeIso;
        manga.details.lastRunStatus = 'success';
        manga.details.lastAddedChapterCount = newValidChapters.length;
        touchedSlugs.add(manga.slug);
        touchedMangaIds.add(manga.id);
        await uploadSeriesFileToR2(manga);
        logProgress(deltaIdx, targetDeltaList.length, manga.title, `+${newValidChapters.length} yeni bölüm eklendi!`);
      } else {
        manga.details.lastRunStatus = 'no_changes';
        manga.details.lastAddedChapterCount = 0;
      }
    }
  }

  // ==========================================================================
  // FAZ 3: Kuyruktan Yeni Seri Keşif & Zenginleştirme (Bounded Batch)
  // ==========================================================================
  if (MODE !== 'delta-only' && MODE !== 'enrich-only' && BATCH_SIZE > 0 && !isTimeBudgetExceeded()) {
    const pendingItems = Object.values(seriesQueue)
      .filter((s) => (s.status === 'pending' || s.status === 'partial') && PRIMARY_SOURCES.includes(s.source))
      .filter((s) => !TARGET_SOURCE || s.source === TARGET_SOURCE)
      .sort((a, b) => (b.priority || 0) - (a.priority || 0));

    const batchToProcess = pendingItems.slice(0, BATCH_SIZE);
    if (batchToProcess.length > 0) {
      logInfo(`--- FAZ 3: Kuyruktan ${batchToProcess.length} Yeni Seri Çekiliyor (Toplam Bekleyen: ${pendingItems.length}) ---`);
      let bIdx = 0;
      for (const card of batchToProcess) {
        if (isTimeBudgetExceeded()) {
          logInfo('Çalışma süresi bütçesi doldu, yeni seri çekim döngüsü güvenli sonlandırılıyor...');
          break;
        }
        bIdx++;
        if (isBLSeries(card)) {
          card.status = 'skipped_bl';
          card.updatedAt = new Date().toISOString();
          delete seriesQueue[card.link];
          logInfo(`[BL Filtresi] BL serisi kuyruktan atlandı: ${card.title}`);
          continue;
        }

        const existingId = store.findMatchingMangaId(card.title);
        if (existingId && store.mangas.has(existingId)) {
          const existing = store.mangas.get(existingId);
          store.upsertSourceLink(existing, { source: card.source, url: card.link });

          // Eksik bölümleri kontrol et ve tamamla (Backfill)
          const detail = await fetchSeriesDetailFromSource(card.source, card.link, card.title, card.cover, card.isAdult);
          if (detail && Array.isArray(detail.chapters) && detail.chapters.length > 0) {
            const existingNums = new Set((existing.chapters || []).map((c) => Number(c.chapterNumber ?? c.number ?? 0)));
            const missingChapters = detail.chapters.filter((ch) => !existingNums.has(Number(ch.chapterNumber)));
            if (missingChapters.length > 0) {
              logProgress(bIdx, batchToProcess.length, existing.title, `${missingChapters.length} eksik bölüm kaynaktan (${card.source}) tamamlanıyor...`);
              await ensureSingleSeriesHydratedFromR2(existing);
              for (let i = 0; i < missingChapters.length; i += CHAPTER_CONCURRENCY) {
                const chunk = missingChapters.slice(i, i + CHAPTER_CONCURRENCY);
                const results = await Promise.all(
                  chunk.map(async (ch) => {
                    const pages = await fetchChapterPagesFromSource(card.source, ch.link);
                    return { ...ch, pages };
                  })
                );
                for (const r of results) {
                  if (r.pages && r.pages.length > 0) {
                    store.upsertChapter(existing, {
                      number: r.chapterNumber,
                      title: r.title,
                      pages: r.pages,
                      releaseDate: r.releaseDate || new Date().toISOString(),
                    });
                  }
                }
              }
            }
          }

          card.status = 'completed';
          card.updatedAt = new Date().toISOString();
          touchedMangaIds.add(existing.id);
          logProgress(bIdx, batchToProcess.length, card.title, `Mevcut seriyle eşleşti (${existing.title}), eksik bölümler tamamlandı.`);
          continue;
        }

        logProgress(bIdx, batchToProcess.length, card.title, `Detay ve bölümler çekiliyor [${card.source}]...`);
        const detail = await fetchSeriesDetailFromSource(card.source, card.link, card.title, card.cover, card.isAdult);
        if (!detail || !Array.isArray(detail.chapters) || detail.chapters.length === 0) {
          card.status = 'failed';
          card.updatedAt = new Date().toISOString();
          logWarn(`Seri atlandı (bölüm bulunamadı): ${card.title}`);
          continue;
        }

        if (isBLSeries(detail)) {
          card.status = 'skipped_bl';
          card.updatedAt = new Date().toISOString();
          delete seriesQueue[card.link];
          logInfo(`[BL Filtresi] BL serisi detaydan atlandı: ${detail.title}`);
          continue;
        }

        const existingByAltId = store.findMatchingMangaId(detail.title, detail.alternativeTitles);
        if (existingByAltId && store.mangas.has(existingByAltId)) {
          const existing = store.mangas.get(existingByAltId);
          store.upsertSourceLink(existing, { source: card.source, url: card.link });

          // Eksik bölümleri kontrol et ve tamamla (Backfill)
          const existingNums = new Set((existing.chapters || []).map((c) => Number(c.chapterNumber ?? c.number ?? 0)));
          const missingChapters = (detail.chapters || []).filter((ch) => !existingNums.has(Number(ch.chapterNumber)));
          if (missingChapters.length > 0) {
            logProgress(bIdx, batchToProcess.length, existing.title, `${missingChapters.length} eksik bölüm kaynaktan (${card.source}) tamamlanıyor...`);
            await ensureSingleSeriesHydratedFromR2(existing);
            for (let i = 0; i < missingChapters.length; i += CHAPTER_CONCURRENCY) {
              const chunk = missingChapters.slice(i, i + CHAPTER_CONCURRENCY);
              const results = await Promise.all(
                chunk.map(async (ch) => {
                  const pages = await fetchChapterPagesFromSource(card.source, ch.link);
                  return { ...ch, pages };
                })
              );
              for (const r of results) {
                if (r.pages && r.pages.length > 0) {
                  store.upsertChapter(existing, {
                    number: r.chapterNumber,
                    title: r.title,
                    pages: r.pages,
                    releaseDate: r.releaseDate || new Date().toISOString(),
                  });
                }
              }
            }
          }

          card.status = 'completed';
          card.updatedAt = new Date().toISOString();
          touchedMangaIds.add(existing.id);
          logProgress(bIdx, batchToProcess.length, card.title, `Alternatif isimle mevcut seriye bağlandı (${existing.title}), eksik bölümler tamamlandı.`);
          continue;
        }

        const validChapters = [];
        for (let i = 0; i < detail.chapters.length; i += CHAPTER_CONCURRENCY) {
          const chunk = detail.chapters.slice(i, i + CHAPTER_CONCURRENCY);
          const results = await Promise.all(
            chunk.map(async (ch) => {
              const pages = await fetchChapterPagesFromSource(card.source, ch.link);
              if (pages.length === 0) return null;
              return { ...ch, title: cleanChapterTitle(ch.title, ch.chapterNumber, detail.title), pages };
            })
          );
          for (const r of results) {
            if (r) validChapters.push(r);
          }
        }

        if (validChapters.length === 0) {
          card.status = 'failed';
          card.updatedAt = new Date().toISOString();
          logWarn(`Seri elendi (0 çalışan bölüm): ${card.title}`);
          continue;
        }

        detail.chapters = validChapters;
        const addedManga = store.addOrMergeSeries(detail);
        if (addedManga) {
          addedManga._hydratedFullChapters = true;
          const enrichedManga = (await store.enrichSeriesAllProviders(addedManga.id)) || addedManga;

          if (enrichedManga?.slug) {
            touchedSlugs.add(enrichedManga.slug);
            touchedMangaIds.add(enrichedManga.id);
            await uploadSeriesFileToR2(enrichedManga);
          }

          card.status = 'completed';
          card.totalChaptersFound = detail.chapters.length;
          card.completedChaptersCount = validChapters.length;
          card.updatedAt = new Date().toISOString();
          logProgress(
            bIdx,
            batchToProcess.length,
            enrichedManga.title,
            `Tamamlandı (${validChapters.length} bölüm, Türkçe açıklama & AniList/MAL eşleşti)`
          );

          // Toplu / Arşiv çekiminde her 5 seride bir veritabanı & R2 ara kaydı yap
          if (bIdx % 5 === 0 && touchedMangaIds.size > 0 && !SKIP_SUPABASE_SYNC) {
            try {
              logInfo(`[Checkpoint] ${bIdx}. seri tamamlandı, R2 ve Supabase ara kaydı yapılıyor...`);
              saveLocalCheckpoint({ ...checkpoint, seriesQueue, ...store.toState() });
              await syncAllToR2AndSupabase(store, seriesQueue, touchedSlugs, touchedMangaIds);
            } catch (cpErr) {
              logWarn(`[Checkpoint] Ara kayıt sırasında hata (işlem devam ediyor): ${cpErr.message}`);
            }
          }
        }
      }
    }
  }

  // ==========================================================================
  // FAZ 4: Mevcut Serilerde Eksik AniList / MAL / Türkçe Açıklama Tamamlama (Bounded Batch)
  // ==========================================================================
  if (MAX_ENRICH_CHECKS > 0 && !isTimeBudgetExceeded()) {
    const mangasNeedingEnrich = Array.from(store.mangas.values()).filter((m) => {
      if (FORCE_ENRICH) return true;
      const hasDesc = Boolean(m.description && m.description.trim().length >= 20);
      const hasTurkishDesc = !hasDesc || isLikelyTurkish(m.description);
      if (m.details?.enrichedAt && hasTurkishDesc) return false;
      const hasAnilist = (m.sourceLinks || []).some((l) => l?.source === 'anilist');
      const hasMal = (m.sourceLinks || []).some((l) => l?.source === 'myanimelist');
      return !hasAnilist || !hasMal || !hasTurkishDesc || !m.details?.enrichedAt;
    });

    const enrichBatch = mangasNeedingEnrich.slice(0, MAX_ENRICH_CHECKS);
    if (enrichBatch.length > 0) {
      logInfo(
        `--- FAZ 4: ${enrichBatch.length}/${mangasNeedingEnrich.length} seride çoklu kaynak metadata ve Türkçe açıklama zenginleştirmesi yapılıyor ---`
      );
      let idx = 0;
      for (const m of enrichBatch) {
        if (isTimeBudgetExceeded()) {
          logInfo('Çalışma süresi bütçesi doldu, metadata zenginleştirme döngüsü güvenli sonlandırılıyor...');
          break;
        }
        idx++;
        if (!store.mangas.has(m.id)) continue;
        logProgress(idx, enrichBatch.length, m.title, 'AniList + MAL + MangaDex + MangaUpdates + AnimePlanet + Türkçe Açıklama');
        const updated = await store.enrichSeriesAllProviders(m.id);
        if (updated?.slug) {
          touchedSlugs.add(updated.slug);
          touchedMangaIds.add(updated.id);
        }
      }
    }
  }

  // Save checkpoint & sync to R2 + Supabase
  saveLocalCheckpoint({ ...checkpoint, seriesQueue, ...store.toState() });
  await syncAllToR2AndSupabase(store, seriesQueue, touchedSlugs, touchedMangaIds);

  console.log('='.repeat(76));
  logInfo(
    `Otomasyon Başarıyla Tamamlandı! Toplam Seri: ${store.mangas.size} | Toplam Bölüm: ${store.toTablesPayload().chapters.length} | Karakter: ${store.characters.size} | Yazar: ${store.authors.size}`
  );
  console.log('='.repeat(76));
};

main()
  .then(() => {
    clearTimeout(globalTimeoutTimer);
    process.exit(0);
  })
  .catch((err) => {
    clearTimeout(globalTimeoutTimer);
    logError(`Kritik otomasyon hatası: ${err.message}\n${err.stack}`);
    process.exit(1);
  });
