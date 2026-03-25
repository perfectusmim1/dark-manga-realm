import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { formatDistanceToNow } from 'date-fns';
import { tr } from 'date-fns/locale';
import {
    Bell,
    BookOpen,
    MessageCircle,
    ThumbsUp,
    Info,
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
import {
    getNotifications,
    getUnreadNotificationCount,
    markNotificationAsRead,
} from '@/lib/storage';
import { Notification } from '@/lib/types';
import { normalizeCommentNavigationLink } from '@/lib/commentNavigation';

const NotificationDropdown: React.FC = () => {
    const { user } = useAuth();
    const navigate = useNavigate();
    const [notifications, setNotifications] = useState<Notification[]>([]);
    const [unreadCount, setUnreadCount] = useState(0);
    const [isOpen, setIsOpen] = useState(false);

    const loadNotifications = async () => {
        if (!user) return;
        try {
            const allNotifications = await getNotifications(user.id);
            setNotifications(allNotifications.slice(0, 8)); // Show max 8 in dropdown
            const count = await getUnreadNotificationCount(user.id);
            setUnreadCount(count);
        } catch (error) {
            console.error('Error loading notifications:', error);
        }
    };

    useEffect(() => {
        loadNotifications();
        // Poll for new notifications every 30 seconds
        const interval = setInterval(loadNotifications, 30000);
        return () => clearInterval(interval);
    }, [user?.id]);

    useEffect(() => {
        if (isOpen) {
            loadNotifications();
        }
    }, [isOpen]);

    const handleNotificationClick = async (notification: Notification) => {
        if (!notification.read && user) {
            await markNotificationAsRead(user.id, notification.id);
            loadNotifications();
        }
        setIsOpen(false);
        if (notification.link) {
            navigate(normalizeCommentNavigationLink(notification.link) || notification.link);
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
            case 'system':
            default:
                return <Info className="h-4 w-4 text-yellow-400" />;
        }
    };

    if (!user) return null;

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
                className="w-80 p-0 border-border/50 bg-background/95 backdrop-blur-xl shadow-2xl"
                sideOffset={8}
            >
                {/* Header */}
                <div className="flex items-center justify-between border-b border-border/50 p-4">
                    <div className="flex items-center gap-2">
                        <Bell className="h-4 w-4 text-primary" />
                        <h3 className="font-semibold">Bildirimler</h3>
                        {unreadCount > 0 && (
                            <Badge variant="secondary" className="text-xs">
                                {unreadCount} yeni
                            </Badge>
                        )}
                    </div>
                </div>

                {/* Notifications List */}
                <ScrollArea className="h-[400px]">
                    {notifications.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-12 px-4">
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
                                    className={`w-full text-left p-4 transition-all hover:bg-secondary/50 flex gap-3 ${!notification.read ? 'bg-primary/5' : ''
                                        }`}
                                >
                                    {/* Icon */}
                                    <div className="flex-shrink-0 mt-0.5">
                                        <div className={`flex h-8 w-8 items-center justify-center rounded-full ${notification.type === 'new_chapter' ? 'bg-primary/10' :
                                            notification.type === 'reply' ? 'bg-blue-500/10' :
                                                notification.type === 'like' ? 'bg-pink-500/10' :
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
                                                className="h-12 w-8 rounded object-cover"
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
                </div>
            </PopoverContent>
        </Popover>
    );
};

export default NotificationDropdown;
