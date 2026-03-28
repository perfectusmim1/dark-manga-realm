import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
import { toast } from 'sonner';

const categoryLabels: Record<SupportTicketCategory, string> = {
  bug_report: 'Bug Report',
  account: 'Hesap',
  content_issue: 'İçerik Sorunu',
  ban_appeal: 'Ban İtirazı',
  other: 'Other',
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
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [selectedTicketId, setSelectedTicketId] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<SupportTicketStatus | 'all'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [reply, setReply] = useState('');
  const [replyImageUrl, setReplyImageUrl] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoadingTickets, setIsLoadingTickets] = useState(false);
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);

  const loadTickets = useCallback(async () => {
    try {
      setIsLoadingTickets(true);
      const nextTickets = await listSupportTickets();
      setTickets(nextTickets);
      setSelectedTicketId((current) => current || nextTickets[0]?.id || '');
    } catch (error) {
      console.error('Admin tickets load failed:', error);
      toast.error(error instanceof Error ? error.message : 'Ticket kayıtları yüklenemedi');
    } finally {
      setIsLoadingTickets(false);
    }
  }, []);

  useEffect(() => {
    void loadTickets();
  }, [loadTickets]);

  const filteredTickets = useMemo(() => {
    const query = searchQuery.trim().toLocaleLowerCase('tr-TR');

    return tickets.filter((ticket) => {
      const matchesStatus = statusFilter === 'all' || ticket.status === statusFilter;
      const matchesSearch = !query
        || ticket.subject.toLocaleLowerCase('tr-TR').includes(query)
        || ticket.userName.toLocaleLowerCase('tr-TR').includes(query)
        || ticket.userEmail.toLocaleLowerCase('tr-TR').includes(query);

      return matchesStatus && matchesSearch;
    });
  }, [searchQuery, statusFilter, tickets]);

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
    <div className="space-y-6 lg:space-y-8">
      <div className="overflow-hidden rounded-[2rem] border border-border bg-card/80 p-5 shadow-xl sm:p-6">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div className="space-y-3">
            <Badge variant="outline" className="w-fit gap-1.5 border-primary/20 bg-primary/10 text-primary">
              <LifeBuoy className="h-3.5 w-3.5" />
              Admin Ticket Inbox
            </Badge>
            <div className="space-y-2">
              <h1 className="text-3xl font-black tracking-tight sm:text-4xl">Destek talepleri</h1>
              <p className="max-w-2xl text-sm leading-7 text-muted-foreground sm:text-base">
                Kullanıcının hesabını, açılış zamanını, konusunu, son hareketini ve görsel linkini tek yerde gör. Yanıtı gönder, durumu değiştir ve gerekiyorsa bileti kapat.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            <div className="rounded-2xl border border-border bg-background/70 px-4 py-3">
              <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">Toplam</p>
              <p className="mt-1 text-xl font-bold">{counts.all}</p>
            </div>
            <div className="rounded-2xl border border-border bg-background/70 px-4 py-3">
              <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">Açık</p>
              <p className="mt-1 text-xl font-bold">{counts.open}</p>
            </div>
            <div className="rounded-2xl border border-border bg-background/70 px-4 py-3">
              <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">Staff</p>
              <p className="mt-1 text-xl font-bold">{counts.waiting_staff}</p>
            </div>
            <div className="rounded-2xl border border-border bg-background/70 px-4 py-3">
              <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">Kullanıcı</p>
              <p className="mt-1 text-xl font-bold">{counts.waiting_user}</p>
            </div>
            <div className="rounded-2xl border border-border bg-background/70 px-4 py-3">
              <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">Kapalı</p>
              <p className="mt-1 text-xl font-bold">{counts.closed}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[380px_minmax(0,1fr)]">
        <section className="space-y-4">
          <div className="rounded-3xl border border-border bg-card p-5 shadow-sm sm:p-6">
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <div className="rounded-2xl bg-primary/10 p-3 text-primary">
                  <Filter className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold">Filtreler</h2>
                  <p className="text-sm text-muted-foreground">Arama ve durum ile biletleri daralt.</p>
                </div>
              </div>

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
          </div>

          <div className="rounded-3xl border border-border bg-card p-4 shadow-sm sm:p-5">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold">Biletler</h2>
                  <p className="text-sm text-muted-foreground">
                    {isLoadingTickets ? 'Yükleniyor...' : `${filteredTickets.length} kayıt`}
                  </p>
              </div>
              <Badge variant="outline">{statusFilter === 'all' ? 'Tümü' : statusMeta[statusFilter].label}</Badge>
            </div>

            <div className="space-y-3">
              {filteredTickets.map((ticket) => {
                const isSelected = ticket.id === selectedTicketId;
                const TicketStatusIcon = statusMeta[ticket.status].icon;

                return (
                  <button
                    key={ticket.id}
                    type="button"
                    onClick={() => setSelectedTicketId(ticket.id)}
                    className={`w-full rounded-2xl border p-4 text-left transition-colors ${
                      isSelected ? 'border-primary/30 bg-primary/10' : 'border-border bg-background/60 hover:bg-secondary/60'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="space-y-1">
                        <p className="font-semibold">{ticket.subject}</p>
                        <p className="text-xs text-muted-foreground">
                          {ticket.userName} · {ticket.userEmail}
                        </p>
                      </div>
                      <Badge className={`gap-1.5 border ${statusMeta[ticket.status].tone}`}>
                        <TicketStatusIcon className="h-3.5 w-3.5" />
                        {statusMeta[ticket.status].label}
                      </Badge>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span className="inline-flex items-center gap-1.5">
                        <CalendarDays className="h-3.5 w-3.5" />
                        {formatTicketTime(ticket.createdAt)}
                      </span>
                      <span className="inline-flex items-center gap-1.5">
                        <Clock3 className="h-3.5 w-3.5" />
                        {categoryLabels[ticket.category]}
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
          </div>
        </section>

        <section className="rounded-3xl border border-border bg-card p-4 shadow-sm sm:p-6">
          {selectedTicket ? (
            <div className="flex h-full flex-col gap-5">
              {(() => {
                const SelectedStatusIcon = statusMeta[selectedTicket.status].icon;

                return (
                  <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
                    <div className="space-y-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-2xl font-bold">{selectedTicket.subject}</h2>
                        <Badge className={`gap-1.5 border ${statusMeta[selectedTicket.status].tone}`}>
                          <SelectedStatusIcon className="h-3.5 w-3.5" />
                          {statusMeta[selectedTicket.status].label}
                        </Badge>
                      </div>

                      <div className="grid gap-2 text-sm text-muted-foreground sm:grid-cols-2">
                        <p className="inline-flex items-center gap-2"><User className="h-4 w-4" /> {selectedTicket.userName}</p>
                        <p className="inline-flex items-center gap-2"><Mail className="h-4 w-4" /> {selectedTicket.userEmail}</p>
                        <p className="inline-flex items-center gap-2"><CalendarDays className="h-4 w-4" /> Açılış: {formatTicketTime(selectedTicket.createdAt)}</p>
                        <p className="inline-flex items-center gap-2"><Clock3 className="h-4 w-4" /> Son hareket: {formatTicketTime(selectedTicket.lastMessageAt)}</p>
                      </div>
                    </div>

                    {selectedTicket.imageUrl && (
                      <div className="xl:w-64">
                        <SupportImageAttachment
                          url={selectedTicket.imageUrl}
                          alt="Ticket görseli"
                          previewClassName="h-44 w-full object-cover"
                        />
                      </div>
                    )}
                  </div>
                );
              })()}

              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-2xl border border-border bg-background/60 p-4">
                  <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Kullanıcı</p>
                  <p className="mt-2 text-sm font-medium">{selectedTicket.userName}</p>
                </div>
                <div className="rounded-2xl border border-border bg-background/60 p-4">
                  <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Kategori</p>
                  <p className="mt-2 text-sm font-medium">{categoryLabels[selectedTicket.category]}</p>
                </div>
                <div className="rounded-2xl border border-border bg-background/60 p-4">
                  <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Mesaj</p>
                  <p className="mt-2 text-sm font-medium">{selectedTicket.messages.length} adet</p>
                </div>
                <div className="rounded-2xl border border-border bg-background/60 p-4">
                  <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Durum</p>
                  <p className="mt-2 text-sm font-medium">{statusMeta[selectedTicket.status].label}</p>
                </div>
              </div>

              <Separator />

              <ScrollArea className="h-[480px] pr-3">
                <div className="space-y-4">
                  {selectedTicket.messages.map((item) => {
                    const isUserMessage = item.authorRole === 'user';

                    return (
                      <article
                        key={item.id}
                        className={`flex ${isUserMessage ? 'justify-start' : 'justify-end'}`}
                      >
                        <div className={`max-w-[92%] rounded-[1.5rem] border px-4 py-3 sm:max-w-[80%] ${
                          isUserMessage
                            ? 'border-border bg-background/70'
                            : 'border-primary/20 bg-primary/10'
                        }`}>
                          <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                            <span className="font-medium text-foreground">{item.authorName}</span>
                            <span>{messageRoleLabels[item.authorRole]}</span>
                          </div>
                          <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-foreground/90">{item.content}</p>
                          {item.imageUrl && (
                            <SupportImageAttachment
                              url={item.imageUrl}
                              alt="Ticket mesaj görseli"
                              className="mt-3"
                            />
                          )}
                          <p className="mt-3 text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
                            {formatTicketTime(item.createdAt)}
                          </p>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </ScrollArea>

              <div className="rounded-3xl border border-border bg-background/70 p-4">
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

                <div className="mt-4 space-y-3">
                  <Textarea
                    value={reply}
                    onChange={(event) => setReply(event.target.value)}
                    placeholder={selectedTicket.status === 'closed' ? 'Ticket kapalı' : 'Cevabını yaz'}
                    className="min-h-28 resize-none"
                    disabled={selectedTicket.status === 'closed'}
                  />
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
                        previewClassName="max-h-56 w-full object-cover"
                      />
                    ) : null}
                  </div>
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <ShieldAlert className="h-3.5 w-3.5" />
                      Son cevap sonrasında durum kullanıcı bekliyor olur. Dış görseller ise kontrollü önizleme ile açılır.
                    </div>
                    <Button onClick={() => void handleReply()} disabled={selectedTicket.status === 'closed' || isSubmitting}>
                      {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
                      Yanıt Gönder
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex min-h-[520px] flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-background/40 p-8 text-center">
              <LifeBuoy className="h-12 w-12 text-muted-foreground/40" />
              <h3 className="mt-4 text-xl font-semibold">Bilet seçilmedi</h3>
              <p className="mt-2 max-w-md text-sm text-muted-foreground">
                Soldan bir kayıt seç veya filtreyi değiştir. Burada kullanıcı bilgileri, mesaj akışı ve durum işlemleri görünür.
              </p>
            </div>
          )}
        </section>
      </div>

      <div className="rounded-2xl border border-sky-500/20 bg-sky-500/10 p-4 text-sm text-sky-100">
        <p className="flex items-start gap-3">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Yanıt gönderildiğinde durum otomatik olarak kullanıcı bekliyor olur. Kapatılan biletler yeniden açılmadan kullanıcı tarafından cevaplanamaz.
          </span>
        </p>
      </div>
    </div>
  );
};

export default AdminTickets;
