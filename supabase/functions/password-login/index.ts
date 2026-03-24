import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const WINDOW_MS = 15 * 60 * 1000;
const IDENTIFIER_LIMIT = 5;
const IP_LIMIT = 20;

const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
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

  let payload: { identifier?: string; password?: string };

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

  if (identifier.length < 2 || password.length < 1) {
    return json({
      success: false,
      message: "E-posta veya kullanıcı adı ve şifre zorunludur.",
    });
  }

  const forwardedFor = req.headers.get("x-forwarded-for") ?? "";
  const ipAddress = forwardedFor.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
  const [identifierHash, ipHash] = await Promise.all([
    sha256(identifier),
    sha256(ipAddress),
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
      message: "Çok fazla giriş denemesi yaptınız. Lütfen 15 dakika sonra tekrar deneyin.",
    });
  }

  let loginEmail = identifier;

  if (!identifier.includes("@")) {
    const { data: matchedUser } = await serviceClient
      .from("users")
      .select("email")
      .eq("username", identifier)
      .maybeSingle();

    loginEmail = matchedUser?.email?.trim().toLowerCase() || `${identifier}@invalid.toonparrot.local`;
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

  return json({
    success: true,
    session: {
      access_token: authResult.access_token,
      refresh_token: authResult.refresh_token,
    },
  });
});
