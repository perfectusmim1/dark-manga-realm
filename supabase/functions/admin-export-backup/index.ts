import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createServiceClient, isPrimaryAdmin, json, requireRequester } from "../_shared/auth.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { BACKUP_CHUNK_SIZE, BACKUP_TABLES, BACKUP_VERSION, type BackupTableName } from "../_shared/backup.ts";

const loadAllRows = async (
  serviceClient: ReturnType<typeof createServiceClient>,
  tableName: BackupTableName,
) => {
  const rows: unknown[] = [];
  let from = 0;

  while (true) {
    const to = from + BACKUP_CHUNK_SIZE - 1;
    const { data, error } = await serviceClient
      .from(tableName)
      .select("*")
      .range(from, to);

    if (error) {
      throw error;
    }

    const batch = data || [];
    rows.push(...batch);

    if (batch.length < BACKUP_CHUNK_SIZE) {
      break;
    }

    from += BACKUP_CHUNK_SIZE;
  }

  return rows;
};

const loadBackupTables = async (
  serviceClient: ReturnType<typeof createServiceClient>,
) => {
  const tables: Partial<Record<BackupTableName, unknown[]>> = {};

  for (const tableName of BACKUP_TABLES) {
    try {
      tables[tableName] = await loadAllRows(serviceClient, tableName);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Backup export failed for table "${tableName}": ${message}`);
    }
  }

  return tables;
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
      return json({ success: false, message: "Only the primary admin can export backups" }, 403);
    }

    const tables = await loadBackupTables(auth.serviceClient);

    return json({
      success: true,
      manifest: {
        version: BACKUP_VERSION,
        exportedAt: new Date().toISOString(),
        exportedBy: {
          id: auth.requesterProfile.id,
          email: auth.requesterProfile.email,
        },
        authManifest: {
          totalUsers: 0,
          users: [],
        },
        tables,
      },
    });
  } catch (error) {
    console.error("Unexpected error in admin-export-backup:", error);
    return json({
      success: false,
      message: error instanceof Error ? error.message : "An unexpected error occurred",
    }, 500);
  }
});
