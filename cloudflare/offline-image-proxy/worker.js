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

const readTargetUrl = async (request) => {
  if (request.method === 'GET') {
    const requestUrl = new URL(request.url);
    return requestUrl.searchParams.get('url');
  }

  const contentType = (request.headers.get('Content-Type') || '').toLowerCase();
  if (contentType.includes('text/plain')) {
    const textBody = await request.text();
    return textBody.trim();
  }

  const body = await request.json().catch(() => null);
  return body?.url;
};

export default {
  async fetch(request, env) {
    const allowedHosts = new Set(parseCsv(env.ALLOWED_HOSTS, DEFAULT_ALLOWED_HOSTS));
    const allowedOrigins = parseCsv(env.ALLOWED_ORIGINS, DEFAULT_ALLOWED_ORIGINS);
    const corsHeaders = buildCorsHeaders(request, allowedOrigins);
    const requestOrigin = request.headers.get('Origin');
    const isAllowedOrigin = !!requestOrigin && allowedOrigins.includes(requestOrigin);

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

    if (!isAllowedOrigin && expectedToken) {
      const authHeader = request.headers.get('Authorization') || '';
      const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
      if (bearerToken !== expectedToken) {
        return jsonResponse({ error: 'Unauthorized' }, 401, corsHeaders);
      }
    } else if (!isAllowedOrigin && !expectedToken) {
      return jsonResponse({ error: 'Unauthorized' }, 401, corsHeaders);
    }

    const sourceUrl = await readTargetUrl(request);
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
      upstreamResponse.headers.get('Cache-Control') || 'public, max-age=3600',
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
