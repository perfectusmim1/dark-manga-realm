import React, { useEffect, useState } from 'react';
import Header from '@/components/layout/Header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useAuth } from '@/contexts/AuthContext';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { toast } from 'sonner';
import {
    User,
    Lock,
    Mail,
    Camera,
    Save,
    ShieldCheck,
    Bell,
    Eye,
    EyeOff,
    ShieldAlert,
    Loader2,
} from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { getBlockedUsers, unblockUser } from '@/lib/profile';

const Settings: React.FC = () => {
    const { user, updateProfile, updatePassword, updatePreferences, toggle2FA } = useAuth();

    // Profile state
    const [username, setUsername] = useState(user?.username || '');
    const [avatar, setAvatar] = useState(user?.avatar || '');
    const [isUpdatingProfile, setIsUpdatingProfile] = useState(false);

    // Password state
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [isUpdatingPassword, setIsUpdatingPassword] = useState(false);

    // Notification state
    const [prefs, setPrefs] = useState<any>(user?.preferences || {
        notifications: {
            new_chapter: true,
            replies: true,
            likes: true
        },
        privacy: {
            visibility: 'public'
        }
    });
    const [isUpdatingPrefs, setIsUpdatingPrefs] = useState(false);
    const [blockedUsers, setBlockedUsers] = useState<any[]>([]);
    const [isBlockedUsersLoading, setIsBlockedUsersLoading] = useState(true);
    const [unblockingUserId, setUnblockingUserId] = useState<string | null>(null);

    useEffect(() => {
        if (!user?.id) {
            setBlockedUsers([]);
            setIsBlockedUsersLoading(false);
            return;
        }

        setIsBlockedUsersLoading(true);
        getBlockedUsers(user.id).then(({ users }) => {
            setBlockedUsers(users || []);
            setIsBlockedUsersLoading(false);
        });
    }, [user?.id]);

    const handleUpdateProfile = async () => {
        if (!username.trim()) {
            toast.error('Kullanıcı adı boş olamaz');
            return;
        }

        try {
            setIsUpdatingProfile(true);
            const { success, error } = await updateProfile({ username, avatar });
            if (success) {
                toast.success('Profil güncellendi');
            } else {
                toast.error(error || 'Profil güncellenemedi');
            }
        } catch (err) {
            toast.error('İşlem başarısız oldu');
        } finally {
            setIsUpdatingProfile(false);
        }
    };

    const handleUpdatePassword = async () => {
        if (newPassword.length < 6) {
            toast.error('Şifre en az 6 karakter olmalıdır');
            return;
        }
        if (newPassword !== confirmPassword) {
            toast.error('Şifreler uyuşmuyor');
            return;
        }

        try {
            setIsUpdatingPassword(true);
            const { success, error } = await updatePassword(newPassword);
            if (success) {
                toast.success('Şifre başarıyla güncellendi');
                setNewPassword('');
                setConfirmPassword('');
            } else {
                toast.error(error || 'Şifre güncellenemedi');
            }
        } catch (err) {
            toast.error('İşlem başarısız oldu');
        } finally {
            setIsUpdatingPassword(false);
        }
    };

    const handleUpdatePreferences = async (newPrefs: typeof prefs) => {
        try {
            setIsUpdatingPrefs(true);
            const { success, error } = await updatePreferences(newPrefs);
            if (success) {
                setPrefs(newPrefs);
                toast.success('Bildirim tercihleri güncellendi');
            } else {
                toast.error(error || 'Güncellenemedi');
            }
        } catch (err) {
            toast.error('Bir hata oluştu');
        } finally {
            setIsUpdatingPrefs(false);
        }
    };

    const handleUnblockUser = async (blockedId: string) => {
        if (!user?.id) {
            return;
        }

        try {
            setUnblockingUserId(blockedId);
            const { error } = await unblockUser(user.id, blockedId);

            if (error) {
                toast.error('Engel kaldirilemedi');
                return;
            }

            setBlockedUsers((prev) => prev.filter((blockedUser) => blockedUser.id !== blockedId));
            toast.success('Engel kaldirildi');
        } catch {
            toast.error('Islem basarisiz oldu');
        } finally {
            setUnblockingUserId(null);
        }
    };

    if (!user) {
        return (
            <div className="min-h-screen bg-background">
                <Header />
                <main className="container flex min-h-[60vh] items-center justify-center pt-20">
                    <p>Ayarları görmek için giriş yapmalısınız.</p>
                </main>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-background">
            <Header />

            <main className="container max-w-4xl py-24">
                <div className="mb-8">
                    <h1 className="text-3xl font-bold">Ayarlar</h1>
                    <p className="text-muted-foreground">Profilinizi ve güvenlik tercihlerinizi yönetin</p>
                </div>

                <Tabs defaultValue="profile" className="space-y-6">
                    <TabsList className="bg-secondary/50 p-1">
                        <TabsTrigger value="profile" className="gap-2">
                            <User className="h-4 w-4" />
                            Profil
                        </TabsTrigger>
                        <TabsTrigger value="security" className="gap-2">
                            <ShieldCheck className="h-4 w-4" />
                            Güvenlik
                        </TabsTrigger>
                        <TabsTrigger value="notifications" className="gap-2">
                            <Bell className="h-4 w-4" />
                            Bildirimler
                        </TabsTrigger>
                        <TabsTrigger value="privacy" className="gap-2">
                            <EyeOff className="h-4 w-4" />
                            Gizlilik
                        </TabsTrigger>
                        <TabsTrigger value="blocked" className="gap-2">
                            <ShieldAlert className="h-4 w-4" />
                            Engellenenler
                        </TabsTrigger>
                    </TabsList>

                    <TabsContent value="profile">
                        <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
                            <CardHeader>
                                <CardTitle>Genel Bilgiler</CardTitle>
                                <CardDescription>Herkese açık profil bilgilerinizi buradan düzenleyebilirsiniz.</CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-6">
                                {/* Avatar Section */}
                                <div className="flex flex-col items-center gap-4 sm:flex-row sm:gap-6">
                                    <div className="relative group">
                                        <Avatar className="h-24 w-24 border-2 border-primary/20">
                                            <AvatarImage src={avatar} />
                                            <AvatarFallback className="text-xl">{user.username[0].toUpperCase()}</AvatarFallback>
                                        </Avatar>
                                        <div className="absolute inset-0 flex items-center justify-center rounded-full bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer">
                                            <Camera className="h-6 w-6 text-white" />
                                        </div>
                                    </div>
                                    <div className="flex-1 space-y-2 text-center sm:text-left">
                                        <Label htmlFor="avatar-url">Profil Fotoğrafı URL</Label>
                                        <Input
                                            id="avatar-url"
                                            placeholder="https://example.com/image.jpg"
                                            value={avatar}
                                            onChange={(e) => setAvatar(e.target.value)}
                                        />
                                        <p className="text-xs text-muted-foreground">Resim URL'si girerek profil fotoğrafınızı güncelleyebilirsiniz.</p>
                                    </div>
                                </div>

                                <div className="space-y-2">
                                    <Label htmlFor="username">Kullanıcı Adı</Label>
                                    <Input
                                        id="username"
                                        value={username}
                                        onChange={(e) => setUsername(e.target.value)}
                                    />
                                </div>
                            </CardContent>
                            <CardFooter className="border-t border-border/50 pt-6">
                                <Button onClick={handleUpdateProfile} disabled={isUpdatingProfile} className="ml-auto gap-2">
                                    {isUpdatingProfile ? 'Güncelleniyor...' : <><Save className="h-4 w-4" /> Kaydet</>}
                                </Button>
                            </CardFooter>
                        </Card>
                    </TabsContent>

                    <TabsContent value="security">
                        <div className="grid gap-6">
                            {/* Email Section */}
                            <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
                                <CardHeader>
                                    <CardTitle className="flex items-center gap-2">
                                        <Mail className="h-5 w-5" />
                                        E-posta Adresi
                                    </CardTitle>
                                    <CardDescription>E-posta adresiniz güvenlik nedeniyle değiştirilemez.</CardDescription>
                                </CardHeader>
                                <CardContent className="space-y-4">
                                    <div className="space-y-2">
                                        <Label htmlFor="email">E-posta</Label>
                                        <Input
                                            id="email"
                                            type="email"
                                            value={user.email || ''}
                                            disabled
                                            className="bg-secondary/30"
                                        />
                                    </div>
                                </CardContent>
                            </Card>

                            {/* Password Section */}
                            <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
                                <CardHeader>
                                    <CardTitle className="flex items-center gap-2">
                                        <Lock className="h-5 w-5" />
                                        Şifre Değiştir
                                    </CardTitle>
                                    <CardDescription>Hesabınızın şifresini güvenli bir şifreyle güncelleyin.</CardDescription>
                                </CardHeader>
                                <CardContent className="space-y-4">
                                    <div className="space-y-2">
                                        <Label htmlFor="new-password">Yeni Şifre</Label>
                                        <div className="relative">
                                            <Input
                                                id="new-password"
                                                type={showPassword ? 'text' : 'password'}
                                                value={newPassword}
                                                onChange={(e) => setNewPassword(e.target.value)}
                                            />
                                            <button
                                                type="button"
                                                onClick={() => setShowPassword(!showPassword)}
                                                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                                            >
                                                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                            </button>
                                        </div>
                                    </div>
                                    <div className="space-y-2">
                                        <Label htmlFor="confirm-password">Şifre Tekrar</Label>
                                        <Input
                                            id="confirm-password"
                                            type={showPassword ? 'text' : 'password'}
                                            value={confirmPassword}
                                            onChange={(e) => setConfirmPassword(e.target.value)}
                                        />
                                    </div>
                                </CardContent>
                                <CardFooter className="border-t border-border/50 pt-6">
                                    <Button onClick={handleUpdatePassword} disabled={isUpdatingPassword} className="ml-auto gap-2">
                                        {isUpdatingPassword ? 'Güncelleniyor...' : 'Şifreyi Kaydet'}
                                    </Button>
                                </CardFooter>
                            </Card>
                            {/* Two-Factor Authentication Section */}
                            <Card className="border-border/50 bg-card/50 backdrop-blur-sm border-primary/20">
                                <CardHeader>
                                    <div className="flex items-center justify-between">
                                        <div className="space-y-1">
                                            <CardTitle className="flex items-center gap-2">
                                                <ShieldCheck className="h-5 w-5 text-primary" />
                                                İki Faktörlü Doğrulama (2FA)
                                            </CardTitle>
                                            <CardDescription>
                                                Hesabınıza her girişte e-posta adresinize tek kullanımlık bir giriş bağlantısı gönderilir.
                                            </CardDescription>
                                        </div>
                                        <Switch
                                            checked={user?.twoFactorEnabled}
                                            onCheckedChange={async (checked) => {
                                                const { success, error } = await toggle2FA(checked);
                                                if (success) {
                                                    toast.success(checked ? '2FA Aktif Edildi' : '2FA Kapatıldı');
                                                } else {
                                                    toast.error(error || 'Hata oluştu');
                                                }
                                            }}
                                        />
                                    </div>
                                </CardHeader>
                                <CardContent>
                                    <div className="rounded-lg bg-primary/5 p-4 border border-primary/10">
                                        <p className="text-sm text-primary/90">
                                            Güvenliğiniz için 2FA'yı açmanızı öneririz. Bu özellik aktif olduğunda, şifreniz doğru olsa bile e-postanıza gelecek <b>tek kullanımlık giriş bağlantısı</b> olmadan giriş yapılamaz.
                                        </p>
                                    </div>
                                </CardContent>
                            </Card>
                        </div>
                    </TabsContent>

                    <TabsContent value="notifications">
                        <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
                            <CardHeader>
                                <CardTitle className="flex items-center gap-2">
                                    <Bell className="h-5 w-5" />
                                    Bildirim Tercihleri
                                </CardTitle>
                                <CardDescription>Hangi durumlarda bildirim almak istediğinizi seçin.</CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-6">
                                <div className="flex items-center justify-between space-x-2">
                                    <div className="flex flex-col space-y-1">
                                        <Label htmlFor="new-chapter">Yeni Bölüm Bildirimleri</Label>
                                        <p className="text-sm text-muted-foreground">Takip ettiğiniz mangalara yeni bölüm eklendiğinde haber ver.</p>
                                    </div>
                                    <Switch
                                        id="new-chapter"
                                        checked={prefs.notifications.new_chapter}
                                        onCheckedChange={(checked) => handleUpdatePreferences({
                                            ...prefs,
                                            notifications: { ...prefs.notifications, new_chapter: checked }
                                        })}
                                        disabled={isUpdatingPrefs}
                                    />
                                </div>
                                <div className="flex items-center justify-between space-x-2 border-t border-border/50 pt-6">
                                    <div className="flex flex-col space-y-1">
                                        <Label htmlFor="replies">Yanıt Bildirimleri</Label>
                                        <p className="text-sm text-muted-foreground">Yorumlarınıza yanıt geldiğinde haber ver.</p>
                                    </div>
                                    <Switch
                                        id="replies"
                                        checked={prefs.notifications.replies}
                                        onCheckedChange={(checked) => handleUpdatePreferences({
                                            ...prefs,
                                            notifications: { ...prefs.notifications, replies: checked }
                                        })}
                                        disabled={isUpdatingPrefs}
                                    />
                                </div>
                                <div className="flex items-center justify-between space-x-2 border-t border-border/50 pt-6">
                                    <div className="flex flex-col space-y-1">
                                        <Label htmlFor="likes">Beğeni Bildirimleri</Label>
                                        <p className="text-sm text-muted-foreground">Yorumlarınız beğenildiğinde haber ver.</p>
                                    </div>
                                    <Switch
                                        id="likes"
                                        checked={prefs.notifications.likes}
                                        onCheckedChange={(checked) => handleUpdatePreferences({
                                            ...prefs,
                                            notifications: { ...prefs.notifications, likes: checked }
                                        })}
                                        disabled={isUpdatingPrefs}
                                    />
                                </div>
                            </CardContent>
                        </Card>
                    </TabsContent>
                    <TabsContent value="privacy">
                        <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
                            <CardHeader>
                                <CardTitle className="flex items-center gap-2">
                                    <EyeOff className="h-5 w-5" />
                                    Gizlilik Ayarları
                                </CardTitle>
                                <CardDescription>Profilinizin ve okuma geçmişinizin kimler tarafından görülebileceğini seçin.</CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-6">
                                <div className="flex items-center justify-between space-x-2">
                                    <div className="flex flex-col space-y-1">
                                        <Label>Profil Görünürlüğü</Label>
                                        <p className="text-sm text-muted-foreground">Profilinizi (İstatistikler, Tier List, vb.) kimler görebilir?</p>
                                    </div>
                                    <div className="flex items-center gap-2 bg-secondary/30 rounded-lg p-1">
                                        <button
                                            onClick={() => handleUpdatePreferences({
                                                ...prefs,
                                                privacy: { ...prefs.privacy, visibility: 'public' }
                                            })}
                                            className={`px-3 py-1.5 text-xs font-bold rounded-md transition-all ${
                                                (!prefs.privacy || prefs.privacy.visibility === 'public')
                                                ? 'bg-background text-foreground shadow-sm'
                                                : 'text-muted-foreground hover:text-foreground'
                                            }`}
                                        >
                                            Herkese Açık
                                        </button>
                                        <button
                                            onClick={() => handleUpdatePreferences({
                                                ...prefs,
                                                privacy: { ...prefs.privacy, visibility: 'members' }
                                            })}
                                            className={`px-3 py-1.5 text-xs font-bold rounded-md transition-all ${
                                                prefs.privacy?.visibility === 'members'
                                                ? 'bg-background text-foreground shadow-sm'
                                                : 'text-muted-foreground hover:text-foreground'
                                            }`}
                                        >
                                            Sadece Üyeler
                                        </button>
                                        <button
                                            onClick={() => handleUpdatePreferences({
                                                ...prefs,
                                                privacy: { ...prefs.privacy, visibility: 'private' }
                                            })}
                                            className={`px-3 py-1.5 text-xs font-bold rounded-md transition-all ${
                                                prefs.privacy?.visibility === 'private'
                                                ? 'bg-background text-foreground shadow-sm'
                                                : 'text-muted-foreground hover:text-foreground'
                                            }`}
                                        >
                                            Gizli
                                        </button>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                    </TabsContent>
                    <TabsContent value="blocked">
                        <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
                            <CardHeader>
                                <CardTitle className="flex items-center gap-2">
                                    <ShieldAlert className="h-5 w-5 text-red-500" />
                                    Engellenen Kullanıcılar
                                </CardTitle>
                                <CardDescription>Kimi engellediğinizi görebilir ve isterseniz engeli kaldırabilirsiniz.</CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                {isBlockedUsersLoading ? (
                                    <div className="flex items-center justify-center py-10 text-sm text-muted-foreground">
                                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                        Engellenenler yukleniyor...
                                    </div>
                                ) : blockedUsers.length > 0 ? (
                                    blockedUsers.map((blockedUser) => (
                                        <div key={blockedUser.id} className="flex flex-col gap-4 rounded-xl border border-border/60 bg-background/40 p-4 sm:flex-row sm:items-center sm:justify-between">
                                            <div className="flex items-center gap-3">
                                                <Avatar className="h-12 w-12 border border-border/60">
                                                    <AvatarImage src={blockedUser.avatar} />
                                                    <AvatarFallback>{blockedUser.username?.slice(0, 2).toUpperCase() || '??'}</AvatarFallback>
                                                </Avatar>
                                                <div>
                                                    <p className="font-semibold">{blockedUser.username}</p>
                                                    <p className="text-sm text-muted-foreground">Bu kullanıcı profilinizi ve yorumlarınızı göremez.</p>
                                                </div>
                                            </div>

                                            <Button
                                                variant="outline"
                                                className="border-red-500/40 text-red-500 hover:bg-red-500/10 hover:text-red-400"
                                                disabled={unblockingUserId === blockedUser.id}
                                                onClick={() => handleUnblockUser(blockedUser.id)}
                                            >
                                                {unblockingUserId === blockedUser.id ? (
                                                    <>
                                                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                                        Kaldiriliyor...
                                                    </>
                                                ) : 'Engeli Kaldir'}
                                            </Button>
                                        </div>
                                    ))
                                ) : (
                                    <div className="rounded-xl border border-dashed border-border/60 bg-background/20 py-12 text-center">
                                        <ShieldAlert className="mx-auto mb-4 h-10 w-10 text-muted-foreground/60" />
                                        <p className="font-medium">Engellenen kullanıcı yok</p>
                                        <p className="mt-1 text-sm text-muted-foreground">Engellediğiniz kişiler burada listelenecek.</p>
                                    </div>
                                )}
                            </CardContent>
                        </Card>
                    </TabsContent>
                </Tabs>
            </main >
        </div >
    );
};

export default Settings;
