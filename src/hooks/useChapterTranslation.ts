import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { ResolvedReaderPage } from '@/lib/types';
import { PageTranslationState, TranslationBlock } from '@/lib/translation/types';
import {
  TranslationSettings,
  getEffectiveApiKeys,
  loadTranslationSettings,
  normalizeApiKeysList,
  saveTranslationSettings,
} from '@/lib/translation/translationSettings';
import {
  classifyTranslationError,
  extractPageOcr,
  ExtractedPageOcr,
  isAbortTranslationError,
  releaseExtractedPageOcr,
  translateAndInpaintPage,
  translatePageImage,
} from '@/lib/translation/geminiTranslator';
import {
  clearAllTranslationCache,
  clearChapterTranslationCache,
  getLocalChapterTranslations,
} from '@/lib/translation/localTranslationCache';
import {
  getCachedChapterTranslations,
  upsertPageTranslation,
} from '@/lib/translation/translationCache';

interface QueueJob {
  epoch: number;
  chapterId: string;
  pageIndex: number;
}

interface TransJob {
  epoch: number;
  chapterId: string;
  pageIndex: number;
  ocrData: ExtractedPageOcr;
}

const getMaxOcrConcurrency = (): number => {
  if (typeof navigator === 'undefined') return 1;
  const isMobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent || '');
  if (isMobile) return 1;
  const cores = navigator.hardwareConcurrency || 4;
  return cores >= 6 ? 2 : 1;
};

const MAX_TRANS_CONCURRENCY = 3;

export interface TranslationTimingsLog {
  ocrMs: number;
  transMs: number;
  totalMs: number;
  pageNumber: number;
  provider: 'gemini' | 'google';
}

export interface TranslationSummary {
  totalPages: number;
  doneCount: number;
  translatingCount: number;
  queuedCount: number;
  errorCount: number;
  activePageNumbers: number[];
  isBusy: boolean;
  batchDone: number;
  batchTotal: number;
  lastFinishedPageNumber: number | null;
  lastErrorMessage: string | null;
  completedPulseAt: number | null;
  lastTimings: TranslationTimingsLog | null;
  isPillDismissed: boolean;
}

export interface ReaderTranslationApi {
  enabled: boolean;
  cacheReady: boolean;
  wasCancelledManually: boolean;
  effectiveKeyCount: number;
  hasTranslatedPages: boolean;
  settings: TranslationSettings;
  updateSettings: (patch: Partial<TranslationSettings>) => void;
  pageStates: Record<number, PageTranslationState>;
  summary: TranslationSummary;
  translatePage: (pageIndex: number, options?: { force?: boolean }) => void;
  translateAllPages: () => void;
  retryFailedPages: () => void;
  cancelTranslation: () => void;
  dismissStatusFeedback: () => void;
  clearCurrentChapterCache: () => Promise<void>;
  clearAllCache: () => Promise<void>;
}

interface UseChapterTranslationOptions {
  chapterId: string;
  pages: ResolvedReaderPage[];
  currentPage: number;
  networkEnabled: boolean;
}

export const useChapterTranslation = ({
  chapterId,
  pages,
  currentPage,
  networkEnabled,
}: UseChapterTranslationOptions): ReaderTranslationApi => {
  const [settings, setSettings] = useState<TranslationSettings>(() => loadTranslationSettings());
  const [pageStates, setPageStates] = useState<Record<number, PageTranslationState>>({});
  const [cacheReady, setCacheReady] = useState(false);
  const [wasCancelledManually, setWasCancelledManually] = useState(false);
  const [lastErrorMessage, setLastErrorMessage] = useState<string | null>(null);
  const [completedPulseAt, setCompletedPulseAt] = useState<number | null>(null);
  const [lastFinishedPageNumber, setLastFinishedPageNumber] = useState<number | null>(null);
  const [lastTimings, setLastTimings] = useState<TranslationTimingsLog | null>(null);
  const [isPillDismissed, setIsPillDismissed] = useState(false);
  const [batchTracker, setBatchTracker] = useState<{ done: number; total: number }>({
    done: 0,
    total: 0,
  });

  const chapterEpochRef = useRef(0);
  const queueRef = useRef<QueueJob[]>([]);
  const transQueueRef = useRef<TransJob[]>([]);
  const runningOcrRef = useRef(0);
  const runningTransRef = useRef(0);
  const runningRef = useRef(0);
  const statesRef = useRef<Record<number, PageTranslationState>>({});
  const settingsRef = useRef(settings);
  const pagesRef = useRef(pages);
  const chapterRef = useRef(chapterId);
  const networkEnabledRef = useRef(networkEnabled);
  const abortControllerRef = useRef<AbortController>(new AbortController());
  const wasCancelledManuallyRef = useRef(false);

  settingsRef.current = settings;
  pagesRef.current = pages;
  networkEnabledRef.current = networkEnabled;

  const setPageState = useCallback((index: number, state: PageTranslationState) => {
    statesRef.current = { ...statesRef.current, [index]: state };
    setPageStates(statesRef.current);
  }, []);

  const updateSettings = useCallback((patch: Partial<TranslationSettings>) => {
    if (patch.autoTranslate === true) {
      wasCancelledManuallyRef.current = false;
      setWasCancelledManually(false);
    }
    setSettings((prev) => {
      const next: TranslationSettings = { ...prev, ...patch };
      if ('apiKeys' in patch && !('apiKey' in patch)) {
        const normalized = normalizeApiKeysList(patch.apiKeys);
        next.apiKeys = normalized;
        next.apiKey = normalized[0] || '';
      } else if ('apiKey' in patch && !('apiKeys' in patch)) {
        const normalized = normalizeApiKeysList(undefined, patch.apiKey);
        next.apiKeys = normalized;
        next.apiKey = normalized[0] || '';
      }
      settingsRef.current = next;
      saveTranslationSettings(next);
      return next;
    });
  }, []);

  // Sayfalar değiştiğinde (yeni bölümün sayfaları geldiğinde veya boşaldığında) kuyruk sınırlarını güncelle.
  useEffect(() => {
    pagesRef.current = pages;
    if (pages.length === 0) {
      queueRef.current = [];
      setBatchTracker((prev) => (prev.done === 0 && prev.total === 0 ? prev : { done: 0, total: 0 }));
      return;
    }
    const max = pages.length;
    queueRef.current = queueRef.current.filter((job) => job.pageIndex < max);
    setBatchTracker((prev) => {
      const nextDone = Math.min(prev.done, max);
      const nextTotal = Math.min(prev.total, max);
      return prev.done === nextDone && prev.total === nextTotal
        ? prev
        : { done: nextDone, total: nextTotal };
    });
  }, [pages]);

  // Bölüm veya hedef dil değiştiğinde:
  // 1. Önceki bölümün tüm devam eden isteklerini iptal et ve oturum epoch'unu artır.
  // 2. Kuyruğu ve durumları sıfırla; böylece eski bölümün sayfaları asla yeni bölüme sızamaz.
  // 3. Yeni bölümün yerel IndexedDB önbelleğini yükle.
  useEffect(() => {
    chapterEpochRef.current += 1;
    const currentEpoch = chapterEpochRef.current;
    chapterRef.current = chapterId;

    abortControllerRef.current.abort();
    abortControllerRef.current = new AbortController();
    wasCancelledManuallyRef.current = false;
    setWasCancelledManually(false);
    queueRef.current = [];
    transQueueRef.current.forEach((job) => releaseExtractedPageOcr(job.ocrData));
    transQueueRef.current = [];
    runningOcrRef.current = 0;
    runningTransRef.current = 0;
    runningRef.current = 0;
    statesRef.current = {};
    setPageStates({});
    setCacheReady(false);
    setLastErrorMessage(null);
    setCompletedPulseAt(null);
    setLastFinishedPageNumber(null);
    setLastTimings(null);
    setIsPillDismissed(false);
    setBatchTracker({ done: 0, total: 0 });

    if (!chapterId) {
      setCacheReady(true);
      return;
    }

    let cancelled = false;
    const activeLang = settings.targetLang;

    const loadCaches = async () => {
      try {
        const localMap = await getLocalChapterTranslations(chapterId, activeLang);
        if (cancelled || chapterEpochRef.current !== currentEpoch || chapterRef.current !== chapterId) return;
        if (localMap.size > 0) {
          const initial: Record<number, PageTranslationState> = {};
          localMap.forEach((blocks, index) => {
            initial[index] = { status: 'done', blocks };
          });
          statesRef.current = initial;
          setPageStates(initial);
        }

        if (networkEnabledRef.current) {
          const mergedMap = await getCachedChapterTranslations(chapterId, activeLang, {
            networkEnabled: true,
          });
          if (cancelled || chapterEpochRef.current !== currentEpoch || chapterRef.current !== chapterId) return;
          if (mergedMap.size > 0) {
            const next = { ...statesRef.current };
            let changed = false;
            mergedMap.forEach((blocks, index) => {
              const existing = next[index];
              if (!existing || existing.status === 'idle') {
                next[index] = { status: 'done', blocks };
                changed = true;
              }
            });
            if (changed) {
              statesRef.current = next;
              setPageStates(next);
            }
          }
        }
      } catch {
        // Önbellek okunamasa bile çeviri sistemi çalışmaya devam eder
      } finally {
        if (!cancelled && chapterEpochRef.current === currentEpoch && chapterRef.current === chapterId) {
          setCacheReady(true);
        }
      }
    };

    void loadCaches();

    return () => {
      cancelled = true;
    };
  }, [chapterId, settings.targetLang]);

  // Çevrimdışından çevrimiçine geçildiğinde mevcut durumu silmeden uzak önbelleği birleştir.
  useEffect(() => {
    if (!networkEnabled || !chapterId || !cacheReady) return;
    let cancelled = false;
    const currentEpoch = chapterEpochRef.current;
    const activeLang = settings.targetLang;

    getCachedChapterTranslations(chapterId, activeLang, { networkEnabled: true })
      .then((mergedMap) => {
        if (cancelled || chapterEpochRef.current !== currentEpoch || chapterRef.current !== chapterId) return;
        const next = { ...statesRef.current };
        let changed = false;
        mergedMap.forEach((blocks, index) => {
          const existing = next[index];
          if (!existing || existing.status === 'idle') {
            next[index] = { status: 'done', blocks };
            changed = true;
          }
        });
        if (changed) {
          statesRef.current = next;
          setPageStates(next);
        }
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [networkEnabled, chapterId, settings.targetLang, cacheReady]);

  // Bileşen kapanırken çalışan istekleri temizle
  useEffect(() => () => {
    abortControllerRef.current.abort();
    queueRef.current = [];
    transQueueRef.current.forEach((job) => releaseExtractedPageOcr(job.ocrData));
    transQueueRef.current = [];
  }, []);

  const runQueue = useCallback(() => {
    const currentEpoch = chapterEpochRef.current;
    const currentChapter = chapterRef.current;
    const activeKeys = getEffectiveApiKeys(settingsRef.current);
    const langAtStart = settingsRef.current.targetLang;
    const signal = abortControllerRef.current.signal;

    // 1. AŞAMA: OCR İşlemcisi (CPU / WASM Worker)
    // Mobil cihazlarda kesinlikle 1 (cihazı ısıtmaz/kasmayacak), 6+ çekirdekli PC'lerde 2 paralel OCR.
    const maxOcr = getMaxOcrConcurrency();
    while (runningOcrRef.current < maxOcr && queueRef.current.length > 0) {
      const job = queueRef.current.shift() as QueueJob;
      if (!job) break;

      // İş başka bir bölüme veya önceki bir oturuma aitse derhal atla
      if (job.chapterId !== currentChapter || job.epoch !== currentEpoch) {
        continue;
      }

      const index = job.pageIndex;
      const state = statesRef.current[index];
      if (state && (state.status === 'translating' || state.status === 'done')) continue;

      const src = pagesRef.current[index]?.src;
      if (!src) {
        if (state?.status === 'queued') {
          setPageState(index, { status: 'idle' });
        }
        continue;
      }

      runningOcrRef.current += 1;
      runningRef.current = runningOcrRef.current + runningTransRef.current;
      setPageState(index, { status: 'translating' });

      const prevSrc = index > 0 ? pagesRef.current[index - 1]?.src : undefined;
      const nextSrc =
        index + 1 < pagesRef.current.length ? pagesRef.current[index + 1]?.src : undefined;

      extractPageOcr({
        imageSrc: src,
        prevImageSrc: prevSrc,
        nextImageSrc: nextSrc,
        targetLang: langAtStart,
        signal,
      })
        .then(async (ocrData) => {
          if (
            signal.aborted ||
            currentEpoch !== chapterEpochRef.current ||
            chapterRef.current !== currentChapter ||
            settingsRef.current.targetLang !== langAtStart
          ) {
            releaseExtractedPageOcr(ocrData);
            return;
          }

          // Eğer sayfada metin yoksa veya reklam/jenerik sayfasıysa Gemini'ye gitmeden direkt tamamla
          if (ocrData.rawBubbles.length === 0) {
            releaseExtractedPageOcr(ocrData);
            setPageState(index, { status: 'done', blocks: [] });
            setLastFinishedPageNumber(index + 1);
            setBatchTracker((prev) => ({
              total: Math.max(prev.total, prev.done + 1),
              done: prev.done + 1,
            }));
            await upsertPageTranslation(currentChapter, index, langAtStart, [], {
              networkEnabled: networkEnabledRef.current,
            });
            return;
          }

          // Balonlar çıkarıldı! OCR işi bitti, hemen 2. aşama kuyruğuna devret
          transQueueRef.current.push({
            epoch: currentEpoch,
            chapterId: currentChapter,
            pageIndex: index,
            ocrData,
          });
          runQueue();
        })
        .catch((err) => {
          if (
            isAbortTranslationError(err) ||
            signal.aborted ||
            currentEpoch !== chapterEpochRef.current ||
            chapterRef.current !== currentChapter ||
            settingsRef.current.targetLang !== langAtStart
          ) {
            return;
          }
          console.error('[OCR Error]', err);
          setPageState(index, { status: 'error' });
          setLastErrorMessage(classifyTranslationError(err));
        })
        .finally(() => {
          if (currentEpoch === chapterEpochRef.current) {
            runningOcrRef.current = Math.max(0, runningOcrRef.current - 1);
            runningRef.current = runningOcrRef.current + runningTransRef.current;
            runQueue();
          }
        });
    }

    // 2. AŞAMA: Çeviri & Inpaint İşlemcisi (Ağ I/O + WebP Inpaint)
    // Gemini/Google metin çevirisi hafif HTTP isteğidir; 3 sayfaya kadar paralel çalışabilir.
    while (runningTransRef.current < MAX_TRANS_CONCURRENCY && transQueueRef.current.length > 0) {
      const transJob = transQueueRef.current.shift() as TransJob;
      if (!transJob) break;

      if (transJob.chapterId !== currentChapter || transJob.epoch !== currentEpoch) {
        releaseExtractedPageOcr(transJob.ocrData);
        continue;
      }

      const index = transJob.pageIndex;
      runningTransRef.current += 1;
      runningRef.current = runningOcrRef.current + runningTransRef.current;

      translateAndInpaintPage({
        ocrData: transJob.ocrData,
        apiKey: activeKeys[0] || settingsRef.current.apiKey,
        apiKeys: activeKeys,
        provider: settingsRef.current.provider,
        targetLang: langAtStart,
        signal,
      })
        .then(async ({ blocks, timings }) => {
          if (
            signal.aborted ||
            currentEpoch !== chapterEpochRef.current ||
            chapterRef.current !== currentChapter ||
            settingsRef.current.targetLang !== langAtStart
          ) {
            return;
          }
          setPageState(index, { status: 'done', blocks });
          setLastFinishedPageNumber(index + 1);
          setLastTimings({
            ocrMs: timings.ocrMs,
            transMs: timings.transMs,
            totalMs: timings.totalMs,
            pageNumber: index + 1,
            provider: settingsRef.current.provider,
          });
          setBatchTracker((prev) => ({
            total: Math.max(prev.total, prev.done + 1),
            done: prev.done + 1,
          }));
          await upsertPageTranslation(currentChapter, index, langAtStart, blocks, {
            networkEnabled: networkEnabledRef.current,
          });
        })
        .catch((err) => {
          if (
            isAbortTranslationError(err) ||
            signal.aborted ||
            currentEpoch !== chapterEpochRef.current ||
            chapterRef.current !== currentChapter ||
            settingsRef.current.targetLang !== langAtStart
          ) {
            return;
          }
          console.error('[Translation Error]', err);
          setPageState(index, { status: 'error' });
          setLastErrorMessage(classifyTranslationError(err));
        })
        .finally(() => {
          if (currentEpoch === chapterEpochRef.current) {
            runningTransRef.current = Math.max(0, runningTransRef.current - 1);
            runningRef.current = runningOcrRef.current + runningTransRef.current;
            runQueue();
          }
        });
    }

    // Tamamlanma Kontrolü:
    if (
      runningOcrRef.current === 0 &&
      runningTransRef.current === 0 &&
      queueRef.current.length === 0 &&
      transQueueRef.current.length === 0 &&
      !wasCancelledManuallyRef.current &&
      !signal.aborted
    ) {
      const hasDone = Object.values(statesRef.current).some((s) => s.status === 'done');
      const hasErr = Object.values(statesRef.current).some((s) => s.status === 'error');
      if (hasDone && !hasErr) {
        setCompletedPulseAt(Date.now());
      }
      setBatchTracker({ done: 0, total: 0 });
    }
  }, [setPageState]);

  const ensureCanStartTranslation = useCallback((): boolean => {
    if (!networkEnabledRef.current) {
      toast.error('Yeni sayfa çevirmek için internet bağlantısı gerekiyor.');
      return false;
    }
    if (
      settingsRef.current.provider === 'gemini' &&
      getEffectiveApiKeys(settingsRef.current).length === 0
    ) {
      toast.error(
        'Gemini Flash-Lite çevirisi için lütfen Görsel Çeviri panelinden en az bir API anahtarı ekleyin veya Google Çeviri motorunu seçin.',
      );
      return false;
    }
    return true;
  }, []);

  const enqueueIndices = useCallback(
    (indices: number[], options?: { force?: boolean; prioritize?: boolean }) => {
      const activeChapterId = chapterRef.current;
      const currentEpoch = chapterEpochRef.current;
      if (!activeChapterId || indices.length === 0 || pagesRef.current.length === 0) return;

      wasCancelledManuallyRef.current = false;
      setWasCancelledManually(false);
      const isCurrentlyBusy =
        runningOcrRef.current > 0 ||
        runningTransRef.current > 0 ||
        queueRef.current.length > 0 ||
        transQueueRef.current.length > 0;
      if (!isCurrentlyBusy) {
        setIsPillDismissed(false);
      }
      setLastErrorMessage(null);
      setCompletedPulseAt(null);

      if (abortControllerRef.current.signal.aborted) {
        abortControllerRef.current = new AbortController();
      }

      const activeIndicesInQueue = new Set(
        queueRef.current
          .filter((j) => j.chapterId === activeChapterId && j.epoch === currentEpoch)
          .map((j) => j.pageIndex),
      );
      const validAdditions: QueueJob[] = [];

      for (const pageIndex of indices) {
        if (pageIndex < 0 || pageIndex >= pagesRef.current.length) continue;
        const state = statesRef.current[pageIndex];
        if (!options?.force && state && ['queued', 'translating', 'done'].includes(state.status)) {
          continue;
        }
        if (options?.force && state?.status === 'translating') {
          continue;
        }
        setPageState(pageIndex, { status: 'queued' });
        if (!activeIndicesInQueue.has(pageIndex)) {
          validAdditions.push({ epoch: currentEpoch, chapterId: activeChapterId, pageIndex });
          activeIndicesInQueue.add(pageIndex);
        }
      }

      if (validAdditions.length === 0 && !options?.prioritize) return;

      setBatchTracker((prev) => {
        const activeNow =
          runningOcrRef.current +
          runningTransRef.current +
          queueRef.current.length +
          transQueueRef.current.length;
        if (activeNow === 0) {
          return { done: 0, total: validAdditions.length };
        }
        return { done: prev.done, total: prev.total + validAdditions.length };
      });

      if (options?.prioritize) {
        const priorityIndices = new Set(indices);
        const rest = queueRef.current.filter((j) => !priorityIndices.has(j.pageIndex));
        const prioritized = validAdditions.sort((a, b) => a.pageIndex - b.pageIndex);
        queueRef.current = [...prioritized, ...rest];
      } else {
        const existingKeys = new Set(queueRef.current.map((j) => `${j.chapterId}:${j.pageIndex}`));
        const toAppend = validAdditions.filter((j) => !existingKeys.has(`${j.chapterId}:${j.pageIndex}`));
        queueRef.current = [...queueRef.current, ...toAppend].sort((a, b) => a.pageIndex - b.pageIndex);
      }

      if (!settingsRef.current.overlayVisible) {
        updateSettings({ overlayVisible: true });
      }

      runQueue();
    },
    [runQueue, setPageState, updateSettings],
  );

  const translatePage = useCallback(
    (pageIndex: number, options?: { force?: boolean }) => {
      if (!ensureCanStartTranslation()) return;
      enqueueIndices([pageIndex], { force: options?.force, prioritize: true });
    },
    [enqueueIndices, ensureCanStartTranslation],
  );

  const translateAllPages = useCallback(() => {
    if (!ensureCanStartTranslation()) return;
    const total = pagesRef.current.length;
    if (total === 0) return;

    // Sayfaları kesin sıralı olarak baştan sona (1, 2, 3, 4...) sıraya al
    const ordered: number[] = [];
    for (let i = 0; i < total; i += 1) ordered.push(i);

    const pending = ordered.filter((idx) => {
      const st = statesRef.current[idx];
      return !st || st.status === 'idle' || st.status === 'error';
    });

    if (pending.length === 0) {
      toast.info('Bu bölümdeki tüm sayfalar zaten çevrildi.');
      return;
    }

    enqueueIndices(pending);
  }, [enqueueIndices, ensureCanStartTranslation]);

  const retryFailedPages = useCallback(() => {
    if (!ensureCanStartTranslation()) return;
    const failedIndices = Object.entries(statesRef.current)
      .filter(([, st]) => st.status === 'error')
      .map(([idx]) => Number(idx))
      .sort((a, b) => a - b);

    if (failedIndices.length === 0) return;
    enqueueIndices(failedIndices, { force: true, prioritize: true });
  }, [enqueueIndices, ensureCanStartTranslation]);

  const cancelTranslation = useCallback(() => {
    chapterEpochRef.current += 1;
    wasCancelledManuallyRef.current = true;
    setWasCancelledManually(true);
    abortControllerRef.current.abort();
    abortControllerRef.current = new AbortController();
    queueRef.current = [];
    transQueueRef.current.forEach((job) => releaseExtractedPageOcr(job.ocrData));
    transQueueRef.current = [];
    runningOcrRef.current = 0;
    runningTransRef.current = 0;
    runningRef.current = 0;

    const next = { ...statesRef.current };
    let changed = false;
    Object.keys(next).forEach((key) => {
      const idx = Number(key);
      const st = next[idx];
      if (st && (st.status === 'queued' || st.status === 'translating')) {
        next[idx] = { status: 'idle' };
        changed = true;
      }
    });
    if (changed) {
      statesRef.current = next;
      setPageStates(next);
    }
    setBatchTracker({ done: 0, total: 0 });
  }, []);

  const dismissStatusFeedback = useCallback(() => {
    setIsPillDismissed(true);
    setLastErrorMessage(null);
    setCompletedPulseAt(null);
  }, []);

  const clearCurrentChapterCache = useCallback(async () => {
    cancelTranslation();
    if (chapterRef.current) {
      await clearChapterTranslationCache(chapterRef.current, settingsRef.current.targetLang);
    }
    statesRef.current = {};
    setPageStates({});
    setLastErrorMessage(null);
    setCompletedPulseAt(null);
    setLastFinishedPageNumber(null);
  }, [cancelTranslation]);

  const clearAllCache = useCallback(async () => {
    cancelTranslation();
    await clearAllTranslationCache();
    statesRef.current = {};
    setPageStates({});
    setLastErrorMessage(null);
    setCompletedPulseAt(null);
    setLastFinishedPageNumber(null);
  }, [cancelTranslation]);

  const effectiveKeyCount = getEffectiveApiKeys(settings).length;
  const requiresApiKey = settings.provider === 'gemini';

  // Otomatik çeviri: önbellek yüklendikten sonra çevrilmemiş sayfaları KESİNLİKLE 1. sayfadan (0'dan) itibaren baştan sona sırayla kuyruğa alır.
  useEffect(() => {
    if (
      !settings.autoTranslate ||
      wasCancelledManually ||
      wasCancelledManuallyRef.current ||
      (requiresApiKey && effectiveKeyCount === 0) ||
      !networkEnabled ||
      !cacheReady ||
      !chapterId ||
      pages.length === 0
    ) {
      return;
    }

    const order: number[] = [];
    for (let i = 0; i < pages.length; i += 1) order.push(i);

    const activeIndices = new Set(queueRef.current.map((j) => j.pageIndex));
    const additions = order.filter((index) => {
      const state = statesRef.current[index];
      const pending = !state || state.status === 'idle';
      return pending && !activeIndices.has(index);
    });
    if (additions.length === 0) return;

    enqueueIndices(additions);
  }, [
    settings.autoTranslate,
    requiresApiKey,
    effectiveKeyCount,
    settings.targetLang,
    wasCancelledManually,
    networkEnabled,
    cacheReady,
    chapterId,
    pages,
    enqueueIndices,
  ]);

  // Otomatik çeviri kapatılınca bekleyen kuyruğu temizle.
  useEffect(() => {
    if (settings.autoTranslate) return;
    const pending = queueRef.current;
    if (pending.length === 0) return;
    queueRef.current = [];
    pending.forEach((job) => {
      if (statesRef.current[job.pageIndex]?.status === 'queued') {
        setPageState(job.pageIndex, { status: 'idle' });
      }
    });
  }, [settings.autoTranslate, setPageState]);

  // Tamamlandı bildirimi 3.2 sn sonra kendiliğinden kaybolur.
  useEffect(() => {
    if (!completedPulseAt) return;
    const timer = window.setTimeout(() => {
      setCompletedPulseAt((current) => (current === completedPulseAt ? null : current));
    }, 3200);
    return () => window.clearTimeout(timer);
  }, [completedPulseAt]);

  const summary = useMemo<TranslationSummary>(() => {
    let doneCount = 0;
    let translatingCount = 0;
    let queuedCount = 0;
    let errorCount = 0;
    const activePageNumbers: number[] = [];

    Object.entries(pageStates).forEach(([idxStr, state]) => {
      if (!state) return;
      if (state.status === 'done') doneCount += 1;
      else if (state.status === 'translating') {
        translatingCount += 1;
        activePageNumbers.push(Number(idxStr) + 1);
      } else if (state.status === 'queued') {
        queuedCount += 1;
      } else if (state.status === 'error') {
        errorCount += 1;
      }
    });

    activePageNumbers.sort((a, b) => a - b);
    const isBusy = translatingCount > 0 || queuedCount > 0;

    return {
      totalPages: pages.length,
      doneCount,
      translatingCount,
      queuedCount,
      errorCount,
      activePageNumbers,
      isBusy,
      batchDone: batchTracker.done,
      batchTotal: batchTracker.total,
      lastFinishedPageNumber,
      lastErrorMessage,
      completedPulseAt,
      lastTimings,
      isPillDismissed,
    };
  }, [
    batchTracker.done,
    batchTracker.total,
    completedPulseAt,
    isPillDismissed,
    lastErrorMessage,
    lastFinishedPageNumber,
    lastTimings,
    pageStates,
    pages.length,
  ]);

  return {
    enabled: networkEnabled,
    cacheReady,
    wasCancelledManually,
    effectiveKeyCount,
    hasTranslatedPages: summary.doneCount > 0,
    settings,
    updateSettings,
    pageStates,
    summary,
    translatePage,
    translateAllPages,
    retryFailedPages,
    cancelTranslation,
    dismissStatusFeedback,
    clearCurrentChapterCache,
    clearAllCache,
  };
};
