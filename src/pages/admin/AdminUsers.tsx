import React, { useState, useEffect } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { tr } from 'date-fns/locale';
import {
    Plus,
    Trash2,
    Shield,
    ShieldCheck,
    Users,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
import { getAdminUsers, addAdminUser, deleteAdminUser, AdminUser } from '@/lib/database';
import { getAdminSession } from '@/lib/storage';
import { toast } from 'sonner';

const AdminUsers: React.FC = () => {
    const [admins, setAdmins] = useState<AdminUser[]>([]);
    const [showAddDialog, setShowAddDialog] = useState(false);
    const [deleteId, setDeleteId] = useState<string | null>(null);
    const [newAdmin, setNewAdmin] = useState({
        username: '',
        email: '',
        password: '',
        role: 'moderator' as 'admin' | 'moderator',
    });

    const currentSession = getAdminSession();

    useEffect(() => {
        loadAdmins();
    }, []);

    const loadAdmins = () => {
        setAdmins(getAdminUsers());
    };

    const handleAddAdmin = () => {
        if (!newAdmin.username.trim() || !newAdmin.email.trim() || !newAdmin.password.trim()) {
            toast.error('Tüm alanları doldurun');
            return;
        }

        if (newAdmin.password.length < 6) {
            toast.error('Şifre en az 6 karakter olmalı');
            return;
        }

        addAdminUser(newAdmin);
        loadAdmins();
        setShowAddDialog(false);
        setNewAdmin({ username: '', email: '', password: '', role: 'moderator' });
        toast.success('Admin eklendi');
    };

    const handleDeleteAdmin = () => {
        if (deleteId) {
            if (admins.length <= 1) {
                toast.error('Son admin silinemez');
                return;
            }

            deleteAdminUser(deleteId);
            loadAdmins();
            toast.success('Admin silindi');
            setDeleteId(null);
        }
    };

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold">Adminler</h1>
                    <p className="text-muted-foreground">Admin ve moderatörleri yönetin</p>
                </div>
                <Button onClick={() => setShowAddDialog(true)}>
                    <Plus className="mr-2 h-4 w-4" />
                    Yeni Admin
                </Button>
            </div>

            {/* Admins List */}
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
                            {admins.map((admin) => (
                                <tr key={admin.id} className="hover:bg-secondary/50">
                                    <td className="px-4 py-3">
                                        <div className="flex items-center gap-3">
                                            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
                                                {admin.username[0].toUpperCase()}
                                            </div>
                                            <div>
                                                <p className="font-medium">{admin.username}</p>
                                                {currentSession?.adminId === admin.id && (
                                                    <Badge variant="secondary" className="text-xs">Siz</Badge>
                                                )}
                                            </div>
                                        </div>
                                    </td>
                                    <td className="px-4 py-3 text-muted-foreground">{admin.email}</td>
                                    <td className="px-4 py-3">
                                        {admin.role === 'admin' ? (
                                            <Badge className="bg-purple-500/20 text-purple-500">
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
                                        {formatDistanceToNow(new Date(admin.createdAt), { addSuffix: true, locale: tr })}
                                    </td>
                                    <td className="px-4 py-3 text-right">
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="text-destructive hover:text-destructive"
                                            onClick={() => setDeleteId(admin.id)}
                                            disabled={currentSession?.adminId === admin.id || admins.length <= 1}
                                        >
                                            <Trash2 className="h-4 w-4" />
                                        </Button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
                {admins.length === 0 && (
                    <div className="flex flex-col items-center justify-center py-12">
                        <Users className="h-12 w-12 text-muted-foreground/50" />
                        <p className="mt-2 text-muted-foreground">Admin bulunamadı</p>
                    </div>
                )}
            </div>

            {/* Add Admin Dialog */}
            <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Yeni Admin Ekle</DialogTitle>
                    </DialogHeader>

                    <div className="space-y-4">
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Kullanıcı Adı</label>
                            <Input
                                value={newAdmin.username}
                                onChange={(e) => setNewAdmin(prev => ({ ...prev, username: e.target.value }))}
                                placeholder="kullaniciadi"
                            />
                        </div>

                        <div className="space-y-2">
                            <label className="text-sm font-medium">E-posta</label>
                            <Input
                                type="email"
                                value={newAdmin.email}
                                onChange={(e) => setNewAdmin(prev => ({ ...prev, email: e.target.value }))}
                                placeholder="admin@example.com"
                            />
                        </div>

                        <div className="space-y-2">
                            <label className="text-sm font-medium">Şifre</label>
                            <Input
                                type="password"
                                value={newAdmin.password}
                                onChange={(e) => setNewAdmin(prev => ({ ...prev, password: e.target.value }))}
                                placeholder="••••••••"
                            />
                        </div>

                        <div className="space-y-2">
                            <label className="text-sm font-medium">Rol</label>
                            <Select
                                value={newAdmin.role}
                                onValueChange={(value: 'admin' | 'moderator') => setNewAdmin(prev => ({ ...prev, role: value }))}
                            >
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="admin">Admin</SelectItem>
                                    <SelectItem value="moderator">Moderatör</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    </div>

                    <DialogFooter>
                        <Button variant="outline" onClick={() => setShowAddDialog(false)}>
                            İptal
                        </Button>
                        <Button onClick={handleAddAdmin}>
                            Ekle
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Delete Confirmation Dialog */}
            <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Admin Sil</AlertDialogTitle>
                        <AlertDialogDescription>
                            Bu admini silmek istediğinizden emin misiniz? Bu işlem geri alınamaz.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>İptal</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={handleDeleteAdmin}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                            Sil
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
};

export default AdminUsers;
