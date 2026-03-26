import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Trophy, Heart, Search, Filter } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { getCharacters } from '@/lib/database';
import { Character } from '@/lib/types';
import Header from '@/components/layout/Header';
import EntityPlaceholderArt from '@/components/entities/EntityPlaceholderArt';
import OfflineRequiredScreen from '@/components/offline/OfflineRequiredScreen';
import { useEffectiveOnlineStatus } from '@/hooks/useEffectiveOnlineStatus';

const CharactersBrowse: React.FC = () => {
    const { isOnline } = useEffectiveOnlineStatus();
    const [characters, setCharacters] = useState<Character[]>([]);
    const [searchQuery, setSearchQuery] = useState('');
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const loadCharacters = async () => {
            const data = await getCharacters();
            setCharacters(data);
            setLoading(false);
        };
        loadCharacters();
    }, []);

    const filteredCharacters = characters.filter(c =>
        c.name.toLowerCase().includes(searchQuery.toLowerCase())
    );

    if (!isOnline) {
        return (
            <OfflineRequiredScreen
                description="Karakter arşivi için internete bağlanın."
                actionHref="/downloads"
                actionLabel="İndirilenlere Git"
            />
        );
    }

    return (
        <div className="min-h-screen bg-background flex flex-col pt-16">
            <Header />
            <main className="flex-1 container mx-auto px-4 py-8 max-w-7xl animate-in fade-in slide-in-from-bottom-4 duration-500">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-12">
                    <div>
                        <h1 className="text-4xl font-black mb-2">Popüler Karakterler</h1>
                        <p className="text-muted-foreground">Manga dünyasının en sevilen karakterleri ve sıralamaları</p>
                    </div>

                    <div className="flex items-center gap-4 w-full md:w-auto">
                        <div className="relative flex-1 md:w-80">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            <Input
                                placeholder="Karakter ara..."
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
                        {filteredCharacters.map((char, index) => (
                            <Link
                                key={char.id}
                                to={`/character/${char.id}`}
                                className="group relative flex flex-col items-center text-center"
                            >
                                <div className="relative aspect-[3/4] w-full overflow-hidden rounded-2xl border border-border bg-card shadow-lg [transform:translateZ(0)] transition-all duration-300 group-hover:-translate-y-2 group-hover:shadow-2xl group-hover:border-primary/50">
                                    {char.imageUrl ? (
                                        <img
                                            src={char.imageUrl}
                                            className="h-full w-full rounded-[inherit] object-cover transform-gpu transition-transform duration-500 group-hover:scale-110"
                                            alt={char.name}
                                        />
                                    ) : (
                                        <EntityPlaceholderArt
                                            name={char.name}
                                            className="rounded-[inherit]"
                                            initialClassName="text-5xl sm:text-6xl"
                                        />
                                    )}
                                    <div className="absolute inset-0 rounded-[inherit] bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-60 transition-opacity group-hover:opacity-90" />

                                    {/* Rank Badge */}
                                    <div className="absolute top-3 left-3 flex items-center gap-1.5 px-3 py-1 bg-black/60 backdrop-blur-md rounded-lg text-xs font-bold border border-white/10">
                                        <Trophy className={`h-3 w-3 ${char.rank && char.rank <= 3 ? 'text-yellow-400' : 'text-gray-400'}`} />
                                        <span>#{char.rank}</span>
                                    </div>

                                    {/* Likes Badge */}
                                    <div className="absolute bottom-3 right-3 flex items-center gap-1 text-white text-xs font-medium">
                                        <Heart className="h-4 w-4 fill-primary text-primary" />
                                        {char.likesCount}
                                    </div>
                                </div>
                                <h3 className="mt-4 font-bold text-lg line-clamp-1 group-hover:text-primary transition-colors">{char.name}</h3>
                            </Link>
                        ))}
                    </div>
                )}

                {filteredCharacters.length === 0 && !loading && (
                    <div className="text-center py-20">
                        <p className="text-2xl font-bold text-muted-foreground">Aradığınız karakter bulunamadı.</p>
                    </div>
                )}
            </main>
        </div>
    );
};

export default CharactersBrowse;
