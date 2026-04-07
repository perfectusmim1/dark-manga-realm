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
  const [isLoadingRequests, setIsLoadingRequests] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const loadRequestsPromiseRef = useRef<Promise<void> | null>(null);

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
      const createdRequest = await createSeriesRequest({
        seriesTitle,
        referenceUrl,
        note,
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
            <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
              <div className="space-y-2">
                <Badge variant="outline" className="w-fit border-primary/20 bg-primary/10 text-primary">
                  Seri İstekleri
                </Badge>
                <h1 className="text-2xl font-black tracking-tight sm:text-3xl">
                  İstediğin seriyi hızlıca bırak.
                </h1>
                <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
                  Seri adı ve bir kaynak link yeterli. Linki ben kontrol edip durumu burada güncelleyeyim.
                </p>
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
                      <Label htmlFor="series-request-title">Seri adı</Label>
                      <Input
                        id="series-request-title"
                        value={seriesTitle}
                        onChange={(event) => setSeriesTitle(event.target.value)}
                        placeholder="Örn. The Boxer"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="series-request-url">Kaynak link</Label>
                      <Input
                        id="series-request-url"
                        value={referenceUrl}
                        onChange={(event) => setReferenceUrl(event.target.value)}
                        placeholder="https://..."
                      />
                    </div>

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

                  <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-xs leading-5 text-muted-foreground">
                      Linkte sadece `http/https` kabul edilir. Aynı aktif link için tekrar istek açılamaz.
                    </p>
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
