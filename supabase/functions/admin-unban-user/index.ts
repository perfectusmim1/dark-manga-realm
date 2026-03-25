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
      console.warn(`User ${requesterId} (${requesterProfile?.role}) tried to unban a user`);
      return json({ success: false, message: "Not authorized" }, 403);
    }

    const payload = await req.json().catch(() => null) as { targetUserId?: string } | null;
    const targetUserId = payload?.targetUserId?.trim();
    if (!targetUserId) {
      return json({ success: false, message: "targetUserId gerekli" }, 400);
    }

    const { error: updateError } = await serviceClient
      .from("users")
      .update({
        is_banned: false,
        ban_reason: null,
        banned_at: null,
        banned_by: null,
      })
      .eq("id", targetUserId);

    if (updateError) {
      console.error("Unban update error:", updateError.message);
      return json({ success: false, message: "Error unbanning user" }, 500);
    }

    await Promise.all([
      serviceClient.from("banned_ip_hashes").delete().eq("user_id", targetUserId),
      serviceClient.from("banned_device_hashes").delete().eq("user_id", targetUserId),
    ]);

    return json({ success: true });
  } catch (err) {
    console.error("Unexpected error in Edge Function:", err);
    return json({ success: false, message: "An unexpected error occurred" }, 500);
  }
});
