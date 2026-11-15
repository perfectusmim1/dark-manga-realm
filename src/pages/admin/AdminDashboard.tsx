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
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { getStatistics, getRecentAdminMangas } from '@/lib/database';
import { Manga } from '@/lib/types';
import { toast } from 'sonner';
import { getMangaTypeLabel } from '@/lib/mangaType';
import { useDeviceProfile } from '@/hooks/use-device-profile';
import { cn } from '@/lib/utils';

const AdminDashboard: React.FC = () => {
    const [stats, setStats] = useState<any | null>(null);
    const [recentMangas, setRecentMangas] = useState<Manga[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const { disableHeavyEffects, prefersReducedMotion } = useDeviceProfile();

    useEffect(() => {
        const loadData = async () => {
            try {
                setIsLoading(true);
                const [statistics, latestMangas] = await Promise.all([
                    getStatistics(),
                    getRecentAdminMangas(5)
                ]);

                setStats(statistics);
                setRecentMangas(latestMangas);
            } catch (err) {
                toast.error('İstatistikler yüklenemedi');
            } finally {
                setIsLoading(false);
            }
        };
        loadData();
    }, []);

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

    const cardRevealClass = prefersReducedMotion
        ? ''
        : disableHeavyEffects
            ? 'animate-route-fade'
            : 'animate-card-reveal-fast';

    return (
        <div className="space-y-6 lg:space-y-8">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h1 className="text-2xl font-bold sm:text-3xl">Genel Bakış</h1>
                </div>
                <div className="flex gap-2">
                    <Button asChild className="w-full sm:w-auto">
                        <Link to="/admin/mangas/new">
                            <Plus className="mr-2 h-4 w-4" />
                            Yeni Manga Ekle
                        </Link>
                    </Button>
                </div>
            </div>

            <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-5">
                {statCards.map((stat, index) => (
                    <div
                        key={stat.title}
                        className={cn(
                            'rounded-xl border border-border bg-card p-3.5 transition-[border-color,box-shadow] duration-150 hover:border-primary/35 hover:shadow-lg sm:p-5',
                            index === statCards.length - 1 && 'col-span-2 lg:col-span-1',
                            cardRevealClass,
                        )}
                        style={prefersReducedMotion || disableHeavyEffects ? undefined : { animationDelay: `${index * 25}ms` }}
                    >
                        <div className="flex items-center justify-between">
                            <div className={`rounded-lg p-2 ${stat.bgColor}`}>
                                <stat.icon className={`h-5 w-5 ${stat.color}`} />
                            </div>
                            <ArrowUpRight className="h-4 w-4 text-muted-foreground" />
                        </div>
                        <div className="mt-3 sm:mt-4">
                            <p className="text-xl font-bold sm:text-2xl">{stat.value}</p>
                            <p className="text-xs text-muted-foreground sm:text-sm">{stat.title}</p>
                        </div>
                    </div>
                ))}
            </div>

            <div className="grid gap-4 lg:grid-cols-2 lg:gap-6">
                <div className={cn('rounded-xl border border-border bg-card p-4 transition-[border-color,box-shadow] duration-150 hover:border-border/90 hover:shadow-md sm:p-6', cardRevealClass)}>
                    <h2 className="mb-4 text-lg font-semibold">Türe Göre Dağılım</h2>
                    <div className="space-y-4">
                        {(['manhwa', 'manhua', 'manga', 'webtoon', 'hentai', 'webtoon_hentai'] as const)
                            .filter((type) => (stats.mangasByType[type] || 0) > 0)
                            .map((type) => {
                            const count = stats.mangasByType[type] || 0;
                            const percentage = stats.totalMangas > 0
                                ? Math.round((count / stats.totalMangas) * 100)
                                : 0;

                            return (
                                <div key={type}>
                                    <div className="mb-1 flex items-center justify-between text-sm">
                                        <span className="font-medium">{getMangaTypeLabel(type as Manga['type'])}</span>
                                        <span className="text-muted-foreground font-mono">{count} ({percentage}%)</span>
                                    </div>
                                    <div className="h-2 overflow-hidden rounded-full bg-secondary">
                                        <div
                                            className={`h-full rounded-full transition-all ${type === 'manhwa' ? 'bg-orange-500' :
                                                type === 'manhua' ? 'bg-emerald-500' :
                                                    type === 'manga' ? 'bg-primary' :
                                                        type === 'webtoon' ? 'bg-sky-500' :
                                                            type === 'hentai' ? 'bg-rose-500' : 'bg-fuchsia-500'
                                                }`}
                                            style={{ width: `${percentage}%` }}
                                        />
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>

                <div className={cn('rounded-xl border border-border bg-card p-4 transition-[border-color,box-shadow] duration-150 hover:border-border/90 hover:shadow-md sm:p-6', cardRevealClass)}>
                    <h2 className="mb-4 text-lg font-semibold">Duruma Göre Dağılım</h2>
                    <div className="space-y-4">
                        {[
                            { key: 'ongoing', label: 'Devam Ediyor', color: 'bg-green-500' },
                            { key: 'completed', label: 'Tamamlandı', color: 'bg-primary' },
                            { key: 'hiatus', label: 'Ara Verildi', color: 'bg-orange-500' },
                        ].map(({ key, label, color }) => {
                            const count = stats.mangasByStatus[key as any] || 0;
                            const percentage = stats.totalMangas > 0
                                ? Math.round((count / stats.totalMangas) * 100)
                                : 0;

                            return (
                                <div key={key}>
                                    <div className="mb-1 flex items-center justify-between text-sm">
                                        <span>{label}</span>
                                        <span className="text-muted-foreground font-mono">{count} ({percentage}%)</span>
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

            <div className={cn('rounded-xl border border-border bg-card p-4 transition-[border-color,box-shadow] duration-150 hover:border-border/90 hover:shadow-md sm:p-6', cardRevealClass)}>
                <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <h2 className="text-lg font-semibold">Son Güncellenenler</h2>
                    <Button variant="ghost" size="sm" asChild className="w-full sm:w-auto">
                        <Link to="/admin/mangas">Tümünü Gör</Link>
                    </Button>
                </div>
                <div className="space-y-2 sm:space-y-3">
                    {recentMangas.map((manga) => (
                        <Link
                            key={manga.id}
                            to={`/admin/mangas/${manga.id}`}
                            className="flex items-start gap-3 rounded-lg p-2.5 transition-colors hover:bg-secondary/70 sm:items-center sm:p-3"
                        >
                            <img
                                src={manga.cover}
                                alt={manga.title}
                                className="h-14 w-10 shrink-0 rounded object-cover sm:h-12 sm:w-9"
                            />
                            <div className="min-w-0 flex-1">
                                <h3 className="truncate font-medium">{manga.title}</h3>
                                <p className="text-xs text-muted-foreground sm:text-sm">
                                    {manga.chapterCount ?? manga.chapters.length} bölüm • {getMangaTypeLabel(manga.type)}
                                </p>
                                <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground sm:hidden">
                                    <Clock className="h-3.5 w-3.5" />
                                    {new Date(manga.lastUpdated).toLocaleDateString('tr-TR')}
                                </div>
                            </div>
                            <div className="hidden items-center gap-1 text-sm text-muted-foreground sm:ml-auto sm:flex sm:shrink-0">
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
