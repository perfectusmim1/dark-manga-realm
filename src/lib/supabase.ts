import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

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
                    type: 'manga' | 'manhwa' | 'manhua';
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
        };
    };
};
