import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Eye, EyeOff, Mail, Lock, User } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

const Auth: React.FC = () => {
  const [isLogin, setIsLogin] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [formData, setFormData] = useState({
    username: '',
    email: '',
    password: '',
  });

  const { login, register } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      if (isLogin) {
        const success = await login(formData.email, formData.password);
        if (success) {
          toast.success('Giriş başarılı!');
          navigate('/');
        } else {
          toast.error('Geçersiz e-posta veya şifre');
        }
      } else {
        if (formData.password.length < 6) {
          toast.error('Şifre en az 6 karakter olmalıdır');
          setIsLoading(false);
          return;
        }
        const success = await register(formData.username, formData.email, formData.password);
        if (success) {
          toast.success('Kayıt başarılı!');
          navigate('/');
        } else {
          toast.error('Kayıt sırasında bir hata oluştu');
        }
      }
    } catch (error) {
      toast.error('Bir hata oluştu');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      {/* Background Effects */}
      <div className="fixed inset-0 overflow-hidden">
        <div className="absolute -left-1/4 top-0 h-96 w-96 rounded-full bg-primary/10 blur-3xl" />
        <div className="absolute -right-1/4 bottom-0 h-96 w-96 rounded-full bg-[#2994FF]/10 blur-3xl" />
      </div>

      <div className="relative z-10 w-full max-w-md animate-scale-in">
        {/* Logo */}
        <Link to="/" className="mb-8 flex justify-center">
          <span className="bg-gradient-to-r from-primary to-[#2994FF] bg-clip-text text-3xl font-bold text-transparent">
            MangaVerse
          </span>
        </Link>

        {/* Card */}
        <div className="rounded-2xl border border-border bg-card/50 p-8 shadow-xl backdrop-blur-xl">
          <h1 className="text-center text-2xl font-bold">
            {isLogin ? 'Hoş Geldiniz' : 'Hesap Oluştur'}
          </h1>
          <p className="mt-2 text-center text-sm text-muted-foreground">
            {isLogin
              ? 'Hesabınıza giriş yapın'
              : 'Hemen ücretsiz hesap oluşturun'}
          </p>

          <form onSubmit={handleSubmit} className="mt-8 space-y-4">
            {!isLogin && (
              <div className="space-y-2">
                <Label htmlFor="username">Kullanıcı Adı</Label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="username"
                    type="text"
                    placeholder="kullanici_adi"
                    value={formData.username}
                    onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                    className="pl-10"
                    required={!isLogin}
                  />
                </div>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="email">E-posta</Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="email"
                  type="email"
                  placeholder="ornek@email.com"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  className="pl-10"
                  required
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">Şifre</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  placeholder="••••••••"
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
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

            <Button type="submit" variant="glow" className="w-full" size="lg" disabled={isLoading}>
              {isLoading ? 'Yükleniyor...' : isLogin ? 'Giriş Yap' : 'Kayıt Ol'}
            </Button>
          </form>

          <div className="mt-6 text-center text-sm">
            <span className="text-muted-foreground">
              {isLogin ? 'Hesabınız yok mu? ' : 'Zaten hesabınız var mı? '}
            </span>
            <button
              onClick={() => setIsLogin(!isLogin)}
              className="font-medium text-primary hover:underline"
            >
              {isLogin ? 'Kayıt Ol' : 'Giriş Yap'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Auth;
