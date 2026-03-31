import { invokeAuthenticatedFunction } from '@/lib/supabase';

export interface AdminMediaMetricsSummary {
  requests24h: number;
  errors24h: number;
  averageDurationMs24h: number;
  ingestItems24h: number;
  storedBytesTotal: number;
  storedObjectsTotal: number;
  lastSeenAt?: string | null;
}

export interface AdminMediaMetricsBreakdownRow {
  label: string;
  sublabel?: string;
  requests: number;
  errors: number;
  averageDurationMs: number;
  bytesTotal?: number;
  lastSeenAt?: string | null;
}

export interface AdminMediaMetricsTrendPoint {
  bucketStart: string;
  scraperRequests: number;
  offlineRequests: number;
  ingestItems: number;
  errors: number;
}

export interface AdminMediaMetricsSnapshot {
  summary: AdminMediaMetricsSummary;
  scraper: AdminMediaMetricsBreakdownRow[];
  offline: AdminMediaMetricsBreakdownRow[];
  storage: AdminMediaMetricsBreakdownRow[];
  trend: AdminMediaMetricsTrendPoint[];
}

export const getAdminMediaMetrics = async (preferredAccessToken?: string | null) => (
  invokeAuthenticatedFunction<AdminMediaMetricsSnapshot>('admin-media-metrics', {}, {
    preferredAccessToken,
  })
);
