import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { getIpAddress, getJwtClaims, sha256Hex, upsertUserSessionMetadata } from "../_shared/session-tracking.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-device-hash, x-device-installation-id",
};

const WINDOW_MS = 2 * 60 * 1000;
const IDENTIFIER_LIMIT = 5;
const IP_LIMIT = 20;

const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });

const hasActiveUserBan = (user?: {
  is_banned?: boolean | null;
  active_ban_type?: string | null;
  ban_expires_at?: string | null;
}) => {
  if (!user?.is_banned && !user?.active_ban_type) {
    return false;
  }

  if (!user?.ban_expires_at) {
    return true;
  }

  const expiresAt = Date.parse(user.ban_expires_at);
  if (!Number.isFinite(expiresAt)) {
    return true;
  }

  return expiresAt > Date.now();
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({
      success: false,
      message: "Unsupported method",
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? serviceRoleKey;

  if (!supabaseUrl || !serviceRoleKey || !anonKey) {
    return json({
      success: false,
      message: "Missing Supabase environment variables",
    });
  }

  let payload: { identifier?: string; password?: string; deviceHash?: string; deviceInstallationId?: string };

  try {
    payload = await req.json();
  } catch {
    return json({
      success: false,
      message: "Invalid request body",
    });
  }

  const identifier = payload.identifier?.trim().toLowerCase() ?? "";
  const password = payload.password ?? "";
  const deviceHash = payload.deviceHash?.trim() || null;

  if (identifier.length < 2 || password.length < 1) {
    return json({
      success: false,
      message: "E-posta veya kullanıcı adı ve şifre zorunludur.",
    });
  }

  const ipAddress = getIpAddress(req);
  const [identifierHash, ipHash] = await Promise.all([
    sha256Hex(identifier),
    sha256Hex(ipAddress),
  ]);

  const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  const windowStart = new Date(Date.now() - WINDOW_MS).toISOString();

  const [{ count: identifierFailures }, { count: ipFailures }] = await Promise.all([
    serviceClient
      .from("auth_login_attempts")
      .select("id", { count: "exact", head: true })
      .eq("identifier_hash", identifierHash)
      .eq("success", false)
      .gte("created_at", windowStart),
    serviceClient
      .from("auth_login_attempts")
      .select("id", { count: "exact", head: true })
      .eq("ip_hash", ipHash)
      .eq("success", false)
      .gte("created_at", windowStart),
  ]);

  if ((identifierFailures ?? 0) >= IDENTIFIER_LIMIT || (ipFailures ?? 0) >= IP_LIMIT) {
    return json({
      success: false,
      code: "RATE_LIMITED",
      retryAfterSeconds: Math.floor(WINDOW_MS / 1000),
      message: "Çok fazla giriş denemesi yaptınız. Lütfen 2 dakika sonra tekrar deneyin.",
    });
  }

  let loginEmail = identifier;
  let matchedUserRecord: {
    id: string;
    email: string | null;
    is_banned?: boolean | null;
    ban_reason?: string | null;
    active_ban_type?: string | null;
    ban_expires_at?: string | null;
  } | null = null;

  const [{ data: ipBan }, { data: deviceBan }] = await Promise.all([
    serviceClient.from("banned_ip_hashes").select("ip_hash").eq("ip_hash", ipHash).maybeSingle(),
    deviceHash
      ? serviceClient.from("banned_device_hashes").select("device_hash").eq("device_hash", deviceHash).maybeSingle()
      : Promise.resolve({ data: null, error: null } as const),
  ]);

  if (ipBan) {
    return json({
      success: false,
      code: "IP_BANNED",
      message: "Bu bağlantı için site erişimi engellendi.",
    });
  }

  if (deviceBan) {
    return json({
      success: false,
      code: "DEVICE_BANNED",
      message: "Bu cihaz için site erişimi engellendi.",
    });
  }

  if (!identifier.includes("@")) {
    const { data: matchedUser } = await serviceClient
      .from("users")
      .select("id, email, is_banned, ban_reason, active_ban_type, ban_expires_at")
      .eq("username", identifier)
      .maybeSingle();
    matchedUserRecord = matchedUser;
    loginEmail = matchedUser?.email?.trim().toLowerCase() || `${identifier}@invalid.toonparrot.local`;
  } else {
    const { data: matchedUser } = await serviceClient
      .from("users")
      .select("id, email, is_banned, ban_reason, active_ban_type, ban_expires_at")
      .eq("email", identifier)
      .maybeSingle();
    matchedUserRecord = matchedUser;
  }

  if (matchedUserRecord && hasActiveUserBan(matchedUserRecord)) {
    return json({
      success: false,
      code: "USER_BANNED",
      message: matchedUserRecord.ban_reason || "Bu hesap için erişim geçici veya kalıcı olarak engellendi.",
    });
  }

  const authResponse = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
    },
    body: JSON.stringify({
      email: loginEmail,
      password,
    }),
  });

  const authResult = await authResponse.json().catch(() => null);

  if (!authResponse.ok || !authResult?.access_token || !authResult?.refresh_token) {
    await serviceClient.from("auth_login_attempts").insert({
      identifier_hash: identifierHash,
      ip_hash: ipHash,
      success: false,
    });

    return json({
      success: false,
      message: "E-posta/kullanıcı adı veya şifre hatalı.",
    });
  }

  await serviceClient.from("auth_login_attempts").insert({
    identifier_hash: identifierHash,
    ip_hash: ipHash,
    success: true,
  });

  if (authResult?.user?.id && deviceHash) {
    await serviceClient.from("user_access_fingerprints").upsert({
      user_id: authResult.user.id,
      ip_hash: ipHash,
      device_hash: deviceHash,
      installation_id_hash: payload.deviceInstallationId?.trim() ? await sha256Hex(payload.deviceInstallationId.trim()) : null,
      user_agent: req.headers.get("user-agent"),
      last_seen_at: new Date().toISOString(),
    }, {
      onConflict: "user_id,ip_hash,device_hash",
      ignoreDuplicates: false,
    });
  }

  const sessionId = typeof authResult.access_token === "string"
    ? getJwtClaims(authResult.access_token)?.sessionId ?? null
    : null;

  if (authResult?.user?.id && sessionId) {
    await upsertUserSessionMetadata(serviceClient, {
      userId: authResult.user.id,
      sessionId,
      userAgent: req.headers.get("user-agent"),
      request: req,
    }).catch((error) => {
      console.error("password-login session metadata upsert failed:", error);
    });
  }

  return json({
    success: true,
    resolvedEmail: authResult.user?.email || loginEmail,
    session: {
      access_token: authResult.access_token,
      refresh_token: authResult.refresh_token,
    },
  });
});
