import type { OfflineDownloadStatus } from './types';

export const OFFLINE_DOWNLOAD_STATUS_LABELS: Record<OfflineDownloadStatus, string> = {
  queued: 'Sırada',
  running: 'İndiriliyor',
  paused: 'Duraklatıldı',
  completed: 'Tamamlandı',
  failed: 'Başarısız',
  partial: 'Kısmi',
  cancelled: 'İptal Edildi',
};

export const getOfflineDownloadStatusLabel = (status?: OfflineDownloadStatus | string | null): string => {
  const normalized = `${status || ''}`.trim().toLocaleLowerCase('en-US') as OfflineDownloadStatus;
  if (!normalized) {
    return 'Bilinmiyor';
  }
  return OFFLINE_DOWNLOAD_STATUS_LABELS[normalized] || 'Beklemede';
};
