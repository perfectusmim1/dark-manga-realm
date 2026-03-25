import React, { useEffect, useState } from 'react';
import { Loader2, Settings, Shield, ShieldOff, TriangleAlert } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { useAuth } from '@/contexts/AuthContext';
import {
    getSiteSecuritySettings,
    setAdblockWarningEnabled,
    setDevtoolsProtectionEnabled,
    SiteSecuritySettings,
} from '@/lib/siteSecurity';
import { toast } from 'sonner';

const DEFAULT_SECURITY_SETTINGS: SiteSecuritySettings = {
    devtoolsProtectionEnabled: false,
    adblockWarningEnabled: false,
    updatedAt: null,
    updatedBy: null,
};

const AdminSiteSettings: React.FC = () => {
    const { user } = useAuth();
    const [securitySettings, setSecuritySettings] = useState<SiteSecuritySettings>(DEFAULT_SECURITY_SETTINGS);
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const isPrimaryAdmin = user?.role === 'admin';

    useEffect(() => {
        if (!isPrimaryAdmin) {
            setIsLoading(false);
            return;
        }

        const loadSettings = async () => {
            try {
                setIsLoading(true);
                const nextSettings = await getSiteSecuritySettings();
                setSecuritySettings(nextSettings);
            } catch (error) {
                console.error('Site security settings could not be loaded:', error);
                toast.error('Site ayarları yüklenemedi');
            } finally {
                setIsLoading(false);
            }
        };

        void loadSettings();
    }, [isPrimaryAdmin]);

    const handleDevtoolsToggle = async (checked: boolean) => {
        if (!isPrimaryAdmin || isSaving) {
            return;
        }

        try {
            setIsSaving(true);
            const nextSettings = await setDevtoolsProtectionEnabled(checked);
            setSecuritySettings(nextSettings);
            toast.success(
                checked
                    ? 'Geliştirici araçları koruması yeniden açıldı'
                    : 'Geliştirici araçları koruması geçici olarak kapatıldı'
            );
        } catch (error) {
            console.error('Devtools protection toggle failed:', error);
            toast.error('Geliştirici aracı ayarı güncellenemedi');
        } finally {
            setIsSaving(false);
        }
    };

    const handleAdblockToggle = async (checked: boolean) => {
        if (!isPrimaryAdmin || isSaving) {
            return;
        }

        try {
            setIsSaving(true);
            const nextSettings = await setAdblockWarningEnabled(checked);
            setSecuritySettings(nextSettings);
            toast.success(
                checked
                    ? 'Adblock uyarısı yeniden açıldı'
                    : 'Adblock uyarısı kapatıldı'
            );
        } catch (error) {
            console.error('Adblock warning toggle failed:', error);
            toast.error('Adblock uyarı ayarı güncellenemedi');
        } finally {
            setIsSaving(false);
        }
    };

    if (isLoading) {
        return (
            <div className="flex min-h-[400px] items-center justify-center">
                <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent"></div>
            </div>
        );
    }

    if (!isPrimaryAdmin) {
        return (
            <div className="rounded-2xl border border-destructive/30 bg-card/70 p-8 text-center">
                <h1 className="text-2xl font-bold">Yetkisiz Erişim</h1>
                <p className="mt-3 text-muted-foreground">
                    Site ayarlarını sadece admin hesabı görüntüleyebilir ve değiştirebilir.
                </p>
            </div>
        );
    }

    return (
        <div className="space-y-8">
            <div className="space-y-2">
                <div className="flex items-center gap-3">
                    <div className="rounded-xl bg-primary/10 p-3 text-primary">
                        <Settings className="h-6 w-6" />
                    </div>
                    <div>
                        <h1 className="text-3xl font-bold">Site Settings</h1>
                        <p className="text-muted-foreground">
                            Site geneli güvenlik ve kullanıcı uyarı anahtarları.
                        </p>
                    </div>
                </div>
                <p className="text-sm text-muted-foreground">
                    {securitySettings.updatedAt
                        ? `Son değişiklik ${new Date(securitySettings.updatedAt).toLocaleString('tr-TR')}`
                        : 'Henüz bu alanda kayıtlı bir değişiklik yok'}
                </p>
            </div>

            <div className="grid gap-5 xl:grid-cols-2">
                <section className="rounded-2xl border border-border bg-card p-6">
                    <div className="flex items-start justify-between gap-4">
                        <div className="space-y-3">
                            <div className={`inline-flex rounded-xl p-3 ${securitySettings.devtoolsProtectionEnabled ? 'bg-amber-500/10 text-amber-500' : 'bg-emerald-500/10 text-emerald-500'}`}>
                                {securitySettings.devtoolsProtectionEnabled ? (
                                    <Shield className="h-6 w-6" />
                                ) : (
                                    <ShieldOff className="h-6 w-6" />
                                )}
                            </div>
                            <div>
                                <h2 className="text-xl font-semibold">Geliştirici Aracı Koruması</h2>
                                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                                    F12, genel sağ tık ve `debugger` döngüsünü site genelinde kontrol eder. Admin hesabı bu kısıttan muaf kalır.
                                </p>
                            </div>
                        </div>
                        <Switch
                            checked={securitySettings.devtoolsProtectionEnabled}
                            onCheckedChange={handleDevtoolsToggle}
                            disabled={isSaving}
                            aria-label="Geliştirici aracı korumasını aç veya kapat"
                        />
                    </div>
                    <p className="mt-5 text-xs uppercase tracking-wide text-muted-foreground">
                        Durum: {securitySettings.devtoolsProtectionEnabled ? 'Açık' : 'Kapalı'}
                    </p>
                </section>

                <section className="rounded-2xl border border-border bg-card p-6">
                    <div className="flex items-start justify-between gap-4">
                        <div className="space-y-3">
                            <div className={`inline-flex rounded-xl p-3 ${securitySettings.adblockWarningEnabled ? 'bg-amber-500/10 text-amber-500' : 'bg-emerald-500/10 text-emerald-500'}`}>
                                <TriangleAlert className="h-6 w-6" />
                            </div>
                            <div>
                                <h2 className="text-xl font-semibold">Adblock Uyarısı</h2>
                                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                                    Reklam engelleyici algılanırsa kapatılabilir uyarı gösterir. Kullanıcı tekrar siteye girdiğinde uyarı yeniden görünür.
                                </p>
                            </div>
                        </div>
                        <Switch
                            checked={securitySettings.adblockWarningEnabled}
                            onCheckedChange={handleAdblockToggle}
                            disabled={isSaving}
                            aria-label="Adblock uyarısını aç veya kapat"
                        />
                    </div>
                    <p className="mt-5 text-xs uppercase tracking-wide text-muted-foreground">
                        Durum: {securitySettings.adblockWarningEnabled ? 'Açık' : 'Kapalı'}
                    </p>
                </section>
            </div>

            {isSaving ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Ayarlar kaydediliyor...
                </div>
            ) : null}
        </div>
    );
};

export default AdminSiteSettings;
