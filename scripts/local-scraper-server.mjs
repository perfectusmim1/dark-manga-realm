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

  headers.set('Accept', 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8');
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
    writeJson(request, response, 200, {
      ok: true,
      host: config.host || DEFAULT_HOST,
      port: config.port || DEFAULT_PORT,
      configPath,
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

    const upstreamResponse = await fetch(targetUrl, {
      method: typeof payload.method === 'string' ? payload.method : 'GET',
      headers: buildUpstreamHeaders(payload, config),
      body: normalizeRequestBody(payload),
      redirect: 'follow',
    });

    const contentType = upstreamResponse.headers.get('content-type') || 'text/plain; charset=utf-8';
    const content = await upstreamResponse.text();

    writeJson(request, response, 200, {
      statusCode: upstreamResponse.status,
      contentType,
      content,
      finalUrl: upstreamResponse.url,
    }, config);
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

  server.listen(port, host, () => {
    console.log(`[local-scraper] Ready on http://${host}:${port}`);
    console.log(`[local-scraper] Config: ${configPath}`);
    if (!config.sources?.siyahmelek?.cookie) {
      console.log('[local-scraper] Warning: sources.siyahmelek.cookie bos. Cloudflare/VIP korumasinda bu gerekli olabilir.');
    }
  });
};

bootstrap().catch((error) => {
  console.error('[local-scraper] Start failed:', error);
  process.exitCode = 1;
});
