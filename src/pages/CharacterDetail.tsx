import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Heart, Trophy, BookOpen, MessageCircle, ArrowLeft, Calendar } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import { getCharacterById, toggleEntityLike, getEntityComments, addEntityComment } from '@/lib/database';
import { Character, Comment } from '@/lib/types';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import Header from '@/components/layout/Header';

const CharacterDetail: React.FC = () => {
    const { id } = useParams<{ id: string }>();
    const { user } = useAuth();
    const [character, setCharacter] = useState<Character | null>(null);
    const [comments, setComments] = useState<Comment[]>([]);
    const [loading, setLoading] = useState(true);
    const [commentInput, setCommentInput] = useState('');
    const [isLiked, setIsLiked] = useState(false);

    useEffect(() => {
        const loadData = async () => {
            if (!id) return;
            try {
                const char = await getCharacterById(id);
                if (char) {
                    setCharacter(char);
                    // Check if liked - simplified for now
                }
                const comms = await getEntityComments('character', id);
                setComments(comms);
            } catch (err) {
                console.error(err);
            } finally {
                setLoading(false);
            }
        };
        loadData();
    }, [id]);

    const handleLike = async () => {
        if (!user) {
            toast.error('Lütfen önce giriş yapın');
            return;
        }
        if (!id || !character) return;
        try {
            await toggleEntityLike('character', id, user.id);
            setIsLiked(!isLiked);
            setCharacter(prev => prev ? {
                ...prev,
                likesCount: isLiked ? prev.likesCount - 1 : prev.likesCount + 1
            } : null);
            toast.success(isLiked ? 'Beğeni kaldırıldı' : 'Beğenildi');
        } catch (err) {
            toast.error('Bir hata oluştu');
        }
    };

    const handleComment = async () => {
        if (!user) {
            toast.error('Giriş yapmalısınız');
            return;
        }
        if (!commentInput.trim()) return;
        try {
            await addEntityComment('character', id!, user.id, commentInput);
            setCommentInput('');
            const comms = await getEntityComments('character', id!);
            setComments(comms);
            toast.success('Yorum yapıldı');
        } catch (err) {
            toast.error('Yorum gönderilemedi');
        }
    };

    if (loading) return <div className="min-h-screen bg-background" />;
    if (!character) return <div className="min-h-screen bg-background flex items-center justify-center">Karakter bulunamadı</div>;

    return (
        <div className="min-h-screen bg-background flex flex-col pt-16">
            <Header />

            <main className="flex-1 container mx-auto px-4 py-8 max-w-6xl">
                <Link to="/" className="inline-flex items-center text-muted-foreground hover:text-primary mb-6 transition-colors">
                    <ArrowLeft className="mr-2 h-4 w-4" />
                    Geri Dön
                </Link>

                <div className="grid gap-8 md:grid-cols-[1fr,2fr]">
                    {/* Left Side - Image & Stats */}
                    <div className="space-y-6">
                        <div className="relative group">
                            <div className="absolute -inset-1 bg-gradient-to-r from-primary/50 to-purple-600/50 rounded-2xl blur opacity-25 group-hover:opacity-100 transition duration-500" />
                            <div className="relative aspect-[3/4] rounded-xl overflow-hidden border border-border shadow-2xl bg-card">
                                <img
                                    src={character.imageUrl || 'https://via.placeholder.com/300x400?text=No+Image'}
                                    alt={character.name}
                                    className="w-full h-full object-cover"
                                />
                                {character.rank === 1 && (
                                    <div className="absolute top-4 left-4">
                                        <Badge className="bg-yellow-500 text-black font-bold px-3 py-1 text-sm shadow-lg">
                                            <Trophy className="mr-2 h-4 w-4" />
                                            #1 RANK
                                        </Badge>
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
                                {character.likesCount} Kalp
                            </Button>
                            {character.rank && (
                                <div className="w-20 h-11 flex items-center justify-center rounded-xl bg-secondary border border-border">
                                    <span className="text-xl font-bold">#{character.rank}</span>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Right Side - Info */}
                    <div className="space-y-8">
                        <div>
                            <h1 className="text-4xl md:text-5xl font-black bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text text-transparent">
                                {character.name}
                            </h1>
                            <div className="flex items-center gap-4 mt-4 text-muted-foreground">
                                <div className="flex items-center gap-1">
                                    <Calendar className="h-4 w-4" />
                                    <span>{new Date(character.createdAt).getFullYear()}'de Eklendi</span>
                                </div>
                            </div>
                        </div>

                        <div className="space-y-4">
                            <h2 className="text-2xl font-bold flex items-center gap-2">
                                <BookOpen className="h-6 w-6 text-primary" />
                                Seri Bağlantıları
                            </h2>
                            <div className="flex flex-wrap gap-3">
                                {character.series && character.series.length > 0 ? (
                                    character.series.map(s => (
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
                            <h2 className="text-2xl font-bold">Hikayesi / Tanımı</h2>
                            <div className="bg-secondary/30 rounded-2xl p-6 border border-border leading-relaxed text-lg italic text-foreground/90">
                                {character.description || 'Bu karakter için henüz bir hikaye girişi yapılmamış.'}
                            </div>
                        </div>

                        <Separator className="my-8" />

                        {/* Comments Section */}
                        <div className="space-y-6">
                            <h2 className="text-2xl font-bold flex items-center gap-2">
                                <MessageCircle className="h-6 w-6 text-primary" />
                                Yorumlar ({comments.length})
                            </h2>

                            <div className="space-y-4">
                                <Textarea
                                    placeholder="Bu karakter hakkında ne düşünüyorsun?"
                                    className="min-h-[100px] rounded-xl bg-secondary/50 border-border focus:ring-primary"
                                    value={commentInput}
                                    onChange={(e) => setCommentInput(e.target.value)}
                                />
                                <div className="flex justify-end">
                                    <Button onClick={handleComment} className="rounded-xl px-8 shadow-md">
                                        Gönder
                                    </Button>
                                </div>
                            </div>

                            <div className="space-y-4 mt-8">
                                {comments.map(c => (
                                    <div key={c.id} className="flex gap-4 p-4 rounded-xl bg-card border border-border shadow-sm">
                                        <Avatar className="h-10 w-10 border border-border">
                                            <AvatarImage src={c.userAvatar} />
                                            <AvatarFallback>{c.username[0]}</AvatarFallback>
                                        </Avatar>
                                        <div className="flex-1 space-y-1">
                                            <div className="flex items-center justify-between">
                                                <span className="font-bold text-sm text-primary">{c.username}</span>
                                                <span className="text-xs text-muted-foreground">
                                                    {new Date(c.createdAt).toLocaleDateString('tr-TR')}
                                                </span>
                                            </div>
                                            <p className="text-foreground/90">{c.content}</p>
                                        </div>
                                    </div>
                                ))}
                                {comments.length === 0 && (
                                    <div className="text-center py-10 text-muted-foreground italic">
                                        Henüz yorum yok. İlk yorumu sen yap!
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            </main>
        </div>
    );
};

export default CharacterDetail;
