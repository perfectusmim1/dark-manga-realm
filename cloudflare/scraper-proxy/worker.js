const DEFAULT_ALLOWED_HOSTS = [
  'hayalistic.net',
  'hayalistic.com',
  'webtoonhatti.club',
  'yedek.mangawow.com',
  'kirmizikafa.monster',
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
      };
    } catch {
      return { sourceUrl: textBody };
    }
  }

  const body = await request.json().catch(() => null);
  return {
    sourceUrl: typeof body?.url === 'string' ? body.url : '',
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

    const { sourceUrl } = await readRequestPayload(request);

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

    const upstreamHeaders = new Headers({
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7',
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
