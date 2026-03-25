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
    SlidersHorizontal,
    Loader2,
    WifiOff,
    Smartphone,
    ShieldOff,
    Copy,
    TriangleAlert,
} from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { getBlockedUsers, unblockUser } from '@/lib/profile';
import { useOfflinePreferences } from '@/hooks/useOfflinePreferences';
import type { User as AppUser } from '@/lib/types';

type PreferenceState = {
    notifications: {
        new_chapter: boolean;
        replies: boolean;
        likes: boolean;
    };
    comments: {
        auto_show_media: boolean;
        auto_show_gifs: boolean;
        auto_show_replies: boolean;
        show_page_comments: boolean;
    };
    privacy: {
        visibility: NonNullable<NonNullable<AppUser['preferences']>['privacy']>['visibility'];
    };
};

type BlockedUser = {
    id: string;
    username: string;
    avatar?: string | null;
};

const buildPreferenceState = (preferences?: AppUser['preferences']): PreferenceState => ({
    notifications: {
        new_chapter: preferences?.notifications?.new_chapter ?? true,
        replies: preferences?.notifications?.replies ?? true,
        likes: preferences?.notifications?.likes ?? true,
    },
    comments: {
        auto_show_media: preferences?.comments?.auto_show_media ?? false,
        auto_show_gifs: preferences?.comments?.auto_show_gifs ?? false,
        auto_show_replies: preferences?.comments?.auto_show_replies ?? false,
        show_page_comments: preferences?.comments?.show_page_comments ?? false,
    },
    privacy: {
        visibility: preferences?.privacy?.visibility ?? 'public',
    },
});

const sanitizeTotpCode = (value: string) => value.replace(/\D/g, '').slice(0, 6);

const getTotpQrImageSrc = (qrCode: string | undefined) => {
    const normalized = qrCode?.trim();

    if (!normalized) {
        return null;
    }

    if (normalized.startsWith('data:image/')) {
        return normalized;
    }

    if (normalized.startsWith('<svg') || normalized.startsWith('<?xml')) {
        return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(normalized)}`;
    }

    return normalized;
};

const getTotpQrSvgMarkup = (qrCode: string | undefined) => {
    const normalized = qrCode?.trim();

    if (!normalized) {
        return null;
    }

    const svgIndex = normalized.indexOf('<svg');
    if (svgIndex === -1) {
        return null;
    }

    return normalized.slice(svgIndex);
};

const Settings: React.FC = () => {
    const {
        user,
        mfaState,
        updateProfile,
        updatePassword,
        updatePreferences,
        enrollTwoFactor,
        cancelTwoFactorEnrollment,
        verifyTwoFactorEnrollment,
        disableTwoFactor,
    } = useAuth();
    const { preferences: offlinePreferences, updatePreferences: updateOfflinePreferences } = useOfflinePreferences();

    // Profile state
    const [username, setUsername] = useState(user?.username || '');
    const [avatar, setAvatar] = useState(user?.avatar || '');
    const [isUpdatingProfile, setIsUpdatingProfile] = useState(false);

    // Password state
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [isUpdatingPassword, setIsUpdatingPassword] = useState(false);

    // MFA state
    const [disableDialogOpen, setDisableDialogOpen] = useState(false);
    const [setupCode, setSetupCode] = useState('');
    const [disableCode, setDisableCode] = useState('');
    const [pendingEnrollment, setPendingEnrollment] = useState<{
        factorId: string;
        friendlyName?: string;
        qrCodeSvg: string;
        secret: string;
        uri: string;
    } | null>(null);
    const [isTwoFactorBusy, setIsTwoFactorBusy] = useState(false);

    // Notification state
    const [prefs, setPrefs] = useState<PreferenceState>(buildPreferenceState(user?.preferences));
    const [isUpdatingPrefs, setIsUpdatingPrefs] = useState(false);
    const [blockedUsers, setBlockedUsers] = useState<BlockedUser[]>([]);
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
            setBlockedUsers((users || []) as BlockedUser[]);
            setIsBlockedUsersLoading(false);
        });
    }, [user?.id]);

    useEffect(() => {
        setUsername(user?.username || '');
        setAvatar(user?.avatar || '');
    }, [user?.username, user?.avatar]);

    useEffect(() => {
        setPrefs(buildPreferenceState(user?.preferences));
    }, [user?.preferences]);

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
        if (newPassword.length < 8) {
            toast.error('Şifre en az 8 karakter olmalıdır');
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

    const closeSetupDialog = async () => {
        if (pendingEnrollment?.factorId) {
            await cancelTwoFactorEnrollment(pendingEnrollment.factorId);
        }

        setPendingEnrollment(null);
        setSetupCode('');
    };

    const handleStartTwoFactorSetup = async () => {
        try {
            setIsTwoFactorBusy(true);
            const { success, error, enrollment } = await enrollTwoFactor();

            if (!success || !enrollment) {
                toast.error(error || '2FA kurulumu başlatılamadı');
                return;
            }

            setPendingEnrollment(enrollment);
            setSetupCode('');
        } finally {
            setIsTwoFactorBusy(false);
        }
    };

    const handleVerifyTwoFactorSetup = async () => {
        if (!pendingEnrollment) {
            toast.error('Aktif bir kurulum bulunamadı');
            return;
        }

        try {
            setIsTwoFactorBusy(true);
            const { success, error } = await verifyTwoFactorEnrollment(pendingEnrollment.factorId, setupCode);

            if (!success) {
                toast.error(error || 'Doğrulama başarısız oldu');
                return;
            }

            toast.success('Google Authenticator başarıyla etkinleştirildi');
            setPendingEnrollment(null);
            setSetupCode('');
        } finally {
            setIsTwoFactorBusy(false);
        }
    };

    const handleDisableTwoFactor = async () => {
        try {
            setIsTwoFactorBusy(true);
            const { success, error } = await disableTwoFactor(disableCode);

            if (!success) {
                toast.error(error || '2FA kapatılamadı');
                return;
            }

            toast.success('2FA kapatıldı');
            setDisableCode('');
            setDisableDialogOpen(false);
        } finally {
            setIsTwoFactorBusy(false);
        }
    };

    const handleUpdatePreferences = async (
        newPrefs: typeof prefs,
        successMessage = 'Tercihler güncellendi'
    ) => {
        const previousPrefs = prefs;

        try {
            setPrefs(newPrefs);
            setIsUpdatingPrefs(true);
            const { success, error } = await updatePreferences(newPrefs);
            if (success) {
                toast.success(successMessage);
            } else {
                setPrefs(previousPrefs);
                toast.error(error || 'Güncellenemedi');
            }
        } catch (err) {
            setPrefs(previousPrefs);
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

    const qrCodeDataUrl = getTotpQrImageSrc(pendingEnrollment?.qrCodeSvg);
    const qrCodeSvgMarkup = getTotpQrSvgMarkup(pendingEnrollment?.qrCodeSvg);
    const activeTotpFactor = mfaState.factors.find((factor) => factor.status === 'verified') || null;

    const openQrInNewTab = () => {
        if (!qrCodeDataUrl) {
            return;
        }

        const popup = window.open('', '_blank');

        if (!popup) {
            toast.error('Yeni sekme açılamadı. Tarayıcı popup engelliyor olabilir.');
            return;
        }

        const qrMarkup = qrCodeSvgMarkup
            ? `<div style="width:320px;height:320px;">${qrCodeSvgMarkup}</div>`
            : `<img src="${qrCodeDataUrl}" alt="Google Authenticator QR" style="width:320px;height:320px;display:block;" />`;

        popup.document.write(`
          <!doctype html>
          <html lang="tr">
            <head>
              <meta charset="utf-8" />
              <title>Google Authenticator QR</title>
              <style>
                body {
                  margin: 0;
                  min-height: 100vh;
                  display: flex;
                  align-items: center;
                  justify-content: center;
                  background: #ffffff;
                }
              </style>
            </head>
            <body>${qrMarkup}</body>
          </html>
        `);
        popup.document.close();
    };

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
                        <TabsTrigger value="preferences" className="gap-2">
                            <SlidersHorizontal className="h-4 w-4" />
                            Tercihler
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
                                            disabled
                                            className="bg-secondary/30"
                                        />
                                        <p className="text-xs text-muted-foreground">Kullanıcı adı kayıt sırasında belirlenir ve sonradan değiştirilemez.</p>
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
                                    <div className="flex items-center justify-between gap-4">
                                        <div className="space-y-1">
                                            <CardTitle className="flex items-center gap-2">
                                                <ShieldCheck className="h-5 w-5 text-primary" />
                                                İki Faktörlü Doğrulama (2FA)
                                            </CardTitle>
                                            <CardDescription>
                                                Google Authenticator uyumlu TOTP kodları ile hesabınızı koruyun.
                                            </CardDescription>
                                        </div>
                                        <Badge variant={user.twoFactorEnabled ? 'default' : 'secondary'}>
                                            {user.twoFactorEnabled ? 'Etkin' : 'Kapalı'}
                                        </Badge>
                                    </div>
                                </CardHeader>
                                <CardContent className="space-y-4">
                                    <div className="rounded-lg border border-primary/10 bg-primary/5 p-4">
                                        <p className="text-sm text-primary/90">
                                            2FA etkin olduğunda giriş şifreniz doğru olsa bile Google Authenticator uygulamasındaki 6 haneli kod olmadan hesabınıza erişilemez.
                                        </p>
                                    </div>

                                    {activeTotpFactor ? (
                                        <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                                            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                                <div className="space-y-1">
                                                    <p className="flex items-center gap-2 text-sm font-medium">
                                                        <Smartphone className="h-4 w-4 text-primary" />
                                                        ToonParrot
                                                    </p>
                                                    <p className="text-xs text-muted-foreground">
                                                        {user.email || activeTotpFactor.friendlyName || 'Google Authenticator'}
                                                    </p>
                                                    <p className="text-xs text-muted-foreground">
                                                        Bu faktör doğrulanmış durumda. 2FA'yı kapatmak için yeni bir 6 haneli kod girmeniz gerekir.
                                                    </p>
                                                </div>
                                                <Button
                                                    type="button"
                                                    variant="outline"
                                                    className="gap-2"
                                                    onClick={() => {
                                                        setDisableCode('');
                                                        setDisableDialogOpen(true);
                                                    }}
                                                >
                                                    <ShieldOff className="h-4 w-4" />
                                                    2FA'yı Kapat
                                                </Button>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="space-y-3 rounded-xl border border-white/10 bg-white/5 p-4">
                                            <div className="rounded-lg border border-white/10 bg-white/5 p-3 text-sm text-muted-foreground">
                                                Authenticator uygulamasında bu kayıt `ToonParrot` olarak görünecek ve hesap etiketi olarak `{user.email || 'e-posta adresiniz'}` kullanılacak.
                                            </div>
                                            <Button
                                                type="button"
                                                className="gap-2"
                                                onClick={handleStartTwoFactorSetup}
                                                disabled={isTwoFactorBusy || Boolean(pendingEnrollment)}
                                            >
                                                {isTwoFactorBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                                                Google Authenticator Kur
                                            </Button>

                                            {pendingEnrollment && (
                                                <div className="space-y-5 rounded-2xl border border-primary/20 bg-background/60 p-5">
                                                    <div className="space-y-1">
                                                        <p className="text-base font-semibold">Google Authenticator Kurulumu</p>
                                                        <p className="text-sm text-muted-foreground">
                                                            QR kodu Google Authenticator ile tarayın. Tarayamıyorsanız alttaki gizli anahtarı manuel girin ve ardından 6 haneli kodu doğrulayın.
                                                        </p>
                                                    </div>

                                                    {qrCodeDataUrl && (
                                                        <div className="flex flex-col items-center gap-3">
                                                            <div className="select-none rounded-2xl bg-white p-4 shadow-xl" data-allow-image-interaction="true">
                                                                {qrCodeSvgMarkup ? (
                                                                    <div
                                                                        className="h-52 w-52 [&>svg]:h-full [&>svg]:w-full"
                                                                        data-allow-image-interaction="true"
                                                                        dangerouslySetInnerHTML={{ __html: qrCodeSvgMarkup }}
                                                                    />
                                                                ) : (
                                                                    <img
                                                                        src={qrCodeDataUrl}
                                                                        alt="Google Authenticator QR"
                                                                        className="h-52 w-52"
                                                                        data-allow-image-interaction="true"
                                                                    />
                                                                )}
                                                            </div>
                                                            <Button
                                                                type="button"
                                                                variant="outline"
                                                                size="sm"
                                                                className="border-white/15"
                                                                onClick={openQrInNewTab}
                                                            >
                                                                QR&apos;ı Yeni Sekmede Aç
                                                            </Button>
                                                        </div>
                                                    )}

                                                    <div className="space-y-2">
                                                        <Label htmlFor="totp-secret">Kurulum Anahtarı</Label>
                                                        <div className="flex gap-2">
                                                            <Input
                                                                id="totp-secret"
                                                                value={pendingEnrollment.secret || ''}
                                                                readOnly
                                                                className="font-mono tracking-[0.2em]"
                                                            />
                                                            <Button
                                                                type="button"
                                                                variant="outline"
                                                                onClick={async () => {
                                                                    if (!pendingEnrollment.secret) {
                                                                        return;
                                                                    }

                                                                    await navigator.clipboard.writeText(pendingEnrollment.secret);
                                                                    toast.success('Kurulum anahtarı kopyalandı');
                                                                }}
                                                            >
                                                                <Copy className="h-4 w-4" />
                                                            </Button>
                                                        </div>
                                                    </div>

                                                    <div className="space-y-2">
                                                        <Label htmlFor="setup-code">Authenticator Kodu</Label>
                                                        <Input
                                                            id="setup-code"
                                                            inputMode="numeric"
                                                            placeholder="123456"
                                                            value={setupCode}
                                                            onChange={(e) => setSetupCode(sanitizeTotpCode(e.target.value))}
                                                            className="text-center text-lg tracking-[0.35em]"
                                                            maxLength={6}
                                                        />
                                                    </div>

                                                    <div className="flex justify-end gap-2">
                                                        <Button type="button" variant="ghost" onClick={() => void closeSetupDialog()} disabled={isTwoFactorBusy}>
                                                            Vazgeç
                                                        </Button>
                                                        <Button type="button" onClick={handleVerifyTwoFactorSetup} disabled={isTwoFactorBusy || setupCode.length !== 6}>
                                                            {isTwoFactorBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Doğrula ve Etkinleştir'}
                                                        </Button>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    <Alert>
                                        <TriangleAlert className="h-4 w-4" />
                                        <AlertTitle>Önemli</AlertTitle>
                                        <AlertDescription>
                                            Şifre sıfırlama bağlantısı yalnızca şifreyi yeniler. Google Authenticator açıksa sonraki girişte yine TOTP kodu gerekir.
                                        </AlertDescription>
                                    </Alert>
                                </CardContent>
                            </Card>

                            <Card className="border-border/50 bg-card/50 backdrop-blur-sm border-blue-500/20">
                                <CardHeader>
                                    <div className="flex items-center justify-between gap-4">
                                        <div className="space-y-1">
                                            <CardTitle className="flex items-center gap-2">
                                                <WifiOff className="h-5 w-5 text-blue-400" />
                                                Çevrimdışı Mod
                                            </CardTitle>
                                            <CardDescription>
                                                Açıkken internetin olsa bile site çevrimdışı gibi davranır ve öncelik yalnızca indirilen içeriklere verilir.
                                            </CardDescription>
                                        </div>
                                        <Switch
                                            checked={offlinePreferences.forceOfflineMode}
                                            onCheckedChange={(checked) => {
                                                updateOfflinePreferences({ forceOfflineMode: checked });
                                                toast.success(checked ? 'Çevrimdışı mod açıldı' : 'Çevrimdışı mod kapatıldı');
                                            }}
                                        />
                                    </div>
                                </CardHeader>
                                <CardContent>
                                    <div className="rounded-lg border border-blue-500/15 bg-blue-500/5 p-4 text-sm text-blue-100/90">
                                        Bu modda ana sayfa, seri sayfaları ve okuyucu indirilen içeriklere göre çalışır. Yeni yorum, takip, favori ve benzeri online işlemler pasif olur.
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
                                        }, 'Bildirim tercihleri güncellendi')}
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
                                        }, 'Bildirim tercihleri güncellendi')}
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
                                        }, 'Bildirim tercihleri güncellendi')}
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
                                            }, 'Gizlilik ayarlari guncellendi')}
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
                                            }, 'Gizlilik ayarlari guncellendi')}
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
                                            }, 'Gizlilik ayarlari guncellendi')}
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
                    <TabsContent value="preferences">
                        <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
                            <CardHeader>
                                <CardTitle className="flex items-center gap-2">
                                    <SlidersHorizontal className="h-5 w-5" />
                                    Diğer Tercihler
                                </CardTitle>
                                <CardDescription>Yorum görünümü ve genel kullanım davranışlarını buradan belirleyebilirsiniz.</CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-6">
                                <div className="flex items-center justify-between space-x-2">
                                    <div className="flex flex-col space-y-1">
                                        <Label htmlFor="auto-show-replies">Yanıtları Otomatik Aç</Label>
                                        <p className="text-sm text-muted-foreground">Yorum başlıklarının altındaki yanıtlar varsayılan olarak açık gelsin.</p>
                                    </div>
                                    <Switch
                                        id="auto-show-replies"
                                        checked={prefs.comments?.auto_show_replies ?? false}
                                        onCheckedChange={(checked) => handleUpdatePreferences({
                                            ...prefs,
                                            comments: { ...prefs.comments, auto_show_replies: checked }
                                        }, 'Tercihler güncellendi')}
                                        disabled={isUpdatingPrefs}
                                    />
                                </div>
                                <div className="flex items-center justify-between space-x-2 border-t border-border/50 pt-6">
                                    <div className="flex flex-col space-y-1">
                                        <Label htmlFor="auto-show-media">Yorum Medyalarını Otomatik Aç</Label>
                                        <p className="text-sm text-muted-foreground">Yorumlardaki görselleri butona basmadan direkt göster.</p>
                                    </div>
                                    <Switch
                                        id="auto-show-media"
                                        checked={prefs.comments?.auto_show_media ?? false}
                                        onCheckedChange={(checked) => handleUpdatePreferences({
                                            ...prefs,
                                            comments: { ...prefs.comments, auto_show_media: checked }
                                        }, 'Tercihler güncellendi')}
                                        disabled={isUpdatingPrefs}
                                    />
                                </div>
                                <div className="flex items-center justify-between space-x-2 border-t border-border/50 pt-6">
                                    <div className="flex flex-col space-y-1">
                                        <Label htmlFor="auto-show-gifs">Yorum GIF'lerini Otomatik Aç</Label>
                                        <p className="text-sm text-muted-foreground">GIF içeren yorumları varsayılan olarak açık göster.</p>
                                    </div>
                                    <Switch
                                        id="auto-show-gifs"
                                        checked={prefs.comments?.auto_show_gifs ?? false}
                                        onCheckedChange={(checked) => handleUpdatePreferences({
                                            ...prefs,
                                            comments: { ...prefs.comments, auto_show_gifs: checked }
                                        }, 'Tercihler güncellendi')}
                                        disabled={isUpdatingPrefs}
                                    />
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

                <Dialog
                    open={disableDialogOpen}
                    onOpenChange={(open) => {
                        setDisableDialogOpen(open);
                        if (!open) {
                            setDisableCode('');
                        }
                    }}
                >
                    <DialogContent className="max-w-md border-white/10 bg-[#0f0f10] text-white">
                        <DialogHeader>
                            <DialogTitle>2FA'yı Kapat</DialogTitle>
                            <DialogDescription>
                                Güvenlik gereği 2FA'yı kapatmadan önce authenticator uygulamanızdaki güncel 6 haneli kodu doğrulamanız gerekiyor.
                            </DialogDescription>
                        </DialogHeader>

                        <div className="space-y-2">
                            <Label htmlFor="disable-code">Authenticator Kodu</Label>
                            <Input
                                id="disable-code"
                                inputMode="numeric"
                                placeholder="123456"
                                value={disableCode}
                                onChange={(e) => setDisableCode(sanitizeTotpCode(e.target.value))}
                                className="text-center text-lg tracking-[0.35em]"
                                maxLength={6}
                            />
                        </div>

                        <DialogFooter>
                            <Button type="button" variant="ghost" onClick={() => setDisableDialogOpen(false)} disabled={isTwoFactorBusy}>
                                İptal
                            </Button>
                            <Button type="button" variant="destructive" onClick={handleDisableTwoFactor} disabled={isTwoFactorBusy || disableCode.length !== 6}>
                                {isTwoFactorBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : '2FA\'yı Kapat'}
                            </Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
            </main >
        </div >
    );
};

export default Settings;
