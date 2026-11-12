import React, { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
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
  Languages,
  ArrowDown,
  ArrowUp,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ReaderSettings, Chapter, ResolvedReaderPage } from '@/lib/types';
import {
  formatChapterDisplayTitle,
  formatChapterNumberLabel,
  sanitizeChapterTitle,
  isChapterRaw,
} from '@/lib/chapterTitle';
import {
  getChapterLanguageInfo,
  getLanguageInfoByCode,
  resolveChapterLanguageCode,
} from '@/lib/seriesLanguage';
import { Input } from '@/components/ui/input';
import { LanguageFlag } from '@/components/ui/LanguageFlag';
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
import TranslationPanel from '@/components/reader/TranslationPanel';
import { ReaderTranslationApi } from '@/hooks/useChapterTranslation';

const READER_TOP_SAFE_AREA = 'calc(env(safe-area-inset-top) + 0px)';
const READER_BOTTOM_SAFE_AREA = 'calc(env(safe-area-inset-bottom) + 0px)';

interface ReaderControlsProps {
  mangaId: string;
  mangaTitle: string;
  currentChapter: Chapter;
  chapters: Chapter[];
  pages: ResolvedReaderPage[];
  settings: ReaderSettings;
  onSettingsChange: (settings: ReaderSettings) => void;
  onAddBookmark: () => void;
  currentPage: number;
  totalPages: number;
  progressPercent?: number;
  pageOffsetRatio?: number;
  visible: boolean;
  onPageChange?: (page: number, smooth?: boolean) => void;
  onPercentChange?: (percent: number, smooth?: boolean) => void;
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
  translation: ReaderTranslationApi;
  onQueueOfflineChapter?: () => Promise<void>;
}

const normalizeChapterSearchValue = (value?: string | null) =>
  value?.trim().toLocaleLowerCase('tr-TR') || '';

const ReaderControls: React.FC<ReaderControlsProps> = ({
  mangaId,
  mangaTitle,
  currentChapter,
  chapters,
  pages,
  settings,
  onSettingsChange,
  onAddBookmark,
  currentPage,
  totalPages,
  progressPercent: externalProgressPercent,
  visible,
  onPageChange,
  onPercentChange,
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
  translation,
  onQueueOfflineChapter,
}) => {
  const navigate = useNavigate();
  const { isMobile } = useDeviceProfile();

  const fallbackLangCode = useMemo(() => {
    for (const ch of chapters) {
      if (ch.language && ch.language.trim()) {
        return ch.language.trim().toLowerCase();
      }
    }
    return 'tr';
  }, [chapters]);

  const currentLangCode = useMemo(
    () => resolveChapterLanguageCode(currentChapter, fallbackLangCode),
    [currentChapter, fallbackLangCode],
  );

  const chapterVariantsByNumber = useMemo(() => {
    const map = new Map<number, Chapter[]>();
    for (const ch of chapters) {
      const num = typeof ch.number === 'number' ? ch.number : parseFloat(String(ch.number)) || 0;
      const lang = resolveChapterLanguageCode(ch, fallbackLangCode);
      const list = map.get(num) || [];
      const existingIdx = list.findIndex(
        (item) => resolveChapterLanguageCode(item, fallbackLangCode) === lang,
      );
      if (existingIdx === -1) {
        list.push(ch);
      } else {
        const existing = list[existingIdx];
        const existingPages = existing.pageCount || existing.pages?.length || 0;
        const candidatePages = ch.pageCount || ch.pages?.length || 0;
        if (candidatePages > existingPages) {
          list[existingIdx] = ch;
        }
      }
      map.set(num, list);
    }

    for (const [num, list] of map.entries()) {
      list.sort((a, b) => {
        const langA = resolveChapterLanguageCode(a, fallbackLangCode);
        const langB = resolveChapterLanguageCode(b, fallbackLangCode);
        if (langA === 'tr' && langB !== 'tr') return -1;
        if (langB === 'tr' && langA !== 'tr') return 1;
        if (langA === 'en' && langB !== 'en') return -1;
        if (langB === 'en' && langA !== 'en') return 1;
        return langA.localeCompare(langB);
      });
      map.set(num, list);
    }

    return map;
  }, [chapters, fallbackLangCode]);

  const uniqueChapterCount = useMemo(
    () => chapterVariantsByNumber.size || chapters.length,
    [chapterVariantsByNumber.size, chapters.length],
  );

  const sameLanguageChapters = useMemo(() => {
    const filtered = chapters.filter(
      (ch) => resolveChapterLanguageCode(ch, fallbackLangCode) === currentLangCode,
    );
    return filtered.length > 0 ? filtered : chapters;
  }, [chapters, currentLangCode, fallbackLangCode]);

  const currentIndex = sameLanguageChapters.findIndex((ch) => ch.id === currentChapter.id);
  const prevChapter = currentIndex >= 0 ? sameLanguageChapters[currentIndex + 1] : undefined;
  const nextChapter = currentIndex > 0 ? sameLanguageChapters[currentIndex - 1] : undefined;

  const [hoverPage, setHoverPage] = useState<number | null>(null);
  const [hoverPercent, setHoverPercent] = useState<number | null>(null);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [scrubPage, setScrubPage] = useState<number | null>(null);
  const [scrubPercent, setScrubPercent] = useState<number | null>(null);
  const scrubRafRef = useRef<number | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [navigatingChapterId, setNavigatingChapterId] = useState<string | null>(null);
  const [chapterSearch, setChapterSearch] = useState('');
  const [chapterSortOrder, setChapterSortOrder] = useState<'desc' | 'asc'>('desc');
  const [selectedReaderLang, setSelectedReaderLang] = useState<string>('all');
  const [chapterPanelOpen, setChapterPanelOpen] = useState(false);
  const [translationPanelOpen, setTranslationPanelOpen] = useState(false);
  const activeChapterItemRef = useRef<HTMLButtonElement | null>(null);

  const availableReaderLanguages = useMemo(() => {
    const counts = new Map<string, number>();
    for (const variants of chapterVariantsByNumber.values()) {
      for (const ch of variants) {
        const code = resolveChapterLanguageCode(ch, fallbackLangCode);
        counts.set(code, (counts.get(code) || 0) + 1);
      }
    }
    return Array.from(counts.entries())
      .map(([code, count]) => ({
        code,
        count,
        info: getLanguageInfoByCode(code),
      }))
      .sort((a, b) => {
        if (a.code === 'tr' && b.code !== 'tr') return -1;
        if (b.code === 'tr' && a.code !== 'tr') return 1;
        if (a.code === 'en' && b.code !== 'en') return -1;
        if (b.code === 'en' && a.code !== 'en') return 1;
        return b.count - a.count;
      });
  }, [chapterVariantsByNumber, fallbackLangCode]);

  const seriesRouteKey = buildRouteKey(`/manga/${mangaId}`);
  const deferredChapterSearch = useDeferredValue(normalizeChapterSearchValue(chapterSearch));

  const activePageDisplay = isScrubbing && scrubPage !== null ? scrubPage : currentPage;
  const fallbackProgressPercent = totalPages > 1 ? ((activePageDisplay - 1) / (totalPages - 1)) * 100 : 0;
  const baseProgressPercent = typeof externalProgressPercent === 'number'
    ? Math.max(0, Math.min(100, externalProgressPercent))
    : fallbackProgressPercent;
  const progressPercent = isScrubbing && scrubPercent !== null ? scrubPercent : baseProgressPercent;
  const chapterItems = useMemo(() => {
    const sortedNumbers = Array.from(chapterVariantsByNumber.keys()).sort((a, b) =>
      chapterSortOrder === 'desc' ? b - a : a - b,
    );
    const items: Chapter[] = [];
    for (const num of sortedNumbers) {
      const variants = chapterVariantsByNumber.get(num) || [];
      if (variants.length === 0) continue;
      if (selectedReaderLang !== 'all') {
        const match = variants.find(
          (ch) => resolveChapterLanguageCode(ch, fallbackLangCode) === selectedReaderLang,
        );
        if (match) items.push(match);
      } else {
        const matchCurrentLang = variants.find(
          (ch) => resolveChapterLanguageCode(ch, fallbackLangCode) === currentLangCode,
        );
        items.push(matchCurrentLang || variants[0]);
      }
    }
    return items;
  }, [chapterVariantsByNumber, chapterSortOrder, selectedReaderLang, fallbackLangCode, currentLangCode]);
  const filteredChapters = useMemo(() => {
    if (!deferredChapterSearch) {
      return chapterItems;
    }

    return chapterItems.filter((chapterItem) => {
      const searchTarget = normalizeChapterSearchValue(
        `${chapterItem.number} ${chapterItem.title || ''} ${formatChapterDisplayTitle(chapterItem.number, chapterItem.title)}`,
      );
      return searchTarget.includes(deferredChapterSearch);
    });
  }, [chapterItems, deferredChapterSearch]);

  useEffect(() => {
    if (!chapterPanelOpen) return;
    const frameId = window.requestAnimationFrame(() => {
      activeChapterItemRef.current?.scrollIntoView({ block: 'nearest' });
    });
    return () => window.cancelAnimationFrame(frameId);
  }, [chapterPanelOpen]);

  const getScrubTargetFromClientX = useCallback(
    (clientX: number, target: HTMLDivElement): { percent: number; page: number } => {
      const rect = target.getBoundingClientRect();
      const x = clientX - rect.left;
      const ratio = Math.max(0, Math.min(1, x / Math.max(1, rect.width)));
      const percent = Number((ratio * 100).toFixed(2));
      const safeTotal = Math.max(1, totalPages);
      const exactPageFloat = ratio * safeTotal;
      const page = ratio >= 0.999
        ? safeTotal
        : Math.max(1, Math.min(safeTotal, Math.floor(exactPageFloat) + 1));
      return { percent, page };
    },
    [totalPages],
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.stopPropagation();
      e.currentTarget.setPointerCapture(e.pointerId);
      const { percent, page } = getScrubTargetFromClientX(e.clientX, e.currentTarget);
      setIsScrubbing(true);
      setScrubPage(page);
      setScrubPercent(percent);
      if (onPercentChange) {
        onPercentChange(percent, false);
      } else {
        onPageChange?.(page, false);
      }
    },
    [getScrubTargetFromClientX, onPageChange, onPercentChange],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!isScrubbing) {
        if (e.pointerType === 'mouse') {
          const { percent, page } = getScrubTargetFromClientX(e.clientX, e.currentTarget);
          setHoverPage(page);
          setHoverPercent(percent);
        }
        return;
      }
      e.stopPropagation();
      const { percent, page } = getScrubTargetFromClientX(e.clientX, e.currentTarget);
      setScrubPage(page);
      setScrubPercent(percent);
      if (scrubRafRef.current !== null) {
        cancelAnimationFrame(scrubRafRef.current);
      }
      scrubRafRef.current = requestAnimationFrame(() => {
        if (onPercentChange) {
          onPercentChange(percent, false);
        } else {
          onPageChange?.(page, false);
        }
      });
    },
    [getScrubTargetFromClientX, isScrubbing, onPageChange, onPercentChange],
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (isScrubbing) {
        e.stopPropagation();
        try {
          e.currentTarget.releasePointerCapture(e.pointerId);
        } catch {
          // Yoksay
        }
        const { percent, page } = getScrubTargetFromClientX(e.clientX, e.currentTarget);
        if (scrubRafRef.current !== null) {
          cancelAnimationFrame(scrubRafRef.current);
          scrubRafRef.current = null;
        }
        if (onPercentChange) {
          onPercentChange(percent, false);
        } else {
          onPageChange?.(page, false);
        }
        setIsScrubbing(false);
        setScrubPage(null);
        setScrubPercent(null);
        setHoverPage(null);
        setHoverPercent(null);
      }
    },
    [getScrubTargetFromClientX, isScrubbing, onPageChange, onPercentChange],
  );

  const handlePointerCancel = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (isScrubbing) {
        try {
          e.currentTarget.releasePointerCapture(e.pointerId);
        } catch {
          // Yoksay
        }
        if (scrubRafRef.current !== null) {
          cancelAnimationFrame(scrubRafRef.current);
          scrubRafRef.current = null;
        }
        setIsScrubbing(false);
        setScrubPage(null);
        setScrubPercent(null);
        setHoverPage(null);
        setHoverPercent(null);
      }
    },
    [isScrubbing],
  );

  const handleBarLeave = useCallback(() => {
    if (!isScrubbing) {
      setHoverPage(null);
      setHoverPercent(null);
    }
  }, [isScrubbing]);

  const handleChapterNavigation = useCallback(
    async (chapter?: Chapter) => {
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
    },
    [forceOfflineRead, mangaId, navigate, navigatingChapterId, onBeforeChapterChange],
  );

  const handleSeriesPageNavigation = useCallback(() => {
    markRouteToForceTopOnNextVisit(seriesRouteKey);
  }, [seriesRouteKey]);

  const chapterPanelContent = (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h4 className="text-sm font-semibold tracking-tight text-foreground sm:text-base">
            Bölümler
          </h4>
          <span className="rounded-md bg-secondary/80 px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-muted-foreground">
            {filteredChapters.length}
          </span>
          {isOfflineChapter && (
            <span className="rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
              Çevrimdışı
            </span>
          )}
        </div>
        <div className="flex items-center rounded-lg border border-border/70 bg-secondary/40 p-0.5 text-[11px]">
          <button
            type="button"
            onClick={() => setChapterSortOrder('desc')}
            className={cn(
              'flex items-center gap-1 rounded-md px-2 py-1 font-medium transition-colors',
              chapterSortOrder === 'desc'
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <ArrowDown className="h-3 w-3" />
            Son Eklenen
          </button>
          <button
            type="button"
            onClick={() => setChapterSortOrder('asc')}
            className={cn(
              'flex items-center gap-1 rounded-md px-2 py-1 font-medium transition-colors',
              chapterSortOrder === 'asc'
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <ArrowUp className="h-3 w-3" />
            İlk Eklenen
          </button>
        </div>
      </div>

      {availableReaderLanguages.length > 1 && (
        <div className="flex flex-wrap items-center gap-1 rounded-xl border border-border/70 bg-secondary/40 p-1 text-[11px]">
          <button
            type="button"
            onClick={() => setSelectedReaderLang('all')}
            className={cn(
              'rounded-lg px-2 py-1 font-medium transition-colors',
              selectedReaderLang === 'all'
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            Tümü ({uniqueChapterCount})
          </button>
          {availableReaderLanguages.map((entry) => (
            <button
              key={entry.code}
              type="button"
              onClick={() => setSelectedReaderLang(entry.code)}
              className={cn(
                'rounded-lg px-2 py-1 font-medium transition-colors',
                selectedReaderLang === entry.code
                  ? entry.code === 'tr'
                    ? 'bg-emerald-600 text-white shadow-sm'
                    : entry.code === 'en'
                    ? 'bg-sky-600 text-white shadow-sm'
                    : 'bg-primary text-primary-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <span className="inline-flex items-center gap-1.5">
                <LanguageFlag code={entry.info.language} label={entry.info.label} className="h-3 w-4" />
                <span>({entry.count})</span>
              </span>
            </button>
          ))}
        </div>
      )}

      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          id="reader-chapter-search"
          name="chapterSearch"
          type="search"
          value={chapterSearch}
          onChange={(event) => setChapterSearch(event.target.value)}
          placeholder="Bölüm ara..."
          aria-label="Bölüm ara"
          className="h-9 rounded-xl border-border bg-secondary/40 pl-9 text-sm text-foreground placeholder:text-muted-foreground/70 focus-visible:border-primary/50 focus-visible:bg-secondary/70 focus-visible:ring-1 focus-visible:ring-primary/30 focus-visible:ring-offset-0"
        />
      </div>

      <div
        className={cn(
          'reader-scroll-thin overflow-y-auto pr-1 space-y-1.5',
          isMobile ? 'max-h-[min(56svh,24rem)]' : 'max-h-[min(58vh,26rem)]',
        )}
      >
        {filteredChapters.map((ch) => {
          const numKey = typeof ch.number === 'number' ? ch.number : parseFloat(String(ch.number)) || 0;
          const variants = chapterVariantsByNumber.get(numKey) || [ch];
          const isCurrentChapter = variants.some((v) => v.id === currentChapter.id);
          const chapterLabel = `Bölüm ${formatChapterNumberLabel(ch.number)}`;
          const rawSubtitle = sanitizeChapterTitle(ch.number, ch.title);
          const cleanSubtitle =
            rawSubtitle &&
            rawSubtitle.trim().toLocaleLowerCase('tr-TR') !== chapterLabel.trim().toLocaleLowerCase('tr-TR') &&
            rawSubtitle.trim() !== formatChapterNumberLabel(ch.number)
              ? rawSubtitle.trim()
              : null;

          return (
            <button
              key={ch.id}
              ref={isCurrentChapter ? activeChapterItemRef : undefined}
              type="button"
              onClick={() => void handleChapterNavigation(ch)}
              disabled={navigatingChapterId === ch.id}
              className={cn(
                'group flex w-full items-center justify-between gap-2.5 rounded-xl border px-3.5 py-2.5 text-left transition-all duration-150 focus-visible:border-primary/70 focus-visible:ring-1 focus-visible:ring-primary/40',
                isCurrentChapter
                  ? 'border-primary/60 bg-primary/10 text-primary font-semibold'
                  : 'border-border/50 bg-secondary/30 text-foreground/85 hover:border-border/80 hover:bg-secondary/60 hover:text-foreground',
                navigatingChapterId === ch.id && 'opacity-60 pointer-events-none',
              )}
            >
              <div className="flex min-w-0 flex-1 items-center gap-2.5">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <p
                      className={cn(
                        'truncate text-sm leading-snug',
                        isCurrentChapter ? 'text-primary font-semibold' : 'text-foreground/90 font-medium',
                      )}
                    >
                      {chapterLabel}
                    </p>
                    {variants.map((variant) => {
                      const langInfo = getChapterLanguageInfo(variant, fallbackLangCode);
                      const isActiveVariant = variant.id === currentChapter.id;
                      return (
                        <span
                          key={variant.id}
                          role="button"
                          tabIndex={0}
                          onClick={(e) => {
                            e.stopPropagation();
                            void handleChapterNavigation(variant);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.stopPropagation();
                              void handleChapterNavigation(variant);
                            }
                          }}
                          className={cn(
                            'inline-flex shrink-0 items-center justify-center transition-all hover:scale-105',
                            langInfo.language === 'raw' && cn('rounded border px-1.5 py-0.5 text-[9px] font-black', langInfo.badgeClass),
                            variants.length > 1 && !isActiveVariant && 'opacity-75 hover:opacity-100',
                          )}
                          title={`${langInfo.label} olarak aç`}
                        >
                          <LanguageFlag code={langInfo.language} label={langInfo.label} className="h-3 w-4" />
                        </span>
                      );
                    })}
                  </div>
                  {cleanSubtitle && (
                    <p className="mt-0.5 truncate text-xs text-muted-foreground font-normal">
                      {cleanSubtitle}
                    </p>
                  )}
                </div>
              </div>
            </button>
          );
        })}

        {filteredChapters.length === 0 && (
          <div className="rounded-xl border border-dashed border-border/70 px-4 py-6 text-center text-xs text-muted-foreground">
            Eşleşen bölüm bulunamadı.
          </div>
        )}
      </div>
    </div>
  );

  const translationPanelBody = (
    <TranslationPanel
      chapterId={currentChapter.id}
      mangaTitle={mangaTitle}
      chapterNumber={currentChapter.number}
      pages={pages}
      translation={translation}
      isOnline={isOnline}
      isOfflineMode={forceOfflineRead}
      onQueueOfflineChapter={onQueueOfflineChapter}
    />
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
        <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-2 px-2 py-2 sm:h-14 sm:gap-4 sm:px-4 sm:py-0">
          <div className="flex min-w-0 flex-1 items-center gap-1.5 sm:gap-2">
            <Button
              asChild
              variant="ghost"
              size="icon"
              className="h-8 w-8 sm:h-10 sm:w-10"
              aria-label="Ana sayfaya git"
            >
              <Link to="/">
                <Home className="h-4 w-4 sm:h-5 sm:w-5" />
              </Link>
            </Button>
            <Button
              asChild
              variant="ghost"
              size="icon"
              className="h-8 w-8 sm:h-10 sm:w-10"
              aria-label="Seri sayfasına git"
            >
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
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 sm:h-10 sm:w-10"
              onClick={onAddBookmark}
              aria-label="Yer İmlerime Ekle"
            >
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
                  <Button
                    variant="ghost"
                    size="icon"
                    className={cn(
                      'h-8 w-8 sm:h-10 sm:w-10',
                      chapterPanelOpen && 'bg-primary/15 text-primary',
                    )}
                    aria-label="Bölüm listesini aç"
                  >
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
                  className="max-h-[min(74svh,33rem)] rounded-t-[1.75rem] border-t border-border/80 bg-background/95 backdrop-blur-2xl px-0 shadow-2xl pb-[max(0.75rem,env(safe-area-inset-bottom))]"
                >
                  <DrawerHeader className="px-4 pb-1 pt-2 text-left">
                    <DrawerTitle className="sr-only">Bölümler</DrawerTitle>
                    <DrawerDescription className="sr-only">
                      Okumak istediğiniz bölümü seçin.
                    </DrawerDescription>
                  </DrawerHeader>
                  <div className="px-4 pb-2">{chapterPanelContent}</div>
                </DrawerContent>
              </Drawer>
            ) : (
              <Popover open={chapterPanelOpen} onOpenChange={setChapterPanelOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className={cn(
                      'h-8 w-8 sm:h-10 sm:w-10',
                      chapterPanelOpen && 'bg-primary/15 text-primary',
                    )}
                    aria-label="Bölüm listesini aç"
                  >
                    <List className="h-4 w-4 sm:h-5 sm:w-5" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent
                  align="end"
                  onOpenAutoFocus={(event) => event.preventDefault()}
                  className="w-[min(23rem,calc(100vw-1rem))] rounded-2xl border border-border/80 bg-background/95 backdrop-blur-2xl p-3.5 shadow-2xl"
                >
                  {chapterPanelContent}
                </PopoverContent>
              </Popover>
            )}

            {isMobile ? (
              <Drawer
                open={translationPanelOpen}
                onOpenChange={setTranslationPanelOpen}
                modal
                dismissible
                shouldScaleBackground={false}
                autoFocus={false}
              >
                <DrawerTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className={cn(
                      'relative h-8 w-8 sm:h-10 sm:w-10',
                      (translationPanelOpen || translation.summary.isBusy) && 'text-primary',
                    )}
                    aria-label="Görsel çeviri ayarları"
                  >
                    <Languages className="h-4 w-4 sm:h-5 sm:w-5" />
                  </Button>
                </DrawerTrigger>
                <DrawerContent
                  onOpenAutoFocus={(event) => event.preventDefault()}
                  onPointerDownOutside={() => setTranslationPanelOpen(false)}
                  onInteractOutside={() => setTranslationPanelOpen(false)}
                  className="max-h-[min(82svh,38rem)] rounded-t-[1.75rem] border-border/70 bg-popover px-0 shadow-2xl pb-[max(0.75rem,env(safe-area-inset-bottom))]"
                >
                  <DrawerHeader className="px-4 pb-2 pt-2 text-left">
                    <DrawerTitle className="text-base font-semibold">Görsel Çeviri</DrawerTitle>
                    <DrawerDescription className="sr-only">
                      Görsel çeviri, dil ve önbellek ayarları.
                    </DrawerDescription>
                  </DrawerHeader>
                  <div className="reader-scroll-thin overflow-y-auto px-4 pb-3">
                    {translationPanelBody}
                  </div>
                </DrawerContent>
              </Drawer>
            ) : (
              <Popover open={translationPanelOpen} onOpenChange={setTranslationPanelOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className={cn(
                      'relative h-8 w-8 sm:h-10 sm:w-10',
                      translationPanelOpen && 'bg-primary/15 text-primary',
                      !translationPanelOpen && translation.summary.isBusy && 'text-primary',
                    )}
                    aria-label="Görsel çeviri ayarları"
                  >
                    <Languages className="h-4 w-4 sm:h-5 sm:w-5" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent
                  align="end"
                  onOpenAutoFocus={(event) => event.preventDefault()}
                  className="reader-scroll-thin max-h-[min(80vh,38rem)] w-[min(21.5rem,calc(100vw-1rem))] overflow-y-auto rounded-2xl border-border bg-popover p-3 shadow-2xl sm:p-4"
                >
                  <h4 className="mb-3 text-sm font-semibold tracking-tight sm:text-base">
                    Görsel Çeviri
                  </h4>
                  {translationPanelBody}
                </PopoverContent>
              </Popover>
            )}

            <Popover>
              <PopoverTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8 sm:h-10 sm:w-10" aria-label="Okuyucu ayarları">
                  <Settings className="h-4 w-4 sm:h-5 sm:w-5" />
                </Button>
              </PopoverTrigger>
              <PopoverContent
                align="end"
                onOpenAutoFocus={(event) => event.preventDefault()}
                className="w-[min(20rem,calc(100vw-1rem))] rounded-2xl border-border bg-popover p-3 shadow-2xl sm:w-72 sm:p-4"
              >
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
                      <Switch checked={isIncognito} onCheckedChange={onIncognitoToggle} />
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
                      onCheckedChange={(checked) =>
                        onSettingsChange({ ...settings, showPageComments: checked })
                      }
                    />
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <Label className="text-sm">Sonraki Bölümü Önbelleğe Al</Label>
                    <Switch
                      checked={settings.prefetchNextChapter}
                      onCheckedChange={(checked) =>
                        onSettingsChange({ ...settings, prefetchNextChapter: checked })
                      }
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
        <div className="mx-auto flex h-14 w-full max-w-7xl items-center justify-between gap-3 px-2 sm:gap-4 sm:px-4">
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
                {activePageDisplay} / {totalPages}
              </span>

              <div className="relative min-w-0 flex-1 max-w-[500px]">
                {/* Hover / Scrub tooltip */}
                {(hoverPage !== null || isScrubbing) && (
                  <div
                    className="absolute -top-8 z-10 rounded-md bg-popover px-2 py-0.5 text-[11px] font-bold text-popover-foreground shadow-lg border border-border/50 pointer-events-none select-none whitespace-nowrap"
                    style={{
                      left: `${Math.max(4, Math.min(96, isScrubbing ? progressPercent : (hoverPercent ?? progressPercent)))}%`,
                      transform: 'translateX(-50%)',
                    }}
                  >
                    %{(isScrubbing ? progressPercent : (hoverPercent ?? progressPercent)).toFixed(1)} · S.{isScrubbing ? activePageDisplay : hoverPage}
                  </div>
                )}

                {/* Sürüklenebilir ve tıklanabilir iz alanı */}
                <div
                  ref={trackRef}
                  className="relative h-9 flex items-center cursor-pointer group touch-none select-none py-2"
                  onPointerDown={handlePointerDown}
                  onPointerMove={handlePointerMove}
                  onPointerUp={handlePointerUp}
                  onPointerCancel={handlePointerCancel}
                  onPointerLeave={handleBarLeave}
                >
                  {/* Background track */}
                  <div className="absolute inset-x-0 h-[5px] rounded-full bg-white/10 group-hover:h-[7px] transition-all duration-200" />

                  {/* Fill */}
                  <div
                    className={cn(
                      'absolute left-0 h-[5px] rounded-full bg-gradient-to-r from-primary to-blue-400 group-hover:h-[7px] pointer-events-none',
                      isScrubbing ? 'transition-none h-[7px]' : 'transition-all duration-150',
                    )}
                    style={{ width: `${progressPercent}%` }}
                  />

                  {/* Thumb */}
                  <div
                    className={cn(
                      'absolute top-1/2 -translate-y-1/2 rounded-full bg-white border-2 border-primary shadow-[0_0_10px_rgba(59,130,246,0.5)] pointer-events-none -translate-x-1/2',
                      isScrubbing
                        ? 'h-5 w-5 shadow-[0_0_20px_rgba(59,130,246,0.9)] ring-4 ring-primary/35 transition-none'
                        : 'h-3.5 w-3.5 group-hover:h-4 group-hover:w-4 group-hover:shadow-[0_0_16px_rgba(59,130,246,0.7)] transition-all duration-150',
                    )}
                    style={{
                      left: `${progressPercent}%`,
                    }}
                  />
                </div>
              </div>

              <span className="text-[11px] font-semibold tabular-nums text-primary select-none whitespace-nowrap">
                %{progressPercent >= 99.95 ? '100' : progressPercent.toFixed(1)}
              </span>

              {isAutoScrollAvailable && (
                <div className="flex shrink-0 items-center gap-1 rounded-full border border-border/70 bg-background/70 px-1 py-1 sm:gap-1.5 sm:px-1.5">
                  <Button
                    variant={isAutoScrolling ? 'default' : 'ghost'}
                    size="icon"
                    className="h-7 w-7 rounded-full"
                    onClick={onAutoScrollToggle}
                    aria-label={
                      isAutoScrolling
                        ? 'Otomatik kaydırmayı duraklat'
                        : 'Otomatik kaydırmayı başlat'
                    }
                  >
                    {isAutoScrolling ? (
                      <Pause className="h-3.5 w-3.5" />
                    ) : (
                      <Play className="h-3.5 w-3.5" />
                    )}
                  </Button>

                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 rounded-full p-0 text-[10px] font-semibold text-muted-foreground hover:text-foreground sm:h-7 sm:w-auto sm:gap-1 sm:px-2"
                        aria-label="Otomatik kaydırma hızı"
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
