const rawAnonKey =
  typeof import.meta !== 'undefined' && import.meta.env
    ? String(import.meta.env.VITE_SUPABASE_ANON_KEY || '').trim()
    : '';

const rawConfiguredProxies =
  typeof import.meta !== 'undefined' && import.meta.env
    ? String(import.meta.env.VITE_OFFLINE_IMAGE_PROXY_URL || '').trim()
    : '';

export const defaultOfflineImageProxyUrl =
  'https://toonparrot-offline-image-proxy.caganhuseyinerdil.workers.dev';

const normalizeProxyUrl = (value: string): string => value.trim().replace(/\/+$/, '');

const buildConfiguredProxyPool = (rawValue: string): string[] => {
  const seen = new Set<string>();
  const pool: string[] = [];

  for (const part of rawValue.split(',')) {
    const normalized = normalizeProxyUrl(part);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    pool.push(normalized);
  }

  // Primary worker (deployed from this repo with latest ALLOWED_HOSTS) is always kept in the pool.
  const normalizedDefault = normalizeProxyUrl(defaultOfflineImageProxyUrl);
  if (normalizedDefault && !seen.has(normalizedDefault)) {
    seen.add(normalizedDefault);
    pool.push(normalizedDefault);
  }

  return pool;
};

export const configuredOfflineImageProxyUrls: string[] = buildConfiguredProxyPool(rawConfiguredProxies);

// Per-session memory of proxy origins that rejected (401/403) a specific upstream image hostname.
const rejectedProxiesByHost = new Map<string, Set<string>>();

// Hosts that are only whitelisted on the primary (latest) worker deployment.
const PRIMARY_WORKER_ONLY_HOST_SUFFIXES = [
  'asurascans.com',
  'asuracomic.net',
  'mangadass.com',
  'madaradex.org',
];

const isPrimaryWorkerOnlyHost = (host: string): boolean => {
  if (!host) return false;
  return PRIMARY_WORKER_ONLY_HOST_SUFFIXES.some(
    (suffix) => host === suffix || host.endsWith(`.${suffix}`),
  );
};

const extractHostname = (targetUrl: string): string => {
  try {
    return new URL(targetUrl).hostname.toLowerCase();
  } catch {
    return '';
  }
};

const extractProxyKey = (proxyUrl: string): string => {
  const normalized = normalizeProxyUrl(proxyUrl);
  try {
    const parsed = new URL(normalized);
    return `${parsed.origin.toLowerCase()}${parsed.pathname.replace(/\/+$/, '')}`;
  } catch {
    return normalized.toLowerCase();
  }
};

export const markOfflineProxyRejectedForHost = (proxyUrl: string, targetUrl: string): void => {
  const host = extractHostname(targetUrl);
  const proxyKey = extractProxyKey(proxyUrl);
  if (!host || !proxyKey) return;

  let set = rejectedProxiesByHost.get(host);
  if (!set) {
    set = new Set<string>();
    rejectedProxiesByHost.set(host, set);
  }
  set.add(proxyKey);
};

export const isOfflineProxyRejectedForHost = (proxyUrl: string, targetUrl: string): boolean => {
  const host = extractHostname(targetUrl);
  if (!host) return false;
  const set = rejectedProxiesByHost.get(host);
  if (!set || set.size === 0) return false;
  return set.has(extractProxyKey(proxyUrl));
};

export const clearOfflineProxyRejections = (): void => {
  rejectedProxiesByHost.clear();
};

const getNonRejectedPoolForTarget = (targetUrl: string, pool: readonly string[] = configuredOfflineImageProxyUrls): string[] => {
  if (pool.length === 0) return [defaultOfflineImageProxyUrl];
  const host = extractHostname(targetUrl);
  if (!host) return [...pool];

  if (isPrimaryWorkerOnlyHost(host)) {
    return [defaultOfflineImageProxyUrl];
  }

  const rejected = rejectedProxiesByHost.get(host);
  if (!rejected || rejected.size === 0) return [...pool];

  const available = pool.filter((proxyUrl) => !rejected.has(extractProxyKey(proxyUrl)));
  if (available.length > 0) return available;

  return [defaultOfflineImageProxyUrl];
};

let proxyIndex = 0;

export const getOfflineImageProxyUrl = (): string => {
  if (configuredOfflineImageProxyUrls.length === 0) return defaultOfflineImageProxyUrl;
  const url = configuredOfflineImageProxyUrls[proxyIndex % configuredOfflineImageProxyUrls.length];
  proxyIndex = (proxyIndex + 1) % configuredOfflineImageProxyUrls.length;
  return url;
};

export const getCandidateOfflineProxyUrls = (
  targetUrl: string,
  pool: readonly string[] = configuredOfflineImageProxyUrls,
): string[] => {
  const available = getNonRejectedPoolForTarget(targetUrl, pool);
  if (available.length <= 1) return available;

  const primaryKey = extractProxyKey(defaultOfflineImageProxyUrl);
  const primaryIdx = available.findIndex((u) => extractProxyKey(u) === primaryKey);
  if (primaryIdx >= 0) {
    const rest = available.filter((_, idx) => idx !== primaryIdx);
    return [available[primaryIdx], ...rest];
  }

  const start = proxyIndex % available.length;
  proxyIndex = (proxyIndex + 1) % available.length;
  return [...available.slice(start), ...available.slice(0, start)];
};

export const getPreferredOfflineProxyUrlForSource = (
  sourceUrl: string,
  pool: readonly string[] = configuredOfflineImageProxyUrls,
): string => {
  const available = getNonRejectedPoolForTarget(sourceUrl, pool);
  if (available.length === 0) return defaultOfflineImageProxyUrl;
  let hash = 0;
  for (let i = 0; i < sourceUrl.length; i += 1) {
    hash = (hash << 5) - hash + sourceUrl.charCodeAt(i);
    hash |= 0;
  }
  const index = Math.abs(hash) % available.length;
  return available[index];
};

export const isSupabaseFunctionsProxyUrl = (proxyUrl: string): boolean =>
  Boolean(proxyUrl && proxyUrl.includes('/functions/v1/'));

export const offlineProxyConfig = {
  get url(): string {
    return getOfflineImageProxyUrl();
  },
  urls: configuredOfflineImageProxyUrls,
  defaultUrl: defaultOfflineImageProxyUrl,
  usesSupabaseAuth: isSupabaseFunctionsProxyUrl(configuredOfflineImageProxyUrls[0] || ''),
  supabaseAnonKey: rawAnonKey,
};
