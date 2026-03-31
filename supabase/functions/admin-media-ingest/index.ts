import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createServiceClient, json, requireRequester } from "../_shared/auth.ts";
import { corsHeaders } from "../_shared/cors.ts";

const normalizeText = (value?: string | null) => value?.trim() || "";

const loadWorkerSecrets = async (
  serviceClient: ReturnType<typeof createServiceClient>,
) => {
  const { data, error } = await serviceClient
    .from("internal_worker_secrets")
    .select("key, value")
    .in("key", ["media_ingest_url", "media_ingest_token"]);

  if (error) {
    throw error;
  }

  const values = new Map<string, string>();
  for (const row of data || []) {
    values.set(normalizeText(row.key), normalizeText(row.value));
  }

  return {
    url: values.get("media_ingest_url") || "",
    token: values.get("media_ingest_token") || "",
  };
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ success: false, message: "Method not allowed" }, 405);
  }

  const requester = await requireRequester(req, ["admin"]);
  if (!requester.ok) {
    return requester.response;
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return json({ success: false, message: "Invalid request body" }, 400);
  }

  const { url, token } = await loadWorkerSecrets(requester.serviceClient);
  if (!url || !token) {
    return json({ success: false, message: "Media ingest worker secrets are missing" }, 503);
  }

  const upstreamResponse = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  }).catch((error) => {
    console.error("admin-media-ingest upstream request failed", error);
    return null;
  });

  if (!upstreamResponse) {
    return json({ success: false, message: "Media ingest worker is unreachable" }, 502);
  }

  const responseText = await upstreamResponse.text();

  return new Response(responseText, {
    status: upstreamResponse.status,
    headers: {
      ...corsHeaders,
      "Content-Type": upstreamResponse.headers.get("Content-Type") || "application/json",
    },
  });
});
