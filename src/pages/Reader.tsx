import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { getMangaById, incrementChapterViews, incrementMangaViews } from '@/lib/database';
import {
  getReaderSettings,
  setReaderSettings,
  syncChapterReadProgress,
  updateReadingProgress,
  addBookmark,
  getLatestProgress,
} from '../lib/storage';
import { logChapterRead } from '../lib/profile';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { ArrowUpToLine, ArrowDownToLine, Download, WifiOff } from 'lucide-react';
import ReaderControls from '@/components/reader/ReaderControls';
import VerticalReader from '@/components/reader/VerticalReader';
import HorizontalReader from '@/components/reader/HorizontalReader';
import PageCommentRail from '@/components/reader/PageCommentRail';
import PageCommentModal from '@/components/reader/PageCommentModal';
import CommentSection from '@/components/comments/CommentSection';
import OfflineNotice from '@/components/offline/OfflineNotice';
import { Chapter, ReaderSettings, ResolvedReaderPage } from '@/lib/types';
import {
  buildOfflineReaderPages,
  cacheOfflineManga,
  getOfflineChapter,
  getOfflineMangaDetail,
  markOfflineChapterReadProgress,
  getPendingReaderSyncItems,
} from '@/lib/offline/offlineStorage';
import {
  flushPendingReaderSync,
  queueReadingProgressSync,
} from '@/lib/offline/offlineReaderSync';
import { useEffectiveOnlineStatus } from '@/hooks/useEffectiveOnlineStatus';
import { prefetchChapterAssets, prefetchImageAsset, retainPrefetchedChapters } from '@/lib/imagePrefetch';
import { OPEN_PAGE_COMMENT_EVENT, OpenPageCommentDetail } from '@/lib/pageCommentEvents';

let persistedAutoScrollIntent = false;
const MIN_READING_SESSION_SECONDS = 1;
const READING_SESSION_FLUSH_INTERVAL_MS = 30000;

const Reader: React.FC = () => {
  const { mangaId, chapterId } = useParams<{ mangaId: string; chapterId: string }>();
  const navigate = useNavigate();
  const { user, isLoading: authLoading } = useAuth();
  const { isOnline: isOnlineNow } = useEffectiveOnlineStatus();
  const viewTracked = useRef(false);

  const [manga, setManga] = useState<any>(null);
  const [chapter, setChapter] = useState<any>(null);
  const [resolvedPages, setResolvedPages] = useState<ResolvedReaderPage[]>([]);
  const [settings, setSettings] = useState<ReaderSettings>(getReaderSettings());
  const [currentPage, setCurrentPage] = useState(1);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [initialized, setInitialized] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isTrackingReady, setIsTrackingReady] = useState(false);
  const [isIncognito, setIsIncognito] = useState(() => localStorage.getItem('toonparrot_incognito') === 'true');
  const [isAutoScrolling, setIsAutoScrolling] = useState(() => persistedAutoScrollIntent);
  const [isOfflineChapter, setIsOfflineChapter] = useState(false);
  const [offlineUnavailable, setOfflineUnavailable] = useState(false);
  const [isInitialViewportReady, setIsInitialViewportReady] = useState(false);
  const [isContentReady, setIsContentReady] = useState(false);
  const [pageCommentModalOpen, setPageCommentModalOpen] = useState(false);
  const [pageCommentModalPage, setPageCommentModalPage] = useState<number | null>(null);
  const readingSessionStartedAt = useRef<number | null>(null);
  const readerContentRef = useRef<HTMLDivElement | null>(null);
  const autoScrollFrameRef = useRef<number | null>(null);
  const autoScrollLastTickRef = useRef<number | null>(null);
  const revokeOfflineUrlsRef = useRef<(() => void) | null>(null);
  const resumeAutoScrollAfterNavigationRef = useRef(false);
  const pendingInitialRestorePageRef = useRef<number | null>(null);
  const currentMangaRef = useRef<any>(null);
  const preparedTransitionRef = useRef<{
    mangaId: string;
    chapterId: string;
    chapter: Chapter;
    resolvedPages: ResolvedReaderPage[];
  } | null>(null);
  const warmCriticalChapterPages = useCallback((chapterToWarm?: Chapter) => {
    if (!chapterToWarm || !Array.isArray(chapterToWarm.pages) || chapterToWarm.pages.length === 0) {
      return;
    }

    chapterToWarm.pages.slice(0, 10).forEach((page) => {
      if (!page) {
        return;
      }

      void prefetchImageAsset(page).catch(() => undefined);
    });
  }, []);

  const primeChapterEntry = useCallback(async (chapterToPrime?: Chapter) => {
    if (
      !chapterToPrime
      || !isOnlineNow
      || isOfflineChapter
      || !Array.isArray(chapterToPrime.pages)
      || chapterToPrime.pages.length === 0
    ) {
      return;
    }

    const criticalSources = chapterToPrime.pages.slice(0, Math.min(3, chapterToPrime.pages.length));
    await Promise.allSettled(criticalSources.map((page) => prefetchImageAsset(page)));
  }, [isOfflineChapter, isOnlineNow]);

  useEffect(() => {
    document.documentElement.classList.add('reader-active');
    document.body.classList.add('reader-active');

    return () => {
      document.documentElement.classList.remove('reader-active');
      document.body.classList.remove('reader-active');
    };
  }, []);

  useEffect(() => {
    currentMangaRef.current = manga;
  }, [manga]);

  const prepareChapterTransition = useCallback((targetChapter?: Chapter) => {
    if (
      isOnlineNow
      && !isOfflineChapter
      && settings.prefetchNextChapter
      && targetChapter
      && Array.isArray(targetChapter.pages)
      && targetChapter.pages.length > 0
    ) {
      preparedTransitionRef.current = {
        mangaId: mangaId || '',
        chapterId: targetChapter.id,
        chapter: targetChapter,
        resolvedPages: targetChapter.pages.map((page) => ({ src: page, source: 'remote' })),
      };
      warmCriticalChapterPages(targetChapter);
      void prefetchChapterAssets(
        targetChapter.id,
        targetChapter.pages,
        { concurrency: Math.min(targetChapter.pages.length, 24) }
      );
    } else {
      preparedTransitionRef.current = null;
    }

    setIsLoading(true);
    setIsInitialViewportReady(false);
    setCurrentPage(1);
    pendingInitialRestorePageRef.current = 1;
    isScrollingRef.current = true;

    if (scrollTimeoutRef.current) {
      clearTimeout(scrollTimeoutRef.current);
      scrollTimeoutRef.current = null;
    }

    window.scrollTo({ top: 0, behavior: 'auto' });
  }, [isOfflineChapter, isOnlineNow, mangaId, settings.prefetchNextChapter, warmCriticalChapterPages]);

  const handleBeforeChapterChange = useCallback(async (targetChapter?: Chapter) => {
    if (targetChapter) {
      await primeChapterEntry(targetChapter);
    }

    prepareChapterTransition(targetChapter);
  }, [prepareChapterTransition, primeChapterEntry]);

  const toggleIncognito = (val: boolean) => {
    setIsIncognito(val);
    localStorage.setItem('toonparrot_incognito', val.toString());
    if (val) {
        toast.info("Gizli mod açıldı. Okuma verileriniz kaydedilmeyecek.");
    } else {
        toast.info("Gizli mod kapatıldı.");
    }
  };

  const flushReadingSession = useCallback(async (minimumSeconds = 0, resetTimer = true) => {
    const startedAt = readingSessionStartedAt.current;
    if (!startedAt) {
      return;
    }

    const elapsedSeconds = Math.floor((Date.now() - startedAt) / 1000);

    if (resetTimer) {
      readingSessionStartedAt.current = Date.now();
    } else {
      readingSessionStartedAt.current = null;
    }

    if (!user || !mangaId || !chapterId || !chapter || isIncognito || elapsedSeconds < minimumSeconds) {
      return;
    }

    if (isOnlineNow) {
      await logChapterRead(user.id, mangaId, chapterId, chapter.number, elapsedSeconds);
      await flushPendingReaderSync();
      return;
    }
  }, [user, mangaId, chapterId, chapter, isIncognito, isOnlineNow]);

  // Reset state and scroll on chapter change
  useEffect(() => {
    const preparedTransition = preparedTransitionRef.current;
    const canUsePreparedTransition = Boolean(
      preparedTransition
      && preparedTransition.mangaId === mangaId
      && preparedTransition.chapterId === chapterId
    );

    setCurrentPage(1);
    window.scrollTo({ top: 0, behavior: 'auto' });
    viewTracked.current = false;
    setInitialized(false);
    setIsTrackingReady(false);
    setIsInitialViewportReady(false);
    setIsContentReady(canUsePreparedTransition);
    if (!resumeAutoScrollAfterNavigationRef.current) {
      persistedAutoScrollIntent = false;
      setIsAutoScrolling(false);
    }
    setOfflineUnavailable(false);
    if (canUsePreparedTransition && preparedTransition) {
      setChapter(preparedTransition.chapter);
      setResolvedPages(preparedTransition.resolvedPages);
      setIsOfflineChapter(false);
    } else {
      setResolvedPages([]);
      setIsOfflineChapter(false);
    }
    pendingInitialRestorePageRef.current = null;
    setPageCommentModalOpen(false);
    setPageCommentModalPage(null);
    revokeOfflineUrlsRef.current?.();
    revokeOfflineUrlsRef.current = null;
  }, [chapterId]);

  useEffect(() => () => {
    revokeOfflineUrlsRef.current?.();
    revokeOfflineUrlsRef.current = null;
    if (!resumeAutoScrollAfterNavigationRef.current) {
      persistedAutoScrollIntent = false;
    }
  }, []);

  useEffect(() => {
    const previousScrollRestoration = window.history.scrollRestoration;
    window.history.scrollRestoration = 'manual';

    return () => {
      window.history.scrollRestoration = previousScrollRestoration;
    };
  }, []);

  useEffect(() => {
    const handleOpenPageComment = (event: Event) => {
      const { detail } = event as CustomEvent<OpenPageCommentDetail>;
      if (!detail?.pageNumber) {
        return;
      }

      if (!user) {
        toast.error('Sayfa yorumu yazmak için giriş yapmalısınız');
        return;
      }

      setPageCommentModalPage(detail.pageNumber);
      setPageCommentModalOpen(true);
    };

    window.addEventListener(OPEN_PAGE_COMMENT_EVENT, handleOpenPageComment);
    return () => {
      window.removeEventListener(OPEN_PAGE_COMMENT_EVENT, handleOpenPageComment);
    };
  }, [user]);

  useEffect(() => {
    const shouldLockScroll = isLoading || !isInitialViewportReady;
    const html = document.documentElement;
    const body = document.body;
    const previousHtmlOverflow = html.style.overflow;
    const previousBodyOverflow = body.style.overflow;
    const previousHtmlOverscroll = html.style.overscrollBehavior;
    const previousBodyOverscroll = body.style.overscrollBehavior;
    const previousBodyTouchAction = body.style.touchAction;

    if (shouldLockScroll) {
      html.style.overflow = 'hidden';
      body.style.overflow = 'hidden';
      html.style.overscrollBehavior = 'none';
      body.style.overscrollBehavior = 'none';
      body.style.touchAction = 'none';
      window.scrollTo({ top: 0, behavior: 'auto' });
    }

    return () => {
      html.style.overflow = previousHtmlOverflow;
      body.style.overflow = previousBodyOverflow;
      html.style.overscrollBehavior = previousHtmlOverscroll;
      body.style.overscrollBehavior = previousBodyOverscroll;
      body.style.touchAction = previousBodyTouchAction;
    };
  }, [isInitialViewportReady, isLoading]);

  // Load chapter content only once per route change. User/auth state is resolved separately.
  useEffect(() => {
    const loadContent = async () => {
      if (!mangaId || !chapterId) return;

      try {
        setIsLoading(true);
        const preparedTransition = preparedTransitionRef.current;
        const hasPreparedTransition = Boolean(
          preparedTransition
          && preparedTransition.mangaId === mangaId
          && preparedTransition.chapterId === chapterId
        );
        const offlineChapter = await getOfflineChapter(chapterId);
        const existingManga = currentMangaRef.current && currentMangaRef.current.id === mangaId
          ? currentMangaRef.current
          : null;
        const mData = isOnlineNow ? (existingManga ?? await getMangaById(mangaId)) : undefined;
        const fallbackManga = mData || await getOfflineMangaDetail(mangaId);

        if (mData) {
          void cacheOfflineManga(mData);
        }

        if (!fallbackManga) {
          navigate('/');
          return;
        }
        setManga(fallbackManga);

        const resolvedChapter = fallbackManga.chapters.find(c => c.id === chapterId)
          || (offlineChapter ? {
            id: offlineChapter.chapterId,
            number: offlineChapter.chapterNumber,
            title: offlineChapter.title,
            pages: offlineChapter.sourcePageUrls,
            releaseDate: offlineChapter.releaseDate,
            views: 0,
          } : null);

        if (!resolvedChapter) {
          navigate(`/manga/${mangaId}`);
          return;
        }

        if (!isOnlineNow && offlineChapter?.downloadStatus === 'completed') {
          setChapter(resolvedChapter);
          const offlinePages = await buildOfflineReaderPages(
            chapterId,
            Math.max(
              resolvedChapter.pages?.length || 0,
              offlineChapter.pageCount || 0,
            ),
          );
          revokeOfflineUrlsRef.current?.();
          revokeOfflineUrlsRef.current = offlinePages.revoke;

          if (offlinePages.storedPageCount > 0) {
            setResolvedPages(offlinePages.pages);
            setIsOfflineChapter(true);
            setOfflineUnavailable(false);
          } else {
            revokeOfflineUrlsRef.current?.();
            revokeOfflineUrlsRef.current = null;
            setResolvedPages([]);
            setIsOfflineChapter(false);
            setOfflineUnavailable(true);
          }
        } else if (!isOnlineNow) {
          setChapter(resolvedChapter);
          setResolvedPages([]);
          setIsOfflineChapter(false);
          setOfflineUnavailable(true);
        } else if (hasPreparedTransition && preparedTransition) {
          setChapter(preparedTransition.chapter);
          setResolvedPages(preparedTransition.resolvedPages);
          setIsOfflineChapter(false);
          setOfflineUnavailable(false);
        } else {
          setChapter(resolvedChapter);
          setResolvedPages(resolvedChapter.pages.map((page) => ({ src: page, source: 'remote' })));
          setIsOfflineChapter(false);
          setOfflineUnavailable(false);
        }

        preparedTransitionRef.current = null;
        setIsContentReady(true);
      } catch (err) {
        console.error('Reader load error:', err);
        setResolvedPages([]);
        setIsOfflineChapter(false);
        setOfflineUnavailable(!isOnlineNow);
        setIsContentReady(false);
        setIsLoading(false);
      }
    };

    loadContent();
  }, [chapterId, isOnlineNow, mangaId, navigate]);

  useEffect(() => {
    if (initialized || !isContentReady || !mangaId || !chapterId) {
      return;
    }

    const urlPage = new URLSearchParams(window.location.search).get('page');
    const parsedUrlPage = urlPage ? parseInt(urlPage, 10) : NaN;
    const hasExplicitPage = Number.isFinite(parsedUrlPage) && parsedUrlPage > 0;

    if (authLoading && !hasExplicitPage) {
      return;
    }

    let isCancelled = false;

    const resolveInitialPage = async () => {
      let initialTargetPage = hasExplicitPage ? parsedUrlPage : 1;

      if (!hasExplicitPage && user) {
        const progress = await getLatestProgress(user.id, mangaId);
        if (progress && progress.chapterId === chapterId && progress.page > 1) {
          initialTargetPage = progress.page;
        }

        if (initialTargetPage <= 1) {
          const pendingProgress = (await getPendingReaderSyncItems())
            .filter((item) => item.type === 'progress' && item.userId === user.id)
            .find((item) => (item.payload as { mangaId?: string }).mangaId === mangaId);

          const pendingPayload = pendingProgress?.payload as { chapterId?: string; page?: number } | undefined;
          if (pendingPayload?.chapterId === chapterId && pendingPayload.page && pendingPayload.page > 1) {
            initialTargetPage = pendingPayload.page;
          }
        }

        if (initialTargetPage <= 1) {
          const offlineChapter = await getOfflineChapter(chapterId);
          if (offlineChapter?.maxReadPage && offlineChapter.maxReadPage > 1) {
            initialTargetPage = offlineChapter.maxReadPage;
          }
        }
      }

      if (isCancelled) {
        return;
      }

      pendingInitialRestorePageRef.current = initialTargetPage;
      setCurrentPage(initialTargetPage);
      setInitialized(true);
      setIsLoading(false);
    };

    void resolveInitialPage();

    return () => {
      isCancelled = true;
    };
  }, [authLoading, chapterId, initialized, isContentReady, isOnlineNow, mangaId, user]);

  useEffect(() => {
    if (!initialized || !chapter || !mangaId || !chapterId || viewTracked.current || isIncognito || !isOnlineNow) {
      return;
    }

    incrementMangaViews(mangaId);
    incrementChapterViews(mangaId, chapterId);
    viewTracked.current = true;
  }, [chapter, chapterId, initialized, isIncognito, isOnlineNow, mangaId]);

  useEffect(() => {
    if (!initialized || isLoading || !chapter || resolvedPages.length === 0 || offlineUnavailable) {
      return;
    }

    const timer = window.setTimeout(() => {
      setIsTrackingReady(true);
    }, 2000);

    return () => {
      window.clearTimeout(timer);
    };
  }, [chapter, initialized, isLoading, offlineUnavailable, resolvedPages.length]);

  // Save reading progress when page changes
  useEffect(() => {
    const saveProgress = async () => {
      if (mangaId && chapterId && chapter && initialized && isTrackingReady && user && !isIncognito) {
        try {
          await syncChapterReadProgress(user.id, {
            mangaId,
            chapterId,
            chapterNumber: chapter.number,
            page: currentPage,
            pageCount: resolvedPages.length || chapter.pages.length || currentPage,
            mangaTitle: manga?.title,
            mangaCover: manga?.cover,
            mangaAlternativeTitles: manga?.alternativeTitles || [],
            chapterTitle: chapter.title,
          });

          if (isOnlineNow) {
            await updateReadingProgress(user.id, {
              mangaId,
              chapterId,
              chapterNumber: chapter.number,
              page: currentPage,
            });
            await flushPendingReaderSync();
            return;
          }

          await queueReadingProgressSync(user.id, {
            mangaId,
            chapterId,
            chapterNumber: chapter.number,
            page: currentPage,
            pageCount: resolvedPages.length || chapter.pages.length || currentPage,
          });
        } catch (error) {
          console.error('Error updating reading progress:', error);
        }
      }
    };
    saveProgress();
  }, [chapter, chapterId, currentPage, initialized, isOnlineNow, isTrackingReady, manga, mangaId, resolvedPages.length, user]);

  useEffect(() => {
    if (!isTrackingReady || !isOfflineChapter || !chapterId || resolvedPages.length === 0) {
      return;
    }

    void markOfflineChapterReadProgress(chapterId, currentPage, resolvedPages.length);
  }, [chapterId, currentPage, isOfflineChapter, isTrackingReady, resolvedPages.length]);

  useEffect(() => {
    if (!initialized || !isInitialViewportReady || !user || !mangaId || !chapterId || !chapter || isIncognito) {
      readingSessionStartedAt.current = null;
      return;
    }

    readingSessionStartedAt.current = Date.now();

    return () => {
      void flushReadingSession(MIN_READING_SESSION_SECONDS, false);
    };
  }, [initialized, isInitialViewportReady, user, mangaId, chapterId, chapter, isIncognito, flushReadingSession]);

  useEffect(() => {
    if (!initialized || !isInitialViewportReady || !user || !chapter || isIncognito) {
      return;
    }

    const intervalId = window.setInterval(() => {
      void flushReadingSession(READING_SESSION_FLUSH_INTERVAL_MS / 1000, true);
    }, READING_SESSION_FLUSH_INTERVAL_MS);

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        void flushReadingSession(MIN_READING_SESSION_SECONDS, false);
        return;
      }

      readingSessionStartedAt.current = Date.now();
    };

    const handleBeforeUnload = () => {
      void flushReadingSession(MIN_READING_SESSION_SECONDS, false);
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [initialized, isInitialViewportReady, user, chapter, isIncognito, flushReadingSession]);

  const handleSettingsChange = useCallback((newSettings: ReaderSettings) => {
    setSettings(newSettings);
    setReaderSettings(newSettings);
  }, []);

  const isAutoScrollAvailable = settings.mode !== 'horizontal';

  const handleAutoScrollToggle = useCallback(() => {
    if (!isAutoScrollAvailable) {
      toast.info('Otomatik kaydırma yalnızca dikey okuyucuda kullanılabilir.');
      return;
    }

    setIsAutoScrolling((prev) => {
      const next = !prev;
      persistedAutoScrollIntent = next;
      return next;
    });
  }, [isAutoScrollAvailable]);

  const handleAutoScrollSpeedChange = useCallback((speed: number) => {
    handleSettingsChange({
      ...settings,
      autoScrollSpeed: speed,
    });
  }, [handleSettingsChange, settings]);

  const nextChapter = useMemo(() => {
    if (!manga || !chapter) {
      return undefined;
    }

    const currentIndex = manga.chapters.findIndex((chapterItem: any) => chapterItem.id === chapter.id);
    if (currentIndex < 0) {
      return undefined;
    }

    return manga.chapters[currentIndex - 1];
  }, [chapter, manga]);

  useEffect(() => {
    if (isAutoScrollAvailable) {
      return;
    }

    persistedAutoScrollIntent = false;
    setIsAutoScrolling(false);
  }, [isAutoScrollAvailable]);

  useEffect(() => {
    if (!isAutoScrolling || !isAutoScrollAvailable || !initialized || isLoading || !chapter || resolvedPages.length === 0) {
      if (autoScrollFrameRef.current !== null) {
        cancelAnimationFrame(autoScrollFrameRef.current);
        autoScrollFrameRef.current = null;
      }
      autoScrollLastTickRef.current = null;
      return;
    }

    const step = (timestamp: number) => {
      const contentRoot = readerContentRef.current;
      if (!contentRoot) {
        setIsAutoScrolling(false);
        return;
      }

      if (autoScrollLastTickRef.current === null) {
        autoScrollLastTickRef.current = timestamp;
      }

      const elapsed = timestamp - autoScrollLastTickRef.current;
      autoScrollLastTickRef.current = timestamp;

      const contentBottom = contentRoot.offsetTop + contentRoot.offsetHeight;
      const maxScrollTop = Math.max(0, contentBottom - window.innerHeight);

      if (window.scrollY >= maxScrollTop - 2) {
        if (nextChapter && mangaId) {
          resumeAutoScrollAfterNavigationRef.current = true;
          prepareChapterTransition();
          navigate(`/manga/${mangaId}/chapter/${nextChapter.id}?page=1`);
          return;
        }

        persistedAutoScrollIntent = false;
        setIsAutoScrolling(false);
        return;
      }

      const pixelsPerSecond = settings.autoScrollSpeed || 30;
      const distance = (pixelsPerSecond * elapsed) / 1000;
      window.scrollBy({ top: distance, behavior: 'auto' });
      autoScrollFrameRef.current = requestAnimationFrame(step);
    };

    autoScrollFrameRef.current = requestAnimationFrame(step);

    return () => {
      if (autoScrollFrameRef.current !== null) {
        cancelAnimationFrame(autoScrollFrameRef.current);
        autoScrollFrameRef.current = null;
      }
      autoScrollLastTickRef.current = null;
    };
  }, [chapter, initialized, isAutoScrolling, isAutoScrollAvailable, isLoading, mangaId, navigate, nextChapter, prepareChapterTransition, resolvedPages.length, settings.autoScrollSpeed]);

  useEffect(() => {
    if (!initialized || !isAutoScrollAvailable || !resumeAutoScrollAfterNavigationRef.current) {
      return;
    }

    resumeAutoScrollAfterNavigationRef.current = false;
    persistedAutoScrollIntent = true;
    setIsAutoScrolling(true);
  }, [chapterId, initialized, isAutoScrollAvailable]);

  useEffect(() => {
    retainPrefetchedChapters(
      [chapterId, nextChapter?.id].filter((id): id is string => Boolean(id))
    );
  }, [chapterId, nextChapter]);

  useEffect(() => {
    if (
      !isOnlineNow
      || isOfflineChapter
      || !settings.prefetchNextChapter
      || !nextChapter
      || !Array.isArray(nextChapter.pages)
      || nextChapter.pages.length === 0
    ) {
      return;
    }

    warmCriticalChapterPages(nextChapter);
    void prefetchChapterAssets(
      nextChapter.id,
      nextChapter.pages,
      { concurrency: Math.min(nextChapter.pages.length, 24) }
    );
  }, [
    isOfflineChapter,
    isOnlineNow,
    nextChapter,
    settings.prefetchNextChapter,
    warmCriticalChapterPages,
  ]);

  const isScrollingRef = useRef(false);
  const scrollTimeoutRef = useRef<any>(null);

  const isRestoreLayoutReady = useCallback((targetPage: number) => {
    const targetIndex = Math.max(0, Math.min(resolvedPages.length, targetPage) - 1);

    for (let index = 0; index <= targetIndex; index += 1) {
      const pageElement = document.querySelector(`[data-page-index="${index}"]`) as HTMLElement | null;

      if (!pageElement || pageElement.offsetHeight < 32) {
        return false;
      }

      const mediaElement = pageElement.querySelector('[data-media-ready="true"]') as HTMLElement | null;
      if (!mediaElement || mediaElement.getBoundingClientRect().height < 32) {
        return false;
      }
    }

    return true;
  }, [resolvedPages.length]);

  const handlePageChange = useCallback((page: number) => {
    // If we are programmatically scrolling, ignore updates from the observer
    if (isScrollingRef.current || !isInitialViewportReady) return;
    setCurrentPage(page);
  }, [isInitialViewportReady]);

  // Scroll to a specific page (called when user clicks on progress bar)
  const scrollToPage = useCallback((page: number, smooth = true) => {
    const targetIndex = page - 1;
    const targetElement = document.querySelector(`[data-page-index="${targetIndex}"]`);

    if (!targetElement) {
      return false;
    }

    if (smooth) {
      isScrollingRef.current = true;
      if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
      scrollTimeoutRef.current = setTimeout(() => {
        isScrollingRef.current = false;
      }, 800);
    } else {
      isScrollingRef.current = false;
    }

    const elementTop = (targetElement as HTMLElement).offsetTop;
    window.scrollTo({
      top: Math.max(0, elementTop - 80),
      behavior: smooth ? 'smooth' : 'auto'
    });
    setCurrentPage(page);
    return true;
  }, []);

  useEffect(() => {
    if (!initialized || !chapterId) {
      return;
    }

    const params = new URLSearchParams(window.location.search);
    const currentPageParam = params.get('page');
    const nextPageParam = String(currentPage);

    if (currentPageParam === nextPageParam) {
      return;
    }

    params.set('page', nextPageParam);
    const nextSearch = params.toString();
    const nextUrl = `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ''}`;
    window.history.replaceState(window.history.state, '', nextUrl);
  }, [chapterId, currentPage, initialized]);

  useEffect(() => {
    if (!initialized || isLoading) {
      return;
    }

    if (settings.mode === 'horizontal') {
      setIsInitialViewportReady(true);
      return;
    }

    if (resolvedPages.length === 0) {
      return;
    }

    const targetPage = pendingInitialRestorePageRef.current ?? 1;
    pendingInitialRestorePageRef.current = null;

    let isCancelled = false;
    let restoreTimerId: number | null = null;

    const finishRestore = () => {
      window.requestAnimationFrame(() => {
        if (!isCancelled) {
          isScrollingRef.current = false;
          setIsInitialViewportReady(true);
        }
      });
    };

    const restore = (attempt = 0) => {
      if (isCancelled) {
        return;
      }

      if (targetPage <= 1) {
        window.scrollTo({ top: 0, behavior: 'auto' });
        setCurrentPage(1);
        finishRestore();
        return;
      }

      if (!isRestoreLayoutReady(targetPage) && attempt < 40) {
        restoreTimerId = window.setTimeout(() => restore(attempt + 1), 80);
        return;
      }

      if (targetPage > 1) {
        const didScroll = scrollToPage(targetPage, false);
        if (!didScroll && attempt < 40) {
          restoreTimerId = window.setTimeout(() => restore(attempt + 1), 80);
          return;
        }

        window.requestAnimationFrame(() => {
          window.requestAnimationFrame(() => {
            if (isCancelled) {
              return;
            }

            scrollToPage(targetPage, false);
            finishRestore();
          });
        });
        return;
      }

      finishRestore();
    };

    isScrollingRef.current = true;
    restoreTimerId = window.setTimeout(() => restore(), 0);

    return () => {
      isCancelled = true;
      if (restoreTimerId !== null) {
        window.clearTimeout(restoreTimerId);
      }
      isScrollingRef.current = false;
    };
  }, [chapterId, initialized, isLoading, isRestoreLayoutReady, resolvedPages.length, scrollToPage, settings.mode]);

  const handleAddBookmark = useCallback(() => {
    if (!user) {
      toast.error('Yer imi eklemek için giriş yapmalısınız');
      return;
    }

    if (mangaId && chapterId && chapter && user) {
      addBookmark(user.id, {
        mangaId,
        chapterId,
        chapterNumber: chapter.number,
        page: currentPage,
        mangaTitle: manga?.title,
        mangaCover: manga?.cover,
        mangaAlternativeTitles: manga?.alternativeTitles || [],
        chapterTitle: chapter.title,
      }).then(() => {
        toast.success(
          isOnlineNow
            ? `Yer imi eklendi: Sayfa ${currentPage}`
            : 'Yer imi kaydedildi, tekrar çevrimiçi olduğunda eşitlenecek'
        );
      }).catch((error) => {
        if (error.message === 'ALREADY_EXISTS') {
          toast.warning(`Bu sayfa (Sayfa ${currentPage}) zaten yer imlerine eklenmiş!`);
        } else {
          console.error('Error adding bookmark:', error);
          toast.error('Yer imi eklenemedi');
        }
      });
    }
  }, [chapter, chapterId, currentPage, isOnlineNow, manga, mangaId, user]);

  const toggleControls = useCallback(() => {
    setControlsVisible(prev => !prev);
  }, []);

  const handleTap = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    const target = e.target as HTMLElement;
    if (
      target.closest('button') ||
      target.closest('a') ||
      target.closest('[role="dialog"]') ||
      target.closest('[data-radix-popper-content-wrapper]') ||
      target.closest('[data-state]') ||
      target.closest('.fixed')
    ) {
      return;
    }
    toggleControls();
  }, [toggleControls]);

  // Keyboard shortcut listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'h') {
        toggleControls();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [toggleControls]);

  if (isLoading && (!manga || !chapter)) {
    return <div className="min-h-screen bg-background" />;
  }

  if (!isLoading && offlineUnavailable && manga && chapter) {
    return (
      <div className="min-h-screen bg-background px-4 py-20">
        <div className="mx-auto max-w-2xl rounded-3xl border border-border bg-card/40 p-8 text-center backdrop-blur-sm">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-blue-500/10 text-blue-300">
            <WifiOff className="h-7 w-7" />
          </div>
          <h1 className="mt-5 text-2xl font-black tracking-tight">Bu bölüm çevrimdışı hazır değil</h1>
          <p className="mt-3 text-sm text-muted-foreground">
            Bölüm {chapter.number} bu cihazda indirilmediği için internet olmadan açılamıyor.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Button asChild variant="glow">
              <Link to="/downloads">
                <Download className="mr-2 h-4 w-4" />
                İndirilenlere Git
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link to={`/manga/${manga.id}`}>
                Seri Sayfasına Dön
              </Link>
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (!isLoading && (!manga || !chapter)) {
    return (
      <div className="min-h-screen bg-background px-4 py-20">
        <div className="mx-auto max-w-2xl">
          <OfflineNotice
            title={isOnlineNow ? 'Bölüm açılamadı' : 'Çevrimdışısınız'}
            description={isOnlineNow
              ? 'Bölüm verisi yüklenemedi. Tekrar deneyin.'
              : 'Bu bölüm bu cihazda çevrimdışı hazır değil veya okunacak içerik bulunamadı.'}
            actionHref="/downloads"
            actionLabel="İndirilenlere Git"
          />
        </div>
      </div>
    );
  }

  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const scrollToBottom = () => {
    window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
  };

  const isReaderTransitionActive = isLoading || !isInitialViewportReady;
  const showPageCommentRail = settings.showPageComments;
  const totalPageCount = resolvedPages.length || chapter.pages.length || 0;
  const commentPagePreviewUrls = resolvedPages.length > 0
    ? resolvedPages.map((page) => page.src)
    : chapter.pages;

  return (
    <div
      className="min-h-screen bg-background"
      onClick={handleTap}
    >
      {isReaderTransitionActive && (
        <div className="fixed inset-0 z-40 pointer-events-none bg-background transition-opacity duration-75" />
      )}

      <PageCommentModal
        open={pageCommentModalOpen}
        onOpenChange={(open) => {
          setPageCommentModalOpen(open);
          if (!open) {
            setPageCommentModalPage(null);
          }
        }}
        mangaId={manga.id}
        chapterId={chapterId || ''}
        pageNumber={pageCommentModalPage}
        user={user}
      />

      <ReaderControls
        mangaId={manga.id}
        mangaTitle={manga.title}
        currentChapter={chapter}
        chapters={manga.chapters}
        settings={settings}
        onSettingsChange={handleSettingsChange}
        onAddBookmark={handleAddBookmark}
        currentPage={currentPage}
        totalPages={totalPageCount}
        visible={controlsVisible}
        onPageChange={scrollToPage}
        isIncognito={isIncognito}
        onIncognitoToggle={toggleIncognito}
        isAutoScrollAvailable={isAutoScrollAvailable}
        isAutoScrolling={isAutoScrolling}
        autoScrollSpeed={settings.autoScrollSpeed || 30}
        onAutoScrollToggle={handleAutoScrollToggle}
        onAutoScrollSpeedChange={handleAutoScrollSpeedChange}
        isOfflineChapter={isOfflineChapter}
        isOnline={isOnlineNow}
        onBeforeChapterChange={handleBeforeChapterChange}
      />

      {!isReaderTransitionActive && isOnlineNow && showPageCommentRail && (
        <PageCommentRail
          mangaId={manga.id}
          mangaTitle={manga.title}
          chapterId={chapterId}
          currentPage={currentPage}
          enabled={showPageCommentRail}
        />
      )}

      <div
        className={`transition-opacity duration-100 ease-out ${isReaderTransitionActive
          ? 'pointer-events-none opacity-0'
          : 'opacity-100'
          }`}
      >
        <div ref={readerContentRef}>
          {settings.mode === 'vertical' || settings.mode === 'webtoon' ? (
            <VerticalReader
              key={chapterId}
              pages={resolvedPages}
              settings={settings}
              onPageChange={handlePageChange}
              initialPage={currentPage}
              trackingEnabled={isInitialViewportReady}
            />
          ) : (
            <HorizontalReader
              key={chapterId}
              pages={resolvedPages}
              settings={settings}
              currentPage={currentPage}
              onPageChange={handlePageChange}
            />
          )}
        </div>
      </div>

      {/* Scroll controls */}
      <div className={`fixed bottom-24 right-4 z-40 flex flex-col gap-3 pointer-events-none transition-opacity duration-300 ${controlsVisible ? 'opacity-100' : 'opacity-0'}`}>
        <Button 
          variant="secondary" 
          size="icon" 
          className="rounded-full shadow-lg h-10 w-10 opacity-70 hover:opacity-100 pointer-events-auto transition-opacity border border-border bg-background/80 backdrop-blur-md"
          onClick={(e) => { e.stopPropagation(); scrollToTop(); }}
          title="En Üste Git"
        >
          <ArrowUpToLine className="h-5 w-5" />
        </Button>
      </div>

      <div className={`fixed bottom-24 left-4 z-40 flex flex-col gap-3 pointer-events-none transition-opacity duration-300 ${controlsVisible ? 'opacity-100' : 'opacity-0'}`}>
        <Button 
          variant="secondary" 
          size="icon" 
          className="rounded-full shadow-lg h-10 w-10 opacity-70 hover:opacity-100 pointer-events-auto transition-opacity border border-border bg-background/80 backdrop-blur-md"
          onClick={(e) => { e.stopPropagation(); scrollToBottom(); }}
          title="En Alta Git"
        >
          <ArrowDownToLine className="h-5 w-5" />
        </Button>
      </div>

      {/* Yorum Bölümü */}
      <div
        className="mx-auto mt-6 max-w-4xl border-t border-border px-3 pt-6 pb-28 sm:mt-8 sm:px-4 sm:pt-8 md:pb-32"
        onClick={(e) => e.stopPropagation()}
        >
        {isOnlineNow ? (
            <div>
            <CommentSection
              mangaId={manga.id}
              chapterId={chapterId}
              totalReaderPages={totalPageCount}
              enablePageComments
              pagePreviewUrls={commentPagePreviewUrls}
            />
          </div>
        ) : (
          <div className="rounded-2xl border border-border bg-card/40 px-4 py-6 text-center text-sm text-muted-foreground">
            Yorumlar için internet bağlantısı gerekiyor.
          </div>
        )}
      </div>
    </div>
  );
};

export default Reader;
