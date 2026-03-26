import React, { useEffect, useState } from 'react';
import { useNavigate, Link, useSearchParams } from 'react-router-dom';
import { Eye, EyeOff, Mail, Lock, User, AtSign, ArrowLeft, ShieldCheck, KeyRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/contexts/AuthContext';
import { PASSWORD_MIN_LENGTH, getPasswordRequirementError, getPasswordRequirementStatus } from '@/lib/auth/passwordPolicy';
import { toast } from 'sonner';

type AuthView = 'login' | 'register' | 'forgot-password' | 'email-check' | 'reset-password' | 'verify-mfa';
type EmailNoticeMode = 'signup' | 'recovery';

const getErrorMessage = (error: unknown, fallback = 'Bir hata oluştu') => (
  error instanceof Error ? error.message : fallback
);

const Auth: React.FC = () => {
  const [searchParams] = useSearchParams();
  const [view, setView] = useState<AuthView>('login');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [emailNoticeMode, setEmailNoticeMode] = useState<EmailNoticeMode>('signup');
  const [submittedEmail, setSubmittedEmail] = useState('');
  const [formData, setFormData] = useState({
    username: '',
    email: '',
    emailOrUsername: '',
    password: '',
    mfaCode: '',
    newPassword: '',
  });

  const {
    user,
    mfaState,
    login,
    register,
    resetPassword,
    updatePassword,
    loginWithGoogle,
    challengeTwoFactor,
    logout,
    resendEmail,
  } = useAuth();
  const navigate = useNavigate();
  const registerPasswordStatus = getPasswordRequirementStatus(formData.password, PASSWORD_MIN_LENGTH);
  const resetPasswordStatus = getPasswordRequirementStatus(formData.newPassword, PASSWORD_MIN_LENGTH);

  useEffect(() => {
    const type = searchParams.get('type');
    const step = searchParams.get('step');

    if (type === 'recovery') {
      setView('reset-password');
      return;
    }

    if (mfaState.needsVerification || step === 'mfa') {
      setView('verify-mfa');
      return;
    }

    if (user) {
      navigate('/');
    }
  }, [mfaState.needsVerification, navigate, searchParams, user]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      const result = await login(formData.emailOrUsername, formData.password);

      if (!result.success) {
        toast.error(result.error || 'Giriş başarısız');
        return;
      }

      if (result.requiresTwoFactor) {
        setView('verify-mfa');
        setFormData((prev) => ({ ...prev, mfaCode: '' }));
        toast.info('Girişinizi tamamlamak için Google Authenticator kodunu girin.');
        return;
      }

      toast.success('Giriş başarılı!');
      navigate('/');
    } catch (error: unknown) {
      toast.error(getErrorMessage(error));
    } finally {
      setIsLoading(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();

    const passwordError = getPasswordRequirementError(formData.password, PASSWORD_MIN_LENGTH);
    if (passwordError) {
      toast.error(passwordError);
      return;
    }

    setIsLoading(true);
    try {
      const result = await register(formData.username, formData.email, formData.password);
      if (!result.success) {
        toast.error(result.error || 'Kayıt başarısız');
        return;
      }

      setSubmittedEmail(formData.email);
      setEmailNoticeMode('signup');
      setView('email-check');
      toast.success('Kayıt tamamlandı. E-posta onay bağlantısını kontrol edin.');
    } catch {
      toast.error('Bir hata oluştu');
    } finally {
      setIsLoading(false);
    }
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      const result = await resetPassword(formData.email);
      if (!result.success) {
        toast.error(result.error || 'İşlem başarısız');
        return;
      }

      setSubmittedEmail(formData.email);
      setEmailNoticeMode('recovery');
      setView('email-check');
      toast.success('Şifre sıfırlama bağlantısı e-postanıza gönderildi.');
    } catch {
      toast.error('İşlem başarısız');
    } finally {
      setIsLoading(false);
    }
  };

  const handleMfaVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      const result = await challengeTwoFactor(formData.mfaCode);
      if (!result.success) {
        toast.error(result.error || 'Kod hatalı veya süresi dolmuş');
        return;
      }

      toast.success('Doğrulama başarılı!');
      navigate('/');
    } finally {
      setIsLoading(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();

    const passwordError = getPasswordRequirementError(formData.newPassword, PASSWORD_MIN_LENGTH);
    if (passwordError) {
      toast.error(passwordError);
      return;
    }

    setIsLoading(true);
    const result = await updatePassword(formData.newPassword, { skipVerification: true });
    if (result.success) {
      toast.success('Şifreniz başarıyla güncellendi.');
      navigate('/');
    } else {
      toast.error(result.error || 'Şifre güncellenemedi');
    }
    setIsLoading(false);
  };
  const [resendCooldown, setResendCooldown] = useState(0);

  useEffect(() => {
    let timer: any;
    if (resendCooldown > 0) {
      timer = setTimeout(() => setResendCooldown(resendCooldown - 1), 1000);
    }
    return () => clearTimeout(timer);
  }, [resendCooldown]);

  const handleResendEmail = async () => {
    if (resendCooldown > 0 || !submittedEmail) return;

    setIsLoading(true);
    try {
      const result = await resendEmail(submittedEmail, emailNoticeMode);
      if (result.success) {
        toast.success('Yeni bağlantı gönderildi. Lütfen gelen kutunuzu kontrol edin.');
        setResendCooldown(60); // 1 minute cooldown
      } else {
        toast.error(result.error || 'Bağlantı gönderilemedi');
      }
    } catch {
      toast.error('Geri gönderme işlemi başarısız');
    } finally {
      setIsLoading(false);
    }
  };

  const heading = {
    login: 'Hoş Geldiniz',
    register: 'Hesap Oluştur',
    'forgot-password': 'Şifremi Unuttum',
    'email-check': 'E-postanızı Kontrol Edin',
    'reset-password': 'Yeni Şifre Belirle',
    'verify-mfa': 'Google Authenticator',
  }[view];

  const description = {
    login: 'Hesabınıza güvenli şekilde giriş yapın',
    register: 'Topluluğumuza katılın',
    'forgot-password': 'Şifre sıfırlama bağlantısı e-posta adresinize gönderilir',
    'email-check': emailNoticeMode === 'signup'
      ? `${submittedEmail} adresine gönderilen hesap onay bağlantısını açın.`
      : `${submittedEmail} adresine gönderilen şifre sıfırlama bağlantısını açın.`,
    'reset-password': 'Hesabınız için yeni ve güçlü bir şifre belirleyin',
    'verify-mfa': user?.email
      ? `${user.email} hesabı için authenticator uygulamasındaki 6 haneli kodu girin.`
      : 'Authenticator uygulamanızdaki 6 haneli kodu girin.',
  }[view];

  const showBackButton = view !== 'login' && view !== 'register' && view !== 'verify-mfa';
  const showSubmitButton = view !== 'email-check';

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background p-4">
      <div className="absolute -left-1/4 top-0 h-96 w-96 rounded-full bg-primary/10 blur-[100px]" />
      <div className="absolute -right-1/4 bottom-0 h-96 w-96 rounded-full bg-primary/10 blur-[100px]" />

      <div className="relative z-10 w-full max-w-md animate-fade-up">
        <Link to="/" className="mb-8 flex justify-center">
          <img src="/logo.png" alt="Logo" className="h-16 w-auto object-contain transition-transform hover:scale-105" />
        </Link>

        <div className="rounded-2xl border border-white/10 bg-black/40 p-8 shadow-2xl ring-1 ring-white/20 backdrop-blur-2xl">
          {showBackButton && (
            <button
              onClick={() => setView('login')}
              className="mb-4 flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-primary"
            >
              <ArrowLeft className="h-4 w-4" /> Geri Dön
            </button>
          )}

          <h1 className="text-center text-2xl font-bold tracking-tight">{heading}</h1>
          <p className="mb-8 mt-2 text-center text-sm text-muted-foreground">{description}</p>

          <form
            onSubmit={
              view === 'login' ? handleLogin
                : view === 'register' ? handleRegister
                  : view === 'forgot-password' ? handleForgotPassword
                    : view === 'verify-mfa' ? handleMfaVerify
                      : handleResetPassword
            }
            className="space-y-4"
          >
            {view === 'register' && (
              <div className="space-y-2">
                <Label className="text-xs font-bold uppercase tracking-wider opacity-60">Kullanıcı Adı</Label>
                <div className="group relative">
                  <User className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground transition-colors group-focus-within:text-primary" />
                  <Input
                    placeholder="kullanici_adi"
                    value={formData.username}
                    onChange={(e) => setFormData((prev) => ({ ...prev, username: e.target.value }))}
                    className="border-white/10 bg-white/5 pl-10 transition-all focus:border-primary/50"
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
                <div className="group relative">
                  <AtSign className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground transition-colors group-focus-within:text-primary" />
                  <Input
                    type={view === 'login' ? 'text' : 'email'}
                    placeholder={view === 'login' ? 'E-posta veya kullanıcı adı' : 'ornek@email.com'}
                    value={view === 'login' ? formData.emailOrUsername : formData.email}
                    onChange={(e) => setFormData((prev) => ({
                      ...prev,
                      [view === 'login' ? 'emailOrUsername' : 'email']: e.target.value,
                    }))}
                    className="border-white/10 bg-white/5 pl-10 transition-all focus:border-primary/50"
                    required
                  />
                </div>
              </div>
            )}

            {(view === 'login' || view === 'register') && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-bold uppercase tracking-wider opacity-60">Şifre</Label>
                  {view === 'login' && (
                    <button
                      type="button"
                      onClick={() => setView('forgot-password')}
                      className="text-[11px] font-medium text-primary hover:underline"
                    >
                      Şifremi Unuttum?
                    </button>
                  )}
                </div>
                <div className="group relative">
                  <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground transition-colors group-focus-within:text-primary" />
                  <Input
                    type={showPassword ? 'text' : 'password'}
                    placeholder="••••••••"
                    value={formData.password}
                    onChange={(e) => setFormData((prev) => ({ ...prev, password: e.target.value }))}
                    className="border-white/10 bg-white/5 pl-10 pr-10 transition-all focus:border-primary/50"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((prev) => !prev)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-muted-foreground transition-colors hover:text-foreground"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                {view === 'register' && (
                  <p
                    className={`text-xs ${
                      registerPasswordStatus.tone === 'error'
                        ? 'text-amber-400'
                        : registerPasswordStatus.tone === 'success'
                          ? 'text-emerald-400'
                          : 'text-muted-foreground'
                    }`}
                  >
                    {registerPasswordStatus.message}
                  </p>
                )}
              </div>
            )}

            {view === 'verify-mfa' && (
              <div className="space-y-4 rounded-2xl border border-primary/15 bg-primary/5 p-5">
                <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
                  <ShieldCheck className="h-8 w-8 text-primary" />
                </div>
                <div className="space-y-2 text-center">
                  <h3 className="text-lg font-semibold">İkinci adımı tamamlayın</h3>
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    Giriş oturumunuz oluşturuldu ancak hesaba erişmek için authenticator doğrulaması gerekiyor.
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="mfa-code" className="text-xs font-bold uppercase tracking-wider opacity-60">
                    6 Haneli Kod
                  </Label>
                  <Input
                    id="mfa-code"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    placeholder="123456"
                    value={formData.mfaCode}
                    onChange={(e) => setFormData((prev) => ({
                      ...prev,
                      mfaCode: e.target.value.replace(/\D/g, '').slice(0, 6),
                    }))}
                    className="border-white/10 bg-white/5 text-center text-lg tracking-[0.35em]"
                    maxLength={6}
                    required
                  />
                </div>
                <Button
                  variant="ghost"
                  type="button"
                  className="w-full text-xs text-muted-foreground hover:bg-white/5 hover:text-white"
                  onClick={async () => {
                    await logout();
                    setFormData((prev) => ({ ...prev, password: '', mfaCode: '' }));
                    setView('login');
                  }}
                >
                  Oturumu kapat ve başka hesapla dene
                </Button>
              </div>
            )}

            {view === 'email-check' && (
              <div className="space-y-6 py-6 text-center">
                <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-primary/10">
                  <Mail className="h-10 w-10 text-primary" />
                </div>
                <div className="space-y-2">
                  <h3 className="text-xl font-bold">Bağlantıyı e-postanızdan açın</h3>
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    {emailNoticeMode === 'signup'
                      ? 'Hesabınızı etkinleştirmek için gelen onay bağlantısını kullanın.'
                      : 'Şifrenizi güvenli şekilde yenilemek için gelen sıfırlama bağlantısını kullanın.'}
                  </p>
                </div>
                <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-xs italic leading-relaxed text-muted-foreground">
                  Tek kullanımlık bağlantılar güvenlik için kısa süre geçerlidir. E-posta içindeki bağlantı dışında başka bir bağlantıya güvenmeyin.
                </div>
                <div className="flex flex-col gap-2">
                  <Button
                    type="button"
                    variant="glow"
                    className="w-full"
                    disabled={isLoading || resendCooldown > 0}
                    onClick={handleResendEmail}
                  >
                    {resendCooldown > 0 ? `Yeniden Gönder (${resendCooldown}s)` : 'Bağlantıyı Yeniden Gönder'}
                  </Button>
                  <Button type="button" variant="ghost" className="w-full" onClick={() => setView('login')}>
                    Giriş ekranına dön
                  </Button>
                </div>
              </div>
            )}

            {view === 'reset-password' && (
              <div className="space-y-2">
                <Label className="text-xs font-bold uppercase tracking-wider opacity-60">Yeni Şifre</Label>
                <div className="group relative">
                  <KeyRound className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground transition-colors group-focus-within:text-primary" />
                  <Input
                    type={showPassword ? 'text' : 'password'}
                    placeholder="Yeni şifreniz"
                    value={formData.newPassword}
                    onChange={(e) => setFormData((prev) => ({ ...prev, newPassword: e.target.value }))}
                    className="border-white/10 bg-white/5 pl-10 pr-10"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((prev) => !prev)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-muted-foreground transition-colors hover:text-foreground"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                <p
                  className={`text-xs ${
                    resetPasswordStatus.tone === 'error'
                      ? 'text-amber-400'
                      : resetPasswordStatus.tone === 'success'
                        ? 'text-emerald-400'
                        : 'text-muted-foreground'
                  }`}
                >
                  {resetPasswordStatus.message} Şifre sıfırlama MFA doğrulamasını kapatmaz.
                </p>
              </div>
            )}

            {showSubmitButton && (
              <Button type="submit" variant="glow" className="mt-4 h-11 w-full rounded-xl shadow-lg shadow-primary/20" disabled={isLoading}>
                {isLoading ? (
                  <div className="flex items-center gap-2">
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/20 border-t-white" />
                    İşleniyor...
                  </div>
                ) : (
                  <>
                    {view === 'login' && 'Giriş Yap'}
                    {view === 'register' && 'Hesap Oluştur'}
                    {view === 'forgot-password' && 'Şifre Sıfırlama Bağlantısı Gönder'}
                    {view === 'verify-mfa' && 'Doğrula ve Giriş Yap'}
                    {view === 'reset-password' && 'Şifreyi Güncelle'}
                  </>
                )}
              </Button>
            )}
          </form>

          {(view === 'login' || view === 'register') && (
            <div className="mt-6">
              <div className="relative mb-6">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-white/5" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-[#0c0c0c]/80 px-2 text-muted-foreground backdrop-blur-sm">veya şununla devam et</span>
                </div>
              </div>

              <Button
                variant="outline"
                type="button"
                className="h-11 w-full gap-3 rounded-xl border-white/10 bg-white/5 text-white hover:bg-white/10"
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
                {view === 'register' ? 'Google ile Kayıt Ol' : 'Google ile Giriş Yap'}
              </Button>
            </div>
          )}

          {(view === 'login' || view === 'register') && (
            <div className="mt-8 border-t border-white/5 pt-6 text-center text-sm">
              <span className="text-muted-foreground">
                {view === 'login' ? 'Henüz hesabınız yok mu? ' : 'Zaten hesabınız var mı? '}
              </span>
              <button
                onClick={() => setView(view === 'login' ? 'register' : 'login')}
                className="font-bold text-primary transition-all hover:underline"
              >
                {view === 'login' ? 'Kayıt Ol' : 'Giriş Yap'}
              </button>
            </div>
          )}
        </div>

        <div className="mt-8 text-center">
          <Link to="/" className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground transition-colors duration-300 hover:text-white">
            &larr; Ana Sayfaya Dön
          </Link>
        </div>
      </div>
    </div>
  );
};

export default Auth;
