import { supabase } from '@/lib/supabase';

export interface SiteSecuritySettings {
  devtoolsProtectionEnabled: boolean;
  adblockWarningEnabled: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
}

const SITE_SECURITY_EVENT = 'site-security-settings-updated';

const normalizeSiteSecuritySettings = (payload: any): SiteSecuritySettings => ({
  devtoolsProtectionEnabled: Boolean(payload?.devtools_protection_enabled),
  adblockWarningEnabled: Boolean(payload?.adblock_warning_enabled),
  updatedAt: payload?.updated_at ?? null,
  updatedBy: payload?.updated_by ?? null,
});

export const getSiteSecuritySettings = async (): Promise<SiteSecuritySettings> => {
  const { data, error } = await supabase.rpc('get_site_security_settings');

  if (error) {
    throw error;
  }

  const row = Array.isArray(data) ? data[0] : data;
  return normalizeSiteSecuritySettings(row);
};

export const setDevtoolsProtectionEnabled = async (
  enabled: boolean
): Promise<SiteSecuritySettings> => {
  const { data, error } = await supabase.rpc('admin_set_devtools_protection', {
    p_enabled: enabled,
  });

  if (error) {
    throw error;
  }

  const row = Array.isArray(data) ? data[0] : data;
  const normalized = normalizeSiteSecuritySettings(row);
  notifySiteSecuritySettingsUpdated(normalized);
  return normalized;
};

export const setAdblockWarningEnabled = async (
  enabled: boolean
): Promise<SiteSecuritySettings> => {
  const { data, error } = await supabase.rpc('admin_set_adblock_warning_enabled', {
    p_enabled: enabled,
  });

  if (error) {
    throw error;
  }

  const row = Array.isArray(data) ? data[0] : data;
  const normalized = normalizeSiteSecuritySettings(row);
  notifySiteSecuritySettingsUpdated(normalized);
  return normalized;
};

export const notifySiteSecuritySettingsUpdated = (
  settings: SiteSecuritySettings
): void => {
  if (typeof window === 'undefined') {
    return;
  }

  window.dispatchEvent(
    new CustomEvent<SiteSecuritySettings>(SITE_SECURITY_EVENT, {
      detail: settings,
    })
  );
};

export const subscribeToSiteSecuritySettings = (
  callback: (settings: SiteSecuritySettings) => void
): (() => void) => {
  if (typeof window === 'undefined') {
    return () => undefined;
  }

  const handler = (event: Event) => {
    const customEvent = event as CustomEvent<SiteSecuritySettings>;
    callback(customEvent.detail);
  };

  window.addEventListener(SITE_SECURITY_EVENT, handler);

  return () => {
    window.removeEventListener(SITE_SECURITY_EVENT, handler);
  };
};
