const DEFAULT_ALLOWED_HOSTS = [
  'cdn.anime-planet.com',
  'anime-planet.com',
  'www.anime-planet.com',
  'myanimelist.net',
  'cdn.myanimelist.net',
  'api.jikan.moe',
  'mangaupdates.com',
  'api.mangaupdates.com',
  'anilist.co',
  'anisearch.com',
  'www.anisearch.com',
  'cdn.anisearch.com',
  'cdn.mangaupdates.com',
  'i.imgur.com',
  'i.pinimg.com',
  'webtoonhatti.club',
  'hayalistic.net',
  'i.hizliresim.com',
  'preview.redd.it',
  'i.redd.it',
  'i.namu.wiki',
  'nabimanga.com',
  'gg.asuracomic.net',
  'us-a.tapas.io',
  'wallpapers.com',
  'www.mc-tr.com',
  'napost.com',
  'ruyamanga.net',
];

const DEFAULT_ALLOWED_ORIGINS = [
  'https://toonparrot.vercel.app',
  'https://*.vercel.app',
  'http://localhost:*',
  'http://127.0.0.1:*',
];

const BROWSER_LIKE_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36';

const parseCsv = (value, fallback = []) => {
  const parsed = (value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

  return parsed.length > 0 ? parsed : fallback;
};

const matchesOriginPattern = (origin, pattern) => {
  if (!origin || !pattern) {
    return false;
  }

  if (pattern === '*') {
    return true;
  }

  const parts = pattern.split('*').filter(Boolean);
  if (parts.length === 0) {
    return true;
  }

  let searchIndex = 0;

  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];
    const foundIndex = origin.indexOf(part, searchIndex);

    if (foundIndex === -1) {
      return false;
    }

    if (index === 0 && !pattern.startsWith('*') && foundIndex !== 0) {
      return false;
    }

    searchIndex = foundIndex + part.length;
  }

  return pattern.endsWith('*') || origin.endsWith(parts[parts.length - 1]);
};

const resolveAllowedOrigin = (request, allowedOriginPatterns) => {
  const requestOrigin = request.headers.get('Origin');
  if (!requestOrigin) {
    return null;
  }

  return allowedOriginPatterns.some((pattern) => matchesOriginPattern(requestOrigin, pattern))
    ? requestOrigin
    : null;
};

const buildCorsHeaders = (allowedOrigin) => {
  if (!allowedOrigin) {
    return {
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Expose-Headers': 'Content-Type, Cache-Control',
      Vary: 'Origin',
    };
  }

  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Expose-Headers': 'Content-Type, Cache-Control',
    Vary: 'Origin',
  };
};

const jsonResponse = (body, status, corsHeaders) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });

const getRequestId = (request) => (
  request.headers.get('cf-ray')
  || request.headers.get('x-request-id')
  || crypto.randomUUID()
);

const getRefererPath = (request) => {
  const referer = request.headers.get('Referer');
  if (!referer) {
    return null;
  }

  try {
    const parsed = new URL(referer);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return null;
  }
};

const getOriginFromValue = (value) => {
  if (!value) {
    return null;
  }

  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
};

const normalizeHostRule = (value) => value.trim().toLowerCase().replace(/^\*\./, '');

const isAllowedHost = (hostname, allowedHosts) => {
  const normalizedHostname = hostname.trim().toLowerCase();

  return allowedHosts.some((value) => {
    const normalizedRule = normalizeHostRule(value);
    if (!normalizedRule) {
      return false;
    }

    return normalizedHostname === normalizedRule || normalizedHostname.endsWith(`.${normalizedRule}`);
  });
};

const getUpstreamReferer = (parsedUrl) => {
  const hostname = parsedUrl.hostname.toLowerCase();

  if (hostname === 'cdn.anime-planet.com' || hostname.endsWith('.anime-planet.com')) {
    return 'https://www.anime-planet.com/';
  }

  if (hostname === 'cdn.myanimelist.net' || hostname.endsWith('.myanimelist.net')) {
    return 'https://myanimelist.net/';
  }

  return `${parsedUrl.protocol}//${parsedUrl.hostname}/`;
};

const buildUpstreamHeaders = (parsedUrl, mode = 'browser') => {
  const referer = getUpstreamReferer(parsedUrl);
  const headers = new Headers({
    Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
    'User-Agent': BROWSER_LIKE_USER_AGENT,
  });

  if (mode !== 'minimal') {
    headers.set('Referer', referer);
    headers.set('Origin', referer.replace(/\/$/, ''));
  }

  return headers;
};

const fetchUpstreamImage = async (parsedUrl, transform) => {
  const attempts = [
    {
      mode: 'browser',
      useTransform: Boolean(transform),
      cf: transform ? { cacheEverything: false, image: transform } : { cacheEverything: false },
    },
    {
      mode: 'browser',
      useTransform: false,
      cf: { cacheEverything: false },
    },
    {
      mode: 'minimal',
      useTransform: false,
      cf: { cacheEverything: false },
    },
  ];

  let lastResponse = null;

  for (const attempt of attempts) {
    if (attempt.useTransform === false && lastResponse?.ok) {
      break;
    }

    const response = await fetch(parsedUrl.toString(), {
      method: 'GET',
      headers: buildUpstreamHeaders(parsedUrl, attempt.mode),
      redirect: 'follow',
      cf: attempt.cf,
    }).catch((error) => {
      console.error('media-ingest upstream request failed', {
        host: parsedUrl.hostname,
        mode: attempt.mode,
        transformed: attempt.useTransform,
        error,
      });
      return null;
    });

    if (response?.ok) {
      return response;
    }

    lastResponse = response;
  }

  return lastResponse;
};

const PUBLIC_CACHE_CONTROL = 'public, max-age=31536000, immutable';

const normalizeTransform = (transform) => {
  if (!transform || typeof transform !== 'object') {
    return null;
  }

  const width = Number.isFinite(Number(transform.width)) ? Math.max(64, Math.min(2400, Math.round(Number(transform.width)))) : undefined;
  const quality = Number.isFinite(Number(transform.quality)) ? Math.max(35, Math.min(90, Math.round(Number(transform.quality)))) : undefined;
  const fit = ['scale-down', 'contain', 'cover'].includes(transform.fit) ? transform.fit : undefined;
  const format = ['webp', 'avif', 'jpeg', 'png'].includes(transform.format) ? transform.format : 'webp';

  return {
    ...(width ? { width } : {}),
    ...(quality ? { quality } : {}),
    ...(fit ? { fit } : {}),
    format,
  };
};

const logEvent = (event, payload) => {
  console.log(JSON.stringify({
    service: 'media-ingest',
    event,
    timestamp: new Date().toISOString(),
    ...payload,
  }));
};

const queueMetric = (env, ctx, event, payload) => {
  const metricsUrl = `${env.METRICS_INGEST_URL || ''}`.trim();
  const metricsToken = `${env.METRICS_INGEST_TOKEN || ''}`.trim();

  if (!ctx || !metricsUrl || !metricsToken) {
    return;
  }

  ctx.waitUntil(
    fetch(metricsUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${metricsToken}`,
      },
      body: JSON.stringify({
        service: 'media-ingest',
        event,
        createdAt: new Date().toISOString(),
        ...payload,
      }),
    }).catch((error) => {
      console.error('media-ingest metric enqueue failed', error);
    }),
  );
};

const reportEvent = (env, ctx, event, payload) => {
  logEvent(event, payload);
  queueMetric(env, ctx, event, payload);
};

const encodeObjectKey = (key) => key.split('/').map((segment) => encodeURIComponent(segment)).join('/');

const buildPublicUrl = (env, key) => {
  const baseUrl = `${env.PUBLIC_BUCKET_URL || ''}`.trim().replace(/\/+$/, '');
  if (!baseUrl) {
    return null;
  }

  return `${baseUrl}/${encodeObjectKey(key)}`;
};

const isValidObjectKey = (key) => typeof key === 'string' && /^[a-z0-9][a-z0-9/_-]*\.(webp|avif|png|jpe?g)$/i.test(key);

const readRequestPayload = async (request) => {
  if (request.method === 'GET') {
    return { items: [] };
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return null;
  }

  const items = Array.isArray(body.items) ? body.items : body.item ? [body.item] : [];
  return {
    items,
    force: body.force === true,
  };
};

const processItem = async (env, item, context) => {
  const startedAt = Date.now();
  const sourceUrl = typeof item?.sourceUrl === 'string' ? item.sourceUrl.trim() : '';
  const objectKey = typeof item?.objectKey === 'string' ? item.objectKey.trim() : '';
  const sourceName = typeof item?.sourceName === 'string' ? item.sourceName.trim() : null;
  const entityType = typeof item?.entityType === 'string' ? item.entityType.trim() : null;
  const variant = typeof item?.variant === 'string' ? item.variant.trim() : null;
  const transform = normalizeTransform(item?.transform);
  const force = context.force === true || item?.force === true;
  const itemId = typeof item?.id === 'string' ? item.id : objectKey || sourceUrl;

  if (!sourceUrl || !objectKey || !isValidObjectKey(objectKey)) {
    reportEvent(env, context.ctx, 'invalid_request', {
      requestId: context.requestId,
      itemId,
      objectKey,
      sourceUrl,
      status: 400,
      refererPath: context.refererPath,
      durationMs: Date.now() - startedAt,
    });

    return {
      id: itemId,
      status: 'invalid',
      error: 'Invalid sourceUrl or objectKey',
    };
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(sourceUrl);
  } catch {
    reportEvent(env, context.ctx, 'invalid_request', {
      requestId: context.requestId,
      itemId,
      objectKey,
      sourceUrl,
      status: 400,
      refererPath: context.refererPath,
      durationMs: Date.now() - startedAt,
    });

    return {
      id: itemId,
      status: 'invalid',
      error: 'Invalid sourceUrl',
    };
  }

  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    reportEvent(env, context.ctx, 'invalid_request', {
      requestId: context.requestId,
      itemId,
      objectKey,
      sourceUrl,
      sourceHost: parsedUrl.hostname,
      status: 400,
      refererPath: context.refererPath,
      durationMs: Date.now() - startedAt,
    });

    return {
      id: itemId,
      status: 'invalid',
      error: 'Unsupported protocol',
    };
  }

  if (!isAllowedHost(parsedUrl.hostname, context.allowedHosts)) {
    reportEvent(env, context.ctx, 'blocked', {
      requestId: context.requestId,
      itemId,
      objectKey,
      sourceHost: parsedUrl.hostname,
      sourceUrl: parsedUrl.toString(),
      sourceName,
      entityType,
      variant,
      status: 403,
      refererPath: context.refererPath,
      durationMs: Date.now() - startedAt,
    });

    return {
      id: itemId,
      status: 'blocked',
      error: 'Host is not allowed',
      sourceHost: parsedUrl.hostname,
    };
  }

  if (!force) {
    const existing = await env.MEDIA_BUCKET.head(objectKey);
    if (existing) {
      const publicUrl = buildPublicUrl(env, objectKey);
      reportEvent(env, context.ctx, 'cache_hit', {
        requestId: context.requestId,
        itemId,
        objectKey,
        sourceHost: parsedUrl.hostname,
        sourceName,
        entityType,
        variant,
        durationMs: Date.now() - startedAt,
      });

      return {
        id: itemId,
        status: 'exists',
        objectKey,
        publicUrl,
      };
    }
  }

  const upstreamResponse = await fetchUpstreamImage(parsedUrl, transform);

  if (!upstreamResponse || !upstreamResponse.ok) {
    reportEvent(env, context.ctx, 'upstream_failure', {
      requestId: context.requestId,
      itemId,
      sourceHost: parsedUrl.hostname,
      sourceUrl: parsedUrl.toString(),
      sourceName,
      entityType,
      variant,
      status: upstreamResponse?.status || 502,
      refererPath: context.refererPath,
      durationMs: Date.now() - startedAt,
    });

    return {
      id: itemId,
      status: 'error',
      error: `Upstream request failed (${upstreamResponse?.status || 502})`,
      sourceHost: parsedUrl.hostname,
    };
  }

  const contentType = upstreamResponse.headers.get('Content-Type') || (transform?.format === 'webp' ? 'image/webp' : 'application/octet-stream');
  const arrayBuffer = await upstreamResponse.arrayBuffer();

  await env.MEDIA_BUCKET.put(objectKey, arrayBuffer, {
    httpMetadata: {
      contentType,
      cacheControl: PUBLIC_CACHE_CONTROL,
    },
    customMetadata: {
      sourceUrl: parsedUrl.toString(),
      sourceName: sourceName || '',
      entityType: entityType || '',
      variant: variant || '',
    },
  });

  const publicUrl = buildPublicUrl(env, objectKey);
  reportEvent(env, context.ctx, 'stored', {
    requestId: context.requestId,
    itemId,
    objectKey,
    sourceHost: parsedUrl.hostname,
    sourceUrl: parsedUrl.toString(),
    sourceName,
    entityType,
    variant,
    bytes: arrayBuffer.byteLength,
    contentType,
    durationMs: Date.now() - startedAt,
  });

  return {
    id: itemId,
    status: 'stored',
    objectKey,
    publicUrl,
    bytes: arrayBuffer.byteLength,
    contentType,
  };
};

export default {
  async fetch(request, env, ctx) {
    const startedAt = Date.now();
    const requestId = getRequestId(request);
    const allowedHosts = parseCsv(env.ALLOWED_HOSTS, DEFAULT_ALLOWED_HOSTS);
    const allowedOriginPatterns = parseCsv(env.ALLOWED_ORIGINS, DEFAULT_ALLOWED_ORIGINS);
    const allowedOrigin = resolveAllowedOrigin(request, allowedOriginPatterns);
    const corsHeaders = buildCorsHeaders(allowedOrigin);
    const requestOrigin = request.headers.get('Origin');
    const refererOrigin = getOriginFromValue(request.headers.get('Referer'));
    const isAllowedReferer = refererOrigin
      ? allowedOriginPatterns.some((pattern) => matchesOriginPattern(refererOrigin, pattern))
      : false;
    const refererPath = getRefererPath(request);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (!['GET', 'POST'].includes(request.method)) {
      reportEvent(env, ctx, 'blocked', {
        requestId,
        status: 405,
        method: request.method,
        refererPath,
        durationMs: Date.now() - startedAt,
      });
      return jsonResponse({ error: 'Method not allowed' }, 405, corsHeaders);
    }

    const expectedToken = `${env.INGEST_TOKEN || ''}`.trim();
    const authHeader = request.headers.get('Authorization') || '';
    const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';

    if (requestOrigin && !allowedOrigin) {
      reportEvent(env, ctx, 'blocked', {
        requestId,
        status: 403,
        reason: 'origin_not_allowed',
        refererPath,
        durationMs: Date.now() - startedAt,
      });
      return jsonResponse({ error: 'Origin is not allowed' }, 403, corsHeaders);
    }

    if (!requestOrigin && refererOrigin && !isAllowedReferer) {
      reportEvent(env, ctx, 'blocked', {
        requestId,
        status: 403,
        reason: 'referer_not_allowed',
        refererPath,
        durationMs: Date.now() - startedAt,
      });
      return jsonResponse({ error: 'Referer is not allowed' }, 403, corsHeaders);
    }

    if (!expectedToken || bearerToken !== expectedToken) {
      reportEvent(env, ctx, 'blocked', {
        requestId,
        status: 401,
        reason: 'unauthorized',
        refererPath,
        durationMs: Date.now() - startedAt,
      });
      return jsonResponse({ error: 'Unauthorized' }, 401, corsHeaders);
    }

    const payload = await readRequestPayload(request);

    if (request.method === 'GET' || !payload) {
      return jsonResponse({
        ok: true,
        service: 'toonparrot-media-ingest',
        bucketUrl: env.PUBLIC_BUCKET_URL || null,
        bucketConfigured: Boolean(env.MEDIA_BUCKET),
      }, 200, corsHeaders);
    }

    const items = payload.items.filter(Boolean);
    if (items.length === 0) {
      reportEvent(env, ctx, 'invalid_request', {
        requestId,
        status: 400,
        refererPath,
        durationMs: Date.now() - startedAt,
      });
      return jsonResponse({ error: 'At least one item is required' }, 400, corsHeaders);
    }

    const results = [];
    for (const item of items) {
      results.push(await processItem(env, item, {
        force: payload.force,
        allowedHosts,
        requestId,
        refererPath,
        ctx,
      }));
    }

    reportEvent(env, ctx, 'batch_complete', {
      requestId,
      itemCount: items.length,
      refererPath,
      durationMs: Date.now() - startedAt,
    });

    return jsonResponse({
      success: true,
      items: results,
    }, 200, corsHeaders);
  },
};
