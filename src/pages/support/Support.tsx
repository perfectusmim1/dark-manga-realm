import React, { useEffect, useMemo, useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { tr } from 'date-fns/locale';
import {
  AlertTriangle,
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  Clock3,
  FileText,
  LifeBuoy,
  Link2,
  Loader2,
  MessageSquareReply,
  Plus,
  Send,
  ShieldAlert,
  Sparkles,
  User,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import Header from '@/components/layout/Header';
import { useAuth } from '@/contexts/AuthContext';
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
import { createSupportTicket, listSupportTickets, replyToSupportTicket } from '@/lib/supportTickets';
import { toast } from 'sonner';

const categoryLabels: Record<SupportTicketCategory, string> = {
  bug_report: 'Bug Report',
  account: 'Hesap',
  content_issue: 'İçerik Sorunu',
  ban_appeal: 'Ban İtirazı',
  other: 'Other',
};

const categoryDescriptions: Record<SupportTicketCategory, string> = {
  bug_report: 'Teknik hata, çökme, görsel bozulma veya beklenmeyen davranış.',
  account: 'Giriş, profil, şifre, e-posta veya hesap erişim sorunu.',
  content_issue: 'Manga, bölüm, sayfa veya veri eşleşmesi ile ilgili sorunlar.',
  ban_appeal: 'Uyarı, ban veya erişim kısıtlaması için itiraz.',
  other: 'Diğer tüm destek talepleri.',
};

const statusMeta: Record<SupportTicketStatus, { label: string; tone: string; icon: React.ComponentType<{ className?: string }> }> = {
  open: { label: 'Açık', tone: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300', icon: Sparkles },
  waiting_staff: { label: 'Staff Bekliyor', tone: 'border-sky-500/20 bg-sky-500/10 text-sky-300', icon: Clock3 },
  waiting_user: { label: 'Sıra Sizde', tone: 'border-amber-500/20 bg-amber-500/10 text-amber-200', icon: MessageSquareReply },
  closed: { label: 'Kapalı', tone: 'border-zinc-500/20 bg-zinc-500/10 text-zinc-300', icon: CheckCircle2 },
};

const messageRoleLabels: Record<SupportTicketMessage['authorRole'], string> = {
  user: 'Kullanıcı',
  moderator: 'Moderatör',
  admin: 'Admin',
  system: 'Sistem',
};

const formatTicketTime = (value: string) => formatDistanceToNow(new Date(value), { addSuffix: true, locale: tr });

const SupportTicketBadge = ({ status }: { status: SupportTicketStatus }) => {
  const MetaIcon = statusMeta[status].icon;

  return (
    <Badge className={`gap-1.5 border ${statusMeta[status].tone}`}>
      <MetaIcon className="h-3.5 w-3.5" />
      {statusMeta[status].label}
    </Badge>
  );
};

const Support: React.FC = () => {
  const { user } = useAuth();
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [selectedTicketId, setSelectedTicketId] = useState<string>('');
  const [category, setCategory] = useState<SupportTicketCategory>('bug_report');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [reply, setReply] = useState('');
  const [replyImageUrl, setReplyImageUrl] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoadingTickets, setIsLoadingTickets] = useState(false);

  const userTickets = useMemo(
    () => (user ? tickets.filter((ticket) => ticket.userId === user.id) : []),
    [tickets, user],
  );

  const visibleTickets = user ? userTickets : tickets;

  const selectedTicket = useMemo(
    () => visibleTickets.find((ticket) => ticket.id === selectedTicketId) || visibleTickets[0] || null,
    [selectedTicketId, visibleTickets],
  );

  useEffect(() => {
    if (!user) {
      setTickets([]);
      setSelectedTicketId('');
      return;
    }

    let isCancelled = false;

    const loadTickets = async () => {
      try {
        setIsLoadingTickets(true);
        const nextTickets = await listSupportTickets();
        if (isCancelled) {
          return;
        }

        setTickets(nextTickets);
        setSelectedTicketId((current) => current || nextTickets[0]?.id || '');
      } catch (error) {
        if (isCancelled) {
          return;
        }

        console.error('Support tickets load failed:', error);
        toast.error('Destek kayıtları yüklenemedi');
      } finally {
        if (!isCancelled) {
          setIsLoadingTickets(false);
        }
      }
    };

    void loadTickets();

    return () => {
      isCancelled = true;
    };
  }, [user]);

  useEffect(() => {
    if (!visibleTickets.length) {
      return;
    }

    if (!visibleTickets.some((ticket) => ticket.id === selectedTicketId)) {
      setSelectedTicketId(visibleTickets[0].id);
    }
  }, [selectedTicketId, visibleTickets]);

  useEffect(() => {
    setReply('');
    setReplyImageUrl('');
  }, [selectedTicketId]);

  const stats = useMemo(() => ({
    open: visibleTickets.filter((ticket) => ticket.status === 'open').length,
    waitingStaff: visibleTickets.filter((ticket) => ticket.status === 'waiting_staff').length,
    waitingUser: visibleTickets.filter((ticket) => ticket.status === 'waiting_user').length,
    closed: visibleTickets.filter((ticket) => ticket.status === 'closed').length,
  }), [visibleTickets]);

  const handleCreateTicket = async () => {
    if (!user) {
      toast.error('Bilet açmak için giriş yapmalısın');
      return;
    }

    if (!subject.trim() || !message.trim()) {
      toast.error('Başlık ve açıklama zorunlu');
      return;
    }

    try {
      setIsSubmitting(true);
      const nextTicket = await createSupportTicket({
        subject: subject.trim(),
        category,
        message: message.trim(),
        imageUrl: imageUrl.trim() || null,
      });

      setTickets((current) => [nextTicket, ...current.filter((ticket) => ticket.id !== nextTicket.id)]);
      setSelectedTicketId(nextTicket.id);
      setSubject('');
      setMessage('');
      setImageUrl('');
      setCategory('bug_report');
      toast.success('Destek bileti oluşturuldu');
    } catch (error) {
      console.error('Create support ticket failed:', error);
      toast.error(error instanceof Error ? error.message : 'Destek bileti oluşturulamadı');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleReply = async () => {
    if (!user || !selectedTicket) {
      return;
    }

    if (selectedTicket.status === 'closed') {
      toast.error('Kapalı biletlere yanıt verilemez');
      return;
    }

    if (!reply.trim()) {
      toast.error('Yanıt yazmalısın');
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
      console.error('Support ticket reply failed:', error);
      toast.error(error instanceof Error ? error.message : 'Yanıt gönderilemedi');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleOpenWithThread = (ticketId: string) => {
    setSelectedTicketId(ticketId);
  };

  if (!user) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <main className="container pb-12 pt-20 sm:pt-24">
      <div className="space-y-6 pt-6 pb-8 lg:pt-8 lg:pb-10">
        <div className="overflow-hidden rounded-[2rem] border border-border bg-card/80 p-6 shadow-xl sm:p-8">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,_rgba(59,130,246,0.18),_transparent_40%)]" />
          <div className="relative grid gap-6 lg:grid-cols-[1.2fr_0.8fr] lg:items-center">
            <div className="space-y-5">
              <Badge variant="outline" className="w-fit gap-1.5 border-primary/20 bg-primary/10 text-primary">
                <LifeBuoy className="h-3.5 w-3.5" />
                Destek Merkezi
              </Badge>
              <div className="space-y-3">
                <h1 className="text-3xl font-black tracking-tight sm:text-5xl">
                  Bilet aç, takip et, yanıt al.
                </h1>
                <p className="max-w-2xl text-sm leading-7 text-muted-foreground sm:text-base">
                  Hata bildirimi, hesap sorunu, içerik problemi veya ban itirazını tek akıştan gönderebilirsin. Giriş yaptıktan sonra biletlerin sohbet şeklinde ilerler.
                </p>
              </div>

              <div className="flex flex-wrap gap-3 text-sm text-muted-foreground">
                <div className="rounded-full border border-border bg-background/80 px-3 py-2">Bug report</div>
                <div className="rounded-full border border-border bg-background/80 px-3 py-2">Ban itirazı</div>
                <div className="rounded-full border border-border bg-background/80 px-3 py-2">Görsel ekleme</div>
              </div>

              <Button asChild className="w-fit">
                <Link to="/auth">
                  Giriş Yap
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
            </div>

            <div className="rounded-3xl border border-border/70 bg-background/70 p-5 shadow-lg backdrop-blur">
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <div className="rounded-2xl bg-primary/10 p-3 text-primary">
                    <FileText className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold">Destek akışı</p>
                    <p className="text-xs text-muted-foreground">Mobil ve masaüstü uyumlu sohbet görünümü</p>
                  </div>
                </div>
                <Separator />
                <div className="space-y-3 text-sm text-muted-foreground">
                  <p className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-emerald-400" /> Konu, açıklama ve opsiyonel görsel linki</p>
                  <p className="flex items-center gap-2"><Clock3 className="h-4 w-4 text-sky-400" /> Staff yanıtları ve durum takibi</p>
                  <p className="flex items-center gap-2"><ShieldAlert className="h-4 w-4 text-amber-400" /> Banlı hesaplar için bile destek yolu</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container pb-12 pt-20 sm:pt-24">
    <div className="space-y-6 pt-6 pb-8 lg:space-y-8 lg:pt-8 lg:pb-10">
      <div className="overflow-hidden rounded-[2rem] border border-border bg-card/80 p-5 shadow-xl sm:p-6">
        <div className="relative flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-3">
            <Badge variant="outline" className="w-fit gap-1.5 border-primary/20 bg-primary/10 text-primary">
              <LifeBuoy className="h-3.5 w-3.5" />
              Destek Merkezi
            </Badge>
            <div className="space-y-2">
              <h1 className="text-3xl font-black tracking-tight sm:text-4xl">
                Destek bileti oluştur
              </h1>
              <p className="max-w-2xl text-sm leading-7 text-muted-foreground sm:text-base">
                Sorununu başlık, açıklama ve isterse görsel linki ile gönder. Yanıtlar sohbet gibi akar, durumlar da açıkça görünür.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-2xl border border-border bg-background/70 px-4 py-3">
              <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">Açık</p>
              <p className="mt-1 text-xl font-bold">{stats.open}</p>
            </div>
            <div className="rounded-2xl border border-border bg-background/70 px-4 py-3">
              <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">Staff</p>
              <p className="mt-1 text-xl font-bold">{stats.waitingStaff}</p>
            </div>
            <div className="rounded-2xl border border-border bg-background/70 px-4 py-3">
              <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">Sizde</p>
              <p className="mt-1 text-xl font-bold">{stats.waitingUser}</p>
            </div>
            <div className="rounded-2xl border border-border bg-background/70 px-4 py-3">
              <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">Kapalı</p>
              <p className="mt-1 text-xl font-bold">{stats.closed}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[420px_minmax(0,1fr)]">
        <section className="space-y-6">
          <div className="rounded-3xl border border-border bg-card p-5 shadow-sm sm:p-6">
            <div className="flex items-center gap-3">
              <div className="rounded-2xl bg-primary/10 p-3 text-primary">
                <Plus className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-lg font-semibold">Yeni ticket</h2>
                <p className="text-sm text-muted-foreground">Konu seç, anlat, gönder.</p>
              </div>
            </div>

            <div className="mt-5 space-y-4">
              <div className="space-y-2">
                <Label>Kategori</Label>
                <Select value={category} onValueChange={(value) => setCategory(value as SupportTicketCategory)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Kategori seç" />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(categoryLabels) as SupportTicketCategory[]).map((value) => (
                      <SelectItem key={value} value={value}>
                        {categoryLabels[value]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">{categoryDescriptions[category]}</p>
              </div>

              <div className="space-y-2">
                <Label>Başlık</Label>
                <Input
                  value={subject}
                  onChange={(event) => setSubject(event.target.value)}
                  placeholder="Sorunu kısa ve net yaz"
                />
              </div>

              <div className="space-y-2">
                <Label>Açıklama</Label>
                <Textarea
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                  placeholder="Sorunu detaylı anlat"
                  className="min-h-36 resize-none"
                />
              </div>

              <div className="space-y-2">
                <Label>Görsel linki (isteğe bağlı)</Label>
                <Input
                  value={imageUrl}
                  onChange={(event) => setImageUrl(event.target.value)}
                  placeholder="https://..."
                />
                {imageUrl.trim() ? (
                  <SupportImageAttachment
                    url={imageUrl}
                    alt="Ticket görsel önizlemesi"
                    initialPreview
                    previewClassName="h-44 w-full object-cover"
                  />
                ) : null}
              </div>

              <Button onClick={handleCreateTicket} className="w-full" disabled={isSubmitting}>
                {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
                Bilet Oluştur
              </Button>
            </div>
          </div>

          <div className="rounded-3xl border border-border bg-card p-5 shadow-sm sm:p-6">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">Ticket listesi</h2>
                <p className="text-sm text-muted-foreground">
                  {isLoadingTickets
                    ? 'Biletler yükleniyor...'
                    : userTickets.length > 0
                      ? 'Kendi biletlerin burada görünür.'
                      : 'Henüz ticket yok.'}
                </p>
              </div>
              <Badge variant="outline">{visibleTickets.length}</Badge>
            </div>

            <div className="mt-4 space-y-3">
              {visibleTickets.map((ticket) => {
                const isSelected = ticket.id === selectedTicketId;

                return (
                  <button
                    key={ticket.id}
                    type="button"
                    onClick={() => handleOpenWithThread(ticket.id)}
                    className={`w-full rounded-2xl border p-4 text-left transition-colors ${
                      isSelected
                        ? 'border-primary/30 bg-primary/10'
                        : 'border-border bg-background/60 hover:bg-secondary/60'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="space-y-1">
                        <p className="font-semibold">{ticket.subject}</p>
                        <p className="text-xs text-muted-foreground">
                          {ticket.userName} · {categoryLabels[ticket.category]}
                        </p>
                      </div>
                      <SupportTicketBadge status={ticket.status} />
                    </div>
                    <div className="mt-3 flex items-center gap-3 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <CalendarDays className="h-3.5 w-3.5" />
                        {formatTicketTime(ticket.createdAt)}
                      </span>
                      <span className="h-1 w-1 rounded-full bg-border" />
                      <span>{ticket.messages.length} mesaj</span>
                    </div>
                  </button>
                );
              })}

              {visibleTickets.length === 0 && (
                <div className="rounded-2xl border border-dashed border-border p-8 text-center">
                  <LifeBuoy className="mx-auto h-10 w-10 text-muted-foreground/40" />
                  <p className="mt-3 font-medium">{isLoadingTickets ? 'Ticketler yükleniyor' : 'Ticket bulunamadı'}</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {isLoadingTickets ? 'Destek kayıtları getiriliyor.' : 'İlk destek talebini üstteki formdan aç.'}
                  </p>
                </div>
              )}
            </div>
          </div>
        </section>

        <section className="rounded-3xl border border-border bg-card p-4 shadow-sm sm:p-6">
          {selectedTicket ? (
            <div className="flex h-full flex-col gap-5">
              <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-2xl font-bold">{selectedTicket.subject}</h2>
                    <SupportTicketBadge status={selectedTicket.status} />
                  </div>
                  <div className="flex flex-wrap gap-2 text-sm text-muted-foreground">
                    <span className="inline-flex items-center gap-1.5"><User className="h-4 w-4" /> {selectedTicket.userName}</span>
                    <span className="inline-flex items-center gap-1.5"><FileText className="h-4 w-4" /> {categoryLabels[selectedTicket.category]}</span>
                    <span className="inline-flex items-center gap-1.5"><Clock3 className="h-4 w-4" /> {formatTicketTime(selectedTicket.lastMessageAt)}</span>
                  </div>
                </div>

                {selectedTicket.imageUrl && (
                  <div className="xl:w-60">
                    <SupportImageAttachment
                      url={selectedTicket.imageUrl}
                      alt="Ticket görseli"
                      previewClassName="h-40 w-full object-cover"
                    />
                  </div>
                )}
              </div>

              <Separator />

              <ScrollArea className="h-[480px] pr-3">
                <div className="space-y-4">
                  {selectedTicket.messages.map((item) => {
                    const isUserMessage = item.authorRole === 'user';
                    return (
                      <article
                        key={item.id}
                        className={`flex ${isUserMessage ? 'justify-end' : 'justify-start'}`}
                      >
                        <div className={`max-w-[92%] rounded-[1.5rem] border px-4 py-3 sm:max-w-[80%] ${
                          isUserMessage
                            ? 'border-primary/20 bg-primary/10'
                            : 'border-border bg-background/70'
                        }`}>
                          <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                            <span className="font-medium text-foreground">{item.authorName}</span>
                            <span>{messageRoleLabels[item.authorRole]}</span>
                          </div>
                          <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-foreground/90">{item.content}</p>
                          {item.imageUrl && (
                            <SupportImageAttachment
                              url={item.imageUrl}
                              alt="Bilet görseli"
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
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <MessageSquareReply className="h-4 w-4" />
                  {selectedTicket.status === 'closed'
                    ? 'Bu bilet kapalı. Staff yeniden açarsa yanıt verebilirsin.'
                    : 'Yanıt gönder ve sohbet akışını sürdür.'}
                </div>

                <div className="mt-4 space-y-3">
                  <Textarea
                    value={reply}
                    onChange={(event) => setReply(event.target.value)}
                    placeholder={selectedTicket.status === 'closed' ? 'Kapalı bilette yanıt yazılamaz' : 'Yanıtını yaz'}
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
                        alt="Yanıt görsel önizlemesi"
                        initialPreview
                        previewClassName="max-h-56 w-full object-cover"
                      />
                    ) : null}
                  </div>
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Link2 className="h-3.5 w-3.5" />
                      Linkli görseller güvenli önizleme ile yüklenir; dış kaynağa istek sadece sen tetiklediğinde gider.
                    </div>
                    <Button onClick={() => void handleReply()} disabled={selectedTicket.status === 'closed' || isSubmitting}>
                      {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
                      Cevap Gönder
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex min-h-[520px] flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-background/40 p-8 text-center">
              <LifeBuoy className="h-12 w-12 text-muted-foreground/40" />
              <h3 className="mt-4 text-xl font-semibold">Bir ticket seç</h3>
              <p className="mt-2 max-w-md text-sm text-muted-foreground">
                Sol taraftan bir destek kaydı seç veya yeni bir kayıt aç.
              </p>
            </div>
          )}
        </section>
      </div>

      <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 p-4 text-sm text-amber-100">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            Ticket görselleri bu sürümde link tabanlı çalışır. Banlı kullanıcılar da sadece bu destek akışına erişebilir; diğer sayfalarda erişim engeli devam eder.
          </p>
        </div>
      </div>
    </div>
      </main>
    </div>
  );
};

export default Support;
