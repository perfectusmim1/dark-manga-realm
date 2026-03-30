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
  chapterCount?: number;
  lastUpdated: string;
  createdAt: string;
  type: 'manga' | 'manhwa' | 'manhua' | 'webtoon';
  releaseYear?: number;
  characters?: Character[];
  authorDetails?: Author;
  artistDetails?: Artist;
  authorsDetails?: Author[];
  artistsDetails?: Artist[];
  details?: EntityMetadata;
  sourceLinks?: ExternalSourceLink[];
  relatedSeries?: MangaRelation[];
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

export type ExternalSourceName = 'anilist' | 'myanimelist' | 'mangaupdates';

export interface ExternalSourceLink {
  source: ExternalSourceName | string;
  url: string;
  label?: string;
  kind?: string;
}

export interface EntityGalleryImage {
  url: string;
  thumbUrl?: string;
  source?: ExternalSourceName | string;
  sourceUrl?: string;
  label?: string;
}

export interface EntityMetadata {
  nativeName?: string;
  englishName?: string;
  romajiName?: string;
  status?: string;
  age?: string;
  gender?: string;
  birthday?: string;
  birthDate?: string;
  birthPlace?: string;
  bloodType?: string;
  zodiac?: string;
  nationality?: string;
  occupation?: string;
  role?: string;
  className?: string;
  rankTitle?: string;
  affiliation?: string[];
  relatives?: string[];
  website?: string;
  twitter?: string;
  favorites?: number;
  popularity?: number;
  averageScore?: number;
  meanScore?: number;
  chapters?: number;
  volumes?: number;
  startDate?: string;
  endDate?: string;
  sourceMaterial?: string;
  countryOfOrigin?: string;
  originalPublisher?: string;
  officialTranslations?: string[];
  originalWebtoon?: string[];
  genres?: string[];
  tags?: string[];
  comments?: string;
  extra?: Record<string, string | number | boolean | string[] | null>;
}

export interface BaseRichEntity {
  id: string;
  name: string;
  imageUrl?: string;
  description?: string;
  likesCount: number;
  createdAt: string;
  series?: Manga[];
  rank?: number;
  isPublic?: boolean;
  alternativeNames?: string[];
  details?: EntityMetadata;
  gallery?: EntityGalleryImage[];
  sourceLinks?: ExternalSourceLink[];
}

export interface Character {
  id: BaseRichEntity['id'];
  name: BaseRichEntity['name'];
  imageUrl?: BaseRichEntity['imageUrl'];
  description?: BaseRichEntity['description'];
  likesCount: BaseRichEntity['likesCount'];
  createdAt: BaseRichEntity['createdAt'];
  series?: BaseRichEntity['series'];
  rank?: BaseRichEntity['rank'];
  isPublic?: BaseRichEntity['isPublic'];
  alternativeNames?: BaseRichEntity['alternativeNames'];
  details?: BaseRichEntity['details'];
  gallery?: BaseRichEntity['gallery'];
  sourceLinks?: BaseRichEntity['sourceLinks'];
  voiceActors?: CharacterVoiceActorRole[];
}

export interface Author {
  id: BaseRichEntity['id'];
  name: BaseRichEntity['name'];
  imageUrl?: BaseRichEntity['imageUrl'];
  description?: BaseRichEntity['description'];
  likesCount: BaseRichEntity['likesCount'];
  createdAt: BaseRichEntity['createdAt'];
  series?: BaseRichEntity['series'];
  rank?: BaseRichEntity['rank'];
  isPublic?: BaseRichEntity['isPublic'];
  alternativeNames?: BaseRichEntity['alternativeNames'];
  details?: BaseRichEntity['details'];
  gallery?: BaseRichEntity['gallery'];
  sourceLinks?: BaseRichEntity['sourceLinks'];
}

export interface Artist {
  id: BaseRichEntity['id'];
  name: BaseRichEntity['name'];
  imageUrl?: BaseRichEntity['imageUrl'];
  description?: BaseRichEntity['description'];
  likesCount: BaseRichEntity['likesCount'];
  createdAt: BaseRichEntity['createdAt'];
  series?: BaseRichEntity['series'];
  rank?: BaseRichEntity['rank'];
  isPublic?: BaseRichEntity['isPublic'];
  alternativeNames?: BaseRichEntity['alternativeNames'];
  details?: BaseRichEntity['details'];
  gallery?: BaseRichEntity['gallery'];
  sourceLinks?: BaseRichEntity['sourceLinks'];
}

export interface VoiceActor {
  id: BaseRichEntity['id'];
  name: BaseRichEntity['name'];
  imageUrl?: BaseRichEntity['imageUrl'];
  description?: BaseRichEntity['description'];
  likesCount: BaseRichEntity['likesCount'];
  createdAt: BaseRichEntity['createdAt'];
  series?: BaseRichEntity['series'];
  rank?: BaseRichEntity['rank'];
  isPublic?: BaseRichEntity['isPublic'];
  alternativeNames?: BaseRichEntity['alternativeNames'];
  details?: BaseRichEntity['details'];
  gallery?: BaseRichEntity['gallery'];
  sourceLinks?: BaseRichEntity['sourceLinks'];
  roles?: VoiceActorRole[];
}

export interface CharacterVoiceActorRole {
  id: string;
  characterId: string;
  voiceActorId: string;
  language?: string;
  localeCode?: string;
  roleLabel?: string;
  sortOrder?: number;
  sourceName?: string;
  sourceUrl?: string;
  details?: Record<string, unknown>;
  voiceActor?: VoiceActor;
}

export interface VoiceActorRole {
  id: string;
  characterId: string;
  voiceActorId: string;
  characterName: string;
  characterImageUrl?: string;
  language?: string;
  localeCode?: string;
  roleLabel?: string;
  sortOrder?: number;
  sourceName?: string;
  sourceUrl?: string;
  details?: Record<string, unknown>;
}

export interface MangaRelation {
  id: string;
  mangaId: string;
  relatedMangaId: string;
  relationType: string;
  sourceName?: string;
  sourceUrl?: string;
  sortOrder?: number;
  relatedManga?: Manga;
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
  usernameChangedAt?: string;
  email: string;
  avatar?: string;
  role?: 'user' | 'admin' | 'moderator';
  createdAt?: string;
  lastSeenAt?: string;
  isBanned?: boolean;
  banReason?: string;
  bannedAt?: string;
  activeBanType?: UserBanKind | null;
  banExpiresAt?: string | null;
  warningCount?: number;
  unreadWarningCount?: number;
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
    appearance?: {
      manga_hover_preview?: boolean;
      show_header_search_bar?: boolean;
      show_header_offline_toggle?: boolean;
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
  mangaTitle?: string;
  mangaCover?: string;
  mangaAlternativeTitles?: string[];
  chapterTitle?: string;
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
  entityType?: 'manga' | 'character' | 'author' | 'artist' | 'voice_actor';
  chapterId?: string;
  pageNumber?: number;
  userId: string;
  username: string;
  usernameChangedAt?: string;
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

export type SupportTicketCategory = 'bug_report' | 'account' | 'content_issue' | 'ban_appeal' | 'other';

export type SupportTicketStatus = 'open' | 'waiting_staff' | 'waiting_user' | 'closed';

export type UserBanKind = 'timed' | 'permanent' | 'hard';

export type ScrapeSource = 'hayalistic' | 'webtoonhatti';

export interface SupportTicketMessage {
  id: string;
  ticketId: string;
  authorId: string | null;
  authorName: string;
  authorRole: 'user' | 'moderator' | 'admin' | 'system';
  content: string;
  imageUrl?: string | null;
  createdAt: string;
}

export interface SupportTicket {
  id: string;
  userId: string | null;
  userName: string;
  userEmail: string;
  contactName?: string | null;
  contactEmail?: string | null;
  appealAccountEmail?: string | null;
  isGuestTicket?: boolean;
  subject: string;
  category: SupportTicketCategory;
  status: SupportTicketStatus;
  imageUrl?: string | null;
  createdAt: string;
  updatedAt: string;
  lastMessageAt: string;
  messages: SupportTicketMessage[];
}

export interface UserWarning {
  id: string;
  title: string;
  message: string;
  createdAt: string;
  acknowledgedAt?: string | null;
  issuedBy?: string | null;
  issuedByName?: string | null;
}

export interface UserBanRecord {
  id: string;
  kind: UserBanKind;
  reason: string;
  createdAt: string;
  expiresAt?: string | null;
  revokedAt?: string | null;
  issuedBy?: string | null;
  issuedByName?: string | null;
  revokedBy?: string | null;
  revokedByName?: string | null;
  warningId?: string | null;
  metadata?: Record<string, unknown>;
}

export interface CurrentUserWarning {
  id: string;
  title: string;
  message: string;
  createdAt: string;
}

export interface CurrentUserBanState {
  active: boolean;
  type?: UserBanKind | null;
  reason?: string | null;
  expiresAt?: string | null;
  bannedAt?: string | null;
}

export type AccessDecisionReason =
  | 'ok'
  | 'ip_banned'
  | 'device_banned'
  | 'user_banned'
  | 'support_only'
  | 'access_check_failed';

export interface UserAccessState {
  reason?: AccessDecisionReason;
  blockedMessage?: string | null;
  supportOnly: boolean;
  warning: CurrentUserWarning | null;
  ban: CurrentUserBanState;
}

export interface SiteBackupManifest {
  version: number;
  exportedAt: string;
  exportedBy: {
    id: string;
    email: string;
  };
  authManifest: {
    totalUsers: number;
    users: Array<{
      id: string;
      email?: string | null;
      role?: string | null;
      createdAt?: string | null;
      lastSignInAt?: string | null;
      emailConfirmedAt?: string | null;
    }>;
  };
  tables: Record<string, unknown[]>;
}
