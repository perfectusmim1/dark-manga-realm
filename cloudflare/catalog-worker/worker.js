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

const isValidSlug = (slug) => Boolean(slug && /^[a-z0-9_-]+$/i.test(slug) && !slug.includes('..'));

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

const putR2Json = async (bucket, key, data) => {
  await bucket.put(key, JSON.stringify(data), {
    httpMetadata: {
      contentType: 'application/json; charset=utf-8',
    },
  });
};

const deleteR2 = async (bucket, key) => {
  await bucket.delete(key);
};

const verifyAdmin = async (request, env) => {
  const token =
    request.headers.get('X-Catalog-Admin-Token') ||
    (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();

  if (!token) {
    return false;
  }

  // 1. Env token check (No hardcoded fallback token)
  const expectedAdminToken = env.CATALOG_ADMIN_TOKEN?.trim();
  if (expectedAdminToken && token === expectedAdminToken) {
    return true;
  }

  // 2. Supabase Auth Verification
  if (env.SUPABASE_URL && env.SUPABASE_ANON_KEY) {
    try {
      const authRes = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
        headers: {
          Authorization: `Bearer ${token}`,
          apikey: env.SUPABASE_ANON_KEY,
        },
      });

      if (authRes.ok) {
        const user = await authRes.json();
        if (user && user.id) {
          // If metadata has admin role
          if (user.app_metadata?.role === 'admin' || user.user_metadata?.role === 'admin') {
            return true;
          }

          // Check admin_users table
          const adminRes = await fetch(
            `${env.SUPABASE_URL}/rest/v1/admin_users?user_id=eq.${encodeURIComponent(user.id)}&select=id`,
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

          // Check public.users table for role='admin' or is_admin=true
          const userRes = await fetch(
            `${env.SUPABASE_URL}/rest/v1/users?id=eq.${encodeURIComponent(user.id)}&select=role,is_admin`,
            {
              headers: {
                Authorization: `Bearer ${token}`,
                apikey: env.SUPABASE_ANON_KEY,
              },
            }
          );

          if (userRes.ok) {
            const userList = await userRes.json();
            if (Array.isArray(userList) && userList.length > 0) {
              const u = userList[0];
              if (u.role === 'admin' || u.is_admin === true) {
                return true;
              }
            }
          }
        }
      }
    } catch (err) {
      console.error('Supabase admin verification check failed:', err);
    }
  }

  return false;
};

// Build index entry without full chapter page arrays to keep index.json lightweight
const buildMangaSummary = (manga) => {
  const { chapters, ...rest } = manga;
  const chapterCount = Array.isArray(chapters) ? chapters.length : manga.chapterCount || 0;
  const latestChapter = Array.isArray(chapters) && chapters.length > 0
    ? {
        id: chapters[chapters.length - 1].id,
        chapterNumber: chapters[chapters.length - 1].chapterNumber,
        title: chapters[chapters.length - 1].title,
        releaseDate: chapters[chapters.length - 1].releaseDate,
      }
    : null;

  return {
    ...rest,
    chapterCount,
    latestChapter,
  };
};

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const bucket = env.ARCHIVE_BUCKET;
    if (!bucket) {
      return errorResponse('R2 ARCHIVE_BUCKET binding missing', 500);
    }

    const url = new URL(request.url);
    const pathname = url.pathname.replace(/\/+$/, '') || '/';
    const method = request.method.toUpperCase();

    // Healthcheck
    if (pathname === '/health' && method === 'GET') {
      return jsonResponse({
        ok: true,
        service: 'toonparrot-catalog-worker',
        timestamp: new Date().toISOString(),
      });
    }

    const edgeCacheHeaders = {
      'Cache-Control': 'public, max-age=30, s-maxage=60, stale-while-revalidate=86400',
    };

    // ==================== 1. PUBLIC TABLE READ ENDPOINTS ====================

    // GET /v1/catalog/tables: Tüm 16 tabloyu tek JSON olarak döner (veya ?tables=... ?exclude=...)
    if (pathname === '/v1/catalog/tables' && method === 'GET') {
      const tablesParam = url.searchParams.get('tables');
      const excludeParam = url.searchParams.get('exclude');

      let targetTables = [...CATALOG_TABLES];
      if (tablesParam) {
        const allowed = new Set(tablesParam.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean));
        targetTables = targetTables.filter((t) => allowed.has(t));
      }
      if (excludeParam) {
        const excluded = new Set(excludeParam.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean));
        targetTables = targetTables.filter((t) => !excluded.has(t));
      }

      const tableDataEntries = await Promise.all(
        targetTables.map(async (tableName) => {
          const rows = (await getR2Json(bucket, `catalog/tables/${tableName}.json`)) || [];
          return [tableName, rows];
        })
      );

      const tables = Object.fromEntries(tableDataEntries);

      return jsonResponse(
        {
          ok: true,
          updatedAt: new Date().toISOString(),
          tables,
        },
        200,
        edgeCacheHeaders
      );
    }

    // GET /v1/catalog/table/:tableName: Tek bir tablonun dizisini döner
    if (pathname.startsWith('/v1/catalog/table/') && method === 'GET') {
      const tableName = pathname.replace('/v1/catalog/table/', '').trim().toLowerCase();
      if (!CATALOG_TABLES.includes(tableName)) {
        return errorResponse(`Invalid catalog table: '${tableName}'`, 400);
      }

      const rows = (await getR2Json(bucket, `catalog/tables/${tableName}.json`)) || [];
      return jsonResponse(rows, 200, edgeCacheHeaders);
    }

    // ==================== 2. LEGACY COMPATIBILITY READ ENDPOINTS ====================

    if (method === 'GET') {
      if (pathname === '/v1/catalog/snapshot') {
        const snapshot = await getR2Json(bucket, 'catalog/snapshot.json');
        if (!snapshot) {
          return jsonResponse(
            {
              version: 1,
              updatedAt: new Date().toISOString(),
              mangas: [],
              characters: [],
              authors: [],
              artists: [],
              tags: [],
              mangaRelationships: [],
            },
            200,
            edgeCacheHeaders
          );
        }
        return jsonResponse(snapshot, 200, edgeCacheHeaders);
      }

      if (pathname === '/v1/catalog/index') {
        const index = await getR2Json(bucket, 'catalog/index.json');
        if (!index) {
          return jsonResponse(
            { version: 1, updatedAt: new Date().toISOString(), mangas: [] },
            200,
            edgeCacheHeaders
          );
        }
        return jsonResponse(index, 200, edgeCacheHeaders);
      }

      if (pathname.startsWith('/v1/catalog/series/')) {
        const slug = pathname.replace('/v1/catalog/series/', '').trim();
        if (!isValidSlug(slug)) return errorResponse('Invalid slug', 400);

        const series = await getR2Json(bucket, `catalog/series/${slug}.json`);
        if (!series) {
          return errorResponse(`Series '${slug}' not found`, 404);
        }
        return jsonResponse(series, 200, edgeCacheHeaders);
      }

      if (pathname === '/v1/catalog/characters') {
        const chars = await getR2Json(bucket, 'catalog/characters.json');
        return jsonResponse(chars || { characters: [] }, 200, edgeCacheHeaders);
      }

      if (pathname === '/v1/catalog/taxonomies') {
        const taxonomies = await getR2Json(bucket, 'catalog/taxonomies.json');
        return jsonResponse(
          taxonomies || { authors: [], artists: [], tags: [] },
          200,
          edgeCacheHeaders
        );
      }

      if (pathname === '/v1/catalog/sync-state') {
        const state = await getR2Json(bucket, 'manifests/sync-state.json');
        return jsonResponse(state || { status: 'idle', updatedAt: null }, 200, edgeCacheHeaders);
      }
    }

    // ==================== 3. ADMIN MUTATION ENDPOINTS ====================
    if (pathname.startsWith('/v1/admin/')) {
      const isAdmin = await verifyAdmin(request, env);
      if (!isAdmin) {
        return errorResponse('Unauthorized: Valid admin token or admin session required', 401);
      }

      const now = new Date().toISOString();

      // PUT /v1/admin/table/:tableName: Tek bir tablonun tamamını R2'ye yazar
      if (pathname.startsWith('/v1/admin/table/') && !pathname.endsWith('/mutate') && method === 'PUT') {
        const tableName = pathname.replace('/v1/admin/table/', '').trim().toLowerCase();
        if (!CATALOG_TABLES.includes(tableName)) {
          return errorResponse(`Invalid catalog table: '${tableName}'`, 400);
        }

        const body = await request.json().catch(() => null);
        const rows = Array.isArray(body) ? body : Array.isArray(body?.rows) ? body.rows : null;
        if (!rows) {
          return errorResponse('Payload must be an array of rows or { rows: [...] }', 400);
        }

        await putR2Json(bucket, `catalog/tables/${tableName}.json`, rows);

        // Mangas güncellendiyse index.json'u da senkronize et
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

      // POST /v1/admin/table/:tableName/mutate: Atomik tablo mutasyonu
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
          if (match && typeof match === 'object') {
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
          } else if (Array.isArray(incomingRows)) {
            const idsToDelete = new Set(incomingRows.map((r) => (typeof r === 'object' && r ? r.id : r)));
            const remaining = [];
            for (const r of currentRows) {
              if (idsToDelete.has(r.id)) {
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

        return jsonResponse({
          ok: true,
          action,
          tableName,
          count: affectedRows.length,
          affectedRows,
          updatedAt: now,
        });
      }

      // PUT /v1/admin/catalog/tables: Çoklu tabloyu tek seferde R2'ye yazar
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

      // 1. Full Snapshot Update
      if (pathname === '/v1/admin/catalog/snapshot' && method === 'PUT') {
        const body = await request.json().catch(() => null);
        if (!body || !Array.isArray(body.mangas)) {
          return errorResponse('Valid snapshot payload with mangas array is required', 400);
        }

        const snapshot = {
          version: 1,
          updatedAt: now,
          mangas: body.mangas,
          characters: Array.isArray(body.characters) ? body.characters : [],
          authors: Array.isArray(body.authors) ? body.authors : [],
          artists: Array.isArray(body.artists) ? body.artists : [],
          tags: Array.isArray(body.tags) ? body.tags : [],
          mangaRelationships: Array.isArray(body.mangaRelationships) ? body.mangaRelationships : [],
        };

        // Write full snapshot
        await putR2Json(bucket, 'catalog/snapshot.json', snapshot);

        // Write lightweight index
        const indexList = body.mangas.map(buildMangaSummary);
        await putR2Json(bucket, 'catalog/index.json', {
          version: 1,
          updatedAt: now,
          mangas: indexList,
        });

        // Also populate table files if chapters or other entities exist
        await putR2Json(bucket, 'catalog/tables/mangas.json', body.mangas);
        if (Array.isArray(body.characters)) await putR2Json(bucket, 'catalog/tables/characters.json', body.characters);
        if (Array.isArray(body.authors)) await putR2Json(bucket, 'catalog/tables/authors.json', body.authors);
        if (Array.isArray(body.artists)) await putR2Json(bucket, 'catalog/tables/artists.json', body.artists);
        if (Array.isArray(body.tags)) await putR2Json(bucket, 'catalog/tables/tags.json', body.tags);

        // Write taxonomies & characters
        await putR2Json(bucket, 'catalog/characters.json', { characters: snapshot.characters });
        await putR2Json(bucket, 'catalog/taxonomies.json', {
          authors: snapshot.authors,
          artists: snapshot.artists,
          tags: snapshot.tags,
        });

        // Write individual series files in batch (only partition when <= 30 to prevent Cloudflare subrequest limits)
        let totalChapters = 0;
        let totalPages = 0;
        const shouldPartitionIndividual = body.mangas.length <= 30;
        for (const manga of body.mangas) {
          if (manga && isValidSlug(manga.slug)) {
            const chapters = Array.isArray(manga.chapters) ? manga.chapters : [];
            totalChapters += chapters.length;
            for (const ch of chapters) {
              if (Array.isArray(ch.pages)) totalPages += ch.pages.length;
            }
            if (shouldPartitionIndividual) {
              await putR2Json(bucket, `catalog/series/${manga.slug}.json`, {
                ...manga,
                chapters,
              });
            }
          }
        }

        // Write sync state manifest
        await putR2Json(bucket, 'manifests/sync-state.json', {
          lastSyncAt: now,
          totalMangas: body.mangas.length,
          totalChapters,
          totalPages,
          totalCharacters: snapshot.characters.length,
          status: 'synced',
        });

        return jsonResponse({
          ok: true,
          message: 'Full catalog snapshot applied successfully',
          mangaCount: body.mangas.length,
          totalChapters,
          individualPartitioned: shouldPartitionIndividual,
          timestamp: now,
        });
      }

      // 2. Single Series Create / Update
      if (pathname.startsWith('/v1/admin/series/') && !pathname.endsWith('/chapters') && method === 'PUT') {
        const slug = pathname.replace('/v1/admin/series/', '').trim();
        if (!isValidSlug(slug)) return errorResponse('Invalid slug', 400);

        const mangaData = await request.json().catch(() => null);
        if (!mangaData || typeof mangaData !== 'object') {
          return errorResponse('Valid manga data object is required', 400);
        }

        const manga = { ...mangaData, slug, updatedAt: now };

        // Save individual series file
        await putR2Json(bucket, `catalog/series/${slug}.json`, manga);

        // Update index.json
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

        // Update snapshot.json
        const snapshot = await getR2Json(bucket, 'catalog/snapshot.json');
        if (snapshot && Array.isArray(snapshot.mangas)) {
          const snapIdx = snapshot.mangas.findIndex((m) => m.slug === slug || m.id === manga.id);
          if (snapIdx >= 0) {
            snapshot.mangas[snapIdx] = manga;
          } else {
            snapshot.mangas.push(manga);
          }
          snapshot.updatedAt = now;
          await putR2Json(bucket, 'catalog/snapshot.json', snapshot);
        }

        return jsonResponse({ ok: true, slug, updatedAt: now });
      }

      // 3. Delete Series
      if (pathname.startsWith('/v1/admin/series/') && method === 'DELETE') {
        const slug = pathname.replace('/v1/admin/series/', '').trim();
        if (!isValidSlug(slug)) return errorResponse('Invalid slug', 400);

        await deleteR2(bucket, `catalog/series/${slug}.json`);

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

        return jsonResponse({ ok: true, slug, deleted: true });
      }

      // 4. Series Chapters Update
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

        // Update index & snapshot
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

      // 5. Taxonomy & Entities Update
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
          const updatedTax = {
            authors: Array.isArray(body.authors) ? body.authors : currentTax.authors,
            artists: Array.isArray(body.artists) ? body.artists : currentTax.artists,
            tags: Array.isArray(body.tags) ? body.tags : currentTax.tags,
          };
          await putR2Json(bucket, 'catalog/taxonomies.json', updatedTax);

          if (Array.isArray(body.authors)) await putR2Json(bucket, 'catalog/tables/authors.json', body.authors);
          if (Array.isArray(body.artists)) await putR2Json(bucket, 'catalog/tables/artists.json', body.artists);
          if (Array.isArray(body.tags)) await putR2Json(bucket, 'catalog/tables/tags.json', body.tags);
        }

        // Sync with snapshot
        const snapshot = await getR2Json(bucket, 'catalog/snapshot.json');
        if (snapshot) {
          if (Array.isArray(body.characters)) snapshot.characters = body.characters;
          if (Array.isArray(body.authors)) snapshot.authors = body.authors;
          if (Array.isArray(body.artists)) snapshot.artists = body.artists;
          if (Array.isArray(body.tags)) snapshot.tags = body.tags;
          if (Array.isArray(body.mangaRelationships)) snapshot.mangaRelationships = body.mangaRelationships;
          snapshot.updatedAt = now;
          await putR2Json(bucket, 'catalog/snapshot.json', snapshot);
        }

        return jsonResponse({ ok: true, updated: Object.keys(body), updatedAt: now });
      }

      // 6. Backup Creation
      if (pathname === '/v1/admin/catalog/backup' && method === 'POST') {
        const snapshot = await getR2Json(bucket, 'catalog/snapshot.json');
        if (!snapshot) {
          return errorResponse('No snapshot found to backup', 404);
        }

        const backupKey = `backups/backup-${Date.now()}.json`;
        await putR2Json(bucket, backupKey, snapshot);
        return jsonResponse({ ok: true, backupKey, timestamp: now });
      }

      // 7. Backup Restoration
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

        // Apply as snapshot
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
  },
};
