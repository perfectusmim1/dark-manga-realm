import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createServiceClient, json, requireRequester } from "../_shared/auth.ts";
import { corsHeaders } from "../_shared/cors.ts";

type BanKind = "timed" | "permanent" | "hard";

const normalizeBanKind = (value?: string | null): BanKind | null => {
  if (!value) {
    return null;
  }

  if (value === "user") {
    return "permanent";
  }

  if (value === "timed" || value === "permanent" || value === "hard") {
    return value;
  }

  return null;
};

const loadTargetUser = async (
  serviceClient: ReturnType<typeof createServiceClient>,
  userId: string,
) => {
  const { data, error } = await serviceClient
    .from("users")
    .select("id, username, email, role, avatar, is_banned, ban_reason, banned_at, created_at, last_seen_at, warning_count, unread_warning_count, active_ban_type, ban_expires_at")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data;
};

const loadUserHistory = async (
  serviceClient: ReturnType<typeof createServiceClient>,
  userId: string,
) => {
  const [user, warningsResult, bansResult] = await Promise.all([
    loadTargetUser(serviceClient, userId),
    serviceClient
      .from("user_warnings")
      .select("id, title, message, created_at, acknowledged_at, issued_by")
      .eq("user_id", userId)
      .order("created_at", { ascending: false }),
    serviceClient
      .from("user_bans")
      .select("id, kind, reason, created_at, expires_at, revoked_at, issued_by, revoked_by, warning_id, metadata")
      .eq("user_id", userId)
      .order("created_at", { ascending: false }),
  ]);

  if (warningsResult.error) {
    throw warningsResult.error;
  }

  if (bansResult.error) {
    throw bansResult.error;
  }

  const issuerIds = [
    ...new Set([
      ...(warningsResult.data || []).map((warning) => warning.issued_by).filter(Boolean),
      ...(bansResult.data || []).flatMap((ban) => [ban.issued_by, ban.revoked_by]).filter(Boolean),
    ]),
  ] as string[];

  const issuerMap = new Map<string, string>();
  if (issuerIds.length > 0) {
    const { data: issuers, error: issuersError } = await serviceClient
      .from("users")
      .select("id, username")
      .in("id", issuerIds);

    if (issuersError) {
      throw issuersError;
    }

    for (const issuer of issuers || []) {
      issuerMap.set(issuer.id, issuer.username);
    }
  }

  return {
    user: user
      ? {
        id: user.id,
        username: user.username,
        email: user.email,
        avatar: user.avatar,
        role: user.role,
        isBanned: user.is_banned,
        banReason: user.ban_reason,
        bannedAt: user.banned_at,
        createdAt: user.created_at,
        lastSeenAt: user.last_seen_at,
        warningCount: user.warning_count,
        unreadWarningCount: user.unread_warning_count,
        activeBanType: user.active_ban_type,
        banExpiresAt: user.ban_expires_at,
      }
      : null,
    warnings: (warningsResult.data || []).map((warning) => ({
      id: warning.id,
      title: warning.title,
      message: warning.message,
      createdAt: warning.created_at,
      acknowledgedAt: warning.acknowledged_at,
      issuedBy: warning.issued_by,
      issuedByName: warning.issued_by ? issuerMap.get(warning.issued_by) || null : null,
    })),
    bans: (bansResult.data || []).map((ban) => ({
      id: ban.id,
      kind: ban.kind,
      reason: ban.reason,
      createdAt: ban.created_at,
      expiresAt: ban.expires_at,
      revokedAt: ban.revoked_at,
      issuedBy: ban.issued_by,
      issuedByName: ban.issued_by ? issuerMap.get(ban.issued_by) || null : null,
      revokedBy: ban.revoked_by,
      revokedByName: ban.revoked_by ? issuerMap.get(ban.revoked_by) || null : null,
      warningId: ban.warning_id,
      metadata: ban.metadata || {},
    })),
  };
};

const revokeActiveBans = async (
  serviceClient: ReturnType<typeof createServiceClient>,
  userId: string,
  requesterId: string,
) => {
  const now = new Date().toISOString();
  const { error } = await serviceClient
    .from("user_bans")
    .update({
      revoked_at: now,
      revoked_by: requesterId,
    })
    .eq("user_id", userId)
    .is("revoked_at", null);

  if (error) {
    throw error;
  }
};

const formatDateTimeTr = (value?: string | null) => {
  if (!value) {
    return null;
  }

  return new Intl.DateTimeFormat("tr-TR", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Istanbul",
  }).format(new Date(value));
};

const createSystemNotification = async (
  serviceClient: ReturnType<typeof createServiceClient>,
  options: {
    userId: string;
    title: string;
    message: string;
    link?: string | null;
  },
) => {
  const { error } = await serviceClient
    .from("notifications")
    .insert({
      user_id: options.userId,
      type: "system",
      title: options.title,
      message: options.message,
      link: options.link || null,
      read: false,
      created_at: new Date().toISOString(),
    });

  if (error) {
    console.error("System notification insert failed:", error);
  }
};

const createBan = async (
  serviceClient: ReturnType<typeof createServiceClient>,
  options: {
    requesterId: string;
    targetUserId: string;
    kind: BanKind;
    reason: string;
    durationHours?: number | null;
    warningId?: string | null;
    metadata?: Record<string, unknown>;
  },
) => {
  await revokeActiveBans(serviceClient, options.targetUserId, options.requesterId);

  const now = new Date();
  const expiresAt = options.kind === "timed" && options.durationHours
    ? new Date(now.getTime() + (options.durationHours * 60 * 60 * 1000)).toISOString()
    : null;

  const { error } = await serviceClient
    .from("user_bans")
    .insert({
      user_id: options.targetUserId,
      issued_by: options.requesterId,
      warning_id: options.warningId || null,
      kind: options.kind,
      reason: options.reason,
      expires_at: expiresAt,
      metadata: options.metadata || {},
      created_at: now.toISOString(),
    });

  if (error) {
    throw error;
  }

  if (options.kind === "hard") {
    const { data: fingerprints, error: fingerprintError } = await serviceClient
      .from("user_access_fingerprints")
      .select("ip_hash, device_hash")
      .eq("user_id", options.targetUserId);

    if (fingerprintError) {
      throw fingerprintError;
    }

    const ipHashes = [...new Set((fingerprints || []).map((entry) => entry.ip_hash).filter(Boolean))];
    const deviceHashes = [...new Set((fingerprints || []).map((entry) => entry.device_hash).filter(Boolean))];

    if (ipHashes.length > 0) {
      const { error: ipError } = await serviceClient
        .from("banned_ip_hashes")
        .upsert(ipHashes.map((ipHash) => ({
          ip_hash: ipHash,
          user_id: options.targetUserId,
          reason: options.reason,
          banned_by: options.requesterId,
        })), {
          onConflict: "ip_hash",
          ignoreDuplicates: false,
        });

      if (ipError) {
        throw ipError;
      }
    }

    if (deviceHashes.length > 0) {
      const { error: deviceError } = await serviceClient
        .from("banned_device_hashes")
        .upsert(deviceHashes.map((deviceHash) => ({
          device_hash: deviceHash,
          user_id: options.targetUserId,
          reason: options.reason,
          banned_by: options.requesterId,
        })), {
          onConflict: "device_hash",
          ignoreDuplicates: false,
        });

      if (deviceError) {
        throw deviceError;
      }
    }
  }

  await serviceClient.rpc("refresh_user_ban_state", {
    p_user_id: options.targetUserId,
  });

  const banLabel = options.kind === "timed"
    ? "Süreli Ban"
    : options.kind === "hard"
      ? "Hard Ban"
      : "Kalıcı Ban";
  const expiresAtLabel = formatDateTimeTr(expiresAt);
  const banNotificationParts = [
    `Hesabınıza yönetim tarafından ${banLabel.toLocaleLowerCase("tr-TR")} uygulandı.`,
    `Gerekçe: ${options.reason}`,
  ];

  if (expiresAtLabel) {
    banNotificationParts.push(`Ban bitişi: ${expiresAtLabel}.`);
  }

  banNotificationParts.push("İtiraz göndermek isterseniz destek sayfasını kullanabilirsiniz.");

  await createSystemNotification(serviceClient, {
    userId: options.targetUserId,
    title: `${banLabel} Uygulandı`,
    message: banNotificationParts.join(" "),
    link: "/support",
  });

  return {
    kind: options.kind,
    expiresAt,
  };
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ success: false, message: "Unsupported method" }, 405);
  }

  try {
    const auth = await requireRequester(req, ["admin", "moderator"]);
    if (!auth.ok) {
      return auth.response;
    }

    let payload: {
      action?: string;
      targetUserId?: string;
      title?: string;
      message?: string;
      reason?: string;
      kind?: string;
      durationHours?: number;
    } = {};

    try {
      payload = await req.json();
    } catch {
      payload = {};
    }

    const action = payload.action || "history";
    const targetUserId = payload.targetUserId?.trim();

    if (!targetUserId) {
      return json({ success: false, message: "targetUserId is required" }, 400);
    }

    const targetUser = await loadTargetUser(auth.serviceClient, targetUserId);
    if (!targetUser) {
      return json({ success: false, message: "Kullanıcı bulunamadı" }, 404);
    }

    if (targetUser.id === auth.requesterProfile.id) {
      return json({ success: false, message: "Kendi hesabınıza işlem uygulayamazsınız" }, 400);
    }

    if (targetUser.role === "admin" || targetUser.role === "moderator") {
      return json({ success: false, message: "Yetkili hesaplara bu işlem uygulanamaz" }, 400);
    }

    if (action === "history") {
      const history = await loadUserHistory(auth.serviceClient, targetUserId);
      return json({ success: true, ...history });
    }

    if (action === "warn") {
      const title = payload.title?.trim() || "Yönetici uyarısı";
      const message = payload.message?.trim() || payload.reason?.trim() || "";
      const durationHours = Number(payload.durationHours || 0);

      if (!message) {
        return json({ success: false, message: "Uyarı mesajı zorunlu" }, 400);
      }

      const { data: warning, error: warningError } = await auth.serviceClient
        .from("user_warnings")
        .insert({
          user_id: targetUserId,
          issued_by: auth.requesterProfile.id,
          title,
          message,
        })
        .select("id")
        .single();

      if (warningError || !warning) {
        console.error("Warning insert failed:", warningError);
        return json({ success: false, message: "Uyarı kaydedilemedi" }, 500);
      }

      await auth.serviceClient.rpc("refresh_user_warning_summary", {
        p_user_id: targetUserId,
      });

      const latestTargetUser = await loadTargetUser(auth.serviceClient, targetUserId);
      const warningCount = Math.max(1, latestTargetUser?.warning_count || 0);
      const remainingWarnings = Math.max(0, 3 - warningCount);
      let autoBan: { kind: BanKind; expiresAt: string | null } | null = null;

      if ((latestTargetUser?.warning_count || 0) >= 3) {
        autoBan = await createBan(auth.serviceClient, {
          requesterId: auth.requesterProfile.id,
          targetUserId,
          kind: "permanent",
          reason: "3 uyarı sınırı aşıldığı için kalıcı ban uygulandı.",
          warningId: warning.id,
          metadata: {
            source: "warning_limit",
          },
        });
      } else if (durationHours > 0) {
        autoBan = await createBan(auth.serviceClient, {
          requesterId: auth.requesterProfile.id,
          targetUserId,
          kind: "timed",
          reason: message,
          durationHours,
          warningId: warning.id,
          metadata: {
            source: "warning_with_timed_ban",
          },
        });
      }

      const warningNotificationParts = [
        "Hesabınıza yönetim tarafından bir uyarı gönderildi.",
        `Toplam uyarı sayınız ${warningCount}/3.`,
      ];

      if (remainingWarnings > 0) {
        warningNotificationParts.push(`${remainingWarnings} uyarı daha alırsanız hesabınız kalıcı olarak banlanacaktır.`);
      } else if (autoBan?.kind) {
        warningNotificationParts.push("Bu uyarı sonrası hesabınıza kalıcı ban uygulandı.");
      }

      if (durationHours > 0) {
        warningNotificationParts.push(`Bu uyarıyla birlikte ${durationHours} saatlik süreli ban da uygulandı.`);
      }

      warningNotificationParts.push(`Detay: ${message}`);

      await createSystemNotification(auth.serviceClient, {
        userId: targetUserId,
        title: title === "Yönetici uyarısı" ? "Hesabınıza Uyarı Verildi" : title,
        message: warningNotificationParts.join(" "),
        link: null,
      });

      const history = await loadUserHistory(auth.serviceClient, targetUserId);
      return json({
        success: true,
        warningId: warning.id,
        autoBan,
        ...history,
      });
    }

    if (action === "ban") {
      const reason = payload.reason?.trim() || "Yönetici tarafından banlandı.";
      const kind = normalizeBanKind(payload.kind);
      const durationHours = Number(payload.durationHours || 0);

      if (!kind) {
        return json({ success: false, message: "Geçersiz ban türü" }, 400);
      }

      if (kind === "timed" && (!Number.isFinite(durationHours) || durationHours <= 0)) {
        return json({ success: false, message: "Süreli ban için pozitif saat değeri gerekli" }, 400);
      }

      const ban = await createBan(auth.serviceClient, {
        requesterId: auth.requesterProfile.id,
        targetUserId,
        kind,
        reason,
        durationHours,
        metadata: {
          source: "manual_ban",
        },
      });

      const history = await loadUserHistory(auth.serviceClient, targetUserId);
      return json({
        success: true,
        ban,
        ...history,
      });
    }

    if (action === "unban") {
      await revokeActiveBans(auth.serviceClient, targetUserId, auth.requesterProfile.id);

      await Promise.all([
        auth.serviceClient.from("banned_ip_hashes").delete().eq("user_id", targetUserId),
        auth.serviceClient.from("banned_device_hashes").delete().eq("user_id", targetUserId),
      ]);

      await auth.serviceClient.rpc("refresh_user_ban_state", {
        p_user_id: targetUserId,
      });

      const history = await loadUserHistory(auth.serviceClient, targetUserId);
      return json({
        success: true,
        ...history,
      });
    }

    return json({ success: false, message: "Unknown action" }, 400);
  } catch (error) {
    console.error("Unexpected error in admin-user-access:", error);
    return json({ success: false, message: "An unexpected error occurred" }, 500);
  }
});
