import React, { useEffect, useRef, useState } from 'react';
import { Download, FileJson, Loader2, Settings, Shield, ShieldOff, TriangleAlert, Upload } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/contexts/AuthContext';
import { useAdminAccess } from '@/hooks/useAdminAccess';
import {
    getSiteSecuritySettings,
    setAdblockWarningEnabled,
    setDevtoolsProtectionEnabled,
    SiteSecuritySettings,
} from '@/lib/siteSecurity';
import { exportSiteBackup, importSiteBackup } from '@/lib/siteBackup';
import { SiteBackupManifest } from '@/lib/types';
import { toast } from 'sonner';

const DEFAULT_SECURITY_SETTINGS: SiteSecuritySettings = {
    devtoolsProtectionEnabled: false,
    adblockWarningEnabled: false,
    updatedAt: null,
    updatedBy: null,
};

const CONTENT_BACKUP_INCLUDED_AREAS = [
    'Mangalar ve bölümler',
    'Karakter, yazar, çizer kayıtları',
    'Galeri, metadata ve kaynak linkleri',
    'Seri bağlantıları',
    'Etiketler ve entity-tag ilişkileri',
    'Duyurular ve site ayarları',
];

const CONTENT_BACKUP_EXCLUDED_AREAS = [
    'Auth ve kullanıcı profili verileri',
    'Yorumlar, incelemeler ve puanlar',
    'Favoriler, yer imleri ve okuma listeleri',
    'Takip, bildirim ve aktivite kayıtları',
    'Destek, rapor ve moderasyon geçmişi',
];

const getManifestTableCount = (manifest: SiteBackupManifest) =>
    Object.values(manifest.tables || {}).filter((rows) => Array.isArray(rows)).length;

const getManifestRowCount = (manifest: SiteBackupManifest) =>
    Object.values(manifest.tables || {}).reduce((total, rows) => (
        total + (Array.isArray(rows) ? rows.length : 0)
    ), 0);

const AdminSiteSettings: React.FC = () => {
    const { user } = useAuth();
    const { access, isLoading: accessLoading } = useAdminAccess();
    const [securitySettings, setSecuritySettings] = useState<SiteSecuritySettings>(DEFAULT_SECURITY_SETTINGS);
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [isExportingBackup, setIsExportingBackup] = useState(false);
    const [isImportingBackup, setIsImportingBackup] = useState(false);
    const [pendingBackupFileName, setPendingBackupFileName] = useState('');
    const [pendingManifest, setPendingManifest] = useState<SiteBackupManifest | null>(null);
    const fileInputRef = useRef<HTMLInputElement | null>(null);
    const isPrimaryAdmin = access.isPrimaryAdmin;
    const pendingManifestTableCount = pendingManifest ? getManifestTableCount(pendingManifest) : 0;
    const pendingManifestRowCount = pendingManifest ? getManifestRowCount(pendingManifest) : 0;

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

    const handleExportBackup = async () => {
        if (!isPrimaryAdmin) {
            return;
        }

        try {
            setIsExportingBackup(true);
            const manifest = await exportSiteBackup();
            const fileName = `toonparrot-backup-${manifest.exportedAt.replace(/[:.]/g, '-')}.json`;
            const blob = new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = fileName;
            link.click();
            URL.revokeObjectURL(url);
            toast.success('Yedek dosyası indirildi');
        } catch (error) {
            console.error('Backup export failed:', error);
            toast.error(error instanceof Error ? error.message : 'Yedek dışa aktarılamadı');
        } finally {
            setIsExportingBackup(false);
        }
    };

    const handleBackupFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) {
            setPendingBackupFileName('');
            setPendingManifest(null);
            return;
        }

        try {
            const text = await file.text();
            const parsed = JSON.parse(text) as SiteBackupManifest;

            if (!parsed || typeof parsed !== 'object' || typeof parsed.version !== 'number' || !parsed.tables) {
                throw new Error('Geçersiz yedek dosyası');
            }

            setPendingManifest(parsed);
            setPendingBackupFileName(file.name);
            toast.success('Yedek dosyası yüklendi, şimdi içe aktarabilirsin');
        } catch (error) {
            console.error('Backup file parse failed:', error);
            setPendingManifest(null);
            setPendingBackupFileName('');
            toast.error(error instanceof Error ? error.message : 'Yedek dosyası okunamadı');
        } finally {
            if (event.target) {
                event.target.value = '';
            }
        }
    };

    const handleImportBackup = async () => {
        if (!isPrimaryAdmin || !pendingManifest) {
            return;
        }

        try {
            setIsImportingBackup(true);
            const result = await importSiteBackup(pendingManifest);
            toast.success(`Yedek içe aktarıldı (${result.restoredTables.length} tablo)`);
            setPendingManifest(null);
            setPendingBackupFileName('');
        } catch (error) {
            console.error('Backup import failed:', error);
            toast.error(error instanceof Error ? error.message : 'Yedek içe aktarılamadı');
        } finally {
            setIsImportingBackup(false);
        }
    };

    if (accessLoading || isLoading) {
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
        <div className="space-y-6 lg:space-y-8">
            <div className="space-y-2">
                <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center">
                    <div className="rounded-xl bg-primary/10 p-3 text-primary">
                        <Settings className="h-6 w-6" />
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold sm:text-3xl">Site Settings</h1>
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

            <div className="grid gap-4 xl:grid-cols-2 xl:gap-5">
                <section className="rounded-2xl border border-border bg-card p-4 sm:p-6">
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
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

                <section className="rounded-2xl border border-border bg-card p-4 sm:p-6">
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
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

            <section className="rounded-2xl border border-border bg-card p-4 sm:p-6">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="space-y-3">
                        <div className="inline-flex rounded-xl bg-primary/10 p-3 text-primary">
                            <FileJson className="h-6 w-6" />
                        </div>
                        <div>
                            <h2 className="text-xl font-semibold">Site verisi yedekleme</h2>
                            <p className="mt-2 text-sm leading-6 text-muted-foreground">
                                Bu bölüm içerik ve katalog verilerini JSON manifest olarak dışa aktarır ve geri yükler.
                                Manga, bölüm, karakter, yazar, çizer, galeri, metadata, kaynak linkleri, seri bağlantıları, etiket ilişkileri,
                                duyurular ve site ayarları bu kapsama dahildir.
                            </p>
                            <p className="text-sm leading-6 text-muted-foreground">
                                Auth kullanıcıları ve tüm kullanıcı aksiyonları bu akıştan hariç tutulur; yorumlar, incelemeler, puanlar, favoriler,
                                okuma listeleri, bildirimler ve destek kayıtları import/export dosyasına girmez.
                            </p>
                        </div>
                    </div>

                    <div className="flex w-full flex-col gap-3 lg:w-auto lg:min-w-[280px]">
                        <Button onClick={() => void handleExportBackup()} disabled={isExportingBackup || isImportingBackup}>
                            {isExportingBackup ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
                            İçerik Yedeğini Dışa Aktar
                        </Button>

                        <Button
                            variant="outline"
                            onClick={() => fileInputRef.current?.click()}
                            disabled={isExportingBackup || isImportingBackup}
                        >
                            <Upload className="mr-2 h-4 w-4" />
                            Backup Dosyası Seç
                        </Button>
                        <Input
                            ref={fileInputRef}
                            type="file"
                            accept="application/json,.json"
                            className="hidden"
                            onChange={(event) => void handleBackupFileChange(event)}
                        />

                        <Button
                            variant="outline"
                            onClick={() => void handleImportBackup()}
                            disabled={!pendingManifest || isImportingBackup || isExportingBackup}
                        >
                            {isImportingBackup ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
                            İçerik Yedeğini İçe Aktar
                        </Button>
                    </div>
                </div>

                <div className="mt-5 grid gap-4 lg:grid-cols-2">
                    <div className="rounded-2xl border border-border bg-background/60 p-4">
                        <h3 className="text-sm font-semibold">İçe aktarma durumu</h3>
                        <p className="mt-2 text-sm text-muted-foreground">
                            {pendingBackupFileName ? `${pendingBackupFileName} hazır` : 'Henüz dosya seçilmedi'}
                        </p>
                        {pendingManifest ? (
                            <div className="mt-3 space-y-1 text-xs text-muted-foreground">
                                <p>Versiyon: {pendingManifest.version}</p>
                                <p>Dışa aktarım: {new Date(pendingManifest.exportedAt).toLocaleString('tr-TR')}</p>
                                <p>İçerik tablosu: {pendingManifestTableCount}</p>
                                <p>Toplam kayıt: {pendingManifestRowCount}</p>
                            </div>
                        ) : null}
                    </div>

                    <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 p-4 text-sm text-amber-100">
                        <p className="font-semibold">Davranış</p>
                        <p className="mt-2 leading-6">
                            Bu içe aktarma akışı kullanıcı verisini korumak için ana içerik tablolarında merge çalışır.
                            Backup dosyasında olmayan manga, bölüm veya entity kayıtları güvenlik nedeniyle otomatik silinmez.
                        </p>
                    </div>
                </div>

                <div className="mt-4 grid gap-4 xl:grid-cols-2">
                    <div className="rounded-2xl border border-border bg-background/60 p-4">
                        <h3 className="text-sm font-semibold">Dahil edilen alanlar</h3>
                        <p className="mt-2 text-sm leading-6 text-muted-foreground">
                            {CONTENT_BACKUP_INCLUDED_AREAS.join(' • ')}
                        </p>
                    </div>

                    <div className="rounded-2xl border border-border bg-background/60 p-4">
                        <h3 className="text-sm font-semibold">Hariç tutulan alanlar</h3>
                        <p className="mt-2 text-sm leading-6 text-muted-foreground">
                            {CONTENT_BACKUP_EXCLUDED_AREAS.join(' • ')}
                        </p>
                    </div>
                </div>
            </section>

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
