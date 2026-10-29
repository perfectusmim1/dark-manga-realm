/**
 * toonparrot-offline-image-proxy
 * High-performance Image Proxy for Online Reader, Covers & Offline Downloads
 */

const DEFAULT_ALLOWED_HOSTS = [
  'webtoonhatti.club',
  'okutoon.com',
  'om-cdn.okutoon.com',
  'mangacix.net',
  'cdn.mangacix.net',
  'image.tmdb.org',
  'golgebahcesi.com',
  'api.golgebahcesi.com',
  'dxdfansub.com',
  'api.dxdfansub.com',
  'anilist.co',
  's4.anilist.co',
  'myanimelist.net',
  'cdn.myanimelist.net',
  'mangadex.org',
  'uploads.mangadex.org',
  'anime-planet.com',
  'cdn.anime-planet.com',
  'anisearch.com',
  'www.anisearch.com',
  'mangaupdates.com',
  'cdn.mangaupdates.com',
  'imgur.com',
  'i.imgur.com',
  'wp.com',
  'i0.wp.com',
  'i1.wp.com',
  'i2.wp.com',
  'i3.wp.com',
  'blogspot.com',
  'googleusercontent.com',
  'r2.dev',
  'cloudflarestorage.com',
  'siyahmelek.my',
  'www.siyahmelek.my',
  'siyahmelek.mom',
  'hentaiturk.com',
  'www.hentaiturk.com',
  'cdn.hentaiturk.com',
  'hattorimanga.net',
  'www.hattorimanga.net',
];

const BROWSER_LIKE_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
  'Access-Control-Expose-Headers': 'Content-Type, Content-Length, Cache-Control, X-Proxy-Upstream-Status',
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

  // IPv4 Private Ranges (10.x, 192.168.x, 169.254.x, 172.16-31.x)
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
  const normalizedHostname = hostname.trim().toLowerCase();
  return allowedHosts.some((value) => {
    const normalizedRule = value.trim().toLowerCase().replace(/^\*\./, '');
    if (!normalizedRule) return false;
    return (
      normalizedHostname === normalizedRule ||
      normalizedHostname.endsWith(`.${normalizedRule}`)
    );
  });
};

const resolveRefererForHost = (url, explicitReferer) => {
  if (explicitReferer && typeof explicitReferer === 'string' && explicitReferer.startsWith('http')) {
    return explicitReferer;
  }

  const hostname = url.hostname.toLowerCase();
  if (hostname.includes('okutoon.com')) return 'https://okutoon.com/';
  if (hostname.includes('mangacix.net')) return 'https://mangacix.net/';
  if (hostname.includes('webtoonhatti.club')) return 'https://webtoonhatti.club/';
  if (hostname.includes('golgebahcesi.com')) return 'https://golgebahcesi.com/';
  if (hostname.includes('dxdfansub.com')) return 'https://dxdfansub.com/';
  if (hostname.includes('siyahmelek')) return 'https://siyahmelek.mom/';
  if (hostname.includes('hentaiturk')) return 'https://hentaiturk.com/';
  if (hostname.includes('hattorimanga')) return 'https://hattorimanga.net/';
  if (hostname.includes('anilist.co')) return 'https://anilist.co/';
  if (hostname.includes('myanimelist.net')) return 'https://myanimelist.net/';
  if (hostname.includes('mangadex.org')) return 'https://mangadex.org/';
  if (hostname.includes('anime-planet.com')) return 'https://www.anime-planet.com/';
  if (hostname.includes('anisearch.com')) return 'https://www.anisearch.com/';
  if (hostname.includes('mangaupdates.com')) return 'https://www.mangaupdates.com/';

  return `${url.origin}/`;
};

const readPayload = async (request) => {
  const requestUrl = new URL(request.url);

  if (request.method === 'GET') {
    return {
      sourceUrl: requestUrl.searchParams.get('url'),
      referer: requestUrl.searchParams.get('referer'),
    };
  }

  const contentType = (request.headers.get('Content-Type') || '').toLowerCase();
  if (contentType.includes('text/plain')) {
    const text = (await request.text()).trim();
    if (!text) return { sourceUrl: '' };
    try {
      const parsed = JSON.parse(text);
      return {
        sourceUrl: parsed?.url || '',
        referer: parsed?.referer || '',
      };
    } catch {
      return { sourceUrl: text, referer: '' };
    }
  }

  const body = await request.json().catch(() => null);
  return {
    sourceUrl: typeof body?.url === 'string' ? body.url : '',
    referer: typeof body?.referer === 'string' ? body.referer : '',
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
        service: 'toonparrot-offline-image-proxy',
        timestamp: new Date().toISOString(),
      });
    }

    if (!['GET', 'POST'].includes(request.method)) {
      return jsonResponse({ error: 'Method not allowed' }, 405);
    }

    const { sourceUrl, referer } = await readPayload(request);
    if (!sourceUrl || typeof sourceUrl !== 'string') {
      return jsonResponse({
        ok: true,
        service: 'toonparrot-offline-image-proxy',
        usage: 'GET /?url=<url>&referer=<optional> or POST { url, referer }',
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

    // Safe Fetch with SSRF-guarded manual redirect loop (max 3 redirects)
    let upstreamResponse = null;
    const maxRedirects = 3;

    for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount++) {
      // 1. SSRF Guard on each hop
      if (isPrivateIpOrLocalhost(currentParsedUrl.hostname)) {
        return jsonResponse({ error: 'Access to private / local networks is forbidden' }, 403);
      }

      // 2. Strict Host Whitelist (No extension-based bypass)
      if (!isAllowedHost(currentParsedUrl.hostname, allowedHosts)) {
        return jsonResponse({ error: `Host '${currentParsedUrl.hostname}' is not allowed` }, 403);
      }

      const targetReferer = resolveRefererForHost(currentParsedUrl, referer);

      const upstreamHeaders = new Headers({
        Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
        'User-Agent': BROWSER_LIKE_USER_AGENT,
        Referer: targetReferer,
        'Sec-Fetch-Dest': 'image',
        'Sec-Fetch-Mode': 'no-cors',
        'Sec-Fetch-Site': 'cross-site',
      });

      const resp = await fetch(currentParsedUrl.toString(), {
        method: 'GET',
        headers: upstreamHeaders,
        redirect: 'manual',
        cf: {
          cacheEverything: true,
          cacheTtl: 604800, // 7 days edge cache
        },
      }).catch((err) => {
        console.error('Image proxy upstream error:', err);
        return null;
      });

      if (!resp) break;

      // Handle 3xx redirects securely
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
      return jsonResponse({ error: 'Upstream fetch failed or invalid redirect' }, 502);
    }

    if (!upstreamResponse.ok || !upstreamResponse.body) {
      return jsonResponse(
        {
          error: `Upstream error (${upstreamResponse.status})`,
          status: upstreamResponse.status,
        },
        upstreamResponse.status
      );
    }

    const contentType = upstreamResponse.headers.get('Content-Type') || 'image/jpeg';
    const responseHeaders = new Headers(CORS_HEADERS);
    responseHeaders.set('Content-Type', contentType);
    responseHeaders.set(
      'Cache-Control',
      'public, max-age=604800, stale-while-revalidate=2592000'
    );
    responseHeaders.set('X-Proxy-Upstream-Status', String(upstreamResponse.status));
    responseHeaders.set('X-Proxy-Source-Host', currentParsedUrl.hostname);

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
