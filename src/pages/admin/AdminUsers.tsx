import React, { useEffect, useMemo, useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { tr } from 'date-fns/locale';
import {
    Plus,
    Shield,
    ShieldCheck,
    ShieldAlert,
    Trash2,
    Users,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from '@/components/ui/dialog';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
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
import { getAdminUsers, addAdminUser, deleteAdminUser, getAllUsers, AdminUser } from '@/lib/database';
import { User } from '@/lib/types';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

const PRIMARY_ADMIN_EMAIL = 'caganherdil@gmail.com';

const AdminUsers: React.FC = () => {
    const { user } = useAuth();
    const [admins, setAdmins] = useState<AdminUser[]>([]);
    const [allUsers, setAllUsers] = useState<User[]>([]);
    const [showAddDialog, setShowAddDialog] = useState(false);
    const [deleteId, setDeleteId] = useState<string | null>(null);
    const [selectedUserId, setSelectedUserId] = useState('');

    useEffect(() => {
        loadData();
    }, []);

    const loadData = async () => {
        const [staffData, usersData] = await Promise.all([
            getAdminUsers(),
            getAllUsers(),
        ]);

        setAdmins(staffData);
        setAllUsers(usersData);
    };

    const eligibleUsers = useMemo(
        () => allUsers.filter((member) => (member.role || 'user') === 'user'),
        [allUsers]
    );

    const handleAddModerator = async () => {
        if (!selectedUserId) {
            toast.error('Bir kullanıcı seçin');
            return;
        }

        try {
            await addAdminUser({ userId: selectedUserId, role: 'moderator' });
            await loadData();
            setShowAddDialog(false);
            setSelectedUserId('');
            toast.success('Moderatör eklendi');
        } catch (error: any) {
            if (error?.message === 'ONLY_MODERATOR_ALLOWED') {
                toast.error('Bu panelden sadece moderatör eklenebilir');
                return;
            }

            toast.error('Moderatör eklenemedi');
        }
    };

    const handleRemoveModerator = async () => {
        if (!deleteId) {
            return;
        }

        const selectedStaff = admins.find((staff) => staff.id === deleteId);
        if (selectedStaff?.role === 'admin' || selectedStaff?.email?.toLowerCase() === PRIMARY_ADMIN_EMAIL) {
            toast.error('Ana admin kaldırılamaz');
            return;
        }

        try {
            await deleteAdminUser(deleteId);
            await loadData();
            toast.success('Moderatör yetkisi kaldırıldı');
            setDeleteId(null);
        } catch (error) {
            toast.error('Yetki kaldırılamadı');
        }
    };

    if (user?.role !== 'admin') {
        return (
            <div className="space-y-6">
                <div>
                    <h1 className="text-3xl font-bold">Adminler</h1>
                    <p className="text-muted-foreground">Bu alan sadece ana admin hesabına açıktır.</p>
                </div>

                <div className="rounded-2xl border border-border bg-card/50 p-10 text-center">
                    <ShieldAlert className="mx-auto h-12 w-12 text-destructive" />
                    <h2 className="mt-4 text-xl font-semibold">Erişim Engellendi</h2>
                    <p className="mt-2 text-muted-foreground">
                        Moderatörler staff yönetimi ekranını kullanamaz.
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-bold">Adminler</h1>
                    <p className="text-muted-foreground">
                        Tek admin hesabı kilitli. Buradan sadece mevcut kullanıcıları moderatör yapabilir veya moderatör yetkisini kaldırabilirsiniz.
                    </p>
                </div>
                <Button onClick={() => setShowAddDialog(true)}>
                    <Plus className="mr-2 h-4 w-4" />
                    Yeni Moderatör
                </Button>
            </div>

            <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 p-4 text-sm text-amber-100">
                <p className="font-medium">Korunan ana admin</p>
                <p className="mt-1 text-amber-100/80">
                    {PRIMARY_ADMIN_EMAIL} hesabı dışında hiçbir kullanıcı admin yapılamaz ve bu hesap kaldırılamaz.
                </p>
            </div>

            <div className="rounded-xl border border-border bg-card">
                <div className="overflow-x-auto">
                    <table className="w-full">
                        <thead>
                            <tr className="border-b border-border">
                                <th className="px-4 py-3 text-left text-sm font-medium text-muted-foreground">Kullanıcı</th>
                                <th className="px-4 py-3 text-left text-sm font-medium text-muted-foreground">E-posta</th>
                                <th className="px-4 py-3 text-left text-sm font-medium text-muted-foreground">Rol</th>
                                <th className="px-4 py-3 text-left text-sm font-medium text-muted-foreground">Kayıt Tarihi</th>
                                <th className="px-4 py-3 text-right text-sm font-medium text-muted-foreground">İşlemler</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                            {admins.map((admin) => {
                                const isPrimaryAdmin = admin.role === 'admin' || admin.email?.toLowerCase() === PRIMARY_ADMIN_EMAIL;

                                return (
                                    <tr key={admin.id} className="hover:bg-secondary/50">
                                        <td className="px-4 py-3">
                                            <div className="flex items-center gap-3">
                                                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
                                                    {admin.username ? admin.username[0].toUpperCase() : 'A'}
                                                </div>
                                                <div>
                                                    <p className="font-medium">{admin.username}</p>
                                                    {user?.id === admin.id && (
                                                        <Badge variant="secondary" className="text-xs">Siz</Badge>
                                                    )}
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-4 py-3 text-muted-foreground">{admin.email || 'E-posta senkron bekliyor'}</td>
                                        <td className="px-4 py-3">
                                            {isPrimaryAdmin ? (
                                                <Badge variant="outline" className="border-purple-500/20 bg-purple-500/10 text-purple-500">
                                                    <ShieldCheck className="mr-1 h-3 w-3" />
                                                    Admin
                                                </Badge>
                                            ) : (
                                                <Badge variant="secondary">
                                                    <Shield className="mr-1 h-3 w-3" />
                                                    Moderatör
                                                </Badge>
                                            )}
                                        </td>
                                        <td className="px-4 py-3 text-muted-foreground">
                                            {admin.createdAt
                                                ? formatDistanceToNow(new Date(admin.createdAt), { addSuffix: true, locale: tr })
                                                : 'Bilinmiyor'}
                                        </td>
                                        <td className="px-4 py-3 text-right">
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="text-destructive hover:text-destructive"
                                                onClick={() => setDeleteId(admin.id)}
                                                disabled={isPrimaryAdmin}
                                                title={isPrimaryAdmin ? 'Ana admin kaldırılamaz' : 'Moderatör yetkisini kaldır'}
                                            >
                                                <Trash2 className="h-4 w-4" />
                                            </Button>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>

                {admins.length === 0 && (
                    <div className="flex flex-col items-center justify-center py-12">
                        <Users className="h-12 w-12 text-muted-foreground/50" />
                        <p className="mt-2 text-muted-foreground">Yetkili kullanıcı bulunamadı</p>
                    </div>
                )}
            </div>

            <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Yeni Moderatör Ekle</DialogTitle>
                    </DialogHeader>

                    <div className="space-y-4">
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Kullanıcı</label>
                            <Select value={selectedUserId} onValueChange={setSelectedUserId}>
                                <SelectTrigger>
                                    <SelectValue placeholder="Mevcut bir kullanıcı seçin" />
                                </SelectTrigger>
                                <SelectContent>
                                    {eligibleUsers.map((member) => (
                                        <SelectItem key={member.id} value={member.id}>
                                            {member.email ? `${member.username} (${member.email})` : member.username}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="rounded-xl border border-border bg-secondary/30 p-3 text-sm text-muted-foreground">
                            Bu ekran yeni admin oluşturmaz. Sadece mevcut kullanıcıya moderatör rolü verir.
                        </div>
                    </div>

                    <DialogFooter>
                        <Button variant="outline" onClick={() => setShowAddDialog(false)}>
                            İptal
                        </Button>
                        <Button onClick={handleAddModerator} disabled={!selectedUserId}>
                            Moderatör Yap
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Moderatör Yetkisini Kaldır</AlertDialogTitle>
                        <AlertDialogDescription>
                            Bu kullanıcının moderatör yetkisini kaldırmak istediğinizden emin misiniz? Kullanıcının hesabı silinmez, sadece rolü tekrar normal kullanıcı olur.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>İptal</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={handleRemoveModerator}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                            Yetkiyi Kaldır
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
};

export default AdminUsers;
