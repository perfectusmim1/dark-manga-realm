import React from 'react';
import { AlertTriangle, Eye, EyeOff, Languages, Loader2, RefreshCw } from 'lucide-react';
import { PageTranslationState, TranslationBlock } from '@/lib/translation/types';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';

// Profesyonel webtoon/manga editleme katmanı:
// 1. Orijinal metni balonun kendi arka plan rengiyle (ve yumuşak kenar geçişiyle) siler (Inpaint Mask).
// 2. Çevrilen metni balonun tam ortasına scanlation fontu ve kontrast renkle dizgiler (Typeset).
export const TranslationOverlay: React.FC<{ blocks: TranslationBlock[] }> = ({ blocks }) => (
  <div className="pointer-events-none absolute inset-0 z-20">
    {blocks.map((block, index) => {
      const [ymin, xmin, ymax, xmax] = block.box;
      const bgColor = block.bgColor || '#ffffff';
      const textColor = block.textColor || (block.isDark ? '#ffffff' : '#0a0a0a');

      return (
        <div
          key={index}
          className="absolute flex items-center justify-center pointer-events-none select-none"
          style={{
            top: `${ymin / 10}%`,
            left: `${xmin / 10}%`,
            width: `${(xmax - xmin) / 10}%`,
            height: `${(ymax - ymin) / 10}%`,
            containerType: 'size',
          } as React.CSSProperties}
        >
          {/* Orijinal yazıyı lekesiz örten yumuşak inpaint arka plan yaması (kutu veya gölge içermez) */}
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              backgroundColor: bgColor,
              borderRadius: '45%',
              filter: 'blur(1.5px)',
              transform: 'scale(1.04)',
              opacity: 0.98,
            }}
          />

          {/* Webtoon/manga scanlation dizgisi */}
          <div
            className="relative z-10 flex h-full w-full items-center justify-center p-1 text-center font-bold tracking-tight"
            style={{
              color: textColor,
              fontFamily: '"Nunito", "Rubik", "Comic Sans MS", system-ui, -apple-system, sans-serif',
              lineHeight: 1.15,
              wordBreak: 'break-word',
              overflowWrap: 'break-word',
            }}
          >
            <span
              style={{
                fontSize: 'clamp(8px, min(14cqw, 24cqh), 22px)',
                textShadow: block.isDark
                  ? '0 1px 2px rgba(0,0,0,0.6)'
                  : '0 0 1px rgba(255,255,255,0.4)',
              }}
            >
              {block.text}
            </span>
          </div>
        </div>
      );
    })}
  </div>
);

interface PageTranslateButtonProps {
  state?: PageTranslationState;
  showIdleButton: boolean;
  overlayShown: boolean;
  onTranslate: () => void;
  onRetranslate: () => void;
  onToggleOverlay: () => void;
}

const buttonClasses =
  'pointer-events-auto absolute right-2 top-2 z-30 flex h-7 items-center gap-1 rounded-full bg-black/60 px-2.5 text-[11px] font-medium text-white backdrop-blur transition-colors hover:bg-black/80';

// Sayfanın sağ üst köşesindeki çeviri kontrolü.
export const PageTranslateButton: React.FC<PageTranslateButtonProps> = ({
  state,
  showIdleButton,
  overlayShown,
  onTranslate,
  onRetranslate,
  onToggleOverlay,
}) => {
  const status = state?.status ?? 'idle';

  if (status === 'queued' || status === 'translating') {
    return (
      <div className={buttonClasses} aria-label="Çevriliyor">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        <span>Çevriliyor</span>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <button type="button" className={buttonClasses} onClick={onTranslate} aria-label="Çeviri başarısız, tekrar dene">
        <AlertTriangle className="h-3.5 w-3.5 text-red-400" />
        <span>Tekrar dene</span>
      </button>
    );
  }

  if (status === 'done') {
    return (
      <Popover>
        <PopoverTrigger asChild>
          <button type="button" className={buttonClasses} aria-label="Çeviri seçenekleri">
            <Languages className="h-3.5 w-3.5" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" className="pointer-events-auto z-40 w-44 rounded-xl border-border/60 bg-popover/95 p-1.5 shadow-xl backdrop-blur-xl">
          <Button variant="ghost" size="sm" className="w-full justify-start gap-2" onClick={onToggleOverlay}>
            {overlayShown ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            {overlayShown ? 'Çeviriyi gizle' : 'Çeviriyi göster'}
          </Button>
          <Button variant="ghost" size="sm" className="w-full justify-start gap-2" onClick={onRetranslate}>
            <RefreshCw className="h-4 w-4" />
            Yeniden çevir
          </Button>
        </PopoverContent>
      </Popover>
    );
  }

  if (!showIdleButton) return null;

  return (
    <button type="button" className={buttonClasses} onClick={onTranslate} aria-label="Bu sayfayı çevir">
      <Languages className="h-3.5 w-3.5" />
      <span>Çevir</span>
    </button>
  );
};
