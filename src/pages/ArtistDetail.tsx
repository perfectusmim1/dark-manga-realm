import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Heart, BookOpen, ArrowLeft, Calendar } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { getArtistById, toggleEntityLike } from '@/lib/database';
import { Artist } from '@/lib/types';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import Header from '@/components/layout/Header';
import CommentSection from '@/components/comments/CommentSection';
import EntityPlaceholderArt from '@/components/entities/EntityPlaceholderArt';
import EntityDetailRankBadge from '@/components/entities/EntityDetailRankBadge';
import EntitySeriesGrid from '@/components/entities/EntitySeriesGrid';
import { supabase } from '@/lib/supabase';
import OfflineRequiredScreen from '@/components/offline/OfflineRequiredScreen';
import { useEffectiveOnlineStatus } from '@/hooks/useEffectiveOnlineStatus';
import OptimizedImage from '@/components/media/OptimizedImage';
import DeferredMount from '@/components/performance/DeferredMount';

const ArtistDetail: React.FC = () => {
    const { id } = useParams<{ id: string }>();
    const { user } = useAuth();
    const { isOnline } = useEffectiveOnlineStatus();
    const [artist, setArtist] = useState<Artist | null>(null);
    const [loading, setLoading] = useState(true);
    const [isLiked, setIsLiked] = useState(false);

    if (!isOnline) {
        return (
            <OfflineRequiredScreen
                description="Çizer sayfaları internet bağlantısı gerektirir."
                actionHref="/downloads"
                actionLabel="İndirilenlere Git"
            />
        );
    }

    useEffect(() => {
        const fetchArtist = async () => {
            if (!id) return;
            try {
                const data = await getArtistById(id);
                if (data) {
                    setArtist(data);
                    // Check if liked
                    if (user) {
                        const { data: liked } = await supabase
                            .from('artist_likes')
                            .select('*')
                            .eq('artist_id', id)
                            .eq('user_id', user.id)
                            .maybeSingle();
                        setIsLiked(!!liked);
                    }
                }
            } catch (error) {
                console.error(error);
                toast.error('Çizer bilgileri yüklenemedi');
            } finally {
                setLoading(false);
            }
        };

        fetchArtist();
    }, [id, user]);

    const handleLike = async () => {
        if (!user) {
            toast.error('Bu işlemi yapmak için giriş yapmalısınız');
            return;
        }

        try {
            await toggleEntityLike('artist', id!, user.id);
            setIsLiked(!isLiked);
            // Update local count
            if (artist) {
                setArtist({
                    ...artist,
                    likesCount: isLiked ? artist.likesCount - 1 : artist.likesCount + 1
                });
            }
            toast.success(isLiked ? 'Beğeni kaldırıldı' : 'Beğenildi');
        } catch (error) {
            toast.error('İşlem başarısız oldu');
        }
    };

    if (loading) {
        return (
            <div className="min-h-screen bg-background flex items-center justify-center">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
            </div>
        );
    }

    if (!artist) {
        return (
            <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-4">
                <h1 className="text-2xl font-bold">Çizer Bulunamadı</h1>
                <Button asChild variant="outline">
                    <Link to="/artists">Çizerlere Dön</Link>
                </Button>
            </div>
        );
    }

    const hasDescription = Boolean(artist.description?.trim());

    return (
        <div className="min-h-screen bg-background flex flex-col pt-16">
            <Header />

            <main className="flex-1 container mx-auto px-4 py-8 max-w-6xl">
                <Link to="/artists" className="inline-flex items-center text-muted-foreground hover:text-primary mb-6 transition-colors">
                    <ArrowLeft className="mr-2 h-4 w-4" />
                    Tüm Çizerler
                </Link>

                <div className="grid gap-8 md:grid-cols-[minmax(0,18rem),minmax(0,1fr)] xl:grid-cols-[minmax(0,19rem),minmax(0,1fr)]">
                    {/* Left Side - Image & Stats */}
                    <div className="space-y-6 md:max-w-[19rem]">
                        <div className="relative group">
                            <div className="absolute -inset-1 bg-gradient-to-r from-primary/50 to-purple-600/50 rounded-2xl blur opacity-25 group-hover:opacity-100 transition duration-500" />
                            <div className="relative aspect-[3/4] rounded-xl overflow-hidden border border-border shadow-2xl bg-card flex flex-col items-center justify-center">
                                {artist.imageUrl ? (
                                    <OptimizedImage
                                        src={artist.imageUrl}
                                        alt={artist.name}
                                        priority
                                        containerClassName="h-full w-full"
                                        placeholderClassName="rounded-none"
                                        className="w-full h-full object-cover"
                                    />
                                ) : (
                                    <EntityPlaceholderArt
                                        name={artist.name}
                                        initialClassName="text-8xl md:text-9xl"
                                    />
                                )}
                                {artist.rank && artist.rank <= 3 && (
                                    <div className="absolute top-4 left-4">
                                        <EntityDetailRankBadge rank={artist.rank} />
                                    </div>
                                )}
                            </div>
                        </div>

                        <div className="flex gap-4">
                            <Button
                                variant={isLiked ? "default" : "outline"}
                                size="lg"
                                className="flex-1 rounded-xl shadow-lg hover:scale-[1.02] transition-transform"
                                onClick={handleLike}
                            >
                                <Heart className={`mr-2 h-5 w-5 ${isLiked ? 'fill-current' : ''}`} />
                                {artist.likesCount || 0}
                            </Button>
                            {artist.rank && (
                                <div className="w-20 h-11 flex items-center justify-center rounded-xl bg-secondary border border-border">
                                    <span className="text-xl font-bold">#{artist.rank}</span>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Right Side - Info */}
                    <div className="space-y-8">
                        <div>
                            <h1 className="text-4xl md:text-5xl font-black bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text text-transparent">
                                {artist.name}
                            </h1>
                            <div className="flex items-center gap-4 mt-4 text-muted-foreground">
                                <div className="flex items-center gap-1">
                                    <Calendar className="h-4 w-4" />
                                    <span>{new Date(artist.createdAt || Date.now()).getFullYear()}'de Eklendi</span>
                                </div>
                            </div>
                        </div>

                        <div className="space-y-4">
                            <h2 className="text-2xl font-bold flex items-center gap-2">
                                <BookOpen className="h-6 w-6 text-primary" />
                                Çizimlerini Yaptığı Seriler
                            </h2>
                            <EntitySeriesGrid
                                mangas={artist.series}
                                emptyText="Henüz bir seriyle ilişkilendirilmemiş."
                            />
                        </div>

                        {hasDescription && (
                            <div className="space-y-4">
                                <h2 className="text-2xl font-bold">Hakkında</h2>
                                <div className="bg-secondary/30 rounded-2xl p-6 border border-border leading-relaxed text-lg italic text-foreground/90 whitespace-pre-line">
                                    {artist.description}
                                </div>
                            </div>
                        )}

                        <Separator className="my-8" />

                        <DeferredMount placeholderMinHeight={360} rootMargin="720px 0px">
                            <div className="space-y-6">
                                <CommentSection entityId={id} entityType="artist" />
                            </div>
                        </DeferredMount>
                    </div>
                </div>
            </main>
        </div>
    );
};

export default ArtistDetail;
