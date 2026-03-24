import { supabase } from './supabase';

export interface Announcement {
    id: string;
    title: string;
    content: string;
    created_at: string;
    created_by: string;
}

export const getAnnouncements = async () => {
    const { data, error } = await supabase
        .from('announcements')
        .select('*')
        .order('created_at', { ascending: false });
        
    return { announcements: data || [], error };
};

export const createAnnouncement = async (title: string, content: string) => {
    const { data, error } = await supabase
        .from('announcements')
        .insert({ title, content })
        .select()
        .single();
        
    return { announcement: data, error };
};

export const deleteAnnouncement = async (id: string) => {
    const { error } = await supabase
        .from('announcements')
        .delete()
        .eq('id', id);
        
    return { error };
};

export const markAsRead = async (announcementId: string, userId: string) => {
    const { error } = await supabase
        .from('announcement_reads')
        .upsert({ announcement_id: announcementId, user_id: userId }, { onConflict: 'announcement_id,user_id' });
        
    return { error };
};

export const getUnreadAnnouncementCount = async (userId: string) => {
    const { data, error } = await supabase
        .rpc('get_unread_announcement_count', { p_user_id: userId });
        
    return { count: data || 0, error };
};

export const getReadList = async (userId: string) => {
    const { data, error } = await supabase
        .from('announcement_reads')
        .select('announcement_id')
        .eq('user_id', userId);
        
    return { reads: data?.map(r => r.announcement_id) || [], error };
};

export const markAllAnnouncementsAsRead = async (announcementIds: string[], userId: string) => {
    if (!announcementIds.length) {
        return { error: null };
    }

    const payload = announcementIds.map((announcementId) => ({
        announcement_id: announcementId,
        user_id: userId,
    }));

    const { error } = await supabase
        .from('announcement_reads')
        .upsert(payload, { onConflict: 'announcement_id,user_id' });

    return { error };
};
