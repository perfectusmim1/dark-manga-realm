const DEFAULT_ALLOWED_HOSTS = [
  'hayalistic.net',
  'hayalistic.com',
  'webtoonhatti.club',
  'siyahmelek.mom',
  'yedek.mangawow.com',
  'kirmizikafa.monster',
  'myanimelist.net',
  'cdn.myanimelist.net',
  'mangaupdates.com',
  'api.mangaupdates.com',
  'anilist.co',
  'graphql.anilist.co',
  'api.jikan.moe',
  'anime-planet.com',
  'www.anime-planet.com',
  'anisearch.com',
  'www.anisearch.com',
  'cdn.anisearch.com',
];

const DEFAULT_ALLOWED_ORIGINS = [
  'https://toonparrot.vercel.app',
  'https://*.vercel.app',
  'http://localhost:*',
  'http://127.0.0.1:*',
];

const BROWSER_LIKE_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36';

const FORWARDED_HEADER_ALLOWLIST = new Set([
  'accept',
  'accept-language',
  'authorization',
  'cache-control',
  'content-type',
]);

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

  const isAllowed = allowedOriginPatterns.some((pattern) => matchesOriginPattern(requestOrigin, pattern));
  return isAllowed ? requestOrigin : null;
};

const buildCorsHeaders = (allowedOrigin) => {
  if (!allowedOrigin) {
    return {
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Expose-Headers': 'Content-Type, Cache-Control, X-Proxy-Upstream-Status',
      Vary: 'Origin',
    };
  }

  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Expose-Headers': 'Content-Type, Cache-Control, X-Proxy-Upstream-Status',
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

const detectSourceName = (hostname) => {
  const normalizedHostname = `${hostname || ''}`.toLowerCase();

  if (normalizedHostname.endsWith('myanimelist.net')) return 'myanimelist';
  if (normalizedHostname.endsWith('anime-planet.com')) return 'animeplanet';
  if (normalizedHostname.endsWith('mangaupdates.com')) return 'mangaupdates';
  if (normalizedHostname.endsWith('anisearch.com')) return 'anisearch';
  if (normalizedHostname === 'anilist.co' || normalizedHostname === 'graphql.anilist.co') return 'anilist';
  if (normalizedHostname === 'api.jikan.moe') return 'jikan';

  return normalizedHostname || 'unknown';
};

const detectOperation = (url) => {
  const hostname = `${url.hostname || ''}`.toLowerCase();
  const pathname = `${url.pathname || ''}`.toLowerCase();

  if (hostname.endsWith('myanimelist.net')) {
    if (pathname === '/manga.php') return 'search';
    if (/^\/manga\/\d+\/?[^/]*\/characters\/?$/.test(pathname)) return 'characters';
    if (/^\/manga\/\d+\/?[^/]*\/pics\/?$/.test(pathname)) return 'gallery';
    if (/^\/manga\/\d+/.test(pathname)) return 'manga_detail';
    if (/^\/character\/\d+\/?[^/]*\/pics\/?$/.test(pathname)) return 'character_gallery';
    if (/^\/character\/\d+/.test(pathname)) return 'character_detail';
    if (/^\/people\/\d+\/?[^/]*\/pics\/?$/.test(pathname)) return 'person_gallery';
    if (/^\/people\/\d+/.test(pathname)) return 'person_detail';
  }

  if (hostname.endsWith('anime-planet.com')) {
    if (pathname === '/manga/all') return 'search';
    if (/^\/manga\/[^/]+\/characters\/?$/.test(pathname)) return 'characters';
    if (/^\/manga\/[^/]+\/staff\/?$/.test(pathname)) return 'staff';
    if (/^\/manga\/[^/]+\/?$/.test(pathname)) return 'manga_detail';
    if (/^\/people\/[^/]+\/?$/.test(pathname)) return 'person_detail';
    if (/^\/characters\/[^/]+\/?$/.test(pathname)) return 'character_detail';
  }

  if (hostname.endsWith('mangaupdates.com')) {
    if (pathname.includes('/site/search/result')) return 'search';
    if (/^\/series\/[^/]+\/?$/.test(pathname)) return 'manga_detail';
    if (/^\/author\/[^/]+\/?$/.test(pathname)) return 'person_detail';
  }

  if (hostname.endsWith('anisearch.com')) {
    if (pathname === '/sitemap.xml' || /\/manga_\(\d+\)\.xml\.gz$/i.test(pathname)) return 'search';
    if (/^\/manga\/\d+,?[^/]*\/characters\/?$/.test(pathname)) return 'characters';
    if (/^\/manga\/\d+,?[^/]*\/relations\/?$/.test(pathname)) return 'relations';
    if (/^\/manga\/\d+,?[^/]*\/?$/.test(pathname)) return 'manga_detail';
    if (/^\/person\/\d+,?[^/]*\/?$/.test(pathname)) return 'person_detail';
    if (/^\/character\/\d+,?[^/]*\/?$/.test(pathname)) return 'character_detail';
  }

  if (hostname === 'anilist.co' || hostname === 'graphql.anilist.co') {
    if (pathname.startsWith('/search/manga')) return 'search';
    if (/^\/manga\/\d+/.test(pathname)) return pathname.endsWith('/characters') ? 'characters' : pathname.endsWith('/staff') ? 'staff' : 'manga_detail';
    if (/^\/character\/\d+/.test(pathname)) return 'character_detail';
    if (pathname === '/') return 'graphql';
  }

  if (hostname === 'api.jikan.moe') {
    if (pathname.includes('/characters')) return 'characters';
    if (pathname.includes('/people')) return 'person_detail';
    if (pathname.includes('/manga')) return 'manga_detail';
  }

  return 'fetch';
};

const logProxyEvent = (event, payload) => {
  console.log(JSON.stringify({
    service: 'scraper-proxy',
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
        service: 'scraper-proxy',
        event,
        createdAt: new Date().toISOString(),
        ...payload,
      }),
    }).catch((error) => {
      console.error('scraper-proxy metric enqueue failed', error);
    }),
  );
};

const reportProxyEvent = (env, ctx, event, payload) => {
  logProxyEvent(event, payload);
  queueMetric(env, ctx, event, payload);
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

const readRequestPayload = async (request) => {
  const requestUrl = new URL(request.url);

  if (request.method === 'GET') {
    return {
      sourceUrl: requestUrl.searchParams.get('url'),
      upstreamMethod: 'GET',
      upstreamHeaders: {},
      upstreamBody: undefined,
    };
  }

  const contentType = (request.headers.get('Content-Type') || '').toLowerCase();

  if (contentType.includes('text/plain')) {
    const textBody = (await request.text()).trim();
    if (!textBody) {
      return { sourceUrl: '' };
    }

    try {
      const parsedBody = JSON.parse(textBody);
      return {
        sourceUrl: typeof parsedBody?.url === 'string' ? parsedBody.url : '',
        upstreamMethod: typeof parsedBody?.method === 'string' ? parsedBody.method : 'GET',
        upstreamHeaders: parsedBody?.headers && typeof parsedBody.headers === 'object'
          ? parsedBody.headers
          : {},
        upstreamBody: typeof parsedBody?.body === 'string'
          ? parsedBody.body
          : parsedBody?.body != null
            ? JSON.stringify(parsedBody.body)
            : undefined,
      };
    } catch {
      return {
        sourceUrl: textBody,
        upstreamMethod: 'GET',
        upstreamHeaders: {},
        upstreamBody: undefined,
      };
    }
  }

  const body = await request.json().catch(() => null);
  return {
    sourceUrl: typeof body?.url === 'string' ? body.url : '',
    upstreamMethod: typeof body?.method === 'string' ? body.method : 'GET',
    upstreamHeaders: body?.headers && typeof body.headers === 'object'
      ? body.headers
      : {},
    upstreamBody: typeof body?.body === 'string'
      ? body.body
      : body?.body != null
        ? JSON.stringify(body.body)
        : undefined,
  };
};

const isAllowedHost = (hostname, allowedHosts) => {
  const normalizedHostname = hostname.toLowerCase();

  return allowedHosts.some((allowedHost) => {
    const normalizedAllowedHost = allowedHost.toLowerCase();
    return (
      normalizedHostname === normalizedAllowedHost ||
      normalizedHostname.endsWith(`.${normalizedAllowedHost}`)
    );
  });
};

const sanitizeUpstreamMethod = (method) => {
  const normalizedMethod = `${method || 'GET'}`.trim().toUpperCase();
  return ['GET', 'POST'].includes(normalizedMethod) ? normalizedMethod : null;
};

const sanitizeUpstreamHeaders = (headers) => {
  const sanitized = new Headers();

  if (!headers || typeof headers !== 'object' || Array.isArray(headers)) {
    return sanitized;
  }

  for (const [key, value] of Object.entries(headers)) {
    const normalizedKey = `${key}`.trim().toLowerCase();
    if (!FORWARDED_HEADER_ALLOWLIST.has(normalizedKey)) {
      continue;
    }

    const normalizedValue = typeof value === 'string' ? value.trim() : '';
    if (!normalizedValue) {
      continue;
    }

    sanitized.set(normalizedKey, normalizedValue);
  }

  return sanitized;
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

    if (request.method === 'OPTIONS') {
      if (requestOrigin && !allowedOrigin) {
        reportProxyEvent(env, ctx, 'blocked', {
          requestId,
          reason: 'origin_not_allowed',
          status: 403,
          method: request.method,
          refererPath: getRefererPath(request),
        });
        return jsonResponse({ error: 'Origin is not allowed' }, 403, corsHeaders);
      }

      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (!['GET', 'POST'].includes(request.method)) {
      reportProxyEvent(env, ctx, 'blocked', {
        requestId,
        reason: 'method_not_allowed',
        status: 405,
        method: request.method,
        refererPath: getRefererPath(request),
      });
      return jsonResponse({ error: 'Method not allowed' }, 405, corsHeaders);
    }

    const {
      sourceUrl,
      upstreamMethod,
      upstreamHeaders,
      upstreamBody,
    } = await readRequestPayload(request);

    if (!sourceUrl) {
      reportProxyEvent(env, ctx, 'healthcheck', {
        requestId,
        status: 200,
        method: request.method,
        refererPath: getRefererPath(request),
      });
      return jsonResponse(
        {
          ok: true,
          service: 'toonparrot-scraper-proxy',
          methods: ['GET ?url=', 'POST text/plain', 'POST application/json'],
          allowedHosts,
        },
        200,
        corsHeaders,
      );
    }

    const expectedToken = env.PROXY_TOKEN?.trim();
    const isTrustedBrowserRequest = !!allowedOrigin || !!isAllowedReferer;

    if (requestOrigin && !allowedOrigin) {
      reportProxyEvent(env, ctx, 'blocked', {
        requestId,
        reason: 'origin_not_allowed',
        status: 403,
        method: request.method,
        refererPath: getRefererPath(request),
      });
      return jsonResponse({ error: 'Origin is not allowed' }, 403, corsHeaders);
    }

    if (!requestOrigin && refererOrigin && !isAllowedReferer) {
      reportProxyEvent(env, ctx, 'blocked', {
        requestId,
        reason: 'referer_not_allowed',
        status: 403,
        method: request.method,
        refererPath: getRefererPath(request),
      });
      return jsonResponse({ error: 'Referer is not allowed' }, 403, corsHeaders);
    }

    if (!isTrustedBrowserRequest) {
      const authHeader = request.headers.get('Authorization') || '';
      const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';

      if (!expectedToken || bearerToken !== expectedToken) {
        reportProxyEvent(env, ctx, 'blocked', {
          requestId,
          reason: 'unauthorized',
          status: 401,
          method: request.method,
          refererPath: getRefererPath(request),
        });
        return jsonResponse({ error: 'Unauthorized' }, 401, corsHeaders);
      }
    }

    let parsedUrl;
    try {
      parsedUrl = new URL(sourceUrl);
    } catch {
      reportProxyEvent(env, ctx, 'invalid_request', {
        requestId,
        reason: 'invalid_url',
        status: 400,
        method: request.method,
        sourceUrl,
        refererPath: getRefererPath(request),
      });
      return jsonResponse({ error: 'Invalid url' }, 400, corsHeaders);
    }

    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      reportProxyEvent(env, ctx, 'invalid_request', {
        requestId,
        reason: 'unsupported_protocol',
        status: 400,
        method: request.method,
        sourceUrl,
        refererPath: getRefererPath(request),
      });
      return jsonResponse({ error: 'Unsupported protocol' }, 400, corsHeaders);
    }

    if (!isAllowedHost(parsedUrl.hostname, allowedHosts)) {
      reportProxyEvent(env, ctx, 'blocked', {
        requestId,
        reason: 'host_not_allowed',
        status: 403,
        method: request.method,
        sourceUrl,
        sourceHost: parsedUrl.hostname,
        refererPath: getRefererPath(request),
      });
      return jsonResponse({ error: 'Host is not allowed' }, 403, corsHeaders);
    }

    const resolvedMethod = sanitizeUpstreamMethod(upstreamMethod);
    if (!resolvedMethod) {
      reportProxyEvent(env, ctx, 'invalid_request', {
        requestId,
        reason: 'unsupported_upstream_method',
        status: 400,
        method: request.method,
        sourceUrl,
        refererPath: getRefererPath(request),
      });
      return jsonResponse({ error: 'Unsupported upstream method' }, 400, corsHeaders);
    }

    const sourceName = detectSourceName(parsedUrl.hostname);
    const operation = detectOperation(parsedUrl);

    const resolvedUpstreamHeaders = new Headers({
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7',
      'User-Agent': BROWSER_LIKE_USER_AGENT,
      Referer: `${parsedUrl.origin}/`,
    });

    if (resolvedMethod !== 'GET') {
      resolvedUpstreamHeaders.set('Origin', parsedUrl.origin);
    }

    const forwardedHeaders = sanitizeUpstreamHeaders(upstreamHeaders);
    forwardedHeaders.forEach((value, key) => {
      resolvedUpstreamHeaders.set(key, value);
    });

    const shouldSendBody = resolvedMethod === 'POST' && typeof upstreamBody === 'string';
    const performUpstreamFetch = async (headers, attempt = 1) => fetch(parsedUrl.toString(), {
      method: resolvedMethod,
      headers,
      body: shouldSendBody ? upstreamBody : undefined,
      redirect: 'follow',
      cf: {
        cacheEverything: false,
      },
    }).catch((error) => {
      console.error('Upstream request failed', error);
      reportProxyEvent(env, ctx, 'upstream_failure', {
        requestId,
        sourceName,
        operation,
        sourceHost: parsedUrl.hostname,
        sourceUrl: parsedUrl.toString(),
        method: resolvedMethod,
        attempt,
        refererPath: getRefererPath(request),
        durationMs: Date.now() - startedAt,
      });
      return null;
    });

    let upstreamResponse = await performUpstreamFetch(resolvedUpstreamHeaders);

    if (
      upstreamResponse?.status === 403
      && sourceName === 'mangaupdates'
      && resolvedMethod === 'GET'
    ) {
      const retryHeaders = new Headers(resolvedUpstreamHeaders);
      retryHeaders.delete('Referer');
      retryHeaders.delete('Origin');
      retryHeaders.set('Accept-Language', 'en-US,en;q=0.9');
      retryHeaders.set('Cache-Control', 'no-cache');

      reportProxyEvent(env, ctx, 'upstream_retry', {
        requestId,
        sourceName,
        operation,
        sourceHost: parsedUrl.hostname,
        sourceUrl: parsedUrl.toString(),
        method: resolvedMethod,
        retryReason: 'mangaupdates_403_relaxed_headers',
        refererPath: getRefererPath(request),
        durationMs: Date.now() - startedAt,
      });

      const retriedResponse = await performUpstreamFetch(retryHeaders, 2);
      if (retriedResponse) {
        upstreamResponse = retriedResponse;
      }
    }

    if (!upstreamResponse) {
      return jsonResponse({ error: 'Upstream request failed' }, 502, corsHeaders);
    }

    if (!upstreamResponse.ok || !upstreamResponse.body) {
      reportProxyEvent(env, ctx, 'upstream_response', {
        requestId,
        sourceName,
        operation,
        sourceHost: parsedUrl.hostname,
        sourceUrl: parsedUrl.toString(),
        method: resolvedMethod,
        status: upstreamResponse.status,
        result: upstreamResponse.ok ? 'empty_body' : 'error',
        refererPath: getRefererPath(request),
        durationMs: Date.now() - startedAt,
      });
      return jsonResponse(
        {
          error: `Upstream request failed (${upstreamResponse.status})`,
          upstreamStatus: upstreamResponse.status,
        },
        upstreamResponse.status,
        corsHeaders,
      );
    }

    const responseHeaders = new Headers(corsHeaders);
    responseHeaders.set(
      'Content-Type',
      upstreamResponse.headers.get('Content-Type') || 'text/html; charset=utf-8',
    );
    responseHeaders.set('Cache-Control', 'no-store');
    responseHeaders.set('X-Proxy-Upstream-Status', String(upstreamResponse.status));
    responseHeaders.set('X-Proxy-Source', sourceName);
    responseHeaders.set('X-Proxy-Operation', operation);

    reportProxyEvent(env, ctx, 'success', {
      requestId,
      sourceName,
      operation,
      sourceHost: parsedUrl.hostname,
      sourceUrl: parsedUrl.toString(),
      method: resolvedMethod,
      status: upstreamResponse.status,
      refererPath: getRefererPath(request),
      durationMs: Date.now() - startedAt,
    });

    return new Response(upstreamResponse.body, {
      status: 200,
      headers: responseHeaders,
    });
  },
};
