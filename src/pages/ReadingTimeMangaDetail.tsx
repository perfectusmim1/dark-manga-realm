import React from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, BookOpen, CalendarDays, Clock3, Flame } from 'lucide-react';
import Header from '@/components/layout/Header';
import OfflineRequiredScreen from '@/components/offline/OfflineRequiredScreen';
import { useAuth } from '@/contexts/AuthContext';
import { useEffectiveOnlineStatus } from '@/hooks/useEffectiveOnlineStatus';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
    ReadingTimeEntry,
    formatReadingDuration,
    getReadingTimeMangaEntries,
} from '@/lib/profile';

const parseDateKey = (value: string) => {
    const [year, month, day] = value.split('-').map(Number);
    return new Date(year, (month || 1) - 1, day || 1);
};

const formatScopeLabel = (scopeLabel: string | null, startDate: string | null, endDate: string | null) => {
    if (scopeLabel) {
        return scopeLabel;
    }

    if (startDate && endDate) {
        const start = parseDateKey(startDate);
        const end = parseDateKey(endDate);

        if (startDate === endDate) {
            return start.toLocaleDateString('tr-TR', {
                weekday: 'long',
                day: 'numeric',
                month: 'long',
                year: 'numeric',
            });
        }

        return `${start.toLocaleDateString('tr-TR', {
            day: 'numeric',
            month: 'short',
        })} - ${end.toLocaleDateString('tr-TR', {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
        })}`;
    }

    return 'Seçilen Aralık';
};

const groupEntriesByDay = (entries: ReadingTimeEntry[]) => {
    const dayMap = new Map<string, { date: string; label: string; seconds: number; entries: ReadingTimeEntry[] }>();

    entries.forEach((entry) => {
        const resolvedDate = new Date(entry.readAt);
        const dateKey = `${resolvedDate.getFullYear()}-${`${resolvedDate.getMonth() + 1}`.padStart(2, '0')}-${`${resolvedDate.getDate()}`.padStart(2, '0')}`;
        const existing = dayMap.get(dateKey);

        if (existing) {
            existing.seconds += entry.secondsSpent;
            existing.entries.push(entry);
            return;
        }

        dayMap.set(dateKey, {
            date: dateKey,
            label: resolvedDate.toLocaleDateString('tr-TR', {
                weekday: 'long',
                day: 'numeric',
                month: 'long',
                year: 'numeric',
            }),
            seconds: entry.secondsSpent,
            entries: [entry],
        });
    });

    return Array.from(dayMap.values()).sort((left, right) => right.date.localeCompare(left.date));
};

const ReadingTimeSessionCard = ({ entry }: { entry: ReadingTimeEntry }) => (
    <Link
        to={entry.chapterId ? `/manga/${entry.mangaId}/chapter/${entry.chapterId}` : `/manga/${entry.mangaId}`}
        className="flex items-start gap-3 rounded-2xl border border-border bg-card/45 p-3 transition-[transform,background-color,border-color] duration-300 hover:-translate-y-0.5 hover:border-primary/35 hover:bg-card"
    >
        {entry.mangaCover ? (
            <img
                src={entry.mangaCover}
                alt={entry.mangaTitle}
                className="h-16 w-12 shrink-0 rounded-xl object-cover"
            />
        ) : (
            <div className="flex h-16 w-12 shrink-0 items-center justify-center rounded-xl bg-secondary/60">
                <BookOpen className="h-4 w-4 text-muted-foreground" />
            </div>
        )}

        <div className="min-w-0 flex-1">
            <p className="line-clamp-2 text-sm font-semibold leading-snug sm:text-base">{entry.mangaTitle}</p>
            <p className="mt-1 text-xs text-muted-foreground">
                {entry.chapterNumber ? `Bölüm ${entry.chapterNumber}` : 'Okuma kaydı'}
            </p>
        </div>

        <div className="shrink-0 text-right">
            <p className="text-sm font-semibold text-primary">{formatReadingDuration(entry.secondsSpent)}</p>
            <p className="mt-1 text-[11px] text-muted-foreground">
                {new Date(entry.readAt).toLocaleTimeString('tr-TR', {
                    hour: '2-digit',
                    minute: '2-digit',
                })}
            </p>
        </div>
    </Link>
);

const ReadingTimeMangaDetail: React.FC = () => {
    const { mangaId } = useParams<{ mangaId: string }>();
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const { user } = useAuth();
    const { isOnline } = useEffectiveOnlineStatus();
    const [entries, setEntries] = React.useState<ReadingTimeEntry[]>([]);
    const [isLoading, setIsLoading] = React.useState(true);

    const startDate = searchParams.get('from');
    const endDate = searchParams.get('to');
    const scopeLabel = formatScopeLabel(searchParams.get('scopeLabel'), startDate, endDate);

    React.useEffect(() => {
        if (!user || !mangaId) {
            setEntries([]);
            setIsLoading(false);
            return;
        }

        const loadEntries = async () => {
            try {
                setIsLoading(true);
                const data = await getReadingTimeMangaEntries(user.id, mangaId, 'all', {
                    startDate,
                    endDate,
                });
                setEntries(data);
            } catch (error) {
                console.error('Reading time manga detail page error:', error);
            } finally {
                setIsLoading(false);
            }
        };

        void loadEntries();
    }, [endDate, mangaId, startDate, user]);

    if (user && !isOnline) {
        return (
            <OfflineRequiredScreen
                description="Okuma süresi manga detayları güvenlik nedeniyle sadece internet bağlantısıyla görüntülenebilir."
                actionHref="/reading-time"
                actionLabel="Okuma Süresine Dön"
            />
        );
    }

    if (!user) {
        return (
            <div className="min-h-screen bg-background">
                <Header />
                <main className="container flex min-h-[60vh] items-center justify-center pt-20">
                    <div className="text-center">
                        <Clock3 className="mx-auto h-16 w-16 text-muted-foreground" />
                        <h1 className="mt-4 text-2xl font-bold">Okuma Süresi Detayı</h1>
                        <p className="mt-2 text-muted-foreground">
                            Bu detay ekranını görmek için giriş yapmalısınız.
                        </p>
                        <Button asChild className="mt-4" variant="glow">
                            <Link to="/auth">Giriş Yap</Link>
                        </Button>
                    </div>
                </main>
            </div>
        );
    }

    const mangaTitle = entries[0]?.mangaTitle || 'Okuma Detayı';
    const mangaCover = entries[0]?.mangaCover;
    const groupedDays = groupEntriesByDay(entries);
    const totalSeconds = entries.reduce((sum, entry) => sum + entry.secondsSpent, 0);
    const uniqueChapterCount = new Set(entries.map((entry) => entry.chapterId || (entry.chapterNumber ? `chapter-${entry.chapterNumber}` : `entry-${entry.id}`))).size;

    return (
        <div className="min-h-screen bg-background">
            <Header />

            <main className="container pb-12 pt-20">
                <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="flex items-start gap-4">
                        <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            className="mt-1 shrink-0 rounded-2xl"
                            onClick={() => {
                                if (window.history.length > 1) {
                                    navigate(-1);
                                    return;
                                }

                                navigate('/reading-time');
                            }}
                        >
                            <ArrowLeft className="h-4 w-4" />
                        </Button>

                        <div className="flex items-start gap-4">
                            {mangaCover ? (
                                <img
                                    src={mangaCover}
                                    alt={mangaTitle}
                                    className="hidden h-28 w-20 rounded-2xl border border-border/70 object-cover sm:block"
                                />
                            ) : null}

                            <div>
                                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-primary/80">Okuma Süresi Detayı</p>
                                <h1 className="mt-2 max-w-3xl text-2xl font-bold tracking-tight sm:text-3xl">{mangaTitle}</h1>
                                <p className="mt-2 text-sm text-muted-foreground">{scopeLabel}</p>

                                <div className="mt-4 flex flex-wrap gap-2">
                                    <Badge variant="outline">{entries.length} oturum</Badge>
                                    <Badge variant="outline">{uniqueChapterCount} bölüm</Badge>
                                    <Badge variant="outline">{groupedDays.length} aktif gün</Badge>
                                </div>
                            </div>
                        </div>
                    </div>

                    <Button asChild variant="outline" className="rounded-2xl">
                        <Link to={`/manga/${mangaId}`}>Seri Sayfasına Git</Link>
                    </Button>
                </div>

                <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
                    <div className="rounded-2xl border border-border bg-card/45 p-4">
                        <div className="flex items-center gap-2 text-muted-foreground">
                            <Flame className="h-4 w-4 text-primary" />
                            <span className="text-sm">Toplam Süre</span>
                        </div>
                        <p className="mt-3 text-2xl font-bold text-primary">{formatReadingDuration(totalSeconds)}</p>
                    </div>
                    <div className="rounded-2xl border border-border bg-card/45 p-4">
                        <div className="flex items-center gap-2 text-muted-foreground">
                            <Clock3 className="h-4 w-4 text-sky-400" />
                            <span className="text-sm">Oturum</span>
                        </div>
                        <p className="mt-3 text-2xl font-bold">{entries.length}</p>
                    </div>
                    <div className="rounded-2xl border border-border bg-card/45 p-4">
                        <div className="flex items-center gap-2 text-muted-foreground">
                            <BookOpen className="h-4 w-4 text-emerald-400" />
                            <span className="text-sm">Bölüm</span>
                        </div>
                        <p className="mt-3 text-2xl font-bold">{uniqueChapterCount}</p>
                    </div>
                    <div className="rounded-2xl border border-border bg-card/45 p-4">
                        <div className="flex items-center gap-2 text-muted-foreground">
                            <CalendarDays className="h-4 w-4 text-amber-400" />
                            <span className="text-sm">Aktif Gün</span>
                        </div>
                        <p className="mt-3 text-2xl font-bold">{groupedDays.length}</p>
                    </div>
                </div>

                <div className="mt-6 sm:mt-8">
                    {isLoading ? (
                        <div className="space-y-4">
                            {Array.from({ length: 4 }).map((_, index) => (
                                <Skeleton key={index} className="h-32 rounded-2xl" />
                            ))}
                        </div>
                    ) : groupedDays.length > 0 ? (
                        <div className="space-y-4">
                            {groupedDays.map((day, index) => (
                                <div
                                    key={day.date}
                                    className="animate-fade-up rounded-3xl border border-border bg-card/35 p-4 opacity-0 sm:p-5"
                                    style={{ animationDelay: `${0.06 + Math.min(index, 10) * 0.03}s`, animationFillMode: 'forwards' }}
                                >
                                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                        <div>
                                            <p className="text-lg font-semibold capitalize">{day.label}</p>
                                            <p className="mt-1 text-sm text-muted-foreground">{day.entries.length} oturum</p>
                                        </div>

                                        <div className="text-left sm:text-right">
                                            <p className="text-xl font-bold text-primary">{formatReadingDuration(day.seconds)}</p>
                                            <p className="text-xs text-muted-foreground">Günlük toplam</p>
                                        </div>
                                    </div>

                                    <div className="mt-4 space-y-3">
                                        {day.entries.map((entry) => (
                                            <ReadingTimeSessionCard key={entry.id} entry={entry} />
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="rounded-2xl border border-dashed border-border bg-background/30 py-16 text-center">
                            <Clock3 className="mx-auto h-12 w-12 text-muted-foreground/60" />
                            <h2 className="mt-4 text-xl font-semibold">Bu aralıkta kayıt yok</h2>
                            <p className="mt-2 text-muted-foreground">
                                Farklı bir gün veya hafta seçip tekrar deneyebilirsin.
                            </p>
                        </div>
                    )}
                </div>
            </main>
        </div>
    );
};

export default ReadingTimeMangaDetail;
