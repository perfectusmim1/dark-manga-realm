// Local Database using localStorage with proper structure
// This simulates a backend database for a manga reading site

import { Manga, Chapter, User } from './types';

// Database Keys
const DB_KEYS = {
  MANGAS: 'db_mangas',
  USERS: 'db_users',
  COMMENTS: 'db_comments',
  ADMIN_USERS: 'db_admin_users',
};

// Comment Interface
export interface Comment {
  id: string;
  mangaId: string;
  chapterId?: string; // If null, it's a manga-level comment
  userId: string;
  username: string;
  userAvatar?: string;
  content: string;
  gifUrl?: string;
  createdAt: string;
  updatedAt?: string;
  parentId?: string; // For replies
  likes: number;
  likedBy: string[];
}

// Admin User Interface
export interface AdminUser {
  id: string;
  username: string;
  email: string;
  password: string; // In real app, this would be hashed
  role: 'admin' | 'moderator';
  createdAt: string;
}

// Initialize database with default admin
export const initializeDatabase = () => {
  // Check if admin exists
  const admins = getAdminUsers();
  if (admins.length === 0) {
    const defaultAdmin: AdminUser = {
      id: 'admin-1',
      username: 'admin',
      email: 'admin@mangaverse.com',
      password: 'admin123', // Default password
      role: 'admin',
      createdAt: new Date().toISOString(),
    };
    localStorage.setItem(DB_KEYS.ADMIN_USERS, JSON.stringify([defaultAdmin]));
  }
};

// ==================== MANGA OPERATIONS ====================

export const getAllMangas = (): Manga[] => {
  const data = localStorage.getItem(DB_KEYS.MANGAS);
  return data ? JSON.parse(data) : [];
};

export const saveManga = (manga: Manga): void => {
  const mangas = getAllMangas();
  const existingIndex = mangas.findIndex(m => m.id === manga.id);
  
  if (existingIndex >= 0) {
    mangas[existingIndex] = manga;
  } else {
    mangas.push(manga);
  }
  
  localStorage.setItem(DB_KEYS.MANGAS, JSON.stringify(mangas));
};

export const deleteManga = (mangaId: string): void => {
  const mangas = getAllMangas().filter(m => m.id !== mangaId);
  localStorage.setItem(DB_KEYS.MANGAS, JSON.stringify(mangas));
  
  // Also delete related comments
  const comments = getAllComments().filter(c => c.mangaId !== mangaId);
  localStorage.setItem(DB_KEYS.COMMENTS, JSON.stringify(comments));
};

export const getMangaById = (mangaId: string): Manga | undefined => {
  return getAllMangas().find(m => m.id === mangaId);
};

export const addChapterToManga = (mangaId: string, chapter: Chapter): boolean => {
  const manga = getMangaById(mangaId);
  if (!manga) return false;
  
  manga.chapters.push(chapter);
  manga.lastUpdated = new Date().toISOString();
  saveManga(manga);
  return true;
};

export const updateChapter = (mangaId: string, chapter: Chapter): boolean => {
  const manga = getMangaById(mangaId);
  if (!manga) return false;
  
  const chapterIndex = manga.chapters.findIndex(c => c.id === chapter.id);
  if (chapterIndex < 0) return false;
  
  manga.chapters[chapterIndex] = chapter;
  saveManga(manga);
  return true;
};

export const deleteChapter = (mangaId: string, chapterId: string): boolean => {
  const manga = getMangaById(mangaId);
  if (!manga) return false;
  
  manga.chapters = manga.chapters.filter(c => c.id !== chapterId);
  saveManga(manga);
  return true;
};

// ==================== COMMENT OPERATIONS ====================

export const getAllComments = (): Comment[] => {
  const data = localStorage.getItem(DB_KEYS.COMMENTS);
  return data ? JSON.parse(data) : [];
};

export const getCommentsForManga = (mangaId: string, chapterId?: string): Comment[] => {
  return getAllComments()
    .filter(c => c.mangaId === mangaId && c.chapterId === chapterId)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
};

export const addComment = (comment: Omit<Comment, 'id' | 'createdAt' | 'likes' | 'likedBy'>): Comment => {
  const comments = getAllComments();
  const newComment: Comment = {
    ...comment,
    id: `comment-${Date.now()}-${Math.random().toString(36).substring(7)}`,
    createdAt: new Date().toISOString(),
    likes: 0,
    likedBy: [],
  };
  
  comments.push(newComment);
  localStorage.setItem(DB_KEYS.COMMENTS, JSON.stringify(comments));
  return newComment;
};

export const updateComment = (commentId: string, content: string, gifUrl?: string): boolean => {
  const comments = getAllComments();
  const index = comments.findIndex(c => c.id === commentId);
  
  if (index < 0) return false;
  
  comments[index].content = content;
  comments[index].gifUrl = gifUrl;
  comments[index].updatedAt = new Date().toISOString();
  
  localStorage.setItem(DB_KEYS.COMMENTS, JSON.stringify(comments));
  return true;
};

export const deleteComment = (commentId: string): boolean => {
  const comments = getAllComments();
  const filtered = comments.filter(c => c.id !== commentId && c.parentId !== commentId);
  
  if (filtered.length === comments.length) return false;
  
  localStorage.setItem(DB_KEYS.COMMENTS, JSON.stringify(filtered));
  return true;
};

export const toggleCommentLike = (commentId: string, userId: string): boolean => {
  const comments = getAllComments();
  const index = comments.findIndex(c => c.id === commentId);
  
  if (index < 0) return false;
  
  const comment = comments[index];
  const likeIndex = comment.likedBy.indexOf(userId);
  
  if (likeIndex >= 0) {
    comment.likedBy.splice(likeIndex, 1);
    comment.likes--;
  } else {
    comment.likedBy.push(userId);
    comment.likes++;
  }
  
  localStorage.setItem(DB_KEYS.COMMENTS, JSON.stringify(comments));
  return true;
};

// ==================== ADMIN OPERATIONS ====================

export const getAdminUsers = (): AdminUser[] => {
  const data = localStorage.getItem(DB_KEYS.ADMIN_USERS);
  return data ? JSON.parse(data) : [];
};

export const authenticateAdmin = (email: string, password: string): AdminUser | null => {
  const admins = getAdminUsers();
  return admins.find(a => a.email === email && a.password === password) || null;
};

export const addAdminUser = (admin: Omit<AdminUser, 'id' | 'createdAt'>): AdminUser => {
  const admins = getAdminUsers();
  const newAdmin: AdminUser = {
    ...admin,
    id: `admin-${Date.now()}`,
    createdAt: new Date().toISOString(),
  };
  
  admins.push(newAdmin);
  localStorage.setItem(DB_KEYS.ADMIN_USERS, JSON.stringify(admins));
  return newAdmin;
};

export const deleteAdminUser = (adminId: string): boolean => {
  const admins = getAdminUsers();
  // Don't allow deleting the last admin
  if (admins.length <= 1) return false;
  
  const filtered = admins.filter(a => a.id !== adminId);
  localStorage.setItem(DB_KEYS.ADMIN_USERS, JSON.stringify(filtered));
  return true;
};

// ==================== SEARCH OPERATIONS ====================

export const searchMangas = (query: string): Manga[] => {
  const lowercaseQuery = query.toLowerCase();
  return getAllMangas().filter(manga =>
    manga.title.toLowerCase().includes(lowercaseQuery) ||
    manga.author.toLowerCase().includes(lowercaseQuery) ||
    manga.genres.some(genre => genre.toLowerCase().includes(lowercaseQuery))
  );
};

export const filterMangasByType = (type: 'manga' | 'manhwa' | 'manhua'): Manga[] => {
  return getAllMangas().filter(m => m.type === type);
};

export const filterMangasByGenre = (genre: string): Manga[] => {
  return getAllMangas().filter(m =>
    m.genres.some(g => g.toLowerCase() === genre.toLowerCase())
  );
};

export const filterMangasByStatus = (status: 'ongoing' | 'completed' | 'hiatus'): Manga[] => {
  return getAllMangas().filter(m => m.status === status);
};

// ==================== STATISTICS ====================

export const getStatistics = () => {
  const mangas = getAllMangas();
  const comments = getAllComments();
  
  return {
    totalMangas: mangas.length,
    totalChapters: mangas.reduce((acc, m) => acc + m.chapters.length, 0),
    totalViews: mangas.reduce((acc, m) => acc + m.views, 0),
    totalComments: comments.length,
    mangasByType: {
      manga: mangas.filter(m => m.type === 'manga').length,
      manhwa: mangas.filter(m => m.type === 'manhwa').length,
      manhua: mangas.filter(m => m.type === 'manhua').length,
    },
    mangasByStatus: {
      ongoing: mangas.filter(m => m.status === 'ongoing').length,
      completed: mangas.filter(m => m.status === 'completed').length,
      hiatus: mangas.filter(m => m.status === 'hiatus').length,
    },
  };
};

// Initialize database on import
initializeDatabase();
