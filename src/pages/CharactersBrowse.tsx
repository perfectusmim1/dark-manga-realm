import React from 'react';
import Header from '@/components/layout/Header';
import EntityBrowseGrid from '@/components/entities/EntityBrowseGrid';
import OfflineRequiredScreen from '@/components/offline/OfflineRequiredScreen';
import { useEffectiveOnlineStatus } from '@/hooks/useEffectiveOnlineStatus';
import { getCharacters } from '@/lib/database';
import { Character } from '@/lib/types';

const CharactersBrowse: React.FC = () => {
  const { isOnline } = useEffectiveOnlineStatus();
  const [characters, setCharacters] = React.useState<Character[]>([]);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    let isCancelled = false;

    const loadCharacters = async () => {
      try {
        const data = await getCharacters();
        if (!isCancelled) {
          setCharacters(data);
        }
      } finally {
        if (!isCancelled) {
          setLoading(false);
        }
      }
    };

    void loadCharacters();

    return () => {
      isCancelled = true;
    };
  }, []);

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
      <main className="flex-1 container mx-auto max-w-7xl px-4 py-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
        <EntityBrowseGrid
          title="Popüler Karakterler"
          
          searchPlaceholder="Karakter ara..."
          emptyMessage="Aradığınız karakter bulunamadı."
          countLabel="karakter"
          items={characters}
          loading={loading}
          buildHref={(character) => `/character/${character.id}`}
        />
      </main>
    </div>
  );
};

export default CharactersBrowse;
