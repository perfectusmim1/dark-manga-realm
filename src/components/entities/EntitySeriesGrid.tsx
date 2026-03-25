import React from 'react';
import MangaCard from '@/components/manga/MangaCard';
import { Manga } from '@/lib/types';

interface EntitySeriesGridProps {
  mangas?: Manga[];
  emptyText: string;
}

const EntitySeriesGrid: React.FC<EntitySeriesGridProps> = ({ mangas, emptyText }) => {
  if (!mangas || mangas.length === 0) {
    return <p className="text-muted-foreground">{emptyText}</p>;
  }

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 2xl:grid-cols-4">
      {mangas.map((manga, index) => (
        <MangaCard key={manga.id} manga={manga} index={index} />
      ))}
    </div>
  );
};

export default EntitySeriesGrid;
