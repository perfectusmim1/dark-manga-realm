import React from 'react';
import { AlertTriangle, Eye, EyeOff, Languages, Loader2, RefreshCw } from 'lucide-react';
import { PageTranslationState, TranslationBlock } from '@/lib/translation/types';
import { formatScanlationText, getFontFamilyCss } from '@/lib/translation/bubbleInpainter';
import { isRpgStatLine } from '@/lib/translation/ocrCore';
import {
  computeSmartWrappedLines,
  getLineHeightRatioForBlock,
  getSharedMeasureContext,
} from '@/lib/translation/textLayout';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

// Piksel-Inpaint + Vektör & Stil Kopyalı Scanlation Dizgi Katmanı:
// 1. Orijinal metni balonun veya sahnenin pikselleriyle pürüzsüz onaran WebP yamayı (patchDataUrl) 1:1 oturtur.
// 2. Çevrilen metni sayfa genişliğine (cqw) kilitli, orijinal yazının font karakterini, rengini, konturunu,
//    gradyanını, açısını ve vurgu ölçeğini birebir koruyan vektör katmanıyla ekrana basar.
export const TranslationOverlay: React.FC<{
  blocks: TranslationBlock[];
  targetLang?: string;
}> = ({ blocks, targetLang = 'tr' }) => {
  const measureCtx = getSharedMeasureContext();

  return (
    <div
      className="pointer-events-none absolute inset-0 z-20 select-none"
      style={{ containerType: 'inline-size' } as React.CSSProperties}
    >
      {/* 1. Katman: Tüm balonların ve sahne yazılarının lekesiz piksel-inpaint arka plan yamaları */}
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

      {/* 2. Katman: Vektörel Retina webtoon/manga & SFX dizgisi */}
      {blocks.map((block, index) => {
        const [ymin, xmin, ymax, xmax] = block.box;
        const displayText = formatScanlationText(block.text, targetLang);
        if (!displayText) return null;

        const textColor = block.textColor || (block.isDark ? '#fafafa' : '#0c0c0c');
        const fontSizeCqw = block.fontSizeCqw ?? 2.85;
        const fontFamilyCss = getFontFamilyCss(block.fontFamily);
        const fontWeight = block.fontWeight ?? 600;
        const lineHeightRatio = getLineHeightRatioForBlock(block);
        const strokeColor = block.strokeColor || '#ffffff';
        const strokeWidthEm = block.strokeWidthEm ?? 0.12;
        const letterSpacing = `${block.letterSpacingEm ?? 0.01}em`;

        // Referans 1000px genişlik üzerinden dengeli satırları ve vurgu ölçeğini hesapla (%12 yatay güvenlik payı)
        const refBoxW = Math.max(20, xmax - xmin);
        const refFontPx = (fontSizeCqw / 100) * 1000;
        const isSingleLineStat =
          !block.text.includes('\n') &&
          displayText.length <= 48 &&
          isRpgStatLine(displayText);
        const wrapped = isSingleLineStat
          ? {
              lines: [{ text: displayText, widthPx: refBoxW, scale: 1 }],
              maxWordWidth: refBoxW,
              totalHeightPx: refFontPx * lineHeightRatio,
            }
          : computeSmartWrappedLines(
              measureCtx,
              displayText,
              refBoxW * 0.88,
              refFontPx,
              {
                fontFamily: block.fontFamily,
                fontWeight,
                lineWidthsPct: block.lineWidthsPct,
                emphasisLastLineScale: block.emphasisLastLineScale,
                lineHeightRatio,
              },
            );

        const textShadow = block.shadowColor
          ? `0 0 3px ${block.shadowColor}, 0 0 7px ${block.shadowColor}`
          : undefined;

        const transformParts: string[] = [];
        if (block.rotationDeg) transformParts.push(`rotate(${block.rotationDeg}deg)`);
        if (block.skewDeg) transformParts.push(`skewX(${block.skewDeg}deg)`);
        const transformCss = transformParts.length > 0 ? transformParts.join(' ') : undefined;

        return (
          <div
            key={`text-${index}`}
            className={cn(
              'pointer-events-none absolute flex flex-col justify-center select-none',
              isSingleLineStat ? 'items-start' : 'items-center',
            )}
            style={{
              top: `${ymin / 10}%`,
              left: `${xmin / 10}%`,
              width: `${(xmax - xmin) / 10}%`,
              height: `${(ymax - ymin) / 10}%`,
              transform: transformCss,
            }}
          >
            {wrapped.lines.length > 0 ? (
              wrapped.lines.map((line, lineIdx) => {
                const lineCqw = Number((fontSizeCqw * line.scale).toFixed(3));
                const ls = block.lineStyles?.[lineIdx];
                const lineColor = ls?.textColor ?? textColor;
                const lineHasStroke = ls?.hasTextStroke ?? block.hasTextStroke;
                const lineStrokeColor = ls?.strokeColor ?? strokeColor;
                const lineStrokeWidthEm = ls?.strokeWidthEm ?? strokeWidthEm;
                const lineShadow = ls?.shadowColor
                  ? `0 0 3px ${ls.shadowColor}, 0 0 7px ${ls.shadowColor}`
                  : ls && ls.hasTextStroke === false
                    ? undefined
                    : textShadow;
                return (
                  <span
                    key={lineIdx}
                    className={cn(
                      'block w-full whitespace-nowrap',
                      isSingleLineStat ? 'text-left' : 'text-center',
                    )}
                    style={
                      {
                        color: lineColor,
                        fontFamily: fontFamilyCss,
                        fontWeight,
                        fontStyle: block.fontStyle || 'normal',
                        fontSize: `${lineCqw}cqw`,
                        lineHeight: lineHeightRatio,
                        letterSpacing,
                        textShadow: lineShadow,
                        ...(lineHasStroke
                          ? {
                              WebkitTextStroke: `${lineStrokeWidthEm}em ${lineStrokeColor}`,
                              paintOrder: 'stroke fill',
                            }
                          : undefined),
                      } as React.CSSProperties
                    }
                  >
                    {line.text}
                  </span>
                );
              })
            ) : (
              <span
                className="block w-full text-center"
                style={
                  {
                    color: textColor,
                    fontFamily: fontFamilyCss,
                    fontWeight,
                    fontSize: `${fontSizeCqw}cqw`,
                    lineHeight: lineHeightRatio,
                    letterSpacing,
                    overflowWrap: 'break-word',
                    textShadow,
                    ...(block.hasTextStroke
                      ? {
                          WebkitTextStroke: `${strokeWidthEm}em ${strokeColor}`,
                          paintOrder: 'stroke fill',
                        }
                      : undefined),
                  } as React.CSSProperties
                }
              >
                {displayText}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
};

interface PageTranslateButtonProps {
  state?: PageTranslationState;
  canRequestTranslation?: boolean;
  showIdleButton: boolean;
  overlayShown: boolean;
  onTranslate: () => void;
  onRetranslate: () => void;
  onToggleOverlay: () => void;
}

const baseButtonClasses =
  'pointer-events-auto absolute right-2.5 top-2.5 z-30 flex h-7 items-center gap-1.5 rounded-full border border-white/10 bg-background/75 px-2.5 text-[11px] font-medium text-foreground shadow-md backdrop-blur-md transition-colors hover:border-primary/40 hover:bg-background/90';

// Sayfanın sağ üst köşesindeki çeviri kontrolü.
export const PageTranslateButton: React.FC<PageTranslateButtonProps> = ({
  state,
  canRequestTranslation = true,
  showIdleButton,
  overlayShown,
  onTranslate,
  onRetranslate,
  onToggleOverlay,
}) => {
  const status = state?.status ?? 'idle';
  const blockCount = state?.blocks?.length ?? 0;

  if (status === 'queued' || status === 'translating') {
    return (
      <div
        className={cn(baseButtonClasses, 'border-primary/40 bg-background/85 text-primary')}
        aria-label="Sayfa çevriliyor"
        onClick={(e) => e.stopPropagation()}
      >
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        <span>{status === 'translating' ? 'Çevriliyor' : 'Sırada'}</span>
      </div>
    );
  }

  if (status === 'error') {
    if (!canRequestTranslation) return null;
    return (
      <button
        type="button"
        className={cn(baseButtonClasses, 'border-destructive/45 bg-background/85 text-red-300 hover:border-destructive')}
        onClick={(e) => {
          e.stopPropagation();
          onTranslate();
        }}
        aria-label="Çeviri başarısız, tekrar dene"
      >
        <AlertTriangle className="h-3.5 w-3.5 text-red-400" />
        <span>Tekrar dene</span>
      </button>
    );
  }

  if (status === 'done') {
    if (blockCount === 0 && !canRequestTranslation) return null;

    return (
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            className={cn(
              baseButtonClasses,
              blockCount > 0 && overlayShown
                ? 'border-primary/45 bg-primary/15 text-primary hover:bg-primary/25'
                : 'text-muted-foreground hover:text-foreground',
            )}
            onClick={(e) => e.stopPropagation()}
            aria-label="Sayfa çeviri seçenekleri"
          >
            <Languages className="h-3.5 w-3.5" />
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="end"
          onClick={(e) => e.stopPropagation()}
          className="pointer-events-auto z-40 w-44 rounded-xl border-border/60 bg-popover/95 p-1.5 shadow-xl backdrop-blur-xl"
        >
          {blockCount > 0 ? (
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start gap-2 rounded-lg text-xs"
              onClick={onToggleOverlay}
            >
              {overlayShown ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              {overlayShown ? 'Çeviriyi gizle' : 'Çeviriyi göster'}
            </Button>
          ) : (
            <p className="px-2.5 py-1.5 text-[11px] text-muted-foreground">
              Konuşma balonu bulunamadı
            </p>
          )}
          {canRequestTranslation && (
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start gap-2 rounded-lg text-xs"
              onClick={onRetranslate}
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Yeniden çevir
            </Button>
          )}
        </PopoverContent>
      </Popover>
    );
  }

  if (!canRequestTranslation || !showIdleButton) return null;

  return (
    <button
      type="button"
      className={baseButtonClasses}
      onClick={(e) => {
        e.stopPropagation();
        onTranslate();
      }}
      aria-label="Bu sayfayı çevir"
    >
      <Languages className="h-3.5 w-3.5 text-primary" />
      <span>Çevir</span>
    </button>
  );
};
