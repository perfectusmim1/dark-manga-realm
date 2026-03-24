import React, { useEffect, useMemo, useState } from 'react';
import {
    BookOpen,
    CheckCircle2,
    Clock3,
    Flag,
    Loader2,
    MessageSquare,
    ShieldX,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
    CommentReport,
    getCommentReports,
    getMangaReports,
    MangaReport,
    ReportStatus,
    updateCommentReportStatus,
    updateMangaReportStatus,
} from '@/lib/database';
import { toast } from 'sonner';

const statusMeta: Record<ReportStatus, { label: string; icon: React.ComponentType<{ className?: string }> }> = {
    open: { label: 'Acik', icon: Flag },
    reviewed: { label: 'Inceleniyor', icon: Clock3 },
    resolved: { label: 'Cozuldu', icon: CheckCircle2 },
    dismissed: { label: 'Reddedildi', icon: ShieldX },
};

const statusOrder: ReportStatus[] = ['open', 'reviewed', 'resolved', 'dismissed'];

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
                    <TabsTrigger key={status} value={status} className="gap-2">
                        <Icon className="h-4 w-4" />
                        {statusMeta[status].label}
                        <Badge variant="secondary" className="ml-1 h-5 min-w-5 px-1.5">
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
        <h3 className="text-lg font-semibold">Kayit bulunamadi</h3>
        <p className="mt-2 text-sm text-muted-foreground">{label}</p>
    </div>
);

const AdminReports: React.FC = () => {
    const [mangaReports, setMangaReports] = useState<MangaReport[]>([]);
    const [commentReports, setCommentReports] = useState<CommentReport[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [activeTab, setActiveTab] = useState<'manga' | 'comments'>('manga');
    const [mangaStatusTab, setMangaStatusTab] = useState<ReportStatus>('open');
    const [commentStatusTab, setCommentStatusTab] = useState<ReportStatus>('open');
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
            toast.error('Raporlar yuklenemedi');
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        void loadReports();
    }, []);

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

    const handleMangaStatusChange = async (id: string, status: ReportStatus) => {
        try {
            setUpdatingId(id);
            await updateMangaReportStatus(id, status);
            setMangaReports((current) => current.map((report) => (
                report.id === id
                    ? { ...report, status, updatedAt: new Date().toISOString() }
                    : report
            )));
            toast.success('Seri bildirimi guncellendi');
        } catch (error) {
            console.error('Manga report status change error:', error);
            toast.error('Durum guncellenemedi');
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
            toast.success('Yorum bildirimi guncellendi');
        } catch (error) {
            console.error('Comment report status change error:', error);
            toast.error('Durum guncellenemedi');
        } finally {
            setUpdatingId(null);
        }
    };

    return (
        <div className="space-y-8">
            <div className="flex items-start justify-between gap-4">
                <div>
                    <h1 className="flex items-center gap-3 text-3xl font-bold">
                        <Flag className="h-8 w-8 text-primary" />
                        Bildirilenler
                    </h1>
                    <p className="text-muted-foreground">
                        Kullanicilarin bildirdigi seri ve yorum sorunlarini buradan yonetebilirsiniz.
                    </p>
                </div>

                <Badge variant="outline" className="px-3 py-1 text-sm">
                    {mangaReports.length + commentReports.length} toplam rapor
                </Badge>
            </div>

            {isLoading ? (
                <div className="flex min-h-[320px] items-center justify-center rounded-2xl border border-border bg-card/40">
                    <div className="text-center">
                        <Loader2 className="mx-auto h-8 w-8 animate-spin text-primary" />
                        <p className="mt-3 text-sm text-muted-foreground">Raporlar yukleniyor...</p>
                    </div>
                </div>
            ) : (
                <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as 'manga' | 'comments')} className="space-y-6">
                    <TabsList className="h-auto flex-wrap gap-2 rounded-2xl bg-secondary/40 p-1">
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
                                        <div key={report.id} className="rounded-2xl border border-border bg-card/50 p-6">
                                            <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                                                <div className="space-y-3">
                                                    <div className="flex flex-wrap items-center gap-2">
                                                        <h2 className="text-lg font-semibold">{report.mangaTitle}</h2>
                                                        <Badge variant="outline" className="gap-1">
                                                            <StatusIcon className="h-3.5 w-3.5" />
                                                            {statusMeta[report.status].label}
                                                        </Badge>
                                                    </div>

                                                    <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                                                        <span>bildiren: {report.reporterUsername || report.reporterId}</span>
                                                        <span>{formatDate(report.createdAt)}</span>
                                                        <span>guncellendi: {formatDate(report.updatedAt)}</span>
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

                                                <div className="flex flex-wrap gap-2 xl:w-[360px] xl:justify-end">
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
                                        <div key={report.id} className="rounded-2xl border border-border bg-card/50 p-6">
                                            <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                                                <div className="space-y-3">
                                                    <div className="flex flex-wrap items-center gap-2">
                                                        <h2 className="text-lg font-semibold">{report.targetTitle || 'Bilinmeyen hedef'}</h2>
                                                        <Badge variant="outline">{report.commentEntityType}</Badge>
                                                        <Badge variant="outline" className="gap-1">
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
                                                            {report.commentPreview || 'Yorum bulunamadi veya silinmis.'}
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

                                                <div className="flex flex-wrap gap-2 xl:w-[360px] xl:justify-end">
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
                </Tabs>
            )}
        </div>
    );
};

export default AdminReports;
