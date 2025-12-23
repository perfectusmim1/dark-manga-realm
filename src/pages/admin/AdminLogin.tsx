import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Lock, Mail, Eye, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { authenticateAdmin } from '@/lib/database';
import { setAdminSession } from '../../lib/storage';
import { toast } from 'sonner';

const AdminLogin: React.FC = () => {
    const navigate = useNavigate();
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);

        const admin = await authenticateAdmin(email, password);

        if (admin) {
            setAdminSession({
                adminId: admin.id,
                username: admin.username,
                role: admin.role,
            });
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
