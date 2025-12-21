import React from 'react';
import { Manga } from '@/lib/types';
import MangaCard from './MangaCard';

interface MangaGridProps {
  manga: Manga[];
  title?: string;
  emptyMessage?: string;
}

const MangaGrid: React.FC<MangaGridProps> = ({ 
  manga, 
  title, 
  emptyMessage = 'Manga bulunamadı' 
}) => {
  if (manga.length === 0) {
    return (
      <div className="flex min-h-[200px] items-center justify-center rounded-xl border border-dashed border-border bg-card/50 p-8">
        <p className="text-center text-muted-foreground">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <section>
      {title && (
        <h2 className="mb-6 text-xl font-bold tracking-tight text-foreground md:text-2xl">
          {title}
        </h2>
      )}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
        {manga.map((item, index) => (
          <MangaCard key={item.id} manga={item} index={index} />
        ))}
      </div>
    </section>
  );
};

export default MangaGrid;
