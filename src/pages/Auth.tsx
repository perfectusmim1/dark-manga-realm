import React, { useState, useEffect } from 'react';
import { useNavigate, Link, useSearchParams } from 'react-router-dom';
import { Eye, EyeOff, Mail, Lock, User, AtSign, ArrowLeft, ShieldCheck, KeyRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { User as UserType } from '@/lib/types'; // Renamed to avoid conflict with lucide-react User icon

type AuthView = 'login' | 'register' | 'forgot-password' | 'verify-otp' | 'reset-password';

const Auth: React.FC = () => {
  const [searchParams] = useSearchParams();
  const [view, setView] = useState<AuthView>('login');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [is2FAProcessing, setIs2FAProcessing] = useState(false); // Added state
  const [otpEmail, setOtpEmail] = useState('');
  const [otpType, setOtpType] = useState<'signup' | 'recovery' | 'email'>('signup');

  const [formData, setFormData] = useState({
    username: '',
    email: '',
    emailOrUsername: '',
    password: '',
    otpToken: '',
    newPassword: '',
  });

  const { user, login, register, resetPassword, verifyOtp, updatePassword, loginWithGoogle } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    // If user is already logged in (e.g. after Google OAuth return), redirect to home
    // BUT only if we are not in the middle of a 2FA flow
    if (user && !is2FAProcessing && view !== 'verify-otp') {
      navigate('/');
    }
  }, [user, navigate, is2FAProcessing, view]);

  useEffect(() => {
    const type = searchParams.get('type');
    if (type === 'recovery') {
      setView('reset-password');
    }
  }, [searchParams]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      // 1. First, resolve the actual email if username was provided
      let loginEmail = formData.emailOrUsername;
      let twoFactorEnabled = false;

      if (!loginEmail.includes('@')) {
        const { data: userData } = await supabase
          .from('users')
          .select('email, two_factor_enabled')
          .eq('username', loginEmail)
          .maybeSingle();

        if (userData) {
          loginEmail = userData.email;
          twoFactorEnabled = userData.two_factor_enabled;
        } else {
          toast.error('Kullanıcı bulunamadı');
          setIsLoading(false);
          return;
        }
      } else {
        const { data: userData } = await supabase
          .from('users')
          .select('two_factor_enabled')
          .eq('email', loginEmail)
          .maybeSingle();

        if (userData) {
          twoFactorEnabled = userData.two_factor_enabled;
        }
      }

      // 2. Perform regular login
      const result = await login(loginEmail, formData.password);

      if (result.success) {
        if (twoFactorEnabled) {
          // Flag that we are handling 2FA to prevent early redirect
          setIs2FAProcessing(true);

          // Sign out current session and request OTP for 2FA
          await supabase.auth.signOut();
          setOtpEmail(loginEmail);
          setOtpType('email');

          const { error: otpError } = await supabase.auth.signInWithOtp({
            email: loginEmail,
            options: { shouldCreateUser: false }
          });

          if (otpError) {
            setIs2FAProcessing(false);
            throw otpError;
          }

          setView('verify-otp');
          toast.info('2FA: Giriş yapmak için e-postanıza gönderilen doğrulama kodunu girin.');
        } else {
          toast.success('Giriş başarılı!');
          navigate('/');
        }
      } else {
        toast.error(result.error || 'Giriş başarısız');
      }
    } catch (error: any) {
      toast.error(error.message || 'Bir hata oluştu');
    } finally {
      setIsLoading(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (formData.password.length < 6) {
      toast.error('Şifre en az 6 karakter olmalıdır');
      return;
    }

    setIsLoading(true);
    try {
      const result = await register(formData.username, formData.email, formData.password);
      if (result.success) {
        // If Supabase sends confirmation email, user is not logged in yet
        setView('verify-otp');
        setOtpEmail(formData.email);
        setOtpType('signup');
        toast.success('Kayıt başarılı! E-postanıza gelen doğrulama kodunu girin.');
      } else {
        toast.error(result.error || 'Kayıt başarısız');
      }
    } catch (error) {
      toast.error('Bir hata oluştu');
    } finally {
      setIsLoading(false);
    }
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      // We'll use the generic resetPassword which sends a link. 
      // If the user wants OTP, they should check if they can verify with OTP.
      const result = await resetPassword(formData.email);
      if (result.success) {
        toast.success('Şifre sıfırlama bağlantısı e-postanıza gönderildi.');
        setOtpEmail(formData.email);
        setOtpType('recovery');
        setView('verify-otp'); // Let's allow them to enter a code if they got one instead of a link
      } else {
        toast.error(result.error || 'İşlem başarısız');
      }
    } catch (error) {
      toast.error('Giriş başarısız');
    } finally {
      setIsLoading(false);
    }
  };

  const handleOtpVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    const result = await verifyOtp(otpEmail, formData.otpToken, otpType);
    if (result.success) {
      toast.success('Doğrulama başarılı!');
      if (otpType === 'recovery') {
        setView('reset-password');
      } else {
        navigate('/');
      }
    } else {
      toast.error(result.error || 'Kod hatalı veya süresi dolmuş');
    }
    setIsLoading(false);
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    const result = await updatePassword(formData.newPassword);
    if (result.success) {
      toast.success('Şifreniz başarıyla güncellendi!');
      navigate('/');
    } else {
      toast.error(result.error || 'Şifre güncellenemedi');
    }
    setIsLoading(false);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4 relative overflow-hidden">
      {/* Background Effects */}
      <div className="absolute -left-1/4 top-0 h-96 w-96 rounded-full bg-primary/10 blur-[100px]" />
      <div className="absolute -right-1/4 bottom-0 h-96 w-96 rounded-full bg-primary/10 blur-[100px]" />

      <div className="relative z-10 w-full max-w-md animate-fade-up">
        {/* Logo */}
        <Link to="/" className="mb-8 flex justify-center">
          <img src="/logo.png" alt="Logo" className="h-16 w-auto object-contain hover:scale-105 transition-transform" />
        </Link>

        {/* Card */}
        <div className="rounded-2xl border border-white/10 bg-black/40 p-8 shadow-2xl backdrop-blur-2xl ring-1 ring-white/20">

          {view !== 'login' && view !== 'register' && (
            <button
              onClick={() => setView('login')}
              className="mb-4 flex items-center gap-2 text-sm text-muted-foreground hover:text-primary transition-colors"
            >
              <ArrowLeft className="h-4 w-4" /> Geri Dön
            </button>
          )}

          <h1 className="text-2xl font-bold tracking-tight text-center">
            {view === 'login' && 'Hoş Geldiniz'}
            {view === 'register' && 'Hesap Oluştur'}
            {view === 'forgot-password' && 'Şifremi Unuttum'}
            {view === 'verify-otp' && 'Doğrulama Gerekli'}
            {view === 'reset-password' && 'Yeni Şifre Belirle'}
          </h1>

          <p className="mt-2 text-center text-sm text-muted-foreground mb-8">
            {view === 'login' && 'Sizleri tekrar görmek çok güzel'}
            {view === 'register' && 'Topluluğumuza katılın'}
            {view === 'forgot-password' && 'E-posta adresinize kod gönderilecektir'}
            {view === 'verify-otp' && `${otpEmail} adresine gönderilen kodu girin.`}
            {view === 'reset-password' && 'Hesabınız için yeni ve güvenli bir şifre girin'}
          </p>

          <form
            onSubmit={
              view === 'login' ? handleLogin :
                view === 'register' ? handleRegister :
                  view === 'forgot-password' ? handleForgotPassword :
                    view === 'verify-otp' ? handleOtpVerify :
                      handleResetPassword
            }
            className="space-y-4"
          >
            {view === 'register' && (
              <div className="space-y-2">
                <Label className="text-xs font-bold uppercase tracking-wider opacity-60">Kullanıcı Adı</Label>
                <div className="relative group">
                  <User className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground group-focus-within:text-primary transition-colors" />
                  <Input
                    placeholder="kullanici_adi"
                    value={formData.username}
                    onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                    className="pl-10 bg-white/5 border-white/10 focus:border-primary/50 transition-all"
                    required
                  />
                </div>
              </div>
            )}

            {(view === 'login' || view === 'register' || view === 'forgot-password') && (
              <div className="space-y-2">
                <Label className="text-xs font-bold uppercase tracking-wider opacity-60">
                  {view === 'login' ? 'E-posta veya Kullanıcı Adı' : 'E-posta'}
                </Label>
                <div className="relative group">
                  <AtSign className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground group-focus-within:text-primary transition-colors" />
                  <Input
                    type={view === 'login' ? 'text' : 'email'}
                    placeholder={view === 'login' ? "E-posta veya kullanıcı adı" : "ornek@email.com"}
                    value={view === 'login' ? formData.emailOrUsername : formData.email}
                    onChange={(e) => setFormData({
                      ...formData,
                      [view === 'login' ? 'emailOrUsername' : 'email']: e.target.value
                    })}
                    className="pl-10 bg-white/5 border-white/10 focus:border-primary/50 transition-all"
                    required
                  />
                </div>
              </div>
            )}

            {(view === 'login' || view === 'register') && (
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <Label className="text-xs font-bold uppercase tracking-wider opacity-60">Şifre</Label>
                  {view === 'login' && (
                    <button
                      type="button"
                      onClick={() => setView('forgot-password')}
                      className="text-[11px] text-primary hover:underline font-medium"
                    >
                      Şifremi Unuttum?
                    </button>
                  )}
                </div>
                <div className="relative group">
                  <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground group-focus-within:text-primary transition-colors" />
                  <Input
                    type={showPassword ? 'text' : 'password'}
                    placeholder="••••••••"
                    value={formData.password}
                    onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                    className="pl-10 pr-10 bg-white/5 border-white/10 focus:border-primary/50 transition-all"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-1 transition-colors"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
            )}

            {view === 'verify-otp' && (
              <div className="text-center py-8 space-y-6">
                <div className="mx-auto w-20 h-20 bg-primary/10 rounded-full flex items-center justify-center mb-4">
                  <Mail className="h-10 w-10 text-primary animate-pulse" />
                </div>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <h3 className="text-xl font-bold">Bağlantıyı Kontrol Edin</h3>
                    <p className="text-sm text-muted-foreground leading-relaxed">
                      Güvenliğiniz için <span className="font-medium text-white">{otpEmail}</span> adresine bir <b>tek kullanımlık giriş bağlantısı</b> gönderdik.
                    </p>
                  </div>

                  <div className="bg-white/5 border border-white/10 rounded-xl p-4 text-xs text-muted-foreground leading-relaxed italic">
                    "E-postanızdaki bağlantıya tıkladığınızda bu sekme otomatik olarak güncellenecektir."
                  </div>

                  <div className="flex flex-col gap-3 pt-4">
                    <Button
                      variant="ghost"
                      type="button"
                      className="text-xs text-primary hover:text-primary/80 hover:bg-primary/5"
                      onClick={async () => {
                        setIsLoading(true);
                        const { error } = await supabase.auth.signInWithOtp({
                          email: otpEmail,
                          options: { shouldCreateUser: false }
                        });
                        setIsLoading(false);
                        if (error) toast.error('Hata: ' + error.message);
                        else toast.success('Yeni bağlantı gönderildi!');
                      }}
                      disabled={isLoading}
                    >
                      <ArrowLeft className="h-3 w-3 mr-2 rotate-180" /> Bağlantıyı Tekrar Gönder
                    </Button>
                  </div>
                </div>

                <div className="pt-6 border-t border-white/5 text-center">
                  <button
                    type="button"
                    onClick={() => {
                      setIs2FAProcessing(false);
                      setView('login');
                    }}
                    className="text-xs text-muted-foreground hover:text-white transition-colors"
                  >
                    Geri dön ve başka bir hesapla dene
                  </button>
                </div>
              </div>
            )}

            {view === 'reset-password' && (
              <div className="space-y-2">
                <Label className="text-xs font-bold uppercase tracking-wider opacity-60">Yeni Şifre</Label>
                <div className="relative group">
                  <KeyRound className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground group-focus-within:text-primary transition-colors" />
                  <Input
                    type={showPassword ? 'text' : 'password'}
                    placeholder="Yeni şifreniz"
                    value={formData.newPassword}
                    onChange={(e) => setFormData({ ...formData, newPassword: e.target.value })}
                    className="pl-10 pr-10 bg-white/5 border-white/10"
                    required
                  />
                </div>
              </div>
            )}

            <Button type="submit" variant="glow" className="w-full h-11 rounded-xl shadow-lg shadow-primary/20 mt-4" disabled={isLoading}>
              {isLoading ? (
                <div className="flex items-center gap-2">
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/20 border-t-white" />
                  İşleniyor...
                </div>
              ) : (
                <>
                  {view === 'login' && 'Giriş Yap'}
                  {view === 'register' && 'Hesap Oluştur'}
                  {view === 'forgot-password' && 'Kod Gönder'}
                  {view === 'verify-otp' && 'Doğrula ve Giriş Yap'}
                  {view === 'reset-password' && 'Şifreyi Güncelle'}
                </>
              )}
            </Button>
          </form>

          {(view === 'login' || view === 'register') && (
            <div className="mt-6">
              <div className="relative mb-6">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-white/5"></div>
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-[#0c0c0c]/80 px-2 text-muted-foreground backdrop-blur-sm">veya şununla devam et</span>
                </div>
              </div>

              <Button
                variant="outline"
                type="button"
                className="w-full bg-white/5 border-white/10 hover:bg-white/10 text-white h-11 rounded-xl gap-3"
                onClick={() => loginWithGoogle()}
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
                Google ile Giriş Yap
              </Button>
            </div>
          )}

          {(view === 'login' || view === 'register') && (
            <div className="mt-8 text-center text-sm border-t border-white/5 pt-6">
              <span className="text-muted-foreground">
                {view === 'login' ? 'Henüz hesabınız yok mu? ' : 'Zaten hesabınız var mı? '}
              </span>
              <button
                onClick={() => setView(view === 'login' ? 'register' : 'login')}
                className="font-bold text-primary hover:underline transition-all"
              >
                {view === 'login' ? 'Kayıt Ol' : 'Giriş Yap'}
              </button>
            </div>
          )}
        </div>

        <div className="mt-8 text-center">
          <Link to="/" className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground hover:text-white transition-colors duration-300">
            &larr; Ana Sayfaya Dön
          </Link>
        </div>
      </div >
    </div >
  );
};

export default Auth;
