import { Manga } from './types';

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

// Initialize database on import (no mock data)
export const initializeMockData = (): void => {
  console.log('App initialized with Supabase backend');
};
