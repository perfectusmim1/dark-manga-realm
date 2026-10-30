import { supabaseAnonKey, supabaseUrl } from '@/lib/supabase';

export const defaultOfflineImageProxyUrl = 'https://toonparrot-offline-image-proxy.caganhuseyinerdil.workers.dev';
const configuredProxyUrl = import.meta.env.VITE_OFFLINE_IMAGE_PROXY_URL?.trim();
const activeProxyUrl = configuredProxyUrl || defaultOfflineImageProxyUrl;

export const offlineProxyConfig = {
  url: activeProxyUrl,
  defaultUrl: defaultOfflineImageProxyUrl,
  usesSupabaseAuth: Boolean(activeProxyUrl && activeProxyUrl.includes('/functions/v1/')),
  supabaseAnonKey,
};

export const getOfflineImageProxyUrl = (): string => offlineProxyConfig.url;
