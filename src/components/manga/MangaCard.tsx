import React from 'react';
import { Link } from 'react-router-dom';
import { Star, Eye, BookOpen } from 'lucide-react';
import { Manga } from '@/lib/types';
import { Badge } from '@/components/ui/badge';

interface MangaCardProps {
  manga: Manga;
  index?: number;
}

const MangaCard: React.FC<MangaCardProps> = ({ manga, index = 0 }) => {
  const formatViews = (views: number) => {
    if (views >= 1000000) return `${(views / 1000000).toFixed(1)}M`;
    if (views >= 1000) return `${(views / 1000).toFixed(0)}K`;
    return views.toString();
  };

  return (
    <Link
      to={`/manga/${manga.id}`}
      className={`group relative block overflow-hidden rounded-xl bg-card transition-all duration-300 hover-lift animate-fade-up opacity-0`}
      style={{ animationDelay: `${index * 0.05}s`, animationFillMode: 'forwards' }}
    >
      {/* Cover Image */}
      <div className="relative aspect-[2/3] overflow-hidden">
        <img
          src={manga.cover}
          alt={manga.title}
          className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-110"
          loading="lazy"
        />

        {/* Gradient Overlay */}
        <div className="absolute inset-0 bg-gradient-to-t from-background via-background/20 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />

        {/* Type Badge */}
        <Badge
          variant="secondary"
          className={`absolute left-2 top-2 border-none text-[10px] font-bold backdrop-blur-md ${manga.type === 'manhwa' ? 'bg-purple-600/90 text-white shadow-lg shadow-purple-500/20' :
            manga.type === 'manhua' ? 'bg-emerald-600/90 text-white shadow-lg shadow-emerald-500/20' :
              'bg-primary text-primary-foreground shadow-lg shadow-primary/20'
            }`}
        >
          {manga.type.toUpperCase()}
        </Badge>

        {/* Status Badge */}
        <Badge
          variant={manga.status === 'completed' ? 'default' : 'outline'}
          className={`absolute right-2 top-2 text-xs ${manga.status === 'completed'
            ? 'bg-primary/90 text-primary-foreground'
            : 'border-foreground/30 bg-background/80 backdrop-blur-sm'
            }`}
        >
          {manga.status === 'completed' ? 'Tamamlandı' : manga.status === 'ongoing' ? 'Devam Ediyor' : 'Ara'}
        </Badge>

        {/* Hover Info */}
        <div className="absolute bottom-0 left-0 right-0 translate-y-full p-3 transition-transform duration-300 group-hover:translate-y-0">
          <div className="flex items-center gap-3 text-xs text-foreground/80">
            <span className="flex items-center gap-1">
              <Star className="h-3 w-3 fill-primary text-primary" />
              {manga.ratings && manga.ratings.length > 0
                ? (manga.ratings.reduce((acc, curr) => acc + curr.rating, 0) / manga.ratings.length).toFixed(1)
                : '0.0'}
            </span>
            <span className="flex items-center gap-1">
              <Eye className="h-3 w-3" />
              {formatViews(manga.views)}
            </span>
            <span className="flex items-center gap-1">
              <BookOpen className="h-3 w-3" />
              {manga.chapters.length}
            </span>
          </div>
        </div>
      </div>

      {/* Info */}
      <div className="p-3">
        <h3 className="line-clamp-1 font-semibold text-foreground transition-colors group-hover:text-primary">
          {manga.title}
        </h3>
        <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">
          {manga.author}
        </p>
        <div className="mt-2 flex flex-wrap gap-1">
          {manga.genres.slice(0, 2).map((genre) => (
            <span
              key={genre}
              className="rounded-full bg-secondary px-2 py-0.5 text-[10px] text-muted-foreground"
            >
              {genre}
            </span>
          ))}
        </div>
      </div>
    </Link>
  );
};

export default MangaCard;
