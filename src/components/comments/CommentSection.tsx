import React, { useState, useEffect } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { tr } from 'date-fns/locale';
import {
    MessageCircle,
    ThumbsUp,
    Edit2,
    Trash2,
    Reply,
    Image,
    Send,
    X,
    MoreVertical
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { useAuth } from '@/contexts/AuthContext';
import {
    Comment,
    getCommentsForManga,
    addComment,
    updateComment,
    deleteComment,
    toggleCommentLike
} from '@/lib/database';
import { toast } from 'sonner';

interface CommentSectionProps {
    mangaId: string;
    chapterId?: string;
}

const TENOR_API_KEY = 'AIzaSyAyimkuYQYF_FXVALexPuGQctUWRURdCYQ'; // Free tier API key

const CommentSection: React.FC<CommentSectionProps> = ({ mangaId, chapterId }) => {
    const { user } = useAuth();
    const [comments, setComments] = useState<Comment[]>([]);
    const [newComment, setNewComment] = useState('');
    const [selectedGif, setSelectedGif] = useState<string | null>(null);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editContent, setEditContent] = useState('');
    const [editGif, setEditGif] = useState<string | null>(null);
    const [replyingTo, setReplyingTo] = useState<string | null>(null);
    const [replyContent, setReplyContent] = useState('');
    const [showGifPicker, setShowGifPicker] = useState(false);
    const [gifSearch, setGifSearch] = useState('');
    const [gifs, setGifs] = useState<any[]>([]);
    const [gifTarget, setGifTarget] = useState<'new' | 'edit' | 'reply'>('new');

    useEffect(() => {
        loadComments();
    }, [mangaId, chapterId]);

    const loadComments = () => {
        const loadedComments = getCommentsForManga(mangaId, chapterId);
        setComments(loadedComments);
    };

    const searchGifs = async (query: string) => {
        if (!query.trim()) {
            setGifs([]);
            return;
        }

        try {
            // Using Tenor API
            const response = await fetch(
                `https://tenor.googleapis.com/v2/search?q=${encodeURIComponent(query)}&key=${TENOR_API_KEY}&limit=20&media_filter=gif`
            );
            const data = await response.json();
            setGifs(data.results || []);
        } catch (error) {
            console.error('GIF search error:', error);
            // Fallback: Use Giphy if Tenor fails
            try {
                const giphyResponse = await fetch(
                    `https://api.giphy.com/v1/gifs/search?api_key=dc6zaTOxFJmzC&q=${encodeURIComponent(query)}&limit=20`
                );
                const giphyData = await giphyResponse.json();
                setGifs(giphyData.data?.map((g: any) => ({
                    id: g.id,
                    media_formats: { tinygif: { url: g.images.fixed_height.url } }
                })) || []);
            } catch {
                toast.error('GIF araması başarısız oldu');
            }
        }
    };

    const handleSubmitComment = () => {
        if (!user) {
            toast.error('Yorum yapmak için giriş yapmalısınız');
            return;
        }

        if (!newComment.trim() && !selectedGif) {
            toast.error('Lütfen bir yorum yazın veya GIF seçin');
            return;
        }

        addComment({
            mangaId,
            chapterId,
            userId: user.id,
            username: user.username,
            userAvatar: user.avatar,
            content: newComment,
            gifUrl: selectedGif || undefined,
        });

        setNewComment('');
        setSelectedGif(null);
        loadComments();
        toast.success('Yorum eklendi');
    };

    const handleEditComment = (commentId: string) => {
        if (!editContent.trim() && !editGif) {
            toast.error('Lütfen bir yorum yazın veya GIF seçin');
            return;
        }

        updateComment(commentId, editContent, editGif || undefined);
        setEditingId(null);
        setEditContent('');
        setEditGif(null);
        loadComments();
        toast.success('Yorum güncellendi');
    };

    const handleDeleteComment = (commentId: string) => {
        deleteComment(commentId);
        loadComments();
        toast.success('Yorum silindi');
    };

    const handleReply = (parentId: string) => {
        if (!user) {
            toast.error('Yanıt vermek için giriş yapmalısınız');
            return;
        }

        if (!replyContent.trim()) {
            toast.error('Lütfen bir yanıt yazın');
            return;
        }

        const parentComment = comments.find(c => c.id === parentId);

        addComment({
            mangaId,
            chapterId,
            userId: user.id,
            username: user.username,
            userAvatar: user.avatar,
            content: `@${parentComment?.username} ${replyContent}`,
            parentId,
        });

        setReplyingTo(null);
        setReplyContent('');
        loadComments();
        toast.success('Yanıt eklendi');
    };

    const handleLike = (commentId: string) => {
        if (!user) {
            toast.error('Beğenmek için giriş yapmalısınız');
            return;
        }

        toggleCommentLike(commentId, user.id);
        loadComments();
    };

    const selectGif = (gifUrl: string) => {
        if (gifTarget === 'new') {
            setSelectedGif(gifUrl);
        } else if (gifTarget === 'edit') {
            setEditGif(gifUrl);
        }
        setShowGifPicker(false);
        setGifSearch('');
        setGifs([]);
    };

    const startEdit = (comment: Comment) => {
        setEditingId(comment.id);
        setEditContent(comment.content);
        setEditGif(comment.gifUrl || null);
    };

    const parentComments = comments.filter(c => !c.parentId);
    const getReplies = (parentId: string) => comments.filter(c => c.parentId === parentId);

    return (
        <div className="space-y-6">
            <div className="flex items-center gap-2">
                <MessageCircle className="h-5 w-5 text-primary" />
                <h3 className="text-lg font-semibold">Yorumlar ({comments.length})</h3>
            </div>

            {/* New Comment Form */}
            {user ? (
                <div className="rounded-lg border border-border bg-card p-4">
                    <div className="flex gap-3">
                        <Avatar className="h-10 w-10">
                            <AvatarImage src={user.avatar} />
                            <AvatarFallback>{user.username[0].toUpperCase()}</AvatarFallback>
                        </Avatar>
                        <div className="flex-1 space-y-3">
                            <Textarea
                                placeholder="Bir yorum yazın..."
                                value={newComment}
                                onChange={(e) => setNewComment(e.target.value)}
                                className="min-h-[80px] resize-none"
                            />

                            {selectedGif && (
                                <div className="relative inline-block">
                                    <img src={selectedGif} alt="Selected GIF" className="max-h-32 rounded-lg" />
                                    <Button
                                        size="icon"
                                        variant="destructive"
                                        className="absolute -right-2 -top-2 h-6 w-6"
                                        onClick={() => setSelectedGif(null)}
                                    >
                                        <X className="h-4 w-4" />
                                    </Button>
                                </div>
                            )}

                            <div className="flex items-center justify-between">
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => {
                                        setGifTarget('new');
                                        setShowGifPicker(true);
                                    }}
                                >
                                    <Image className="mr-2 h-4 w-4" />
                                    GIF Ekle
                                </Button>
                                <Button onClick={handleSubmitComment} disabled={!newComment.trim() && !selectedGif}>
                                    <Send className="mr-2 h-4 w-4" />
                                    Gönder
                                </Button>
                            </div>
                        </div>
                    </div>
                </div>
            ) : (
                <div className="rounded-lg border border-border bg-card/50 p-4 text-center">
                    <p className="text-muted-foreground">Yorum yapmak için <a href="/auth" className="text-primary hover:underline">giriş yapın</a></p>
                </div>
            )}

            {/* Comments List */}
            <div className="space-y-4">
                {parentComments.length === 0 ? (
                    <div className="py-8 text-center text-muted-foreground">
                        Henüz yorum yok. İlk yorumu siz yapın!
                    </div>
                ) : (
                    parentComments.map((comment) => (
                        <div key={comment.id} className="rounded-lg border border-border bg-card/50 p-4">
                            <div className="flex gap-3">
                                <Avatar className="h-10 w-10">
                                    <AvatarImage src={comment.userAvatar} />
                                    <AvatarFallback>{comment.username[0].toUpperCase()}</AvatarFallback>
                                </Avatar>
                                <div className="flex-1">
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-2">
                                            <span className="font-medium">{comment.username}</span>
                                            <span className="text-xs text-muted-foreground">
                                                {formatDistanceToNow(new Date(comment.createdAt), { addSuffix: true, locale: tr })}
                                                {comment.updatedAt && ' (düzenlendi)'}
                                            </span>
                                        </div>

                                        {user?.id === comment.userId && (
                                            <DropdownMenu>
                                                <DropdownMenuTrigger asChild>
                                                    <Button variant="ghost" size="icon" className="h-8 w-8">
                                                        <MoreVertical className="h-4 w-4" />
                                                    </Button>
                                                </DropdownMenuTrigger>
                                                <DropdownMenuContent align="end">
                                                    <DropdownMenuItem onClick={() => startEdit(comment)}>
                                                        <Edit2 className="mr-2 h-4 w-4" />
                                                        Düzenle
                                                    </DropdownMenuItem>
                                                    <DropdownMenuItem
                                                        onClick={() => handleDeleteComment(comment.id)}
                                                        className="text-destructive"
                                                    >
                                                        <Trash2 className="mr-2 h-4 w-4" />
                                                        Sil
                                                    </DropdownMenuItem>
                                                </DropdownMenuContent>
                                            </DropdownMenu>
                                        )}
                                    </div>

                                    {editingId === comment.id ? (
                                        <div className="mt-2 space-y-2">
                                            <Textarea
                                                value={editContent}
                                                onChange={(e) => setEditContent(e.target.value)}
                                                className="min-h-[60px]"
                                            />
                                            {editGif && (
                                                <div className="relative inline-block">
                                                    <img src={editGif} alt="Edit GIF" className="max-h-24 rounded-lg" />
                                                    <Button
                                                        size="icon"
                                                        variant="destructive"
                                                        className="absolute -right-2 -top-2 h-6 w-6"
                                                        onClick={() => setEditGif(null)}
                                                    >
                                                        <X className="h-4 w-4" />
                                                    </Button>
                                                </div>
                                            )}
                                            <div className="flex gap-2">
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    onClick={() => {
                                                        setGifTarget('edit');
                                                        setShowGifPicker(true);
                                                    }}
                                                >
                                                    <Image className="h-4 w-4" />
                                                </Button>
                                                <Button size="sm" onClick={() => handleEditComment(comment.id)}>
                                                    Kaydet
                                                </Button>
                                                <Button
                                                    size="sm"
                                                    variant="ghost"
                                                    onClick={() => {
                                                        setEditingId(null);
                                                        setEditContent('');
                                                        setEditGif(null);
                                                    }}
                                                >
                                                    İptal
                                                </Button>
                                            </div>
                                        </div>
                                    ) : (
                                        <>
                                            <p className="mt-2 text-foreground/90">{comment.content}</p>
                                            {comment.gifUrl && (
                                                <img src={comment.gifUrl} alt="Comment GIF" className="mt-2 max-h-48 rounded-lg" />
                                            )}
                                        </>
                                    )}

                                    <div className="mt-3 flex items-center gap-4">
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => handleLike(comment.id)}
                                            className={comment.likedBy.includes(user?.id || '') ? 'text-primary' : ''}
                                        >
                                            <ThumbsUp className="mr-1 h-4 w-4" />
                                            {comment.likes}
                                        </Button>
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => setReplyingTo(replyingTo === comment.id ? null : comment.id)}
                                        >
                                            <Reply className="mr-1 h-4 w-4" />
                                            Yanıtla
                                        </Button>
                                    </div>

                                    {/* Reply Form */}
                                    {replyingTo === comment.id && user && (
                                        <div className="mt-3 flex gap-2">
                                            <Textarea
                                                placeholder={`@${comment.username} yanıtınız...`}
                                                value={replyContent}
                                                onChange={(e) => setReplyContent(e.target.value)}
                                                className="min-h-[60px]"
                                            />
                                            <div className="flex flex-col gap-1">
                                                <Button size="sm" onClick={() => handleReply(comment.id)}>
                                                    <Send className="h-4 w-4" />
                                                </Button>
                                                <Button
                                                    size="sm"
                                                    variant="ghost"
                                                    onClick={() => {
                                                        setReplyingTo(null);
                                                        setReplyContent('');
                                                    }}
                                                >
                                                    <X className="h-4 w-4" />
                                                </Button>
                                            </div>
                                        </div>
                                    )}

                                    {/* Replies */}
                                    {getReplies(comment.id).length > 0 && (
                                        <div className="mt-4 space-y-3 border-l-2 border-border pl-4">
                                            {getReplies(comment.id).map((reply) => (
                                                <div key={reply.id} className="flex gap-2">
                                                    <Avatar className="h-8 w-8">
                                                        <AvatarImage src={reply.userAvatar} />
                                                        <AvatarFallback>{reply.username[0].toUpperCase()}</AvatarFallback>
                                                    </Avatar>
                                                    <div className="flex-1">
                                                        <div className="flex items-center gap-2">
                                                            <span className="text-sm font-medium">{reply.username}</span>
                                                            <span className="text-xs text-muted-foreground">
                                                                {formatDistanceToNow(new Date(reply.createdAt), { addSuffix: true, locale: tr })}
                                                            </span>
                                                            {user?.id === reply.userId && (
                                                                <Button
                                                                    variant="ghost"
                                                                    size="icon"
                                                                    className="h-6 w-6"
                                                                    onClick={() => handleDeleteComment(reply.id)}
                                                                >
                                                                    <Trash2 className="h-3 w-3" />
                                                                </Button>
                                                            )}
                                                        </div>
                                                        <p className="text-sm text-foreground/90">{reply.content}</p>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    ))
                )}
            </div>

            {/* GIF Picker Dialog */}
            <Dialog open={showGifPicker} onOpenChange={setShowGifPicker}>
                <DialogContent className="max-w-2xl">
                    <DialogHeader>
                        <DialogTitle>GIF Seç</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4">
                        <input
                            type="text"
                            placeholder="GIF ara..."
                            value={gifSearch}
                            onChange={(e) => {
                                setGifSearch(e.target.value);
                                searchGifs(e.target.value);
                            }}
                            className="w-full rounded-lg border border-border bg-background px-4 py-2"
                        />
                        <div className="grid max-h-96 grid-cols-3 gap-2 overflow-y-auto">
                            {gifs.map((gif) => (
                                <button
                                    key={gif.id}
                                    onClick={() => selectGif(gif.media_formats?.tinygif?.url || gif.media_formats?.gif?.url)}
                                    className="overflow-hidden rounded-lg transition-transform hover:scale-105"
                                >
                                    <img
                                        src={gif.media_formats?.tinygif?.url || gif.media_formats?.gif?.url}
                                        alt="GIF"
                                        className="h-24 w-full object-cover"
                                    />
                                </button>
                            ))}
                        </div>
                        {gifs.length === 0 && gifSearch && (
                            <p className="py-8 text-center text-muted-foreground">GIF bulunamadı</p>
                        )}
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    );
};

export default CommentSection;
