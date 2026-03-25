import { createClient } from '@supabase/supabase-js';

export const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
export const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Supabase URL veya Anon Key tanımlanmamış! .env dosyasını kontrol edin.');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Database types (will be expanded as we create tables)
export type Database = {
    public: {
        Tables: {
            mangas: {
                Row: {
                    id: string;
                    title: string;
                    author: string;
                    artist: string | null;
                    description: string;
                    cover: string;
                    banner: string | null;
                    genres: string[];
                    status: 'ongoing' | 'completed' | 'hiatus';
                    type: 'manga' | 'manhwa' | 'manhua' | 'webtoon';
                    views: number;
                    created_at: string;
                    last_updated: string;
                };
                Insert: Omit<Database['public']['Tables']['mangas']['Row'], 'id' | 'created_at' | 'views'> & {
                    id?: string;
                    created_at?: string;
                    views?: number;
                };
                Update: Partial<Database['public']['Tables']['mangas']['Insert']>;
            };
            chapters: {
                Row: {
                    id: string;
                    manga_id: string;
                    number: number;
                    title: string;
                    pages: string[];
                    views: number;
                    release_date: string;
                    created_at: string;
                };
                Insert: Omit<Database['public']['Tables']['chapters']['Row'], 'id' | 'created_at' | 'views'> & {
                    id?: string;
                    created_at?: string;
                    views?: number;
                };
                Update: Partial<Database['public']['Tables']['chapters']['Insert']>;
            };
            users: {
                Row: {
                    id: string;
                    username: string;
                    email: string;
                    password_hash: string;
                    avatar: string | null;
                    role: 'user' | 'admin' | 'moderator';
                    is_banned: boolean;
                    ban_reason: string | null;
                    banned_at: string | null;
                    banned_by: string | null;
                    created_at: string;
                };
                Insert: Omit<Database['public']['Tables']['users']['Row'], 'id' | 'created_at'> & {
                    id?: string;
                    created_at?: string;
                };
                Update: Partial<Database['public']['Tables']['users']['Insert']>;
            };
            comments: {
                Row: {
                    id: string;
                    manga_id: string;
                    chapter_id: string | null;
                    page_number: number | null;
                    user_id: string;
                    content: string;
                    gif_url: string | null;
                    parent_id: string | null;
                    likes: number;
                    created_at: string;
                    updated_at: string | null;
                };
                Insert: Omit<Database['public']['Tables']['comments']['Row'], 'id' | 'created_at' | 'likes'> & {
                    id?: string;
                    created_at?: string;
                    likes?: number;
                };
                Update: Partial<Database['public']['Tables']['comments']['Insert']>;
            };
            ratings: {
                Row: {
                    id: string;
                    manga_id: string;
                    user_id: string;
                    rating: number;
                    created_at: string;
                };
                Insert: Omit<Database['public']['Tables']['ratings']['Row'], 'id' | 'created_at'> & {
                    id?: string;
                    created_at?: string;
                };
                Update: Partial<Database['public']['Tables']['ratings']['Insert']>;
            };
            favorites: {
                Row: {
                    id: string;
                    user_id: string;
                    manga_id: string;
                    category: 'reading' | 'completed' | 'plan_to_read' | 'on_hold' | 'dropped';
                    added_at: string;
                };
                Insert: Omit<Database['public']['Tables']['favorites']['Row'], 'id' | 'added_at'> & {
                    id?: string;
                    added_at?: string;
                };
                Update: Partial<Database['public']['Tables']['favorites']['Insert']>;
            };
            reading_progress: {
                Row: {
                    id: string;
                    user_id: string;
                    manga_id: string;
                    chapter_id: string;
                    page: number;
                    last_read: string;
                };
                Insert: Omit<Database['public']['Tables']['reading_progress']['Row'], 'id'> & {
                    id?: string;
                };
                Update: Partial<Database['public']['Tables']['reading_progress']['Insert']>;
            };
            bookmarks: {
                Row: {
                    id: string;
                    user_id: string;
                    manga_id: string;
                    chapter_id: string;
                    page: number;
                    note: string | null;
                    created_at: string;
                };
                Insert: Omit<Database['public']['Tables']['bookmarks']['Row'], 'id' | 'created_at'> & {
                    id?: string;
                    created_at?: string;
                };
                Update: Partial<Database['public']['Tables']['bookmarks']['Insert']>;
            };
            comment_likes: {
                Row: {
                    id: string;
                    comment_id: string;
                    user_id: string;
                    created_at: string;
                };
                Insert: Omit<Database['public']['Tables']['comment_likes']['Row'], 'id' | 'created_at'> & {
                    id?: string;
                    created_at?: string;
                };
                Update: Partial<Database['public']['Tables']['comment_likes']['Insert']>;
            };
            follows: {
                Row: {
                    id: string;
                    user_id: string;
                    manga_id: string;
                    followed_at: string;
                };
                Insert: Omit<Database['public']['Tables']['follows']['Row'], 'id' | 'followed_at'> & {
                    id?: string;
                    followed_at?: string;
                };
                Update: Partial<Database['public']['Tables']['follows']['Insert']>;
            };
            notifications: {
                Row: {
                    id: string;
                    user_id: string;
                    type: string;
                    title: string;
                    message: string;
                    link: string | null;
                    read: boolean;
                    created_at: string;
                    manga_id: string | null;
                    chapter_id: string | null;
                };
                Insert: Omit<Database['public']['Tables']['notifications']['Row'], 'id' | 'created_at' | 'read'> & {
                    id?: string;
                    created_at?: string;
                    read?: boolean;
                };
                Update: Partial<Database['public']['Tables']['notifications']['Insert']>;
            };
            characters: {
                Row: {
                    id: string;
                    name: string;
                    image_url: string | null;
                    description: string | null;
                    likes_count: number;
                    created_at: string;
                };
                Insert: Omit<Database['public']['Tables']['characters']['Row'], 'id' | 'created_at' | 'likes_count'> & {
                    id?: string;
                    created_at?: string;
                    likes_count?: number;
                };
                Update: Partial<Database['public']['Tables']['characters']['Insert']>;
            };
            authors: {
                Row: {
                    id: string;
                    name: string;
                    image_url: string | null;
                    description: string | null;
                    likes_count: number;
                    created_at: string;
                };
                Insert: Omit<Database['public']['Tables']['authors']['Row'], 'id' | 'created_at' | 'likes_count'> & {
                    id?: string;
                    created_at?: string;
                    likes_count?: number;
                };
                Update: Partial<Database['public']['Tables']['authors']['Insert']>;
            };
            artists: {
                Row: {
                    id: string;
                    name: string;
                    image_url: string | null;
                    description: string | null;
                    likes_count: number;
                    created_at: string;
                };
                Insert: Omit<Database['public']['Tables']['artists']['Row'], 'id' | 'created_at' | 'likes_count'> & {
                    id?: string;
                    created_at?: string;
                    likes_count?: number;
                };
                Update: Partial<Database['public']['Tables']['artists']['Insert']>;
            };
            manga_characters: {
                Row: {
                    manga_id: string;
                    character_id: string;
                };
                Insert: Database['public']['Tables']['manga_characters']['Row'];
                Update: Partial<Database['public']['Tables']['manga_characters']['Insert']>;
            };
            manga_authors: {
                Row: {
                    manga_id: string;
                    author_id: string;
                };
                Insert: Database['public']['Tables']['manga_authors']['Row'];
                Update: Partial<Database['public']['Tables']['manga_authors']['Insert']>;
            };
            manga_artists: {
                Row: {
                    manga_id: string;
                    artist_id: string;
                };
                Insert: Database['public']['Tables']['manga_artists']['Row'];
                Update: Partial<Database['public']['Tables']['manga_artists']['Insert']>;
            };
            character_likes: {
                Row: {
                    user_id: string;
                    character_id: string;
                };
                Insert: Database['public']['Tables']['character_likes']['Row'];
                Update: Partial<Database['public']['Tables']['character_likes']['Insert']>;
            };
            author_likes: {
                Row: {
                    user_id: string;
                    author_id: string;
                };
                Insert: Database['public']['Tables']['author_likes']['Row'];
                Update: Partial<Database['public']['Tables']['author_likes']['Insert']>;
            };
            artist_likes: {
                Row: {
                    user_id: string;
                    artist_id: string;
                };
                Insert: Database['public']['Tables']['artist_likes']['Row'];
                Update: Partial<Database['public']['Tables']['artist_likes']['Insert']>;
            };
            character_comments: {
                Row: {
                    id: string;
                    character_id: string;
                    user_id: string;
                    content: string;
                    likes: number;
                    created_at: string;
                };
                Insert: Omit<Database['public']['Tables']['character_comments']['Row'], 'id' | 'created_at' | 'likes'> & {
                    id?: string;
                    created_at?: string;
                    likes?: number;
                };
                Update: Partial<Database['public']['Tables']['character_comments']['Insert']>;
            };
            author_comments: {
                Row: {
                    id: string;
                    author_id: string;
                    user_id: string;
                    content: string;
                    likes: number;
                    created_at: string;
                };
                Insert: Omit<Database['public']['Tables']['author_comments']['Row'], 'id' | 'created_at' | 'likes'> & {
                    id?: string;
                    created_at?: string;
                    likes?: number;
                };
                Update: Partial<Database['public']['Tables']['author_comments']['Insert']>;
            };
            artist_comments: {
                Row: {
                    id: string;
                    artist_id: string;
                    user_id: string;
                    content: string;
                    likes: number;
                    created_at: string;
                };
                Insert: Omit<Database['public']['Tables']['artist_comments']['Row'], 'id' | 'created_at' | 'likes'> & {
                    id?: string;
                    created_at?: string;
                    likes?: number;
                };
                Update: Partial<Database['public']['Tables']['artist_comments']['Insert']>;
            };
        };
    };
};
