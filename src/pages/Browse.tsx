import React, { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Filter, X } from 'lucide-react';
import Header from '@/components/layout/Header';
import VirtualMangaGrid from '@/components/manga/VirtualMangaGrid';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
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

const browsePageCache: Partial<Record<BrowseAudienceCacheKey, Manga[]>> = {};
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
      <div key={`browse-skeleton-${index}`} className="overflow-hidden rounded-xl border border-border/60 bg-card/40">
        <Skeleton className="aspect-[2/3] w-full rounded-none" />
        <div className="space-y-2 p-2.5">
          <Skeleton className="h-4 w-5/6" />
          <Skeleton className="h-3 w-2/3" />
          <div className="flex gap-2 pt-1">
            <Skeleton className="h-5 w-14 rounded-md" />
            <Skeleton className="h-5 w-16 rounded-md" />
          </div>
          <div className="grid grid-cols-2 gap-2 pt-1">
            <Skeleton className="h-8 w-full rounded-lg" />
            <Skeleton className="h-8 w-full rounded-lg" />
          </div>
        </div>
      </div>
    ))}
  </div>
);

const getSixColumnDesktopCount = (width: number) => {
  if (width >= 1024) return 6;
  if (width >= 768) return 5;
  if (width >= 640) return 4;
  if (width >= 430) return 3;
  return 2;
};

const Browse: React.FC = () => {
  const { user } = useAuth();
  const { isOnline } = useEffectiveOnlineStatus();
  const [searchParams, setSearchParams] = useSearchParams();
  const isAuthenticatedViewer = Boolean(user?.id);
  const canSeeAdultContent = isAuthenticatedViewer && (
    user?.role === 'admin'
      || user?.role === 'moderator'
      || user?.preferences?.content?.adult_mode === true
  );
  const browseAudienceKey: BrowseAudienceCacheKey = canSeeAdultContent ? 'adult' : 'safe';
  const [showFilters, setShowFilters] = useState(false);
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
        const cachedMangas = browsePageCache[browseAudienceKey];
        if (cachedMangas) {
          setMangas(cachedMangas);
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
    if (contentFilter !== 'all') params.content = contentFilter;
    if (selectedGenres.length > 0) params.genre = selectedGenres.join(',');
    if (selectedTagSlugs.length > 0) params.tags = selectedTagSlugs.join(',');

    setSearchParams(params);
  }, [contentFilter, searchQuery, sortBy, typeFilter, selectedGenres, selectedTagSlugs, setSearchParams]);

  const filteredManga = useMemo(() => {
    let result = [...mangas];

    // Search filter
    if (deferredSearchQuery) {
      result = result.filter(
        (manga) => matchesMangaSearch(manga, deferredSearchQuery)
      );
    }

    // Type filter
    if (typeFilter !== 'all') {
      result = result.filter((manga) => (
        typeFilter === 'adult'
          ? (manga.isAdult === true || manga.type === 'hentai' || manga.type === 'webtoon_hentai')
          : manga.type === typeFilter
      ));
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
  };

  const clearFilters = () => {
    setSearchQuery('');
    setSelectedGenres([]);
    setSelectedTagSlugs([]);
    setTypeFilter('all');
    setStatusFilter('all');
    setContentFilter('all');
    setSortBy('popular');
    setSearchParams({});
  };

  const hasActiveFilters = searchQuery || selectedGenres.length > 0 || selectedTagSlugs.length > 0 || typeFilter !== 'all' || statusFilter !== 'all' || contentFilter !== 'all';
  const isInitialResultsPending = isLoading && mangas.length === 0;
  const resultsLabel = isInitialResultsPending
    ? 'Seriler hazırlanıyor...'
    : isHydratingFullCollection
      ? `${filteredManga.length} seri gösteriliyor, tam liste yükleniyor...`
      : `${filteredManga.length} sonuç bulundu`;

  return (
    <div className="min-h-screen bg-background">
      <Header />

      <main className="container pb-12 pt-20">
        <div className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight">Keşfet</h1>
          <p className="mt-2 text-muted-foreground">Binlerce manga, manhwa, manhua ve webtoon arasından seçim yapın</p>
        </div>

        {/* Filters Bar */}
        <div className="mb-6 flex flex-wrap items-center gap-3 sm:gap-4">
          <div className="w-full md:min-w-[240px] md:flex-1">
            <Input
              type="search"
              placeholder="Ara..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full"
            />
          </div>

          <div className="w-full sm:w-[calc(50%-0.375rem)] md:w-32">
            <Select value={typeFilter} onValueChange={(value) => setTypeFilter(normalizeBrowseTypeFilter(value))}>
              <SelectTrigger className="w-full">
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

          <div className="w-full sm:w-[calc(50%-0.375rem)] md:w-36">
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-full">
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

          <div className="w-full sm:w-[calc(50%-0.375rem)] md:w-40">
            <Select value={contentFilter} onValueChange={(value) => setContentFilter(value as BrowseContentFilter)}>
              <SelectTrigger className={`w-full ${contentFilter === 'adult' ? 'border-rose-500/40 bg-rose-500/10 text-rose-500' : ''}`}>
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

          <div className="w-full sm:w-[calc(50%-0.375rem)] md:w-36">
            <Select value={sortBy} onValueChange={setSortBy}>
              <SelectTrigger className="w-full">
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
            onClick={() => setShowFilters(!showFilters)}
            className="w-full sm:w-[calc(50%-0.375rem)] md:w-auto"
          >
            <Filter className="mr-2 h-4 w-4" />
            Türler
          </Button>

          {hasActiveFilters && (
            <Button variant="ghost" onClick={clearFilters} className="w-full sm:w-[calc(50%-0.375rem)] md:w-auto">
              <X className="mr-2 h-4 w-4" />
              Temizle
            </Button>
          )}
        </div>

        {/* Genre Filters */}
        {showFilters && (
          <div className="mb-6 flex flex-wrap gap-2 rounded-xl border border-border bg-card/50 p-4 animate-scale-in">
            {allGenres.map((genre) => (
              <Badge
                key={genre}
                variant={selectedGenres.includes(genre) ? 'default' : 'outline'}
                className="cursor-pointer transition-all hover:scale-105"
                onClick={() => toggleGenre(genre)}
              >
                {genre}
              </Badge>
            ))}
          </div>
        )}

        {/* Tag Filters */}
        <div className="mb-6">
          <TagFilterPanel
            selectedTags={selectedTagSlugs}
            onSelectedTagsChange={setSelectedTagSlugs}
          />
        </div>

        <p className="mb-4 text-sm text-muted-foreground">
          {resultsLabel}
        </p>

        {/* Manga Grid */}
        {isInitialResultsPending ? (
          <BrowseGridSkeleton />
        ) : (
          <div>
            <VirtualMangaGrid
              manga={filteredManga}
              getColumnCount={getSixColumnDesktopCount}
              emptyMessage="Arama kriterlerinize uygun manga bulunamadı"
              enableEntryAnimation
              showTopTenWeekBadges={false}
              entryAnimationClassName="animate-card-reveal-fast"
              entryAnimationDelayStepMs={10}
              entryAnimationDurationMs={170}
            />
          </div>
        )}
      </main>
    </div>
  );
};

export default Browse;
