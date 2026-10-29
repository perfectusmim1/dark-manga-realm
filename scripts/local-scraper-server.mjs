import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const configPath = path.join(projectRoot, 'local-scraper.config.json');

const DEFAULT_PORT = 41113;
const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_ACCEPT_LANGUAGE = 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7';
const DEFAULT_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36';
const DEFAULT_PROXY_WORKER = 'https://toonparrot-scraper-proxy.caganhuseyinerdil.workers.dev';
const DEFAULT_CDP_URL = 'http://127.0.0.1:9222';

const readJsonBody = async (request) => {
  const chunks = [];

  for await (const chunk of request) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }

  const rawBody = Buffer.concat(chunks).toString('utf8').trim();
  if (!rawBody) {
    return {};
  }

  return JSON.parse(rawBody);
};

const loadConfig = async () => {
  try {
    const rawConfig = await readFile(configPath, 'utf8');
    const parsed = JSON.parse(rawConfig);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return {};
    }

    throw error;
  }
};

const matchesAllowedOrigin = (requestOrigin, allowedOrigin) => {
  if (allowedOrigin === '*') {
    return true;
  }

  if (allowedOrigin === requestOrigin) {
    return true;
  }

  if (allowedOrigin.endsWith(':*')) {
    const baseOrigin = allowedOrigin.slice(0, -2);
    return requestOrigin.startsWith(`${baseOrigin}:`);
  }

  try {
    const requestUrl = new URL(requestOrigin);
    const allowedUrl = new URL(allowedOrigin);

    return (
      requestUrl.protocol === allowedUrl.protocol &&
      requestUrl.hostname === allowedUrl.hostname &&
      requestUrl.port === allowedUrl.port
    );
  } catch {
    return false;
  }
};

const getAllowedOrigin = (requestOrigin, config) => {
  const allowedOrigins = Array.isArray(config.allowedOrigins)
    ? config.allowedOrigins.filter((origin) => typeof origin === 'string' && origin.trim())
    : [];

  if (!requestOrigin) {
    return '';
  }

  if (allowedOrigins.includes('*')) {
    return '*';
  }

  return allowedOrigins.some((origin) => matchesAllowedOrigin(requestOrigin, origin))
    ? requestOrigin
    : '';
};

const setCorsHeaders = (request, response, config) => {
  const requestOrigin = typeof request.headers.origin === 'string' ? request.headers.origin : '';
  const allowedOrigin = getAllowedOrigin(requestOrigin, config);

  if (allowedOrigin) {
    response.setHeader('Access-Control-Allow-Origin', allowedOrigin);
    response.setHeader('Vary', 'Origin');
    response.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    response.setHeader('Access-Control-Allow-Private-Network', 'true');
  }
};

const writeJson = (request, response, statusCode, payload, config) => {
  setCorsHeaders(request, response, config);
  response.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(payload));
};

const buildUpstreamHeaders = (payload, config) => {
  const sourceKey = typeof payload.source === 'string' ? payload.source : '';
  const sourceConfig = config.sources && typeof config.sources === 'object' && config.sources[sourceKey]
    ? config.sources[sourceKey]
    : {};

  const headers = new Headers();

  headers.set('Accept', 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8');
  headers.set('Accept-Language', sourceConfig.acceptLanguage || config.acceptLanguage || DEFAULT_ACCEPT_LANGUAGE);
  headers.set('Cache-Control', 'no-cache');
  headers.set('Pragma', 'no-cache');
  headers.set('User-Agent', sourceConfig.userAgent || config.userAgent || DEFAULT_USER_AGENT);

  if (typeof sourceConfig.cookie === 'string' && sourceConfig.cookie.trim()) {
    headers.set('Cookie', sourceConfig.cookie.trim());
  }

  if (typeof sourceConfig.referer === 'string' && sourceConfig.referer.trim()) {
    headers.set('Referer', sourceConfig.referer.trim());
  }

  if (payload.url) {
    try {
      const targetUrl = new URL(payload.url);
      headers.set('Origin', sourceConfig.origin || targetUrl.origin);
      if (!headers.has('Referer')) {
        headers.set('Referer', `${targetUrl.origin}/`);
      }
    } catch {
      if (typeof sourceConfig.origin === 'string' && sourceConfig.origin.trim()) {
        headers.set('Origin', sourceConfig.origin.trim());
      }
    }
  }

  if (payload.headers && typeof payload.headers === 'object' && !Array.isArray(payload.headers)) {
    for (const [key, value] of Object.entries(payload.headers)) {
      if (typeof value === 'string' && value.trim()) {
        headers.set(key, value);
      }
    }
  }

  if (sourceConfig.extraHeaders && typeof sourceConfig.extraHeaders === 'object') {
    for (const [key, value] of Object.entries(sourceConfig.extraHeaders)) {
      if (typeof value === 'string' && value.trim()) {
        headers.set(key, value);
      }
    }
  }

  return headers;
};

const normalizeRequestBody = (payload) => {
  if (payload.body === undefined || payload.body === null) {
    return undefined;
  }

  if (typeof payload.body === 'string') {
    return payload.body;
  }

  return JSON.stringify(payload.body);
};

const isCloudflareBlocked = (statusCode, content) => {
  if (statusCode === 403 || statusCode === 503) {
    return true;
  }

  if (typeof content !== 'string' || !content) {
    return false;
  }

  const lower = content.toLowerCase();
  return (
    lower.includes('just a moment...') ||
    lower.includes('cf-mitigated') ||
    lower.includes('challenges.cloudflare.com') ||
    lower.includes('cf-chl-') ||
    lower.includes('attention required! | cloudflare') ||
    lower.includes('security check') ||
    lower.includes('checking your browser')
  );
};

const isCdpAvailable = async (cdpUrl) => {
  try {
    const res = await fetch(`${cdpUrl}/json/version`, {
      signal: AbortSignal.timeout(1200),
    });
    return res.ok;
  } catch {
    return false;
  }
};

const fetchViaCdp = async (targetUrl, cdpUrl = DEFAULT_CDP_URL, timeoutMs = 15000) => {
  const newTabRes = await fetch(`${cdpUrl}/json/new?${encodeURIComponent(targetUrl)}`, {
    method: 'PUT',
    signal: AbortSignal.timeout(5000),
  });

  if (!newTabRes.ok) {
    throw new Error(`CDP /json/new failed with HTTP ${newTabRes.status}`);
  }

  const tab = await newTabRes.json();
  const tabId = tab.id;
  const wsUrl = tab.webSocketDebuggerUrl;

  if (!wsUrl) {
    throw new Error('CDP target returned no webSocketDebuggerUrl');
  }

  try {
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`CDP page load timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      const ws = new WebSocket(wsUrl);
      let idCounter = 1;
      const callbacks = new Map();

      const send = (method, params = {}) => new Promise((res, rej) => {
        const id = idCounter++;
        callbacks.set(id, { resolve: res, reject: rej });
        ws.send(JSON.stringify({ id, method, params }));
      });

      const cleanup = () => {
        clearTimeout(timer);
        try {
          ws.close();
        } catch {}
      };

      ws.addEventListener('open', async () => {
        try {
          await send('Page.enable');
          await send('Runtime.enable');

          // Wait 3.5s for CF challenge or scripts to execute
          await new Promise((r) => setTimeout(r, 3500));

          const evalResult = await send('Runtime.evaluate', {
            expression: 'document.documentElement ? document.documentElement.outerHTML : (document.body ? document.body.innerHTML : "")',
            returnByValue: true,
          });

          const outerHtml = evalResult?.result?.value || '';
          cleanup();
          resolve(outerHtml);
        } catch (err) {
          cleanup();
          reject(err);
        }
      });

      ws.addEventListener('message', (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.id && callbacks.has(msg.id)) {
            const cb = callbacks.get(msg.id);
            callbacks.delete(msg.id);
            if (msg.error) {
              cb.reject(new Error(msg.error.message || 'CDP command error'));
            } else {
              cb.resolve(msg.result);
            }
          }
        } catch {}
      });

      ws.addEventListener('error', (err) => {
        cleanup();
        reject(err);
      });
    });
  } finally {
    fetch(`${cdpUrl}/json/close/${tabId}`).catch(() => {});
  }
};

const server = createServer(async (request, response) => {
  let config = {};

  try {
    config = await loadConfig();
  } catch (error) {
    writeJson(request, response, 500, {
      error: `Config okunamadı: ${error instanceof Error ? error.message : 'Bilinmeyen hata'}`,
    }, {});
    return;
  }

  if (request.method === 'OPTIONS') {
    setCorsHeaders(request, response, config);
    response.writeHead(204);
    response.end();
    return;
  }

  if (request.url === '/health') {
    const cdpUrl = config.cdpUrl || DEFAULT_CDP_URL;
    const cdpOk = await isCdpAvailable(cdpUrl);

    writeJson(request, response, 200, {
      ok: true,
      host: config.host || DEFAULT_HOST,
      port: config.port || DEFAULT_PORT,
      configPath,
      proxyWorkerUrl: config.proxyWorkerUrl || DEFAULT_PROXY_WORKER,
      cdpUrl,
      cdpAvailable: cdpOk,
      hasSiyahMelekCookie: Boolean(config.sources?.siyahmelek?.cookie),
    }, config);
    return;
  }

  if (request.method !== 'POST' || request.url !== '/fetch') {
    writeJson(request, response, 404, { error: 'Not found' }, config);
    return;
  }

  const requestOrigin = typeof request.headers.origin === 'string' ? request.headers.origin : '';
  if (requestOrigin && !getAllowedOrigin(requestOrigin, config)) {
    writeJson(request, response, 403, {
      error: `Origin izinli değil: ${requestOrigin}. local-scraper.config.json içindeki allowedOrigins alanını kontrol edin.`,
    }, config);
    return;
  }

  try {
    const payload = await readJsonBody(request);
    const targetUrl = typeof payload.url === 'string' ? payload.url.trim() : '';

    if (!targetUrl) {
      writeJson(request, response, 400, { error: 'url gerekli' }, config);
      return;
    }

    const headers = buildUpstreamHeaders(payload, config);
    let directResponse = null;
    let directError = null;
    let directContent = '';
    let directStatus = 0;
    let directContentType = 'text/plain; charset=utf-8';
    let directFinalUrl = targetUrl;

    // --- Katman 1: Doğrudan HTTP fetch ---
    try {
      directResponse = await fetch(targetUrl, {
        method: typeof payload.method === 'string' ? payload.method : 'GET',
        headers,
        body: normalizeRequestBody(payload),
        redirect: 'follow',
      });
      directStatus = directResponse.status;
      directContentType = directResponse.headers.get('content-type') || 'text/plain; charset=utf-8';
      directContent = await directResponse.text();
      directFinalUrl = directResponse.url || targetUrl;
    } catch (err) {
      directError = err;
    }

    // Doğrudan istek başarılı ve engellenmemişse dön
    if (directResponse && !directError && !isCloudflareBlocked(directStatus, directContent)) {
      writeJson(request, response, 200, {
        statusCode: directStatus,
        contentType: directContentType,
        content: directContent,
        finalUrl: directFinalUrl,
        via: 'direct',
      }, config);
      return;
    }

    // --- Katman 2: Cloudflare Scraper Proxy Worker Köprüsü ---
    const proxyWorkerUrl = config.proxyWorkerUrl || DEFAULT_PROXY_WORKER;
    let proxyContent = '';
    let proxyStatus = 0;
    let proxyContentType = directContentType;
    let proxyFinalUrl = directFinalUrl;
    let proxySucceeded = false;

    try {
      const headerObj = {};
      for (const [k, v] of headers.entries()) {
        headerObj[k] = v;
      }

      const proxyRes = await fetch(proxyWorkerUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: targetUrl,
          method: typeof payload.method === 'string' ? payload.method : 'GET',
          headers: headerObj,
          body: payload.body,
          source: payload.source,
        }),
      });

      if (proxyRes.ok) {
        const rawProxyText = await proxyRes.text();
        let parsedProxy = null;
        try {
          parsedProxy = JSON.parse(rawProxyText);
        } catch {}

        if (parsedProxy && typeof parsedProxy === 'object' && typeof parsedProxy.content === 'string') {
          proxyContent = parsedProxy.content;
          proxyStatus = Number(parsedProxy.statusCode) || proxyRes.status;
          proxyContentType = parsedProxy.contentType || 'text/html; charset=utf-8';
          proxyFinalUrl = parsedProxy.finalUrl || targetUrl;
        } else {
          proxyContent = rawProxyText;
          proxyStatus = proxyRes.status;
        }

        if (!isCloudflareBlocked(proxyStatus, proxyContent)) {
          proxySucceeded = true;
          writeJson(request, response, 200, {
            statusCode: proxyStatus,
            contentType: proxyContentType,
            content: proxyContent,
            finalUrl: proxyFinalUrl,
            via: 'edge-proxy',
          }, config);
          return;
        }
      }
    } catch {}

    // --- Katman 3: Yerel Chrome CDP (Gerçek Tarayıcı Sekmesi) ---
    const cdpUrl = config.cdpUrl || DEFAULT_CDP_URL;
    const cdpAvailable = await isCdpAvailable(cdpUrl);

    if (cdpAvailable) {
      try {
        const cdpHtml = await fetchViaCdp(targetUrl, cdpUrl, 15000);
        if (cdpHtml && cdpHtml.length > 50) {
          writeJson(request, response, 200, {
            statusCode: 200,
            contentType: 'text/html; charset=utf-8',
            content: cdpHtml,
            finalUrl: targetUrl,
            via: 'chrome-cdp',
          }, config);
          return;
        }
      } catch (cdpErr) {
        console.warn(`[local-scraper] CDP bypass hatası: ${cdpErr instanceof Error ? cdpErr.message : String(cdpErr)}`);
      }
    }

    // Katmanların hiçbiri tam temiz dönemediyse en iyi yanıtı döndür
    if (proxyContent) {
      writeJson(request, response, 200, {
        statusCode: proxyStatus || 403,
        contentType: proxyContentType,
        content: proxyContent,
        finalUrl: proxyFinalUrl,
        via: 'edge-proxy-mitigated',
      }, config);
      return;
    }

    if (directResponse) {
      writeJson(request, response, 200, {
        statusCode: directStatus,
        contentType: directContentType,
        content: directContent,
        finalUrl: directFinalUrl,
        via: 'direct-mitigated',
      }, config);
      return;
    }

    throw directError || new Error('İstek gerçekleştirilemedi');
  } catch (error) {
    writeJson(request, response, 500, {
      error: error instanceof Error ? error.message : 'Local scraper isteği başarısız oldu',
    }, config);
  }
});

const bootstrap = async () => {
  const config = await loadConfig();
  const port = Number(config.port) || DEFAULT_PORT;
  const host = typeof config.host === 'string' && config.host.trim() ? config.host.trim() : DEFAULT_HOST;
  const cdpUrl = config.cdpUrl || DEFAULT_CDP_URL;
  const cdpOk = await isCdpAvailable(cdpUrl);

  server.listen(port, host, () => {
    console.log(`[local-scraper] Ready on http://${host}:${port}`);
    console.log(`[local-scraper] Config: ${configPath}`);
    console.log(`[local-scraper] Proxy Worker: ${config.proxyWorkerUrl || DEFAULT_PROXY_WORKER}`);
    console.log(`[local-scraper] Chrome CDP (${cdpUrl}): ${cdpOk ? 'CONNECTED' : 'DISCONNECTED'}`);
    if (!config.sources?.siyahmelek?.cookie) {
      console.log('[local-scraper] Info: sources.siyahmelek.cookie bos (siyahmelek icin gerekebilir).');
    }
  });
};

bootstrap().catch((error) => {
  console.error('[local-scraper] Start failed:', error);
  process.exitCode = 1;
});

