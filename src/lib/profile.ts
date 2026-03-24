import { supabase } from './supabase';
import { User } from './types';

// Fetch profile data including stats
export const getUserProfile = async (userId: string) => {
    // Get user details
    const { data: user, error: userError } = await supabase
        .from('users')
        .select('id, username, avatar, created_at, preferences')
        .eq('id', userId)
        .single();
        
    if (userError) throw userError;
    
    // Get stats: total distinct series read, total chapters read
    // From reading_progress, we can get distinct manga_id
    const { count: totalSeries } = await supabase
        .from('reading_progress')
        .select('manga_id', { count: 'exact', head: true })
        .eq('user_id', userId);
        
    // Fetch last 4 recently read mangas
    const { data: recentReads } = await supabase
        .from('reading_progress')
        .select('manga_id, chapter_number, page, last_read, mangas:manga_id (id, title, cover)')
        .eq('user_id', userId)
        .order('last_read', { ascending: false })
        .limit(4);
        
    const { count: totalChapters } = await supabase
        .from('reading_activity_log')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId);
        
    const { count: totalComments } = await supabase
        .from('comments')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId);

    return {
        ...user,
        stats: {
            totalSeries: totalSeries || 0,
            totalChapters: totalChapters || 0,
            totalComments: totalComments || 0,
        },
        recentReads: recentReads || []
    };
};

export const getReadingActivity = async (userId: string, days: number = 365) => {
    // Calculate the date X days ago
    const dateFrom = new Date();
    dateFrom.setDate(dateFrom.getDate() - days);
    
    // In reading_activity_log, read_at is the timestamp
    const { data, error } = await supabase
        .from('reading_activity_log')
        .select('read_at, chapter_id')
        .eq('user_id', userId)
        .gte('read_at', dateFrom.toISOString());
        
    if (error) {
        console.error('Activity log error:', error);
        return [];
    }
    
    // Group by date (YYYY-MM-DD)
    const activityMap: Record<string, number> = {};
    data.forEach(log => {
        const dateStr = new Date(log.read_at).toISOString().split('T')[0];
        activityMap[dateStr] = (activityMap[dateStr] || 0) + 1;
    });
    
    return Object.entries(activityMap).map(([date, count]) => ({ date, count }));
};

export const logChapterRead = async (userId: string, mangaId: string, chapterId: string, chapterNumber: number) => {
    // Optional optimization: don't log if already logged today for the same chapter
    const today = new Date().toISOString().split('T')[0];
    
    const { data } = await supabase
        .from('reading_activity_log')
        .select('id')
        .eq('user_id', userId)
        .eq('chapter_id', chapterId)
        .gte('read_at', today + 'T00:00:00Z')
        .maybeSingle();
        
    if (!data) {
        // Log it!
        await supabase.from('reading_activity_log').insert({
            user_id: userId,
            manga_id: mangaId,
            chapter_id: chapterId,
            chapter_number: chapterNumber
        });
    }
};

export const updatePrivacySettings = async (userId: string, visibility: 'public' | 'private' | 'members', currentPreferences: any = {}) => {
    const updatedPreferences = {
        ...currentPreferences,
        privacy: {
            visibility // public, members, private
        }
    };
    
    const { error } = await supabase
        .from('users')
        .update({ preferences: updatedPreferences })
        .eq('id', userId);
        
    if (error) throw error;
};

// Evaluate and sync achievements
export const syncAchievements = async (userId: string, stats: { totalSeries: number, totalChapters: number, totalComments: number }) => {
    const { totalSeries, totalChapters, totalComments } = stats;

    const currentProgress: Record<string, number> = {
        'first_blood': totalChapters,
        'manga_worm': totalChapters,
        'veteran': totalChapters,
        'critic': totalComments,
        'explorer': totalSeries,
    };

    const { data: existingAchievements } = await supabase
        .from('user_achievements')
        .select('achievement_id, unlocked_at')
        .eq('user_id', userId);

    const unlockedIds = new Set(existingAchievements?.filter(a => a.unlocked_at).map(a => a.achievement_id) || []);
    
    // We only care about unlocking new ones
    const toInsert = [];
    const now = new Date().toISOString();

    for (const [id, value] of Object.entries(currentProgress)) {
        let maxNeeded = 1;
        if (id === 'manga_worm') maxNeeded = 100;
        if (id === 'critic') maxNeeded = 50;
        if (id === 'explorer') maxNeeded = 10;
        if (id === 'veteran') maxNeeded = 1000;

        if (value >= maxNeeded && !unlockedIds.has(id)) {
            toInsert.push({
                user_id: userId,
                achievement_id: id,
                progress: maxNeeded,
                unlocked_at: now
            });
        }
    }

    if (toInsert.length > 0) {
        const { error } = await supabase.from('user_achievements').upsert(toInsert, { onConflict: 'user_id, achievement_id' });
        if (error) console.error('Achievements upsert error:', error);
    }
    
    // Return all unlocked with their timestamps
    return await supabase
        .from('user_achievements')
        .select('*')
        .eq('user_id', userId)
        .not('unlocked_at', 'is', null);
};
