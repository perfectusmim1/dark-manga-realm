import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

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

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    return json({ success: false, message: "Missing Supabase environment variables" }, 500);
  }

  const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  const authHeader = req.headers.get("Authorization");
  const accessToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!accessToken) {
    return json({ success: false, message: "Unauthorized" }, 401);
  }

  const { data: authData } = await serviceClient.auth.getUser(accessToken);
  const requesterId = authData.user?.id;
  if (!requesterId) {
    return json({ success: false, message: "Unauthorized" }, 401);
  }

  const { data: requesterProfile } = await serviceClient
    .from("users")
    .select("id, role")
    .eq("id", requesterId)
    .maybeSingle();

  if (!requesterProfile || !["admin", "moderator"].includes(requesterProfile.role)) {
    return json({ success: false, message: "Not authorized" }, 403);
  }

  const payload = await req.json().catch(() => null) as { targetUserId?: string; reason?: string } | null;
  const targetUserId = payload?.targetUserId?.trim();
  const reason = payload?.reason?.trim() || "Yönetici tarafından banlandı.";

  if (!targetUserId) {
    return json({ success: false, message: "targetUserId gerekli" }, 400);
  }

  const { data: targetUser } = await serviceClient
    .from("users")
    .select("id, role, email, is_banned")
    .eq("id", targetUserId)
    .maybeSingle();

  if (!targetUser) {
    return json({ success: false, message: "Kullanıcı bulunamadı" }, 404);
  }

  if (targetUser.id === requesterId) {
    return json({ success: false, message: "Kendinizi banlayamazsınız" }, 400);
  }

  if (["admin", "moderator"].includes(targetUser.role)) {
    return json({ success: false, message: "Yetkili kullanıcılar banlanamaz" }, 400);
  }

  await serviceClient
    .from("users")
    .update({
      is_banned: true,
      ban_reason: reason,
      banned_at: new Date().toISOString(),
      banned_by: requesterId,
    })
    .eq("id", targetUserId);

  const { data: fingerprints } = await serviceClient
    .from("user_access_fingerprints")
    .select("ip_hash, device_hash")
    .eq("user_id", targetUserId);

  const uniqueIpHashes = [...new Set((fingerprints || []).map((item: any) => item.ip_hash).filter(Boolean))];
  const uniqueDeviceHashes = [...new Set((fingerprints || []).map((item: any) => item.device_hash).filter(Boolean))];

  if (uniqueIpHashes.length > 0) {
    await serviceClient.from("banned_ip_hashes").upsert(
      uniqueIpHashes.map((ipHash) => ({
        ip_hash: ipHash,
        user_id: targetUserId,
        reason,
        banned_by: requesterId,
      })),
      { onConflict: "ip_hash", ignoreDuplicates: false }
    );
  }

  if (uniqueDeviceHashes.length > 0) {
    await serviceClient.from("banned_device_hashes").upsert(
      uniqueDeviceHashes.map((deviceHash) => ({
        device_hash: deviceHash,
        user_id: targetUserId,
        reason,
        banned_by: requesterId,
      })),
      { onConflict: "device_hash", ignoreDuplicates: false }
    );
  }

  return json({
    success: true,
    ipBanCount: uniqueIpHashes.length,
    deviceBanCount: uniqueDeviceHashes.length,
  });
});
