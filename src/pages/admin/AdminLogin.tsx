import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Lock, Mail, Eye, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { authenticateAdmin } from '@/lib/database';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { useAdminAccess } from '@/hooks/useAdminAccess';

const AdminLogin: React.FC = () => {
    const { user, loginWithGoogle } = useAuth();
    const { access, isLoading: accessLoading } = useAdminAccess();
    const navigate = useNavigate();
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [loading, setLoading] = useState(false);

    React.useEffect(() => {
        if (!accessLoading && user && access.canAccessAdminPanel) {
            navigate('/admin');
        }
    }, [access.canAccessAdminPanel, accessLoading, user, navigate, loginWithGoogle]);

    const handleGoogleLogin = async () => {
        setLoading(true);
        try {
            await loginWithGoogle(`${window.location.origin}/admin/login`);
        } catch (error) {
            toast.error('Google ile giriş yapılamadı');
            setLoading(false);
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);

        const admin = await authenticateAdmin(email, password);

        if (admin) {
            toast.success('Giriş başarılı!');
            navigate('/admin');
        } else {
            toast.error('E-posta veya şifre hatalı');
        }

        setLoading(false);
    };

    return (
        <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-background via-background to-primary/5">
            <div className="w-full max-w-md animate-fade-up">
                <div className="rounded-2xl border border-border bg-card/50 p-8 shadow-xl backdrop-blur-sm">
                    <div className="mb-8 text-center">
                        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
                            <Lock className="h-8 w-8 text-primary" />
                        </div>
                        <h1 className="text-2xl font-bold">Admin Girişi</h1>
                        <p className="mt-2 text-sm text-muted-foreground">
                            Yönetim paneline erişmek için giriş yapın
                        </p>
                    </div>

                    <form onSubmit={handleSubmit} className="space-y-4">
                        <div className="space-y-2">
                            <label className="text-sm font-medium">E-posta</label>
                            <div className="relative">
                                <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                                <Input
                                    type="email"
                                    placeholder="admin@mangaverse.com"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    className="pl-10"
                                    required
                                />
                            </div>
                        </div>

                        <div className="space-y-2">
                            <label className="text-sm font-medium">Şifre</label>
                            <div className="relative">
                                <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                                <Input
                                    type={showPassword ? 'text' : 'password'}
                                    placeholder="••••••••"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    className="pl-10 pr-10"
                                    required
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowPassword(!showPassword)}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                                >
                                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                </button>
                            </div>
                        </div>

                        <Button type="submit" className="w-full" disabled={loading}>
                            {loading ? 'Giriş yapılıyor...' : 'Giriş Yap'}
                        </Button>
                    </form>

                    <div className="relative my-6">
                        <div className="absolute inset-0 flex items-center">
                            <span className="w-full border-t border-border" />
                        </div>
                        <div className="relative flex justify-center text-xs uppercase">
                            <span className="bg-card px-2 text-muted-foreground">veya</span>
                        </div>
                    </div>

                    <Button
                        variant="outline"
                        type="button"
                        className="w-full h-11 rounded-xl gap-3"
                        disabled={loading}
                        onClick={handleGoogleLogin}
                    >
                        <svg className="h-5 w-5" viewBox="0 0 24 24">
                            <path
                                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                                fill="#4285F4"
                            />
                            <path
                                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                                fill="#34A853"
                            />
                            <path
                                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                                fill="#FBBC05"
                            />
                            <path
                                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                                fill="#EA4335"
                            />
                        </svg>
                        Google ile Yönetici Girişi
                    </Button>

                    <div className="mt-6 text-center">
                        <a href="/" className="text-sm text-muted-foreground hover:text-primary">
                            ← Ana Sayfaya Dön
                        </a>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default AdminLogin;
