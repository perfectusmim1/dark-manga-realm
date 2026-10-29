import { invokeAuthenticatedFunction } from '@/lib/supabase';
import { SiteBackupManifest } from '@/lib/types';
import {
  R2_CATALOG_TABLES,
  exportAllCatalogTables,
  importAllCatalogTables,
} from '@/lib/r2CatalogClient';

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
  let baseManifest: SiteBackupManifest;

  try {
    const data = await invokeAuthenticatedFunction<SiteBackupResponse>('admin-export-backup', {});
    ensureSuccess(data, 'SITE_BACKUP_EXPORT_FAILED');
    baseManifest = data.manifest as SiteBackupManifest;
  } catch (err) {
    console.warn('Supabase admin-export-backup failed or unavailable, creating fallback manifest:', err);
    baseManifest = {
      version: 1,
      exportedAt: new Date().toISOString(),
      exportedBy: { id: 'admin', email: 'admin@toonparrot.com' },
      authManifest: { totalUsers: 0, users: [] },
      tables: {},
    };
  }

  // Export and merge all R2 catalog tables
  const catalogTables = await exportAllCatalogTables();
  baseManifest.tables = {
    ...(baseManifest.tables || {}),
    ...catalogTables,
  };

  return baseManifest;
};

export const importSiteBackup = async (
  manifest: SiteBackupManifest,
): Promise<{ restoredAt: string; restoredTables: string[] }> => {
  const restoredTables: string[] = [];
  const now = new Date().toISOString();

  // 1. Separate R2 catalog tables from Supabase tables
  const catalogTablesToImport: Record<string, any[]> = {};
  const supabaseTablesToImport: Record<string, any[]> = {};

  if (manifest?.tables && typeof manifest.tables === 'object') {
    for (const [tbl, rows] of Object.entries(manifest.tables)) {
      if (R2_CATALOG_TABLES.has(tbl) && Array.isArray(rows)) {
        catalogTablesToImport[tbl] = rows;
      } else {
        supabaseTablesToImport[tbl] = rows;
      }
    }
  }

  // 2. Restore R2 catalog tables
  if (Object.keys(catalogTablesToImport).length > 0) {
    await importAllCatalogTables(catalogTablesToImport);
    restoredTables.push(...Object.keys(catalogTablesToImport));
  }

  // 3. Restore Supabase user/auth tables if any exist
  let restoredAt = now;
  if (Object.keys(supabaseTablesToImport).length > 0 || (manifest.authManifest?.users?.length || 0) > 0) {
    try {
      const supabaseManifest: SiteBackupManifest = {
        ...manifest,
        tables: supabaseTablesToImport,
      };

      const data = await invokeAuthenticatedFunction<SiteBackupResponse>('admin-import-backup', {
        manifest: supabaseManifest,
      });

      if (data?.success) {
        restoredAt = data.restoredAt || now;
        if (Array.isArray(data.restoredTables)) {
          restoredTables.push(...data.restoredTables);
        }
      }
    } catch (err) {
      console.warn('Supabase admin-import-backup warning:', err);
    }
  }

  return {
    restoredAt,
    restoredTables: [...new Set(restoredTables)],
  };
};
