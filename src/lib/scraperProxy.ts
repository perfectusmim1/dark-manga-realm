import { getCurrentAccessToken, supabaseUrl } from '@/lib/supabase';
import { type ScrapeSource, getDefaultScrapeSource } from '@/lib/scraper/scrapeSources';

const configuredCloudflareScraperUrls = (import.meta.env.VITE_SCRAPER_PROXY_URL?.trim() || '')
  .split(',')
  .map((u) => u.trim().replace(/\/+$/, ''))
  .filter(Boolean);

const configuredCloudflareScraperUrl = configuredCloudflareScraperUrls[0] || '';

let clientScraperRoundRobin = 0;
export const getNextScraperProxyUrl = (): string => {
  if (configuredCloudflareScraperUrls.length === 0) return configuredCloudflareScraperUrl;
  const url = configuredCloudflareScraperUrls[clientScraperRoundRobin % configuredCloudflareScraperUrls.length];
  clientScraperRoundRobin = (clientScraperRoundRobin + 1) % configuredCloudflareScraperUrls.length;
  return url;
};
const configuredSupabaseScraperUrl = supabaseUrl
  ? `${supabaseUrl}/functions/v1/proxy-scraper`
  : '';
const configuredLocalhostScraperUrl = import.meta.env.VITE_LOCALHOST_SCRAPER_URL?.trim() || 'http://127.0.0.1:41113/fetch';

const SCRAPER_PROVIDER_STORAGE_KEY = 'toonparrot:scraper-provider';

export type ScraperProvider = 'cloudflare' | 'supabase' | 'localhost';

const SCRAPER_PROVIDER_LABELS: Record<ScraperProvider, string> = {
  cloudflare: 'Cloudflare',
  supabase: 'Supabase',
  localhost: 'Localhost',
};

interface ProxyAttempt {
  label: string;
  request: (targetUrl: string, source?: ScrapeSource) => Promise<Response>;
}

interface StructuredProxyAttempt {
  label: string;
  request: (payload: ScraperProxyRequestPayload, source?: ScrapeSource) => Promise<Response>;
}

export interface ScraperProxyRequestPayload {
  url: string;
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: string | Record<string, unknown> | unknown[];
  source?: ScrapeSource;
}

export const isScraperProvider = (value: string): value is ScraperProvider => (
  value === 'cloudflare' || value === 'supabase' || value === 'localhost'
);

export const getScraperProviderLabel = (provider: ScraperProvider) => (
  SCRAPER_PROVIDER_LABELS[provider]
);

export const getAvailableScraperProviders = (): ScraperProvider[] => {
  const providers: ScraperProvider[] = ['localhost'];

  if (configuredCloudflareScraperUrl) {
    providers.push('cloudflare');
  }

  if (configuredSupabaseScraperUrl) {
    providers.push('supabase');
  }

  return providers;
};

export const getDefaultScraperProvider = (): ScraperProvider => {
  const availableProviders = getAvailableScraperProviders();

  if (availableProviders.includes('cloudflare')) {
    return 'cloudflare';
  }

  if (availableProviders.includes('supabase')) {
    return 'supabase';
  }

  if (availableProviders.includes('localhost')) {
    return 'localhost';
  }

  throw new Error('No scraper provider configured');
};

export const getDefaultScraperProviderForSource = (source: ScrapeSource): ScraperProvider => {
  const availableProviders = getAvailableScraperProviders();

  if (source === 'siyahmelek' && availableProviders.includes('localhost')) {
    return 'localhost';
  }

  if (source === 'siyahmelek' && availableProviders.includes('supabase')) {
    return 'supabase';
  }

  if (availableProviders.includes('cloudflare')) {
    return 'cloudflare';
  }

  return getDefaultScraperProvider();
};

export const readPreferredScraperProvider = (): ScraperProvider => {
  const availableProviders = getAvailableScraperProviders();

  if (typeof window !== 'undefined') {
    const storedProvider = window.localStorage.getItem(SCRAPER_PROVIDER_STORAGE_KEY);
    if (storedProvider && isScraperProvider(storedProvider) && availableProviders.includes(storedProvider)) {
      return storedProvider;
    }
  }

  return getDefaultScraperProvider();
};

export const writePreferredScraperProvider = (provider: ScraperProvider) => {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(SCRAPER_PROVIDER_STORAGE_KEY, provider);
};

const readProxyResponse = async (response: Response) => {
  const contentType = (response.headers.get('Content-Type') || '').toLowerCase();

  if (contentType.includes('application/json')) {
    const data = await response.clone().json().catch(() => null);
    const embeddedStatusCode = data && typeof data === 'object' && typeof data.statusCode === 'number'
      ? data.statusCode
      : null;

    if (embeddedStatusCode && embeddedStatusCode >= 400) {
      const embeddedMessage = typeof data?.error === 'string'
        ? data.error
        : typeof data?.message === 'string'
          ? data.message
          : typeof data?.content === 'string' && data.content.trim()
            ? data.content
            : '';
      throw new Error(embeddedMessage || `Scraper proxy upstream failed (${embeddedStatusCode})`);
    }

    if (typeof data === 'string' && data.trim()) {
      return data;
    }

    if (data && typeof data.content === 'string' && data.content.trim()) {
      return data.content;
    }

    if (data && typeof data.contents === 'string' && data.contents.trim()) {
      return data.contents;
    }
  }

  const text = await response.text();
  if (text.trim()) {
    return text;
  }

  throw new Error('Empty scraper proxy response');
};

const createProxyAttempt = (provider: ScraperProvider): ProxyAttempt => {
  if (provider === 'localhost') {
    return {
      label: 'Localhost scraper',
      request: async (targetUrl, source) => {
        try {
          return await fetch(configuredLocalhostScraperUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: targetUrl, source }),
            credentials: 'omit',
          });
        } catch {
          throw new Error('Localhost scraper erişilemiyor. Önce `npm run scraper:local` çalıştırın.');
        }
      },
    };
  }

  if (provider === 'cloudflare') {
    if (!configuredCloudflareScraperUrl) {
      throw new Error('Cloudflare scraper proxy URL is not configured');
    }

    return {
      label: 'Cloudflare scraper proxy',
      request: (targetUrl) =>
        fetch(getNextScraperProxyUrl(), {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
          body: targetUrl,
          credentials: 'omit',
        }),
    };
  }

  if (!configuredSupabaseScraperUrl) {
    throw new Error('Supabase scraper proxy URL is not configured');
  }

  return {
    label: 'Supabase scraper proxy',
    request: async (targetUrl, source) => {
      const accessToken = await getCurrentAccessToken();
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };

      if (accessToken) {
        headers.Authorization = `Bearer ${accessToken}`;
      }

      return await fetch(configuredSupabaseScraperUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({ url: targetUrl, source }),
        credentials: 'omit',
      });
    },
  };
};

const createStructuredProxyAttempt = (provider: ScraperProvider): StructuredProxyAttempt => {
  if (provider === 'localhost') {
    return {
      label: 'Localhost scraper',
      request: async (payload, source) => {
        try {
          return await fetch(configuredLocalhostScraperUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...payload, source: payload.source ?? source }),
            credentials: 'omit',
          });
        } catch {
          throw new Error('Localhost scraper erişilemiyor. Önce `npm run scraper:local` çalıştırın.');
        }
      },
    };
  }

  if (provider === 'cloudflare') {
    if (!configuredCloudflareScraperUrl) {
      throw new Error('Cloudflare scraper proxy URL is not configured');
    }

    return {
      label: 'Cloudflare scraper proxy',
      request: (payload) =>
        fetch(getNextScraperProxyUrl(), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          credentials: 'omit',
        }),
    };
  }

  if (!configuredSupabaseScraperUrl) {
    throw new Error('Supabase scraper proxy URL is not configured');
  }

  return {
    label: 'Supabase scraper proxy',
    request: async (payload, source) => {
      const accessToken = await getCurrentAccessToken();
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };

      if (accessToken) {
        headers.Authorization = `Bearer ${accessToken}`;
      }

      return await fetch(configuredSupabaseScraperUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({ ...payload, source: payload.source ?? source }),
        credentials: 'omit',
      });
    },
  };
};

const fetchScraperResponse = async (
  targetUrl: string,
  options?: { provider?: ScraperProvider; source?: ScrapeSource }
) => {
  const provider = options?.provider ?? getDefaultScraperProviderForSource(options?.source ?? getDefaultScrapeSource());
  const errors: string[] = [];

  for (const providerToTry of getProviderAttemptOrder(provider, options?.source)) {
    const attempt = createProxyAttempt(providerToTry);

    try {
      const response = await attempt.request(targetUrl, options?.source);

      if (!response.ok) {
        throw new Error(`${attempt.label} failed (${response.status})`);
      }

      return response;
    } catch (error) {
      errors.push(error instanceof Error ? error.message : `${attempt.label} request failed`);
    }
  }

  throw new Error(errors.join(' | ') || 'Scraper proxy request failed');
};

const fetchStructuredScraperResponse = async (
  payload: ScraperProxyRequestPayload,
  options?: { provider?: ScraperProvider; source?: ScrapeSource }
) => {
  const provider = options?.provider ?? getDefaultScraperProviderForSource(options?.source ?? getDefaultScrapeSource());
  const errors: string[] = [];

  for (const providerToTry of getProviderAttemptOrder(provider, options?.source)) {
    const attempt = createStructuredProxyAttempt(providerToTry);

    try {
      const response = await attempt.request(payload, options?.source);

      if (!response.ok) {
        throw new Error(`${attempt.label} failed (${response.status})`);
      }

      return response;
    } catch (error) {
      errors.push(error instanceof Error ? error.message : `${attempt.label} request failed`);
    }
  }

  throw new Error(errors.join(' | ') || 'Scraper proxy request failed');
};

const getProviderAttemptOrder = (preferredProvider: ScraperProvider, source?: ScrapeSource) => {
  const availableProviders = getAvailableScraperProviders();
  const orderedProviders: ScraperProvider[] = [];
  const forcedFirstProvider = source === 'siyahmelek' && availableProviders.includes('localhost')
    ? 'localhost'
    : null;

  if (forcedFirstProvider) {
    orderedProviders.push(forcedFirstProvider);
  }

  if (availableProviders.includes(preferredProvider) && !orderedProviders.includes(preferredProvider)) {
    orderedProviders.push(preferredProvider);
  }

  for (const provider of availableProviders) {
    if (!orderedProviders.includes(provider)) {
      orderedProviders.push(provider);
    }
  }

  return orderedProviders;
};

export const fetchScraperContent = async (
  targetUrl: string,
  options?: { provider?: ScraperProvider; source?: ScrapeSource }
) => {
  const response = await fetchScraperResponse(targetUrl, options);
  return await readProxyResponse(response);
};

export const fetchScraperArrayBuffer = async (
  targetUrl: string,
  options?: { provider?: ScraperProvider; source?: ScrapeSource }
) => {
  const response = await fetchScraperResponse(targetUrl, options);
  return await response.arrayBuffer();
};

export const fetchScraperJson = async <T>(
  payload: ScraperProxyRequestPayload,
  options?: { provider?: ScraperProvider; source?: ScrapeSource }
): Promise<T> => {
  const response = await fetchStructuredScraperResponse(payload, options);
  return await response.json() as T;
};
