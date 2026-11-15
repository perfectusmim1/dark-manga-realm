import React from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, BookOpen, CalendarDays, Clock3, Flame } from 'lucide-react';
import Header from '@/components/layout/Header';
import OfflineRequiredScreen from '@/components/offline/OfflineRequiredScreen';
import OptimizedImage from '@/components/media/OptimizedImage';
import useDocumentTitle from '@/hooks/useDocumentTitle';
import { useDeviceProfile } from '@/hooks/use-device-profile';
import { useAuth } from '@/contexts/AuthContext';
import { useEffectiveOnlineStatus } from '@/hooks/useEffectiveOnlineStatus';
import { cn } from '@/lib/utils';
import { formatChapterNumberLabel } from '@/lib/chapterTitle';
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
        if (Number.isNaN(resolvedDate.getTime())) {
            return;
        }
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

const ReadingTimeSessionCard = ({ entry }: { entry: ReadingTimeEntry }) => {
    const readTime = entry.readAt && !Number.isNaN(new Date(entry.readAt).getTime())
        ? new Date(entry.readAt).toLocaleTimeString('tr-TR', {
            hour: '2-digit',
            minute: '2-digit',
        })
        : '';

    return (
        <Link
            to={entry.chapterId ? `/manga/${entry.mangaId}/chapter/${entry.chapterId}` : `/manga/${entry.mangaId}`}
            className="group flex items-start gap-3 rounded-xl border border-border/60 bg-card/75 p-3 transition-colors duration-200 hover:border-primary/40 hover:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
            {entry.mangaCover ? (
                <OptimizedImage
                    src={entry.mangaCover}
                    alt={entry.mangaTitle}
                    allowProxy
                    transform={{ width: 144, quality: 85, format: 'webp', fit: 'cover' }}
                    containerClassName="h-16 w-12 shrink-0 overflow-hidden rounded-lg ring-1 ring-border/50"
                    placeholderClassName="rounded-lg p-1 text-[8px] leading-tight"
                    className="h-full w-full object-cover"
                />
            ) : (
                <div className="flex h-16 w-12 shrink-0 items-center justify-center rounded-lg bg-secondary/60">
                    <BookOpen className="h-4 w-4 text-muted-foreground" />
                </div>
            )}

            <div className="min-w-0 flex-1">
                <p className="line-clamp-2 text-sm font-semibold leading-snug transition-colors group-hover:text-primary group-focus-visible:text-primary sm:text-base">
                    {entry.mangaTitle}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                    {entry.chapterNumber ? `Bölüm ${formatChapterNumberLabel(entry.chapterNumber)}` : 'Okuma kaydı'}
                </p>
            </div>

            <div className="shrink-0 text-right">
                <p className="text-sm font-semibold text-primary tabular-nums">{formatReadingDuration(entry.secondsSpent)}</p>
                {readTime && (
                    <p className="mt-1 text-[11px] text-muted-foreground tabular-nums">
                        {readTime}
                    </p>
                )}
            </div>
        </Link>
    );
};

const ReadingTimeMangaDetail: React.FC = () => {
    const { mangaId } = useParams<{ mangaId: string }>();
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const { user } = useAuth();
    const { isOnline } = useEffectiveOnlineStatus();
    const { disableHeavyEffects } = useDeviceProfile();
    const [entries, setEntries] = React.useState<ReadingTimeEntry[]>([]);
    const [isLoading, setIsLoading] = React.useState(true);

    const startDate = searchParams.get('from');
    const endDate = searchParams.get('to');
    const scopeLabel = formatScopeLabel(searchParams.get('scopeLabel'), startDate, endDate);

    useDocumentTitle(entries[0]?.mangaTitle ? `${entries[0].mangaTitle} · Okuma Süresi` : 'Okuma Süresi Detayı');

    React.useEffect(() => {
        if (!user || !mangaId || !isOnline) {
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
                const seenIds = new Set<string>();
                const uniqueEntries = data.filter((entry) => {
                    if (!entry.id || seenIds.has(entry.id)) {
                        return false;
                    }
                    seenIds.add(entry.id);
                    return true;
                });
                setEntries(uniqueEntries);
            } catch (error) {
                console.error('Reading time manga detail page error:', error);
            } finally {
                setIsLoading(false);
            }
        };

        void loadEntries();
    }, [endDate, isOnline, mangaId, startDate, user]);

    if (user && !isOnline) {
        return (
            <OfflineRequiredScreen
                description="Okuma süresi seri detayları güvenlik nedeniyle sadece internet bağlantısıyla görüntülenebilir."
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
        <div className="min-h-screen overflow-x-clip bg-background">
            <Header />

            <main className="container overflow-x-clip pb-12 pt-16">
                <div className="flex flex-col gap-4 py-6 sm:py-8 lg:flex-row lg:items-start lg:justify-between">
                    <div className="flex min-w-0 items-start gap-3 sm:gap-4">
                        <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            aria-label="Geri dön"
                            className="mt-1 shrink-0 rounded-xl"
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

                        <div className="flex min-w-0 flex-1 items-start gap-3 sm:gap-4">
                            {mangaCover ? (
                                <OptimizedImage
                                    src={mangaCover}
                                    alt={mangaTitle}
                                    priority
                                    allowProxy
                                    transform={{ width: 192, quality: 85, format: 'webp', fit: 'cover' }}
                                    containerClassName="h-20 w-14 shrink-0 overflow-hidden rounded-xl border border-border/60 sm:h-28 sm:w-20 sm:rounded-2xl"
                                    placeholderClassName="rounded-xl p-1 text-[8px] leading-tight sm:rounded-2xl"
                                    className="h-full w-full object-cover"
                                />
                            ) : null}

                            <div className="min-w-0 flex-1">
                                <h1 className="max-w-3xl break-words text-xl font-bold tracking-tight sm:text-3xl">{mangaTitle}</h1>
                                <p className="mt-1 text-sm text-muted-foreground">{scopeLabel}</p>
                            </div>
                        </div>
                    </div>

                    <Button asChild variant="outline" className="w-full shrink-0 rounded-xl sm:w-auto">
                        <Link to={`/manga/${mangaId}`}>Seri Sayfasına Git</Link>
                    </Button>
                </div>

                <div className="grid grid-cols-2 gap-2.5 sm:gap-3 lg:grid-cols-4">
                    <div className="rounded-2xl border border-border/60 bg-card/75 p-3.5 sm:p-4">
                        <div className="flex items-center gap-2 text-muted-foreground">
                            <Flame className="h-4 w-4 shrink-0 text-primary" />
                            <span className="text-xs sm:text-sm">Toplam Süre</span>
                        </div>
                        <p className="mt-2 text-xl font-bold text-primary tabular-nums sm:text-2xl">{formatReadingDuration(totalSeconds)}</p>
                    </div>
                    <div className="rounded-2xl border border-border/60 bg-card/75 p-3.5 sm:p-4">
                        <div className="flex items-center gap-2 text-muted-foreground">
                            <Clock3 className="h-4 w-4 shrink-0 text-sky-400" />
                            <span className="text-xs sm:text-sm">Oturum</span>
                        </div>
                        <p className="mt-2 text-xl font-bold tabular-nums sm:text-2xl">{entries.length}</p>
                    </div>
                    <div className="rounded-2xl border border-border/60 bg-card/75 p-3.5 sm:p-4">
                        <div className="flex items-center gap-2 text-muted-foreground">
                            <BookOpen className="h-4 w-4 shrink-0 text-emerald-400" />
                            <span className="text-xs sm:text-sm">Bölüm</span>
                        </div>
                        <p className="mt-2 text-xl font-bold tabular-nums sm:text-2xl">{uniqueChapterCount}</p>
                    </div>
                    <div className="rounded-2xl border border-border/60 bg-card/75 p-3.5 sm:p-4">
                        <div className="flex items-center gap-2 text-muted-foreground">
                            <CalendarDays className="h-4 w-4 shrink-0 text-amber-400" />
                            <span className="text-xs sm:text-sm">Aktif Gün</span>
                        </div>
                        <p className="mt-2 text-xl font-bold tabular-nums sm:text-2xl">{groupedDays.length}</p>
                    </div>
                </div>

                <div className="mt-6">
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
                                    className={cn(
                                        'rounded-2xl border border-border/60 bg-card/60 p-4 sm:p-5',
                                        !disableHeavyEffects && 'animate-fade-up',
                                    )}
                                    style={disableHeavyEffects ? undefined : { animationDelay: `${0.06 + Math.min(index, 10) * 0.03}s` }}
                                >
                                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                                        <div className="min-w-0">
                                            <p className="text-base font-semibold capitalize sm:text-lg">{day.label}</p>
                                            <p className="mt-0.5 text-xs sm:text-sm text-muted-foreground tabular-nums">{day.entries.length} oturum</p>
                                        </div>

                                        <p className="text-lg font-bold text-primary tabular-nums sm:text-xl">
                                            {formatReadingDuration(day.seconds)}
                                        </p>
                                    </div>

                                    <div className="mt-4 space-y-2.5">
                                        {day.entries.map((entry) => (
                                            <ReadingTimeSessionCard key={entry.id} entry={entry} />
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="rounded-2xl border border-dashed border-border bg-background/30 py-14 text-center">
                            <Clock3 className="mx-auto h-12 w-12 text-muted-foreground/60" />
                            <h2 className="mt-4 text-xl font-semibold">Bu aralıkta kayıt yok</h2>
                            <p className="mt-2 text-sm text-muted-foreground">
                                Farklı bir gün veya hafta seçip tekrar deneyebilirsiniz.
                            </p>
                        </div>
                    )}
                </div>
            </main>
        </div>
    );
};

export default ReadingTimeMangaDetail;
