import React from 'react';
import { AlertTriangle, Eye, EyeOff, Languages, Loader2, RefreshCw } from 'lucide-react';
import { PageTranslationState, TranslationBlock } from '@/lib/translation/types';
import { formatScanlationText, SCANLATION_FONT_FAMILY } from '@/lib/translation/bubbleInpainter';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';

// Piksel-Inpaint + Vektör Scanlation Dizgi Katmanı:
// 1. Orijinal metni balonun kendi pikselleriyle pürüzsüz onaran WebP yamayı (patchDataUrl) 1:1 oturtur.
// 2. Çevrilen metni sayfa genişliğine (cqw) kilitli Shantell Sans çizgi roman fontuyla balon içine dizgiler.
export const TranslationOverlay: React.FC<{
  blocks: TranslationBlock[];
  targetLang?: string;
}> = ({ blocks, targetLang = 'tr' }) => (
  <div
    className="pointer-events-none absolute inset-0 z-20 select-none"
    style={{ containerType: 'inline-size' } as React.CSSProperties}
  >
    {/* 1. Katman: Tüm balonların lekesiz piksel-inpaint arka plan yamaları */}
    {blocks.map((block, index) => {
      if (!block.patchDataUrl || !block.patchBox) return null;
      const [pYmin, pXmin, pYmax, pXmax] = block.patchBox;
      return (
        <img
          key={`patch-${index}`}
          src={block.patchDataUrl}
          alt=""
          aria-hidden="true"
          draggable={false}
          className="pointer-events-none absolute block max-w-none select-none"
          style={{
            top: `${pYmin / 10}%`,
            left: `${pXmin / 10}%`,
            width: `${(pXmax - pXmin) / 10}%`,
            height: `${(pYmax - pYmin) / 10}%`,
          }}
        />
      );
    })}

    {/* 2. Katman: Vektörel Retina webtoon/manga dizgisi */}
    {blocks.map((block, index) => {
      const [ymin, xmin, ymax, xmax] = block.box;
      const textColor = block.textColor || (block.isDark ? '#fafafa' : '#0c0c0c');
      const fontSizeCqw = block.fontSizeCqw ?? 2.85;
      const displayText = formatScanlationText(block.text, targetLang);

      return (
        <div
          key={`text-${index}`}
          className="pointer-events-none absolute flex items-center justify-center select-none"
          style={{
            top: `${ymin / 10}%`,
            left: `${xmin / 10}%`,
            width: `${(xmax - xmin) / 10}%`,
            height: `${(ymax - ymin) / 10}%`,
          }}
        >
          <span
            className="block w-full text-center font-bold"
            style={{
              color: textColor,
              fontFamily: SCANLATION_FONT_FAMILY,
              fontSize: `${fontSizeCqw}cqw`,
              lineHeight: 1.22,
              letterSpacing: '0.01em',
              overflowWrap: 'break-word',
              wordBreak: 'normal',
              ...(block.hasTextStroke
                ? {
                    WebkitTextStroke: '0.22em #ffffff',
                    paintOrder: 'stroke fill',
                  }
                : undefined),
            } as React.CSSProperties}
          >
            {displayText}
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
