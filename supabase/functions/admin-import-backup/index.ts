import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { isPrimaryAdmin, json, requireRequester } from "../_shared/auth.ts";
import { corsHeaders } from "../_shared/cors.ts";
import {
  BACKUP_TABLES,
  BACKUP_VERSION,
  type BackupTableName,
} from "../_shared/backup.ts";

type BackupManifest = {
  version: number;
  exportedAt?: string;
  authManifest?: {
    totalUsers?: number;
    users?: Array<{ id?: string; email?: string | null }>;
  };
  tables?: Partial<Record<BackupTableName, unknown[]>>;
};

type RestoreSiteBackupResult = {
  restoredAt?: string;
  restoredTables?: string[];
};

const normalizeManifestForImport = (manifest: BackupManifest): BackupManifest => {
  const normalizedTables = Object.fromEntries(
    BACKUP_TABLES.flatMap((tableName) => {
      if (!manifest.tables || !(tableName in manifest.tables)) {
        return [];
      }

      const rows = manifest.tables[tableName];
      return [[tableName, Array.isArray(rows) ? rows : []] as const];
    }),
  ) as Partial<Record<BackupTableName, unknown[]>>;

  return {
    ...manifest,
    tables: normalizedTables,
  };
};

const validateManifest = (manifest: BackupManifest) => {
  if (!manifest || typeof manifest !== "object") {
    throw new Error("Manifest is required");
  }

  if (manifest.version !== BACKUP_VERSION) {
    throw new Error(`Unsupported backup version: ${manifest.version}`);
  }

  if (!manifest.tables || typeof manifest.tables !== "object") {
    throw new Error("Manifest tables payload is required");
  }

  for (const tableName of BACKUP_TABLES) {
    const value = manifest.tables[tableName];
    if (value !== undefined && !Array.isArray(value)) {
      throw new Error(`Table payload must be an array: ${tableName}`);
    }
  }
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ success: false, message: "Unsupported method" }, 405);
  }

  try {
    const auth = await requireRequester(req, ["admin"]);
    if (!auth.ok) {
      return auth.response;
    }

    if (!isPrimaryAdmin(auth.requesterProfile)) {
      return json({ success: false, message: "Only the primary admin can import backups" }, 403);
    }

    let payload: { manifest?: BackupManifest } = {};
    try {
      payload = await req.json();
    } catch {
      payload = {};
    }

    const manifest = payload.manifest;
    if (!manifest) {
      return json({ success: false, message: "manifest is required" }, 400);
    }

    validateManifest(manifest);
    const normalizedManifest = normalizeManifestForImport(manifest);
    const { data: restoreResult, error: restoreError } = await auth.serviceClient.rpc(
      "restore_site_backup",
      {
        p_manifest: normalizedManifest,
      },
    );

    if (restoreError) {
      throw restoreError;
    }

    return json({
      success: true,
      restoredAt: (restoreResult as RestoreSiteBackupResult | null)?.restoredAt || new Date().toISOString(),
      restoredTables: Array.isArray((restoreResult as RestoreSiteBackupResult | null)?.restoredTables)
        ? (restoreResult as RestoreSiteBackupResult).restoredTables
        : BACKUP_TABLES,
    });
  } catch (error) {
    console.error("Unexpected error in admin-import-backup:", error);
    return json({
      success: false,
      message: error instanceof Error ? error.message : "An unexpected error occurred",
    }, 500);
  }
});
