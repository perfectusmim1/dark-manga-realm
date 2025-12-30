import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Heart, BookOpen, MessageCircle, ArrowLeft, Calendar, User } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import { getAuthorById, toggleEntityLike, getEntityComments, addEntityComment } from '@/lib/database';
import { Author, Comment } from '@/lib/types';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import Header from '@/components/layout/Header';

const AuthorDetail: React.FC = () => {
    const { id } = useParams<{ id: string }>();
    const { user } = useAuth();
    const [author, setAuthor] = useState<Author | null>(null);
    const [comments, setComments] = useState<Comment[]>([]);
    const [loading, setLoading] = useState(true);
    const [commentInput, setCommentInput] = useState('');
    const [isLiked, setIsLiked] = useState(false);

    useEffect(() => {
        const loadData = async () => {
            if (!id) return;
            try {
                const data = await getAuthorById(id);
                if (data) setAuthor(data);
                const comms = await getEntityComments('author', id);
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
            toast.error('Giriş yapmalısınız');
            return;
        }
        try {
            await toggleEntityLike('author', id!, user.id);
            setIsLiked(!isLiked);
            setAuthor(prev => prev ? { ...prev, likesCount: isLiked ? prev.likesCount - 1 : prev.likesCount + 1 } : null);
            toast.success('İşlem başarılı');
        } catch (err) {
            toast.error('Bir hata oluştu');
        }
    };

    const handleComment = async () => {
        if (!user || !commentInput.trim()) return;
        try {
            await addEntityComment('author', id!, user.id, commentInput);
            setCommentInput('');
            const comms = await getEntityComments('author', id!);
            setComments(comms);
        } catch (err) {
            toast.error('Yorum gönderilemedi');
        }
    };

    if (loading) return <div className="min-h-screen bg-background" />;
    if (!author) return <div className="min-h-screen bg-background flex items-center justify-center">Yazar bulunamadı</div>;

    return (
        <div className="min-h-screen bg-background flex flex-col pt-16">
            <Header />
            <main className="flex-1 container mx-auto px-4 py-8 max-w-6xl">
                <Link to="/" className="inline-flex items-center text-muted-foreground hover:text-primary mb-6">
                    <ArrowLeft className="mr-2 h-4 w-4" /> Geri Dön
                </Link>

                <div className="grid gap-8 md:grid-cols-[1fr,2fr]">
                    <div className="space-y-6">
                        <div className="relative aspect-[3/4] rounded-xl overflow-hidden border border-border shadow-xl bg-card">
                            <img src={author.imageUrl || 'https://via.placeholder.com/300x400?text=No+Image'} className="w-full h-full object-cover" />
                        </div>
                        <Button variant={isLiked ? "default" : "outline"} size="lg" className="w-full rounded-xl" onClick={handleLike}>
                            <Heart className={`mr-2 h-5 w-5 ${isLiked ? 'fill-current' : ''}`} /> {author.likesCount} Beğeni
                        </Button>
                    </div>

                    <div className="space-y-8">
                        <div>
                            <Badge variant="outline" className="mb-2">Yazar</Badge>
                            <h1 className="text-4xl font-black">{author.name}</h1>
                        </div>

                        <div className="space-y-4">
                            <h2 className="text-2xl font-bold flex items-center gap-2"><BookOpen className="h-6 w-6 text-primary" /> Eserleri</h2>
                            <div className="flex flex-wrap gap-3">
                                {author.series?.map(s => (
                                    <Link key={s.id} to={`/manga/${s.id}`}>
                                        <Badge variant="secondary" className="px-4 py-2 text-md rounded-lg hover:bg-secondary cursor-pointer border-border">
                                            {s.title}
                                        </Badge>
                                    </Link>
                                ))}
                            </div>
                        </div>

                        <div className="space-y-4">
                            <h2 className="text-2xl font-bold">Hakkında</h2>
                            <div className="bg-secondary/30 rounded-2xl p-6 border border-border italic text-foreground/90 leading-relaxed">
                                {author.description || 'Henüz bir biyografi eklenmemiş.'}
                            </div>
                        </div>

                        <Separator />

                        {/* Comments */}
                        <div className="space-y-6">
                            <h2 className="text-2xl font-bold flex items-center gap-2"><MessageCircle className="h-6 w-6 text-primary" /> Yorumlar</h2>
                            <div className="space-y-4">
                                <Textarea placeholder="Yazar hakkında bir yorum bırak..." className="min-h-[100px] rounded-xl" value={commentInput} onChange={(e) => setCommentInput(e.target.value)} />
                                <div className="flex justify-end"><Button onClick={handleComment} className="rounded-xl px-8">Gönder</Button></div>
                            </div>
                            <div className="space-y-4 mt-8">
                                {comments.map(c => (
                                    <div key={c.id} className="flex gap-4 p-4 rounded-xl bg-card border border-border shadow-sm">
                                        <Avatar className="h-10 w-10 border border-border">
                                            <AvatarImage src={c.userAvatar} />
                                            <AvatarFallback>{c.username[0]}</AvatarFallback>
                                        </Avatar>
                                        <div className="flex-1">
                                            <div className="flex items-center justify-between mb-1">
                                                <span className="font-bold text-sm text-primary">{c.username}</span>
                                                <span className="text-xs text-muted-foreground">{new Date(c.createdAt).toLocaleDateString('tr-TR')}</span>
                                            </div>
                                            <p className="text-sm">{c.content}</p>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            </main>
        </div>
    );
};
export default AuthorDetail;
