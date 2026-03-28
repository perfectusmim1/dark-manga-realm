import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { requireRequester, json } from "../_shared/auth.ts";
import { corsHeaders } from "../_shared/cors.ts";

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

    const { data: users, error } = await auth.serviceClient
      .from("users")
      .select("id, username, email, avatar, role, is_banned, ban_reason, banned_at, created_at, last_seen_at, warning_count, unread_warning_count, active_ban_type, ban_expires_at")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Admin directory fetch error:", error);
      return json({ success: false, message: "Error fetching users" }, 500);
    }

    return json({
      success: true,
      users: users || [],
    });
  } catch (error) {
    console.error("Unexpected error in admin-user-directory:", error);
    return json({ success: false, message: "An unexpected error occurred" }, 500);
  }
});
