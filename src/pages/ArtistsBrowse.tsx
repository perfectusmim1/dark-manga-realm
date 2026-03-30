import React from 'react';
import Header from '@/components/layout/Header';
import EntityBrowseGrid from '@/components/entities/EntityBrowseGrid';
import OfflineRequiredScreen from '@/components/offline/OfflineRequiredScreen';
import { useEffectiveOnlineStatus } from '@/hooks/useEffectiveOnlineStatus';
import { getArtists } from '@/lib/database';
import { Artist } from '@/lib/types';

const ArtistsBrowse: React.FC = () => {
  const { isOnline } = useEffectiveOnlineStatus();
  const [artists, setArtists] = React.useState<Artist[]>([]);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    let isCancelled = false;

    const loadArtists = async () => {
      try {
        const data = await getArtists();
        if (!isCancelled) {
          setArtists(data);
        }
      } finally {
        if (!isCancelled) {
          setLoading(false);
        }
      }
    };

    void loadArtists();

    return () => {
      isCancelled = true;
    };
  }, []);

  if (!isOnline) {
    return (
      <OfflineRequiredScreen
        description="Çizer arşivi için internete bağlanın."
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
          title="Popüler Çizerler"
          description="Manga dünyasının en sevilen çizerleri"
          searchPlaceholder="Çizer ara..."
          emptyMessage="Aradığınız çizer bulunamadı."
          countLabel="çizer"
          items={artists}
          loading={loading}
          buildHref={(artist) => `/artist/${artist.id}`}
        />
      </main>
    </div>
  );
};

export default ArtistsBrowse;
