import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, Heart, Mic2, Calendar } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { getVoiceActorById, toggleEntityLike } from '@/lib/database';
import { VoiceActor } from '@/lib/types';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import Header from '@/components/layout/Header';
import CommentSection from '@/components/comments/CommentSection';
import EntityPlaceholderArt from '@/components/entities/EntityPlaceholderArt';
import EntityDetailRankBadge from '@/components/entities/EntityDetailRankBadge';
import EntityMetadataGrid from '@/components/entities/EntityMetadataGrid';
import EntityGalleryGrid from '@/components/entities/EntityGalleryGrid';
import { supabase } from '@/lib/supabase';
import OfflineRequiredScreen from '@/components/offline/OfflineRequiredScreen';
import { useEffectiveOnlineStatus } from '@/hooks/useEffectiveOnlineStatus';
import OptimizedImage from '@/components/media/OptimizedImage';
import DeferredMount from '@/components/performance/DeferredMount';

const VoiceActorDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const { isOnline } = useEffectiveOnlineStatus();
  const [voiceActor, setVoiceActor] = useState<VoiceActor | null>(null);
  const [loading, setLoading] = useState(true);
  const [isLiked, setIsLiked] = useState(false);

  if (!isOnline) {
    return (
      <OfflineRequiredScreen
        description="Seslendiren sayfaları internet bağlantısı gerektirir."
        actionHref="/downloads"
        actionLabel="İndirilenlere Git"
      />
    );
  }

  useEffect(() => {
    const fetchVoiceActor = async () => {
      if (!id) return;
      try {
        const data = await getVoiceActorById(id);
        if (data) {
          setVoiceActor(data);
          if (user) {
            const { data: liked } = await supabase
              .from('voice_actor_likes')
              .select('*')
              .eq('voice_actor_id', id)
              .eq('user_id', user.id)
              .maybeSingle();
            setIsLiked(!!liked);
          }
        }
      } catch (error) {
        console.error(error);
        toast.error('Seslendiren bilgileri yüklenemedi');
      } finally {
        setLoading(false);
      }
    };

    void fetchVoiceActor();
  }, [id, user]);

  const handleLike = async () => {
    if (!user) {
      toast.error('Bu işlemi yapmak için giriş yapmalısınız');
      return;
    }

    try {
      await toggleEntityLike('voice_actor', id!, user.id);
      setIsLiked(!isLiked);
      setVoiceActor((current) => current ? ({
        ...current,
        likesCount: isLiked ? current.likesCount - 1 : current.likesCount + 1,
      }) : current);
      toast.success(isLiked ? 'Beğeni kaldırıldı' : 'Beğenildi');
    } catch {
      toast.error('İşlem başarısız oldu');
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary" />
      </div>
    );
  }

  if (!voiceActor) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-4">
        <h1 className="text-2xl font-bold">Seslendiren Bulunamadı</h1>
        <Button asChild variant="outline">
          <Link to="/voice-actors">Seslendirenlere Dön</Link>
        </Button>
      </div>
    );
  }

  const hasDescription = Boolean(voiceActor.description?.trim());

  return (
    <div className="min-h-screen bg-background flex flex-col pt-16">
      <Header />

      <main className="flex-1 container mx-auto px-4 py-8 max-w-6xl">
        <Link to="/voice-actors" className="inline-flex items-center text-muted-foreground hover:text-primary mb-6 transition-colors">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Tüm Seslendirenler
        </Link>

        <div className="grid gap-8 md:grid-cols-[minmax(0,18rem),minmax(0,1fr)] xl:grid-cols-[minmax(0,19rem),minmax(0,1fr)]">
          <div className="space-y-6 md:max-w-[19rem]">
            <div className="relative group">
              <div className="absolute -inset-1 bg-gradient-to-r from-primary/50 to-orange-500/40 rounded-2xl blur opacity-25 group-hover:opacity-100 transition duration-500" />
              <div className="relative aspect-[3/4] rounded-xl overflow-hidden border border-border shadow-2xl bg-card flex flex-col items-center justify-center">
                {voiceActor.imageUrl ? (
                  <OptimizedImage
                    src={voiceActor.imageUrl}
                    alt={voiceActor.name}
                    priority
                    containerClassName="h-full w-full"
                    placeholderClassName="rounded-none"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <EntityPlaceholderArt
                    name={voiceActor.name}
                    initialClassName="text-8xl md:text-9xl"
                  />
                )}
                {voiceActor.rank && voiceActor.rank <= 3 && (
                  <div className="absolute top-4 left-4">
                    <EntityDetailRankBadge rank={voiceActor.rank} />
                  </div>
                )}
              </div>
            </div>

            <div className="flex gap-4">
              <Button
                variant={isLiked ? 'default' : 'outline'}
                size="lg"
                className="flex-1 rounded-xl shadow-lg hover:scale-[1.02] transition-transform"
                onClick={handleLike}
              >
                <Heart className={`mr-2 h-5 w-5 ${isLiked ? 'fill-current' : ''}`} />
                {voiceActor.likesCount || 0}
              </Button>
              {voiceActor.rank && (
                <div className="w-20 h-11 flex items-center justify-center rounded-xl bg-secondary border border-border">
                  <span className="text-xl font-bold">#{voiceActor.rank}</span>
                </div>
              )}
            </div>
          </div>

          <div className="space-y-8">
            <div>
              <h1 className="text-4xl md:text-5xl font-black bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text text-transparent">
                {voiceActor.name}
              </h1>
              <div className="flex items-center gap-4 mt-4 text-muted-foreground">
                <div className="flex items-center gap-1">
                  <Calendar className="h-4 w-4" />
                  <span>{new Date(voiceActor.createdAt || Date.now()).getFullYear()}'de Eklendi</span>
                </div>
              </div>
            </div>

            <EntityMetadataGrid
              metadata={voiceActor.details}
              alternativeNames={voiceActor.alternativeNames}
              sourceLinks={voiceActor.sourceLinks}
              title="Seslendiren Profili"
            />

            {hasDescription && (
              <div className="space-y-4">
                <h2 className="text-2xl font-bold">Hakkında</h2>
                <div className="bg-secondary/30 rounded-2xl p-6 border border-border leading-relaxed text-lg italic text-foreground/90 whitespace-pre-line">
                  {voiceActor.description}
                </div>
              </div>
            )}

            {voiceActor.roles && voiceActor.roles.length > 0 && (
              <div className="space-y-4">
                <h2 className="text-2xl font-bold flex items-center gap-2">
                  <Mic2 className="h-6 w-6 text-primary" />
                  Seslendirdiği Karakterler
                </h2>
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  {voiceActor.roles.map((role) => (
                    <Link
                      key={role.id}
                      to={`/character/${role.characterId}`}
                      className="group rounded-2xl border border-border bg-card/70 p-4 transition-all hover:-translate-y-1 hover:border-primary/40 hover:shadow-lg"
                    >
                      <div className="flex items-start gap-4">
                        <div className="h-20 w-20 overflow-hidden rounded-2xl border border-border bg-secondary">
                          {role.characterImageUrl ? (
                            <OptimizedImage
                              src={role.characterImageUrl}
                              alt={role.characterName}
                              rootMargin="420px 0px"
                              containerClassName="h-full w-full"
                              placeholderClassName="rounded-none"
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            <EntityPlaceholderArt
                              name={role.characterName}
                              className="rounded-none"
                              initialClassName="text-2xl"
                            />
                          )}
                        </div>
                        <div className="min-w-0 flex-1 space-y-2">
                          <div>
                            <p className="line-clamp-2 font-semibold group-hover:text-primary">
                              {role.characterName}
                            </p>
                            <p className="text-sm text-muted-foreground">
                              {role.roleLabel || 'Ses Rolü'}
                            </p>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {role.language && (
                              <Badge variant="secondary" className="rounded-full">
                                {role.language}
                              </Badge>
                            )}
                            {role.localeCode && (
                              <Badge variant="outline" className="rounded-full uppercase">
                                {role.localeCode}
                              </Badge>
                            )}
                          </div>
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            )}

            <EntityGalleryGrid images={voiceActor.gallery} title="Seslendiren Galerisi" />

            <Separator className="my-8" />

            <DeferredMount placeholderMinHeight={360} rootMargin="720px 0px">
              <div className="space-y-6">
                <CommentSection entityId={id} entityType="voice_actor" />
              </div>
            </DeferredMount>
          </div>
        </div>
      </main>
    </div>
  );
};

export default VoiceActorDetail;
