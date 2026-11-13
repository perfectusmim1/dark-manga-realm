import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { tr } from 'date-fns/locale';
import {
  CheckCircle2,
  ExternalLink,
  Link2,
  Loader2,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  X,
  XCircle,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import Header from '@/components/layout/Header';
import OfflineRequiredScreen from '@/components/offline/OfflineRequiredScreen';
import { useAuth } from '@/contexts/AuthContext';
import { useEffectiveOnlineStatus } from '@/hooks/useEffectiveOnlineStatus';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  createSeriesRequest,
  listSeriesRequests,
  SERIES_REQUEST_STATUS_LABELS,
} from '@/lib/seriesRequests';
import {
  detectSeriesSource,
  fetchSeriesMetadataByUrl,
  formatSeriesMetadataSummary,
  type FetchedSeriesInfo,
} from '@/lib/seriesSourceFetch';
import type { SeriesRequest, SeriesRequestStatus } from '@/lib/types';
import { toast } from 'sonner';

const formatRequestTime = (value: string) => formatDistanceToNow(new Date(value), { addSuffix: true, locale: tr });

const statusMeta: Record<
  SeriesRequestStatus,
  {
    label: string;
    className: string;
    icon: React.ComponentType<{ className?: string }>;
  }
> = {
  pending: {
    label: SERIES_REQUEST_STATUS_LABELS.pending,
    className: 'border-amber-500/20 bg-amber-500/10 text-amber-200',
    icon: Send,
  },
  in_review: {
    label: SERIES_REQUEST_STATUS_LABELS.in_review,
    className: 'border-sky-500/20 bg-sky-500/10 text-sky-200',
    icon: Search,
  },
  approved: {
    label: SERIES_REQUEST_STATUS_LABELS.approved,
    className: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-200',
    icon: CheckCircle2,
  },
  rejected: {
    label: SERIES_REQUEST_STATUS_LABELS.rejected,
    className: 'border-rose-500/20 bg-rose-500/10 text-rose-200',
    icon: XCircle,
  },
};

const StatusBadge = ({ status }: { status: SeriesRequestStatus }) => {
  const StatusIcon = statusMeta[status].icon;

  return (
    <Badge variant="outline" className={`gap-1.5 border ${statusMeta[status].className}`}>
      <StatusIcon className="h-3.5 w-3.5" />
      {statusMeta[status].label}
    </Badge>
  );
};

const SeriesRequests: React.FC = () => {
  const { user, isLoading: authLoading } = useAuth();
  const { isOnline } = useEffectiveOnlineStatus();
  const [requests, setRequests] = useState<SeriesRequest[]>([]);
  const [seriesTitle, setSeriesTitle] = useState('');
  const [referenceUrl, setReferenceUrl] = useState('');
  const [note, setNote] = useState('');
  const [fetchedMetadata, setFetchedMetadata] = useState<FetchedSeriesInfo | null>(null);
  const [isFetchingMetadata, setIsFetchingMetadata] = useState(false);
  const [isLoadingRequests, setIsLoadingRequests] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const loadRequestsPromiseRef = useRef<Promise<void> | null>(null);
  const fetchAbortControllerRef = useRef<AbortController | null>(null);

  // AniList & MyAnimeList otomatik algılama ve veri çekme
  useEffect(() => {
    const trimmedUrl = referenceUrl.trim();
    const detected = detectSeriesSource(trimmedUrl);

    if (!detected) {
      setFetchedMetadata(null);
      setIsFetchingMetadata(false);
      if (fetchAbortControllerRef.current) {
        fetchAbortControllerRef.current.abort();
        fetchAbortControllerRef.current = null;
      }
      return;
    }

    if (fetchAbortControllerRef.current) {
      fetchAbortControllerRef.current.abort();
    }

    const controller = new AbortController();
    fetchAbortControllerRef.current = controller;
    setIsFetchingMetadata(true);

    const timer = setTimeout(async () => {
      try {
        const metadata = await fetchSeriesMetadataByUrl(trimmedUrl, controller.signal);
        if (metadata && !controller.signal.aborted) {
          setFetchedMetadata(metadata);
          setSeriesTitle(metadata.title);
          toast.success(`${metadata.providerLabel} serisi algılandı: "${metadata.title}"`);
        }
      } catch (err) {
        if (!controller.signal.aborted) {
          console.error('Otomatik seri bilgisi çekilemedi:', err);
          // Hata olsa dahi kullanıcıyı engellemiyoruz, serbest girişe devam edebilir
        }
      } finally {
        if (!controller.signal.aborted) {
          setIsFetchingMetadata(false);
        }
      }
    }, 350);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [referenceUrl]);

  const handleClearMetadata = () => {
    setFetchedMetadata(null);
    setSeriesTitle('');
  };

  const loadRequests = useCallback(async () => {
    if (!user) {
      setRequests([]);
      return;
    }

    if (loadRequestsPromiseRef.current) {
      return loadRequestsPromiseRef.current;
    }

    const request = (async () => {
      try {
        setIsLoadingRequests(true);
        const nextRequests = await listSeriesRequests();
        setRequests(nextRequests.map((item) => ({
          ...item,
          userName: user.username,
          userEmail: user.email,
        })));
      } catch (error) {
        console.error('Series requests load failed:', error);
        toast.error(error instanceof Error ? error.message : 'Seri istekleri yüklenemedi');
      } finally {
        setIsLoadingRequests(false);
      }
    })().finally(() => {
      if (loadRequestsPromiseRef.current === request) {
        loadRequestsPromiseRef.current = null;
      }
    });

    loadRequestsPromiseRef.current = request;
    return request;
  }, [user]);

  useEffect(() => {
    if (authLoading || !user) {
      return;
    }

    void loadRequests();
  }, [authLoading, loadRequests, user]);

  const stats = useMemo(() => ({
    total: requests.length,
    pending: requests.filter((request) => request.status === 'pending').length,
    approved: requests.filter((request) => request.status === 'approved').length,
  }), [requests]);

  const handleCreateRequest = async () => {
    if (!seriesTitle.trim()) {
      toast.error('Seri adı zorunlu');
      return;
    }

    if (!referenceUrl.trim()) {
      toast.error('Kontrol için seri linki zorunlu');
      return;
    }

    try {
      setIsSubmitting(true);

      let finalNote: string | undefined = note.trim() || undefined;
      if (fetchedMetadata) {
        const metaSummary = formatSeriesMetadataSummary(fetchedMetadata);
        if (finalNote) {
          finalNote = `${finalNote}\n\n[Otomatik Kaynak Bilgisi]\n${metaSummary}`;
        } else {
          finalNote = `[Otomatik Kaynak: ${fetchedMetadata.providerLabel}]\n${metaSummary}`;
        }
      }

      const createdRequest = await createSeriesRequest({
        seriesTitle,
        referenceUrl,
        note: finalNote,
      });

      setRequests((current) => [
        {
          ...createdRequest,
          userName: user?.username || '',
          userEmail: user?.email || '',
        },
        ...current,
      ]);
      setSeriesTitle('');
      setReferenceUrl('');
      setNote('');
      setFetchedMetadata(null);
      toast.success('Seri isteği gönderildi');
    } catch (error) {
      console.error('Series request create failed:', error);
      toast.error(error instanceof Error ? error.message : 'Seri isteği oluşturulamadı');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOnline) {
    return (
      <OfflineRequiredScreen
        title="Seri isteği için internet gerekli"
        description="Yeni seri isteği bırakmak ve durumunu görmek için bağlantı gerekiyor."
        actionHref="/downloads"
        actionLabel="İndirilenlere Git"
      />
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container pb-10 pt-20 sm:pt-24">
        <div className="space-y-6 pt-4 sm:pt-6">
          <section className="rounded-[1.8rem] border border-border bg-card p-5 shadow-sm sm:p-6">
            <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h1 className="text-2xl font-black tracking-tight sm:text-3xl">
                  Seri İstekleri
                </h1>
              </div>

              <div className="grid grid-cols-3 gap-2 sm:min-w-[20rem]">
                <div className="rounded-2xl border border-border bg-background px-3 py-3">
                  <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Toplam</p>
                  <p className="mt-1 text-xl font-bold">{stats.total}</p>
                </div>
                <div className="rounded-2xl border border-border bg-background px-3 py-3">
                  <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Bekleyen</p>
                  <p className="mt-1 text-xl font-bold">{stats.pending}</p>
                </div>
                <div className="rounded-2xl border border-border bg-background px-3 py-3">
                  <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Onay</p>
                  <p className="mt-1 text-xl font-bold">{stats.approved}</p>
                </div>
              </div>
            </div>
          </section>

          {authLoading ? (
            <section className="rounded-[1.8rem] border border-border bg-card p-8 text-center shadow-sm">
              <Loader2 className="mx-auto h-8 w-8 animate-spin text-primary" />
              <p className="mt-3 text-sm text-muted-foreground">Hesap bilgileri hazırlanıyor.</p>
            </section>
          ) : !user ? (
            <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
              <div className="rounded-[1.8rem] border border-border bg-card p-6 shadow-sm">
                <h2 className="text-xl font-semibold">Bu alan sadece kayıtlı kullanıcılar için açık.</h2>
                <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground">
                  Seri isteklerini hesaba bağlı tutuyorum. Böylece gönderdiğin kayıtlar ve admin geri dönüşleri tek yerde kalıyor.
                </p>
                <Button asChild className="mt-5">
                  <Link to="/auth">Giriş Yap</Link>
                </Button>
              </div>

              <div className="rounded-[1.8rem] border border-border bg-card p-6 shadow-sm">
                <h3 className="text-base font-semibold">Ne bırakmalısın?</h3>
                <div className="mt-4 space-y-3 text-sm text-muted-foreground">
                  <p>Seri adını mümkün olduğunca net yaz.</p>
                  <p>Kontrol edebilmem için bir seri sayfası linki ekle.</p>
                  <p>Alternatif isim veya not varsa kısa ekle.</p>
                </div>
              </div>
            </section>
          ) : (
            <>
              <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
                <div className="rounded-[1.8rem] border border-border bg-card p-5 shadow-sm sm:p-6">
                  <h2 className="text-lg font-semibold">Yeni istek</h2>
                  <div className="mt-5 grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <div className="flex min-h-6 items-center justify-between">
                        <Label htmlFor="series-request-url">Kaynak link</Label>
                        {isFetchingMetadata ? (
                          <span className="inline-flex items-center gap-1 text-xs text-primary">
                            <Loader2 className="h-3 w-3 animate-spin" />
                            Bilgiler çekiliyor...
                          </span>
                        ) : fetchedMetadata ? (
                          <Badge
                            variant="outline"
                            className={
                              fetchedMetadata.provider === 'anilist'
                                ? 'border-sky-500/30 bg-sky-500/10 text-sky-300 gap-1 text-[11px]'
                                : 'border-blue-500/30 bg-blue-500/10 text-blue-300 gap-1 text-[11px]'
                            }
                          >
                            <Sparkles className="h-3 w-3" />
                            {fetchedMetadata.providerLabel}
                          </Badge>
                        ) : null}
                      </div>
                      <Input
                        id="series-request-url"
                        value={referenceUrl}
                        onChange={(event) => setReferenceUrl(event.target.value)}
                        placeholder="https://anilist.co/..., https://myanimelist.net/... veya serbest link"
                      />
                    </div>

                    <div className="space-y-2">
                      <div className="flex min-h-6 items-center justify-between">
                        <Label htmlFor="series-request-title">Seri adı</Label>
                      </div>
                      <Input
                        id="series-request-title"
                        value={seriesTitle}
                        onChange={(event) => setSeriesTitle(event.target.value)}
                        placeholder="Örn. The Boxer"
                      />
                    </div>

                    {fetchedMetadata ? (
                      <div className="md:col-span-2 overflow-hidden rounded-2xl border border-primary/20 bg-primary/[0.04] p-3.5 transition-all">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex items-start gap-3.5 min-w-0">
                            {fetchedMetadata.coverUrl ? (
                              <img
                                src={fetchedMetadata.coverUrl}
                                alt={fetchedMetadata.title}
                                referrerPolicy="no-referrer"
                                className="h-20 w-14 shrink-0 rounded-xl object-cover border border-white/10 shadow-sm"
                              />
                            ) : null}
                            <div className="min-w-0 space-y-1">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <Badge variant="secondary" className="text-[10px] uppercase font-bold tracking-wider">
                                  {fetchedMetadata.providerLabel}
                                </Badge>
                                {fetchedMetadata.format ? (
                                  <Badge variant="outline" className="text-[10px] text-muted-foreground">
                                    {fetchedMetadata.format}
                                  </Badge>
                                ) : null}
                                {fetchedMetadata.year ? (
                                  <span className="text-xs text-muted-foreground">{fetchedMetadata.year}</span>
                                ) : null}
                                {fetchedMetadata.score ? (
                                  <span className="text-xs font-semibold text-amber-300">★ {fetchedMetadata.score}</span>
                                ) : null}
                              </div>

                              <p className="truncate text-sm font-semibold text-foreground">
                                {fetchedMetadata.title}
                              </p>

                              {fetchedMetadata.genres.length > 0 ? (
                                <div className="flex flex-wrap gap-1 pt-0.5">
                                  {fetchedMetadata.genres.slice(0, 4).map((g) => (
                                    <span key={g} className="rounded-md bg-white/[0.06] px-1.5 py-0.5 text-[10px] text-foreground/80">
                                      {g}
                                    </span>
                                  ))}
                                </div>
                              ) : null}

                              {fetchedMetadata.authors.length > 0 ? (
                                <p className="text-[11px] text-muted-foreground truncate">
                                  Yazar: {fetchedMetadata.authors.slice(0, 2).join(', ')}
                                </p>
                              ) : null}
                            </div>
                          </div>

                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground hover:text-foreground shrink-0"
                            onClick={handleClearMetadata}
                            title="Bilgileri Temizle"
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    ) : null}

                    <div className="space-y-2 md:col-span-2">
                      <Label htmlFor="series-request-note">Not</Label>
                      <Textarea
                        id="series-request-note"
                        value={note}
                        onChange={(event) => setNote(event.target.value)}
                        placeholder="Alternatif isim, istediğin kaynak veya kısa açıklama."
                        className="min-h-28 resize-none"
                      />
                    </div>
                  </div>

                  <div className="mt-5 flex justify-end">
                    <Button onClick={() => void handleCreateRequest()} disabled={isSubmitting}>
                      {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
                      Gönder
                    </Button>
                  </div>
                </div>

                <div className="rounded-[1.8rem] border border-border bg-card p-5 shadow-sm sm:p-6">
                  <h3 className="text-base font-semibold">İnceleme akışı</h3>
                  <div className="mt-4 space-y-4 text-sm text-muted-foreground">
                    <div>
                      <p className="font-medium text-foreground">1. Beklemede</p>
                      <p className="mt-1 leading-6">Kayıt alındı, kontrol sırasına girdi.</p>
                    </div>
                    <div>
                      <p className="font-medium text-foreground">2. İnceleniyor</p>
                      <p className="mt-1 leading-6">Kaynak link ve seri uygunluğu kontrol ediliyor.</p>
                    </div>
                    <div>
                      <p className="font-medium text-foreground">3. Sonuç</p>
                      <p className="mt-1 leading-6">Onay veya red ile beraber admin notu burada görünür.</p>
                    </div>
                  </div>
                </div>
              </section>

              <section className="rounded-[1.8rem] border border-border bg-card p-5 shadow-sm sm:p-6">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h2 className="text-lg font-semibold">Gönderdiğin istekler</h2>
                    <p className="text-sm text-muted-foreground">
                      {isLoadingRequests ? 'Kayıtlar yükleniyor...' : `${requests.length} kayıt bulundu`}
                    </p>
                  </div>

                  <Button variant="outline" onClick={() => void loadRequests()} disabled={isLoadingRequests}>
                    {isLoadingRequests ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}
                    Yenile
                  </Button>
                </div>

                <div className="mt-5 space-y-3">
                  {requests.map((request) => (
                    <article key={request.id} className="rounded-[1.4rem] border border-border bg-background/70 p-4 sm:p-5">
                      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="text-lg font-semibold">{request.seriesTitle}</h3>
                            <StatusBadge status={request.status} />
                            {(() => {
                              const detected = detectSeriesSource(request.referenceUrl);
                              if (!detected) return null;
                              return (
                                <Badge
                                  variant="outline"
                                  className={
                                    detected.provider === 'anilist'
                                      ? 'border-sky-500/30 bg-sky-500/10 text-sky-300 gap-1 text-[11px]'
                                      : 'border-blue-500/30 bg-blue-500/10 text-blue-300 gap-1 text-[11px]'
                                  }
                                >
                                  <Sparkles className="h-3 w-3" />
                                  {detected.provider === 'anilist' ? 'AniList' : 'MyAnimeList'}
                                </Badge>
                              );
                            })()}
                          </div>

                          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-muted-foreground">
                            <span>{formatRequestTime(request.createdAt)}</span>
                            <span>{request.referenceHost}</span>
                            <span>Son güncelleme: {formatRequestTime(request.updatedAt)}</span>
                          </div>
                        </div>

                        <Button asChild variant="outline" size="sm" className="w-full lg:w-auto">
                          <a href={request.referenceUrl} target="_blank" rel="noreferrer">
                            <ExternalLink className="mr-2 h-4 w-4" />
                            Linki Aç
                          </a>
                        </Button>
                      </div>

                      <div className="mt-4 grid gap-3 lg:grid-cols-2">
                        <div className="rounded-2xl border border-border bg-card p-4">
                          <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Senin notun</p>
                          <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-foreground/90">
                            {request.note || 'Not bırakılmadı.'}
                          </p>
                        </div>

                        <div className="rounded-2xl border border-border bg-card p-4">
                          <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Admin notu</p>
                          <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-foreground/90">
                            {request.adminNote || 'Henüz admin notu eklenmedi.'}
                          </p>
                          {request.reviewedAt ? (
                            <p className="mt-3 inline-flex items-center gap-2 text-xs text-muted-foreground">
                              <ShieldCheck className="h-3.5 w-3.5" />
                              {request.reviewedByName
                                ? `${request.reviewedByName} tarafından ${formatRequestTime(request.reviewedAt)}`
                                : formatRequestTime(request.reviewedAt)}
                            </p>
                          ) : null}
                        </div>
                      </div>

                      <div className="mt-4 rounded-2xl border border-border bg-card p-4">
                        <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Kaynak link</p>
                        <p className="mt-2 break-all text-sm leading-6 text-foreground/90">
                          <Link2 className="mr-2 inline h-4 w-4 text-primary" />
                          {request.referenceUrl}
                        </p>
                      </div>
                    </article>
                  ))}

                  {!isLoadingRequests && requests.length === 0 ? (
                    <div className="rounded-[1.4rem] border border-dashed border-border bg-background/50 p-10 text-center">
                      <p className="text-base font-medium">Henüz seri isteği göndermedin.</p>
                      <p className="mt-2 text-sm text-muted-foreground">İlk kaydı yukarıdaki formdan bırakabilirsin.</p>
                    </div>
                  ) : null}
                </div>
              </section>
            </>
          )}
        </div>
      </main>
    </div>
  );
};

export default SeriesRequests;
