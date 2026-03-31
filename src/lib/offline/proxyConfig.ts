import { supabaseAnonKey, supabaseUrl } from '@/lib/supabase';

export const defaultOfflineImageProxyUrl = `${supabaseUrl}/functions/v1/offline-image-proxy`;
const configuredProxyUrl = import.meta.env.VITE_OFFLINE_IMAGE_PROXY_URL?.trim();
const configuredProxyToken = import.meta.env.VITE_OFFLINE_IMAGE_PROXY_TOKEN?.trim();

export const offlineProxyConfig = {
  url: configuredProxyUrl || defaultOfflineImageProxyUrl,
  defaultUrl: defaultOfflineImageProxyUrl,
  token: configuredProxyToken || null,
  usesSupabaseAuth: !(configuredProxyUrl && configuredProxyUrl !== defaultOfflineImageProxyUrl),
  supabaseAnonKey,
};
