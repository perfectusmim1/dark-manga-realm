import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createServiceClient, json } from "../_shared/auth.ts";
import { corsHeaders } from "../_shared/cors.ts";

type MetricEventPayload = {
  service?: string;
  event?: string;
  eventName?: string;
  sourceName?: string;
  operation?: string;
  operationName?: string;
  sourceHost?: string;
  purpose?: string;
  entityType?: string;
  variant?: string;
  status?: number | string | null;
  result?: string | null;
  durationMs?: number | string | null;
  bytes?: number | string | null;
  createdAt?: string | null;
};

const normalizeText = (value?: string | null) => value?.trim() || "";

const toInteger = (value: unknown) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.round(numeric)) : 0;
};

const toStatusBucket = (status: number, result: string, eventName: string) => {
  if (status >= 500) return "5xx";
  if (status >= 400) return "4xx";
  if (status >= 300) return "3xx";
  if (status >= 200) return "2xx";
  if (status >= 100) return "1xx";
  if (result) return result;
  if (eventName === "stored") return "stored";
  if (eventName === "cache_hit") return "cache_hit";
  if (eventName === "blocked") return "blocked";
  if (eventName === "invalid_request") return "invalid";
  if (eventName === "upstream_failure") return "upstream_failure";
  if (eventName === "success") return "success";
  return "other";
};

const isErrorEvent = (status: number, result: string, eventName: string) => (
  status >= 400
  || result === "error"
  || ["blocked", "invalid_request", "upstream_failure"].includes(eventName)
);

const toBucketStart = (value?: string | null) => {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) {
    return new Date().toISOString();
  }

  date.setUTCMinutes(0, 0, 0);
  return date.toISOString();
};

const loadExpectedToken = async (
  serviceClient: ReturnType<typeof createServiceClient>,
) => {
  const { data, error } = await serviceClient
    .from("internal_worker_secrets")
    .select("value")
    .eq("key", "metrics_ingest_token")
    .maybeSingle();

  if (error) {
    throw error;
  }

  return normalizeText(data?.value);
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ success: false, message: "Method not allowed" }, 405);
  }

  const serviceClient = createServiceClient();
  const expectedToken = await loadExpectedToken(serviceClient);
  const authHeader = req.headers.get("Authorization") || "";
  const bearerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";

  if (!expectedToken || bearerToken !== expectedToken) {
    return json({ success: false, message: "Unauthorized" }, 401);
  }

  const payload = await req.json().catch(() => null);
  const events = Array.isArray(payload?.events)
    ? payload.events
    : payload && typeof payload === "object"
      ? [payload]
      : [];

  if (events.length === 0) {
    return json({ success: false, message: "No events provided" }, 400);
  }

  const writes = await Promise.allSettled(
    events.map((rawEvent) => {
      const event = rawEvent as MetricEventPayload;
      const service = normalizeText(event.service);
      const eventName = normalizeText(event.eventName || event.event);
      const result = normalizeText(event.result);
      const status = toInteger(event.status);

      if (!service || !eventName) {
        throw new Error("service and event are required");
      }

      return serviceClient.rpc("record_worker_metric", {
        p_bucket_start: toBucketStart(event.createdAt),
        p_service: service,
        p_event_name: eventName,
        p_source_name: normalizeText(event.sourceName),
        p_operation_name: normalizeText(event.operationName || event.operation),
        p_source_host: normalizeText(event.sourceHost),
        p_purpose: normalizeText(event.purpose),
        p_entity_type: normalizeText(event.entityType),
        p_variant: normalizeText(event.variant),
        p_status_bucket: toStatusBucket(status, result, eventName),
        p_request_count: 1,
        p_error_count: isErrorEvent(status, result, eventName) ? 1 : 0,
        p_bytes_total: toInteger(event.bytes),
        p_duration_total_ms: toInteger(event.durationMs),
        p_last_seen_at: event.createdAt || new Date().toISOString(),
      });
    }),
  );

  const rejected = writes.filter((item) => item.status === "rejected");
  if (rejected.length > 0) {
    console.error("cloudflare-metrics-ingest failed", rejected);
    return json({
      success: false,
      message: "Metric events could not be stored",
      processed: events.length - rejected.length,
      failed: rejected.length,
    }, 500);
  }

  return json({
    success: true,
    processed: events.length,
  });
});
