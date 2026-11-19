import React from 'react';
import { Loader2 } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useDeviceProfile } from '@/hooks/use-device-profile';
import { useUpscaleStatus, useUpscaleSupport } from '@/hooks/useUpscaleSupport';
import type { UpscaleMode } from '@/lib/upscale/types';
import { cn } from '@/lib/utils';

interface UpscalePanelProps {
  mode: UpscaleMode;
  upscaleHighRes: boolean;
  compare: boolean;
  onModeChange: (mode: UpscaleMode) => void;
  onHighResChange: (value: boolean) => void;
  onCompareChange: (value: boolean) => void;
}

const MODE_OPTIONS: Array<{ value: UpscaleMode; label: string; hint?: string }> = [
  { value: 'off', label: 'Kapalı' },
  { value: 'fast', label: 'Hızlı', hint: 'Pil dostu, anında' },
  { value: 'ai', label: 'Yapay Zekâ', hint: 'En yüksek kalite, daha yavaş' },
];

const UpscalePanel: React.FC<UpscalePanelProps> = ({
  mode,
  upscaleHighRes,
  compare,
  onModeChange,
  onHighResChange,
  onCompareChange,
}) => {
  const support = useUpscaleSupport();
  const status = useUpscaleStatus();
  const { isLowEndDevice } = useDeviceProfile();

  const canFast = !support.checked || support.webgpu || support.webgl2;
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

        <div className="grid grid-cols-3 gap-1 rounded-xl border border-border/60 bg-secondary/40 p-1">
          {MODE_OPTIONS.map((option) => {
            const isDisabled =
              (option.value === 'ai' && !canAi) ||
              (option.value === 'fast' && !canFast);
            const isSelected = mode === option.value;
            return (
              <button
                key={option.value}
                type="button"
                disabled={isDisabled}
                onClick={() => onModeChange(option.value)}
                className={cn(
                  'rounded-lg px-2 py-1.5 text-xs font-semibold transition-all',
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

        {support.checked && !canFast && (
          <p className="text-[11px] leading-snug text-muted-foreground">
            Bu cihaz desteklemiyor
          </p>
        )}

        {support.checked && canFast && !canAi && (
          <p className="text-[11px] leading-snug text-muted-foreground">
            Yapay Zekâ: Bu cihaz desteklemiyor
          </p>
        )}

        {isLowEndDevice && canFast && (
          <p className="text-[11px] leading-snug text-amber-400/90">
            {mode === 'ai'
              ? 'Cihazınızı ısıtabilir; düşük donanımda Hızlı mod önerilir.'
              : 'Düşük donanımda Hızlı mod önerilir.'}
          </p>
        )}
      </div>

      {/* Yapay Zekâ Model İndirme / Hata Durumu */}
      {mode === 'ai' && canAi && (isDownloading || status.lastError) && (
        <div className="space-y-1.5 rounded-xl border border-border/60 bg-secondary/30 p-2.5">
          {isDownloading && status.download && (
            <div className="space-y-1">
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
