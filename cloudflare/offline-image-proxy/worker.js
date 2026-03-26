const DEFAULT_ALLOWED_HOSTS = [
  'hayalistic.net',
  'hayalistic.com',
  'webtoonhatti.club',
  'yedek.mangawow.com',
  'kirmizikafa.monster',
];

const DEFAULT_ALLOWED_ORIGINS = [
  'https://toonparrot.vercel.app',
  'http://localhost:8080',
  'http://127.0.0.1:8080',
];

const BROWSER_LIKE_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36';

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

const jsonResponse = (body, status, corsHeaders) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });

const buildCorsHeaders = (request, allowedOrigins) => {
  const origin = request.headers.get('Origin');
  const allowOrigin = origin && allowedOrigins.includes(origin) ? origin : allowedOrigins[0] || '*';

  return {
    'Access-Control-Allow-Origin': allowOrigin,
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
  const quality = parseIntegerWithinRange(transform.quality, 35, 90);
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
  async fetch(request, env) {
    const allowedHosts = new Set(parseCsv(env.ALLOWED_HOSTS, DEFAULT_ALLOWED_HOSTS));
    const allowedOrigins = parseCsv(env.ALLOWED_ORIGINS, DEFAULT_ALLOWED_ORIGINS);
    const corsHeaders = buildCorsHeaders(request, allowedOrigins);
    const requestOrigin = request.headers.get('Origin');
    const refererOrigin = getOriginFromValue(request.headers.get('Referer'));
    const isAllowedOrigin = !!requestOrigin && allowedOrigins.includes(requestOrigin);
    const isAllowedReferer = !!refererOrigin && allowedOrigins.includes(refererOrigin);
    const isTrustedBrowserRequest = isAllowedOrigin || isAllowedReferer;

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    if (!['GET', 'POST'].includes(request.method)) {
      return jsonResponse({ error: 'Method not allowed' }, 405, corsHeaders);
    }

    const expectedToken = env.PROXY_TOKEN?.trim();
    if (requestOrigin && !isAllowedOrigin) {
      return jsonResponse({ error: 'Origin is not allowed' }, 403, corsHeaders);
    }

    if (!requestOrigin && refererOrigin && !isAllowedReferer) {
      return jsonResponse({ error: 'Referer is not allowed' }, 403, corsHeaders);
    }

    if (!isTrustedBrowserRequest && expectedToken) {
      const authHeader = request.headers.get('Authorization') || '';
      const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
      if (bearerToken !== expectedToken) {
        return jsonResponse({ error: 'Unauthorized' }, 401, corsHeaders);
      }
    } else if (!isTrustedBrowserRequest && !expectedToken) {
      return jsonResponse({ error: 'Unauthorized' }, 401, corsHeaders);
    }

    const { sourceUrl, transform } = await readRequestPayload(request);
    if (!sourceUrl || typeof sourceUrl !== 'string') {
      return jsonResponse({ error: 'Valid url is required' }, 400, corsHeaders);
    }

    let parsedUrl;
    try {
      parsedUrl = new URL(sourceUrl);
    } catch {
      return jsonResponse({ error: 'Invalid url' }, 400, corsHeaders);
    }

    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      return jsonResponse({ error: 'Unsupported protocol' }, 400, corsHeaders);
    }

    if (!allowedHosts.has(parsedUrl.hostname.toLowerCase())) {
      return jsonResponse({ error: 'Host is not allowed' }, 403, corsHeaders);
    }

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
      return null;
    });

    if (!upstreamResponse) {
      return jsonResponse({ error: 'Upstream request failed' }, 502, corsHeaders);
    }

    if (!upstreamResponse.ok || !upstreamResponse.body) {
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

    const contentLength = upstreamResponse.headers.get('Content-Length');
    if (contentLength) {
      responseHeaders.set('Content-Length', contentLength);
    }

    return new Response(upstreamResponse.body, {
      status: 200,
      headers: responseHeaders,
    });
  },
};
