import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Link, useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { getMangaById, incrementChapterViews, incrementMangaViews } from '@/lib/database';
import {
  getReaderSettings,
  setReaderSettings,
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

const Reader: React.FC = () => {
  const { mangaId, chapterId } = useParams<{ mangaId: string; chapterId: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const viewTracked = useRef(false);

  const [manga, setManga] = useState<any>(null);
  const [chapter, setChapter] = useState<any>(null);
  const [resolvedPages, setResolvedPages] = useState<ResolvedReaderPage[]>([]);
  const [settings, setSettings] = useState<ReaderSettings>(getReaderSettings());
  const [currentPage, setCurrentPage] = useState(1);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [initialized, setInitialized] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isIncognito, setIsIncognito] = useState(() => localStorage.getItem('toonparrot_incognito') === 'true');
  const [isAutoScrolling, setIsAutoScrolling] = useState(false);
  const [isOfflineChapter, setIsOfflineChapter] = useState(false);
  const [offlineUnavailable, setOfflineUnavailable] = useState(false);
  const readingSessionStartedAt = useRef<number | null>(null);
  const readerContentRef = useRef<HTMLDivElement | null>(null);
  const autoScrollFrameRef = useRef<number | null>(null);
  const autoScrollLastTickRef = useRef<number | null>(null);
  const revokeOfflineUrlsRef = useRef<(() => void) | null>(null);

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

    if (navigator.onLine) {
      await logChapterRead(user.id, mangaId, chapterId, chapter.number, elapsedSeconds);
      await flushPendingReaderSync();
      return;
    }
  }, [user, mangaId, chapterId, chapter, isIncognito]);

  // Reset state and scroll on chapter change
  useEffect(() => {
    setCurrentPage(1);
    window.scrollTo({ top: 0, behavior: 'instant' });
    viewTracked.current = false;
    setIsAutoScrolling(false);
    setOfflineUnavailable(false);
    setResolvedPages([]);
    setIsOfflineChapter(false);
    revokeOfflineUrlsRef.current?.();
    revokeOfflineUrlsRef.current = null;
  }, [chapterId]);

  useEffect(() => () => {
    revokeOfflineUrlsRef.current?.();
    revokeOfflineUrlsRef.current = null;
  }, []);

  // Load Manga and Chapter
  useEffect(() => {
    const loadContent = async () => {
      if (!mangaId || !chapterId) return;

      try {
        setIsLoading(true);
        const offlineChapter = await getOfflineChapter(chapterId);
        const mData = navigator.onLine ? await getMangaById(mangaId) : undefined;
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

        if (offlineChapter?.downloadStatus === 'completed') {
          const offlinePages = await buildOfflineReaderPages(chapterId);
          revokeOfflineUrlsRef.current?.();
          revokeOfflineUrlsRef.current = offlinePages.revoke;
          setResolvedPages(offlinePages.pages);
          setIsOfflineChapter(true);
          setOfflineUnavailable(false);
        } else if (!navigator.onLine) {
          setResolvedPages([]);
          setIsOfflineChapter(false);
          setOfflineUnavailable(true);
        } else {
          setResolvedPages(resolvedChapter.pages.map((page) => ({ src: page, source: 'remote' })));
          setIsOfflineChapter(false);
          setOfflineUnavailable(false);
        }

        // Determine initial page
        const urlPage = searchParams.get('page');
        if (urlPage && parseInt(urlPage) > 0) {
          setCurrentPage(parseInt(urlPage));
        } else if (user && navigator.onLine) {
          const progress = await getLatestProgress(user.id, mangaId);
          if (progress && progress.chapterId === chapterId && progress.page > 1) {
            setCurrentPage(progress.page);
          } else {
            setCurrentPage(1);
          }
        } else if (user) {
          const pendingProgress = (await getPendingReaderSyncItems())
            .filter((item) => item.type === 'progress' && item.userId === user.id)
            .find((item) => (item.payload as { mangaId?: string }).mangaId === mangaId);

          const pendingPayload = pendingProgress?.payload as { chapterId?: string; page?: number } | undefined;
          if (pendingPayload?.chapterId === chapterId && pendingPayload.page && pendingPayload.page > 1) {
            setCurrentPage(pendingPayload.page);
          } else {
            setCurrentPage(1);
          }
        } else {
          setCurrentPage(1);
        }

        setInitialized(true);

        // Track views (only if not incognito)
        if (!viewTracked.current && !isIncognito && navigator.onLine) {
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
  }, [mangaId, chapterId, user, navigate, searchParams]);

  // Save reading progress when page changes
  useEffect(() => {
    const saveProgress = async () => {
      if (mangaId && chapterId && chapter && initialized && user && !isIncognito) {
        try {
          if (navigator.onLine) {
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
          });
        } catch (error) {
          console.error('Error updating reading progress:', error);
        }
      }
    };
    saveProgress();
  }, [mangaId, chapterId, chapter, currentPage, initialized, user]);

  useEffect(() => {
    if (!isOfflineChapter || !chapterId || resolvedPages.length === 0) {
      return;
    }

    void markOfflineChapterReadProgress(chapterId, currentPage, resolvedPages.length);
  }, [chapterId, currentPage, isOfflineChapter, resolvedPages.length]);

  useEffect(() => {
    if (!initialized || !user || !mangaId || !chapterId || !chapter || isIncognito) {
      readingSessionStartedAt.current = null;
      return;
    }

    if (navigator.onLine) {
      logChapterRead(user.id, mangaId, chapterId, chapter.number, 0);
    }
    readingSessionStartedAt.current = Date.now();

    return () => {
      void flushReadingSession(5, false);
    };
  }, [initialized, user, mangaId, chapterId, chapter, isIncognito, flushReadingSession]);

  useEffect(() => {
    if (!initialized || !user || !chapter || isIncognito) {
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
  }, [initialized, user, chapter, isIncognito, flushReadingSession]);

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

    setIsAutoScrolling((prev) => !prev);
  }, [isAutoScrollAvailable]);

  const handleAutoScrollSpeedChange = useCallback((speed: number) => {
    handleSettingsChange({
      ...settings,
      autoScrollSpeed: speed,
    });
  }, [handleSettingsChange, settings]);

  useEffect(() => {
    if (isAutoScrollAvailable) {
      return;
    }

    setIsAutoScrolling(false);
  }, [isAutoScrollAvailable]);

  useEffect(() => {
    if (!isAutoScrolling || !isAutoScrollAvailable) {
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
        setIsAutoScrolling(false);
        toast.info('Bölüm sonuna ulaşıldı, otomatik kaydırma durduruldu.');
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
  }, [isAutoScrolling, isAutoScrollAvailable, settings.autoScrollSpeed]);

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

  const handleAddBookmark = useCallback(() => {
    if (!navigator.onLine) {
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
  }, [user, mangaId, chapterId, chapter, currentPage]);

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
        {navigator.onLine ? (
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
