import React from 'react';
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
  onPageChange?: (page: number) => void;
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

  return (
    <>
      {/* Top Bar */}
      <div
        className={`fixed left-0 right-0 top-0 z-50 border-b border-border/50 bg-background/95 backdrop-blur-xl transition-transform duration-300 ${visible ? 'translate-y-0' : '-translate-y-full'
          }`}
      >
        <div className="container flex h-14 items-center justify-between gap-4">
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
                      className={`rounded-lg px-3 py-2 text-sm transition-colors hover:bg-secondary ${ch.id === currentChapter.id ? 'bg-primary text-primary-foreground' : ''
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
        <div className="container flex h-14 items-center justify-between gap-4">
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
              <div className="relative h-2 flex-1 max-w-[600px] group">
                {/* Progress Background */}
                <div className="absolute inset-0 rounded-full bg-secondary/30" />

                {/* Active Progress Fill */}
                <div
                  className="absolute inset-y-0 left-0 reading-progress-bar rounded-full transition-all duration-300 pointer-events-none"
                  style={{ width: `${(currentPage / totalPages) * 100}%` }}
                />

                {/* Interactive Dots Container */}
                <div className="absolute inset-x-0 h-full flex items-center justify-between px-[1px]">
                  {Array.from({ length: totalPages }).map((_, i) => {
                    const pageNum = i + 1;
                    const isActive = pageNum <= currentPage;
                    const isCurrent = pageNum === currentPage;

                    return (
                      <button
                        key={pageNum}
                        onClick={(e) => {
                          e.stopPropagation();
                          onPageChange?.(pageNum);
                        }}
                        className={`group/dot relative z-10 flex h-4 w-4 transform items-center justify-center transition-all hover:scale-150 ${isCurrent ? 'scale-125' : 'scale-100'
                          }`}
                        title={`Sayfa ${pageNum}`}
                      >
                        <div
                          className={`h-1.5 w-1.5 rounded-full transition-all duration-300 ${isCurrent
                              ? 'h-2 w-2 bg-primary shadow-[0_0_8px_rgba(var(--primary),0.6)]'
                              : isActive
                                ? 'bg-primary/80 group-hover/dot:bg-primary'
                                : 'bg-muted-foreground/40 group-hover/dot:bg-muted-foreground'
                            }`}
                        />
                        {/* Tooltip on hover */}
                        <div className="absolute -top-8 hidden rounded bg-popover px-2 py-0.5 text-[10px] text-popover-foreground shadow-md group-hover/dot:block">
                          {pageNum}
                        </div>
                      </button>
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
