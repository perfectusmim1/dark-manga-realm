import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createServiceClient, json, requireRequester } from "../_shared/auth.ts";
import { corsHeaders } from "../_shared/cors.ts";

const loadLatestUnreadWarning = async (
  serviceClient: ReturnType<typeof createServiceClient>,
  userId: string,
) => {
  const { data, error } = await serviceClient
    .from("user_warnings")
    .select("id, title, message, created_at, acknowledged_at")
    .eq("user_id", userId)
    .is("acknowledged_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data
    ? {
      id: data.id,
      title: data.title,
      message: data.message,
      createdAt: data.created_at,
    }
    : null;
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ success: false, message: "Unsupported method" }, 405);
  }

  try {
    const auth = await requireRequester(req);
    if (!auth.ok) {
      return auth.response;
    }

    let payload: { action?: string; warningId?: string } = {};
    try {
      payload = await req.json();
    } catch {
      payload = {};
    }

    const action = payload.action || "get";
    await auth.serviceClient.rpc("refresh_user_ban_state", {
      p_user_id: auth.requesterProfile.id,
    }).catch((error) => {
      console.error("Failed to refresh user ban state:", error);
    });

    if (action === "acknowledge-warning") {
      const warningId = payload.warningId?.trim();
      if (!warningId) {
        return json({ success: false, message: "warningId is required" }, 400);
      }

      const { data: warning, error: warningError } = await auth.serviceClient
        .from("user_warnings")
        .select("id, user_id, acknowledged_at")
        .eq("id", warningId)
        .maybeSingle();

      if (warningError) {
        console.error("Warning lookup failed:", warningError);
        return json({ success: false, message: "Warning lookup failed" }, 500);
      }

      if (!warning || warning.user_id !== auth.requesterProfile.id) {
        return json({ success: false, message: "Warning not found" }, 404);
      }

      if (!warning.acknowledged_at) {
        const { error: updateError } = await auth.serviceClient
          .from("user_warnings")
          .update({ acknowledged_at: new Date().toISOString() })
          .eq("id", warningId)
          .eq("user_id", auth.requesterProfile.id);

        if (updateError) {
          console.error("Warning acknowledgement failed:", updateError);
          return json({ success: false, message: "Warning acknowledgement failed" }, 500);
        }
      }

      await auth.serviceClient.rpc("refresh_user_warning_summary", {
        p_user_id: auth.requesterProfile.id,
      }).catch((error) => {
        console.error("Failed to refresh warning summary:", error);
      });
    }

    const { data: refreshedProfile, error: refreshedProfileError } = await auth.serviceClient
      .from("users")
      .select("id, role, is_banned, ban_reason, banned_at, active_ban_type, ban_expires_at, warning_count, unread_warning_count")
      .eq("id", auth.requesterProfile.id)
      .maybeSingle();

    if (refreshedProfileError) {
      console.error("Profile refresh failed, using requester fallback:", refreshedProfileError);
    }

    let warning = null;
    try {
      warning = await loadLatestUnreadWarning(auth.serviceClient, auth.requesterProfile.id);
    } catch (error) {
      console.error("Warning refresh failed, continuing without warning payload:", error);
    }

    const effectiveProfile = refreshedProfile || auth.requesterProfile;

    return json({
      success: true,
      warning,
      ban: effectiveProfile
        ? {
          active: Boolean(effectiveProfile.is_banned),
          type: effectiveProfile.active_ban_type,
          reason: effectiveProfile.ban_reason,
          expiresAt: effectiveProfile.ban_expires_at,
          bannedAt: effectiveProfile.banned_at,
        }
        : {
          active: false,
          type: null,
          reason: null,
          expiresAt: null,
          bannedAt: null,
        },
      warningCount: effectiveProfile?.warning_count || 0,
      unreadWarningCount: effectiveProfile?.unread_warning_count || 0,
    });
  } catch (error) {
    console.error("Unexpected error in user-access-state:", error);
    return json({ success: false, message: "An unexpected error occurred" }, 500);
  }
});
