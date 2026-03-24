import React from 'react';
import { Link } from 'react-router-dom';
import { formatDistanceToNow } from 'date-fns';
import { tr } from 'date-fns/locale';
import { BookOpen, Clock } from 'lucide-react';
import Header from '@/components/layout/Header';
import ListSkeleton from '@/components/skeletons/ListSkeleton';
import { Badge } from '@/components/ui/badge';
import { getLatestChapters, LatestChapterFeedItem } from '@/lib/database';

const formatChapterNumber = (value: number) => {
    if (Number.isInteger(value)) {
        return value.toString();
    }

    return value.toFixed(1).replace(/\.0$/, '');
};

const LatestChapters: React.FC = () => {
    const [chapters, setChapters] = React.useState<LatestChapterFeedItem[]>([]);
    const [isLoading, setIsLoading] = React.useState(true);

    React.useEffect(() => {
        const loadChapters = async () => {
            try {
                setIsLoading(true);
                const data = await getLatestChapters();
                setChapters(data);
            } catch (error) {
                console.error('Latest chapters page error:', error);
            } finally {
                setIsLoading(false);
            }
        };

        loadChapters();
    }, []);

    if (isLoading) {
        return (
            <>
                <Header />
                <ListSkeleton />
            </>
        );
    }

    return (
        <div className="min-h-screen bg-background">
            <Header />

            <main className="container pb-12 pt-20">
                <div className="mb-8 animate-fade-up opacity-0" style={{ animationDelay: '0.1s', animationFillMode: 'forwards' }}>
                    <div className="flex items-center gap-3">
                        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                            <Clock className="h-6 w-6" />
                        </div>
                        <div>
                            <h1 className="text-3xl font-bold tracking-tight">Son Bölümler</h1>
                            <p className="mt-1 text-muted-foreground">
                                Siteye en son eklenen bölümler, seri bilgisi ve eklenme zamanı ile birlikte.
                            </p>
                        </div>
                    </div>
                    <div className="mt-4">
                        <Badge variant="secondary" className="px-3 py-1 text-xs">
                            {chapters.length} bölüm listeleniyor
                        </Badge>
                    </div>
                </div>

                {chapters.length > 0 ? (
                    <div className="grid gap-3 xl:grid-cols-2">
                        {chapters.map((chapter, index) => (
                            <Link
                                key={chapter.chapterId}
                                to={`/manga/${chapter.mangaId}/chapter/${chapter.chapterId}`}
                                className="group flex items-center gap-3 rounded-2xl border border-border bg-card/40 p-3 transition-all hover:border-primary/40 hover:bg-card"
                                style={{ animationDelay: `${0.12 + index * 0.02}s`, animationFillMode: 'forwards' }}
                            >
                                <img
                                    src={chapter.mangaCover}
                                    alt={chapter.mangaTitle}
                                    className="h-20 w-14 shrink-0 rounded-xl object-cover shadow-sm transition-transform duration-300 group-hover:scale-[1.03]"
                                />

                                <div className="min-w-0 flex-1">
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="min-w-0">
                                            <div className="mb-1 flex flex-wrap items-center gap-2">
                                                {chapter.mangaType && (
                                                    <Badge variant="outline" className="text-[10px] uppercase">
                                                        {chapter.mangaType}
                                                    </Badge>
                                                )}
                                                <span className="text-[11px] text-muted-foreground">
                                                    {new Date(chapter.addedAt).toLocaleDateString('tr-TR', {
                                                        day: 'numeric',
                                                        month: 'short',
                                                        hour: '2-digit',
                                                        minute: '2-digit',
                                                    })}
                                                </span>
                                            </div>
                                            <h2 className="line-clamp-1 font-semibold transition-colors group-hover:text-primary">
                                                {chapter.mangaTitle}
                                            </h2>
                                            <p className="mt-1 line-clamp-1 text-sm text-primary">
                                                Bölüm {formatChapterNumber(chapter.chapterNumber)}
                                                {chapter.chapterTitle ? ` • ${chapter.chapterTitle}` : ''}
                                            </p>
                                        </div>

                                        <Badge variant="secondary" className="shrink-0 whitespace-nowrap text-[10px]">
                                            {formatDistanceToNow(new Date(chapter.addedAt), { addSuffix: true, locale: tr })}
                                        </Badge>
                                    </div>

                                    <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                                        <BookOpen className="h-3.5 w-3.5" />
                                        <span className="line-clamp-1">
                                            {chapter.releaseDate
                                                ? `Yayın tarihi: ${new Date(chapter.releaseDate).toLocaleDateString('tr-TR')}`
                                                : 'Yayın tarihi bilgisi yok'}
                                        </span>
                                    </div>
                                </div>
                            </Link>
                        ))}
                    </div>
                ) : (
                    <div className="flex min-h-[40vh] items-center justify-center rounded-2xl border border-dashed border-border bg-card/30">
                        <div className="text-center">
                            <Clock className="mx-auto h-14 w-14 text-muted-foreground/60" />
                            <h2 className="mt-4 text-xl font-semibold">Henüz bölüm yok</h2>
                            <p className="mt-2 text-muted-foreground">
                                Yeni bölümler eklendikçe burada görünecek.
                            </p>
                        </div>
                    </div>
                )}
            </main>
        </div>
    );
};

export default LatestChapters;
