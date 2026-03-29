import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { tr } from 'date-fns/locale';
import { AlertTriangle, Calendar, Gavel, Loader2, Mail, MessageSquareWarning, Search, ShieldAlert, ShieldBan, ShieldCheck, Trash2, UserCircle, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { getAllUsers, deleteUser } from '@/lib/database';
import { banUserAccount, deleteUserWarning, getUserAccessHistory, issueUserWarning, type UserAccessHistory, unbanUserAccount } from '@/lib/adminUserAccess';
import { User, UserBanKind } from '@/lib/types';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

const ACTIVE_WINDOW_MS = 15 * 60 * 1000;
const banKindLabels: Record<UserBanKind, string> = { timed: 'Süreli Ban', permanent: 'Kalıcı Ban', hard: 'Hard Ban' };
const formatRelative = (value?: string | null) => value ? formatDistanceToNow(new Date(value), { addSuffix: true, locale: tr }) : 'Bilinmiyor';
const formatTimestamp = (value?: string | null) => value ? new Date(value).toLocaleString('tr-TR') : 'Bilinmiyor';
const getErrorMessage = (error: unknown, fallback: string) => error instanceof Error ? error.message : fallback;

const getPresence = (account: User) => {
  if (account.isBanned) return { label: banKindLabels[account.activeBanType || 'permanent'], detail: account.banExpiresAt ? `Bitiş ${formatTimestamp(account.banExpiresAt)}` : account.banReason || 'Kısıtlı', banned: true };
  if (!account.lastSeenAt) return { label: 'Bilinmiyor', detail: undefined, banned: false };
  return Date.now() - new Date(account.lastSeenAt).getTime() <= ACTIVE_WINDOW_MS
    ? { label: 'Aktif', detail: `Son görülme ${formatRelative(account.lastSeenAt)}`, banned: false }
    : { label: 'Pasif', detail: `Son görülme ${formatRelative(account.lastSeenAt)}`, banned: false };
};

type ActionState = 'warning' | 'ban' | 'unban' | 'delete' | null;

const AdminUserManagement: React.FC = () => {
  const { user, isLoading: authLoading } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshingUsers, setIsRefreshingUsers] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [history, setHistory] = useState<UserAccessHistory | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedUserId, setSelectedUserId] = useState('');
  const [warningTarget, setWarningTarget] = useState<User | null>(null);
  const [banTarget, setBanTarget] = useState<User | null>(null);
  const [unbanTarget, setUnbanTarget] = useState<User | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<User | null>(null);
  const [activeAction, setActiveAction] = useState<ActionState>(null);
  const [warningTitle, setWarningTitle] = useState('Yönetici uyarısı');
  const [warningMessage, setWarningMessage] = useState('');
  const [warningDurationHours, setWarningDurationHours] = useState('');
  const [banKind, setBanKind] = useState<UserBanKind>('timed');
  const [banReason, setBanReason] = useState('');
  const [banDurationHours, setBanDurationHours] = useState('12');
  const [deletingWarningId, setDeletingWarningId] = useState<string | null>(null);
  const hasLoadedUsersRef = useRef(false);
  const loadUsersPromiseRef = useRef<Promise<void> | null>(null);
  const historyRequestRef = useRef<{ targetUserId: string; promise: Promise<void> } | null>(null);

  const loadUsers = useCallback(async (options?: { preserveVisibleState?: boolean }) => {
    if (loadUsersPromiseRef.current) {
      return loadUsersPromiseRef.current;
    }

    const request = (async () => {
      const shouldPreserveVisibleState = Boolean(options?.preserveVisibleState || hasLoadedUsersRef.current);
      if (shouldPreserveVisibleState) {
        setIsRefreshingUsers(true);
      } else {
        setIsLoading(true);
      }

      try {
        const nextUsers = await getAllUsers();
        setUsers(nextUsers);
        setSelectedUserId((current) => current || nextUsers[0]?.id || '');
      } catch (error) {
        console.error('User load failed:', error);
        toast.error('Kullanıcılar yüklenemedi');
        if (!hasLoadedUsersRef.current) {
          setUsers([]);
        }
      } finally {
        hasLoadedUsersRef.current = true;
        setIsLoading(false);
        setIsRefreshingUsers(false);
      }
    })().finally(() => {
      if (loadUsersPromiseRef.current === request) {
        loadUsersPromiseRef.current = null;
      }
    });

    loadUsersPromiseRef.current = request;
    return request;
  }, []);

  const loadHistory = useCallback(async (targetUserId: string) => {
    if (
      historyRequestRef.current?.targetUserId === targetUserId
    ) {
      return historyRequestRef.current.promise;
    }

    const request = (async () => {
      try {
        setHistoryLoading(true);
        setHistory(await getUserAccessHistory(targetUserId));
      } catch (error) {
        console.error('History load failed:', error);
        toast.error('Kullanıcı geçmişi yüklenemedi');
        setHistory(null);
      } finally {
        setHistoryLoading(false);
      }
    })().finally(() => {
      if (historyRequestRef.current?.promise === request) {
        historyRequestRef.current = null;
      }
    });

    historyRequestRef.current = { targetUserId, promise: request };
    return request;
  }, []);

  useEffect(() => {
    if (authLoading) {
      return;
    }

    if (user?.id) {
      void loadUsers();
      return;
    }

    if (!user) {
      setUsers([]);
      setHistory(null);
      setDeletingWarningId(null);
      hasLoadedUsersRef.current = false;
      setIsLoading(false);
      setIsRefreshingUsers(false);
    }
  }, [authLoading, loadUsers, user?.id]);

  const manageableUsers = useMemo(
    () => users.filter((account) => (account.role || 'user') === 'user'),
    [users],
  );

  const filteredUsers = useMemo(() => {
    const query = searchQuery.trim().toLocaleLowerCase('tr-TR');
    return manageableUsers.filter((account) => !query || account.username.toLocaleLowerCase('tr-TR').includes(query) || account.email.toLocaleLowerCase('tr-TR').includes(query));
  }, [manageableUsers, searchQuery]);

  const selectedUser = useMemo(
    () => filteredUsers.find((account) => account.id === selectedUserId) || filteredUsers[0] || null,
    [filteredUsers, selectedUserId],
  );

  useEffect(() => {
    if (!filteredUsers.length) {
      setSelectedUserId('');
      setHistory(null);
      return;
    }
    if (!selectedUserId || !filteredUsers.some((account) => account.id === selectedUserId)) {
      setSelectedUserId(filteredUsers[0].id);
    }
  }, [filteredUsers, selectedUserId]);

  useEffect(() => {
    if (authLoading || !user?.id || !selectedUser?.id) {
      return;
    }

    void loadHistory(selectedUser.id);
  }, [authLoading, loadHistory, selectedUser?.id, user?.id]);

  const stats = useMemo(() => ({
    total: manageableUsers.length,
    banned: manageableUsers.filter((account) => account.isBanned).length,
    warned: manageableUsers.filter((account) => (account.warningCount || 0) > 0).length,
    unread: manageableUsers.reduce((sum, account) => sum + (account.unreadWarningCount || 0), 0),
  }), [manageableUsers]);

  const refreshAfterAction = async (targetUserId: string) => {
    await Promise.all([
      loadUsers({ preserveVisibleState: true }),
      loadHistory(targetUserId),
    ]);
  };

  const handleWarning = async () => {
    if (!warningTarget || !warningMessage.trim()) {
      toast.error('Uyarı mesajı zorunlu');
      return;
    }
    const durationHours = warningDurationHours.trim() ? Number(warningDurationHours) : undefined;
    if (warningDurationHours.trim() && (!Number.isFinite(durationHours) || (durationHours || 0) <= 0)) {
      toast.error('Geçerli bir süre gir');
      return;
    }
    try {
      setActiveAction('warning');
      const result = await issueUserWarning({ targetUserId: warningTarget.id, title: warningTitle.trim() || 'Yönetici uyarısı', message: warningMessage.trim(), durationHours });
      await refreshAfterAction(warningTarget.id);
      setWarningTarget(null);
      setWarningTitle('Yönetici uyarısı');
      setWarningMessage('');
      setWarningDurationHours('');
      const notificationFailed = result.warningNotificationDelivered === false || result.banNotificationDelivered === false;
      if (notificationFailed) {
        toast.warning(result.autoBan
          ? 'Uyarı ve ceza kaydedildi ama kullanıcı bildirimi üretilemedi'
          : 'Uyarı kaydedildi ama kullanıcı bildirimi üretilemedi');
      } else {
        toast.success(result.autoBan ? (result.autoBan.kind === 'timed' ? 'Uyarı ve süreli ban uygulandı' : '3. uyarı sonrası kalıcı ban otomatik uygulandı') : 'Uyarı gönderildi');
      }
    } catch (error) {
      toast.error(getErrorMessage(error, 'Uyarı gönderilemedi'));
    } finally {
      setActiveAction(null);
    }
  };

  const handleBan = async () => {
    if (!banTarget || !banReason.trim()) {
      toast.error('Ban nedeni zorunlu');
      return;
    }
    const durationHours = banDurationHours.trim() ? Number(banDurationHours) : undefined;
    if (banKind === 'timed' && (!Number.isFinite(durationHours) || (durationHours || 0) <= 0)) {
      toast.error('Süreli ban için saat değeri gir');
      return;
    }
    try {
      setActiveAction('ban');
      const result = await banUserAccount({ targetUserId: banTarget.id, kind: banKind, reason: banReason.trim(), durationHours: banKind === 'timed' ? durationHours : undefined });
      await refreshAfterAction(banTarget.id);
      setBanTarget(null);
      setBanKind('timed');
      setBanReason('');
      setBanDurationHours('12');
      if (result.banNotificationDelivered === false) {
        toast.warning(`${banKindLabels[banKind]} uygulandı ama kullanıcı bildirimi üretilemedi`);
      } else {
        toast.success(`${banKindLabels[banKind]} uygulandı`);
      }
    } catch (error) {
      toast.error(getErrorMessage(error, 'Ban uygulanamadı'));
    } finally {
      setActiveAction(null);
    }
  };

  const handleUnban = async () => {
    if (!unbanTarget) return;
    try {
      setActiveAction('unban');
      await unbanUserAccount(unbanTarget.id);
      await refreshAfterAction(unbanTarget.id);
      setUnbanTarget(null);
      toast.success('Ban kaldırıldı');
    } catch (error) {
      toast.error(getErrorMessage(error, 'Ban kaldırılamadı'));
    } finally {
      setActiveAction(null);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      setActiveAction('delete');
      await deleteUser(deleteTarget.id);
      await loadUsers({ preserveVisibleState: true });
      setHistory(null);
      setDeleteTarget(null);
      toast.success('Kullanıcı silindi');
    } catch (error) {
      toast.error(getErrorMessage(error, 'Kullanıcı silinemedi'));
    } finally {
      setActiveAction(null);
    }
  };

  const handleDeleteWarning = async (warningId: string) => {
    if (!selectedUser) return;
    try {
      setDeletingWarningId(warningId);
      await deleteUserWarning({ targetUserId: selectedUser.id, warningId });
      await refreshAfterAction(selectedUser.id);
      toast.success('Uyarı silindi');
    } catch (error) {
      toast.error(getErrorMessage(error, 'Uyarı silinemedi'));
    } finally {
      setDeletingWarningId(null);
    }
  };

  if (authLoading || (isLoading && !hasLoadedUsersRef.current)) {
    return (
      <div className="space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div><Skeleton className="h-10 w-64" /><Skeleton className="mt-2 h-5 w-96" /></div>
          <Skeleton className="h-11 w-full sm:w-72" />
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">{Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-28 rounded-3xl" />)}</div>
        <div className="grid gap-6 xl:grid-cols-[380px_minmax(0,1fr)]"><Skeleton className="h-[520px] rounded-3xl" /><Skeleton className="h-[520px] rounded-3xl" /></div>
      </div>
    );
  }

  return (
    <div className="space-y-6 lg:space-y-8">
      <div className="overflow-hidden rounded-[2rem] border border-border bg-card/80 p-5 shadow-xl sm:p-6">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div className="space-y-2">
            <Badge variant="outline" className="w-fit gap-1.5 border-primary/20 bg-primary/10 text-primary"><Users className="h-3.5 w-3.5" /> Moderation Desk</Badge>
            <h1 className="text-3xl font-black tracking-tight sm:text-4xl">Kullanıcı yönetimi</h1>
            <p className="max-w-2xl text-sm leading-7 text-muted-foreground sm:text-base">Uyarı, süreli ban, kalıcı ban, hard ban ve unban akışları burada. Sağ panel warning ve ban geçmişini gösterir.</p>
          </div>
          <div className="relative w-full xl:w-80">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Kullanıcı adı veya e-posta..." className="pl-9" />
          </div>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-3xl border border-border bg-card p-5 shadow-sm"><p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">Toplam</p><p className="mt-2 text-3xl font-black">{stats.total}</p></div>
        <div className="rounded-3xl border border-border bg-card p-5 shadow-sm"><p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">Aktif Ban</p><p className="mt-2 text-3xl font-black text-destructive">{stats.banned}</p></div>
        <div className="rounded-3xl border border-border bg-card p-5 shadow-sm"><p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">Uyarı Alan</p><p className="mt-2 text-3xl font-black text-amber-300">{stats.warned}</p></div>
        <div className="rounded-3xl border border-border bg-card p-5 shadow-sm"><div className="flex items-center justify-between gap-3"><p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">Okunmamış</p>{isRefreshingUsers ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : null}</div><p className="mt-2 text-3xl font-black text-sky-300">{stats.unread}</p></div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[380px_minmax(0,1fr)]">
        <section className="rounded-3xl border border-border bg-card p-4 shadow-sm sm:p-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div><h2 className="text-lg font-semibold">Kullanıcı listesi</h2><p className="text-sm text-muted-foreground">{filteredUsers.length} kayıt</p></div>
            <Badge variant="outline">Rolü `user` olan hesaplar cezalandırılabilir</Badge>
          </div>
          <div className="space-y-3">
            {filteredUsers.map((account) => {
              const selected = selectedUser?.id === account.id;
              const presence = getPresence(account);
              return (
                <button key={account.id} type="button" onClick={() => setSelectedUserId(account.id)} className={`w-full rounded-3xl border p-4 text-left transition-colors ${selected ? 'border-primary/30 bg-primary/10' : 'border-border bg-background/60 hover:bg-secondary/60'}`}>
                  <div className="flex items-start gap-3">
                    {account.avatar ? <img src={account.avatar} alt={account.username} className="h-12 w-12 rounded-2xl object-cover" /> : <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary"><UserCircle className="h-6 w-6" /></div>}
                    <div className="min-w-0 flex-1 space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate font-semibold">{account.username}</p>
                        <Badge variant="outline" className="capitalize">{account.role || 'user'}</Badge>
                        {(account.warningCount || 0) > 0 ? <Badge className="border-amber-500/20 bg-amber-500/10 text-amber-200">{account.warningCount} uyarı</Badge> : null}
                      </div>
                      <p className="truncate text-sm text-muted-foreground">{account.email || 'E-posta alınamadı'}</p>
                      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        {presence.banned ? <Badge variant="destructive" className="gap-1"><ShieldBan className="h-3 w-3" />{presence.label}</Badge> : <Badge variant="outline">{presence.label}</Badge>}
                        {presence.detail ? <span>{presence.detail}</span> : null}
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}
            {!filteredUsers.length ? <div className="rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">Kullanıcı bulunamadı.</div> : null}
          </div>
        </section>

        <section className="rounded-3xl border border-border bg-card p-4 shadow-sm sm:p-6">
          {selectedUser ? (
            <div className="space-y-5">
              <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-2xl font-bold">{selectedUser.username}</h2>
                    <Badge variant="outline" className="capitalize">{selectedUser.role || 'user'}</Badge>
                    {selectedUser.activeBanType ? <Badge variant="destructive">{banKindLabels[selectedUser.activeBanType]}</Badge> : null}
                  </div>
                  <div className="grid gap-2 text-sm text-muted-foreground sm:grid-cols-2">
                    <p className="inline-flex items-center gap-2"><Mail className="h-4 w-4" /> {selectedUser.email || 'E-posta alınamadı'}</p>
                    <p className="inline-flex items-center gap-2"><Calendar className="h-4 w-4" /> Kayıt: {formatRelative(selectedUser.createdAt)}</p>
                    <p className="inline-flex items-center gap-2"><AlertTriangle className="h-4 w-4" /> Uyarı: {selectedUser.warningCount || 0}</p>
                    <p className="inline-flex items-center gap-2"><ShieldAlert className="h-4 w-4" /> Ban bitişi: {selectedUser.banExpiresAt ? formatTimestamp(selectedUser.banExpiresAt) : 'Yok'}</p>
                  </div>
                </div>
                {selectedUser.avatar ? <img src={selectedUser.avatar} alt={selectedUser.username} className="h-20 w-20 rounded-3xl object-cover" /> : <div className="flex h-20 w-20 items-center justify-center rounded-3xl bg-primary/10 text-primary"><UserCircle className="h-10 w-10" /></div>}
              </div>

              <div className="flex flex-col gap-3 rounded-3xl border border-border bg-background/60 p-4 sm:flex-row sm:flex-wrap">
                {selectedUser.role === 'user' ? (
                  <>
                    <Button variant="outline" onClick={() => setWarningTarget(selectedUser)}><MessageSquareWarning className="mr-2 h-4 w-4" /> Uyarı Ver</Button>
                    {!selectedUser.isBanned ? <Button variant="outline" onClick={() => setBanTarget(selectedUser)}><Gavel className="mr-2 h-4 w-4" /> Ban Uygula</Button> : <Button variant="outline" className="border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10 hover:text-emerald-300" onClick={() => setUnbanTarget(selectedUser)}><ShieldCheck className="mr-2 h-4 w-4" /> Banı Kaldır</Button>}
                    <Button variant="outline" className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={() => setDeleteTarget(selectedUser)}><Trash2 className="mr-2 h-4 w-4" /> Sil</Button>
                  </>
                ) : <p className="text-sm text-muted-foreground">Yetkili hesaplara bu ekrandan moderation işlemi uygulanmaz.</p>}
              </div>

              <div className="grid gap-5 lg:grid-cols-2">
                <div className="rounded-3xl border border-border bg-background/60 p-4">
                  <div className="flex items-center justify-between gap-3"><div><h3 className="text-lg font-semibold">Uyarı geçmişi</h3><p className="text-sm text-muted-foreground">{history?.warnings.length || 0} kayıt</p></div>{historyLoading ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : null}</div>
                  <ScrollArea className="mt-4 h-[300px] pr-3">
                    <div className="space-y-3">
                      {history?.warnings.map((warning) => (
                        <article key={warning.id} className="group relative rounded-2xl border border-border bg-card/70 p-4">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="font-semibold">{warning.title}</p>
                            <Badge className={warning.acknowledgedAt ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-200' : 'border-sky-500/20 bg-sky-500/10 text-sky-200'}>
                              {warning.acknowledgedAt ? 'Okundu' : 'Okunmadı'}
                            </Badge>
                          </div>
                          <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">{warning.message}</p>
                          <div className="mt-3 space-y-1 text-xs text-muted-foreground">
                            <p>Gönderen: {warning.issuedByName || 'Yönetim'}</p>
                            <p>Gönderim: {formatTimestamp(warning.createdAt)}</p>
                            <p>Okundu: {warning.acknowledgedAt ? formatTimestamp(warning.acknowledgedAt) : 'Henüz kullanıcı tarafından okunmadı'}</p>
                          </div>
                          <Button 
                            variant="ghost" 
                            size="icon" 
                            className="absolute right-2 top-2 h-8 w-8 text-muted-foreground opacity-0 hover:text-destructive group-hover:opacity-100"
                            onClick={() => void handleDeleteWarning(warning.id)}
                            disabled={deletingWarningId === warning.id}
                          >
                            {deletingWarningId === warning.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                          </Button>
                        </article>
                      ))}
                      {!historyLoading && !history?.warnings.length ? <div className="rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">Kayıtlı uyarı yok.</div> : null}
                    </div>
                  </ScrollArea>
                </div>

                <div className="rounded-3xl border border-border bg-background/60 p-4">
                  <div className="flex items-center justify-between gap-3"><div><h3 className="text-lg font-semibold">Ban geçmişi</h3><p className="text-sm text-muted-foreground">{history?.bans.length || 0} kayıt</p></div>{historyLoading ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : null}</div>
                  <ScrollArea className="mt-4 h-[300px] pr-3">
                    <div className="space-y-3">
                      {history?.bans.map((ban) => (
                        <article key={ban.id} className="rounded-2xl border border-border bg-card/70 p-4">
                          <div className="flex flex-wrap items-center gap-2"><p className="font-semibold">{banKindLabels[ban.kind]}</p><Badge variant={ban.revokedAt ? 'outline' : 'destructive'}>{ban.revokedAt ? 'Kaldırıldı' : 'Kayıtlı'}</Badge></div>
                          <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">{ban.reason}</p>
                          <div className="mt-3 space-y-1 text-xs text-muted-foreground"><p>Başlangıç: {formatTimestamp(ban.createdAt)}</p><p>Bitiş: {formatTimestamp(ban.expiresAt)}</p><p>Veren: {ban.issuedByName || 'Yönetim'}</p><p>Kaldıran: {ban.revokedByName || 'Yok'}</p></div>
                        </article>
                      ))}
                      {!historyLoading && !history?.bans.length ? <div className="rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">Kayıtlı ban yok.</div> : null}
                    </div>
                  </ScrollArea>
                </div>
              </div>
            </div>
          ) : <div className="flex min-h-[520px] flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-background/40 p-8 text-center"><Users className="h-12 w-12 text-muted-foreground/40" /><h3 className="mt-4 text-xl font-semibold">Kullanıcı seçilmedi</h3><p className="mt-2 max-w-md text-sm text-muted-foreground">Soldan bir kullanıcı seç. Warning ve ban geçmişi burada açılır.</p></div>}
        </section>
      </div>

      <Dialog open={!!warningTarget} onOpenChange={(open) => !open && activeAction !== 'warning' && setWarningTarget(null)}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader><DialogTitle>Uyarı Gönder</DialogTitle><DialogDescription>3. uyarı otomatik kalıcı ban anlamına gelir. İstersen aynı anda süreli ban ekleyebilirsin.</DialogDescription></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2"><Label>Başlık</Label><Input value={warningTitle} onChange={(event) => setWarningTitle(event.target.value)} /></div>
            <div className="space-y-2"><Label>Uyarı Mesajı</Label><Textarea value={warningMessage} onChange={(event) => setWarningMessage(event.target.value)} className="min-h-32 resize-none" /></div>
            <div className="space-y-2"><Label>İsteğe bağlı süreli ban (saat)</Label><Input value={warningDurationHours} onChange={(event) => setWarningDurationHours(event.target.value)} inputMode="numeric" placeholder="Örn: 12" /></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setWarningTarget(null)} disabled={activeAction === 'warning'}>İptal</Button><Button onClick={() => void handleWarning()} disabled={activeAction === 'warning'}>{activeAction === 'warning' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <MessageSquareWarning className="mr-2 h-4 w-4" />}Uyarıyı Gönder</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!banTarget} onOpenChange={(open) => !open && activeAction !== 'ban' && setBanTarget(null)}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader><DialogTitle>Ban Uygula</DialogTitle><DialogDescription>Süreli, kalıcı veya hard ban seçebilirsin. Hard ban cihaz ve IP eşleşmelerini de bloklar.</DialogDescription></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2"><Label>Ban Türü</Label><Select value={banKind} onValueChange={(value) => setBanKind(value as UserBanKind)}><SelectTrigger><SelectValue placeholder="Ban türü seç" /></SelectTrigger><SelectContent><SelectItem value="timed">Süreli Ban</SelectItem><SelectItem value="permanent">Kalıcı Ban</SelectItem><SelectItem value="hard">Hard Ban</SelectItem></SelectContent></Select></div>
            {banKind === 'timed' ? <div className="space-y-2"><Label>Süre (saat)</Label><Input value={banDurationHours} onChange={(event) => setBanDurationHours(event.target.value)} inputMode="numeric" placeholder="Örn: 12" /></div> : null}
            <div className="space-y-2"><Label>Gerekçe</Label><Textarea value={banReason} onChange={(event) => setBanReason(event.target.value)} className="min-h-28 resize-none" /></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setBanTarget(null)} disabled={activeAction === 'ban'}>İptal</Button><Button onClick={() => void handleBan()} disabled={activeAction === 'ban'}>{activeAction === 'ban' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Gavel className="mr-2 h-4 w-4" />}Banı Uygula</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!unbanTarget} onOpenChange={() => setUnbanTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Banı Kaldır</AlertDialogTitle><AlertDialogDescription>Tüm aktif kullanıcı banları ve varsa hard banın eklediği IP/cihaz blokları kaldırılır.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel disabled={activeAction === 'unban'}>İptal</AlertDialogCancel><AlertDialogAction onClick={() => void handleUnban()}>{activeAction === 'unban' ? 'İşleniyor...' : 'Banı Kaldır'}</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Kullanıcıyı Sil</AlertDialogTitle><AlertDialogDescription>Bu işlem geri alınamaz. Kullanıcının hesabı ve ilişkili verileri silinir.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel disabled={activeAction === 'delete'}>İptal</AlertDialogCancel><AlertDialogAction onClick={() => void handleDelete()} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">{activeAction === 'delete' ? 'Siliniyor...' : 'Sil'}</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 p-4 text-sm text-amber-100">
        <div className="flex items-start gap-3"><ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" /><div className="space-y-1"><p>Uyarı alan kullanıcı 5 saniye bekleyip “Okudum, Anlıyorum” demeden siteyi kullanamaz.</p><p>3. warning otomatik kalıcı ban üretir. Hard ban cihaz ve IP eşleşmelerini de bloklar.</p></div></div>
      </div>
    </div>
  );
};

export default AdminUserManagement;
