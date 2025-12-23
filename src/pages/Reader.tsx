import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { getMangaById, incrementChapterViews, incrementMangaViews } from '@/lib/database';
import { getChapterById } from '@/lib/mockData';
import {
  getReaderSettings,
  setReaderSettings,
  updateReadingProgress,
  addBookmark,
  getLatestProgress,
} from '../lib/storage';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import ReaderControls from '@/components/reader/ReaderControls';
import VerticalReader from '@/components/reader/VerticalReader';
import HorizontalReader from '@/components/reader/HorizontalReader';
import { ReaderSettings } from '@/lib/types';

const Reader: React.FC = () => {
  const { mangaId, chapterId } = useParams<{ mangaId: string; chapterId: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const viewTracked = useRef(false);

  const manga = getMangaById(mangaId || '');
  const chapter = getChapterById(mangaId || '', chapterId || '');

  // Compute initial page synchronously from URL or saved progress
  const getInitialPage = (): number => {
    // First check URL param
    const urlPage = searchParams.get('page');
    if (urlPage && parseInt(urlPage) > 0) {
      return parseInt(urlPage);
    }
    // Fall back to saved progress
    if (mangaId) {
      const progress = getLatestProgress(mangaId);
      if (progress && progress.chapterId === chapterId && progress.page > 1) {
        return progress.page;
      }
    }
    return 1;
  };

  const [settings, setSettings] = useState<ReaderSettings>(getReaderSettings());
  const [currentPage, setCurrentPage] = useState(() => getInitialPage());
  const [controlsVisible, setControlsVisible] = useState(true);
  const [lastTap, setLastTap] = useState(0);
  const [initialized, setInitialized] = useState(false);

  // Initialize and track views
  useEffect(() => {
    if (!manga || !chapter) {
      navigate('/');
      return;
    }

    if (!initialized && mangaId && chapterId) {
      setInitialized(true);

      // Track views only once per chapter visit
      if (!viewTracked.current) {
        incrementMangaViews(mangaId);
        incrementChapterViews(mangaId, chapterId);
        viewTracked.current = true;
      }
    }
  }, [manga, chapter, navigate, mangaId, chapterId, initialized]);

  // Save reading progress when page changes
  useEffect(() => {
    if (mangaId && chapterId && chapter && initialized) {
      updateReadingProgress({
        mangaId,
        chapterId,
        chapterNumber: chapter.number,
        page: currentPage,
      });
    }
  }, [mangaId, chapterId, chapter, currentPage, initialized]);

  const handleSettingsChange = useCallback((newSettings: ReaderSettings) => {
    setSettings(newSettings);
    setReaderSettings(newSettings);
  }, []);

  const handlePageChange = useCallback((page: number) => {
    setCurrentPage(page);
  }, []);

  const handleAddBookmark = useCallback(() => {
    if (!user) {
      toast.error('Yer imi eklemek için giriş yapmalısınız');
      return;
    }

    if (mangaId && chapterId && chapter) {
      addBookmark({
        mangaId,
        chapterId,
        chapterNumber: chapter.number,
        page: currentPage,
      });
      toast.success(`Yer imi eklendi: Sayfa ${currentPage}`);
    }
  }, [user, mangaId, chapterId, chapter, currentPage]);

  const handleTap = useCallback(() => {
    const now = Date.now();
    if (now - lastTap < 300) {
      // Double tap - toggle controls
      setControlsVisible(prev => !prev);
    }
    setLastTap(now);
  }, [lastTap]);

  // Hide controls after inactivity
  useEffect(() => {
    let timeout: NodeJS.Timeout;

    const handleMouseMove = () => {
      setControlsVisible(true);
      clearTimeout(timeout);
      timeout = setTimeout(() => {
        if (settings.mode === 'horizontal') {
          setControlsVisible(false);
        }
      }, 3000);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('touchstart', handleMouseMove);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('touchstart', handleMouseMove);
      clearTimeout(timeout);
    };
  }, [settings.mode]);

  if (!manga || !chapter) {
    return null;
  }

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
        onPageChange={handlePageChange}
      />

      {settings.mode === 'vertical' || settings.mode === 'webtoon' ? (
        <VerticalReader
          pages={chapter.pages}
          settings={settings}
          onPageChange={handlePageChange}
          initialPage={currentPage}
        />
      ) : (
        <HorizontalReader
          pages={chapter.pages}
          settings={settings}
          currentPage={currentPage}
          onPageChange={handlePageChange}
        />
      )}
    </div>
  );
};

export default Reader;
