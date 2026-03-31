import React from 'react';
import {
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
  buildMaterializedGalleryObjectKey,
  canMaterializeRemoteMedia,
  isStoredMediaUrl,
  materializeRemoteImages,
} from '@/lib/mediaStorage';
import { useAuth } from '@/contexts/AuthContext';
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

const AdminMediaMigration: React.FC = () => {
  const { user, session, mfaState, isLoading: authLoading } = useAuth();
  const [batchSize, setBatchSize] = React.useState('20');
  const [isLoading, setIsLoading] = React.useState(true);
  const [processingKey, setProcessingKey] = React.useState<ProcessingKey>(null);
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

    return Math.max(1, Math.min(2000, numeric));
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

  const refreshDashboard = React.useCallback(async () => {
    if (authLoading || !user || !session?.access_token || mfaState.needsVerification) {
      return;
    }

    await loadCandidates();
  }, [authLoading, loadCandidates, mfaState.needsVerification, session?.access_token, user]);

  React.useEffect(() => {
    if (authLoading) {
      return;
    }

    if (!user || !session?.access_token || mfaState.needsVerification) {
      return;
    }

    void refreshDashboard();
  }, [authLoading, mfaState.needsVerification, refreshDashboard, session?.access_token, user]);

  const migrateMangaMediaBatch = async () => {
    if (!mediaEnabled) {
      toast.error('Medya ingest yapılandırması eksik');
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
      toast.error('Medya ingest yapılandırması eksik');
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
      toast.error('Medya ingest yapılandırması eksik');
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
      toast.error('Medya ingest yapılandırması eksik');
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
                image.url || image.sourceUrl || `${index}`,
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

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <UploadCloud className="h-5 w-5 text-primary" />
            Medya Taşıma
          </CardTitle>
          <CardDescription>
            Dış kaynaklı kapak, banner, profil ve galeri görsellerini sıkıştırılmış WebP olarak R2&apos;ye taşır.
            Public tarafta bu işlemden sonra proxy yerine doğrudan bucket URL&apos;si kullanılır.
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
                {mediaEnabled ? 'Medya ingest aktif' : 'Medya ingest eksik'}
              </Badge>
              <Button
                type="button"
                variant="outline"
                onClick={() => void refreshDashboard()}
                disabled={isLoading || Boolean(processingKey)}
              >
                {isLoading ? (
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
              Bucket public URL veya admin medya-ingest backend yapılandırması eksik.
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
                        {card.count} kayıt taşınmayı bekliyor
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
                    Sonraki {Math.min(parsedBatchSize, card.count)} kaydı taşı
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="rounded-xl border border-border bg-muted/20 px-4 py-3 text-sm text-muted-foreground">
            Geçiş mantığı idempotent çalışır. Zaten R2 üzerinde duran URL&apos;ler tekrar taşınmaz;
            yarıda kesilirse aynı ekrandan devam edebilirsin.
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default AdminMediaMigration;
