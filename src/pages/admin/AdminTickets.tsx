import React, { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { tr } from 'date-fns/locale';
import {
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Copy,
  LifeBuoy,
  Loader2,
  Mail,
  MessageSquareReply,
  Search,
  Send,
  ShieldAlert,
  User,
  XCircle,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Textarea } from '@/components/ui/textarea';
import SupportImageAttachment from '@/components/support/SupportImageAttachment';
import { SupportTicket, SupportTicketCategory, SupportTicketMessage, SupportTicketStatus } from '@/lib/types';
import { listSupportTickets, replyToSupportTicket, updateSupportTicketStatus } from '@/lib/supportTickets';
import { cn } from '@/lib/utils';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

type StatusFilterValue = SupportTicketStatus | 'all';

const categoryLabels: Record<SupportTicketCategory, string> = {
  bug_report: 'Bug Report',
  account: 'Hesap',
  content_issue: 'İçerik Sorunu',
  ban_appeal: 'Ban İtirazı',
  other: 'Diğer',
};

const statusMeta: Record<
  SupportTicketStatus,
  {
    label: string;
    tone: string;
    icon: React.ComponentType<{ className?: string }>;
  }
> = {
  open: {
    label: 'Açık',
    tone: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
    icon: CheckCircle2,
  },
  waiting_staff: {
    label: 'Staff Bekliyor',
    tone: 'border-sky-500/30 bg-sky-500/10 text-sky-300',
    icon: Clock3,
  },
  waiting_user: {
    label: 'Kullanıcı Bekliyor',
    tone: 'border-amber-500/30 bg-amber-500/10 text-amber-200',
    icon: MessageSquareReply,
  },
  closed: {
    label: 'Kapalı',
    tone: 'border-rose-500/30 bg-rose-500/10 text-rose-300',
    icon: XCircle,
  },
};

const filterLabels: Record<StatusFilterValue, string> = {
  all: 'Tümü',
  open: 'Açık',
  waiting_staff: 'Staff Bekliyor',
  waiting_user: 'Kullanıcı Bekliyor',
  closed: 'Kapalı',
};

const messageRoleLabels: Record<SupportTicketMessage['authorRole'], string> = {
  user: 'Kullanıcı',
  moderator: 'Moderatör',
  admin: 'Admin',
  system: 'Sistem',
};

const formatTicketTime = (value: string) => formatDistanceToNow(new Date(value), { addSuffix: true, locale: tr });

const TicketStatusBadge = ({
  status,
  className,
}: {
  status: SupportTicketStatus;
  className?: string;
}) => {
  const meta = statusMeta[status];
  const StatusIcon = meta.icon;

  return (
    <Badge
      variant="outline"
      className={cn(
        'gap-1.5 border font-medium text-xs',
        meta.tone,
        className,
      )}
    >
      <StatusIcon className="h-3.5 w-3.5" />
      {meta.label}
    </Badge>
  );
};

const AdminTickets: React.FC = () => {
  const { user, session, mfaState, isLoading: authLoading } = useAuth();
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [selectedTicketId, setSelectedTicketId] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<StatusFilterValue>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [reply, setReply] = useState('');
  const [replyImageUrl, setReplyImageUrl] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoadingTickets, setIsLoadingTickets] = useState(false);
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);
  const loadTicketsPromiseRef = useRef<Promise<void> | null>(null);
  const deferredSearchQuery = useDeferredValue(searchQuery);

  const loadTickets = useCallback(async (silent = false) => {
    if (!user || !session?.access_token || mfaState.needsVerification) {
      setTickets([]);
      setSelectedTicketId('');
      return;
    }

    if (loadTicketsPromiseRef.current) {
      return loadTicketsPromiseRef.current;
    }

    const request = (async () => {
      try {
        if (!silent) {
          setIsLoadingTickets(true);
        }

        const nextTickets = await listSupportTickets();
        setTickets(nextTickets);
        setSelectedTicketId((current) => {
          if (!nextTickets.length) {
            return '';
          }

          if (current && nextTickets.some((ticket) => ticket.id === current)) {
            return current;
          }

          return nextTickets[0].id;
        });
      } catch (error) {
        if (!silent) {
          console.error('Admin tickets load failed:', error);
          toast.error(error instanceof Error ? error.message : 'Destek biletleri yüklenemedi');
        }
      } finally {
        if (!silent) {
          setIsLoadingTickets(false);
        }
      }
    })().finally(() => {
      if (loadTicketsPromiseRef.current === request) {
        loadTicketsPromiseRef.current = null;
      }
    });

    loadTicketsPromiseRef.current = request;
    return request;
  }, [mfaState.needsVerification, session?.access_token, user]);

  useEffect(() => {
    if (authLoading || !user || !session?.access_token || mfaState.needsVerification) {
      return;
    }

    void loadTickets().catch(() => {});

    const syncIfVisible = () => {
      if (document.visibilityState !== 'visible') {
        return;
      }

      void loadTickets(true).catch(() => {});
    };

    const intervalId = window.setInterval(syncIfVisible, 12000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [authLoading, loadTickets, mfaState.needsVerification, session?.access_token, user]);

  const filteredTickets = useMemo(() => {
    const query = deferredSearchQuery.trim().toLocaleLowerCase('tr-TR');

    return tickets.filter((ticket) => {
      const matchesStatus = statusFilter === 'all' || ticket.status === statusFilter;
      const matchesSearch = !query
        || ticket.subject.toLocaleLowerCase('tr-TR').includes(query)
        || ticket.userName.toLocaleLowerCase('tr-TR').includes(query)
        || ticket.userEmail.toLocaleLowerCase('tr-TR').includes(query);

      return matchesStatus && matchesSearch;
    });
  }, [deferredSearchQuery, statusFilter, tickets]);

  const selectedTicket = useMemo(
    () => filteredTickets.find((ticket) => ticket.id === selectedTicketId) || filteredTickets[0] || null,
    [filteredTickets, selectedTicketId],
  );

  useEffect(() => {
    if (!filteredTickets.length) {
      return;
    }

    if (!filteredTickets.some((ticket) => ticket.id === selectedTicketId)) {
      setSelectedTicketId(filteredTickets[0].id);
    }
  }, [filteredTickets, selectedTicketId]);

  useEffect(() => {
    setReply('');
    setReplyImageUrl('');
  }, [selectedTicketId]);

  const counts = useMemo(() => ({
    all: tickets.length,
    open: tickets.filter((ticket) => ticket.status === 'open').length,
    waiting_staff: tickets.filter((ticket) => ticket.status === 'waiting_staff').length,
    waiting_user: tickets.filter((ticket) => ticket.status === 'waiting_user').length,
    closed: tickets.filter((ticket) => ticket.status === 'closed').length,
  }), [tickets]);

  const handleCopy = useCallback(async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(`${label} panoya kopyalandı`);
    } catch (error) {
      console.error('Copy ticket field failed', error);
      toast.error(`${label} kopyalanamadı`);
    }
  }, []);

  const handleReply = async () => {
    if (!selectedTicket) {
      return;
    }

    if (!reply.trim()) {
      toast.error('Yanıt yazılmalı');
      return;
    }

    if (selectedTicket.status === 'closed') {
      toast.error('Kapalı bilete yanıt gönderilemez');
      return;
    }

    try {
      setIsSubmitting(true);
      const updatedTicket = await replyToSupportTicket({
        ticketId: selectedTicket.id,
        message: reply.trim(),
        imageUrl: replyImageUrl.trim() || null,
      });
      setTickets((current) => current.map((ticket) => (
        ticket.id === updatedTicket.id ? updatedTicket : ticket
      )));
      setReply('');
      setReplyImageUrl('');
      toast.success('Yanıt gönderildi');
    } catch (error) {
      console.error('Admin ticket reply failed:', error);
      void loadTickets(true).catch(() => {});
      toast.error(error instanceof Error ? error.message : 'Cevap gönderilemedi');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCloseTicket = async () => {
    if (!selectedTicket) {
      return;
    }

    try {
      setIsUpdatingStatus(true);
      const updatedTicket = await updateSupportTicketStatus({
        ticketId: selectedTicket.id,
        status: 'closed',
      });
      setTickets((current) => current.map((ticket) => (
        ticket.id === updatedTicket.id ? updatedTicket : ticket
      )));
      toast.success('Destek bileti kapatıldı');
    } catch (error) {
      console.error('Admin ticket close failed:', error);
      toast.error(error instanceof Error ? error.message : 'Bilet kapatılamadı');
    } finally {
      setIsUpdatingStatus(false);
    }
  };

  const handleReopenTicket = async () => {
    if (!selectedTicket) {
      return;
    }

    try {
      setIsUpdatingStatus(true);
      const updatedTicket = await updateSupportTicketStatus({
        ticketId: selectedTicket.id,
        status: 'waiting_staff',
      });
      setTickets((current) => current.map((ticket) => (
        ticket.id === updatedTicket.id ? updatedTicket : ticket
      )));
      toast.success('Destek bileti yeniden açıldı');
    } catch (error) {
      console.error('Admin ticket reopen failed:', error);
      toast.error(error instanceof Error ? error.message : 'Bilet yeniden açılamadı');
    } finally {
      setIsUpdatingStatus(false);
    }
  };

  return (
    <div className="space-y-6 lg:space-y-8">
      {/* Top Header Card */}
      <div className="overflow-hidden rounded-[2rem] border border-border bg-card/80 p-5 shadow-xl sm:p-6">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div className="space-y-2">
            <Badge variant="outline" className="w-fit gap-1.5 border-primary/20 bg-primary/10 text-primary">
              <LifeBuoy className="h-3.5 w-3.5" /> Destek Talepleri
            </Badge>
            <h1 className="text-3xl font-black tracking-tight sm:text-4xl">Destek Talepleri</h1>
          </div>

          <div className="flex items-center gap-3 w-full xl:w-auto">
            <div className="relative w-full xl:w-80">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Başlık, isim veya e-posta..."
                className="pl-9 rounded-xl"
              />
            </div>
            {isLoadingTickets && <Loader2 className="h-5 w-5 animate-spin text-primary shrink-0" />}
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
          onClick={() => setStatusFilter('open')}
          className={cn(
            'rounded-3xl border p-5 text-left transition-all shadow-sm',
            statusFilter === 'open' ? 'border-emerald-500/40 bg-emerald-500/10' : 'border-border bg-card hover:bg-secondary/40'
          )}
        >
          <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">Açık</p>
          <p className="mt-2 text-3xl font-black text-emerald-300">{counts.open}</p>
        </button>

        <button
          type="button"
          onClick={() => setStatusFilter('waiting_staff')}
          className={cn(
            'rounded-3xl border p-5 text-left transition-all shadow-sm',
            statusFilter === 'waiting_staff' ? 'border-sky-500/40 bg-sky-500/10' : 'border-border bg-card hover:bg-secondary/40'
          )}
        >
          <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">Staff Bekliyor</p>
          <p className="mt-2 text-3xl font-black text-sky-300">{counts.waiting_staff}</p>
        </button>

        <button
          type="button"
          onClick={() => setStatusFilter('waiting_user')}
          className={cn(
            'rounded-3xl border p-5 text-left transition-all shadow-sm',
            statusFilter === 'waiting_user' ? 'border-amber-500/40 bg-amber-500/10' : 'border-border bg-card hover:bg-secondary/40'
          )}
        >
          <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">Kullanıcı Bekliyor</p>
          <p className="mt-2 text-3xl font-black text-amber-300">{counts.waiting_user}</p>
        </button>

        <button
          type="button"
          onClick={() => setStatusFilter('closed')}
          className={cn(
            'rounded-3xl border p-5 text-left transition-all shadow-sm',
            statusFilter === 'closed' ? 'border-rose-500/40 bg-rose-500/10' : 'border-border bg-card hover:bg-secondary/40'
          )}
        >
          <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">Kapalı</p>
          <p className="mt-2 text-3xl font-black text-rose-300">{counts.closed}</p>
        </button>
      </div>

      {/* 2-Column Split */}
      <div className="grid gap-6 xl:grid-cols-[380px_minmax(0,1fr)]">
        {/* Left Ticket List */}
        <section className="rounded-3xl border border-border bg-card p-4 shadow-sm sm:p-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">Bilet Listesi</h2>
            <Badge variant="outline">{filteredTickets.length} kayıt</Badge>
          </div>

          <ScrollArea className="h-[620px] pr-2">
            <div className="space-y-3">
              {filteredTickets.map((ticket) => {
                const isSelected = selectedTicket?.id === ticket.id;
                const lastMessage = ticket.messages[ticket.messages.length - 1];

                return (
                  <button
                    key={ticket.id}
                    type="button"
                    onClick={() => setSelectedTicketId(ticket.id)}
                    className={cn(
                      'w-full rounded-2xl border p-3.5 text-left transition-colors',
                      isSelected
                        ? 'border-primary/40 bg-primary/10 shadow-sm'
                        : 'border-border bg-background/60 hover:bg-secondary/60'
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-semibold text-sm line-clamp-1">{ticket.subject}</p>
                      <TicketStatusBadge status={ticket.status} className="shrink-0" />
                    </div>

                    <p className="mt-1.5 text-xs text-muted-foreground line-clamp-2">
                      {lastMessage?.content || 'İçerik bulunamadı'}
                    </p>

                    <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground">
                      <span className="truncate max-w-[170px]">{ticket.userName}</span>
                      <span>{formatTicketTime(ticket.lastMessageAt)}</span>
                    </div>
                  </button>
                );
              })}

              {filteredTickets.length === 0 && (
                <div className="rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
                  Destek bileti bulunamadı.
                </div>
              )}
            </div>
          </ScrollArea>
        </section>

        {/* Right Detail & Chat Panel */}
        <section className="rounded-3xl border border-border bg-card p-4 shadow-sm sm:p-6">
          {selectedTicket ? (
            <div className="space-y-6">
              {/* Header Box */}
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between border-b border-border pb-5">
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-2xl font-bold">{selectedTicket.subject}</h2>
                    <TicketStatusBadge status={selectedTicket.status} />
                    {selectedTicket.isGuestTicket && (
                      <Badge variant="outline" className="border-primary/20 bg-primary/10 text-primary text-xs">
                        Misafir
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Kategori: {categoryLabels[selectedTicket.category]} • Başlangıç: {formatTicketTime(selectedTicket.createdAt)} • ID: #{selectedTicket.id.slice(0, 8)}
                  </p>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {selectedTicket.status !== 'closed' ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void handleCloseTicket()}
                      disabled={isUpdatingStatus}
                      className="border-rose-500/30 text-rose-300 hover:bg-rose-500/10"
                    >
                      {isUpdatingStatus ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <XCircle className="mr-1.5 h-3.5 w-3.5" />}
                      Bileti Kapat
                    </Button>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void handleReopenTicket()}
                      disabled={isUpdatingStatus}
                    >
                      {isUpdatingStatus ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <ArrowRight className="mr-1.5 h-3.5 w-3.5" />}
                      Yeniden Aç
                    </Button>
                  )}
                </div>
              </div>

              {/* Info Chips */}
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <div className="rounded-2xl border border-border bg-background/50 p-3.5">
                  <div className="flex items-center justify-between">
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Kullanıcı</p>
                    <button
                      type="button"
                      onClick={() => void handleCopy(selectedTicket.userName, 'Kullanıcı adı')}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <Copy className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <p className="mt-1 font-semibold text-sm truncate">{selectedTicket.userName}</p>
                </div>

                <div className="rounded-2xl border border-border bg-background/50 p-3.5">
                  <div className="flex items-center justify-between">
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground">E-Posta</p>
                    <button
                      type="button"
                      onClick={() => void handleCopy(selectedTicket.userEmail, 'E-posta')}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <Copy className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <p className="mt-1 font-semibold text-sm truncate">{selectedTicket.userEmail}</p>
                </div>

                {selectedTicket.appealAccountEmail ? (
                  <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 p-3.5">
                    <p className="text-[10px] uppercase tracking-wider text-amber-200">Ban İtirazı Hesabı</p>
                    <p className="mt-1 font-semibold text-sm truncate text-amber-100">{selectedTicket.appealAccountEmail}</p>
                  </div>
                ) : (
                  <div className="rounded-2xl border border-border bg-background/50 p-3.5">
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Mesaj Sayısı</p>
                    <p className="mt-1 font-semibold text-sm">{selectedTicket.messages.length} mesaj</p>
                  </div>
                )}
              </div>

              {/* Attached initial image if any */}
              {selectedTicket.imageUrl && (
                <div className="rounded-2xl border border-border bg-background/50 p-3">
                  <p className="text-xs font-semibold text-muted-foreground mb-2">Eklenen Görsel</p>
                  <SupportImageAttachment
                    url={selectedTicket.imageUrl}
                    alt="Ticket görseli"
                    variant="adminCompact"
                    previewClassName="h-36 w-full rounded-xl object-cover"
                  />
                </div>
              )}

              {/* Chat Thread */}
              <div className="rounded-2xl border border-border bg-background/50 p-4 space-y-4">
                <ScrollArea className="h-[340px] pr-3">
                  <div className="space-y-3">
                    {selectedTicket.messages.map((item) => {
                      const isOwnMessage = item.authorId === user?.id;

                      return (
                        <div
                          key={item.id}
                          className={cn('flex flex-col', isOwnMessage ? 'items-end' : 'items-start')}
                        >
                          <div
                            className={cn(
                              'max-w-[85%] rounded-2xl p-3 text-sm shadow-sm',
                              isOwnMessage
                                ? 'bg-primary text-primary-foreground rounded-tr-sm'
                                : 'bg-card border border-border rounded-tl-sm'
                            )}
                          >
                            <div className="flex items-center gap-2 mb-1">
                              <span className="font-semibold text-xs">
                                {isOwnMessage ? 'Siz' : item.authorName}
                              </span>
                              <Badge
                                variant="outline"
                                className={cn(
                                  'text-[9px] px-1 py-0',
                                  isOwnMessage ? 'border-primary-foreground/30 text-primary-foreground' : 'text-muted-foreground'
                                )}
                              >
                                {messageRoleLabels[item.authorRole]}
                              </Badge>
                            </div>

                            <p className="whitespace-pre-wrap leading-relaxed">{item.content}</p>

                            {item.imageUrl && (
                              <div className="mt-2">
                                <SupportImageAttachment
                                  url={item.imageUrl}
                                  alt="Mesaj görseli"
                                  variant="adminCompact"
                                  previewClassName="h-28 w-full rounded-lg object-cover"
                                />
                              </div>
                            )}

                            <p className={cn('mt-1.5 text-[10px] text-right', isOwnMessage ? 'text-primary-foreground/70' : 'text-muted-foreground')}>
                              {formatTicketTime(item.createdAt)}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </ScrollArea>

                {/* Reply Box */}
                {selectedTicket.status !== 'closed' ? (
                  <div className="pt-3 border-t border-border space-y-3">
                    <Textarea
                      value={reply}
                      onChange={(e) => setReply(e.target.value)}
                      placeholder="Yanıtınızı buraya yazın..."
                      className="min-h-[85px] resize-none rounded-xl text-sm"
                    />

                    <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
                      <Input
                        value={replyImageUrl}
                        onChange={(e) => setReplyImageUrl(e.target.value)}
                        placeholder="Görsel linki (isteğe bağlı)..."
                        className="rounded-xl text-xs h-9 sm:max-w-xs"
                      />

                      <Button
                        size="sm"
                        onClick={() => void handleReply()}
                        disabled={isSubmitting || !reply.trim()}
                        className="rounded-xl px-4"
                      >
                        {isSubmitting ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Send className="mr-1.5 h-3.5 w-3.5" />}
                        Yanıtla
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-xl border border-border bg-muted/40 p-3 text-center text-xs text-muted-foreground">
                    Bu destek bileti kapatılmıştır. Yanıt yazmak için yukarıdan yeniden açabilirsiniz.
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="flex min-h-[460px] flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-background/40 p-8 text-center">
              <LifeBuoy className="h-12 w-12 text-muted-foreground/40" />
              <h3 className="mt-4 text-xl font-semibold">Bilet Seçilmedi</h3>
              <p className="mt-2 text-sm text-muted-foreground">Listeden bir bilet seçerek mesaj geçmişini ve yanıtları görüntüleyebilirsiniz.</p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
};

export default AdminTickets;
