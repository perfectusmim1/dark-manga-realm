import React from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock3,
  HardDrive,
  ImageIcon,
  Loader2,
  RefreshCw,
  UploadCloud,
} from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  getArtistMediaRecords,
  getAuthorMediaRecords,
  getCharacterMediaRecords,
  getMangaMediaRecords,
  type MangaMediaRecord,
  type NamedEntityMediaRecord,
  updateArtistMedia,
  updateArtistImageUrl,
  updateAuthorMedia,
  updateAuthorImageUrl,
  updateCharacterMedia,
  updateCharacterImageUrl,
  updateMangaMediaUrls,
} from '@/lib/database';
import {
  getAdminMediaMetrics,
  type AdminMediaMetricsBreakdownRow,
  type AdminMediaMetricsSnapshot,
} from '@/lib/adminMediaMetrics';
import {
  buildMaterializedGalleryObjectKey,
  canMaterializeRemoteMedia,
  isStoredMediaUrl,
  materializeRemoteImages,
} from '@/lib/mediaStorage';
import type { EntityGalleryImage } from '@/lib/types';

type ProcessingKey =
  | 'manga-media'
  | 'manga-gallery'
  | 'character-profile'
  | 'character-gallery'
  | 'author-profile'
  | 'author-gallery'
  | 'artist-profile'
  | 'artist-gallery'
  | null;

type EntityType = 'character' | 'author' | 'artist';

const normalizeUrl = (value?: string | null) => value?.trim() || '';

const getExternalMediaUrl = (value?: string | null) => {
  const normalized = normalizeUrl(value);
  if (!normalized || isStoredMediaUrl(normalized)) {
    return undefined;
  }

  return normalized;
};

const getExternalGalleryImages = (gallery?: EntityGalleryImage[]) => (
  (gallery || []).filter((image) => Boolean(getExternalMediaUrl(image?.url)))
);

const formatBytes = (value: number) => {
  if (!Number.isFinite(value) || value <= 0) {
    return '0 B';
  }

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = value;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }

  return `${size >= 10 || unitIndex === 0 ? size.toFixed(0) : size.toFixed(1)} ${units[unitIndex]}`;
};

const formatDateTime = (value?: string | null) => {
  if (!value) {
    return 'Henüz veri yok';
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return 'Henüz veri yok';
  }

  return parsed.toLocaleString('tr-TR');
};

const CandidatePreviewList = ({ values }: { values: string[] }) => {
  if (values.length === 0) {
    return <p className="text-xs text-muted-foreground">Taşınacak kayıt kalmadı.</p>;
  }

  return (
    <div className="space-y-1">
      {values.slice(0, 5).map((value) => (
        <p key={value} className="truncate text-xs text-muted-foreground">
          {value}
        </p>
      ))}
      {values.length > 5 ? (
        <p className="text-xs text-muted-foreground">
          +{values.length - 5} kayıt daha
        </p>
      ) : null}
    </div>
  );
};

const LabelledInput = ({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) => (
  <div className="space-y-2">
    <p className="text-sm font-medium">{label}</p>
    <Input
      value={value}
      onChange={(event) => onChange(event.target.value)}
      inputMode="numeric"
      className="w-full md:w-40"
    />
  </div>
);

const MetricBreakdownList = ({
  rows,
  emptyText,
  showBytes = false,
}: {
  rows: AdminMediaMetricsBreakdownRow[];
  emptyText: string;
  showBytes?: boolean;
}) => {
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">{emptyText}</p>;
  }

  return (
    <div className="space-y-3">
      {rows.map((row) => (
        <div
          key={`${row.label}-${row.sublabel || ''}`}
          className="rounded-2xl border border-border/70 bg-background/70 px-4 py-4"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold capitalize">{row.label}</p>
              {row.sublabel ? (
                <p className="mt-1 truncate text-xs text-muted-foreground">{row.sublabel}</p>
              ) : null}
            </div>
            <Badge variant={row.errors > 0 ? 'destructive' : 'secondary'}>
              {row.requests}
            </Badge>
          </div>

          <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
            <span>{row.errors} hata</span>
            <span>{row.averageDurationMs} ms ort.</span>
            {showBytes ? <span>{formatBytes(row.bytesTotal || 0)}</span> : null}
            <span>Son: {formatDateTime(row.lastSeenAt)}</span>
          </div>
        </div>
      ))}
    </div>
  );
};

const MetricSummaryCard = ({
  icon: Icon,
  label,
  value,
  description,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  description: string;
}) => (
  <div className="rounded-2xl border border-border/70 bg-background/70 px-4 py-4">
    <div className="flex items-center gap-3">
      <div className="rounded-xl border border-primary/20 bg-primary/10 p-2 text-primary">
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0">
        <p className="text-xs font-bold uppercase tracking-[0.22em] text-muted-foreground">
          {label}
        </p>
        <p className="mt-2 text-2xl font-bold">{value}</p>
      </div>
    </div>
    <p className="mt-3 text-xs text-muted-foreground">{description}</p>
  </div>
);

const AdminMediaMigration: React.FC = () => {
  const [batchSize, setBatchSize] = React.useState('20');
  const [isLoading, setIsLoading] = React.useState(true);
  const [metricsLoading, setMetricsLoading] = React.useState(true);
  const [processingKey, setProcessingKey] = React.useState<ProcessingKey>(null);
  const [metrics, setMetrics] = React.useState<AdminMediaMetricsSnapshot | null>(null);
  const [metricsError, setMetricsError] = React.useState<string | null>(null);
  const [mangaCandidates, setMangaCandidates] = React.useState<MangaMediaRecord[]>([]);
  const [characterCandidates, setCharacterCandidates] = React.useState<NamedEntityMediaRecord[]>([]);
  const [authorCandidates, setAuthorCandidates] = React.useState<NamedEntityMediaRecord[]>([]);
  const [artistCandidates, setArtistCandidates] = React.useState<NamedEntityMediaRecord[]>([]);

  const mediaEnabled = canMaterializeRemoteMedia();
  const parsedBatchSize = React.useMemo(() => {
    const numeric = Number.parseInt(batchSize, 10);
    if (!Number.isFinite(numeric)) {
      return 20;
    }

    return Math.max(1, Math.min(100, numeric));
  }, [batchSize]);

  const loadCandidates = React.useCallback(async () => {
    setIsLoading(true);

    try {
      const [mangas, characters, authors, artists] = await Promise.all([
        getMangaMediaRecords(),
        getCharacterMediaRecords(),
        getAuthorMediaRecords(),
        getArtistMediaRecords(),
      ]);

      setMangaCandidates(mangas);
      setCharacterCandidates(characters);
      setAuthorCandidates(authors);
      setArtistCandidates(artists);
    } catch (error) {
      console.error(error);
      toast.error('Media migration kayıtları yüklenemedi');
    } finally {
      setIsLoading(false);
    }
  }, []);

  const loadMetrics = React.useCallback(async () => {
    setMetricsLoading(true);
    setMetricsError(null);

    try {
      const nextMetrics = await getAdminMediaMetrics();
      setMetrics(nextMetrics);
    } catch (error) {
      console.error(error);
      setMetrics(null);
      setMetricsError(error instanceof Error ? error.message : 'Metrics yüklenemedi');
    } finally {
      setMetricsLoading(false);
    }
  }, []);

  const refreshDashboard = React.useCallback(async () => {
    await Promise.all([
      loadCandidates(),
      loadMetrics(),
    ]);
  }, [loadCandidates, loadMetrics]);

  React.useEffect(() => {
    void refreshDashboard();
  }, [refreshDashboard]);

  const migrateMangaMediaBatch = async () => {
    if (!mediaEnabled) {
      toast.error('Media ingest yapılandırması eksik');
      return;
    }

    const batch = mangaCandidates
      .filter((manga) => Boolean(getExternalMediaUrl(manga.cover)) || Boolean(getExternalMediaUrl(manga.banner)))
      .slice(0, parsedBatchSize);

    if (batch.length === 0) {
      toast.success('Taşınacak seri kapak veya banner kalmadı');
      return;
    }

    setProcessingKey('manga-media');

    try {
      const results = await materializeRemoteImages(
        batch.flatMap((manga) => {
          const items = [];
          const cover = getExternalMediaUrl(manga.cover);
          const banner = getExternalMediaUrl(manga.banner);

          if (cover) {
            items.push({
              id: `manga:${manga.id}:cover`,
              sourceUrl: cover,
              entityType: 'manga' as const,
              entityId: manga.id,
              variant: 'cover' as const,
            });
          }

          if (banner) {
            items.push({
              id: `manga:${manga.id}:banner`,
              sourceUrl: banner,
              entityType: 'manga' as const,
              entityId: manga.id,
              variant: 'banner' as const,
            });
          }

          return items;
        }),
      );

      const updates = await Promise.all(
        batch.map(async (manga) => {
          const nextCover = results.get(`manga:${manga.id}:cover`);
          const nextBanner = results.get(`manga:${manga.id}:banner`);

          if (!nextCover && !nextBanner) {
            return 0;
          }

          await updateMangaMediaUrls(manga.id, {
            ...(nextCover ? { cover: nextCover } : {}),
            ...(nextBanner ? { banner: nextBanner } : {}),
          });

          return 1;
        }),
      );

      toast.success(`${updates.reduce((sum, value) => sum + value, 0)} seri kaydı güncellendi`);
      await refreshDashboard();
    } catch (error) {
      console.error(error);
      toast.error('Seri görselleri taşınırken hata oluştu');
    } finally {
      setProcessingKey(null);
    }
  };

  const migrateMangaGalleryBatch = async () => {
    if (!mediaEnabled) {
      toast.error('Media ingest yapılandırması eksik');
      return;
    }

    const batch = mangaCandidates
      .filter((manga) => manga.galleryUrls.some((url) => Boolean(getExternalMediaUrl(url))))
      .slice(0, parsedBatchSize);

    if (batch.length === 0) {
      toast.success('Taşınacak seri galerisi kalmadı');
      return;
    }

    setProcessingKey('manga-gallery');

    try {
      const results = await materializeRemoteImages(
        batch.flatMap((manga) => (
          manga.galleryUrls.flatMap((url, index) => {
            const sourceUrl = getExternalMediaUrl(url);
            if (!sourceUrl) {
              return [];
            }

            return [{
              id: `manga:${manga.id}:gallery:${index}`,
              sourceUrl,
              entityType: 'manga' as const,
              entityId: manga.id,
              variant: 'gallery' as const,
              objectKey: buildMaterializedGalleryObjectKey('manga', manga.id, sourceUrl),
            }];
          })
        )),
      );

      let updatedCount = 0;
      for (const manga of batch) {
        const nextGalleryUrls = manga.galleryUrls.map((url, index) => (
          results.get(`manga:${manga.id}:gallery:${index}`) || url
        ));

        if (nextGalleryUrls.every((value, index) => value === manga.galleryUrls[index])) {
          continue;
        }

        await updateMangaMediaUrls(manga.id, { galleryUrls: nextGalleryUrls });
        updatedCount += 1;
      }

      toast.success(`${updatedCount} seri galerisi güncellendi`);
      await refreshDashboard();
    } catch (error) {
      console.error(error);
      toast.error('Seri galerileri taşınırken hata oluştu');
    } finally {
      setProcessingKey(null);
    }
  };

  const migrateEntityProfileBatch = async (
    entityType: EntityType,
    candidates: NamedEntityMediaRecord[],
  ) => {
    if (!mediaEnabled) {
      toast.error('Media ingest yapılandırması eksik');
      return;
    }

    const batch = candidates
      .filter((item) => Boolean(getExternalMediaUrl(item.imageUrl)))
      .slice(0, parsedBatchSize);

    if (batch.length === 0) {
      toast.success('Taşınacak profil görseli kalmadı');
      return;
    }

    setProcessingKey(`${entityType}-profile` as ProcessingKey);

    try {
      const results = await materializeRemoteImages(
        batch.flatMap((item) => {
          const sourceUrl = getExternalMediaUrl(item.imageUrl);
          if (!sourceUrl) {
            return [];
          }

          return [{
            id: `${entityType}:${item.id}:profile`,
            sourceUrl,
            entityType,
            entityId: item.id,
            variant: 'profile' as const,
          }];
        }),
      );

      await Promise.all(
        batch.map(async (item) => {
          const imageUrl = results.get(`${entityType}:${item.id}:profile`);
          if (!imageUrl) {
            return;
          }

          if (entityType === 'character') {
            await updateCharacterImageUrl(item.id, imageUrl);
            return;
          }

          if (entityType === 'author') {
            await updateAuthorImageUrl(item.id, imageUrl);
            return;
          }

          await updateArtistImageUrl(item.id, imageUrl);
        }),
      );

      toast.success(`${batch.length} kayıt işlendi`);
      await refreshDashboard();
    } catch (error) {
      console.error(error);
      toast.error('Profil görselleri taşınırken hata oluştu');
    } finally {
      setProcessingKey(null);
    }
  };

  const migrateEntityGalleryBatch = async (
    entityType: EntityType,
    candidates: NamedEntityMediaRecord[],
  ) => {
    if (!mediaEnabled) {
      toast.error('Media ingest yapılandırması eksik');
      return;
    }

    const batch = candidates
      .filter((item) => getExternalGalleryImages(item.gallery).length > 0)
      .slice(0, parsedBatchSize);

    if (batch.length === 0) {
      toast.success('Taşınacak galeri görseli kalmadı');
      return;
    }

    setProcessingKey(`${entityType}-gallery` as ProcessingKey);

    try {
      const results = await materializeRemoteImages(
        batch.flatMap((item) => (
          item.gallery.flatMap((image, index) => {
            const sourceUrl = getExternalMediaUrl(image.url);
            if (!sourceUrl) {
              return [];
            }

            return [{
              id: `${entityType}:${item.id}:gallery:${index}`,
              sourceUrl,
              entityType,
              entityId: item.id,
              variant: 'gallery' as const,
              objectKey: buildMaterializedGalleryObjectKey(
                entityType,
                item.id,
                image.sourceUrl || image.url || `${index}`,
              ),
            }];
          })
        )),
      );

      for (const item of batch) {
        const nextGallery = item.gallery.map((image, index) => {
          const materializedUrl = results.get(`${entityType}:${item.id}:gallery:${index}`);
          if (!materializedUrl) {
            return image;
          }

          return {
            ...image,
            url: materializedUrl,
            thumbUrl: materializedUrl,
            sourceUrl: normalizeUrl(image.sourceUrl) || normalizeUrl(image.url),
          };
        });

        if (nextGallery.every((image, index) => image.url === item.gallery[index]?.url)) {
          continue;
        }

        if (entityType === 'character') {
          await updateCharacterMedia(item.id, { gallery: nextGallery });
          continue;
        }

        if (entityType === 'author') {
          await updateAuthorMedia(item.id, { gallery: nextGallery });
          continue;
        }

        await updateArtistMedia(item.id, { gallery: nextGallery });
      }

      toast.success(`${batch.length} galeri kaydı işlendi`);
      await refreshDashboard();
    } catch (error) {
      console.error(error);
      toast.error('Galeri görselleri taşınırken hata oluştu');
    } finally {
      setProcessingKey(null);
    }
  };

  const summaryCards = [
    {
      key: 'manga-media' as const,
      title: 'Seri Kapak / Banner',
      count: mangaCandidates.filter((manga) => Boolean(getExternalMediaUrl(manga.cover)) || Boolean(getExternalMediaUrl(manga.banner))).length,
      preview: mangaCandidates
        .filter((manga) => Boolean(getExternalMediaUrl(manga.cover)) || Boolean(getExternalMediaUrl(manga.banner)))
        .map((item) => item.title),
      action: migrateMangaMediaBatch,
    },
    {
      key: 'manga-gallery' as const,
      title: 'Seri Galerisi',
      count: mangaCandidates.filter((manga) => manga.galleryUrls.some((url) => Boolean(getExternalMediaUrl(url)))).length,
      preview: mangaCandidates
        .filter((manga) => manga.galleryUrls.some((url) => Boolean(getExternalMediaUrl(url))))
        .map((item) => `${item.title} (${item.galleryUrls.filter((url) => Boolean(getExternalMediaUrl(url))).length})`),
      action: migrateMangaGalleryBatch,
    },
    {
      key: 'character-profile' as const,
      title: 'Karakter Profilleri',
      count: characterCandidates.filter((item) => Boolean(getExternalMediaUrl(item.imageUrl))).length,
      preview: characterCandidates
        .filter((item) => Boolean(getExternalMediaUrl(item.imageUrl)))
        .map((item) => item.name),
      action: () => migrateEntityProfileBatch('character', characterCandidates),
    },
    {
      key: 'character-gallery' as const,
      title: 'Karakter Galerileri',
      count: characterCandidates.filter((item) => getExternalGalleryImages(item.gallery).length > 0).length,
      preview: characterCandidates
        .filter((item) => getExternalGalleryImages(item.gallery).length > 0)
        .map((item) => `${item.name} (${getExternalGalleryImages(item.gallery).length})`),
      action: () => migrateEntityGalleryBatch('character', characterCandidates),
    },
    {
      key: 'author-profile' as const,
      title: 'Yazar Profilleri',
      count: authorCandidates.filter((item) => Boolean(getExternalMediaUrl(item.imageUrl))).length,
      preview: authorCandidates
        .filter((item) => Boolean(getExternalMediaUrl(item.imageUrl)))
        .map((item) => item.name),
      action: () => migrateEntityProfileBatch('author', authorCandidates),
    },
    {
      key: 'author-gallery' as const,
      title: 'Yazar Galerileri',
      count: authorCandidates.filter((item) => getExternalGalleryImages(item.gallery).length > 0).length,
      preview: authorCandidates
        .filter((item) => getExternalGalleryImages(item.gallery).length > 0)
        .map((item) => `${item.name} (${getExternalGalleryImages(item.gallery).length})`),
      action: () => migrateEntityGalleryBatch('author', authorCandidates),
    },
    {
      key: 'artist-profile' as const,
      title: 'Çizer Profilleri',
      count: artistCandidates.filter((item) => Boolean(getExternalMediaUrl(item.imageUrl))).length,
      preview: artistCandidates
        .filter((item) => Boolean(getExternalMediaUrl(item.imageUrl)))
        .map((item) => item.name),
      action: () => migrateEntityProfileBatch('artist', artistCandidates),
    },
    {
      key: 'artist-gallery' as const,
      title: 'Çizer Galerileri',
      count: artistCandidates.filter((item) => getExternalGalleryImages(item.gallery).length > 0).length,
      preview: artistCandidates
        .filter((item) => getExternalGalleryImages(item.gallery).length > 0)
        .map((item) => `${item.name} (${getExternalGalleryImages(item.gallery).length})`),
      action: () => migrateEntityGalleryBatch('artist', artistCandidates),
    },
  ];

  const totalPendingCount = summaryCards.reduce((sum, card) => sum + card.count, 0);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="h-5 w-5 text-primary" />
            Proxy ve Storage Ozeti
          </CardTitle>
          <CardDescription>
            Son 24 saatlik proxy trafigi ile R2&apos;ye yazilan medya hacmini ayni panelde toplar.
            Source ve operation bazli hangi hattin istek yedigini buradan okuyabilirsin.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {metricsError ? (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
              Metrics paneli hazir degil: {metricsError}
            </div>
          ) : null}

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <MetricSummaryCard
              icon={Activity}
              label="24 Saat Proxy"
              value={metricsLoading ? '...' : `${metrics?.summary.requests24h || 0}`}
              description="Scraper ve offline-image proxy isteklerinin toplami"
            />
            <MetricSummaryCard
              icon={AlertTriangle}
              label="24 Saat Hata"
              value={metricsLoading ? '...' : `${metrics?.summary.errors24h || 0}`}
              description="4xx, 5xx ve blocked eventlerinin toplam sayisi"
            />
            <MetricSummaryCard
              icon={Clock3}
              label="Ortalama Sure"
              value={metricsLoading ? '...' : `${metrics?.summary.averageDurationMs24h || 0} ms`}
              description="Son 24 saatte proxy cevap suresi ortalamasi"
            />
            <MetricSummaryCard
              icon={HardDrive}
              label="Yaklasik Storage"
              value={metricsLoading ? '...' : formatBytes(metrics?.summary.storedBytesTotal || 0)}
              description="Media ingest worker tarafindan R2&apos;ye yazilan toplam boyut"
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="border-border/70 bg-card/60">
              <CardHeader className="pb-3">
                <CardTitle className="text-lg">Scraper Proxy</CardTitle>
                <CardDescription>
                  Kaynak ve islem bazli son 24 saat istegi
                </CardDescription>
              </CardHeader>
              <CardContent>
                <MetricBreakdownList
                  rows={metrics?.scraper || []}
                  emptyText="Scraper proxy icin metrik bulunamadi."
                />
              </CardContent>
            </Card>

            <Card className="border-border/70 bg-card/60">
              <CardHeader className="pb-3">
                <CardTitle className="text-lg">Offline Image Proxy</CardTitle>
                <CardDescription>
                  Purpose ve entity bazli hangi gorsel yolu daha cok kullaniliyor
                </CardDescription>
              </CardHeader>
              <CardContent>
                <MetricBreakdownList
                  rows={metrics?.offline || []}
                  emptyText="Offline image proxy icin metrik bulunamadi."
                />
              </CardContent>
            </Card>

            <Card className="border-border/70 bg-card/60">
              <CardHeader className="pb-3">
                <CardTitle className="text-lg">R2 Dagilimi</CardTitle>
                <CardDescription>
                  Hangi entity ve varyant ne kadar yer kapliyor
                </CardDescription>
              </CardHeader>
              <CardContent>
                <MetricBreakdownList
                  rows={metrics?.storage || []}
                  emptyText="Storage dagilimi henuz olusmadi."
                  showBytes
                />
              </CardContent>
            </Card>
          </div>

          <div className="rounded-xl border border-border/70 bg-background/70 px-4 py-4 text-sm text-muted-foreground">
            Son veri: {metricsLoading ? 'Yukleniyor...' : formatDateTime(metrics?.summary.lastSeenAt)}
            {' • '}
            Son 24 saatte ingest edilen item: {metrics?.summary.ingestItems24h || 0}
            {' • '}
            Toplam kayitli obje: {metrics?.summary.storedObjectsTotal || 0}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <UploadCloud className="h-5 w-5 text-primary" />
            Medya Tasima
          </CardTitle>
          <CardDescription>
            Dis kaynakli kapak, banner, profil ve galeri gorsellerini sikistirilmis WebP olarak R2&apos;ye tasir.
            Public tarafta bu islemden sonra proxy yerine dogrudan bucket URL&apos;si kullanilir.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <LabelledInput
              label="Batch Boyutu"
              value={batchSize}
              onChange={setBatchSize}
            />

            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={mediaEnabled ? 'default' : 'destructive'}>
                {mediaEnabled ? 'Media ingest aktif' : 'Media ingest eksik'}
              </Badge>
              <Button
                type="button"
                variant="outline"
                onClick={() => void refreshDashboard()}
                disabled={isLoading || metricsLoading || Boolean(processingKey)}
              >
                {(isLoading || metricsLoading) ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="mr-2 h-4 w-4" />
                )}
                Yeniden Tara
              </Button>
            </div>
          </div>

          {!mediaEnabled ? (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
              `VITE_MEDIA_INGEST_URL`, `VITE_MEDIA_INGEST_TOKEN` ve bucket public URL yapilandirmasi eksik.
            </div>
          ) : null}

          <div className="grid gap-4 xl:grid-cols-2">
            {summaryCards.map((card) => (
              <Card key={card.key} className="border-border/70 bg-card/60">
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <CardTitle className="text-lg">{card.title}</CardTitle>
                      <CardDescription>
                        {card.count} kayit tasinmayi bekliyor
                      </CardDescription>
                    </div>
                    <Badge variant={card.count > 0 ? 'secondary' : 'outline'}>
                      {card.count}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <CandidatePreviewList values={card.preview} />

                  <Button
                    type="button"
                    className="w-full"
                    disabled={!mediaEnabled || card.count === 0 || processingKey !== null}
                    onClick={() => void card.action()}
                  >
                    {processingKey === card.key ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <ImageIcon className="mr-2 h-4 w-4" />
                    )}
                    Sonraki {Math.min(parsedBatchSize, card.count)} kaydi tasi
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="rounded-xl border border-border bg-muted/20 px-4 py-3 text-sm text-muted-foreground">
            Gecis mantigi idempotent calisir. Zaten R2 uzerinde duran URL&apos;ler tekrar tasinmaz;
            yarida kesilirse ayni ekrandan devam edebilirsin.
          </div>
        </CardContent>
      </Card>

      <Card className="border-border/70 bg-card/60">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            {totalPendingCount === 0 ? (
              <CheckCircle2 className="h-5 w-5 text-emerald-400" />
            ) : (
              <AlertTriangle className="h-5 w-5 text-amber-300" />
            )}
            Gecis Durumu
          </CardTitle>
          <CardDescription>
            Proxy ihtiyaci olan medya kalemleri burada ozetlenir. Bu sayi sifira yaklastikca public tarafta dis gorsel bagimliligi azalir.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {summaryCards.map((card) => (
            <div key={card.key} className="rounded-xl border border-border bg-background/60 px-4 py-4">
              <p className="text-xs font-bold uppercase tracking-[0.28em] text-muted-foreground">
                {card.title}
              </p>
              <p className="mt-3 text-3xl font-bold">{card.count}</p>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
};

export default AdminMediaMigration;
