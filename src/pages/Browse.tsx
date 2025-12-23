import React, { useState, useMemo, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Filter, X } from 'lucide-react';
import Header from '@/components/layout/Header';
import MangaGrid from '@/components/manga/MangaGrid';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { allGenres } from '@/lib/mockData';
import { getAllMangas } from '@/lib/database';
import { Manga } from '@/lib/types';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const Browse: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [showFilters, setShowFilters] = useState(false);
  const [selectedGenres, setSelectedGenres] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState(searchParams.get('search') || '');
  const [sortBy, setSortBy] = useState(searchParams.get('sort') || 'popular');
  const [typeFilter, setTypeFilter] = useState(searchParams.get('type') || 'all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [mangas, setMangas] = useState<Manga[]>([]);

  useEffect(() => {
    setMangas(getAllMangas());
  }, []);

  const filteredManga = useMemo(() => {
    let result = [...mangas];

    // Search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      result = result.filter(
        manga =>
          manga.title.toLowerCase().includes(query) ||
          manga.author.toLowerCase().includes(query)
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

    // Genre filter
    if (selectedGenres.length > 0) {
      result = result.filter(manga =>
        selectedGenres.every(genre => manga.genres.includes(genre))
      );
    }

    // Sort
    switch (sortBy) {
      case 'rating':
        result.sort((a, b) => {
          const ratingA = a.ratings && a.ratings.length > 0
            ? a.ratings.reduce((sum, r) => sum + r.rating, 0) / a.ratings.length
            : 0;
          const ratingB = b.ratings && b.ratings.length > 0
            ? b.ratings.reduce((sum, r) => sum + r.rating, 0) / b.ratings.length
            : 0;
          return ratingB - ratingA;
        });
        break;
      case 'updated':
        result.sort((a, b) => new Date(b.lastUpdated).getTime() - new Date(a.lastUpdated).getTime());
        break;
      case 'views':
        result.sort((a, b) => b.views - a.views);
        break;
      case 'chapters':
        result.sort((a, b) => b.chapters.length - a.chapters.length);
        break;
      default:
        result.sort((a, b) => b.views - a.views);
    }

    return result;
  }, [searchQuery, typeFilter, statusFilter, selectedGenres, sortBy, mangas]);

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
    setTypeFilter('all');
    setStatusFilter('all');
    setSortBy('popular');
    setSearchParams({});
  };

  const hasActiveFilters = searchQuery || selectedGenres.length > 0 || typeFilter !== 'all' || statusFilter !== 'all';

  return (
    <div className="min-h-screen bg-background">
      <Header />

      <main className="container pb-12 pt-20">
        <div className="mb-8 animate-fade-up opacity-0" style={{ animationDelay: '0.1s', animationFillMode: 'forwards' }}>
          <h1 className="text-3xl font-bold tracking-tight">Keşfet</h1>
          <p className="mt-2 text-muted-foreground">Binlerce manga ve manhwa arasından seçim yapın</p>
        </div>

        {/* Filters Bar */}
        <div className="mb-6 flex flex-wrap items-center gap-4 animate-fade-up opacity-0" style={{ animationDelay: '0.2s', animationFillMode: 'forwards' }}>
          <div className="flex-1 min-w-[200px]">
            <Input
              type="search"
              placeholder="Ara..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full"
            />
          </div>

          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-32">
              <SelectValue placeholder="Tür" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tümü</SelectItem>
              <SelectItem value="manga">Manga</SelectItem>
              <SelectItem value="manhwa">Manhwa</SelectItem>
              <SelectItem value="manhua">Manhua</SelectItem>
            </SelectContent>
          </Select>

          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-36">
              <SelectValue placeholder="Durum" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tümü</SelectItem>
              <SelectItem value="ongoing">Devam Ediyor</SelectItem>
              <SelectItem value="completed">Tamamlandı</SelectItem>
              <SelectItem value="hiatus">Ara Verildi</SelectItem>
            </SelectContent>
          </Select>

          <Select value={sortBy} onValueChange={setSortBy}>
            <SelectTrigger className="w-36">
              <SelectValue placeholder="Sırala" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="popular">Popüler</SelectItem>
              <SelectItem value="rating">Puan</SelectItem>
              <SelectItem value="updated">Son Güncellenen</SelectItem>
              <SelectItem value="views">Görüntülenme</SelectItem>
              <SelectItem value="chapters">Bölüm Sayısı</SelectItem>
            </SelectContent>
          </Select>

          <Button
            variant={showFilters ? 'default' : 'outline'}
            onClick={() => setShowFilters(!showFilters)}
          >
            <Filter className="mr-2 h-4 w-4" />
            Türler
          </Button>

          {hasActiveFilters && (
            <Button variant="ghost" onClick={clearFilters}>
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

        {/* Results Count */}
        <p className="mb-4 text-sm text-muted-foreground">
          {filteredManga.length} sonuç bulundu
        </p>

        {/* Manga Grid */}
        <MangaGrid
          manga={filteredManga}
          emptyMessage="Arama kriterlerinize uygun manga bulunamadı"
        />
      </main>
    </div>
  );
};

export default Browse;
