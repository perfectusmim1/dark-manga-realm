/**
 * toonparrot-offline-image-proxy
 * High-performance Image Proxy for Online Reader, Covers & Offline Downloads
 */

const DEFAULT_ALLOWED_HOSTS = [
  'webtoonhatti.club',
  'webtoonhatti.com',
  'webtoonhatti.net',
  'webtoon-oku.net',
  'cdn-2.webtoon-oku.net',
  'cdn-1.webtoon-oku.net',
  'okutoon.com',
  'om-cdn.okutoon.com',
  'mangacix.net',
  'cdn.mangacix.net',
  'image.tmdb.org',
  'golgebahcesi.com',
  'api.golgebahcesi.com',
  'skycdn.online',
  'c2.skycdn.online',
  'dxdfansub.com',
  'api.dxdfansub.com',
  'anilist.co',
  's4.anilist.co',
  'myanimelist.net',
  'cdn.myanimelist.net',
  'wikia.nocookie.net',
  'static.wikia.nocookie.net',
  'mangadex.org',
  'uploads.mangadex.org',
  'anime-planet.com',
  'cdn.anime-planet.com',
  'anisearch.com',
  'www.anisearch.com',
  'cdn.anisearch.com',
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
  'hayalistic.com',
  'hayalistic.com.tr',
  'yedek.mangawow.com',
  'kirmizikafa.monster',
  'discord.com',
  'discordapp.com',
  'cdn.discordapp.com',
  'media.discordapp.net',
  'ibb.co',
  'i.ibb.co',
  'postimg.cc',
  'i.postimg.cc',
  'b-cdn.net',
  'mangadass.com',
  'www.mangadass.com',
  'asurascans.com',
  'cdn.asurascans.com',
  'www.asurascans.com',
  'asuracomic.net',
  'gg.asuracomic.net',
  'madaradex.org',
  'cdn.madaradex.org',
  'www.madaradex.org',
];

const BROWSER_LIKE_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
  'Access-Control-Expose-Headers': 'Content-Type, Content-Length, Cache-Control, X-Proxy-Upstream-Status',
  'Access-Control-Max-Age': '86400',
  'Cross-Origin-Resource-Policy': 'cross-origin',
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
  const host = `${hostname || ''}`.trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (!host) return true;

  if (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '::1' ||
    host === '::' ||
    host === '0.0.0.0' ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host.endsWith('.localhost') ||
    host.endsWith('.nip.io') ||
    host.endsWith('.sslip.io') ||
    host.endsWith('.xip.io')
  ) {
    return true;
  }

  // Block single-integer / hex / octal IP representations
  if (/^\d+$/.test(host) || /^0x[0-9a-f]+$/i.test(host)) {
    return true;
  }

  // Block IPv6 private, loopback, link-local, and IPv4-mapped literals
  if (host.includes(':')) {
    if (
      host === '::1' ||
      host === '::' ||
      host.startsWith('fc') ||
      host.startsWith('fd') ||
      host.startsWith('fe8') ||
      host.startsWith('fe9') ||
      host.startsWith('fea') ||
      host.startsWith('feb') ||
      host.startsWith('::ffff:')
    ) {
      return true;
    }
  }

  const ipv4Regex = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
  const match = host.match(ipv4Regex);
  if (match) {
    if (match.slice(1).some((part) => part.length > 1 && part.startsWith('0'))) {
      return true;
    }
    const [, a, b] = match.map(Number);
    if (a === 0 || a === 10 || a === 127 || a >= 224) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
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
  const hostname = url.hostname.toLowerCase();
  // AniList CDN blocks Worker requests when cross-site Referer/Sec-Fetch headers are attached
  if (hostname.includes('anilist.co') || hostname.includes('wikia.nocookie.net')) {
    return '';
  }

  if (explicitReferer && typeof explicitReferer === 'string' && explicitReferer.startsWith('http')) {
    try {
      const parsedRef = new URL(explicitReferer);
      if (!isPrivateIpOrLocalhost(parsedRef.hostname)) {
        return explicitReferer;
      }
    } catch {
      // ignore invalid referer
    }
  }

  if (hostname.includes('okutoon.com')) return 'https://okutoon.com/';
  if (hostname.includes('mangacix.net')) return 'https://mangacix.net/';
  if (hostname.includes('webtoonhatti') || hostname.includes('webtoon-oku.net')) return 'https://webtoonhatti.club/';
  if (hostname.includes('golgebahcesi.com') || hostname.includes('skycdn.online')) return 'https://golgebahcesi.com/';
  if (hostname.includes('dxdfansub.com')) return 'https://dxdfansub.com/';
  if (hostname.includes('siyahmelek')) return 'https://siyahmelek.mom/';
  if (hostname.includes('hentaiturk')) return 'https://hentaiturk.com/';
  if (hostname.includes('hattorimanga')) return 'https://hattorimanga.net/';
  if (hostname.includes('myanimelist.net')) return 'https://myanimelist.net/';
  if (hostname.includes('mangadex.org')) return 'https://mangadex.org/';
  if (hostname.includes('anime-planet.com')) return 'https://www.anime-planet.com/';
  if (hostname.includes('anisearch.com')) return 'https://www.anisearch.com/';
  if (hostname.includes('mangaupdates.com')) return 'https://www.mangaupdates.com/';
  if (hostname.includes('mangadass.com')) return 'https://mangadass.com/';

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
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const requestUrl = new URL(request.url);
    const pathname = requestUrl.pathname.replace(/\/+$/, '') || '/';

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

    const allowedHosts = Array.from(
      new Set([...DEFAULT_ALLOWED_HOSTS, ...parseCsv(env.ALLOWED_HOSTS, [])])
    );

    let upstreamResponse = null;
    const maxRedirects = 3;

    for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount++) {
      if (isPrivateIpOrLocalhost(currentParsedUrl.hostname)) {
        return jsonResponse({ error: 'Access to private / local networks is forbidden' }, 403);
      }

      if (!isAllowedHost(currentParsedUrl.hostname, allowedHosts)) {
        return jsonResponse({ error: `Host '${currentParsedUrl.hostname}' is not allowed` }, 403);
      }

      const targetReferer = resolveRefererForHost(currentParsedUrl, referer);

      const upstreamHeaders = new Headers({
        Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
        'User-Agent': BROWSER_LIKE_USER_AGENT,
      });
      if (targetReferer) {
        upstreamHeaders.set('Referer', targetReferer);
        upstreamHeaders.set('Sec-Fetch-Dest', 'image');
        upstreamHeaders.set('Sec-Fetch-Mode', 'no-cors');
        upstreamHeaders.set('Sec-Fetch-Site', 'cross-site');
      }

      const cfCacheConfig = {
        cacheEverything: true,
        cacheTtlByStatus: { '200-299': 604800, '400-599': -1 },
      };

      let resp = await fetch(currentParsedUrl.toString(), {
        method: 'GET',
        headers: upstreamHeaders,
        redirect: 'manual',
        cf: cfCacheConfig,
      }).catch((err) => {
        console.error('Image proxy upstream error:', err);
        return null;
      });

      // Fallback retry without Referer or via Photon CDN (i0.wp.com) if upstream CDN blocks CF Worker IP with 403
      if (!resp || resp.status === 403) {
        const noRefererHeaders = new Headers({
          Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
          'User-Agent': BROWSER_LIKE_USER_AGENT,
        });
        const retryResp = await fetch(currentParsedUrl.toString(), {
          method: 'GET',
          headers: noRefererHeaders,
          redirect: 'manual',
          cf: cfCacheConfig,
        }).catch(() => null);
        if (retryResp && retryResp.ok) {
          resp = retryResp;
        } else {
          const photonUrl = `https://i0.wp.com/${currentParsedUrl.hostname}${currentParsedUrl.pathname}${currentParsedUrl.search}`;
          const photonResp = await fetch(photonUrl, {
            method: 'GET',
            headers: noRefererHeaders,
            cf: cfCacheConfig,
          }).catch(() => null);
          if (photonResp && photonResp.ok) {
            resp = photonResp;
          }
        }
      }

      if (!resp) break;

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
    if (contentType.toLowerCase().includes('text/html')) {
      return jsonResponse({ error: 'Upstream returned HTML instead of image' }, 502);
    }

    const responseHeaders = new Headers(CORS_HEADERS);
    responseHeaders.set('Content-Type', contentType);
    responseHeaders.set(
      'Cache-Control',
      'public, max-age=31536000, immutable'
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
