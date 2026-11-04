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
  isAbortTranslationError,
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

const getMaxConcurrentTranslations = (settings: TranslationSettings): number => {
  if (!settings.parallelMode) return 1;
  const keyCount = Math.max(1, getEffectiveApiKeys(settings).length);
  return Math.min(Math.max(2, keyCount * 2), 6);
};

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
  const [lastErrorMessage, setLastErrorMessage] = useState<string | null>(null);
  const [completedPulseAt, setCompletedPulseAt] = useState<number | null>(null);
  const [lastFinishedPageNumber, setLastFinishedPageNumber] = useState<number | null>(null);
  const [lastTimings, setLastTimings] = useState<TranslationTimingsLog | null>(null);
  const [isPillDismissed, setIsPillDismissed] = useState(false);
  const [batchTracker, setBatchTracker] = useState<{ done: number; total: number }>({
    done: 0,
    total: 0,
  });

  const queueRef = useRef<number[]>([]);
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

  // Bölüm veya hedef dil değiştiğinde kuyruğu durdurup önce yerel IndexedDB önbelleğini anında yükler.
  // API anahtarı boş veya çevrimdışı olsa bile önbellekteki çeviriler eksiksiz gösterilir.
  useEffect(() => {
    chapterRef.current = chapterId;
    abortControllerRef.current.abort();
    abortControllerRef.current = new AbortController();
    queueRef.current = [];
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
        if (cancelled || chapterRef.current !== chapterId) return;
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
          if (cancelled || chapterRef.current !== chapterId) return;
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
        if (!cancelled && chapterRef.current === chapterId) {
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
    const activeLang = settings.targetLang;

    getCachedChapterTranslations(chapterId, activeLang, { networkEnabled: true })
      .then((mergedMap) => {
        if (cancelled || chapterRef.current !== chapterId) return;
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
  }, []);

  const runQueue = useCallback(() => {
    while (
      runningRef.current < getMaxConcurrentTranslations(settingsRef.current) &&
      queueRef.current.length > 0
    ) {
      const index = queueRef.current.shift() as number;
      const state = statesRef.current[index];
      if (state && (state.status === 'translating' || state.status === 'done')) continue;

      const src = pagesRef.current[index]?.src;
      if (!src) {
        if (state?.status === 'queued') {
          setPageState(index, { status: 'idle' });
        }
        continue;
      }

      const chapterAtStart = chapterRef.current;
      const langAtStart = settingsRef.current.targetLang;
      const activeKeys = getEffectiveApiKeys(settingsRef.current);
      const parallelAtStart = settingsRef.current.parallelMode;
      const signal = abortControllerRef.current.signal;

      runningRef.current += 1;
      setPageState(index, { status: 'translating' });

      translatePageImage({
        apiKey: activeKeys[0] || settingsRef.current.apiKey,
        apiKeys: activeKeys,
        provider: settingsRef.current.provider,
        parallelMode: parallelAtStart,
        imageSrc: src,
        targetLang: langAtStart,
        signal,
      })
        .then(async ({ blocks, timings }) => {
          if (
            signal.aborted ||
            chapterRef.current !== chapterAtStart ||
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
          await upsertPageTranslation(chapterAtStart, index, langAtStart, blocks, {
            networkEnabled: networkEnabledRef.current,
          });
        })
        .catch((err) => {
          if (
            isAbortTranslationError(err) ||
            signal.aborted ||
            chapterRef.current !== chapterAtStart ||
            settingsRef.current.targetLang !== langAtStart
          ) {
            return;
          }
          setPageState(index, { status: 'error' });
          setLastErrorMessage(classifyTranslationError(err));
        })
        .finally(() => {
          runningRef.current = Math.max(0, runningRef.current - 1);
          if (
            runningRef.current === 0 &&
            queueRef.current.length === 0 &&
            !wasCancelledManuallyRef.current &&
            !abortControllerRef.current.signal.aborted
          ) {
            const hasDone = Object.values(statesRef.current).some((s) => s.status === 'done');
            const hasErr = Object.values(statesRef.current).some((s) => s.status === 'error');
            if (hasDone && !hasErr) {
              setCompletedPulseAt(Date.now());
            }
            setBatchTracker({ done: 0, total: 0 });
          } else {
            runQueue();
          }
        });
    }
  }, [setPageState]);

  const ensureCanStartTranslation = useCallback((): boolean => {
    if (!networkEnabledRef.current) {
      toast.error('Yeni sayfa çevirmek için internet bağlantısı gerekiyor.');
      return false;
    }
    if (settingsRef.current.provider === 'gemini' && getEffectiveApiKeys(settingsRef.current).length === 0) {
      toast.error('Önce Görsel Çeviri ayarlarından en az bir Gemini API anahtarı ekleyin.');
      return false;
    }
    return true;
  }, []);

  const enqueueIndices = useCallback(
    (indices: number[], options?: { force?: boolean; prioritize?: boolean }) => {
      if (indices.length === 0) return;
      wasCancelledManuallyRef.current = false;
      const isCurrentlyBusy = runningRef.current > 0 || queueRef.current.length > 0;
      if (!isCurrentlyBusy) {
        setIsPillDismissed(false);
      }
      setLastErrorMessage(null);
      setCompletedPulseAt(null);

      if (abortControllerRef.current.signal.aborted) {
        abortControllerRef.current = new AbortController();
      }

      const queuedSet = new Set(queueRef.current);
      const validAdditions: number[] = [];

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
        if (!queuedSet.has(pageIndex)) {
          validAdditions.push(pageIndex);
          queuedSet.add(pageIndex);
        }
      }

      if (validAdditions.length === 0 && !options?.prioritize) return;

      setBatchTracker((prev) => {
        const activeNow = runningRef.current + queueRef.current.length;
        if (activeNow === 0) {
          return { done: 0, total: validAdditions.length };
        }
        return { done: prev.done, total: prev.total + validAdditions.length };
      });

      if (options?.prioritize) {
        const rest = queueRef.current.filter((i) => !indices.includes(i));
        const prioritized = indices
          .filter((i) => statesRef.current[i]?.status === 'queued')
          .sort((a, b) => a - b);
        queueRef.current = [...prioritized, ...rest];
      } else {
        const nextQueue = Array.from(new Set([...queueRef.current, ...validAdditions]));
        nextQueue.sort((a, b) => a - b);
        queueRef.current = nextQueue;
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
    wasCancelledManuallyRef.current = true;
    abortControllerRef.current.abort();
    abortControllerRef.current = new AbortController();
    queueRef.current = [];
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

    if (settingsRef.current.autoTranslate) {
      updateSettings({ autoTranslate: false });
    }
  }, [updateSettings]);

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

  // Paralel mod açıldığında veya yeni anahtar eklendiğinde bekleyen kuyruğu yeni eşzamanlılık sınırı ile besle.
  useEffect(() => {
    if (queueRef.current.length > 0) {
      runQueue();
    }
  }, [settings.parallelMode, effectiveKeyCount, runQueue]);

  // Otomatik çeviri: önbellek yüklendikten sonra çevrilmemiş sayfaları aktif sayfadan başlayarak kuyruğa alır.
  useEffect(() => {
    if (
      !settings.autoTranslate ||
      effectiveKeyCount === 0 ||
      !networkEnabled ||
      !cacheReady ||
      !chapterId ||
      pages.length === 0
    ) {
      return;
    }

    // Otomatik çeviri: önbellek yüklendikten sonra çevrilmemiş sayfaları KESİNLİKLE 1. sayfadan (0'dan) itibaren baştan sona sırayla kuyruğa alır.
    const order: number[] = [];
    for (let i = 0; i < pages.length; i += 1) order.push(i);

    const queuedSet = new Set(queueRef.current);
    const additions = order.filter((index) => {
      const state = statesRef.current[index];
      const pending = !state || state.status === 'idle';
      return pending && !queuedSet.has(index);
    });
    if (additions.length === 0) return;

    enqueueIndices(additions);
  }, [
    settings.autoTranslate,
    effectiveKeyCount,
    settings.targetLang,
    networkEnabled,
    cacheReady,
    chapterId,
    pages.length,
    enqueueIndices,
  ]);

  // Otomatik çeviri kapatılınca bekleyen kuyruğu temizle.
  useEffect(() => {
    if (settings.autoTranslate) return;
    const pending = queueRef.current;
    if (pending.length === 0) return;
    queueRef.current = [];
    pending.forEach((index) => {
      if (statesRef.current[index]?.status === 'queued') {
        setPageState(index, { status: 'idle' });
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
