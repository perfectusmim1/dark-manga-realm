import React, { useState, useRef, useCallback } from 'react';
import { Link } from 'react-router-dom';
import {
  ChevronLeft,
  ChevronRight,
  Settings,
  BookmarkPlus,
  Rows,
  Columns,
  Home,
  List,
  X
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ReaderSettings, Chapter } from '@/lib/types';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';

interface ReaderControlsProps {
  mangaId: string;
  mangaTitle: string;
  currentChapter: Chapter;
  chapters: Chapter[];
  settings: ReaderSettings;
  onSettingsChange: (settings: ReaderSettings) => void;
  onAddBookmark: () => void;
  currentPage: number;
  totalPages: number;
  visible: boolean;
  onPageChange?: (page: number, smooth?: boolean) => void;
}

const ReaderControls: React.FC<ReaderControlsProps> = ({
  mangaId,
  mangaTitle,
  currentChapter,
  chapters,
  settings,
  onSettingsChange,
  onAddBookmark,
  currentPage,
  totalPages,
  visible,
  onPageChange,
}) => {
  const currentIndex = chapters.findIndex(ch => ch.id === currentChapter.id);
  const prevChapter = chapters[currentIndex + 1];
  const nextChapter = chapters[currentIndex - 1];

  const [isDragging, setIsDragging] = useState(false);
  const progressBarRef = useRef<HTMLDivElement>(null);

  const calculatePageFromPosition = useCallback((clientX: number) => {
    if (!progressBarRef.current) return currentPage;

    const rect = progressBarRef.current.getBoundingClientRect();
    const x = clientX - rect.left;
    const percentage = Math.max(0, Math.min(1, x / rect.width));
    const page = Math.round(percentage * (totalPages - 1)) + 1;
    return Math.max(1, Math.min(totalPages, page));
  }, [currentPage, totalPages]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
    const page = calculatePageFromPosition(e.clientX);
    onPageChange?.(page, false);
  }, [calculatePageFromPosition, onPageChange]);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isDragging) return;
    const page = calculatePageFromPosition(e.clientX);
    onPageChange?.(page, false);
  }, [isDragging, calculatePageFromPosition, onPageChange]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    e.stopPropagation();
    setIsDragging(true);
    const touch = e.touches[0];
    const page = calculatePageFromPosition(touch.clientX);
    onPageChange?.(page, false);
  }, [calculatePageFromPosition, onPageChange]);

  const handleTouchMove = useCallback((e: TouchEvent) => {
    if (!isDragging) return;
    const touch = e.touches[0];
    const page = calculatePageFromPosition(touch.clientX);
    onPageChange?.(page, false);
  }, [isDragging, calculatePageFromPosition, onPageChange]);

  const handleTouchEnd = useCallback(() => {
    setIsDragging(false);
  }, []);

  // Add and remove global event listeners for dragging
  React.useEffect(() => {
    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      window.addEventListener('touchmove', handleTouchMove);
      window.addEventListener('touchend', handleTouchEnd);
    }
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('touchend', handleTouchEnd);
    };
  }, [isDragging, handleMouseMove, handleMouseUp, handleTouchMove, handleTouchEnd]);

  return (
    <>
      {/* Top Bar */}
      <div
        className={`fixed left-0 right-0 top-0 z-50 border-b border-border/50 bg-background/95 backdrop-blur-xl transition-transform duration-300 ${visible ? 'translate-y-0' : '-translate-y-full'
          }`}
      >
        <div 
          className="container flex h-14 items-center justify-between gap-4"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center gap-2">
            <Button asChild variant="ghost" size="icon">
              <Link to={`/manga/${mangaId}`}>
                <X className="h-5 w-5" />
              </Link>
            </Button>
            <div className="flex flex-col">
              <span className="line-clamp-1 text-sm font-medium">{mangaTitle}</span>
              <span className="text-xs text-muted-foreground">
                Bölüm {currentChapter.number}: {currentChapter.title}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" onClick={onAddBookmark}>
              <BookmarkPlus className="h-5 w-5" />
            </Button>

            <Popover>
              <PopoverTrigger asChild>
                <Button variant="ghost" size="icon">
                  <List className="h-5 w-5" />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-64 max-h-80 overflow-auto">
                <h4 className="mb-2 font-semibold">Bölümler</h4>
                <div className="flex flex-col gap-1">
                  {chapters.slice().reverse().map((ch) => (
                    <Link
                      key={ch.id}
                      to={`/manga/${mangaId}/chapter/${ch.id}`}
                      className={`rounded-lg px-3 py-2 text-sm transition-colors ${ch.id === currentChapter.id
                        ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                        : 'hover:bg-secondary text-foreground'
                        }`}
                    >
                      Bölüm {ch.number}
                    </Link>
                  ))}
                </div>
              </PopoverContent>
            </Popover>

            <Popover>
              <PopoverTrigger asChild>
                <Button variant="ghost" size="icon">
                  <Settings className="h-5 w-5" />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-64">
                <h4 className="mb-4 font-semibold">Okuyucu Ayarları</h4>
                <div className="flex flex-col gap-4">
                  <div className="flex items-center justify-between">
                    <Label>Okuma Modu</Label>
                    <div className="flex gap-1">
                      <Button
                        variant={settings.mode === 'vertical' ? 'default' : 'ghost'}
                        size="icon"
                        onClick={() => onSettingsChange({ ...settings, mode: 'vertical' })}
                      >
                        <Rows className="h-4 w-4" />
                      </Button>
                      <Button
                        variant={settings.mode === 'horizontal' ? 'default' : 'ghost'}
                        size="icon"
                        onClick={() => onSettingsChange({ ...settings, mode: 'horizontal' })}
                      >
                        <Columns className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                      <Label>Zoom (%{settings.zoom || 100})</Label>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2 text-[10px]"
                        onClick={() => onSettingsChange({ ...settings, zoom: 100 })}
                      >
                        Sıfırla
                      </Button>
                    </div>
                    <Slider
                      value={[settings.zoom || 100]}
                      min={10}
                      max={300}
                      step={5}
                      onValueChange={([val]) => onSettingsChange({ ...settings, zoom: val })}
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <Label>Genişliğe Sığdır</Label>
                    <Switch
                      checked={settings.fitWidth}
                      onCheckedChange={(checked) => onSettingsChange({ ...settings, fitWidth: checked })}
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <Label>İlerleme Göster</Label>
                    <Switch
                      checked={settings.showProgress}
                      onCheckedChange={(checked) => onSettingsChange({ ...settings, showProgress: checked })}
                    />
                  </div>
                </div>
              </PopoverContent>
            </Popover>
          </div>
        </div>
      </div>

      {/* Bottom Bar */}
      <div
        className={`fixed bottom-0 left-0 right-0 z-50 border-t border-border/50 bg-background/95 backdrop-blur-xl transition-transform duration-300 ${visible ? 'translate-y-0' : 'translate-y-full'
          }`}
      >
        <div 
          className="container flex h-14 items-center justify-between gap-4"
          onClick={(e) => e.stopPropagation()}
        >
          <Button
            variant="ghost"
            disabled={!prevChapter}
            asChild={!!prevChapter}
          >
            {prevChapter ? (
              <Link to={`/manga/${mangaId}/chapter/${prevChapter.id}`}>
                <ChevronLeft className="h-4 w-4" />
                Önceki
              </Link>
            ) : (
              <>
                <ChevronLeft className="h-4 w-4" />
                Önceki
              </>
            )}
          </Button>

          {settings.showProgress && (
            <div className="flex flex-1 items-center justify-center gap-4 px-4 overflow-hidden">
              <span className="text-sm font-medium tabular-nums min-w-[3rem] text-center">
                {currentPage} / {totalPages}
              </span>
              <div
                ref={progressBarRef}
                className={`relative h-6 flex-1 max-w-[600px] group cursor-pointer flex items-center ${isDragging ? 'cursor-grabbing' : 'cursor-grab'}`}
                onMouseDown={handleMouseDown}
                onTouchStart={handleTouchStart}
                onClick={(e) => e.stopPropagation()}
              >
                {/* Progress Background */}
                <div className="absolute inset-x-0 h-1.5 rounded-full bg-secondary/30 pointer-events-none" />

                {/* Active Progress Fill */}
                <div
                  className="absolute inset-y-0 left-0 reading-progress-bar rounded-full transition-all duration-300 pointer-events-none"
                  style={{ width: `calc(${totalPages > 1 ? ((currentPage - 1) / (totalPages - 1)) * 100 : 0}% + 4px)` }}
                />

                {/* Interactive Dots Container */}
                <div className="absolute inset-x-0 h-full flex items-center justify-between px-[1px] pointer-events-none">
                  {Array.from({ length: totalPages }).map((_, i) => {
                    const pageNum = i + 1;
                    const isActive = pageNum <= currentPage;
                    const isCurrent = pageNum === currentPage;

                    return (
                      <div
                        key={pageNum}
                        className={`group/dot relative z-10 flex h-full flex-1 items-center justify-center transition-all min-w-[2px]`}
                      >
                        <div
                          className={`rounded-full transition-all duration-300 ${isCurrent
                            ? 'h-2.5 w-2.5 bg-white shadow-[0_0_8px_rgba(255,255,255,0.8)] scale-125'
                            : isActive
                              ? 'h-1.5 w-1.5 bg-white'
                              : 'h-1.5 w-1.5 bg-muted-foreground/40'
                            }`}
                        />
                        <div className="absolute -top-8 left-1/2 -translate-x-1/2 hidden rounded bg-popover px-2 py-0.5 text-[10px] text-popover-foreground shadow-md group-hover/dot:block font-bold">
                          {pageNum}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          <Button
            variant="ghost"
            disabled={!nextChapter}
            asChild={!!nextChapter}
          >
            {nextChapter ? (
              <Link to={`/manga/${mangaId}/chapter/${nextChapter.id}`}>
                Sonraki
                <ChevronRight className="h-4 w-4" />
              </Link>
            ) : (
              <>
                Sonraki
                <ChevronRight className="h-4 w-4" />
              </>
            )}
          </Button>
        </div>
      </div>
    </>
  );
};

export default ReaderControls;
