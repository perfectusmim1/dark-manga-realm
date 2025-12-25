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
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { getAdminSession, removeAdminSession } from '@/lib/storage';
import { getStatistics } from '@/lib/database';
import { toast } from 'sonner';

const AdminLayout: React.FC = () => {
    const navigate = useNavigate();
    const location = useLocation();
    const [sidebarOpen, setSidebarOpen] = useState(true);
    const adminSession = getAdminSession();

    useEffect(() => {
        if (!adminSession) {
            navigate('/admin/login');
        }
    }, [adminSession, navigate]);

    if (!adminSession) {
        return null;
    }

    const handleLogout = () => {
        removeAdminSession();
        toast.success('Çıkış yapıldı');
        navigate('/admin/login');
    };

    const menuItems = [
        { icon: LayoutDashboard, label: 'Dashboard', path: '/admin' },
        { icon: BookOpen, label: 'Mangalar', path: '/admin/mangas' },
        { icon: Plus, label: 'Manga Ekle', path: '/admin/mangas/new' },
        { icon: Download, label: 'İçerik Çek', path: '/admin/scraper' },
        { icon: MessageSquare, label: 'Yorumlar', path: '/admin/comments' },
        { icon: UserCircle, label: 'Kullanıcılar', path: '/admin/user-management' },
        { icon: Users, label: 'Adminler', path: '/admin/users' },
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
                <div className="flex h-16 items-center justify-between border-b border-border px-4">
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

                <nav className="flex flex-col gap-1 p-4">
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
                </nav>

                <div className="absolute bottom-0 left-0 right-0 border-t border-border p-4">
                    <div className={`flex items-center gap-3 ${sidebarOpen ? '' : 'justify-center'}`}>
                        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
                            {adminSession.username[0].toUpperCase()}
                        </div>
                        {sidebarOpen && (
                            <div className="flex-1">
                                <p className="text-sm font-medium">{adminSession.username}</p>
                                <p className="text-xs text-muted-foreground">{adminSession.role}</p>
                            </div>
                        )}
                        {sidebarOpen && (
                            <Button variant="ghost" size="icon" onClick={handleLogout}>
                                <LogOut className="h-5 w-5" />
                            </Button>
                        )}
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
