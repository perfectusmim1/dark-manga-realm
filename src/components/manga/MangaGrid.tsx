import React from 'react';
import { Manga } from '@/lib/types';
import VirtualMangaGrid from './VirtualMangaGrid';

interface MangaGridProps {
  manga: Manga[];
  title?: string;
  emptyMessage?: string;
  getColumnCount?: (viewportWidth: number) => number;
}

const MangaGrid: React.FC<MangaGridProps> = ({
  manga,
  title,
  emptyMessage = 'Manga bulunamadı',
  getColumnCount,
}) => {
  return (
    <VirtualMangaGrid
      manga={manga}
      title={title}
      emptyMessage={emptyMessage}
      getColumnCount={getColumnCount}
    />
  );
};

export default MangaGrid;
