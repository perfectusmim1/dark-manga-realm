import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
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
import { ArrowUpToLine, ArrowDownToLine } from 'lucide-react';
import ReaderControls from '@/components/reader/ReaderControls';
import VerticalReader from '@/components/reader/VerticalReader';
import HorizontalReader from '@/components/reader/HorizontalReader';
import CommentSection from '@/components/comments/CommentSection';
import { ReaderSettings } from '@/lib/types';
import ReaderSkeleton from '@/components/skeletons/ReaderSkeleton';

const Reader: React.FC = () => {
  const { mangaId, chapterId } = useParams<{ mangaId: string; chapterId: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const viewTracked = useRef(false);

  const [manga, setManga] = useState<any>(null);
  const [chapter, setChapter] = useState<any>(null);
  const [settings, setSettings] = useState<ReaderSettings>(getReaderSettings());
  const [currentPage, setCurrentPage] = useState(1);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [initialized, setInitialized] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isIncognito, setIsIncognito] = useState(() => localStorage.getItem('toonparrot_incognito') === 'true');

  const toggleIncognito = (val: boolean) => {
    setIsIncognito(val);
    localStorage.setItem('toonparrot_incognito', val.toString());
    if (val) {
        toast.info("Gizli mod açıldı. Okuma verileriniz kaydedilmeyecek.");
    } else {
        toast.info("Gizli mod kapatıldı.");
    }
  };

  // Reset state and scroll on chapter change
  useEffect(() => {
    setCurrentPage(1);
    window.scrollTo({ top: 0, behavior: 'instant' });
    viewTracked.current = false;
  }, [chapterId]);

  // Load Manga and Chapter
  useEffect(() => {
    const loadContent = async () => {
      if (!mangaId || !chapterId) return;

      try {
        setIsLoading(true);
        const mData = await getMangaById(mangaId);
        if (!mData) {
          navigate('/');
          return;
        }
        setManga(mData);

        const ch = mData.chapters.find(c => c.id === chapterId);
        if (!ch) {
          navigate(`/manga/${mangaId}`);
          return;
        }
        setChapter(ch);

        // Determine initial page
        const urlPage = searchParams.get('page');
        if (urlPage && parseInt(urlPage) > 0) {
          setCurrentPage(parseInt(urlPage));
        } else if (user) {
          const progress = await getLatestProgress(user.id, mangaId);
          if (progress && progress.chapterId === chapterId && progress.page > 1) {
            setCurrentPage(progress.page);
          } else {
            setCurrentPage(1);
          }
        } else {
          setCurrentPage(1);
        }

        setInitialized(true);

        // Track views (only if not incognito)
        if (!viewTracked.current && !isIncognito) {
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
          await updateReadingProgress(user.id, {
            mangaId,
            chapterId,
            chapterNumber: chapter.number,
            page: currentPage,
          });
          
          await logChapterRead(user.id, mangaId, chapterId, chapter.number);
        } catch (error) {
          console.error('Error updating reading progress:', error);
        }
      }
    };
    saveProgress();
  }, [mangaId, chapterId, chapter, currentPage, initialized, user]);

  const handleSettingsChange = useCallback((newSettings: ReaderSettings) => {
    setSettings(newSettings);
    setReaderSettings(newSettings);
  }, []);

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
        totalPages={chapter.pages.length}
        visible={controlsVisible}
        onPageChange={scrollToPage}
        isIncognito={isIncognito}
        onIncognitoToggle={toggleIncognito}
      />

      {settings.mode === 'vertical' || settings.mode === 'webtoon' ? (
        <VerticalReader
          key={chapterId}
          pages={chapter.pages}
          settings={settings}
          onPageChange={handlePageChange}
          initialPage={currentPage}
        />
      ) : (
        <HorizontalReader
          key={chapterId}
          pages={chapter.pages}
          settings={settings}
          currentPage={currentPage}
          onPageChange={handlePageChange}
        />
      )}

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
        <CommentSection mangaId={manga.id} chapterId={chapterId} />
      </div>
    </div>
  );
};

export default Reader;
