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

    const { data: { user }, error: authError } = await serviceClient.auth.getUser(accessToken);
    if (authError || !user) {
      console.error("Auth error:", authError?.message || "User not found");
      return json({ success: false, message: `Unauthorized: ${authError?.message || "Invalid token"}` }, 401);
    }

    const { data: requesterProfile, error: profileError } = await serviceClient
      .from("users")
      .select("id, role")
      .eq("id", user.id)
      .maybeSingle();

    if (profileError) {
      console.error("Profile error:", profileError.message);
      return json({ success: false, message: "Error fetching user profile" }, 500);
    }

    if (!requesterProfile || !["admin", "moderator"].includes(requesterProfile.role)) {
      console.warn(`User ${user.id} (${requesterProfile?.role}) tried to access admin directory`);
      return json({ success: false, message: "Not authorized" }, 403);
    }

    const { data: users, error: fetchError } = await serviceClient
      .from("users")
      .select("id, username, email, avatar, role, is_banned, ban_reason, banned_at, created_at, last_seen_at")
      .order("created_at", { ascending: false });

    if (fetchError) {
      console.error("Database fetch error:", fetchError.message);
      return json({ success: false, message: fetchError.message }, 500);
    }

    return json({
      success: true,
      users: users || [],
    });
  } catch (err) {
    console.error("Unexpected error in Edge Function:", err);
    return json({ success: false, message: "An unexpected error occurred" }, 500);
  }
});
