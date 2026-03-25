import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
    BookOpen,
    Eye,
    MessageSquare,
    TrendingUp,
    Clock,
    Plus,
    ArrowUpRight,
    Users as UsersIcon,
    Loader2,
    Shield,
    ShieldOff,
    TriangleAlert,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { useAuth } from '@/contexts/AuthContext';
import { getStatistics, getAllMangas } from '@/lib/database';
import {
    getSiteSecuritySettings,
    setAdblockWarningEnabled,
    setDevtoolsProtectionEnabled,
    SiteSecuritySettings,
} from '@/lib/siteSecurity';
import { Manga } from '@/lib/types';
import { toast } from 'sonner';

const AdminDashboard: React.FC = () => {
    const { user } = useAuth();
    const [stats, setStats] = useState<any | null>(null);
    const [recentMangas, setRecentMangas] = useState<Manga[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [securitySettings, setSecuritySettings] = useState<SiteSecuritySettings>({
        devtoolsProtectionEnabled: false,
        adblockWarningEnabled: false,
        updatedAt: null,
        updatedBy: null,
    });
    const [isSecurityLoading, setIsSecurityLoading] = useState(false);
    const isPrimaryAdmin = user?.role === 'admin';

    useEffect(() => {
        const loadData = async () => {
            try {
                setIsLoading(true);
                const [statistics, allMangas] = await Promise.all([
                    getStatistics(),
                    getAllMangas()
                ]);

                setStats(statistics);
                setRecentMangas(allMangas
                    .sort((a, b) => new Date(b.lastUpdated).getTime() - new Date(a.lastUpdated).getTime())
                    .slice(0, 5)
                );
            } catch (err) {
                toast.error('İstatistikler yüklenemedi');
            } finally {
                setIsLoading(false);
            }
        };
        loadData();
    }, []);

    useEffect(() => {
        if (!isPrimaryAdmin) {
            return;
        }

        const loadSecuritySettings = async () => {
            try {
                setIsSecurityLoading(true);
                const nextSettings = await getSiteSecuritySettings();
                setSecuritySettings(nextSettings);
            } catch (error) {
                console.error('Site security settings could not be loaded:', error);
                toast.error('Site güvenlik ayarı yüklenemedi');
            } finally {
                setIsSecurityLoading(false);
            }
        };

        void loadSecuritySettings();
    }, [isPrimaryAdmin]);

    const handleProtectionToggle = async (checked: boolean) => {
        if (!isPrimaryAdmin || isSecurityLoading) {
            return;
        }

        try {
            setIsSecurityLoading(true);
            const nextSettings = await setDevtoolsProtectionEnabled(checked);
            setSecuritySettings(nextSettings);
            toast.success(
                checked
                    ? 'Geliştirici araçları koruması yeniden açıldı'
                    : 'Geliştirici araçları koruması geçici olarak kapatıldı'
            );
        } catch (error) {
            console.error('Devtools protection toggle failed:', error);
            toast.error('Koruma ayarı güncellenemedi');
        } finally {
            setIsSecurityLoading(false);
        }
    };

    const handleAdblockWarningToggle = async (checked: boolean) => {
        if (!isPrimaryAdmin || isSecurityLoading) {
            return;
        }

        try {
            setIsSecurityLoading(true);
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
            setIsSecurityLoading(false);
        }
    };

    if (isLoading) {
        return (
            <div className="flex min-h-[400px] items-center justify-center">
                <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent"></div>
            </div>
        );
    }

    if (!stats) return null;

    const statCards = [
        {
            title: 'Toplam Manga',
            value: stats.totalMangas,
            icon: BookOpen,
            color: 'text-primary',
            bgColor: 'bg-primary/10',
        },
        {
            title: 'Toplam Bölüm',
            value: stats.totalChapters,
            icon: TrendingUp,
            color: 'text-green-500',
            bgColor: 'bg-green-500/10',
        },
        {
            title: 'Toplam Görüntülenme',
            value: stats.totalViews.toLocaleString('tr-TR'),
            icon: Eye,
            color: 'text-purple-500',
            bgColor: 'bg-purple-500/10',
        },
        {
            title: 'Toplam Yorum',
            value: stats.totalComments,
            icon: MessageSquare,
            color: 'text-orange-500',
            bgColor: 'bg-orange-500/10',
        },
        {
            title: 'Toplam Kullanıcı',
            value: stats.totalUsers,
            icon: UsersIcon,
            color: 'text-blue-500',
            bgColor: 'bg-blue-500/10',
        },
    ];

    return (
        <div className="space-y-8">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold">Dashboard</h1>
                    <p className="text-muted-foreground">Site istatistiklerine genel bakış</p>
                </div>
                <div className="flex gap-2">
                    <Button asChild>
                        <Link to="/admin/mangas/new">
                            <Plus className="mr-2 h-4 w-4" />
                            Yeni Manga Ekle
                        </Link>
                    </Button>
                </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
                {statCards.map((stat) => (
                    <div
                        key={stat.title}
                        className="rounded-xl border border-border bg-card p-6 transition-shadow hover:shadow-lg"
                    >
                        <div className="flex items-center justify-between">
                            <div className={`rounded-lg p-2 ${stat.bgColor}`}>
                                <stat.icon className={`h-5 w-5 ${stat.color}`} />
                            </div>
                            <ArrowUpRight className="h-4 w-4 text-muted-foreground" />
                        </div>
                        <div className="mt-4">
                            <p className="text-2xl font-bold">{stat.value}</p>
                            <p className="text-sm text-muted-foreground">{stat.title}</p>
                        </div>
                    </div>
                ))}
            </div>

            {isPrimaryAdmin ? (
                <div className="rounded-xl border border-border bg-card p-6">
                    <div className="space-y-6">
                        <div className="space-y-2">
                            <div className="flex items-center gap-3">
                                <div className="rounded-lg bg-primary/10 p-2 text-primary">
                                    <Shield className="h-5 w-5" />
                                </div>
                                <div>
                                    <h2 className="text-lg font-semibold">Site Koruma ve Uyarı Ayarları</h2>
                                    <p className="text-sm text-muted-foreground">
                                        Bu anahtarlar sadece admin tarafından değiştirilebilir.
                                    </p>
                                </div>
                            </div>
                            <p className="text-sm text-muted-foreground">
                                {securitySettings.updatedAt
                                    ? `Son değişiklik ${new Date(securitySettings.updatedAt).toLocaleString('tr-TR')}`
                                    : 'Henüz panelden bir değişiklik yapılmadı'}
                            </p>
                        </div>

                        <div className="grid gap-4 lg:grid-cols-2">
                            <div className="rounded-2xl border border-border/70 bg-secondary/30 p-4">
                                <div className="flex items-start justify-between gap-4">
                                    <div className="space-y-2">
                                        <div className={`inline-flex rounded-lg p-2 ${securitySettings.devtoolsProtectionEnabled ? 'bg-amber-500/10 text-amber-500' : 'bg-emerald-500/10 text-emerald-500'}`}>
                                            {securitySettings.devtoolsProtectionEnabled ? (
                                                <Shield className="h-5 w-5" />
                                            ) : (
                                                <ShieldOff className="h-5 w-5" />
                                            )}
                                        </div>
                                        <div>
                                            <h3 className="font-semibold">Geliştirici Aracı Koruması</h3>
                                            <p className="mt-1 text-sm text-muted-foreground">
                                                F12, genel sağ tık ve `debugger` döngüsünü kontrol eder. Admin bu kısıttan muaftır.
                                            </p>
                                        </div>
                                    </div>
                                    <Switch
                                        checked={securitySettings.devtoolsProtectionEnabled}
                                        onCheckedChange={handleProtectionToggle}
                                        disabled={isSecurityLoading}
                                        aria-label="Geliştirici aracı korumasını aç veya kapat"
                                    />
                                </div>
                                <p className="mt-4 text-xs text-muted-foreground">
                                    Durum: {securitySettings.devtoolsProtectionEnabled ? 'Açık' : 'Kapalı'}
                                </p>
                            </div>

                            <div className="rounded-2xl border border-border/70 bg-secondary/30 p-4">
                                <div className="flex items-start justify-between gap-4">
                                    <div className="space-y-2">
                                        <div className={`inline-flex rounded-lg p-2 ${securitySettings.adblockWarningEnabled ? 'bg-amber-500/10 text-amber-500' : 'bg-emerald-500/10 text-emerald-500'}`}>
                                            <TriangleAlert className="h-5 w-5" />
                                        </div>
                                        <div>
                                            <h3 className="font-semibold">Adblock Uyarısı</h3>
                                            <p className="mt-1 text-sm text-muted-foreground">
                                                Reklam engelleyici algılanırsa kapatılabilir bir uyarı gösterir. Kullanıcı siteye yeniden girdiğinde tekrar çıkar.
                                            </p>
                                        </div>
                                    </div>
                                    <Switch
                                        checked={securitySettings.adblockWarningEnabled}
                                        onCheckedChange={handleAdblockWarningToggle}
                                        disabled={isSecurityLoading}
                                        aria-label="Adblock uyarısını aç veya kapat"
                                    />
                                </div>
                                <p className="mt-4 text-xs text-muted-foreground">
                                    Durum: {securitySettings.adblockWarningEnabled ? 'Açık' : 'Kapalı'}
                                </p>
                            </div>
                        </div>

                        {isSecurityLoading ? (
                            <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                <Loader2 className="h-4 w-4 animate-spin" />
                                Ayarlar güncelleniyor...
                            </div>
                        ) : null}
                    </div>
                </div>
            ) : null}

            <div className="grid gap-6 lg:grid-cols-2">
                <div className="rounded-xl border border-border bg-card p-6">
                    <h2 className="mb-4 text-lg font-semibold">Türe Göre Dağılım</h2>
                    <div className="space-y-4">
                        {(['manga', 'manhwa', 'manhua', 'webtoon'] as const).map((type) => {
                            const count = stats.mangasByType[type];
                            const percentage = stats.totalMangas > 0
                                ? Math.round((count / stats.totalMangas) * 100)
                                : 0;

                            return (
                                <div key={type}>
                                    <div className="mb-1 flex items-center justify-between text-sm">
                                        <span className="capitalize">{type}</span>
                                        <span className="text-muted-foreground">{count} ({percentage}%)</span>
                                    </div>
                                    <div className="h-2 overflow-hidden rounded-full bg-secondary">
                                        <div
                                            className={`h-full rounded-full transition-all ${type === 'manga' ? 'bg-primary' :
                                                type === 'manhwa' ? 'bg-purple-500' :
                                                    type === 'manhua' ? 'bg-green-500' : 'bg-sky-500'
                                                }`}
                                            style={{ width: `${percentage}%` }}
                                        />
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>

                <div className="rounded-xl border border-border bg-card p-6">
                    <h2 className="mb-4 text-lg font-semibold">Duruma Göre Dağılım</h2>
                    <div className="space-y-4">
                        {[
                            { key: 'ongoing', label: 'Devam Ediyor', color: 'bg-green-500' },
                            { key: 'completed', label: 'Tamamlandı', color: 'bg-primary' },
                            { key: 'hiatus', label: 'Ara Verildi', color: 'bg-orange-500' },
                        ].map(({ key, label, color }) => {
                            const count = stats.mangasByStatus[key as any];
                            const percentage = stats.totalMangas > 0
                                ? Math.round((count / stats.totalMangas) * 100)
                                : 0;

                            return (
                                <div key={key}>
                                    <div className="mb-1 flex items-center justify-between text-sm">
                                        <span>{label}</span>
                                        <span className="text-muted-foreground">{count} ({percentage}%)</span>
                                    </div>
                                    <div className="h-2 overflow-hidden rounded-full bg-secondary">
                                        <div
                                            className={`h-full rounded-full transition-all ${color}`}
                                            style={{ width: `${percentage}%` }}
                                        />
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>

            <div className="rounded-xl border border-border bg-card p-6">
                <div className="mb-4 flex items-center justify-between">
                    <h2 className="text-lg font-semibold">Son Güncellenenler</h2>
                    <Button variant="ghost" size="sm" asChild>
                        <Link to="/admin/mangas">Tümünü Gör</Link>
                    </Button>
                </div>
                <div className="space-y-3">
                    {recentMangas.map((manga) => (
                        <Link
                            key={manga.id}
                            to={`/admin/mangas/${manga.id}`}
                            className="flex items-center gap-4 rounded-lg p-3 transition-colors hover:bg-secondary"
                        >
                            <img
                                src={manga.cover}
                                alt={manga.title}
                                className="h-12 w-9 rounded object-cover"
                            />
                            <div className="flex-1">
                                <h3 className="font-medium">{manga.title}</h3>
                                <p className="text-sm text-muted-foreground">
                                    {manga.chapters.length} bölüm • {manga.type}
                                </p>
                            </div>
                            <div className="flex items-center gap-1 text-sm text-muted-foreground">
                                <Clock className="h-4 w-4" />
                                {new Date(manga.lastUpdated).toLocaleDateString('tr-TR')}
                            </div>
                        </Link>
                    ))}
                    {recentMangas.length === 0 && (
                        <p className="py-8 text-center text-muted-foreground">
                            Henüz manga eklenmemiş
                        </p>
                    )}
                </div>
            </div>
        </div>
    );
};

export default AdminDashboard;
