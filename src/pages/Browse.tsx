import useDocumentTitle from '@/hooks/useDocumentTitle';
import React, { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  BookOpen,
  Check,
  ChevronDown,
  Eye,
  LayoutGrid,
  List,
  Search,
  Shuffle,
  SlidersHorizontal,
  Star,
  X,
} from 'lucide-react';
import Header from '@/components/layout/Header';
import { cn } from '@/lib/utils';
import MangaCard from '@/components/manga/MangaCard';
import OptimizedImage from '@/components/media/OptimizedImage';
import AppPagination from '@/components/ui/AppPagination';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Skeleton } from '@/components/ui/skeleton';
import { allGenres, normalizeGenreName } from '@/lib/mockData';
import { getMangaSummaries, getMangasByMultipleTags } from '@/lib/database';
import { Manga } from '@/lib/types';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import TagFilterPanel from '@/components/tags/TagFilterPanel';
import OfflineRequiredScreen from '@/components/offline/OfflineRequiredScreen';
import { useEffectiveOnlineStatus } from '@/hooks/useEffectiveOnlineStatus';
import { matchesMangaSearch } from '@/lib/searchMatching';
import { useAuth } from '@/contexts/AuthContext';
import { ADULT_MODE_CHANGED_EVENT } from '@/lib/adultModeEvents';
import { getMangaTypeLabel, isAdultMangaType } from '@/lib/mangaType';

type BrowseAudienceCacheKey = 'safe' | 'adult';
type BrowseContentFilter = 'all' | 'safe' | 'adult';
type BrowseTypeFilter = 'all' | 'manga' | 'manhwa' | 'manhua' | 'webtoon' | 'adult';
type BrowseViewMode = 'grid' | 'list';

const browsePageCache: Partial<Record<BrowseAudienceCacheKey, Manga[]>> = {};
let browsePageCacheUserId: string | null | undefined = undefined;
const ADULT_GENRE_EQUIVALENTS = new Set(['Yetişkin', 'Hentai', 'Webtoon Hentai']);

const normalizeBrowseTypeFilter = (value: string | null): BrowseTypeFilter => {
  switch (value) {
    case 'manga':
    case 'manhwa':
    case 'manhua':
    case 'webtoon':
    case 'adult':
      return value;
    case 'hentai':
    case 'webtoon_hentai':
      return 'adult';
    default:
      return 'all';
  }
};

const normalizeBrowseGenresFromParams = (value: string | null): string[] => {
  if (!value) {
    return [];
  }

  return Array.from(new Set(
    value
      .split(',')
      .map((genre) => normalizeGenreName(genre))
      .filter(Boolean),
  ));
};

const mangaMatchesSelectedGenre = (manga: Manga, genre: string) => {
  const normalizedGenres = (manga.genres || []).map((item) => normalizeGenreName(item));

  if (genre === 'Yetişkin') {
    return manga.isAdult === true || normalizedGenres.some((item) => ADULT_GENRE_EQUIVALENTS.has(item));
  }

  return normalizedGenres.includes(genre);
};

const BrowseGridSkeleton: React.FC = () => (
  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
    {Array.from({ length: 12 }).map((_, index) => (
      <div key={`browse-skeleton-${index}`} className="overflow-hidden rounded-lg border border-border/60 bg-card/40">
        <Skeleton className="aspect-[5/7] w-full rounded-none" />
        <div className="space-y-2 p-2.5">
          <Skeleton className="h-4 w-5/6" />
          <Skeleton className="h-3 w-2/3" />
          <div className="grid grid-cols-2 gap-1.5 pt-1">
            <Skeleton className="h-6 w-full rounded-md" />
            <Skeleton className="h-6 w-full rounded-md" />
          </div>
        </div>
      </div>
    ))}
  </div>
);

const Browse: React.FC = () => {
  useDocumentTitle('Keşfet');
  const navigate = useNavigate();
  const { user } = useAuth();
  const { isOnline } = useEffectiveOnlineStatus();
  const [searchParams, setSearchParams] = useSearchParams();
  const isAuthenticatedViewer = Boolean(user?.id);
  const canSeeAdultContent = isAuthenticatedViewer && user?.preferences?.content?.adult_mode === true;
  const browseAudienceKey: BrowseAudienceCacheKey = canSeeAdultContent ? 'adult' : 'safe';

  const [selectedGenres, setSelectedGenres] = useState<string[]>(
    () => normalizeBrowseGenresFromParams(searchParams.get('genre'))
  );
  const [searchQuery, setSearchQuery] = useState(searchParams.get('search') || '');
  const [sortBy, setSortBy] = useState(searchParams.get('sort') || 'popular');
  const [typeFilter, setTypeFilter] = useState<BrowseTypeFilter>(() => normalizeBrowseTypeFilter(searchParams.get('type')));
  const [statusFilter, setStatusFilter] = useState(searchParams.get('status') || 'all');
  const [minChaptersFilter, setMinChaptersFilter] = useState(searchParams.get('minChapters') || 'all');
  const [yearFilter, setYearFilter] = useState(searchParams.get('year') || 'all');
  const [contentFilter, setContentFilter] = useState<BrowseContentFilter>(() => {
    const value = searchParams.get('content');
    return value === 'safe' || value === 'adult' ? value : 'all';
  });
  const [selectedTagSlugs, setSelectedTagSlugs] = useState<string[]>(
    searchParams.get('tags') ? searchParams.get('tags')!.split(',') : []
  );
  const [showFilters, setShowFilters] = useState(
    () => Boolean(
      searchParams.get('tags')
      || searchParams.get('status')
      || searchParams.get('minChapters')
      || searchParams.get('year')
      || (searchParams.get('type') && searchParams.get('type') !== 'all')
    )
  );
  const [viewMode, setViewMode] = useState<BrowseViewMode>('grid');
  const [currentPage, setCurrentPage] = useState(() => {
    const p = parseInt(searchParams.get('page') || '1', 10);
    return isNaN(p) || p < 1 ? 1 : p;
  });
  const [mangas, setMangas] = useState<Manga[]>(() => browsePageCache[browseAudienceKey] ?? []);
  const [tagFilteredMangaIds, setTagFilteredMangaIds] = useState<Set<string> | null>(null);
  const [isLoading, setIsLoading] = useState(() => !browsePageCache[browseAudienceKey]);
  const [isHydratingFullCollection, setIsHydratingFullCollection] = useState(() => !browsePageCache[browseAudienceKey]);
  const deferredSearchQuery = useDeferredValue(searchQuery);

  if (!isOnline) {
    return (
      <OfflineRequiredScreen
        description="Keşfet sayfası internet bağlantısı gerektirir."
        actionHref="/downloads"
        actionLabel="İndirilenlere Git"
      />
    );
  }

  useEffect(() => {
    if (!canSeeAdultContent && contentFilter === 'adult') {
      setContentFilter('all');
    }
  }, [canSeeAdultContent, contentFilter]);

  useEffect(() => {
    if (!canSeeAdultContent && typeFilter === 'adult') {
      setTypeFilter('all');
    }
  }, [canSeeAdultContent, typeFilter]);

  useEffect(() => {
    const nextUserKey = user?.id ?? null;
    if (browsePageCacheUserId !== undefined && browsePageCacheUserId !== nextUserKey) {
      browsePageCache.safe = undefined;
      browsePageCache.adult = undefined;
    }
    browsePageCacheUserId = nextUserKey;
  }, [user?.id]);

  useEffect(() => {
    const handleAdultModeChanged = () => {
      browsePageCache.safe = undefined;
      browsePageCache.adult = undefined;
      setMangas([]);
      setIsLoading(true);
      setIsHydratingFullCollection(true);
    };

    window.addEventListener(ADULT_MODE_CHANGED_EVENT, handleAdultModeChanged);
    return () => {
      window.removeEventListener(ADULT_MODE_CHANGED_EVENT, handleAdultModeChanged);
    };
  }, []);

  useEffect(() => {
    let active = true;

    const fetchMangas = async () => {
      try {
        const nextUserKey = user?.id ?? null;
        if (browsePageCacheUserId !== undefined && browsePageCacheUserId !== nextUserKey) {
          browsePageCache.safe = undefined;
          browsePageCache.adult = undefined;
        }
        browsePageCacheUserId = nextUserKey;

        const memoryCache = browsePageCache[browseAudienceKey];
        if (memoryCache && memoryCache.length > 0) {
          setMangas(memoryCache);
          setIsLoading(false);
          setIsHydratingFullCollection(false);
          return;
        }

        setMangas([]);
        setIsLoading(true);
        setIsHydratingFullCollection(true);

        const data = await getMangaSummaries();
        if (!active) {
          return;
        }

        browsePageCache[browseAudienceKey] = data;
        setMangas(data);
      } finally {
        if (active) {
          setIsLoading(false);
          setIsHydratingFullCollection(false);
        }
      }
    };

    fetchMangas();

    return () => {
      active = false;
    };
  }, [browseAudienceKey]);

  useEffect(() => {
    const loadTagFilteredMangas = async () => {
      if (selectedTagSlugs.length === 0) {
        setTagFilteredMangaIds(null);
        return;
      }
      const results = await getMangasByMultipleTags(selectedTagSlugs);
      setTagFilteredMangaIds(new Set(results.map(m => m.id)));
    };
    loadTagFilteredMangas();
  }, [selectedTagSlugs]);

  useEffect(() => {
    const params: Record<string, string> = {};
    if (searchQuery) params.search = searchQuery;
    if (sortBy !== 'popular') params.sort = sortBy;
    if (typeFilter !== 'all') params.type = typeFilter;
    if (statusFilter !== 'all') params.status = statusFilter;
    if (minChaptersFilter !== 'all') params.minChapters = minChaptersFilter;
    if (yearFilter !== 'all') params.year = yearFilter;
    if (contentFilter !== 'all') params.content = contentFilter;
    if (selectedGenres.length > 0) params.genre = selectedGenres.join(',');
    if (selectedTagSlugs.length > 0) params.tags = selectedTagSlugs.join(',');
    if (currentPage > 1) params.page = String(currentPage);

    setSearchParams(params);
  }, [
    contentFilter,
    searchQuery,
    sortBy,
    typeFilter,
    statusFilter,
    minChaptersFilter,
    yearFilter,
    selectedGenres,
    selectedTagSlugs,
    currentPage,
    setSearchParams,
  ]);

  const availableYears = useMemo(() => {
    const years = new Set<number>();
    for (const manga of mangas) {
      if (typeof manga.releaseYear === 'number' && manga.releaseYear > 1950) {
        years.add(manga.releaseYear);
      }
    }
    return Array.from(years).sort((a, b) => b - a);
  }, [mangas]);

  const filteredManga = useMemo(() => {
    const seenMangaIds = new Set<string>();
    let result = mangas.filter((manga) => {
      if (!manga?.id || seenMangaIds.has(manga.id)) {
        return false;
      }
      seenMangaIds.add(manga.id);
      return true;
    });

    if (deferredSearchQuery) {
      result = result.filter(
        (manga) => matchesMangaSearch(manga, deferredSearchQuery)
      );
    }

    if (typeFilter !== 'all') {
      result = result.filter((manga) => {
        if (typeFilter === 'adult') {
          return manga.isAdult === true || manga.type === 'hentai' || manga.type === 'webtoon_hentai';
        }
        if (manga.type === typeFilter) {
          return true;
        }
        const lowerGenres = (manga.genres || []).map((g) => g.toLowerCase());
        if (typeFilter === 'manga') return lowerGenres.includes('manga');
        if (typeFilter === 'manhwa') return lowerGenres.includes('manhwa');
        if (typeFilter === 'manhua') return lowerGenres.includes('manhua');
        if (typeFilter === 'webtoon') return lowerGenres.includes('webtoon');
        return false;
      });
    }

    if (statusFilter !== 'all') {
      result = result.filter(manga => manga.status === statusFilter);
    }

    if (contentFilter === 'safe') {
      result = result.filter(manga => manga.isAdult !== true);
    } else if (contentFilter === 'adult') {
      result = result.filter(manga => manga.isAdult === true);
    }

    if (minChaptersFilter !== 'all') {
      const minThreshold = Number(minChaptersFilter);
      if (Number.isFinite(minThreshold)) {
        result = result.filter((manga) => {
          const count = typeof manga.chapterCount === 'number' ? manga.chapterCount : manga.chapters?.length || 0;
          return count >= minThreshold;
        });
      }
    }

    if (yearFilter !== 'all') {
      const targetYear = Number(yearFilter);
      if (Number.isFinite(targetYear)) {
        result = result.filter((manga) => manga.releaseYear === targetYear);
      }
    }

    if (selectedGenres.length > 0) {
      result = result.filter((manga) => (
        selectedGenres.every((genre) => mangaMatchesSelectedGenre(manga, genre))
      ));
    }

    if (tagFilteredMangaIds) {
      result = result.filter(manga => tagFilteredMangaIds.has(manga.id));
    }

    switch (sortBy) {
      case 'rating':
        result.sort((a, b) => {
          const ratingA = typeof a.averageRating === 'number'
            ? a.averageRating
            : a.ratings && a.ratings.length > 0
              ? a.ratings.reduce((sum, r) => sum + r.rating, 0) / a.ratings.length
              : 0;
          const ratingB = typeof b.averageRating === 'number'
            ? b.averageRating
            : b.ratings && b.ratings.length > 0
              ? b.ratings.reduce((sum, r) => sum + r.rating, 0) / b.ratings.length
              : 0;
          return ratingB - ratingA;
        });
        break;
      case 'updated':
        result.sort((a, b) => new Date(b.lastUpdated).getTime() - new Date(a.lastUpdated).getTime());
        break;
      case 'created':
        result.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        break;
      case 'views':
        result.sort((a, b) => b.views - a.views);
        break;
      case 'chapters':
        result.sort(
          (a, b) => (
            (typeof b.chapterCount === 'number' ? b.chapterCount : b.chapters.length)
            - (typeof a.chapterCount === 'number' ? a.chapterCount : a.chapters.length)
          )
        );
        break;
      default:
        result.sort((a, b) => b.views - a.views);
    }

    return result;
  }, [
    contentFilter,
    deferredSearchQuery,
    typeFilter,
    statusFilter,
    minChaptersFilter,
    yearFilter,
    selectedGenres,
    selectedTagSlugs,
    tagFilteredMangaIds,
    sortBy,
    mangas,
  ]);

  const typeOptions = useMemo(() => {
    const nextOptions = [
      { value: 'manga', label: getMangaTypeLabel('manga') },
      { value: 'manhwa', label: getMangaTypeLabel('manhwa') },
      { value: 'manhua', label: getMangaTypeLabel('manhua') },
      { value: 'webtoon', label: getMangaTypeLabel('webtoon') },
      ...(canSeeAdultContent ? [{ value: 'adult', label: 'Yetişkin' }] : []),
    ];

    const seenLabels = new Set<string>();
    return nextOptions.filter((option) => {
      if (seenLabels.has(option.label)) {
        return false;
      }

      seenLabels.add(option.label);
      return true;
    });
  }, [canSeeAdultContent]);

  const toggleGenre = (genre: string) => {
    setSelectedGenres(prev =>
      prev.includes(genre)
        ? prev.filter(g => g !== genre)
        : [...prev, genre]
    );
    setCurrentPage(1);
  };

  const clearFilters = () => {
    setSearchQuery('');
    setSelectedGenres([]);
    setSelectedTagSlugs([]);
    setTypeFilter('all');
    setStatusFilter('all');
    setMinChaptersFilter('all');
    setYearFilter('all');
    setContentFilter('all');
    setSortBy('popular');
    setCurrentPage(1);
    setSearchParams({});
  };

  const handleRandomSeries = () => {
    const pool = filteredManga.length > 0 ? filteredManga : mangas;
    if (pool.length === 0) return;
    const picked = pool[Math.floor(Math.random() * pool.length)];
    if (picked?.id) {
      navigate(`/manga/${picked.id}`);
    }
  };

  const advancedFilterCount =
    (typeFilter !== 'all' ? 1 : 0)
    + (statusFilter !== 'all' ? 1 : 0)
    + (minChaptersFilter !== 'all' ? 1 : 0)
    + (yearFilter !== 'all' ? 1 : 0)
    + selectedTagSlugs.length;

  const hasActiveFilters = Boolean(
    searchQuery
    || selectedGenres.length > 0
    || advancedFilterCount > 0
    || contentFilter !== 'all'
    || sortBy !== 'popular'
  );
  const isInitialResultsPending = isLoading && mangas.length === 0;

  const BROWSE_PAGE_SIZE = 36;
  const totalPages = Math.max(1, Math.ceil(filteredManga.length / BROWSE_PAGE_SIZE));

  useEffect(() => {
    if (currentPage > totalPages && totalPages > 0) {
      setCurrentPage(1);
    }
  }, [currentPage, totalPages]);

  const paginatedManga = useMemo(() => {
    const start = (currentPage - 1) * BROWSE_PAGE_SIZE;
    return filteredManga.slice(start, start + BROWSE_PAGE_SIZE);
  }, [filteredManga, currentPage]);

  const resultsLabel = isInitialResultsPending
    ? 'Seriler hazırlanıyor...'
    : isHydratingFullCollection
      ? `${filteredManga.length} seri gösteriliyor, tam liste yükleniyor...`
      : totalPages > 1
        ? `${filteredManga.length} sonuç • Sayfa ${currentPage} / ${totalPages}`
        : `${filteredManga.length} sonuç`;

  const formatViews = (views: number) => {
    if (views >= 1_000_000) return `${(views / 1_000_000).toFixed(1)}M`;
    if (views >= 1_000) return `${Math.round(views / 1_000)}K`;
    return String(views || 0);
  };

  return (
    <div className="min-h-screen bg-background">
      <Header />

      <main className="container mx-auto max-w-7xl px-4 pb-12 pt-20">
        {/* Compact Header */}
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-baseline gap-2.5 min-w-0">
            <h1 className="text-xl font-bold tracking-tight sm:text-2xl">Keşfet</h1>
            <span className="text-xs text-muted-foreground tabular-nums">{resultsLabel}</span>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleRandomSeries}
              disabled={mangas.length === 0}
              className="h-8 gap-1.5 text-xs bg-card/60"
            >
              <Shuffle className="h-3.5 w-3.5" />
              <span>Şanslı</span>
            </Button>

            <div className="inline-flex items-center rounded-lg border border-border/60 bg-card/60 p-0.5">
              <button
                type="button"
                onClick={() => setViewMode('grid')}
                aria-label="Izgara görünümü"
                aria-pressed={viewMode === 'grid'}
                className={cn(
                  'inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors',
                  viewMode === 'grid'
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <LayoutGrid className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setViewMode('list')}
                aria-label="Liste görünümü"
                aria-pressed={viewMode === 'list'}
                className={cn(
                  'inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors',
                  viewMode === 'list'
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <List className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>

        {/* Sleek Search & Filter Card */}
        <div className="mb-5 rounded-xl border border-border/60 bg-card/65 p-3 space-y-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="h-3.5 w-3.5 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <Input
                type="search"
                placeholder="Seri, yazar veya alternatif isim ara..."
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setCurrentPage(1);
                }}
                className="w-full h-9 pl-8 text-sm bg-background/70"
              />
            </div>

            <div className="w-[150px] shrink-0">
              <Select
                value={sortBy}
                onValueChange={(value) => {
                  setSortBy(value);
                  setCurrentPage(1);
                }}
              >
                <SelectTrigger className="w-full h-9 text-xs sm:text-sm bg-background/70" aria-label="Sıralama">
                  <SelectValue placeholder="Sırala" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="popular">Popüler</SelectItem>
                  <SelectItem value="rating">Puan</SelectItem>
                  <SelectItem value="created">Yeni Eklenen</SelectItem>
                  <SelectItem value="updated">Son Güncellenen</SelectItem>
                  <SelectItem value="views">Görüntülenme</SelectItem>
                  <SelectItem value="chapters">Bölüm Sayısı</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {canSeeAdultContent && (
              <div className="w-[140px] shrink-0">
                <Select
                  value={contentFilter}
                  onValueChange={(value) => {
                    setContentFilter(value as BrowseContentFilter);
                    setCurrentPage(1);
                  }}
                >
                  <SelectTrigger
                    aria-label="İçerik filtresi"
                    className={cn(
                      'w-full h-9 text-xs sm:text-sm bg-background/70',
                      contentFilter === 'adult' && 'border-rose-500/40 bg-rose-500/10 text-rose-500',
                    )}
                  >
                    <SelectValue placeholder="İçerik" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Tümü</SelectItem>
                    <SelectItem value="safe">Normal</SelectItem>
                    <SelectItem value="adult">Yetişkin 18+</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Multi-Column Genres Popover */}
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant={selectedGenres.length > 0 ? 'default' : 'outline'}
                  size="sm"
                  className="h-9 gap-1.5 text-xs bg-background/70 shrink-0"
                >
                  <span>Kategoriler</span>
                  {selectedGenres.length > 0 && (
                    <span className="rounded-full bg-background/20 px-1.5 py-0 text-[10px] font-bold">
                      {selectedGenres.length}
                    </span>
                  )}
                  <ChevronDown className="h-3.5 w-3.5 opacity-70" />
                </Button>
              </PopoverTrigger>
              <PopoverContent
                align="end"
                className="w-[300px] sm:w-[440px] p-3 overscroll-contain"
              >
                <div className="mb-2 flex items-center justify-between border-b border-border/60 pb-2">
                  <span className="text-xs font-semibold text-foreground">
                    Kategoriler ({selectedGenres.length} seçili)
                  </span>
                  {selectedGenres.length > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedGenres([]);
                        setCurrentPage(1);
                      }}
                      className="text-[11px] font-medium text-primary hover:underline"
                    >
                      Temizle
                    </button>
                  )}
                </div>
                <div className="grid max-h-64 grid-cols-2 gap-1 overflow-y-auto overscroll-contain pr-1 sm:grid-cols-3">
                  {allGenres.map((genre) => {
                    const isSelected = selectedGenres.includes(genre);
                    return (
                      <button
                        key={genre}
                        type="button"
                        onClick={() => toggleGenre(genre)}
                        className={cn(
                          'flex items-center justify-between gap-1.5 rounded-md px-2 py-1.5 text-left text-xs transition-colors',
                          isSelected
                            ? 'bg-primary/15 text-primary font-semibold'
                            : 'text-muted-foreground hover:bg-secondary/70 hover:text-foreground',
                        )}
                      >
                        <span className="truncate">{genre}</span>
                        {isSelected && <Check className="h-3 w-3 shrink-0" />}
                      </button>
                    );
                  })}
                </div>
              </PopoverContent>
            </Popover>

            <Button
              type="button"
              variant={showFilters || advancedFilterCount > 0 ? 'secondary' : 'outline'}
              size="sm"
              onClick={() => setShowFilters((prev) => !prev)}
              className="h-9 gap-1.5 text-xs shrink-0"
            >
              <SlidersHorizontal className="h-3.5 w-3.5" />
              <span>Gelişmiş</span>
              {advancedFilterCount > 0 && (
                <span className="rounded-full bg-primary text-primary-foreground px-1.5 py-0 text-[10px] font-bold">
                  {advancedFilterCount}
                </span>
              )}
            </Button>

            {hasActiveFilters && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={clearFilters}
                className="h-9 px-2.5 text-xs text-muted-foreground hover:text-foreground gap-1 shrink-0"
              >
                <X className="h-3.5 w-3.5" />
                <span>Sıfırla</span>
              </Button>
            )}
          </div>

          {/* Selected Genre Pills */}
          {selectedGenres.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
              {selectedGenres.map((genre) => (
                <button
                  key={genre}
                  type="button"
                  onClick={() => toggleGenre(genre)}
                  className="inline-flex items-center gap-1 rounded-md border border-primary/35 bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary hover:bg-primary/20 transition-colors"
                >
                  <span>{genre}</span>
                  <X className="h-3 w-3" />
                </button>
              ))}
            </div>
          )}

          {/* Collapsible Advanced Filters */}
          {showFilters && (
            <div className="border-t border-border/60 pt-3 space-y-3">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <Select
                  value={typeFilter}
                  onValueChange={(value) => {
                    setTypeFilter(normalizeBrowseTypeFilter(value));
                    setCurrentPage(1);
                  }}
                >
                  <SelectTrigger className="h-8 text-xs bg-background/70" aria-label="Format">
                    <SelectValue placeholder="Format" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Tüm Formatlar</SelectItem>
                    {typeOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Select
                  value={statusFilter}
                  onValueChange={(value) => {
                    setStatusFilter(value);
                    setCurrentPage(1);
                  }}
                >
                  <SelectTrigger className="h-8 text-xs bg-background/70" aria-label="Durum">
                    <SelectValue placeholder="Durum" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Tüm Durumlar</SelectItem>
                    <SelectItem value="ongoing">Devam Ediyor</SelectItem>
                    <SelectItem value="completed">Tamamlandı</SelectItem>
                    <SelectItem value="hiatus">Ara Verildi</SelectItem>
                  </SelectContent>
                </Select>

                <Select
                  value={minChaptersFilter}
                  onValueChange={(value) => {
                    setMinChaptersFilter(value);
                    setCurrentPage(1);
                  }}
                >
                  <SelectTrigger className="h-8 text-xs bg-background/70" aria-label="Bölüm sayısı">
                    <SelectValue placeholder="Bölüm sayısı" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Bölüm: Tümü</SelectItem>
                    <SelectItem value="10">10+ Bölüm</SelectItem>
                    <SelectItem value="30">30+ Bölüm</SelectItem>
                    <SelectItem value="50">50+ Bölüm</SelectItem>
                    <SelectItem value="100">100+ Bölüm</SelectItem>
                  </SelectContent>
                </Select>

                {availableYears.length > 0 && (
                  <Select
                    value={yearFilter}
                    onValueChange={(value) => {
                      setYearFilter(value);
                      setCurrentPage(1);
                    }}
                  >
                    <SelectTrigger className="h-8 text-xs bg-background/70" aria-label="Yıl">
                      <SelectValue placeholder="Yıl" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Yıl: Tümü</SelectItem>
                      {availableYears.map((yr) => (
                        <SelectItem key={yr} value={String(yr)}>
                          {yr}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>

              <TagFilterPanel
                selectedTags={selectedTagSlugs}
                onSelectedTagsChange={(tags) => {
                  setSelectedTagSlugs(tags);
                  setCurrentPage(1);
                }}
              />
            </div>
          )}
        </div>

        {/* Manga Catalog */}
        {isInitialResultsPending ? (
          <BrowseGridSkeleton />
        ) : filteredManga.length === 0 ? (
          <div className="rounded-xl border border-border/60 bg-card/40 py-14 text-center space-y-3">
            <p className="text-sm text-muted-foreground">Arama kriterlerinize uygun seri bulunamadı.</p>
            {hasActiveFilters && (
              <Button variant="outline" size="sm" onClick={clearFilters}>
                Filtreleri Sıfırla
              </Button>
            )}
          </div>
        ) : (
          <div className="space-y-6">
            {viewMode === 'grid' ? (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
                {paginatedManga.map((item, idx) => (
                  <MangaCard
                    key={item.id}
                    manga={item}
                    index={idx}
                    enableEntryAnimation
                    entryAnimationClassName="animate-card-reveal-fast"
                    entryAnimationDelayStepMs={8}
                    entryAnimationDurationMs={160}
                  />
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {paginatedManga.map((item) => {
                  const showAdultLabel = item.isAdult === true || isAdultMangaType(item.type);
                  const typeLabel = showAdultLabel ? 'Yetişkin' : getMangaTypeLabel(item.type);
                  const chapterTotal = typeof item.chapterCount === 'number'
                    ? item.chapterCount
                    : item.chapters?.length || 0;
                  const statusLabel = item.status === 'completed'
                    ? 'Tamamlandı'
                    : item.status === 'ongoing'
                      ? 'Devam Ediyor'
                      : 'Ara';

                  return (
                    <Link
                      key={item.id}
                      to={`/manga/${item.id}`}
                      className="group flex gap-3 rounded-xl border border-border/60 bg-card/65 p-2.5 transition-colors hover:border-primary/45 hover:bg-card/90 min-w-0"
                    >
                      <div className="w-20 sm:w-24 shrink-0 overflow-hidden rounded-lg border border-border/50 bg-muted aspect-[5/7]">
                        <OptimizedImage
                          src={item.cover}
                          alt={item.title}
                          width={180}
                          height={252}
                          transform={{ width: 240, quality: 75, format: 'webp', fit: 'cover' }}
                          containerClassName="h-full w-full"
                          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                        />
                      </div>

                      <div className="flex flex-1 flex-col justify-between gap-1.5 min-w-0 py-0.5">
                        <div className="space-y-1 min-w-0">
                          <div className="flex items-start justify-between gap-2 min-w-0">
                            <h3 className="text-sm sm:text-base font-bold text-foreground group-hover:text-primary transition-colors line-clamp-1">
                              {item.title}
                            </h3>
                            <span className="shrink-0 rounded bg-secondary px-1.5 py-0.5 text-[10px] font-semibold text-secondary-foreground">
                              {typeLabel}
                            </span>
                          </div>

                          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] text-muted-foreground">
                            <span className="inline-flex items-center gap-1 font-medium text-amber-400">
                              <Star className="h-3 w-3 fill-current" />
                              {Number(item.averageRating || 0).toFixed(1)}
                            </span>
                            <span className="inline-flex items-center gap-1 tabular-nums">
                              <BookOpen className="h-3 w-3" />
                              {chapterTotal} bölüm
                            </span>
                            <span className="inline-flex items-center gap-1 tabular-nums">
                              <Eye className="h-3 w-3" />
                              {formatViews(item.views || 0)}
                            </span>
                            <span className="text-foreground/75">{statusLabel}</span>
                          </div>

                          {item.description && (
                            <p className="text-xs text-muted-foreground line-clamp-2 break-words">
                              {item.description}
                            </p>
                          )}
                        </div>

                        {item.genres && item.genres.length > 0 && (
                          <div className="flex flex-wrap gap-1 pt-0.5">
                            {Array.from(new Set(item.genres)).slice(0, 4).map((genre) => (
                              <Badge
                                key={genre}
                                variant="secondary"
                                className="px-1.5 py-0 text-[10px] font-medium"
                              >
                                {genre}
                              </Badge>
                            ))}
                          </div>
                        )}
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}

            <AppPagination
              currentPage={currentPage}
              totalPages={totalPages}
              onPageChange={setCurrentPage}
            />
          </div>
        )}
      </main>
    </div>
  );
};

export default Browse;
