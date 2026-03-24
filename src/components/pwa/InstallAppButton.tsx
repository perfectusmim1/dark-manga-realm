import React, { useState } from 'react';
import { Download, Smartphone } from 'lucide-react';
import { toast } from 'sonner';
import { Button, type ButtonProps } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { usePwaInstall } from '@/hooks/usePwaInstall';
import { cn } from '@/lib/utils';

interface InstallAppButtonProps {
  iconOnly?: boolean;
  label?: string;
  className?: string;
  title?: string;
  variant?: ButtonProps['variant'];
  size?: ButtonProps['size'];
}

const InstallAppButton: React.FC<InstallAppButtonProps> = ({
  iconOnly = false,
  label = 'Uygulamayı Yükle',
  className,
  title,
  variant = 'glow',
  size = 'default',
}) => {
  const { canInstall, isInstalled, isIos, promptInstall } = usePwaInstall();
  const [isIosHelpOpen, setIsIosHelpOpen] = useState(false);
  const [isPrompting, setIsPrompting] = useState(false);

  if (isInstalled || (!canInstall && !isIos)) {
    return null;
  }

  const buttonLabel = isIos ? 'Nasıl Yüklenir?' : isPrompting ? 'Açılıyor...' : label;

  const handleInstall = async () => {
    if (isIos) {
      setIsIosHelpOpen(true);
      return;
    }

    try {
      setIsPrompting(true);
      const outcome = await promptInstall();

      if (outcome === 'accepted') {
        toast.success('ToonParrot cihazına yükleniyor.');
      } else if (outcome === 'dismissed') {
        toast.info('Kurulum istemi kapatıldı.');
      }
    } catch (error) {
      console.error('PWA install prompt error:', error);
      toast.error('Kurulum penceresi açılamadı.');
    } finally {
      setIsPrompting(false);
    }
  };

  return (
    <>
      <Button
        variant={variant}
        size={size}
        onClick={() => void handleInstall()}
        disabled={isPrompting}
        title={title || buttonLabel}
        aria-label={title || buttonLabel}
        className={cn(className)}
      >
        {iconOnly ? (
          <Download className="h-4 w-4" />
        ) : (
          <>
            <Smartphone className="mr-2 h-4 w-4" />
            {buttonLabel}
          </>
        )}
      </Button>

      <Dialog open={isIosHelpOpen} onOpenChange={setIsIosHelpOpen}>
        <DialogContent className="sm:max-w-[460px]">
          <DialogHeader>
            <DialogTitle>iPhone / iPad Kurulumu</DialogTitle>
            <DialogDescription>
              Safari üzerinden ToonParrot&apos;ı ana ekrana ekleyerek uygulama gibi kullanabilirsin.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2 text-sm text-muted-foreground">
            <p>1. Siteyi Safari içinde açık tut.</p>
            <p>2. Alttaki Paylaş menüsüne dokun.</p>
            <p>3. “Ana Ekrana Ekle” seçeneğini seç.</p>
            <p>4. Kaydet deyince ToonParrot cihazında uygulama gibi açılır.</p>
          </div>

          <DialogFooter>
            <Button variant="glow" onClick={() => setIsIosHelpOpen(false)}>
              Tamam
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default InstallAppButton;
