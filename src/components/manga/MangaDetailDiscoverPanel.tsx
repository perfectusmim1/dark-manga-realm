import { Link } from 'react-router-dom';
import { BookOpen, Star } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import OptimizedImage from '@/components/media/OptimizedImage';
import type { Manga } from '@/lib/types';
import { getMangaTypeLabel } from '@/lib/mangaType';

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
  return (
    <div className="rounded-xl border border-border bg-card/50 p-4 sm:p-8">
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-2xl font-bold">Benzer Seriler</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {genres.slice(0, 3).join(', ')} turlerinde diger populer seriler
          </p>
        </div>
        <Button variant="outline" asChild className="w-full sm:w-auto">
          <Link to="/browse">Tum Serilere Goz At</Link>
        </Button>
      </div>

      {loading ? (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
          {[1, 2, 3, 4, 5, 6].map((item) => (
            <div key={item} className="animate-pulse">
              <div className="aspect-[2/3] rounded-lg bg-muted" />
              <div className="mt-2 h-4 w-3/4 rounded bg-muted" />
            </div>
          ))}
        </div>
      ) : similarMangas.length > 0 ? (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
          {similarMangas.map((manga, index) => (
            <Link
              key={manga.id}
              to={`/manga/${manga.id}`}
              className="group relative overflow-hidden rounded-lg border border-border bg-card transition-all hover:border-primary/50 hover:shadow-lg hover:shadow-primary/10"
            >
              <div className="aspect-[2/3] overflow-hidden">
                <OptimizedImage
                  src={manga.cover}
                  alt={manga.title}
                  priority={index < 2}
                  rootMargin="420px 0px"
                  containerClassName="h-full w-full"
                  placeholderClassName="rounded-none"
                  className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
              </div>
              <div className="absolute bottom-0 left-0 right-0 translate-y-full p-3 transition-transform group-hover:translate-y-0">
                <h4 className="line-clamp-2 text-sm font-semibold text-white">{manga.title}</h4>
                <div className="mt-1 flex items-center gap-2">
                  <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
                    {getMangaTypeLabel(manga.type)}
                  </Badge>
                  {typeof manga.averageRating === 'number' && manga.averageRating > 0 ? (
                    <span className="flex items-center gap-0.5 text-xs text-yellow-400">
                      <Star className="h-3 w-3 fill-current" />
                      {manga.averageRating}
                    </span>
                  ) : null}
                </div>
              </div>
              <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 to-transparent p-2 transition-opacity group-hover:opacity-0">
                <h4 className="line-clamp-2 text-xs font-medium text-white">{manga.title}</h4>
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-border bg-secondary/10 py-16 text-center">
          <BookOpen className="mx-auto mb-4 h-12 w-12 opacity-20 text-muted-foreground" />
          <p className="text-muted-foreground">Benzer seri bulunamadi.</p>
          <p className="mt-1 text-sm text-muted-foreground/70">
            Daha fazla icerik eklendiginde oneriler burada gorunecek.
          </p>
        </div>
      )}
    </div>
  );
};

export default MangaDetailDiscoverPanel;
