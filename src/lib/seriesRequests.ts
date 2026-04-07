import { supabase, waitForUsableSupabaseSession } from '@/lib/supabase';
import type { SeriesRequest, SeriesRequestStatus } from '@/lib/types';

interface SeriesRequestRow {
  id: string;
  user_id: string;
  series_title: string;
  reference_url: string;
  reference_host: string;
  note: string | null;
  admin_note: string | null;
  status: SeriesRequestStatus;
  reviewed_at: string | null;
  reviewed_by: string | null;
  created_at: string;
  updated_at: string;
}

const SERIES_REQUEST_SELECT = `
  id,
  user_id,
  series_title,
  reference_url,
  reference_host,
  note,
  admin_note,
  status,
  reviewed_at,
  reviewed_by,
  created_at,
  updated_at
`;

export const SERIES_REQUEST_STATUS_VALUES: SeriesRequestStatus[] = [
  'pending',
  'in_review',
  'approved',
  'rejected',
];

export const SERIES_REQUEST_STATUS_LABELS: Record<SeriesRequestStatus, string> = {
  pending: 'Beklemede',
  in_review: 'İnceleniyor',
  approved: 'Onaylandı',
  rejected: 'Reddedildi',
};

const mapSeriesRequestRow = (row: SeriesRequestRow): SeriesRequest => ({
  id: row.id,
  userId: row.user_id,
  userName: '',
  userEmail: '',
  seriesTitle: row.series_title,
  referenceUrl: row.reference_url,
  referenceHost: row.reference_host,
  note: row.note,
  adminNote: row.admin_note,
  status: row.status,
  reviewedAt: row.reviewed_at,
  reviewedBy: row.reviewed_by,
  reviewedByName: null,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const normalizeSeriesTitle = (value: string) => value.trim().slice(0, 160);

const normalizeReferenceUrl = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error('Geçerli bir http/https seri linki girin');
  }

  let parsed: URL;

  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error('Geçerli bir http/https seri linki girin');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Geçerli bir http/https seri linki girin');
  }

  parsed.hash = '';

  return {
    referenceUrl: parsed.href,
    referenceHost: parsed.hostname.replace(/^www\./i, '').toLowerCase(),
  };
};

const getErrorMessage = (error: unknown, fallback: string) => {
  if (error instanceof Error) {
    const normalized = error.message.toLowerCase();

    if (normalized.includes('duplicate key value')) {
      return 'Bu link için zaten aktif bir seri isteğin var';
    }

    if (normalized.includes('row-level security')) {
      return 'Bu işlem için yetkin yok veya hesabın bu isteği gönderemiyor';
    }

    return error.message;
  }

  return fallback;
};

const ensureSession = async () => {
  await waitForUsableSupabaseSession({
    required: true,
    maxWaitMs: 5000,
  });
};

export const listSeriesRequests = async (): Promise<SeriesRequest[]> => {
  await ensureSession();

  const { data, error } = await supabase
    .from('series_requests')
    .select(SERIES_REQUEST_SELECT)
    .order('created_at', { ascending: false });

  if (error) {
    throw new Error(getErrorMessage(error, 'Seri istekleri yüklenemedi'));
  }

  return ((data || []) as SeriesRequestRow[]).map(mapSeriesRequestRow);
};

export const createSeriesRequest = async (payload: {
  seriesTitle: string;
  referenceUrl: string;
  note?: string | null;
}): Promise<SeriesRequest> => {
  const normalizedTitle = normalizeSeriesTitle(payload.seriesTitle);
  if (normalizedTitle.length < 2) {
    throw new Error('Seri adı en az 2 karakter olmalı');
  }

  const { referenceUrl, referenceHost } = normalizeReferenceUrl(payload.referenceUrl);
  await ensureSession();

  const { data, error } = await supabase
    .from('series_requests')
    .insert({
      user_id: (await supabase.auth.getUser()).data.user?.id,
      series_title: normalizedTitle,
      reference_url: referenceUrl,
      reference_host: referenceHost,
      note: payload.note?.trim() || null,
      status: 'pending',
    })
    .select(SERIES_REQUEST_SELECT)
    .single();

  if (error) {
    throw new Error(getErrorMessage(error, 'Seri isteği oluşturulamadı'));
  }

  return mapSeriesRequestRow(data as SeriesRequestRow);
};

export const updateSeriesRequest = async (payload: {
  requestId: string;
  status: SeriesRequestStatus;
  adminNote?: string | null;
}): Promise<SeriesRequest> => {
  await ensureSession();

  const userResult = await supabase.auth.getUser();
  const reviewerId = userResult.data.user?.id;
  if (!reviewerId) {
    throw new Error('Oturum bulunamadı');
  }

  const { data, error } = await supabase
    .from('series_requests')
    .update({
      status: payload.status,
      admin_note: payload.adminNote?.trim() || null,
      reviewed_at: new Date().toISOString(),
      reviewed_by: reviewerId,
    })
    .eq('id', payload.requestId)
    .select(SERIES_REQUEST_SELECT)
    .single();

  if (error) {
    throw new Error(getErrorMessage(error, 'Seri isteği güncellenemedi'));
  }

  return mapSeriesRequestRow(data as SeriesRequestRow);
};
