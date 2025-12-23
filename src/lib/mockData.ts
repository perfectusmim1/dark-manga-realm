import { Chapter, Manga } from './types';
import { getAllMangas, initializeDatabase } from './database';

// Available genres for filtering/selection
export const allGenres = [
  'Aksiyon',
  'Macera',
  'Komedi',
  'Dram',
  'Fantastik',
  'Korku',
  'Gizem',
  'Romantik',
  'Bilim Kurgu',
  'Slice of Life',
  'Spor',
  'Doğaüstü',
  'Gerilim',
  'Tarihi',
  'Psikolojik',
  'Okul Hayatı',
  'Shounen',
  'Shoujo',
  'Seinen',
  'Josei',
  'Isekai',
  'Dövüş Sanatları',
  'Müzik',
  'Reenkarnasyon',
];

// Helper function to generate pages for a chapter
export const generateChapterPages = (chapterId: string, pageCount: number): string[] => {
  return Array.from({ length: pageCount }, (_, i) =>
    `https://via.placeholder.com/800x1200?text=Page+${i + 1}`
  );
};

// Initialize database on import (no mock data)
export const initializeMockData = (): void => {
  // Only initialize database (admin users)
  initializeDatabase();
  console.log('Database initialized!');
};

// Re-export from database for legacy compatibility
export {
  getMangaById,
  searchMangas as searchManga,
  filterMangasByGenre as filterMangaByGenre
} from './database';

export const getChapterById = (mangaId: string, chapterId: string): Chapter | undefined => {
  const manga = getAllMangas().find(m => m.id === mangaId);
  return manga?.chapters.find((chapter: Chapter) => chapter.id === chapterId);
};
