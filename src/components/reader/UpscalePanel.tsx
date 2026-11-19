import React from 'react';
import { Loader2 } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useDeviceProfile } from '@/hooks/use-device-profile';
import { useUpscaleStatus, useUpscaleSupport } from '@/hooks/useUpscaleSupport';
import type { UpscaleAiModel, UpscaleMode } from '@/lib/upscale/types';
import { cn } from '@/lib/utils';

interface UpscalePanelProps {
  mode: UpscaleMode;
  aiModel: UpscaleAiModel;
  upscaleHighRes: boolean;
  compare: boolean;
  onModeChange: (mode: UpscaleMode) => void;
  onAiModelChange: (model: UpscaleAiModel) => void;
  onHighResChange: (value: boolean) => void;
  onCompareChange: (value: boolean) => void;
}

const MODE_OPTIONS: Array<{ value: UpscaleMode; label: string; hint?: string }> = [
  { value: 'off', label: 'Kapalı' },
  { value: 'fast', label: 'Hızlı', hint: 'Pil dostu, anında' },
  { value: 'quality', label: 'Kaliteli', hint: 'Daha net çizgiler' },
  { value: 'ai', label: 'Yapay Zekâ', hint: 'En yüksek kalite, daha yavaş' },
];

const AI_MODEL_OPTIONS: Array<{ value: UpscaleAiModel; label: string; hint: string }> = [
  { value: 'realesrgan', label: 'Real-ESRGAN', hint: 'Keskin' },
  { value: 'waifu2x', label: 'waifu2x', hint: 'Yumuşak' },
];

const UpscalePanel: React.FC<UpscalePanelProps> = ({
  mode,
  aiModel,
  upscaleHighRes,
  compare,
  onModeChange,
  onAiModelChange,
  onHighResChange,
  onCompareChange,
}) => {
  const support = useUpscaleSupport();
  const status = useUpscaleStatus();
  const { isLowEndDevice } = useDeviceProfile();

  const canFastOrQuality = !support.checked || support.webgpu || support.webgl2;
  const canAi = !support.checked || support.webgpu;

  const activeModeMeta = MODE_OPTIONS.find((item) => item.value === mode);
  const isDownloading =
    status.download &&
    (status.download.stage === 'downloading' || status.download.stage === 'initializing');

  return (
    <div className="space-y-3.5">
      {/* Mod Seçimi */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <Label className="text-xs font-semibold text-muted-foreground">Mod</Label>
          {status.activeJobs > 0 && mode !== 'off' && (
            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-primary">
              <Loader2 className="h-3 w-3 animate-spin" />
              <span>İşleniyor</span>
            </span>
          )}
        </div>

        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.25fr)] gap-1 rounded-xl border border-border/60 bg-secondary/40 p-1">
          {MODE_OPTIONS.map((option) => {
            const isDisabled =
              (option.value === 'ai' && !canAi) ||
              ((option.value === 'fast' || option.value === 'quality') && !canFastOrQuality);
            const isSelected = mode === option.value;
            return (
              <button
                key={option.value}
                type="button"
                disabled={isDisabled}
                onClick={() => onModeChange(option.value)}
                className={cn(
                  'rounded-lg px-1 py-1.5 text-xs font-semibold transition-all',
                  isSelected
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'text-muted-foreground hover:bg-secondary/70 hover:text-foreground',
                  isDisabled && 'cursor-not-allowed opacity-40 hover:bg-transparent hover:text-muted-foreground',
                )}
              >
                <span className="block truncate whitespace-nowrap">{option.label}</span>
              </button>
            );
          })}
        </div>

        {activeModeMeta?.hint && (
          <p className="text-[11px] leading-snug text-muted-foreground">{activeModeMeta.hint}</p>
        )}

        {support.checked && !canFastOrQuality && (
          <p className="text-[11px] leading-snug text-muted-foreground">
            Bu cihaz desteklemiyor
          </p>
        )}

        {support.checked && canFastOrQuality && !canAi && (
          <p className="text-[11px] leading-snug text-muted-foreground">
            Yapay Zekâ: Bu cihaz desteklemiyor
          </p>
        )}

        {isLowEndDevice && canFastOrQuality && (
          <p className="text-[11px] leading-snug text-amber-400/90">
            {mode === 'ai'
              ? 'Cihazınızı ısıtabilir; düşük donanımda Hızlı mod önerilir.'
              : 'Düşük donanımda Hızlı mod önerilir.'}
          </p>
        )}
      </div>

      {/* Yapay Zekâ Model Seçimi */}
      {mode === 'ai' && canAi && (
        <div className="space-y-1.5 rounded-xl border border-border/60 bg-secondary/30 p-2.5">
          <div className="flex items-center justify-between gap-2">
            <Label className="text-xs font-semibold text-muted-foreground">Yapay Zekâ Modeli</Label>
            <span className="text-[10px] font-medium text-muted-foreground">Deneysel</span>
          </div>

          <div className="grid grid-cols-2 gap-1 rounded-xl border border-border/60 bg-background/50 p-1">
            {AI_MODEL_OPTIONS.map((option) => {
              const isSelected = aiModel === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => onAiModelChange(option.value)}
                  className={cn(
                    'flex flex-col items-center justify-center rounded-lg py-1.5 text-center transition-all',
                    isSelected
                      ? 'bg-primary text-primary-foreground shadow-sm'
                      : 'text-muted-foreground hover:bg-secondary/70 hover:text-foreground',
                  )}
                >
                  <span className="text-xs font-semibold leading-tight">{option.label}</span>
                  <span
                    className={cn(
                      'text-[10px] leading-tight',
                      isSelected ? 'text-primary-foreground/85' : 'text-muted-foreground',
                    )}
                  >
                    {option.hint}
                  </span>
                </button>
              );
            })}
          </div>

          {isDownloading && status.download && (
            <div className="space-y-1 pt-1">
              <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                <span>
                  {status.download.stage === 'initializing'
                    ? 'Model hazırlanıyor...'
                    : `Model indiriliyor %${status.download.percent}`}
                </span>
                <span className="tabular-nums">%{status.download.percent}</span>
              </div>
              <progress
                className="tp-progress block h-1.5 w-full"
                aria-label="Model indirme ilerlemesi"
                max={100}
                value={status.download.percent}
              />
            </div>
          )}

          {status.lastError && (
            <p className="text-[11px] leading-snug text-red-300">{status.lastError}</p>
          )}
        </div>
      )}

      {/* Karşılaştırma ve Yüksek Çözünürlük Seçenekleri */}
      <div className="space-y-2.5 border-t border-border/60 pt-2.5">
        <div className="flex items-center justify-between gap-4">
          <Label
            htmlFor="upscale-compare-toggle"
            className={cn('text-sm', mode === 'off' && 'text-muted-foreground')}
          >
            Öncesi / Sonrası karşılaştır
          </Label>
          <Switch
            id="upscale-compare-toggle"
            disabled={mode === 'off'}
            checked={mode !== 'off' && compare}
            onCheckedChange={onCompareChange}
          />
        </div>

        <div className="flex items-center justify-between gap-4">
          <div className="space-y-0.5">
            <Label htmlFor="upscale-highres-toggle" className="text-sm">
              Yüksek çözünürlüklü sayfaları da işle
            </Label>
            <p className="text-[11px] leading-snug text-muted-foreground">
              Kapalıyken ekran çözünürlüğünden yüksek sayfalar atlanır.
            </p>
          </div>
          <Switch
            id="upscale-highres-toggle"
            checked={upscaleHighRes}
            onCheckedChange={onHighResChange}
          />
        </div>
      </div>
    </div>
  );
};

export default UpscalePanel;
