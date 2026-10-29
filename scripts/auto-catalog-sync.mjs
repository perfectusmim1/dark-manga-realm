#!/usr/bin/env node
/**
 * ToonParrot - 24/7 Smart Automated Scraper, Delta Chapter Checker & Multi-Source Metadata Engine
 *
 * Features:
 * 1. 4 Primary High-Quality Sources with Single-Source-per-Series Lock (Prevents 1-2 chapter shifts):
 *    - Normal: webtoonhatti (Priority 1), okutoon (Priority 2)
 *    - +18 Adult: siyahmelek (Priority 1, unlocked chapters), hattorimanga (Priority 2)
 * 2. Smart Filtering & Fast Delta Chapter Checking:
 *    - Auto-skips completed series (status === 'completed')
 *    - Auto-skips dormant series (> 4 months / 120 days since last chapter, unless on front-page latest feed)
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
const SCRAPER_PROXY_URL = (process.env.VITE_SCRAPER_PROXY_URL || process.env.SCRAPER_PROXY_URL || '').replace(/\/+$/, '');
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

const MODE = getArgValue('--mode', 'smart'); // 'smart' | 'delta-only' | 'enrich-only' | 'discover'
const BATCH_SIZE = Math.max(0, parseInt(getArgValue('--batch-size', '6'), 10) || 6);
const MAX_DELTA_CHECKS = Math.max(0, parseInt(getArgValue('--max-delta-checks', '20'), 10) || 20);
const COOLDOWN_HOURS = Math.max(0, parseFloat(getArgValue('--cooldown-hours', '6')) || 6);
const DORMANT_DAYS_LIMIT = Math.max(30, parseInt(getArgValue('--dormant-days', '120'), 10) || 120); // 4 months = 120 days
const FRONT_PAGES_TO_SCAN = Math.max(1, parseInt(getArgValue('--front-pages', '2'), 10) || 2);
const TARGET_SOURCE = getArgValue('--source', null);
const FORCE_ENRICH = hasFlag('--force-enrich');
const FORCE_DELTA = hasFlag('--force-delta');
const IS_DRY_RUN = hasFlag('--dry-run');
const MAX_RUNTIME_MINUTES = Math.max(5, parseInt(getArgValue('--max-runtime-minutes', '25'), 10) || 25);

const PRIMARY_SOURCES = ['webtoonhatti', 'okutoon', 'siyahmelek', 'hattorimanga'];
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

const cleanSeriesTitle = (title) =>
  (title || '')
    .toString()
    .replace(/\s*[–—-]\s*manga\s*kapağı\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();

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
const fetchUpstream = async (targetUrl, options = {}) => {
  const method = options.method || 'GET';
  const customHeaders = options.headers || {};
  const body = options.body;
  const timeoutMs = options.timeoutMs || 12000;

  const baseHeaders = {
    'User-Agent': DEFAULT_USER_AGENT,
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
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

  const isDirectCapable =
    domain.includes('siyahmelek') ||
    domain.includes('okutoon') ||
    domain.includes('hattorimanga') ||
    domain.includes('anime-planet') ||
    domain.includes('anisearch') ||
    domain.includes('mangaupdates');

  if (isDirectCapable) {
    try {
      const directRes = await fetch(targetUrl, {
        method,
        headers: baseHeaders,
        body: body ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
        redirect: 'follow',
      });
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
    } catch {}
  }

  if (SCRAPER_PROXY_URL) {
    try {
      const proxyRes = await fetch(SCRAPER_PROXY_URL, {
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
  'base64',
  'data:image',
];

const isJunkImageUrl = (url) => {
  if (!url || typeof url !== 'string') return true;
  const trimmed = url.trim();
  if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) return true;
  const lower = trimmed.toLowerCase();
  if (/\.(?:svg|ico|gif)(?:\?.*)?$/i.test(lower)) return true;
  return JUNK_URL_PATTERNS.some((p) => lower.includes(p));
};

const verifiedDomainSuccessCounts = new Map();
const verifiedDomainCache = new Map([
  ['cdn.hentaiturk.com', true],
  ['cdn-2.webtoon-oku.net', true],
  ['cdn.mangacix.net', true],
  ['api.golgebahcesi.com', true],
  ['api.dxdfansub.com', true],
  ['s4.anilist.co', true],
  ['cdn.myanimelist.net', true],
  ['uploads.mangadex.org', true],
]);
const verifiedUrlCache = new Map();

const verifyImageUrl = async (url) => {
  if (isJunkImageUrl(url)) return false;
  const cleanUrl = url.trim();
  if (verifiedUrlCache.has(cleanUrl)) return verifiedUrlCache.get(cleanUrl);

  let domain = '';
  try {
    domain = new URL(cleanUrl).hostname;
  } catch {
    return false;
  }

  if (verifiedDomainCache.get(domain) === true) return true;
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
    if (isImage) {
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
// 4 PRIMARY SOURCE SCRAPERS (WebtoonHattı, OkuToon, SiyahMelek, HattoriManga)
// ============================================================================
const scanFrontPageFeed = async (source, maxPages = 2) => {
  const cards = [];
  const seen = new Set();

  if (source === 'webtoonhatti') {
    const feedUrls = [
      { url: 'https://webtoonhatti.club/manga/page/1/?m_orderby=latest', isAdult: false },
      { url: 'https://webtoonhatti.club/webtoon-tur/adult/page/1/?m_orderby=latest', isAdult: true },
    ];
    for (const feed of feedUrls) {
      for (let page = 1; page <= maxPages; page++) {
        const pageUrl = feed.url.replace('/page/1/', `/page/${page}/`);
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
            cards.push({ source: 'webtoonhatti', title, link, cover, isAdult: feed.isAdult, genres: feed.isAdult ? ['+18'] : [] });
          }
        }
      }
    }
  } else if (source === 'okutoon') {
    for (let page = 1; page <= maxPages; page++) {
      const res = await fetchUpstream(`https://okutoon.com/tur?sayfa=${page}`);
      if (!res.ok || !res.content) break;
      const matches = extractRegexMatches(
        res.content,
        /<a[^>]+href="([^"]+)"[^>]*>[\s\S]*?<img[^>]+src="([^"]*covers[^"]*)"[^>]*>[\s\S]*?<h[23][^>]*>([\s\S]*?)<\/h[23]>/gi
      );
      if (matches.length === 0) break;
      for (const m of matches) {
        const link = m[1]?.startsWith('http') ? m[1] : `https://okutoon.com${m[1]}`;
        const cover = m[2]?.startsWith('http') ? m[2] : `https://okutoon.com${m[2]}`;
        const title = stripTags(m[3]);
        if (link && title && !seen.has(link)) {
          seen.add(link);
          cards.push({ source: 'okutoon', title, link, cover, isAdult: false, genres: [] });
        }
      }
    }
  } else if (source === 'siyahmelek') {
    for (let page = 1; page <= maxPages; page++) {
      const res = await fetchUpstream(`https://siyahmelek.my/manga/page/${page}/`);
      if (!res.ok || !res.content) break;
      const matches = extractRegexMatches(
        res.content,
        /<div class="manga-item-grid">[\s\S]*?<a href="(https:\/\/siyahmelek\.my\/manga\/[^"/]+\/)">[\s\S]*?<img[^>]+src="([^"]+)"[\s\S]*?alt="([^"]+) için kapak görseli"/gi
      );
      if (matches.length === 0) break;
      for (const m of matches) {
        const link = m[1]?.trim();
        const cover = m[2]?.trim();
        const title = stripTags(m[3]);
        if (link && title && !seen.has(link)) {
          seen.add(link);
          cards.push({ source: 'siyahmelek', title, link, cover, isAdult: true, genres: ['Yetişkin', 'Manhwa'] });
        }
      }
    }
  } else if (source === 'hattorimanga') {
    for (let page = 1; page <= maxPages; page++) {
      const pageUrl = page === 1 ? 'https://hattorimanga.net/manga/' : `https://hattorimanga.net/manga/page/${page}/`;
      const res = await fetchUpstream(pageUrl);
      if (!res.ok || !res.content) break;
      const blocks = res.content.split(/class=["'][^"']*(?:page-item-detail|c-tabs-item__content|badge-pos-\d+)[^"']*["']/i).slice(1);
      if (blocks.length === 0) break;
      for (const b of blocks) {
        const linkMatch = b.match(/href=["'](https:\/\/hattorimanga\.net\/manga\/[^"'\/?#]+(?:\/)?)["']/i);
        const titleMatch = b.match(/title=["']([^"']+)["']/i) || b.match(/<a[^>]+href=["'][^"']+["'][^>]*>([^<]+)<\/a>/i);
        const imgMatch = b.match(/(?:data-src|data-lazy-src|src)=["']([^"']+\.(?:webp|jpg|jpeg|png)[^"']*)["']/i);
        const link = linkMatch?.[1]?.trim();
        const title = titleMatch?.[1] ? cleanSeriesTitle(stripTags(titleMatch[1])) : '';
        const cover = imgMatch?.[1]?.trim() || '';
        if (link && title && !seen.has(link)) {
          seen.add(link);
          cards.push({ source: 'hattorimanga', title, link, cover, isAdult: true, genres: ['Yetişkin', 'Manhwa'] });
        }
      }
    }
  }

  return cards;
};

const fetchSeriesDetailFromSource = async (source, seriesUrl, fallbackTitle = '', fallbackCover = '', fallbackIsAdult = false) => {
  const res = await fetchUpstream(seriesUrl, { timeoutMs: 15000 });
  if (!res.ok || !res.content) return null;
  const html = res.content;

  if (source === 'webtoonhatti' || source === 'hattorimanga') {
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
        title: chText || `Bölüm ${num}`,
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
      isAdult: Boolean(fallbackIsAdult || source === 'hattorimanga' || /yetişkin|adult|smut|ecchi|mature|\+18/i.test(genres.join(' '))),
      chapters: rawChapters,
    };
  }

  if (source === 'siyahmelek') {
    const titleMatch = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
    const title = titleMatch ? stripTags(titleMatch[1]) : fallbackTitle;
    const descMatch = /<div class="manga-description[^"]*">([\s\S]*?)<\/div>/i.exec(html);
    const description = descMatch ? stripTags(descMatch[1]) : '';

    const chapterItems = html.split(/class="[^"]*chapter-item[^"]*"/i).slice(1);
    const rawChapters = [];
    for (const block of chapterItems) {
      if (block.includes('icon: lock') || block.includes('icon:lock') || block.includes('kilitli')) continue;
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
      source: 'siyahmelek',
      title,
      link: seriesUrl,
      cover: fallbackCover,
      description,
      alternativeTitles: [],
      author: 'Bilinmiyor',
      artist: undefined,
      status: 'ongoing',
      genres: ['Yetişkin', 'Manhwa'],
      isAdult: true,
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
        title: chText || `Bölüm ${num}`,
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

  return null;
};

const fetchChapterPagesFromSource = async (source, chapterLink) => {
  const res = await fetchUpstream(chapterLink, { timeoutMs: 15000 });
  if (!res.ok || !res.content) return [];
  const html = res.content;

  if (source === 'webtoonhatti' || source === 'hattorimanga') {
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

  return [];
};

// ============================================================================
// MULTI-SOURCE METADATA PROVIDERS (AniList, MAL, MangaDex, MangaUpdates, Anime-Planet, aniSearch)
// ============================================================================
const queryAniList = async (searchTerms = []) => {
  const query = `
    query ($search: String) {
      Page(perPage: 3) {
        media(search: $search, type: MANGA) {
          id
          idMal
          status
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
          characters(perPage: 15, sort: [ROLE, RELEVANCE]) {
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
    if (!term || term.length < 2) continue;
    try {
      const res = await fetch(ANILIST_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ query, variables: { search: term } }),
        signal: AbortSignal.timeout(8000),
      });
      if (res.status === 429) {
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
    await sleep(300);
  }
  return null;
};

const queryJikanMal = async (searchTerms = [], directMalId = null) => {
  const fetchMalCharacters = async (malId) => {
    try {
      await sleep(350);
      const charRes = await fetch(`${JIKAN_API_URL}/${malId}/characters`, {
        headers: { 'User-Agent': DEFAULT_USER_AGENT },
        signal: AbortSignal.timeout(7000),
      });
      if (charRes.ok) {
        const charJson = await charRes.json();
        if (Array.isArray(charJson?.data)) {
          return charJson.data.slice(0, 12).map((c) => ({
            name: c.character?.name ? c.character.name.replace(/^([^,]+),\s*(.+)$/, '$2 $1').trim() : '',
            image: c.character?.images?.jpg?.image_url,
            role: c.role === 'Main' ? 'main' : 'supporting',
          })).filter((c) => c.name);
        }
      }
    } catch {}
    return [];
  };

  if (directMalId) {
    try {
      const res = await fetch(`${JIKAN_API_URL}/${directMalId}`, {
        headers: { 'User-Agent': DEFAULT_USER_AGENT },
        signal: AbortSignal.timeout(7000),
      });
      if (res.ok) {
        const json = await res.json();
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
      }
    } catch {}
  }

  for (const term of searchTerms) {
    if (!term || term.length < 2) continue;
    try {
      const res = await fetch(`${JIKAN_API_URL}?q=${encodeURIComponent(term)}&limit=3`, {
        headers: { 'User-Agent': DEFAULT_USER_AGENT },
        signal: AbortSignal.timeout(7000),
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
        signal: AbortSignal.timeout(7000),
      });
      if (!res.ok) continue;
      const json = await res.json();
      const items = json?.data;
      if (Array.isArray(items) && items.length > 0) {
        const manga = items[0];
        const coverRel = (manga.relationships || []).find((r) => r.type === 'cover_art');
        const coverFileName = coverRel?.attributes?.fileName;
        const coverUrl = coverFileName ? `https://uploads.mangadex.org/covers/${manga.id}/${coverFileName}` : '';
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
    if (!term || term.length < 2) continue;
    try {
      const res = await fetch(MANGAUPDATES_SEARCH_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'User-Agent': DEFAULT_USER_AGENT,
        },
        body: JSON.stringify({ search: term, perpage: 3 }),
        signal: AbortSignal.timeout(7000),
      });
      if (!res.ok) continue;
      const json = await res.json();
      const results = json?.results;
      if (Array.isArray(results) && results.length > 0) {
        const record = results[0]?.record;
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
    if (!term || term.length < 2) continue;
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
        return {
          id: slug,
          url,
          title: titleMatch ? stripTags(titleMatch[1]) : term,
        };
      }

      const cardMatch = /<a[^>]+class=["'][^"']*tooltip[^"']*["'][^>]+href=["'](\/manga\/[^"'\/?#]+)["'][^>]*>[\s\S]*?<h3[^>]*class=["']cardName["'][^>]*>([\s\S]*?)<\/h3>/i.exec(html);
      if (cardMatch && !cardMatch[1].includes('/manga/all')) {
        const slug = cardMatch[1].replace('/manga/', '');
        return {
          id: slug,
          url: `${ANIME_PLANET_BASE_URL}/manga/${slug}`,
          title: stripTags(cardMatch[2]),
        };
      }
    } catch {}
    await sleep(250);
  }
  return null;
};

const queryAniSearch = async (searchTerms = []) => {
  for (const term of searchTerms.slice(0, 2)) {
    if (!term || term.length < 2) continue;
    try {
      const searchUrl = `${ANISEARCH_BASE_URL}/manga/index?char=all&text=${encodeURIComponent(term)}&smode=1`;
      const res = await fetchUpstream(searchUrl, { timeoutMs: 8000 });
      if (!res.ok || !res.content) continue;
      const match = /href=["']((?:https:\/\/www\.anisearch\.com)?\/manga\/(\d+),[^"'\/?#]+)["']/i.exec(res.content);
      if (match) {
        const rawHref = match[1];
        const id = match[2];
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
      m.title = cleanSeriesTitle(m.title);
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
    }
  }

  hydrateFromR2(snapshot, tables = null) {
    if (snapshot && Array.isArray(snapshot.mangas)) {
      for (const m of snapshot.mangas) {
        if (!m || !m.id) continue;
        const existing = this.mangas.get(m.id);
        if (!existing) {
          this.mangas.set(m.id, {
            ...m,
            alternativeTitles: m.alternativeTitles || m.alternative_titles || [],
            sourceLinks: m.sourceLinks || m.source_links || [],
            details: m.details || {},
            chapters: Array.isArray(m.chapters) ? m.chapters : [],
          });
        } else {
          // Preserve full chapter pages if local checkpoint has them
          const existingHasPages = (existing.chapters || []).some((ch) => Array.isArray(ch.pages) && ch.pages.length > 0);
          const incomingHasPages = (m.chapters || []).some((ch) => Array.isArray(ch.pages) && ch.pages.length > 0);
          this.mangas.set(m.id, {
            ...existing,
            ...m,
            alternativeTitles: Array.from(
              new Set([...(existing.alternativeTitles || []), ...(m.alternativeTitles || m.alternative_titles || [])])
            ),
            sourceLinks: this.mergeSourceLinksList(existing.sourceLinks, m.sourceLinks || m.source_links),
            details: { ...(existing.details || {}), ...(m.details || {}) },
            chapters: incomingHasPages || !existingHasPages ? m.chapters || existing.chapters || [] : existing.chapters,
          });
        }
      }
    }

    if (snapshot?.characters) {
      for (const c of snapshot.characters) {
        if (c?.id && !this.characters.has(c.id)) this.characters.set(c.id, c);
      }
    }
    if (snapshot?.authors) {
      for (const a of snapshot.authors) {
        if (a?.id && !this.authors.has(a.id)) this.authors.set(a.id, a);
      }
    }
    if (snapshot?.artists) {
      for (const a of snapshot.artists) {
        if (a?.id && !this.artists.has(a.id)) this.artists.set(a.id, a);
      }
    }
    if (snapshot?.tags) {
      for (const t of snapshot.tags) {
        if (t?.id && !this.tags.has(t.id)) this.tags.set(t.id, t);
      }
    }

    if (tables) {
      for (const r of tables.manga_characters || []) {
        if (!this.mangaCharacters.some((mc) => mc.manga_id === r.manga_id && mc.character_id === r.character_id)) {
          this.mangaCharacters.push(r);
        }
      }
      for (const r of tables.manga_authors || []) {
        if (!this.mangaAuthors.some((ma) => ma.manga_id === r.manga_id && ma.author_id === r.author_id)) {
          this.mangaAuthors.push(r);
        }
      }
      for (const r of tables.manga_artists || []) {
        if (!this.mangaArtists.some((mar) => mar.manga_id === r.manga_id && mar.artist_id === r.artist_id)) {
          this.mangaArtists.push(r);
        }
      }
      for (const r of tables.manga_tags || []) {
        if (!this.mangaTags.some((mt) => mt.manga_id === r.manga_id && mt.tag_id === r.tag_id)) {
          this.mangaTags.push(r);
        }
      }
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
    if (manga.details?.primarySource && manga.details?.primarySourceUrl) {
      return {
        source: manga.details.primarySource,
        url: manga.details.primarySourceUrl,
      };
    }
    const scraperSources = ['webtoonhatti', 'okutoon', 'siyahmelek', 'hattorimanga', 'golgebahcesi', 'dxdfansub', 'mangacix', 'hentaiturk'];
    const found = (manga.sourceLinks || []).find((l) => l && scraperSources.includes(l.source) && l.url);
    if (found) {
      if (!manga.details) manga.details = {};
      manga.details.primarySource = found.source;
      manga.details.primarySourceUrl = found.url;
      return { source: found.source, url: found.url };
    }
    return null;
  }

  findMatchingMangaId(title, alternativeTitles = []) {
    const allTitles = [title, ...(alternativeTitles || [])];
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

  addOrMergeSeries(scraped) {
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
      if (!existing.cover && scraped.cover) existing.cover = scraped.cover;
      if (scraped.status === 'completed') existing.status = 'completed';
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
          if (!existingChMap.has(chNum)) {
            existing.chapters.push({
              id: randomUUID(),
              mangaId: existing.id,
              chapterNumber: chNum,
              title: ch.title || `Bölüm ${chNum}`,
              pages: ch.pages || [],
              releaseDate: now,
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
        }
      }

      this.syncScrapedTaxonomies(existing.id, scraped);
      this.rebuildIndexes();
      return existing;
    }

    // Create brand-new series locked to this primarySource
    const mangaId = randomUUID();
    const baseSlug = slugify(scraped.title) || `manga-${mangaId.slice(0, 8)}`;
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
      title: scraped.title,
      alternativeTitles: (scraped.alternativeTitles || []).filter((t) => t && t !== scraped.title),
      description: scraped.description || '',
      cover: scraped.cover || '',
      banner: scraped.cover || '',
      author: scraped.author || 'Bilinmiyor',
      artist: scraped.artist || undefined,
      status: scraped.status || 'ongoing',
      type: 'webtoon',
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
        title: ch.title || `Bölüm ${ch.chapterNumber ?? ch.number ?? 0}`,
        pages: ch.pages || [],
        releaseDate: now,
        views: 0,
        _sourceLink: ch.link,
      })),
      sourceLinks: scraped.link ? [{ source: scraped.source, url: scraped.link }] : [],
      details: {
        primarySource: scraped.source,
        primarySourceUrl: scraped.link,
        lastChapterAddedAt: now,
        lastDeltaCheckAt: now,
      },
      createdAt: now,
      updatedAt: now,
    };

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
    if (!manga) return null;

    const cleanSearchTerm = (str) => {
      if (!str) return '';
      return str
        .replace(/\b(türkçe|oku|webtoon|manhwa|manga|sansürsüz|güncel|bölüm|sezon)\b/gi, ' ')
        .replace(/[–—\-:_|]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    };

    const locked = this.getLockedPrimarySource(manga);
    const slugTerm = locked?.url
      ? locked.url.split('/').filter(Boolean).pop()?.replace(/-/g, ' ') || ''
      : (manga.slug || '').replace(/-/g, ' ');
    const translatedTitle = await translateTextGtx(manga.title, 'tr', 'en');

    const searchTerms = Array.from(
      new Set(
        [
          ...(manga.alternativeTitles || []).map(cleanSearchTerm),
          cleanSearchTerm(translatedTitle),
          cleanSearchTerm(slugTerm),
          cleanSearchTerm(manga.title),
          manga.title,
        ].filter((t) => t && t.length > 2)
      )
    ).slice(0, 6);

    let finalId = manga.id;
    let englishSynopsisCandidate = '';

    // 1. AniList
    const anilistData = await queryAniList(searchTerms);
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

        if (anilistData.coverImage?.extraLarge) target.cover = anilistData.coverImage.extraLarge;
        if (anilistData.bannerImage) target.banner = anilistData.bannerImage;
        if (anilistData.startDate?.year && !target.releaseYear) target.releaseYear = anilistData.startDate.year;
        if (anilistData.description) englishSynopsisCandidate = anilistData.description;

        if (anilistData.isAdult) {
          target.isAdult = true;
          if (!target.genres.includes('Yetişkin')) target.genres.push('Yetişkin');
        }

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
        if ((!currentManga.cover || !(await verifyImageUrl(currentManga.cover))) && jikanData.cover) {
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
    const mdData = await queryMangaDex(searchTerms.slice(0, 3));
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
      if ((!currentManga.cover || !(await verifyImageUrl(currentManga.cover))) && mdData.cover) {
        currentManga.cover = mdData.cover;
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

  buildAutomationsPayload() {
    const now = new Date().toISOString();
    const automations = [];
    const runs = [];

    for (const m of this.mangas.values()) {
      const locked = this.getLockedPrimarySource(m);
      if (!locked || !locked.source || !locked.url) continue;

      const autoId = deterministicUuid(`automation:${m.id}`);
      const isCompleted = m.status === 'completed';
      const lastCheck = m.details?.lastDeltaCheckAt || m.updatedAt || now;
      const lastAddedCount = Number(m.details?.lastAddedChapterCount || 0);
      const lastStatus = m.details?.lastRunStatus || ((m.chapters || []).length > 0 ? 'success' : 'no_changes');

      automations.push({
        id: autoId,
        automation_type: 'chapter',
        manga_id: m.id,
        source: locked.source,
        source_url: locked.url,
        proxy_provider: 'cloudflare',
        check_times: ['13:00'],
        schedule_timezone: 'Europe/Istanbul',
        is_active: !isCompleted,
        validation_snapshot: {
          source: locked.source,
          sourceTitle: m.title,
          normalizedUrl: locked.url,
          cover: m.cover || null,
          chapterCount: (m.chapters || []).length,
          latestChapterNumber:
            (m.chapters || []).length > 0
              ? Math.max(...m.chapters.map((c) => Number(c.chapterNumber ?? c.number ?? 0)))
              : null,
          checkedAt: lastCheck,
        },
        next_run_at: !isCompleted ? new Date(Date.now() + 2 * 3600 * 1000).toISOString() : null,
        last_run_status: lastStatus,
        last_run_started_at: lastCheck,
        last_run_finished_at: lastCheck,
        last_run_error: null,
        last_added_chapter_count: lastAddedCount,
        created_at: m.createdAt || now,
        updated_at: lastCheck,
      });

      runs.push({
        id: deterministicUuid(`automation_run:${m.id}`),
        automation_id: autoId,
        status: lastStatus === 'idle' ? 'no_changes' : lastStatus,
        started_at: lastCheck,
        finished_at: lastCheck,
        chapters_added: lastAddedCount,
        source_chapter_count: (m.chapters || []).length,
        new_chapter_count: lastAddedCount,
        error_message: null,
        details: {
          primarySource: locked.source,
          mode: 'github_actions_smart_sync',
        },
      });
    }

    return { automations, runs };
  }

  toSnapshotPayload() {
    const lightweightMangas = Array.from(this.mangas.values()).map((m) => {
      const { chapters, ...rest } = m;
      return {
        ...rest,
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
    const { automations, runs } = this.buildAutomationsPayload();

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
        pages: [],
        views: ch.views || 0,
        release_date: ch.releaseDate || ch.release_date || now,
        created_at: ch.createdAt || ch.created_at || now,
      }))
    );

    const charactersRows = Array.from(this.characters.values()).map((entity) => ({
      id: entity.id,
      name: entity.name,
      image_url: entity.image || entity.image_url || null,
      description: entity.description || '',
      likes_count: 0,
      is_public: true,
      alternative_names: entity.alternativeName ? [entity.alternativeName] : entity.alternative_names || [],
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
      alternative_names: entity.alternativeName ? [entity.alternativeName] : entity.alternative_names || [],
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
      alternative_names: entity.alternativeName ? [entity.alternativeName] : entity.alternative_names || [],
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
      chapter_automations: automations,
      chapter_automation_runs: runs,
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
    return JSON.parse(readFileSync(CHECKPOINT_PATH, 'utf8'));
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

const uploadSeriesFileToR2 = async (manga) => {
  if (!CATALOG_WORKER_URL || !CATALOG_ADMIN_TOKEN || !manga?.slug || IS_DRY_RUN) return;
  try {
    await fetch(`${CATALOG_WORKER_URL}/v1/admin/series/${manga.slug}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'X-Catalog-Admin-Token': CATALOG_ADMIN_TOKEN,
      },
      body: JSON.stringify(manga),
      signal: AbortSignal.timeout(15000),
    });
  } catch (err) {
    logWarn(`Seri R2 yükleme uyarısı (${manga.slug}): ${err.message}`);
  }
};

const syncAllToR2AndSupabase = async (store, seriesQueue, touchedSlugs = new Set()) => {
  if (IS_DRY_RUN) {
    logInfo('[DryRun] R2 ve Supabase senkronizasyonu atlandı.');
    return;
  }

  const tablesPayload = store.toTablesPayload();

  // 1. Sync to Cloudflare R2 Catalog Worker
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
        await fetch(`${CATALOG_WORKER_URL}/v1/admin/table/${tbl}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'X-Catalog-Admin-Token': CATALOG_ADMIN_TOKEN,
          },
          body: JSON.stringify(rows),
          signal: AbortSignal.timeout(20000),
        });
      } catch (err) {
        logWarn(`R2 tablo hatası (${tbl}): ${err.message}`);
      }
    }

    // Update snapshot.json
    try {
      await fetch(`${CATALOG_WORKER_URL}/v1/admin/catalog/snapshot`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-Catalog-Admin-Token': CATALOG_ADMIN_TOKEN,
        },
        body: JSON.stringify(store.toSnapshotPayload()),
        signal: AbortSignal.timeout(25000),
      });
    } catch (err) {
      logWarn(`R2 snapshot hatası: ${err.message}`);
    }

    // Upload touched individual series files (with full chapter page URLs)
    const mangasToUpload = Array.from(store.mangas.values()).filter(
      (m) => touchedSlugs.has(m.slug) || (m.chapters || []).some((ch) => Array.isArray(ch.pages) && ch.pages.length > 0)
    );
    for (let i = 0; i < mangasToUpload.length; i += 3) {
      const chunk = mangasToUpload.slice(i, i + 3);
      await Promise.all(chunk.map((m) => uploadSeriesFileToR2(m)));
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
        }),
        signal: AbortSignal.timeout(20000),
      });
    } catch (err) {
      logWarn(`R2 automation-state kayıt uyarısı: ${err.message}`);
    }
  }

  // 2. Mirror to Supabase PostgreSQL via sync_r2_catalog_to_supabase RPC
  if (SUPABASE_URL && SUPABASE_ANON_KEY && CATALOG_ADMIN_TOKEN) {
    logInfo('Supabase PostgreSQL ikiz katalog senkronizasyonu başlatılıyor (AniList/MAL & Kullanıcı Etkileşim Eşleşmesi)...');
    const callSupabaseRpc = async (payloadChunk) => {
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
        signal: AbortSignal.timeout(25000),
      });
      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status}: ${errText.slice(0, 200)}`);
      }
      return await res.json();
    };

    try {
      // Step A: Sync core entities & junctions
      const coreResult = await callSupabaseRpc({
        mangas: tablesPayload.mangas,
        characters: tablesPayload.characters,
        authors: tablesPayload.authors,
        artists: tablesPayload.artists,
        tags: tablesPayload.tags,
        manga_characters: tablesPayload.manga_characters,
        manga_authors: tablesPayload.manga_authors,
        manga_artists: tablesPayload.manga_artists,
        manga_tags: tablesPayload.manga_tags,
        chapter_automations: tablesPayload.chapter_automations,
        chapter_automation_runs: tablesPayload.chapter_automation_runs,
      });
      logInfo(
        `Supabase ana tablolar senkronize edildi: ${coreResult?.mangas_synced ?? 0} manga, ${coreResult?.characters_synced ?? 0} karakter, ${coreResult?.automations_synced ?? 0} otomasyon.`
      );

      // Step B: Sync lightweight chapters in chunks of 2500
      const allChapters = tablesPayload.chapters || [];
      let syncedChaptersTotal = 0;
      const chunkSize = 2500;
      for (let i = 0; i < allChapters.length; i += chunkSize) {
        const chChunk = allChapters.slice(i, i + chunkSize);
        const chRes = await callSupabaseRpc({ chapters: chChunk });
        syncedChaptersTotal += Number(chRes?.chapters_synced || chChunk.length);
      }
      logInfo(`Supabase bölüm indeksleri senkronize edildi: ${syncedChaptersTotal} bölüm (pages='{}').`);
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
    `Mod: ${MODE} | Yeni Seri Batch: ${BATCH_SIZE} | Delta Kontrol Limit: ${MAX_DELTA_CHECKS} | İnaktif Sınır: ${DORMANT_DAYS_LIMIT} gün`
  );

  const checkpoint = loadLocalCheckpoint();
  const store = new SmartCatalogStore(checkpoint);
  let seriesQueue = checkpoint.seriesQueue || {};
  const touchedSlugs = new Set();

  // 1. Hydrate from R2 Catalog Worker
  if (CATALOG_WORKER_URL) {
    try {
      logInfo('Cloudflare R2 mevcut katalog ve otomasyon kuyruğu yükleniyor...');
      const [snapRes, tablesRes, autoStateRes] = await Promise.all([
        fetch(`${CATALOG_WORKER_URL}/v1/catalog/snapshot`, { signal: AbortSignal.timeout(10000) }),
        fetch(`${CATALOG_WORKER_URL}/v1/catalog/tables?exclude=chapters`, { signal: AbortSignal.timeout(10000) }),
        fetch(`${CATALOG_WORKER_URL}/v1/catalog/automation-state`, { signal: AbortSignal.timeout(10000) }),
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
      }

      // Hydrate chapter pages for existing series from R2 if missing locally
      const mangasMissingPages = Array.from(store.mangas.values()).filter(
        (m) => m.slug && (m.chapters || []).length > 0 && !(m.chapters || []).some((ch) => Array.isArray(ch.pages) && ch.pages.length > 0)
      );
      if (mangasMissingPages.length > 0) {
        logInfo(`R2'den ${mangasMissingPages.length} serinin tam bölüm sayfaları eşitleniyor...`);
        for (let i = 0; i < mangasMissingPages.length; i += 5) {
          const chunk = mangasMissingPages.slice(i, i + 5);
          await Promise.all(
            chunk.map(async (m) => {
              try {
                const sRes = await fetch(`${CATALOG_WORKER_URL}/v1/catalog/series/${m.slug}`, {
                  signal: AbortSignal.timeout(8000),
                });
                if (sRes.ok) {
                  const fullSeries = await sRes.json();
                  if (Array.isArray(fullSeries?.chapters) && fullSeries.chapters.length > 0) {
                    m.chapters = fullSeries.chapters;
                  }
                }
              } catch {}
            })
          );
        }
      }

      logInfo(
        `Katalog yüklendi: ${store.mangas.size} seri, ${store.characters.size} karakter, ${store.authors.size} yazar, ${store.tags.size} etiket.`
      );
    } catch (err) {
      logWarn(`R2 başlangıç yükleme uyarısı: ${err.message}`);
    }
  }

  // ==========================================================================
  // FAZ 1: Mevcut Serilerde Eksik AniList / MAL / Türkçe Açıklama Tamamlama
  // ==========================================================================
  const mangasNeedingEnrich = Array.from(store.mangas.values()).filter((m) => {
    if (FORCE_ENRICH) return true;
    const hasTurkishDesc = isLikelyTurkish(m.description);
    if (m.details?.enrichedAt && hasTurkishDesc) return false;
    const hasAnilist = (m.sourceLinks || []).some((l) => l?.source === 'anilist');
    const hasMal = (m.sourceLinks || []).some((l) => l?.source === 'myanimelist');
    return !hasAnilist || !hasMal || !hasTurkishDesc || !m.details?.enrichedAt;
  });

  if (mangasNeedingEnrich.length > 0) {
    logInfo(`--- FAZ 1: ${mangasNeedingEnrich.length} seride çoklu kaynak metadata ve Türkçe açıklama zenginleştirmesi yapılıyor ---`);
    let idx = 0;
    const totalToEnrich = mangasNeedingEnrich.length;
    for (const m of mangasNeedingEnrich) {
      idx++;
      if (!store.mangas.has(m.id)) continue; // Merged into another record
      logProgress(idx, totalToEnrich, m.title, 'AniList + MAL + MangaDex + MangaUpdates + AnimePlanet + Türkçe Açıklama');
      const updated = await store.enrichSeriesAllProviders(m.id);
      if (updated?.slug) touchedSlugs.add(updated.slug);
    }
  }

  if (MODE === 'enrich-only') {
    saveLocalCheckpoint({ ...checkpoint, seriesQueue, ...store.toState() });
    await syncAllToR2AndSupabase(store, seriesQueue, touchedSlugs);
    logInfo('Sadece zenginleştirme (enrich-only) modu tamamlandı.');
    return;
  }

  // ==========================================================================
  // FAZ 2: 4 Ana Kaynakta Vitrin (Son Güncellenenler) Taraması
  // ==========================================================================
  logInfo(`--- FAZ 2: 4 Ana Kaynak Vitrin Taraması (${PRIMARY_SOURCES.join(', ')}) ---`);
  const hotUpdatedMangaIds = new Set();
  const sourcesToScan = TARGET_SOURCE ? [TARGET_SOURCE] : PRIMARY_SOURCES;

  let newQueuedFromFrontPage = 0;
  for (const src of sourcesToScan) {
    const frontCards = await scanFrontPageFeed(src, FRONT_PAGES_TO_SCAN);
    for (const card of frontCards) {
      const matchedId = store.findMatchingMangaId(card.title);
      if (matchedId && store.mangas.has(matchedId)) {
        const existing = store.mangas.get(matchedId);
        const locked = store.getLockedPrimarySource(existing);
        // Single-source rule: only trigger delta check if this front-page update is from the series' locked primarySource
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

  // ==========================================================================
  // FAZ 3: Akıllı Filtreli Delta Bölüm Kontrolü (Tamamlanan & >4 Ay İnaktif Skip)
  // ==========================================================================
  if (MAX_DELTA_CHECKS > 0) {
    logInfo('--- FAZ 3: Akıllı Filtreli Delta Bölüm Kontrolü ---');
    let skippedCompleted = 0;
    let skippedDormant = 0;
    let skippedCooldown = 0;
    let skippedUnsupported = 0;

    const eligibleForDelta = [];
    const nowMs = Date.now();
    const dormantLimitMs = DORMANT_DAYS_LIMIT * 24 * 3600 * 1000;
    const cooldownLimitMs = COOLDOWN_HOURS * 3600 * 1000;

    for (const manga of store.mangas.values()) {
      const isHot = hotUpdatedMangaIds.has(manga.id);

      // 1. Auto-skip completed series
      if (manga.status === 'completed' && (manga.chapters || []).length > 0 && !FORCE_DELTA) {
        skippedCompleted++;
        continue;
      }

      // 2. Must have a locked primary source in PRIMARY_SOURCES
      const locked = store.getLockedPrimarySource(manga);
      if (!locked || !PRIMARY_SOURCES.includes(locked.source)) {
        skippedUnsupported++;
        continue;
      }

      if (TARGET_SOURCE && locked.source !== TARGET_SOURCE) {
        continue;
      }

      // 3. Auto-skip dormant series (> 4 months / 120 days since last chapter), unless seen on front-page feed
      const latestChapterDates = (manga.chapters || [])
        .map((c) => Date.parse(c.releaseDate || c.release_date || ''))
        .filter((ts) => Number.isFinite(ts));
      const lastActivityTs =
        latestChapterDates.length > 0
          ? Math.max(...latestChapterDates)
          : Date.parse(manga.details?.lastChapterAddedAt || manga.updatedAt || manga.createdAt || '') || nowMs;

      if (!isHot && !FORCE_DELTA && nowMs - lastActivityTs > dormantLimitMs) {
        skippedDormant++;
        continue;
      }

      // 4. Cooldown check
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

    // Sort: hot front-page updates first, then oldest checked first
    eligibleForDelta.sort((a, b) => {
      if (a.isHot !== b.isHot) return a.isHot ? -1 : 1;
      return a.lastCheckTs - b.lastCheckTs;
    });

    const targetDeltaList = eligibleForDelta.slice(0, MAX_DELTA_CHECKS);
    logInfo(
      `Filtreleme Raporu -> Atlanan Tamamlanmış: ${skippedCompleted} | Atlanan >4 Ay İnaktif: ${skippedDormant} | Cooldown: ${skippedCooldown} | Şimdi Kontrol Edilecek: ${targetDeltaList.length}`
    );

    let deltaIdx = 0;
    for (const item of targetDeltaList) {
      deltaIdx++;
      const { manga, locked } = item;
      const checkTimeIso = new Date().toISOString();
      if (!manga.details) manga.details = {};
      manga.details.lastDeltaCheckAt = checkTimeIso;

      const detail = await fetchSeriesDetailFromSource(locked.source, locked.url, manga.title, manga.cover, manga.isAdult);
      if (!detail || !Array.isArray(detail.chapters)) {
        manga.details.lastRunStatus = 'error';
        logProgress(deltaIdx, targetDeltaList.length, manga.title, `Kaynak okunamadı (${locked.source})`);
        continue;
      }

      if (detail.status === 'completed') {
        manga.status = 'completed';
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
              title: ch.title || `Bölüm ${ch.chapterNumber}`,
              pages,
              releaseDate: checkTimeIso,
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
        manga.details.lastRunStatus = 'success';
        manga.details.lastAddedChapterCount = newValidChapters.length;
        touchedSlugs.add(manga.slug);
        await uploadSeriesFileToR2(manga);
        logProgress(deltaIdx, targetDeltaList.length, manga.title, `+${newValidChapters.length} yeni bölüm eklendi!`);
      } else {
        manga.details.lastRunStatus = 'no_changes';
        manga.details.lastAddedChapterCount = 0;
      }
    }
  }

  // ==========================================================================
  // FAZ 4: Kuyruktan Yeni Seri Keşif & Zenginleştirme (Bounded Batch)
  // ==========================================================================
  if (MODE !== 'delta-only' && BATCH_SIZE > 0) {
    const pendingItems = Object.values(seriesQueue)
      .filter((s) => (s.status === 'pending' || s.status === 'partial') && PRIMARY_SOURCES.includes(s.source))
      .filter((s) => !TARGET_SOURCE || s.source === TARGET_SOURCE)
      .sort((a, b) => (b.priority || 0) - (a.priority || 0));

    const batchToProcess = pendingItems.slice(0, BATCH_SIZE);
    if (batchToProcess.length > 0) {
      logInfo(`--- FAZ 4: Kuyruktan ${batchToProcess.length} Yeni Seri Çekiliyor (Toplam Bekleyen: ${pendingItems.length}) ---`);
      let bIdx = 0;
      for (const card of batchToProcess) {
        bIdx++;
        // Check if series already exists in catalog (Single-Source & Zero-Duplicate Guard)
        const existingId = store.findMatchingMangaId(card.title);
        if (existingId && store.mangas.has(existingId)) {
          const existing = store.mangas.get(existingId);
          store.upsertSourceLink(existing, { source: card.source, url: card.link });
          card.status = 'completed';
          card.updatedAt = new Date().toISOString();
          logProgress(bIdx, batchToProcess.length, card.title, `Mevcut seriyle eşleşti (${existing.title}), tek kaynak korundu.`);
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

        // Check again with alternative titles from detail page
        const existingByAltId = store.findMatchingMangaId(detail.title, detail.alternativeTitles);
        if (existingByAltId && store.mangas.has(existingByAltId)) {
          const existing = store.mangas.get(existingByAltId);
          store.upsertSourceLink(existing, { source: card.source, url: card.link });
          card.status = 'completed';
          card.updatedAt = new Date().toISOString();
          logProgress(bIdx, batchToProcess.length, card.title, `Alternatif isimle mevcut seriye bağlandı (${existing.title}).`);
          continue;
        }

        const validChapters = [];
        for (let i = 0; i < detail.chapters.length; i += CHAPTER_CONCURRENCY) {
          const chunk = detail.chapters.slice(i, i + CHAPTER_CONCURRENCY);
          const results = await Promise.all(
            chunk.map(async (ch) => {
              const pages = await fetchChapterPagesFromSource(card.source, ch.link);
              if (pages.length === 0) return null;
              return { ...ch, pages };
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
        const enrichedManga = (await store.enrichSeriesAllProviders(addedManga.id)) || addedManga;

        if (enrichedManga?.slug) {
          touchedSlugs.add(enrichedManga.slug);
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
      }
    }
  }

  // Save checkpoint & sync to R2 + Supabase
  saveLocalCheckpoint({ ...checkpoint, seriesQueue, ...store.toState() });
  await syncAllToR2AndSupabase(store, seriesQueue, touchedSlugs);

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
