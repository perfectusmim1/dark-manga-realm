import React, { useEffect, useMemo, useState } from 'react';
import {
    BookOpen,
    CheckCircle2,
    Clock3,
    Flag,
    Loader2,
    MessageSquare,
    ShieldX,
    UserCircle2,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
    CommentReport,
    getCommentReports,
    getMangaReports,
    getProfileReports,
    MangaReport,
    ProfileReport,
    ReportStatus,
    updateCommentReportStatus,
    updateMangaReportStatus,
    updateProfileReportStatus,
} from '@/lib/database';
import { toast } from 'sonner';

const statusMeta: Record<ReportStatus, { label: string; icon: React.ComponentType<{ className?: string }> }> = {
    open: { label: 'Açık', icon: Flag },
    reviewed: { label: 'İnceleniyor', icon: Clock3 },
    resolved: { label: 'Çözüldü', icon: CheckCircle2 },
    dismissed: { label: 'Reddedildi', icon: ShieldX },
};

const statusToneClassNames: Record<
    ReportStatus,
    {
        trigger: string;
        badge: string;
        card: string;
    }
> = {
    open: {
        trigger: 'border-amber-500/25 bg-amber-500/10 text-amber-200 hover:bg-amber-500/15 data-[state=active]:border-amber-400/40 data-[state=active]:bg-amber-500/20 data-[state=active]:text-amber-50',
        badge: 'border-amber-500/25 bg-amber-500/10 text-amber-200',
        card: 'border-amber-500/10 bg-gradient-to-br from-amber-500/[0.08] via-card/90 to-card/95',
    },
    reviewed: {
        trigger: 'border-sky-500/25 bg-sky-500/10 text-sky-200 hover:bg-sky-500/15 data-[state=active]:border-sky-400/40 data-[state=active]:bg-sky-500/20 data-[state=active]:text-sky-50',
        badge: 'border-sky-500/25 bg-sky-500/10 text-sky-200',
        card: 'border-sky-500/10 bg-gradient-to-br from-sky-500/[0.08] via-card/90 to-card/95',
    },
    resolved: {
        trigger: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/15 data-[state=active]:border-emerald-400/40 data-[state=active]:bg-emerald-500/20 data-[state=active]:text-emerald-50',
        badge: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-200',
        card: 'border-emerald-500/10 bg-gradient-to-br from-emerald-500/[0.08] via-card/90 to-card/95',
    },
    dismissed: {
        trigger: 'border-rose-500/25 bg-rose-500/10 text-rose-200 hover:bg-rose-500/15 data-[state=active]:border-rose-400/40 data-[state=active]:bg-rose-500/20 data-[state=active]:text-rose-50',
        badge: 'border-rose-500/25 bg-rose-500/10 text-rose-200',
        card: 'border-rose-500/10 bg-gradient-to-br from-rose-500/[0.08] via-card/90 to-card/95',
    },
};

const statusOrder: ReportStatus[] = ['open', 'reviewed', 'resolved', 'dismissed'];
const commentEntityTypeLabels: Record<string, string> = {
    manga: 'Seri',
    character: 'Karakter',
    author: 'Yazar',
    artist: 'Çizer',
};

const formatDate = (value?: string) => {
    if (!value) {
        return 'Tarih yok';
    }

    return new Date(value).toLocaleString('tr-TR', {
        dateStyle: 'medium',
        timeStyle: 'short',
    });
};

const StatusTabs = ({
    counts,
    value,
    onValueChange,
}: {
    counts: Record<ReportStatus, number>;
    value: ReportStatus;
    onValueChange: (next: ReportStatus) => void;
}) => (
    <Tabs value={value} onValueChange={(next) => onValueChange(next as ReportStatus)} className="space-y-4">
        <TabsList className="h-auto flex-wrap gap-2 rounded-2xl bg-secondary/40 p-1">
            {statusOrder.map((status) => {
                const Icon = statusMeta[status].icon;

                return (
                    <TabsTrigger
                        key={status}
                        value={status}
                        className={`gap-2 rounded-xl border px-3 py-2 transition-colors ${statusToneClassNames[status].trigger}`}
                    >
                        <Icon className="h-4 w-4" />
                        {statusMeta[status].label}
                        <Badge className={`ml-1 h-5 min-w-5 px-1.5 ${statusToneClassNames[status].badge}`}>
                            {counts[status] || 0}
                        </Badge>
                    </TabsTrigger>
                );
            })}
        </TabsList>
    </Tabs>
);

const EmptyState = ({ label }: { label: string }) => (
    <div className="rounded-2xl border border-dashed border-border bg-card/30 p-12 text-center">
        <Flag className="mx-auto mb-4 h-12 w-12 text-muted-foreground/30" />
        <h3 className="text-lg font-semibold">Kayıt bulunamadı</h3>
        <p className="mt-2 text-sm text-muted-foreground">{label}</p>
    </div>
);

const AdminReports: React.FC = () => {
    const [mangaReports, setMangaReports] = useState<MangaReport[]>([]);
    const [commentReports, setCommentReports] = useState<CommentReport[]>([]);
    const [profileReports, setProfileReports] = useState<ProfileReport[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isLoadingProfileReports, setIsLoadingProfileReports] = useState(false);
    const [hasLoadedProfileReports, setHasLoadedProfileReports] = useState(false);
    const [activeTab, setActiveTab] = useState<'manga' | 'comments' | 'profiles'>('manga');
    const [mangaStatusTab, setMangaStatusTab] = useState<ReportStatus>('open');
    const [commentStatusTab, setCommentStatusTab] = useState<ReportStatus>('open');
    const [profileStatusTab, setProfileStatusTab] = useState<ReportStatus>('open');
    const [updatingId, setUpdatingId] = useState<string | null>(null);

    const loadReports = async () => {
        setIsLoading(true);
        try {
            const [mangaData, commentData] = await Promise.all([
                getMangaReports(),
                getCommentReports(),
            ]);
            setMangaReports(mangaData);
            setCommentReports(commentData);
        } catch (error) {
            console.error('Admin reports load error:', error);
            toast.error('Raporlar yüklenemedi');
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        void loadReports();
    }, []);

    useEffect(() => {
        if (activeTab !== 'profiles' || hasLoadedProfileReports || isLoadingProfileReports) {
            return;
        }

        let isCancelled = false;

        const loadProfileReports = async () => {
            try {
                setIsLoadingProfileReports(true);
                const data = await getProfileReports();

                if (isCancelled) {
                    return;
                }

                setProfileReports(data);
                setHasLoadedProfileReports(true);
            } catch (error) {
                if (isCancelled) {
                    return;
                }

                console.error('Admin profile reports load error:', error);
                toast.error('Profil bildirimleri yüklenemedi');
            } finally {
                if (!isCancelled) {
                    setIsLoadingProfileReports(false);
                }
            }
        };

        void loadProfileReports();

        return () => {
            isCancelled = true;
        };
    }, [activeTab, hasLoadedProfileReports, isLoadingProfileReports]);

    const mangaCounts = useMemo(() => (
        statusOrder.reduce((acc, status) => {
            acc[status] = mangaReports.filter((report) => report.status === status).length;
            return acc;
        }, {} as Record<ReportStatus, number>)
    ), [mangaReports]);

    const commentCounts = useMemo(() => (
        statusOrder.reduce((acc, status) => {
            acc[status] = commentReports.filter((report) => report.status === status).length;
            return acc;
        }, {} as Record<ReportStatus, number>)
    ), [commentReports]);

    const filteredMangaReports = useMemo(
        () => mangaReports.filter((report) => report.status === mangaStatusTab),
        [mangaReports, mangaStatusTab],
    );

    const filteredCommentReports = useMemo(
        () => commentReports.filter((report) => report.status === commentStatusTab),
        [commentReports, commentStatusTab],
    );

    const profileCounts = useMemo(() => (
        statusOrder.reduce((acc, status) => {
            acc[status] = profileReports.filter((report) => report.status === status).length;
            return acc;
        }, {} as Record<ReportStatus, number>)
    ), [profileReports]);

    const filteredProfileReports = useMemo(
        () => profileReports.filter((report) => report.status === profileStatusTab),
        [profileReports, profileStatusTab],
    );

    const handleMangaStatusChange = async (id: string, status: ReportStatus) => {
        try {
            setUpdatingId(id);
            await updateMangaReportStatus(id, status);
            setMangaReports((current) => current.map((report) => (
                report.id === id
                    ? { ...report, status, updatedAt: new Date().toISOString() }
                    : report
            )));
            toast.success('Seri bildirimi güncellendi');
        } catch (error) {
            console.error('Manga report status change error:', error);
            toast.error('Durum güncellenemedi');
        } finally {
            setUpdatingId(null);
        }
    };

    const handleCommentStatusChange = async (id: string, status: ReportStatus) => {
        try {
            setUpdatingId(id);
            await updateCommentReportStatus(id, status);
            setCommentReports((current) => current.map((report) => (
                report.id === id
                    ? { ...report, status, updatedAt: new Date().toISOString() }
                    : report
            )));
            toast.success('Yorum bildirimi güncellendi');
        } catch (error) {
            console.error('Comment report status change error:', error);
            toast.error('Durum güncellenemedi');
        } finally {
            setUpdatingId(null);
        }
    };

    const handleProfileStatusChange = async (id: string, status: ReportStatus) => {
        try {
            setUpdatingId(id);
            await updateProfileReportStatus(id, status);
            setProfileReports((current) => current.map((report) => (
                report.id === id
                    ? { ...report, status, updatedAt: new Date().toISOString() }
                    : report
            )));
            toast.success('Profil bildirimi güncellendi');
        } catch (error) {
            console.error('Profile report status change error:', error);
            toast.error('Durum güncellenemedi');
        } finally {
            setUpdatingId(null);
        }
    };

    return (
        <div className="space-y-6 lg:space-y-8">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div>
                    <h1 className="flex items-center gap-3 text-2xl font-bold sm:text-3xl">
                        <Flag className="h-8 w-8 text-primary" />
                        Bildirilenler
                    </h1>
                    <p className="text-muted-foreground">
                        Kullanıcıların bildirdiği seri ve yorum sorunlarını buradan yönetebilirsiniz.
                    </p>
                </div>

                <Badge variant="outline" className="w-fit px-3 py-1 text-sm">
                    {mangaReports.length + commentReports.length + profileReports.length} toplam rapor
                </Badge>
            </div>

            {isLoading ? (
                <div className="flex min-h-[320px] items-center justify-center rounded-2xl border border-border bg-card/40">
                    <div className="text-center">
                        <Loader2 className="mx-auto h-8 w-8 animate-spin text-primary" />
                        <p className="mt-3 text-sm text-muted-foreground">Raporlar yükleniyor...</p>
                    </div>
                </div>
            ) : (
                <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as 'manga' | 'comments' | 'profiles')} className="space-y-6">
                    <TabsList className="h-auto flex-wrap justify-start gap-2 rounded-2xl bg-secondary/40 p-1">
                        <TabsTrigger value="manga" className="gap-2">
                            <BookOpen className="h-4 w-4" />
                            Seri Bildirimleri
                            <Badge variant="secondary" className="ml-1 h-5 min-w-5 px-1.5">
                                {mangaReports.length}
                            </Badge>
                        </TabsTrigger>
                        <TabsTrigger value="comments" className="gap-2">
                            <MessageSquare className="h-4 w-4" />
                            Yorum Bildirimleri
                            <Badge variant="secondary" className="ml-1 h-5 min-w-5 px-1.5">
                                {commentReports.length}
                            </Badge>
                        </TabsTrigger>
                        <TabsTrigger value="profiles" className="gap-2">
                            <UserCircle2 className="h-4 w-4" />
                            Profil Bildirimleri
                            <Badge variant="secondary" className="ml-1 h-5 min-w-5 px-1.5">
                                {profileReports.length}
                            </Badge>
                        </TabsTrigger>
                    </TabsList>

                    <TabsContent value="manga" className="mt-0 space-y-6">
                        <StatusTabs counts={mangaCounts} value={mangaStatusTab} onValueChange={setMangaStatusTab} />

                        {filteredMangaReports.length === 0 ? (
                            <EmptyState label="Bu durum filtresinde seri bildirimi yok." />
                        ) : (
                            <div className="grid gap-4">
                                {filteredMangaReports.map((report) => {
                                    const StatusIcon = statusMeta[report.status].icon;

                                    return (
                                        <div key={report.id} className={`rounded-2xl border p-4 sm:p-6 ${statusToneClassNames[report.status].card}`}>
                                            <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                                                <div className="space-y-3">
                                                    <div className="flex flex-wrap items-center gap-2">
                                                        <h2 className="text-lg font-semibold">{report.mangaTitle}</h2>
                                                        <Badge className={`gap-1 ${statusToneClassNames[report.status].badge}`}>
                                                            <StatusIcon className="h-3.5 w-3.5" />
                                                            {statusMeta[report.status].label}
                                                        </Badge>
                                                    </div>

                                                    <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                                                        <span>bildiren: {report.reporterUsername || report.reporterId}</span>
                                                        <span>{formatDate(report.createdAt)}</span>
                                                        <span>güncellendi: {formatDate(report.updatedAt)}</span>
                                                    </div>

                                                    <div className="rounded-xl border border-border/60 bg-background/40 p-4">
                                                        <p className="text-sm font-medium">Neden</p>
                                                        <p className="mt-1 text-sm text-foreground/90">{report.reason}</p>
                                                        {report.details && (
                                                            <>
                                                                <p className="mt-4 text-sm font-medium">Detay</p>
                                                                <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{report.details}</p>
                                                            </>
                                                        )}
                                                    </div>
                                                </div>

                                                <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap xl:w-[360px] xl:justify-end">
                                                    {statusOrder.filter((status) => status !== report.status).map((status) => (
                                                        <Button
                                                            key={status}
                                                            variant="outline"
                                                            size="sm"
                                                            onClick={() => void handleMangaStatusChange(report.id, status)}
                                                            disabled={updatingId === report.id}
                                                        >
                                                            {updatingId === report.id ? 'Kaydediliyor...' : statusMeta[status].label}
                                                        </Button>
                                                    ))}
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </TabsContent>

                    <TabsContent value="comments" className="mt-0 space-y-6">
                        <StatusTabs counts={commentCounts} value={commentStatusTab} onValueChange={setCommentStatusTab} />

                        {filteredCommentReports.length === 0 ? (
                            <EmptyState label="Bu durum filtresinde yorum bildirimi yok." />
                        ) : (
                            <div className="grid gap-4">
                                {filteredCommentReports.map((report) => {
                                    const StatusIcon = statusMeta[report.status].icon;

                                    return (
                                        <div key={report.id} className={`rounded-2xl border p-4 sm:p-6 ${statusToneClassNames[report.status].card}`}>
                                            <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                                                <div className="space-y-3">
                                                    <div className="flex flex-wrap items-center gap-2">
                                                        <h2 className="text-lg font-semibold">{report.targetTitle || 'Bilinmeyen hedef'}</h2>
                                                        <Badge variant="outline">{commentEntityTypeLabels[report.commentEntityType] || report.commentEntityType}</Badge>
                                                        <Badge className={`gap-1 ${statusToneClassNames[report.status].badge}`}>
                                                            <StatusIcon className="h-3.5 w-3.5" />
                                                            {statusMeta[report.status].label}
                                                        </Badge>
                                                    </div>

                                                    <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                                                        <span>bildiren: {report.reporterUsername || report.reporterId}</span>
                                                        <span>yorum sahibi: {report.reportedUsername || report.reportedUserId}</span>
                                                        <span>{formatDate(report.createdAt)}</span>
                                                    </div>

                                                    <div className="rounded-xl border border-border/60 bg-background/40 p-4">
                                                        <p className="text-sm font-medium">Yorum</p>
                                                        <p className="mt-1 whitespace-pre-wrap text-sm text-foreground/90">
                                                            {report.commentPreview || 'Yorum bulunamadı veya silinmiş.'}
                                                        </p>
                                                        {report.commentCreatedAt && (
                                                            <p className="mt-2 text-xs text-muted-foreground">
                                                                yorum tarihi: {formatDate(report.commentCreatedAt)}
                                                            </p>
                                                        )}
                                                        <p className="mt-4 text-sm font-medium">Neden</p>
                                                        <p className="mt-1 text-sm text-foreground/90">{report.reason}</p>
                                                        {report.details && (
                                                            <>
                                                                <p className="mt-4 text-sm font-medium">Detay</p>
                                                                <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{report.details}</p>
                                                            </>
                                                        )}
                                                    </div>
                                                </div>

                                                <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap xl:w-[360px] xl:justify-end">
                                                    {statusOrder.filter((status) => status !== report.status).map((status) => (
                                                        <Button
                                                            key={status}
                                                            variant="outline"
                                                            size="sm"
                                                            onClick={() => void handleCommentStatusChange(report.id, status)}
                                                            disabled={updatingId === report.id}
                                                        >
                                                            {updatingId === report.id ? 'Kaydediliyor...' : statusMeta[status].label}
                                                        </Button>
                                                    ))}
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </TabsContent>

                    <TabsContent value="profiles" className="mt-0 space-y-6">
                        <StatusTabs counts={profileCounts} value={profileStatusTab} onValueChange={setProfileStatusTab} />

                        {filteredProfileReports.length === 0 ? (
                            <EmptyState label="Bu durum filtresinde profil bildirimi yok." />
                        ) : (
                            <div className="grid gap-4">
                                {filteredProfileReports.map((report) => {
                                    const StatusIcon = statusMeta[report.status].icon;

                                    return (
                                        <div key={report.id} className={`rounded-2xl border p-4 sm:p-6 ${statusToneClassNames[report.status].card}`}>
                                            <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                                                <div className="space-y-3">
                                                    <div className="flex flex-wrap items-center gap-2">
                                                        <h2 className="text-lg font-semibold">{report.reportedUsername || report.reportedUserId}</h2>
                                                        <Badge variant="outline">Profil</Badge>
                                                        <Badge className={`gap-1 ${statusToneClassNames[report.status].badge}`}>
                                                            <StatusIcon className="h-3.5 w-3.5" />
                                                            {statusMeta[report.status].label}
                                                        </Badge>
                                                    </div>

                                                    <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                                                        <span>bildiren: {report.reporterUsername || report.reporterId}</span>
                                                        <span>hedef: {report.reportedUsername || report.reportedUserId}</span>
                                                        <span>{formatDate(report.createdAt)}</span>
                                                        <span>güncellendi: {formatDate(report.updatedAt)}</span>
                                                    </div>

                                                    <div className="rounded-xl border border-border/60 bg-background/40 p-4">
                                                        <p className="text-sm font-medium">Neden</p>
                                                        <p className="mt-1 text-sm text-foreground/90">{report.reason}</p>
                                                        {report.details && (
                                                            <>
                                                                <p className="mt-4 text-sm font-medium">Detay</p>
                                                                <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{report.details}</p>
                                                            </>
                                                        )}
                                                    </div>
                                                </div>

                                                <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap xl:w-[360px] xl:justify-end">
                                                    {statusOrder.filter((status) => status !== report.status).map((status) => (
                                                        <Button
                                                            key={status}
                                                            variant="outline"
                                                            size="sm"
                                                            onClick={() => void handleProfileStatusChange(report.id, status)}
                                                            disabled={updatingId === report.id}
                                                        >
                                                            {updatingId === report.id ? 'Kaydediliyor...' : statusMeta[status].label}
                                                        </Button>
                                                    ))}
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </TabsContent>
                </Tabs>
            )}
        </div>
    );
};

export default AdminReports;
