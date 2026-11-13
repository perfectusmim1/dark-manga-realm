import React, { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { BookOpen, Loader2, Search, X } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import {
  createForumTopic,
  FORUM_CATEGORIES,
  ForumCategoryId,
  ForumTopic,
  getForumTopicDetail,
  updateForumTopic,
} from '@/lib/forum';
import { getMangaChapters, searchMangas } from '@/lib/database';
import {
  mergeForumTextAndMedia,
  splitForumTextAndMedia,
  validateForumMediaUrls,
} from '@/lib/forumMedia';
import type { Chapter, Manga } from '@/lib/types';
import OptimizedImage from '@/components/media/OptimizedImage';
import ForumMediaAttachmentField from '@/components/community/ForumMediaAttachmentField';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';

const NO_CHAPTER_VALUE = '__none__';

interface LinkedMangaSummary {
  id: string;
  title: string;
  cover?: string;
}

interface ForumTopicComposerModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultCategory?: ForumCategoryId;
  editTopic?: ForumTopic | null;
  onSaved: (topic: ForumTopic) => void;
}

const ForumTopicComposerModal: React.FC<ForumTopicComposerModalProps> = ({
  open,
  onOpenChange,
  defaultCategory = 'genel-sohbet',
  editTopic = null,
  onSaved,
}) => {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const isEditMode = Boolean(editTopic);

  const [category, setCategory] = useState<ForumCategoryId>(defaultCategory);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [mediaUrls, setMediaUrls] = useState<string[]>([]);
  const [isSpoiler, setIsSpoiler] = useState(false);

  const [selectedManga, setSelectedManga] = useState<LinkedMangaSummary | null>(null);
  const [selectedChapterId, setSelectedChapterId] = useState<string>('');
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [isLoadingChapters, setIsLoadingChapters] = useState(false);

  const [mangaSearch, setMangaSearch] = useState('');
  const [mangaResults, setMangaResults] = useState<Manga[]>([]);
  const [isSearchingMangas, setIsSearchingMangas] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!open) {
      return;
    }

    if (editTopic) {
      const parsed = splitForumTextAndMedia(editTopic.content);
      setCategory(editTopic.category);
      setTitle(editTopic.title);
      setContent(parsed.body);
      setMediaUrls(parsed.mediaUrls);
      setIsSpoiler(editTopic.isSpoiler);
      setSelectedManga(
        editTopic.mangaId && editTopic.mangaTitle
          ? {
              id: editTopic.mangaId,
              title: editTopic.mangaTitle,
              cover: editTopic.mangaCover,
            }
          : null,
      );
      setSelectedChapterId(editTopic.chapterId || '');
    } else {
      setCategory(defaultCategory);
      setTitle('');
      setContent('');
      setMediaUrls([]);
      setIsSpoiler(false);
      setSelectedManga(null);
      setSelectedChapterId('');
    }

    setMangaSearch('');
    setMangaResults([]);
  }, [defaultCategory, editTopic, open]);

  useEffect(() => {
    if (!open || !selectedManga) {
      setChapters([]);
      setIsLoadingChapters(false);
      return;
    }

    let isCancelled = false;

    const loadChapters = async () => {
      try {
        setIsLoadingChapters(true);
        const fetched = await getMangaChapters(selectedManga.id);
        if (!isCancelled) {
          setChapters(fetched);
        }
      } catch (error) {
        console.error('Forum topic composer chapter load error:', error);
        if (!isCancelled) {
          setChapters([]);
        }
      } finally {
        if (!isCancelled) {
          setIsLoadingChapters(false);
        }
      }
    };

    void loadChapters();

    return () => {
      isCancelled = true;
    };
  }, [open, selectedManga]);

  useEffect(() => {
    if (!open || selectedManga) {
      setMangaResults([]);
      setIsSearchingMangas(false);
      return;
    }

    const trimmedQuery = mangaSearch.trim();
    if (trimmedQuery.length < 2) {
      setMangaResults([]);
      setIsSearchingMangas(false);
      return;
    }

    let isCancelled = false;
    const timeoutId = window.setTimeout(async () => {
      try {
        setIsSearchingMangas(true);
        const results = await searchMangas(trimmedQuery);
        if (!isCancelled) {
          setMangaResults(results.slice(0, 8));
        }
      } catch (error) {
        console.error('Forum topic composer manga search error:', error);
        if (!isCancelled) {
          setMangaResults([]);
        }
      } finally {
        if (!isCancelled) {
          setIsSearchingMangas(false);
        }
      }
    }, 300);

    return () => {
      isCancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [mangaSearch, open, selectedManga]);

  const handleSelectManga = (manga: Manga) => {
    setSelectedManga({
      id: manga.id,
      title: manga.title,
      cover: manga.cover,
    });
    setSelectedChapterId('');
    setMangaSearch('');
    setMangaResults([]);
  };

  const handleClearManga = () => {
    setSelectedManga(null);
    setSelectedChapterId('');
    setChapters([]);
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!user) {
      toast.error('Konu paylaşmak için giriş yapmalısınız.');
      return;
    }

    const trimmedTitle = title.trim();
    if (!validateForumMediaUrls(mediaUrls)) {
      toast.error('Lütfen geçerli görsel veya GIF bağlantıları (http:// veya https://) girin.');
      return;
    }

    const trimmedContent = mergeForumTextAndMedia(content, mediaUrls);

    if (trimmedTitle.length < 3 || trimmedTitle.length > 160) {
      toast.error('Konu başlığı 3 ile 160 karakter arasında olmalıdır.');
      return;
    }

    if (trimmedContent.length < 1 || trimmedContent.length > 20000) {
      toast.error('Konu içeriği veya görseli boş bırakılamaz ve toplam uzunluk en fazla 20.000 karakter olabilir.');
      return;
    }

    try {
      setIsSubmitting(true);

      if (editTopic) {
        await updateForumTopic(editTopic.id, {
          category,
          title: trimmedTitle,
          content: trimmedContent,
          mangaId: selectedManga ? selectedManga.id : null,
          chapterId: selectedManga && selectedChapterId ? selectedChapterId : null,
          isSpoiler,
        });
        const refreshed = await getForumTopicDetail(editTopic.id);
        if (refreshed) {
          onSaved(refreshed);
        } else {
          const selectedChapter = chapters.find((ch) => ch.id === selectedChapterId);
          onSaved({
            ...editTopic,
            category,
            title: trimmedTitle,
            content: trimmedContent,
            mangaId: selectedManga?.id,
            mangaTitle: selectedManga?.title,
            mangaCover: selectedManga?.cover,
            chapterId: selectedManga && selectedChapterId ? selectedChapterId : undefined,
            chapterNumber: selectedManga && selectedChapter ? selectedChapter.number : undefined,
            chapterTitle: selectedManga && selectedChapter ? selectedChapter.title : undefined,
            isSpoiler,
            updatedAt: new Date().toISOString(),
          });
        }
        toast.success('Konu güncellendi.');
        void queryClient.invalidateQueries({ queryKey: ['community', 'forum'] });
      } else {
        const createdTopic = await createForumTopic({
          userId: user.id,
          actorUsername: user.username,
          category,
          title: trimmedTitle,
          content: trimmedContent,
          mangaId: selectedManga?.id || null,
          chapterId: selectedManga && selectedChapterId ? selectedChapterId : null,
          isSpoiler,
        });
        void queryClient.invalidateQueries({ queryKey: ['community', 'forum'] });
        onSaved(createdTopic);
        toast.success('Konu oluşturuldu.');
      }

      onOpenChange(false);
    } catch (error) {
      console.error('Forum topic save error:', error);
      toast.error(isEditMode ? 'Konu güncellenemedi.' : 'Konu oluşturulamadı.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] w-[calc(100vw-1.5rem)] max-w-2xl overflow-y-auto rounded-2xl border border-border bg-card">
        <DialogHeader>
          <DialogTitle>{isEditMode ? 'Konuyu Düzenle' : 'Yeni Konu Aç'}</DialogTitle>
          <DialogDescription>
            {isEditMode
              ? 'Konu bilgilerini güncelleyin.'
              : 'Kategori seçip başlık ve içeriği yazarak toplulukla tartışma başlatın.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="forum-topic-category">Kategori</Label>
            <Select
              value={category}
              onValueChange={(value) => setCategory(value as ForumCategoryId)}
            >
              <SelectTrigger id="forum-topic-category">
                <SelectValue placeholder="Kategori seçin" />
              </SelectTrigger>
              <SelectContent>
                {FORUM_CATEGORIES.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="forum-topic-title">Başlık</Label>
              <span className="text-xs text-muted-foreground">{title.trim().length}/160</span>
            </div>
            <Input
              id="forum-topic-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              maxLength={160}
              placeholder="Konu başlığını yazın..."
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="forum-topic-content">İçerik</Label>
              <span className="text-xs text-muted-foreground">{content.length}/20000</span>
            </div>
            <Textarea
              id="forum-topic-content"
              value={content}
              onChange={(event) => setContent(event.target.value)}
              maxLength={20000}
              rows={6}
              placeholder="Düşüncelerinizi paylaşın... (@kullanici ile birinden bahsedebilirsiniz)"
            />
            <ForumMediaAttachmentField
              mediaUrls={mediaUrls}
              onChange={setMediaUrls}
              disabled={isSubmitting}
            />
          </div>

          <div className="flex items-center justify-between rounded-xl border border-border/70 bg-background/40 px-3.5 py-2.5">
            <Label htmlFor="forum-topic-spoiler" className="cursor-pointer font-medium">
              Spoiler içerir
            </Label>
            <Switch
              id="forum-topic-spoiler"
              checked={isSpoiler}
              onCheckedChange={setIsSpoiler}
            />
          </div>

          <div className="space-y-3 rounded-xl border border-border/70 bg-background/40 p-3.5">
            <Label className="flex items-center gap-2 text-sm font-medium">
              <BookOpen className="h-4 w-4 text-primary" />
              Seri ve Bölüm Bağla (İsteğe bağlı)
            </Label>

            {selectedManga ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card/80 p-2.5">
                  <div className="flex min-w-0 items-center gap-3">
                    {selectedManga.cover ? (
                      <OptimizedImage
                        src={selectedManga.cover}
                        alt={selectedManga.title}
                        allowProxy
                        transform={{ width: 96, quality: 75 }}
                        containerClassName="h-12 w-9 shrink-0 overflow-hidden rounded-md bg-secondary"
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-12 w-9 shrink-0 items-center justify-center rounded-md bg-secondary">
                        <BookOpen className="h-4 w-4 text-muted-foreground" />
                      </div>
                    )}
                    <span className="truncate text-sm font-medium">{selectedManga.title}</span>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={handleClearManga}
                    className="shrink-0 gap-1 text-muted-foreground hover:text-destructive"
                  >
                    <X className="h-4 w-4" />
                    Kaldır
                  </Button>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="forum-topic-chapter" className="text-xs text-muted-foreground">
                    Bölüm (İsteğe bağlı)
                  </Label>
                  <Select
                    value={selectedChapterId || NO_CHAPTER_VALUE}
                    onValueChange={(value) =>
                      setSelectedChapterId(value === NO_CHAPTER_VALUE ? '' : value)
                    }
                    disabled={isLoadingChapters}
                  >
                    <SelectTrigger id="forum-topic-chapter">
                      <SelectValue
                        placeholder={
                          isLoadingChapters ? 'Bölümler yükleniyor...' : 'Bölüm seçilmedi'
                        }
                      />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_CHAPTER_VALUE}>Bölüm seçilmedi</SelectItem>
                      {chapters.map((chapter) => (
                        <SelectItem key={chapter.id} value={chapter.id}>
                          {`Bölüm ${chapter.number}${chapter.title ? ` — ${chapter.title}` : ''}`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={mangaSearch}
                    onChange={(event) => setMangaSearch(event.target.value)}
                    placeholder="Seri adı ile arayın..."
                    className="pl-9"
                  />
                </div>

                {isSearchingMangas && (
                  <div className="flex items-center gap-2 py-2 text-xs text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Seriler aranıyor...
                  </div>
                )}

                {!isSearchingMangas && mangaResults.length > 0 && (
                  <div className="max-h-48 divide-y divide-border/50 overflow-y-auto rounded-lg border border-border bg-card">
                    {mangaResults.map((manga) => (
                      <button
                        key={manga.id}
                        type="button"
                        onClick={() => handleSelectManga(manga)}
                        className="flex w-full items-center gap-3 p-2 text-left transition-colors hover:bg-secondary/60"
                      >
                        <OptimizedImage
                          src={manga.cover}
                          alt={manga.title}
                          allowProxy
                          transform={{ width: 80, quality: 70 }}
                          containerClassName="h-10 w-8 shrink-0 overflow-hidden rounded bg-secondary"
                          className="h-full w-full object-cover"
                        />
                        <span className="min-w-0 flex-1 truncate text-sm font-medium">
                          {manga.title}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
            >
              İptal
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {isEditMode ? 'Değişiklikleri Kaydet' : 'Konuyu Yayınla'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default ForumTopicComposerModal;
