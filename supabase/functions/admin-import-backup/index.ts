import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createServiceClient, isPrimaryAdmin, json, requireRequester } from "../_shared/auth.ts";
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

const SENSITIVE_USER_FIELDS = new Set([
  "password_hash",
  "encrypted_password",
  "password_salt",
  "otp_secret",
  "mfa_secret",
  "recovery_token",
  "reset_token",
]);

const loadAllAuthUserIds = async (serviceClient: ReturnType<typeof createServiceClient>) => {
  const userIds = new Set<string>();
  let page = 1;

  while (true) {
    const { data, error } = await serviceClient.auth.admin.listUsers({
      page,
      perPage: 200,
    });

    if (error) {
      throw error;
    }

    const batch = data.users || [];
    for (const user of batch) {
      userIds.add(user.id);
    }

    if (batch.length < 200) {
      break;
    }

    page += 1;
  }

  return userIds;
};

const sanitizeBackupRow = (tableName: BackupTableName, row: unknown) => {
  if (!row || typeof row !== "object" || Array.isArray(row)) {
    return row;
  }

  if (tableName !== "users") {
    return row;
  }

  const sanitizedRow = { ...(row as Record<string, unknown>) };
  for (const field of SENSITIVE_USER_FIELDS) {
    delete sanitizedRow[field];
  }

  return sanitizedRow;
};

const sanitizeManifestForImport = (manifest: BackupManifest): BackupManifest => {
  const sanitizedTables = Object.fromEntries(
    BACKUP_TABLES.map((tableName) => {
      const rows = manifest.tables?.[tableName] || [];
      return [
        tableName,
        Array.isArray(rows)
          ? rows.map((row) => sanitizeBackupRow(tableName, row))
          : [],
      ];
    }),
  ) as Partial<Record<BackupTableName, unknown[]>>;

  return {
    ...manifest,
    tables: sanitizedTables,
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

    const authUserIds = await loadAllAuthUserIds(auth.serviceClient);
    const requiredUserIds = new Set<string>();

    for (const user of manifest.authManifest?.users || []) {
      if (user?.id) {
        requiredUserIds.add(user.id);
      }
    }

    for (const userRow of (manifest.tables?.users || []) as Array<{ id?: string }>) {
      if (userRow?.id) {
        requiredUserIds.add(userRow.id);
      }
    }

    const missingUserIds = [...requiredUserIds].filter((userId) => !authUserIds.has(userId));
    if (missingUserIds.length > 0) {
      return json({
        success: false,
        message: "Missing auth.users records for backup restore",
        missingUserIds,
      }, 400);
    }

    const sanitizedManifest = sanitizeManifestForImport(manifest);
    const { data: restoreResult, error: restoreError } = await auth.serviceClient.rpc(
      "restore_site_backup",
      {
        p_manifest: sanitizedManifest,
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
