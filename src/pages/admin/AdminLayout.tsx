import React, { useState, useEffect } from 'react';
import { useNavigate, Link, Outlet, useLocation } from 'react-router-dom';
import {
    LayoutDashboard,
    BookOpen,
    Users,
    MessageSquare,
    Settings,
    LogOut,
    Menu,
    X,
    Plus,
    UserCircle,
    Download,
    RefreshCw,
    Hash,
    Megaphone,
    Flag,
    LifeBuoy,
    Bot,
    Send,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { useAdminAccess } from '@/hooks/useAdminAccess';
import { toast } from 'sonner';

const AdminLayout: React.FC = () => {
    const navigate = useNavigate();
    const location = useLocation();
    const [sidebarOpen, setSidebarOpen] = useState(true);
    const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
    const { user, isLoading, logout } = useAuth();
    const { access, isLoading: accessLoading } = useAdminAccess({ requireOnlineValidation: true });
    const isAdmin = access.canAccessAdminPanel;
    const canUseScrapers = isAdmin && access.role === 'admin';

    useEffect(() => {
        if (!isLoading && !accessLoading && !isAdmin) {
            navigate('/admin/login');
        }
    }, [accessLoading, isAdmin, isLoading, navigate]);

    useEffect(() => {
        setMobileSidebarOpen(false);
    }, [location.pathname]);

    if (isLoading || accessLoading || !isAdmin || !user) {
        return null;
    }

    const handleLogout = async () => {
        await logout();
        toast.success('Çıkış yapıldı');
        navigate('/admin/login');
    };

    const menuItems = [
        { icon: LayoutDashboard, label: 'Dashboard', path: '/admin' },
        { icon: BookOpen, label: 'Mangalar', path: '/admin/mangas' },
        { icon: BookOpen, label: 'Yetişkin Mangalar', path: '/admin/adult-mangas' },
        { icon: Plus, label: 'Manga Ekle', path: '/admin/mangas/new' },
        ...(canUseScrapers ? [{ icon: Download, label: 'İçerik Çek', path: '/admin/scraper' }] : []),
        ...(canUseScrapers ? [{ icon: Download, label: 'Metadata Import', path: '/admin/metadata-import' }] : []),
        ...(canUseScrapers ? [{ icon: RefreshCw, label: 'Bölüm Çekme', path: '/admin/chapter-scraper' }] : []),
        ...(canUseScrapers ? [{ icon: Bot, label: 'Otomasyon', path: '/admin/automation' }] : []),
        { icon: MessageSquare, label: 'Yorumlar', path: '/admin/comments' },
        { icon: Users, label: 'Karakter & Sanatçı', path: '/admin/entities' },
        { icon: Hash, label: 'Etiketler', path: '/admin/tags' },
        { icon: UserCircle, label: 'Kullanıcılar', path: '/admin/user-management' },
        { icon: LifeBuoy, label: 'Destek Talepleri', path: '/admin/tickets' },
        { icon: Send, label: 'Seri İstekleri', path: '/admin/series-requests' },
        ...(access.isPrimaryAdmin ? [{ icon: Megaphone, label: 'Duyurular', path: '/admin/announcements' }] : []),
        { icon: Flag, label: 'Bildirilenler', path: '/admin/reports' },
        ...(access.isPrimaryAdmin ? [{ icon: Settings, label: 'Site Settings', path: '/admin/site-settings' }] : []),
        ...(access.isPrimaryAdmin ? [{ icon: Users, label: 'Adminler', path: '/admin/users' }] : []),
    ];

    const isActive = (path: string) => {
        if (path === '/admin') return location.pathname === '/admin';
        return location.pathname.startsWith(path);
    };

    const activeMenuLabel = menuItems.find((item) => isActive(item.path))?.label || 'Yönetim';

    return (
        <div className="min-h-screen bg-background">
            {mobileSidebarOpen && (
                <button
                    type="button"
                    className="fixed inset-0 z-30 bg-background/80 backdrop-blur-sm lg:hidden"
                    onClick={() => setMobileSidebarOpen(false)}
                    aria-label="Admin menüsünü kapat"
                />
            )}

            <aside
                className={`fixed left-0 top-0 z-40 h-screen border-r border-border bg-card transition-all duration-300 ${
                    mobileSidebarOpen ? 'translate-x-0' : '-translate-x-full'
                } w-72 lg:translate-x-0 ${sidebarOpen ? 'lg:w-64' : 'lg:w-20'}`}
            >
                <div className="flex h-full min-h-0 flex-col">
                    <div className="flex h-16 shrink-0 items-center justify-between border-b border-border px-4">
                        {(sidebarOpen || mobileSidebarOpen) && (
                            <Link to="/" className="flex items-center">
                                <img src="/logo.webp" alt="Logo" className="h-12 w-auto object-contain" decoding="async" />
                            </Link>
                        )}
                        <div className="flex items-center gap-2">
                            <Button
                                variant="ghost"
                                size="icon"
                                className="lg:hidden"
                                onClick={() => setMobileSidebarOpen(false)}
                            >
                                <X className="h-5 w-5" />
                            </Button>
                            <Button
                                variant="ghost"
                                size="icon"
                                className="hidden lg:inline-flex"
                                onClick={() => setSidebarOpen(!sidebarOpen)}
                            >
                                {sidebarOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
                            </Button>
                        </div>
                    </div>

                    <nav className="flex-1 overflow-y-auto px-4 py-4">
                        <div className="flex flex-col gap-1 pb-6">
                            {menuItems.map((item) => (
                                <Link
                                    key={item.path}
                                    to={item.path}
                                    className={`flex items-center gap-3 rounded-lg px-3 py-3 text-sm transition-colors ${isActive(item.path)
                                        ? 'bg-primary text-primary-foreground'
                                        : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
                                        }`}
                                >
                                    <item.icon className="h-5 w-5 shrink-0" />
                                    {(sidebarOpen || mobileSidebarOpen) && <span>{item.label}</span>}
                                </Link>
                            ))}
                        </div>
                    </nav>

                    <div className="shrink-0 border-t border-border p-4">
                        <div className={`flex items-center gap-3 ${sidebarOpen || mobileSidebarOpen ? '' : 'justify-center'}`}>
                            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
                                {user.username[0].toUpperCase()}
                            </div>
                            {(sidebarOpen || mobileSidebarOpen) && (
                                <div className="min-w-0 flex-1">
                                    <p className="truncate text-sm font-medium">{user.username}</p>
                                    <p className="text-xs text-muted-foreground">{access.role || user.role}</p>
                                </div>
                            )}
                            {(sidebarOpen || mobileSidebarOpen) && (
                                <Button variant="ghost" size="icon" onClick={() => void handleLogout()}>
                                    <LogOut className="h-5 w-5" />
                                </Button>
                            )}
                        </div>
                    </div>
                </div>
            </aside>

            {/* Main Content */}
            <main className={`min-h-screen transition-all duration-300 ${sidebarOpen ? 'lg:ml-64' : 'lg:ml-20'}`}>
                <div className="sticky top-0 z-20 border-b border-border/70 bg-background/95 px-4 py-3 backdrop-blur lg:hidden">
                    <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                            <p className="truncate text-sm font-semibold">Admin Paneli</p>
                            <p className="truncate text-xs text-muted-foreground">{activeMenuLabel}</p>
                        </div>
                        <Button variant="outline" size="icon" onClick={() => setMobileSidebarOpen(true)}>
                            <Menu className="h-5 w-5" />
                        </Button>
                    </div>
                </div>

                <div className="px-4 py-4 sm:px-6 lg:container lg:py-8">
                    <Outlet />
                </div>
            </main>
        </div>
    );
};

export default AdminLayout;
