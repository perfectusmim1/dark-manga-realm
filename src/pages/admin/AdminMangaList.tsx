import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
    Plus,
    Search,
    Edit2,
    Trash2,
    Eye,
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
import { getAllMangas, deleteManga } from '@/lib/database';
import { Manga } from '@/lib/types';
import { toast } from 'sonner';

const AdminMangaList: React.FC = () => {
    const [mangas, setMangas] = useState<Manga[]>([]);
    const [searchQuery, setSearchQuery] = useState('');
    const [typeFilter, setTypeFilter] = useState<string>('all');
    const [statusFilter, setStatusFilter] = useState<string>('all');
    const [deleteId, setDeleteId] = useState<string | null>(null);

    useEffect(() => {
        loadMangas();
    }, []);

    const loadMangas = () => {
        setMangas(getAllMangas());
    };

    const handleDelete = () => {
        if (deleteId) {
            deleteManga(deleteId);
            loadMangas();
            toast.success('Manga silindi');
            setDeleteId(null);
        }
    };

    const filteredMangas = mangas.filter((manga) => {
        const matchesSearch = manga.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
            manga.author.toLowerCase().includes(searchQuery.toLowerCase());
        const matchesType = typeFilter === 'all' || manga.type === typeFilter;
        const matchesStatus = statusFilter === 'all' || manga.status === statusFilter;
        return matchesSearch && matchesType && matchesStatus;
    });

    const getStatusBadge = (status: string) => {
        switch (status) {
            case 'ongoing':
                return <Badge className="bg-green-500/20 text-green-500">Devam Ediyor</Badge>;
            case 'completed':
                return <Badge className="bg-primary/20 text-primary">Tamamlandı</Badge>;
            case 'hiatus':
                return <Badge className="bg-orange-500/20 text-orange-500">Ara Verildi</Badge>;
            default:
                return null;
        }
    };

    const getTypeBadge = (type: string) => {
        switch (type) {
            case 'manga':
                return <Badge variant="outline">Manga</Badge>;
            case 'manhwa':
                return <Badge variant="outline" className="border-purple-500 text-purple-500">Manhwa</Badge>;
            case 'manhua':
                return <Badge variant="outline" className="border-green-500 text-green-500">Manhua</Badge>;
            default:
                return null;
        }
    };

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold">Mangalar</h1>
                    <p className="text-muted-foreground">Tüm mangaları yönetin</p>
                </div>
                <Button asChild>
                    <Link to="/admin/mangas/new">
                        <Plus className="mr-2 h-4 w-4" />
                        Yeni Manga
                    </Link>
                </Button>
            </div>

            {/* Filters */}
            <div className="flex flex-wrap items-center gap-4">
                <div className="relative flex-1 min-w-[200px]">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                        placeholder="Manga veya yazar ara..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="pl-10"
                    />
                </div>

                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button variant="outline">
                            <Filter className="mr-2 h-4 w-4" />
                            Tür: {typeFilter === 'all' ? 'Tümü' : typeFilter}
                            <ChevronDown className="ml-2 h-4 w-4" />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent>
                        <DropdownMenuItem onClick={() => setTypeFilter('all')}>Tümü</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setTypeFilter('manga')}>Manga</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setTypeFilter('manhwa')}>Manhwa</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setTypeFilter('manhua')}>Manhua</DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>

                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button variant="outline">
                            <Filter className="mr-2 h-4 w-4" />
                            Durum: {statusFilter === 'all' ? 'Tümü' : statusFilter}
                            <ChevronDown className="ml-2 h-4 w-4" />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent>
                        <DropdownMenuItem onClick={() => setStatusFilter('all')}>Tümü</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setStatusFilter('ongoing')}>Devam Ediyor</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setStatusFilter('completed')}>Tamamlandı</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setStatusFilter('hiatus')}>Ara Verildi</DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            </div>

            {/* Manga List */}
            <div className="rounded-xl border border-border bg-card">
                <div className="overflow-x-auto">
                    <table className="w-full">
                        <thead>
                            <tr className="border-b border-border">
                                <th className="px-4 py-3 text-left text-sm font-medium text-muted-foreground">Manga</th>
                                <th className="px-4 py-3 text-left text-sm font-medium text-muted-foreground">Tür</th>
                                <th className="px-4 py-3 text-left text-sm font-medium text-muted-foreground">Durum</th>
                                <th className="px-4 py-3 text-left text-sm font-medium text-muted-foreground">Bölümler</th>
                                <th className="px-4 py-3 text-left text-sm font-medium text-muted-foreground">Görüntülenme</th>
                                <th className="px-4 py-3 text-right text-sm font-medium text-muted-foreground">İşlemler</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                            {filteredMangas.map((manga) => (
                                <tr key={manga.id} className="hover:bg-secondary/50">
                                    <td className="px-4 py-3">
                                        <div className="flex items-center gap-3">
                                            <img
                                                src={manga.cover}
                                                alt={manga.title}
                                                className="h-12 w-9 rounded object-cover"
                                            />
                                            <div>
                                                <p className="font-medium">{manga.title}</p>
                                                <p className="text-sm text-muted-foreground">{manga.author}</p>
                                            </div>
                                        </div>
                                    </td>
                                    <td className="px-4 py-3">{getTypeBadge(manga.type)}</td>
                                    <td className="px-4 py-3">{getStatusBadge(manga.status)}</td>
                                    <td className="px-4 py-3">{manga.chapters.length}</td>
                                    <td className="px-4 py-3">{manga.views.toLocaleString('tr-TR')}</td>
                                    <td className="px-4 py-3">
                                        <div className="flex items-center justify-end gap-2">
                                            <Button variant="ghost" size="icon" asChild>
                                                <Link to={`/manga/${manga.id}`} target="_blank">
                                                    <Eye className="h-4 w-4" />
                                                </Link>
                                            </Button>
                                            <Button variant="ghost" size="icon" asChild>
                                                <Link to={`/admin/mangas/${manga.id}`}>
                                                    <Edit2 className="h-4 w-4" />
                                                </Link>
                                            </Button>
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="text-destructive hover:text-destructive"
                                                onClick={() => setDeleteId(manga.id)}
                                            >
                                                <Trash2 className="h-4 w-4" />
                                            </Button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
                {filteredMangas.length === 0 && (
                    <div className="py-12 text-center text-muted-foreground">
                        Manga bulunamadı
                    </div>
                )}
            </div>

            {/* Delete Confirmation Dialog */}
            <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Manga Sil</AlertDialogTitle>
                        <AlertDialogDescription>
                            Bu mangayı silmek istediğinizden emin misiniz? Bu işlem geri alınamaz.
                            Tüm bölümler ve yorumlar da silinecektir.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>İptal</AlertDialogCancel>
                        <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                            Sil
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
};

export default AdminMangaList;
