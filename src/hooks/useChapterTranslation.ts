import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { ResolvedReaderPage } from '@/lib/types';
import { PageTranslationState, TranslationBlock } from '@/lib/translation/types';
import {
  TranslationSettings,
  loadTranslationSettings,
  saveTranslationSettings,
} from '@/lib/translation/translationSettings';
import { translatePageImage } from '@/lib/translation/geminiTranslator';
import {
  getCachedChapterTranslations,
  upsertPageTranslation,
} from '@/lib/translation/translationCache';

const MAX_CONCURRENT_TRANSLATIONS = 2;

export interface ReaderTranslationApi {
  enabled: boolean;
  settings: TranslationSettings;
  updateSettings: (patch: Partial<TranslationSettings>) => void;
  pageStates: Record<number, PageTranslationState>;
  translatePage: (pageIndex: number, options?: { force?: boolean }) => void;
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

  const queueRef = useRef<number[]>([]);
  const runningRef = useRef(0);
  const statesRef = useRef<Record<number, PageTranslationState>>({});
  const settingsRef = useRef(settings);
  const pagesRef = useRef(pages);
  const chapterRef = useRef(chapterId);

  settingsRef.current = settings;
  pagesRef.current = pages;

  const setPageState = useCallback((index: number, state: PageTranslationState) => {
    // statesRef senkron güncellenir ki kuyruk döngüsü render beklemeden doğru durumu görsün.
    statesRef.current = { ...statesRef.current, [index]: state };
    setPageStates(statesRef.current);
  }, []);

  const updateSettings = useCallback((patch: Partial<TranslationSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      saveTranslationSettings(next);
      return next;
    });
  }, []);

  // Bölüm veya hedef dil değişince durumları sıfırla, ortak önbelleği yükle.
  useEffect(() => {
    chapterRef.current = chapterId;
    queueRef.current = [];
    statesRef.current = {};
    setPageStates({});
    setCacheReady(false);
    if (!chapterId || !networkEnabled) {
      setCacheReady(true);
      return;
    }

    let cancelled = false;
    getCachedChapterTranslations(chapterId, settings.targetLang)
      .then((cached) => {
        if (cancelled || chapterRef.current !== chapterId) return;
        const next: Record<number, PageTranslationState> = {};
        cached.forEach((blocks, index) => {
          next[index] = { status: 'done', blocks };
        });
        statesRef.current = next;
        setPageStates(next);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setCacheReady(true);
      });

    return () => {
      cancelled = true;
    };
  }, [chapterId, settings.targetLang, networkEnabled]);

  const runQueue = useCallback(() => {
    while (runningRef.current < MAX_CONCURRENT_TRANSLATIONS && queueRef.current.length > 0) {
      const index = queueRef.current.shift() as number;
      const state = statesRef.current[index];
      if (state && (state.status === 'translating' || state.status === 'done')) continue;

      const src = pagesRef.current[index]?.src;
      if (!src) continue;

      const chapterAtStart = chapterRef.current;
      const langAtStart = settingsRef.current.targetLang;

      runningRef.current += 1;
      setPageState(index, { status: 'translating' });

      translatePageImage({ apiKey: settingsRef.current.apiKey, imageSrc: src, targetLang: langAtStart })
        .then(async (blocks: TranslationBlock[]) => {
          if (chapterRef.current !== chapterAtStart || settingsRef.current.targetLang !== langAtStart) return;
          setPageState(index, { status: 'done', blocks });
          try {
            await upsertPageTranslation(chapterAtStart, index, langAtStart, blocks);
          } catch {
            // Önbelleğe yazılamasa bile çeviri kullanıcıya gösterilir (örn. giriş yapılmamış).
          }
        })
        .catch(() => {
          if (chapterRef.current !== chapterAtStart || settingsRef.current.targetLang !== langAtStart) return;
          setPageState(index, { status: 'error' });
        })
        .finally(() => {
          runningRef.current -= 1;
          runQueue();
        });
    }
  }, [setPageState]);

  const translatePage = useCallback(
    (pageIndex: number, options?: { force?: boolean }) => {
      if (!networkEnabled) return;
      if (!settingsRef.current.apiKey) {
        toast.error('Önce çeviri ayarlarından Gemini API anahtarını girin.');
        return;
      }
      const state = statesRef.current[pageIndex];
      if (!options?.force && state && ['queued', 'translating', 'done'].includes(state.status)) return;

      setPageState(pageIndex, { status: 'queued' });
      queueRef.current = [pageIndex, ...queueRef.current.filter((i) => i !== pageIndex)];
      runQueue();
    },
    [networkEnabled, runQueue, setPageState],
  );

  // Auto-translate: önbellek yüklendikten sonra çevrilmemiş sayfaları
  // aktif sayfadan başlayarak sıralı kuyruğa ekler.
  useEffect(() => {
    if (!settings.autoTranslate || !settings.apiKey || !networkEnabled || !cacheReady || !chapterId || pages.length === 0) {
      return;
    }
    const startIndex = Math.max(0, currentPage - 1);
    const order: number[] = [];
    for (let i = startIndex; i < pages.length; i += 1) order.push(i);
    for (let i = 0; i < startIndex; i += 1) order.push(i);

    const queuedSet = new Set(queueRef.current);
    const additions = order.filter((index) => {
      const state = statesRef.current[index];
      const pending = !state || state.status === 'idle';
      return pending && !queuedSet.has(index);
    });
    if (additions.length === 0) return;

    additions.forEach((index) => setPageState(index, { status: 'queued' }));
    queueRef.current = [...queueRef.current, ...additions];
    runQueue();
  }, [settings.autoTranslate, settings.apiKey, settings.targetLang, networkEnabled, cacheReady, chapterId, pages.length, currentPage, runQueue, setPageState]);

  // Auto kapatılınca bekleyen kuyruğu boşalt (çalışan istekler doğal biter).
  useEffect(() => {
    if (settings.autoTranslate) return;
    const pending = queueRef.current;
    queueRef.current = [];
    pending.forEach((index) => {
      if (statesRef.current[index]?.status === 'queued') {
        setPageState(index, { status: 'idle' });
      }
    });
  }, [settings.autoTranslate, setPageState]);

  // Kullanıcı sayfa değiştirince aktif sayfa kuyruğun başına alınır.
  useEffect(() => {
    const index = currentPage - 1;
    if (queueRef.current.includes(index)) {
      queueRef.current = [index, ...queueRef.current.filter((i) => i !== index)];
    }
  }, [currentPage]);

  return {
    enabled: networkEnabled,
    settings,
    updateSettings,
    pageStates,
    translatePage,
  };
};
