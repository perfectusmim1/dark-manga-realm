import { supabaseAnonKey } from '@/lib/supabase';

export const defaultOfflineImageProxyUrl = 'https://toonparrot-offline-image-proxy.caganhuseyinerdil.workers.dev';

export const configuredOfflineImageProxyUrls: string[] = (
  import.meta.env.VITE_OFFLINE_IMAGE_PROXY_URL?.trim() || defaultOfflineImageProxyUrl
)
  .split(',')
  .map((u) => u.trim().replace(/\/+$/, ''))
  .filter(Boolean);

let proxyIndex = 0;
export const getOfflineImageProxyUrl = (): string => {
  if (configuredOfflineImageProxyUrls.length === 0) return defaultOfflineImageProxyUrl;
  const url = configuredOfflineImageProxyUrls[proxyIndex % configuredOfflineImageProxyUrls.length];
  proxyIndex = (proxyIndex + 1) % configuredOfflineImageProxyUrls.length;
  return url;
};

export const offlineProxyConfig = {
  get url(): string {
    return getOfflineImageProxyUrl();
  },
  urls: configuredOfflineImageProxyUrls,
  defaultUrl: defaultOfflineImageProxyUrl,
  usesSupabaseAuth: Boolean(
    configuredOfflineImageProxyUrls[0] && configuredOfflineImageProxyUrls[0].includes('/functions/v1/')
  ),
  supabaseAnonKey,
};
