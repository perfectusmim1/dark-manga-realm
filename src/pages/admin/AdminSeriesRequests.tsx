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
  Send,
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
import { detectSeriesSource } from '@/lib/seriesSourceFetch';
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
  }
> = {
  pending: {
    label: SERIES_REQUEST_STATUS_LABELS.pending,
    icon: Clock3,
    badgeTone: 'border-amber-500/25 bg-amber-500/12 text-amber-200',
  },
  in_review: {
    label: SERIES_REQUEST_STATUS_LABELS.in_review,
    icon: Search,
    badgeTone: 'border-sky-500/25 bg-sky-500/12 text-sky-200',
  },
  approved: {
    label: SERIES_REQUEST_STATUS_LABELS.approved,
    icon: CheckCircle2,
    badgeTone: 'border-emerald-500/25 bg-emerald-500/12 text-emerald-200',
  },
  rejected: {
    label: SERIES_REQUEST_STATUS_LABELS.rejected,
    icon: XCircle,
    badgeTone: 'border-rose-500/25 bg-rose-500/12 text-rose-200',
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
  const meta = statusMeta[status];
  const StatusIcon = meta.icon;

  return (
    <Badge variant="outline" className={cn('gap-1.5 border font-medium text-xs', meta.badgeTone)}>
      <StatusIcon className="h-3.5 w-3.5" />
      {meta.label}
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
    <div className="space-y-6 lg:space-y-8">
      {/* Header Bar */}
      <div className="overflow-hidden rounded-[2rem] border border-border bg-card/80 p-5 shadow-xl sm:p-6">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div className="space-y-2">
            <Badge variant="outline" className="w-fit gap-1.5 border-primary/20 bg-primary/10 text-primary">
              <Send className="h-3.5 w-3.5" /> Seri İstekleri
            </Badge>
            <h1 className="text-3xl font-black tracking-tight sm:text-4xl">Seri İstekleri</h1>
          </div>

          <div className="flex items-center gap-3 w-full xl:w-auto">
            <div className="relative w-full xl:w-80">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Seri adı, kullanıcı veya link..."
                className="pl-9 rounded-xl"
              />
            </div>
            {isLoadingRequests && <Loader2 className="h-5 w-5 animate-spin text-primary shrink-0" />}
          </div>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <button
          type="button"
          onClick={() => setStatusFilter('all')}
          className={cn(
            'rounded-3xl border p-5 text-left transition-all shadow-sm',
            statusFilter === 'all' ? 'border-primary/40 bg-primary/10' : 'border-border bg-card hover:bg-secondary/40'
          )}
        >
          <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">Toplam</p>
          <p className="mt-2 text-3xl font-black">{counts.all}</p>
        </button>

        <button
          type="button"
          onClick={() => setStatusFilter('pending')}
          className={cn(
            'rounded-3xl border p-5 text-left transition-all shadow-sm',
            statusFilter === 'pending' ? 'border-amber-500/40 bg-amber-500/10' : 'border-border bg-card hover:bg-secondary/40'
          )}
        >
          <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">Bekleyen</p>
          <p className="mt-2 text-3xl font-black text-amber-300">{counts.pending}</p>
        </button>

        <button
          type="button"
          onClick={() => setStatusFilter('in_review')}
          className={cn(
            'rounded-3xl border p-5 text-left transition-all shadow-sm',
            statusFilter === 'in_review' ? 'border-sky-500/40 bg-sky-500/10' : 'border-border bg-card hover:bg-secondary/40'
          )}
        >
          <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">İncelenen</p>
          <p className="mt-2 text-3xl font-black text-sky-300">{counts.in_review}</p>
        </button>

        <button
          type="button"
          onClick={() => setStatusFilter('approved')}
          className={cn(
            'rounded-3xl border p-5 text-left transition-all shadow-sm',
            statusFilter === 'approved' ? 'border-emerald-500/40 bg-emerald-500/10' : 'border-border bg-card hover:bg-secondary/40'
          )}
        >
          <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">Onaylanan</p>
          <p className="mt-2 text-3xl font-black text-emerald-300">{counts.approved}</p>
        </button>

        <button
          type="button"
          onClick={() => setStatusFilter('rejected')}
          className={cn(
            'rounded-3xl border p-5 text-left transition-all shadow-sm',
            statusFilter === 'rejected' ? 'border-rose-500/40 bg-rose-500/10' : 'border-border bg-card hover:bg-secondary/40'
          )}
        >
          <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">Reddedilen</p>
          <p className="mt-2 text-3xl font-black text-rose-300">{counts.rejected}</p>
        </button>
      </div>

      {/* Main 2-Column Split */}
      <div className="grid gap-6 xl:grid-cols-[380px_minmax(0,1fr)]">
        {/* Left List */}
        <section className="rounded-3xl border border-border bg-card p-4 shadow-sm sm:p-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">İstek Listesi</h2>
            <Badge variant="outline">{filteredRequests.length} kayıt</Badge>
          </div>

          <ScrollArea className="h-[620px] pr-2">
            <div className="space-y-3">
              {filteredRequests.map((request) => {
                const isSelected = selectedRequest?.id === request.id;
                return (
                  <button
                    key={request.id}
                    type="button"
                    onClick={() => setSelectedRequestId(request.id)}
                    className={cn(
                      'w-full rounded-2xl border p-3.5 text-left transition-colors',
                      isSelected
                        ? 'border-primary/40 bg-primary/10 shadow-sm'
                        : 'border-border bg-background/60 hover:bg-secondary/60'
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-semibold text-sm line-clamp-1">{request.seriesTitle}</p>
                      <SeriesRequestBadge status={request.status} />
                    </div>

                    <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
                      <span className="truncate max-w-[170px]">{request.userName}</span>
                      <span>{formatRequestTime(request.createdAt)}</span>
                    </div>

                    <div className="mt-1 text-[11px] text-muted-foreground/80 truncate">
                      {request.referenceHost}
                    </div>
                  </button>
                );
              })}

              {filteredRequests.length === 0 && (
                <div className="rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
                  İstek bulunamadı.
                </div>
              )}
            </div>
          </ScrollArea>
        </section>

        {/* Right Detail Panel */}
        <section className="rounded-3xl border border-border bg-card p-4 shadow-sm sm:p-6">
          {selectedRequest ? (
            <div className="space-y-6">
              {/* Header Box */}
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between border-b border-border pb-5">
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-2xl font-bold">{selectedRequest.seriesTitle}</h2>
                    <SeriesRequestBadge status={selectedRequest.status} />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Gönderim: {formatRequestTime(selectedRequest.createdAt)} • ID: #{selectedRequest.id.slice(0, 8)}
                  </p>
                </div>
              </div>

              {/* Info Badges Grid */}
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div className="rounded-2xl border border-border bg-background/50 p-3.5">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Kullanıcı</p>
                  <p className="mt-1 font-semibold text-sm truncate">{selectedRequest.userName}</p>
                  <p className="text-xs text-muted-foreground truncate">{selectedRequest.userEmail}</p>
                </div>

                <div className="rounded-2xl border border-border bg-background/50 p-3.5">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Kaynak</p>
                  <p className="mt-1 font-semibold text-sm truncate">{selectedRequest.referenceHost}</p>
                </div>

                <div className="rounded-2xl border border-border bg-background/50 p-3.5">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Tarih</p>
                  <p className="mt-1 font-semibold text-sm">{new Date(selectedRequest.createdAt).toLocaleDateString('tr-TR')}</p>
                </div>

                <div className="rounded-2xl border border-border bg-background/50 p-3.5">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">İnceleyen</p>
                  <p className="mt-1 font-semibold text-sm">{selectedRequest.reviewedByName || 'Henüz Yok'}</p>
                </div>
              </div>

              {/* Source Link Box */}
              <div className="rounded-2xl border border-border bg-background/50 p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-xs font-semibold text-muted-foreground">Kaynak Bağlantısı</p>
                      {(() => {
                        const detected = detectSeriesSource(selectedRequest.referenceUrl);
                        if (!detected) return null;
                        return (
                          <Badge
                            variant="outline"
                            className={cn(
                              'gap-1 text-[10px] py-0 px-2 font-medium',
                              detected.provider === 'anilist'
                                ? 'border-sky-500/30 bg-sky-500/10 text-sky-300'
                                : 'border-blue-500/30 bg-blue-500/10 text-blue-300',
                            )}
                          >
                            <Sparkles className="h-2.5 w-2.5" />
                            {detected.provider === 'anilist' ? 'AniList' : 'MyAnimeList'}
                          </Badge>
                        );
                      })()}
                    </div>
                    <p className="mt-1 break-all text-sm">{selectedRequest.referenceUrl}</p>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void handleCopy(selectedRequest.referenceUrl, 'Bağlantı')}
                    >
                      <Copy className="h-3.5 w-3.5 mr-1" /> Kopyala
                    </Button>
                    <Button asChild size="sm">
                      <a href={selectedRequest.referenceUrl} target="_blank" rel="noreferrer">
                        <ExternalLink className="h-3.5 w-3.5 mr-1" /> Aç
                      </a>
                    </Button>
                  </div>
                </div>
              </div>

              {/* User Note if exists */}
              {selectedRequest.note && (
                <div className="rounded-2xl border border-border bg-background/50 p-4">
                  <p className="text-xs font-semibold text-muted-foreground">Kullanıcı Notu</p>
                  <p className="mt-2 text-sm leading-6 whitespace-pre-wrap">{selectedRequest.note}</p>
                </div>
              )}

              {/* Admin Review Action Area */}
              <div className="rounded-2xl border border-border bg-background/70 p-5 space-y-4">
                <div className="grid gap-4 sm:grid-cols-[200px_minmax(0,1fr)]">
                  <div className="space-y-2">
                    <Label>Durum Değiştir</Label>
                    <Select value={reviewStatus} onValueChange={(val) => setReviewStatus(val as SeriesRequestStatus)}>
                      <SelectTrigger className="rounded-xl">
                        <SelectValue placeholder="Durum seç" />
                      </SelectTrigger>
                      <SelectContent>
                        {SERIES_REQUEST_STATUS_VALUES.map((status) => (
                          <SelectItem key={status} value={status}>
                            {SERIES_REQUEST_STATUS_LABELS[status]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="admin-note">Admin Notu</Label>
                    <Textarea
                      id="admin-note"
                      value={reviewNote}
                      onChange={(e) => setReviewNote(e.target.value)}
                      placeholder="İsteğe dair kısa durum veya yanıt notu..."
                      className="min-h-[90px] resize-none rounded-xl text-sm"
                    />
                  </div>
                </div>

                <div className="flex justify-end pt-2">
                  <Button onClick={() => void handleSaveReview()} disabled={isSaving}>
                    {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
                    Durumu Kaydet
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex min-h-[460px] flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-background/40 p-8 text-center">
              <Sparkles className="h-12 w-12 text-muted-foreground/40" />
              <h3 className="mt-4 text-xl font-semibold">İstek Seçilmedi</h3>
              <p className="mt-2 text-sm text-muted-foreground">Listeden bir istek seçerek detaylarını yönetebilirsiniz.</p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
};

export default AdminSeriesRequests;
