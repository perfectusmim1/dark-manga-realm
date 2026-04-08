import { createServiceClient, json, requireRequester } from "../_shared/auth.ts";
import { corsHeaders } from "../_shared/cors.ts";

const DEFAULT_ALLOWED_HOSTS = [
  "hayalistic.net",
  "hayalistic.com",
  "webtoonhatti.club",
  "siyahmelek.mom",
  "yedek.mangawow.com",
  "kirmizikafa.monster",
  "myanimelist.net",
  "cdn.myanimelist.net",
  "mangaupdates.com",
  "api.mangaupdates.com",
  "anilist.co",
  "graphql.anilist.co",
  "api.jikan.moe",
  "anime-planet.com",
  "www.anime-planet.com",
  "anisearch.com",
  "www.anisearch.com",
  "cdn.anisearch.com",
];

const BROWSER_LIKE_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36";

const FORWARDED_HEADER_ALLOWLIST = new Set([
  "accept",
  "accept-language",
  "authorization",
  "cache-control",
  "content-type",
]);

const PROXY_TOKEN_SECRET_KEY = "scraper_proxy_token";
const SOURCE_COOKIE_SECRET_KEYS = {
  siyahmelek: "scraper_cookie_siyahmelek",
} as const;

type SourceName = "hayalistic" | "webtoonhatti" | "siyahmelek" | "other";

type RequestPayload = {
  sourceUrl: string;
  upstreamMethod: string;
  upstreamHeaders: Record<string, string>;
  upstreamBody?: string;
};

const parseCsv = (value: string | undefined | null, fallback: string[] = []) => {
  const parsed = `${value || ""}`
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  return parsed.length > 0 ? parsed : fallback;
};

const normalizeText = (value?: string | null) => value?.replace(/\s+/g, " ").trim() || "";

const getAllowedHosts = () => parseCsv(
  Deno.env.get("SCRAPER_PROXY_ALLOWED_HOSTS"),
  DEFAULT_ALLOWED_HOSTS,
);

const readRequestPayload = async (request: Request): Promise<RequestPayload> => {
  const requestUrl = new URL(request.url);

  if (request.method === "GET") {
    return {
      sourceUrl: requestUrl.searchParams.get("url") || "",
      upstreamMethod: "GET",
      upstreamHeaders: {},
      upstreamBody: undefined,
    };
  }

  const contentType = (request.headers.get("Content-Type") || "").toLowerCase();

  if (contentType.includes("text/plain")) {
    const rawText = (await request.text()).trim();
    if (!rawText) {
      return {
        sourceUrl: "",
        upstreamMethod: "GET",
        upstreamHeaders: {},
        upstreamBody: undefined,
      };
    }

    try {
      const parsed = JSON.parse(rawText) as {
        url?: string;
        method?: string;
        headers?: Record<string, string>;
        body?: unknown;
      };

      return {
        sourceUrl: typeof parsed.url === "string" ? parsed.url : "",
        upstreamMethod: typeof parsed.method === "string" ? parsed.method : "GET",
        upstreamHeaders: parsed.headers && typeof parsed.headers === "object" ? parsed.headers : {},
        upstreamBody: typeof parsed.body === "string"
          ? parsed.body
          : parsed.body != null
            ? JSON.stringify(parsed.body)
            : undefined,
      };
    } catch {
      return {
        sourceUrl: rawText,
        upstreamMethod: "GET",
        upstreamHeaders: {},
        upstreamBody: undefined,
      };
    }
  }

  const parsedBody = await request.json().catch(() => null) as {
    url?: string;
    method?: string;
    headers?: Record<string, string>;
    body?: unknown;
  } | null;

  return {
    sourceUrl: typeof parsedBody?.url === "string" ? parsedBody.url : "",
    upstreamMethod: typeof parsedBody?.method === "string" ? parsedBody.method : "GET",
    upstreamHeaders: parsedBody?.headers && typeof parsedBody.headers === "object" ? parsedBody.headers : {},
    upstreamBody: typeof parsedBody?.body === "string"
      ? parsedBody.body
      : parsedBody?.body != null
        ? JSON.stringify(parsedBody.body)
        : undefined,
  };
};

const isAllowedHost = (hostname: string, allowedHosts: string[]) => {
  const normalizedHostname = hostname.toLowerCase();

  return allowedHosts.some((allowedHost) => {
    const normalizedAllowedHost = allowedHost.toLowerCase();
    return (
      normalizedHostname === normalizedAllowedHost
      || normalizedHostname.endsWith(`.${normalizedAllowedHost}`)
    );
  });
};

const sanitizeUpstreamMethod = (method?: string | null) => {
  const normalizedMethod = `${method || "GET"}`.trim().toUpperCase();
  return ["GET", "POST"].includes(normalizedMethod) ? normalizedMethod : null;
};

const sanitizeUpstreamHeaders = (headers?: Record<string, string> | null) => {
  const sanitized = new Headers();

  if (!headers || typeof headers !== "object" || Array.isArray(headers)) {
    return sanitized;
  }

  for (const [key, value] of Object.entries(headers)) {
    const normalizedKey = `${key}`.trim().toLowerCase();
    if (!FORWARDED_HEADER_ALLOWLIST.has(normalizedKey)) {
      continue;
    }

    const normalizedValue = typeof value === "string" ? value.trim() : "";
    if (!normalizedValue) {
      continue;
    }

    sanitized.set(normalizedKey, normalizedValue);
  }

  return sanitized;
};

const loadSecretMap = async (
  serviceClient: ReturnType<typeof createServiceClient>,
  keys: string[],
) => {
  if (keys.length === 0) {
    return new Map<string, string>();
  }

  const { data, error } = await serviceClient
    .from("internal_worker_secrets")
    .select("key, value")
    .in("key", keys);

  if (error) {
    throw error;
  }

  const values = new Map<string, string>();
  for (const row of data || []) {
    values.set(normalizeText(row.key), normalizeText(row.value));
  }

  return values;
};

const detectSourceName = (hostname: string): SourceName => {
  const normalizedHostname = hostname.toLowerCase().replace(/^www\./, "");

  if (normalizedHostname === "siyahmelek.mom") {
    return "siyahmelek";
  }

  if (normalizedHostname === "webtoonhatti.club") {
    return "webtoonhatti";
  }

  if (normalizedHostname === "hayalistic.com" || normalizedHostname === "hayalistic.net") {
    return "hayalistic";
  }

  return "other";
};

const isBotChallengeResponse = (html: string) => {
  const normalized = html.toLowerCase();
  return normalized.includes("just a moment")
    || normalized.includes("cf-browser-verification")
    || normalized.includes("challenge-platform")
    || normalized.includes("cf-turnstile")
    || normalized.includes("/cdn-cgi/challenge-platform/");
};

const buildBlockedMessage = (sourceName: SourceName) => {
  if (sourceName === "siyahmelek") {
    return "SiyahMelek isteği bot korumasına takıldı. Sunucu proxy yeterli olmadı; admin panelindeki tarayici oturumundan cek akisini kullanin.";
  }

  return "Kaynak site isteği engelledi.";
};

const authorizeProxyRequest = async (
  request: Request,
  expectedProxyToken: string,
) => {
  const authHeader = request.headers.get("Authorization") || "";
  const bearerToken = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7).trim()
    : "";

  if (expectedProxyToken && bearerToken === expectedProxyToken) {
    return null;
  }

  const requesterResult = await requireRequester(request, ["admin", "moderator"]);
  if (!requesterResult.ok) {
    return requesterResult.response;
  }

  return null;
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders,
    });
  }

  if (!["GET", "POST"].includes(request.method)) {
    return json({ error: "Method not allowed" }, 405);
  }

  try {
    const {
      sourceUrl,
      upstreamMethod,
      upstreamHeaders,
      upstreamBody,
    } = await readRequestPayload(request);

    if (!sourceUrl) {
      return json({
        ok: true,
        service: "proxy-scraper",
        methods: ["GET ?url=", "POST text/plain", "POST application/json"],
        allowedHosts: getAllowedHosts(),
      });
    }

    const serviceClient = createServiceClient();
    const proxySecrets = await loadSecretMap(serviceClient, [PROXY_TOKEN_SECRET_KEY]);
    const authFailureResponse = await authorizeProxyRequest(
      request,
      proxySecrets.get(PROXY_TOKEN_SECRET_KEY) || "",
    );

    if (authFailureResponse) {
      return authFailureResponse;
    }

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(sourceUrl);
    } catch {
      return json({ error: "Invalid url", statusCode: 400 }, 400);
    }

    if (!["http:", "https:"].includes(parsedUrl.protocol)) {
      return json({ error: "Unsupported protocol", statusCode: 400 }, 400);
    }

    const allowedHosts = getAllowedHosts();
    if (!isAllowedHost(parsedUrl.hostname, allowedHosts)) {
      return json({ error: "Host is not allowed", statusCode: 403 }, 403);
    }

    const resolvedMethod = sanitizeUpstreamMethod(upstreamMethod);
    if (!resolvedMethod) {
      return json({ error: "Unsupported upstream method", statusCode: 400 }, 400);
    }

    const sourceName = detectSourceName(parsedUrl.hostname);
    const sourceCookieKey = sourceName in SOURCE_COOKIE_SECRET_KEYS
      ? SOURCE_COOKIE_SECRET_KEYS[sourceName as keyof typeof SOURCE_COOKIE_SECRET_KEYS]
      : null;
    const sourceSecrets = await loadSecretMap(
      serviceClient,
      sourceCookieKey ? [sourceCookieKey] : [],
    );
    const sourceCookie = sourceCookieKey ? sourceSecrets.get(sourceCookieKey) || "" : "";

    const resolvedUpstreamHeaders = new Headers({
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7",
      "User-Agent": BROWSER_LIKE_USER_AGENT,
      Referer: `${parsedUrl.origin}/`,
      "Cache-Control": "no-cache",
    });

    if (resolvedMethod !== "GET") {
      resolvedUpstreamHeaders.set("Origin", parsedUrl.origin);
    }

    const forwardedHeaders = sanitizeUpstreamHeaders(upstreamHeaders);
    forwardedHeaders.forEach((value, key) => {
      resolvedUpstreamHeaders.set(key, value);
    });

    if (sourceCookie) {
      resolvedUpstreamHeaders.set("Cookie", sourceCookie);
    }

    const upstreamResponse = await fetch(parsedUrl.toString(), {
      method: resolvedMethod,
      headers: resolvedUpstreamHeaders,
      body: resolvedMethod === "POST" && typeof upstreamBody === "string" ? upstreamBody : undefined,
      redirect: "follow",
    }).catch(() => null);

    if (!upstreamResponse) {
      return json({
        error: "Upstream request failed",
        statusCode: 502,
      });
    }

    const content = await upstreamResponse.text();
    const challengeDetected = isBotChallengeResponse(content);
    const effectiveStatusCode = challengeDetected ? 403 : upstreamResponse.status;
    const errorMessage = challengeDetected
      ? buildBlockedMessage(sourceName)
      : upstreamResponse.ok
        ? undefined
        : `Upstream request failed (${upstreamResponse.status})`;

    return json({
      content,
      contentType: upstreamResponse.headers.get("Content-Type") || "text/html; charset=utf-8",
      statusCode: effectiveStatusCode,
      error: errorMessage,
    });
  } catch (error) {
    return json({
      error: error instanceof Error ? error.message : "Unexpected scraper proxy error",
      statusCode: 500,
    }, 500);
  }
});
