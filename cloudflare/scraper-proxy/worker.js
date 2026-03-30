const DEFAULT_ALLOWED_HOSTS = [
  'hayalistic.net',
  'hayalistic.com',
  'webtoonhatti.club',
  'yedek.mangawow.com',
  'kirmizikafa.monster',
  'myanimelist.net',
  'cdn.myanimelist.net',
  'mangaupdates.com',
  'api.mangaupdates.com',
  'anilist.co',
  'graphql.anilist.co',
  'api.jikan.moe',
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

const escapeRegex = (value) => value.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');

const patternToRegex = (pattern) => {
  const escaped = escapeRegex(pattern).replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`);
};

const matchesOriginPattern = (origin, pattern) => {
  if (!origin || !pattern) {
    return false;
  }

  return patternToRegex(pattern).test(origin);
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
  async fetch(request, env) {
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
        return jsonResponse({ error: 'Origin is not allowed' }, 403, corsHeaders);
      }

      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (!['GET', 'POST'].includes(request.method)) {
      return jsonResponse({ error: 'Method not allowed' }, 405, corsHeaders);
    }

    const {
      sourceUrl,
      upstreamMethod,
      upstreamHeaders,
      upstreamBody,
    } = await readRequestPayload(request);

    if (!sourceUrl) {
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
      return jsonResponse({ error: 'Origin is not allowed' }, 403, corsHeaders);
    }

    if (!requestOrigin && refererOrigin && !isAllowedReferer) {
      return jsonResponse({ error: 'Referer is not allowed' }, 403, corsHeaders);
    }

    if (!isTrustedBrowserRequest) {
      const authHeader = request.headers.get('Authorization') || '';
      const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';

      if (!expectedToken || bearerToken !== expectedToken) {
        return jsonResponse({ error: 'Unauthorized' }, 401, corsHeaders);
      }
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

    if (!isAllowedHost(parsedUrl.hostname, allowedHosts)) {
      return jsonResponse({ error: 'Host is not allowed' }, 403, corsHeaders);
    }

    const resolvedMethod = sanitizeUpstreamMethod(upstreamMethod);
    if (!resolvedMethod) {
      return jsonResponse({ error: 'Unsupported upstream method' }, 400, corsHeaders);
    }

    const resolvedUpstreamHeaders = new Headers({
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7',
      'User-Agent': BROWSER_LIKE_USER_AGENT,
      Referer: `${parsedUrl.origin}/`,
      Origin: parsedUrl.origin,
    });

    const forwardedHeaders = sanitizeUpstreamHeaders(upstreamHeaders);
    forwardedHeaders.forEach((value, key) => {
      resolvedUpstreamHeaders.set(key, value);
    });

    const shouldSendBody = resolvedMethod === 'POST' && typeof upstreamBody === 'string';

    const upstreamResponse = await fetch(parsedUrl.toString(), {
      method: resolvedMethod,
      headers: resolvedUpstreamHeaders,
      body: shouldSendBody ? upstreamBody : undefined,
      redirect: 'follow',
      cf: {
        cacheEverything: false,
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
      upstreamResponse.headers.get('Content-Type') || 'text/html; charset=utf-8',
    );
    responseHeaders.set('Cache-Control', 'no-store');
    responseHeaders.set('X-Proxy-Upstream-Status', String(upstreamResponse.status));

    return new Response(upstreamResponse.body, {
      status: 200,
      headers: responseHeaders,
    });
  },
};
