/**
 * toonparrot-catalog-worker
 * R2 Hybrid Catalog Store & Management Edge API
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Catalog-Admin-Token, Prefer, Range',
  'Access-Control-Expose-Headers': 'Content-Range, Content-Length',
  'Access-Control-Max-Age': '86400',
};

const CATALOG_TABLES = [
  'mangas',
  'chapters',
  'characters',
  'authors',
  'artists',
  'tags',
  'manga_characters',
  'manga_authors',
  'manga_artists',
  'manga_relations',
  'manga_tags',
  'character_tags',
  'author_tags',
  'artist_tags',
  'chapter_automations',
  'chapter_automation_runs',
];

const NO_STORE_TABLES = new Set(['chapter_automations', 'chapter_automation_runs']);

const isValidSlug = (slug) => Boolean(slug && /^[a-z0-9_-]+$/i.test(slug) && !slug.includes('..'));

const slugifyTagValue = (value) =>
  `${value ?? ''}`
    .replace(/\u0130/g, 'I')
    .replace(/\u0131/g, 'i')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

const timingSafeEqualStr = (a, b) => {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const enc = new TextEncoder();
  const aBytes = enc.encode(a);
  const bBytes = enc.encode(b);
  if (aBytes.length !== bBytes.length) return false;
  let diff = 0;
  for (let i = 0; i < aBytes.length; i++) {
    diff |= aBytes[i] ^ bBytes[i];
  }
  return diff === 0;
};

const jsonResponse = (data, status = 200, extraHeaders = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      ...CORS_HEADERS,
      'Content-Type': 'application/json; charset=utf-8',
      ...extraHeaders,
    },
  });

const errorResponse = (message, status = 400) =>
  jsonResponse({ ok: false, error: message }, status, { 'Cache-Control': 'no-store' });

const getR2Json = async (bucket, key) => {
  const object = await bucket.get(key);
  if (!object) return null;
  return await object.json();
};

const streamR2Object = async (bucket, key, extraHeaders = {}, fallbackJson = null) => {
  const object = await bucket.get(key);
  if (!object) {
    if (fallbackJson !== null) {
      return jsonResponse(fallbackJson, 200, extraHeaders);
    }
    return null;
  }
  const headers = new Headers({
    ...CORS_HEADERS,
    ...extraHeaders,
  });
  object.writeHttpMetadata(headers);
  if (object.httpEtag) headers.set('etag', object.httpEtag);
  headers.set('Content-Type', 'application/json; charset=utf-8');
  return new Response(object.body, { status: 200, headers });
};

const putR2Json = async (bucket, key, data) => {
  await bucket.put(key, JSON.stringify(data), {
    httpMetadata: {
      contentType: 'application/json; charset=utf-8',
    },
  });
};

const putR2RawStream = async (bucket, key, bodyStream) => {
  await bucket.put(key, bodyStream, {
    httpMetadata: {
      contentType: 'application/json; charset=utf-8',
    },
  });
};

const deleteR2 = async (bucket, key) => {
  await bucket.delete(key);
};

const mirrorToSupabase = async (env, payload) => {
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY || !env.CATALOG_ADMIN_TOKEN) {
    return;
  }
  try {
    await fetch(`${env.SUPABASE_URL.replace(/\/+$/, '')}/rest/v1/rpc/sync_r2_catalog_to_supabase`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: env.SUPABASE_ANON_KEY,
        Authorization: `Bearer ${env.SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify({
        p_admin_token: env.CATALOG_ADMIN_TOKEN,
        p_payload: payload,
      }),
    });
  } catch (err) {
    console.error('Supabase mirror sync warning:', err);
  }
};

const verifyAdmin = async (request, env) => {
  const token =
    request.headers.get('X-Catalog-Admin-Token') ||
    (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();

  if (!token) {
    return false;
  }

  const expectedAdminToken = (env.CATALOG_ADMIN_TOKEN || env.ADMIN_API_KEY || env.ADMIN_TOKEN)?.trim();
  if (expectedAdminToken && timingSafeEqualStr(token, expectedAdminToken)) {
    return true;
  }

  const catalogHeader = request.headers.get('X-Catalog-Admin-Token')?.trim();
  if (catalogHeader && expectedAdminToken && timingSafeEqualStr(catalogHeader, expectedAdminToken)) {
    return true;
  }

  if (env.SUPABASE_URL && env.SUPABASE_ANON_KEY) {
    const supabaseUrl = env.SUPABASE_URL.replace(/\/+$/, '');
    try {
      const authRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
        headers: {
          Authorization: `Bearer ${token}`,
          apikey: env.SUPABASE_ANON_KEY,
        },
      });

      if (authRes.ok) {
        const user = await authRes.json();
        if (user && user.id) {
          if (
            user.app_metadata?.role === 'admin' ||
            user.user_metadata?.role === 'admin' ||
            user.app_metadata?.claims_admin === true ||
            user.role === 'admin'
          ) {
            return true;
          }

          // 1. admin_users table check
          try {
            const adminRes = await fetch(
              `${supabaseUrl}/rest/v1/admin_users?id=eq.${encodeURIComponent(user.id)}&select=id`,
              {
                headers: {
                  Authorization: `Bearer ${token}`,
                  apikey: env.SUPABASE_ANON_KEY,
                },
              }
            );

            if (adminRes.ok) {
              const adminList = await adminRes.json();
              if (Array.isArray(adminList) && adminList.length > 0) {
                return true;
              }
            }
          } catch {
            // graceful ignore
          }

          // 2. profiles table check
          try {
            const profileRes = await fetch(
              `${supabaseUrl}/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}&select=role`,
              {
                headers: {
                  Authorization: `Bearer ${token}`,
                  apikey: env.SUPABASE_ANON_KEY,
                },
              }
            );

            if (profileRes.ok) {
              const profileList = await profileRes.json();
              if (Array.isArray(profileList) && profileList.length > 0) {
                const p = profileList[0];
                if (p && (p.role === 'admin' || p.is_admin === true)) {
                  return true;
                }
              }
            }
          } catch {
            // graceful ignore
          }

          // 3. users table check (strictly safe: select=role,is_admin with fallback to select=role)
          try {
            let userRes = await fetch(
              `${supabaseUrl}/rest/v1/users?id=eq.${encodeURIComponent(user.id)}&select=role,is_admin`,
              {
                headers: {
                  Authorization: `Bearer ${token}`,
                  apikey: env.SUPABASE_ANON_KEY,
                },
              }
            );

            if (!userRes.ok) {
              userRes = await fetch(
                `${supabaseUrl}/rest/v1/users?id=eq.${encodeURIComponent(user.id)}&select=role`,
                {
                  headers: {
                    Authorization: `Bearer ${token}`,
                    apikey: env.SUPABASE_ANON_KEY,
                  },
                }
              );
            }

            if (userRes.ok) {
              const userList = await userRes.json();
              if (Array.isArray(userList) && userList.length > 0) {
                const u = userList[0];
                if (u && (u.role === 'admin' || u.is_admin === true)) {
                  return true;
                }
              }
            }
          } catch {
            // graceful ignore
          }
        }
      }
    } catch (err) {
      console.error('Supabase admin verification check failed:', err);
    }
  }

  return false;
};

const normalizeMangaRow = (manga, fallbackNow = new Date().toISOString()) => {
  if (!manga || typeof manga !== 'object') return manga;
  const isPublic =
    manga.is_public !== undefined
      ? Boolean(manga.is_public)
      : manga.isPublic !== undefined
      ? Boolean(manga.isPublic)
      : true;
  const isAdult = Boolean(manga.is_adult ?? manga.isAdult ?? false);
  const createdAt = manga.created_at || manga.createdAt || fallbackNow;
  const lastUpdated = manga.last_updated || manga.updatedAt || manga.updated_at || createdAt;
  const releaseYear = manga.release_year ?? manga.releaseYear ?? null;
  const alternativeTitles = Array.isArray(manga.alternative_titles)
    ? manga.alternative_titles
    : Array.isArray(manga.alternativeTitles)
    ? manga.alternativeTitles
    : [];
  const sourceLinks = Array.isArray(manga.source_links)
    ? manga.source_links
    : Array.isArray(manga.sourceLinks)
    ? manga.sourceLinks
    : [];

  return {
    ...manga,
    author: manga.author || 'Bilinmiyor',
    artist: manga.artist || manga.author || 'Bilinmiyor',
    status: manga.status || 'ongoing',
    type: manga.type || 'webtoon',
    views: Number(manga.views ?? 0),
    genres: Array.isArray(manga.genres) ? manga.genres : [],
    is_public: isPublic,
    isPublic,
    is_adult: isAdult,
    isAdult,
    created_at: createdAt,
    createdAt,
    last_updated: lastUpdated,
    updatedAt: lastUpdated,
    updated_at: lastUpdated,
    release_year: releaseYear,
    releaseYear,
    alternative_titles: alternativeTitles,
    alternativeTitles,
    source_links: sourceLinks,
    sourceLinks,
  };
};

const normalizeTagRow = (tag, fallbackNow = new Date().toISOString()) => {
  if (!tag || typeof tag !== 'object') return tag;
  const name = `${tag.name || tag.slug || 'Genel'}`.trim();
  const slug = slugifyTagValue(tag.slug || name) || 'general';
  const isOfficial = tag.is_official !== undefined ? Boolean(tag.is_official) : tag.isOfficial !== undefined ? Boolean(tag.isOfficial) : true;
  const communityApproved = tag.community_approved !== undefined ? Boolean(tag.community_approved) : tag.communityApproved !== undefined ? Boolean(tag.communityApproved) : true;
  const usageCount = Number(tag.usage_count ?? tag.usageCount ?? 0);
  const createdAt = tag.created_at || tag.createdAt || fallbackNow;
  return {
    ...tag,
    name,
    slug,
    category: tag.category || 'theme',
    is_official: isOfficial,
    isOfficial,
    community_approved: communityApproved,
    communityApproved,
    usage_count: usageCount,
    usageCount,
    created_at: createdAt,
  };
};

const normalizeEntityTagRelationRow = (rel, fallbackNow = new Date().toISOString()) => {
  if (!rel || typeof rel !== 'object') return rel;
  const isDiscoverable = rel.is_discoverable !== undefined ? Boolean(rel.is_discoverable) : rel.isDiscoverable !== undefined ? Boolean(rel.isDiscoverable) : true;
  return {
    ...rel,
    is_discoverable: isDiscoverable,
    isDiscoverable,
    status: rel.status || 'accepted',
    created_at: rel.created_at || fallbackNow,
  };
};

const normalizeTableRows = (tableName, rawRows, nowIso) => {
  if (!Array.isArray(rawRows)) return [];
  if (tableName === 'mangas') {
    return rawRows.map((r) => {
      const { chapters, ...light } = normalizeMangaRow(r, nowIso);
      return light;
    });
  }
  if (tableName === 'tags') {
    return rawRows.map((r) => normalizeTagRow(r, nowIso));
  }
  if (tableName === 'manga_tags' || tableName === 'character_tags' || tableName === 'author_tags' || tableName === 'artist_tags') {
    return rawRows.map((r) => normalizeEntityTagRelationRow(r, nowIso));
  }
  return rawRows;
};

const buildMangaSummary = (manga) => {
  const normalized = normalizeMangaRow(manga);
  const { chapters, ...rest } = normalized;
  const chapterCount = Array.isArray(chapters) ? chapters.length : normalized.chapterCount || 0;
  const latestChapter = Array.isArray(chapters) && chapters.length > 0
    ? {
        id: chapters[chapters.length - 1].id,
        chapterNumber: chapters[chapters.length - 1].chapterNumber ?? chapters[chapters.length - 1].number,
        title: chapters[chapters.length - 1].title,
        releaseDate: chapters[chapters.length - 1].releaseDate || chapters[chapters.length - 1].release_date,
      }
    : null;

  return {
    ...rest,
    chapterCount,
    latestChapter,
  };
};

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    try {
      const bucket = env.ARCHIVE_BUCKET;
      if (!bucket) {
        return errorResponse('R2 ARCHIVE_BUCKET binding missing', 500);
      }

    const url = new URL(request.url);
    const pathname = url.pathname.replace(/\/+$/, '') || '/';
    const method = request.method.toUpperCase();

    if ((pathname === '/' || pathname === '/health') && method === 'GET') {
      return jsonResponse({
        ok: true,
        service: 'toonparrot-catalog-worker',
        timestamp: new Date().toISOString(),
      });
    }

    const edgeCacheHeaders = {
      'Cache-Control': 'public, max-age=15, s-maxage=30, stale-while-revalidate=120',
    };
    const noStoreHeaders = {
      'Cache-Control': 'no-store, no-cache, must-revalidate',
    };

    // ==================== 1. PUBLIC VIEW INCREMENT ENDPOINT ====================
    if (pathname === '/v1/catalog/views' && method === 'POST') {
      const body = await request.json().catch(() => null);
      const targetType = body?.type;
      const targetId = typeof body?.id === 'string' ? body.id.trim() : '';

      if (!['manga', 'chapter'].includes(targetType) || !/^[a-z0-9_-]{4,128}$/i.test(targetId)) {
        return errorResponse('Valid type (manga|chapter) and id required', 400);
      }

      const tableName = targetType === 'manga' ? 'mangas' : 'chapters';
      const rows = (await getR2Json(bucket, `catalog/tables/${tableName}.json`)) || [];
      const row = Array.isArray(rows) ? rows.find((item) => item && String(item.id) === targetId) : null;

      if (!row) {
        return jsonResponse({ ok: true, found: false }, 200, { 'Cache-Control': 'no-store' });
      }

      row.views = Number(row.views || 0) + 1;
      await putR2Json(bucket, `catalog/tables/${tableName}.json`, rows);

      if (targetType === 'manga') {
        const syncIndexPromise = (async () => {
          const index = await getR2Json(bucket, 'catalog/index.json');
          if (index && Array.isArray(index.mangas)) {
            const idxItem = index.mangas.find((m) => m && String(m.id) === targetId);
            if (idxItem) {
              idxItem.views = row.views;
              await putR2Json(bucket, 'catalog/index.json', index);
            }
          }
        })().catch(() => undefined);

        if (ctx?.waitUntil) ctx.waitUntil(syncIndexPromise);
      }

      if (env.SUPABASE_URL && env.SUPABASE_ANON_KEY) {
        const rpcName = targetType === 'manga' ? 'increment_manga_views' : 'increment_chapter_views';
        const rpcParam = targetType === 'manga' ? { manga_id_param: targetId } : { chapter_id_param: targetId };
        const rpcPromise = fetch(`${env.SUPABASE_URL.replace(/\/+$/, '')}/rest/v1/rpc/${rpcName}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            apikey: env.SUPABASE_ANON_KEY,
            Authorization: `Bearer ${env.SUPABASE_ANON_KEY}`,
          },
          body: JSON.stringify(rpcParam),
        }).catch(() => undefined);

        if (ctx?.waitUntil) ctx.waitUntil(rpcPromise);
      }

      return jsonResponse({ ok: true, views: row.views }, 200, { 'Cache-Control': 'no-store' });
    }

    // ==================== 2. PUBLIC TABLE READ ENDPOINTS ====================

    if (pathname === '/v1/catalog/tables' && method === 'GET') {
      const tablesParam = url.searchParams.get('tables');
      const excludeParam = url.searchParams.get('exclude');

      let targetTables = [...CATALOG_TABLES];
      if (tablesParam) {
        const allowed = new Set(tablesParam.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean));
        targetTables = targetTables.filter((t) => allowed.has(t));
      } else if (!url.searchParams.has('include_chapters')) {
        // Exclude massive chapters table by default to prevent CPU timeout (503) on free workers
        targetTables = targetTables.filter((t) => t !== 'chapters');
      }
      if (excludeParam) {
        const excluded = new Set(excludeParam.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean));
        targetTables = targetTables.filter((t) => !excluded.has(t));
      }

      const nowIso = new Date().toISOString();
      const isFresh = url.searchParams.get('fresh') === '1';
      const hasNoStoreTable = targetTables.some((t) => NO_STORE_TABLES.has(t));
      const headers = isFresh || hasNoStoreTable ? noStoreHeaders : edgeCacheHeaders;

      if (url.searchParams.get('normalize') !== '1') {
        const rawEntries = await Promise.all(
          targetTables.map(async (tableName) => {
            const obj = await bucket.get(`catalog/tables/${tableName}.json`);
            const rawText = obj ? (await obj.text()).trim() : '[]';
            return `${JSON.stringify(tableName)}:${rawText || '[]'}`;
          })
        );
        const bodyStr = `{"ok":true,"updatedAt":${JSON.stringify(nowIso)},"tables":{${rawEntries.join(',')}}}`;
        return new Response(bodyStr, {
          status: 200,
          headers: {
            ...CORS_HEADERS,
            'Content-Type': 'application/json; charset=utf-8',
            ...headers,
          },
        });
      }

      const tableDataEntries = await Promise.all(
        targetTables.map(async (tableName) => {
          const rawRows = (await getR2Json(bucket, `catalog/tables/${tableName}.json`)) || [];
          const rows = normalizeTableRows(tableName, rawRows, nowIso);
          return [tableName, rows];
        })
      );

      const tables = Object.fromEntries(tableDataEntries);

      return jsonResponse(
        {
          ok: true,
          updatedAt: nowIso,
          tables,
        },
        200,
        headers
      );
    }

    if (pathname.startsWith('/v1/catalog/table/') && method === 'GET') {
      const tableName = pathname.replace('/v1/catalog/table/', '').trim().toLowerCase();
      if (!CATALOG_TABLES.includes(tableName)) {
        return errorResponse(`Invalid catalog table: '${tableName}'`, 400);
      }

      const headers = NO_STORE_TABLES.has(tableName) ? noStoreHeaders : edgeCacheHeaders;
      if (url.searchParams.get('normalize') !== '1') {
        return await streamR2Object(bucket, `catalog/tables/${tableName}.json`, headers, []);
      }

      const nowIso = new Date().toISOString();
      const rawRows = (await getR2Json(bucket, `catalog/tables/${tableName}.json`)) || [];
      const rows = normalizeTableRows(tableName, rawRows, nowIso);
      return jsonResponse(rows, 200, headers);
    }

    // ==================== 3. LEGACY COMPATIBILITY READ ENDPOINTS ====================

    if (method === 'GET') {
      if (pathname === '/v1/catalog/snapshot') {
        return await streamR2Object(bucket, 'catalog/snapshot.json', edgeCacheHeaders, {
          version: 1,
          updatedAt: new Date().toISOString(),
          mangas: [],
          characters: [],
          authors: [],
          artists: [],
          tags: [],
          mangaRelationships: [],
        });
      }

      if (pathname === '/v1/catalog/index') {
        return await streamR2Object(bucket, 'catalog/index.json', edgeCacheHeaders, {
          version: 1,
          updatedAt: new Date().toISOString(),
          mangas: [],
        });
      }

      if (pathname.startsWith('/v1/catalog/series/')) {
        const slug = pathname.replace('/v1/catalog/series/', '').trim();
        if (!isValidSlug(slug)) return errorResponse('Invalid slug', 400);

        const object = await bucket.get(`catalog/series/${slug}.json`);
        if (!object) {
          return errorResponse(`Series '${slug}' not found`, 404);
        }
        const headers = new Headers(CORS_HEADERS);
        object.writeHttpMetadata(headers);
        headers.set('etag', object.httpEtag);
        headers.set('Content-Type', 'application/json; charset=utf-8');
        headers.set('Cache-Control', 'public, max-age=60, s-maxage=300, stale-while-revalidate=600');
        return new Response(object.body, { headers });
      }

      if (pathname === '/v1/catalog/characters') {
        return await streamR2Object(bucket, 'catalog/characters.json', edgeCacheHeaders, { characters: [] });
      }

      if (pathname === '/v1/catalog/taxonomies') {
        return await streamR2Object(bucket, 'catalog/taxonomies.json', edgeCacheHeaders, {
          authors: [],
          artists: [],
          tags: [],
        });
      }

      if (pathname === '/v1/catalog/sync-state') {
        const state = await getR2Json(bucket, 'manifests/sync-state.json');
        return jsonResponse(state || { status: 'idle', updatedAt: null }, 200, edgeCacheHeaders);
      }

      if (pathname === '/v1/catalog/automation-state') {
        const state = await getR2Json(bucket, 'manifests/automation-state.json');
        return jsonResponse(state || { version: 1, updatedAt: null, seriesQueue: {}, runHistory: [] }, 200, { 'Cache-Control': 'no-store' });
      }
    }

    // ==================== 4. ADMIN MUTATION ENDPOINTS ====================
    if (pathname.startsWith('/v1/admin/')) {
      const isAdmin = await verifyAdmin(request, env);
      if (!isAdmin) {
        return errorResponse('Unauthorized: Valid admin token or admin session required', 401);
      }

      const now = new Date().toISOString();

      if (pathname === '/v1/admin/catalog/automation-state' && method === 'PUT') {
        const body = await request.json().catch(() => null);
        if (!body || typeof body !== 'object') {
          return errorResponse('Valid automation state object required', 400);
        }
        const existingState = await getR2Json(bucket, 'manifests/automation-state.json');
        const nextState = {
          ...body,
          deletedAutomationMangaIds: Array.isArray(body.deletedAutomationMangaIds)
            ? body.deletedAutomationMangaIds
            : existingState?.deletedAutomationMangaIds || [],
          deletedAutomationIds: Array.isArray(body.deletedAutomationIds)
            ? body.deletedAutomationIds
            : existingState?.deletedAutomationIds || [],
          updatedAt: now,
        };
        await putR2Json(bucket, 'manifests/automation-state.json', nextState);
        return jsonResponse({ ok: true, updatedAt: now });
      }

      if (pathname.startsWith('/v1/admin/cover/') && method === 'PUT') {
        const fileName = pathname.replace('/v1/admin/cover/', '').trim();
        if (!fileName || !/^[a-z0-9_.-]+$/i.test(fileName) || fileName.includes('..')) {
          return errorResponse('Invalid cover file name', 400);
        }
        const contentType = request.headers.get('Content-Type') || 'image/jpeg';
        const objectKey = `covers/${fileName}`;
        await bucket.put(objectKey, request.body, {
          httpMetadata: {
            contentType,
            cacheControl: 'public, max-age=31536000, immutable',
          },
        });
        return jsonResponse({
          ok: true,
          key: objectKey,
          publicUrl: `https://pub-07935d827f4c4ba1995ed590a345b88a.r2.dev/${objectKey}`,
          updatedAt: now,
        });
      }

      if (pathname.startsWith('/v1/admin/table/') && !pathname.endsWith('/mutate') && method === 'PUT') {
        const tableName = pathname.replace('/v1/admin/table/', '').trim().toLowerCase();
        if (!CATALOG_TABLES.includes(tableName)) {
          return errorResponse(`Invalid catalog table: '${tableName}'`, 400);
        }

        if (url.searchParams.get('raw') === '1') {
          await putR2RawStream(bucket, `catalog/tables/${tableName}.json`, request.body);
          return jsonResponse({
            ok: true,
            tableName,
            raw: true,
            updatedAt: now,
          });
        }

        const body = await request.json().catch(() => null);
        const rows = Array.isArray(body) ? body : Array.isArray(body?.rows) ? body.rows : null;
        if (!rows) {
          return errorResponse('Payload must be an array of rows or { rows: [...] }', 400);
        }

        await putR2Json(bucket, `catalog/tables/${tableName}.json`, rows);

        if (tableName === 'mangas') {
          const indexList = rows.map(buildMangaSummary);
          await putR2Json(bucket, 'catalog/index.json', {
            version: 1,
            updatedAt: now,
            mangas: indexList,
          });
        }

        return jsonResponse({
          ok: true,
          tableName,
          count: rows.length,
          updatedAt: now,
        });
      }

      if (pathname.startsWith('/v1/admin/table/') && pathname.endsWith('/mutate') && method === 'POST') {
        const tableName = pathname.replace('/v1/admin/table/', '').replace('/mutate', '').trim().toLowerCase();
        if (!CATALOG_TABLES.includes(tableName)) {
          return errorResponse(`Invalid catalog table: '${tableName}'`, 400);
        }

        const body = await request.json().catch(() => null);
        if (!body || typeof body !== 'object' || !body.action) {
          return errorResponse("Missing mutation payload with 'action'", 400);
        }

        const { action, rows: incomingRows, match, onConflict, patch } = body;
        let currentRows = (await getR2Json(bucket, `catalog/tables/${tableName}.json`)) || [];
        let affectedRows = [];

        if (action === 'insert') {
          const newRows = (Array.isArray(incomingRows) ? incomingRows : [incomingRows]).filter(Boolean).map((r) => ({
            id: r.id || crypto.randomUUID(),
            ...r,
            created_at: r.created_at || now,
            updated_at: now,
          }));

          currentRows.push(...newRows);
          affectedRows = newRows;
        } else if (action === 'upsert') {
          const conflictCols = (onConflict || 'id')
            .split(',')
            .map((c) => c.trim())
            .filter(Boolean);

          const items = (Array.isArray(incomingRows) ? incomingRows : [incomingRows]).filter(Boolean);

          for (const item of items) {
            const matchIndex = currentRows.findIndex((existing) =>
              conflictCols.every((col) => existing[col] !== undefined && String(existing[col]) === String(item[col]))
            );

            if (matchIndex >= 0) {
              const updated = {
                ...currentRows[matchIndex],
                ...item,
                updated_at: now,
              };
              currentRows[matchIndex] = updated;
              affectedRows.push(updated);
            } else {
              const inserted = {
                id: item.id || crypto.randomUUID(),
                ...item,
                created_at: item.created_at || now,
                updated_at: now,
              };
              currentRows.push(inserted);
              affectedRows.push(inserted);
            }
          }
        } else if (action === 'update') {
          if (match && typeof match === 'object') {
            const matchEntries = Object.entries(match);
            for (let i = 0; i < currentRows.length; i++) {
              const matches = matchEntries.every(([k, v]) => String(currentRows[i][k]) === String(v));
              if (matches) {
                currentRows[i] = {
                  ...currentRows[i],
                  ...(patch || {}),
                  updated_at: now,
                };
                affectedRows.push(currentRows[i]);
              }
            }
          } else if (Array.isArray(incomingRows)) {
            for (const item of incomingRows) {
              if (item && item.id) {
                const idx = currentRows.findIndex((r) => r.id === item.id);
                if (idx >= 0) {
                  currentRows[idx] = { ...currentRows[idx], ...item, updated_at: now };
                  affectedRows.push(currentRows[idx]);
                }
              }
            }
          }
        } else if (action === 'delete') {
          const idsToDelete = new Set();

          if (Array.isArray(incomingRows)) {
            for (const r of incomingRows) {
              if (r && typeof r === 'object' && r.id) idsToDelete.add(String(r.id));
              else if (typeof r === 'string' || typeof r === 'number') idsToDelete.add(String(r));
            }
          } else if (incomingRows && typeof incomingRows === 'object' && incomingRows.id) {
            idsToDelete.add(String(incomingRows.id));
          }

          if (Array.isArray(body.ids)) {
            for (const id of body.ids) idsToDelete.add(String(id));
          } else if (body.id) {
            idsToDelete.add(String(body.id));
          }

          if (match && typeof match === 'object' && match.id !== undefined) {
            const rawIdVal = String(match.id).trim();
            if (rawIdVal.startsWith('in.(') && rawIdVal.endsWith(')')) {
              const inIds = rawIdVal.slice(4, -1).split(',').map((s) => s.trim().replace(/^["']|["']$/g, ''));
              for (const id of inIds) idsToDelete.add(id);
            } else {
              idsToDelete.add(rawIdVal);
            }
          }

          if (idsToDelete.size > 0) {
            const remaining = [];
            for (const r of currentRows) {
              if (r && idsToDelete.has(String(r.id))) {
                affectedRows.push(r);
              } else {
                remaining.push(r);
              }
            }
            currentRows = remaining;
          } else if (match && typeof match === 'object' && Object.keys(match).length > 0) {
            const matchEntries = Object.entries(match);
            const remaining = [];
            for (const r of currentRows) {
              const matches = matchEntries.every(([k, v]) => String(r[k]) === String(v));
              if (matches) {
                affectedRows.push(r);
              } else {
                remaining.push(r);
              }
            }
            currentRows = remaining;
          }
        } else {
          return errorResponse(`Unsupported mutation action: '${action}'`, 400);
        }

        await putR2Json(bucket, `catalog/tables/${tableName}.json`, currentRows);

        if (tableName === 'mangas') {
          const indexList = currentRows.map(buildMangaSummary);
          await putR2Json(bucket, 'catalog/index.json', {
            version: 1,
            updatedAt: now,
            mangas: indexList,
          });
        }

        if (tableName === 'chapter_automations' && action === 'delete' && affectedRows.length > 0) {
          const autoState = (await getR2Json(bucket, 'manifests/automation-state.json')) || { version: 2, seriesQueue: {} };
          const delMangaIds = affectedRows.map((r) => r.manga_id).filter(Boolean);
          const delIds = affectedRows.map((r) => r.id).filter(Boolean);
          const existingMangaIds = Array.isArray(autoState.deletedAutomationMangaIds) ? autoState.deletedAutomationMangaIds : [];
          const existingIds = Array.isArray(autoState.deletedAutomationIds) ? autoState.deletedAutomationIds : [];

          autoState.deletedAutomationMangaIds = Array.from(new Set([...existingMangaIds, ...delMangaIds]));
          autoState.deletedAutomationIds = Array.from(new Set([...existingIds, ...delIds]));
          autoState.updatedAt = now;
          await putR2Json(bucket, 'manifests/automation-state.json', autoState);

          if (delIds.length > 0) {
            const delIdsSet = new Set(delIds.map(String));
            const runs = (await getR2Json(bucket, 'catalog/tables/chapter_automation_runs.json')) || [];
            if (Array.isArray(runs) && runs.length > 0) {
              const remainingRuns = runs.filter((run) => !delIdsSet.has(String(run.automation_id)));
              if (remainingRuns.length !== runs.length) {
                await putR2Json(bucket, 'catalog/tables/chapter_automation_runs.json', remainingRuns);
              }
            }
          }

          await mirrorToSupabase(env, { delete_automation_ids: delIds });
        } else if (tableName === 'chapter_automations' && (action === 'insert' || action === 'upsert') && affectedRows.length > 0) {
          const autoState = await getR2Json(bucket, 'manifests/automation-state.json');
          if (autoState && Array.isArray(autoState.deletedAutomationMangaIds) && autoState.deletedAutomationMangaIds.length > 0) {
            const activeMangaIds = new Set(affectedRows.map((r) => r.manga_id).filter(Boolean));
            const activeIds = new Set(affectedRows.map((r) => r.id).filter(Boolean));
            const prevMangaCount = autoState.deletedAutomationMangaIds.length;
            autoState.deletedAutomationMangaIds = autoState.deletedAutomationMangaIds.filter((id) => !activeMangaIds.has(id));
            if (Array.isArray(autoState.deletedAutomationIds)) {
              autoState.deletedAutomationIds = autoState.deletedAutomationIds.filter((id) => !activeIds.has(id));
            }
            if (autoState.deletedAutomationMangaIds.length !== prevMangaCount) {
              autoState.updatedAt = now;
              await putR2Json(bucket, 'manifests/automation-state.json', autoState);
            }
          }
        }

        if (action === 'delete' && tableName === 'mangas' && affectedRows.length > 0) {
          await mirrorToSupabase(env, {
            delete_manga_ids: affectedRows.map((r) => r.id).filter(Boolean),
          });
        } else if (action === 'delete' && tableName === 'chapter_automations') {
          // mirrorToSupabase already called above with delete_automation_ids
        } else if (action !== 'delete' && affectedRows.length > 0) {
          await mirrorToSupabase(env, {
            [tableName]: affectedRows,
          });
        }

        return jsonResponse({
          ok: true,
          action,
          tableName,
          count: affectedRows.length,
          deletedCount: affectedRows.length,
          affectedRows,
          updatedAt: now,
        });
      }

      if (pathname === '/v1/admin/catalog/tables' && method === 'PUT') {
        const body = await request.json().catch(() => null);
        if (!body || typeof body.tables !== 'object') {
          return errorResponse("Missing payload with 'tables' object", 400);
        }

        const updatedTables = [];
        for (const [tbl, rows] of Object.entries(body.tables)) {
          if (CATALOG_TABLES.includes(tbl) && Array.isArray(rows)) {
            await putR2Json(bucket, `catalog/tables/${tbl}.json`, rows);
            updatedTables.push(tbl);
          }
        }

        if (body.tables.mangas && Array.isArray(body.tables.mangas)) {
          const indexList = body.tables.mangas.map(buildMangaSummary);
          await putR2Json(bucket, 'catalog/index.json', {
            version: 1,
            updatedAt: now,
            mangas: indexList,
          });
        }

        return jsonResponse({
          ok: true,
          updatedTables,
          count: updatedTables.length,
          updatedAt: now,
        });
      }

      if (pathname === '/v1/admin/catalog/index' && method === 'PUT') {
        await putR2RawStream(bucket, 'catalog/index.json', request.body);
        return jsonResponse({ ok: true, updatedAt: now });
      }

      if (pathname === '/v1/admin/catalog/snapshot' && method === 'PUT') {
        if (url.searchParams.get('raw') === '1') {
          await putR2RawStream(bucket, 'catalog/snapshot.json', request.body);
          return jsonResponse({
            ok: true,
            raw: true,
            message: 'Raw catalog snapshot streamed to R2 successfully',
            timestamp: now,
          });
        }

        const body = await request.json().catch(() => null);
        if (!body || !Array.isArray(body.mangas)) {
          return errorResponse('Valid snapshot payload with mangas array is required', 400);
        }

        const normalizedMangas = body.mangas.map((m) => normalizeMangaRow(m, now));
        const normalizedTags = Array.isArray(body.tags) ? body.tags.map((t) => normalizeTagRow(t, now)) : [];

        const snapshot = {
          version: 1,
          updatedAt: now,
          mangas: normalizedMangas,
          characters: Array.isArray(body.characters) ? body.characters : [],
          authors: Array.isArray(body.authors) ? body.authors : [],
          artists: Array.isArray(body.artists) ? body.artists : [],
          tags: normalizedTags,
          mangaRelationships: Array.isArray(body.mangaRelationships) ? body.mangaRelationships : [],
        };

        await putR2Json(bucket, 'catalog/snapshot.json', snapshot);

        const indexList = normalizedMangas.map(buildMangaSummary);
        await putR2Json(bucket, 'catalog/index.json', {
          version: 1,
          updatedAt: now,
          mangas: indexList,
        });

        await putR2Json(bucket, 'catalog/characters.json', { characters: snapshot.characters });
        await putR2Json(bucket, 'catalog/taxonomies.json', {
          authors: snapshot.authors,
          artists: snapshot.artists,
          tags: snapshot.tags,
        });

        let totalChapters = 0;
        let totalPages = 0;
        for (const manga of normalizedMangas) {
          if (manga) {
            const chapters = Array.isArray(manga.chapters) ? manga.chapters : [];
            totalChapters += chapters.length;
            for (const ch of chapters) {
              if (Array.isArray(ch.pages)) totalPages += ch.pages.length;
            }
          }
        }

        await putR2Json(bucket, 'manifests/sync-state.json', {
          lastSyncAt: now,
          totalMangas: normalizedMangas.length,
          totalChapters,
          totalPages,
          totalCharacters: snapshot.characters.length,
          status: 'synced',
        });

        return jsonResponse({
          ok: true,
          message: 'Full catalog snapshot applied successfully',
          mangaCount: normalizedMangas.length,
          totalChapters,
          timestamp: now,
        });
      }

      if (pathname.startsWith('/v1/admin/series/') && !pathname.endsWith('/chapters') && method === 'PUT') {
        const slug = pathname.replace('/v1/admin/series/', '').trim();
        if (!isValidSlug(slug)) return errorResponse('Invalid slug', 400);

        const onlySeries = url.searchParams.get('onlySeries') === '1';
        if (onlySeries && url.searchParams.get('raw') === '1') {
          await putR2RawStream(bucket, `catalog/series/${slug}.json`, request.body);
          return jsonResponse({ ok: true, slug, raw: true, updatedAt: now });
        }

        const mangaData = await request.json().catch(() => null);
        if (!mangaData || typeof mangaData !== 'object') {
          return errorResponse('Valid manga data object is required', 400);
        }

        const manga = { ...normalizeMangaRow(mangaData, now), slug, updatedAt: now };

        await putR2Json(bucket, `catalog/series/${slug}.json`, manga);

        if (!onlySeries) {
          const index = (await getR2Json(bucket, 'catalog/index.json')) || {
            version: 1,
            updatedAt: now,
            mangas: [],
          };
          const summary = buildMangaSummary(manga);
          const existingIdx = index.mangas.findIndex((m) => m.slug === slug || m.id === manga.id);
          if (existingIdx >= 0) {
            index.mangas[existingIdx] = summary;
          } else {
            index.mangas.push(summary);
          }
          index.updatedAt = now;
          await putR2Json(bucket, 'catalog/index.json', index);
        }

        return jsonResponse({ ok: true, slug, updatedAt: now });
      }

      if (pathname.startsWith('/v1/admin/series/') && method === 'DELETE') {
        const slug = pathname.replace('/v1/admin/series/', '').trim();
        if (!isValidSlug(slug)) return errorResponse('Invalid slug', 400);

        await deleteR2(bucket, `catalog/series/${slug}.json`);

        const onlySeries = url.searchParams.get('onlySeries') === '1';
        if (!onlySeries) {
          const index = await getR2Json(bucket, 'catalog/index.json');
          if (index && Array.isArray(index.mangas)) {
            index.mangas = index.mangas.filter((m) => m.slug !== slug);
            index.updatedAt = now;
            await putR2Json(bucket, 'catalog/index.json', index);
          }

          const snapshot = await getR2Json(bucket, 'catalog/snapshot.json');
          if (snapshot && Array.isArray(snapshot.mangas)) {
            snapshot.mangas = snapshot.mangas.filter((m) => m.slug !== slug);
            snapshot.updatedAt = now;
            await putR2Json(bucket, 'catalog/snapshot.json', snapshot);
          }
        }

        return jsonResponse({ ok: true, slug, deleted: true });
      }

      if (pathname.startsWith('/v1/admin/series/') && pathname.endsWith('/chapters') && method === 'POST') {
        const slug = pathname.replace('/v1/admin/series/', '').replace('/chapters', '').trim();
        if (!isValidSlug(slug)) return errorResponse('Invalid slug', 400);

        const body = await request.json().catch(() => null);
        if (!body || !Array.isArray(body.chapters)) {
          return errorResponse('Payload must contain chapters array', 400);
        }

        const existing = await getR2Json(bucket, `catalog/series/${slug}.json`);
        if (!existing) {
          return errorResponse(`Series '${slug}' not found`, 404);
        }

        existing.chapters = body.chapters;
        existing.chapterCount = body.chapters.length;
        existing.updatedAt = now;

        await putR2Json(bucket, `catalog/series/${slug}.json`, existing);

        const index = await getR2Json(bucket, 'catalog/index.json');
        if (index && Array.isArray(index.mangas)) {
          const item = index.mangas.find((m) => m.slug === slug || m.id === existing.id);
          if (item) {
            item.chapterCount = body.chapters.length;
            item.updatedAt = now;
            item.latestChapter = body.chapters.length > 0 ? {
              id: body.chapters[body.chapters.length - 1].id,
              chapterNumber: body.chapters[body.chapters.length - 1].chapterNumber,
              title: body.chapters[body.chapters.length - 1].title,
              releaseDate: body.chapters[body.chapters.length - 1].releaseDate,
            } : null;
            index.updatedAt = now;
            await putR2Json(bucket, 'catalog/index.json', index);
          }
        }

        const snapshot = await getR2Json(bucket, 'catalog/snapshot.json');
        if (snapshot && Array.isArray(snapshot.mangas)) {
          const snapManga = snapshot.mangas.find((m) => m.slug === slug || m.id === existing.id);
          if (snapManga) {
            snapManga.chapters = body.chapters;
            snapManga.chapterCount = body.chapters.length;
            snapManga.updatedAt = now;
            snapshot.updatedAt = now;
            await putR2Json(bucket, 'catalog/snapshot.json', snapshot);
          }
        }

        return jsonResponse({ ok: true, slug, chapterCount: body.chapters.length, updatedAt: now });
      }

      if (pathname === '/v1/admin/entities' && method === 'PUT') {
        const body = await request.json().catch(() => null);
        if (!body || typeof body !== 'object') {
          return errorResponse('Valid entities object required', 400);
        }

        if (Array.isArray(body.characters)) {
          await putR2Json(bucket, 'catalog/characters.json', { characters: body.characters });
          await putR2Json(bucket, 'catalog/tables/characters.json', body.characters);
        }

        if (Array.isArray(body.authors) || Array.isArray(body.artists) || Array.isArray(body.tags)) {
          const currentTax = (await getR2Json(bucket, 'catalog/taxonomies.json')) || {
            authors: [],
            artists: [],
            tags: [],
          };
          const normalizedTags = Array.isArray(body.tags) ? body.tags.map((t) => normalizeTagRow(t, now)) : currentTax.tags;
          const updatedTax = {
            authors: Array.isArray(body.authors) ? body.authors : currentTax.authors,
            artists: Array.isArray(body.artists) ? body.artists : currentTax.artists,
            tags: normalizedTags,
          };
          await putR2Json(bucket, 'catalog/taxonomies.json', updatedTax);

          if (Array.isArray(body.authors)) await putR2Json(bucket, 'catalog/tables/authors.json', body.authors);
          if (Array.isArray(body.artists)) await putR2Json(bucket, 'catalog/tables/artists.json', body.artists);
          if (Array.isArray(body.tags)) await putR2Json(bucket, 'catalog/tables/tags.json', normalizedTags);
        }

        const snapshot = await getR2Json(bucket, 'catalog/snapshot.json');
        if (snapshot) {
          if (Array.isArray(body.characters)) snapshot.characters = body.characters;
          if (Array.isArray(body.authors)) snapshot.authors = body.authors;
          if (Array.isArray(body.artists)) snapshot.artists = body.artists;
          if (Array.isArray(body.tags)) snapshot.tags = body.tags.map((t) => normalizeTagRow(t, now));
          if (Array.isArray(body.mangaRelationships)) snapshot.mangaRelationships = body.mangaRelationships;
          snapshot.updatedAt = now;
          await putR2Json(bucket, 'catalog/snapshot.json', snapshot);
        }

        return jsonResponse({ ok: true, updated: Object.keys(body), updatedAt: now });
      }

      if (pathname === '/v1/admin/catalog/backup' && method === 'POST') {
        const snapshot = await getR2Json(bucket, 'catalog/snapshot.json');
        if (!snapshot) {
          return errorResponse('No snapshot found to backup', 404);
        }

        const backupKey = `backups/backup-${Date.now()}.json`;
        await putR2Json(bucket, backupKey, snapshot);
        return jsonResponse({ ok: true, backupKey, timestamp: now });
      }

      if (pathname === '/v1/admin/catalog/restore' && method === 'POST') {
        const body = await request.json().catch(() => null);
        const backupKey = body?.backupKey;
        if (!backupKey || typeof backupKey !== 'string' || !/^backups\/backup-[a-z0-9_.-]+\.json$/i.test(backupKey) || backupKey.includes('..')) {
          return errorResponse('Invalid backup key', 400);
        }

        const restoredSnapshot = await getR2Json(bucket, backupKey);
        if (!restoredSnapshot || !Array.isArray(restoredSnapshot.mangas)) {
          return errorResponse(`Invalid backup at '${backupKey}'`, 404);
        }

        await putR2Json(bucket, 'catalog/snapshot.json', restoredSnapshot);
        const indexList = restoredSnapshot.mangas.map(buildMangaSummary);
        await putR2Json(bucket, 'catalog/index.json', {
          version: 1,
          updatedAt: restoredSnapshot.updatedAt || now,
          mangas: indexList,
        });

        if (restoredSnapshot.mangas.length <= 30) {
          for (const manga of restoredSnapshot.mangas) {
            if (manga && isValidSlug(manga.slug)) {
              await putR2Json(bucket, `catalog/series/${manga.slug}.json`, manga);
            }
          }
        }

        return jsonResponse({ ok: true, restoredFrom: backupKey, count: restoredSnapshot.mangas.length });
      }
    }

    return errorResponse(`Route '${method} ${pathname}' not found`, 404);
  } catch (err) {
    console.error('Unhandled catalog worker error:', err);
    return jsonResponse({ ok: false, error: err?.message || 'Internal Catalog Worker Error' }, 500, {
      'Cache-Control': 'no-store',
    });
  }
  },
};
