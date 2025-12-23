import React from 'react';
import { Settings, Database, Shield } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { initializeMockData } from '@/lib/mockData';
import { getAllMangas } from '@/lib/database';

const AdminSettings: React.FC = () => {
    const handleResetData = () => {
        localStorage.clear();
        initializeMockData();
        toast.success('Veriler sıfırlandı ve mock data yüklendi');
        window.location.reload();
    };

    const handleLoadMockData = () => {
        const currentMangas = getAllMangas();
        if (currentMangas.length > 0) {
            toast.error('Zaten manga mevcut. Önce verileri sıfırlayın.');
            return;
        }
        initializeMockData();
        toast.success('Mock data yüklendi');
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
                            <p className="text-sm text-muted-foreground">Veritabanı işlemleri</p>
                        </div>
                    </div>

                    <div className="space-y-4">
                        <div className="flex items-center justify-between rounded-lg border border-border p-4">
                            <div>
                                <p className="font-medium">Mock Data Yükle</p>
                                <p className="text-sm text-muted-foreground">
                                    Örnek manga verileri yükler (veritabanı boşsa)
                                </p>
                            </div>
                            <Button variant="outline" onClick={handleLoadMockData}>
                                Yükle
                            </Button>
                        </div>

                        <div className="flex items-center justify-between rounded-lg border border-destructive/50 p-4">
                            <div>
                                <p className="font-medium text-destructive">Tüm Verileri Sıfırla</p>
                                <p className="text-sm text-muted-foreground">
                                    Tüm verileri siler ve mock data yükler
                                </p>
                            </div>
                            <Button variant="destructive" onClick={handleResetData}>
                                Sıfırla
                            </Button>
                        </div>
                    </div>
                </div>

                {/* Site Settings */}
                <div className="rounded-xl border border-border bg-card p-6">
                    <div className="flex items-center gap-3 mb-4">
                        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-500/10">
                            <Settings className="h-5 w-5 text-green-500" />
                        </div>
                        <div>
                            <h2 className="text-lg font-semibold">Site Ayarları</h2>
                            <p className="text-sm text-muted-foreground">Genel site yapılandırması</p>
                        </div>
                    </div>

                    <div className="rounded-lg border border-border p-4 text-center text-muted-foreground">
                        <p>Site ayarları yakında eklenecek</p>
                    </div>
                </div>

                {/* Security Settings */}
                <div className="rounded-xl border border-border bg-card p-6">
                    <div className="flex items-center gap-3 mb-4">
                        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-purple-500/10">
                            <Shield className="h-5 w-5 text-purple-500" />
                        </div>
                        <div>
                            <h2 className="text-lg font-semibold">Güvenlik</h2>
                            <p className="text-sm text-muted-foreground">Güvenlik ayarları</p>
                        </div>
                    </div>

                    <div className="rounded-lg border border-border p-4 text-center text-muted-foreground">
                        <p>Güvenlik ayarları yakında eklenecek</p>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default AdminSettings;
