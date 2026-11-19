import { fetchTranslatableImageBlob } from '@/lib/translation/geminiTranslator';
import { DEFAULT_MAX_TEX_SIZE, computeStripOutputSize } from './stripPlanner';
import { detectUpscaleSupport, getCachedUpscaleSupport } from './support';
import type {
  ModelDownloadProgress,
  StripPlan,
  UpscaleEngineKey,
  UpscaleRuntimeStatus,
} from './types';
import { UpscaleProcessor } from './upscaleProcessor';
import type { UpscaleWorkerOutgoing } from './upscaleWorker';

export interface StripJobRequest {
  src: string;
  strip: StripPlan;
  engine: UpscaleEngineKey;
  screenPx: number;
  isMobile: boolean;
  getPriority?: () => number;
  signal?: AbortSignal;
}

interface PageBitmapEntry {
  bitmap: ImageBitmap;
  inUse: number;
}

interface AiBlobEntry {
  blob: Blob;
  bytes: number;
}

interface PendingStripTask {
  id: number;
  cacheKey: string;
  request: StripJobRequest;
  generation: number;
  getPriority: () => number;
  resolve: (bitmap: ImageBitmap) => void;
  reject: (err: unknown) => void;
  abortController: AbortController;
  cleanupAbortListener: () => void;
}

interface WorkerPendingJob {
  resolve: (res: { bitmap: ImageBitmap; blob?: Blob }) => void;
  reject: (err: unknown) => void;
}

const MOBILE_PAGE_CACHE_LIMIT = 1;
const DESKTOP_PAGE_CACHE_LIMIT = 1;
const MOBILE_STRIP_LRU_LIMIT = 8;
const DESKTOP_STRIP_LRU_LIMIT = 16;
const MOBILE_AI_BLOB_BUDGET = 45 * 1024 * 1024;
const DESKTOP_AI_BLOB_BUDGET = 120 * 1024 * 1024;
const SCROLL_PAUSE_MS = 140;
const IDLE_PAGE_BITMAP_PURGE_MS = 1200;

const isAiEngine = (engine: UpscaleEngineKey): boolean => engine === 'realesrgan';

const makeAbortError = (): DOMException => new DOMException('İptal edildi', 'AbortError');

let cachedBlobFormat: { mime: string; quality: number } | null = null;
let encodeCanvas: OffscreenCanvas | HTMLCanvasElement | null = null;

const detectBlobFormat = async (): Promise<{ mime: string; quality: number }> => {
  if (cachedBlobFormat) return cachedBlobFormat;
  try {
    if (typeof OffscreenCanvas !== 'undefined') {
      const probe = new OffscreenCanvas(1, 1);
      const ctx = probe.getContext('2d');
      ctx?.fillRect(0, 0, 1, 1);
      const blob = await probe.convertToBlob({ type: 'image/webp', quality: 0.92 });
      if (blob.type === 'image/webp') {
        cachedBlobFormat = { mime: 'image/webp', quality: 0.92 };
        return cachedBlobFormat;
      }
    } else if (typeof document !== 'undefined') {
      const probe = document.createElement('canvas');
      probe.width = 1;
      probe.height = 1;
      if (probe.toDataURL('image/webp').startsWith('data:image/webp')) {
        cachedBlobFormat = { mime: 'image/webp', quality: 0.92 };
        return cachedBlobFormat;
      }
    }
  } catch {
    // Fallback below
  }
  cachedBlobFormat = { mime: 'image/jpeg', quality: 0.95 };
  return cachedBlobFormat;
};

const encodeBitmapToBlob = async (bitmap: ImageBitmap): Promise<Blob | null> => {
  try {
    const fmt = await detectBlobFormat();
    if (typeof OffscreenCanvas !== 'undefined') {
      if (!encodeCanvas || !(encodeCanvas instanceof OffscreenCanvas)) {
        encodeCanvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      }
      if (encodeCanvas.width !== bitmap.width) encodeCanvas.width = bitmap.width;
      if (encodeCanvas.height !== bitmap.height) encodeCanvas.height = bitmap.height;
      const ctx = encodeCanvas.getContext('2d') as OffscreenCanvasRenderingContext2D | null;
      if (!ctx) return null;
      ctx.clearRect(0, 0, bitmap.width, bitmap.height);
      ctx.drawImage(bitmap, 0, 0);
      return await encodeCanvas.convertToBlob({ type: fmt.mime, quality: fmt.quality });
    }
    if (typeof document !== 'undefined') {
      if (!encodeCanvas || encodeCanvas instanceof OffscreenCanvas) {
        encodeCanvas = document.createElement('canvas');
      }
      encodeCanvas.width = bitmap.width;
      encodeCanvas.height = bitmap.height;
      const ctx = (encodeCanvas as HTMLCanvasElement).getContext('2d');
      if (!ctx) return null;
      ctx.clearRect(0, 0, bitmap.width, bitmap.height);
      ctx.drawImage(bitmap, 0, 0);
      return await new Promise<Blob | null>((resolve) =>
        (encodeCanvas as HTMLCanvasElement).toBlob(resolve, fmt.mime, fmt.quality),
      );
    }
  } catch {
    // Ignore blob encode errors
  }
  return null;
};

class UpscaleQueueManager {
  private worker: Worker | null = null;
  private workerUnavailable = false;
  private workerJobs = new Map<number, WorkerPendingJob>();
  private mainProcessor: UpscaleProcessor | null = null;

  private pageBitmapCache = new Map<string, PageBitmapEntry>();
  private pendingPageLoads = new Map<string, Promise<ImageBitmap>>();

  private aiBlobCache = new Map<string, AiBlobEntry>();
  private totalAiBlobBytes = 0;

  private activeStripLru = new Map<string, () => void>();

  private queue: PendingStripTask[] = [];
  private activeTask: PendingStripTask | null = null;
  private pumpScheduled = false;
  private isHidden = false;
  private visibilityAttached = false;
  private lastScrollAt = 0;
  private scrollResumeTimer: number | null = null;
  private idlePurgeTimer: number | null = null;

  private generation = 0;
  private jobSeq = 0;

  private statusListeners = new Set<() => void>();
  private statusSnapshot: UpscaleRuntimeStatus = {
    activeJobs: 0,
    queuedJobs: 0,
    activeEngine: null,
    download: null,
    lastError: null,
  };

  constructor() {
    this.attachVisibilityListener();
  }

  private attachVisibilityListener(): void {
    if (this.visibilityAttached || typeof document === 'undefined') return;
    this.visibilityAttached = true;
    document.addEventListener('visibilitychange', () => {
      this.isHidden = Boolean(document.hidden);
      if (!this.isHidden) {
        this.schedulePump();
      }
    });
    if (typeof window !== 'undefined') {
      window.addEventListener(
        'scroll',
        () => {
          this.lastScrollAt = performance.now();
        },
        { passive: true },
      );
    }
  }

  private updateStatus(patch: Partial<UpscaleRuntimeStatus>): void {
    const next: UpscaleRuntimeStatus = {
      ...this.statusSnapshot,
      ...patch,
    };
    if (
      next.activeJobs === this.statusSnapshot.activeJobs &&
      next.queuedJobs === this.statusSnapshot.queuedJobs &&
      next.activeEngine === this.statusSnapshot.activeEngine &&
      next.download === this.statusSnapshot.download &&
      next.lastError === this.statusSnapshot.lastError
    ) {
      return;
    }
    this.statusSnapshot = next;
    this.statusListeners.forEach((listener) => listener());
  }

  subscribe = (listener: () => void): (() => void) => {
    this.statusListeners.add(listener);
    return () => {
      this.statusListeners.delete(listener);
    };
  };

  getSnapshot = (): UpscaleRuntimeStatus => this.statusSnapshot;

  private ensureWorker(): Worker | null {
    if (this.workerUnavailable || typeof Worker === 'undefined') {
      return null;
    }
    if (this.worker) {
      return this.worker;
    }
    try {
      const worker = new Worker(new URL('./upscaleWorker.ts', import.meta.url), {
        type: 'module',
      });
      worker.onmessage = (event: MessageEvent<UpscaleWorkerOutgoing>) => {
        const msg = event.data;
        if (msg.type === 'progress') {
          const dl = msg.progress;
          this.updateStatus({
            download: dl.stage === 'ready' ? null : dl,
            lastError: dl.stage === 'error' ? dl.error || 'Model yüklenemedi' : this.statusSnapshot.lastError,
          });
          return;
        }
        const pending = this.workerJobs.get(msg.id);
        if (!pending) {
          if (msg.bitmap) {
            try {
              msg.bitmap.close();
            } catch {
              // ignore
            }
          }
          return;
        }
        this.workerJobs.delete(msg.id);
        if (msg.ok && msg.bitmap) {
          pending.resolve({ bitmap: msg.bitmap, blob: msg.blob });
        } else if (msg.aborted) {
          pending.reject(makeAbortError());
        } else {
          pending.reject(new Error(msg.error || 'Görsel iyileştirme başarısız'));
        }
      };

      worker.onerror = (err) => {
        console.warn('[Upscale] Worker hatası, ana iş parçacığına geçiliyor:', err.message);
        const rejectErr = new Error(err.message || 'Upscale worker hatası');
        this.workerJobs.forEach((job) => job.reject(rejectErr));
        this.workerJobs.clear();
        worker.terminate();
        this.worker = null;
        this.workerUnavailable = true;
      };

      this.worker = worker;
      return worker;
    } catch {
      this.workerUnavailable = true;
      return null;
    }
  }

  private trimPageBitmapCache(limit: number): void {
    for (const [key, entry] of this.pageBitmapCache) {
      if (this.pageBitmapCache.size <= limit) break;
      if (entry.inUse > 0) continue;
      this.pageBitmapCache.delete(key);
      try {
        entry.bitmap.close();
      } catch {
        // ignore
      }
    }
  }

  private async acquirePageBitmap(
    src: string,
    isMobile: boolean,
    signal: AbortSignal,
  ): Promise<{ bitmap: ImageBitmap; release: () => void }> {
    const existing = this.pageBitmapCache.get(src);
    if (existing) {
      this.pageBitmapCache.delete(src);
      this.pageBitmapCache.set(src, existing);
      existing.inUse += 1;
      return {
        bitmap: existing.bitmap,
        release: () => {
          existing.inUse = Math.max(0, existing.inUse - 1);
          this.trimPageBitmapCache(isMobile ? MOBILE_PAGE_CACHE_LIMIT : DESKTOP_PAGE_CACHE_LIMIT);
        },
      };
    }

    let loadPromise = this.pendingPageLoads.get(src);
    if (!loadPromise) {
      loadPromise = (async () => {
        const blob = await fetchTranslatableImageBlob(src);
        return createImageBitmap(blob);
      })();
      this.pendingPageLoads.set(src, loadPromise);
      loadPromise
        .then((bmp) => {
          this.pendingPageLoads.delete(src);
          if (!this.pageBitmapCache.has(src)) {
            this.pageBitmapCache.set(src, { bitmap: bmp, inUse: 0 });
            this.trimPageBitmapCache(isMobile ? MOBILE_PAGE_CACHE_LIMIT : DESKTOP_PAGE_CACHE_LIMIT);
          } else {
            try {
              bmp.close();
            } catch {
              // ignore
            }
          }
        })
        .catch(() => {
          this.pendingPageLoads.delete(src);
        });
    }

    if (signal.aborted) {
      throw makeAbortError();
    }

    const bitmap = await new Promise<ImageBitmap>((resolve, reject) => {
      const onAbort = () => reject(makeAbortError());
      signal.addEventListener('abort', onAbort, { once: true });
      loadPromise!.then(
        (bmp) => {
          signal.removeEventListener('abort', onAbort);
          resolve(bmp);
        },
        (err) => {
          signal.removeEventListener('abort', onAbort);
          reject(err);
        },
      );
    });

    let entry = this.pageBitmapCache.get(src);
    if (!entry) {
      entry = { bitmap, inUse: 0 };
      this.pageBitmapCache.set(src, entry);
    }
    entry.inUse += 1;

    return {
      bitmap: entry.bitmap,
      release: () => {
        entry!.inUse = Math.max(0, entry!.inUse - 1);
        this.trimPageBitmapCache(isMobile ? MOBILE_PAGE_CACHE_LIMIT : DESKTOP_PAGE_CACHE_LIMIT);
      },
    };
  }

  private getAiBlob(key: string): Blob | null {
    const entry = this.aiBlobCache.get(key);
    if (!entry) return null;
    this.aiBlobCache.delete(key);
    this.aiBlobCache.set(key, entry);
    return entry.blob;
  }

  private putAiBlob(key: string, blob: Blob, isMobile: boolean): void {
    const budget = isMobile ? MOBILE_AI_BLOB_BUDGET : DESKTOP_AI_BLOB_BUDGET;
    if (blob.size > budget) return;

    const existing = this.aiBlobCache.get(key);
    if (existing) {
      this.totalAiBlobBytes -= existing.bytes;
      this.aiBlobCache.delete(key);
    }

    this.aiBlobCache.set(key, { blob, bytes: blob.size });
    this.totalAiBlobBytes += blob.size;

    while (this.totalAiBlobBytes > budget && this.aiBlobCache.size > 0) {
      const oldestKey = this.aiBlobCache.keys().next().value;
      if (oldestKey === undefined) break;
      const oldest = this.aiBlobCache.get(oldestKey);
      this.aiBlobCache.delete(oldestKey);
      if (oldest) {
        this.totalAiBlobBytes = Math.max(0, this.totalAiBlobBytes - oldest.bytes);
      }
    }
  }

  markStripActive(stripKey: string, onEvict: () => void, isMobile: boolean): void {
    this.activeStripLru.delete(stripKey);
    this.activeStripLru.set(stripKey, onEvict);
    const limit = isMobile ? MOBILE_STRIP_LRU_LIMIT : DESKTOP_STRIP_LRU_LIMIT;
    while (this.activeStripLru.size > limit) {
      const oldestKey = this.activeStripLru.keys().next().value;
      if (oldestKey === undefined) break;
      const evictFn = this.activeStripLru.get(oldestKey);
      this.activeStripLru.delete(oldestKey);
      try {
        evictFn?.();
      } catch {
        // ignore eviction callback errors
      }
    }
  }

  unmarkStripActive(stripKey: string): void {
    this.activeStripLru.delete(stripKey);
  }

  enqueueStrip(request: StripJobRequest): Promise<ImageBitmap> {
    if (request.signal?.aborted) {
      return Promise.reject(makeAbortError());
    }

    const gen = this.generation;
    const id = ++this.jobSeq;
    const abortController = new AbortController();

    const onCallerAbort = () => {
      abortController.abort();
      if (this.activeTask?.id === id) {
        this.worker?.postMessage({ type: 'cancel', id });
      } else {
        const idx = this.queue.findIndex((item) => item.id === id);
        if (idx !== -1) {
          const [removed] = this.queue.splice(idx, 1);
          removed.cleanupAbortListener();
          removed.reject(makeAbortError());
          this.syncCounts();
        }
      }
    };

    request.signal?.addEventListener('abort', onCallerAbort, { once: true });
    const cleanupAbortListener = () => {
      request.signal?.removeEventListener('abort', onCallerAbort);
    };

    const cacheKey = `${request.src}|${request.strip.index}|${request.engine}|${Math.ceil(request.screenPx)}`;

    return new Promise<ImageBitmap>((resolve, reject) => {
      this.queue.push({
        id,
        cacheKey,
        request,
        generation: gen,
        getPriority: request.getPriority ?? (() => request.strip.validY0),
        resolve,
        reject,
        abortController,
        cleanupAbortListener,
      });
      this.syncCounts();
      this.schedulePump();
    });
  }

  private syncCounts(): void {
    this.updateStatus({
      activeJobs: this.activeTask ? 1 : 0,
      queuedJobs: this.queue.length,
      activeEngine: this.activeTask?.request.engine ?? null,
    });
  }

  private schedulePump(): void {
    if (this.pumpScheduled) return;
    this.pumpScheduled = true;
    queueMicrotask(() => {
      this.pumpScheduled = false;
      void this.pumpQueue();
    });
  }

  private async pumpQueue(): Promise<void> {
    if (this.activeTask || this.isHidden || this.queue.length === 0) {
      return;
    }

    this.queue.sort((a, b) => a.getPriority() - b.getPriority());
    const nextCandidate = this.queue[0];

    // Kullanıcı aktif olarak sayfayı kaydırırken ağır Yapay Zekâ işini kısa süre beklet
    // (önbellekte hazırsa bekletmeden anında döner)
    if (
      nextCandidate &&
      isAiEngine(nextCandidate.request.engine) &&
      !this.aiBlobCache.has(nextCandidate.cacheKey) &&
      typeof window !== 'undefined'
    ) {
      const elapsedSinceScroll = performance.now() - this.lastScrollAt;
      if (elapsedSinceScroll < SCROLL_PAUSE_MS) {
        if (this.scrollResumeTimer === null) {
          const waitMs = Math.max(24, Math.ceil(SCROLL_PAUSE_MS - elapsedSinceScroll));
          this.scrollResumeTimer = window.setTimeout(() => {
            this.scrollResumeTimer = null;
            this.schedulePump();
          }, waitMs);
        }
        return;
      }
    }

    const task = this.queue.shift()!;
    if (task.generation !== this.generation || task.abortController.signal.aborted) {
      task.cleanupAbortListener();
      task.reject(makeAbortError());
      this.syncCounts();
      this.schedulePump();
      return;
    }

    if (this.idlePurgeTimer !== null && typeof window !== 'undefined') {
      window.clearTimeout(this.idlePurgeTimer);
      this.idlePurgeTimer = null;
    }

    this.activeTask = task;
    this.syncCounts();

    try {
      const bitmap = await this.executeTask(task);
      if (task.generation !== this.generation || task.abortController.signal.aborted) {
        try {
          bitmap.close();
        } catch {
          // ignore
        }
        task.reject(makeAbortError());
      } else {
        this.updateStatus({ lastError: null });
        task.resolve(bitmap);
      }
    } catch (err) {
      const isAbort = err instanceof DOMException && err.name === 'AbortError';
      if (!isAbort) {
        this.updateStatus({
          lastError: err instanceof Error ? err.message : String(err),
        });
      }
      task.reject(err);
    } finally {
      task.cleanupAbortListener();
      if (this.activeTask?.id === task.id) {
        this.activeTask = null;
      }
      this.syncCounts();
      if (!this.isHidden && this.queue.length > 0) {
        this.schedulePump();
      } else if (this.queue.length === 0 && !this.activeTask) {
        // Kuyruk tamamen boşaldığında 44 MB'lık ham tam-sayfa bitmap'lerini RAM'den temizle
        if (typeof window !== 'undefined') {
          if (this.idlePurgeTimer !== null) window.clearTimeout(this.idlePurgeTimer);
          this.idlePurgeTimer = window.setTimeout(() => {
            this.idlePurgeTimer = null;
            if (!this.activeTask && this.queue.length === 0) {
              this.trimPageBitmapCache(0);
            }
          }, IDLE_PAGE_BITMAP_PURGE_MS);
        } else {
          this.trimPageBitmapCache(0);
        }
      }
    }
  }

  private async executeTask(task: PendingStripTask): Promise<ImageBitmap> {
    const { request, abortController, id } = task;
    const { src, strip, engine, screenPx, isMobile } = request;

    // Hem Hızlı hem Yapay Zekâ modunda daha önce işlenmiş şeridin ~150 KB'lık Blob önbelleği varsa
    // GPU/AI çalıştırmadan (%0 GPU) 1ms içinde doğrudan decode et!
    const cachedBlob = this.getAiBlob(task.cacheKey);
    if (cachedBlob) {
      if (abortController.signal.aborted || task.generation !== this.generation) {
        throw makeAbortError();
      }
      return createImageBitmap(cachedBlob);
    }

    const acquired = await this.acquirePageBitmap(src, isMobile, abortController.signal);
    let stripBitmap: ImageBitmap;
    let outWidth: number;
    let outHeight: number;
    let cropTop = strip.cropTop;
    let cropBottom = strip.cropBottom;

    try {
      if (abortController.signal.aborted || task.generation !== this.generation) {
        throw makeAbortError();
      }

      const srcW = acquired.bitmap.width;
      const srcH = acquired.bitmap.height;
      const sliceY0 = Math.min(srcH - 1, Math.max(0, strip.y0));
      const sliceY1 = Math.min(srcH, Math.max(sliceY0 + 1, strip.y1));
      const sliceH = Math.max(1, sliceY1 - sliceY0);
      const validH = Math.max(1, strip.validY1 - strip.validY0);

      const sizes = computeStripOutputSize(srcW, validH, screenPx, DEFAULT_MAX_TEX_SIZE);
      outWidth = sizes.outWidth;
      outHeight = sizes.outHeight;

      if (sizes.inputScale < 1) {
        const scaledSliceH = Math.max(1, Math.round(sliceH * sizes.inputScale));
        cropTop = Math.round(strip.cropTop * sizes.inputScale);
        cropBottom = Math.round(strip.cropBottom * sizes.inputScale);
        stripBitmap = await createImageBitmap(acquired.bitmap, 0, sliceY0, srcW, sliceH, {
          resizeWidth: sizes.inputWidth,
          resizeHeight: scaledSliceH,
          resizeQuality: 'high',
        });
      } else {
        stripBitmap = await createImageBitmap(acquired.bitmap, 0, sliceY0, srcW, sliceH);
      }
    } finally {
      acquired.release();
    }

    if (abortController.signal.aborted || task.generation !== this.generation) {
      try {
        stripBitmap.close();
      } catch {
        // ignore
      }
      throw makeAbortError();
    }

    const cachedSupport = getCachedUpscaleSupport();
    const support = cachedSupport.checked ? cachedSupport : await detectUpscaleSupport();
    const preferWebGPU = support.webgpu;

    let resultBitmap: ImageBitmap;
    let workerBlob: Blob | undefined;
    const worker = this.ensureWorker();
    if (worker) {
      const workerOut = await new Promise<{ bitmap: ImageBitmap; blob?: Blob }>((resolve, reject) => {
        this.workerJobs.set(id, { resolve, reject });
        try {
          worker.postMessage(
            {
              type: 'process',
              id,
              bitmap: stripBitmap,
              engine,
              outWidth,
              outHeight,
              cropTop,
              cropBottom,
              preferWebGPU,
            },
            [stripBitmap],
          );
        } catch (err) {
          this.workerJobs.delete(id);
          try {
            stripBitmap.close();
          } catch {
            // ignore
          }
          reject(err);
        }
      });
      resultBitmap = workerOut.bitmap;
      workerBlob = workerOut.blob;
    } else {
      if (!this.mainProcessor) {
        this.mainProcessor = new UpscaleProcessor();
      }
      resultBitmap = await this.mainProcessor.process(
        {
          id,
          bitmap: stripBitmap,
          engine,
          outWidth,
          outHeight,
          cropTop,
          cropBottom,
          preferWebGPU,
        },
        {
          onProgress: (dl) =>
            this.updateStatus({
              download: dl.stage === 'ready' ? null : dl,
              lastError: dl.stage === 'error' ? dl.error || 'Model yüklenemedi' : this.statusSnapshot.lastError,
            }),
          isCancelled: () => abortController.signal.aborted || task.generation !== this.generation,
        },
      );
    }

    if (task.generation === this.generation && !abortController.signal.aborted) {
      const encoded = workerBlob ?? (await encodeBitmapToBlob(resultBitmap));
      if (encoded && encodeCanvas) {
        encodeCanvas.width = 1;
        encodeCanvas.height = 1;
      }
      if (encoded) {
        this.putAiBlob(task.cacheKey, encoded, isMobile);
      }
    }

    return resultBitmap;
  }

  cancelPage(src: string): void {
    const remaining: PendingStripTask[] = [];
    for (const task of this.queue) {
      if (task.request.src === src) {
        task.abortController.abort();
        task.cleanupAbortListener();
        task.reject(makeAbortError());
      } else {
        remaining.push(task);
      }
    }
    this.queue = remaining;

    if (this.activeTask?.request.src === src) {
      this.activeTask.abortController.abort();
      this.worker?.postMessage({ type: 'cancel', id: this.activeTask.id });
    }
    this.syncCounts();
  }

  cancelAll(disposeEngines = false): void {
    this.generation += 1;
    const queued = this.queue.splice(0, this.queue.length);
    for (const task of queued) {
      task.abortController.abort();
      task.cleanupAbortListener();
      task.reject(makeAbortError());
    }

    if (this.activeTask) {
      this.activeTask.abortController.abort();
      this.worker?.postMessage({ type: 'cancel', id: this.activeTask.id });
    }

    for (const [key, entry] of this.pageBitmapCache) {
      if (entry.inUse === 0) {
        this.pageBitmapCache.delete(key);
        try {
          entry.bitmap.close();
        } catch {
          // ignore
        }
      }
    }

    if (disposeEngines) {
      this.worker?.postMessage({ type: 'dispose' });
      void this.mainProcessor?.dispose();
      this.updateStatus({ download: null });
    }

    this.syncCounts();
  }
}

export const upscaleQueue = new UpscaleQueueManager();
