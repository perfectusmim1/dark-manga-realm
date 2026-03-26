import React from 'react';
import Header from '@/components/layout/Header';
import EntityBrowseGrid from '@/components/entities/EntityBrowseGrid';
import OfflineRequiredScreen from '@/components/offline/OfflineRequiredScreen';
import { useEffectiveOnlineStatus } from '@/hooks/useEffectiveOnlineStatus';
import { getAuthors } from '@/lib/database';
import { Author } from '@/lib/types';

const AuthorsBrowse: React.FC = () => {
  const { isOnline } = useEffectiveOnlineStatus();
  const [authors, setAuthors] = React.useState<Author[]>([]);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    let isCancelled = false;

    const loadAuthors = async () => {
      try {
        const data = await getAuthors();
        if (!isCancelled) {
          setAuthors(data);
        }
      } finally {
        if (!isCancelled) {
          setLoading(false);
        }
      }
    };

    void loadAuthors();

    return () => {
      isCancelled = true;
    };
  }, []);

  if (!isOnline) {
    return (
      <OfflineRequiredScreen
        description="Yazar arşivi için internete bağlanın."
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
          title="Popüler Yazarlar"
          description="Manga dünyasının en sevilen yazarları"
          searchPlaceholder="Yazar ara..."
          emptyMessage="Aradığınız yazar bulunamadı."
          countLabel="yazar"
          items={authors}
          loading={loading}
          buildHref={(author) => `/author/${author.id}`}
          resolveRank={(_, index) => index + 1}
        />
      </main>
    </div>
  );
};

export default AuthorsBrowse;
