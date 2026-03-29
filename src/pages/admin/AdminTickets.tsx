import React, { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { tr } from 'date-fns/locale';
import {
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Copy,
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
import { Textarea } from '@/components/ui/textarea';
import SupportImageAttachment from '@/components/support/SupportImageAttachment';
import { SupportTicket, SupportTicketCategory, SupportTicketMessage, SupportTicketStatus } from '@/lib/types';
import { listSupportTickets, replyToSupportTicket, updateSupportTicketStatus } from '@/lib/supportTickets';
import { cn } from '@/lib/utils';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

type StatusFilterValue = SupportTicketStatus | 'all';

type StatusMetaEntry = {
  label: string;
  tone: string;
  icon: React.ComponentType<{ className?: string }>;
  panelTone: string;
  surfaceTone: string;
  dotTone: string;
  railTone: string;
};

type RoleMetaEntry = {
  badgeTone: string;
  bubbleTone: string;
  timeTone: string;
};

const categoryLabels: Record<SupportTicketCategory, string> = {
  bug_report: 'Bug Report',
  account: 'Hesap',
  content_issue: 'İçerik Sorunu',
  ban_appeal: 'Ban İtirazı',
  other: 'Diğer',
};

const statusMeta: Record<SupportTicketStatus, StatusMetaEntry> = {
  open: {
    label: 'Açık',
    tone: 'border-emerald-500/35 bg-emerald-500/12 text-emerald-200',
    icon: CheckCircle2,
    panelTone: 'from-emerald-500/14 via-emerald-500/5 to-transparent',
    surfaceTone: 'border-emerald-500/18 bg-emerald-500/[0.06]',
    dotTone: 'bg-emerald-300',
    railTone: 'from-emerald-300 via-emerald-400 to-emerald-500',
  },
  waiting_staff: {
    label: 'Staff Bekliyor',
    tone: 'border-sky-500/35 bg-sky-500/12 text-sky-200',
    icon: Clock3,
    panelTone: 'from-sky-500/14 via-sky-500/5 to-transparent',
    surfaceTone: 'border-sky-500/18 bg-sky-500/[0.06]',
    dotTone: 'bg-sky-300',
    railTone: 'from-sky-300 via-sky-400 to-sky-500',
  },
  waiting_user: {
    label: 'Kullanıcı Bekliyor',
    tone: 'border-amber-500/35 bg-amber-500/12 text-amber-100',
    icon: MessageSquareReply,
    panelTone: 'from-amber-500/14 via-amber-500/5 to-transparent',
    surfaceTone: 'border-amber-500/18 bg-amber-500/[0.06]',
    dotTone: 'bg-amber-300',
    railTone: 'from-amber-200 via-amber-400 to-amber-500',
  },
  closed: {
    label: 'Kapalı',
    tone: 'border-rose-500/35 bg-rose-500/12 text-rose-200',
    icon: XCircle,
    panelTone: 'from-rose-500/14 via-rose-500/5 to-transparent',
    surfaceTone: 'border-rose-500/18 bg-rose-500/[0.06]',
    dotTone: 'bg-rose-300',
    railTone: 'from-rose-200 via-rose-400 to-rose-500',
  },
};

const statusFilterMeta: Record<StatusFilterValue, {
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  panelTone: string;
  surfaceTone: string;
  dotTone: string;
}> = {
  all: {
    label: 'Tümü',
    description: 'Açık, bekleyen ve kapanan tüm kayıtlar.',
    icon: Filter,
    panelTone: 'from-white/14 via-white/[0.05] to-transparent',
    surfaceTone: 'border-white/12 bg-white/[0.03]',
    dotTone: 'bg-white/70',
  },
  open: {
    label: statusMeta.open.label,
    description: 'Yeni veya aktif işlem bekleyen talepler.',
    icon: statusMeta.open.icon,
    panelTone: statusMeta.open.panelTone,
    surfaceTone: statusMeta.open.surfaceTone,
    dotTone: statusMeta.open.dotTone,
  },
  waiting_staff: {
    label: statusMeta.waiting_staff.label,
    description: 'Ekip aksiyonu gereken kayıtlar.',
    icon: statusMeta.waiting_staff.icon,
    panelTone: statusMeta.waiting_staff.panelTone,
    surfaceTone: statusMeta.waiting_staff.surfaceTone,
    dotTone: statusMeta.waiting_staff.dotTone,
  },
  waiting_user: {
    label: statusMeta.waiting_user.label,
    description: 'Kullanıcı dönüşü beklenen konuşmalar.',
    icon: statusMeta.waiting_user.icon,
    panelTone: statusMeta.waiting_user.panelTone,
    surfaceTone: statusMeta.waiting_user.surfaceTone,
    dotTone: statusMeta.waiting_user.dotTone,
  },
  closed: {
    label: statusMeta.closed.label,
    description: 'İşlemi tamamlanmış veya arşivlenmiş talepler.',
    icon: statusMeta.closed.icon,
    panelTone: statusMeta.closed.panelTone,
    surfaceTone: statusMeta.closed.surfaceTone,
    dotTone: statusMeta.closed.dotTone,
  },
};

const messageRoleLabels: Record<SupportTicketMessage['authorRole'], string> = {
  user: 'Kullanıcı',
  moderator: 'Moderatör',
  admin: 'Admin',
  system: 'Sistem',
};

const messageRoleMeta: Record<SupportTicketMessage['authorRole'], RoleMetaEntry> = {
  user: {
    badgeTone: 'border-white/12 bg-white/[0.05] text-foreground/80',
    bubbleTone: 'border-white/10 bg-white/[0.035] text-foreground/88',
    timeTone: 'text-muted-foreground',
  },
  moderator: {
    badgeTone: 'border-emerald-500/25 bg-emerald-500/12 text-emerald-100',
    bubbleTone: 'border-emerald-500/18 bg-emerald-500/[0.06] text-emerald-50',
    timeTone: 'text-emerald-100/70',
  },
  admin: {
    badgeTone: 'border-sky-500/25 bg-sky-500/12 text-sky-100',
    bubbleTone: 'border-sky-500/18 bg-sky-500/[0.06] text-sky-50',
    timeTone: 'text-sky-100/70',
  },
  system: {
    badgeTone: 'border-amber-500/30 bg-amber-500/12 text-amber-100',
    bubbleTone: 'border-amber-500/18 bg-amber-500/[0.06] text-amber-50',
    timeTone: 'text-amber-100/70',
  },
};

const ownMessageMeta: RoleMetaEntry = {
  badgeTone: 'border-sky-500/25 bg-sky-500/12 text-sky-100',
  bubbleTone: 'border-sky-500/18 bg-sky-500/[0.08] text-sky-50',
  timeTone: 'text-sky-100/70',
};

const formatTicketTime = (value: string) => formatDistanceToNow(new Date(value), { addSuffix: true, locale: tr });

const TicketStatusBadge = ({
  status,
  className,
}: {
  status: SupportTicketStatus;
  className?: string;
}) => {
  const StatusIcon = statusMeta[status].icon;

  return (
    <Badge
      className={cn(
        'gap-1.5 border px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[0.16em]',
        statusMeta[status].tone,
        className,
      )}
    >
      <StatusIcon className="h-3.5 w-3.5" />
      {statusMeta[status].label}
    </Badge>
  );
};

const FilterOverviewCard = ({
  label,
  description,
  count,
  icon: Icon,
  panelTone,
  dotTone,
  active,
  onClick,
}: {
  label: string;
  description: string;
  count: number;
  icon: React.ComponentType<{ className?: string }>;
  panelTone: string;
  dotTone: string;
  active: boolean;
  onClick: () => void;
}) => (
  <button
    type="button"
    onClick={onClick}
    aria-pressed={active}
    className={cn(
      'group relative overflow-hidden rounded-[1.25rem] border p-3.5 text-left transition-all duration-200',
      active
        ? 'border-white/14 bg-white/[0.07] shadow-[0_12px_32px_rgba(2,6,23,0.28)]'
        : 'border-white/8 bg-black/10 hover:border-white/14 hover:bg-white/[0.04]',
    )}
  >
    <div className={cn('absolute inset-x-0 top-0 h-24 bg-gradient-to-b opacity-80', panelTone)} />
    <div className="relative flex items-start justify-between gap-3">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-black/20 text-foreground/85">
        <Icon className="h-3.5 w-3.5" />
      </span>
      <span className={cn('mt-1 h-2.5 w-2.5 shrink-0 rounded-full shadow-[0_0_18px_currentColor]', dotTone)} />
    </div>
    <div className="relative mt-4">
      <p className="text-xl font-semibold tracking-tight text-foreground">{count}</p>
      <p className="mt-1 text-sm font-medium text-foreground/90">{label}</p>
      <p className="mt-1.5 text-[11px] leading-5 text-muted-foreground">{description}</p>
    </div>
  </button>
);

const DetailMetaCard = ({
  icon: Icon,
  label,
  value,
  hint,
  className,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: React.ReactNode;
  hint?: string;
  className?: string;
}) => (
  <div className={cn('rounded-[1.2rem] border border-white/10 bg-white/[0.03] p-3.5', className)}>
    <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
      <Icon className="h-3 w-3" />
      {label}
    </div>
    <div className="mt-2.5 text-sm font-medium leading-5 text-foreground">{value}</div>
    {hint ? <p className="mt-1.5 text-[11px] leading-5 text-muted-foreground">{hint}</p> : null}
  </div>
);

const CopyableInfoChip = ({
  icon: Icon,
  value,
  onClick,
  className,
  title,
}: {
  icon: React.ComponentType<{ className?: string }>;
  value: string;
  onClick: () => void;
  className?: string;
  title: string;
}) => (
  <button
    type="button"
    onClick={onClick}
    title={title}
    className={cn(
      'inline-flex min-w-0 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5 text-sm text-foreground/90 transition-colors hover:border-white/18 hover:bg-white/[0.06]',
      className,
    )}
  >
    <Icon className="h-4 w-4 shrink-0 text-primary" />
    <span className="truncate">{value}</span>
    <Copy className="ml-auto h-3.5 w-3.5 shrink-0 text-muted-foreground" />
  </button>
);

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

  const filterCards = useMemo(() => ([
    { value: 'all' as const, count: counts.all, ...statusFilterMeta.all },
    { value: 'open' as const, count: counts.open, ...statusFilterMeta.open },
    { value: 'waiting_staff' as const, count: counts.waiting_staff, ...statusFilterMeta.waiting_staff },
    { value: 'waiting_user' as const, count: counts.waiting_user, ...statusFilterMeta.waiting_user },
    { value: 'closed' as const, count: counts.closed, ...statusFilterMeta.closed },
  ]), [counts]);

  const activeFilterMeta = statusFilterMeta[statusFilter];

  const handleCopyTicketField = useCallback(async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(`${label} panoya kopyalandı`);
    } catch (error) {
      console.error(`Admin ticket ${label} copy failed:`, error);
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
      <section className="rounded-[1.6rem] border border-white/10 bg-card/95 shadow-[0_18px_48px_rgba(2,6,23,0.28)]">
        <div className="space-y-4 p-4 sm:p-5">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
            <div className="max-w-2xl">
              <Badge variant="outline" className="w-fit gap-2 border-primary/20 bg-primary/10 px-2.5 py-1 text-primary">
                <LifeBuoy className="h-3.5 w-3.5" />
                Destek Talepleri
              </Badge>
              <h1 className="mt-3 text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
                Ticket akışını tek panelden yönet
              </h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
                Ölçeği düşürülmüş, daha sade ve daha hızlı taranabilen görünüm. Durum etiketleri doğrudan açık-kapalı mantığıyla ayrılıyor.
              </p>
            </div>

            <div className="flex flex-col items-start gap-2 xl:items-end">
              <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs text-foreground/85">
                {isLoadingTickets ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                ) : (
                  <Clock3 className="h-3.5 w-3.5 text-primary" />
                )}
                {isLoadingTickets ? 'Kayıtlar yenileniyor' : '8 sn otomatik senkron'}
              </div>
              <p className="text-xs text-muted-foreground">
                {filteredTickets.length} kayıt görüntüleniyor
                <span className="mx-2 text-white/20">•</span>
                Aktif filtre: {activeFilterMeta.label}
              </p>
            </div>
          </div>

          <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-5">
            {filterCards.map((item) => (
              <FilterOverviewCard
                key={item.value}
                label={item.label}
                description={item.description}
                count={item.count}
                icon={item.icon}
                panelTone={item.panelTone}
                dotTone={item.dotTone}
                active={statusFilter === item.value}
                onClick={() => setStatusFilter(item.value)}
              />
            ))}
          </div>
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-[minmax(390px,470px)_minmax(0,1fr)] xl:items-start">
        <section className="flex min-h-[36rem] min-w-0 flex-col self-start overflow-hidden rounded-[1.6rem] border border-white/10 bg-card/95 shadow-[0_18px_48px_rgba(2,6,23,0.26)] xl:h-[calc(100vh-8.75rem)]">
          <div className="border-b border-white/10 p-4 sm:p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Liste</p>
                <h2 className="mt-1.5 text-lg font-semibold tracking-tight text-foreground">Bilet kuyruğu</h2>
                <p className="mt-1.5 text-sm leading-5 text-muted-foreground">
                  En az üç kaydı aynı anda gör ve soldan kaydırmadan ilerle.
                </p>
              </div>
              <Badge variant="outline" className="border-white/10 bg-white/[0.04] px-2.5 py-1 text-xs text-foreground/80">
                {filteredTickets.length} kayıt
              </Badge>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_150px]">
              <div className="space-y-2">
                <Label htmlFor="admin-ticket-search" className="text-xs text-foreground/90">Arama</Label>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="admin-ticket-search"
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    placeholder="Başlık, isim veya e-posta"
                    className="h-10 rounded-xl border-white/10 bg-white/[0.04] pl-10 text-sm text-foreground placeholder:text-muted-foreground"
                  />
                </div>
              </div>

              <div className={cn('rounded-[1.1rem] border p-3', activeFilterMeta.surfaceTone)}>
                <p className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Aktif filtre</p>
                <div className="mt-2 flex items-center gap-2">
                  <span className={cn('h-2.5 w-2.5 rounded-full shadow-[0_0_18px_currentColor]', activeFilterMeta.dotTone)} />
                  <p className="text-sm font-medium text-foreground">{activeFilterMeta.label}</p>
                </div>
                <p className="mt-1.5 text-[11px] leading-5 text-muted-foreground">{activeFilterMeta.description}</p>
              </div>
            </div>
          </div>

          <ScrollArea className="min-h-0 flex-1">
            <div className="space-y-2.5 p-4 sm:p-5">
              {filteredTickets.map((ticket) => {
                const isSelected = ticket.id === selectedTicketId;
                const ticketStatus = statusMeta[ticket.status];
                const lastMessage = ticket.messages[ticket.messages.length - 1];

                return (
                  <button
                    key={ticket.id}
                    type="button"
                    onClick={() => setSelectedTicketId(ticket.id)}
                    className={cn(
                      'group relative w-full overflow-hidden rounded-[1.2rem] border text-left transition-all duration-200',
                      isSelected
                        ? 'border-white/14 bg-white/[0.07] shadow-[0_14px_36px_rgba(2,6,23,0.28)]'
                        : 'border-white/8 bg-black/10 hover:border-white/14 hover:bg-white/[0.04]',
                    )}
                  >
                    <div className={cn('absolute inset-y-0 left-0 w-1 bg-gradient-to-b', ticketStatus.railTone)} />
                    <div className={cn('absolute inset-x-0 top-0 h-20 bg-gradient-to-b opacity-75', ticketStatus.panelTone)} />

                    <div className="relative p-3.5">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="truncate text-[15px] font-semibold leading-5 text-foreground">{ticket.subject}</p>
                            {ticket.isGuestTicket ? (
                              <span className="rounded-full border border-primary/20 bg-primary/10 px-2 py-0.5 text-[9px] font-medium uppercase tracking-[0.14em] text-primary">
                                Misafir
                              </span>
                            ) : null}
                          </div>
                          <p className="mt-1 truncate text-[11px] text-muted-foreground">
                            {ticket.userName}
                            <span className="mx-1.5 text-white/20">•</span>
                            {ticket.userEmail}
                          </p>
                        </div>
                        <TicketStatusBadge status={ticket.status} className="shrink-0" />
                      </div>

                      <p className="mt-2.5 line-clamp-2 text-[13px] leading-5 text-foreground/80">
                        {lastMessage?.content || 'Mesaj içeriği bulunamadı.'}
                      </p>

                      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
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
                    </div>
                  </button>
                );
              })}

              {filteredTickets.length === 0 && (
                <div className="rounded-[1.3rem] border border-dashed border-white/10 bg-white/[0.03] p-8 text-center">
                  <Loader2 className={cn('mx-auto h-9 w-9 text-muted-foreground/40', isLoadingTickets ? 'animate-spin' : '')} />
                  <p className="mt-4 text-base font-semibold text-foreground">
                    {isLoadingTickets ? 'Ticketler yükleniyor' : 'Eşleşen ticket bulunamadı'}
                  </p>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">
                    {isLoadingTickets ? 'Kayıtlar getiriliyor.' : 'Aramayı temizle veya üstteki durum kartlarından farklı bir filtre seç.'}
                  </p>
                </div>
              )}
            </div>
          </ScrollArea>
        </section>

        <section className="flex min-h-0 min-w-0 flex-col self-start rounded-[1.6rem] border border-white/10 bg-card/95 p-3.5 shadow-[0_18px_48px_rgba(2,6,23,0.26)] sm:p-4">
          {selectedTicket ? (
            <div className="flex min-h-0 flex-col gap-4">
              <div className="relative overflow-hidden rounded-[1.35rem] border border-white/10 bg-background/40 p-4 shadow-[0_14px_40px_rgba(2,6,23,0.24)] sm:p-5">
                <div className={cn('absolute inset-0 bg-gradient-to-br opacity-80', statusMeta[selectedTicket.status].panelTone)} />

                <div className="relative grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px] lg:items-start">
                  <div className="min-w-0 space-y-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline" className="border-white/10 bg-white/[0.04] px-2.5 py-1 text-xs text-foreground/80">
                        #{selectedTicket.id.slice(0, 8)}
                      </Badge>
                      <TicketStatusBadge status={selectedTicket.status} />
                      {selectedTicket.isGuestTicket ? (
                        <Badge variant="outline" className="border-primary/20 bg-primary/10 px-2.5 py-1 text-xs text-primary">
                          Misafir Ticket
                        </Badge>
                      ) : null}
                    </div>

                    <div>
                      <h2 className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
                        {selectedTicket.subject}
                      </h2>
                      <p className="mt-2 text-sm leading-6 text-foreground/75">
                        {categoryLabels[selectedTicket.category]} kategorisinde. Son hareket {formatTicketTime(selectedTicket.lastMessageAt)}.
                      </p>
                    </div>

                    <div className="grid gap-2.5 sm:grid-cols-2">
                      <CopyableInfoChip
                        icon={User}
                        value={selectedTicket.userName}
                        title="Kullanıcı adını kopyala"
                        onClick={() => void handleCopyTicketField(selectedTicket.userName, 'Kullanıcı adı')}
                      />
                      <CopyableInfoChip
                        icon={Mail}
                        value={selectedTicket.userEmail}
                        title="E-postayı kopyala"
                        onClick={() => void handleCopyTicketField(selectedTicket.userEmail, 'E-posta')}
                      />
                      {selectedTicket.appealAccountEmail ? (
                        <div className="inline-flex min-w-0 items-center gap-2 rounded-xl border border-amber-500/20 bg-amber-500/[0.08] px-3 py-2.5 text-sm text-amber-100 sm:col-span-2">
                          <ShieldAlert className="h-4 w-4 shrink-0" />
                          <span className="truncate">Ban itirazı hesabı: {selectedTicket.appealAccountEmail}</span>
                        </div>
                      ) : null}
                    </div>
                  </div>

                  {selectedTicket.imageUrl ? (
                    <div className="min-w-0 lg:w-full">
                      <SupportImageAttachment
                        url={selectedTicket.imageUrl}
                        alt="Ticket görseli"
                        variant="adminCompact"
                        previewClassName="h-32 w-full rounded-xl object-cover"
                      />
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <DetailMetaCard
                  icon={Clock3}
                  label="Kategori"
                  value={categoryLabels[selectedTicket.category]}
                  hint="Talebin türünü hızlıca ayırt eder."
                />
                <DetailMetaCard
                  icon={MessageSquareReply}
                  label="Mesaj Sayısı"
                  value={`${selectedTicket.messages.length} adet`}
                  hint="Konuşma yoğunluğunu gösterir."
                />
                <DetailMetaCard
                  icon={CalendarDays}
                  label="Açılış"
                  value={formatTicketTime(selectedTicket.createdAt)}
                  hint="İlk ticket zamanı."
                />
                <DetailMetaCard
                  icon={LifeBuoy}
                  label="Son Hareket"
                  value={formatTicketTime(selectedTicket.lastMessageAt)}
                  hint="En son etkileşim zamanı."
                />
              </div>

              <section className="overflow-hidden rounded-[1.35rem] border border-white/10 bg-background/35">
                <div className="border-b border-white/10 px-4 py-4 sm:px-5">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                      <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Konuşma</p>
                      <h3 className="mt-1 text-base font-semibold text-foreground">Mesaj akışı</h3>
                      <p className="mt-1 text-xs leading-5 text-muted-foreground">
                        {selectedTicket.status === 'closed'
                          ? 'Bu ticket kapalı. Cevap için önce yeniden aç.'
                          : 'Mesajlar ve yanıt alanı aynı panelde tutulur.'}
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline" className="w-fit border-white/10 bg-white/[0.04] px-2.5 py-1 text-xs text-foreground/80">
                        {selectedTicket.messages.length} mesaj
                      </Badge>
                      {selectedTicket.status !== 'closed' ? (
                        <Button
                          variant="outline"
                          onClick={() => void handleCloseTicket()}
                          disabled={isUpdatingStatus}
                          className="h-9 rounded-xl border-white/10 bg-white/[0.04] px-3 text-xs hover:bg-white/[0.08]"
                        >
                          {isUpdatingStatus ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          ) : (
                            <CheckCircle2 className="mr-2 h-4 w-4" />
                          )}
                          Kapat
                        </Button>
                      ) : (
                        <Button
                          variant="outline"
                          onClick={() => void handleReopenTicket()}
                          disabled={isUpdatingStatus}
                          className="h-9 rounded-xl border-white/10 bg-white/[0.04] px-3 text-xs hover:bg-white/[0.08]"
                        >
                          {isUpdatingStatus ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          ) : (
                            <ArrowRight className="mr-2 h-4 w-4" />
                          )}
                          Yeniden Aç
                        </Button>
                      )}
                    </div>
                  </div>
                </div>

                <ScrollArea className="h-[22rem] px-3 py-3 sm:px-4 lg:h-[calc(100vh-24rem)]">
                  <div className="space-y-2.5 pr-3">
                    {selectedTicket.messages.map((item) => {
                      const isOwnMessage = item.authorId === user?.id;
                      const roleMeta = isOwnMessage ? ownMessageMeta : messageRoleMeta[item.authorRole];

                      return (
                        <article
                          key={item.id}
                          className={cn('flex', isOwnMessage ? 'justify-end' : 'justify-start')}
                        >
                          <div
                            className={cn(
                              'max-w-[88%] rounded-[1.1rem] border px-3 py-2.5 shadow-[0_10px_24px_rgba(0,0,0,0.16)] sm:max-w-[74%]',
                              roleMeta.bubbleTone,
                              isOwnMessage ? 'rounded-tr-md text-right' : 'rounded-tl-md text-left',
                            )}
                          >
                            <div className={cn('flex flex-wrap items-center gap-1.5', isOwnMessage ? 'justify-end' : 'justify-start')}>
                              <span className="text-[12px] font-semibold text-foreground">{item.authorName}</span>
                              <span className={cn('rounded-full border px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-[0.14em]', roleMeta.badgeTone)}>
                                {isOwnMessage ? 'Ben' : messageRoleLabels[item.authorRole]}
                              </span>
                            </div>

                            <p className="mt-1.5 whitespace-pre-wrap text-[12px] leading-5 text-inherit">{item.content}</p>

                            {item.imageUrl ? (
                              <div className="mt-2">
                                <SupportImageAttachment
                                  url={item.imageUrl}
                                  alt="Ticket mesaj görseli"
                                  variant="adminCompact"
                                  className="w-full"
                                  previewClassName="h-24 w-full rounded-xl object-cover"
                                />
                              </div>
                            ) : null}

                            <p className={cn('mt-2 text-[10px] uppercase tracking-[0.14em]', roleMeta.timeTone)}>
                              {formatTicketTime(item.createdAt)}
                            </p>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                </ScrollArea>

                <div className="border-t border-white/10 bg-white/[0.02] px-3 py-3 sm:px-4">
                  <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_260px_auto] lg:items-end">
                    <div className="space-y-1.5">
                      <Label htmlFor="admin-ticket-reply" className="text-xs text-foreground/90">Yanıt</Label>
                      <Textarea
                        id="admin-ticket-reply"
                        value={reply}
                        onChange={(event) => setReply(event.target.value)}
                        placeholder={selectedTicket.status === 'closed' ? 'Ticket kapalı' : 'Cevabını buraya yaz'}
                        className="min-h-[92px] resize-none rounded-[1.15rem] border-white/10 bg-white/[0.04] text-sm leading-5 text-foreground placeholder:text-muted-foreground"
                        disabled={selectedTicket.status === 'closed'}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="admin-ticket-image" className="text-xs text-foreground/90">Görsel linki</Label>
                      <Input
                        id="admin-ticket-image"
                        value={replyImageUrl}
                        onChange={(event) => setReplyImageUrl(event.target.value)}
                        placeholder="https://..."
                        disabled={selectedTicket.status === 'closed'}
                        className="h-10 rounded-xl border-white/10 bg-background/60 text-sm text-foreground placeholder:text-muted-foreground"
                      />
                      {replyImageUrl.trim() ? (
                        <SupportImageAttachment
                          url={replyImageUrl}
                          alt="Admin yanıt görsel önizlemesi"
                          variant="adminCompact"
                          initialPreview
                          previewClassName="h-24 w-full rounded-xl object-cover"
                        />
                      ) : null}
                      <p className="text-[11px] leading-4 text-muted-foreground">
                        Gönderim sonrası durum otomatik olarak kullanıcı bekliyor olur.
                      </p>
                    </div>

                    <Button
                      variant="glow"
                      onClick={() => void handleReply()}
                      disabled={selectedTicket.status === 'closed' || isSubmitting}
                      className="h-10 rounded-xl px-4 text-xs lg:self-end"
                    >
                      {isSubmitting ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Send className="mr-2 h-4 w-4" />
                      )}
                      Yanıt Gönder
                    </Button>
                  </div>
                </div>
              </section>
            </div>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col items-center justify-center rounded-[1.35rem] border border-dashed border-white/10 bg-white/[0.03] p-8 text-center">
              <LifeBuoy className="h-12 w-12 text-muted-foreground/40" />
              <h3 className="mt-4 text-xl font-semibold text-foreground">Ticket seçilmedi</h3>
              <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">
                Soldaki listeden bir kayıt seç veya üstteki filtre kartlarıyla görünümü değiştir. Kullanıcı bilgileri, mesaj akışı ve durum işlemleri burada açılır.
              </p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
};

export default AdminTickets;
