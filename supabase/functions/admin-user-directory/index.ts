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

  const { data: users, error } = await serviceClient
    .from("users")
    .select("id, username, email, avatar, role, is_banned, ban_reason, banned_at, created_at, last_seen_at")
    .order("created_at", { ascending: false });

  if (error) {
    return json({ success: false, message: error.message }, 500);
  }

  return json({
    success: true,
    users: users || [],
  });
});
