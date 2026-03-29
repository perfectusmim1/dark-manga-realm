import React, { useEffect, useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';

const REQUIRED_WAIT_SECONDS = 5;

const UserWarningGate: React.FC = () => {
  const { accessState, acknowledgeWarning, logout } = useAuth();
  const navigate = useNavigate();
  const warning = accessState.warning;
  const warningId = warning?.id;
  const [secondsLeft, setSecondsLeft] = useState(REQUIRED_WAIT_SECONDS);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!warningId) {
      setSecondsLeft(REQUIRED_WAIT_SECONDS);
      return;
    }

    setSecondsLeft(REQUIRED_WAIT_SECONDS);
    const intervalId = window.setInterval(() => {
      setSecondsLeft((current) => {
        if (current <= 1) {
          window.clearInterval(intervalId);
          return 0;
        }

        return current - 1;
      });
    }, 1000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [warningId]);

  if (!warning) {
    return null;
  }

  const handleAcknowledge = async () => {
    if (secondsLeft > 0 || isSubmitting) {
      return;
    }

    try {
      setIsSubmitting(true);
      const result = await acknowledgeWarning(warning.id);
      if (!result.success) {
        throw new Error(result.error || 'WARNING_ACK_FAILED');
      }

      if (result.banActive) {
        toast.error('Hesap banlandığı için oturum kapatıldı. Destek sayfasından itiraz gönderebilirsiniz.');
        await logout();
        navigate('/support', { replace: true });
        return;
      }

      toast.success('Uyarı okundu olarak işaretlendi');
    } catch (error) {
      console.error('Warning acknowledgement failed:', error);
      toast.error('Uyarı onaylanamadı');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <div className="w-full max-w-lg overflow-hidden rounded-[2rem] border border-amber-500/30 bg-card shadow-2xl">
        <div className="border-b border-border/70 bg-amber-500/10 px-6 py-5">
          <div className="flex items-center gap-3">
            <div className="rounded-2xl bg-amber-500/20 p-3 text-amber-300">
              <ShieldAlert className="h-6 w-6" />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-amber-200/80">Zorunlu Uyarı</p>
              <h2 className="mt-1 text-2xl font-black tracking-tight">{warning.title}</h2>
            </div>
          </div>
        </div>

        <div className="space-y-5 px-6 py-6">
          <p className="whitespace-pre-wrap text-sm leading-7 text-muted-foreground">
            {warning.message}
          </p>

          <div className="rounded-2xl border border-border bg-background/70 p-4 text-sm text-muted-foreground">
            <p>Gönderilme: {new Date(warning.createdAt).toLocaleString('tr-TR')}</p>
            <p className="mt-2">
              Devam etmek için bu uyarıyı okuyup anladığını onaylaman gerekiyor.
            </p>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted-foreground">
              {secondsLeft > 0
                ? `Buton ${secondsLeft} saniye içinde açılacak.`
                : 'Onay butonu hazır.'}
            </p>
            <Button onClick={handleAcknowledge} disabled={secondsLeft > 0 || isSubmitting}>
              {isSubmitting ? 'İşleniyor...' : 'Okudum, Anlıyorum'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default UserWarningGate;
