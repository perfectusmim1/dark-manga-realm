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
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { getStatistics, getAllMangas } from '@/lib/database';
import { Manga } from '@/lib/types';

const AdminDashboard: React.FC = () => {
    const [stats, setStats] = useState<ReturnType<typeof getStatistics> | null>(null);
    const [recentMangas, setRecentMangas] = useState<Manga[]>([]);

    useEffect(() => {
        setStats(getStatistics());
        const mangas = getAllMangas()
            .sort((a, b) => new Date(b.lastUpdated).getTime() - new Date(a.lastUpdated).getTime())
            .slice(0, 5);
        setRecentMangas(mangas);
    }, []);

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
    ];

    return (
        <div className="space-y-8">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold">Dashboard</h1>
                    <p className="text-muted-foreground">Site istatistiklerine genel bakış</p>
                </div>
                <Button asChild>
                    <Link to="/admin/mangas/new">
                        <Plus className="mr-2 h-4 w-4" />
                        Yeni Manga Ekle
                    </Link>
                </Button>
            </div>

            {/* Stat Cards */}
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
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

            {/* Type Distribution */}
            <div className="grid gap-6 lg:grid-cols-2">
                <div className="rounded-xl border border-border bg-card p-6">
                    <h2 className="mb-4 text-lg font-semibold">Türe Göre Dağılım</h2>
                    <div className="space-y-4">
                        {(['manga', 'manhwa', 'manhua'] as const).map((type) => {
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
                                                type === 'manhwa' ? 'bg-purple-500' : 'bg-green-500'
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
                        {([
                            { key: 'ongoing', label: 'Devam Ediyor', color: 'bg-green-500' },
                            { key: 'completed', label: 'Tamamlandı', color: 'bg-primary' },
                            { key: 'hiatus', label: 'Ara Verildi', color: 'bg-orange-500' },
                        ] as const).map(({ key, label, color }) => {
                            const count = stats.mangasByStatus[key];
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

            {/* Recent Mangas */}
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
