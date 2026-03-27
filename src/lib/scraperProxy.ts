import { supabaseUrl } from '@/lib/supabase';

const configuredCloudflareScraperUrl = import.meta.env.VITE_SCRAPER_PROXY_URL?.trim() || '';
const configuredSupabaseScraperUrl = supabaseUrl
  ? `${supabaseUrl}/functions/v1/proxy-scraper`
  : '';

const SCRAPER_PROVIDER_STORAGE_KEY = 'toonparrot:scraper-provider';

export type ScraperProvider = 'cloudflare' | 'supabase';

const SCRAPER_PROVIDER_LABELS: Record<ScraperProvider, string> = {
  cloudflare: 'Cloudflare',
  supabase: 'Supabase',
};

interface ProxyAttempt {
  label: string;
  request: (targetUrl: string) => Promise<Response>;
}

export const isScraperProvider = (value: string): value is ScraperProvider => (
  value === 'cloudflare' || value === 'supabase'
);

export const getScraperProviderLabel = (provider: ScraperProvider) => (
  SCRAPER_PROVIDER_LABELS[provider]
);

export const getAvailableScraperProviders = (): ScraperProvider[] => {
  const providers: ScraperProvider[] = [];

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

  throw new Error('No scraper provider configured');
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
  if (provider === 'cloudflare') {
    if (!configuredCloudflareScraperUrl) {
      throw new Error('Cloudflare scraper proxy URL is not configured');
    }

    return {
      label: 'Cloudflare scraper proxy',
      request: (targetUrl) =>
        fetch(configuredCloudflareScraperUrl, {
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
    request: (targetUrl) =>
      fetch(configuredSupabaseScraperUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: targetUrl }),
        credentials: 'omit',
      }),
  };
};

export const fetchScraperContent = async (
  targetUrl: string,
  options?: { provider?: ScraperProvider }
) => {
  const provider = options?.provider ?? readPreferredScraperProvider();
  const attempt = createProxyAttempt(provider);

  try {
    const response = await attempt.request(targetUrl);

    if (!response.ok) {
      throw new Error(`${attempt.label} failed (${response.status})`);
    }

    return await readProxyResponse(response);
  } catch (error) {
    if (error instanceof Error) {
      throw error;
    }

    throw new Error(`${attempt.label} request failed`);
  }
};
