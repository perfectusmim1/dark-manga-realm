import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Heart, Trophy, BookOpen, ArrowLeft, Calendar } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { getCharacterById, getMangaCharacters, toggleEntityLike } from '@/lib/database';
import { Character } from '@/lib/types';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import Header from '@/components/layout/Header';
import CommentSection from '@/components/comments/CommentSection';
import EntityPlaceholderArt from '@/components/entities/EntityPlaceholderArt';
import EntitySeriesGrid from '@/components/entities/EntitySeriesGrid';
import EntityMetadataGrid from '@/components/entities/EntityMetadataGrid';
import EntityGalleryGrid from '@/components/entities/EntityGalleryGrid';
import { supabase } from '@/lib/supabase'; // Added for like check
import OfflineRequiredScreen from '@/components/offline/OfflineRequiredScreen';
import { useEffectiveOnlineStatus } from '@/hooks/useEffectiveOnlineStatus';
import OptimizedImage from '@/components/media/OptimizedImage';
import DeferredMount from '@/components/performance/DeferredMount';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { normalizeEntityDisplayText } from '@/lib/entityMetadata';

interface RelativeLinkEntry {
    text: string;
    characterId?: string;
}

const normalizeRelativeLookupKey = (value?: string | null) => (
    (value || '')
        .toLocaleLowerCase('tr-TR')
        .replace(/[\u{1F300}-\u{1FAFF}\u2600-\u27BF]/gu, ' ')
        .replace(/[^\p{L}\p{N}\s'-]/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim()
);

const parseRelativeNameCandidate = (value: string) => {
    const normalizedValue = normalizeEntityDisplayText(value);
    const withoutLeadingSymbols = normalizedValue.replace(/^[^\p{L}\p{N}]+/gu, '').trim();
    const match = withoutLeadingSymbols.match(/^[^(,\n]+/u);
    return normalizeRelativeLookupKey(match?.[0] || withoutLeadingSymbols);
};

const buildRelativeLinkEntries = (
    relatives: string[] | undefined,
    relatedCharacters: Character[],
    currentCharacterId?: string,
): RelativeLinkEntry[] => {
    if (!Array.isArray(relatives) || relatives.length === 0) {
        return [];
    }

    const lookup = new Map<string, string>();

    relatedCharacters.forEach((relatedCharacter) => {
        if (!relatedCharacter.id || relatedCharacter.id === currentCharacterId) {
            return;
        }

        const names = [
            relatedCharacter.name,
            ...(relatedCharacter.alternativeNames || []),
        ];

        names.forEach((name) => {
            const key = normalizeRelativeLookupKey(name);
            if (key && !lookup.has(key)) {
                lookup.set(key, relatedCharacter.id);
            }
        });
    });

    return relatives
        .map((relative) => normalizeEntityDisplayText(relative))
        .filter(Boolean)
        .map((relative) => ({
            text: relative,
            characterId: lookup.get(parseRelativeNameCandidate(relative)),
        }));
};

const CharacterDetail: React.FC = () => {
    const { id } = useParams<{ id: string }>();
    const { user } = useAuth();
    const { isOnline } = useEffectiveOnlineStatus();
    const [character, setCharacter] = useState<Character | null>(null);
    const [relatedSeriesCharacters, setRelatedSeriesCharacters] = useState<Character[]>([]);
    const [loading, setLoading] = useState(true);
    const [isLiked, setIsLiked] = useState(false);
    const [activeDetailTab, setActiveDetailTab] = useState<'general' | 'series' | 'gallery'>('general');

    if (!isOnline) {
        return (
            <OfflineRequiredScreen
                description="Karakter sayfaları internet bağlantısı gerektirir."
                actionHref="/downloads"
                actionLabel="İndirilenlere Git"
            />
        );
    }

    useEffect(() => {
        const fetchCharacter = async () => {
            if (!id) return;
            try {
                const data = await getCharacterById(id);
                if (data) {
                    setCharacter(data);

                    const seriesIds = Array.from(new Set((data.series || []).map((series) => series.id).filter(Boolean)));
                    if (seriesIds.length > 0) {
                        const relatedCharacters = await Promise.all(seriesIds.map((seriesId) => getMangaCharacters(seriesId)));
                        const uniqueCharacters = Array.from(
                            new Map(
                                relatedCharacters
                                    .flat()
                                    .filter((relatedCharacter) => relatedCharacter?.id)
                                    .map((relatedCharacter) => [relatedCharacter.id, relatedCharacter]),
                            ).values(),
                        );
                        setRelatedSeriesCharacters(uniqueCharacters);
                    } else {
                        setRelatedSeriesCharacters([]);
                    }

                    // Check if liked
                    if (user) {
                        const { data: liked } = await supabase
                            .from('character_likes')
                            .select('*')
                            .eq('character_id', id)
                            .eq('user_id', user.id)
                            .maybeSingle();
                        setIsLiked(!!liked);
                    }
                }
            } catch (error) {
                console.error(error);
                toast.error('Karakter bilgileri yüklenemedi');
            } finally {
                setLoading(false);
            }
        };

        fetchCharacter();
    }, [id, user]);

    const handleLike = async () => {
        if (!user) {
            toast.error('Bu işlemi yapmak için giriş yapmalısınız');
            return;
        }

        try {
            await toggleEntityLike('character', id!, user.id);
            setIsLiked(!isLiked);
            // Update local count
            if (character) {
                setCharacter({
                    ...character,
                    likesCount: isLiked ? character.likesCount - 1 : character.likesCount + 1
                });
            }
            toast.success(isLiked ? 'Beğeni kaldırıldı' : 'Beğenildi');
        } catch (error) {
            toast.error('İşlem başarısız oldu');
        }
    };

    if (loading) {
        return (
            <div className="min-h-screen bg-background flex items-center justify-center">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
            </div>
        );
    }

    if (!character) {
        return (
            <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-4">
                <h1 className="text-2xl font-bold">Karakter Bulunamadı</h1>
                <Button asChild variant="outline">
                    <Link to="/">Ana Sayfaya Dön</Link>
                </Button>
            </div>
        );
    }

    const hasDescription = Boolean(character.description?.trim());
    const relativeLinkEntries = buildRelativeLinkEntries(
        character.details?.relatives,
        relatedSeriesCharacters,
        character.id,
    );
    const relativesOverride = relativeLinkEntries.length > 0 ? (
        <div className="space-y-2">
            {relativeLinkEntries.map((entry) => {
                const namePart = entry.text.match(/^[^(,\n]+/u)?.[0]?.trim() || entry.text;
                const trailingPart = entry.text.slice(namePart.length);

                return (
                    <div key={entry.text}>
                        {entry.characterId ? (
                            <Link
                                to={`/character/${entry.characterId}`}
                                className="font-medium text-primary transition-colors hover:text-primary/80 hover:underline"
                            >
                                {namePart}
                            </Link>
                        ) : (
                            <span>{namePart}</span>
                        )}
                        <span className="text-foreground/80">{trailingPart}</span>
                    </div>
                );
            })}
        </div>
    ) : undefined;
    const descriptionSection = hasDescription ? (
        <div className="space-y-4">
            <h2 className="text-2xl font-bold">Hikayesi / Tanımı</h2>
            <div className="bg-secondary/30 rounded-2xl p-6 border border-border leading-relaxed text-lg italic text-foreground/90">
                {character.description}
            </div>
        </div>
    ) : null;

    return (
        <div className="min-h-screen bg-background flex flex-col pt-16">
            <Header />

            <main className="flex-1 container mx-auto px-4 py-8 max-w-6xl">
                <Link to="/" className="inline-flex items-center text-muted-foreground hover:text-primary mb-6 transition-colors">
                    <ArrowLeft className="mr-2 h-4 w-4" />
                    Geri Dön
                </Link>

                <div className="grid gap-8 md:grid-cols-[minmax(0,18rem),minmax(0,1fr)] xl:grid-cols-[minmax(0,19rem),minmax(0,1fr)]">
                    {/* Left Side - Image & Stats */}
                    <div className="space-y-6 md:max-w-[19rem]">
                        <div className="relative group">
                            <div className="absolute -inset-1 bg-gradient-to-r from-primary/50 to-purple-600/50 rounded-2xl blur opacity-25 group-hover:opacity-100 transition duration-500" />
                            <div className="relative aspect-[3/4] rounded-xl overflow-hidden border border-border shadow-2xl bg-card">
                                {character.imageUrl ? (
                                    <OptimizedImage
                                        src={character.imageUrl}
                                        alt={character.name}
                                        allowProxy
                                        priority
                                        containerClassName="h-full w-full"
                                        placeholderClassName="rounded-none"
                                        className="w-full h-full object-cover"
                                    />
                                ) : (
                                    <EntityPlaceholderArt
                                        name={character.name}
                                        initialClassName="text-8xl md:text-9xl"
                                    />
                                )}
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
                                className="flex-1 rounded-xl shadow-lg transition-colors"
                                onClick={handleLike}
                            >
                                <Heart className={`mr-2 h-5 w-5 ${isLiked ? 'fill-current' : ''}`} />
                                {character.likesCount}
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
                        <Tabs value={activeDetailTab} onValueChange={(value) => setActiveDetailTab(value as 'general' | 'series' | 'gallery')} className="space-y-8">
                            <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
                                <div className="min-w-0">
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

                                <div className="w-full xl:w-auto xl:flex-none">
                                    <TabsList className="grid h-auto w-full grid-cols-3 rounded-2xl border border-border bg-secondary/30 p-1.5 xl:w-auto xl:min-w-[320px]">
                                        <TabsTrigger
                                            value="general"
                                            className="rounded-xl px-4 py-2.5 text-sm font-semibold data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-lg"
                                        >
                                            Genel
                                        </TabsTrigger>
                                        <TabsTrigger
                                            value="series"
                                            className="rounded-xl px-4 py-2.5 text-sm font-semibold data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-lg"
                                        >
                                            Seri
                                        </TabsTrigger>
                                        <TabsTrigger
                                            value="gallery"
                                            className="rounded-xl px-4 py-2.5 text-sm font-semibold data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-lg"
                                        >
                                            Galeri
                                        </TabsTrigger>
                                    </TabsList>
                                </div>
                            </div>

                            <TabsContent value="general" className="mt-0 animate-in fade-in slide-in-from-bottom-4 duration-500">
                                <div className="space-y-8">
                                    <EntityMetadataGrid
                                        metadata={character.details}
                                        alternativeNames={character.alternativeNames}
                                        sourceLinks={character.sourceLinks}
                                        title="Karakter Profili"
                                        metadataOverrides={relativesOverride ? { Yakınlar: relativesOverride } : undefined}
                                    />

                                    {descriptionSection}
                                </div>
                            </TabsContent>

                            <TabsContent value="series" className="mt-0 animate-in fade-in slide-in-from-bottom-4 duration-500">
                                <div className="space-y-4">
                                    <h2 className="text-2xl font-bold flex items-center gap-2">
                                        <BookOpen className="h-6 w-6 text-primary" />
                                        Seri Bağlantıları
                                    </h2>
                                    <EntitySeriesGrid
                                        mangas={character.series}
                                        emptyText="Henüz bir seriyle ilişkilendirilmemiş."
                                    />
                                </div>
                            </TabsContent>

                            <TabsContent value="gallery" className="mt-0 animate-in fade-in slide-in-from-bottom-4 duration-500">
                                <EntityGalleryGrid
                                    images={character.gallery}
                                    title="Karakter Galerisi"
                                    emptyText="Bu karakter için galeri bulunamadı."
                                />
                            </TabsContent>
                        </Tabs>
                    </div>
                </div>

                <Separator className="my-8" />

                <DeferredMount placeholderMinHeight={360} rootMargin="720px 0px">
                    <div className="space-y-6">
                        <CommentSection entityId={id} entityType="character" />
                    </div>
                </DeferredMount>
            </main>
        </div>
    );
};

export default CharacterDetail;
