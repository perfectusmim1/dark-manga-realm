import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-device-hash, x-device-installation-id",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ success: false, message: "Unsupported method" }, 405);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) {
      console.error("Missing Supabase environment variables");
      return json({ success: false, message: "Server configuration error" }, 500);
    }

    const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    const authHeader = req.headers.get("Authorization");
    const accessToken = authHeader?.replace(/^Bearer\s+/i, "");

    if (!accessToken) {
      console.error("Missing access token in Authorization header");
      return json({ success: false, message: "Unauthorized: Missing token" }, 401);
    }

    const { data: { user: requesterUser }, error: authError } = await serviceClient.auth.getUser(accessToken);
    if (authError || !requesterUser) {
      console.error("Auth error:", authError?.message || "User not found");
      return json({ success: false, message: `Unauthorized: ${authError?.message || "Invalid token"}` }, 401);
    }

    const requesterId = requesterUser.id;

    const { data: requesterProfile, error: profileError } = await serviceClient
      .from("users")
      .select("id, role")
      .eq("id", requesterId)
      .maybeSingle();

    if (profileError) {
      console.error("Profile error:", profileError.message);
      return json({ success: false, message: "Error fetching requester profile" }, 500);
    }

    if (!requesterProfile || !["admin", "moderator"].includes(requesterProfile.role)) {
      console.warn(`User ${requesterId} (${requesterProfile?.role}) tried to ban a user`);
      return json({ success: false, message: "Not authorized" }, 403);
    }

    const payload = await req.json().catch(() => null) as {
      targetUserId?: string;
      reason?: string;
      mode?: "user" | "hard";
    } | null;
    const targetUserId = payload?.targetUserId?.trim();
    const reason = payload?.reason?.trim() || "Yönetici tarafından banlandı.";
    const mode = payload?.mode === "user" ? "user" : "hard";

    if (!targetUserId) {
      return json({ success: false, message: "targetUserId gerekli" }, 400);
    }

    const { data: targetUser, error: targetError } = await serviceClient
      .from("users")
      .select("id, role, email, is_banned")
      .eq("id", targetUserId)
      .maybeSingle();

    if (targetError) {
      console.error("Target user fetch error:", targetError.message);
      return json({ success: false, message: "Error fetching target user" }, 500);
    }

    if (!targetUser) {
      return json({ success: false, message: "Kullanıcı bulunamadı" }, 404);
    }

    if (targetUser.id === requesterId) {
      return json({ success: false, message: "Kendinizi banlayamazsınız" }, 400);
    }

    if (["admin", "moderator"].includes(targetUser.role)) {
      return json({ success: false, message: "Yetkili kullanıcılar banlanamaz" }, 400);
    }

    const { error: updateError } = await serviceClient
      .from("users")
      .update({
        is_banned: true,
        ban_reason: reason,
        banned_at: new Date().toISOString(),
        banned_by: requesterId,
      })
      .eq("id", targetUserId);

    if (updateError) {
      console.error("Update error:", updateError.message);
      return json({ success: false, message: "Error updating user ban status" }, 500);
    }

    let uniqueIpHashes: string[] = [];
    let uniqueDeviceHashes: string[] = [];

    if (mode === "hard") {
      const { data: fingerprints, error: fError } = await serviceClient
        .from("user_access_fingerprints")
        .select("ip_hash, device_hash")
        .eq("user_id", targetUserId);

      if (fError) {
        console.error("Fingerprint fetch error:", fError.message);
      }

      uniqueIpHashes = [...new Set((fingerprints || []).map((item: any) => item.ip_hash).filter(Boolean))];
      uniqueDeviceHashes = [...new Set((fingerprints || []).map((item: any) => item.device_hash).filter(Boolean))];

      if (uniqueIpHashes.length > 0) {
        const { error: ipError } = await serviceClient.from("banned_ip_hashes").upsert(
          uniqueIpHashes.map((ipHash) => ({
            ip_hash: ipHash,
            user_id: targetUserId,
            reason,
            banned_by: requesterId,
          })),
          { onConflict: "ip_hash", ignoreDuplicates: false }
        );
        if (ipError) console.error("IP ban error:", ipError.message);
      }

      if (uniqueDeviceHashes.length > 0) {
        const { error: devError } = await serviceClient.from("banned_device_hashes").upsert(
          uniqueDeviceHashes.map((deviceHash) => ({
            device_hash: deviceHash,
            user_id: targetUserId,
            reason,
            banned_by: requesterId,
          })),
          { onConflict: "device_hash", ignoreDuplicates: false }
        );
        if (devError) console.error("Device ban error:", devError.message);
      }
    }

    return json({
      success: true,
      mode,
      ipBanCount: uniqueIpHashes.length,
      deviceBanCount: uniqueDeviceHashes.length,
      message: mode === "hard"
        ? "Kullanıcı hesabı ve kayıtlı cihaz izleri banlandı."
        : "Kullanıcı hesabı banlandı.",
    });
  } catch (err) {
    console.error("Unexpected error in Edge Function:", err);
    return json({ success: false, message: "An unexpected error occurred" }, 500);
  }
});
