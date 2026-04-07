import React, { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { tr } from 'date-fns/locale';
import {
  CheckCircle2,
  Clock3,
  Copy,
  ExternalLink,
  Loader2,
  Search,
  Sparkles,
  User,
  XCircle,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/contexts/AuthContext';
import { getAllUsers } from '@/lib/database';
import {
  listSeriesRequests,
  SERIES_REQUEST_STATUS_LABELS,
  SERIES_REQUEST_STATUS_VALUES,
  updateSeriesRequest,
} from '@/lib/seriesRequests';
import type { SeriesRequest, SeriesRequestStatus } from '@/lib/types';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

type StatusFilterValue = SeriesRequestStatus | 'all';

const formatRequestTime = (value: string) => formatDistanceToNow(new Date(value), { addSuffix: true, locale: tr });

const statusMeta: Record<
  SeriesRequestStatus,
  {
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    badgeTone: string;
    panelTone: string;
  }
> = {
  pending: {
    label: SERIES_REQUEST_STATUS_LABELS.pending,
    icon: Clock3,
    badgeTone: 'border-amber-500/25 bg-amber-500/12 text-amber-100',
    panelTone: 'from-amber-500/14 via-amber-500/5 to-transparent',
  },
  in_review: {
    label: SERIES_REQUEST_STATUS_LABELS.in_review,
    icon: Search,
    badgeTone: 'border-sky-500/25 bg-sky-500/12 text-sky-100',
    panelTone: 'from-sky-500/14 via-sky-500/5 to-transparent',
  },
  approved: {
    label: SERIES_REQUEST_STATUS_LABELS.approved,
    icon: CheckCircle2,
    badgeTone: 'border-emerald-500/25 bg-emerald-500/12 text-emerald-100',
    panelTone: 'from-emerald-500/14 via-emerald-500/5 to-transparent',
  },
  rejected: {
    label: SERIES_REQUEST_STATUS_LABELS.rejected,
    icon: XCircle,
    badgeTone: 'border-rose-500/25 bg-rose-500/12 text-rose-100',
    panelTone: 'from-rose-500/14 via-rose-500/5 to-transparent',
  },
};

const filterLabels: Record<StatusFilterValue, string> = {
  all: 'Tümü',
  pending: SERIES_REQUEST_STATUS_LABELS.pending,
  in_review: SERIES_REQUEST_STATUS_LABELS.in_review,
  approved: SERIES_REQUEST_STATUS_LABELS.approved,
  rejected: SERIES_REQUEST_STATUS_LABELS.rejected,
};

const SeriesRequestBadge = ({ status }: { status: SeriesRequestStatus }) => {
  const StatusIcon = statusMeta[status].icon;

  return (
    <Badge variant="outline" className={`gap-1.5 border ${statusMeta[status].badgeTone}`}>
      <StatusIcon className="h-3.5 w-3.5" />
      {statusMeta[status].label}
    </Badge>
  );
};

const AdminSeriesRequests: React.FC = () => {
  const { user, isLoading: authLoading } = useAuth();
  const [requests, setRequests] = useState<SeriesRequest[]>([]);
  const [selectedRequestId, setSelectedRequestId] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilterValue>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [reviewStatus, setReviewStatus] = useState<SeriesRequestStatus>('pending');
  const [reviewNote, setReviewNote] = useState('');
  const [isLoadingRequests, setIsLoadingRequests] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const loadRequestsPromiseRef = useRef<Promise<void> | null>(null);
  const deferredSearchQuery = useDeferredValue(searchQuery);

  const loadRequests = useCallback(async (silent = false) => {
    if (!user) {
      setRequests([]);
      setSelectedRequestId('');
      return;
    }

    if (loadRequestsPromiseRef.current) {
      return loadRequestsPromiseRef.current;
    }

    const request = (async () => {
      try {
        if (!silent) {
          setIsLoadingRequests(true);
        }

        const [nextRequests, allUsers] = await Promise.all([
          listSeriesRequests(),
          getAllUsers(),
        ]);
        const userMap = new Map(allUsers.map((account) => [account.id, account]));
        const hydratedRequests = nextRequests.map((item) => ({
          ...item,
          userName: userMap.get(item.userId)?.username || item.userId,
          userEmail: userMap.get(item.userId)?.email || item.userEmail,
          reviewedByName: item.reviewedBy ? (userMap.get(item.reviewedBy)?.username || null) : null,
        }));

        setRequests(hydratedRequests);
        setSelectedRequestId((current) => (
          current && hydratedRequests.some((item) => item.id === current)
            ? current
            : hydratedRequests[0]?.id || ''
        ));
      } catch (error) {
        if (!silent) {
          console.error('Admin series requests load failed:', error);
          toast.error(error instanceof Error ? error.message : 'Seri istekleri yüklenemedi');
        }
      } finally {
        if (!silent) {
          setIsLoadingRequests(false);
        }
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

  const filteredRequests = useMemo(() => {
    const query = deferredSearchQuery.trim().toLocaleLowerCase('tr-TR');

    return requests.filter((request) => {
      const matchesStatus = statusFilter === 'all' || request.status === statusFilter;
      const matchesSearch = !query
        || request.seriesTitle.toLocaleLowerCase('tr-TR').includes(query)
        || request.userName.toLocaleLowerCase('tr-TR').includes(query)
        || request.userEmail.toLocaleLowerCase('tr-TR').includes(query)
        || request.referenceHost.toLocaleLowerCase('tr-TR').includes(query);

      return matchesStatus && matchesSearch;
    });
  }, [deferredSearchQuery, requests, statusFilter]);

  const selectedRequest = useMemo(
    () => filteredRequests.find((request) => request.id === selectedRequestId) || filteredRequests[0] || null,
    [filteredRequests, selectedRequestId],
  );

  useEffect(() => {
    if (!filteredRequests.length) {
      setSelectedRequestId('');
      return;
    }

    if (!filteredRequests.some((request) => request.id === selectedRequestId)) {
      setSelectedRequestId(filteredRequests[0].id);
    }
  }, [filteredRequests, selectedRequestId]);

  useEffect(() => {
    if (!selectedRequest) {
      return;
    }

    setReviewStatus(selectedRequest.status);
    setReviewNote(selectedRequest.adminNote || '');
  }, [selectedRequest?.id]);

  const counts = useMemo(() => ({
    all: requests.length,
    pending: requests.filter((request) => request.status === 'pending').length,
    in_review: requests.filter((request) => request.status === 'in_review').length,
    approved: requests.filter((request) => request.status === 'approved').length,
    rejected: requests.filter((request) => request.status === 'rejected').length,
  }), [requests]);

  const handleCopy = useCallback(async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(`${label} panoya kopyalandı`);
    } catch (error) {
      console.error('Series request clipboard failed:', error);
      toast.error(`${label} kopyalanamadı`);
    }
  }, []);

  const handleSaveReview = async () => {
    if (!selectedRequest) {
      return;
    }

    try {
      setIsSaving(true);
      const updatedRequest = await updateSeriesRequest({
        requestId: selectedRequest.id,
        status: reviewStatus,
        adminNote: reviewNote.trim() || null,
      });

      setRequests((current) => current.map((request) => (
        request.id === updatedRequest.id
          ? {
            ...updatedRequest,
            userName: request.userName,
            userEmail: request.userEmail,
            reviewedByName: user?.username || request.reviewedByName || null,
          }
          : request
      )));
      toast.success('Seri isteği güncellendi');
    } catch (error) {
      console.error('Series request review failed:', error);
      toast.error(error instanceof Error ? error.message : 'Seri isteği güncellenemedi');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <section className="rounded-[1.6rem] border border-white/10 bg-card/95 shadow-[0_18px_48px_rgba(2,6,23,0.28)]">
        <div className="space-y-4 p-4 sm:p-5">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
            <div className="max-w-2xl">
              <Badge variant="outline" className="w-fit gap-2 border-primary/20 bg-primary/10 px-2.5 py-1 text-primary">
                <Sparkles className="h-3.5 w-3.5" />
                Seri İstekleri
              </Badge>
              <h1 className="mt-3 text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
                Kullanıcıların seri taleplerini tek panelden yönet
              </h1>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                Linki kontrol et, statüyü güncelle ve gerekiyorsa kısa admin notu bırak.
              </p>
            </div>

            <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs text-foreground/85">
              {isLoadingRequests ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
              ) : (
                <Clock3 className="h-3.5 w-3.5 text-primary" />
              )}
              {isLoadingRequests ? 'Kayıtlar yenileniyor' : `${filteredRequests.length} kayıt görüntüleniyor`}
            </div>
          </div>

          <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-5">
            {([
              { key: 'all', count: counts.all },
              { key: 'pending', count: counts.pending },
              { key: 'in_review', count: counts.in_review },
              { key: 'approved', count: counts.approved },
              { key: 'rejected', count: counts.rejected },
            ] as const).map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => setStatusFilter(item.key)}
                className={cn(
                  'rounded-[1.2rem] border p-3 text-left transition-all duration-200',
                  statusFilter === item.key
                    ? 'border-white/14 bg-white/[0.07] shadow-[0_12px_32px_rgba(2,6,23,0.28)]'
                    : 'border-white/8 bg-black/10 hover:border-white/14 hover:bg-white/[0.04]',
                )}
              >
                <p className="text-lg font-semibold text-foreground">{item.count}</p>
                <p className="mt-1 text-sm text-foreground/80">{filterLabels[item.key]}</p>
              </button>
            ))}
          </div>
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-[minmax(380px,440px)_minmax(0,1fr)] xl:items-start">
        <section className="flex min-h-[36rem] min-w-0 flex-col overflow-hidden rounded-[1.6rem] border border-white/10 bg-card/95 shadow-[0_18px_48px_rgba(2,6,23,0.26)] xl:h-[calc(100vh-8.75rem)]">
          <div className="border-b border-white/10 p-4 sm:p-5">
            <div className="space-y-3">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="Seri adı, kullanıcı veya domain"
                  className="h-10 rounded-xl border-white/10 bg-white/[0.04] pl-10 text-sm text-foreground placeholder:text-muted-foreground"
                />
              </div>

              <div className="rounded-[1.1rem] border border-white/10 bg-white/[0.03] p-3">
                <p className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Aktif filtre</p>
                <p className="mt-2 text-sm font-medium text-foreground">{filterLabels[statusFilter]}</p>
              </div>
            </div>
          </div>

          <ScrollArea className="min-h-0 flex-1">
            <div className="space-y-2.5 p-4 sm:p-5">
              {filteredRequests.map((request) => (
                <button
                  key={request.id}
                  type="button"
                  onClick={() => setSelectedRequestId(request.id)}
                  className={cn(
                    'relative w-full overflow-hidden rounded-[1.2rem] border text-left transition-all duration-200',
                    selectedRequest?.id === request.id
                      ? 'border-white/14 bg-white/[0.07] shadow-[0_14px_36px_rgba(2,6,23,0.28)]'
                      : 'border-white/8 bg-black/10 hover:border-white/14 hover:bg-white/[0.04]',
                  )}
                >
                  <div className={cn('absolute inset-x-0 top-0 h-20 bg-gradient-to-b opacity-75', statusMeta[request.status].panelTone)} />
                  <div className="relative p-3.5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[15px] font-semibold leading-5 text-foreground">{request.seriesTitle}</p>
                        <p className="mt-1 truncate text-[11px] text-muted-foreground">
                          {request.userName}
                          <span className="mx-1.5 text-white/20">•</span>
                          {request.referenceHost}
                        </p>
                      </div>
                      <SeriesRequestBadge status={request.status} />
                    </div>

                    <p className="mt-3 text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                      {formatRequestTime(request.createdAt)}
                    </p>
                  </div>
                </button>
              ))}

              {filteredRequests.length === 0 && (
                <div className="rounded-[1.3rem] border border-dashed border-white/10 bg-white/[0.03] p-8 text-center">
                  <Loader2 className={cn('mx-auto h-9 w-9 text-muted-foreground/40', isLoadingRequests ? 'animate-spin' : '')} />
                  <p className="mt-4 text-base font-semibold text-foreground">
                    {isLoadingRequests ? 'Seri istekleri yükleniyor' : 'Eşleşen seri isteği bulunamadı'}
                  </p>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">
                    Aramayı temizle veya başka bir filtre seç.
                  </p>
                </div>
              )}
            </div>
          </ScrollArea>
        </section>

        <section className="rounded-[1.6rem] border border-white/10 bg-card/95 p-3.5 shadow-[0_18px_48px_rgba(2,6,23,0.26)] sm:p-4">
          {selectedRequest ? (
            <div className="space-y-4">
              <div className="relative overflow-hidden rounded-[1.35rem] border border-white/10 bg-background/40 p-4 shadow-[0_14px_40px_rgba(2,6,23,0.24)] sm:p-5">
                <div className={cn('absolute inset-0 bg-gradient-to-br opacity-80', statusMeta[selectedRequest.status].panelTone)} />

                <div className="relative space-y-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className="border-white/10 bg-white/[0.04] px-2.5 py-1 text-xs text-foreground/80">
                      #{selectedRequest.id.slice(0, 8)}
                    </Badge>
                    <SeriesRequestBadge status={selectedRequest.status} />
                  </div>

                  <div>
                    <h2 className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
                      {selectedRequest.seriesTitle}
                    </h2>
                    <p className="mt-2 text-sm leading-6 text-foreground/75">
                      İstek {formatRequestTime(selectedRequest.createdAt)} gönderildi. Son güncelleme {formatRequestTime(selectedRequest.updatedAt)}.
                    </p>
                  </div>

                  <div className="grid gap-2.5 sm:grid-cols-2">
                    <button
                      type="button"
                      onClick={() => void handleCopy(selectedRequest.userEmail, 'E-posta')}
                      className="inline-flex min-w-0 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5 text-left text-sm text-foreground/90 transition-colors hover:border-white/18 hover:bg-white/[0.06]"
                    >
                      <User className="h-4 w-4 shrink-0 text-primary" />
                      <span className="truncate">{selectedRequest.userEmail}</span>
                      <Copy className="ml-auto h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleCopy(selectedRequest.referenceUrl, 'Link')}
                      className="inline-flex min-w-0 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5 text-left text-sm text-foreground/90 transition-colors hover:border-white/18 hover:bg-white/[0.06]"
                    >
                      <Search className="h-4 w-4 shrink-0 text-primary" />
                      <span className="truncate">{selectedRequest.referenceHost}</span>
                      <Copy className="ml-auto h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    </button>
                  </div>
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-[1.2rem] border border-white/10 bg-white/[0.03] p-3.5">
                  <p className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Kullanıcı</p>
                  <p className="mt-2.5 text-sm font-medium leading-5 text-foreground">{selectedRequest.userName}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{selectedRequest.userEmail}</p>
                </div>
                <div className="rounded-[1.2rem] border border-white/10 bg-white/[0.03] p-3.5">
                  <p className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Kaynak</p>
                  <p className="mt-2.5 text-sm font-medium leading-5 text-foreground">{selectedRequest.referenceHost}</p>
                </div>
                <div className="rounded-[1.2rem] border border-white/10 bg-white/[0.03] p-3.5">
                  <p className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Gönderim</p>
                  <p className="mt-2.5 text-sm font-medium leading-5 text-foreground">{formatRequestTime(selectedRequest.createdAt)}</p>
                </div>
                <div className="rounded-[1.2rem] border border-white/10 bg-white/[0.03] p-3.5">
                  <p className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">İnceleyen</p>
                  <p className="mt-2.5 text-sm font-medium leading-5 text-foreground">
                    {selectedRequest.reviewedByName || 'Henüz yok'}
                  </p>
                </div>
              </div>

              <div className="rounded-[1.35rem] border border-white/10 bg-background/35 p-4 sm:p-5">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Referans</p>
                    <p className="mt-2 break-all text-sm leading-6 text-foreground/90">{selectedRequest.referenceUrl}</p>
                  </div>
                  <Button asChild variant="outline" className="w-full lg:w-auto">
                    <a href={selectedRequest.referenceUrl} target="_blank" rel="noreferrer">
                      <ExternalLink className="mr-2 h-4 w-4" />
                      Linki Aç
                    </a>
                  </Button>
                </div>
              </div>

              {selectedRequest.note ? (
                <div className="rounded-[1.35rem] border border-white/10 bg-background/35 p-4 sm:p-5">
                  <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Kullanıcı notu</p>
                  <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-6 text-foreground/90">
                    {selectedRequest.note}
                  </p>
                </div>
              ) : null}

              <div className="rounded-[1.35rem] border border-white/10 bg-background/35 p-4 sm:p-5">
                <div className="grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
                  <div className="space-y-2">
                    <Label>Durum</Label>
                    <Select value={reviewStatus} onValueChange={(value) => setReviewStatus(value as SeriesRequestStatus)}>
                      <SelectTrigger className="rounded-xl border-white/10 bg-white/[0.04]">
                        <SelectValue placeholder="Durum seç" />
                      </SelectTrigger>
                      <SelectContent>
                        {SERIES_REQUEST_STATUS_VALUES.map((status) => (
                          <SelectItem key={status} value={status}>{SERIES_REQUEST_STATUS_LABELS[status]}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="series-request-admin-note">Admin notu</Label>
                    <Textarea
                      id="series-request-admin-note"
                      value={reviewNote}
                      onChange={(event) => setReviewNote(event.target.value)}
                      placeholder="Kullanıcıya görünen kısa değerlendirme veya not."
                      className="min-h-[124px] resize-none rounded-[1.15rem] border-white/10 bg-white/[0.04] text-sm leading-6 text-foreground placeholder:text-muted-foreground"
                    />
                  </div>
                </div>

                <div className="mt-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <p className="text-xs leading-5 text-muted-foreground">
                    Kaydettiğinde kullanıcı kendi ekranında güncel statü ve notu görecek.
                  </p>
                  <Button onClick={() => void handleSaveReview()} disabled={isSaving}>
                    {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
                    Güncellemeyi Kaydet
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex min-h-[30rem] flex-col items-center justify-center rounded-[1.35rem] border border-dashed border-white/10 bg-white/[0.03] p-8 text-center">
              <Sparkles className="h-12 w-12 text-muted-foreground/40" />
              <h3 className="mt-4 text-xl font-semibold text-foreground">Seri isteği seçilmedi</h3>
              <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">
                Soldaki listeden bir kayıt seç. Detay, kaynak linki ve admin durumu bu panelde açılır.
              </p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
};

export default AdminSeriesRequests;
