import React from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import {
    BookOpen,
    CalendarDays,
    Clock3,
    Flame,
    Info,
    LayoutGrid,
    LineChart as LineChartIcon,
    List,
} from 'lucide-react';
import Header from '@/components/layout/Header';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import {
    ReadingTimeDayBucket,
    ReadingTimeEntry,
    ReadingTimeHistoryMonth,
    ReadingTimeHistoryWeek,
    ReadingTimeOverview,
    ReadingTimeRange,
    formatReadingDuration,
    getReadingTimeHistoryCalendar,
    getReadingTimeOverview,
    getReadingTimeTimeline,
} from '@/lib/profile';
import OfflineRequiredScreen from '@/components/offline/OfflineRequiredScreen';
import { useEffectiveOnlineStatus } from '@/hooks/useEffectiveOnlineStatus';

const RANGE_LABELS: Record<ReadingTimeRange, string> = {
    today: 'Bugün',
    week: 'Haftalık',
    month: 'Aylık',
    all: 'Tüm Zaman',
};

const VIEW_TRANSITION = {
    duration: 0.24,
    ease: [0.22, 1, 0.36, 1] as const,
};

const DAY_PANEL_MOTION = {
    initial: { opacity: 0, y: 14, scale: 0.985 },
    animate: { opacity: 1, y: 0, scale: 1 },
    exit: { opacity: 0, y: -8, scale: 0.992 },
    transition: VIEW_TRANSITION,
};

type ReadingTimeView = 'line' | 'grid' | 'list';

const VIEW_OPTIONS: Array<{
    value: ReadingTimeView;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    description: string;
}> = [
        {
            value: 'line',
            label: 'Çizgi',
            icon: LineChartIcon,
            description: 'Her nokta bir günü temsil eder.',
        },
        {
            value: 'grid',
            label: 'Izgara',
            icon: LayoutGrid,
            description: 'Her kare bir günü temsil eder.',
        },
        {
            value: 'list',
            label: 'Liste',
            icon: List,
            description: 'Madde madde günlük döküm görünümü.',
        },
    ];

interface ReadingChartDatum {
    date: string;
    label: string;
    shortLabel: string;
    seconds: number;
    minutes: number;
    chapters: number;
    seriesCount: number;
}

const parseDateKey = (value: string) => {
    const [year, month, day] = value.split('-').map(Number);
    return new Date(year, (month || 1) - 1, day || 1);
};

const getDateKey = (value: Date) => {
    const year = value.getFullYear();
    const month = `${value.getMonth() + 1}`.padStart(2, '0');
    const day = `${value.getDate()}`.padStart(2, '0');

    return `${year}-${month}-${day}`;
};

const getMonthKey = (value: Date) => `${value.getFullYear()}-${`${value.getMonth() + 1}`.padStart(2, '0')}`;

const formatWeekRange = (startDate: string, endDate: string) => {
    const start = parseDateKey(startDate);
    const end = parseDateKey(endDate);
    const sameMonth = start.getFullYear() === end.getFullYear() && start.getMonth() === end.getMonth();

    if (sameMonth) {
        return `${start.toLocaleDateString('tr-TR', { day: 'numeric' })} - ${end.toLocaleDateString('tr-TR', {
            day: 'numeric',
            month: 'long',
            year: 'numeric',
        })}`;
    }

    return `${start.toLocaleDateString('tr-TR', {
        day: 'numeric',
        month: 'short',
    })} - ${end.toLocaleDateString('tr-TR', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
    })}`;
};

const formatCompactReadingDuration = (seconds: number) => {
    const normalized = Math.max(0, Math.round(seconds));
    const hours = Math.floor(normalized / 3600);
    const minutes = Math.floor((normalized % 3600) / 60);

    if (hours <= 0) {
        return `${minutes} dk`;
    }

    if (minutes <= 0) {
        return `${hours} sa`;
    }

    return `${hours} sa ${minutes} dk`;
};

const formatChartAxisMinutes = (minutes: number) => {
    const normalized = Math.max(0, Number(minutes) || 0);

    if (normalized >= 60) {
        return `${Math.round(normalized / 60)} sa`;
    }

    return `${Math.round(normalized)} dk`;
};

const getChartTickLabel = (date: string, range: ReadingTimeRange) => {
    const resolvedDate = parseDateKey(date);

    if (range === 'today') {
        return 'Bugün';
    }

    if (range === 'week') {
        return resolvedDate.toLocaleDateString('tr-TR', {
            weekday: 'short',
        }).replace('.', '');
    }

    return resolvedDate.toLocaleDateString('tr-TR', {
        day: 'numeric',
        month: 'short',
    });
};

const buildSquareDateParts = (date: string) => {
    const resolvedDate = parseDateKey(date);

    return {
        weekday: resolvedDate.toLocaleDateString('tr-TR', { weekday: 'short' }).replace('.', ''),
        day: resolvedDate.toLocaleDateString('tr-TR', { day: '2-digit' }),
        month: resolvedDate.toLocaleDateString('tr-TR', { month: 'short' }),
    };
};

const OverviewCard = ({
    label,
    value,
    accentClassName,
    index,
}: {
    label: string;
    value: string;
    accentClassName: string;
    index: number;
}) => (
    <div
        className="animate-fade-up aspect-[1.05/1] min-h-[8.5rem] rounded-3xl border border-border bg-card/50 p-4 opacity-0 sm:aspect-auto sm:min-h-0 sm:rounded-2xl sm:p-5"
        style={{ animationDelay: `${0.1 + index * 0.03}s`, animationFillMode: 'forwards' }}
    >
        <p className="line-clamp-2 text-sm leading-snug text-muted-foreground">{label}</p>
        <p className={`mt-2 break-words text-[clamp(1.55rem,5.4vw,2rem)] font-bold leading-tight ${accentClassName}`}>
            {value}
        </p>
    </div>
);

const ReadingEntryCard = ({ entry }: { entry: ReadingTimeEntry }) => (
    <Link
        to={entry.chapterId ? `/manga/${entry.mangaId}/chapter/${entry.chapterId}` : `/manga/${entry.mangaId}`}
        className="flex items-start gap-3 rounded-xl border border-border/70 bg-card/50 p-2.5 transition-colors hover:border-primary/30 hover:bg-card sm:items-center sm:p-3"
    >
        {entry.mangaCover ? (
            <img
                src={entry.mangaCover}
                alt={entry.mangaTitle}
                className="h-12 w-9 shrink-0 rounded-lg object-cover sm:h-14 sm:w-10"
            />
        ) : (
            <div className="flex h-12 w-9 shrink-0 items-center justify-center rounded-lg bg-secondary/60 sm:h-14 sm:w-10">
                <BookOpen className="h-4 w-4 text-muted-foreground" />
            </div>
        )}

        <div className="min-w-0 flex-1">
            <p className="line-clamp-1 text-sm font-medium sm:text-base">{entry.mangaTitle}</p>
            <p className="mt-1 text-[11px] text-muted-foreground sm:text-xs">
                {entry.chapterNumber ? `Bölüm ${entry.chapterNumber}` : 'Okuma oturumu'}
            </p>
        </div>

        <div className="shrink-0 text-right">
            <p className="text-sm font-semibold leading-tight">{formatReadingDuration(entry.secondsSpent)}</p>
            <p className="text-[11px] text-muted-foreground">
                {new Date(entry.readAt).toLocaleTimeString('tr-TR', {
                    hour: '2-digit',
                    minute: '2-digit',
                })}
            </p>
        </div>
    </Link>
);

const SelectedDayPanel = ({
    day,
    title,
}: {
    day: ReadingTimeDayBucket;
    title: string;
}) => (
    <motion.div
        {...DAY_PANEL_MOTION}
        className="rounded-2xl border border-border bg-background/40 p-4 sm:p-5"
    >
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-primary/80">{title}</p>
                <h3 className="mt-1 text-xl font-bold capitalize tracking-tight">{day.label}</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                    {new Date(`${day.date}T00:00:00`).toLocaleDateString('tr-TR', {
                        weekday: 'long',
                        day: 'numeric',
                        month: 'long',
                        year: 'numeric',
                    })}
                </p>
            </div>

            <div className="text-left lg:text-right">
                <p className="text-2xl font-bold text-primary">{formatReadingDuration(day.seconds)}</p>
                <p className="text-xs text-muted-foreground">Toplam okuma süresi</p>
            </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
            <Badge variant="outline">{day.chapters} bölüm</Badge>
            <Badge variant="outline">{day.seriesCount} seri</Badge>
            <Badge variant="outline">{day.entries.length} oturum</Badge>
        </div>

        <div className="mt-4 space-y-2">
            {day.entries.map((entry) => (
                <ReadingEntryCard key={entry.id} entry={entry} />
            ))}
        </div>
    </motion.div>
);

const ReadingTrendChart = ({
    data,
    selectedDate,
    onSelect,
}: {
    data: ReadingChartDatum[];
    selectedDate: string | null;
    onSelect: (date: string) => void;
}) => {
    const width = 760;
    const height = 280;
    const padding = { top: 18, right: 18, bottom: 40, left: 42 };
    const innerWidth = width - padding.left - padding.right;
    const innerHeight = height - padding.top - padding.bottom;
    const maxMinutes = Math.max(...data.map((item) => item.minutes), 1);
    const guideCount = 4;
    const tickStride = data.length > 72
        ? Math.ceil(data.length / 12)
        : data.length > 30
            ? 4
            : data.length > 16
                ? 2
                : 1;

    const points = data.map((item, index) => {
        const x = data.length === 1
            ? padding.left + innerWidth / 2
            : padding.left + (index / Math.max(data.length - 1, 1)) * innerWidth;
        const y = padding.top + innerHeight - (item.minutes / maxMinutes) * innerHeight;

        return {
            ...item,
            x,
            y,
        };
    });

    const linePath = points
        .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`)
        .join(' ');
    const areaPath = points.length > 0
        ? `${linePath} L ${points[points.length - 1].x} ${padding.top + innerHeight} L ${points[0].x} ${padding.top + innerHeight} Z`
        : '';

    const selectedPoint = points.find((point) => point.date === selectedDate) ?? points[0] ?? null;

    return (
        <div className="space-y-4">
            <div className="rounded-2xl border border-border/70 bg-background/35 p-3 sm:p-4">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 pb-3">
                    <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-primary/75">Trend</p>
                        <p className="mt-1 text-sm text-muted-foreground">
                            Noktalara basarak o günün detayını seçebilirsin.
                        </p>
                    </div>
                    <AnimatePresence mode="wait" initial={false}>
                        {selectedPoint && (
                            <motion.div
                                key={selectedPoint.date}
                                initial={{ opacity: 0, y: 8, scale: 0.98 }}
                                animate={{ opacity: 1, y: 0, scale: 1 }}
                                exit={{ opacity: 0, y: -6, scale: 0.98 }}
                                transition={VIEW_TRANSITION}
                                className="rounded-xl border border-primary/20 bg-primary/10 px-3 py-2 text-right"
                            >
                                <p className="text-xs text-muted-foreground">{selectedPoint.label}</p>
                                <p className="text-sm font-semibold text-primary">{formatReadingDuration(selectedPoint.seconds)}</p>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>

                <div className="mt-4 overflow-hidden">
                    <svg
                        viewBox={`0 0 ${width} ${height}`}
                        className="h-[15rem] w-full sm:h-[18rem]"
                        role="img"
                        aria-label="Okuma süresi çizgi grafiği"
                    >
                        <defs>
                            <linearGradient id="reading-trend-fill" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity="0.26" />
                                <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity="0.02" />
                            </linearGradient>
                        </defs>

                        {Array.from({ length: guideCount + 1 }).map((_, index) => {
                            const ratio = index / guideCount;
                            const y = padding.top + ratio * innerHeight;
                            const minutes = Math.round(maxMinutes * (1 - ratio));

                            return (
                                <g key={index}>
                                    <line
                                        x1={padding.left}
                                        y1={y}
                                        x2={width - padding.right}
                                        y2={y}
                                        stroke="hsl(var(--border))"
                                        strokeDasharray="4 6"
                                        opacity="0.55"
                                    />
                                    <text
                                        x={padding.left - 10}
                                        y={y + 4}
                                        textAnchor="end"
                                        className="fill-muted-foreground text-[11px]"
                                    >
                                        {formatChartAxisMinutes(minutes)}
                                    </text>
                                </g>
                            );
                        })}

                        {areaPath && <path d={areaPath} fill="url(#reading-trend-fill)" />}
                        {linePath && (
                            <path
                                d={linePath}
                                fill="none"
                                stroke="hsl(var(--primary))"
                                strokeWidth="4"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                            />
                        )}

                        {points.map((point, index) => {
                            const isSelected = point.date === selectedPoint?.date;
                            const shouldRenderLabel = isSelected
                                || index === 0
                                || index === points.length - 1
                                || index % tickStride === 0;

                            return (
                                <g
                                    key={point.date}
                                    role="button"
                                    tabIndex={0}
                                    onClick={() => onSelect(point.date)}
                                    onKeyDown={(event) => {
                                        if (event.key === 'Enter' || event.key === ' ') {
                                            event.preventDefault();
                                            onSelect(point.date);
                                        }
                                    }}
                                    className="cursor-pointer outline-none"
                                >
                                    <motion.circle
                                        cx={point.x}
                                        cy={point.y}
                                        animate={{
                                            r: isSelected ? 10 : 8,
                                            strokeWidth: isSelected ? 4 : 3,
                                            opacity: isSelected ? 1 : 0.95,
                                        }}
                                        transition={VIEW_TRANSITION}
                                        fill="hsl(var(--background))"
                                        stroke="hsl(var(--primary))"
                                    />
                                    <motion.circle
                                        cx={point.x}
                                        cy={point.y}
                                        animate={{ r: isSelected ? 4.5 : 3.25 }}
                                        transition={VIEW_TRANSITION}
                                        fill="hsl(var(--primary))"
                                    />
                                    {shouldRenderLabel && (
                                        <text
                                            x={point.x}
                                            y={height - 10}
                                            textAnchor="middle"
                                            className={cn(
                                                'text-[11px] transition-colors duration-200',
                                                isSelected ? 'fill-primary' : 'fill-muted-foreground',
                                            )}
                                        >
                                            {point.shortLabel}
                                        </text>
                                    )}
                                </g>
                            );
                        })}
                    </svg>
                </div>
            </div>

            <AnimatePresence mode="wait" initial={false}>
                {selectedPoint && (
                    <motion.div
                        key={selectedPoint.date}
                        initial={{ opacity: 0, y: 12 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -8 }}
                        transition={VIEW_TRANSITION}
                        className="grid grid-cols-2 gap-3 sm:grid-cols-4"
                    >
                        <div className="rounded-2xl border border-border bg-background/35 px-4 py-3">
                            <p className="text-xs text-muted-foreground">Okuma süresi</p>
                            <p className="mt-1 text-lg font-semibold text-primary">{formatReadingDuration(selectedPoint.seconds)}</p>
                        </div>
                        <div className="rounded-2xl border border-border bg-background/35 px-4 py-3">
                            <p className="text-xs text-muted-foreground">Bölüm</p>
                            <p className="mt-1 text-lg font-semibold">{selectedPoint.chapters}</p>
                        </div>
                        <div className="rounded-2xl border border-border bg-background/35 px-4 py-3">
                            <p className="text-xs text-muted-foreground">Seri</p>
                            <p className="mt-1 text-lg font-semibold">{selectedPoint.seriesCount}</p>
                        </div>
                        <div className="rounded-2xl border border-border bg-background/35 px-4 py-3">
                            <p className="text-xs text-muted-foreground">Tarih</p>
                            <p className="mt-1 text-sm font-semibold">{new Date(`${selectedPoint.date}T00:00:00`).toLocaleDateString('tr-TR')}</p>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
};

const ReadingTime: React.FC = () => {
    const { user } = useAuth();
    const { isOnline } = useEffectiveOnlineStatus();
    const [range, setRange] = React.useState<ReadingTimeRange>('week');
    const [view, setView] = React.useState<ReadingTimeView>('line');
    const [expandedDays, setExpandedDays] = React.useState<Record<string, boolean>>({});
    const [selectedDayDate, setSelectedDayDate] = React.useState<string | null>(null);
    const [customWeek, setCustomWeek] = React.useState<ReadingTimeHistoryWeek | null>(null);
    const [historyMonths, setHistoryMonths] = React.useState<ReadingTimeHistoryMonth[]>([]);
    const [calendarMonthKey, setCalendarMonthKey] = React.useState<string | null>(null);
    const [isHistoryLoading, setIsHistoryLoading] = React.useState(true);
    const [isWeekPickerOpen, setIsWeekPickerOpen] = React.useState(false);
    const [overview, setOverview] = React.useState<ReadingTimeOverview>({
        todaySeconds: 0,
        weekSeconds: 0,
        monthSeconds: 0,
        allTimeSeconds: 0,
    });
    const [timeline, setTimeline] = React.useState<ReadingTimeDayBucket[]>([]);
    const [isOverviewLoading, setIsOverviewLoading] = React.useState(true);
    const [isTimelineLoading, setIsTimelineLoading] = React.useState(true);

    if (user && !isOnline) {
        return (
            <OfflineRequiredScreen
                description="Okuma süresi istatistikleri güvenlik nedeniyle sadece internet bağlantısıyla görüntülenebilir."
                actionHref="/history"
                actionLabel="Okuma Geçmişine Git"
            />
        );
    }

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

        void loadOverview();
    }, [user]);

    React.useEffect(() => {
        if (!user) {
            setHistoryMonths([]);
            setCalendarMonthKey(null);
            setCustomWeek(null);
            setIsHistoryLoading(false);
            return;
        }

        const loadHistoryMonths = async () => {
            try {
                setIsHistoryLoading(true);
                const months = await getReadingTimeHistoryCalendar(user.id);
                setHistoryMonths(months);
                setCalendarMonthKey((current) => (
                    current && months.some((month) => month.monthKey === current)
                        ? current
                        : months[0]?.monthKey ?? null
                ));
                setCustomWeek((current) => {
                    if (!current) {
                        return null;
                    }

                    const resolvedWeek = months
                        .find((month) => month.monthKey === current.monthKey)
                        ?.weeks.find((week) => week.id === current.id);

                    return resolvedWeek || null;
                });
            } catch (error) {
                console.error('Reading time history calendar page error:', error);
            } finally {
                setIsHistoryLoading(false);
            }
        };

        void loadHistoryMonths();
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
                const data = await getReadingTimeTimeline(
                    user.id,
                    range,
                    customWeek
                        ? {
                            startDate: customWeek.startDate,
                            endDate: customWeek.endDate,
                        }
                        : undefined,
                );
                setTimeline(data);
            } catch (error) {
                console.error('Reading time timeline page error:', error);
            } finally {
                setIsTimelineLoading(false);
            }
        };

        void loadTimeline();
    }, [customWeek, range, user]);

    React.useEffect(() => {
        if (timeline.length === 0) {
            setSelectedDayDate(null);
            return;
        }

        setSelectedDayDate((current) => (
            current && timeline.some((day) => day.date === current)
                ? current
                : timeline[0].date
        ));
    }, [timeline]);

    const sortedTimeline = React.useMemo(
        () => [...timeline].sort((left, right) => new Date(left.date).getTime() - new Date(right.date).getTime()),
        [timeline],
    );

    const chartData = React.useMemo(() => (
        sortedTimeline.map((day) => ({
            date: day.date,
            label: day.label,
            shortLabel: getChartTickLabel(day.date, customWeek ? 'week' : range),
            seconds: day.seconds,
            minutes: Number((day.seconds / 60).toFixed(1)),
            chapters: day.chapters,
            seriesCount: day.seriesCount,
        }))
    ), [customWeek, range, sortedTimeline]);

    const selectedDay = React.useMemo(
        () => timeline.find((day) => day.date === selectedDayDate) || null,
        [selectedDayDate, timeline],
    );

    const selectedHistoryMonth = React.useMemo(
        () => historyMonths.find((month) => month.monthKey === calendarMonthKey) || historyMonths[0] || null,
        [calendarMonthKey, historyMonths],
    );

    const selectedHistoryMonthDate = React.useMemo(
        () => selectedHistoryMonth ? parseDateKey(selectedHistoryMonth.monthDate) : null,
        [selectedHistoryMonth],
    );

    const selectedHistoryActiveDateSet = React.useMemo(
        () => new Set(selectedHistoryMonth?.activeDates || []),
        [selectedHistoryMonth],
    );

    const calendarHighlightedDates = React.useMemo(
        () => (selectedHistoryMonth?.activeDates || []).map((dateKey) => parseDateKey(dateKey)),
        [selectedHistoryMonth],
    );

    const selectedCustomWeekDates = React.useMemo(
        () => customWeek && selectedHistoryMonth?.monthKey === customWeek.monthKey
            ? customWeek.activeDates.map((dateKey) => parseDateKey(dateKey))
            : [],
        [customWeek, selectedHistoryMonth],
    );

    const activeRangeLabel = customWeek ? `${customWeek.monthLabel} • ${customWeek.label}` : RANGE_LABELS[range];
    const activeRangeDetail = customWeek ? formatWeekRange(customWeek.startDate, customWeek.endDate) : null;

    const applyHistoricalWeek = React.useCallback((week: ReadingTimeHistoryWeek) => {
        setCustomWeek(week);
        setIsWeekPickerOpen(false);
    }, []);

    const handleCalendarDateSelect = React.useCallback((date?: Date) => {
        if (!date || !selectedHistoryMonth) {
            return;
        }

        const matchingWeek = selectedHistoryMonth.weeks.find((week) => week.activeDates.includes(getDateKey(date)));
        if (matchingWeek) {
            applyHistoricalWeek(matchingWeek);
        }
    }, [applyHistoricalWeek, selectedHistoryMonth]);

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
                <div className="mb-6 flex flex-col gap-4 lg:mb-8 lg:flex-row lg:items-end lg:justify-between">
                    <div>
                        <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                            <Clock3 className="h-6 w-6" />
                        </div>
                        <h1 className="text-3xl font-bold tracking-tight">Okuma Süresi</h1>
                        <p className="mt-2 max-w-2xl text-muted-foreground">
                            Bugün, haftalık, aylık ve tüm zaman okuma süreni farklı görünümlerle takip et. Çizgi, ızgara ve liste arasında geçip günlük yoğunluğu daha rahat görebilirsin.
                        </p>
                    </div>

                    <div className="rounded-2xl border border-border bg-card/40 px-4 py-3 text-sm text-muted-foreground">
                        <div>
                            Aktif görünüm: <span className="font-semibold text-foreground">{activeRangeLabel}</span>
                        </div>
                        {activeRangeDetail && (
                            <div className="mt-1 text-xs text-muted-foreground">{activeRangeDetail}</div>
                        )}
                    </div>
                </div>

                {isOverviewLoading ? (
                    <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-2 xl:grid-cols-4">
                        {Array.from({ length: 4 }).map((_, index) => (
                            <Skeleton key={index} className="aspect-[1.05/1] rounded-3xl sm:h-28 sm:aspect-auto sm:rounded-2xl" />
                        ))}
                    </div>
                ) : (
                    <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-2 xl:grid-cols-4">
                        <OverviewCard label="Bugün" value={formatReadingDuration(overview.todaySeconds)} accentClassName="text-primary" index={0} />
                        <OverviewCard label="Bu Hafta" value={formatReadingDuration(overview.weekSeconds)} accentClassName="text-sky-400" index={1} />
                        <OverviewCard label="Bu Ay" value={formatReadingDuration(overview.monthSeconds)} accentClassName="text-emerald-400" index={2} />
                        <OverviewCard label="Tüm Zaman" value={formatReadingDuration(overview.allTimeSeconds)} accentClassName="text-amber-400" index={3} />
                    </div>
                )}

                <div
                    className="mt-6 animate-fade-up rounded-3xl border border-border bg-card/35 p-4 opacity-0 sm:mt-8 sm:p-5 md:p-6"
                    style={{ animationDelay: '0.18s', animationFillMode: 'forwards' }}
                >
                    <Tabs
                        value={range}
                        onValueChange={(value) => {
                            setRange(value as ReadingTimeRange);
                            setCustomWeek(null);
                        }}
                        className="space-y-5 sm:space-y-6"
                    >
                        <TabsList className="grid h-auto w-full grid-cols-2 gap-2 rounded-2xl bg-secondary/40 p-1 sm:flex sm:flex-wrap">
                            <TabsTrigger value="today" className="w-full whitespace-normal px-2 py-2 text-center text-xs leading-tight sm:w-auto sm:px-3 sm:text-sm sm:whitespace-nowrap">
                                Bugün
                            </TabsTrigger>
                            <TabsTrigger value="week" className="w-full whitespace-normal px-2 py-2 text-center text-xs leading-tight sm:w-auto sm:px-3 sm:text-sm sm:whitespace-nowrap">
                                Haftalık
                            </TabsTrigger>
                            <TabsTrigger value="month" className="w-full whitespace-normal px-2 py-2 text-center text-xs leading-tight sm:w-auto sm:px-3 sm:text-sm sm:whitespace-nowrap">
                                Aylık
                            </TabsTrigger>
                            <TabsTrigger value="all" className="w-full whitespace-normal px-2 py-2 text-center text-xs leading-tight sm:w-auto sm:px-3 sm:text-sm sm:whitespace-nowrap">
                                Tüm Zaman
                            </TabsTrigger>
                        </TabsList>

                        <div className="rounded-2xl border border-border bg-background/25 p-3">
                            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                                <div>
                                    <p className="text-sm font-semibold">Geçmişten Hafta Bul</p>
                                    <p className="hidden text-xs text-muted-foreground sm:block">
                                        Hızlı filtreler üstte kalır. Daha eski bir haftayı arıyorsan takvimden, sadece kayıt olan aylara gidip seçebilirsin.
                                    </p>
                                    <p className="text-xs text-muted-foreground sm:hidden">
                                        Eski haftalar için takvimden seçim yap.
                                    </p>
                                </div>

                                <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
                                    <Popover open={isWeekPickerOpen} onOpenChange={setIsWeekPickerOpen}>
                                        <PopoverTrigger asChild>
                                            <Button
                                                type="button"
                                                variant={customWeek ? 'default' : 'outline'}
                                                size="sm"
                                                className="w-full justify-center gap-2 sm:w-auto"
                                            >
                                                <CalendarDays className="h-4 w-4" />
                                                Takvimden Hafta Seç
                                            </Button>
                                        </PopoverTrigger>

                                        <PopoverContent
                                            align="center"
                                            side="bottom"
                                            className="w-[calc(100vw-1rem)] max-h-[85vh] max-w-[32rem] overflow-hidden rounded-2xl border-border bg-card p-0"
                                        >
                                            <div className="border-b border-border/70 px-4 py-4">
                                                <p className="text-sm font-semibold">Geçmişten Hafta Seç</p>
                                                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                                                    Sadece okuma kaydı olan aylar listelenir. Bir güne dokunarak veya doğrudan hafta kartını seçerek o dönemi açabilirsin.
                                                </p>
                                            </div>

                                            <ScrollArea className="max-h-[calc(85vh-4.5rem)]">
                                                <div className="space-y-4 p-4">
                                                {isHistoryLoading ? (
                                                    <div className="space-y-3">
                                                        <Skeleton className="h-10 rounded-xl" />
                                                        <Skeleton className="h-[19rem] rounded-2xl" />
                                                        <Skeleton className="h-28 rounded-2xl" />
                                                    </div>
                                                ) : selectedHistoryMonth && selectedHistoryMonthDate ? (
                                                    <>
                                                        <div className="space-y-2">
                                                            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-primary/75">Kayıtlı Ay</p>
                                                            <Select value={selectedHistoryMonth.monthKey} onValueChange={setCalendarMonthKey}>
                                                                <SelectTrigger className="h-11 rounded-xl border-border bg-background/70">
                                                                    <SelectValue placeholder="Ay seç" />
                                                                </SelectTrigger>
                                                                <SelectContent>
                                                                    {historyMonths.map((month) => (
                                                                        <SelectItem key={month.monthKey} value={month.monthKey}>
                                                                            {month.label}
                                                                        </SelectItem>
                                                                    ))}
                                                                </SelectContent>
                                                            </Select>
                                                        </div>

                                                        <div className="rounded-2xl border border-border bg-background/45">
                                                            <Calendar
                                                                mode="single"
                                                                month={selectedHistoryMonthDate}
                                                                fromMonth={selectedHistoryMonthDate}
                                                                toMonth={selectedHistoryMonthDate}
                                                                selected={customWeek?.monthKey === selectedHistoryMonth.monthKey
                                                                    ? parseDateKey(customWeek.activeDates[customWeek.activeDates.length - 1] || customWeek.startDate)
                                                                    : undefined}
                                                                onSelect={handleCalendarDateSelect}
                                                                showOutsideDays={false}
                                                                disabled={(date) => !selectedHistoryActiveDateSet.has(getDateKey(date))}
                                                                modifiers={{
                                                                    hasData: calendarHighlightedDates,
                                                                    selectedWeek: selectedCustomWeekDates,
                                                                }}
                                                                modifiersClassNames={{
                                                                    hasData: 'bg-primary/10 text-foreground hover:bg-primary/15',
                                                                    selectedWeek: 'bg-primary text-primary-foreground hover:bg-primary',
                                                                }}
                                                                className="mx-auto scale-[0.96] sm:scale-100"
                                                                classNames={{
                                                                    months: 'flex flex-col',
                                                                    month: 'space-y-3',
                                                                    table: 'w-full border-collapse space-y-1',
                                                                    head_cell: 'text-muted-foreground rounded-md w-8 text-[0.7rem] font-normal sm:w-9 sm:text-[0.8rem]',
                                                                    cell: 'h-8 w-8 p-0 text-center text-sm sm:h-9 sm:w-9',
                                                                    day: 'h-8 w-8 p-0 text-xs font-normal aria-selected:opacity-100 sm:h-9 sm:w-9 sm:text-sm',
                                                                    day_disabled: 'text-muted-foreground/25 opacity-30',
                                                                }}
                                                            />
                                                        </div>

                                                        <div className="space-y-2">
                                                            <div className="flex items-center justify-between">
                                                                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-primary/75">
                                                                    Ayın Haftaları
                                                                </p>
                                                                <Badge variant="outline">{selectedHistoryMonth.weeks.length} hafta</Badge>
                                                            </div>

                                                            <ScrollArea className="max-h-60 rounded-2xl border border-border bg-background/25">
                                                                <div className="space-y-2 p-2">
                                                                    {selectedHistoryMonth.weeks.map((week) => {
                                                                        const isActive = customWeek?.id === week.id;

                                                                        return (
                                                                            <button
                                                                                key={week.id}
                                                                                type="button"
                                                                                onClick={() => applyHistoricalWeek(week)}
                                                                                className={cn(
                                                                                    'w-full rounded-2xl border px-3 py-3 text-left transition-[transform,background-color,border-color,box-shadow] duration-300 ease-out hover:-translate-y-0.5 hover:border-primary/35 hover:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                                                                                    isActive
                                                                                        ? 'border-primary/40 bg-primary/10 shadow-[0_12px_28px_rgba(59,130,246,0.14)]'
                                                                                        : 'border-border bg-background/40',
                                                                                )}
                                                                            >
                                                                                <div className="flex items-start justify-between gap-3">
                                                                                    <div>
                                                                                        <p className="text-sm font-semibold">{week.label}</p>
                                                                                        <p className="mt-1 text-xs text-muted-foreground">
                                                                                            {formatWeekRange(week.startDate, week.endDate)}
                                                                                        </p>
                                                                                    </div>
                                                                                    <Badge variant="outline">{week.activeDayCount} aktif gün</Badge>
                                                                                </div>
                                                                            </button>
                                                                        );
                                                                    })}
                                                                </div>
                                                            </ScrollArea>
                                                        </div>
                                                    </>
                                                ) : (
                                                    <div className="rounded-2xl border border-dashed border-border bg-background/30 px-4 py-10 text-center">
                                                        <CalendarDays className="mx-auto h-9 w-9 text-muted-foreground/60" />
                                                        <p className="mt-3 text-sm font-semibold">Henüz seçim yapılacak geçmiş hafta yok</p>
                                                        <p className="mt-1 text-xs text-muted-foreground">
                                                            Okuma kaydı oluştukça burada ay ve hafta bazlı geçmişin görünecek.
                                                        </p>
                                                    </div>
                                                )}
                                                </div>
                                            </ScrollArea>
                                        </PopoverContent>
                                    </Popover>

                                    {customWeek && (
                                        <>
                                            <Badge variant="outline" className="max-w-full self-start sm:self-auto">
                                                {customWeek.monthLabel} • {customWeek.label}
                                            </Badge>
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="sm"
                                                className="justify-center sm:justify-start"
                                                onClick={() => setCustomWeek(null)}
                                            >
                                                Özel Haftayı Kapat
                                            </Button>
                                        </>
                                    )}
                                </div>
                            </div>
                        </div>

                        <div className="rounded-2xl border border-border bg-background/30 p-3">
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                <div>
                                    <p className="text-sm font-semibold">Görünüm tipi</p>
                                    <p className="text-xs text-muted-foreground">
                                        Çizgi, ızgara veya liste görünümüne geç.
                                    </p>
                                </div>
                                <div className="grid w-full grid-cols-3 gap-2 sm:w-auto">
                                    {VIEW_OPTIONS.map((option) => {
                                        const Icon = option.icon;

                                        return (
                                            <Button
                                                key={option.value}
                                                type="button"
                                                variant={view === option.value ? 'default' : 'outline'}
                                                size="sm"
                                                className="justify-center gap-1.5 px-2 text-xs sm:justify-start sm:gap-2 sm:px-3 sm:text-sm"
                                                onClick={() => setView(option.value)}
                                            >
                                                <Icon className="h-4 w-4" />
                                                {option.label}
                                            </Button>
                                        );
                                    })}
                                </div>
                            </div>
                            <p className="mt-3 text-xs text-muted-foreground">
                                {VIEW_OPTIONS.find((option) => option.value === view)?.description}
                                {(view === 'line' || view === 'grid') && timeline.length > 0 ? ' Detay görmek için gün seçebilirsin.' : ''}
                                {timeline.length > 24 && view !== 'list' ? ' Çok daha eski haftalar için üstteki takvim seçiciyi kullanman daha rahat olur.' : ''}
                            </p>
                        </div>

                        <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3">
                            <div className="animate-fade-up aspect-[1.02/1] min-h-[8rem] rounded-3xl border border-border bg-background/40 p-4 opacity-0 sm:aspect-auto sm:min-h-0 sm:rounded-2xl" style={{ animationDelay: '0.22s', animationFillMode: 'forwards' }}>
                                <div className="flex items-center gap-2 text-muted-foreground">
                                    <Flame className="h-4 w-4 text-primary" />
                                    <span className="line-clamp-2 text-sm leading-snug">Seçili Süre</span>
                                </div>
                                <p className="mt-3 break-words text-[clamp(1.45rem,5.2vw,2rem)] font-bold leading-tight">{formatReadingDuration(selectedTotalSeconds)}</p>
                            </div>
                            <div className="animate-fade-up aspect-[1.02/1] min-h-[8rem] rounded-3xl border border-border bg-background/40 p-4 opacity-0 sm:aspect-auto sm:min-h-0 sm:rounded-2xl" style={{ animationDelay: '0.26s', animationFillMode: 'forwards' }}>
                                <div className="flex items-center gap-2 text-muted-foreground">
                                    <CalendarDays className="h-4 w-4 text-sky-400" />
                                    <span className="line-clamp-2 text-sm leading-snug">Aktif Gün</span>
                                </div>
                                <p className="mt-3 break-words text-[clamp(1.45rem,5.2vw,2rem)] font-bold leading-tight">{timeline.length}</p>
                            </div>
                            <div className="animate-fade-up col-span-2 aspect-[2.08/1] min-h-[8rem] rounded-3xl border border-border bg-background/40 p-4 opacity-0 sm:aspect-auto sm:min-h-0 sm:rounded-2xl md:col-span-1" style={{ animationDelay: '0.3s', animationFillMode: 'forwards' }}>
                                <div className="flex items-center gap-2 text-muted-foreground">
                                    <LineChartIcon className="h-4 w-4 text-emerald-400" />
                                    <span className="line-clamp-2 text-sm leading-snug">En Yoğun Gün</span>
                                </div>
                                <p className="mt-3 break-words text-[clamp(1.45rem,5.2vw,2rem)] font-bold leading-tight">
                                    {maxDaySeconds > 0 ? formatReadingDuration(maxDaySeconds) : '0 sn'}
                                </p>
                            </div>
                        </div>

                        {isTimelineLoading ? (
                            <div className="space-y-4">
                                {Array.from({ length: 5 }).map((_, index) => (
                                    <Skeleton key={index} className="h-32 rounded-2xl sm:h-36" />
                                ))}
                            </div>
                        ) : timeline.length > 0 ? (
                            <AnimatePresence mode="wait" initial={false}>
                                {view === 'line' && (
                                    <motion.div
                                        key="reading-time-line"
                                        initial={{ opacity: 0, y: 14 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        exit={{ opacity: 0, y: -10 }}
                                        transition={VIEW_TRANSITION}
                                        className="space-y-4"
                                    >
                                        <div className="flex items-center justify-between gap-3">
                                            <div>
                                                <h2 className="text-lg font-semibold">Günlük Trend Grafiği</h2>
                                                <p className="text-sm text-muted-foreground">
                                                    Her çizgi noktası bir günü temsil eder, seçtiğin günün detayları aşağıda açılır.
                                                </p>
                                            </div>
                                            <Badge variant="outline">{chartData.length} gün</Badge>
                                        </div>

                                        <ReadingTrendChart
                                            data={chartData}
                                            selectedDate={selectedDayDate}
                                            onSelect={setSelectedDayDate}
                                        />

                                        <AnimatePresence mode="wait" initial={false}>
                                            {selectedDay && (
                                                <SelectedDayPanel
                                                    key={selectedDay.date}
                                                    day={selectedDay}
                                                    title="Grafikten Seçilen Gün"
                                                />
                                            )}
                                        </AnimatePresence>
                                    </motion.div>
                                )}

                                {view === 'grid' && (
                                    <motion.div
                                        key="reading-time-grid"
                                        initial={{ opacity: 0, y: 14 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        exit={{ opacity: 0, y: -10 }}
                                        transition={VIEW_TRANSITION}
                                        className="space-y-4"
                                    >
                                        <div className="flex items-start gap-3 rounded-2xl border border-border bg-background/30 px-4 py-3 text-sm text-muted-foreground">
                                            <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                                            <p>Her kare bir günü temsil eder. Güne basınca detay paneli aşağıda açılır.</p>
                                        </div>

                                        <div className={cn(
                                            'rounded-2xl border border-border bg-background/20 p-3',
                                            timeline.length > 24 && 'max-h-[48rem] overflow-y-auto',
                                        )}>
                                            <div className="grid grid-cols-2 gap-3 min-[430px]:grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
                                                {timeline.map((day, index) => {
                                                    const dateParts = buildSquareDateParts(day.date);
                                                    const isSelected = day.date === selectedDayDate;

                                                    return (
                                                        <button
                                                            key={day.date}
                                                            type="button"
                                                            onClick={() => setSelectedDayDate(day.date)}
                                                            className={cn(
                                                                'animate-fade-up aspect-square rounded-2xl border p-3 text-left opacity-0 transition-[transform,background-color,border-color,box-shadow] duration-300 ease-out hover:-translate-y-0.5 hover:border-primary/40 hover:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                                                                isSelected
                                                                    ? 'scale-[1.015] -translate-y-0.5 border-primary/45 bg-primary/10 shadow-[0_10px_24px_rgba(59,130,246,0.12),0_0_0_1px_rgba(59,130,246,0.18)]'
                                                                    : 'border-border bg-background/40',
                                                            )}
                                                            style={{
                                                                animationDelay: `${0.06 + Math.min(index, 15) * 0.02}s`,
                                                                animationFillMode: 'forwards',
                                                                contentVisibility: 'auto',
                                                                containIntrinsicSize: '180px',
                                                            }}
                                                        >
                                                            <div className="flex h-full flex-col justify-between">
                                                                <div>
                                                                    <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                                                                        {dateParts.weekday}
                                                                    </p>
                                                                    <p className="mt-2 text-2xl font-bold leading-none">{dateParts.day}</p>
                                                                    <p className="mt-1 text-xs text-muted-foreground">{dateParts.month}</p>
                                                                </div>

                                                                <div>
                                                                    <p className="text-sm font-semibold text-primary">{formatCompactReadingDuration(day.seconds)}</p>
                                                                    <p className="mt-1 text-[11px] text-muted-foreground">{day.chapters} bölüm</p>
                                                                </div>
                                                            </div>
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        </div>

                                        <AnimatePresence mode="wait" initial={false}>
                                            {selectedDay && (
                                                <SelectedDayPanel
                                                    key={selectedDay.date}
                                                    day={selectedDay}
                                                    title="Seçili Gün"
                                                />
                                            )}
                                        </AnimatePresence>
                                    </motion.div>
                                )}

                                {view === 'list' && (
                                    <motion.div
                                        key="reading-time-list"
                                        initial={{ opacity: 0, y: 14 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        exit={{ opacity: 0, y: -10 }}
                                        transition={VIEW_TRANSITION}
                                        className="space-y-4"
                                    >
                                        {timeline.map((day, index) => {
                                            const width = maxDaySeconds > 0 ? Math.max((day.seconds / maxDaySeconds) * 100, 6) : 0;
                                            const isExpanded = Boolean(expandedDays[day.date]);
                                            const visibleEntries = isExpanded ? day.entries : day.entries.slice(0, 4);
                                            const hiddenCount = Math.max(day.entries.length - 4, 0);

                                            return (
                                                <div
                                                    key={day.date}
                                                    className="animate-fade-up rounded-2xl border border-border bg-background/40 p-3 opacity-0 sm:p-4"
                                                    style={{
                                                        animationDelay: `${0.08 + Math.min(index, 10) * 0.03}s`,
                                                        animationFillMode: 'forwards',
                                                        contentVisibility: 'auto',
                                                        containIntrinsicSize: '320px',
                                                    }}
                                                >
                                                    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                                                        <div className="min-w-0">
                                                            <p className="text-base font-semibold capitalize leading-tight sm:text-lg">{day.label}</p>
                                                            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                                                                <Badge variant="outline">{day.chapters} bölüm</Badge>
                                                                <Badge variant="outline">{day.seriesCount} seri</Badge>
                                                                <span>{new Date(`${day.date}T00:00:00`).toLocaleDateString('tr-TR')}</span>
                                                            </div>
                                                        </div>

                                                        <div className="min-w-0 text-left md:min-w-[10rem] md:text-right">
                                                            <p className="break-words text-lg font-bold leading-tight text-primary sm:text-xl">{formatReadingDuration(day.seconds)}</p>
                                                            <p className="text-xs text-muted-foreground">{activeRangeLabel} görünümünde</p>
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
                                                            <ReadingEntryCard key={entry.id} entry={entry} />
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
                                    </motion.div>
                                )}
                            </AnimatePresence>
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
