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
import CommentSection from '@/components/comments/CommentSection';
import { ReaderSettings, ResolvedReaderPage } from '@/lib/types';
import ReaderSkeleton from '@/components/skeletons/ReaderSkeleton';
import {
  buildOfflineReaderPages,
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

let persistedAutoScrollIntent = false;

const Reader: React.FC = () => {
  const { mangaId, chapterId } = useParams<{ mangaId: string; chapterId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
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
  const readingSessionStartedAt = useRef<number | null>(null);
  const readerContentRef = useRef<HTMLDivElement | null>(null);
  const autoScrollFrameRef = useRef<number | null>(null);
  const autoScrollLastTickRef = useRef<number | null>(null);
  const revokeOfflineUrlsRef = useRef<(() => void) | null>(null);
  const resumeAutoScrollAfterNavigationRef = useRef(false);
  const pendingInitialRestorePageRef = useRef<number | null>(null);

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
    setCurrentPage(1);
    window.scrollTo({ top: 0, behavior: 'instant' });
    viewTracked.current = false;
    setIsTrackingReady(false);
    if (!resumeAutoScrollAfterNavigationRef.current) {
      persistedAutoScrollIntent = false;
      setIsAutoScrolling(false);
    }
    setOfflineUnavailable(false);
    setResolvedPages([]);
    setIsOfflineChapter(false);
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

  // Load Manga and Chapter
  useEffect(() => {
    const loadContent = async () => {
      if (!mangaId || !chapterId) return;

      try {
        setIsLoading(true);
        const offlineChapter = await getOfflineChapter(chapterId);
        const mData = isOnlineNow ? await getMangaById(mangaId) : undefined;
        const fallbackManga = mData || await getOfflineMangaDetail(mangaId);

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

        setChapter(resolvedChapter);

        if (!isOnlineNow && offlineChapter?.downloadStatus === 'completed') {
          const offlinePages = await buildOfflineReaderPages(chapterId);
          revokeOfflineUrlsRef.current?.();
          revokeOfflineUrlsRef.current = offlinePages.revoke;
          setResolvedPages(offlinePages.pages);
          setIsOfflineChapter(true);
          setOfflineUnavailable(false);
        } else if (!isOnlineNow) {
          setResolvedPages([]);
          setIsOfflineChapter(false);
          setOfflineUnavailable(true);
        } else {
          setResolvedPages(resolvedChapter.pages.map((page) => ({ src: page, source: 'remote' })));
          setIsOfflineChapter(false);
          setOfflineUnavailable(false);
        }

        // Determine initial page
        const urlPage = new URLSearchParams(window.location.search).get('page');
        let initialTargetPage = 1;

        if (urlPage && parseInt(urlPage) > 0) {
          initialTargetPage = parseInt(urlPage);
        } else if (user && isOnlineNow) {
          const progress = await getLatestProgress(user.id, mangaId);
          if (progress && progress.chapterId === chapterId && progress.page > 1) {
            initialTargetPage = progress.page;
          }
        } else if (user) {
          const pendingProgress = (await getPendingReaderSyncItems())
            .filter((item) => item.type === 'progress' && item.userId === user.id)
            .find((item) => (item.payload as { mangaId?: string }).mangaId === mangaId);

          const pendingPayload = pendingProgress?.payload as { chapterId?: string; page?: number } | undefined;
          if (pendingPayload?.chapterId === chapterId && pendingPayload.page && pendingPayload.page > 1) {
            initialTargetPage = pendingPayload.page;
          }
        }

        pendingInitialRestorePageRef.current = initialTargetPage;
        setCurrentPage(initialTargetPage);

        setInitialized(true);

        // Track views (only if not incognito)
        if (!viewTracked.current && !isIncognito && isOnlineNow) {
          incrementMangaViews(mangaId);
          incrementChapterViews(mangaId, chapterId);
          viewTracked.current = true;
        }
      } catch (err) {
        console.error('Reader load error:', err);
      } finally {
        setIsLoading(false);
      }
    };

    loadContent();
  }, [chapterId, isIncognito, isOnlineNow, mangaId, navigate, user]);

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
          if (isOnlineNow) {
            await updateReadingProgress(user.id, {
              mangaId,
              chapterId,
              chapterNumber: chapter.number,
              page: currentPage,
            });
            await syncChapterReadProgress(user.id, {
              mangaId,
              chapterId,
              chapterNumber: chapter.number,
              page: currentPage,
              pageCount: resolvedPages.length || chapter.pages.length || currentPage,
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
  }, [mangaId, chapterId, chapter, currentPage, initialized, isOnlineNow, isTrackingReady, resolvedPages.length, user]);

  useEffect(() => {
    if (!isTrackingReady || !isOfflineChapter || !chapterId || resolvedPages.length === 0) {
      return;
    }

    void markOfflineChapterReadProgress(chapterId, currentPage, resolvedPages.length);
  }, [chapterId, currentPage, isOfflineChapter, isTrackingReady, resolvedPages.length]);

  useEffect(() => {
    if (!initialized || !isTrackingReady || !user || !mangaId || !chapterId || !chapter || isIncognito) {
      readingSessionStartedAt.current = null;
      return;
    }

    if (isOnlineNow) {
      logChapterRead(user.id, mangaId, chapterId, chapter.number, 0);
    }
    readingSessionStartedAt.current = Date.now();

    return () => {
      void flushReadingSession(5, false);
    };
  }, [initialized, isTrackingReady, user, mangaId, chapterId, chapter, isIncognito, flushReadingSession, isOnlineNow]);

  useEffect(() => {
    if (!initialized || !isTrackingReady || !user || !chapter || isIncognito) {
      return;
    }

    const intervalId = window.setInterval(() => {
      void flushReadingSession(30, true);
    }, 30000);

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        void flushReadingSession(5, false);
        return;
      }

      readingSessionStartedAt.current = Date.now();
    };

    const handleBeforeUnload = () => {
      void flushReadingSession(5, false);
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [initialized, isTrackingReady, user, chapter, isIncognito, flushReadingSession]);

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
  }, [chapter, initialized, isAutoScrolling, isAutoScrollAvailable, isLoading, mangaId, navigate, nextChapter, resolvedPages.length, settings.autoScrollSpeed]);

  useEffect(() => {
    if (!initialized || !isAutoScrollAvailable || !resumeAutoScrollAfterNavigationRef.current) {
      return;
    }

    resumeAutoScrollAfterNavigationRef.current = false;
    persistedAutoScrollIntent = true;
    setIsAutoScrolling(true);
  }, [chapterId, initialized, isAutoScrollAvailable]);

  const isScrollingRef = useRef(false);
  const scrollTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const handlePageChange = useCallback((page: number) => {
    // If we are programmatically scrolling, ignore updates from the observer
    if (isScrollingRef.current) return;
    setCurrentPage(page);
  }, []);

  // Scroll to a specific page (called when user clicks on progress bar)
  const scrollToPage = useCallback((page: number, smooth = true) => {
    const targetIndex = page - 1;
    const targetElement = document.querySelector(`[data-page-index="${targetIndex}"]`);

    if (targetElement) {
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
        top: elementTop - 80,
        behavior: smooth ? 'smooth' : 'auto'
      });
      setCurrentPage(page);
    }
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
    if (!initialized || isLoading || resolvedPages.length === 0) {
      return;
    }

    const targetPage = pendingInitialRestorePageRef.current;
    if (targetPage === null) {
      return;
    }

    pendingInitialRestorePageRef.current = null;

    const restore = () => {
      if (targetPage > 1) {
        scrollToPage(targetPage, false);
        return;
      }

      window.scrollTo({ top: 0, behavior: 'auto' });
    };

    const timers = [0, 200, 700, 1400].map((delay) => window.setTimeout(restore, delay));

    return () => {
      timers.forEach((timerId) => window.clearTimeout(timerId));
    };
  }, [chapterId, initialized, isLoading, resolvedPages.length, scrollToPage]);

  const handleAddBookmark = useCallback(() => {
    if (!isOnlineNow) {
      toast.error('Yer imi eklemek için internet bağlantısı gerekli');
      return;
    }

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
      }).then(() => {
        toast.success(`Yer imi eklendi: Sayfa ${currentPage}`);
      }).catch((error) => {
        if (error.message === 'ALREADY_EXISTS') {
          toast.warning(`Bu sayfa (Sayfa ${currentPage}) zaten yer imlerine eklenmiş!`);
        } else {
          console.error('Error adding bookmark:', error);
          toast.error('Yer imi eklenemedi');
        }
      });
    }
  }, [user, mangaId, chapterId, chapter, currentPage, isOnlineNow]);

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

  if (isLoading) {
    return <ReaderSkeleton />;
  }

  if (offlineUnavailable && manga && chapter) {
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

  if (!manga || !chapter) {
    return null;
  }

  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const scrollToBottom = () => {
    window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
  };

  return (
    <div
      className="min-h-screen bg-background"
      onClick={handleTap}
    >
      <ReaderControls
        mangaId={manga.id}
        mangaTitle={manga.title}
        currentChapter={chapter}
        chapters={manga.chapters}
        settings={settings}
        onSettingsChange={handleSettingsChange}
        onAddBookmark={handleAddBookmark}
        currentPage={currentPage}
        totalPages={resolvedPages.length}
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
      />

      <div ref={readerContentRef}>
        {settings.mode === 'vertical' || settings.mode === 'webtoon' ? (
          <VerticalReader
            key={chapterId}
            pages={resolvedPages}
            settings={settings}
            onPageChange={handlePageChange}
            initialPage={currentPage}
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
        className="mx-auto max-w-4xl px-4 py-8 mt-8 border-t border-border"
        onClick={(e) => e.stopPropagation()}
      >
        {isOnlineNow ? (
          <CommentSection mangaId={manga.id} chapterId={chapterId} />
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
