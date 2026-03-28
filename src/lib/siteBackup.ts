import { supabase } from '@/lib/supabase';
import { SiteBackupManifest } from '@/lib/types';

interface SiteBackupResponse {
  success?: boolean;
  message?: string;
  manifest?: SiteBackupManifest;
  restoredAt?: string;
  restoredTables?: string[];
}

const ensureSuccess = (data: SiteBackupResponse | null | undefined, fallback: string) => {
  if (!data?.success) {
    throw new Error(data?.message || fallback);
  }
};

export const exportSiteBackup = async (): Promise<SiteBackupManifest> => {
  const { data, error } = await supabase.functions.invoke('admin-export-backup', {
    body: {},
  });

  if (error) {
    throw error;
  }

  ensureSuccess(data, 'SITE_BACKUP_EXPORT_FAILED');
  return data.manifest as SiteBackupManifest;
};

export const importSiteBackup = async (
  manifest: SiteBackupManifest,
): Promise<{ restoredAt: string; restoredTables: string[] }> => {
  const { data, error } = await supabase.functions.invoke('admin-import-backup', {
    body: {
      manifest,
    },
  });

  if (error) {
    throw error;
  }

  ensureSuccess(data, 'SITE_BACKUP_IMPORT_FAILED');
  return {
    restoredAt: data.restoredAt as string,
    restoredTables: Array.isArray(data?.restoredTables) ? data.restoredTables : [],
  };
};
