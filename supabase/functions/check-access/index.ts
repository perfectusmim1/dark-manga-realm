import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createServiceClient, getAccessToken, json } from "../_shared/auth.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { getJwtClaims, getIpAddress, sha256Hex, upsertUserSessionMetadata } from "../_shared/session-tracking.ts";

const normalizePath = (path?: string | null) => {
  const trimmed = path?.trim() || "/";
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
};

const isSupportAllowedPath = (path: string) =>
  path === "/auth"
  || path.startsWith("/auth?")
  || path === "/support"
  || path.startsWith("/support/");

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const shouldRetryAuthResolution = (message?: string | null) => {
  const normalizedMessage = message?.toLowerCase() || "";
  return normalizedMessage.includes("future")
    || normalizedMessage.includes("not yet valid")
    || normalizedMessage.includes("jwt")
    || normalizedMessage.includes("token")
    || normalizedMessage.includes("iat");
};

const resolveAuthUserId = async (
  serviceClient: ReturnType<typeof createServiceClient>,
  accessToken: string,
) => {
  for (const retryDelay of [0, 1200]) {
    if (retryDelay > 0) {
      await sleep(retryDelay);
    }

    try {
      const { data: authData, error: authError } = await serviceClient.auth.getUser(accessToken);
      if (!authError) {
        return authData.user?.id || null;
      }

      if (retryDelay === 0 && shouldRetryAuthResolution(authError.message)) {
        continue;
      }

      console.warn("check-access token resolution failed:", authError.message);
      return null;
    } catch (error) {
      if (retryDelay === 0) {
        continue;
      }

      console.warn("check-access token resolution threw unexpectedly:", error);
      return null;
    }
  }

  return null;
};

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

    const ipHash = await sha256Hex(getIpAddress(req));
    const deviceHash = payload.deviceHash?.trim() || null;
    const installationIdHash = payload.deviceInstallationId?.trim()
      ? await sha256Hex(payload.deviceInstallationId.trim())
      : null;
    const routePath = normalizePath(payload.path);

    const accessToken = getAccessToken(req);
    let authUserId: string | null = null;
    const currentSessionId = accessToken ? getJwtClaims(accessToken)?.sessionId ?? null : null;

    if (accessToken) {
      authUserId = await resolveAuthUserId(serviceClient, accessToken);
    }

    const [
      { data: ipBan },
      { data: deviceBan },
    ] = await Promise.all([
      serviceClient.from("banned_ip_hashes").select("ip_hash").eq("ip_hash", ipHash).maybeSingle(),
      deviceHash
        ? serviceClient.from("banned_device_hashes").select("device_hash").eq("device_hash", deviceHash).maybeSingle()
        : Promise.resolve({ data: null } as const),
    ]);

    if (ipBan) {
      return json({
        allowed: false,
        reason: "ip_banned",
        message: "Bu bağlantı için site erişimi engellendi.",
      }, 200);
    }

    if (deviceBan) {
      return json({
        allowed: false,
        reason: "device_banned",
        message: "Bu cihaz için site erişimi engellendi.",
      }, 200);
    }

    let userRecord: {
      id: string;
      username: string;
      email: string;
      role: string;
      is_banned: boolean;
      ban_reason: string | null;
      banned_at: string | null;
      active_ban_type: string | null;
      ban_expires_at: string | null;
      warning_count: number;
      unread_warning_count: number;
    } | null = null;
    let latestWarning: {
      id: string;
      title: string;
      message: string;
      created_at: string;
    } | null = null;

    if (authUserId) {
      try {
        const { error: banRefreshError } = await serviceClient.rpc("refresh_user_ban_state", {
          p_user_id: authUserId,
        });
        if (banRefreshError) {
          console.error("Failed to refresh user ban state:", banRefreshError);
        }

        const [
          userRecordResult,
          latestWarningResult,
          fingerprintResult,
          sessionMetadataResult,
        ] = await Promise.all([
          serviceClient
            .from("users")
            .select("id, username, email, role, is_banned, ban_reason, banned_at, active_ban_type, ban_expires_at, warning_count, unread_warning_count")
            .eq("id", authUserId)
            .maybeSingle(),
          serviceClient
            .from("user_warnings")
            .select("id, title, message, created_at")
            .eq("user_id", authUserId)
            .is("acknowledged_at", null)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle(),
          deviceHash
            ? serviceClient.from("user_access_fingerprints").upsert({
              user_id: authUserId,
              ip_hash: ipHash,
              device_hash: deviceHash,
              installation_id_hash: installationIdHash,
              user_agent: req.headers.get("user-agent"),
              last_seen_at: new Date().toISOString(),
            }, {
              onConflict: "user_id,ip_hash,device_hash",
              ignoreDuplicates: false,
            })
            : Promise.resolve({ error: null } as const),
          currentSessionId
            ? upsertUserSessionMetadata(serviceClient, {
              userId: authUserId,
              sessionId: currentSessionId,
              userAgent: req.headers.get("user-agent"),
              request: req,
            }).then(() => ({ error: null } as const)).catch((error) => ({ error } as const))
            : Promise.resolve({ error: null } as const),
        ]);

        if (userRecordResult.error) {
          console.error("check-access user profile lookup failed:", userRecordResult.error);
        } else {
          userRecord = userRecordResult.data;
        }

        if (latestWarningResult.error) {
          console.error("check-access warning lookup failed:", latestWarningResult.error);
        } else {
          latestWarning = latestWarningResult.data;
        }

        if (fingerprintResult.error) {
          console.error("check-access fingerprint upsert failed:", fingerprintResult.error);
        }

        if (sessionMetadataResult.error) {
          console.error("check-access session metadata upsert failed:", sessionMetadataResult.error);
        }
      } catch (error) {
        console.error("Authenticated access evaluation failed:", error);
        return json({
          allowed: isSupportAllowedPath(routePath),
          reason: "access_check_failed",
          message: isSupportAllowedPath(routePath)
            ? undefined
            : "Erişim güvenliği kontrol edilemedi. Lütfen kısa süre sonra tekrar deneyin.",
          supportOnly: false,
          warning: null,
          ban: { active: false },
          user: null,
        });
      }
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
          type: userRecord.active_ban_type || null,
          reason: message,
          expiresAt: userRecord.ban_expires_at || null,
          bannedAt: userRecord.banned_at || null,
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
      }, 200);
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
