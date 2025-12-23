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
    Check,
    CheckCheck,
    Trash2,
    Filter,
} from 'lucide-react';
import Header from '@/components/layout/Header';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useAuth } from '@/contexts/AuthContext';
import {
    getNotifications,
    markNotificationAsRead,
    markAllNotificationsAsRead,
    clearNotifications,
    getUnreadNotificationCount,
} from '@/lib/storage';
import { Notification } from '@/lib/types';
import { toast } from 'sonner';

type FilterType = 'all' | 'unread' | 'new_chapter' | 'reply' | 'like';

const Notifications: React.FC = () => {
    const { user } = useAuth();
    const navigate = useNavigate();
    const [notifications, setNotifications] = useState<Notification[]>([]);
    const [filter, setFilter] = useState<FilterType>('all');
    const [unreadCount, setUnreadCount] = useState(0);

    const loadNotifications = async () => {
        if (!user) return;
        try {
            const allNotifications = await getNotifications(user.id);
            setNotifications(allNotifications);
            const count = await getUnreadNotificationCount(user.id);
            setUnreadCount(count);
        } catch (error) {
            console.error('Error loading notifications:', error);
        }
    };

    useEffect(() => {
        loadNotifications();
    }, [user?.id]);

    const handleNotificationClick = async (notification: Notification) => {
        if (!notification.read && user) {
            await markNotificationAsRead(user.id, notification.id);
            loadNotifications();
        }
        if (notification.link) {
            navigate(notification.link);
        }
    };

    const handleMarkAllRead = async () => {
        if (!user) return;
        await markAllNotificationsAsRead(user.id);
        loadNotifications();
        toast.success('Tüm bildirimler okundu olarak işaretlendi');
    };

    const handleClearAll = async () => {
        if (!user) return;
        await clearNotifications(user.id);
        loadNotifications();
        toast.success('Tüm bildirimler silindi');
    };

    const getNotificationIcon = (type: Notification['type']) => {
        switch (type) {
            case 'new_chapter':
                return <BookOpen className="h-5 w-5 text-primary" />;
            case 'reply':
                return <MessageCircle className="h-5 w-5 text-blue-400" />;
            case 'like':
                return <ThumbsUp className="h-5 w-5 text-pink-400" />;
            case 'system':
            default:
                return <Info className="h-5 w-5 text-yellow-400" />;
        }
    };

    const getNotificationTypeLabel = (type: Notification['type']) => {
        switch (type) {
            case 'new_chapter':
                return 'Yeni Bölüm';
            case 'reply':
                return 'Yanıt';
            case 'like':
                return 'Beğeni';
            case 'system':
            default:
                return 'Sistem';
        }
    };

    const filteredNotifications = notifications.filter((n) => {
        if (filter === 'all') return true;
        if (filter === 'unread') return !n.read;
        return n.type === filter;
    });

    const filterLabels: Record<FilterType, string> = {
        all: 'Tümü',
        unread: 'Okunmamış',
        new_chapter: 'Yeni Bölümler',
        reply: 'Yanıtlar',
        like: 'Beğeniler',
    };

    if (!user) {
        return (
            <div className="min-h-screen bg-background">
                <Header />
                <main className="container flex min-h-[60vh] items-center justify-center pt-20">
                    <div className="text-center">
                        <Bell className="mx-auto h-16 w-16 text-muted-foreground/30 mb-4" />
                        <h1 className="text-2xl font-bold">Giriş Yapmalısınız</h1>
                        <p className="mt-2 text-muted-foreground">
                            Bildirimleri görmek için giriş yapmanız gerekiyor.
                        </p>
                        <Button asChild className="mt-4">
                            <Link to="/auth">Giriş Yap</Link>
                        </Button>
                    </div>
                </main>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-background">
            <Header />

            <main className="container pt-20 pb-12">
                {/* Page Header */}
                <div className="mb-8 animate-fade-up opacity-0" style={{ animationDelay: '0.1s', animationFillMode: 'forwards' }}>
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                        <div className="flex items-center gap-3">
                            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
                                <Bell className="h-6 w-6 text-primary" />
                            </div>
                            <div>
                                <h1 className="text-2xl font-bold">Bildirimler</h1>
                                <p className="text-sm text-muted-foreground">
                                    {unreadCount > 0
                                        ? `${unreadCount} okunmamış bildirim`
                                        : 'Tüm bildirimler okundu'}
                                </p>
                            </div>
                        </div>

                        <div className="flex items-center gap-2">
                            {/* Filter Dropdown */}
                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <Button variant="outline" size="sm">
                                        <Filter className="mr-2 h-4 w-4" />
                                        {filterLabels[filter]}
                                    </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                    {(Object.entries(filterLabels) as [FilterType, string][]).map(
                                        ([key, label]) => (
                                            <DropdownMenuItem
                                                key={key}
                                                onClick={() => setFilter(key)}
                                                className={filter === key ? 'bg-secondary' : ''}
                                            >
                                                {label}
                                            </DropdownMenuItem>
                                        )
                                    )}
                                </DropdownMenuContent>
                            </DropdownMenu>

                            {/* Mark All Read */}
                            {unreadCount > 0 && (
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={handleMarkAllRead}
                                >
                                    <CheckCheck className="mr-2 h-4 w-4" />
                                    Tümünü Okundu İşaretle
                                </Button>
                            )}

                            {/* Clear All */}
                            {notifications.length > 0 && (
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={handleClearAll}
                                    className="text-destructive hover:text-destructive"
                                >
                                    <Trash2 className="mr-2 h-4 w-4" />
                                    Temizle
                                </Button>
                            )}
                        </div>
                    </div>
                </div>

                {/* Notifications List */}
                <div className="space-y-3 animate-fade-up opacity-0" style={{ animationDelay: '0.2s', animationFillMode: 'forwards' }}>
                    {filteredNotifications.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-20 rounded-xl border border-border bg-card/50">
                            <Bell className="h-16 w-16 text-muted-foreground/20 mb-4" />
                            <h2 className="text-xl font-semibold text-muted-foreground mb-2">
                                {filter === 'all'
                                    ? 'Henüz bildirim yok'
                                    : `${filterLabels[filter]} bildirim yok`}
                            </h2>
                            <p className="text-sm text-muted-foreground/70 text-center max-w-md">
                                Mangaları takip ederek yeni bölüm bildirimleri alabilirsiniz.
                                Yorumlarınıza gelen yanıtlar ve beğeniler de burada görünecek.
                            </p>
                        </div>
                    ) : (
                        filteredNotifications.map((notification, index) => (
                            <button
                                key={notification.id}
                                onClick={() => handleNotificationClick(notification)}
                                className={`w-full text-left rounded-xl border transition-all hover:border-primary/30 hover:shadow-lg hover:shadow-primary/5 flex gap-4 p-4 group animate-fade-up opacity-0 ${!notification.read
                                    ? 'bg-primary/5 border-primary/20'
                                    : 'bg-card/50 border-border'
                                    }`}
                                style={{ animationDelay: `${0.1 + index * 0.05}s`, animationFillMode: 'forwards' }}
                            >
                                {/* Icon */}
                                <div className="flex-shrink-0">
                                    <div
                                        className={`flex h-12 w-12 items-center justify-center rounded-xl transition-transform group-hover:scale-110 ${notification.type === 'new_chapter'
                                            ? 'bg-primary/10'
                                            : notification.type === 'reply'
                                                ? 'bg-blue-500/10'
                                                : notification.type === 'like'
                                                    ? 'bg-pink-500/10'
                                                    : 'bg-yellow-500/10'
                                            }`}
                                    >
                                        {getNotificationIcon(notification.type)}
                                    </div>
                                </div>

                                {/* Content */}
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 mb-1">
                                        <Badge
                                            variant="outline"
                                            className={`text-xs ${notification.type === 'new_chapter'
                                                ? 'border-primary/50 text-primary'
                                                : notification.type === 'reply'
                                                    ? 'border-blue-400/50 text-blue-400'
                                                    : notification.type === 'like'
                                                        ? 'border-pink-400/50 text-pink-400'
                                                        : 'border-yellow-400/50 text-yellow-400'
                                                }`}
                                        >
                                            {getNotificationTypeLabel(notification.type)}
                                        </Badge>
                                        {!notification.read && (
                                            <span className="flex items-center gap-1 text-xs text-primary font-medium">
                                                <span className="h-2 w-2 rounded-full bg-primary animate-pulse" />
                                                Yeni
                                            </span>
                                        )}
                                    </div>
                                    <h3 className="font-semibold text-foreground group-hover:text-primary transition-colors">
                                        {notification.title}
                                    </h3>
                                    <p className="text-sm text-muted-foreground mt-1">
                                        {notification.message}
                                    </p>
                                    <div className="flex items-center gap-3 mt-2">
                                        <span className="text-xs text-muted-foreground/60">
                                            {formatDistanceToNow(new Date(notification.createdAt), {
                                                addSuffix: true,
                                                locale: tr,
                                            })}
                                        </span>
                                        {notification.fromUsername && (
                                            <span className="text-xs text-muted-foreground">
                                                • {notification.fromUsername} tarafından
                                            </span>
                                        )}
                                        {notification.mangaTitle && notification.type !== 'new_chapter' && (
                                            <span className="text-xs text-muted-foreground">
                                                • {notification.mangaTitle}
                                            </span>
                                        )}
                                    </div>
                                </div>

                                {/* Manga Cover (for new chapter notifications) */}
                                {notification.mangaCover && (
                                    <div className="flex-shrink-0">
                                        <img
                                            src={notification.mangaCover}
                                            alt={notification.mangaTitle || 'Manga'}
                                            className="h-16 w-12 rounded-lg object-cover shadow-md transition-transform group-hover:scale-105"
                                        />
                                    </div>
                                )}

                                {/* Read Indicator */}
                                {notification.read && (
                                    <div className="flex-shrink-0 flex items-center">
                                        <Check className="h-4 w-4 text-muted-foreground/40" />
                                    </div>
                                )}
                            </button>
                        ))
                    )}
                </div>
            </main>
        </div>
    );
};

export default Notifications;
