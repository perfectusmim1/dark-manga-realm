import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Heart, BookOpen, ArrowLeft, Calendar } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { getArtistById, toggleEntityLike } from '@/lib/database';
import { Artist } from '@/lib/types';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import Header from '@/components/layout/Header';
import { supabase } from '@/lib/supabase';

const ArtistDetail: React.FC = () => {
    const { id } = useParams<{ id: string }>();
    const { user } = useAuth();
    const [artist, setArtist] = useState<Artist | null>(null);
    const [loading, setLoading] = useState(true);
    const [isLiked, setIsLiked] = useState(false);

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

    return (
        <div className="min-h-screen bg-background flex flex-col pt-16">
            <Header />

            <main className="flex-1 container mx-auto px-4 py-8 max-w-6xl">
                <Link to="/artists" className="inline-flex items-center text-muted-foreground hover:text-primary mb-6 transition-colors">
                    <ArrowLeft className="mr-2 h-4 w-4" />
                    Tüm Çizerler
                </Link>

                <div className="grid gap-8 md:grid-cols-[1fr,2fr]">
                    {/* Left Side - Image & Stats */}
                    <div className="space-y-6">
                        <div className="relative group">
                            <div className="absolute -inset-1 bg-gradient-to-r from-primary/50 to-purple-600/50 rounded-2xl blur opacity-25 group-hover:opacity-100 transition duration-500" />
                            <div className="relative aspect-[3/4] rounded-xl overflow-hidden border border-border shadow-2xl bg-card flex flex-col items-center justify-center">
                                {artist.imageUrl ? (
                                    <img
                                        src={artist.imageUrl}
                                        alt={artist.name}
                                        className="w-full h-full object-cover"
                                    />
                                ) : (
                                    <span className="text-8xl font-black text-muted-foreground/30">{artist.name.charAt(0)}</span>
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
                            <div className="flex flex-wrap gap-3">
                                {artist.series && artist.series.length > 0 ? (
                                    artist.series.map(s => (
                                        <Link
                                            key={s.id}
                                            to={`/manga/${s.id}`}
                                            className="group relative"
                                        >
                                            <div className="absolute -inset-0.5 bg-gradient-to-r from-primary to-purple-600 rounded-lg blur opacity-0 group-hover:opacity-40 transition" />
                                            <Badge variant="secondary" className="relative px-4 py-2 text-md rounded-lg cursor-pointer bg-card border-border hover:bg-secondary">
                                                {s.title}
                                            </Badge>
                                        </Link>
                                    ))
                                ) : (
                                    <p className="text-muted-foreground">Henüz bir seriyle ilişkilendirilmemiş.</p>
                                )}
                            </div>
                        </div>

                        <div className="space-y-4">
                            <h2 className="text-2xl font-bold">Hakkında</h2>
                            <div className="bg-secondary/30 rounded-2xl p-6 border border-border leading-relaxed text-lg italic text-foreground/90 whitespace-pre-line">
                                {artist.description || 'Bu çizer için henüz bir bilgi girişi yapılmamış.'}
                            </div>
                        </div>
                    </div>
                </div>
            </main>
        </div>
    );
};

export default ArtistDetail;
