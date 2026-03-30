import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { tr } from 'date-fns/locale';
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  Clock3,
  FileText,
  LifeBuoy,
  Link2,
  Loader2,
  Mail,
  MessageSquareReply,
  Plus,
  Send,
  ShieldAlert,
  Sparkles,
  Trash2,
  User,
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
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import ConfirmDialog from '@/components/ui/confirm-dialog';
import SupportImageAttachment from '@/components/support/SupportImageAttachment';
import { SupportTicket, SupportTicketCategory, SupportTicketMessage, SupportTicketStatus } from '@/lib/types';
import {
  createPublicSupportTicket,
  createSupportTicket,
  deleteSupportTicket,
  listSupportTickets,
  replyToSupportTicket,
} from '@/lib/supportTickets';
import { waitForUsableSupabaseSession } from '@/lib/supabase';
import { toast } from 'sonner';

const categoryLabels: Record<SupportTicketCategory, string> = {
  bug_report: 'Bug Report',
  account: 'Hesap',
  content_issue: 'İçerik Sorunu',
  ban_appeal: 'Ban İtirazı',
  other: 'Diğer',
};

const categoryDescriptions: Record<SupportTicketCategory, string> = {
  bug_report: 'Teknik hata, çökme veya beklenmeyen davranış.',
  account: 'Giriş, profil veya hesap erişimi.',
  content_issue: 'Seri, bölüm veya sayfa sorunu.',
  ban_appeal: 'Ban itirazısı. Banlanan hesap e-postası zorunlu.',
  other: 'Diğer destek talepleri.',
};

const supportCategories = Object.keys(categoryLabels) as SupportTicketCategory[];

const statusMeta: Record<SupportTicketStatus, { label: string; tone: string; icon: React.ComponentType<{ className?: string }> }> = {
  open: { label: 'Açık', tone: 'border-green-500/20 bg-green-500/10 text-green-300', icon: Sparkles },
  waiting_staff: { label: 'Staff Bekliyor', tone: 'border-sky-500/20 bg-sky-500/10 text-sky-300', icon: Clock3 },
  waiting_user: { label: 'Sıra Sizde', tone: 'border-amber-500/20 bg-amber-500/10 text-amber-200', icon: MessageSquareReply },
  closed: { label: 'Kapalı', tone: 'border-red-500/20 bg-red-500/10 text-red-300', icon: CheckCircle2 },
};

const messageRoleLabels: Record<SupportTicketMessage['authorRole'], string> = {
  user: 'Kullanıcı',
  moderator: 'Moderatör',
  admin: 'Admin',
  system: 'Sistem',
};

const formatTicketTime = (value: string) => formatDistanceToNow(new Date(value), { addSuffix: true, locale: tr });

const SupportTicketBadge = ({ status }: { status: SupportTicketStatus }) => {
  const StatusIcon = statusMeta[status].icon;
  return (
    <Badge variant="outline" className={`gap-1.5 border ${statusMeta[status].tone}`}>
      <StatusIcon className="h-3.5 w-3.5" />
      {statusMeta[status].label}
    </Badge>
  );
};

const Support: React.FC = () => {
  const { user, session, mfaState, isLoading: authLoading } = useAuth();
  const { isOnline } = useEffectiveOnlineStatus();
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [selectedTicketId, setSelectedTicketId] = useState('');
  const [category, setCategory] = useState<SupportTicketCategory>('bug_report');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [contactName, setContactName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [appealAccountEmail, setAppealAccountEmail] = useState('');
  const [reply, setReply] = useState('');
  const [replyImageUrl, setReplyImageUrl] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoadingTickets, setIsLoadingTickets] = useState(false);
  const [deletingTicketId, setDeletingTicketId] = useState<string | null>(null);
  const [publicSubmission, setPublicSubmission] = useState<SupportTicket | null>(null);
  const [ticketToDelete, setTicketToDelete] = useState<SupportTicket | null>(null);
  const loadTicketsPromiseRef = useRef<Promise<void> | null>(null);

  const isGuestMode = !user;
  const isBanAppeal = category === 'ban_appeal';
  const availableCategories = useMemo(
    () => (isGuestMode ? supportCategories.filter((value) => value !== 'account') : supportCategories),
    [isGuestMode],
  );
  const visibleTickets = useMemo(() => (user ? tickets.filter((ticket) => ticket.userId === user.id) : []), [tickets, user]);
  const selectedTicket = useMemo(
    () => visibleTickets.find((ticket) => ticket.id === selectedTicketId) || visibleTickets[0] || null,
    [selectedTicketId, visibleTickets],
  );

  useEffect(() => {
    if (!user) return;
    setContactName(user.username);
    setContactEmail(user.email);
    setAppealAccountEmail((current) => current || user.email);
  }, [user]);

  useEffect(() => {
    if (isGuestMode && category === 'account') {
      setCategory('bug_report');
    }
  }, [category, isGuestMode]);

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
        if (!silent) setIsLoadingTickets(true);
        await waitForUsableSupabaseSession({
          required: true,
          maxWaitMs: 5000,
        });
        const nextTickets = await listSupportTickets();
        setTickets(nextTickets);
        setSelectedTicketId((current) => (current && nextTickets.some((ticket) => ticket.id === current) ? current : nextTickets[0]?.id || ''));
      } catch (error) {
        if (!silent) {
          console.error('Support tickets load failed:', error);
          toast.error('Destek kayıtları yüklenemedi');
        }
      } finally {
        if (!silent) setIsLoadingTickets(false);
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
    if (authLoading || !user || !session?.access_token || mfaState.needsVerification) return;
    void loadTickets();
    const syncIfVisible = () => {
      if (document.visibilityState === 'visible') void loadTickets(true);
    };
    const intervalId = window.setInterval(syncIfVisible, 8000);
    return () => {
      window.clearInterval(intervalId);
    };
  }, [authLoading, loadTickets, mfaState.needsVerification, session?.access_token, user]);

  useEffect(() => {
    if (selectedTicket) {
      setReply('');
      setReplyImageUrl('');
    }
  }, [selectedTicket?.id]);

  const stats = useMemo(() => ({
    open: visibleTickets.filter((ticket) => ticket.status === 'open').length,
    waitingStaff: visibleTickets.filter((ticket) => ticket.status === 'waiting_staff').length,
    waitingUser: visibleTickets.filter((ticket) => ticket.status === 'waiting_user').length,
    closed: visibleTickets.filter((ticket) => ticket.status === 'closed').length,
  }), [visibleTickets]);

  const resetComposeState = () => {
    setCategory('bug_report');
    setSubject('');
    setMessage('');
    setImageUrl('');
    setAppealAccountEmail(user?.email || '');
  };

  const handleCreateTicket = async () => {
    if (!subject.trim() || !message.trim()) {
      toast.error('Başlık ve açıklama zorunlu');
      return;
    }
    if (isBanAppeal && !appealAccountEmail.trim()) {
      toast.error('Ban itirazı için banlanan hesabın e-postası zorunlu');
      return;
    }
    try {
      setIsSubmitting(true);
      if (user) {
        const nextTicket = await createSupportTicket({
          subject: subject.trim(),
          category,
          message: message.trim(),
          imageUrl: imageUrl.trim() || null,
          appealAccountEmail: appealAccountEmail.trim() || null,
        });
        setTickets((current) => [nextTicket, ...current.filter((ticket) => ticket.id !== nextTicket.id)]);
        setSelectedTicketId(nextTicket.id);
        setPublicSubmission(null);
      } else {
        if (!contactName.trim() || !contactEmail.trim()) {
          toast.error('İsim ve iletişim e-postası zorunlu');
          return;
        }
        const createdTicket = await createPublicSupportTicket({
          subject: subject.trim(),
          category,
          message: message.trim(),
          imageUrl: imageUrl.trim() || null,
          contactName: contactName.trim(),
          contactEmail: contactEmail.trim(),
          appealAccountEmail: appealAccountEmail.trim() || null,
        });
        setPublicSubmission(createdTicket);
      }
      resetComposeState();
      toast.success('Destek bileti oluşturuldu');
    } catch (error) {
      console.error('Create support ticket failed:', error);
      toast.error(error instanceof Error ? error.message : 'Destek bileti oluşturulamadı');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleReply = async () => {
    if (!user || !selectedTicket) return;
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
      setTickets((current) => current.map((ticket) => (ticket.id === updatedTicket.id ? updatedTicket : ticket)));
      setReply('');
      setReplyImageUrl('');
      toast.success('Yanıt gönderildi');
    } catch (error) {
      console.error('Support ticket reply failed:', error);
      toast.error(error instanceof Error ? error.message : 'Yanıt gönderilemedi');
      void loadTickets(true);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteTicket = async () => {
    if (!user) return;
    const targetTicket = ticketToDelete;
    if (!targetTicket) {
      return;
    }
    setTicketToDelete(null);

    try {
      setDeletingTicketId(targetTicket.id);
      await deleteSupportTicket(targetTicket.id);
      setTickets((current) => current.filter((ticket) => ticket.id !== targetTicket.id));
      setSelectedTicketId((current) => (current === targetTicket.id ? '' : current));
      toast.success('Ticket silindi');
    } catch (error) {
      console.error('Delete support ticket failed:', error);
      toast.error(error instanceof Error ? error.message : 'Ticket silinemedi');
    } finally {
      setDeletingTicketId(null);
    }
  };

  const composeCard = (
    <div className="rounded-3xl border border-border bg-card p-4 shadow-sm sm:p-5">
      <div className="mb-4 flex items-center gap-3">
        <div className="rounded-2xl bg-primary/10 p-2.5 text-primary"><Plus className="h-4.5 w-4.5" /></div>
        <div>
          <h2 className="text-base font-semibold">{isGuestMode ? 'Yeni destek talebi' : 'Yeni ticket'}</h2>
          <p className="text-sm text-muted-foreground">{isGuestMode ? 'Misafir modunda tek seferlik ticket aç.' : 'Konu seç, anlat, gönder.'}</p>
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2 sm:col-span-2">
          <Label>Kategori</Label>
          <Select value={category} onValueChange={(value) => setCategory(value as SupportTicketCategory)}>
            <SelectTrigger><SelectValue placeholder="Kategori seç" /></SelectTrigger>
            <SelectContent>
              {availableCategories.map((value) => (
                <SelectItem key={value} value={value}>{categoryLabels[value]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">{categoryDescriptions[category]}</p>
        </div>
        {isGuestMode && (
          <>
            <div className="space-y-2">
              <Label>İsim</Label>
              <Input value={contactName} onChange={(event) => setContactName(event.target.value)} placeholder="Adın veya kullanıcı adın" />
            </div>
            <div className="space-y-2">
              <Label>İletişim E-postası</Label>
              <Input type="email" value={contactEmail} onChange={(event) => setContactEmail(event.target.value)} placeholder="ornek@mail.com" />
            </div>
          </>
        )}
        <div className="space-y-2 sm:col-span-2">
          <Label>Başlık</Label>
          <Input value={subject} onChange={(event) => setSubject(event.target.value)} placeholder="Sorunu kısa ve net yaz" />
        </div>
        {isBanAppeal && (
          <div className="space-y-2 sm:col-span-2">
            <Label>Banlanan hesabın e-postası</Label>
            <Input type="email" value={appealAccountEmail} onChange={(event) => setAppealAccountEmail(event.target.value)} placeholder="Banlanan hesabın e-postası" />
          </div>
        )}
        <div className="space-y-2 sm:col-span-2">
          <Label>Açıklama</Label>
          <Textarea value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Sorunu detaylı anlat" className="min-h-28 resize-none" />
        </div>
        <div className="space-y-2 sm:col-span-2">
          <Label>Görsel linki (isteğe bağlı)</Label>
          <Input value={imageUrl} onChange={(event) => setImageUrl(event.target.value)} placeholder="https://..." />
          {imageUrl.trim() ? <SupportImageAttachment url={imageUrl} alt="Ticket görsel önizlemesi" initialPreview previewClassName="h-32 w-full rounded-2xl object-cover" /> : null}
        </div>
        <Button onClick={handleCreateTicket} className="sm:col-span-2" disabled={isSubmitting}>
          {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
          {isGuestMode ? 'Talebi Gönder' : 'Bilet Oluştur'}
        </Button>
      </div>
    </div>
  );

  if (!isOnline) {
    return (
      <OfflineRequiredScreen
        title="Destek çevrimdışında açılamaz"
        description="Destek talepleri ve ban itirazı akışı internet bağlantısı gerektirir. Bağlantı geri geldiğinde tekrar deneyin."
        actionHref="/downloads"
        actionLabel="İndirilenlere Git"
      />
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container pb-10 pt-20 sm:pt-24">
        <div className="space-y-4 pt-4 sm:space-y-5 sm:pt-6">
          <section className="rounded-[1.75rem] border border-border bg-card/80 p-4 shadow-xl sm:p-5">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
              <div className="space-y-2">
                <Badge variant="outline" className="w-fit gap-1.5 border-primary/20 bg-primary/10 text-primary"><LifeBuoy className="h-3.5 w-3.5" />Destek Merkezi</Badge>
                <h1 className="text-2xl font-black tracking-tight sm:text-3xl">{isGuestMode ? 'Giriş yapmadan da destek talebi bırak.' : 'Destek paneli daha sıkı yerleşimle hazır.'}</h1>
                <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
                  {isGuestMode ? 'Ban itirazısı dahil destek akışı misafir kullanıcıya açık. Ban itirazısında ilgili hesap e-postası zorunlu.' : 'Form, liste ve mesaj alanı aynı ekranda daha rahat görülecek şekilde küçültüldü.'}
                </p>
              </div>
              {user ? (
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <div className="rounded-2xl border border-border bg-background/70 px-3 py-2.5"><p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Açık</p><p className="mt-1 text-lg font-bold">{stats.open}</p></div>
                  <div className="rounded-2xl border border-border bg-background/70 px-3 py-2.5"><p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Staff</p><p className="mt-1 text-lg font-bold">{stats.waitingStaff}</p></div>
                  <div className="rounded-2xl border border-border bg-background/70 px-3 py-2.5"><p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Sizde</p><p className="mt-1 text-lg font-bold">{stats.waitingUser}</p></div>
                  <div className="rounded-2xl border border-border bg-background/70 px-3 py-2.5"><p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Kapalı</p><p className="mt-1 text-lg font-bold">{stats.closed}</p></div>
                </div>
              ) : (
                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="rounded-2xl border border-primary/20 bg-primary/10 px-4 py-3"><p className="text-[10px] uppercase tracking-[0.2em] text-primary/80">Misafir mod</p><p className="mt-1 text-sm font-semibold">Ticket açabilirsin</p></div>
                  <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 px-4 py-3"><p className="text-[10px] uppercase tracking-[0.2em] text-amber-200/80">Ban itirazı</p><p className="mt-1 text-sm font-semibold">Hesap e-postası zorunlu</p></div>
                </div>
              )}
            </div>
          </section>

          {isGuestMode ? (
            <div className="grid gap-4 xl:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
              {composeCard}
              <div className="space-y-4">
                {publicSubmission && (
                  <div className="rounded-3xl border border-emerald-500/20 bg-emerald-500/10 p-4 shadow-sm sm:p-5">
                    <div className="flex items-start gap-3">
                      <div className="rounded-2xl bg-emerald-500/15 p-2.5 text-emerald-300"><CheckCircle2 className="h-5 w-5" /></div>
                      <div className="space-y-2">
                        <p className="text-sm font-semibold text-emerald-100">Talep alındı</p>
                        <p className="text-sm text-emerald-50/85">Ticket ID: <span className="font-mono">{publicSubmission.id.slice(0, 8).toUpperCase()}</span></p>
                        <p className="text-xs leading-6 text-emerald-50/75">Yeni bir kayıt açmadan önce mevcut talebin işlenmesini bekle.</p>
                      </div>
                    </div>
                  </div>
                )}
                <div className="rounded-3xl border border-border bg-card p-4 shadow-sm sm:p-5">
                  <div className="mb-4 flex items-center gap-3">
                    <div className="rounded-2xl bg-primary/10 p-2.5 text-primary"><ShieldAlert className="h-5 w-5" /></div>
                    <div>
                      <h2 className="text-base font-semibold">Misafir destek akışı</h2>
                      <p className="text-sm text-muted-foreground">Özellikle logout sonrası ban itirazısı için.</p>
                    </div>
                  </div>
                  <div className="space-y-3 text-sm text-muted-foreground">
                    <p className="flex items-start gap-2"><Mail className="mt-0.5 h-4 w-4 shrink-0 text-primary" />İletişim e-postasını doğru gir.</p>
                    <p className="flex items-start gap-2"><FileText className="mt-0.5 h-4 w-4 shrink-0 text-primary" />Ban itirazısında banlanan hesabın e-postasını ayrıca yaz.</p>
                    <p className="flex items-start gap-2"><Link2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />Görsel linkleri sadece `http/https` kabul edilir.</p>
                  </div>
                  <Separator className="my-4" />
                  <Button asChild variant="secondary" size="sm"><Link to="/auth">Giriş Yap</Link></Button>
                </div>
              </div>
            </div>
          ) : (
            <div className="grid gap-4 xl:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
              <div className="space-y-4">
                {composeCard}
                <div className="rounded-3xl border border-border bg-card p-4 shadow-sm sm:p-5">
                  <div className="mb-4 flex items-center justify-between gap-3">
                    <div>
                      <h2 className="text-base font-semibold">Ticket listesi</h2>
                      <p className="text-sm text-muted-foreground">{isLoadingTickets ? 'Biletler yükleniyor...' : visibleTickets.length > 0 ? 'Açtığın kayıtlar burada görünür.' : 'Henüz ticket yok.'}</p>
                    </div>
                    <Badge variant="outline">{visibleTickets.length}</Badge>
                  </div>
                  <div className="space-y-2.5">
                    {visibleTickets.map((ticket) => (
                      <div
                        key={ticket.id}
                        className={`relative rounded-2xl border p-3.5 transition-colors ${
                          ticket.id === selectedTicketId
                            ? 'border-primary/30 bg-primary/10'
                            : 'border-border bg-background/60 hover:bg-secondary/60'
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => setSelectedTicketId(ticket.id)}
                          className="w-full pr-10 text-left"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="space-y-1">
                              <p className="text-sm font-semibold">{ticket.subject}</p>
                              <p className="text-xs text-muted-foreground">{categoryLabels[ticket.category]}</p>
                            </div>
                            <SupportTicketBadge status={ticket.status} />
                          </div>
                          <div className="mt-2 flex items-center gap-2 text-[11px] text-muted-foreground">
                            <CalendarDays className="h-3.5 w-3.5" />
                            {formatTicketTime(ticket.createdAt)}
                            <span className="h-1 w-1 rounded-full bg-border" />
                            {ticket.messages.length} mesaj
                          </div>
                        </button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="absolute right-2 top-2 h-8 w-8 text-muted-foreground hover:text-destructive"
                          onClick={(event) => {
                            event.stopPropagation();
                            setTicketToDelete(ticket);
                          }}
                          disabled={deletingTicketId === ticket.id}
                          aria-label="Ticket sil"
                        >
                          {deletingTicketId === ticket.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Trash2 className="h-4 w-4" />
                          )}
                        </Button>
                      </div>
                    ))}
                    {visibleTickets.length === 0 && (
                      <div className="rounded-2xl border border-dashed border-border p-6 text-center">
                        <LifeBuoy className="mx-auto h-10 w-10 text-muted-foreground/40" />
                        <p className="mt-3 font-medium">{isLoadingTickets ? 'Ticketler yükleniyor' : 'Ticket bulunamadı'}</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="rounded-3xl border border-border bg-card p-4 shadow-sm sm:p-5">
                {selectedTicket ? (
                  <div className="flex h-full flex-col gap-4">
                    <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                      <div className="space-y-2">
                        <div className="flex flex-wrap items-center gap-2"><h2 className="text-xl font-bold">{selectedTicket.subject}</h2><SupportTicketBadge status={selectedTicket.status} /></div>
                        <div className="flex flex-wrap gap-3 text-sm text-muted-foreground">
                          <span className="inline-flex items-center gap-1.5"><User className="h-4 w-4" />{selectedTicket.userName}</span>
                          <span className="inline-flex items-center gap-1.5"><FileText className="h-4 w-4" />{categoryLabels[selectedTicket.category]}</span>
                          <span className="inline-flex items-center gap-1.5"><Clock3 className="h-4 w-4" />{formatTicketTime(selectedTicket.lastMessageAt)}</span>
                        </div>
                        {selectedTicket.appealAccountEmail ? <p className="text-xs text-amber-200">Ban itirazı hesabı: {selectedTicket.appealAccountEmail}</p> : null}
                      </div>
                      {selectedTicket.imageUrl ? <div className="xl:w-56"><SupportImageAttachment url={selectedTicket.imageUrl} alt="Ticket görseli" previewClassName="h-32 w-full rounded-2xl object-cover" /></div> : null}
                    </div>
                    <Separator />
                    <ScrollArea className="h-[400px] pr-2 sm:h-[430px]">
                      <div className="space-y-3.5">
                        {selectedTicket.messages.map((item) => {
                          const isOwn = item.authorId ? item.authorId === user?.id : item.authorRole === 'user';
                          const bubble = isOwn ? 'border-sky-400/30 bg-sky-500/15' : item.authorRole === 'admin' ? 'border-violet-500/25 bg-violet-500/10' : item.authorRole === 'moderator' ? 'border-emerald-500/25 bg-emerald-500/10' : item.authorRole === 'system' ? 'border-amber-500/25 bg-amber-500/10' : 'border-border bg-background/70';
                          const roleTone = isOwn ? 'border-sky-400/25 bg-sky-500/12 text-sky-100' : item.authorRole === 'admin' ? 'border-violet-500/25 bg-violet-500/12 text-violet-100' : item.authorRole === 'moderator' ? 'border-emerald-500/25 bg-emerald-500/12 text-emerald-100' : item.authorRole === 'system' ? 'border-amber-500/25 bg-amber-500/12 text-amber-100' : 'border-border bg-background/60 text-muted-foreground';
                          return (
                            <article key={item.id} className={`flex ${isOwn ? 'justify-end' : 'justify-start'}`}>
                              <div className={`flex max-w-[92%] flex-col gap-2 rounded-[1.35rem] border px-3.5 py-3 sm:max-w-[78%] ${isOwn ? 'ml-6 items-end rounded-br-md text-right sm:ml-10' : 'mr-6 items-start rounded-bl-md text-left sm:mr-10'} ${bubble}`}>
                                <div className={`flex flex-wrap items-center gap-2 ${isOwn ? 'justify-end' : 'justify-start'}`}>
                                  <span className="text-sm font-semibold text-foreground">{item.authorName}</span>
                                  <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.16em] ${roleTone}`}>{messageRoleLabels[item.authorRole]}</span>
                                </div>
                                <p className={`w-full whitespace-pre-wrap text-sm leading-6 ${isOwn ? 'text-right text-foreground' : 'text-left text-foreground/90'}`}>{item.content}</p>
                                {item.imageUrl ? <SupportImageAttachment url={item.imageUrl} alt="Bilet görseli" className="mt-1 w-full" /> : null}
                                <p className={`w-full text-[10px] uppercase tracking-[0.2em] text-muted-foreground ${isOwn ? 'text-right' : 'text-left'}`}>{formatTicketTime(item.createdAt)}</p>
                              </div>
                            </article>
                          );
                        })}
                      </div>
                    </ScrollArea>
                    <div className="rounded-3xl border border-border bg-background/70 p-4">
                      <div className="flex items-center gap-2 text-sm text-muted-foreground"><MessageSquareReply className="h-4 w-4" />{selectedTicket.status === 'closed' ? 'Bu bilet kapalı.' : 'Yanıt gönder ve akışı sürdür.'}</div>
                      <div className="mt-3 space-y-3">
                        <Textarea value={reply} onChange={(event) => setReply(event.target.value)} placeholder={selectedTicket.status === 'closed' ? 'Kapalı bilette yanıt yazılamaz' : 'Yanıtını yaz'} className="min-h-24 resize-none" disabled={selectedTicket.status === 'closed'} />
                        <div className="space-y-2">
                          <Label>Yanıt görsel linki (isteğe bağlı)</Label>
                          <Input value={replyImageUrl} onChange={(event) => setReplyImageUrl(event.target.value)} placeholder="https://..." disabled={selectedTicket.status === 'closed'} />
                        </div>
                        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                          <div className="flex items-center gap-2 text-xs text-muted-foreground"><Link2 className="h-3.5 w-3.5" />Linkli görseller güvenli önizleme ile yüklenir.</div>
                          <Button onClick={() => void handleReply()} disabled={selectedTicket.status === 'closed' || isSubmitting}>
                            {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
                            Cevap Gönder
                          </Button>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="flex min-h-[460px] flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-background/40 p-8 text-center">
                    <LifeBuoy className="h-12 w-12 text-muted-foreground/40" />
                    <h3 className="mt-4 text-xl font-semibold">Bir ticket seç</h3>
                    <p className="mt-2 max-w-md text-sm text-muted-foreground">Soldan bir destek kaydı seç veya yeni bir kayıt aç.</p>
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 p-4 text-sm text-amber-100">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <p>Banlanan kullanıcılar uyarıyı gördükten sonra oturumdan çıkarılır; destek ve ban itirazısı akışı ise misafir modunda da açık kalır.</p>
            </div>
          </div>
        </div>
      </main>

      <ConfirmDialog
        open={Boolean(ticketToDelete)}
        onOpenChange={(open) => {
          if (!open) {
            setTicketToDelete(null);
          }
        }}
        title="Ticket silinsin mi?"
        description={
          ticketToDelete
            ? `"${ticketToDelete.subject}" başlıklı ticket ve içindeki mesajlar kalıcı olarak silinecek.`
            : ''
        }
        confirmLabel="Ticketı Sil"
        cancelLabel="Vazgeç"
        onConfirm={() => {
          void handleDeleteTicket();
        }}
        destructive
      />
    </div>
  );
};

export default Support;
