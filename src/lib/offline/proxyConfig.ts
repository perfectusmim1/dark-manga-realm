import { supabaseAnonKey, supabaseUrl } from '@/lib/supabase';

export const defaultOfflineImageProxyUrl = `${supabaseUrl}/functions/v1/offline-image-proxy`;
const configuredProxyUrl = import.meta.env.VITE_OFFLINE_IMAGE_PROXY_URL?.trim();

export const offlineProxyConfig = {
  url: configuredProxyUrl || defaultOfflineImageProxyUrl,
  defaultUrl: defaultOfflineImageProxyUrl,
  usesSupabaseAuth: !(configuredProxyUrl && configuredProxyUrl !== defaultOfflineImageProxyUrl),
  supabaseAnonKey,
};

export const getOfflineImageProxyUrl = (): string => offlineProxyConfig.url;
