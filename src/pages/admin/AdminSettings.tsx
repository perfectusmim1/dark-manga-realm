import React from 'react';
import { Settings, Database, Shield, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { initializeMockData } from '@/lib/mockData';
import { getAllMangas } from '@/lib/database';

const AdminSettings: React.FC = () => {
    const handleResetDatabase = () => {
        if (confirm('Tüm manga verilerini, yorumları ve görüntülenmeleri silmek istediğinize emin misiniz? (Admin kullanıcıları silinmez)')) {
            const adminUsers = localStorage.getItem('db_admin_users');
            const adminSession = localStorage.getItem('manga_admin_session');

            localStorage.clear();

            // Restore admin data
            if (adminUsers) localStorage.setItem('db_admin_users', adminUsers);
            if (adminSession) localStorage.setItem('manga_admin_session', adminSession);

            initializeMockData();
            toast.success('Veritabanı temizlendi');
            window.location.reload();
        }
    };

    const handleClearUserSpecificData = () => {
        if (confirm('Tüm kullanıcıların okuma geçmişini, yer imlerini ve favorilerini silmek istediğinize emin misiniz?')) {
            const keysToRemove = [
                'manga_favorites',
                'manga_reading_progress',
                'manga_bookmarks',
                'manga_notifications'
            ];
            keysToRemove.forEach(key => localStorage.removeItem(key));
            toast.success('Kullanıcı verileri temizlendi');
        }
    };

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-3xl font-bold">Ayarlar</h1>
                <p className="text-muted-foreground">Site ayarlarını yönetin</p>
            </div>

            <div className="grid gap-6">
                {/* Database Settings */}
                <div className="rounded-xl border border-border bg-card p-6">
                    <div className="flex items-center gap-3 mb-4">
                        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-500/10">
                            <Database className="h-5 w-5 text-blue-500" />
                        </div>
                        <div>
                            <h2 className="text-lg font-semibold">Veritabanı</h2>
                            <p className="text-sm text-muted-foreground">Verisiz başlangıç ve temizlik</p>
                        </div>
                    </div>

                    <div className="space-y-4">
                        <div className="flex items-center justify-between rounded-lg border border-destructive/30 p-4">
                            <div>
                                <p className="font-medium text-destructive">Tüm Mangaları Sil</p>
                                <p className="text-sm text-muted-foreground">
                                    Veritabanındaki tüm mangaları, bölümleri ve yorumları temizler.
                                </p>
                            </div>
                            <Button variant="destructive" onClick={handleResetDatabase}>
                                <Trash2 className="mr-2 h-4 w-4" />
                                Mangaları Temizle
                            </Button>
                        </div>

                        <div className="flex items-center justify-between rounded-lg border border-orange-500/30 p-4">
                            <div>
                                <p className="font-medium text-orange-500">Kullanıcı Verilerini Temizle</p>
                                <p className="text-sm text-muted-foreground">
                                    Tüm kullanıcıların favorilerini, geçmişlerini ve yer imlerini siler.
                                </p>
                            </div>
                            <Button variant="secondary" onClick={handleClearUserSpecificData}>
                                <Trash2 className="mr-2 h-4 w-4 text-orange-500" />
                                Kullanıcı Verilerini Sil
                            </Button>
                        </div>
                    </div>
                </div>

                {/* Info Card */}
                <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 p-6">
                    <p className="text-sm text-blue-400">
                        <strong>Not:</strong> Gerçek veri kullanmaya başladığınızda bu panelden sahte mangaları temizleyebilirsiniz.
                        Şu anki sistemde tüm veriler tarayıcınızın LocalStorage'ında saklanmaktadır.
                    </p>
                </div>
            </div>
        </div>
    );
};

export default AdminSettings;
