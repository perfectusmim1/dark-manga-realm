import { Manga, Chapter } from './types';

const generatePages = (count: number): string[] => {
  return Array.from({ length: count }, (_, i) => 
    `https://picsum.photos/seed/${Math.random().toString(36).substring(7)}/800/1200`
  );
};

const generateChapters = (count: number): Chapter[] => {
  return Array.from({ length: count }, (_, i) => ({
    id: `chapter-${i + 1}`,
    number: i + 1,
    title: i === 0 ? 'Başlangıç' : `Bölüm ${i + 1}`,
    pages: generatePages(Math.floor(Math.random() * 20) + 15),
    releaseDate: new Date(Date.now() - i * 7 * 24 * 60 * 60 * 1000).toISOString(),
    views: Math.floor(Math.random() * 50000) + 5000,
  }));
};

export const mockMangaList: Manga[] = [
  {
    id: 'solo-leveling',
    title: 'Solo Leveling',
    cover: 'https://images.unsplash.com/photo-1578632767115-351597cf2477?w=400&h=600&fit=crop',
    author: 'Chugong',
    artist: 'Dubu',
    status: 'completed',
    genres: ['Aksiyon', 'Fantazi', 'Macera'],
    description: 'Dünyanın en zayıf avcısı Sung Jin-Woo, gizemli bir zindan içinde benzersiz bir güç kazanır ve seviye atlayabilen tek insan olur.',
    rating: 4.9,
    views: 2500000,
    chapters: generateChapters(179),
    lastUpdated: new Date().toISOString(),
    type: 'manhwa',
  },
  {
    id: 'one-punch-man',
    title: 'One Punch Man',
    cover: 'https://images.unsplash.com/photo-1601850494422-3cf14624b0b3?w=400&h=600&fit=crop',
    author: 'ONE',
    artist: 'Yusuke Murata',
    status: 'ongoing',
    genres: ['Aksiyon', 'Komedi', 'Süper Güç'],
    description: 'Saitama, tek yumrukla her düşmanı yenebilen sıradan bir kahramandır. Ancak bu güç onu sıkmaya başlamıştır.',
    rating: 4.8,
    views: 1800000,
    chapters: generateChapters(195),
    lastUpdated: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
    type: 'manga',
  },
  {
    id: 'tower-of-god',
    title: 'Tower of God',
    cover: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=400&h=600&fit=crop',
    author: 'SIU',
    status: 'ongoing',
    genres: ['Aksiyon', 'Fantazi', 'Gizem'],
    description: 'Bam, tüm isteklerini yerine getirebileceği söylenen Kule\'ye sevdiği kızı bulmak için girer.',
    rating: 4.7,
    views: 1500000,
    chapters: generateChapters(550),
    lastUpdated: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
    type: 'manhwa',
  },
  {
    id: 'demon-slayer',
    title: 'Demon Slayer',
    cover: 'https://images.unsplash.com/photo-1578632292335-df3abbb0d586?w=400&h=600&fit=crop',
    author: 'Koyoharu Gotouge',
    status: 'completed',
    genres: ['Aksiyon', 'Doğaüstü', 'Tarihi'],
    description: 'Ailesi iblisler tarafından katledilen Tanjiro, iblis olan kız kardeşini kurtarmak için bir iblis avcısı olur.',
    rating: 4.9,
    views: 3000000,
    chapters: generateChapters(205),
    lastUpdated: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
    type: 'manga',
  },
  {
    id: 'the-beginning-after-the-end',
    title: 'The Beginning After The End',
    cover: 'https://images.unsplash.com/photo-1551269901-5c5e14c25df7?w=400&h=600&fit=crop',
    author: 'TurtleMe',
    status: 'ongoing',
    genres: ['Fantazi', 'Macera', 'Reenkarnasyon'],
    description: 'Efsanevi bir kral, büyülü bir dünyada yeniden doğar ve geçmişteki hatalarını düzeltmeye çalışır.',
    rating: 4.8,
    views: 1200000,
    chapters: generateChapters(185),
    lastUpdated: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
    type: 'manhwa',
  },
  {
    id: 'chainsaw-man',
    title: 'Chainsaw Man',
    cover: 'https://images.unsplash.com/photo-1544413164-5f1b361f5bea?w=400&h=600&fit=crop',
    author: 'Tatsuki Fujimoto',
    status: 'ongoing',
    genres: ['Aksiyon', 'Karanlık Fantazi', 'Korku'],
    description: 'Denji, bir iblis köpeğiyle birleşerek Chainsaw Man olur ve iblis avcıları örgütüne katılır.',
    rating: 4.7,
    views: 2000000,
    chapters: generateChapters(145),
    lastUpdated: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
    type: 'manga',
  },
  {
    id: 'jujutsu-kaisen',
    title: 'Jujutsu Kaisen',
    cover: 'https://images.unsplash.com/photo-1569003339405-ea396a5a8a90?w=400&h=600&fit=crop',
    author: 'Gege Akutami',
    status: 'ongoing',
    genres: ['Aksiyon', 'Doğaüstü', 'Okul'],
    description: 'Yuji Itadori, lanetli bir parmağı yuttuktan sonra lanet dünyasına girer ve jujutsu büyücüsü olmaya karar verir.',
    rating: 4.8,
    views: 2200000,
    chapters: generateChapters(236),
    lastUpdated: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString(),
    type: 'manga',
  },
  {
    id: 'omniscient-reader',
    title: 'Omniscient Reader\'s Viewpoint',
    cover: 'https://images.unsplash.com/photo-1516979187457-637abb4f9353?w=400&h=600&fit=crop',
    author: 'Sing Shong',
    status: 'ongoing',
    genres: ['Aksiyon', 'Fantazi', 'İsekai'],
    description: 'Kim Dokja, okuduğu romanın gerçek olduğu bir dünyada uyanır ve hikayeyi değiştirmeye çalışır.',
    rating: 4.9,
    views: 1400000,
    chapters: generateChapters(165),
    lastUpdated: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
    type: 'manhwa',
  },
];

export const allGenres = [
  'Aksiyon', 'Macera', 'Komedi', 'Drama', 'Fantazi', 'Korku', 
  'Gizem', 'Romantik', 'Bilim Kurgu', 'Okul', 'Spor', 
  'Doğaüstü', 'Psikolojik', 'Tarihi', 'Slice of Life', 'İsekai',
  'Reenkarnasyon', 'Süper Güç', 'Karanlık Fantazi'
];

export const getMangaById = (id: string): Manga | undefined => {
  return mockMangaList.find(manga => manga.id === id);
};

export const getChapterById = (mangaId: string, chapterId: string): Chapter | undefined => {
  const manga = getMangaById(mangaId);
  return manga?.chapters.find(chapter => chapter.id === chapterId);
};

export const searchManga = (query: string): Manga[] => {
  const lowercaseQuery = query.toLowerCase();
  return mockMangaList.filter(manga => 
    manga.title.toLowerCase().includes(lowercaseQuery) ||
    manga.author.toLowerCase().includes(lowercaseQuery) ||
    manga.genres.some(genre => genre.toLowerCase().includes(lowercaseQuery))
  );
};

export const filterMangaByGenre = (genre: string): Manga[] => {
  return mockMangaList.filter(manga => 
    manga.genres.some(g => g.toLowerCase() === genre.toLowerCase())
  );
};
