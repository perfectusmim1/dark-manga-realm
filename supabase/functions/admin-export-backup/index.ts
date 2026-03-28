import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createServiceClient, isPrimaryAdmin, json, requireRequester } from "../_shared/auth.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { BACKUP_CHUNK_SIZE, BACKUP_TABLES, BACKUP_VERSION, type BackupTableName } from "../_shared/backup.ts";

const USERS_BACKUP_SELECT = [
  "id",
  "username",
  "email",
  "avatar",
  "role",
  "created_at",
  "preferences",
  "two_factor_enabled",
  "last_seen_at",
  "is_banned",
  "ban_reason",
  "banned_at",
  "banned_by",
  "username_last_changed_at",
  "warning_count",
  "unread_warning_count",
  "last_warning_at",
  "active_ban_type",
  "ban_expires_at",
].join(", ");

const loadAllRows = async (
  serviceClient: ReturnType<typeof createServiceClient>,
  tableName: BackupTableName,
) => {
  const rows: unknown[] = [];
  let from = 0;
  const selectColumns = tableName === "users" ? USERS_BACKUP_SELECT : "*";

  while (true) {
    const to = from + BACKUP_CHUNK_SIZE - 1;
    const { data, error } = await serviceClient
      .from(tableName)
      .select(selectColumns)
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

const loadAllAuthUsers = async (
  serviceClient: ReturnType<typeof createServiceClient>,
) => {
  const users: Array<Record<string, unknown>> = [];
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
    users.push(...batch.map((user) => ({
      id: user.id,
      email: user.email || null,
      role: user.user_metadata?.role || user.app_metadata?.role || "user",
      createdAt: user.created_at || null,
      lastSignInAt: user.last_sign_in_at || null,
      emailConfirmedAt: user.email_confirmed_at || null,
    })));

    if (batch.length < 200) {
      break;
    }

    page += 1;
  }

  return users;
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

    const authUsers = await loadAllAuthUsers(auth.serviceClient);

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
          totalUsers: authUsers.length,
          users: authUsers,
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
