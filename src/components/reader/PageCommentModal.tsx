import React, { useEffect, useMemo, useState } from 'react';
import { Eye, EyeOff, Image, Link2, Send, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { addCommentV2 } from '@/lib/database';
import { commentHasRenderableContent, isValidCommentMediaUrls } from '@/lib/commentContent';
import { dispatchPageCommentsUpdated } from '@/lib/pageCommentEvents';
import { User } from '@/lib/types';
import { cn } from '@/lib/utils';

const TENOR_API_KEY = 'AIzaSyAyimkuYQYF_FXVALexPuGQctUWRURdCYQ';

interface PageCommentModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    mangaId: string;
    chapterId: string;
    pageNumber: number | null;
    user: User | null;
}

interface ModalCommentDraft {
    body: string;
    mediaUrls: string[];
    isSpoiler: boolean;
    gifUrl: string | null;
}

const createEmptyDraft = (): ModalCommentDraft => ({
    body: '',
    mediaUrls: [],
    isSpoiler: false,
    gifUrl: null,
});

const PageCommentModal: React.FC<PageCommentModalProps> = ({
    open,
    onOpenChange,
    mangaId,
    chapterId,
    pageNumber,
    user,
}) => {
    const [draft, setDraft] = useState<ModalCommentDraft>(createEmptyDraft());
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [showMediaFields, setShowMediaFields] = useState(false);
    const [showGifBrowser, setShowGifBrowser] = useState(false);
    const [gifSearch, setGifSearch] = useState('');
    const [gifs, setGifs] = useState<any[]>([]);
    const [isGifLoading, setIsGifLoading] = useState(false);

    useEffect(() => {
        if (!open) {
            setDraft(createEmptyDraft());
            setShowMediaFields(false);
            setShowGifBrowser(false);
            setGifSearch('');
            setGifs([]);
            setIsSubmitting(false);
        }
    }, [open, pageNumber]);

    const hasContent = useMemo(() => commentHasRenderableContent({
        body: draft.body,
        mediaUrls: draft.mediaUrls,
        gifUrl: draft.gifUrl,
    }), [draft.body, draft.gifUrl, draft.mediaUrls]);

    const searchGifs = async (query: string) => {
        if (!query.trim()) {
            setGifs([]);
            return;
        }

        try {
            setIsGifLoading(true);
            const response = await fetch(
                `https://tenor.googleapis.com/v2/search?q=${encodeURIComponent(query)}&key=${TENOR_API_KEY}&limit=18&media_filter=gif`
            );
            const data = await response.json();
            setGifs(data.results || []);
        } catch (error) {
            console.error('Reader modal GIF search error:', error);
            toast.error('GIF araması başarısız oldu');
        } finally {
            setIsGifLoading(false);
        }
    };

    const updateMediaUrl = (index: number, value: string) => {
        setDraft((previous) => {
            const nextMediaUrls = [...previous.mediaUrls];
            nextMediaUrls[index] = value;
            return {
                ...previous,
                mediaUrls: nextMediaUrls,
            };
        });
    };

    const addMediaField = () => {
        setShowMediaFields(true);
        setDraft((previous) => ({
            ...previous,
            mediaUrls: [...previous.mediaUrls, ''],
        }));
    };

    const removeMediaField = (index: number) => {
        setDraft((previous) => {
            const nextMediaUrls = previous.mediaUrls.filter((_, mediaIndex) => mediaIndex !== index);
            if (nextMediaUrls.length === 0) {
                setShowMediaFields(false);
            }

            return {
                ...previous,
                mediaUrls: nextMediaUrls,
            };
        });
    };

    const handleSubmit = async () => {
        if (!user) {
            toast.error('Yorum yapmak için giriş yapmalısınız');
            return;
        }

        if (!pageNumber) {
            toast.error('Yorum yapılacak sayfa bulunamadı');
            return;
        }

        const normalizedDraft = {
            ...draft,
            body: draft.body.trim(),
            mediaUrls: draft.mediaUrls.map((url) => url.trim()).filter(Boolean),
        };

        if (!commentHasRenderableContent({
            body: normalizedDraft.body,
            mediaUrls: normalizedDraft.mediaUrls,
            gifUrl: normalizedDraft.gifUrl,
        })) {
            toast.error('Yorum, görsel veya GIF eklemelisiniz');
            return;
        }

        if (!isValidCommentMediaUrls(normalizedDraft.mediaUrls)) {
            toast.error('Tüm görsel bağlantıları geçerli olmalı');
            return;
        }

        try {
            setIsSubmitting(true);
            await addCommentV2({
                mangaId,
                entityType: 'manga',
                chapterId,
                pageNumber,
                userId: user.id,
                username: user.username,
                userAvatar: user.avatar,
                userRole: user.role,
                content: normalizedDraft.body,
                mediaUrl: normalizedDraft.mediaUrls[0] || undefined,
                mediaUrls: normalizedDraft.mediaUrls,
                isSpoiler: normalizedDraft.isSpoiler,
                gifUrl: normalizedDraft.gifUrl || undefined,
            });

            dispatchPageCommentsUpdated({
                mangaId,
                chapterId,
                pageNumber,
            });

            toast.success(`Sayfa ${pageNumber} yorumu gönderildi`);
            onOpenChange(false);
        } catch (error) {
            console.error('Page comment modal submit error:', error);
            toast.error('Yorum gönderilemedi');
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="w-[calc(100%-1.5rem)] max-w-2xl border-border/80 bg-background/95 p-0 backdrop-blur-xl">
                <div className="border-b border-border/60 px-4 py-5 sm:px-6">
                    <DialogHeader>
                        <DialogTitle>Sayfa {pageNumber ?? '-'} İçin Yorum Yap</DialogTitle>
                        <DialogDescription>
                            Okuyucudan ayrılmadan bu sayfaya hızlıca yorum bırakabilirsin.
                        </DialogDescription>
                    </DialogHeader>
                </div>

                {!user ? (
                    <div className="px-6 py-8 text-center text-sm text-muted-foreground">
                        Yorum yazmak için giriş yapmalısınız.
                    </div>
                ) : (
                    <div className="space-y-4 px-4 py-5 sm:px-6">
                        <div className="rounded-2xl border border-border/70 bg-card/60 p-3 sm:p-4">
                            <div className="flex flex-col gap-3 sm:flex-row">
                                <Avatar className="h-10 w-10">
                                    <AvatarImage src={user.avatar} />
                                    <AvatarFallback>{user.username[0]?.toUpperCase() || '?'}</AvatarFallback>
                                </Avatar>

                                <div className="min-w-0 flex-1 space-y-3">
                                    <Textarea
                                        placeholder={`Sayfa ${pageNumber ?? '-'} hakkında yorum yazın...`}
                                        value={draft.body}
                                        onChange={(event) => setDraft((previous) => ({
                                            ...previous,
                                            body: event.target.value,
                                        }))}
                                        className="min-h-[120px]"
                                    />

                                    {(draft.gifUrl || draft.mediaUrls.length > 0) && (
                                        <div className="flex flex-wrap gap-3">
                                            {draft.gifUrl && (
                                                <div className="relative overflow-hidden rounded-xl border border-border bg-background/70">
                                                    <img src={draft.gifUrl} alt="Seçili GIF" className="max-h-32 rounded-xl object-cover" />
                                                    <Button
                                                        size="icon"
                                                        variant="destructive"
                                                        className="absolute right-2 top-2 h-7 w-7"
                                                        onClick={() => setDraft((previous) => ({ ...previous, gifUrl: null }))}
                                                    >
                                                        <X className="h-4 w-4" />
                                                    </Button>
                                                </div>
                                            )}

                                            {draft.mediaUrls.filter(Boolean).map((mediaUrl, index) => (
                                                <div key={`${mediaUrl}-${index}`} className="flex w-full min-w-0 items-center gap-2 rounded-xl border border-border bg-background/70 px-3 py-2 text-sm text-muted-foreground sm:min-w-[220px] sm:w-auto">
                                                    <Link2 className="h-4 w-4 shrink-0" />
                                                    <span className="truncate">{mediaUrl}</span>
                                                </div>
                                            ))}
                                        </div>
                                    )}

                                    {showMediaFields && (
                                        <div className="space-y-2 rounded-xl border border-border/60 bg-background/30 p-3">
                                            {draft.mediaUrls.map((mediaUrl, index) => (
                                                <div key={`reader-modal-media-${index}`} className="flex flex-col gap-2 sm:flex-row sm:items-center">
                                                    <Input
                                                        placeholder={`Görsel Linki ${index + 1}`}
                                                        value={mediaUrl}
                                                        onChange={(event) => updateMediaUrl(index, event.target.value)}
                                                        className="h-10"
                                                    />
                                                    <Button type="button" variant="ghost" size="sm" className="justify-start sm:justify-center" onClick={() => removeMediaField(index)}>
                                                        Kaldır
                                                    </Button>
                                                </div>
                                            ))}

                                            <Button type="button" variant="outline" size="sm" onClick={addMediaField}>
                                                Bir Tane Daha Ekle
                                            </Button>
                                        </div>
                                    )}

                                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                onClick={() => setShowGifBrowser((previous) => !previous)}
                                            >
                                                <Image className="mr-2 h-4 w-4" />
                                                GIF Ekle
                                            </Button>

                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                onClick={() => {
                                                    if (draft.mediaUrls.length === 0) {
                                                        addMediaField();
                                                    } else {
                                                        setShowMediaFields((previous) => !previous);
                                                    }
                                                }}
                                            >
                                                <Link2 className="mr-2 h-4 w-4" />
                                                Görsel Ekle
                                            </Button>

                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="sm"
                                                aria-pressed={draft.isSpoiler}
                                                className={cn(
                                                    draft.isSpoiler && 'border border-primary/40 bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary',
                                                )}
                                                onClick={() => setDraft((previous) => ({
                                                    ...previous,
                                                    isSpoiler: !previous.isSpoiler,
                                                }))}
                                            >
                                                {draft.isSpoiler ? <EyeOff className="mr-2 h-4 w-4" /> : <Eye className="mr-2 h-4 w-4" />}
                                                Spoiler Olarak İşaretle
                                            </Button>
                                        </div>

                                        <div className="flex w-full flex-col-reverse gap-2 sm:w-auto sm:flex-row sm:items-center">
                                            <Button variant="ghost" size="sm" className="w-full sm:w-auto" onClick={() => onOpenChange(false)}>
                                                İptal
                                            </Button>
                                            <Button size="sm" className="w-full sm:w-auto" onClick={handleSubmit} disabled={!hasContent || isSubmitting}>
                                                <Send className="mr-2 h-4 w-4" />
                                                {isSubmitting ? 'Gönderiliyor...' : 'Gönder'}
                                            </Button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {showGifBrowser && (
                            <div className="space-y-4 rounded-2xl border border-border/70 bg-card/40 p-4">
                                <div className="space-y-2">
                                    <Input
                                        type="text"
                                        placeholder="GIF ara..."
                                        value={gifSearch}
                                        onChange={(event) => {
                                            const nextValue = event.target.value;
                                            setGifSearch(nextValue);
                                            void searchGifs(nextValue);
                                        }}
                                    />
                                    <p className="text-xs text-muted-foreground">Bir GIF seçtiğinde doğrudan bu sayfanın yorumuna eklenir.</p>
                                </div>

                                <div className="grid max-h-72 grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-3">
                                    {gifs.map((gif) => {
                                        const gifUrl = gif.media_formats?.tinygif?.url || gif.media_formats?.gif?.url;
                                        if (!gifUrl) {
                                            return null;
                                        }

                                        return (
                                            <button
                                                key={gif.id}
                                                onClick={() => {
                                                    setDraft((previous) => ({ ...previous, gifUrl }));
                                                    setShowGifBrowser(false);
                                                }}
                                                className="overflow-hidden rounded-lg transition-transform hover:scale-[1.03]"
                                            >
                                                <img
                                                    src={gifUrl}
                                                    alt="GIF"
                                                    className="h-24 w-full object-cover"
                                                />
                                            </button>
                                        );
                                    })}
                                </div>

                                {isGifLoading && (
                                    <p className="text-center text-sm text-muted-foreground">GIF'ler yükleniyor...</p>
                                )}

                                {!isGifLoading && gifs.length === 0 && gifSearch && (
                                    <p className="text-center text-sm text-muted-foreground">GIF bulunamadı</p>
                                )}
                            </div>
                        )}
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
};

export default PageCommentModal;
