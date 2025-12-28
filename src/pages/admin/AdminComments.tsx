import React, { useState, useEffect } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { tr } from 'date-fns/locale';
import {
    Search,
    Trash2,
    MessageSquare,
    Filter,
    ChevronDown,
} from 'lucide-react';
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
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { getAllComments, deleteComment, getMangaById } from '@/lib/database';
import { Comment } from '@/lib/types';
import { toast } from 'sonner';

const AdminComments: React.FC = () => {
    const [comments, setComments] = useState<Comment[]>([]);
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedComments, setSelectedComments] = useState<Set<string>>(new Set());
    const [deleteId, setDeleteId] = useState<string | null>(null);
    const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState(false);
    const [mangaCache, setMangaCache] = useState<Record<string, string>>({});

    useEffect(() => {
        loadComments();
    }, []);

    const loadComments = async () => {
        const data = await getAllComments();
        setComments(data);

        // Load manga titles for unique mangaIds
        const uniqueMangaIds = [...new Set(data.map(c => c.mangaId))];
        const newCache = { ...mangaCache };
        let cacheUpdated = false;

        for (const id of uniqueMangaIds) {
            if (!newCache[id]) {
                const manga = await getMangaById(id);
                if (manga) {
                    newCache[id] = manga.title;
                    cacheUpdated = true;
                }
            }
        }

        if (cacheUpdated) setMangaCache(newCache);
    };

    const handleDelete = async (id: string) => {
        await deleteComment(id);
        await loadComments();
        toast.success('Yorum silindi');
        setDeleteId(null);
    };

    const handleBulkDelete = async () => {
        await Promise.all(Array.from(selectedComments).map(id => deleteComment(id)));
        setSelectedComments(new Set());
        await loadComments();
        toast.success(`${selectedComments.size} yorum silindi`);
        setBulkDeleteConfirm(false);
    };

    const toggleSelect = (id: string) => {
        const newSelected = new Set(selectedComments);
        if (newSelected.has(id)) {
            newSelected.delete(id);
        } else {
            newSelected.add(id);
        }
        setSelectedComments(newSelected);
    };

    const selectAll = () => {
        if (selectedComments.size === filteredComments.length) {
            setSelectedComments(new Set());
        } else {
            setSelectedComments(new Set(filteredComments.map(c => c.id)));
        }
    };

    const filteredComments = comments.filter(comment => {
        const query = searchQuery.toLocaleLowerCase('tr-TR');
        return comment.content.toLocaleLowerCase('tr-TR').includes(query) ||
            comment.username.toLocaleLowerCase('tr-TR').includes(query);
    });

    const getMangaTitle = (mangaId: string) => {
        return mangaCache[mangaId] || 'Yükleniyor...';
    };

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold">Yorumlar</h1>
                    <p className="text-muted-foreground">Tüm yorumları yönetin</p>
                </div>
                {selectedComments.size > 0 && (
                    <Button
                        variant="destructive"
                        onClick={() => setBulkDeleteConfirm(true)}
                    >
                        <Trash2 className="mr-2 h-4 w-4" />
                        {selectedComments.size} Yorum Sil
                    </Button>
                )}
            </div>

            {/* Search */}
            <div className="flex items-center gap-4">
                <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                        placeholder="Yorum veya kullanıcı ara..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="pl-10"
                    />
                </div>
            </div>

            {/* Comments Table */}
            <div className="rounded-xl border border-border bg-card">
                <div className="overflow-x-auto">
                    <table className="w-full">
                        <thead>
                            <tr className="border-b border-border border-l-4 border-transparent">
                                <th className="w-12 px-4 py-3">
                                    <Checkbox
                                        checked={selectedComments.size === filteredComments.length && filteredComments.length > 0}
                                        onCheckedChange={selectAll}
                                    />
                                </th>
                                <th className="px-4 py-3 text-left text-sm font-medium text-muted-foreground">Kullanıcı</th>
                                <th className="px-4 py-3 text-left text-sm font-medium text-muted-foreground">Yorum</th>
                                <th className="px-4 py-3 text-left text-sm font-medium text-muted-foreground">Manga</th>
                                <th className="px-4 py-3 text-left text-sm font-medium text-muted-foreground">Tarih</th>
                                <th className="px-4 py-3 text-right text-sm font-medium text-muted-foreground">İşlemler</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                            {filteredComments.map((comment) => (
                                <tr
                                    key={comment.id}
                                    className={`
                                        group cursor-pointer select-none transition-all duration-200 border-l-4
                                        ${selectedComments.has(comment.id)
                                            ? 'bg-primary/5 border-primary shadow-sm'
                                            : 'hover:bg-secondary/40 border-transparent'}
                                    `}
                                    onClick={() => toggleSelect(comment.id)}
                                >
                                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                                        <Checkbox
                                            checked={selectedComments.has(comment.id)}
                                            onCheckedChange={() => toggleSelect(comment.id)}
                                        />
                                    </td>
                                    <td className="px-4 py-3">
                                        <div className="flex items-center gap-2">
                                            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-sm font-medium text-primary group-hover:scale-110 transition-transform">
                                                {comment.username[0].toUpperCase()}
                                            </div>
                                            <span className="font-medium">{comment.username}</span>
                                        </div>
                                    </td>
                                    <td className="px-4 py-3 max-w-xs">
                                        <p className="truncate text-sm">{comment.content}</p>
                                        <div className="flex gap-1 mt-1">
                                            {comment.gifUrl && (
                                                <Badge variant="secondary" className="text-[10px] h-4">GIF</Badge>
                                            )}
                                            {comment.parentId && (
                                                <Badge variant="outline" className="text-[10px] h-4">Yanıt</Badge>
                                            )}
                                        </div>
                                    </td>
                                    <td className="px-4 py-3 border-r border-transparent">
                                        <span className="text-sm text-muted-foreground group-hover:text-foreground transition-colors">
                                            {getMangaTitle(comment.mangaId)}
                                        </span>
                                    </td>
                                    <td className="px-4 py-3">
                                        <span className="text-sm text-muted-foreground group-hover:text-foreground transition-colors">
                                            {formatDistanceToNow(new Date(comment.createdAt), { addSuffix: true, locale: tr })}
                                        </span>
                                    </td>
                                    <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                                            onClick={() => setDeleteId(comment.id)}
                                        >
                                            <Trash2 className="h-4 w-4" />
                                        </Button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
                {filteredComments.length === 0 && (
                    <div className="flex flex-col items-center justify-center py-12">
                        <MessageSquare className="h-12 w-12 text-muted-foreground/50" />
                        <p className="mt-2 text-muted-foreground">Yorum bulunamadı</p>
                    </div>
                )}
            </div>

            {/* Delete Single Comment Dialog */}
            <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Yorum Sil</AlertDialogTitle>
                        <AlertDialogDescription>
                            Bu yorumu silmek istediğinizden emin misiniz? Bu işlem geri alınamaz.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>İptal</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={() => deleteId && handleDelete(deleteId)}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                            Sil
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            {/* Bulk Delete Dialog */}
            <AlertDialog open={bulkDeleteConfirm} onOpenChange={setBulkDeleteConfirm}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Toplu Silme</AlertDialogTitle>
                        <AlertDialogDescription>
                            {selectedComments.size} yorumu silmek istediğinizden emin misiniz? Bu işlem geri alınamaz.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>İptal</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={handleBulkDelete}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                            {selectedComments.size} Yorum Sil
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
};

export default AdminComments;
