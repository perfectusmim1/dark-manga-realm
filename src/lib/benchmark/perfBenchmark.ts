import {
    getAllTimeMangaRanks,
    getFastHomeCatalogPage,
    getHomePageMangaSections,
    getMangaById,
    getMangaDetailMeta,
    getMangaSummaries,
} from '@/lib/database';
import { readPersistedQueryCache } from '@/lib/persistedQueryCache';
import { normalizeGenreName } from '@/lib/mockData';
import { matchesMangaPreparedSearch, prepareSearchQuery, rankTopMangaMatches } from '@/lib/searchMatching';
import type { Manga } from '@/lib/types';

export type DeviceTierId = 'desktop-1x' | 'mobile-high-2x' | 'mobile-mid-4x' | 'mobile-low-6x';

export interface DeviceTierProfile {
    id: DeviceTierId;
    label: string;
    shortLabel: string;
    cpuMultiplier: number;
    viewportWidth: number;
    viewportHeight: number;
    targetFps: number;
    frameBudgetMs: number;
    isMobile: boolean;
    deviceNote: string;
}

export const DEVICE_PROFILES: readonly DeviceTierProfile[] = [
    {
        id: 'desktop-1x',
        label: 'PC / Masaüstü (1x)',
        shortLabel: 'PC (1x)',
        cpuMultiplier: 1,
        viewportWidth: 1440,
        viewportHeight: 900,
        targetFps: 60,
        frameBudgetMs: 16.67,
        isMobile: false,
        deviceNote: '1440×900 · Doğal CPU hızı',
    },
    {
        id: 'mobile-high-2x',
        label: 'Yüksek Mobil (2x)',
        shortLabel: 'Mobil 2x',
        cpuMultiplier: 2,
        viewportWidth: 390,
        viewportHeight: 844,
        targetFps: 60,
        frameBudgetMs: 16.67,
        isMobile: true,
        deviceNote: '390×844 · 2x CPU yük modeli',
    },
    {
        id: 'mobile-mid-4x',
        label: 'Orta Mobil (4x)',
        shortLabel: 'Mobil 4x',
        cpuMultiplier: 4,
        viewportWidth: 390,
        viewportHeight: 844,
        targetFps: 60,
        frameBudgetMs: 16.67,
        isMobile: true,
        deviceNote: '390×844 · 4x CPU yük modeli',
    },
    {
        id: 'mobile-low-6x',
        label: 'Düşük Mobil (6x)',
        shortLabel: 'Mobil 6x',
        cpuMultiplier: 6,
        viewportWidth: 360,
        viewportHeight: 780,
        targetFps: 60,
        frameBudgetMs: 16.67,
        isMobile: true,
        deviceNote: '360×780 · 6x CPU yük modeli',
    },
] as const;

export const getDeviceProfile = (id: DeviceTierId): DeviceTierProfile =>
    DEVICE_PROFILES.find((item) => item.id === id) ?? DEVICE_PROFILES[0];

export interface RouteBenchmarkMetric {
    id: string;
    name: string;
    path: string;
    kind: 'route' | 'transition' | 'action';
    viewportMode: 'desktop' | 'mobile';
    status: 'ok' | 'timeout' | 'skipped' | 'error';
    note?: string;
    totalMs: number;
    ttfbMs: number;
    fcpMs: number | null;
    lcpMs: number | null;
    cls: number;
    tbtMs: number;
    longTaskCount: number;
    maxLongTaskMs: number;
    avgFps: number;
    minFps: number;
    maxFrameDeltaMs: number;
    droppedFrames16ms: number;
    frozenFrames100ms: number;
    domNodes: number;
    imageCount: number;
    networkRequests: number;
    apiRequests: number;
    transferKb: number;
    heapUsedMb: number | null;
}

export interface MicroBenchmarkMetric {
    id: string;
    name: string;
    category: 'cache' | 'network' | 'cpu';
    durationMs: number;
    itemCount: number;
    payloadKb?: number;
    perItemUs?: number;
    note: string;
    status: 'ok' | 'error';
}

export interface TierScaledProjection {
    tierId: DeviceTierId;
    label: string;
    shortLabel: string;
    cpuMultiplier: number;
    effectiveMs: number;
    projectedTbtMs: number;
    projectedMaxTaskMs: number;
    projectedFps: number;
    jankRisk: 'Akıcı' | 'Orta' | 'Yüksek' | 'Donma';
}

export interface BottleneckFinding {
    id: string;
    severity: 'Kritik' | 'Yüksek' | 'Orta' | 'İyi';
    area: string;
    target: string;
    measuredMs: number;
    maxLongTaskMs: number;
    tbtMs: number;
    mobile6xEffectiveMs: number;
    summary: string;
}

export interface FullBenchmarkReport {
    startedAt: string;
    finishedAt: string;
    durationSec: number;
    userAgent: string;
    hardwareConcurrency: number;
    deviceMemoryGb: number | null;
    activeViewportMode: 'desktop' | 'mobile';
    sampleMangaTitle: string;
    sampleMangaId: string;
    catalogSize: number;
    routes: RouteBenchmarkMetric[];
    micros: MicroBenchmarkMetric[];
    bottlenecks: BottleneckFinding[];
}

export interface BenchmarkProgressEvent {
    phase: 'preparing' | 'micro' | 'routes' | 'complete' | 'cancelled';
    currentLabel: string;
    completedSteps: number;
    totalSteps: number;
}

export interface RunBenchmarkOptions {
    viewportMode: 'desktop' | 'mobile';
    includeHeavyNetworkRefresh?: boolean;
    includeReaderRoute?: boolean;
    includeAllSecondaryRoutes?: boolean;
    currentUserId?: string | null;
    iframeElement: HTMLIFrameElement;
    signal: AbortSignal;
    onProgress?: (event: BenchmarkProgressEvent) => void;
    onPartialRoute?: (metric: RouteBenchmarkMetric) => void;
    onPartialMicro?: (metric: MicroBenchmarkMetric) => void;
}

interface LayoutShiftEntry extends PerformanceEntry {
    value: number;
    hadRecentInput: boolean;
}

interface ChromeMemoryInfo {
    usedJSHeapSize: number;
    totalJSHeapSize: number;
}

interface FrameStats {
    avgFps: number;
    minFps: number;
    maxFrameDeltaMs: number;
    droppedFrames16ms: number;
    frozenFrames100ms: number;
    frameCount: number;
}

interface WindowWithMemory extends Window {
    performance: Performance & { memory?: ChromeMemoryInfo };
}

const throwIfAborted = (signal: AbortSignal) => {
    if (signal.aborted) {
        throw new DOMException('Benchmark iptal edildi', 'AbortError');
    }
};

const sleep = (ms: number, signal: AbortSignal) =>
    new Promise<void>((resolve, reject) => {
        if (signal.aborted) {
            reject(new DOMException('Benchmark iptal edildi', 'AbortError'));
            return;
        }
        const timer = window.setTimeout(() => {
            signal.removeEventListener('abort', onAbort);
            resolve();
        }, ms);
        const onAbort = () => {
            window.clearTimeout(timer);
            reject(new DOMException('Benchmark iptal edildi', 'AbortError'));
        };
        signal.addEventListener('abort', onAbort, { once: true });
    });

const estimateKb = (value: unknown): number => {
    try {
        const text = JSON.stringify(value);
        return Math.round((text.length / 1024) * 10) / 10;
    } catch {
        return 0;
    }
};

const round1 = (value: number): number => Math.round(value * 10) / 10;
const round3 = (value: number): number => Math.round(value * 1000) / 1000;

export const projectMetricForTier = (
    metric: Pick<RouteBenchmarkMetric, 'totalMs' | 'tbtMs' | 'maxLongTaskMs' | 'avgFps' | 'networkRequests'>,
    tier: DeviceTierProfile,
): TierScaledProjection => {
    if (tier.cpuMultiplier === 1) {
        const jankRisk =
            metric.maxLongTaskMs >= 250 || metric.tbtMs >= 450
                ? 'Donma'
                : metric.maxLongTaskMs >= 100 || metric.tbtMs >= 150
                    ? 'Yüksek'
                    : metric.maxLongTaskMs >= 50
                        ? 'Orta'
                        : 'Akıcı';
        return {
            tierId: tier.id,
            label: tier.label,
            shortLabel: tier.shortLabel,
            cpuMultiplier: 1,
            effectiveMs: round1(metric.totalMs),
            projectedTbtMs: round1(metric.tbtMs),
            projectedMaxTaskMs: round1(metric.maxLongTaskMs),
            projectedFps: round1(metric.avgFps),
            jankRisk,
        };
    }

    // Main-thread CPU blocking time scales strongly with CPU throttling; network wait stays roughly flat.
    const cpuCoreMs = Math.max(metric.tbtMs + metric.maxLongTaskMs * 0.5, Math.min(metric.totalMs * 0.6, metric.totalMs));
    const networkFractionMs = Math.max(0, metric.totalMs - cpuCoreMs);
    const scaledCpuMs = cpuCoreMs * tier.cpuMultiplier;
    const effectiveMs = round1(networkFractionMs + scaledCpuMs);
    const projectedMaxTaskMs = round1(
        metric.maxLongTaskMs > 0
            ? metric.maxLongTaskMs * tier.cpuMultiplier
            : Math.max(0, metric.maxFrameDeltaMs - 16.7) * tier.cpuMultiplier,
    );
    const projectedTbtMs = round1(
        metric.tbtMs > 0
            ? metric.tbtMs * tier.cpuMultiplier + Math.max(0, projectedMaxTaskMs - 50) * 0.25
            : Math.max(0, projectedMaxTaskMs - 50),
    );
    const fpsPenalty = Math.min(0.85, (projectedTbtMs / Math.max(effectiveMs, 1)) * 0.72);
    const projectedFps = round1(Math.max(4, metric.avgFps * (1 - fpsPenalty)));

    const jankRisk =
        projectedMaxTaskMs >= 300 || projectedTbtMs >= 600 || projectedFps < 28
            ? 'Donma'
            : projectedMaxTaskMs >= 120 || projectedTbtMs >= 220 || projectedFps < 45
                ? 'Yüksek'
                : projectedMaxTaskMs >= 55
                    ? 'Orta'
                    : 'Akıcı';

    return {
        tierId: tier.id,
        label: tier.label,
        shortLabel: tier.shortLabel,
        cpuMultiplier: tier.cpuMultiplier,
        effectiveMs,
        projectedTbtMs,
        projectedMaxTaskMs,
        projectedFps,
        jankRisk,
    };
};

class IframePerfProbe {
    private win: Window;
    private doc: Document;
    private longTasks: number[] = [];
    private fcpMs: number | null = null;
    private lcpMs: number | null = null;
    private cls = 0;
    private observers: PerformanceObserver[] = [];
    private rafId: number | null = null;
    private frameDeltas: number[] = [];
    private lastFrameTime = 0;
    private resourceBaselineCount = 0;
    private active = true;

    constructor(win: Window) {
        this.win = win;
        this.doc = win.document;
        this.resourceBaselineCount = this.safeGetResources().length;
        this.attachObservers();
        this.startRafSampler();
    }

    private safeGetResources(): PerformanceResourceTiming[] {
        try {
            return this.win.performance.getEntriesByType('resource') as PerformanceResourceTiming[];
        } catch {
            return [];
        }
    }

    private attachObservers() {
        const ObserverCtor = (this.win as unknown as { PerformanceObserver?: typeof PerformanceObserver }).PerformanceObserver;
        if (!ObserverCtor) return;

        const safeObserve = (entryTypes: string[], cb: (entries: PerformanceEntry[]) => void) => {
            try {
                const observer = new ObserverCtor((list) => {
                    if (!this.active) return;
                    cb(list.getEntries());
                });
                observer.observe({ entryTypes, buffered: true } as PerformanceObserverInit);
                this.observers.push(observer);
            } catch {
                // Unsupported entry type in current browser
            }
        };

        safeObserve(['longtask'], (entries) => {
            for (const entry of entries) {
                this.longTasks.push(entry.duration);
            }
        });

        safeObserve(['paint'], (entries) => {
            for (const entry of entries) {
                if (entry.name === 'first-contentful-paint') {
                    this.fcpMs = entry.startTime;
                }
            }
        });

        safeObserve(['largest-contentful-paint'], (entries) => {
            const last = entries[entries.length - 1];
            if (last) {
                this.lcpMs = last.startTime;
            }
        });

        safeObserve(['layout-shift'], (entries) => {
            for (const entry of entries) {
                const ls = entry as LayoutShiftEntry;
                if (!ls.hadRecentInput) {
                    this.cls += ls.value || 0;
                }
            }
        });
    }

    private startRafSampler() {
        this.lastFrameTime = this.win.performance.now();
        const tick = (now: number) => {
            if (!this.active) return;
            const delta = now - this.lastFrameTime;
            this.lastFrameTime = now;
            if (delta > 0 && delta < 10_000) {
                this.frameDeltas.push(delta);
            }
            this.rafId = this.win.requestAnimationFrame(tick);
        };
        this.rafId = this.win.requestAnimationFrame(tick);
    }

    resetWindow() {
        this.longTasks = [];
        this.frameDeltas = [];
        this.cls = 0;
        this.lastFrameTime = this.win.performance.now();
        this.resourceBaselineCount = this.safeGetResources().length;
    }

    getFrameStats(): FrameStats {
        const deltas = this.frameDeltas;
        if (deltas.length === 0) {
            return {
                avgFps: 60,
                minFps: 60,
                maxFrameDeltaMs: 16.7,
                droppedFrames16ms: 0,
                frozenFrames100ms: 0,
                frameCount: 0,
            };
        }

        let sum = 0;
        let maxDelta = 0;
        let dropped16 = 0;
        let frozen100 = 0;
        for (const d of deltas) {
            sum += d;
            if (d > maxDelta) maxDelta = d;
            if (d > 24) dropped16 += 1;
            if (d >= 100) frozen100 += 1;
        }
        const avgDelta = sum / deltas.length;
        return {
            avgFps: round1(Math.min(144, 1000 / Math.max(avgDelta, 1))),
            minFps: round1(Math.min(144, 1000 / Math.max(maxDelta, 1))),
            maxFrameDeltaMs: round1(maxDelta),
            droppedFrames16ms: dropped16,
            frozenFrames100ms: frozen100,
            frameCount: deltas.length,
        };
    }

    collectSnapshot() {
        const frameStats = this.getFrameStats();
        let tbtMs = 0;
        let maxLongTaskMs = 0;
        for (const duration of this.longTasks) {
            if (duration > 50) {
                tbtMs += duration - 50;
            }
            if (duration > maxLongTaskMs) {
                maxLongTaskMs = duration;
            }
        }

        // Also infer TBT-equivalent frame stalls when PerformanceObserver longtask misses synthetic animation bursts
        if (this.longTasks.length === 0 && frameStats.maxFrameDeltaMs > 50) {
            for (const delta of this.frameDeltas) {
                if (delta > 50) {
                    tbtMs += delta - 50;
                }
                if (delta > maxLongTaskMs) {
                    maxLongTaskMs = delta;
                }
            }
        }

        const allResources = this.safeGetResources();
        const slicedResources = allResources.slice(this.resourceBaselineCount);
        let transferBytes = 0;
        let apiRequests = 0;
        for (const res of slicedResources) {
            transferBytes += res.transferSize || res.encodedBodySize || 0;
            if (
                res.name.includes('supabase.co') ||
                res.initiatorType === 'fetch' ||
                res.initiatorType === 'xmlhttprequest'
            ) {
                apiRequests += 1;
            }
        }

        const navEntries = this.win.performance.getEntriesByType('navigation') as PerformanceNavigationTiming[];
        const nav = navEntries[0];
        const ttfbMs = nav ? Math.max(0, round1(nav.responseStart - nav.requestStart)) : 0;

        let domNodes = 0;
        let imageCount = 0;
        try {
            domNodes = this.doc.querySelectorAll('*').length;
            imageCount = this.doc.querySelectorAll('img').length;
        } catch {
            // ignore
        }

        let heapUsedMb: number | null = null;
        try {
            const mem = (this.win as WindowWithMemory).performance.memory;
            if (mem && typeof mem.usedJSHeapSize === 'number') {
                heapUsedMb = round1(mem.usedJSHeapSize / (1024 * 1024));
            }
        } catch {
            heapUsedMb = null;
        }

        return {
            ttfbMs,
            fcpMs: this.fcpMs !== null ? round1(this.fcpMs) : null,
            lcpMs: this.lcpMs !== null ? round1(this.lcpMs) : null,
            cls: round3(this.cls),
            tbtMs: round1(tbtMs),
            longTaskCount: this.longTasks.length,
            maxLongTaskMs: round1(maxLongTaskMs),
            avgFps: frameStats.avgFps,
            minFps: frameStats.minFps,
            maxFrameDeltaMs: frameStats.maxFrameDeltaMs,
            droppedFrames16ms: frameStats.droppedFrames16ms,
            frozenFrames100ms: frameStats.frozenFrames100ms,
            domNodes,
            imageCount,
            networkRequests: slicedResources.length,
            apiRequests,
            transferKb: round1(transferBytes / 1024),
            heapUsedMb,
        };
    }

    dispose() {
        this.active = false;
        if (this.rafId !== null) {
            try {
                this.win.cancelAnimationFrame(this.rafId);
            } catch {
                // ignore
            }
            this.rafId = null;
        }
        for (const observer of this.observers) {
            try {
                observer.disconnect();
            } catch {
                // ignore
            }
        }
        this.observers = [];
    }
}

const isRouteDomSettled = (doc: Document): boolean => {
    if (!doc.body) return false;
    const spinnerCount = doc.querySelectorAll('.animate-spin').length;
    if (spinnerCount > 0) return false;
    const textLen = (doc.body.innerText || '').trim().length;
    return textLen >= 40;
};

const loadIframeRoute = async (
    iframe: HTMLIFrameElement,
    path: string,
    signal: AbortSignal,
    timeoutMs = 12_000,
): Promise<{
    win: Window;
    probe: IframePerfProbe;
    elapsedMs: number;
    timedOut: boolean;
}> => {
    const startTime = performance.now();
    const targetUrl = `${window.location.origin}${path}`;

    return await new Promise((resolve, reject) => {
        let finished = false;
        let attachedProbe: IframePerfProbe | null = null;
        let pollTimer: number | null = null;
        let timeoutTimer: number | null = null;

        const cleanup = () => {
            if (pollTimer !== null) window.clearInterval(pollTimer);
            if (timeoutTimer !== null) window.clearTimeout(timeoutTimer);
            iframe.removeEventListener('load', onLoad);
            signal.removeEventListener('abort', onAbort);
        };

        const finish = (timedOut: boolean) => {
            if (finished) return;
            finished = true;
            cleanup();
            const win = iframe.contentWindow;
            if (!win) {
                reject(new Error('Sandbox penceresine erişilemedi'));
                return;
            }
            if (!attachedProbe) {
                attachedProbe = new IframePerfProbe(win);
            }
            resolve({
                win,
                probe: attachedProbe,
                elapsedMs: round1(performance.now() - startTime),
                timedOut,
            });
        };

        const onAbort = () => {
            if (finished) return;
            finished = true;
            cleanup();
            attachedProbe?.dispose();
            reject(new DOMException('Benchmark iptal edildi', 'AbortError'));
        };

        const onLoad = () => {
            if (finished) return;
            const win = iframe.contentWindow;
            if (!win) return;
            if (!attachedProbe) {
                attachedProbe = new IframePerfProbe(win);
            }
            const loadedAt = performance.now();
            pollTimer = window.setInterval(() => {
                if (finished) return;
                try {
                    const doc = win.document;
                    const settled = isRouteDomSettled(doc);
                    if (settled && performance.now() - loadedAt >= 550) {
                        finish(false);
                    }
                } catch {
                    finish(false);
                }
            }, 90);
        };

        signal.addEventListener('abort', onAbort, { once: true });
        iframe.addEventListener('load', onLoad);
        timeoutTimer = window.setTimeout(() => finish(true), timeoutMs);
        iframe.src = targetUrl;
    });
};

const runMicroSuite = async (
    options: {
        includeHeavyNetworkRefresh: boolean;
        signal: AbortSignal;
        onPartialMicro?: (metric: MicroBenchmarkMetric) => void;
    },
): Promise<{
    micros: MicroBenchmarkMetric[];
    sampleMangaId: string;
    sampleMangaTitle: string;
    sampleChapterId: string | null;
    catalogSize: number;
}> => {
    const { includeHeavyNetworkRefresh, signal, onPartialMicro } = options;
    const micros: MicroBenchmarkMetric[] = [];
    const emit = (metric: MicroBenchmarkMetric) => {
        micros.push(metric);
        onPartialMicro?.(metric);
    };

    // 1. Sample discovery via fast paginated endpoint
    let sampleMangaId = '';
    let sampleMangaTitle = 'Örnek Seri';
    let sampleChapterId: string | null = null;

    {
        const t0 = performance.now();
        try {
            const page = await getFastHomeCatalogPage({
                page: 1,
                pageSize: 28,
                sort: 'popular',
                includeAdult: true,
                forceRefresh: true,
                skipPrefetch: true,
            });
            const dur = round1(performance.now() - t0);
            const first = page.items[0];
            if (first) {
                sampleMangaId = first.id;
                sampleMangaTitle = first.title;
            }
            emit({
                id: 'fast-home-page',
                name: 'Ana Sayfa Sayfalı RPC (getFastHomeCatalogPage · 28 seri)',
                category: 'network',
                durationMs: dur,
                itemCount: page.items.length,
                payloadKb: estimateKb(page.items),
                note: `Toplam katalog: ${page.totalCount} seri · yalnızca aktif 1 sayfa çekildi`,
                status: 'ok',
            });
        } catch (err) {
            emit({
                id: 'fast-home-page',
                name: 'Ana Sayfa Sayfalı RPC (getFastHomeCatalogPage)',
                category: 'network',
                durationMs: round1(performance.now() - t0),
                itemCount: 0,
                note: err instanceof Error ? err.message : 'Bilinmeyen hata',
                status: 'error',
            });
        }
    }

    throwIfAborted(signal);

    // 2. IndexedDB persisted catalog deserialization cost
    {
        const t0 = performance.now();
        try {
            const cachedSafe = await readPersistedQueryCache<Manga[]>('manga-summaries:public:safe');
            const cachedAll = cachedSafe ?? await readPersistedQueryCache<Manga[]>('manga-summaries:public:all');
            const dur = round1(performance.now() - t0);
            const rows = Array.isArray(cachedAll?.value) ? cachedAll.value : [];
            emit({
                id: 'idb-summaries-read',
                name: 'IndexedDB Tam Katalog Okuma + Deserialize (manga-summaries)',
                category: 'cache',
                durationMs: dur,
                itemCount: rows.length,
                payloadKb: rows.length > 0 ? estimateKb(rows) : 0,
                note: rows.length > 0 ? 'Keşfet sayfası açılışında IDB yapısal klon maliyeti' : 'IDB önbelleği henüz boş (soğuk)',
                status: 'ok',
            });
        } catch (err) {
            emit({
                id: 'idb-summaries-read',
                name: 'IndexedDB Tam Katalog Okuma',
                category: 'cache',
                durationMs: round1(performance.now() - t0),
                itemCount: 0,
                note: err instanceof Error ? err.message : 'Okuma hatası',
                status: 'error',
            });
        }
    }

    throwIfAborted(signal);

    // 3. Warm getMangaSummaries
    let summaries: Manga[] = [];
    {
        const t0 = performance.now();
        try {
            summaries = await getMangaSummaries();
            const dur = round1(performance.now() - t0);
            if (!sampleMangaId && summaries[0]) {
                sampleMangaId = summaries[0].id;
                sampleMangaTitle = summaries[0].title;
            }
            emit({
                id: 'warm-summaries',
                name: 'Sıcak Katalog Çağrısı (getMangaSummaries · bellek/IDB)',
                category: 'cache',
                durationMs: dur,
                itemCount: summaries.length,
                payloadKb: estimateKb(summaries.slice(0, 50)) * Math.max(1, Math.round(summaries.length / 50)),
                note: `${summaries.length} seri özet nesnesi döndürüldü`,
                status: 'ok',
            });
        } catch (err) {
            emit({
                id: 'warm-summaries',
                name: 'Sıcak Katalog Çağrısı (getMangaSummaries)',
                category: 'cache',
                durationMs: round1(performance.now() - t0),
                itemCount: 0,
                note: err instanceof Error ? err.message : 'Hata',
                status: 'error',
            });
        }
    }

    throwIfAborted(signal);

    // 4. Optional Cold Full Network Catalog Fetch (what cold /browse users hit!)
    if (includeHeavyNetworkRefresh) {
        const t0 = performance.now();
        try {
            const freshSummaries = await getMangaSummaries({ forceRefresh: true });
            const dur = round1(performance.now() - t0);
            if (freshSummaries.length > 0) {
                summaries = freshSummaries;
            }
            emit({
                id: 'cold-summaries-rpc',
                name: 'Soğuk Tam Katalog Ağı (getMangaSummaries forceRefresh · Tüm Parçalar)',
                category: 'network',
                durationMs: dur,
                itemCount: freshSummaries.length,
                note: `${Math.ceil(freshSummaries.length / 1000)} paralel 1000-satır RPC isteği`,
                status: 'ok',
            });
        } catch (err) {
            emit({
                id: 'cold-summaries-rpc',
                name: 'Soğuk Tam Katalog Ağı (getMangaSummaries forceRefresh)',
                category: 'network',
                durationMs: round1(performance.now() - t0),
                itemCount: 0,
                note: err instanceof Error ? err.message : 'Hata',
                status: 'error',
            });
        }
    }

    throwIfAborted(signal);

    // 5. Home Sections + All-Time Rank RPC + Detail Meta + Single Series
    {
        const t0 = performance.now();
        try {
            const sections = await getHomePageMangaSections();
            emit({
                id: 'home-sections-rpc',
                name: 'Ana Sayfa Bölümleri RPC (getHomePageMangaSections)',
                category: 'network',
                durationMs: round1(performance.now() - t0),
                itemCount: sections.trendingManga.length + sections.latestUpdates.length,
                note: `Trend: ${sections.trendingManga.length} · Son Güncellemeler: ${sections.latestUpdates.length}`,
                status: 'ok',
            });
        } catch (err) {
            emit({
                id: 'home-sections-rpc',
                name: 'Ana Sayfa Bölümleri RPC (getHomePageMangaSections)',
                category: 'network',
                durationMs: round1(performance.now() - t0),
                itemCount: 0,
                note: err instanceof Error ? err.message : 'Hata',
                status: 'error',
            });
        }
    }

    throwIfAborted(signal);

    {
        const t0 = performance.now();
        try {
            const ranks = await getAllTimeMangaRanks(true);
            emit({
                id: 'all-time-ranks-rpc',
                name: 'Tüm Zamanlar Sıralama RPC (getAllTimeMangaRanks)',
                category: 'network',
                durationMs: round1(performance.now() - t0),
                itemCount: ranks.ranks.length,
                payloadKb: estimateKb(ranks.ranks),
                note: `Toplam ${ranks.totalRankedSeries} sıralı seri skoru`,
                status: 'ok',
            });
        } catch (err) {
            emit({
                id: 'all-time-ranks-rpc',
                name: 'Tüm Zamanlar Sıralama RPC (getAllTimeMangaRanks)',
                category: 'network',
                durationMs: round1(performance.now() - t0),
                itemCount: 0,
                note: err instanceof Error ? err.message : 'Hata',
                status: 'error',
            });
        }
    }

    throwIfAborted(signal);

    if (sampleMangaId) {
        const tMeta = performance.now();
        try {
            const meta = await getMangaDetailMeta(sampleMangaId, true);
            emit({
                id: 'detail-meta-rpc',
                name: 'Seri Detay Meta RPC (getMangaDetailMeta)',
                category: 'network',
                durationMs: round1(performance.now() - tMeta),
                itemCount: 1,
                note: `Sıra: #${meta.allTimeRank ?? '-'} · Kitaplık: ${meta.libraryCount}`,
                status: 'ok',
            });
        } catch (err) {
            emit({
                id: 'detail-meta-rpc',
                name: 'Seri Detay Meta RPC (getMangaDetailMeta)',
                category: 'network',
                durationMs: round1(performance.now() - tMeta),
                itemCount: 0,
                note: err instanceof Error ? err.message : 'Hata',
                status: 'error',
            });
        }

        const tDetail = performance.now();
        try {
            const fullManga = await getMangaById(sampleMangaId, { includePrivate: true, includePages: false });
            sampleChapterId = fullManga?.chapters?.[0]?.id ?? null;
            emit({
                id: 'manga-by-id',
                name: 'Tek Seri Detay + Bölümler (getMangaById)',
                category: 'network',
                durationMs: round1(performance.now() - tDetail),
                itemCount: fullManga?.chapters?.length ?? 0,
                payloadKb: fullManga ? estimateKb(fullManga) : 0,
                note: `${fullManga?.title ?? sampleMangaTitle} · ${fullManga?.chapters?.length ?? 0} bölüm`,
                status: 'ok',
            });
        } catch (err) {
            emit({
                id: 'manga-by-id',
                name: 'Tek Seri Detay + Bölümler (getMangaById)',
                category: 'network',
                durationMs: round1(performance.now() - tDetail),
                itemCount: 0,
                note: err instanceof Error ? err.message : 'Hata',
                status: 'error',
            });
        }
    }

    throwIfAborted(signal);

    // 6. CPU Micro-benchmarks on Browse / Search hot loops
    if (summaries.length > 0) {
        // 6a: Browse indexedCatalog simulation
        const tIndex = performance.now();
        const indexed = summaries.map((manga) => {
            const genreKeys = new Set<string>();
            for (const rawGenre of manga.genres) {
                const normalized = normalizeGenreName(rawGenre);
                if (normalized) {
                    genreKeys.add(normalized.toLocaleLowerCase('tr-TR'));
                }
            }
            return {
                manga,
                genreKeys,
                ratingValue: manga.rating || 0,
                viewsValue: manga.views || 0,
                chapterCountValue: manga.chapterCount ?? manga.chapters.length,
                updatedAtMs: Date.parse(manga.updatedAt) || 0,
                createdAtMs: Date.parse(manga.createdAt || '') || 0,
            };
        });
        const indexDur = round1(performance.now() - tIndex);
        emit({
            id: 'cpu-browse-index',
            name: 'CPU: Keşfet Katalog İndeksleme (normalizeGenreName + Date.parse)',
            category: 'cpu',
            durationMs: indexDur,
            itemCount: indexed.length,
            perItemUs: round1((indexDur * 1000) / indexed.length),
            note: `${indexed.length} seri için senkron useMemo indeksleme maliyeti (6x mobilde ~${round1(indexDur * 6)} ms)`,
            status: 'ok',
        });

        // 6b: Search + multi-genre filter + sort
        const tFilter = performance.now();
        const prepared = prepareSearchQuery('so');
        const filtered = indexed.filter((entry) => {
            if (!entry.genreKeys.has('aksiyon') && !entry.genreKeys.has('fantezi')) {
                return false;
            }
            return matchesMangaPreparedSearch(entry.manga, prepared);
        });
        filtered.sort((a, b) => b.viewsValue - a.viewsValue);
        const filterDur = round1(performance.now() - tFilter);
        emit({
            id: 'cpu-browse-filter-sort',
            name: 'CPU: Keşfet Tür Filtresi + Arama + Sıralama (Tek Tuş/Tıklama)',
            category: 'cpu',
            durationMs: filterDur,
            itemCount: filtered.length,
            perItemUs: round1((filterDur * 1000) / indexed.length),
            note: `${indexed.length} içinden ${filtered.length} eşleşme (6x mobilde ~${round1(filterDur * 6)} ms)`,
            status: 'ok',
        });

        // 6c: Full sort without filter
        const tSort = performance.now();
        const cloned = [...indexed];
        cloned.sort((a, b) => b.updatedAtMs - a.updatedAtMs);
        const sortDur = round1(performance.now() - tSort);
        emit({
            id: 'cpu-browse-full-sort',
            name: 'CPU: Tüm Katalog Sıralama (4700+ seri Array.sort)',
            category: 'cpu',
            durationMs: sortDur,
            itemCount: cloned.length,
            perItemUs: round1((sortDur * 1000) / cloned.length),
            note: `Filtresiz tüm seri sıralama maliyeti (6x mobilde ~${round1(sortDur * 6)} ms)`,
            status: 'ok',
        });

        // 6d: Header Search ranking
        const tSearch = performance.now();
        const rankedHits = rankTopMangaMatches(summaries, 'solo', 20);
        const searchDur = round1(performance.now() - tSearch);
        emit({
            id: 'cpu-header-search',
            name: 'CPU: Üst Menü Canlı Arama Skorlama (rankTopMangaMatches)',
            category: 'cpu',
            durationMs: searchDur,
            itemCount: rankedHits.length,
            perItemUs: round1((searchDur * 1000) / summaries.length),
            note: `"solo" araması için ${summaries.length} seri tarandı (${rankedHits.length} sonuç)`,
            status: 'ok',
        });
    }

    return {
        micros,
        sampleMangaId,
        sampleMangaTitle,
        sampleChapterId,
        catalogSize: summaries.length,
    };
};

const waitAndCollectTransition = async (
    win: Window,
    actionStartMs: number,
    conditionFn: () => boolean,
    signal: AbortSignal,
    settleMs = 900,
    timeoutMs = 10_000,
): Promise<{ totalMs: number; timedOut: boolean }> => {
    let matchedAt: number | null = null;
    while (performance.now() - actionStartMs < timeoutMs) {
        throwIfAborted(signal);
        let ok = false;
        try {
            ok = conditionFn();
        } catch {
            ok = false;
        }
        if (ok) {
            if (matchedAt === null) {
                matchedAt = performance.now();
            } else if (performance.now() - matchedAt >= settleMs && isRouteDomSettled(win.document)) {
                return { totalMs: round1(performance.now() - actionStartMs), timedOut: false };
            }
        }
        await sleep(50, signal);
    }
    return { totalMs: round1(performance.now() - actionStartMs), timedOut: true };
};

export const analyzeBottlenecks = (
    routes: RouteBenchmarkMetric[],
    micros: MicroBenchmarkMetric[],
): BottleneckFinding[] => {
    const findings: BottleneckFinding[] = [];

    for (const route of routes) {
        const mobile6x = projectMetricForTier(route, DEVICE_PROFILES[3]);
        const severity: BottleneckFinding['severity'] =
            route.maxLongTaskMs >= 200 || route.tbtMs >= 450 || route.totalMs >= 2200 || mobile6x.jankRisk === 'Donma'
                ? 'Kritik'
                : route.maxLongTaskMs >= 80 || route.tbtMs >= 160 || route.totalMs >= 1200 || mobile6x.jankRisk === 'Yüksek'
                    ? 'Yüksek'
                    : route.maxLongTaskMs >= 45 || route.totalMs >= 650
                        ? 'Orta'
                        : 'İyi';

        let summary = 'Kabul edilebilir kare hızı ve yanıt süresi.';
        if (route.path.includes('browse') && (severity === 'Kritik' || severity === 'Yüksek')) {
            summary = `Keşfet tüm kataloğu (~4.7k seri) tek seferde yükleyip indeksliyor/sıralıyor; ${route.domNodes} DOM düğümü ve ${route.maxLongTaskMs} ms en uzun ana iş parçacığı kilidi oluştu.`;
        } else if (route.id === 'trans-detail-to-alltime') {
            summary = `Seri Detay -> Tüm Zamanlar SPA geçişinde ${route.longTaskCount} long task (${route.tbtMs} ms TBT) ve en yüksek ${route.maxFrameDeltaMs} ms kare sıçraması ölçüldü.`;
        } else if (route.kind === 'transition') {
            summary = `Sayfa geçişi sırasında PageTransitionShell tam mount/unmount maliyeti + veri kurulumu ${route.maxLongTaskMs} ms blokaj üretti.`;
        } else if (route.kind === 'action') {
            summary = `Etkileşim anında senkron state/filtreleme/DOM güncellemesi ${route.droppedFrames16ms} kare düşürdü (${route.minFps} min FPS).`;
        } else if (severity !== 'İyi') {
            summary = `Yüklenme sırasında ${route.totalMs} ms sürdü, ${route.longTaskCount} adet >50ms blokaj (${route.domNodes} DOM, ${route.transferKb} KB).`;
        }

        findings.push({
            id: `finding-${route.id}`,
            severity,
            area: route.kind === 'transition' ? 'Rota Geçişi' : route.kind === 'action' ? 'UI Etkileşimi' : 'Sayfa Yükleme',
            target: route.name,
            measuredMs: route.totalMs,
            maxLongTaskMs: route.maxLongTaskMs,
            tbtMs: route.tbtMs,
            mobile6xEffectiveMs: mobile6x.effectiveMs,
            summary,
        });
    }

    for (const micro of micros) {
        if (micro.status !== 'ok') continue;
        const estimated6x = round1(micro.category === 'network' ? micro.durationMs : micro.durationMs * 6);
        const isSlow =
            (micro.category === 'cpu' && micro.durationMs >= 25) ||
            (micro.category === 'cache' && micro.durationMs >= 80) ||
            (micro.category === 'network' && micro.durationMs >= 900);

        if (isSlow) {
            findings.push({
                id: `finding-micro-${micro.id}`,
                severity:
                    (micro.category === 'cpu' && micro.durationMs >= 75) || micro.durationMs >= 1800
                        ? 'Kritik'
                        : 'Yüksek',
                area: micro.category === 'cpu' ? 'JS/CPU Döngüsü' : micro.category === 'cache' ? 'IDB Önbellek' : 'Ağ/RPC',
                target: micro.name,
                measuredMs: micro.durationMs,
                maxLongTaskMs: micro.category === 'cpu' ? micro.durationMs : 0,
                tbtMs: micro.category === 'cpu' ? Math.max(0, round1(micro.durationMs - 50)) : 0,
                mobile6xEffectiveMs: estimated6x,
                summary: micro.note,
            });
        }
    }

    const rankWeight: Record<BottleneckFinding['severity'], number> = {
        Kritik: 0,
        Yüksek: 1,
        Orta: 2,
        İyi: 3,
    };

    return findings.sort((a, b) => {
        const diff = rankWeight[a.severity] - rankWeight[b.severity];
        if (diff !== 0) return diff;
        return b.tbtMs + b.maxLongTaskMs - (a.tbtMs + a.maxLongTaskMs) || b.measuredMs - a.measuredMs;
    });
};

export const runFullPerformanceBenchmark = async (
    options: RunBenchmarkOptions,
): Promise<FullBenchmarkReport> => {
    const {
        viewportMode,
        includeHeavyNetworkRefresh = true,
        includeReaderRoute = true,
        includeAllSecondaryRoutes = true,
        currentUserId,
        iframeElement,
        signal,
        onProgress,
        onPartialRoute,
        onPartialMicro,
    } = options;

    const startedAtIso = new Date().toISOString();
    const startPerf = performance.now();

    onProgress?.({
        phase: 'preparing',
        currentLabel: 'Örnek seri ve katalog verileri hazırlanıyor...',
        completedSteps: 0,
        totalSteps: 1,
    });

    const microSummary = await runMicroSuite({
        includeHeavyNetworkRefresh,
        signal,
        onPartialMicro,
    });

    throwIfAborted(signal);

    const { sampleMangaId, sampleMangaTitle, sampleChapterId, micros, catalogSize } = microSummary;

    const baseRoutes: Array<{ id: string; name: string; path: string }> = [
        { id: 'route-home', name: 'Ana Sayfa (/)', path: '/' },
        { id: 'route-browse', name: 'Keşfet — İlk Açılış (/browse)', path: '/browse' },
        { id: 'route-browse-alltime', name: 'Keşfet — Tüm Zamanlar (?sort=all_time_rank)', path: '/browse?sort=all_time_rank' },
        { id: 'route-topten', name: 'En İyi 10 (/top-ten)', path: '/top-ten' },
        { id: 'route-latest', name: 'Son Bölümler (/latest-chapters)', path: '/latest-chapters' },
        { id: 'route-community', name: 'Topluluk (/community)', path: '/community' },
        ...(sampleMangaId
            ? [{ id: 'route-manga-detail', name: `Seri Detay (${sampleMangaTitle})`, path: `/manga/${sampleMangaId}` }]
            : []),
    ];

    if (includeAllSecondaryRoutes) {
        baseRoutes.push(
            { id: 'route-library', name: 'Kütüphanem (/library)', path: '/library' },
            { id: 'route-favorites', name: 'Favorilerim (/favorites)', path: '/favorites' },
            { id: 'route-history', name: 'Okuma Geçmişi (/history)', path: '/history' },
            { id: 'route-reading-time', name: 'Okuma Süreleri (/reading-time)', path: '/reading-time' },
            { id: 'route-reading-lists', name: 'Okuma Listeleri (/reading-lists)', path: '/reading-lists' },
            { id: 'route-tier-lists', name: 'Kademe Listeleri (/tier-lists)', path: '/tier-lists' },
            { id: 'route-characters', name: 'Karakterler (/characters)', path: '/characters' },
            { id: 'route-authors', name: 'Yazarlar (/authors)', path: '/authors' },
            { id: 'route-artists', name: 'Çizerler (/artists)', path: '/artists' },
            { id: 'route-settings', name: 'Ayarlar (/settings)', path: '/settings' },
            ...(currentUserId ? [{ id: 'route-profile', name: 'Profil Sayfam (/profile)', path: `/profile/${currentUserId}` }] : []),
        );
    }

    if (includeReaderRoute && sampleMangaId && sampleChapterId) {
        baseRoutes.push({
            id: 'route-reader',
            name: 'Bölüm Okuyucu (/chapter)',
            path: `/manga/${sampleMangaId}/chapter/${sampleChapterId}`,
        });
    }

    const totalRouteSteps = baseRoutes.length + 6; // routes + live SPA transition & UI interaction scenarios
    const routeMetrics: RouteBenchmarkMetric[] = [];
    const emitRoute = (metric: RouteBenchmarkMetric) => {
        routeMetrics.push(metric);
        onPartialRoute?.(metric);
    };

    let activeProbe: IframePerfProbe | null = null;
    try {
        for (let i = 0; i < baseRoutes.length; i += 1) {
            throwIfAborted(signal);
            const item = baseRoutes[i];
            onProgress?.({
                phase: 'routes',
                currentLabel: `Sayfa yükleniyor: ${item.name}`,
                completedSteps: i,
                totalSteps: totalRouteSteps,
            });

            activeProbe?.dispose();
            activeProbe = null;

            try {
                const { probe, elapsedMs, timedOut } = await loadIframeRoute(iframeElement, item.path, signal, 14_000);
                activeProbe = probe;
                // Sample a 650ms idle window after initial render to catch deferred heavy memos / effects
                await sleep(650, signal);
                const snap = probe.collectSnapshot();
                probe.dispose();
                activeProbe = null;

                emitRoute({
                    id: item.id,
                    name: item.name,
                    path: item.path,
                    kind: 'route',
                    viewportMode,
                    status: timedOut ? 'timeout' : 'ok',
                    totalMs: elapsedMs,
                    ...snap,
                });
            } catch (err) {
                if ((err as Error)?.name === 'AbortError') throw err;
                emitRoute({
                    id: item.id,
                    name: item.name,
                    path: item.path,
                    kind: 'route',
                    viewportMode,
                    status: 'error',
                    note: err instanceof Error ? err.message : 'Yükleme hatası',
                    totalMs: 0,
                    ttfbMs: 0,
                    fcpMs: null,
                    lcpMs: null,
                    cls: 0,
                    tbtMs: 0,
                    longTaskCount: 0,
                    maxLongTaskMs: 0,
                    avgFps: 0,
                    minFps: 0,
                    maxFrameDeltaMs: 0,
                    droppedFrames16ms: 0,
                    frozenFrames100ms: 0,
                    domNodes: 0,
                    imageCount: 0,
                    networkRequests: 0,
                    apiRequests: 0,
                    transferKb: 0,
                    heapUsedMb: null,
                });
            }
        }

        let stepCursor = baseRoutes.length;

        // Transition 1: MangaDetail -> Click "Tüm zamanlar sıralaması" Link (exact freeze scenario)
        if (sampleMangaId) {
            throwIfAborted(signal);
            onProgress?.({
                phase: 'routes',
                currentLabel: 'Geçiş ölçülüyor: Seri Detay -> Tüm Zamanlar (/browse?sort=all_time_rank)',
                completedSteps: stepCursor,
                totalSteps: totalRouteSteps,
            });
            stepCursor += 1;

            try {
                const { win, probe } = await loadIframeRoute(iframeElement, `/manga/${sampleMangaId}`, signal, 12_000);
                activeProbe = probe;
                await sleep(450, signal);

                const rankLink = win.document.querySelector('a[href*="/browse?sort=all_time_rank"]') as HTMLAnchorElement | null;
                probe.resetWindow();
                const tStart = performance.now();

                if (rankLink) {
                    rankLink.click();
                } else {
                    win.history.pushState({}, '', '/browse?sort=all_time_rank');
                    win.dispatchEvent(new win.PopStateEvent('popstate'));
                }

                const res = await waitAndCollectTransition(
                    win,
                    tStart,
                    () => win.location.pathname === '/browse' && Boolean(win.document.querySelector('input[placeholder="Ara..."]')),
                    signal,
                    1100,
                    12_000,
                );
                const snap = probe.collectSnapshot();
                probe.dispose();
                activeProbe = null;

                emitRoute({
                    id: 'trans-detail-to-alltime',
                    name: 'SPA Geçiş: Seri Detay → Tüm Zamanlar Sıralaması',
                    path: `/manga/${sampleMangaId} → /browse?sort=all_time_rank`,
                    kind: 'transition',
                    viewportMode,
                    status: res.timedOut ? 'timeout' : 'ok',
                    note: rankLink ? 'Gerçek "Tüm zamanlar sıralaması" link tıklaması' : 'History PopState geçişi',
                    totalMs: res.totalMs,
                    ...snap,
                });
            } catch (err) {
                if ((err as Error)?.name === 'AbortError') throw err;
                activeProbe?.dispose();
                activeProbe = null;
            }
        }

        // Transition 2: Home -> Browse SPA Transition
        throwIfAborted(signal);
        onProgress?.({
            phase: 'routes',
            currentLabel: 'Geçiş ölçülüyor: Ana Sayfa → Keşfet',
            completedSteps: stepCursor,
            totalSteps: totalRouteSteps,
        });
        stepCursor += 1;

        try {
            const { win, probe } = await loadIframeRoute(iframeElement, '/', signal, 12_000);
            activeProbe = probe;
            await sleep(450, signal);

            const browseLink = win.document.querySelector('a[href="/browse"]') as HTMLAnchorElement | null;
            probe.resetWindow();
            const tStart = performance.now();
            if (browseLink) {
                browseLink.click();
            } else {
                win.history.pushState({}, '', '/browse');
                win.dispatchEvent(new win.PopStateEvent('popstate'));
            }
            const res = await waitAndCollectTransition(
                win,
                tStart,
                () => win.location.pathname === '/browse' && Boolean(win.document.querySelector('input[placeholder="Ara..."]')),
                signal,
                1100,
                12_000,
            );
            const snap = probe.collectSnapshot();

            emitRoute({
                id: 'trans-home-to-browse',
                name: 'SPA Geçiş: Ana Sayfa → Keşfet',
                path: '/ → /browse',
                kind: 'transition',
                viewportMode,
                status: res.timedOut ? 'timeout' : 'ok',
                note: browseLink ? 'Gerçek Keşfet link tıklaması' : 'History PopState geçişi',
                totalMs: res.totalMs,
                ...snap,
            });

            // Action 3 (right on mounted /browse): Search typing
            onProgress?.({
                phase: 'routes',
                currentLabel: 'Aksiyon ölçülüyor: Keşfet Tür Seçimi & Arama Yazma',
                completedSteps: stepCursor,
                totalSteps: totalRouteSteps,
            });
            stepCursor += 1;

            await sleep(400, signal);
            probe.resetWindow();
            const tSearchStart = performance.now();
            const searchInput = win.document.querySelector('input[placeholder="Ara..."]') as HTMLInputElement | null;
            if (searchInput) {
                const setter = Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, 'value')?.set;
                setter?.call(searchInput, 'solo');
                searchInput.dispatchEvent(new win.Event('input', { bubbles: true }));
            }
            await sleep(1100, signal);
            const searchSnap = probe.collectSnapshot();
            emitRoute({
                id: 'action-browse-search',
                name: 'Aksiyon: Keşfet Arama Kutusu ("solo")',
                path: '/browse [input=solo]',
                kind: 'action',
                viewportMode,
                status: searchInput ? 'ok' : 'skipped',
                note: searchInput ? 'Gerçek input olayı + deferred/sync filtreleme' : 'Arama kutusu bulunamadı',
                totalMs: round1(performance.now() - tSearchStart),
                ...searchSnap,
            });

            // Action 4: Open genre popover & toggle first genre on /browse
            onProgress?.({
                phase: 'routes',
                currentLabel: 'Aksiyon ölçülüyor: Keşfet Tür Filtresi Tıklaması',
                completedSteps: stepCursor,
                totalSteps: totalRouteSteps,
            });
            stepCursor += 1;

            if (searchInput) {
                const setter = Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, 'value')?.set;
                setter?.call(searchInput, '');
                searchInput.dispatchEvent(new win.Event('input', { bubbles: true }));
                await sleep(300, signal);
            }

            const genreBtn = Array.from(win.document.querySelectorAll('button')).find((btn) =>
                (btn.textContent || '').includes('Türler'),
            );
            probe.resetWindow();
            const tGenreStart = performance.now();
            let selectedGenreName = 'Bulunamadı';
            if (genreBtn) {
                genreBtn.click();
                await sleep(180, signal);
                const genreCandidates = Array.from(
                    win.document.querySelectorAll(
                        '[role="dialog"] button, [role="dialog"] label, [data-radix-popper-content-wrapper] button, [data-radix-popper-content-wrapper] label',
                    ),
                ).filter((b) => {
                    const text = (b.textContent || '').trim();
                    return text.length >= 3 && text.length <= 24 && !text.includes('Temizle') && !text.includes('Sıfırla');
                });
                const firstGenreEl = genreCandidates[0] as HTMLElement | undefined;
                if (firstGenreEl) {
                    selectedGenreName = (firstGenreEl.textContent || '').trim();
                    firstGenreEl.click();
                }
            }
            await sleep(1000, signal);
            const genreSnap = probe.collectSnapshot();
            emitRoute({
                id: 'action-browse-genre',
                name: `Aksiyon: Keşfet Tür Aç + Seç (${selectedGenreName})`,
                path: '/browse [genre toggle]',
                kind: 'action',
                viewportMode,
                status: genreBtn ? 'ok' : 'skipped',
                note: 'Tür popover açma + tüm katalog filtre yeniden hesaplama',
                totalMs: round1(performance.now() - tGenreStart),
                ...genreSnap,
            });

            probe.dispose();
            activeProbe = null;
        } catch (err) {
            if ((err as Error)?.name === 'AbortError') throw err;
            activeProbe?.dispose();
            activeProbe = null;
        }

        // Action 5: Home Pagination ("Tüm Seriler" Sayfa 1 -> 2) & Header Search
        throwIfAborted(signal);
        onProgress?.({
            phase: 'routes',
            currentLabel: 'Aksiyon ölçülüyor: Ana Sayfa Tüm Seriler Sayfalama (1 → 2) & Üst Arama',
            completedSteps: stepCursor,
            totalSteps: totalRouteSteps,
        });
        stepCursor += 1;

        try {
            const { win, probe } = await loadIframeRoute(iframeElement, '/', signal, 12_000);
            activeProbe = probe;
            await sleep(500, signal);

            const page2Btn = Array.from(win.document.querySelectorAll('button, a')).find(
                (el) => (el.textContent || '').trim() === '2',
            ) as HTMLElement | undefined;

            probe.resetWindow();
            const tPageStart = performance.now();
            if (page2Btn) {
                page2Btn.click();
            }
            await sleep(1100, signal);
            const snap = probe.collectSnapshot();

            emitRoute({
                id: 'action-home-page2',
                name: 'Aksiyon: Ana Sayfa Tüm Seriler Sayfa Değişimi (1 → 2)',
                path: '/ [page=2]',
                kind: 'action',
                viewportMode,
                status: page2Btn ? 'ok' : 'skipped',
                note: page2Btn ? 'Sayfalama butonu tıklandı + RPC/render tamamlandı' : 'Sayfa 2 butonu görünmedi',
                totalMs: round1(performance.now() - tPageStart),
                ...snap,
            });

            // Action 6: Header search bar ("solo")
            onProgress?.({
                phase: 'routes',
                currentLabel: 'Aksiyon ölçülüyor: Üst Menü Arama ("solo")',
                completedSteps: stepCursor,
                totalSteps: totalRouteSteps,
            });
            const headerInput = win.document.querySelector('input[placeholder*="Manga, karakter"]') as HTMLInputElement | null;
            probe.resetWindow();
            const tHeaderSearch = performance.now();
            if (headerInput) {
                const setter = Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, 'value')?.set;
                setter?.call(headerInput, 'solo');
                headerInput.dispatchEvent(new win.Event('input', { bubbles: true }));
            }
            await sleep(1100, signal);
            const headerSnap = probe.collectSnapshot();
            probe.dispose();
            activeProbe = null;

            emitRoute({
                id: 'action-header-search',
                name: 'Aksiyon: Üst Menü Canlı Arama ("solo")',
                path: '/ [header-search]',
                kind: 'action',
                viewportMode,
                status: headerInput ? 'ok' : 'skipped',
                note: headerInput ? 'Üst menü arama input -> katalog tarama maliyeti' : 'Mobil/gizli üst arama alanı',
                totalMs: round1(performance.now() - tHeaderSearch),
                ...headerSnap,
            });
        } catch (err) {
            if ((err as Error)?.name === 'AbortError') throw err;
            activeProbe?.dispose();
            activeProbe = null;
        }
    } finally {
        activeProbe?.dispose();
        iframeElement.src = 'about:blank';
    }

    const finishedAtIso = new Date().toISOString();
    const durationSec = round1((performance.now() - startPerf) / 1000);

    onProgress?.({
        phase: 'complete',
        currentLabel: 'Benchmark tamamlandı',
        completedSteps: totalRouteSteps,
        totalSteps: totalRouteSteps,
    });

    const navExtra = navigator as Navigator & { deviceMemory?: number };

    return {
        startedAt: startedAtIso,
        finishedAt: finishedAtIso,
        durationSec,
        userAgent: navigator.userAgent,
        hardwareConcurrency: navigator.hardwareConcurrency || 0,
        deviceMemoryGb: typeof navExtra.deviceMemory === 'number' ? navExtra.deviceMemory : null,
        activeViewportMode: viewportMode,
        sampleMangaTitle,
        sampleMangaId,
        catalogSize,
        routes: routeMetrics,
        micros,
        bottlenecks: analyzeBottlenecks(routeMetrics, micros),
    };
};

export const formatBenchmarkMarkdown = (report: FullBenchmarkReport): string => {
    const lines: string[] = [
        '# ToonParrot Performans & Benchmark Raporu',
        `- **Tarih:** ${new Date(report.finishedAt).toLocaleString('tr-TR')}`,
        `- **Toplam Süre:** ${report.durationSec} sn`,
        `- **Katalog Boyutu:** ${report.catalogSize} seri · **Test Modu:** ${report.activeViewportMode === 'mobile' ? 'Mobil (390×844)' : 'Masaüstü (1440×900)'}`,
        `- **Cihaz Çekirdek / RAM:** ${report.hardwareConcurrency} CPU · ${report.deviceMemoryGb ?? '?'} GB RAM`,
        '',
        '## En Önemli Darboğazlar',
        '| Öncelik | Alan | Hedef | Ölçülen (ms) | En Uzun Blok (ms) | TBT (ms) | 6x Düşük Mobil (ms) | Not |',
        '|---|---|---|---:|---:|---:|---:|---|',
    ];

    for (const item of report.bottlenecks.slice(0, 12)) {
        lines.push(
            `| ${item.severity} | ${item.area} | ${item.target} | ${item.measuredMs} | ${item.maxLongTaskMs} | ${item.tbtMs} | ${item.mobile6xEffectiveMs} | ${item.summary} |`,
        );
    }

    lines.push('', '## Rota & Aksiyon Ölçümleri', '| Tür | Rota / Aksiyon | Toplam (ms) | Max Long Task (ms) | TBT (ms) | Ort. FPS | Min FPS | DOM | Ağ (KB) |', '|---|---|---:|---:|---:|---:|---:|---:|---:|');
    for (const r of report.routes) {
        lines.push(
            `| ${r.kind} | ${r.name} | ${r.totalMs} | ${r.maxLongTaskMs} | ${r.tbtMs} | ${r.avgFps} | ${r.minFps} | ${r.domNodes} | ${r.transferKb} |`,
        );
    }

    lines.push('', '## Veri / Önbellek / CPU Mikro Ölçümleri', '| Kategori | İşlem | Süre (ms) | Adet | Boyut (KB) | Detay |', '|---|---|---:|---:|---:|---|');
    for (const m of report.micros) {
        lines.push(`| ${m.category} | ${m.name} | ${m.durationMs} | ${m.itemCount} | ${m.payloadKb ?? '-'} | ${m.note} |`);
    }

    return lines.join('\n');
};
