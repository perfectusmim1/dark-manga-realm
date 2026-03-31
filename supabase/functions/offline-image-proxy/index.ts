import { corsHeaders } from '../_shared/cors.ts';

const DEFAULT_ALLOWED_HOSTS = new Set([
  'cdn.anime-planet.com',
  'anime-planet.com',
  'www.anime-planet.com',
  'yedek.mangawow.com',
  'kirmizikafa.monster',
]);

const getAllowedHosts = () => {
  const configuredHosts = Deno.env.get('OFFLINE_IMAGE_PROXY_ALLOWED_HOSTS');
  if (!configuredHosts) {
    return DEFAULT_ALLOWED_HOSTS;
  }

  return new Set(
    configuredHosts
      .split(',')
      .map((host) => host.trim().toLowerCase())
      .filter(Boolean),
  );
};

const jsonResponse = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
  });

const getUpstreamReferer = (parsedUrl: URL) => {
  const hostname = parsedUrl.hostname.toLowerCase();

  if (hostname === 'cdn.anime-planet.com' || hostname.endsWith('.anime-planet.com')) {
    return 'https://www.anime-planet.com/';
  }

  return `${parsedUrl.protocol}//${parsedUrl.hostname}/`;
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (!['GET', 'POST'].includes(req.method)) {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  try {
    let url: unknown;

    if (req.method === 'GET') {
      url = new URL(req.url).searchParams.get('url');
    } else {
      const rawBody = await req.text();
      if (!rawBody.trim()) {
        return jsonResponse({ error: 'Request body is required' }, 400);
      }

      let parsedBody: { url?: unknown };
      try {
        parsedBody = JSON.parse(rawBody);
      } catch {
        return jsonResponse({ error: 'Invalid JSON body' }, 400);
      }

      url = parsedBody.url;
    }

    if (typeof url !== 'string' || !url.trim()) {
      return jsonResponse({ error: 'Valid url is required' }, 400);
    }

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      return jsonResponse({ error: 'Invalid url' }, 400);
    }

    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      return jsonResponse({ error: 'Unsupported protocol' }, 400);
    }

    const hostname = parsedUrl.hostname.toLowerCase();
    if (!getAllowedHosts().has(hostname)) {
      return jsonResponse({ error: 'Host is not allowed' }, 403);
    }

    const upstreamResponse = await fetch(parsedUrl.toString(), {
      method: 'GET',
      headers: {
        'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
        'Origin': getUpstreamReferer(parsedUrl).replace(/\/$/, ''),
        'Referer': getUpstreamReferer(parsedUrl),
        'User-Agent': 'ToonParrot Offline Proxy/1.0',
      },
    });

    if (!upstreamResponse.ok || !upstreamResponse.body) {
      return jsonResponse({ error: `Upstream fetch failed (${upstreamResponse.status})` }, 502);
    }

    const responseHeaders = new Headers({
      ...corsHeaders,
      'Content-Type': upstreamResponse.headers.get('content-type') || 'application/octet-stream',
      'Cache-Control': 'private, max-age=3600',
      'Access-Control-Expose-Headers': 'content-type, content-length, cache-control',
    });

    const contentLength = upstreamResponse.headers.get('content-length');
    if (contentLength) {
      responseHeaders.set('Content-Length', contentLength);
    }

    return new Response(upstreamResponse.body, {
      status: 200,
      headers: responseHeaders,
    });
  } catch (error) {
    console.error('offline-image-proxy error', error);
    return jsonResponse(
      { error: error instanceof Error ? error.message : 'Unexpected proxy error' },
      500,
    );
  }
});
