import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { formatDistanceToNow } from 'date-fns';
import { tr } from 'date-fns/locale';
import { CheckCheck, Megaphone } from 'lucide-react';
import Header from '@/components/layout/Header';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/contexts/AuthContext';
import {
    Announcement,
    getAnnouncements,
    getReadList,
    markAllAnnouncementsAsRead,
    markAsRead,
} from '@/lib/announcements';
import { toast } from 'sonner';

const Announcements: React.FC = () => {
    const { user } = useAuth();
    const [announcements, setAnnouncements] = useState<Announcement[]>([]);
    const [readIds, setReadIds] = useState<string[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isMarkingAll, setIsMarkingAll] = useState(false);

    const loadAnnouncements = async () => {
        if (!user) {
            setIsLoading(false);
            return;
        }

        setIsLoading(true);
        try {
            const [{ announcements: announcementData }, { reads }] = await Promise.all([
                getAnnouncements(),
                getReadList(user.id),
            ]);

            const unreadIds = announcementData
                .filter((announcement) => !reads.includes(announcement.id))
                .map((announcement) => announcement.id);

            let nextReadIds = reads;
            if (unreadIds.length > 0) {
                const { error } = await markAllAnnouncementsAsRead(unreadIds, user.id);
                if (!error) {
                    nextReadIds = [...new Set([...reads, ...unreadIds])];
                }
            }

            setAnnouncements(announcementData);
            setReadIds(nextReadIds);
        } catch (error) {
            console.error('Announcements page load error:', error);
            toast.error('Duyurular yüklenemedi');
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        void loadAnnouncements();
    }, [user?.id]);

    const unreadIds = useMemo(
        () => announcements.filter((announcement) => !readIds.includes(announcement.id)).map((announcement) => announcement.id),
        [announcements, readIds],
    );

    const handleMarkAsRead = async (announcementId: string) => {
        if (!user || readIds.includes(announcementId)) {
            return;
        }

        try {
            await markAsRead(announcementId, user.id);
            setReadIds((current) => [...current, announcementId]);
        } catch (error) {
            console.error('Announcement read error:', error);
        }
    };

    const handleMarkAllAsRead = async () => {
        if (!user || unreadIds.length === 0) {
            return;
        }

        try {
            setIsMarkingAll(true);
            const { error } = await markAllAnnouncementsAsRead(unreadIds, user.id);
            if (error) {
                throw error;
            }
            setReadIds((current) => [...new Set([...current, ...unreadIds])]);
            toast.success('Tüm duyurular okundu olarak işaretlendi');
        } catch (error) {
            console.error('Mark all announcements read error:', error);
            toast.error('Duyurular güncellenemedi');
        } finally {
            setIsMarkingAll(false);
        }
    };

    if (!user) {
        return (
            <div className="min-h-screen bg-background">
                <Header />
                <main className="container flex min-h-[60vh] items-center justify-center pt-20">
                    <div className="text-center">
                        <Megaphone className="mx-auto mb-4 h-16 w-16 text-muted-foreground/30" />
                        <h1 className="text-2xl font-bold">Giriş Yapmalısınız</h1>
                        <p className="mt-2 text-muted-foreground">
                            Duyuruları görmek için giriş yapmanız gerekiyor.
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

            <main className="container pb-12 pt-20">
                <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-center gap-3">
                        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-amber-500/10">
                            <Megaphone className="h-6 w-6 text-amber-500" />
                        </div>
                        <div>
                            <h1 className="text-2xl font-bold">Duyurular</h1>
                            <p className="text-sm text-muted-foreground">
                                {unreadIds.length > 0 ? `${unreadIds.length} okunmamış duyuru var` : 'Tüm duyurular okundu'}
                            </p>
                        </div>
                    </div>

                    {unreadIds.length > 0 && (
                        <Button variant="outline" onClick={() => void handleMarkAllAsRead()} disabled={isMarkingAll}>
                            <CheckCheck className="mr-2 h-4 w-4" />
                            {isMarkingAll ? 'İşaretleniyor...' : 'Tümünü Okundu İşaretle'}
                        </Button>
                    )}
                </div>

                {isLoading ? (
                    <div className="rounded-2xl border border-border bg-card/50 p-12 text-center text-muted-foreground">
                        Duyurular yükleniyor...
                    </div>
                ) : announcements.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-border bg-card/50 p-12 text-center">
                        <Megaphone className="mx-auto mb-4 h-14 w-14 text-muted-foreground/20" />
                        <h2 className="text-xl font-semibold">Henüz duyuru yok</h2>
                        <p className="mt-2 text-sm text-muted-foreground">
                            Yeni site duyuruları burada detaylı şekilde görünecek.
                        </p>
                    </div>
                ) : (
                    <div className="space-y-4">
                        {announcements.map((announcement, index) => {
                            const isRead = readIds.includes(announcement.id);

                            return (
                                <article
                                    key={announcement.id}
                                    className={`rounded-2xl border p-6 transition-colors animate-fade-up opacity-0 ${isRead ? 'border-border bg-card/40' : 'border-amber-500/20 bg-amber-500/5'}`}
                                    style={{ animationDelay: `${0.05 + index * 0.03}s`, animationFillMode: 'forwards' }}
                                    onMouseEnter={() => void handleMarkAsRead(announcement.id)}
                                >
                                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                                        <div className="flex items-center gap-3">
                                            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-amber-500/10 text-amber-500">
                                                <Megaphone className="h-5 w-5" />
                                            </div>
                                            <div>
                                                <div className="flex flex-wrap items-center gap-2">
                                                    <h2 className="text-lg font-semibold">{announcement.title}</h2>
                                                    {!isRead && (
                                                        <Badge className="bg-red-500/10 text-red-500 hover:bg-red-500/15">
                                                            Yeni
                                                        </Badge>
                                                    )}
                                                </div>
                                                <p className="mt-1 text-xs text-muted-foreground">
                                                    {formatDistanceToNow(new Date(announcement.created_at), {
                                                        addSuffix: true,
                                                        locale: tr,
                                                    })}
                                                </p>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="mt-5 rounded-xl border border-border/50 bg-background/40 p-4">
                                        <p className="whitespace-pre-wrap text-sm leading-7 text-foreground/90">
                                            {announcement.content}
                                        </p>
                                    </div>
                                </article>
                            );
                        })}
                    </div>
                )}
            </main>
        </div>
    );
};

export default Announcements;
