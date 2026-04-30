const DEFAULT_ALLOWED_HOSTS = [
  'cdn.anime-planet.com',
  'anime-planet.com',
  'www.anime-planet.com',
  'hayalistic.net',
  'hayalistic.com',
  'webtoonhatti.club',
  'webtoonhatti.me',
  'webtoon-oku.net',
  'cdn-2.webtoon-oku.net',
  'siyahmelek.mom',
  's3.melek.lol',
  'yedek.mangawow.com',
  'kirmizikafa.monster',
];

const DEFAULT_ALLOWED_ORIGINS = [
  'https://toonparrot.vercel.app',
  'http://localhost:*',
  'http://127.0.0.1:*',
];

const BROWSER_LIKE_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36';

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

const parseCsv = (value, fallback = []) =>
  (value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .length > 0
    ? (value || '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
    : fallback;

const normalizeHostRule = (value) => value.trim().toLowerCase().replace(/^\*\./, '');

const isAllowedHost = (hostname, allowedHosts) => {
  const normalizedHostname = hostname.trim().toLowerCase();

  return allowedHosts.some((value) => {
    const normalizedRule = normalizeHostRule(value);
    if (!normalizedRule) {
      return false;
    }

    return (
      normalizedHostname === normalizedRule
      || normalizedHostname.endsWith(`.${normalizedRule}`)
    );
  });
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

const logProxyEvent = (event, payload) => {
  console.log(JSON.stringify({
    service: 'offline-image-proxy',
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
        service: 'offline-image-proxy',
        event,
        createdAt: new Date().toISOString(),
        ...payload,
      }),
    }).catch((error) => {
      console.error('offline-image-proxy metric enqueue failed', error);
    }),
  );
};

const reportProxyEvent = (env, ctx, event, payload) => {
  logProxyEvent(event, payload);
  queueMetric(env, ctx, event, payload);
};

const buildCorsHeaders = (allowedOrigin) => {
  if (!allowedOrigin) {
    return {
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Expose-Headers': 'Content-Type, Content-Length, Cache-Control, X-Proxy-Upstream-Status',
      Vary: 'Origin',
    };
  }

  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Expose-Headers': 'Content-Type, Content-Length, Cache-Control, X-Proxy-Upstream-Status',
    Vary: 'Origin',
  };
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

const getHostnameFromValue = (value) => {
  if (!value) {
    return null;
  }

  try {
    return new URL(value).hostname.trim().toLowerCase();
  } catch {
    return null;
  }
};

const getAllowedHosts = (env) => {
  const allowedHosts = parseCsv(env.ALLOWED_HOSTS, DEFAULT_ALLOWED_HOSTS);
  const publicBucketHost = getHostnameFromValue(env.PUBLIC_BUCKET_URL);

  if (!publicBucketHost || allowedHosts.includes(publicBucketHost)) {
    return allowedHosts;
  }

  return [...allowedHosts, publicBucketHost];
};

const clampInteger = (value, min, max) => Math.min(max, Math.max(min, Math.round(value)));

const parseIntegerWithinRange = (value, min, max) => {
  if (value === null || value === undefined || value === '') {
    return undefined;
  }

  const parsedValue = Number(value);
  if (!Number.isFinite(parsedValue)) {
    return undefined;
  }

  return clampInteger(parsedValue, min, max);
};

const normalizeTransform = (transform) => {
  if (!transform || typeof transform !== 'object') {
    return null;
  }

  const width = parseIntegerWithinRange(transform.width, 64, 1600);
  const quality = parseIntegerWithinRange(transform.quality, 35, 95);
  const format = ['webp', 'avif', 'jpeg', 'png'].includes(transform.format) ? transform.format : undefined;
  const fit = ['scale-down', 'contain', 'cover'].includes(transform.fit) ? transform.fit : undefined;

  if (!width && !quality && !format && !fit) {
    return null;
  }

  return {
    ...(width ? { width } : {}),
    ...(quality ? { quality } : {}),
    ...(format ? { format } : {}),
    ...(fit ? { fit } : {}),
  };
};

const readTransformFromSearchParams = (searchParams) =>
  normalizeTransform({
    width: searchParams.get('width'),
    quality: searchParams.get('quality'),
    format: searchParams.get('format'),
    fit: searchParams.get('fit'),
  });

const readRequestPayload = async (request) => {
  const requestUrl = new URL(request.url);

  if (request.method === 'GET') {
    return {
      sourceUrl: requestUrl.searchParams.get('url'),
      transform: readTransformFromSearchParams(requestUrl.searchParams),
    };
  }

  const searchTransform = readTransformFromSearchParams(requestUrl.searchParams);
  const contentType = (request.headers.get('Content-Type') || '').toLowerCase();

  if (contentType.includes('text/plain')) {
    const textBody = (await request.text()).trim();
    if (!textBody) {
      return { sourceUrl: '', transform: searchTransform };
    }

    try {
      const parsedBody = JSON.parse(textBody);
      return {
        sourceUrl: typeof parsedBody?.url === 'string' ? parsedBody.url : '',
        transform: normalizeTransform(parsedBody?.transform) || searchTransform,
      };
    } catch {
      return { sourceUrl: textBody, transform: searchTransform };
    }
  }

  const body = await request.json().catch(() => null);
  return {
    sourceUrl: typeof body?.url === 'string' ? body.url : '',
    transform: normalizeTransform(body?.transform) || searchTransform,
  };
};

export default {
  async fetch(request, env, ctx) {
    const startedAt = Date.now();
    const requestId = getRequestId(request);
    const allowedHosts = getAllowedHosts(env);
    const allowedOriginPatterns = parseCsv(env.ALLOWED_ORIGINS, DEFAULT_ALLOWED_ORIGINS);
    const allowedOrigin = resolveAllowedOrigin(request, allowedOriginPatterns);
    const corsHeaders = buildCorsHeaders(allowedOrigin);
    const requestOrigin = request.headers.get('Origin');
    const refererOrigin = getOriginFromValue(request.headers.get('Referer'));
    const isAllowedOrigin = Boolean(allowedOrigin);
    const isAllowedReferer = refererOrigin
      ? allowedOriginPatterns.some((pattern) => matchesOriginPattern(refererOrigin, pattern))
      : false;
    const isTrustedBrowserRequest = isAllowedOrigin || isAllowedReferer;

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
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

    const expectedToken = env.PROXY_TOKEN?.trim();
    if (requestOrigin && !isAllowedOrigin) {
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

    if (!isTrustedBrowserRequest && expectedToken) {
      const authHeader = request.headers.get('Authorization') || '';
      const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
      if (bearerToken !== expectedToken) {
        reportProxyEvent(env, ctx, 'blocked', {
          requestId,
          reason: 'unauthorized',
          status: 401,
          method: request.method,
          refererPath: getRefererPath(request),
        });
        return jsonResponse({ error: 'Unauthorized' }, 401, corsHeaders);
      }
    } else if (!isTrustedBrowserRequest && !expectedToken) {
      reportProxyEvent(env, ctx, 'blocked', {
        requestId,
        reason: 'unauthorized',
        status: 401,
        method: request.method,
        refererPath: getRefererPath(request),
      });
      return jsonResponse({ error: 'Unauthorized' }, 401, corsHeaders);
    }

    const { sourceUrl, transform } = await readRequestPayload(request);
    if (!sourceUrl || typeof sourceUrl !== 'string') {
      reportProxyEvent(env, ctx, 'invalid_request', {
        requestId,
        reason: 'missing_url',
        status: 400,
        method: request.method,
        refererPath: getRefererPath(request),
      });
      return jsonResponse({ error: 'Valid url is required' }, 400, corsHeaders);
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
        sourceHost: parsedUrl.hostname,
        sourceUrl,
        refererPath: getRefererPath(request),
      });
      return jsonResponse({ error: 'Host is not allowed' }, 403, corsHeaders);
    }

    const requestUrl = new URL(request.url);
    const purpose = requestUrl.searchParams.get('purpose') || null;
    const entityType = requestUrl.searchParams.get('entityType') || null;
    const surface = requestUrl.searchParams.get('surface') || null;

    const upstreamHeaders = new Headers({
      Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
      'User-Agent': BROWSER_LIKE_USER_AGENT,
      Referer: `${parsedUrl.origin}/`,
    });

    const upstreamResponse = await fetch(parsedUrl.toString(), {
      method: 'GET',
      headers: upstreamHeaders,
      redirect: 'follow',
      cf: {
        cacheEverything: false,
        ...(transform ? { image: transform } : {}),
      },
    }).catch((error) => {
      console.error('Upstream request failed', error);
      reportProxyEvent(env, ctx, 'upstream_failure', {
        requestId,
        sourceHost: parsedUrl.hostname,
        sourceUrl: parsedUrl.toString(),
        purpose,
        entityType,
        surface,
        transform,
        refererPath: getRefererPath(request),
        durationMs: Date.now() - startedAt,
      });
      return null;
    });

    if (!upstreamResponse) {
      return jsonResponse({ error: 'Upstream request failed' }, 502, corsHeaders);
    }

    if (!upstreamResponse.ok || !upstreamResponse.body) {
      reportProxyEvent(env, ctx, 'upstream_response', {
        requestId,
        sourceHost: parsedUrl.hostname,
        sourceUrl: parsedUrl.toString(),
        purpose,
        entityType,
        surface,
        transform,
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
      upstreamResponse.headers.get('Content-Type') || 'application/octet-stream',
    );
    responseHeaders.set(
      'Cache-Control',
      transform
        ? 'public, max-age=86400, stale-while-revalidate=604800'
        : upstreamResponse.headers.get('Cache-Control') || 'public, max-age=3600',
    );
    responseHeaders.set('X-Proxy-Upstream-Status', String(upstreamResponse.status));
    responseHeaders.set('X-Proxy-Source-Host', parsedUrl.hostname);

    const contentLength = upstreamResponse.headers.get('Content-Length');
    if (contentLength) {
      responseHeaders.set('Content-Length', contentLength);
    }

    reportProxyEvent(env, ctx, 'success', {
      requestId,
      sourceHost: parsedUrl.hostname,
      sourceUrl: parsedUrl.toString(),
      purpose,
      entityType,
      surface,
      transform,
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
