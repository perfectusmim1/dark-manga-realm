import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  Heart,
  Star,
  Eye,
  BookOpen,
  Calendar,
  Play,
  ChevronDown,
  ChevronUp,
  Library,
  Bell,
  BellOff,
  List,
} from 'lucide-react';
import Header from '@/components/layout/Header';
import CommentSection from '@/components/comments/CommentSection';
import ReadingListModal from '@/components/manga/ReadingListModal';
import { Button } from '@/components/ui/button';

import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { getMangaById, getAverageRating, rateManga, getUserRating, incrementMangaViews } from '@/lib/database';
import { useAuth } from '@/contexts/AuthContext';
import {
  addFavorite,
  removeFavorite,
  isFavorite,
  getLatestProgress,
  updateFavoriteCategory,
  followManga,
  unfollowManga,
  isFollowingManga,
  getFavorites,
} from '../lib/storage';
import { LibraryCategory, Manga } from '@/lib/types';
import { toast } from 'sonner';
import MangaDetailSkeleton from '@/components/skeletons/MangaDetailSkeleton';

const categoryLabels: Record<LibraryCategory, string> = {
  reading: 'Okuyorum',
  plan_to_read: 'Okuyacağım',
  completed: 'Tamamladım',
  on_hold: 'Beklemede',
  dropped: 'Bıraktım',
};

const MangaDetail: React.FC = () => {
  const { mangaId } = useParams<{ mangaId: string }>();
  const [manga, setManga] = useState<Manga | undefined>();
  const { user } = useAuth();
  const [favorite, setFavorite] = useState(false);
  const [isFollowing, setIsFollowing] = useState(false);
  const [category, setCategory] = useState<LibraryCategory | undefined>();
  const [showAllChapters, setShowAllChapters] = useState(false);
  const [userRating, setUserRating] = useState<number | undefined>();
  const [averageRating, setAverageRating] = useState({ average: 0, count: 0 });
  const [hoverRating, setHoverRating] = useState(0);
  const [latestProgress, setLatestProgress] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isListModalOpen, setIsListModalOpen] = useState(false);


  useEffect(() => {
    const loadMangaData = async () => {
      if (!mangaId) return;

      try {
        setIsLoading(true);
        const [mData, avgRating] = await Promise.all([
          getMangaById(mangaId),
          getAverageRating(mangaId)
        ]);

        if (mData) {
          setManga(mData);
          setAverageRating(avgRating);

          // Increment views
          incrementMangaViews(mangaId);

          if (user) {
            const [favorited, following, cat, rating, progress] = await Promise.all([
              isFavorite(user.id, mangaId),
              isFollowingManga(user.id, mangaId),
              // We'll get category from the favorites check or a separate call
              null as any,
              getUserRating(mangaId, user.id),
              getLatestProgress(user.id, mangaId)
            ]);

            setFavorite(favorited);
            setIsFollowing(following);
            setUserRating(rating);
            setLatestProgress(progress);

            // To get category, we'll fetch favorites specifically
            const userFavorites = await getFavorites(user.id);
            const thisFav = userFavorites.find(f => f.mangaId === mangaId);
            if (thisFav) setCategory(thisFav.category);
          }
        }
      } catch (err) {
        console.error('Error loading manga detail:', err);
      } finally {
        setIsLoading(false);
      }
    };

    loadMangaData();
  }, [mangaId, user]);

  if (isLoading) {
    return (
      <>
        <Header />
        <MangaDetailSkeleton />
      </>
    );
  }

  if (!manga) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <main className="container flex min-h-[60vh] items-center justify-center pt-20">
          <div className="text-center">
            <h1 className="text-2xl font-bold">Manga Bulunamadı</h1>
            <p className="mt-2 text-muted-foreground">Aradığınız manga mevcut değil.</p>
            <Button asChild className="mt-4">
              <Link to="/">Ana Sayfaya Dön</Link>
            </Button>
          </div>
        </main>
      </div>
    );
  }

  const toggleFavorite = async () => {
    if (!user) {
      toast.error('Favorilere eklemek için giriş yapmalısınız');
      return;
    }

    try {
      if (favorite) {
        await removeFavorite(user.id, manga.id);
        setFavorite(false);
        setCategory(undefined);
        toast.success('Favorilerden kaldırıldı');
      } else {
        await addFavorite(user.id, manga.id, 'reading');
        setFavorite(true);
        setCategory('reading');
        toast.success('Favorilere eklendi');
      }
    } catch (err) {
      toast.error('İşlem başarısız oldu');
    }
  };

  const handleCategoryChange = async (newCategory: LibraryCategory) => {
    if (!user) {
      toast.error('Giriş yapmalısınız');
      return;
    }

    try {
      if (!favorite) {
        await addFavorite(user.id, manga.id, newCategory);
        setFavorite(true);
      } else {
        await updateFavoriteCategory(user.id, manga.id, newCategory);
      }
      setCategory(newCategory);
      toast.success(`Kategori: ${categoryLabels[newCategory]}`);
    } catch (err) {
      toast.error('Kategori güncellenemedi');
    }
  };

  const toggleFollow = async () => {
    if (!user) {
      toast.error('Takip etmek için giriş yapmalısınız');
      return;
    }

    try {
      if (isFollowing) {
        await unfollowManga(user.id, manga!.id);
        setIsFollowing(false);
        toast.success('Takibi bıraktınız');
      } else {
        await followManga(user.id, manga!.id);
        setIsFollowing(true);
        toast.success('Manga takip ediliyor! Yeni bölümlerden haberdar olacaksınız.');
      }
    } catch (err) {
      toast.error('İşlem başarısız oldu');
    }
  };

  const handleAddToList = () => {
    if (!user) {
      toast.error('Listeye eklemek için giriş yapmalısınız');
      return;
    }
    setIsListModalOpen(true);
  };


  const handleRating = async (rating: number) => {
    if (!user) {
      toast.error('Puan vermek için giriş yapmalısınız');
      return;
    }

    try {
      await rateManga(manga.id, user.id, rating);
      setUserRating(rating);
      const newAvg = await getAverageRating(manga.id);
      setAverageRating(newAvg);
      toast.success(`${rating}/10 puan verildi!`);
    } catch (err) {
      toast.error('Puan kaydedilemedi');
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('tr-TR', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  };

  const formatViews = (views: number) => {
    if (views >= 1000000) return `${(views / 1000000).toFixed(1)}M`;
    if (views >= 1000) return `${(views / 1000).toFixed(0)}K`;
    return views.toString();
  };

  const displayedChapters = showAllChapters
    ? manga.chapters.slice().reverse()
    : manga.chapters.slice().reverse().slice(0, 20);

  const continueChapter = latestProgress
    ? manga.chapters.find(ch => ch.id === latestProgress.chapterId)
    : null;

  return (
    <div className="min-h-screen bg-background">
      <Header />

      <main className="pt-16">
        {/* Hero Section */}
        <div className="relative">
          {/* Background */}
          <div className="absolute inset-0 h-80">
            <img
              src={manga.cover}
              alt=""
              className="h-full w-full object-cover opacity-20 blur-2xl"
            />
            <div className="absolute inset-0 bg-gradient-to-b from-background/50 via-background/80 to-background" />
          </div>

          {/* Content */}
          <div className="container relative z-10 py-8">
            <div className="flex flex-col gap-6 md:flex-row md:gap-8">
              {/* Cover */}
              <div className="shrink-0 animate-fade-up opacity-0" style={{ animationDelay: '0.1s', animationFillMode: 'forwards' }}>
                <img
                  src={manga.cover}
                  alt={manga.title}
                  className="mx-auto h-72 w-48 rounded-xl object-cover shadow-2xl shadow-primary/10 md:h-96 md:w-64"
                />
              </div>

              {/* Info */}
              <div className="flex flex-1 flex-col gap-4 animate-fade-up opacity-0" style={{ animationDelay: '0.2s', animationFillMode: 'forwards' }}>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge
                    variant="default"
                    className={`border-none font-bold ${manga.type === 'manhwa' ? 'bg-purple-600 text-white shadow-lg shadow-purple-500/20' :
                      manga.type === 'manhua' ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-500/20' :
                        'bg-primary text-primary-foreground shadow-lg shadow-primary/20'
                      }`}
                  >
                    {manga.type.toUpperCase()}
                  </Badge>
                  <Badge variant="outline">
                    {manga.status === 'completed' ? 'Tamamlandı' : manga.status === 'ongoing' ? 'Devam Ediyor' : 'Ara Verildi'}
                  </Badge>
                </div>

                <h1 className="text-3xl font-bold tracking-tight md:text-4xl">{manga.title}</h1>

                {manga.alternativeTitles && manga.alternativeTitles.length > 0 && (
                  <p className="text-sm text-muted-foreground italic">
                    {manga.alternativeTitles.join(', ')}
                  </p>
                )}

                <p className="text-muted-foreground flex items-center gap-2">
                  <span>{manga.author} {manga.artist && `• ${manga.artist}`}</span>
                  {manga.releaseYear && (
                    <span className="flex items-center gap-1 text-xs">
                      <Calendar className="h-3 w-3" />
                      {manga.releaseYear}
                    </span>
                  )}
                </p>

                <div className="flex flex-wrap items-center gap-4 text-sm">
                  {averageRating.count > 0 && (
                    <div className="flex items-center gap-1 text-primary">
                      <Star className="h-4 w-4 fill-primary" />
                      <span className="font-semibold">{averageRating.average}/10</span>
                      <span className="text-muted-foreground">({averageRating.count})</span>
                    </div>
                  )}
                  <div className="flex items-center gap-1 text-muted-foreground">
                    <Eye className="h-4 w-4" />
                    <span>{formatViews(manga.views || 0)} görüntülenme</span>
                  </div>
                  <div className="flex items-center gap-1 text-muted-foreground">
                    <BookOpen className="h-4 w-4" />
                    <span>{manga.chapters.length} bölüm</span>
                  </div>
                </div>

                <p className="text-foreground/80 leading-relaxed">{manga.description}</p>

                <div className="flex flex-wrap gap-2">
                  {manga.genres.map((genre) => (
                    <Badge key={genre} variant="secondary">
                      {genre}
                    </Badge>
                  ))}
                </div>

                <div className="flex flex-wrap gap-3 pt-4">
                  {continueChapter ? (
                    <Button asChild variant="glow" size="lg">
                      <Link to={`/manga/${manga.id}/chapter/${continueChapter.id}?page=${latestProgress?.page || 1}`}>
                        <Play className="h-4 w-4" />
                        Devam Et (Bölüm {continueChapter.number}, Sayfa {latestProgress?.page || 1})
                      </Link>
                    </Button>
                  ) : manga.chapters.length > 0 ? (
                    <Button asChild variant="glow" size="lg">
                      <Link to={`/manga/${manga.id}/chapter/${manga.chapters[0]?.id}`}>
                        <Play className="h-4 w-4" />
                        Okumaya Başla
                      </Link>
                    </Button>
                  ) : null}

                  <Button
                    variant={favorite ? 'default' : 'outline'}
                    size="lg"
                    onClick={toggleFavorite}
                    className={favorite ? 'bg-destructive hover:bg-destructive/90' : ''}
                  >
                    <Heart className={`h-4 w-4 ${favorite ? 'fill-current' : ''}`} />
                    {favorite ? 'Favorilerde' : 'Favorilere Ekle'}
                  </Button>

                  <Button
                    variant={isFollowing ? 'default' : 'outline'}
                    size="lg"
                    onClick={toggleFollow}
                    className={isFollowing ? 'bg-primary/20 text-primary border-primary/50 hover:bg-primary/30' : ''}
                  >
                    {isFollowing ? (
                      <BellOff className="h-4 w-4" />
                    ) : (
                      <Bell className="h-4 w-4" />
                    )}
                    {isFollowing ? 'Takibi Bırak' : 'Takip Et'}
                  </Button>

                  <Button
                    variant="outline"
                    size="lg"
                    onClick={handleAddToList}
                    className="group border-primary/30 hover:border-primary/60 hover:bg-primary/5 transition-all"
                  >
                    <List className="h-4 w-4 text-primary transition-transform group-hover:scale-110" />
                    Listeye Ekle
                  </Button>


                  {favorite && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="outline" size="lg">
                          <Library className="h-4 w-4" />
                          {category ? categoryLabels[category] : 'Kategori'}
                          <ChevronDown className="ml-1 h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent>
                        {(Object.entries(categoryLabels) as [LibraryCategory, string][]).map(([key, label]) => (
                          <DropdownMenuItem
                            key={key}
                            onClick={() => handleCategoryChange(key)}
                            className={category === key ? 'bg-secondary' : ''}
                          >
                            {label}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Rating Section */}
        <div className="container py-6">
          <div className="rounded-xl border border-border bg-card/50 p-6 animate-fade-up opacity-0" style={{ animationDelay: '0.25s', animationFillMode: 'forwards' }}>
            <h2 className="text-lg font-semibold mb-4">Puan Ver</h2>
            <div className="flex flex-col sm:flex-row sm:items-center gap-4">
              <div className="flex gap-1">
                {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((star) => (
                  <button
                    key={star}
                    onClick={() => handleRating(star)}
                    onMouseEnter={() => setHoverRating(star)}
                    onMouseLeave={() => setHoverRating(0)}
                    className="p-1 transition-transform hover:scale-110"
                  >
                    <Star
                      className={`h-6 w-6 transition-colors ${star <= (hoverRating || userRating || 0)
                        ? 'fill-yellow-400 text-yellow-400'
                        : 'text-muted-foreground'
                        }`}
                    />
                  </button>
                ))}
              </div>
              <div className="text-sm text-muted-foreground">
                {userRating ? (
                  <span>Puanınız: <strong className="text-foreground">{userRating}/10</strong></span>
                ) : (
                  <span>Henüz puan vermediniz</span>
                )}
                {averageRating.count > 0 && (
                  <span className="ml-4">
                    Ortalama: <strong className="text-foreground">{averageRating.average}/10</strong> ({averageRating.count} oy)
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Chapters List */}
        <div className="container py-8">
          <div className="rounded-xl border border-border bg-card/50 animate-fade-up opacity-0" style={{ animationDelay: '0.3s', animationFillMode: 'forwards' }}>
            <div className="border-b border-border p-4">
              <h2 className="text-xl font-bold">Bölümler</h2>
              <p className="text-sm text-muted-foreground">{manga.chapters.length} bölüm mevcut</p>
            </div>

            {manga.chapters.length > 0 ? (
              <>
                <div className="divide-y divide-border">
                  {displayedChapters.map((chapter) => (
                    <Link
                      key={chapter.id}
                      to={`/manga/${manga.id}/chapter/${chapter.id}`}
                      className="flex items-center justify-between p-4 transition-colors hover:bg-secondary/50"
                    >
                      <div>
                        <h3 className="font-medium">
                          Bölüm {chapter.number}: {chapter.title}
                        </h3>
                        <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <Calendar className="h-3 w-3" />
                            {formatDate(chapter.releaseDate)}
                          </span>
                          <span className="flex items-center gap-1">
                            <Eye className="h-3 w-3" />
                            {formatViews(chapter.views || 0)}
                          </span>
                        </div>
                      </div>
                      <Badge variant="outline" className="text-xs">
                        {chapter.pages.length} sayfa
                      </Badge>
                    </Link>
                  ))}
                </div>

                {manga.chapters.length > 20 && (
                  <div className="border-t border-border p-4">
                    <Button
                      variant="ghost"
                      className="w-full"
                      onClick={() => setShowAllChapters(!showAllChapters)}
                    >
                      {showAllChapters ? (
                        <>
                          <ChevronUp className="mr-2 h-4 w-4" />
                          Daha Az Göster
                        </>
                      ) : (
                        <>
                          <ChevronDown className="mr-2 h-4 w-4" />
                          Tüm Bölümleri Göster ({manga.chapters.length - 20} daha)
                        </>
                      )}
                    </Button>
                  </div>
                )}
              </>
            ) : (
              <div className="p-8 text-center text-muted-foreground">
                Henüz bölüm eklenmemiş
              </div>
            )}
          </div>
        </div>

        {/* Comments Section */}
        <div className="container pb-12">
          <div className="rounded-xl border border-border bg-card/50 p-6 animate-fade-up opacity-0" style={{ animationDelay: '0.4s', animationFillMode: 'forwards' }}>
            <CommentSection mangaId={manga.id} />
          </div>
        </div>
      </main>

      {user && manga && (
        <ReadingListModal
          isOpen={isListModalOpen}
          onClose={() => setIsListModalOpen(false)}
          mangaId={manga.id}
          userId={user.id}
        />
      )}
    </div>
  );
};


export default MangaDetail;
