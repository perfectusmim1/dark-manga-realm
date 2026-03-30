import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Heart, BookOpen, ArrowLeft, Calendar } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { getAuthorById, toggleEntityLike } from '@/lib/database';
import { Author } from '@/lib/types';
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

const AuthorDetail: React.FC = () => {
    const { id } = useParams<{ id: string }>();
    const { user } = useAuth();
    const { isOnline } = useEffectiveOnlineStatus();
    const [author, setAuthor] = useState<Author | null>(null);
    const [loading, setLoading] = useState(true);
    const [isLiked, setIsLiked] = useState(false);

    if (!isOnline) {
        return (
            <OfflineRequiredScreen
                description="Yazar sayfaları internet bağlantısı gerektirir."
                actionHref="/downloads"
                actionLabel="İndirilenlere Git"
            />
        );
    }

    useEffect(() => {
        const fetchAuthor = async () => {
            if (!id) return;
            try {
                const data = await getAuthorById(id);
                if (data) {
                    setAuthor(data);
                    // Check if liked
                    if (user) {
                        const { data: liked } = await supabase
                            .from('author_likes')
                            .select('*')
                            .eq('author_id', id)
                            .eq('user_id', user.id)
                            .maybeSingle();
                        setIsLiked(!!liked);
                    }
                }
            } catch (error) {
                console.error(error);
                toast.error('Yazar bilgileri yüklenemedi');
            } finally {
                setLoading(false);
            }
        };

        fetchAuthor();
    }, [id, user]);

    const handleLike = async () => {
        if (!user) {
            toast.error('Bu işlemi yapmak için giriş yapmalısınız');
            return;
        }

        try {
            await toggleEntityLike('author', id!, user.id);
            setIsLiked(!isLiked);
            // Update local count
            if (author) {
                setAuthor({
                    ...author,
                    likesCount: isLiked ? author.likesCount - 1 : author.likesCount + 1
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

    if (!author) {
        return (
            <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-4">
                <h1 className="text-2xl font-bold">Yazar Bulunamadı</h1>
                <Button asChild variant="outline">
                    <Link to="/authors">Yazarlara Dön</Link>
                </Button>
            </div>
        );
    }

    const hasDescription = Boolean(author.description?.trim());
    const descriptionSection = hasDescription ? (
        <div className="space-y-4">
            <h2 className="text-2xl font-bold">Hakkında</h2>
            <div className="bg-secondary/30 rounded-2xl p-6 border border-border leading-relaxed text-lg italic text-foreground/90 whitespace-pre-line">
                {author.description}
            </div>
        </div>
    ) : null;
    const seriesSection = (
        <div className="space-y-4">
            <h2 className="text-2xl font-bold flex items-center gap-2">
                <BookOpen className="h-6 w-6 text-primary" />
                Katkıda Bulunduğu Seriler
            </h2>
            <EntitySeriesGrid
                mangas={author.series}
                emptyText="Henüz bir seriyle ilişkilendirilmemiş."
            />
        </div>
    );

    return (
        <div className="min-h-screen bg-background flex flex-col pt-16">
            <Header />

            <main className="flex-1 container mx-auto px-4 py-8 max-w-6xl">
                <Link to="/authors" className="inline-flex items-center text-muted-foreground hover:text-primary mb-6 transition-colors">
                    <ArrowLeft className="mr-2 h-4 w-4" />
                    Tüm Yazarlar
                </Link>

                <div className="grid gap-8 md:grid-cols-[minmax(0,18rem),minmax(0,1fr)] xl:grid-cols-[minmax(0,19rem),minmax(0,1fr)]">
                    {/* Left Side - Image & Stats */}
                    <div className="space-y-6 md:max-w-[19rem]">
                        <div className="relative group">
                            <div className="absolute -inset-1 bg-gradient-to-r from-primary/50 to-purple-600/50 rounded-2xl blur opacity-25 group-hover:opacity-100 transition duration-500" />
                            <div className="relative aspect-[3/4] rounded-xl overflow-hidden border border-border shadow-2xl bg-card flex flex-col items-center justify-center">
                                {author.imageUrl ? (
                                    <OptimizedImage
                                        src={author.imageUrl}
                                        alt={author.name}
                                        priority
                                        containerClassName="h-full w-full"
                                        placeholderClassName="rounded-none"
                                        className="w-full h-full object-cover"
                                    />
                                ) : (
                                    <EntityPlaceholderArt
                                        name={author.name}
                                        initialClassName="text-8xl md:text-9xl"
                                    />
                                )}
                                {author.rank && author.rank <= 3 && (
                                    <div className="absolute top-4 left-4">
                                        <EntityDetailRankBadge rank={author.rank} />
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
                                {author.likesCount || 0}
                            </Button>
                            {author.rank && (
                                <div className="w-20 h-11 flex items-center justify-center rounded-xl bg-secondary border border-border">
                                    <span className="text-xl font-bold">#{author.rank}</span>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Right Side - Info */}
                    <div className="space-y-8">
                        <div>
                            <h1 className="text-4xl md:text-5xl font-black bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text text-transparent">
                                {author.name}
                            </h1>
                            <div className="flex items-center gap-4 mt-4 text-muted-foreground">
                                <div className="flex items-center gap-1">
                                    <Calendar className="h-4 w-4" />
                                    <span>{new Date(author.createdAt || Date.now()).getFullYear()}'de Eklendi</span>
                                </div>
                            </div>
                        </div>

                        {descriptionSection}
                        {seriesSection}

                        <Separator className="my-8" />

                        <DeferredMount placeholderMinHeight={360} rootMargin="720px 0px">
                            <div className="space-y-6">
                                <CommentSection entityId={id} entityType="author" />
                            </div>
                        </DeferredMount>
                    </div>
                </div>
            </main>
        </div>
    );
};

export default AuthorDetail;
