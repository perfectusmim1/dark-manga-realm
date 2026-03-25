import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { formatDistanceToNow } from 'date-fns';
import { tr } from 'date-fns/locale';
import {
    Megaphone,
    ChevronRight,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/contexts/AuthContext';
import {
    getAnnouncements,
    getUnreadAnnouncementCount,
    markAsRead,
    getReadList,
    markAllAnnouncementsAsRead,
    Announcement
} from '@/lib/announcements';

const AnnouncementDropdown: React.FC = () => {
    const { user } = useAuth();
    const [announcements, setAnnouncements] = useState<Announcement[]>([]);
    const [unreadCount, setUnreadCount] = useState(0);
    const [readIds, setReadIds] = useState<string[]>([]);
    const [isOpen, setIsOpen] = useState(false);
    const [loading, setLoading] = useState(false);

    const loadAnnouncements = async (markViewed = false) => {
        if (!user) return;
        setLoading(true);
        try {
            const { announcements: allAnnouncements } = await getAnnouncements();
            const { reads } = await getReadList(user.id);

            let nextReadIds = reads;
            if (markViewed) {
                const unreadIds = allAnnouncements
                    .filter((announcement) => !reads.includes(announcement.id))
                    .map((announcement) => announcement.id);

                if (unreadIds.length > 0) {
                    const { error } = await markAllAnnouncementsAsRead(unreadIds, user.id);
                    if (!error) {
                        nextReadIds = [...new Set([...reads, ...unreadIds])];
                    }
                }
            }

            const unreadCount = allAnnouncements.filter((announcement) => !nextReadIds.includes(announcement.id)).length;

            setAnnouncements(allAnnouncements);
            setUnreadCount(unreadCount);
            setReadIds(nextReadIds);
        } catch (error) {
            console.error('Error loading announcements:', error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (user) {
            loadAnnouncements();
            const interval = setInterval(loadAnnouncements, 60000); // Check every minute
            return () => clearInterval(interval);
        }
    }, [user?.id]);

    useEffect(() => {
        if (isOpen) {
            loadAnnouncements(true);
        }
    }, [isOpen]);

    const handleMarkAsRead = async (announcementId: string) => {
        if (!user || readIds.includes(announcementId)) return;
        
        try {
            await markAsRead(announcementId, user.id);
            setReadIds(prev => [...prev, announcementId]);
            setUnreadCount(prev => Math.max(0, prev - 1));
        } catch (error) {
            console.error('Error marking as read:', error);
        }
    };

    if (!user) return null;

    return (
        <Popover open={isOpen} onOpenChange={setIsOpen}>
            <PopoverTrigger asChild>
                <Button
                    variant="ghost"
                    size="icon"
                    className="relative rounded-full hover:bg-secondary/80 h-9 w-9"
                    aria-label="Duyurular"
                >
                    <Megaphone className="h-5 w-5 text-amber-500" />
                    {unreadCount > 0 && (
                        <Badge
                            className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center p-0 text-[10px] font-bold bg-red-500 hover:bg-red-600 text-white animate-pulse border-2 border-background"
                        >
                            {unreadCount > 99 ? '99+' : unreadCount}
                        </Badge>
                    )}
                </Button>
            </PopoverTrigger>
            <PopoverContent
                align="end"
                className="w-[min(18rem,calc(100vw-1rem))] max-w-[calc(100vw-1rem)] border-border/50 bg-background/95 p-0 shadow-2xl backdrop-blur-xl sm:w-80 md:w-96"
                sideOffset={8}
            >
                {/* Header */}
                <div className="flex items-center justify-between border-b border-border/50 p-3 sm:p-4">
                    <div className="flex items-center gap-2">
                        <Megaphone className="h-4 w-4 text-amber-500" />
                        <h3 className="font-semibold">Duyurular</h3>
                        {unreadCount > 0 && (
                            <Badge variant="secondary" className="text-xs bg-red-500/10 text-red-500 border-none">
                                {unreadCount} yeni
                            </Badge>
                        )}
                    </div>
                </div>

                {/* List */}
                <ScrollArea className="h-[min(62vh,22rem)] sm:h-[450px]">
                    {announcements.length === 0 ? (
                        <div className="flex flex-col items-center justify-center px-4 py-10 sm:py-12">
                            <Megaphone className="h-12 w-12 text-muted-foreground/30 mb-3" />
                            <p className="text-sm text-muted-foreground text-center">
                                Henüz duyuru yok
                            </p>
                        </div>
                    ) : (
                        <div className="divide-y divide-border/30">
                            {announcements.map((announcement) => {
                                const isRead = readIds.includes(announcement.id);
                                return (
                                    <div
                                        key={announcement.id}
                                        className={`flex w-full flex-col gap-2 p-3 transition-all sm:p-4 ${!isRead ? 'bg-amber-500/5' : ''}`}
                                        onMouseEnter={() => !isRead && handleMarkAsRead(announcement.id)}
                                    >
                                        <div className="flex items-center justify-between gap-2">
                                            <div className="flex items-center gap-2">
                                                {!isRead && <span className="h-2 w-2 rounded-full bg-red-500 flex-shrink-0" />}
                                                <span className="font-bold text-sm leading-snug">
                                                    {announcement.title}
                                                </span>
                                            </div>
                                            <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                                                {formatDistanceToNow(new Date(announcement.created_at), {
                                                  addSuffix: true,
                                                  locale: tr,
                                                })}
                                            </span>
                                        </div>
                                        <div className="text-xs text-foreground/80 leading-relaxed whitespace-pre-wrap">
                                            {announcement.content}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </ScrollArea>
                
                <div className="p-2 border-t border-border/50 bg-secondary/20">
                    <Button asChild variant="ghost" className="w-full justify-between text-xs text-muted-foreground hover:text-foreground">
                        <Link to="/announcements" onClick={() => setIsOpen(false)}>
                            Tümünü Gör
                            <ChevronRight className="h-3.5 w-3.5" />
                        </Link>
                    </Button>
                </div>
            </PopoverContent>
        </Popover>
    );
};

export default AnnouncementDropdown;
