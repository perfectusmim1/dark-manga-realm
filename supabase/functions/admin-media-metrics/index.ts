import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { json, requireRequester } from "../_shared/auth.ts";
import { corsHeaders } from "../_shared/cors.ts";

type WorkerMetricRollupRow = {
  bucket_start: string;
  service: string;
  event_name: string;
  source_name: string;
  operation_name: string;
  source_host: string;
  purpose: string;
  entity_type: string;
  variant: string;
  status_bucket: string;
  request_count: number;
  error_count: number;
  bytes_total: number;
  duration_total_ms: number;
  last_seen_at: string;
};

type AggregateRow = {
  label: string;
  sublabel?: string;
  requests: number;
  errors: number;
  durationTotalMs: number;
  bytesTotal: number;
  lastSeenAt?: string | null;
};

const normalizeText = (value?: string | null) => value?.trim() || "";

const aggregate = (
  rows: WorkerMetricRollupRow[],
  buildKey: (row: WorkerMetricRollupRow) => string,
  buildLabels: (row: WorkerMetricRollupRow) => { label: string; sublabel?: string },
) => {
  const map = new Map<string, AggregateRow>();

  for (const row of rows) {
    const key = buildKey(row);
    const existing = map.get(key) || {
      ...buildLabels(row),
      requests: 0,
      errors: 0,
      durationTotalMs: 0,
      bytesTotal: 0,
      lastSeenAt: null,
    };

    existing.requests += Number(row.request_count || 0);
    existing.errors += Number(row.error_count || 0);
    existing.durationTotalMs += Number(row.duration_total_ms || 0);
    existing.bytesTotal += Number(row.bytes_total || 0);
    existing.lastSeenAt = existing.lastSeenAt && existing.lastSeenAt > row.last_seen_at
      ? existing.lastSeenAt
      : row.last_seen_at;

    map.set(key, existing);
  }

  return Array.from(map.values())
    .map((row) => ({
      label: row.label,
      sublabel: row.sublabel,
      requests: row.requests,
      errors: row.errors,
      averageDurationMs: row.requests > 0 ? Math.round(row.durationTotalMs / row.requests) : 0,
      bytesTotal: row.bytesTotal,
      lastSeenAt: row.lastSeenAt,
    }))
    .sort((left, right) => {
      if (right.requests !== left.requests) {
        return right.requests - left.requests;
      }

      return right.bytesTotal - left.bytesTotal;
    })
    .slice(0, 12);
};

const shouldCountProxyRequest = (row: WorkerMetricRollupRow) => (
  row.service !== "media-ingest"
  && row.event_name !== "healthcheck"
);

const shouldCountIngestItem = (row: WorkerMetricRollupRow) => (
  row.service === "media-ingest"
  && row.event_name !== "batch_complete"
);

const buildTrend = (rows: WorkerMetricRollupRow[]) => {
  const map = new Map<string, {
    bucketStart: string;
    scraperRequests: number;
    offlineRequests: number;
    ingestItems: number;
    errors: number;
  }>();

  for (const row of rows) {
    if (row.event_name === "healthcheck" || row.event_name === "batch_complete") {
      continue;
    }

    const bucketStart = row.bucket_start;
    const existing = map.get(bucketStart) || {
      bucketStart,
      scraperRequests: 0,
      offlineRequests: 0,
      ingestItems: 0,
      errors: 0,
    };

    if (row.service === "scraper-proxy") {
      existing.scraperRequests += Number(row.request_count || 0);
    } else if (row.service === "offline-image-proxy") {
      existing.offlineRequests += Number(row.request_count || 0);
    } else if (row.service === "media-ingest") {
      existing.ingestItems += Number(row.request_count || 0);
    }

    existing.errors += Number(row.error_count || 0);
    map.set(bucketStart, existing);
  }

  return Array.from(map.values())
    .sort((left, right) => left.bucketStart.localeCompare(right.bucketStart))
    .slice(-24);
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const requester = await requireRequester(req, ["admin"]);
  if (!requester.ok) {
    return requester.response;
  }

  const now = Date.now();
  const last24HoursIso = new Date(now - (24 * 60 * 60 * 1000)).toISOString();
  const last7DaysIso = new Date(now - (7 * 24 * 60 * 60 * 1000)).toISOString();

  const [recentResult, storageResult] = await Promise.all([
    requester.serviceClient
      .from("worker_metric_rollups_hourly")
      .select("*")
      .gte("bucket_start", last7DaysIso)
      .order("bucket_start", { ascending: true }),
    requester.serviceClient
      .from("worker_metric_rollups_hourly")
      .select("*")
      .eq("service", "media-ingest")
      .eq("event_name", "stored")
      .order("bucket_start", { ascending: true }),
  ]);

  if (recentResult.error) {
    console.error("admin-media-metrics recent query failed", recentResult.error);
    return json({ success: false, message: "Recent metric rows could not be loaded" }, 500);
  }

  if (storageResult.error) {
    console.error("admin-media-metrics storage query failed", storageResult.error);
    return json({ success: false, message: "Storage metric rows could not be loaded" }, 500);
  }

  const recentRows = (recentResult.data || []) as WorkerMetricRollupRow[];
  const storageRows = (storageResult.data || []) as WorkerMetricRollupRow[];
  const last24Rows = recentRows.filter((row) => row.bucket_start >= last24HoursIso);

  const requests24h = last24Rows
    .filter(shouldCountProxyRequest)
    .reduce((sum, row) => sum + Number(row.request_count || 0), 0);
  const errors24h = last24Rows.reduce((sum, row) => sum + Number(row.error_count || 0), 0);
  const averageDurationMs24h = requests24h > 0
    ? Math.round(
      last24Rows
        .filter(shouldCountProxyRequest)
        .reduce((sum, row) => sum + Number(row.duration_total_ms || 0), 0) / requests24h,
    )
    : 0;
  const ingestItems24h = last24Rows
    .filter(shouldCountIngestItem)
    .reduce((sum, row) => sum + Number(row.request_count || 0), 0);
  const storedBytesTotal = storageRows.reduce((sum, row) => sum + Number(row.bytes_total || 0), 0);
  const storedObjectsTotal = storageRows.reduce((sum, row) => sum + Number(row.request_count || 0), 0);
  const lastSeenAt = recentRows.reduce<string | null>((latest, row) => {
    if (!row.last_seen_at) {
      return latest;
    }

    return !latest || row.last_seen_at > latest ? row.last_seen_at : latest;
  }, null);

  const scraperRows = last24Rows.filter((row) => row.service === "scraper-proxy" && row.event_name !== "healthcheck");
  const offlineRows = last24Rows.filter((row) => row.service === "offline-image-proxy");

  return json({
    summary: {
      requests24h,
      errors24h,
      averageDurationMs24h,
      ingestItems24h,
      storedBytesTotal,
      storedObjectsTotal,
      lastSeenAt,
    },
    scraper: aggregate(
      scraperRows,
      (row) => `${normalizeText(row.source_name)}|${normalizeText(row.operation_name)}`,
      (row) => ({
        label: normalizeText(row.source_name) || normalizeText(row.source_host) || "Kaynak bilinmiyor",
        sublabel: normalizeText(row.operation_name) || "fetch",
      }),
    ),
    offline: aggregate(
      offlineRows,
      (row) => `${normalizeText(row.purpose)}|${normalizeText(row.entity_type)}|${normalizeText(row.source_host)}`,
      (row) => ({
        label: normalizeText(row.purpose) || "proxy",
        sublabel: [normalizeText(row.entity_type), normalizeText(row.source_host)].filter(Boolean).join(" • ") || "Genel",
      }),
    ),
    storage: aggregate(
      storageRows,
      (row) => `${normalizeText(row.entity_type)}|${normalizeText(row.variant)}`,
      (row) => ({
        label: normalizeText(row.entity_type) || "media",
        sublabel: normalizeText(row.variant) || "other",
      }),
    ),
    trend: buildTrend(recentRows),
  });
});
