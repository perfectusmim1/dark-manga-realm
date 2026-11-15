import useDocumentTitle from '@/hooks/useDocumentTitle';
import React, { startTransition, useDeferredValue, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Activity,
  BookOpen,
  CheckCircle2,
  Clock,
  Compass,
  Eye,
  Filter,
  Flame,
  Grid2x2,
  Grid3x3,
  Layers,
  PauseCircle,
  Search,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Star,
  Trophy,
  X,
} from 'lucide-react';
import Header from '@/components/layout/Header';
import { cn } from '@/lib/utils';
import MangaCard from '@/components/manga/MangaCard';
import AppPagination from '@/components/ui/AppPagination';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { AnimatePresence, motion } from 'framer-motion';
import { allGenres, formatGenreDisplayName, normalizeGenreName } from '@/lib/mockData';
import { getAllTimeMangaRanks, getMangaSummaries, getMangasByMultipleTags } from '@/lib/database';
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
import { matchesMangaPreparedSearch, prepareSearchQuery } from '@/lib/searchMatching';
import { useAuth } from '@/contexts/AuthContext';
import { ADULT_MODE_CHANGED_EVENT } from '@/lib/adultModeEvents';
import { getMangaTypeLabel } from '@/lib/mangaType';
import { useDeviceProfile } from '@/hooks/use-device-profile';
import { useTopTenWeekIds } from '@/hooks/useTopTenWeekIds';

type BrowseAudienceCacheKey = 'safe' | 'adult';
type BrowseContentFilter = 'all' | 'safe' | 'adult';
type BrowseTypeFilter = 'all' | 'manga' | 'manhwa' | 'manhua' | 'webtoon' | 'adult';
type BrowseRankFilter = 'all' | 'top10' | 'top50' | 'top100' | 'top500';
type BrowseGridDensity = 'compact' | 'comfortable';

const RANK_FILTER_LIMITS: Record<Exclude<BrowseRankFilter, 'all'>, number> = {
  top10: 10,
  top50: 50,
  top100: 100,
  top500: 500,
};

const normalizeBrowseRankFilter = (value: string | null): BrowseRankFilter => {
  switch (value) {
    case 'top10':
    case 'top50':
    case 'top100':
    case 'top500':
      return value;
    default:
      return 'all';
  }
};

const BROWSE_DENSITY_STORAGE_KEY = 'toonparrot_browse_density_v1';
const BROWSE_GRID_CLASSES: Record<BrowseGridDensity, string> = {
  compact: 'grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3 sm:gap-3.5',
  comfortable: 'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3 sm:gap-4',
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

interface IndexedBrowseManga {
  manga: Manga;
  normalizedGenres: Set<string>;
  lowerGenres: Set<string>;
  hasAdultGenreEquivalent: boolean;
  rating: number;
  updatedAtMs: number;
  createdAtMs: number;
  chapterCount: number;
  views: number;
}

const indexedBrowseMangaCache = new WeakMap<Manga, IndexedBrowseManga>();

const getFormatIcon = (typeValue: string) => {
  switch (typeValue) {
    case 'manga':
      return <BookOpen className="h-3.5 w-3.5 shrink-0 text-sky-400" />;
    case 'manhwa':
      return <Sparkles className="h-3.5 w-3.5 shrink-0 text-orange-400" />;
    case 'manhua':
      return <Compass className="h-3.5 w-3.5 shrink-0 text-emerald-400" />;
    case 'webtoon':
      return <Smartphone className="h-3.5 w-3.5 shrink-0 text-cyan-400" />;
    case 'adult':
      return <ShieldAlert className="h-3.5 w-3.5 shrink-0 text-rose-400" />;
    default:
      return <Layers className="h-3.5 w-3.5 shrink-0 text-primary" />;
  }
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
  const { disableHeavyEffects, prefersReducedMotion } = useDeviceProfile();
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
  const [rankFilter, setRankFilter] = useState<BrowseRankFilter>(() => normalizeBrowseRankFilter(searchParams.get('rank')));
  const [allTimeRankMap, setAllTimeRankMap] = useState<Map<string, number>>(new Map());
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
  const topTenWeekIds = useTopTenWeekIds(mangas.length > 0);
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const deferredSelectedGenres = useDeferredValue(selectedGenres);
  const deferredTypeFilter = useDeferredValue(typeFilter);
  const deferredStatusFilter = useDeferredValue(statusFilter);
  const deferredContentFilter = useDeferredValue(contentFilter);
  const deferredSortBy = useDeferredValue(sortBy);
  const deferredRankFilter = useDeferredValue(rankFilter);

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
    if (!isOnline || (sortBy !== 'all_time_rank' && rankFilter === 'all')) {
      return;
    }

    let cancelled = false;
    void getAllTimeMangaRanks(canSeeAdultContent)
      .then((res) => {
        if (!cancelled) {
          setAllTimeRankMap(res.rankById);
        }
      })
      .catch(() => {
        // ignore transient rank lookup errors
      });

    return () => {
      cancelled = true;
    };
  }, [canSeeAdultContent, isOnline, rankFilter, sortBy]);

  useEffect(() => {
    const nextParams = new URLSearchParams();
    if (searchQuery) nextParams.set('search', searchQuery);
    if (sortBy !== 'popular') nextParams.set('sort', sortBy);
    if (rankFilter !== 'all') nextParams.set('rank', rankFilter);
    if (typeFilter !== 'all') nextParams.set('type', typeFilter);
    if (contentFilter !== 'all') nextParams.set('content', contentFilter);
    if (selectedGenres.length > 0) nextParams.set('genre', selectedGenres.join(','));
    if (selectedTagSlugs.length > 0) nextParams.set('tags', selectedTagSlugs.join(','));
    if (currentPage > 1) nextParams.set('page', String(currentPage));

    if (nextParams.toString() !== searchParams.toString()) {
      setSearchParams(nextParams, { replace: true });
    }
  }, [contentFilter, rankFilter, searchQuery, sortBy, typeFilter, selectedGenres, selectedTagSlugs, currentPage, searchParams, setSearchParams]);

  const indexedCatalog = useMemo<IndexedBrowseManga[]>(() => {
    const seenMangaIds = new Set<string>();
    const entries: IndexedBrowseManga[] = [];

    for (const manga of mangas) {
      if (!manga?.id || seenMangaIds.has(manga.id)) {
        continue;
      }
      seenMangaIds.add(manga.id);

      const cachedEntry = indexedBrowseMangaCache.get(manga);
      if (cachedEntry) {
        entries.push(cachedEntry);
        continue;
      }

      const normalizedGenres = new Set<string>();
      const lowerGenres = new Set<string>();
      let hasAdultGenreEquivalent = false;

      for (const rawGenre of manga.genres || []) {
        const lower = rawGenre.toLowerCase();
        lowerGenres.add(lower);
        const normalized = normalizeGenreName(rawGenre);
        if (normalized) {
          normalizedGenres.add(normalized);
          if (ADULT_GENRE_EQUIVALENTS.has(normalized)) {
            hasAdultGenreEquivalent = true;
          }
        }
      }

      const rating = typeof manga.averageRating === 'number'
        ? manga.averageRating
        : manga.ratings && manga.ratings.length > 0
          ? manga.ratings.reduce((sum, r) => sum + r.rating, 0) / manga.ratings.length
          : 0;

      const updatedAtMs = manga.lastUpdated ? Date.parse(manga.lastUpdated) || 0 : 0;
      const createdAtMs = manga.createdAt ? Date.parse(manga.createdAt) || 0 : 0;
      const chapterCount = typeof manga.chapterCount === 'number' ? manga.chapterCount : manga.chapters.length;
      const views = typeof manga.views === 'number' ? manga.views : 0;

      const entry: IndexedBrowseManga = {
        manga,
        normalizedGenres,
        lowerGenres,
        hasAdultGenreEquivalent,
        rating,
        updatedAtMs,
        createdAtMs,
        chapterCount,
        views,
      };
      indexedBrowseMangaCache.set(manga, entry);
      entries.push(entry);
    }

    return entries;
  }, [mangas]);

  const filteredManga = useMemo(() => {
    let entries = indexedCatalog;

    if (deferredSearchQuery) {
      const preparedSearch = prepareSearchQuery(deferredSearchQuery);
      entries = entries.filter((entry) => matchesMangaPreparedSearch(entry.manga, preparedSearch));
    }

    if (deferredTypeFilter !== 'all') {
      entries = entries.filter((entry) => {
        if (deferredTypeFilter === 'adult') {
          return entry.manga.isAdult === true || entry.manga.type === 'hentai' || entry.manga.type === 'webtoon_hentai';
        }
        if (entry.manga.type === deferredTypeFilter) {
          return true;
        }
        return entry.lowerGenres.has(deferredTypeFilter);
      });
    }

    if (deferredStatusFilter !== 'all') {
      entries = entries.filter((entry) => entry.manga.status === deferredStatusFilter);
    }

    if (deferredContentFilter === 'safe') {
      entries = entries.filter((entry) => entry.manga.isAdult !== true);
    } else if (deferredContentFilter === 'adult') {
      entries = entries.filter((entry) => entry.manga.isAdult === true);
    }

    if (deferredSelectedGenres.length > 0) {
      entries = entries.filter((entry) => (
        deferredSelectedGenres.every((genre) => (
          genre === 'Yetişkin'
            ? entry.manga.isAdult === true || entry.hasAdultGenreEquivalent
            : entry.normalizedGenres.has(genre)
        ))
      ));
    }

    if (tagFilteredMangaIds) {
      entries = entries.filter((entry) => tagFilteredMangaIds.has(entry.manga.id));
    }

    if (deferredRankFilter !== 'all' && allTimeRankMap.size > 0) {
      const rankLimit = RANK_FILTER_LIMITS[deferredRankFilter];
      entries = entries.filter((entry) => {
        const rank = allTimeRankMap.get(entry.manga.id);
        return typeof rank === 'number' && rank <= rankLimit;
      });
    }

    const sortedEntries = entries === indexedCatalog ? [...entries] : entries;

    switch (deferredSortBy) {
      case 'all_time_rank':
        sortedEntries.sort((a, b) => (
          (allTimeRankMap.get(a.manga.id) ?? Number.MAX_SAFE_INTEGER)
          - (allTimeRankMap.get(b.manga.id) ?? Number.MAX_SAFE_INTEGER)
        ));
        break;
      case 'rating':
        sortedEntries.sort((a, b) => b.rating - a.rating);
        break;
      case 'updated':
        sortedEntries.sort((a, b) => b.updatedAtMs - a.updatedAtMs);
        break;
      case 'created':
        sortedEntries.sort((a, b) => b.createdAtMs - a.createdAtMs);
        break;
      case 'views':
        sortedEntries.sort((a, b) => b.views - a.views);
        break;
      case 'chapters':
        sortedEntries.sort((a, b) => b.chapterCount - a.chapterCount);
        break;
      default:
        sortedEntries.sort((a, b) => b.views - a.views);
    }

    return sortedEntries.map((entry) => entry.manga);
  }, [
    indexedCatalog,
    deferredContentFilter,
    deferredSearchQuery,
    deferredTypeFilter,
    deferredStatusFilter,
    deferredSelectedGenres,
    tagFilteredMangaIds,
    deferredRankFilter,
    allTimeRankMap,
    deferredSortBy,
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
    startTransition(() => {
      setCurrentPage(1);
    });
  };

  const clearFilters = () => {
    setSearchQuery('');
    setSelectedGenres([]);
    setSelectedTagSlugs([]);
    setTypeFilter('all');
    setStatusFilter('all');
    setContentFilter('all');
    setRankFilter('all');
    setSortBy('popular');
    setCurrentPage(1);
    setSearchParams({}, { replace: true });
  };

  const hasActiveFilters = searchQuery || selectedGenres.length > 0 || selectedTagSlugs.length > 0 || typeFilter !== 'all' || statusFilter !== 'all' || contentFilter !== 'all' || rankFilter !== 'all' || sortBy === 'all_time_rank';
  const isInitialResultsPending = isLoading && mangas.length === 0;

  const browsePageSize = gridDensity === 'compact' ? 28 : 36;
  const totalPages = Math.max(1, Math.ceil(filteredManga.length / browsePageSize));

  useEffect(() => {
    if (currentPage > totalPages && totalPages > 0) {
      setCurrentPage(1);
    }
  }, [currentPage, totalPages]);

  const paginatedManga = useMemo(() => {
    const start = (currentPage - 1) * browsePageSize;
    return filteredManga.slice(start, start + browsePageSize);
  }, [filteredManga, currentPage, browsePageSize]);

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

  if (!isOnline) {
    return (
      <OfflineRequiredScreen
        description="Keşfet sayfası internet bağlantısı gerektirir."
        actionHref="/downloads"
        actionLabel="İndirilenlere Git"
      />
    );
  }

  return (
    <div className="min-h-screen overflow-x-clip bg-background">
      <Header />

      <main className="container pb-12 pt-16">
        <div className="flex flex-wrap items-center gap-3 py-6 sm:py-8">
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Keşfet</h1>
          <span className="rounded-full border border-border/60 bg-secondary/40 px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
            {resultsLabel}
          </span>
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
              className="hidden h-9 shrink-0 items-center rounded-lg border border-border/60 bg-background/60 p-0.5 sm:inline-flex sm:h-10"
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
            <div className="relative w-full sm:w-40">
              <Select
                value={typeFilter}
                onValueChange={(value) => {
                  setTypeFilter(normalizeBrowseTypeFilter(value));
                  startTransition(() => setCurrentPage(1));
                }}
              >
                <SelectTrigger className={cn('h-9 w-full text-xs', typeFilter !== 'all' && 'border-primary/45 bg-primary/10 text-foreground')}>
                  <SelectValue placeholder="Format" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">
                    {getFormatIcon('all')}
                    <span>Tüm Formatlar</span>
                  </SelectItem>
                  {typeOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {getFormatIcon(option.value)}
                      <span>{option.label}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="relative w-full sm:w-40">
              <Select
                value={statusFilter}
                onValueChange={(value) => {
                  setStatusFilter(value);
                  startTransition(() => setCurrentPage(1));
                }}
              >
                <SelectTrigger className={cn('h-9 w-full text-xs', statusFilter !== 'all' && 'border-emerald-500/40 bg-emerald-500/10 text-foreground')}>
                  <SelectValue placeholder="Durum" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">
                    <Activity className="h-3.5 w-3.5 shrink-0 text-primary" />
                    <span>Tüm Durumlar</span>
                  </SelectItem>
                  <SelectItem value="ongoing">
                    <Clock className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
                    <span>Devam Ediyor</span>
                  </SelectItem>
                  <SelectItem value="completed">
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-sky-400" />
                    <span>Tamamlandı</span>
                  </SelectItem>
                  <SelectItem value="hiatus">
                    <PauseCircle className="h-3.5 w-3.5 shrink-0 text-amber-400" />
                    <span>Ara Verildi</span>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="relative w-full sm:w-40">
              <Select
                value={contentFilter}
                onValueChange={(value) => {
                  setContentFilter(value as BrowseContentFilter);
                  startTransition(() => setCurrentPage(1));
                }}
              >
                <SelectTrigger className={cn(
                  'h-9 w-full text-xs',
                  contentFilter === 'adult' && 'border-rose-500/40 bg-rose-500/10 text-rose-400',
                  contentFilter === 'safe' && 'border-emerald-500/40 bg-emerald-500/10 text-foreground',
                )}>
                  <SelectValue placeholder="İçerik" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">
                    <Shield className="h-3.5 w-3.5 shrink-0 text-primary" />
                    <span>Tüm İçerikler</span>
                  </SelectItem>
                  <SelectItem value="safe">
                    <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
                    <span>Sadece Normal</span>
                  </SelectItem>
                  {canSeeAdultContent ? (
                    <SelectItem value="adult">
                      <ShieldAlert className="h-3.5 w-3.5 shrink-0 text-rose-400" />
                      <span>Sadece Yetişkin</span>
                    </SelectItem>
                  ) : null}
                </SelectContent>
              </Select>
            </div>

            <div className="relative w-full sm:w-40">
              <Select
                value={rankFilter}
                onValueChange={(value) => {
                  const nextRank = normalizeBrowseRankFilter(value);
                  setRankFilter(nextRank);
                  if (nextRank !== 'all' && sortBy !== 'all_time_rank') {
                    setSortBy('all_time_rank');
                  }
                  startTransition(() => setCurrentPage(1));
                }}
              >
                <SelectTrigger className={cn('h-9 w-full text-xs', rankFilter !== 'all' && 'border-amber-500/45 bg-amber-500/10 text-foreground')}>
                  <SelectValue placeholder="Sıralama" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">
                    <Trophy className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span>Tüm Sıralar</span>
                  </SelectItem>
                  <SelectItem value="top10">
                    <Trophy className="h-3.5 w-3.5 shrink-0 text-amber-400" />
                    <span>İlk 10</span>
                  </SelectItem>
                  <SelectItem value="top50">
                    <Trophy className="h-3.5 w-3.5 shrink-0 text-amber-300" />
                    <span>İlk 50</span>
                  </SelectItem>
                  <SelectItem value="top100">
                    <Trophy className="h-3.5 w-3.5 shrink-0 text-sky-400" />
                    <span>İlk 100</span>
                  </SelectItem>
                  <SelectItem value="top500">
                    <Trophy className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
                    <span>İlk 500</span>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="relative w-full sm:w-52">
              <Select
                value={sortBy}
                onValueChange={(value) => {
                  setSortBy(value);
                  startTransition(() => setCurrentPage(1));
                }}
              >
                <SelectTrigger className={cn('h-9 w-full text-xs', sortBy === 'all_time_rank' && 'border-amber-500/45 bg-amber-500/10 text-foreground')}>
                  <SelectValue placeholder="Sırala" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="popular">
                    <Flame className="h-3.5 w-3.5 shrink-0 text-orange-400" />
                    <span>Popüler</span>
                  </SelectItem>
                  <SelectItem value="all_time_rank">
                    <Trophy className="h-3.5 w-3.5 shrink-0 text-amber-400" />
                    <span>Tüm Zamanlar Sıralaması</span>
                  </SelectItem>
                  <SelectItem value="rating">
                    <Star className="h-3.5 w-3.5 shrink-0 text-amber-400" />
                    <span>Puan</span>
                  </SelectItem>
                  <SelectItem value="created">
                    <Sparkles className="h-3.5 w-3.5 shrink-0 text-violet-400" />
                    <span>Yeni Eklenen</span>
                  </SelectItem>
                  <SelectItem value="updated">
                    <Clock className="h-3.5 w-3.5 shrink-0 text-sky-400" />
                    <span>Son Güncellenen</span>
                  </SelectItem>
                  <SelectItem value="views">
                    <Eye className="h-3.5 w-3.5 shrink-0 text-cyan-400" />
                    <span>Görüntülenme</span>
                  </SelectItem>
                  <SelectItem value="chapters">
                    <BookOpen className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
                    <span>Bölüm Sayısı</span>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="col-span-2 flex items-center gap-2 sm:contents">
              <Button
                variant={showFilters ? 'default' : 'outline'}
                size="sm"
                onClick={() => setShowFilters(!showFilters)}
                className="h-9 flex-1 text-xs sm:w-auto sm:flex-initial"
              >
                <Filter className="mr-1.5 h-3.5 w-3.5" />
                Türler
                {selectedGenres.length > 0 && (
                  <span className={cn(
                    'ml-1.5 rounded-full px-1.5 py-0 text-[10px] font-bold tabular-nums',
                    showFilters ? 'bg-primary-foreground/20 text-primary-foreground' : 'bg-primary/15 text-primary',
                  )}>
                    {selectedGenres.length}
                  </span>
                )}
              </Button>

              {hasActiveFilters && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={clearFilters}
                  className="h-9 shrink-0 text-xs text-muted-foreground hover:text-foreground sm:w-auto"
                >
                  <X className="mr-1.5 h-3.5 w-3.5" />
                  Temizle
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* Genre Filters */}
        <AnimatePresence initial={false}>
          {showFilters && (
            <motion.div
              key="browse-genre-drawer"
              initial={prefersReducedMotion ? false : { opacity: 0, y: disableHeavyEffects ? 0 : -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={prefersReducedMotion ? undefined : { opacity: 0, y: disableHeavyEffects ? 0 : -6 }}
              transition={prefersReducedMotion ? { duration: 0 } : { duration: 0.16, ease: 'easeOut' }}
              className="mb-5 flex flex-wrap gap-2 rounded-2xl border border-border/60 bg-card/50 p-3.5 sm:p-4"
            >
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
                    {formatGenreDisplayName(genre)}
                  </button>
                );
              })}
            </motion.div>
          )}
        </AnimatePresence>

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

        {/* Manga Grid */}
        {isInitialResultsPending ? (
          <BrowseGridSkeleton gridDensity={gridDensity} />
        ) : filteredManga.length === 0 ? (
          <div className="py-16 text-center">
            <p className="text-base text-muted-foreground">Arama kriterlerinize uygun seri bulunamadı.</p>
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
                    allTimeRank={deferredSortBy === 'all_time_rank' || deferredRankFilter !== 'all' ? allTimeRankMap.get(item.id) : undefined}
                    topTenWeekIds={topTenWeekIds}
                    disableHeavyEffects={disableHeavyEffects || prefersReducedMotion}
                    enableEntryAnimation={!prefersReducedMotion}
                    entryAnimationClassName="animate-route-fade"
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
