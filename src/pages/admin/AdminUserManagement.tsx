import React, { useState, useEffect } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { tr } from 'date-fns/locale';
import {
    Trash2,
    Users,
    UserCircle,
    Mail,
    Calendar,
    Search,
    ShieldBan,
    ShieldCheck
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { getAllUsers, deleteUser, banUserAccess, unbanUserAccess } from '@/lib/database';
import { User } from '@/lib/types';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

const ACTIVE_USER_WINDOW_MS = 15 * 60 * 1000;
type BanMode = 'user' | 'hard';

const getErrorMessage = (error: unknown, fallback: string) =>
    error instanceof Error ? error.message : fallback;

const getUserPresence = (user: User) => {
    if (user.isBanned) {
        return {
            tone: 'banned' as const,
            label: 'Banlı',
            detail: user.banReason || undefined,
        };
    }

    if (!user.lastSeenAt) {
        return {
            tone: 'unknown' as const,
            label: 'Bilinmiyor',
            detail: undefined,
        };
    }

    const lastSeenAt = new Date(user.lastSeenAt).getTime();
    if (!Number.isFinite(lastSeenAt)) {
        return {
            tone: 'unknown' as const,
            label: 'Bilinmiyor',
            detail: undefined,
        };
    }

    const isActive = Date.now() - lastSeenAt <= ACTIVE_USER_WINDOW_MS;

    return {
        tone: isActive ? 'active' as const : 'inactive' as const,
        label: isActive ? 'Aktif' : 'Pasif',
        detail: formatDistanceToNow(new Date(user.lastSeenAt), { addSuffix: true, locale: tr }),
    };
};

const AdminUserManagement: React.FC = () => {
    const { user, isLoading: authLoading } = useAuth();
    const [users, setUsers] = useState<User[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');
    const [deleteId, setDeleteId] = useState<string | null>(null);
    const [banTarget, setBanTarget] = useState<User | null>(null);
    const [unbanTarget, setUnbanTarget] = useState<User | null>(null);
    const [banSubmittingMode, setBanSubmittingMode] = useState<BanMode | null>(null);

    useEffect(() => {
        if (authLoading) {
            return;
        }

        let isCancelled = false;

        const loadUsers = async () => {
            if (!user) {
                setUsers([]);
                setIsLoading(false);
                return;
            }

            try {
                setIsLoading(true);
                const data = await getAllUsers();
                if (isCancelled) return;

                setUsers(data);
            } catch (error) {
                if (isCancelled) return;

                console.error('Admin user management load error:', error);
                toast.error('Kullanıcılar yüklenemedi');
                setUsers([]);
            } finally {
                if (!isCancelled) {
                    setIsLoading(false);
                }
            }
        };

        void loadUsers();

        return () => {
            isCancelled = true;
        };
    }, [authLoading, user]);

    const loadUsers = async () => {
        try {
            setIsLoading(true);
            const data = await getAllUsers();
            setUsers(data);
        } catch (error) {
            console.error('Admin user management refresh error:', error);
            toast.error('Kullanıcılar yenilenemedi');
        } finally {
            setIsLoading(false);
        }
    };

    const handleDeleteUser = async () => {
        if (deleteId) {
            try {
                await deleteUser(deleteId);
                await loadUsers();
                toast.success('Kullanıcı başarıyla silindi');
            } catch (error) {
                toast.error('Kullanıcı silinemedi');
            }
            setDeleteId(null);
        }
    };

    const handleBanUser = async (mode: BanMode) => {
        if (!banTarget) {
            return;
        }

        try {
            setBanSubmittingMode(mode);
            const result = await banUserAccess(banTarget.id, { mode });
            await loadUsers();
            setBanTarget(null);
            toast.success(
                mode === 'hard'
                    ? `Hard ban uygulandı${result.deviceBanCount || result.ipBanCount ? ` (${result.deviceBanCount} cihaz, ${result.ipBanCount} IP)` : ''}`
                    : 'Kullanıcı hesabı banlandı'
            );
        } catch (error: unknown) {
            toast.error(getErrorMessage(error, 'Kullanıcı banlanamadı'));
        } finally {
            setBanSubmittingMode(null);
        }
    };

    const handleUnbanUser = async () => {
        if (!unbanTarget) {
            return;
        }

        try {
            await unbanUserAccess(unbanTarget.id);
            await loadUsers();
            toast.success('Ban kaldırıldı');
        } catch (error: unknown) {
            toast.error(getErrorMessage(error, 'Ban kaldırılamadı'));
        } finally {
            setUnbanTarget(null);
        }
    };

    const filteredUsers = users.filter(user => {
        const query = searchQuery.toLocaleLowerCase('tr-TR');
        return user.username.toLocaleLowerCase('tr-TR').includes(query) ||
            user.email.toLocaleLowerCase('tr-TR').includes(query);
    });

    if (authLoading || isLoading) {
        return (
            <div className="space-y-6">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                        <Skeleton className="h-10 w-64" />
                        <Skeleton className="mt-2 h-5 w-96" />
                    </div>
                    <Skeleton className="h-11 w-full sm:w-72" />
                </div>

                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                    <Skeleton className="h-28 rounded-xl" />
                </div>

                <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
                    <div className="space-y-4 p-6">
                        {[1, 2, 3, 4].map((row) => (
                            <div key={row} className="grid grid-cols-[2fr_2fr_1fr_1fr_1fr] gap-4">
                                {Array.from({ length: 5 }).map((_, index) => (
                                    <Skeleton key={index} className="h-10 w-full" />
                                ))}
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h1 className="text-3xl font-bold">Kullanıcı Yönetimi</h1>
                    <p className="text-muted-foreground">Tüm kayıtlı kullanıcıları listeleyin ve yönetin</p>
                </div>
                <div className="relative w-full sm:w-72">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                        placeholder="Kullanıcı adı veya e-posta..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="pl-9"
                    />
                </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
                    <div className="flex items-center gap-4">
                        <div className="rounded-full bg-primary/10 p-3 text-primary">
                            <Users className="h-6 w-6" />
                        </div>
                        <div>
                            <p className="text-sm font-medium text-muted-foreground">Toplam Kullanıcı</p>
                            <p className="text-2xl font-bold">{users.length}</p>
                        </div>
                    </div>
                </div>
                {/* Diğer istatistikler buraya eklenebilir */}
            </div>

            <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full">
                        <thead>
                            <tr className="bg-muted/50 border-b border-border">
                                <th className="px-6 py-4 text-left text-sm font-semibold text-foreground">Kullanıcı</th>
                                <th className="px-6 py-4 text-left text-sm font-semibold text-foreground">E-posta</th>
                                <th className="px-6 py-4 text-left text-sm font-semibold text-foreground">Durum</th>
                                <th className="px-6 py-4 text-left text-sm font-semibold text-foreground">Kayıt Tarihi</th>
                                <th className="px-6 py-4 text-right text-sm font-semibold text-foreground">İşlemler</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                            {filteredUsers.map((user) => (
                                <tr key={user.id} className={`transition-colors ${user.isBanned ? 'bg-destructive/5 hover:bg-destructive/10' : 'hover:bg-secondary/30'}`}>
                                    <td className="px-6 py-4">
                                        <div className="flex items-center gap-3">
                                            {user.avatar ? (
                                                <img src={user.avatar} alt={user.username} className="h-10 w-10 rounded-full object-cover" />
                                            ) : (
                                                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
                                                    <UserCircle className="h-6 w-6" />
                                                </div>
                                            )}
                                            <div>
                                                <p className="font-semibold">{user.username}</p>
                                                <p className="text-xs text-muted-foreground capitalize">{user.role || 'User'}</p>
                                            </div>
                                        </div>
                                    </td>
                                    <td className="px-6 py-4">
                                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                            <Mail className="h-4 w-4" />
                                            {user.email || 'E-posta alınamadı'}
                                        </div>
                                    </td>
                                    <td className="px-6 py-4">
                                        {(() => {
                                            const presence = getUserPresence(user);

                                            if (presence.tone === 'banned') {
                                                return (
                                                    <div className="space-y-1">
                                                        <Badge variant="destructive" className="gap-1">
                                                            <ShieldBan className="h-3 w-3" />
                                                            {presence.label}
                                                        </Badge>
                                                        {presence.detail && (
                                                            <p className="max-w-48 truncate text-xs text-muted-foreground">{presence.detail}</p>
                                                        )}
                                                    </div>
                                                );
                                            }

                                            if (presence.tone === 'active') {
                                                return (
                                                    <div className="space-y-1">
                                                        <Badge className="gap-1 border border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/10">
                                                            <ShieldCheck className="h-3 w-3" />
                                                            {presence.label}
                                                        </Badge>
                                                        {presence.detail && (
                                                            <p className="text-xs text-muted-foreground">Son görülme {presence.detail}</p>
                                                        )}
                                                    </div>
                                                );
                                            }

                                            if (presence.tone === 'inactive') {
                                                return (
                                                    <div className="space-y-1">
                                                        <Badge variant="secondary" className="gap-1">
                                                            <ShieldCheck className="h-3 w-3" />
                                                            {presence.label}
                                                        </Badge>
                                                        {presence.detail && (
                                                            <p className="text-xs text-muted-foreground">Son görülme {presence.detail}</p>
                                                        )}
                                                    </div>
                                                );
                                            }

                                            return (
                                                <Badge variant="outline" className="gap-1">
                                                    <ShieldCheck className="h-3 w-3" />
                                                    {presence.label}
                                                </Badge>
                                            );
                                        })()}
                                    </td>
                                    <td className="px-6 py-4">
                                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                            <Calendar className="h-4 w-4" />
                                            {user.createdAt ? formatDistanceToNow(new Date(user.createdAt), { addSuffix: true, locale: tr }) : 'Bilinmiyor'}
                                        </div>
                                    </td>
                                    <td className="px-6 py-4 text-right">
                                        <div className="flex items-center justify-end gap-2">
                                            {user.role === 'user' && (
                                                user.isBanned ? (
                                                    <Button
                                                        variant="outline"
                                                        size="sm"
                                                        className="border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10 hover:text-emerald-300"
                                                        onClick={() => setUnbanTarget(user)}
                                                    >
                                                        Banı Kaldır
                                                    </Button>
                                                ) : (
                                                    <Button
                                                        variant="outline"
                                                        size="sm"
                                                        className="border-amber-500/40 text-amber-300 hover:bg-amber-500/10 hover:text-amber-200"
                                                        onClick={() => setBanTarget(user)}
                                                    >
                                                        Banla
                                                    </Button>
                                                )
                                            )}
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                                                onClick={() => setDeleteId(user.id)}
                                            >
                                                <Trash2 className="h-4 w-4" />
                                            </Button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
                {filteredUsers.length === 0 && (
                    <div className="flex flex-col items-center justify-center py-16">
                        <Users className="h-16 w-16 text-muted-foreground/20" />
                        <p className="mt-4 text-lg font-medium text-muted-foreground">
                            {searchQuery ? 'Aramanızla eşleşen kullanıcı bulunamadı' : 'Henüz hiç kullanıcı yok'}
                        </p>
                    </div>
                )}
            </div>

            <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Kullanıcıyı Sil</AlertDialogTitle>
                        <AlertDialogDescription>
                            Bu kullanıcıyı silmek istediğinizden emin misiniz? Bu işlem geri alınamaz ve kullanıcının tüm verileri silinecektir.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>İptal</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={handleDeleteUser}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                            Sil
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            <AlertDialog
                open={!!banTarget}
                onOpenChange={(open) => {
                    if (!open && banSubmittingMode === null) {
                        setBanTarget(null);
                    }
                }}
            >
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Kullanıcıyı Banla</AlertDialogTitle>
                        <AlertDialogDescription>
                            <div className="space-y-3">
                                <p>
                                    <span className="font-medium text-foreground">Sadece kullanıcı</span> seçeneği yalnızca hesabı banlar.
                                </p>
                                <p>
                                    <span className="font-medium text-foreground">Hard ban</span> seçeneği ise hesapla birlikte kayıtlı IP ve cihaz parmak izlerini de engeller.
                                </p>
                            </div>
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter className="gap-2">
                        <AlertDialogCancel disabled={banSubmittingMode !== null}>İptal</AlertDialogCancel>
                        <Button
                            variant="outline"
                            disabled={banSubmittingMode !== null}
                            onClick={() => void handleBanUser('user')}
                        >
                            {banSubmittingMode === 'user' ? 'Uygulanıyor...' : 'Sadece Kullanıcı'}
                        </Button>
                        <Button
                            disabled={banSubmittingMode !== null}
                            onClick={() => void handleBanUser('hard')}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                            {banSubmittingMode === 'hard' ? 'Uygulanıyor...' : 'Hard Ban'}
                        </Button>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            <AlertDialog open={!!unbanTarget} onOpenChange={() => setUnbanTarget(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Banı Kaldır</AlertDialogTitle>
                        <AlertDialogDescription>
                            Bu kullanıcının hesap, IP ve cihaz ban kayıtları kaldırılacak.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>İptal</AlertDialogCancel>
                        <AlertDialogAction onClick={handleUnbanUser}>
                            Banı Kaldır
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
};

export default AdminUserManagement;
