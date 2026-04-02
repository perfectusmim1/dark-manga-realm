import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { formatDistanceToNow } from 'date-fns';
import { tr } from 'date-fns/locale';
import {
    Bell,
    BookOpen,
    MessageCircle,
    ThumbsUp,
    Info,
    UserPlus,
    ChevronRight,
    Check,
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
import { useEffectiveOnlineStatus } from '@/hooks/useEffectiveOnlineStatus';
import {
    getNotifications,
    getUnreadNotificationCount,
    markAllNotificationsAsRead,
    markNotificationAsRead,
} from '@/lib/storage';
import { Notification } from '@/lib/types';
import { normalizeCommentNavigationLink } from '@/lib/commentNavigation';
import OfflineNotice from '@/components/offline/OfflineNotice';
import { isDocumentVisible } from '@/lib/documentVisibility';
import { isExpectedAccessControlError } from '@/lib/supabase';
import { readHeaderShellSnapshot, updateHeaderShellCounts } from '@/lib/headerShellCache';

interface NotificationDropdownProps {
    userId?: string | null;
}

const NotificationDropdown: React.FC<NotificationDropdownProps> = ({ userId }) => {
    const { user } = useAuth();
    const { isOnline } = useEffectiveOnlineStatus();
    const navigate = useNavigate();
    const resolvedUserId = user?.id ?? userId ?? null;
    const [notifications, setNotifications] = useState<Notification[]>([]);
    const [unreadCount, setUnreadCount] = useState(() => {
        const snapshot = readHeaderShellSnapshot();
        return snapshot?.unreadNotificationCount || 0;
    });
    const [isOpen, setIsOpen] = useState(false);
    const [isMarkingAllRead, setIsMarkingAllRead] = useState(false);

    const loadUnreadCount = useCallback(async () => {
        if (!resolvedUserId || !isOnline || !isDocumentVisible()) return;
        try {
            const count = await getUnreadNotificationCount(resolvedUserId);
            setUnreadCount(count);
            updateHeaderShellCounts(resolvedUserId, { unreadNotificationCount: count });
        } catch (error) {
            if (!isExpectedAccessControlError(error)) {
                console.error('Error loading unread notification count:', error);
            }
        }
    }, [isOnline, resolvedUserId]);

    const loadNotifications = useCallback(async () => {
        if (!resolvedUserId || !isOnline || !isDocumentVisible()) return;
        try {
            const [allNotifications, count] = await Promise.all([
                getNotifications(resolvedUserId),
                getUnreadNotificationCount(resolvedUserId),
            ]);
            setNotifications(allNotifications.slice(0, 8)); // Show max 8 in dropdown
            setUnreadCount(count);
            updateHeaderShellCounts(resolvedUserId, { unreadNotificationCount: count });
        } catch (error) {
            if (!isExpectedAccessControlError(error)) {
                console.error('Error loading notifications:', error);
            }
        }
    }, [isOnline, resolvedUserId]);

    useEffect(() => {
        if (resolvedUserId) {
            const snapshot = readHeaderShellSnapshot();
            if (snapshot?.user?.id === resolvedUserId) {
                setUnreadCount(snapshot.unreadNotificationCount || 0);
            }
        }
    }, [resolvedUserId]);

    useEffect(() => {
        if (!resolvedUserId || !isOnline) {
            setNotifications([]);
            setUnreadCount(0);
            return;
        }

        void (isOpen ? loadNotifications() : loadUnreadCount());

        const interval = window.setInterval(() => {
            if (isDocumentVisible()) {
                void (isOpen ? loadNotifications() : loadUnreadCount());
            }
        }, 30000);

        return () => {
            window.clearInterval(interval);
        };
    }, [isOnline, isOpen, loadNotifications, loadUnreadCount, resolvedUserId]);

    const handleNotificationClick = async (notification: Notification) => {
        if (!notification.read && resolvedUserId) {
            await markNotificationAsRead(resolvedUserId, notification.id);
            void loadNotifications();
        }
        setIsOpen(false);
        if (notification.link) {
            navigate(normalizeCommentNavigationLink(notification.link) || notification.link);
        }
    };

    const handleMarkAllAsRead = async () => {
        if (!resolvedUserId || unreadCount === 0 || isMarkingAllRead) return;

        setIsMarkingAllRead(true);
        try {
            await markAllNotificationsAsRead(resolvedUserId);
            setNotifications((current) => current.map((notification) => ({
                ...notification,
                read: true,
            })));
            setUnreadCount(0);
            updateHeaderShellCounts(resolvedUserId, { unreadNotificationCount: 0 });
        } catch (error) {
            if (!isExpectedAccessControlError(error)) {
                console.error('Error marking all notifications as read:', error);
            }
        } finally {
            setIsMarkingAllRead(false);
        }
    };

    const getNotificationIcon = (type: Notification['type']) => {
        switch (type) {
            case 'new_chapter':
                return <BookOpen className="h-4 w-4 text-primary" />;
            case 'reply':
                return <MessageCircle className="h-4 w-4 text-blue-400" />;
            case 'like':
                return <ThumbsUp className="h-4 w-4 text-pink-400" />;
            case 'follow':
                return <UserPlus className="h-4 w-4 text-emerald-400" />;
            case 'system':
            default:
                return <Info className="h-4 w-4 text-yellow-400" />;
        }
    };

    if (!resolvedUserId) return null;

    return (
        <Popover open={isOpen} onOpenChange={setIsOpen}>
            <PopoverTrigger asChild>
                <Button
                    variant="ghost"
                    size="icon"
                    className="relative rounded-full"
                    aria-label="Bildirimler"
                >
                    <Bell className="h-5 w-5" />
                    {unreadCount > 0 && (
                        <Badge
                            variant="destructive"
                            className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center p-0 text-[10px] font-bold animate-pulse"
                        >
                            {unreadCount > 99 ? '99+' : unreadCount}
                        </Badge>
                    )}
                </Button>
            </PopoverTrigger>
            <PopoverContent
                align="end"
                className="w-[min(18rem,calc(100vw-1rem))] max-w-[calc(100vw-1rem)] border-border/50 bg-background/95 p-0 shadow-2xl backdrop-blur-xl sm:w-80"
                sideOffset={8}
            >
                {/* Header */}
                <div className="flex items-center justify-between border-b border-border/50 p-3 sm:p-4">
                    <div className="flex items-center gap-2">
                        <Bell className="h-4 w-4 text-primary" />
                        <h3 className="font-semibold">Bildirimler</h3>
                    </div>
                    {unreadCount > 0 ? (
                        <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 px-2 text-xs"
                            onClick={() => void handleMarkAllAsRead()}
                            disabled={isMarkingAllRead}
                        >
                            {isMarkingAllRead ? 'İşleniyor...' : 'Tümünü okundu yap'}
                        </Button>
                    ) : null}
                </div>

                {/* Notifications List */}
                <ScrollArea className="h-[min(60vh,20rem)] sm:h-[400px]">
                    {!isOnline ? (
                        <div className="p-3 sm:p-4">
                            <OfflineNotice
                                compact
                                title="Çevrimdışısınız"
                                description="Bildirimleri görmek için internete bağlanın."
                            />
                        </div>
                    ) : notifications.length === 0 ? (
                        <div className="flex flex-col items-center justify-center px-4 py-10 sm:py-12">
                            <Bell className="h-12 w-12 text-muted-foreground/30 mb-3" />
                            <p className="text-sm text-muted-foreground text-center">
                                Henüz bildiriminiz yok
                            </p>
                            <p className="text-xs text-muted-foreground/70 text-center mt-1">
                                Mangaları takip edin, yeni bölüm bildirimleri alın!
                            </p>
                        </div>
                    ) : (
                        <div className="divide-y divide-border/30">
                            {notifications.map((notification) => (
                                <button
                                    key={notification.id}
                                    onClick={() => handleNotificationClick(notification)}
                                    className={`flex w-full gap-2 p-3 text-left transition-all hover:bg-secondary/50 sm:gap-3 sm:p-4 ${!notification.read ? 'bg-primary/5' : ''
                                        }`}
                                >
                                    {/* Icon */}
                                    <div className="flex-shrink-0 mt-0.5">
                                        <div className={`flex h-8 w-8 items-center justify-center rounded-full ${notification.type === 'new_chapter' ? 'bg-primary/10' :
                                            notification.type === 'reply' ? 'bg-blue-500/10' :
                                                notification.type === 'like' ? 'bg-pink-500/10' :
                                                    notification.type === 'follow' ? 'bg-emerald-500/10' :
                                                    'bg-yellow-500/10'
                                            }`}>
                                            {getNotificationIcon(notification.type)}
                                        </div>
                                    </div>

                                    {/* Content */}
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2">
                                            <span className="font-medium text-sm truncate">
                                                {notification.title}
                                            </span>
                                            {!notification.read && (
                                                <span className="h-2 w-2 rounded-full bg-primary flex-shrink-0" />
                                            )}
                                        </div>
                                        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                                            {notification.message}
                                        </p>
                                        <p className="text-[10px] text-muted-foreground/60 mt-1">
                                            {formatDistanceToNow(new Date(notification.createdAt), {
                                                addSuffix: true,
                                                locale: tr,
                                            })}
                                        </p>
                                    </div>

                                    {/* Manga Cover Preview (for new chapter notifications) */}
                                    {notification.mangaCover && (
                                        <div className="flex-shrink-0">
                                            <img
                                                src={notification.mangaCover}
                                                alt=""
                                                className="h-10 w-7 rounded object-cover sm:h-12 sm:w-8"
                                            />
                                        </div>
                                    )}
                                </button>
                            ))}
                        </div>
                    )}
                </ScrollArea>

                {/* Footer */}
                <div className="border-t border-border/50 p-2">
                    {isOnline ? (
                        <Button
                            variant="ghost"
                            className="w-full justify-between text-sm"
                            asChild
                        >
                            <Link to="/notifications" onClick={() => setIsOpen(false)}>
                                <span className="flex items-center gap-2">
                                    <Check className="h-4 w-4" />
                                    Tümünü Gör
                                </span>
                                <ChevronRight className="h-4 w-4" />
                            </Link>
                        </Button>
                    ) : null}
                </div>
            </PopoverContent>
        </Popover>
    );
};

export default NotificationDropdown;
