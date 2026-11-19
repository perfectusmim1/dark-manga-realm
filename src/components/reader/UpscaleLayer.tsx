import React, { memo, useCallback, useRef, useState } from 'react';
import { MoveHorizontal } from 'lucide-react';
import { usePageUpscale } from '@/hooks/usePageUpscale';
import type { UpscaleAiModel, UpscaleMode } from '@/lib/upscale/types';

interface UpscaleLayerProps {
  src: string;
  mode: UpscaleMode;
  aiModel: UpscaleAiModel;
  upscaleHighRes: boolean;
  compare: boolean;
}

const DEFAULT_SPLIT_PCT = 50;

interface UpscaleStripProps {
  strip: { index: number; validY0: number; validY1: number };
  naturalHeight: number;
  isProcessing: boolean;
  registerStripEl: (index: number, el: HTMLDivElement | null) => void;
  registerCanvasEl: (index: number, el: HTMLCanvasElement | null) => void;
}

const UpscaleStrip = memo<UpscaleStripProps>(
  ({ strip, naturalHeight, isProcessing, registerStripEl, registerCanvasEl }) => {
    const stripRef = useCallback(
      (el: HTMLDivElement | null) => registerStripEl(strip.index, el),
      [registerStripEl, strip.index],
    );
    const canvasRef = useCallback(
      (el: HTMLCanvasElement | null) => registerCanvasEl(strip.index, el),
      [registerCanvasEl, strip.index],
    );

    const topPct = (strip.validY0 / naturalHeight) * 100;
    const heightPct = ((strip.validY1 - strip.validY0) / naturalHeight) * 100;

    return (
      <div
        data-strip-index={strip.index}
        ref={stripRef}
        className="pointer-events-none absolute left-0 right-0 overflow-hidden"
        style={{
          top: `${topPct}%`,
          height: `${heightPct}%`,
        }}
      >
        <canvas
          ref={canvasRef}
          className="pointer-events-none block h-full w-full opacity-0 transition-opacity duration-150"
        />
        {isProcessing && (
          <div className="pointer-events-none absolute inset-0 animate-pulse bg-gradient-to-b from-primary/5 via-primary/10 to-primary/5" />
        )}
      </div>
    );
  },
);
UpscaleStrip.displayName = 'UpscaleStrip';

const updateSharedSplitCssVar = (el: HTMLElement | null, pct: number) => {
  const clamped = Math.max(0, Math.min(100, Math.round(pct * 10) / 10));
  const root = el?.closest('[data-upscale-root]') as HTMLElement | null;
  if (root) {
    root.style.setProperty('--upscale-split', `${clamped}%`);
  }
  return clamped;
};

const UpscaleLayerComponent: React.FC<UpscaleLayerProps> = ({
  src,
  mode,
  aiModel,
  upscaleHighRes,
  compare,
}) => {
  const rootRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const [ariaSplitPct, setAriaSplitPct] = useState(DEFAULT_SPLIT_PCT);

  const { metrics, engine, stripStates, registerStripEl, registerCanvasEl } = usePageUpscale({
    src,
    mode,
    aiModel,
    upscaleHighRes,
    rootRef,
  });

  const isAi = engine === 'realesrgan' || engine === 'waifu2x';
  const showCanvases =
    mode !== 'off' &&
    !metrics.skippedHighRes &&
    metrics.naturalHeight > 0 &&
    metrics.strips.length > 0;
  const showCompareSlider = showCanvases && compare;

  const applySplitFromClientX = useCallback((clientX: number, sliderEl: HTMLDivElement) => {
    const parent = sliderEl.parentElement;
    if (!parent) return;
    const rect = parent.getBoundingClientRect();
    const width = Math.max(1, rect.width);
    const pct = ((clientX - rect.left) / width) * 100;
    const clamped = updateSharedSplitCssVar(sliderEl, pct);
    setAriaSplitPct(Math.round(clamped));
  }, []);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.stopPropagation();
      e.preventDefault();
      draggingRef.current = true;
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // ignore capture error
      }
      applySplitFromClientX(e.clientX, e.currentTarget);
    },
    [applySplitFromClientX],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!draggingRef.current) return;
      e.stopPropagation();
      applySplitFromClientX(e.clientX, e.currentTarget);
    },
    [applySplitFromClientX],
  );

  const handlePointerEnd = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    e.stopPropagation();
    draggingRef.current = false;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // ignore release error
    }
  }, []);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    e.stopPropagation();
    const step = e.shiftKey ? 10 : 2;
    const delta = e.key === 'ArrowLeft' ? -step : step;
    setAriaSplitPct((prev) => {
      const next = updateSharedSplitCssVar(e.currentTarget, prev + delta);
      return Math.round(next);
    });
  }, []);

  return (
    <>
      <div
        ref={rootRef}
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-[5] overflow-hidden select-none"
        style={
          showCompareSlider
            ? { clipPath: 'inset(0 0 0 var(--upscale-split, 50%))' }
            : undefined
        }
      >
        {showCanvases &&
          metrics.strips.map((strip) => (
            <UpscaleStrip
              key={strip.index}
              strip={strip}
              naturalHeight={metrics.naturalHeight}
              isProcessing={isAi && stripStates[strip.index] === 'processing'}
              registerStripEl={registerStripEl}
              registerCanvasEl={registerCanvasEl}
            />
          ))}
      </div>

      {showCompareSlider && (
        <div
          data-upscale-compare="true"
          className="pointer-events-none absolute inset-0 z-[25] select-none"
        >
          <div className="sticky top-16 z-10 flex items-center justify-between px-3 pt-2">
            <span className="rounded-full border border-white/15 bg-background/80 px-2.5 py-0.5 text-[11px] font-medium leading-normal text-foreground/90 shadow-sm backdrop-blur-md">
              Orijinal
            </span>
            <span className="rounded-full border border-primary/35 bg-background/80 px-2.5 py-0.5 text-[11px] font-medium leading-normal text-primary shadow-sm backdrop-blur-md">
              İyileştirilmiş
            </span>
          </div>

          <div
            data-upscale-compare="true"
            role="slider"
            aria-label="Öncesi ve sonrası karşılaştırma sürgüsü"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={ariaSplitPct}
            tabIndex={0}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerEnd}
            onPointerCancel={handlePointerEnd}
            onKeyDown={handleKeyDown}
            onClick={(e) => e.stopPropagation()}
            className="pointer-events-auto absolute inset-y-0 w-11 -translate-x-1/2 cursor-ew-resize touch-none select-none focus:outline-none"
            style={{ left: 'var(--upscale-split, 50%)' }}
          >
            <div className="pointer-events-none absolute inset-y-0 left-1/2 w-[2px] -translate-x-1/2 bg-white/90 shadow-[0_0_8px_rgba(0,0,0,0.65)]" />
            <div className="pointer-events-none sticky top-1/2 mx-auto flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full border border-white/80 bg-background/90 text-foreground shadow-lg backdrop-blur-md">
              <MoveHorizontal className="h-4 w-4" />
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export const UpscaleLayer = memo(UpscaleLayerComponent);
UpscaleLayer.displayName = 'UpscaleLayer';
