import { supabase } from './supabase';
import { Manga, Chapter, User, MangaRating } from './types';

// Comment Interface (Supabase yapısına uygun)
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

// ==================== MANGA OPERATIONS ====================

export const getAllMangas = async (): Promise<Manga[]> => {
    const { data, error } = await supabase
        .from('mangas')
        .select('*')
        .order('created_at', { ascending: false });

    if (error) {
        console.error('Manga çekilirken hata:', error);
        return [];
    }

    // Supabase snake_case kullanıyor olabilir, gerekirse eşleme yapıyoruz
    return data.map(m => ({
        ...m,
        id: m.id,
        lastUpdated: m.last_updated,
        createdAt: m.created_at
    })) as Manga[];
};

export const getMangaById = async (mangaId: string): Promise<Manga | undefined> => {
    const { data, error } = await supabase
        .from('mangas')
        .select('*, chapters(*)') // Join chapters
        .eq('id', mangaId)
        .single();

    if (error) {
        console.error('Manga detay hatası:', error);
        return undefined;
    }

    return {
        ...data,
        lastUpdated: data.last_updated,
        createdAt: data.created_at,
        chapters: (data.chapters || []).sort((a: any, b: any) => b.number - a.number)
    } as Manga;
};

export const saveManga = async (manga: Partial<Manga>): Promise<boolean> => {
    const mangaData = {
        title: manga.title,
        author: manga.author,
        artist: manga.artist,
        description: manga.description,
        cover: manga.cover,
        banner: manga.banner,
        genres: manga.genres,
        status: manga.status,
        type: manga.type,
        last_updated: new Date().toISOString()
    };

    if (manga.id) {
        const { error } = await supabase
            .from('mangas')
            .update(mangaData)
            .eq('id', manga.id);
        return !error;
    } else {
        const { error } = await supabase
            .from('mangas')
            .insert([mangaData]);
        return !error;
    }
};

export const deleteManga = async (mangaId: string): Promise<boolean> => {
    const { error } = await supabase
        .from('mangas')
        .delete()
        .eq('id', mangaId);
    return !error;
};

// ==================== CHAPTER OPERATIONS ====================

export const addChapterToManga = async (mangaId: string, chapter: Partial<Chapter>): Promise<boolean> => {
    const { error } = await supabase
        .from('chapters')
        .insert([{
            manga_id: mangaId,
            number: chapter.number,
            title: chapter.title,
            pages: chapter.pages,
            release_date: new Date().toISOString()
        }]);

    return !error;
};

// ==================== SEARCH & FILTER ====================

export const searchMangas = async (query: string): Promise<Manga[]> => {
    const { data, error } = await supabase
        .from('mangas')
        .select('*')
        .ilike('title', `%${query}%`);

    if (error) return [];
    return data as Manga[];
};

// ==================== STATISTICS ====================

export const getStatistics = async () => {
    const { count: mangaCount } = await supabase.from('mangas').select('*', { count: 'exact', head: true });
    const { count: userCount } = await supabase.from('users').select('*', { count: 'exact', head: true });
    const { data: viewsData } = await supabase.from('mangas').select('views');

    const totalViews = viewsData?.reduce((acc, m) => acc + (m.views || 0), 0) || 0;

    return {
        totalMangas: mangaCount || 0,
        totalUsers: userCount || 0,
        totalViews: totalViews,
        // Diğer istatistikler ihtiyaca göre eklenebilir
    };
};
