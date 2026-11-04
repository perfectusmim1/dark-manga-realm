import { useCallback, useEffect, useRef, useState } from 'react';
import { Chapter } from '@/lib/types';
import {
  TranslationSettings,
  getEffectiveApiKeys,
} from '@/lib/translation/translationSettings';
import {
  isAbortTranslationError,
  translatePageImage,
} from '@/lib/translation/geminiTranslator';
import {
  getCachedChapterTranslations,
  upsertPageTranslation,
} from '@/lib/translation/translationCache';

export interface NextChapterTranslationProgress {
  chapterNumber: number | string;
  chapterId: string;
  completedPages: number;
  totalPages: number;
  percent: number;
}

export interface NextChapterTranslationApi {
  isPretranslating: boolean;
  progress: NextChapterTranslationProgress | null;
  cancelPretranslation: () => void;
}

interface UseNextChapterTranslationOptions {
  currentChapterId?: string | null;
  nextChapter?: Chapter | null;
  isCurrentChapterBusy: boolean;
  networkEnabled: boolean;
  settings: TranslationSettings;
  ensureChapterPagesLoaded: (chapter: Chapter) => Promise<Chapter | null | undefined>;
}

export const useNextChapterTranslation = ({
  currentChapterId,
  nextChapter,
  isCurrentChapterBusy,
  networkEnabled,
  settings,
  ensureChapterPagesLoaded,
}: UseNextChapterTranslationOptions): NextChapterTranslationApi => {
  const [isPretranslating, setIsPretranslating] = useState(false);
  const [progress, setProgress] = useState<NextChapterTranslationProgress | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);
  const isCancelledManuallyRef = useRef(false);

  const cancelPretranslation = useCallback(() => {
    isCancelledManuallyRef.current = true;
    abortControllerRef.current?.abort();
    setIsPretranslating(false);
    setProgress(null);
  }, []);

  useEffect(() => {
    // 1. Ön koşul kontrolleri
    if (
      !settings.prefetchNextChapterTranslation ||
      !networkEnabled ||
      !nextChapter ||
      !nextChapter.id ||
      nextChapter.id === currentChapterId ||
      isCancelledManuallyRef.current
    ) {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
      setIsPretranslating(false);
      setProgress(null);
      return;
    }

    // 2. Aktif bölüm meşgulse (kullanıcı aktif bölümü çeviriyorsa) arka planı durdur / bekle
    if (isCurrentChapterBusy) {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
      setIsPretranslating(false);
      return;
    }

    // 3. Sağlayıcı kontrolü: Gemini ise geçerli en az 1 API anahtarı olmalı
    const activeKeys = getEffectiveApiKeys(settings);
    if (settings.provider === 'gemini' && activeKeys.length === 0) {
      setIsPretranslating(false);
      return;
    }

    const controller = new AbortController();
    abortControllerRef.current = controller;
    const { signal } = controller;

    let isTerminated = false;

    const runBackgroundPretranslation = async () => {
      try {
        // Kısa bir bekleme (500ms): sayfa ilk açıldığında UI'ın ve aktif okuyucunun rahatlaması için
        await new Promise((resolve) => setTimeout(resolve, 500));
        if (signal.aborted || isTerminated) return;

        // Sonraki bölümün sayfalarını temin et
        const resolvedChapter = await ensureChapterPagesLoaded(nextChapter);
        if (!resolvedChapter || !Array.isArray(resolvedChapter.pages) || resolvedChapter.pages.length === 0) {
          return;
        }

        if (signal.aborted || isTerminated) return;

        const pages = resolvedChapter.pages;
        const targetLang = settings.targetLang || 'tr';
        const targetChapterId = resolvedChapter.id;
        const targetChapterNumber = resolvedChapter.number;

        // Mevcut çevirileri kontrol et (IndexedDB + Supabase)
        const cachedTranslations = await getCachedChapterTranslations(targetChapterId, targetLang, {
          networkEnabled: true,
        });

        if (signal.aborted || isTerminated) return;

        // Henüz çevrilmemiş sayfaları tespit et
        const uncompletedIndices: number[] = [];
        for (let idx = 0; idx < pages.length; idx += 1) {
          if (!cachedTranslations.has(idx)) {
            uncompletedIndices.push(idx);
          }
        }

        const totalPages = pages.length;
        let completedPages = totalPages - uncompletedIndices.length;

        // Tüm sayfalar zaten çevrilmişse iş bitti
        if (uncompletedIndices.length === 0) {
          setIsPretranslating(false);
          setProgress({
            chapterNumber: targetChapterNumber,
            chapterId: targetChapterId,
            completedPages: totalPages,
            totalPages,
            percent: 100,
          });
          return;
        }

        setIsPretranslating(true);
        setProgress({
          chapterNumber: targetChapterNumber,
          chapterId: targetChapterId,
          completedPages,
          totalPages,
          percent: Math.round((completedPages / totalPages) * 100),
        });

        // Sayfaları tek tek (sıralı / sequential) çevir
        for (const pageIndex of uncompletedIndices) {
          if (signal.aborted || isTerminated) break;

          const imageSrc = pages[pageIndex];
          if (!imageSrc) continue;

          try {
            const { blocks } = await translatePageImage({
              apiKey: activeKeys[0] || settings.apiKey,
              apiKeys: activeKeys,
              provider: settings.provider,
              imageSrc,
              targetLang,
              signal,
            });

            if (signal.aborted || isTerminated) break;

            // Sayfayı yerel IndexedDB ve Supabase'e anında kaydet
            await upsertPageTranslation(targetChapterId, pageIndex, targetLang, blocks, {
              networkEnabled: true,
            });

            completedPages += 1;
            setProgress({
              chapterNumber: targetChapterNumber,
              chapterId: targetChapterId,
              completedPages,
              totalPages,
              percent: Math.round((completedPages / totalPages) * 100),
            });

            // Donanımı ve ağı rahatlatmak için sayfalar arası 200ms bekle
            await new Promise((resolve) => setTimeout(resolve, 200));
          } catch (err) {
            if (isAbortTranslationError(err) || signal.aborted || isTerminated) {
              break;
            }
            console.warn(`[Next Chapter Pre-translation] Sayfa ${pageIndex + 1} atlandı:`, err);
            // Bir sayfada hata olsa bile sonraki sayfaları denemeye devam et
          }
        }
      } catch (error) {
        if (!signal.aborted && !isTerminated) {
          console.error('[Next Chapter Pre-translation Error]:', error);
        }
      } finally {
        if (!signal.aborted && !isTerminated) {
          setIsPretranslating(false);
        }
      }
    };

    void runBackgroundPretranslation();

    return () => {
      isTerminated = true;
      controller.abort();
    };
  }, [
    currentChapterId,
    ensureChapterPagesLoaded,
    isCurrentChapterBusy,
    networkEnabled,
    nextChapter,
    settings,
  ]);

  return {
    isPretranslating,
    progress,
    cancelPretranslation,
  };
};

export default useNextChapterTranslation;
