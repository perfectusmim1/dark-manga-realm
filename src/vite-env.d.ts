/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  readonly VITE_OFFLINE_IMAGE_PROXY_URL?: string;
  readonly VITE_SCRAPER_PROXY_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
