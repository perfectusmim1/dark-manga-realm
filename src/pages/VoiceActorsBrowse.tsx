import React from 'react';
import Header from '@/components/layout/Header';
import EntityBrowseGrid from '@/components/entities/EntityBrowseGrid';
import OfflineRequiredScreen from '@/components/offline/OfflineRequiredScreen';
import { useEffectiveOnlineStatus } from '@/hooks/useEffectiveOnlineStatus';
import { getVoiceActors } from '@/lib/database';
import { VoiceActor } from '@/lib/types';

const VoiceActorsBrowse: React.FC = () => {
  const { isOnline } = useEffectiveOnlineStatus();
  const [voiceActors, setVoiceActors] = React.useState<VoiceActor[]>([]);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    let isCancelled = false;

    const loadVoiceActors = async () => {
      try {
        const data = await getVoiceActors();
        if (!isCancelled) {
          setVoiceActors(data);
        }
      } finally {
        if (!isCancelled) {
          setLoading(false);
        }
      }
    };

    void loadVoiceActors();

    return () => {
      isCancelled = true;
    };
  }, []);

  if (!isOnline) {
    return (
      <OfflineRequiredScreen
        description="Seslendiren arşivi için internete bağlanın."
        actionHref="/downloads"
        actionLabel="İndirilenlere Git"
      />
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col pt-16">
      <Header />
      <main className="flex-1 container mx-auto max-w-7xl px-4 py-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
        <EntityBrowseGrid
          title="Seslendirenler"
          description="Karakterlere hayat veren seslendirenleri keşfedin"
          searchPlaceholder="Seslendiren ara..."
          emptyMessage="Aradığınız seslendiren bulunamadı."
          countLabel="seslendiren"
          items={voiceActors}
          loading={loading}
          buildHref={(voiceActor) => `/voice-actor/${voiceActor.id}`}
        />
      </main>
    </div>
  );
};

export default VoiceActorsBrowse;
