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
    ChevronRight,
    Plus,
    BarChart3,
    UserCircle,
    Download,
    RefreshCw,
    Hash,
    Megaphone,
    Flag,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

const AdminLayout: React.FC = () => {
    const navigate = useNavigate();
    const location = useLocation();
    const [sidebarOpen, setSidebarOpen] = useState(true);
    const { user, isLoading, logout } = useAuth();
    const isAdmin = user?.role === 'admin' || user?.role === 'moderator';

    useEffect(() => {
        if (!isLoading && !isAdmin) {
            navigate('/admin/login');
        }
    }, [isAdmin, isLoading, navigate]);

    if (isLoading || !isAdmin || !user) {
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
        { icon: Plus, label: 'Manga Ekle', path: '/admin/mangas/new' },
        { icon: Download, label: 'İçerik Çek', path: '/admin/scraper' },
        { icon: RefreshCw, label: 'Bölüm Çekme', path: '/admin/chapter-scraper' },
        { icon: MessageSquare, label: 'Yorumlar', path: '/admin/comments' },
        { icon: Users, label: 'Karakter & Sanatçı', path: '/admin/entities' },
        { icon: Hash, label: 'Etiketler', path: '/admin/tags' },
        { icon: UserCircle, label: 'Kullanıcılar', path: '/admin/user-management' },
        { icon: Megaphone, label: 'Duyurular', path: '/admin/announcements' },
        { icon: Flag, label: 'Bildirilenler', path: '/admin/reports' },
        ...(user?.role === 'admin' ? [{ icon: Users, label: 'Adminler', path: '/admin/users' }] : []),
    ];

    const isActive = (path: string) => {
        if (path === '/admin') return location.pathname === '/admin';
        return location.pathname.startsWith(path);
    };

    return (
        <div className="flex min-h-screen bg-background">
            {/* Sidebar */}
            <aside
                className={`fixed left-0 top-0 z-40 h-screen bg-card border-r border-border transition-all duration-300 ${sidebarOpen ? 'w-64' : 'w-20'
                    }`}
            >
                <div className="flex h-full min-h-0 flex-col">
                    <div className="flex h-16 shrink-0 items-center justify-between border-b border-border px-4">
                        {sidebarOpen && (
                            <Link to="/" className="flex items-center">
                                <img src="/logo.png" alt="Logo" className="h-12 w-auto object-contain" />
                            </Link>
                        )}
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setSidebarOpen(!sidebarOpen)}
                        >
                            {sidebarOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
                        </Button>
                    </div>

                    <nav className="flex-1 overflow-y-auto px-4 py-4">
                        <div className="flex flex-col gap-1 pb-6">
                            {menuItems.map((item) => (
                                <Link
                                    key={item.path}
                                    to={item.path}
                                    className={`flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors ${isActive(item.path)
                                        ? 'bg-primary text-primary-foreground'
                                        : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
                                        }`}
                                >
                                    <item.icon className="h-5 w-5 shrink-0" />
                                    {sidebarOpen && <span>{item.label}</span>}
                                </Link>
                            ))}
                        </div>
                    </nav>

                    <div className="shrink-0 border-t border-border p-4">
                        <div className={`flex items-center gap-3 ${sidebarOpen ? '' : 'justify-center'}`}>
                            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
                                {user.username[0].toUpperCase()}
                            </div>
                            {sidebarOpen && (
                                <div className="min-w-0 flex-1">
                                    <p className="truncate text-sm font-medium">{user.username}</p>
                                    <p className="text-xs text-muted-foreground">{user.role}</p>
                                </div>
                            )}
                            {sidebarOpen && (
                                <Button variant="ghost" size="icon" onClick={() => void handleLogout()}>
                                    <LogOut className="h-5 w-5" />
                                </Button>
                            )}
                        </div>
                    </div>
                </div>
            </aside>

            {/* Main Content */}
            <main className={`flex-1 transition-all duration-300 ${sidebarOpen ? 'ml-64' : 'ml-20'}`}>
                <div className="container py-8">
                    <Outlet />
                </div>
            </main>
        </div>
    );
};

export default AdminLayout;
