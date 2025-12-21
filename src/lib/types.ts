export interface Manga {
  id: string;
  title: string;
  cover: string;
  author: string;
  artist?: string;
  status: 'ongoing' | 'completed' | 'hiatus';
  genres: string[];
  description: string;
  rating: number;
  views: number;
  chapters: Chapter[];
  lastUpdated: string;
  type: 'manga' | 'manhwa' | 'manhua';
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
}

export interface ReadingProgress {
  mangaId: string;
  chapterId: string;
  page: number;
  lastRead: string;
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
}

export type ReadingMode = 'vertical' | 'horizontal';

export interface ReaderSettings {
  mode: ReadingMode;
  fitWidth: boolean;
  showProgress: boolean;
}
