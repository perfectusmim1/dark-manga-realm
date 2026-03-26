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
  engagementScore?: number;
  chapters: Chapter[];
  lastUpdated: string;
  createdAt: string;
  type: 'manga' | 'manhwa' | 'manhua' | 'webtoon';
  releaseYear?: number;
  characters?: Character[];
  authorDetails?: Author;
  artistDetails?: Artist;
  averageRating: number;
  reviewCount: number;
  ratingBreakdown?: {
    story: number;
    characters: number;
    art: number;
    progression: number;
    engagement: number;
  };
}

export interface Character {
  id: string;
  name: string;
  imageUrl?: string;
  description?: string;
  likesCount: number;
  createdAt: string;
  series?: Manga[];
  rank?: number;
}

export interface Author {
  id: string;
  name: string;
  imageUrl?: string;
  description?: string;
  likesCount: number;
  createdAt: string;
  series?: Manga[];
}

export interface Artist {
  id: string;
  name: string;
  imageUrl?: string;
  description?: string;
  likesCount: number;
  createdAt: string;
  series?: Manga[];
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
  avatar?: string;
  role?: 'user' | 'admin' | 'moderator';
  createdAt?: string;
  lastSeenAt?: string;
  isBanned?: boolean;
  banReason?: string;
  bannedAt?: string;
  preferences?: {
    notifications: {
      new_chapter: boolean;
      replies: boolean;
      likes: boolean;
      follows?: boolean;
    };
    comments?: {
      auto_show_media: boolean;
      auto_show_gifs: boolean;
      auto_show_replies: boolean;
      show_page_comments: boolean;
    };
    privacy?: {
      visibility: 'public' | 'members' | 'mutuals' | 'private';
      reading_history_visibility?: 'public' | 'members' | 'mutuals' | 'private';
      comments_visibility?: 'public' | 'members' | 'mutuals' | 'private';
      reading_lists_visibility?: 'public' | 'members' | 'mutuals' | 'private';
      tier_lists_visibility?: 'public' | 'members' | 'mutuals' | 'private';
      followed_manga_visibility?: 'public' | 'members' | 'mutuals' | 'private';
    };
  };
  twoFactorEnabled?: boolean;
}

export interface ReadingProgress {
  userId: string;
  mangaId: string;
  chapterId: string;
  chapterNumber: number;
  page: number;
  lastRead: string;
  mangaTitle?: string;
  mangaCover?: string;
}

export interface Favorite {
  userId: string; // User ID
  mangaId: string;
  addedAt: string;
  category?: LibraryCategory;
  mangaTitle?: string;
  mangaCover?: string;
}

export interface Bookmark {
  id?: string;
  userId: string;
  mangaId: string;
  chapterId: string;
  chapterNumber: number;
  page: number;
  note?: string | null;
  createdAt?: string;
}

export type ReadingMode = 'vertical' | 'horizontal' | 'webtoon';

export interface ReaderSettings {
  mode: ReadingMode;
  fitWidth: boolean;
  showProgress: boolean;
  showPageComments: boolean;
  backgroundColor: 'dark' | 'light' | 'sepia';
  preloadPages: number;
  prefetchNextChapter: boolean;
  zoom: number; // 10-300
  autoScrollSpeed: number; // pixels per second
}

export interface ResolvedReaderPage {
  src: string;
  source: 'remote' | 'offline';
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
  type: 'new_chapter' | 'reply' | 'like' | 'follow' | 'system';
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
  mangaId?: string;
  entityId?: string;
  entityType?: 'manga' | 'character' | 'author' | 'artist';
  chapterId?: string;
  pageNumber?: number;
  userId: string;
  username: string;
  userAvatar?: string;
  userRole?: User['role'];
  content: string;
  title?: string;
  textColor?: string;
  mediaUrl?: string;
  mediaUrls?: string[];
  isSpoiler?: boolean;
  gifUrl?: string;
  createdAt: string;
  updatedAt?: string;
  parentId?: string;
  likes: number;
  likedBy: string[];
  isPinned?: boolean;
}

export interface ReadingList {
  id: string;
  userId: string;
  name: string;
  description?: string;
  imageUrl?: string;
  isPublic: boolean;
  createdAt: string;
  items?: Manga[];
}

export interface ReadingListItem {
  id: string;
  listId: string;
  mangaId: string;
  createdAt: string;
}
export interface Review {
  id: string;
  mangaId: string;
  userId: string;
  username: string;
  userAvatar?: string;
  userRole?: User['role'];
  content: string;
  rating_story: number;
  rating_characters: number;
  rating_art: number;
  rating_progression: number;
  rating_engagement: number;
  createdAt: string;
  updatedAt: string;
  likes: number;
  likedBy: string[];
}

export interface MangaReaction {
  id: string;
  mangaId: string;
  chapterId?: string;
  userId: string;
  reactionType: string;
  createdAt: string;
}

export type TagCategory = 'theme' | 'mood' | 'trope' | 'demographic' | 'content' | 'general';

export interface Tag {
  id: string;
  name: string;
  slug: string;
  category: TagCategory;
  description?: string;
  usageCount: number;
  isOfficial: boolean;
  communityApproved?: boolean;
  isDiscoverable?: boolean;
  createdBy?: string;
  createdAt: string;
}

export interface MangaTag {
  mangaId: string;
  tagId: string;
  tag?: Tag;
  addedBy?: string;
  createdAt: string;
}

export interface TagVote {
  id: string;
  tagId: string;
  entityType: 'manga' | 'character' | 'author' | 'artist';
  entityId: string;
  userId: string;
  voteType: 'up' | 'down';
  createdAt: string;
}
