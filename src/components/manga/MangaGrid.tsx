import React from 'react';
import { Manga } from '@/lib/types';
import VirtualMangaGrid from './VirtualMangaGrid';

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
  return (
    <VirtualMangaGrid
      manga={manga}
      title={title}
      emptyMessage={emptyMessage}
    />
  );
};

export default MangaGrid;
