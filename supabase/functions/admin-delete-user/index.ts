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

    const {
      data: { user: requesterUser },
      error: authError,
    } = await serviceClient.auth.getUser(accessToken);

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
      console.warn(`User ${requesterId} (${requesterProfile?.role}) tried to delete a user`);
      return json({ success: false, message: "Not authorized" }, 403);
    }

    const payload = await req.json().catch(() => null) as {
      targetUserId?: string;
    } | null;
    const targetUserId = payload?.targetUserId?.trim();

    if (!targetUserId) {
      return json({ success: false, message: "targetUserId is required" }, 400);
    }

    if (targetUserId === requesterId) {
      return json({ success: false, message: "You cannot delete yourself" }, 400);
    }

    const { data: targetUser, error: targetError } = await serviceClient
      .from("users")
      .select("id, role, username")
      .eq("id", targetUserId)
      .maybeSingle();

    if (targetError) {
      console.error("Target user fetch error:", targetError.message);
      return json({ success: false, message: "Error fetching target user" }, 500);
    }

    if (!targetUser) {
      return json({ success: false, message: "User not found" }, 404);
    }

    if (["admin", "moderator"].includes(targetUser.role)) {
      return json({ success: false, message: "Cannot delete admin or moderator users" }, 400);
    }

    const { error: deletePublicError } = await serviceClient
      .from("users")
      .delete()
      .eq("id", targetUserId);

    if (deletePublicError) {
      console.error("Delete public.users error:", deletePublicError.message);
      return json({ success: false, message: "Error deleting user profile" }, 500);
    }

    const { error: deleteAuthError } = await serviceClient.auth.admin.deleteUser(targetUserId);

    if (deleteAuthError) {
      console.error("Delete auth.users error:", deleteAuthError.message);
      return json({
        success: false,
        message: "User profile deleted but auth account removal failed. The user may still appear in Supabase Auth.",
      }, 500);
    }

    console.log(`User ${targetUserId} (${targetUser.username}) deleted by ${requesterId}`);

    return json({
      success: true,
      message: "User has been permanently deleted.",
    });
  } catch (err) {
    console.error("Unexpected error in Edge Function:", err);
    return json({ success: false, message: "An unexpected error occurred" }, 500);
  }
});
