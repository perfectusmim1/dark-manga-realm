import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { BookOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import MangaCard from '@/components/manga/MangaCard';
import type { Manga } from '@/lib/types';
import { formatGenreDisplayName } from '@/lib/mockData';
import { useDeviceProfile } from '@/hooks/use-device-profile';
import { cn } from '@/lib/utils';

interface MangaDetailDiscoverPanelProps {
  genres: string[];
  loading: boolean;
  similarMangas: Manga[];
}

const MangaDetailDiscoverPanel = ({
  genres,
  loading,
  similarMangas,
}: MangaDetailDiscoverPanelProps) => {
  const { disableHeavyEffects, prefersReducedMotion } = useDeviceProfile();

  const formattedGenres = useMemo(() => {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const genre of genres) {
      const formatted = formatGenreDisplayName(genre).trim();
      if (!formatted) continue;
      const key = formatted.toLocaleLowerCase('tr-TR');
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(formatted);
    }
    return result;
  }, [genres]);

  const uniqueSimilarMangas = useMemo(() => {
    const seen = new Set<string>();
    return similarMangas.filter((item) => {
      if (!item?.id || seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    });
  }, [similarMangas]);

  return (
    <div className="rounded-2xl border border-border/60 bg-card/65 p-4 sm:p-6 md:p-7">
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h3 className="text-xl sm:text-2xl font-bold tracking-tight">Benzer Seriler</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {formattedGenres.length > 0
              ? `${formattedGenres.slice(0, 3).join(', ')} türlerinde önerilen diğer seriler`
              : 'Tür ve etiket uyumuna göre önerilen seriler'}
          </p>
        </div>
        <Button variant="outline" size="sm" asChild className="w-full shrink-0 sm:w-auto">
          <Link to="/browse">Tüm Serilere Göz At</Link>
        </Button>
      </div>

      {loading ? (
        <div className="grid grid-cols-2 min-[390px]:grid-cols-3 lg:grid-cols-6 gap-2.5 sm:gap-3.5">
          {[1, 2, 3, 4, 5, 6].map((item) => (
            <div key={item} className={cn(!prefersReducedMotion && 'animate-pulse')}>
              <div className="aspect-[2/3] rounded-xl bg-muted" />
              <div className="mt-2 h-4 w-3/4 rounded bg-muted" />
            </div>
          ))}
        </div>
      ) : uniqueSimilarMangas.length > 0 ? (
        <div className="grid grid-cols-2 min-[390px]:grid-cols-3 lg:grid-cols-6 gap-2.5 sm:gap-3.5">
          {uniqueSimilarMangas.map((manga, index) => (
            <MangaCard
              key={manga.id}
              manga={manga}
              index={index}
              disableHeavyEffects={disableHeavyEffects || prefersReducedMotion}
              enableEntryAnimation={!prefersReducedMotion}
              entryAnimationClassName="animate-card-reveal-fast"
              entryAnimationDelayStepMs={10}
              entryAnimationDurationMs={170}
            />
          ))}
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-border/60 bg-secondary/10 py-14 text-center">
          <BookOpen className="mx-auto mb-4 h-11 w-11 text-muted-foreground/30" />
          <p className="text-muted-foreground">Benzer seri bulunamadı.</p>
          <p className="mt-1 text-sm text-muted-foreground/70">
            Daha fazla içerik eklendiğinde öneriler burada görünecek.
          </p>
        </div>
      )}
    </div>
  );
};

export default MangaDetailDiscoverPanel;
