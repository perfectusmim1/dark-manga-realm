import React, { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { tr } from 'date-fns/locale';
import {
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Filter,
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import SupportImageAttachment from '@/components/support/SupportImageAttachment';
import { SupportTicket, SupportTicketCategory, SupportTicketMessage, SupportTicketStatus } from '@/lib/types';
import { listSupportTickets, replyToSupportTicket, updateSupportTicketStatus } from '@/lib/supportTickets';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

const categoryLabels: Record<SupportTicketCategory, string> = {
  bug_report: 'Bug Report',
  account: 'Hesap',
  content_issue: 'İçerik Sorunu',
  ban_appeal: 'Ban İtirazı',
  other: 'Diğer',
};

const statusMeta: Record<SupportTicketStatus, { label: string; tone: string; icon: React.ComponentType<{ className?: string }> }> = {
  open: { label: 'Açık', tone: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300', icon: CheckCircle2 },
  waiting_staff: { label: 'Staff Bekliyor', tone: 'border-sky-500/20 bg-sky-500/10 text-sky-300', icon: Clock3 },
  waiting_user: { label: 'Sıra Sizde', tone: 'border-amber-500/20 bg-amber-500/10 text-amber-200', icon: MessageSquareReply },
  closed: { label: 'Kapalı', tone: 'border-zinc-500/20 bg-zinc-500/10 text-zinc-300', icon: XCircle },
};

const messageRoleLabels: Record<SupportTicketMessage['authorRole'], string> = {
  user: 'Kullanıcı',
  moderator: 'Moderatör',
  admin: 'Admin',
  system: 'Sistem',
};

const formatTicketTime = (value: string) => formatDistanceToNow(new Date(value), { addSuffix: true, locale: tr });

const AdminTickets: React.FC = () => {
  const { user, session, mfaState, isLoading: authLoading } = useAuth();
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [selectedTicketId, setSelectedTicketId] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<SupportTicketStatus | 'all'>('all');
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
          toast.error(error instanceof Error ? error.message : 'Ticket kayıtları yüklenemedi');
        }
        throw error;
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

    const intervalId = window.setInterval(syncIfVisible, 8000);
    window.addEventListener('focus', syncIfVisible);
    document.addEventListener('visibilitychange', syncIfVisible);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('focus', syncIfVisible);
      document.removeEventListener('visibilitychange', syncIfVisible);
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
      toast.success('Cevap gönderildi');
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
      toast.success('Ticket kapatıldı');
    } catch (error) {
      console.error('Admin ticket close failed:', error);
      toast.error(error instanceof Error ? error.message : 'Ticket kapatılamadı');
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
      toast.success('Ticket yeniden açıldı');
    } catch (error) {
      console.error('Admin ticket reopen failed:', error);
      toast.error(error instanceof Error ? error.message : 'Ticket yeniden açılamadı');
    } finally {
      setIsUpdatingStatus(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-3xl border border-border bg-card/80 px-4 py-3 shadow-sm sm:px-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2.5">
            <Badge variant="outline" className="w-fit gap-1.5 border-primary/20 bg-primary/10 text-primary">
              <LifeBuoy className="h-3.5 w-3.5" />
              Destek Talepleri
            </Badge>
            <p className="text-xs text-muted-foreground">
              {counts.all} toplam • {counts.open} açık • {counts.closed} kapalı
            </p>
          </div>
          <p className="text-xs text-muted-foreground">
            {isLoadingTickets ? 'Kayıtlar yenileniyor...' : `${filteredTickets.length} kayıt listeleniyor`}
          </p>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(320px,360px)_minmax(0,1fr)] xl:items-start">
        <section className="flex min-h-0 min-w-0 flex-col self-start rounded-3xl border border-border bg-card p-4 shadow-sm sm:p-5 xl:max-h-[calc(100vh-11rem)]">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">Biletler</h2>
              <p className="text-sm text-muted-foreground">
                {isLoadingTickets ? 'Kayıtlar yenileniyor...' : `${filteredTickets.length} kayıt listeleniyor`}
              </p>
            </div>
            <Badge variant="outline">{statusFilter === 'all' ? 'Tümü' : statusMeta[statusFilter].label}</Badge>
          </div>

          <div className="my-4 grid gap-3 border-y border-border/60 py-4 sm:grid-cols-[minmax(0,1fr)_160px]">
            <div className="space-y-2">
              <Label>Arama</Label>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="Başlık, isim veya e-posta"
                  className="pl-9"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Durum</Label>
              <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as SupportTicketStatus | 'all')}>
                <SelectTrigger>
                  <SelectValue placeholder="Durum seç" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tümü</SelectItem>
                  <SelectItem value="open">Açık</SelectItem>
                  <SelectItem value="waiting_staff">Staff Bekliyor</SelectItem>
                  <SelectItem value="waiting_user">Kullanıcı Bekliyor</SelectItem>
                  <SelectItem value="closed">Kapalı</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <ScrollArea className="min-h-0 flex-1">
            <div className="space-y-2.5 pr-4">
              {filteredTickets.map((ticket) => {
                const isSelected = ticket.id === selectedTicketId;
                const TicketStatusIcon = statusMeta[ticket.status].icon;

                return (
                  <button
                    key={ticket.id}
                    type="button"
                    onClick={() => setSelectedTicketId(ticket.id)}
                    className={`w-full overflow-hidden rounded-2xl border px-3 py-3 text-left transition-colors ${
                      isSelected ? 'border-primary/30 bg-primary/10' : 'border-border bg-background/60 hover:bg-secondary/60'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 space-y-1">
                        <p className="truncate text-sm font-semibold leading-5">{ticket.subject}</p>
                        <p className="truncate text-[11px] text-muted-foreground">
                          {ticket.userName} · {ticket.userEmail}
                        </p>
                      </div>
                      <Badge className={`shrink-0 gap-1.5 border ${statusMeta[ticket.status].tone}`}>
                        <TicketStatusIcon className="h-3.5 w-3.5" />
                        {statusMeta[ticket.status].label}
                      </Badge>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                      <span className="inline-flex items-center gap-1.5">
                        <CalendarDays className="h-3.5 w-3.5" />
                        {formatTicketTime(ticket.lastMessageAt)}
                      </span>
                      <span className="inline-flex items-center gap-1.5">
                        <Clock3 className="h-3.5 w-3.5" />
                        {categoryLabels[ticket.category]}
                      </span>
                      <span className="inline-flex items-center gap-1.5">
                        <MessageSquareReply className="h-3.5 w-3.5" />
                        {ticket.messages.length} mesaj
                      </span>
                    </div>
                  </button>
                );
              })}

              {filteredTickets.length === 0 && (
                <div className="rounded-2xl border border-dashed border-border p-8 text-center">
                  <Loader2 className={`mx-auto h-10 w-10 text-muted-foreground/40 ${isLoadingTickets ? 'animate-spin' : ''}`} />
                  <p className="mt-3 font-medium">{isLoadingTickets ? 'Ticketler yükleniyor' : 'Eşleşen bilet yok'}</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {isLoadingTickets ? 'Destek kayıtları getiriliyor.' : 'Filtreleri değiştir veya aramayı temizle.'}
                  </p>
                </div>
              )}
            </div>
          </ScrollArea>
        </section>

        <section className="flex min-h-0 min-w-0 flex-col self-start rounded-3xl border border-border bg-card p-4 shadow-sm sm:p-6">
          {selectedTicket ? (
            <div className="flex min-h-0 flex-col gap-4">
              {(() => {
                const SelectedStatusIcon = statusMeta[selectedTicket.status].icon;

                return (
                  <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                    <div className="space-y-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-xl font-bold sm:text-2xl">{selectedTicket.subject}</h2>
                        <Badge className={`gap-1.5 border ${statusMeta[selectedTicket.status].tone}`}>
                          <SelectedStatusIcon className="h-3.5 w-3.5" />
                          {statusMeta[selectedTicket.status].label}
                        </Badge>
                      </div>

                      <div className="grid gap-2 text-sm text-muted-foreground sm:grid-cols-2">
                        <p className="inline-flex min-w-0 items-center gap-2">
                          <User className="h-4 w-4" />
                          <span className="truncate">{selectedTicket.userName}</span>
                          {selectedTicket.isGuestTicket ? (
                            <span className="rounded-full border border-primary/20 bg-primary/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.16em] text-primary">
                              Misafir
                            </span>
                          ) : null}
                        </p>
                        <p className="inline-flex min-w-0 items-center gap-2"><Mail className="h-4 w-4" /> <span className="truncate">{selectedTicket.userEmail}</span></p>
                        <p className="inline-flex items-center gap-2"><CalendarDays className="h-4 w-4" /> Açılış: {formatTicketTime(selectedTicket.createdAt)}</p>
                        <p className="inline-flex items-center gap-2"><Clock3 className="h-4 w-4" /> Son hareket: {formatTicketTime(selectedTicket.lastMessageAt)}</p>
                        {selectedTicket.appealAccountEmail ? (
                          <p className="inline-flex min-w-0 items-center gap-2 sm:col-span-2">
                            <ShieldAlert className="h-4 w-4" />
                            <span className="truncate">Ban itirazı hesabı: {selectedTicket.appealAccountEmail}</span>
                          </p>
                        ) : null}
                      </div>
                    </div>

                    {selectedTicket.imageUrl && (
                      <div className="xl:w-56">
                        <SupportImageAttachment
                          url={selectedTicket.imageUrl}
                          alt="Ticket görseli"
                          previewClassName="h-36 w-full object-cover"
                        />
                      </div>
                    )}
                  </div>
                );
              })()}

              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-2xl border border-border bg-background/60 px-3 py-3">
                  <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Kullanıcı</p>
                  <p className="mt-2 text-sm font-medium">
                    {selectedTicket.userName}
                    {selectedTicket.isGuestTicket ? ' · Misafir' : ''}
                  </p>
                </div>
                <div className="rounded-2xl border border-border bg-background/60 px-3 py-3">
                  <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Kategori</p>
                  <p className="mt-2 text-sm font-medium">{categoryLabels[selectedTicket.category]}</p>
                </div>
                <div className="rounded-2xl border border-border bg-background/60 px-3 py-3">
                  <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Mesaj</p>
                  <p className="mt-2 text-sm font-medium">{selectedTicket.messages.length} adet</p>
                </div>
                <div className="rounded-2xl border border-border bg-background/60 px-3 py-3">
                  <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Durum</p>
                  <p className="mt-2 text-sm font-medium">{statusMeta[selectedTicket.status].label}</p>
                </div>
              </div>

              <ScrollArea className="min-h-[22rem] max-h-[68vh] pr-1">
                <div className="space-y-4 pr-4">
                  {selectedTicket.messages.map((item) => {
                    const isOwnMessage = item.authorId === user?.id;
                    const bubbleTone = isOwnMessage
                      ? 'border-sky-400/30 bg-sky-500/15 shadow-[0_14px_34px_rgba(14,165,233,0.12)]'
                      : item.authorRole === 'admin'
                        ? 'border-violet-500/25 bg-violet-500/10 shadow-[0_14px_34px_rgba(139,92,246,0.10)]'
                        : item.authorRole === 'moderator'
                          ? 'border-emerald-500/25 bg-emerald-500/10 shadow-[0_14px_34px_rgba(16,185,129,0.10)]'
                          : item.authorRole === 'system'
                            ? 'border-amber-500/25 bg-amber-500/10 shadow-[0_14px_34px_rgba(245,158,11,0.10)]'
                            : 'border-border bg-background/70';
                    const roleTone = isOwnMessage
                      ? 'border-sky-400/25 bg-sky-500/12 text-sky-100'
                      : item.authorRole === 'admin'
                        ? 'border-violet-500/25 bg-violet-500/12 text-violet-100'
                        : item.authorRole === 'moderator'
                          ? 'border-emerald-500/25 bg-emerald-500/12 text-emerald-100'
                          : item.authorRole === 'system'
                            ? 'border-amber-500/25 bg-amber-500/12 text-amber-100'
                            : 'border-border bg-background/60 text-muted-foreground';

                    return (
                      <article
                        key={item.id}
                        className={`flex ${isOwnMessage ? 'justify-end' : 'justify-start'}`}
                      >
                        <div className={`flex max-w-[90%] flex-col gap-2 rounded-[1.35rem] border px-3.5 py-3 sm:max-w-[76%] ${
                          isOwnMessage
                            ? 'ml-8 items-end rounded-br-md text-right sm:ml-14'
                            : 'mr-8 items-start rounded-bl-md text-left sm:mr-14'
                        } ${bubbleTone}`}>
                          <div className={`flex flex-wrap items-center gap-2 ${
                            isOwnMessage ? 'justify-end' : 'justify-start'
                          }`}>
                            <span className="text-sm font-semibold text-foreground">{item.authorName}</span>
                            <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium uppercase tracking-[0.16em] ${roleTone}`}>
                              {messageRoleLabels[item.authorRole]}
                            </span>
                          </div>
                          <p className={`w-full whitespace-pre-wrap text-sm leading-6 ${
                            isOwnMessage ? 'text-right text-foreground' : 'text-left text-foreground/90'
                          }`}>
                            {item.content}
                          </p>
                          {item.imageUrl && (
                            <div className="w-full">
                              <SupportImageAttachment
                                url={item.imageUrl}
                                alt="Ticket mesaj görseli"
                                className="mt-1"
                              />
                            </div>
                          )}
                          <p className={`w-full text-[11px] uppercase tracking-[0.2em] text-muted-foreground ${
                            isOwnMessage ? 'text-right' : 'text-left'
                          }`}>
                            {formatTicketTime(item.createdAt)}
                          </p>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </ScrollArea>

              <div className="border-t border-border/70 bg-background/70 pt-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <MessageSquareReply className="h-4 w-4" />
                    Admin cevabı gönder
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {selectedTicket.status !== 'closed' ? (
                      <Button variant="outline" onClick={() => void handleCloseTicket()} disabled={isUpdatingStatus}>
                        {isUpdatingStatus ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
                        Kapat
                      </Button>
                    ) : (
                      <Button variant="outline" onClick={() => void handleReopenTicket()} disabled={isUpdatingStatus}>
                        {isUpdatingStatus ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ArrowRight className="mr-2 h-4 w-4" />}
                        Yeniden Aç
                      </Button>
                    )}
                  </div>
                </div>

                <div className="mt-4 grid gap-3 xl:grid-cols-[minmax(0,1fr)_280px]">
                  <Textarea
                    value={reply}
                    onChange={(event) => setReply(event.target.value)}
                    placeholder={selectedTicket.status === 'closed' ? 'Ticket kapalı' : 'Cevabını yaz'}
                    className="min-h-28 resize-none xl:min-h-[140px]"
                    disabled={selectedTicket.status === 'closed'}
                  />
                  <div className="space-y-3">
                    <div className="space-y-2">
                      <Label>Yanıt görsel linki (isteğe bağlı)</Label>
                      <Input
                        value={replyImageUrl}
                        onChange={(event) => setReplyImageUrl(event.target.value)}
                        placeholder="https://..."
                        disabled={selectedTicket.status === 'closed'}
                      />
                      {replyImageUrl.trim() ? (
                        <SupportImageAttachment
                          url={replyImageUrl}
                          alt="Admin yanıt görsel önizlemesi"
                          initialPreview
                          previewClassName="max-h-44 w-full object-cover"
                        />
                      ) : null}
                    </div>
                    <div className="flex flex-col gap-3">
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <ShieldAlert className="h-3.5 w-3.5" />
                        Son cevap sonrası durum kullanıcı bekliyor olur.
                      </div>
                      <Button onClick={() => void handleReply()} disabled={selectedTicket.status === 'closed' || isSubmitting}>
                        {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
                        Yanıt Gönder
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-background/40 p-8 text-center">
              <LifeBuoy className="h-12 w-12 text-muted-foreground/40" />
              <h3 className="mt-4 text-xl font-semibold">Bilet seçilmedi</h3>
              <p className="mt-2 max-w-md text-sm text-muted-foreground">
                Soldan bir kayıt seç veya filtreyi değiştir. Burada kullanıcı bilgileri, mesaj akışı ve durum işlemleri görünür.
              </p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
};

export default AdminTickets;
