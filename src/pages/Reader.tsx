import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getMangaById, getChapterById } from '@/lib/mockData';
import { 
  getReaderSettings, 
  setReaderSettings,
  updateReadingProgress,
  addBookmark
} from '@/lib/storage';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import ReaderControls from '@/components/reader/ReaderControls';
import VerticalReader from '@/components/reader/VerticalReader';
import HorizontalReader from '@/components/reader/HorizontalReader';
import { ReaderSettings } from '@/lib/types';

const Reader: React.FC = () => {
  const { mangaId, chapterId } = useParams<{ mangaId: string; chapterId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  
  const manga = getMangaById(mangaId || '');
  const chapter = getChapterById(mangaId || '', chapterId || '');
  
  const [settings, setSettings] = useState<ReaderSettings>(getReaderSettings());
  const [currentPage, setCurrentPage] = useState(1);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [lastTap, setLastTap] = useState(0);

  useEffect(() => {
    if (!manga || !chapter) {
      navigate('/');
      return;
    }

    // Save reading progress
    if (mangaId && chapterId) {
      updateReadingProgress({
        mangaId,
        chapterId,
        page: currentPage,
      });
    }
  }, [manga, chapter, navigate, mangaId, chapterId, currentPage]);

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

    if (mangaId && chapterId) {
      addBookmark({
        mangaId,
        chapterId,
        page: currentPage,
      });
      toast.success(`Yer imi eklendi: Sayfa ${currentPage}`);
    }
  }, [user, mangaId, chapterId, currentPage]);

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
      />

      {settings.mode === 'vertical' ? (
        <VerticalReader
          pages={chapter.pages}
          settings={settings}
          onPageChange={handlePageChange}
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
