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
  Search,
} from 'lucide-react';
import Header from '@/components/layout/Header';
import CommentSection from '@/components/comments/CommentSection';
import ReadingListModal from '@/components/manga/ReadingListModal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  getMangaById,
  getAverageRating,
  rateManga,
  getUserRating,
  incrementMangaViews,
  getReviewsForManga,
  addReview,
  getUserReview,
  toggleReviewLike,
  getSimilarMangas,
  getMangaCharacters
} from '@/lib/database';
import { Character } from '@/lib/types';
import { Trophy, Group } from 'lucide-react';
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
import { LibraryCategory, Manga, Review } from '@/lib/types';
import {
  MessageSquare,
  ThumbsUp,
  Plus,
  Send,
  ArrowRight,
  Edit3
} from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { toast } from 'sonner';
import MangaDetailSkeleton from '@/components/skeletons/MangaDetailSkeleton';

const categoryLabels: Record<LibraryCategory, string> = {
  reading: 'Okuyorum',
  plan_to_read: 'Okuyacağım',
  completed: 'Tamamladım',
  on_hold: 'Beklemede',
  dropped: 'Bıraktım',
};

const PreviewChapter = ({ 
  chapter, 
  index, 
  mangaId, 
  isImageMounted, 
  onInView,
  onNearBottom 
}: { 
  chapter: any; 
  index: number; 
  mangaId: string; 
  isImageMounted: boolean;
  onInView: (index: number) => void;
  onNearBottom: (index: number) => void;
}) => {
  const containerRef = React.useRef<HTMLDivElement>(null);
  
  useEffect(() => {
    if (!containerRef.current) return;
    
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          onInView(index);
        }
      });
    }, { rootMargin: '-40% 0px -40% 0px' });
    
    observer.observe(containerRef.current);
    
    const bottomObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          onNearBottom(index);
        }
      });
    }, { rootMargin: '0px 0px 800px 0px' });
    
    bottomObserver.observe(containerRef.current);

    return () => {
      observer.disconnect();
      bottomObserver.disconnect();
    };
  }, [index, onInView, onNearBottom]);

  return (
    <div ref={containerRef} className="space-y-4 rounded-xl border border-border bg-card/50 p-4 sm:p-6 shadow-sm">
      <div className="flex items-center justify-between border-b border-border pb-4">
        <div>
          <h3 className="text-xl font-bold">Bölüm {chapter.number}: {chapter.title}</h3>
          <p className="text-sm text-muted-foreground mt-1">
            {chapter.pages.length} sayfa
          </p>
        </div>
        <Button asChild variant="secondary" size="sm">
          <Link to={`/manga/${mangaId}/chapter/${chapter.id}`}>
            <Play className="h-4 w-4 mr-2" />
            Oku
          </Link>
        </Button>
      </div>
      
      <div className="grid grid-cols-2 gap-2 sm:gap-4 md:gap-6">
        {chapter.pages.map((page: string, pageIndex: number) => (
          <Link key={pageIndex} to={`/manga/${mangaId}/chapter/${chapter.id}?page=${pageIndex + 1}`}>
            <div className="group relative aspect-square overflow-hidden rounded-lg bg-secondary border border-border cursor-pointer shadow-sm">
              {isImageMounted ? (
                <img 
                  src={page} 
                  alt={`Bölüm ${chapter.number} Sayfa ${pageIndex + 1}`}
                  loading="lazy"
                  className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-muted-foreground bg-secondary/30">
                  <div className="animate-pulse w-8 h-8 rounded-full bg-border/50"></div>
                </div>
              )}
              <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center backdrop-blur-sm">
                <span className="text-white font-medium flex items-center gap-2">
                  <Eye className="w-5 h-5"/> Sayfaya Git
                </span>
              </div>
              <div className="absolute bottom-2 right-2 bg-black/70 backdrop-blur-md font-mono text-white text-xs px-2 py-1 rounded shadow">
                {pageIndex + 1}
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
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
  const [chapterSearch, setChapterSearch] = useState('');
  const [activeTab, setActiveTab] = useState('overview');
  const [maxLoadedIndex, setMaxLoadedIndex] = useState(0);
  const [currentViewedIndex, setCurrentViewedIndex] = useState(0);

  const handlePreviewInView = React.useCallback((idx: number) => {
    setCurrentViewedIndex(idx);
  }, []);

  const handlePreviewNearBottom = React.useCallback((idx: number) => {
    setMaxLoadedIndex(prev => Math.max(prev, idx + 1));
  }, []);

  const [reviews, setReviews] = useState<Review[]>([]);
  const [avgBreakdown, setAvgBreakdown] = useState<any>({
    story: 0,
    characters: 0,
    art: 0,
    progression: 0,
    engagement: 0
  });
  const [isReviewModalOpen, setIsReviewModalOpen] = useState(false);
  const [userReview, setUserReview] = useState<Partial<Review>>({
    content: '',
    rating_story: 10,
    rating_characters: 10,
    rating_art: 10,
    rating_progression: 10,
    rating_engagement: 10
  });
  const [isSubmittingReview, setIsSubmittingReview] = useState(false);
  const [similarMangas, setSimilarMangas] = useState<Manga[]>([]);
  const [loadingSimilar, setLoadingSimilar] = useState(false);
  const [mangaCharacters, setMangaCharacters] = useState<any[]>([]);


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
            const [favorited, following, cat, rating, progress, mReviews, uReview] = await Promise.all([
              isFavorite(user.id, mangaId),
              isFollowingManga(user.id, mangaId),
              null as any,
              getUserRating(mangaId, user.id),
              getLatestProgress(user.id, mangaId),
              getReviewsForManga(mangaId),
              getUserReview(mangaId, user.id)
            ]);

            setFavorite(favorited);
            setIsFollowing(following);
            setUserRating(rating);
            setLatestProgress(progress);
            setReviews(mReviews);
            if (uReview) setUserReview(uReview);


            const userFavorites = await getFavorites(user.id);
            const thisFav = userFavorites.find(f => f.mangaId === mangaId);
            if (thisFav) setCategory(thisFav.category);
          } else {
            const mReviews = await getReviewsForManga(mangaId);
            setReviews(mReviews);
          }


          if (avgRating) {
            setAvgBreakdown({
              story: (avgRating as any).story || 0,
              characters: (avgRating as any).characters || 0,
              art: (avgRating as any).art || 0,
              progression: (avgRating as any).progression || 0,
              engagement: (avgRating as any).engagement || 0
            });
          }


          if (mData && mData.genres && mData.genres.length > 0) {
            setLoadingSimilar(true);
            const similar = await getSimilarMangas(mangaId, mData.genres, 6);
            setSimilarMangas(similar);
            setLoadingSimilar(false);
          }


          const chars = await getMangaCharacters(mangaId);
          setMangaCharacters(chars);
        }
      } catch (err) {
        console.error('Error loading manga detail:', err);
      } finally {
        setIsLoading(false);
      }
    };

    loadMangaData();
  }, [mangaId, user?.id]);

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
      await addFavorite(user.id, manga.id, newCategory);
      setFavorite(true);
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

      // Update breakdown as well
      setAvgBreakdown({
        story: (newAvg as any).story || 0,
        characters: (newAvg as any).characters || 0,
        art: (newAvg as any).art || 0,
        progression: (newAvg as any).progression || 0,
        engagement: (newAvg as any).engagement || 0
      });

      toast.success(`${rating}/10 puan verildi!`);
    } catch (err) {
      toast.error('Puan kaydedilemedi');
    }
  };

  const handleReviewSubmit = async () => {
    if (!user) return;
    if (!userReview.content?.trim()) {
      toast.error('Lütfen bir inceleme metni yazın');
      return;
    }

    try {
      setIsSubmittingReview(true);
      await addReview({
        mangaId: manga.id,
        userId: user.id,
        username: user.username,
        userAvatar: user.avatar,
        content: userReview.content,
        rating_story: userReview.rating_story || 10,
        rating_characters: userReview.rating_characters || 10,
        rating_art: userReview.rating_art || 10,
        rating_progression: userReview.rating_progression || 10,
        rating_engagement: userReview.rating_engagement || 10,
      });

      const [newAvg, newReviews] = await Promise.all([
        getAverageRating(manga.id),
        getReviewsForManga(manga.id)
      ]);

      setAverageRating(newAvg);
      setReviews(newReviews);
      setAvgBreakdown({
        story: (newAvg as any).story || 0,
        characters: (newAvg as any).characters || 0,
        art: (newAvg as any).art || 0,
        progression: (newAvg as any).progression || 0,
        engagement: (newAvg as any).engagement || 0
      });

      setIsReviewModalOpen(false);
      toast.success('İncelemeniz başarıyla yayınlandı!');
    } catch (err) {
      toast.error('İnceleme gönderilemedi');
    } finally {
      setIsSubmittingReview(false);
    }
  };

  const toggleLikeReview = async (reviewId: string) => {
    if (!user) {
      toast.error('Beğenmek için giriş yapmalısınız');
      return;
    }

    try {
      await toggleReviewLike(reviewId, user.id);
      const newReviews = await getReviewsForManga(manga.id);
      setReviews(newReviews);
    } catch (err) {
      console.error('Like error:', err);
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

  const filteredChapters = manga.chapters.slice().reverse().filter(ch =>
    ch.number.toString().includes(chapterSearch) ||
    ch.title.toLocaleLowerCase('tr-TR').includes(chapterSearch.toLocaleLowerCase('tr-TR'))
  );

  const displayedChapters = showAllChapters
    ? filteredChapters
    : filteredChapters.slice(0, 8);

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
              src={manga.banner || manga.cover}
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

                <div className="flex flex-wrap items-center gap-2 text-muted-foreground">
                  <div className="flex items-center">
                    {manga.authorDetails ? (
                      <Link to={`/author/${manga.authorDetails.id}`} className="hover:text-primary transition-colors underline-offset-4 hover:underline">
                        {manga.author}
                      </Link>
                    ) : (
                      <span>{manga.author}</span>
                    )}
                    
                    {manga.artist && (
                      <span className="mx-2">•</span>
                    )}
                    
                    {manga.artist && manga.artistDetails ? (
                      <Link to={`/artist/${manga.artistDetails.id}`} className="hover:text-primary transition-colors underline-offset-4 hover:underline">
                        {manga.artist}
                      </Link>
                    ) : manga.artist ? (
                      <span>{manga.artist}</span>
                    ) : null}
                  </div>

                  {manga.releaseYear && (
                    <span className="flex items-center gap-1 text-xs border-l border-border pl-2">
                      <Calendar className="h-3 w-3" />
                      {manga.releaseYear}
                    </span>
                  )}
                </div>

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
                    <Link key={genre} to={`/browse?genre=${encodeURIComponent(genre)}`}>
                      <Badge
                        variant="secondary"
                        className="cursor-pointer hover:bg-secondary/80 transition-colors"
                      >
                        {genre}
                      </Badge>
                    </Link>
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
                      <Link to={`/manga/${manga.id}/chapter/${[...manga.chapters].sort((a, b) => a.number - b.number)[0]?.id}`}>
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

        {/* Tabs System */}
        <div className="container py-8">
          <Tabs value={activeTab} className="w-full" onValueChange={setActiveTab}>
            <TabsList className="mb-8 w-full justify-start border-b rounded-none bg-transparent h-auto p-0 gap-8">
              <TabsTrigger
                value="overview"
                className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent bg-transparent px-0 pb-3 text-lg font-semibold transition-all"
              >
                GENEL BAKIŞ
              </TabsTrigger>
              <TabsTrigger
                value="preview"
                className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent bg-transparent px-0 pb-3 text-lg font-semibold transition-all"
              >
                ÖNİZLEME
              </TabsTrigger>
              <TabsTrigger
                value="reviews"
                className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent bg-transparent px-0 pb-3 text-lg font-semibold transition-all flex items-center gap-2"
              >
                İNCELEMELER
                {reviews.length > 0 && (
                  <Badge variant="secondary" className="bg-primary/10 text-primary hover:bg-primary/20 border-none px-2 h-5 text-[10px]">
                    {reviews.length}
                  </Badge>
                )}
              </TabsTrigger>
              <TabsTrigger
                value="characters"
                className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent bg-transparent px-0 pb-3 text-lg font-semibold transition-all flex items-center gap-2"
              >
                KARAKTERLER
                {mangaCharacters.length > 0 && (
                  <Badge variant="secondary" className="bg-primary/10 text-primary hover:bg-primary/20 border-none px-2 h-5 text-[10px]">
                    {mangaCharacters.length}
                  </Badge>
                )}
              </TabsTrigger>
              <TabsTrigger
                value="discover"
                className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent bg-transparent px-0 pb-3 text-lg font-semibold transition-all flex items-center gap-2"
              >
                KEŞFET
              </TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="animate-in fade-in slide-in-from-bottom-4 duration-500">
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                {/* Chapters List */}
                <div className="lg:col-span-2 space-y-8">
                  <div className="rounded-xl border border-border bg-card/50 overflow-hidden">
                    <div className="border-b border-border p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                      <div>
                        <h2 className="text-xl font-bold">Bölümler</h2>
                        <p className="text-sm text-muted-foreground">{manga.chapters.length} bölüm mevcut</p>
                      </div>
                      <div className="relative w-full sm:w-64">
                        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        <Input
                          placeholder="Bölüm ara (örn: 97)"
                          className="pl-9"
                          value={chapterSearch}
                          onChange={(e) => setChapterSearch(e.target.value)}
                        />
                      </div>
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

                        {filteredChapters.length > 8 && (
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
                                  Tüm Bölümleri Göster ({filteredChapters.length - 8} daha)
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

                {/* Sidebar Info */}
                <div className="space-y-6">
                  <div 
                    className="rounded-xl border border-border bg-card/50 p-6 cursor-pointer hover:bg-card/70 transition-colors group"
                    onClick={() => setActiveTab('reviews')}
                  >
                    <h2 className="text-lg font-semibold mb-4 text-center group-hover:text-primary transition-colors">
                      {userRating ? 'Puanınız' : 'Puan Ver'}
                      <ArrowRight className="inline-block ml-2 h-4 w-4 opacity-0 group-hover:opacity-100 transition-all -translate-x-2 group-hover:translate-x-0" />
                    </h2>
                    <div className="flex flex-col gap-4">
                      <div className="flex gap-1 justify-center">
                        {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((star) => (
                          <div
                            key={star}
                            className="p-1"
                          >
                            <Star
                              className={`h-5 w-5 transition-colors ${star <= (userRating || 0)
                                ? 'fill-yellow-400 text-yellow-400'
                                : 'text-muted-foreground'
                                }`}
                            />
                          </div>
                        ))}
                      </div>
                      <div className="text-sm text-center text-muted-foreground group-hover:text-foreground transition-colors">
                        {userRating ? (
                          <span>Puanınız: <strong className="text-foreground">{userRating}/10</strong></span>
                        ) : (
                          <span>Puanlamak için tıklayın</span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="rounded-xl border border-border bg-primary/5 p-6 border-primary/20">
                    <h3 className="font-semibold mb-2">Hızlı Erişim</h3>
                    <p className="text-sm text-muted-foreground mb-4">Manga hakkında daha fazla bilgi ve tartışma için incelemeler sekmesine göz atın.</p>
                    <Button variant="outline" className="w-full group" onClick={() => setActiveTab('reviews')}>
                      İncelemeleri Gör
                      <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-1" />
                    </Button>
                  </div>
                </div>
              </div>

              <div className="mt-8 rounded-xl border border-border bg-card/50 p-6 lg:p-10 shadow-sm">
                <CommentSection mangaId={manga.id} />
              </div>
            </TabsContent>

            <TabsContent value="preview" className="animate-in fade-in slide-in-from-bottom-4 duration-500">
              <div className="space-y-8 max-w-4xl mx-auto">
                {(() => {
                  const sortedChaptersAsc = [...manga.chapters].sort((a, b) => a.number - b.number);
                  const displayedPreviewChapters = sortedChaptersAsc.slice(0, maxLoadedIndex + 1);
                  
                  if (sortedChaptersAsc.length === 0) {
                    return <div className="text-center rounded-xl border border-border bg-card/50 text-muted-foreground p-8">Henüz bölüm eklenmemiş</div>;
                  }

                  return (
                    <>
                      {displayedPreviewChapters.map((chapter, index) => {
                        // Only mount images for current, previous, and next chapters (max 3 loaded in memory)
                        const isImageMounted = Math.abs(index - currentViewedIndex) <= 1;
                        
                        return (
                          <PreviewChapter 
                            key={chapter.id}
                            chapter={chapter}
                            index={index}
                            mangaId={manga.id}
                            isImageMounted={isImageMounted}
                            onInView={handlePreviewInView}
                            onNearBottom={handlePreviewNearBottom}
                          />
                        );
                      })}
                      
                      {maxLoadedIndex < sortedChaptersAsc.length - 1 && (
                        <div className="flex justify-center p-8 bg-card/20 rounded-xl" style={{ minHeight: '100px' }}>
                          <span className="text-muted-foreground flex items-center gap-2">
                             <div className="animate-spin w-4 h-4 border-2 border-primary border-t-transparent rounded-full" />
                             Sonraki bölüm yükleniyor...
                          </span>
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>
            </TabsContent>

            <TabsContent value="characters" className="animate-in fade-in slide-in-from-bottom-4 duration-500">
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-6">
                {mangaCharacters.map((char) => (
                  <Link key={char.id} to={`/character/${char.id}`} className="group space-y-3">
                    <div className="relative aspect-[3/4] rounded-xl overflow-hidden shadow-lg border border-border bg-secondary/30">
                      <img
                        src={char.imageUrl || 'https://via.placeholder.com/300x400?text=Karakter'}
                        className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
                        alt={char.name}
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-3">
                        <div className="text-white text-xs font-bold flex items-center gap-1">
                          <Heart className="h-3 w-3 fill-current" /> {char.likesCount}
                        </div>
                      </div>
                    </div>
                    <h3 className="text-center font-bold text-sm truncate group-hover:text-primary transition-colors">{char.name}</h3>
                  </Link>
                ))}
                {mangaCharacters.length === 0 && (
                  <div className="col-span-full py-20 text-center text-muted-foreground italic bg-secondary/10 rounded-2xl border border-dashed border-border">
                    Bu seri için henüz karakter eklenmemiş.
                  </div>
                )}
              </div>
            </TabsContent>

            <TabsContent value="reviews" className="animate-in fade-in slide-in-from-bottom-4 duration-500">
              <div className="rounded-xl border border-border bg-card/50 p-8 shadow-xl">
                {/* Reviews Summary */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-12 items-center mb-12">
                  <div className="text-center md:border-r border-border py-4">
                    <div className="text-7xl font-black mb-2 tracking-tighter text-foreground">{averageRating.average || '0'}</div>
                    <div className="flex justify-center gap-0.5 mb-2">
                      {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((star) => (
                        <Star key={star} className={`h-4 w-4 ${star <= Math.round(averageRating.average) ? 'fill-yellow-400 text-yellow-400' : 'text-muted-foreground'}`} />
                      ))}
                    </div>
                    <div className="text-muted-foreground font-medium">{reviews.length} inceleme</div>
                  </div>

                  <div className="lg:col-span-2 space-y-3">
                    {[
                      { label: 'Hikaye', value: avgBreakdown.story },
                      { label: 'Karakterler', value: avgBreakdown.characters },
                      { label: 'Çizim', value: avgBreakdown.art },
                      { label: 'İlerleyiş', value: avgBreakdown.progression },
                      { label: 'Sürükleyicilik', value: avgBreakdown.engagement },
                    ].map((item) => (
                      <div key={item.label} className="flex items-center gap-4">
                        <span className="text-sm font-medium w-24 text-muted-foreground">{item.label}</span>
                        <Progress value={item.value * 10} className="h-2 flex-1" />
                        <span className="text-sm font-bold w-12 text-right">{item.value.toFixed(1)}</span>
                      </div>
                    ))}

                    <div className="pt-6 flex justify-end">
                      <Dialog open={isReviewModalOpen} onOpenChange={setIsReviewModalOpen}>
                        <DialogTrigger asChild>
                          <Button variant="glow" size="lg" className="rounded-full px-8 shadow-lg shadow-primary/20">
                            {userReview?.id ? (
                              <>
                                <Edit3 className="mr-2 h-4 w-4" />
                                İncelemeyi Düzenle
                              </>
                            ) : (
                              <>
                                <Plus className="mr-2 h-4 w-4" />
                                İnceleme Yaz
                              </>
                            )}
                          </Button>
                        </DialogTrigger>
                        <DialogContent className="sm:max-w-[600px] bg-card/95 backdrop-blur-xl border-primary/20">
                          <DialogHeader>
                            <DialogTitle className="text-2xl font-bold">
                              {userReview.id ? 'İncelemeyi Düzenle' : 'İnceleme Yaz'}
                            </DialogTitle>
                            <DialogDescription>
                              {userReview.id ? 'Mevcut incelemenizi güncelleyin.' : 'Manga hakkındaki görüşlerinizi ayrıntılı olarak paylaşın.'}
                            </DialogDescription>
                          </DialogHeader>

                          <div className="space-y-6 py-4">
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                              {[
                                { label: 'Hikaye', key: 'rating_story' },
                                { label: 'Karakterler', key: 'rating_characters' },
                                { label: 'Çizim', key: 'rating_art' },
                                { label: 'İlerleyiş', key: 'rating_progression' },
                                { label: 'Sürükleyicilik', key: 'rating_engagement' },
                              ].map((item) => (
                                <div key={item.label} className="space-y-2">
                                  <div className="flex justify-between text-sm font-medium">
                                    <span>{item.label}</span>
                                    <span className="text-primary">{userReview[item.key as keyof Partial<Review>]}/10</span>
                                  </div>
                                  <div className="flex gap-1">
                                    {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((star) => (
                                      <button
                                        key={star}
                                        onClick={() => setUserReview(prev => ({ ...prev, [item.key]: star }))}
                                        className="p-0.5"
                                      >
                                        <Star
                                          className={`h-4 w-4 ${star <= (userReview[item.key as keyof Partial<Review>] as number) ? 'fill-yellow-400 text-yellow-400' : 'text-muted-foreground'}`}
                                        />
                                      </button>
                                    ))}
                                  </div>
                                </div>
                              ))}
                            </div>

                            <div className="space-y-2">
                              <label className="text-sm font-medium">İncelemeniz</label>
                              <Textarea
                                placeholder="Manga hakkındaki düşünceleriniz..."
                                className="min-h-[120px] resize-none bg-secondary/30"
                                value={userReview.content}
                                onChange={(e) => setUserReview(prev => ({ ...prev, content: e.target.value }))}
                              />
                            </div>
                          </div>

                          <DialogFooter>
                            <Button variant="ghost" onClick={() => setIsReviewModalOpen(false)}>İptal</Button>
                            <Button variant="glow" onClick={handleReviewSubmit} disabled={isSubmittingReview}>
                              {isSubmittingReview ? 'Kaydediliyor...' : (userReview.id ? 'Güncelle' : 'Yayınla')}
                            </Button>
                          </DialogFooter>
                        </DialogContent>
                      </Dialog>
                    </div>
                  </div>
                </div>

                {/* Reviews List */}
                <div className="space-y-6">
                  <h3 className="text-xl font-bold mb-6 flex items-center gap-2">
                    <MessageSquare className="h-5 w-5 text-primary" />
                    Kullanıcı İncelemeleri
                  </h3>

                  {reviews.length > 0 ? (
                    <div className="grid grid-cols-1 gap-6">
                      {reviews.map((review) => (
                        <div key={review.id} className="rounded-xl border border-border bg-card/30 p-6 transition-all hover:bg-card/50">
                          <div className="flex justify-between items-start mb-4">
                            <div className="flex gap-4">
                              <Avatar className="h-12 w-12 border-2 border-primary/20">
                                <AvatarImage src={review.userAvatar} />
                                <AvatarFallback>{review.username.substring(0, 2).toUpperCase()}</AvatarFallback>
                              </Avatar>
                              <div>
                                <div className="flex items-center gap-2">
                                  <h4 className="font-bold">{review.username}</h4>
                                  {/* Optional LV badge can go here */}
                                </div>
                                <p className="text-xs text-muted-foreground">{formatDate(review.createdAt)}</p>
                              </div>
                            </div>
                            <div className="flex gap-0.5 text-yellow-400">
                              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((star) => {
                                const avg = (review.rating_story + review.rating_characters + review.rating_art + review.rating_progression + review.rating_engagement) / 5;
                                return <Star key={star} className={`h-3 w-3 ${star <= Math.round(avg) ? 'fill-current' : 'text-muted-foreground'}`} />;
                              })}
                            </div>
                          </div>

                          <p className="text-foreground/90 leading-relaxed mb-6 whitespace-pre-wrap">{review.content}</p>

                          <div className="flex flex-wrap gap-4 text-xs text-muted-foreground mb-6 bg-secondary/20 p-3 rounded-lg">
                            <span>Hikaye: <strong className="text-foreground">{review.rating_story}/10</strong></span>
                            <span>Karakterler: <strong className="text-foreground">{review.rating_characters}/10</strong></span>
                            <span>Çizim: <strong className="text-foreground">{review.rating_art}/10</strong></span>
                            <span>İlerleyiş: <strong className="text-foreground">{review.rating_progression}/10</strong></span>
                            <span>Sürükleyicilik: <strong className="text-foreground">{review.rating_engagement}/10</strong></span>
                          </div>

                          <div className="flex items-center justify-between border-t border-border pt-4">
                            <Button
                              variant="ghost"
                              size="sm"
                              className={`gap-2 ${review.likedBy.includes(user?.id || '') ? 'text-primary bg-primary/10' : ''}`}
                              onClick={() => toggleLikeReview(review.id)}
                            >
                              <ThumbsUp className={`h-4 w-4 ${review.likedBy.includes(user?.id || '') ? 'fill-current' : ''}`} />
                              <span>{review.likes}</span>
                            </Button>

                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-20 bg-secondary/10 rounded-xl border border-dashed border-border">
                      <MessageSquare className="h-12 w-12 text-muted-foreground mx-auto mb-4 opacity-20" />
                      <p className="text-muted-foreground">Henüz inceleme yapılmamış. İlk inceleyen siz olun!</p>
                    </div>
                  )}
                </div>
              </div>
            </TabsContent>

            <TabsContent value="discover" className="animate-in fade-in slide-in-from-bottom-4 duration-500">
              <div className="rounded-xl border border-border bg-card/50 p-8">
                <div className="flex items-center justify-between mb-6">
                  <div>
                    <h3 className="text-2xl font-bold">Benzer Seriler</h3>
                    <p className="text-muted-foreground text-sm mt-1">
                      {manga?.genres?.slice(0, 3).join(', ')} türlerinde diğer popüler seriler
                    </p>
                  </div>
                  <Button variant="outline" asChild>
                    <Link to="/browse">Tüm Serilere Göz At</Link>
                  </Button>
                </div>

                {loadingSimilar ? (
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
                    {[1, 2, 3, 4, 5, 6].map(i => (
                      <div key={i} className="animate-pulse">
                        <div className="aspect-[2/3] bg-muted rounded-lg" />
                        <div className="h-4 bg-muted rounded mt-2 w-3/4" />
                      </div>
                    ))}
                  </div>
                ) : similarMangas.length > 0 ? (
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
                    {similarMangas.map((m) => (
                      <Link
                        key={m.id}
                        to={`/manga/${m.id}`}
                        className="group relative overflow-hidden rounded-lg border border-border bg-card transition-all hover:border-primary/50 hover:shadow-lg hover:shadow-primary/10"
                      >
                        <div className="aspect-[2/3] overflow-hidden">
                          <img
                            src={m.cover}
                            alt={m.title}
                            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                          />
                          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                        </div>
                        <div className="absolute bottom-0 left-0 right-0 p-3 translate-y-full group-hover:translate-y-0 transition-transform">
                          <h4 className="text-sm font-semibold text-white line-clamp-2">{m.title}</h4>
                          <div className="flex items-center gap-2 mt-1">
                            <Badge variant="secondary" className="text-[10px] px-1.5 h-5">
                              {m.type.toUpperCase()}
                            </Badge>
                            {(m as any).averageRating > 0 && (
                              <span className="text-xs text-yellow-400 flex items-center gap-0.5">
                                <Star className="h-3 w-3 fill-current" />
                                {(m as any).averageRating}
                              </span>
                            )}
                          </div>
                        </div>
                        {/* Always visible title overlay */}
                        <div className="absolute bottom-0 left-0 right-0 p-2 bg-gradient-to-t from-black/90 to-transparent group-hover:opacity-0 transition-opacity">
                          <h4 className="text-xs font-medium text-white line-clamp-2">{m.title}</h4>
                        </div>
                      </Link>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-16 bg-secondary/10 rounded-xl border border-dashed border-border">
                    <BookOpen className="h-12 w-12 text-muted-foreground mx-auto mb-4 opacity-20" />
                    <p className="text-muted-foreground">Benzer seri bulunamadı.</p>
                    <p className="text-sm text-muted-foreground/70 mt-1">
                      Daha fazla içerik eklendiğinde öneriler burada görünecek.
                    </p>
                  </div>
                )}
              </div>
            </TabsContent>
          </Tabs>
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
