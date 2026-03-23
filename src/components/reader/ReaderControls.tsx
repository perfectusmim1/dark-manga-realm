import React, { useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import {
  ChevronLeft,
  ChevronRight,
  Settings,
  BookmarkPlus,
  Rows,
  Columns,
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

  const [hoverPage, setHoverPage] = useState<number | null>(null);

  const progressPercent = totalPages > 1 ? ((currentPage - 1) / (totalPages - 1)) * 100 : 0;

  const handleBarClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.stopPropagation();
    const bar = e.currentTarget;
    const rect = bar.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const ratio = Math.max(0, Math.min(1, x / rect.width));
    const page = Math.round(ratio * (totalPages - 1)) + 1;
    onPageChange?.(Math.max(1, Math.min(totalPages, page)), false);
  }, [totalPages, onPageChange]);

  const handleBarHover = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const bar = e.currentTarget;
    const rect = bar.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const ratio = Math.max(0, Math.min(1, x / rect.width));
    const page = Math.round(ratio * (totalPages - 1)) + 1;
    setHoverPage(Math.max(1, Math.min(totalPages, page)));
  }, [totalPages]);

  const handleBarLeave = useCallback(() => {
    setHoverPage(null);
  }, []);

  return (
    <>
      {/* Top Bar */}
      <div
        className={`fixed left-0 right-0 top-0 z-50 border-b border-border/50 bg-background/95 backdrop-blur-xl transition-transform duration-300 ${visible ? 'translate-y-0' : '-translate-y-full'}`}
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div
          className="container flex h-14 items-center justify-between gap-4"
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
        className={`fixed bottom-0 left-0 right-0 z-50 border-t border-border/50 bg-background/95 backdrop-blur-xl transition-transform duration-300 ${visible ? 'translate-y-0' : 'translate-y-full'}`}
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div
          className="container flex h-14 items-center justify-between gap-4"
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
            <div className="flex flex-1 items-center justify-center gap-3 px-4 overflow-hidden">
              <span className="text-xs font-semibold tabular-nums text-muted-foreground select-none whitespace-nowrap">
                {currentPage} / {totalPages}
              </span>

              <div className="relative flex-1 max-w-[500px]">
                {/* Hover tooltip */}
                {hoverPage !== null && (
                  <div
                    className="absolute -top-8 z-10 rounded-md bg-popover px-2 py-0.5 text-[11px] font-bold text-popover-foreground shadow-lg border border-border/50 pointer-events-none select-none"
                    style={{
                      left: `${totalPages > 1 ? ((hoverPage - 1) / (totalPages - 1)) * 100 : 0}%`,
                      transform: 'translateX(-50%)',
                    }}
                  >
                    {hoverPage}
                  </div>
                )}

                {/* Clickable track area */}
                <div
                  className="relative h-8 flex items-center cursor-pointer group"
                  onClick={handleBarClick}
                  onMouseMove={handleBarHover}
                  onMouseLeave={handleBarLeave}
                >
                  {/* Background track */}
                  <div className="absolute inset-x-0 h-[5px] rounded-full bg-white/10 group-hover:h-[7px] transition-all duration-200" />

                  {/* Fill */}
                  <div
                    className="absolute left-0 h-[5px] rounded-full bg-gradient-to-r from-primary to-blue-400 group-hover:h-[7px] transition-all duration-200 pointer-events-none"
                    style={{ width: `${progressPercent}%` }}
                  />

                  {/* Thumb */}
                  <div
                    className="absolute top-1/2 -translate-y-1/2 h-3.5 w-3.5 rounded-full bg-white border-2 border-primary shadow-[0_0_10px_rgba(59,130,246,0.5)] group-hover:h-4 group-hover:w-4 group-hover:shadow-[0_0_16px_rgba(59,130,246,0.7)] transition-all duration-200 pointer-events-none"
                    style={{
                      left: `calc(${progressPercent}% - 7px)`,
                    }}
                  />
                </div>
              </div>

              <span className="text-[10px] font-medium tabular-nums text-primary select-none whitespace-nowrap">
                %{Math.round(progressPercent)}
              </span>
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
