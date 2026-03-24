import React from 'react';
import { Link } from 'react-router-dom';
import { BookOpen, CalendarDays, Clock3, Flame, LineChart } from 'lucide-react';
import Header from '@/components/layout/Header';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
    ReadingTimeDayBucket,
    ReadingTimeOverview,
    ReadingTimeRange,
    formatReadingDuration,
    getReadingTimeOverview,
    getReadingTimeTimeline,
} from '@/lib/profile';

const RANGE_LABELS: Record<ReadingTimeRange, string> = {
    today: 'Bugün',
    week: 'Haftalık',
    month: 'Aylık',
    all: 'Tüm Zaman',
};

const OverviewCard = ({
    label,
    value,
    accentClassName,
}: {
    label: string;
    value: string;
    accentClassName: string;
}) => (
    <div className="rounded-2xl border border-border bg-card/50 p-5">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className={`mt-2 text-2xl font-bold ${accentClassName}`}>{value}</p>
    </div>
);

const ReadingTime: React.FC = () => {
    const { user } = useAuth();
    const [range, setRange] = React.useState<ReadingTimeRange>('week');
    const [expandedDays, setExpandedDays] = React.useState<Record<string, boolean>>({});
    const [overview, setOverview] = React.useState<ReadingTimeOverview>({
        todaySeconds: 0,
        weekSeconds: 0,
        monthSeconds: 0,
        allTimeSeconds: 0,
    });
    const [timeline, setTimeline] = React.useState<ReadingTimeDayBucket[]>([]);
    const [isOverviewLoading, setIsOverviewLoading] = React.useState(true);
    const [isTimelineLoading, setIsTimelineLoading] = React.useState(true);

    React.useEffect(() => {
        if (!user) {
            setIsOverviewLoading(false);
            setIsTimelineLoading(false);
            return;
        }

        const loadOverview = async () => {
            try {
                setIsOverviewLoading(true);
                const data = await getReadingTimeOverview(user.id);
                setOverview(data);
            } catch (error) {
                console.error('Reading time overview page error:', error);
            } finally {
                setIsOverviewLoading(false);
            }
        };

        loadOverview();
    }, [user]);

    React.useEffect(() => {
        if (!user) {
            setIsTimelineLoading(false);
            return;
        }

        const loadTimeline = async () => {
            try {
                setIsTimelineLoading(true);
                setExpandedDays({});
                const data = await getReadingTimeTimeline(user.id, range);
                setTimeline(data);
            } catch (error) {
                console.error('Reading time timeline page error:', error);
            } finally {
                setIsTimelineLoading(false);
            }
        };

        loadTimeline();
    }, [user, range]);

    if (!user) {
        return (
            <div className="min-h-screen bg-background">
                <Header />
                <main className="container flex min-h-[60vh] items-center justify-center pt-20">
                    <div className="text-center">
                        <Clock3 className="mx-auto h-16 w-16 text-muted-foreground" />
                        <h1 className="mt-4 text-2xl font-bold">Okuma Süreniz</h1>
                        <p className="mt-2 text-muted-foreground">
                            Okuma sürenizi görmek için giriş yapmalısınız.
                        </p>
                        <Button asChild className="mt-4" variant="glow">
                            <Link to="/auth">Giriş Yap</Link>
                        </Button>
                    </div>
                </main>
            </div>
        );
    }

    const maxDaySeconds = timeline.reduce((max, day) => Math.max(max, day.seconds), 0);
    const selectedTotalSeconds = timeline.reduce((sum, day) => sum + day.seconds, 0);

    return (
        <div className="min-h-screen bg-background">
            <Header />

            <main className="container pb-12 pt-20">
                <div className="mb-8 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                    <div>
                        <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                            <Clock3 className="h-6 w-6" />
                        </div>
                        <h1 className="text-3xl font-bold tracking-tight">Okuma Süresi</h1>
                        <p className="mt-2 max-w-2xl text-muted-foreground">
                            Bugün, haftalık, aylık ve tüm zaman okuma süreni takip et. Gün gün ne kadar okuduğunu bu ekrandan görebilirsin.
                        </p>
                    </div>

                    <div className="rounded-2xl border border-border bg-card/40 px-4 py-3 text-sm text-muted-foreground">
                        Aktif görünüm: <span className="font-semibold text-foreground">{RANGE_LABELS[range]}</span>
                    </div>
                </div>

                {isOverviewLoading ? (
                    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                        {Array.from({ length: 4 }).map((_, index) => (
                            <Skeleton key={index} className="h-28 rounded-2xl" />
                        ))}
                    </div>
                ) : (
                    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                        <OverviewCard label="Bugün" value={formatReadingDuration(overview.todaySeconds)} accentClassName="text-primary" />
                        <OverviewCard label="Bu Hafta" value={formatReadingDuration(overview.weekSeconds)} accentClassName="text-sky-400" />
                        <OverviewCard label="Bu Ay" value={formatReadingDuration(overview.monthSeconds)} accentClassName="text-emerald-400" />
                        <OverviewCard label="Tüm Zaman" value={formatReadingDuration(overview.allTimeSeconds)} accentClassName="text-amber-400" />
                    </div>
                )}

                <div className="mt-8 rounded-3xl border border-border bg-card/35 p-5 md:p-6">
                    <Tabs value={range} onValueChange={(value) => setRange(value as ReadingTimeRange)} className="space-y-6">
                        <TabsList className="h-auto flex-wrap gap-2 rounded-2xl bg-secondary/40 p-1">
                            <TabsTrigger value="today">Bugün</TabsTrigger>
                            <TabsTrigger value="week">Haftalık</TabsTrigger>
                            <TabsTrigger value="month">Aylık</TabsTrigger>
                            <TabsTrigger value="all">Tüm Zaman</TabsTrigger>
                        </TabsList>

                        <div className="grid gap-4 md:grid-cols-3">
                            <div className="rounded-2xl border border-border bg-background/40 p-4">
                                <div className="flex items-center gap-2 text-muted-foreground">
                                    <Flame className="h-4 w-4 text-primary" />
                                    <span className="text-sm">Seçili Süre</span>
                                </div>
                                <p className="mt-3 text-2xl font-bold">{formatReadingDuration(selectedTotalSeconds)}</p>
                            </div>
                            <div className="rounded-2xl border border-border bg-background/40 p-4">
                                <div className="flex items-center gap-2 text-muted-foreground">
                                    <CalendarDays className="h-4 w-4 text-sky-400" />
                                    <span className="text-sm">Aktif Gün</span>
                                </div>
                                <p className="mt-3 text-2xl font-bold">{timeline.length}</p>
                            </div>
                            <div className="rounded-2xl border border-border bg-background/40 p-4">
                                <div className="flex items-center gap-2 text-muted-foreground">
                                    <LineChart className="h-4 w-4 text-emerald-400" />
                                    <span className="text-sm">En Yoğun Gün</span>
                                </div>
                                <p className="mt-3 text-2xl font-bold">
                                    {maxDaySeconds > 0 ? formatReadingDuration(maxDaySeconds) : '0 sn'}
                                </p>
                            </div>
                        </div>

                        {isTimelineLoading ? (
                            <div className="space-y-4">
                                {Array.from({ length: 5 }).map((_, index) => (
                                    <Skeleton key={index} className="h-36 rounded-2xl" />
                                ))}
                            </div>
                        ) : timeline.length > 0 ? (
                            <div className="space-y-4">
                                {timeline.map((day) => {
                                    const width = maxDaySeconds > 0 ? Math.max((day.seconds / maxDaySeconds) * 100, 6) : 0;
                                    const isExpanded = Boolean(expandedDays[day.date]);
                                    const visibleEntries = isExpanded ? day.entries : day.entries.slice(0, 4);
                                    const hiddenCount = Math.max(day.entries.length - 4, 0);

                                    return (
                                        <div key={day.date} className="rounded-2xl border border-border bg-background/40 p-4">
                                            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                                                <div>
                                                    <p className="text-lg font-semibold capitalize">{day.label}</p>
                                                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                                                        <Badge variant="outline">{day.chapters} bölüm</Badge>
                                                        <Badge variant="outline">{day.seriesCount} seri</Badge>
                                                        <span>{new Date(day.date).toLocaleDateString('tr-TR')}</span>
                                                    </div>
                                                </div>

                                                <div className="min-w-[10rem] text-left md:text-right">
                                                    <p className="text-xl font-bold text-primary">{formatReadingDuration(day.seconds)}</p>
                                                    <p className="text-xs text-muted-foreground">{RANGE_LABELS[range]} görünümünde</p>
                                                </div>
                                            </div>

                                            <div className="mt-4 h-2 overflow-hidden rounded-full bg-secondary/50">
                                                <div
                                                    className="h-full rounded-full bg-primary/80 transition-all"
                                                    style={{ width: `${width}%` }}
                                                />
                                            </div>

                                            <div className="mt-4 space-y-2">
                                                {visibleEntries.map((entry) => (
                                                    <Link
                                                        key={entry.id}
                                                        to={entry.chapterId ? `/manga/${entry.mangaId}/chapter/${entry.chapterId}` : `/manga/${entry.mangaId}`}
                                                        className="flex items-center gap-3 rounded-xl border border-border/70 bg-card/50 p-3 transition-colors hover:border-primary/30 hover:bg-card"
                                                    >
                                                        {entry.mangaCover ? (
                                                            <img
                                                                src={entry.mangaCover}
                                                                alt={entry.mangaTitle}
                                                                className="h-14 w-10 shrink-0 rounded-lg object-cover"
                                                            />
                                                        ) : (
                                                            <div className="flex h-14 w-10 shrink-0 items-center justify-center rounded-lg bg-secondary/60">
                                                                <BookOpen className="h-4 w-4 text-muted-foreground" />
                                                            </div>
                                                        )}

                                                        <div className="min-w-0 flex-1">
                                                            <p className="line-clamp-1 font-medium">{entry.mangaTitle}</p>
                                                            <p className="mt-1 text-xs text-muted-foreground">
                                                                {entry.chapterNumber ? `Bölüm ${entry.chapterNumber}` : 'Okuma oturumu'}
                                                            </p>
                                                        </div>

                                                        <div className="text-right">
                                                            <p className="text-sm font-semibold">{formatReadingDuration(entry.secondsSpent)}</p>
                                                            <p className="text-[11px] text-muted-foreground">
                                                                {new Date(entry.readAt).toLocaleTimeString('tr-TR', {
                                                                    hour: '2-digit',
                                                                    minute: '2-digit',
                                                                })}
                                                            </p>
                                                        </div>
                                                    </Link>
                                                ))}

                                                {hiddenCount > 0 && (
                                                    <button
                                                        type="button"
                                                        onClick={() => setExpandedDays((prev) => ({ ...prev, [day.date]: !isExpanded }))}
                                                        className="pl-1 text-left text-xs font-medium text-primary transition-colors hover:text-primary/80"
                                                    >
                                                        {isExpanded ? 'Daha az göster' : `+${hiddenCount} kayıt daha`}
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        ) : (
                            <div className="rounded-2xl border border-dashed border-border bg-background/30 py-16 text-center">
                                <Clock3 className="mx-auto h-12 w-12 text-muted-foreground/60" />
                                <h2 className="mt-4 text-xl font-semibold">Bu aralıkta kayıt yok</h2>
                                <p className="mt-2 text-muted-foreground">
                                    Okudukça sürelerin burada gün gün görünmeye başlayacak.
                                </p>
                            </div>
                        )}
                    </Tabs>
                </div>
            </main>
        </div>
    );
};

export default ReadingTime;
