import { Manga, Chapter } from './types';
import { getAllMangas, saveManga } from './database';

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
    alternativeTitles: ['나 혼자만 레벨업', 'I Level Up Alone'],
    cover: 'https://images.unsplash.com/photo-1578632767115-351597cf2477?w=400&h=600&fit=crop',
    banner: 'https://images.unsplash.com/photo-1578632767115-351597cf2477?w=1200&h=400&fit=crop',
    author: 'Chugong',
    artist: 'Dubu',
    status: 'completed',
    genres: ['Aksiyon', 'Fantazi', 'Macera'],
    description: 'Dünyanın en zayıf avcısı Sung Jin-Woo, gizemli bir zindan içinde benzersiz bir güç kazanır ve seviye atlayabilen tek insan olur.',
    rating: 4.9,
    views: 2500000,
    chapters: generateChapters(179),
    lastUpdated: new Date().toISOString(),
    createdAt: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString(),
    type: 'manhwa',
    releaseYear: 2018,
  },
  {
    id: 'one-punch-man',
    title: 'One Punch Man',
    alternativeTitles: ['ワンパンマン', 'OPM'],
    cover: 'https://images.unsplash.com/photo-1601850494422-3cf14624b0b3?w=400&h=600&fit=crop',
    banner: 'https://images.unsplash.com/photo-1601850494422-3cf14624b0b3?w=1200&h=400&fit=crop',
    author: 'ONE',
    artist: 'Yusuke Murata',
    status: 'ongoing',
    genres: ['Aksiyon', 'Komedi', 'Süper Güç'],
    description: 'Saitama, tek yumrukla her düşmanı yenebilen sıradan bir kahramandır. Ancak bu güç onu sıkmaya başlamıştır.',
    rating: 4.8,
    views: 1800000,
    chapters: generateChapters(195),
    lastUpdated: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
    createdAt: new Date(Date.now() - 400 * 24 * 60 * 60 * 1000).toISOString(),
    type: 'manga',
    releaseYear: 2012,
  },
  {
    id: 'tower-of-god',
    title: 'Tower of God',
    alternativeTitles: ['신의 탑', 'Kami no Tou'],
    cover: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=400&h=600&fit=crop',
    banner: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=1200&h=400&fit=crop',
    author: 'SIU',
    status: 'ongoing',
    genres: ['Aksiyon', 'Fantazi', 'Gizem'],
    description: "Bam, tüm isteklerini yerine getirebileceği söylenen Kule'ye sevdiği kızı bulmak için girer.",
    rating: 4.7,
    views: 1500000,
    chapters: generateChapters(550),
    lastUpdated: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
    createdAt: new Date(Date.now() - 500 * 24 * 60 * 60 * 1000).toISOString(),
    type: 'manhwa',
    releaseYear: 2010,
  },
  {
    id: 'demon-slayer',
    title: 'Demon Slayer',
    alternativeTitles: ['鬼滅の刃', 'Kimetsu no Yaiba'],
    cover: 'https://images.unsplash.com/photo-1578632292335-df3abbb0d586?w=400&h=600&fit=crop',
    banner: 'https://images.unsplash.com/photo-1578632292335-df3abbb0d586?w=1200&h=400&fit=crop',
    author: 'Koyoharu Gotouge',
    status: 'completed',
    genres: ['Aksiyon', 'Doğaüstü', 'Tarihi'],
    description: 'Ailesi iblisler tarafından katledilen Tanjiro, iblis olan kız kardeşini kurtarmak için bir iblis avcısı olur.',
    rating: 4.9,
    views: 3000000,
    chapters: generateChapters(205),
    lastUpdated: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
    createdAt: new Date(Date.now() - 300 * 24 * 60 * 60 * 1000).toISOString(),
    type: 'manga',
    releaseYear: 2016,
  },
  {
    id: 'the-beginning-after-the-end',
    title: 'The Beginning After The End',
    alternativeTitles: ['TBATE', '끝이 아닌 시작'],
    cover: 'https://images.unsplash.com/photo-1551269901-5c5e14c25df7?w=400&h=600&fit=crop',
    banner: 'https://images.unsplash.com/photo-1551269901-5c5e14c25df7?w=1200&h=400&fit=crop',
    author: 'TurtleMe',
    status: 'ongoing',
    genres: ['Fantazi', 'Macera', 'Reenkarnasyon'],
    description: 'Efsanevi bir kral, büyülü bir dünyada yeniden doğar ve geçmişteki hatalarını düzeltmeye çalışır.',
    rating: 4.8,
    views: 1200000,
    chapters: generateChapters(185),
    lastUpdated: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
    createdAt: new Date(Date.now() - 200 * 24 * 60 * 60 * 1000).toISOString(),
    type: 'manhwa',
    releaseYear: 2018,
  },
  {
    id: 'chainsaw-man',
    title: 'Chainsaw Man',
    alternativeTitles: ['チェンソーマン'],
    cover: 'https://images.unsplash.com/photo-1544413164-5f1b361f5bea?w=400&h=600&fit=crop',
    banner: 'https://images.unsplash.com/photo-1544413164-5f1b361f5bea?w=1200&h=400&fit=crop',
    author: 'Tatsuki Fujimoto',
    status: 'ongoing',
    genres: ['Aksiyon', 'Karanlık Fantazi', 'Korku'],
    description: 'Denji, bir iblis köpeğiyle birleşerek Chainsaw Man olur ve iblis avcıları örgütüne katılır.',
    rating: 4.7,
    views: 2000000,
    chapters: generateChapters(145),
    lastUpdated: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
    createdAt: new Date(Date.now() - 250 * 24 * 60 * 60 * 1000).toISOString(),
    type: 'manga',
    releaseYear: 2018,
  },
  {
    id: 'jujutsu-kaisen',
    title: 'Jujutsu Kaisen',
    alternativeTitles: ['呪術廻戦', 'Sorcery Fight'],
    cover: 'https://images.unsplash.com/photo-1569003339405-ea396a5a8a90?w=400&h=600&fit=crop',
    banner: 'https://images.unsplash.com/photo-1569003339405-ea396a5a8a90?w=1200&h=400&fit=crop',
    author: 'Gege Akutami',
    status: 'completed',
    genres: ['Aksiyon', 'Doğaüstü', 'Okul'],
    description: 'Yuji Itadori, lanetli bir parmağı yuttuktan sonra lanet dünyasına girer ve jujutsu büyücüsü olmaya karar verir.',
    rating: 4.8,
    views: 2200000,
    chapters: generateChapters(271),
    lastUpdated: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString(),
    createdAt: new Date(Date.now() - 280 * 24 * 60 * 60 * 1000).toISOString(),
    type: 'manga',
    releaseYear: 2018,
  },
  {
    id: 'omniscient-reader',
    title: "Omniscient Reader's Viewpoint",
    alternativeTitles: ['전지적 독자 시점', 'ORV'],
    cover: 'https://images.unsplash.com/photo-1516979187457-637abb4f9353?w=400&h=600&fit=crop',
    banner: 'https://images.unsplash.com/photo-1516979187457-637abb4f9353?w=1200&h=400&fit=crop',
    author: 'Sing Shong',
    status: 'ongoing',
    genres: ['Aksiyon', 'Fantazi', 'İsekai'],
    description: 'Kim Dokja, okuduğu romanın gerçek olduğu bir dünyada uyanır ve hikayeyi değiştirmeye çalışır.',
    rating: 4.9,
    views: 1400000,
    chapters: generateChapters(165),
    lastUpdated: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
    createdAt: new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString(),
    type: 'manhwa',
    releaseYear: 2020,
  },
  {
    id: 'martial-peak',
    title: 'Martial Peak',
    alternativeTitles: ['武炼巅峰', 'Wǔ Liàn Diān Fēng'],
    cover: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=400&h=600&fit=crop',
    banner: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=1200&h=400&fit=crop',
    author: 'Momo',
    status: 'ongoing',
    genres: ['Aksiyon', 'Dövüş Sanatları', 'Fantazi'],
    description: 'Yang Kai, dünyanın en güçlü dövüş sanatçısı olmak için zorlu bir yolculuğa çıkar.',
    rating: 4.5,
    views: 900000,
    chapters: generateChapters(3000),
    lastUpdated: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
    createdAt: new Date(Date.now() - 600 * 24 * 60 * 60 * 1000).toISOString(),
    type: 'manhua',
    releaseYear: 2017,
  },
  {
    id: 'tales-of-demons-and-gods',
    title: 'Tales of Demons and Gods',
    alternativeTitles: ['妖神记', 'Yao Shen Ji'],
    cover: 'https://images.unsplash.com/photo-1534447677768-be436bb09401?w=400&h=600&fit=crop',
    banner: 'https://images.unsplash.com/photo-1534447677768-be436bb09401?w=1200&h=400&fit=crop',
    author: 'Mad Snail',
    status: 'ongoing',
    genres: ['Aksiyon', 'Fantazi', 'Reenkarnasyon'],
    description: 'Nie Li, güçlü bir İblis Spiritist olarak geçmişe geri döner ve geleceği değiştirmeye çalışır.',
    rating: 4.6,
    views: 1100000,
    chapters: generateChapters(400),
    lastUpdated: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
    createdAt: new Date(Date.now() - 450 * 24 * 60 * 60 * 1000).toISOString(),
    type: 'manhua',
    releaseYear: 2015,
  },
];

export const allGenres = [
  'Aksiyon', 'Macera', 'Komedi', 'Drama', 'Fantazi', 'Korku',
  'Gizem', 'Romantik', 'Bilim Kurgu', 'Okul', 'Spor',
  'Doğaüstü', 'Psikolojik', 'Tarihi', 'Slice of Life', 'İsekai',
  'Reenkarnasyon', 'Süper Güç', 'Karanlık Fantazi', 'Dövüş Sanatları',
  'Shounen', 'Seinen', 'Shoujo', 'Josei', 'Ecchi', 'Harem'
];

// Initialize mock data in database if empty
export const initializeMockData = (): void => {
  const existingMangas = getAllMangas();
  if (existingMangas.length === 0) {
    mockMangaList.forEach(manga => saveManga(manga));
    console.log('Mock data initialized!');
  }
};

// Legacy exports for compatibility - now use database functions
export {
  getMangaById,
  searchMangas as searchManga,
  filterMangasByGenre as filterMangaByGenre
} from './database';

export const getChapterById = (mangaId: string, chapterId: string): Chapter | undefined => {
  const manga = getAllMangas().find(m => m.id === mangaId);
  return manga?.chapters.find((chapter: Chapter) => chapter.id === chapterId);
};

