import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createServiceClient, getAccessToken, json } from "../_shared/auth.ts";
import { corsHeaders } from "../_shared/cors.ts";

const sha256 = async (value: string) => {
  const encoded = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
};

const getIpAddress = (req: Request) => {
  const forwardedFor = req.headers.get("x-forwarded-for") ?? "";
  return forwardedFor.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
};

const normalizePath = (path?: string | null) => {
  const trimmed = path?.trim() || "/";
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
};

const isSupportAllowedPath = (path: string) =>
  path === "/auth"
  || path.startsWith("/auth?")
  || path === "/support"
  || path.startsWith("/support/");

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ allowed: false, message: "Unsupported method" }, 405);
  }

  try {
    const serviceClient = createServiceClient();

    let payload: {
      deviceHash?: string;
      deviceInstallationId?: string;
      path?: string;
    };

    try {
      payload = await req.json();
    } catch {
      payload = {};
    }

    const ipHash = await sha256(getIpAddress(req));
    const deviceHash = payload.deviceHash?.trim() || null;
    const installationIdHash = payload.deviceInstallationId?.trim()
      ? await sha256(payload.deviceInstallationId.trim())
      : null;
    const routePath = normalizePath(payload.path);

    const accessToken = getAccessToken(req);
    let authUserId: string | null = null;

    if (accessToken) {
      const { data: authData } = await serviceClient.auth.getUser(accessToken);
      authUserId = authData.user?.id || null;
    }

    if (authUserId) {
      await serviceClient.rpc("refresh_user_ban_state", {
        p_user_id: authUserId,
      }).catch((error) => {
        console.error("Failed to refresh user ban state:", error);
      });
    }

    const [
      { data: ipBan },
      { data: deviceBan },
      { data: userRecord },
      { data: latestWarning },
    ] = await Promise.all([
      serviceClient.from("banned_ip_hashes").select("ip_hash").eq("ip_hash", ipHash).maybeSingle(),
      deviceHash
        ? serviceClient.from("banned_device_hashes").select("device_hash").eq("device_hash", deviceHash).maybeSingle()
        : Promise.resolve({ data: null } as const),
      authUserId
        ? serviceClient
          .from("users")
          .select("id, username, email, role, is_banned, ban_reason, banned_at, active_ban_type, ban_expires_at, warning_count, unread_warning_count")
          .eq("id", authUserId)
          .maybeSingle()
        : Promise.resolve({ data: null } as const),
      authUserId
        ? serviceClient
          .from("user_warnings")
          .select("id, title, message, created_at")
          .eq("user_id", authUserId)
          .is("acknowledged_at", null)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle()
        : Promise.resolve({ data: null } as const),
    ]);

    if (ipBan) {
      return json({
        allowed: false,
        reason: "ip_banned",
        message: "Bu bağlantı için site erişimi engellendi.",
      }, 403);
    }

    if (deviceBan) {
      return json({
        allowed: false,
        reason: "device_banned",
        message: "Bu cihaz için site erişimi engellendi.",
      }, 403);
    }

    if (authUserId && deviceHash) {
      await serviceClient.from("user_access_fingerprints").upsert({
        user_id: authUserId,
        ip_hash: ipHash,
        device_hash: deviceHash,
        installation_id_hash: installationIdHash,
        user_agent: req.headers.get("user-agent"),
        last_seen_at: new Date().toISOString(),
      }, {
        onConflict: "user_id,ip_hash,device_hash",
        ignoreDuplicates: false,
      });
    }

    const warning = latestWarning
      ? {
        id: latestWarning.id,
        title: latestWarning.title,
        message: latestWarning.message,
        createdAt: latestWarning.created_at,
      }
      : null;

    if (userRecord?.is_banned) {
      const supportOnly = isSupportAllowedPath(routePath);
      const message = userRecord.ban_reason || "Hesabınız banlandı.";

      return json({
        allowed: supportOnly,
        reason: supportOnly ? "support_only" : "user_banned",
        supportOnly: true,
        message,
        ban: {
          active: true,
          type: userRecord.active_ban_type,
          reason: message,
          expiresAt: userRecord.ban_expires_at,
        },
        warning,
        user: {
          id: userRecord.id,
          username: userRecord.username,
          email: userRecord.email,
          role: userRecord.role,
          warningCount: userRecord.warning_count,
          unreadWarningCount: userRecord.unread_warning_count,
        },
      }, supportOnly ? 200 : 403);
    }

    return json({
      allowed: true,
      reason: "ok",
      supportOnly: false,
      warning,
      user: userRecord
        ? {
          id: userRecord.id,
          username: userRecord.username,
          email: userRecord.email,
          role: userRecord.role,
          warningCount: userRecord.warning_count,
          unreadWarningCount: userRecord.unread_warning_count,
        }
        : null,
    });
  } catch (error) {
    console.error("Unexpected error in check-access:", error);
    return json({ allowed: false, message: "An unexpected error occurred" }, 500);
  }
});
