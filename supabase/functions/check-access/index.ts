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

const sha256 = async (value: string) => {
  const encoded = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
};

const getIpAddress = (req: Request) => {
  const forwardedFor = req.headers.get("x-forwarded-for") ?? "";
  return forwardedFor.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ allowed: false, message: "Unsupported method" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    return json({ allowed: false, message: "Missing Supabase environment variables" }, 500);
  }

  const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  let payload: { deviceHash?: string; deviceInstallationId?: string };
  try {
    payload = await req.json();
  } catch {
    payload = {};
  }

  const ipHash = await sha256(getIpAddress(req));
  const deviceHash = payload.deviceHash?.trim() || null;
  const installationIdHash = payload.deviceInstallationId?.trim()
    ? await sha256(payload.deviceInstallationId.trim())
    : null;

  const authHeader = req.headers.get("Authorization");
  const accessToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  let authUserId: string | null = null;

  if (accessToken) {
    const { data: authData } = await serviceClient.auth.getUser(accessToken);
    authUserId = authData.user?.id || null;
  }

  const [{ data: ipBan }, { data: deviceBan }, { data: userRecord }] = await Promise.all([
    serviceClient.from("banned_ip_hashes").select("ip_hash").eq("ip_hash", ipHash).maybeSingle(),
    deviceHash
      ? serviceClient.from("banned_device_hashes").select("device_hash").eq("device_hash", deviceHash).maybeSingle()
      : Promise.resolve({ data: null } as any),
    authUserId
      ? serviceClient.from("users").select("id, is_banned, ban_reason").eq("id", authUserId).maybeSingle()
      : Promise.resolve({ data: null } as any),
  ]);

  if (ipBan) {
    return json({ allowed: false, message: "Bu bağlantı için site erişimi engellendi." }, 403);
  }

  if (deviceBan) {
    return json({ allowed: false, message: "Bu cihaz için site erişimi engellendi." }, 403);
  }

  if (userRecord?.is_banned) {
    return json({ allowed: false, message: userRecord.ban_reason || "Hesabınız banlandı." }, 403);
  }

  if (authUserId && deviceHash) {
    await serviceClient.from("user_access_fingerprints").upsert({
      user_id: authUserId,
      ip_hash: ipHash,
      device_hash: deviceHash,
      installation_id_hash: installationIdHash,
      user_agent: req.headers.get("user-agent"),
      last_seen_at: new Date().toISOString(),
    }, {
      onConflict: "user_id,ip_hash,device_hash",
      ignoreDuplicates: false,
    });
  }

  return json({ allowed: true });
});
