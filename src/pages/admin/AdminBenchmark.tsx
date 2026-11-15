import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    Activity,
    AlertTriangle,
    Check,
    Copy,
    Cpu,
    Download,
    Eye,
    Gauge,
    Monitor,
    Play,
    RotateCcw,
    Smartphone,
    Square,
    Timer,
    Zap,
} from 'lucide-react';
import {
    Bar,
    BarChart,
    CartesianGrid,
    Legend,
    Line,
    LineChart,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from 'recharts';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { useAdminPageGuard } from '@/hooks/useAdminPageGuard';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import {
    DEVICE_PROFILES,
    type BenchmarkProgressEvent,
    type BottleneckFinding,
    type FullBenchmarkReport,
    type MicroBenchmarkMetric,
    type RouteBenchmarkMetric,
    formatBenchmarkMarkdown,
    projectMetricForTier,
    runFullPerformanceBenchmark,
} from '@/lib/benchmark/perfBenchmark';
import {
    BASELINE_CDP_DESKTOP_REPORT,
    BASELINE_CDP_MOBILE_REPORT,
    MEASURED_CDP_4TIER_ROWS,
} from '@/lib/benchmark/baselineCdpReport';

const BENCHMARK_STORAGE_KEY = 'tp_admin_benchmark_reports_v1';

interface StoredBenchmarkSnapshot {
    desktop: FullBenchmarkReport | null;
    mobile: FullBenchmarkReport | null;
}

const loadStoredReports = (): StoredBenchmarkSnapshot | null => {
    try {
        const raw = window.localStorage.getItem(BENCHMARK_STORAGE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as StoredBenchmarkSnapshot;
        if (parsed && (parsed.desktop || parsed.mobile)) {
            return parsed;
        }
    } catch {
        // ignore corrupted cache
    }
    return null;
};

type RunPreset = 'desktop-and-projections' | 'mobile-and-projections' | 'dual-compare';
type MetricSortKey = 'severity' | 'totalMs' | 'tbtMs' | 'maxLongTaskMs' | 'minFps' | 'domNodes';

const SEVERITY_STYLES: Record<BottleneckFinding['severity'], string> = {
    Kritik: 'bg-red-500/15 text-red-400 border-red-500/30',
    Yüksek: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
    Orta: 'bg-sky-500/15 text-sky-400 border-sky-500/30',
    İyi: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
};

const shortRouteLabel = (name: string): string =>
    name
        .replace(/^SPA Geçiş:\s*/u, 'Geçiş: ')
        .replace(/^Aksiyon:\s*/u, 'Aksiyon: ')
        .replace(/\s*\([^)]*\)\s*$/u, '')
        .slice(0, 28);

const formatMs = (value: number | null | undefined): string => {
    if (value === null || value === undefined || !Number.isFinite(value)) return '—';
    return `${value.toLocaleString('tr-TR', { maximumFractionDigits: 1 })} ms`;
};

const AdminBenchmark: React.FC = () => {
    const { user } = useAuth();
    const { isAllowed, isLoading: guardLoading } = useAdminPageGuard({ requiredRole: 'admin' });

    const [runPreset, setRunPreset] = useState<RunPreset>('dual-compare');
    const [includeHeavyRefresh, setIncludeHeavyRefresh] = useState(true);
    const [includeAllSecondary, setIncludeAllSecondary] = useState(true);
    const [includeReader, setIncludeReader] = useState(true);
    const [showLiveFrame, setShowLiveFrame] = useState(true);

    const [isRunning, setIsRunning] = useState(false);
    const [progress, setProgress] = useState<BenchmarkProgressEvent | null>(null);
    const [liveRoutes, setLiveRoutes] = useState<RouteBenchmarkMetric[]>([]);
    const [liveMicros, setLiveMicros] = useState<MicroBenchmarkMetric[]>([]);

    const initialStored = useMemo(() => loadStoredReports(), []);
    const [reportSource, setReportSource] = useState<'baseline' | 'live'>(initialStored ? 'live' : 'baseline');
    const [desktopReport, setDesktopReport] = useState<FullBenchmarkReport | null>(
        () => initialStored?.desktop ?? BASELINE_CDP_DESKTOP_REPORT,
    );
    const [mobileReport, setMobileReport] = useState<FullBenchmarkReport | null>(
        () => initialStored?.mobile ?? BASELINE_CDP_MOBILE_REPORT,
    );
    const [activeReportTab, setActiveReportTab] = useState<'desktop' | 'mobile'>('desktop');
    const [sortBy, setSortBy] = useState<MetricSortKey>('tbtMs');
    const [copiedMd, setCopiedMd] = useState(false);
    const [activeFrameViewport, setActiveFrameViewport] = useState<'desktop' | 'mobile'>('desktop');

    const iframeRef = useRef<HTMLIFrameElement | null>(null);
    const abortRef = useRef<AbortController | null>(null);

    useEffect(() => {
        return () => {
            abortRef.current?.abort();
        };
    }, []);

    const activeReport = useMemo(() => {
        if (activeReportTab === 'mobile' && mobileReport) return mobileReport;
        return desktopReport ?? mobileReport;
    }, [activeReportTab, desktopReport, mobileReport]);

    const displayedRoutes = isRunning ? liveRoutes : activeReport?.routes ?? liveRoutes;
    const displayedMicros = isRunning ? liveMicros : activeReport?.micros ?? liveMicros;
    const displayedBottlenecks = isRunning ? [] : activeReport?.bottlenecks ?? [];

    const restoreBaselineReport = useCallback(() => {
        try {
            window.localStorage.removeItem(BENCHMARK_STORAGE_KEY);
        } catch {
            // ignore
        }
        setDesktopReport(BASELINE_CDP_DESKTOP_REPORT);
        setMobileReport(BASELINE_CDP_MOBILE_REPORT);
        setReportSource('baseline');
        setActiveReportTab('desktop');
        toast.info('Referans 4 kademeli CDP sonuçlarına dönüldü');
    }, []);

    const stopBenchmark = useCallback(() => {
        abortRef.current?.abort();
        abortRef.current = null;
        setIsRunning(false);
        setProgress((prev) =>
            prev
                ? {
                    ...prev,
                    phase: 'cancelled',
                    currentLabel: 'Benchmark kullanıcı tarafından durduruldu',
                }
                : null,
        );
        toast.info('Performans testi durduruldu');
    }, []);

    const startBenchmark = useCallback(async () => {
        const iframe = iframeRef.current;
        if (!iframe || isRunning) return;

        const controller = new AbortController();
        abortRef.current = controller;
        setIsRunning(true);
        setLiveRoutes([]);
        setLiveMicros([]);
        setDesktopReport(null);
        setMobileReport(null);

        let nextDesktop: FullBenchmarkReport | null = null;
        let nextMobile: FullBenchmarkReport | null = null;

        try {
            if (runPreset === 'desktop-and-projections' || runPreset === 'dual-compare') {
                setActiveFrameViewport('desktop');
                setActiveReportTab('desktop');
                const dReport = await runFullPerformanceBenchmark({
                    viewportMode: 'desktop',
                    includeHeavyNetworkRefresh: includeHeavyRefresh,
                    includeReaderRoute: includeReader,
                    includeAllSecondaryRoutes: includeAllSecondary,
                    currentUserId: user?.id ?? null,
                    iframeElement: iframe,
                    signal: controller.signal,
                    onProgress: (ev) => setProgress(ev),
                    onPartialMicro: (m) => setLiveMicros((prev) => [...prev, m]),
                    onPartialRoute: (r) => setLiveRoutes((prev) => [...prev, r]),
                });
                nextDesktop = dReport;
                setDesktopReport(dReport);
            }

            if (runPreset === 'mobile-and-projections' || runPreset === 'dual-compare') {
                if (runPreset === 'dual-compare') {
                    setLiveRoutes([]);
                    setLiveMicros([]);
                }
                setActiveFrameViewport('mobile');
                const mReport = await runFullPerformanceBenchmark({
                    viewportMode: 'mobile',
                    includeHeavyNetworkRefresh: runPreset === 'mobile-and-projections' ? includeHeavyRefresh : false,
                    includeReaderRoute: includeReader,
                    includeAllSecondaryRoutes: includeAllSecondary,
                    currentUserId: user?.id ?? null,
                    iframeElement: iframe,
                    signal: controller.signal,
                    onProgress: (ev) =>
                        setProgress({
                            ...ev,
                            currentLabel: `[Mobil 390×844] ${ev.currentLabel}`,
                        }),
                    onPartialMicro: (m) => setLiveMicros((prev) => [...prev, m]),
                    onPartialRoute: (r) => setLiveRoutes((prev) => [...prev, r]),
                });
                nextMobile = mReport;
                setMobileReport(mReport);
                if (runPreset === 'mobile-and-projections') {
                    setActiveReportTab('mobile');
                }
            }

            setReportSource('live');
            try {
                window.localStorage.setItem(
                    BENCHMARK_STORAGE_KEY,
                    JSON.stringify({ desktop: nextDesktop, mobile: nextMobile }),
                );
            } catch {
                // ignore storage quota errors
            }

            toast.success('Detaylı benchmark testi tamamlandı');
        } catch (err) {
            if ((err as Error)?.name !== 'AbortError') {
                console.error('Benchmark error:', err);
                toast.error('Benchmark çalıştırılırken hata oluştu');
            }
        } finally {
            setIsRunning(false);
            abortRef.current = null;
        }
    }, [
        includeAllSecondary,
        includeHeavyRefresh,
        includeReader,
        isRunning,
        runPreset,
        user?.id,
    ]);

    const handleDownloadJson = useCallback(() => {
        const payload = {
            generatedAt: new Date().toISOString(),
            desktop: desktopReport,
            mobile: mobileReport,
        };
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = `toonparrot-benchmark-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;
        anchor.click();
        URL.revokeObjectURL(url);
    }, [desktopReport, mobileReport]);

    const handleCopyMarkdown = useCallback(async () => {
        if (!activeReport) return;
        const parts: string[] = [];
        if (desktopReport) {
            parts.push('<!-- MASAÜSTÜ ÖLÇÜMÜ -->\n' + formatBenchmarkMarkdown(desktopReport));
        }
        if (mobileReport) {
            parts.push('<!-- MOBİL (390×844) ÖLÇÜMÜ -->\n' + formatBenchmarkMarkdown(mobileReport));
        }
        const md = parts.join('\n\n---\n\n') || formatBenchmarkMarkdown(activeReport);
        await navigator.clipboard.writeText(md);
        setCopiedMd(true);
        toast.success('Markdown raporu panoya kopyalandı');
        window.setTimeout(() => setCopiedMd(false), 2000);
    }, [activeReport, desktopReport, mobileReport]);

    const sortedRoutes = useMemo(() => {
        const cloned = [...displayedRoutes];
        cloned.sort((a, b) => {
            if (sortBy === 'minFps') return a.minFps - b.minFps;
            if (sortBy === 'domNodes') return b.domNodes - a.domNodes;
            if (sortBy === 'maxLongTaskMs') return b.maxLongTaskMs - a.maxLongTaskMs;
            if (sortBy === 'totalMs') return b.totalMs - a.totalMs;
            return b.tbtMs - a.tbtMs || b.maxLongTaskMs - a.maxLongTaskMs;
        });
        return cloned;
    }, [displayedRoutes, sortBy]);

    const summaryStats = useMemo(() => {
        const routes = displayedRoutes.filter((r) => r.status !== 'error' && r.status !== 'skipped');
        if (routes.length === 0) return null;

        const slowest = [...routes].sort((a, b) => b.totalMs - a.totalMs)[0];
        const maxBlock = [...routes].sort((a, b) => b.maxLongTaskMs - a.maxLongTaskMs)[0];
        const lowestFps = [...routes].sort((a, b) => a.minFps - b.minFps)[0];
        const heaviestDom = [...routes].sort((a, b) => b.domNodes - a.domNodes)[0];
        const totalLongTasks = routes.reduce((acc, r) => acc + r.longTaskCount, 0);
        const cpuIndexMicro = displayedMicros.find((m) => m.id === 'cpu-browse-index');

        return {
            slowest,
            maxBlock,
            lowestFps,
            heaviestDom,
            totalLongTasks,
            cpuIndexMicro,
        };
    }, [displayedMicros, displayedRoutes]);

    const routeChartData = useMemo(
        () =>
            displayedRoutes
                .filter((r) => r.status !== 'skipped')
                .slice(0, 14)
                .map((r) => ({
                    name: shortRouteLabel(r.name),
                    yuklemeMs: r.totalMs,
                    tbtMs: r.tbtMs,
                    maxBlokMs: r.maxLongTaskMs,
                })),
        [displayedRoutes],
    );

    const tierComparisonData = useMemo(() => {
        if (!isRunning && reportSource === 'baseline') {
            return MEASURED_CDP_4TIER_ROWS.slice(0, 7).map((row) => ({
                name: shortRouteLabel(row.test),
                pc1xMs: row.pc1xMs,
                mobil2xMs: row.mobil2xMs,
                mobil4xMs: row.mobil4xMs,
                mobil6xMs: row.mobil6xMs,
                pcFps: row.pc1xMinFps,
                mobil2xFps: row.mobil2xMinFps,
                mobil4xFps: row.mobil4xMinFps,
                mobil6xFps: row.mobil6xMinFps,
            }));
        }

        const targets = displayedRoutes.filter((r) =>
            [
                'route-home',
                'route-browse',
                'route-browse-alltime',
                'trans-detail-to-alltime',
                'trans-home-to-browse',
                'action-browse-genre',
                'route-manga-detail',
            ].includes(r.id),
        );
        const sourceList = targets.length > 0 ? targets : displayedRoutes.slice(0, 6);
        return sourceList.map((r) => {
            const p1 = projectMetricForTier(r, DEVICE_PROFILES[0]);
            const p2 = projectMetricForTier(r, DEVICE_PROFILES[1]);
            const p4 = projectMetricForTier(r, DEVICE_PROFILES[2]);
            const p6 = projectMetricForTier(r, DEVICE_PROFILES[3]);
            return {
                name: shortRouteLabel(r.name),
                pc1xMs: p1.effectiveMs,
                mobil2xMs: p2.effectiveMs,
                mobil4xMs: p4.effectiveMs,
                mobil6xMs: p6.effectiveMs,
                pcFps: p1.projectedFps,
                mobil2xFps: p2.projectedFps,
                mobil4xFps: p4.projectedFps,
                mobil6xFps: p6.projectedFps,
            };
        });
    }, [displayedRoutes, isRunning, reportSource]);

    const microChartData = useMemo(
        () =>
            displayedMicros
                .filter((m) => m.status === 'ok')
                .map((m) => ({
                    name: m.name.replace(/\([^)]*\)/gu, '').trim().slice(0, 32),
                    sureMs: m.durationMs,
                    kategori: m.category === 'cpu' ? 'CPU' : m.category === 'cache' ? 'IDB' : 'Ağ',
                })),
        [displayedMicros],
    );

    const pcVsMobileRows = useMemo(() => {
        if (!desktopReport || !mobileReport) return [];
        const mobileMap = new Map(mobileReport.routes.map((r) => [r.id, r]));
        return desktopReport.routes
            .map((d) => {
                const m = mobileMap.get(d.id);
                if (!m) return null;
                return { id: d.id, name: d.name, desktop: d, mobile: m };
            })
            .filter((item): item is { id: string; name: string; desktop: RouteBenchmarkMetric; mobile: RouteBenchmarkMetric } =>
                Boolean(item),
            );
    }, [desktopReport, mobileReport]);

    if (guardLoading || !isAllowed) {
        return (
            <div className="flex min-h-[360px] items-center justify-center">
                <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
            </div>
        );
    }

    const frameWidth = activeFrameViewport === 'mobile' ? 390 : 1280;
    const frameHeight = activeFrameViewport === 'mobile' ? 844 : 800;
    const frameScale = activeFrameViewport === 'mobile' ? 0.56 : 0.48;
    const progressPct = progress && progress.totalSteps > 0
        ? Math.min(100, Math.round((progress.completedSteps / progress.totalSteps) * 100))
        : 0;

    return (
        <div className="space-y-6">
            {/* Header & Controls */}
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight text-foreground">
                        Performans & Benchmark Laboratuvarı
                    </h1>
                    <p className="mt-1 text-sm text-muted-foreground">
                        Tüm sayfalar, SPA geçişleri, filtre/arama CPU maliyeti ve 4 kademeli cihaz profilleri için canlı ölçüm paketi
                    </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                    {!isRunning ? (
                        <Button onClick={startBenchmark} className="gap-2">
                            <Play className="h-4 w-4" />
                            Testi Başlat
                        </Button>
                    ) : (
                        <Button variant="destructive" onClick={stopBenchmark} className="gap-2">
                            <Square className="h-4 w-4" />
                            Durdur
                        </Button>
                    )}

                    <Button
                        variant="outline"
                        onClick={handleCopyMarkdown}
                        disabled={!activeReport || isRunning}
                        className="gap-2"
                    >
                        {copiedMd ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
                        Markdown Kopyala
                    </Button>

                    <Button
                        variant="outline"
                        onClick={handleDownloadJson}
                        disabled={(!desktopReport && !mobileReport) || isRunning}
                        className="gap-2"
                    >
                        <Download className="h-4 w-4" />
                        JSON İndir
                    </Button>

                    {reportSource === 'live' && !isRunning && (
                        <Button variant="ghost" onClick={restoreBaselineReport} className="gap-2 text-xs">
                            <RotateCcw className="h-3.5 w-3.5" />
                            Referans CDP Sonucuna Dön
                        </Button>
                    )}
                </div>
            </div>

            {/* Configuration Card */}
            <Card className="border-border/60 bg-card/70">
                <CardContent className="grid gap-4 pt-5 md:grid-cols-2 lg:grid-cols-5">
                    <div className="space-y-2">
                        <label className="text-xs font-medium text-muted-foreground">Cihaz & Ekran Modu</label>
                        <Select
                            value={runPreset}
                            onValueChange={(value) => setRunPreset(value as RunPreset)}
                            disabled={isRunning}
                        >
                            <SelectTrigger className="h-9 text-xs">
                                <SelectValue placeholder="Cihaz profili seçin" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="dual-compare">PC + Mobil Karşılaştırmalı (Önerilen)</SelectItem>
                                <SelectItem value="desktop-and-projections">Sadece PC (1440×900) + Mobil Projeksiyon</SelectItem>
                                <SelectItem value="mobile-and-projections">Sadece Mobil (390×844) + 2x/4x/6x Profil</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="flex items-center justify-between rounded-lg border border-border/50 bg-background/40 px-3 py-2">
                        <div className="pr-2">
                            <div className="text-xs font-medium">Soğuk Ağ Testi</div>
                            <div className="text-[11px] text-muted-foreground">Tüm katalog RPC yenilemesi</div>
                        </div>
                        <Switch checked={includeHeavyRefresh} onCheckedChange={setIncludeHeavyRefresh} disabled={isRunning} />
                    </div>

                    <div className="flex items-center justify-between rounded-lg border border-border/50 bg-background/40 px-3 py-2">
                        <div className="pr-2">
                            <div className="text-xs font-medium">Tüm İkincil Sayfalar</div>
                            <div className="text-[11px] text-muted-foreground">Kütüphane, Okuma Süresi, Listeler</div>
                        </div>
                        <Switch checked={includeAllSecondary} onCheckedChange={setIncludeAllSecondary} disabled={isRunning} />
                    </div>

                    <div className="flex items-center justify-between rounded-lg border border-border/50 bg-background/40 px-3 py-2">
                        <div className="pr-2">
                            <div className="text-xs font-medium">Bölüm Okuyucu</div>
                            <div className="text-[11px] text-muted-foreground">Okuyucu rotası dahil</div>
                        </div>
                        <Switch checked={includeReader} onCheckedChange={setIncludeReader} disabled={isRunning} />
                    </div>

                    <div className="flex items-center justify-between rounded-lg border border-border/50 bg-background/40 px-3 py-2">
                        <div className="pr-2">
                            <div className="text-xs font-medium">Canlı İzleme Ekranı</div>
                            <div className="text-[11px] text-muted-foreground">Testi görsel olarak izle</div>
                        </div>
                        <Switch checked={showLiveFrame} onCheckedChange={setShowLiveFrame} />
                    </div>
                </CardContent>
            </Card>

            {/* Sandbox Iframe + Live Stream (always composited so Chromium never throttles rAF!) */}
            <div
                className={cn(
                    showLiveFrame
                        ? 'rounded-xl border border-border/60 bg-card/70 p-4'
                        : 'pointer-events-none fixed left-0 top-0 -z-50 h-2 w-2 overflow-hidden opacity-[0.01]',
                )}
            >
                {showLiveFrame && (
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-border/40 pb-2.5">
                        <div className="flex items-center gap-2 text-xs font-medium text-foreground">
                            <Eye className="h-4 w-4 text-primary" />
                            <span>
                                Canlı Tarayıcı İzleme ({frameWidth}×{frameHeight}{' '}
                                {activeFrameViewport === 'mobile' ? 'Mobil' : 'Masaüstü'})
                            </span>
                        </div>
                        <div className="text-xs text-muted-foreground">
                            {isRunning ? progress?.currentLabel || 'Ölçüm sürüyor...' : 'Testi Başlat dediğinizde sayfalar ve aksiyonlar burada canlı akar'}
                        </div>
                    </div>
                )}

                <div className={cn(showLiveFrame && 'grid gap-4 xl:grid-cols-[auto_1fr]')}>
                    <div
                        className={cn(
                            showLiveFrame &&
                                'relative mx-auto overflow-hidden rounded-lg border border-border/60 bg-zinc-950 shadow-lg',
                        )}
                        style={
                            showLiveFrame
                                ? {
                                      width: Math.round(frameWidth * frameScale),
                                      height: Math.round(frameHeight * frameScale),
                                  }
                                : undefined
                        }
                    >
                        {showLiveFrame && !isRunning && (
                            <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-background/85 p-4 text-center backdrop-blur-[2px]">
                                <Monitor className="h-7 w-7 text-primary/80" />
                                <div className="text-xs font-medium text-foreground">Canlı İzleme Ekranı Hazır</div>
                                <div className="max-w-[260px] text-[11px] text-muted-foreground">
                                    Testi Başlat butonuna bastığınızda her rota, SPA geçişi ve filtre aksiyonu burada gerçek zamanlı görünür.
                                </div>
                            </div>
                        )}
                        <iframe
                            ref={iframeRef}
                            title="Performans Test Sandbox"
                            tabIndex={-1}
                            width={frameWidth}
                            height={frameHeight}
                            style={
                                showLiveFrame
                                    ? {
                                          width: `${frameWidth}px`,
                                          height: `${frameHeight}px`,
                                          transform: `scale(${frameScale})`,
                                          transformOrigin: 'top left',
                                          pointerEvents: 'none',
                                      }
                                    : {
                                          width: `${frameWidth}px`,
                                          height: `${frameHeight}px`,
                                          border: 0,
                                      }
                            }
                        />
                    </div>

                    {showLiveFrame && (
                        <div className="flex min-h-[240px] flex-col rounded-lg border border-border/50 bg-background/45 p-3">
                            <div className="mb-2 flex items-center justify-between text-xs font-medium text-foreground">
                                <span>Canlı Adım & Darboğaz Akışı</span>
                                <span className="text-[11px] text-muted-foreground">
                                    {displayedRoutes.length} ölçüm
                                </span>
                            </div>
                            <div className="max-h-[340px] flex-1 space-y-1.5 overflow-y-auto pr-1 text-xs">
                                {displayedRoutes.map((step) => (
                                    <div
                                        key={`${step.viewportMode}-${step.id}`}
                                        className="flex items-center justify-between gap-2 rounded border border-border/40 bg-card/60 px-2.5 py-1.5"
                                    >
                                        <div className="min-w-0 truncate font-medium text-foreground">{step.name}</div>
                                        <div className="flex shrink-0 items-center gap-3 text-[11px]">
                                            <span>{formatMs(step.totalMs)}</span>
                                            <span
                                                className={cn(
                                                    'font-semibold',
                                                    step.maxLongTaskMs >= 200
                                                        ? 'text-red-400'
                                                        : step.maxLongTaskMs >= 60
                                                            ? 'text-amber-400'
                                                            : 'text-emerald-400',
                                                )}
                                            >
                                                Blok: {formatMs(step.maxLongTaskMs)}
                                            </span>
                                            <span className="text-muted-foreground">{step.minFps} min FPS</span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Live Progress Bar */}
            {progress && (
                <Card className="border-primary/25 bg-card/80">
                    <CardContent className="space-y-2 pt-4">
                        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                            <span className="font-medium text-foreground">{progress.currentLabel}</span>
                            <span className="text-muted-foreground">
                                {progress.completedSteps} / {progress.totalSteps} (%{progressPct})
                            </span>
                        </div>
                        <Progress value={progressPct} className="h-2" />
                    </CardContent>
                </Card>
            )}

            {/* Desktop vs Mobile Report Switcher */}
            {(desktopReport || mobileReport) && !isRunning && (
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-2">
                        {desktopReport && (
                            <Button
                                size="sm"
                                variant={activeReportTab === 'desktop' ? 'default' : 'outline'}
                                onClick={() => setActiveReportTab('desktop')}
                                className="gap-1.5"
                            >
                                <Monitor className="h-3.5 w-3.5" />
                                Masaüstü ({desktopReport.durationSec}s)
                            </Button>
                        )}
                        {mobileReport && (
                            <Button
                                size="sm"
                                variant={activeReportTab === 'mobile' ? 'default' : 'outline'}
                                onClick={() => setActiveReportTab('mobile')}
                                className="gap-1.5"
                            >
                                <Smartphone className="h-3.5 w-3.5" />
                                Mobil 390×844 ({mobileReport.durationSec}s)
                            </Button>
                        )}
                    </div>
                    {activeReport && (
                        <div className="text-xs text-muted-foreground">
                            Kaynak:{' '}
                            <span className="font-medium text-foreground">
                                {reportSource === 'baseline' ? '4 Kademeli CDP Referans Ölçümü (1x/2x/4x/6x)' : 'Canlı Tarayıcı Testiniz'}
                            </span>
                            {activeReport.catalogSize > 0 && (
                                <>
                                    {' · '}Katalog: <span className="font-medium text-foreground">{activeReport.catalogSize} seri</span>
                                </>
                            )}
                            {' · '}Çekirdek: <span className="font-medium text-foreground">{activeReport.hardwareConcurrency} CPU</span>
                            {activeReport.deviceMemoryGb ? ` · ${activeReport.deviceMemoryGb} GB RAM` : ''}
                        </div>
                    )}
                </div>
            )}

            {/* KPI Cards */}
            {summaryStats && (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                    <Card className="border-border/60 bg-card/75">
                        <CardContent className="pt-4">
                            <div className="flex items-center justify-between text-xs text-muted-foreground">
                                <span>En Yavaş Adım</span>
                                <Timer className="h-4 w-4 text-amber-400" />
                            </div>
                            <div className="mt-1.5 text-xl font-bold text-foreground">{formatMs(summaryStats.slowest.totalMs)}</div>
                            <div className="mt-1 truncate text-[11px] text-muted-foreground">{summaryStats.slowest.name}</div>
                        </CardContent>
                    </Card>

                    <Card className="border-border/60 bg-card/75">
                        <CardContent className="pt-4">
                            <div className="flex items-center justify-between text-xs text-muted-foreground">
                                <span>En Uzun Blok (Long Task)</span>
                                <AlertTriangle className="h-4 w-4 text-red-400" />
                            </div>
                            <div className="mt-1.5 text-xl font-bold text-foreground">{formatMs(summaryStats.maxBlock.maxLongTaskMs)}</div>
                            <div className="mt-1 truncate text-[11px] text-muted-foreground">
                                TBT: {formatMs(summaryStats.maxBlock.tbtMs)} · {summaryStats.totalLongTasks} toplam blok
                            </div>
                        </CardContent>
                    </Card>

                    <Card className="border-border/60 bg-card/75">
                        <CardContent className="pt-4">
                            <div className="flex items-center justify-between text-xs text-muted-foreground">
                                <span>En Düşük Kare Hızı</span>
                                <Gauge className="h-4 w-4 text-sky-400" />
                            </div>
                            <div className="mt-1.5 text-xl font-bold text-foreground">{summaryStats.lowestFps.minFps} FPS</div>
                            <div className="mt-1 truncate text-[11px] text-muted-foreground">{summaryStats.lowestFps.name}</div>
                        </CardContent>
                    </Card>

                    <Card className="border-border/60 bg-card/75">
                        <CardContent className="pt-4">
                            <div className="flex items-center justify-between text-xs text-muted-foreground">
                                <span>Katalog İndeksleme (CPU)</span>
                                <Cpu className="h-4 w-4 text-purple-400" />
                            </div>
                            <div className="mt-1.5 text-xl font-bold text-foreground">
                                {summaryStats.cpuIndexMicro ? formatMs(summaryStats.cpuIndexMicro.durationMs) : '—'}
                            </div>
                            <div className="mt-1 truncate text-[11px] text-muted-foreground">
                                {summaryStats.cpuIndexMicro
                                    ? `6x Mobil: ~${Math.round(summaryStats.cpuIndexMicro.durationMs * 6)} ms`
                                    : 'Bekleniyor'}
                            </div>
                        </CardContent>
                    </Card>

                    <Card className="border-border/60 bg-card/75">
                        <CardContent className="pt-4">
                            <div className="flex items-center justify-between text-xs text-muted-foreground">
                                <span>En Yoğun DOM</span>
                                <Zap className="h-4 w-4 text-emerald-400" />
                            </div>
                            <div className="mt-1.5 text-xl font-bold text-foreground">
                                {summaryStats.heaviestDom.domNodes.toLocaleString('tr-TR')}
                            </div>
                            <div className="mt-1 truncate text-[11px] text-muted-foreground">{summaryStats.heaviestDom.name}</div>
                        </CardContent>
                    </Card>
                </div>
            )}

            {/* Main Visualizations & Tables */}
            {(displayedRoutes.length > 0 || displayedMicros.length > 0) && (
                <Tabs defaultValue="charts" className="space-y-4">
                    <TabsList className="grid w-full max-w-2xl grid-cols-4">
                        <TabsTrigger value="charts">Grafikler</TabsTrigger>
                        <TabsTrigger value="bottlenecks">Darboğazlar</TabsTrigger>
                        <TabsTrigger value="routes">Sayfa & Geçiş ({displayedRoutes.length})</TabsTrigger>
                        <TabsTrigger value="micros">CPU & Veri ({displayedMicros.length})</TabsTrigger>
                    </TabsList>

                    <TabsContent value="charts" className="space-y-4">
                        <div className="grid gap-4 lg:grid-cols-2">
                            <Card className="border-border/60 bg-card/75">
                                <CardHeader className="pb-2">
                                    <CardTitle className="text-sm font-semibold">
                                        Sayfa / Geçiş Süresi & Ana İş Parçacığı Blokajı (ms)
                                    </CardTitle>
                                </CardHeader>
                                <CardContent className="h-[340px]">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <BarChart data={routeChartData} margin={{ top: 10, right: 12, left: 0, bottom: 52 }}>
                                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
                                            <XAxis
                                                dataKey="name"
                                                tick={{ fill: '#9ca3af', fontSize: 10 }}
                                                angle={-30}
                                                textAnchor="end"
                                                interval={0}
                                                height={66}
                                            />
                                            <YAxis tick={{ fill: '#9ca3af', fontSize: 11 }} />
                                            <Tooltip
                                                contentStyle={{
                                                    backgroundColor: '#111827',
                                                    borderColor: 'rgba(255,255,255,0.12)',
                                                    borderRadius: 8,
                                                    fontSize: 12,
                                                }}
                                            />
                                            <Legend wrapperStyle={{ fontSize: 11 }} />
                                            <Bar dataKey="yuklemeMs" name="Toplam (ms)" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                                            <Bar dataKey="tbtMs" name="TBT Blokaj (ms)" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                                            <Bar dataKey="maxBlokMs" name="En Uzun Blok (ms)" fill="#ef4444" radius={[4, 4, 0, 0]} />
                                        </BarChart>
                                    </ResponsiveContainer>
                                </CardContent>
                            </Card>

                            <Card className="border-border/60 bg-card/75">
                                <CardHeader className="pb-2">
                                    <CardTitle className="text-sm font-semibold">
                                        4 Kademeli Cihaz Profilleri — Etkili Bekleme Süresi (PC 1x / Mobil 2x·4x·6x)
                                    </CardTitle>
                                </CardHeader>
                                <CardContent className="h-[340px]">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <BarChart data={tierComparisonData} margin={{ top: 10, right: 12, left: 0, bottom: 52 }}>
                                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
                                            <XAxis
                                                dataKey="name"
                                                tick={{ fill: '#9ca3af', fontSize: 10 }}
                                                angle={-25}
                                                textAnchor="end"
                                                interval={0}
                                                height={66}
                                            />
                                            <YAxis tick={{ fill: '#9ca3af', fontSize: 11 }} />
                                            <Tooltip
                                                contentStyle={{
                                                    backgroundColor: '#111827',
                                                    borderColor: 'rgba(255,255,255,0.12)',
                                                    borderRadius: 8,
                                                    fontSize: 12,
                                                }}
                                            />
                                            <Legend wrapperStyle={{ fontSize: 11 }} />
                                            <Bar dataKey="pc1xMs" name="PC (1x)" fill="#10b981" radius={[3, 3, 0, 0]} />
                                            <Bar dataKey="mobil2xMs" name="Yüksek Mobil (2x)" fill="#38bdf8" radius={[3, 3, 0, 0]} />
                                            <Bar dataKey="mobil4xMs" name="Orta Mobil (4x)" fill="#f59e0b" radius={[3, 3, 0, 0]} />
                                            <Bar dataKey="mobil6xMs" name="Düşük Mobil (6x)" fill="#ef4444" radius={[3, 3, 0, 0]} />
                                        </BarChart>
                                    </ResponsiveContainer>
                                </CardContent>
                            </Card>
                        </div>

                        <div className="grid gap-4 lg:grid-cols-2">
                            <Card className="border-border/60 bg-card/75">
                                <CardHeader className="pb-2">
                                    <CardTitle className="text-sm font-semibold">
                                        Cihaz Kademelerine Göre Tahmini Akıcılık (FPS)
                                    </CardTitle>
                                </CardHeader>
                                <CardContent className="h-[300px]">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <LineChart data={tierComparisonData} margin={{ top: 10, right: 12, left: 0, bottom: 48 }}>
                                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
                                            <XAxis
                                                dataKey="name"
                                                tick={{ fill: '#9ca3af', fontSize: 10 }}
                                                angle={-25}
                                                textAnchor="end"
                                                interval={0}
                                                height={62}
                                            />
                                            <YAxis domain={[0, 65]} tick={{ fill: '#9ca3af', fontSize: 11 }} />
                                            <Tooltip
                                                contentStyle={{
                                                    backgroundColor: '#111827',
                                                    borderColor: 'rgba(255,255,255,0.12)',
                                                    borderRadius: 8,
                                                    fontSize: 12,
                                                }}
                                            />
                                            <Legend wrapperStyle={{ fontSize: 11 }} />
                                            <Line type="monotone" dataKey="pcFps" name="PC (1x) FPS" stroke="#10b981" strokeWidth={2} />
                                            <Line type="monotone" dataKey="mobil2xFps" name="Mobil 2x FPS" stroke="#38bdf8" strokeWidth={2} />
                                            <Line type="monotone" dataKey="mobil4xFps" name="Mobil 4x FPS" stroke="#f59e0b" strokeWidth={2} />
                                            <Line type="monotone" dataKey="mobil6xFps" name="Mobil 6x FPS" stroke="#ef4444" strokeWidth={2} />
                                        </LineChart>
                                    </ResponsiveContainer>
                                </CardContent>
                            </Card>

                            <Card className="border-border/60 bg-card/75">
                                <CardHeader className="pb-2">
                                    <CardTitle className="text-sm font-semibold">
                                        Veri Katmanı, IDB Önbellek ve CPU İşlem Süreleri (ms)
                                    </CardTitle>
                                </CardHeader>
                                <CardContent className="h-[300px]">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <BarChart data={microChartData} layout="vertical" margin={{ top: 6, right: 16, left: 10, bottom: 6 }}>
                                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
                                            <XAxis type="number" tick={{ fill: '#9ca3af', fontSize: 11 }} />
                                            <YAxis type="category" dataKey="name" width={170} tick={{ fill: '#d1d5db', fontSize: 10 }} />
                                            <Tooltip
                                                contentStyle={{
                                                    backgroundColor: '#111827',
                                                    borderColor: 'rgba(255,255,255,0.12)',
                                                    borderRadius: 8,
                                                    fontSize: 12,
                                                }}
                                            />
                                            <Bar dataKey="sureMs" name="Süre (ms)" fill="#8b5cf6" radius={[0, 4, 4, 0]} />
                                        </BarChart>
                                    </ResponsiveContainer>
                                </CardContent>
                            </Card>
                        </div>
                    </TabsContent>

                    <TabsContent value="bottlenecks" className="space-y-4">
                        <Card className="border-border/60 bg-card/75">
                            <CardHeader className="pb-3">
                                <CardTitle className="flex items-center gap-2 text-base">
                                    <Activity className="h-4 w-4 text-primary" />
                                    Otomatik Darboğaz & Donma Teşhisi
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-2.5">
                                {displayedBottlenecks.length === 0 ? (
                                    <div className="py-8 text-center text-sm text-muted-foreground">
                                        Rapor tamamlandığında sıralı teşhis listesi burada oluşturulur.
                                    </div>
                                ) : (
                                    displayedBottlenecks.map((item) => (
                                        <div
                                            key={item.id}
                                            className="flex flex-col gap-2 rounded-lg border border-border/50 bg-background/40 p-3 sm:flex-row sm:items-center sm:justify-between"
                                        >
                                            <div className="space-y-1">
                                                <div className="flex flex-wrap items-center gap-2">
                                                    <span
                                                        className={cn(
                                                            'rounded border px-2 py-0.5 text-[11px] font-semibold',
                                                            SEVERITY_STYLES[item.severity],
                                                        )}
                                                    >
                                                        {item.severity}
                                                    </span>
                                                    <span className="text-xs font-medium text-muted-foreground">{item.area}</span>
                                                    <span className="text-sm font-semibold text-foreground">{item.target}</span>
                                                </div>
                                                <p className="text-xs text-muted-foreground">{item.summary}</p>
                                            </div>
                                            <div className="flex shrink-0 flex-wrap items-center gap-4 text-xs">
                                                <div>
                                                    <div className="text-muted-foreground">Ölçülen</div>
                                                    <div className="font-semibold text-foreground">{formatMs(item.measuredMs)}</div>
                                                </div>
                                                <div>
                                                    <div className="text-muted-foreground">Max Blok</div>
                                                    <div className="font-semibold text-red-400">{formatMs(item.maxLongTaskMs)}</div>
                                                </div>
                                                <div>
                                                    <div className="text-muted-foreground">TBT</div>
                                                    <div className="font-semibold text-amber-400">{formatMs(item.tbtMs)}</div>
                                                </div>
                                                <div>
                                                    <div className="text-muted-foreground">6x Mobil</div>
                                                    <div className="font-semibold text-sky-400">{formatMs(item.mobile6xEffectiveMs)}</div>
                                                </div>
                                            </div>
                                        </div>
                                    ))
                                )}
                            </CardContent>
                        </Card>

                        {pcVsMobileRows.length > 0 && (
                            <Card className="border-border/60 bg-card/75">
                                <CardHeader className="pb-3">
                                    <CardTitle className="text-base">PC (1440×900) vs Mobil (390×844) Canlı Karşılaştırma</CardTitle>
                                </CardHeader>
                                <CardContent className="overflow-x-auto">
                                    <table className="w-full text-left text-xs">
                                        <thead>
                                            <tr className="border-b border-border/60 text-muted-foreground">
                                                <th className="py-2 pr-3">Sayfa / Geçiş</th>
                                                <th className="py-2 pr-3 text-right">PC Toplam</th>
                                                <th className="py-2 pr-3 text-right">Mobil Toplam</th>
                                                <th className="py-2 pr-3 text-right">PC TBT</th>
                                                <th className="py-2 pr-3 text-right">Mobil TBT</th>
                                                <th className="py-2 pr-3 text-right">PC FPS</th>
                                                <th className="py-2 pr-3 text-right">Mobil FPS</th>
                                                <th className="py-2 text-right">DOM (PC / Mobil)</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {pcVsMobileRows.map((row) => (
                                                <tr key={row.id} className="border-b border-border/30 hover:bg-muted/20">
                                                    <td className="py-2 pr-3 font-medium text-foreground">{row.name}</td>
                                                    <td className="py-2 pr-3 text-right">{formatMs(row.desktop.totalMs)}</td>
                                                    <td className="py-2 pr-3 text-right font-medium text-amber-300">
                                                        {formatMs(row.mobile.totalMs)}
                                                    </td>
                                                    <td className="py-2 pr-3 text-right">{formatMs(row.desktop.tbtMs)}</td>
                                                    <td className="py-2 pr-3 text-right text-red-400">{formatMs(row.mobile.tbtMs)}</td>
                                                    <td className="py-2 pr-3 text-right">{row.desktop.minFps}</td>
                                                    <td className="py-2 pr-3 text-right">{row.mobile.minFps}</td>
                                                    <td className="py-2 text-right text-muted-foreground">
                                                        {row.desktop.domNodes} / {row.mobile.domNodes}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </CardContent>
                            </Card>
                        )}
                    </TabsContent>

                    <TabsContent value="routes">
                        <Card className="border-border/60 bg-card/75">
                            <CardHeader className="flex flex-col gap-3 pb-3 sm:flex-row sm:items-center sm:justify-between">
                                <CardTitle className="text-base">Tüm Sayfa, Geçiş ve Etkileşim Metrikleri</CardTitle>
                                <div className="w-48">
                                    <Select value={sortBy} onValueChange={(v) => setSortBy(v as MetricSortKey)}>
                                        <SelectTrigger className="h-8 text-xs">
                                            <SelectValue placeholder="Sırala" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="tbtMs">TBT Blokajına Göre</SelectItem>
                                            <SelectItem value="maxLongTaskMs">En Uzun Bloka Göre</SelectItem>
                                            <SelectItem value="totalMs">Toplam Süreye Göre</SelectItem>
                                            <SelectItem value="minFps">En Düşük FPS’e Göre</SelectItem>
                                            <SelectItem value="domNodes">DOM Düğüm Sayısına Göre</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                            </CardHeader>
                            <CardContent className="overflow-x-auto">
                                <table className="w-full min-w-[960px] text-left text-xs">
                                    <thead>
                                        <tr className="border-b border-border/60 text-muted-foreground">
                                            <th className="py-2 pr-3">Tür</th>
                                            <th className="py-2 pr-3">Rota / Aksiyon</th>
                                            <th className="py-2 pr-3 text-right">Toplam</th>
                                            <th className="py-2 pr-3 text-right">FCP / LCP</th>
                                            <th className="py-2 pr-3 text-right">Blok (#)</th>
                                            <th className="py-2 pr-3 text-right">Max Blok</th>
                                            <th className="py-2 pr-3 text-right">TBT</th>
                                            <th className="py-2 pr-3 text-right">Ort / Min FPS</th>
                                            <th className="py-2 pr-3 text-right">DOM</th>
                                            <th className="py-2 pr-3 text-right">Ağ / KB</th>
                                            <th className="py-2 text-right">6x Mobil</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {sortedRoutes.map((route) => {
                                            const tier6 = projectMetricForTier(route, DEVICE_PROFILES[3]);
                                            return (
                                                <tr key={route.id} className="border-b border-border/30 hover:bg-muted/20">
                                                    <td className="py-2 pr-3 uppercase text-[10px] text-muted-foreground">{route.kind}</td>
                                                    <td className="py-2 pr-3">
                                                        <div className="font-medium text-foreground">{route.name}</div>
                                                        <div className="text-[11px] text-muted-foreground">{route.note || route.path}</div>
                                                    </td>
                                                    <td className="py-2 pr-3 text-right font-medium">{formatMs(route.totalMs)}</td>
                                                    <td className="py-2 pr-3 text-right text-muted-foreground">
                                                        {route.fcpMs !== null ? `${route.fcpMs}` : '—'} / {route.lcpMs !== null ? `${route.lcpMs}` : '—'}
                                                    </td>
                                                    <td className="py-2 pr-3 text-right">{route.longTaskCount}</td>
                                                    <td
                                                        className={cn(
                                                            'py-2 pr-3 text-right font-semibold',
                                                            route.maxLongTaskMs >= 200
                                                                ? 'text-red-400'
                                                                : route.maxLongTaskMs >= 80
                                                                    ? 'text-amber-400'
                                                                    : 'text-emerald-400',
                                                        )}
                                                    >
                                                        {formatMs(route.maxLongTaskMs)}
                                                    </td>
                                                    <td className="py-2 pr-3 text-right font-semibold text-amber-300">
                                                        {formatMs(route.tbtMs)}
                                                    </td>
                                                    <td className="py-2 pr-3 text-right">
                                                        {route.avgFps} / <span className="text-muted-foreground">{route.minFps}</span>
                                                    </td>
                                                    <td className="py-2 pr-3 text-right">{route.domNodes.toLocaleString('tr-TR')}</td>
                                                    <td className="py-2 pr-3 text-right text-muted-foreground">
                                                        {route.networkRequests} / {route.transferKb} KB
                                                    </td>
                                                    <td className="py-2 text-right font-medium text-sky-400">
                                                        {formatMs(tier6.effectiveMs)} · {tier6.jankRisk}
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </CardContent>
                        </Card>
                    </TabsContent>

                    <TabsContent value="micros">
                        <Card className="border-border/60 bg-card/75">
                            <CardHeader className="pb-3">
                                <CardTitle className="text-base">Veri Katmanı, IndexedDB ve CPU Mikro Ölçümleri</CardTitle>
                            </CardHeader>
                            <CardContent className="overflow-x-auto">
                                <table className="w-full min-w-[780px] text-left text-xs">
                                    <thead>
                                        <tr className="border-b border-border/60 text-muted-foreground">
                                            <th className="py-2 pr-3">Katman</th>
                                            <th className="py-2 pr-3">İşlem</th>
                                            <th className="py-2 pr-3 text-right">Ölçülen Süre</th>
                                            <th className="py-2 pr-3 text-right">Öğe Sayısı</th>
                                            <th className="py-2 pr-3 text-right">Birim / Yük</th>
                                            <th className="py-2 text-right">6x Düşük Mobil</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {displayedMicros.map((m) => (
                                            <tr key={m.id} className="border-b border-border/30 hover:bg-muted/20">
                                                <td className="py-2 pr-3 uppercase text-[10px] text-muted-foreground">{m.category}</td>
                                                <td className="py-2 pr-3">
                                                    <div className="font-medium text-foreground">{m.name}</div>
                                                    <div className="text-[11px] text-muted-foreground">{m.note}</div>
                                                </td>
                                                <td className="py-2 pr-3 text-right font-semibold">{formatMs(m.durationMs)}</td>
                                                <td className="py-2 pr-3 text-right">{m.itemCount.toLocaleString('tr-TR')}</td>
                                                <td className="py-2 pr-3 text-right text-muted-foreground">
                                                    {m.perItemUs ? `${m.perItemUs} µs/öğe` : m.payloadKb ? `${m.payloadKb} KB` : '—'}
                                                </td>
                                                <td className="py-2 text-right text-sky-400">
                                                    {m.category === 'network' ? formatMs(m.durationMs) : formatMs(m.durationMs * 6)}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </CardContent>
                        </Card>
                    </TabsContent>
                </Tabs>
            )}
        </div>
    );
};

export default AdminBenchmark;
