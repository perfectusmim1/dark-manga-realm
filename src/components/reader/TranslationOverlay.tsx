import React from 'react';
import { AlertTriangle, Eye, EyeOff, Languages, Loader2, RefreshCw } from 'lucide-react';
import { PageTranslationState, TranslationBlock } from '@/lib/translation/types';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';

// Balon çevirilerini görselin üzerine %-tabanlı konumla basar.
// Koordinatlar 0-1000 normalize geldiği için zoom/ekran boyutundan bağımsızdır.
export const TranslationOverlay: React.FC<{ blocks: TranslationBlock[] }> = ({ blocks }) => (
  <div className="pointer-events-none absolute inset-0 z-20">
    {blocks.map((block, index) => {
      const [ymin, xmin, ymax, xmax] = block.box;
      return (
        <div
          key={index}
          className="absolute flex items-center justify-center overflow-hidden rounded-md bg-white/95 px-1 py-0.5 text-center text-black shadow-sm"
          style={{
            top: `${ymin / 10}%`,
            left: `${xmin / 10}%`,
            width: `${(xmax - xmin) / 10}%`,
            height: `${(ymax - ymin) / 10}%`,
            containerType: 'size',
          } as React.CSSProperties}
        >
          <span
            className="leading-tight"
            style={{ fontSize: 'clamp(8px, 13cqw, 22px)', wordBreak: 'break-word' }}
          >
            {block.text}
          </span>
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
