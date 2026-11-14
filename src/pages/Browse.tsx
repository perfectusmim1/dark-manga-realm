import useDocumentTitle from '@/hooks/useDocumentTitle';
import React, { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Filter, Grid2x2, Grid3x3, Search, X } from 'lucide-react';
import Header from '@/components/layout/Header';
import { cn } from '@/lib/utils';
import MangaCard from '@/components/manga/MangaCard';
import AppPagination from '@/components/ui/AppPagination';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
import { getMangaTypeLabel } from '@/lib/mangaType';

type BrowseAudienceCacheKey = 'safe' | 'adult';
type BrowseContentFilter = 'all' | 'safe' | 'adult';
type BrowseTypeFilter = 'all' | 'manga' | 'manhwa' | 'manhua' | 'webtoon' | 'adult';
type BrowseGridDensity = 'compact' | 'comfortable';

const BROWSE_DENSITY_STORAGE_KEY = 'toonparrot_browse_density_v1';
const BROWSE_GRID_CLASSES: Record<BrowseGridDensity, string> = {
  compact: 'grid grid-cols-2 min-[390px]:grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 gap-2.5 sm:gap-3.5',
  comfortable: 'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 sm:gap-4',
};

const readInitialBrowseDensity = (): BrowseGridDensity => {
  if (typeof window === 'undefined') {
    return 'compact';
  }
  try {
    const saved = window.localStorage.getItem(BROWSE_DENSITY_STORAGE_KEY);
    return saved === 'comfortable' ? 'comfortable' : 'compact';
  } catch {
    return 'compact';
  }
};

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

const BrowseGridSkeleton: React.FC<{ gridDensity: BrowseGridDensity }> = ({ gridDensity }) => (
  <div className={BROWSE_GRID_CLASSES[gridDensity]}>
    {Array.from({ length: 14 }).map((_, index) => (
      <div key={`browse-skeleton-${index}`} className="overflow-hidden rounded-xl border border-border/60 bg-card/40">
        <Skeleton className="aspect-[2/3] w-full rounded-none" />
        <div className="space-y-2 p-2">
          <Skeleton className="h-4 w-5/6" />
          <Skeleton className="h-3 w-2/3" />
          <div className="grid grid-cols-2 gap-1.5 pt-1">
            <Skeleton className="h-7 w-full rounded-md" />
            <Skeleton className="h-7 w-full rounded-md" />
          </div>
        </div>
      </div>
    ))}
  </div>
);


const Browse: React.FC = () => {
  useDocumentTitle('Keşfet');
  const { user } = useAuth();
  const { isOnline } = useEffectiveOnlineStatus();
  const [searchParams, setSearchParams] = useSearchParams();
  const isAuthenticatedViewer = Boolean(user?.id);
  const canSeeAdultContent = isAuthenticatedViewer && user?.preferences?.content?.adult_mode === true;
  const browseAudienceKey: BrowseAudienceCacheKey = canSeeAdultContent ? 'adult' : 'safe';
  const [showFilters, setShowFilters] = useState(false);
  const [gridDensity, setGridDensity] = useState<BrowseGridDensity>(readInitialBrowseDensity);
  const [selectedGenres, setSelectedGenres] = useState<string[]>(
    () => normalizeBrowseGenresFromParams(searchParams.get('genre'))
  );
  const [searchQuery, setSearchQuery] = useState(searchParams.get('search') || '');
  const [sortBy, setSortBy] = useState(searchParams.get('sort') || 'popular');
  const [typeFilter, setTypeFilter] = useState<BrowseTypeFilter>(() => normalizeBrowseTypeFilter(searchParams.get('type')));
  const [statusFilter, setStatusFilter] = useState('all');
  const [contentFilter, setContentFilter] = useState<BrowseContentFilter>(() => {
    const value = searchParams.get('content');
    return value === 'safe' || value === 'adult' ? value : 'all';
  });
  const [selectedTagSlugs, setSelectedTagSlugs] = useState<string[]>(
    searchParams.get('tags') ? searchParams.get('tags')!.split(',') : []
  );
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

        // getMangaSummaries, IndexedDB kalıcı önbelleğini kullanır: veri taze ise
        // ağa çıkmadan anında döner; aksi halde normal akış çalışır.
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
    if (contentFilter !== 'all') params.content = contentFilter;
    if (selectedGenres.length > 0) params.genre = selectedGenres.join(',');
    if (selectedTagSlugs.length > 0) params.tags = selectedTagSlugs.join(',');
    if (currentPage > 1) params.page = String(currentPage);

    setSearchParams(params);
  }, [contentFilter, searchQuery, sortBy, typeFilter, selectedGenres, selectedTagSlugs, currentPage, setSearchParams]);

  const filteredManga = useMemo(() => {
    const seenMangaIds = new Set<string>();
    let result = mangas.filter((manga) => {
      if (!manga?.id || seenMangaIds.has(manga.id)) {
        return false;
      }
      seenMangaIds.add(manga.id);
      return true;
    });

    // Search filter
    if (deferredSearchQuery) {
      result = result.filter(
        (manga) => matchesMangaSearch(manga, deferredSearchQuery)
      );
    }

    // Type filter
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

    // Status filter
    if (statusFilter !== 'all') {
      result = result.filter(manga => manga.status === statusFilter);
    }

    if (contentFilter === 'safe') {
      result = result.filter(manga => manga.isAdult !== true);
    } else if (contentFilter === 'adult') {
      result = result.filter(manga => manga.isAdult === true);
    }

    if (selectedGenres.length > 0) {
      result = result.filter((manga) => (
        selectedGenres.every((genre) => mangaMatchesSelectedGenre(manga, genre))
      ));
    }

    if (tagFilteredMangaIds) {
      result = result.filter(manga => tagFilteredMangaIds.has(manga.id));
    }

    // Sort
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
  }, [contentFilter, deferredSearchQuery, typeFilter, statusFilter, selectedGenres, selectedTagSlugs, tagFilteredMangaIds, sortBy, mangas]);

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
    setContentFilter('all');
    setSortBy('popular');
    setCurrentPage(1);
    setSearchParams({});
  };

  const hasActiveFilters = searchQuery || selectedGenres.length > 0 || selectedTagSlugs.length > 0 || typeFilter !== 'all' || statusFilter !== 'all' || contentFilter !== 'all';
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
        ? `${filteredManga.length} sonuç bulundu • Sayfa ${currentPage} / ${totalPages}`
        : `${filteredManga.length} sonuç bulundu`;

  const handleGridDensityChange = (density: BrowseGridDensity) => {
    setGridDensity(density);
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.setItem(BROWSE_DENSITY_STORAGE_KEY, density);
      } catch {
        // ignore storage write errors
      }
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <Header />

      <main className="container pb-12 pt-16">
        <div className="py-6 sm:py-8">
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Keşfet</h1>
        </div>

        {/* Filters Bar */}
        <div className="rounded-2xl border border-border/60 bg-card/50 p-3 sm:p-4 mb-5 space-y-2.5 sm:space-y-3">
          <div className="flex items-center gap-2">
            <div className="relative flex-1 min-w-0">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="search"
                placeholder="Ara..."
                aria-label="Seri ara"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setCurrentPage(1);
                }}
                className="h-9 sm:h-10 w-full pl-9 pr-9 text-sm [&::-webkit-search-cancel-button]:hidden [&::-webkit-search-cancel-button]:appearance-none"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => {
                    setSearchQuery('');
                    setCurrentPage(1);
                  }}
                  aria-label="Aramayı temizle"
                  title="Aramayı temizle"
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            <div
              role="group"
              aria-label="Görünüm yoğunluğu"
              className="inline-flex h-9 sm:h-10 shrink-0 items-center rounded-lg border border-border/60 bg-background/60 p-0.5"
            >
              <button
                type="button"
                onClick={() => handleGridDensityChange('compact')}
                aria-pressed={gridDensity === 'compact'}
                aria-label="Kompakt görünüm"
                title="Kompakt"
                className={cn(
                  'inline-flex h-full items-center gap-1.5 rounded-md px-2 sm:px-2.5 text-xs font-medium transition-colors',
                  gridDensity === 'compact'
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <Grid3x3 className="h-3.5 w-3.5 shrink-0" />
                <span className="hidden sm:inline">Kompakt</span>
              </button>
              <button
                type="button"
                onClick={() => handleGridDensityChange('comfortable')}
                aria-pressed={gridDensity === 'comfortable'}
                aria-label="Rahat görünüm"
                title="Rahat"
                className={cn(
                  'inline-flex h-full items-center gap-1.5 rounded-md px-2 sm:px-2.5 text-xs font-medium transition-colors',
                  gridDensity === 'comfortable'
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <Grid2x2 className="h-3.5 w-3.5 shrink-0" />
                <span className="hidden sm:inline">Rahat</span>
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
            <div className="w-full sm:w-32">
              <Select
                value={typeFilter}
                onValueChange={(value) => {
                  setTypeFilter(normalizeBrowseTypeFilter(value));
                  setCurrentPage(1);
                }}
              >
                <SelectTrigger className="h-9 w-full text-xs">
                  <SelectValue placeholder="Tür" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tümü</SelectItem>
                  {typeOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="w-full sm:w-36">
              <Select
                value={statusFilter}
                onValueChange={(value) => {
                  setStatusFilter(value);
                  setCurrentPage(1);
                }}
              >
                <SelectTrigger className="h-9 w-full text-xs">
                  <SelectValue placeholder="Durum" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tümü</SelectItem>
                  <SelectItem value="ongoing">Devam Ediyor</SelectItem>
                  <SelectItem value="completed">Tamamlandı</SelectItem>
                  <SelectItem value="hiatus">Ara Verildi</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="w-full sm:w-36">
              <Select
                value={contentFilter}
                onValueChange={(value) => {
                  setContentFilter(value as BrowseContentFilter);
                  setCurrentPage(1);
                }}
              >
                <SelectTrigger className={cn('h-9 w-full text-xs', contentFilter === 'adult' && 'border-rose-500/40 bg-rose-500/10 text-rose-500')}>
                  <SelectValue placeholder="İçerik" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tümü</SelectItem>
                  <SelectItem value="safe">Sadece Normal</SelectItem>
                  {canSeeAdultContent ? (
                    <SelectItem value="adult">Sadece Yetişkin</SelectItem>
                  ) : null}
                </SelectContent>
              </Select>
            </div>

            <div className="w-full sm:w-36">
              <Select
                value={sortBy}
                onValueChange={(value) => {
                  setSortBy(value);
                  setCurrentPage(1);
                }}
              >
                <SelectTrigger className="h-9 w-full text-xs">
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

            <Button
              variant={showFilters ? 'default' : 'outline'}
              size="sm"
              onClick={() => setShowFilters(!showFilters)}
              className="h-9 w-full text-xs sm:w-auto"
            >
              <Filter className="mr-1.5 h-3.5 w-3.5" />
              Türler
            </Button>

            {hasActiveFilters && (
              <Button
                variant="ghost"
                size="sm"
                onClick={clearFilters}
                className="h-9 w-full text-xs text-muted-foreground hover:text-foreground sm:w-auto"
              >
                <X className="mr-1.5 h-3.5 w-3.5" />
                Temizle
              </Button>
            )}
          </div>
        </div>

        {/* Genre Filters */}
        {showFilters && (
          <div className="mb-5 flex flex-wrap gap-2 rounded-2xl border border-border/60 bg-card/50 p-3.5 sm:p-4">
            {allGenres.map((genre) => {
              const isSelected = selectedGenres.includes(genre);
              return (
                <button
                  key={genre}
                  type="button"
                  onClick={() => toggleGenre(genre)}
                  aria-pressed={isSelected}
                  className={cn(
                    "cursor-pointer px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                    isSelected
                      ? "border-primary bg-primary text-primary-foreground shadow-sm hover:bg-primary/90 hover:text-primary-foreground hover:border-primary"
                      : "border-border/60 bg-background/50 text-foreground hover:border-primary/50 hover:bg-secondary/70"
                  )}
                >
                  {genre}
                </button>
              );
            })}
          </div>
        )}

        {/* Tag Filters */}
        <div className="mb-5">
          <TagFilterPanel
            selectedTags={selectedTagSlugs}
            onSelectedTagsChange={(tags) => {
              setSelectedTagSlugs(tags);
              setCurrentPage(1);
            }}
          />
        </div>

        <p className="mb-4 text-xs sm:text-sm text-muted-foreground">
          {resultsLabel}
        </p>

        {/* Manga Grid */}
        {isInitialResultsPending ? (
          <BrowseGridSkeleton gridDensity={gridDensity} />
        ) : filteredManga.length === 0 ? (
          <div className="py-16 text-center">
            <p className="text-base text-muted-foreground">Arama kriterlerinize uygun manga bulunamadı.</p>
            {hasActiveFilters && (
              <Button variant="outline" size="sm" onClick={clearFilters} className="mt-4 h-9 text-xs">
                Filtreleri Temizle
              </Button>
            )}
          </div>
        ) : (
          <div className="space-y-8">
            <div className={BROWSE_GRID_CLASSES[gridDensity]}>
              {paginatedManga.map((item, idx) => (
                <div
                  key={item.id}
                  className={idx >= 14 ? 'cv-auto-card' : undefined}
                >
                  <MangaCard
                    manga={item}
                    index={idx}
                    enableEntryAnimation
                    entryAnimationClassName="animate-card-reveal-fast"
                    entryAnimationDelayStepMs={10}
                    entryAnimationDurationMs={170}
                  />
                </div>
              ))}
            </div>

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
