import React, { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Filter, X } from 'lucide-react';
import Header from '@/components/layout/Header';
import VirtualMangaGrid from '@/components/manga/VirtualMangaGrid';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { allGenres } from '@/lib/mockData';
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
import DeferredMount from '@/components/performance/DeferredMount';
import { matchesMangaSearch } from '@/lib/searchMatching';
import { useAuth } from '@/contexts/AuthContext';
import { getMangaTypeLabel } from '@/lib/mangaType';

type BrowseAudienceCacheKey = 'safe' | 'adult';
type BrowseContentFilter = 'all' | 'safe' | 'adult';

const browsePageCache: Partial<Record<BrowseAudienceCacheKey, Manga[]>> = {};

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
    searchParams.get('genre') ? searchParams.get('genre')!.split(',') : []
  );
  const [searchQuery, setSearchQuery] = useState(searchParams.get('search') || '');
  const [sortBy, setSortBy] = useState(searchParams.get('sort') || 'popular');
  const [typeFilter, setTypeFilter] = useState(searchParams.get('type') || 'all');
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
    let active = true;

    const fetchMangas = async () => {
      try {
        const cachedMangas = browsePageCache[browseAudienceKey];
        if (cachedMangas) {
          setMangas(cachedMangas);
          setIsLoading(false);
          return;
        }

        if (!cachedMangas) {
          setIsLoading(true);
        }
        const data = await getMangaSummaries();
        if (!active) {
          return;
        }

        browsePageCache[browseAudienceKey] = data;
        setMangas(data);
      } finally {
        if (active) {
          setIsLoading(false);
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
      result = result.filter(manga => manga.type === typeFilter);
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
      result = result.filter(manga =>
        selectedGenres.every(genre => manga.genres.includes(genre))
      );
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

  return (
    <div className="min-h-screen bg-background">
      <Header />

      <main className="container pb-12 pt-20">
        <div className="mb-8 animate-fade-up opacity-0" style={{ animationDelay: '0.1s', animationFillMode: 'forwards' }}>
          <h1 className="text-3xl font-bold tracking-tight">Keşfet</h1>
          <p className="mt-2 text-muted-foreground">Binlerce manga, manhwa, manhua ve webtoon arasından seçim yapın</p>
        </div>

        {/* Filters Bar */}
        <div className="mb-6 flex flex-wrap items-center gap-3 animate-fade-up opacity-0 sm:gap-4" style={{ animationDelay: '0.2s', animationFillMode: 'forwards' }}>
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
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Tür" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tümü</SelectItem>
                <SelectItem value="manga">{getMangaTypeLabel('manga')}</SelectItem>
                <SelectItem value="manhwa">{getMangaTypeLabel('manhwa')}</SelectItem>
                <SelectItem value="manhua">{getMangaTypeLabel('manhua')}</SelectItem>
                <SelectItem value="webtoon">{getMangaTypeLabel('webtoon')}</SelectItem>
                <SelectItem value="hentai">{getMangaTypeLabel('hentai')}</SelectItem>
                <SelectItem value="webtoon_hentai">{getMangaTypeLabel('webtoon_hentai')}</SelectItem>
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
                  <SelectItem value="adult">Sadece 18+</SelectItem>
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
        <DeferredMount className="mb-6 animate-fade-up opacity-0" placeholderMinHeight={86} rootMargin="240px 0px">
          <div style={{ animationDelay: '0.25s', animationFillMode: 'forwards' }}>
            <TagFilterPanel
              selectedTags={selectedTagSlugs}
              onSelectedTagsChange={setSelectedTagSlugs}
            />
          </div>
        </DeferredMount>

        <p className="mb-4 text-sm text-muted-foreground">
          {isInitialResultsPending ? 'Seriler hazırlanıyor...' : `${filteredManga.length} sonuç bulundu`}
        </p>

        {/* Manga Grid */}
        {isInitialResultsPending ? (
          <div className="min-h-[220px]" />
        ) : (
          <div className="animate-fade-up opacity-0" style={{ animationDelay: '0.3s', animationFillMode: 'forwards' }}>
            <VirtualMangaGrid
              manga={filteredManga}
              getColumnCount={getSixColumnDesktopCount}
              emptyMessage="Arama kriterlerinize uygun manga bulunamadı"
            />
          </div>
        )}
      </main>
    </div>
  );
};

export default Browse;
