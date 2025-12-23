export interface Manga {
  id: string;
  title: string;
  alternativeTitles?: string[];
  cover: string;
  banner?: string;
  author: string;
  artist?: string;
  status: 'ongoing' | 'completed' | 'hiatus';
  genres: string[];
  description: string;
  rating: number;
  views: number;
  chapters: Chapter[];
  lastUpdated: string;
  createdAt: string;
  type: 'manga' | 'manhwa' | 'manhua';
  releaseYear?: number;
}

export interface Chapter {
  id: string;
  number: number;
  title: string;
  pages: string[];
  releaseDate: string;
  views: number;
}

export interface User {
  id: string;
  username: string;
  email: string;
  avatar?: string;
  role?: 'user' | 'admin' | 'moderator';
  createdAt?: string;
}

export interface ReadingProgress {
  mangaId: string;
  chapterId: string;
  chapterNumber: number;
  page: number;
  lastRead: string;
  mangaTitle?: string;
  mangaCover?: string;
}

export interface Bookmark {
  id: string;
  mangaId: string;
  chapterId: string;
  page: number;
  createdAt: string;
  note?: string;
}

export interface Favorite {
  mangaId: string;
  addedAt: string;
  category?: 'reading' | 'plan_to_read' | 'completed' | 'on_hold' | 'dropped';
}

export type ReadingMode = 'vertical' | 'horizontal' | 'webtoon';

export interface ReaderSettings {
  mode: ReadingMode;
  fitWidth: boolean;
  showProgress: boolean;
  backgroundColor: 'dark' | 'light' | 'sepia';
  preloadPages: number;
}

// Library categories
export type LibraryCategory = 'reading' | 'plan_to_read' | 'completed' | 'on_hold' | 'dropped';

export interface LibraryItem extends Favorite {
  manga?: Manga;
  progress?: ReadingProgress;
}

// Notification types
export interface Notification {
  id: string;
  type: 'new_chapter' | 'reply' | 'like' | 'system';
  title: string;
  message: string;
  link?: string;
  read: boolean;
  createdAt: string;
}
