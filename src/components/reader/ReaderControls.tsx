import React, { useCallback, useDeferredValue, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ChevronLeft,
  ChevronRight,
  Settings,
  BookmarkPlus,
  Rows,
  Columns,
  List,
  Home,
  BookOpen,
  Play,
  Pause,
  Gauge,
  Search,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ReaderSettings, Chapter } from '@/lib/types';
import { formatChapterDisplayTitle } from '@/lib/chapterTitle';
import { Input } from '@/components/ui/input';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from '@/components/ui/drawer';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { buildRouteKey, markRouteToForceTopOnNextVisit } from '@/lib/scrollRestoration';
import { cn } from '@/lib/utils';
import { useDeviceProfile } from '@/hooks/use-device-profile';

const READER_TOP_SAFE_AREA = 'calc(env(safe-area-inset-top) + 0px)';
const READER_BOTTOM_SAFE_AREA = 'calc(env(safe-area-inset-bottom) + 0px)';

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
  isIncognito: boolean;
  onIncognitoToggle: (val: boolean) => void;
  isAutoScrollAvailable: boolean;
  isAutoScrolling: boolean;
  autoScrollSpeed: number;
  onAutoScrollToggle: () => void;
  onAutoScrollSpeedChange: (speed: number) => void;
  isOfflineChapter?: boolean;
  isOnline?: boolean;
  forceOfflineRead?: boolean;
  onBeforeChapterChange?: (chapter?: Chapter) => Promise<void> | void;
}

const normalizeChapterSearchValue = (value?: string | null) => (
  value?.trim().toLocaleLowerCase('tr-TR') || ''
);

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
  isIncognito,
  onIncognitoToggle,
  isAutoScrollAvailable,
  isAutoScrolling,
  autoScrollSpeed,
  onAutoScrollToggle,
  onAutoScrollSpeedChange,
  isOfflineChapter = false,
  isOnline = true,
  forceOfflineRead = false,
  onBeforeChapterChange,
}) => {
  const navigate = useNavigate();
  const { isMobile } = useDeviceProfile();
  const currentIndex = chapters.findIndex(ch => ch.id === currentChapter.id);
  const prevChapter = chapters[currentIndex + 1];
  const nextChapter = chapters[currentIndex - 1];

  const [hoverPage, setHoverPage] = useState<number | null>(null);
  const [navigatingChapterId, setNavigatingChapterId] = useState<string | null>(null);
  const [chapterSearch, setChapterSearch] = useState('');
  const [chapterPanelOpen, setChapterPanelOpen] = useState(false);
  const seriesRouteKey = buildRouteKey(`/manga/${mangaId}`);
  const deferredChapterSearch = useDeferredValue(normalizeChapterSearchValue(chapterSearch));

  const progressPercent = totalPages > 1 ? ((currentPage - 1) / (totalPages - 1)) * 100 : 0;
  const chapterItems = useMemo(() => chapters.slice().reverse(), [chapters]);
  const filteredChapters = useMemo(() => {
    if (!deferredChapterSearch) {
      return chapterItems;
    }

    return chapterItems.filter((chapterItem) => {
      const searchTarget = normalizeChapterSearchValue(
        `${chapterItem.number} ${chapterItem.title || ''} ${formatChapterDisplayTitle(chapterItem.number, chapterItem.title)}`
      );
      return searchTarget.includes(deferredChapterSearch);
    });
  }, [chapterItems, deferredChapterSearch]);

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

  const handleChapterNavigation = useCallback(async (chapter?: Chapter) => {
    if (!chapter || navigatingChapterId) {
      return;
    }

    setNavigatingChapterId(chapter.id);

    try {
      await onBeforeChapterChange?.(chapter);
      setChapterPanelOpen(false);
      const nextParams = new URLSearchParams();
      nextParams.set('page', '1');
      if (forceOfflineRead) {
        nextParams.set('offline', '1');
      }
      navigate(`/manga/${mangaId}/chapter/${chapter.id}?${nextParams.toString()}`);
    } finally {
      setNavigatingChapterId(null);
    }
  }, [forceOfflineRead, mangaId, navigate, navigatingChapterId, onBeforeChapterChange]);

  const handleSeriesPageNavigation = useCallback(() => {
    markRouteToForceTopOnNextVisit(seriesRouteKey);
  }, [seriesRouteKey]);

  const chapterPanelContent = (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h4 className="text-sm font-semibold sm:text-base">Bölümler</h4>
          <p className="text-[11px] text-muted-foreground sm:text-xs">
            {filteredChapters.length} bölüm
          </p>
        </div>
        {isOfflineChapter && (
          <span className="rounded-full border border-border bg-secondary/80 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Offline
          </span>
        )}
      </div>

      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="search"
          value={chapterSearch}
          onChange={(event) => setChapterSearch(event.target.value)}
          placeholder="Bölüm ara..."
          className="h-9 rounded-xl border-border/70 bg-background/70 pl-9 text-sm"
        />
      </div>

      <div
        className={cn(
          'overflow-y-auto pr-1',
          isMobile ? 'max-h-[min(58svh,25rem)] space-y-2' : 'max-h-[min(60vh,28rem)] space-y-2.5'
        )}
      >
        {filteredChapters.map((ch) => {
          const isCurrentChapter = ch.id === currentChapter.id;
          return (
            <button
              key={ch.id}
              type="button"
              onClick={() => void handleChapterNavigation(ch)}
              disabled={navigatingChapterId === ch.id}
              className={cn(
                'w-full rounded-2xl border px-3 text-left shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] transition-all duration-200',
                isMobile ? 'py-2.5' : 'py-3',
                isCurrentChapter
                  ? 'border-emerald-500/35 bg-emerald-500/[0.12] text-foreground shadow-[0_0_0_1px_rgba(16,185,129,0.12),0_10px_30px_rgba(6,95,70,0.16)]'
                  : 'border-border/60 bg-card/60 text-foreground hover:border-border hover:bg-card/85',
                navigatingChapterId === ch.id && 'opacity-60'
              )}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className={cn(
                    'truncate font-semibold',
                    isMobile ? 'text-[0.95rem]' : 'text-sm',
                    isCurrentChapter && 'text-emerald-50'
                  )}>
                    {formatChapterDisplayTitle(ch.number, ch.title)}
                  </p>
                  <p className={cn(
                    'mt-1 text-[11px] text-muted-foreground',
                    isCurrentChapter && 'text-emerald-100/75'
                  )}>
                    Bölüm {ch.number}
                  </p>
                </div>
                {isCurrentChapter && (
                  <span className="rounded-full border border-emerald-400/20 bg-emerald-500/15 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-emerald-100">
                    Aktif
                  </span>
                )}
              </div>
            </button>
          );
        })}

        {filteredChapters.length === 0 && (
          <div className="rounded-2xl border border-dashed border-border/70 px-4 py-6 text-center text-sm text-muted-foreground">
            Eşleşen bölüm bulunamadı.
          </div>
        )}
      </div>
    </div>
  );

  return (
    <>
      {/* Top Bar */}
      <div
        className={`fixed left-0 right-0 top-0 z-50 border-b border-border/50 bg-background/95 backdrop-blur-xl transition-transform duration-300 ${visible ? 'translate-y-0' : '-translate-y-full'}`}
        style={{ paddingTop: READER_TOP_SAFE_AREA }}
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div
          className="mx-auto flex w-full max-w-7xl items-center justify-between gap-2 px-2 py-2 sm:h-14 sm:gap-4 sm:px-4 sm:py-0"
        >
          <div className="flex min-w-0 flex-1 items-center gap-1.5 sm:gap-2">
            <Button asChild variant="ghost" size="icon" className="h-8 w-8 sm:h-10 sm:w-10" title="Ana Sayfa" aria-label="Ana sayfaya git">
              <Link to="/">
                <Home className="h-4 w-4 sm:h-5 sm:w-5" />
              </Link>
            </Button>
            <Button asChild variant="ghost" size="icon" className="h-8 w-8 sm:h-10 sm:w-10" title="Seri Sayfası" aria-label="Seri sayfasına git">
              <Link to={`/manga/${mangaId}`} onClick={handleSeriesPageNavigation}>
                <BookOpen className="h-4 w-4 sm:h-5 sm:w-5" />
              </Link>
            </Button>
            <div className="min-w-0 flex-1">
              <span className="line-clamp-1 block text-sm font-medium sm:text-sm">
                {mangaTitle}
              </span>
              <span className="block truncate text-[11px] text-muted-foreground sm:text-xs">
                {formatChapterDisplayTitle(currentChapter.number, currentChapter.title)}
              </span>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1 sm:gap-2">
            <Button variant="ghost" size="icon" className="h-8 w-8 sm:h-10 sm:w-10" onClick={onAddBookmark} title="Yer İmlerime Ekle">
              <BookmarkPlus className="h-4 w-4 sm:h-5 sm:w-5" />
            </Button>

            {isMobile ? (
              <Drawer
                open={chapterPanelOpen}
                onOpenChange={setChapterPanelOpen}
                modal
                dismissible
                shouldScaleBackground={false}
                autoFocus={false}
              >
                <DrawerTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8 sm:h-10 sm:w-10" aria-label="Bölüm listesini aç">
                    <List className="h-4 w-4 sm:h-5 sm:w-5" />
                  </Button>
                </DrawerTrigger>
                <DrawerContent
                  onOpenAutoFocus={(event) => {
                    event.preventDefault();
                  }}
                  onPointerDownOutside={() => {
                    setChapterPanelOpen(false);
                  }}
                  onInteractOutside={() => {
                    setChapterPanelOpen(false);
                  }}
                  className="max-h-[min(74svh,33rem)] rounded-t-[1.75rem] border-border/70 bg-background px-0 shadow-2xl pb-[max(0.75rem,env(safe-area-inset-bottom))]"
                >
                  <DrawerHeader className="px-4 pb-2 pt-2 text-left">
                    <DrawerTitle className="sr-only">Bölümler</DrawerTitle>
                    <DrawerDescription className="sr-only">
                      Okumak istediğiniz bölümü seçin.
                    </DrawerDescription>
                  </DrawerHeader>
                  <div className="px-4 pb-2">
                    {chapterPanelContent}
                  </div>
                </DrawerContent>
              </Drawer>
            ) : (
              <Popover open={chapterPanelOpen} onOpenChange={setChapterPanelOpen}>
                <PopoverTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8 sm:h-10 sm:w-10" aria-label="Bölüm listesini aç">
                    <List className="h-4 w-4 sm:h-5 sm:w-5" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-[min(24rem,calc(100vw-1rem))] rounded-2xl border-border/60 bg-popover/95 p-3 shadow-2xl backdrop-blur-xl sm:p-4">
                  {chapterPanelContent}
                </PopoverContent>
              </Popover>
            )}

            <Popover>
              <PopoverTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8 sm:h-10 sm:w-10">
                  <Settings className="h-4 w-4 sm:h-5 sm:w-5" />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-[min(20rem,calc(100vw-1rem))] rounded-2xl border-border/60 bg-popover/95 p-3 shadow-2xl backdrop-blur-xl sm:w-72 sm:p-4">
                <h4 className="mb-3 text-sm font-semibold sm:mb-4 sm:text-base">Okuyucu Ayarları</h4>
                <div className="flex flex-col gap-3 sm:gap-4">
                  <div className="flex items-center justify-between">
                    <Label className="text-sm">Okuma Modu</Label>
                    <div className="flex gap-1">
                      <Button
                        variant={settings.mode === 'vertical' ? 'default' : 'ghost'}
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => onSettingsChange({ ...settings, mode: 'vertical' })}
                      >
                        <Rows className="h-4 w-4" />
                      </Button>
                      <Button
                        variant={settings.mode === 'horizontal' ? 'default' : 'ghost'}
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => onSettingsChange({ ...settings, mode: 'horizontal' })}
                      >
                        <Columns className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-sm">Zoom (%{settings.zoom || 100})</Label>
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
                    <Label className="text-sm">Genişliğe Sığdır</Label>
                    <Switch
                      checked={settings.fitWidth}
                      onCheckedChange={(checked) => onSettingsChange({ ...settings, fitWidth: checked })}
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <Label className="text-sm">İlerleme Göster</Label>
                    <Switch
                      checked={settings.showProgress}
                      onCheckedChange={(checked) => onSettingsChange({ ...settings, showProgress: checked })}
                    />
                  </div>
                  {isOnline && (
                    <div className="flex items-center justify-between gap-4">
                      <div className="space-y-0.5">
                        <Label className="text-sm">Gizli Mod</Label>
                        <p className="text-[11px] text-muted-foreground">
                          Okuma verileri kaydedilmez.
                        </p>
                      </div>
                      <Switch
                        checked={isIncognito}
                        onCheckedChange={onIncognitoToggle}
                      />
                    </div>
                  )}
                  <div className="flex items-center justify-between gap-4">
                    <div className="space-y-0.5">
                      <Label className="text-sm">Sayfa Yorumlarını Göster</Label>
                      <p className="text-[11px] text-muted-foreground">
                        Mevcut sayfanın yorumlarını kenar boşluklarında gösterir.
                      </p>
                      <p className="text-[11px] text-amber-300/80">
                        Mobil görünüm için uygun değildir.
                      </p>
                    </div>
                    <Switch
                      checked={settings.showPageComments}
                      onCheckedChange={(checked) => onSettingsChange({ ...settings, showPageComments: checked })}
                    />
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <Label className="text-sm">Sonraki Bölümü Önbelleğe Al</Label>
                    <Switch
                      checked={settings.prefetchNextChapter}
                      onCheckedChange={(checked) => onSettingsChange({ ...settings, prefetchNextChapter: checked })}
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
        style={{ paddingBottom: READER_BOTTOM_SAFE_AREA }}
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div
          className="mx-auto flex h-14 w-full max-w-7xl items-center justify-between gap-3 px-2 sm:gap-4 sm:px-4"
        >
          <Button
            variant="ghost"
            disabled={!prevChapter || navigatingChapterId !== null}
            className="h-10 shrink-0 px-2 text-sm sm:px-3"
            onClick={() => {
              if (prevChapter) {
                void handleChapterNavigation(prevChapter);
              }
            }}
          >
            <ChevronLeft className="h-4 w-4" />
            <span className="hidden sm:inline">Önceki</span>
          </Button>

          {settings.showProgress && (
            <div className="flex min-w-0 flex-1 items-center justify-center gap-2 px-1 sm:gap-3 sm:px-4">
              <span className="hidden text-xs font-semibold tabular-nums text-muted-foreground select-none whitespace-nowrap sm:inline">
                {currentPage} / {totalPages}
              </span>

              <div className="relative min-w-0 flex-1 max-w-[500px]">
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

              {isAutoScrollAvailable && (
                <div className="flex shrink-0 items-center gap-1 rounded-full border border-border/70 bg-background/70 px-1 py-1 sm:gap-1.5 sm:px-1.5">
                  <Button
                    variant={isAutoScrolling ? 'default' : 'ghost'}
                    size="icon"
                    className="h-7 w-7 rounded-full"
                    onClick={onAutoScrollToggle}
                    title={isAutoScrolling ? 'Otomatik kaydırmayı duraklat' : 'Otomatik kaydırmayı başlat'}
                  >
                    {isAutoScrolling ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                  </Button>

                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 rounded-full p-0 text-[10px] font-semibold text-muted-foreground hover:text-foreground sm:h-7 sm:w-auto sm:gap-1 sm:px-2"
                        title="Otomatik kaydırma hızı"
                      >
                        <Gauge className="h-3.5 w-3.5" />
                        <span className="hidden sm:inline">{autoScrollSpeed} px/sn</span>
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent align="end" className="w-60">
                      <div className="space-y-4">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-sm font-semibold">Otomatik Kaydırma</p>
                            <p className="text-xs text-muted-foreground">
                              Hızı ayarla, sonra tek tuşla başlat.
                            </p>
                          </div>
                          <Button
                            variant={isAutoScrolling ? 'default' : 'outline'}
                            size="sm"
                            onClick={onAutoScrollToggle}
                          >
                            {isAutoScrolling ? 'Duraklat' : 'Başlat'}
                          </Button>
                        </div>

                        <div className="space-y-2">
                          <div className="flex items-center justify-between text-xs font-medium text-muted-foreground">
                            <Label>Hız</Label>
                            <span>{autoScrollSpeed} px/sn</span>
                          </div>
                          <Slider
                            value={[autoScrollSpeed]}
                            min={10}
                        max={500}
                            step={5}
                            onValueChange={([val]) => onAutoScrollSpeedChange(val)}
                          />
                        </div>
                      </div>
                    </PopoverContent>
                  </Popover>
                </div>
              )}
            </div>
          )}

          <Button
            variant="ghost"
            disabled={!nextChapter || navigatingChapterId !== null}
            className="h-10 shrink-0 px-2 text-sm sm:px-3"
            onClick={() => {
              if (nextChapter) {
                void handleChapterNavigation(nextChapter);
              }
            }}
          >
            <span className="hidden sm:inline">Sonraki</span>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </>
  );
};

export default ReaderControls;
