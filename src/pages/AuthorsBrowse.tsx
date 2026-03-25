import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Trophy, Heart, Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { getAuthors } from '@/lib/database';
import { Author } from '@/lib/types';
import Header from '@/components/layout/Header';
import EntityPlaceholderArt from '@/components/entities/EntityPlaceholderArt';

const AuthorsBrowse: React.FC = () => {
    const [authors, setAuthors] = useState<Author[]>([]);
    const [searchQuery, setSearchQuery] = useState('');
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const loadAuthors = async () => {
            const data = await getAuthors();
            setAuthors(data);
            setLoading(false);
        };
        loadAuthors();
    }, []);

    const filteredAuthors = authors.filter(a =>
        a.name.toLowerCase().includes(searchQuery.toLowerCase())
    );

    return (
        <div className="min-h-screen bg-background flex flex-col pt-16">
            <Header />
            <main className="flex-1 container mx-auto px-4 py-8 max-w-7xl">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-12">
                    <div>
                        <h1 className="text-4xl font-black mb-2">Popüler Yazarlar</h1>
                        <p className="text-muted-foreground">Manga dünyasının en sevilen yazarları</p>
                    </div>

                    <div className="flex items-center gap-4 w-full md:w-auto">
                        <div className="relative flex-1 md:w-80">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            <Input
                                placeholder="Yazar ara..."
                                className="pl-10 rounded-xl"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                            />
                        </div>
                    </div>
                </div>

                {loading ? (
                    <div className="grid gap-6 grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                        {[...Array(10)].map((_, i) => (
                            <div key={i} className="aspect-[3/4] rounded-2xl bg-secondary animate-pulse" />
                        ))}
                    </div>
                ) : (
                    <div className="grid gap-8 grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                        {filteredAuthors.map((author, index) => {
                            // Calculate a pseudo rank just for visual, since they are sorted by count
                            const rank = index + 1;
                            
                            return (
                                <Link
                                    key={author.id}
                                    to={`/author/${author.id}`}
                                    className="group relative flex flex-col items-center text-center"
                                >
                                    <div className="relative aspect-[3/4] w-full rounded-2xl overflow-hidden border border-border bg-card shadow-lg transition-all duration-300 group-hover:-translate-y-2 group-hover:shadow-2xl group-hover:border-primary/50">
                                        {author.imageUrl ? (
                                             <img
                                                 src={author.imageUrl}
                                                 className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
                                                 alt={author.name}
                                             />
                                        ) : (
                                            <EntityPlaceholderArt
                                                name={author.name}
                                                initialClassName="text-5xl sm:text-6xl"
                                            />
                                        )}
                                        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-60 group-hover:opacity-90 transition-opacity" />

                                        {/* Rank Badge */}
                                        <div className="absolute top-3 left-3 flex items-center gap-1.5 px-3 py-1 bg-black/60 backdrop-blur-md rounded-lg text-xs font-bold border border-white/10">
                                            <Trophy className={`h-3 w-3 ${rank && rank <= 3 ? 'text-yellow-400' : 'text-gray-400'}`} />
                                            <span>#{rank}</span>
                                        </div>

                                        {/* Likes Badge */}
                                        <div className="absolute bottom-3 right-3 flex items-center gap-1 text-white text-xs font-medium">
                                            <Heart className="h-4 w-4 fill-primary text-primary" />
                                            {author.likesCount || 0}
                                        </div>
                                    </div>
                                    <h3 className="mt-4 font-bold text-lg line-clamp-1 group-hover:text-primary transition-colors">{author.name}</h3>
                                </Link>
                            );
                        })}
                    </div>
                )}

                {filteredAuthors.length === 0 && !loading && (
                    <div className="text-center py-20">
                        <p className="text-2xl font-bold text-muted-foreground">Aradığınız yazar bulunamadı.</p>
                    </div>
                )}
            </main>
        </div>
    );
};

export default AuthorsBrowse;
