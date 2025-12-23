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
  // Rating is now calculated from user votes
  ratings: MangaRating[];
  views: number;
  chapters: Chapter[];
  lastUpdated: string;
  createdAt: string;
  type: 'manga' | 'manhwa' | 'manhua';
  releaseYear?: number;
}

export interface MangaRating {
  userId: string;
  rating: number; // 1-10
  createdAt: string;
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
  password?: string; // Stored for authentication
  avatar?: string;
  role?: 'user' | 'admin' | 'moderator';
  createdAt?: string;
}

export interface ReadingProgress {
  userId: string; // User ID
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
  userId: string; // User ID
  mangaId: string;
  chapterId: string;
  chapterNumber: number;
  page: number;
  createdAt: string;
  note?: string;
}

export interface Favorite {
  userId: string; // User ID
  mangaId: string;
  addedAt: string;
  category?: LibraryCategory;
  mangaTitle?: string;
  mangaCover?: string;
}

export type ReadingMode = 'vertical' | 'horizontal' | 'webtoon';

export interface ReaderSettings {
  mode: ReadingMode;
  fitWidth: boolean;
  showProgress: boolean;
  backgroundColor: 'dark' | 'light' | 'sepia';
  preloadPages: number;
  zoom: number; // 10-300
}

// Library categories
export type LibraryCategory = 'reading' | 'plan_to_read' | 'completed' | 'on_hold' | 'dropped';

export interface LibraryItem extends Favorite {
  manga?: Manga;
  progress?: ReadingProgress;
}

// Follow system
export interface MangaFollow {
  userId: string;
  mangaId: string;
  followedAt: string;
}

// Notification types
export interface Notification {
  id: string;
  userId: string;
  type: 'new_chapter' | 'reply' | 'like' | 'system';
  title: string;
  message: string;
  link?: string;
  read: boolean;
  createdAt: string;
  // Additional context
  fromUserId?: string;
  fromUsername?: string;
  mangaId?: string;
  mangaTitle?: string;
  mangaCover?: string;
  chapterId?: string;
  chapterNumber?: number;
  commentId?: string;
}

export interface Comment {
  id: string;
  mangaId: string;
  chapterId?: string;
  userId: string;
  username: string;
  userAvatar?: string;
  content: string;
  gifUrl?: string;
  createdAt: string;
  updatedAt?: string;
  parentId?: string;
  likes: number;
  likedBy: string[];
}
