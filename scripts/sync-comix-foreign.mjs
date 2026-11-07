/**
 * TOONPARROT - MEVCUT TÜRKÇE SERİLER İÇİN ÇOKLU DİL (COMIX.TO) & KARAKTER SENKRONİZASYON ARACI
 *
 * Kurallar:
 * - Mevcut Türkçe serinin ana başlığı (örn. "Nano Makine") KESİNLİKLE korunur; İngilizce/yabancı başlıklar
 *   ("Nano Machine" vb.) yalnızca `alternative_titles` dizisine eklenir.
 * - Comix üzerindeki TÜM diller (`tr`, `en`, `es`, `pt-br`, `ru`, `fr`, `id`, `ar`, `de`, `it` vb.)
 *   en iyi çeviri grubu puanlamasıyla çekilir; grup adları veya `[EN]` etiketleri bölüm başlığına YAZILMAZ.
 * - Comix görüntülenme/takipçi sayıları kesinlikle alınmaz (`views` korunur, yeni bölümlerde `views: 0`).
 * - Supabase 500MB limitini korumak için yabancı bölümler ve karakterler R2 `catalog/series/<slug>.json`
 *   içine yazılır; Supabase `mangas` tablosunda yalnızca `alternative_titles`, `source_links` ve `details` güncellenir.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  fetchComixApi,
  unpackManga,
  areSeriesTitlesMatching,
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

// CLI Argümanları
const args = process.argv.slice(2);
function getArgValue(flag, defaultVal = null) {
  const idx = args.indexOf(flag);
  if (idx !== -1 && idx + 1 < args.length) return args[idx + 1];
  return defaultVal;
}

const TARGET_SLUG = getArgValue('--slug', null);
const LIMIT = Number(getArgValue('--limit', TARGET_SLUG ? 1 : 50));
const CONCURRENCY = Math.max(1, Math.min(6, Number(getArgValue('--concurrency', 3))));

// Zaman aşımı koruması (Max 15 dakika genel script süresi, tekil HTTP isteklerinde 15s timeout)
const GLOBAL_TIMEOUT_MS = Number(getArgValue('--timeout-ms', 15 * 60 * 1000));
const globalTimer = setTimeout(() => {
  console.error('[TIMEOUT] Script azami çalışma süresini aştı, güvenli şekilde sonlandırılıyor.');
  process.exit(1);
}, GLOBAL_TIMEOUT_MS);
globalTimer.unref?.();

function getTimeStr() {
  return new Date().toTimeString().split(' ')[0];
}

function logProgress(current, total, title, statusMsg) {
  const pct = total > 0 ? ((current / total) * 100).toFixed(1) : '0.0';
  console.log(`[${getTimeStr()}] [${current}/${total}] (%${pct}) - ${title}: ${statusMsg}`);
}

async function fetchExistingMangasFromSupabase() {
  const headers = {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    Accept: 'application/json',
  };

  if (TARGET_SLUG) {
    const url = `${SUPABASE_URL}/rest/v1/mangas?slug=eq.${encodeURIComponent(TARGET_SLUG)}&select=*&limit=1`;
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`Supabase mangas sorgu hatası: ${res.status}`);
    return await res.json();
  }

  const rows = [];
  const pageSize = 200;
  for (let offset = 0; rows.length < LIMIT; offset += pageSize) {
    const fetchCount = Math.min(pageSize, LIMIT - rows.length);
    const url = `${SUPABASE_URL}/rest/v1/mangas?select=*&order=views.desc,last_updated.desc&offset=${offset}&limit=${fetchCount}`;
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`Supabase mangas liste hatası: ${res.status}`);
    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) break;
    rows.push(...data);
    if (data.length < fetchCount) break;
  }
  return rows;
}

async function fetchExistingChaptersForManga(mangaId, slug) {
  const headers = {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    Accept: 'application/json',
  };
  const all = [];
  const pageSize = 100;
  for (let page = 0; page < 25; page++) {
    const offset = page * pageSize;
    const url = `${SUPABASE_URL}/rest/v1/chapters?manga_id=eq.${encodeURIComponent(mangaId)}&select=id,manga_id,number,title,release_date,views,pages&order=number.asc&offset=${offset}&limit=${pageSize}`;
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(20000) });
    if (!res.ok) break;
    const rows = await res.json();
    if (!Array.isArray(rows) || rows.length === 0) break;
    all.push(...rows);
    if (rows.length < pageSize) break;
  }

  // Also check existing R2 series JSON for any Turkish chapter pages not in Supabase
  if (slug) {
    try {
      const r2Res = await fetch(`${CATALOG_WORKER_URL}/v1/catalog/series/${encodeURIComponent(slug)}`, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(10000),
      });
      if (r2Res.ok) {
        const r2Data = await r2Res.json();
        const r2Chapters = Array.isArray(r2Data?.chapters) ? r2Data.chapters : [];
        const r2PagesByNum = new Map();
        for (const rc of r2Chapters) {
          const lang = String(rc?.language || 'tr').toLowerCase();
          if (lang === 'tr' && Array.isArray(rc?.pages) && rc.pages.length > 0) {
            r2PagesByNum.set(Number(rc.number ?? rc.chapterNumber), rc.pages);
          }
        }
        for (const ch of all) {
          if ((!Array.isArray(ch.pages) || ch.pages.length === 0) && r2PagesByNum.has(Number(ch.number))) {
            ch.pages = r2PagesByNum.get(Number(ch.number));
          }
        }
      }
    } catch {}
  }

  return all;
}

function extractSavedComixHid(manga) {
  if (manga?.details?.hid && typeof manga.details.hid === 'string') {
    return manga.details.hid.trim();
  }
  const links = Array.isArray(manga?.source_links) ? manga.source_links : [];
  for (const link of links) {
    if (link?.source === 'comix' && link?.externalId) {
      return String(link.externalId).trim();
    }
    const url = String(link?.url || '');
    const m = url.match(/comix\.to\/(?:title|comic)\/([a-z0-9]+)/i);
    if (m) return m[1];
  }
  return null;
}

async function findMatchingComixSeries(manga, anilistMeta) {
  const savedHid = extractSavedComixHid(manga);
  if (savedHid) {
    try {
      const raw = await fetchComixApi(`/manga/${savedHid}`);
      const unpacked = unpackManga(raw);
      if (unpacked && unpacked.hid) return unpacked;
    } catch {}
  }

  const candidateTitles = Array.from(
    new Set(
      [
        ...(Array.isArray(manga.alternative_titles) ? manga.alternative_titles : []),
        ...(Array.isArray(anilistMeta?.altTitles) ? anilistMeta.altTitles : []),
        manga.title,
      ]
        .map((s) => String(s || '').trim())
        .filter((s) => s.length >= 2)
    )
  );

  const targetAlId = anilistMeta?.anilistId || null;
  const targetMalId = anilistMeta?.malId || null;

  for (const rawQueryTitle of candidateTitles.slice(0, 8)) {
    const cleanKeyword = String(rawQueryTitle || '')
      .replace(/ı/g, 'i')
      .replace(/ğ/g, 'g')
      .replace(/ü/g, 'u')
      .replace(/ş/g, 's')
      .replace(/ö/g, 'o')
      .replace(/ç/g, 'c')
      .replace(/[^a-zA-Z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (cleanKeyword.length < 2) continue;
    try {
      const searchRes = await fetchComixApi('/manga', {
        keyword: cleanKeyword,
        limit: 15,
      });
      const rawItems = searchRes?.items || (Array.isArray(searchRes) ? searchRes : []);
      const items = rawItems.map(unpackManga).filter((it) => it && it.hid && it.hasChapters && it.latestChapter > 0);

      for (const item of items) {
        const ext = extractExternalIdsFromComixLinks(item.links);
        if (targetAlId && ext.anilistId && Number(targetAlId) === Number(ext.anilistId)) {
          return item;
        }
        if (targetMalId && ext.malId && Number(targetMalId) === Number(ext.malId)) {
          return item;
        }

        const itemTitles = [item.title, ...(Array.isArray(item.altTitles) ? item.altTitles : [])].filter(Boolean);
        const titleMatched = candidateTitles.some((ct) =>
          itemTitles.some((it) => areSeriesTitlesMatching(ct, it))
        );
        if (titleMatched) {
          return item;
        }
      }
    } catch {}
  }

  return null;
}

async function uploadSeriesToR2(slug, seriesPayload) {
  const res = await fetch(`${CATALOG_WORKER_URL}/v1/admin/series/${encodeURIComponent(slug)}?onlySeries=1`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'X-Catalog-Admin-Token': CATALOG_ADMIN_TOKEN,
    },
    body: JSON.stringify(seriesPayload),
    signal: AbortSignal.timeout(25000),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`R2 seri yükleme hatası (${res.status}): ${errText}`);
  }
}

async function updateSupabaseMangaMetadataOnly(updatedMangaRow) {
  const { chapters, characters, ...cleanManga } = updatedMangaRow;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/sync_r2_catalog_to_supabase`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify({
      p_admin_token: CATALOG_ADMIN_TOKEN,
      p_payload: {
        mangas: [cleanManga],
      },
    }),
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    console.warn(`[UYARI] Supabase manga metadata güncellenemedi (${res.status}): ${errText}`);
  }
}

async function processSingleExistingManga(manga, idx, total) {
  const trTitle = String(manga.title || '').trim();
  const slug = String(manga.slug || '').trim();
  if (!slug || !trTitle) {
    logProgress(idx, total, trTitle || manga.id, 'ATLANDI: Geçersiz slug veya başlık.');
    return { matched: false, addedChapters: 0 };
  }

  const extFromDb = extractExternalIdsFromComixLinks(null, manga.source_links);
  const initialAnilist = await fetchAniListMetadataAndCharacters({
    anilistId: extFromDb.anilistId,
    malId: extFromDb.malId,
    searchTitles: [...(manga.alternative_titles || []), trTitle],
  });

  const matchedItem = await findMatchingComixSeries(manga, initialAnilist);
  if (!matchedItem) {
    logProgress(idx, total, trTitle, 'Comix üzerinde eşleşen seri bulunamadı.');
    return { matched: false, addedChapters: 0 };
  }

  const hid = matchedItem.hid;
  let fullComix = matchedItem;
  try {
    const detailRaw = await fetchComixApi(`/manga/${hid}`);
    const unpackedDetail = unpackManga(detailRaw);
    if (unpackedDetail && unpackedDetail.hid) {
      fullComix = unpackedDetail;
    }
  } catch {}

  const extIds = extractExternalIdsFromComixLinks(fullComix.links, manga.source_links);
  const finalAnilist =
    initialAnilist.characters.length > 0
      ? initialAnilist
      : await fetchAniListMetadataAndCharacters({
          anilistId: extIds.anilistId || initialAnilist.anilistId,
          malId: extIds.malId || initialAnilist.malId,
          searchTitles: [fullComix.title, ...(fullComix.altTitles || []), trTitle],
        });

  const [existingTrChapters, comixChaptersRes] = await Promise.all([
    fetchExistingChaptersForManga(manga.id, slug),
    fetchBestComixChaptersByLanguage(hid, manga.id, slug, {
      maxPages: 15,
      verifySamplePages: true,
      hydrateSamplePages: true,
      maxHydrateChapters: 120,
    }),
  ]);

  if (!comixChaptersRes.valid || comixChaptersRes.chapters.length === 0) {
    logProgress(idx, total, trTitle, `Comix serisi (${hid}) boş veya çalışmayan bölümlere sahip, atlandı.`);
    return { matched: false, addedChapters: 0 };
  }

  const mergedChapters = [];
  const seenNumLang = new Set();

  // 1. Önce mevcut Türkçe bölümleri koru (asla ezme, sayfalarını ve görüntülenmelerini koru)
  for (const trCh of existingTrChapters) {
    const num = Number(trCh.number);
    const key = `${num}:tr`;
    seenNumLang.add(key);
    mergedChapters.push({
      id: trCh.id,
      manga_id: manga.id,
      mangaId: manga.id,
      number: num,
      chapterNumber: num,
      title: trCh.title || `Bölüm ${num}`,
      language: 'tr',
      pages: Array.isArray(trCh.pages) ? trCh.pages : [],
      views: Number(trCh.views || 0),
      release_date: trCh.release_date || new Date().toISOString(),
      releaseDate: trCh.release_date || new Date().toISOString(),
    });
  }

  // 2. Comix üzerindeki tüm dillerdeki bölümleri ekle
  let addedForeignCount = 0;
  for (const cCh of comixChaptersRes.chapters) {
    const lang = String(cCh.language || 'en').toLowerCase();
    const num = Number(cCh.number);
    const key = `${num}:${lang}`;
    if (seenNumLang.has(key)) continue;
    seenNumLang.add(key);
    mergedChapters.push(cCh);
    addedForeignCount++;
  }

  mergedChapters.sort((a, b) => {
    if (a.number !== b.number) return a.number - b.number;
    if (a.language === 'tr' && b.language !== 'tr') return -1;
    if (b.language === 'tr' && a.language !== 'tr') return 1;
    return String(a.language || '').localeCompare(String(b.language || ''));
  });

  // Türkçe ana başlığı ("Nano Makine" vb.) KESİNLİKLE koru; İngilizce ve alternatif isimleri alternative_titles'a ekle
  const mergedAltTitles = Array.from(
    new Set(
      [
        ...(Array.isArray(manga.alternative_titles) ? manga.alternative_titles : []),
        fullComix.title,
        ...(Array.isArray(fullComix.altTitles) ? fullComix.altTitles : []),
        ...(Array.isArray(finalAnilist.altTitles) ? finalAnilist.altTitles : []),
      ]
        .map((t) => String(t || '').trim())
        .filter((t) => Boolean(t) && t.toLowerCase() !== trTitle.toLowerCase())
    )
  ).slice(0, 25);

  const existingSourceLinks = Array.isArray(manga.source_links) ? manga.source_links : [];
  const comixLinkUrl = `https://comix.to/title/${hid}-${slug}`;
  const mergedSourceLinks = [
    ...existingSourceLinks.filter((l) => l && l.source !== 'comix' && l.source !== 'asura' && l.source !== 'asurascans'),
    {
      source: 'comix',
      url: comixLinkUrl,
      externalId: hid,
      label: 'Comix',
    },
    ...finalAnilist.sourceLinks.filter(
      (alLink) => !existingSourceLinks.some((ex) => ex.source === alLink.source)
    ),
  ];

  const nowIso = new Date().toISOString();
  const r2SeriesPayload = {
    ...manga,
    title: trTitle, // Türkçe ana başlık korunur
    slug,
    views: Number(manga.views || 0), // Sitenin kendi görüntülenmesi korunur, Comix'ten alınmaz
    alternative_titles: mergedAltTitles,
    alternativeTitles: mergedAltTitles,
    source_links: mergedSourceLinks,
    sourceLinks: mergedSourceLinks,
    details: {
      ...(manga.details || {}),
      hid,
      comixSlug: slug,
      availableLanguages: Array.from(new Set(['tr', ...comixChaptersRes.languages])),
      lastForeignSyncAt: nowIso,
    },
    chapterCount: mergedChapters.length,
    chapters: mergedChapters,
    characters: finalAnilist.characters,
    last_updated: manga.last_updated || nowIso,
    updatedAt: nowIso,
  };

  await uploadSeriesToR2(slug, r2SeriesPayload);
  await updateSupabaseMangaMetadataOnly(r2SeriesPayload);

  logProgress(
    idx,
    total,
    trTitle,
    `BAŞARILI [HID: ${hid}] -> TR: ${existingTrChapters.length} blm | +${addedForeignCount} yabancı blm (${comixChaptersRes.languages.join(', ').toUpperCase()}) | ${finalAnilist.characters.length} karakter | AltBaşlık: ${mergedAltTitles.slice(0, 2).join(', ')}`
  );

  return {
    matched: true,
    hid,
    addedChapters: addedForeignCount,
    languages: comixChaptersRes.languages,
    charactersCount: finalAnilist.characters.length,
  };
}

async function main() {
  console.log('============================================================================');
  console.log('   TOONPARROT - COMIX.TO ÇOKLU DİL & KARAKTER SENKRONİZASYONU (R2 HİBRİT)  ');
  console.log('============================================================================');

  const mangas = await fetchExistingMangasFromSupabase();
  if (!mangas || mangas.length === 0) {
    console.log('[BİLGİ] İşlenecek seri bulunamadı.');
    process.exit(0);
  }

  console.log(`[BİLGİ] Toplam ${mangas.length} mevcut Türkçe seri taranacak (Eşzamanlılık: ${CONCURRENCY})...`);

  let processed = 0;
  let matched = 0;
  let totalAddedChapters = 0;

  for (let i = 0; i < mangas.length; i += CONCURRENCY) {
    const batch = mangas.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      batch.map(async (manga, batchOffset) => {
        const currentIdx = i + batchOffset + 1;
        try {
          return await processSingleExistingManga(manga, currentIdx, mangas.length);
        } catch (err) {
          logProgress(currentIdx, mangas.length, manga.title || manga.slug, `HATA: ${err.message}`);
          return { matched: false, addedChapters: 0 };
        }
      })
    );

    for (const r of results) {
      processed++;
      if (r?.matched) {
        matched++;
        totalAddedChapters += r.addedChapters || 0;
      }
    }
  }

  console.log('============================================================================');
  console.log(`[TAMAMLANDI] İşlenen: ${processed} | Eşleşen: ${matched} | Eklenen Yabancı Bölüm: ${totalAddedChapters}`);
  console.log('============================================================================');
  process.exit(0);
}

main().catch((err) => {
  console.error('[FATAL] Senkronizasyon hatası:', err);
  process.exit(1);
});
