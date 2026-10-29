/**
 * toonparrot-scraper-proxy
 * High-performance Scraper & Metadata Proxy for Turkish Scraper Sources and Metadata Providers
 */

const DEFAULT_ALLOWED_HOSTS = [
  'webtoonhatti.club',
  'okutoon.com',
  'om-cdn.okutoon.com',
  'mangacix.net',
  'cdn.mangacix.net',
  'golgebahcesi.com',
  'api.golgebahcesi.com',
  'dxdfansub.com',
  'api.dxdfansub.com',
  'anilist.co',
  'graphql.anilist.co',
  'api.jikan.moe',
  'myanimelist.net',
  'cdn.myanimelist.net',
  'mangaupdates.com',
  'api.mangaupdates.com',
  'www.mangaupdates.com',
  'anime-planet.com',
  'www.anime-planet.com',
  'cdn.anime-planet.com',
  'anisearch.com',
  'www.anisearch.com',
  'cdn.anisearch.com',
  'mangadex.org',
  'api.mangadex.org',
  'fandom.com',
  'siyahmelek.my',
  'www.siyahmelek.my',
  'hentaiturk.com',
  'www.hentaiturk.com',
  'cdn.hentaiturk.com',
  'hattorimanga.net',
  'www.hattorimanga.net',
];

const BROWSER_LIKE_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36';

const FORWARDED_HEADER_ALLOWLIST = new Set([
  'accept',
  'accept-language',
  'cache-control',
  'content-type',
  'authorization',
  'x-e-h',
  'x-requested-with',
  'referer',
  'origin',
]);

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With, X-E-H',
  'Access-Control-Expose-Headers': 'Content-Type, Cache-Control, X-Proxy-Upstream-Status',
  'Access-Control-Max-Age': '86400',
};

const jsonResponse = (body, status = 200, extraHeaders = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      ...CORS_HEADERS,
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...extraHeaders,
    },
  });

const parseCsv = (value, fallback = []) => {
  const parsed = (value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  return parsed.length > 0 ? parsed : fallback;
};

const isPrivateIpOrLocalhost = (hostname) => {
  const host = hostname.toLowerCase();
  if (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '::1' ||
    host === '0.0.0.0' ||
    host.endsWith('.local') ||
    host.endsWith('.internal')
  ) {
    return true;
  }

  const ipv4Regex = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
  const match = host.match(ipv4Regex);
  if (match) {
    const [, a, b] = match.map(Number);
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
  }

  return false;
};

const isAllowedHost = (hostname, allowedHosts) => {
  const normalizedHostname = hostname.toLowerCase();
  return allowedHosts.some((allowedHost) => {
    const normalized = allowedHost.toLowerCase().replace(/^\*\./, '');
    return normalizedHostname === normalized || normalizedHostname.endsWith(`.${normalized}`);
  });
};

const sanitizeUpstreamHeaders = (headers) => {
  const sanitized = new Headers();
  if (!headers || typeof headers !== 'object' || Array.isArray(headers)) {
    return sanitized;
  }

  for (const [key, value] of Object.entries(headers)) {
    const normalizedKey = `${key}`.trim().toLowerCase();
    if (!FORWARDED_HEADER_ALLOWLIST.has(normalizedKey) && !normalizedKey.startsWith('x-')) {
      continue;
    }

    const normalizedValue = typeof value === 'string' ? value.trim() : '';
    if (normalizedValue) {
      sanitized.set(normalizedKey, normalizedValue);
    }
  }

  return sanitized;
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
    if (!textBody) return { sourceUrl: '' };

    try {
      const parsedBody = JSON.parse(textBody);
      return {
        sourceUrl: typeof parsedBody?.url === 'string' ? parsedBody.url : '',
        upstreamMethod: typeof parsedBody?.method === 'string' ? parsedBody.method : 'GET',
        upstreamHeaders: parsedBody?.headers && typeof parsedBody.headers === 'object' ? parsedBody.headers : {},
        upstreamBody: typeof parsedBody?.body === 'string' ? parsedBody.body : parsedBody?.body != null ? JSON.stringify(parsedBody.body) : undefined,
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
    upstreamHeaders: body?.headers && typeof body.headers === 'object' ? body.headers : {},
    upstreamBody: typeof body?.body === 'string' ? body.body : body?.body != null ? JSON.stringify(body.body) : undefined,
  };
};

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const requestUrl = new URL(request.url);
    const pathname = requestUrl.pathname.replace(/\/+$/, '') || '/';

    // Healthcheck
    if (pathname === '/health' && request.method === 'GET') {
      return jsonResponse({
        ok: true,
        service: 'toonparrot-scraper-proxy',
        timestamp: new Date().toISOString(),
      });
    }

    if (!['GET', 'POST'].includes(request.method)) {
      return jsonResponse({ error: 'Method not allowed' }, 405);
    }

    const {
      sourceUrl,
      upstreamMethod,
      upstreamHeaders,
      upstreamBody,
    } = await readRequestPayload(request);

    if (!sourceUrl) {
      return jsonResponse({
        ok: true,
        service: 'toonparrot-scraper-proxy',
        methods: ['GET ?url=', 'POST text/plain', 'POST application/json'],
        allowedHosts: parseCsv(env.ALLOWED_HOSTS, DEFAULT_ALLOWED_HOSTS),
      });
    }

    let currentParsedUrl;
    try {
      currentParsedUrl = new URL(sourceUrl);
    } catch {
      return jsonResponse({ error: 'Invalid url format' }, 400);
    }

    if (!['http:', 'https:'].includes(currentParsedUrl.protocol)) {
      return jsonResponse({ error: 'Unsupported protocol' }, 400);
    }

    const allowedHosts = parseCsv(env.ALLOWED_HOSTS, DEFAULT_ALLOWED_HOSTS);

    const resolvedMethod = ['GET', 'POST', 'PUT'].includes(upstreamMethod?.toUpperCase())
      ? upstreamMethod.toUpperCase()
      : 'GET';

    const shouldSendBody = (resolvedMethod === 'POST' || resolvedMethod === 'PUT') && typeof upstreamBody === 'string';

    // Safe Fetch with SSRF-guarded manual redirect loop (max 3 redirects)
    let upstreamResponse = null;
    const maxRedirects = 3;

    for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount++) {
      // 1. SSRF Guard on each hop
      if (isPrivateIpOrLocalhost(currentParsedUrl.hostname)) {
        return jsonResponse({ error: 'Access to private / local networks is forbidden' }, 403);
      }

      // 2. Allowed Host Check
      if (!isAllowedHost(currentParsedUrl.hostname, allowedHosts)) {
        return jsonResponse({ error: `Host '${currentParsedUrl.hostname}' is not allowed` }, 403);
      }

      const resolvedUpstreamHeaders = new Headers({
        Accept: 'text/html,application/xhtml+xml,application/xml,application/json;q=0.9,*/*;q=0.8',
        'Accept-Language': 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7',
        'User-Agent': BROWSER_LIKE_USER_AGENT,
        Referer: `${currentParsedUrl.origin}/`,
      });

      if (resolvedMethod !== 'GET') {
        resolvedUpstreamHeaders.set('Origin', currentParsedUrl.origin);
      }

      const forwardedHeaders = sanitizeUpstreamHeaders(upstreamHeaders);
      forwardedHeaders.forEach((value, key) => {
        resolvedUpstreamHeaders.set(key, value);
      });

      const resp = await fetch(currentParsedUrl.toString(), {
        method: redirectCount === 0 ? resolvedMethod : 'GET', // Redirects become GET
        headers: resolvedUpstreamHeaders,
        body: redirectCount === 0 && shouldSendBody ? upstreamBody : undefined,
        redirect: 'manual',
        cf: {
          cacheEverything: false,
        },
      }).catch((err) => {
        console.error('Scraper proxy upstream fetch error:', err);
        return null;
      });

      if (!resp) break;

      // Handle 3xx redirect securely
      if ([301, 302, 303, 307, 308].includes(resp.status)) {
        const location = resp.headers.get('Location');
        if (!location) break;

        try {
          currentParsedUrl = new URL(location, currentParsedUrl.toString());
          continue;
        } catch {
          break;
        }
      }

      upstreamResponse = resp;
      break;
    }

    if (!upstreamResponse) {
      return jsonResponse({ error: 'Upstream request failed or invalid redirect' }, 502);
    }

    if (!upstreamResponse.ok || !upstreamResponse.body) {
      return jsonResponse(
        {
          error: `Upstream request failed (${upstreamResponse.status})`,
          upstreamStatus: upstreamResponse.status,
        },
        upstreamResponse.status
      );
    }

    const responseHeaders = new Headers(CORS_HEADERS);
    responseHeaders.set(
      'Content-Type',
      upstreamResponse.headers.get('Content-Type') || 'text/html; charset=utf-8'
    );
    responseHeaders.set('Cache-Control', 'no-store');
    responseHeaders.set('X-Proxy-Upstream-Status', String(upstreamResponse.status));

    return new Response(upstreamResponse.body, {
      status: 200,
      headers: responseHeaders,
    });
  },
};
