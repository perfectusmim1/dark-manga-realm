import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  Database,
  Download,
  Eye,
  EyeOff,
  FolderDown,
  Languages,
  Loader2,
  Plus,
  Square,
  Trash2,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { ReaderTranslationApi } from '@/hooks/useChapterTranslation';
import { formatBytes } from '@/lib/offline/utils';
import { downloadTranslatedChapterAsZip } from '@/lib/translation/bakeTranslatedPage';
import { isAbortTranslationError } from '@/lib/translation/geminiTranslator';
import { TRANSLATION_LANGUAGES, getLanguageName } from '@/lib/translation/languages';
import {
  TranslationCacheStats,
  getTranslationCacheStats,
  subscribeTranslationCache,
} from '@/lib/translation/localTranslationCache';
import {
  getEffectiveApiKeys,
  maskApiKey,
  parseApiKeysInput,
} from '@/lib/translation/translationSettings';
import { ResolvedReaderPage } from '@/lib/types';
import { cn } from '@/lib/utils';

interface TranslationPanelProps {
  chapterId: string;
  mangaTitle: string;
  chapterNumber: number | string;
  pages: ResolvedReaderPage[];
  translation: ReaderTranslationApi;
  isOnline: boolean;
  isOfflineMode?: boolean;
  onQueueOfflineChapter?: () => Promise<void>;
}

const EMPTY_STATS: TranslationCacheStats = {
  totalChapters: 0,
  totalPages: 0,
  totalBytes: 0,
  currentChapterPages: 0,
  currentChapterBytes: 0,
};

const TranslationPanel: React.FC<TranslationPanelProps> = ({
  chapterId,
  mangaTitle,
  chapterNumber,
  pages,
  translation,
  isOnline,
  isOfflineMode = false,
  onQueueOfflineChapter,
}) => {
  const { settings, updateSettings, summary, pageStates } = translation;
  const [languageQuery, setLanguageQuery] = useState('');
  const [draftKeyInput, setDraftKeyInput] = useState('');
  const [revealKeys, setRevealKeys] = useState(false);
  const [cacheStats, setCacheStats] = useState<TranslationCacheStats>(EMPTY_STATS);
  const [isClearingCache, setIsClearingCache] = useState(false);
  const [zipExportProgress, setZipExportProgress] = useState<{ done: number; total: number } | null>(null);
  const [isSavingOffline, setIsSavingOffline] = useState(false);
  const zipAbortRef = useRef<AbortController | null>(null);

  const effectiveKeys = useMemo(() => getEffectiveApiKeys(settings), [settings]);

  const commitDraftKeys = useCallback(
    (silent = false): number => {
      const parsed = parseApiKeysInput(draftKeyInput);
      if (parsed.length === 0) return 0;

      const existingSet = new Set(effectiveKeys);
      const nextKeys = [...effectiveKeys];
      let addedCount = 0;

      for (const candidate of parsed) {
        if (!existingSet.has(candidate)) {
          existingSet.add(candidate);
          nextKeys.push(candidate);
          addedCount += 1;
        }
      }

      if (addedCount > 0) {
        updateSettings({ apiKeys: nextKeys });
        if (!silent) {
          toast.success(
            addedCount === 1 ? 'API anahtarı eklendi.' : `${addedCount} API anahtarı eklendi.`,
          );
        }
      }
      setDraftKeyInput('');
      return addedCount;
    },
    [draftKeyInput, effectiveKeys, updateSettings],
  );

  const handleAddKeyButton = () => {
    const trimmed = draftKeyInput.trim();
    if (!trimmed) return;
    const parsed = parseApiKeysInput(trimmed);
    if (parsed.length === 0) {
      toast.error('Geçerli bir Gemini API anahtarı girin.');
      return;
    }
    const added = commitDraftKeys(false);
    if (added === 0) {
      toast.info('Bu anahtar zaten ekli.');
    }
  };

  const handleRemoveKey = (keyToRemove: string) => {
    const nextKeys = effectiveKeys.filter((item) => item !== keyToRemove);
    updateSettings({ apiKeys: nextKeys });
  };

  const handleClearAllKeys = () => {
    updateSettings({ apiKeys: [] });
    setDraftKeyInput('');
  };

  const handleStartTranslateAll = () => {
    if (draftKeyInput.trim()) {
      commitDraftKeys(true);
    }
    translation.translateAllPages();
  };

  const refreshStats = useCallback(async () => {
    try {
      const stats = await getTranslationCacheStats(chapterId, settings.targetLang);
      setCacheStats(stats);
    } catch {
      // Yoksay
    }
  }, [chapterId, settings.targetLang]);

  useEffect(() => {
    void refreshStats();
    return subscribeTranslationCache(() => {
      void refreshStats();
    });
  }, [refreshStats]);

  useEffect(() => () => {
    zipAbortRef.current?.abort();
  }, []);

  const filteredLanguages = useMemo(() => {
    const query = languageQuery.trim().toLocaleLowerCase('tr-TR');
    if (!query) return TRANSLATION_LANGUAGES;
    return TRANSLATION_LANGUAGES.filter(
      (lang) =>
        lang.name.toLocaleLowerCase('tr-TR').includes(query) ||
        lang.code.toLowerCase().includes(query),
    );
  }, [languageQuery]);

  const handleExportTranslatedZip = async () => {
    if (zipExportProgress) {
      zipAbortRef.current?.abort();
      zipAbortRef.current = null;
      setZipExportProgress(null);
      return;
    }

    if (summary.doneCount === 0) {
      toast.error('Önce en az bir sayfayı çevirin.');
      return;
    }

    const controller = new AbortController();
    zipAbortRef.current = controller;
    setZipExportProgress({ done: 0, total: pages.length });

    try {
      await downloadTranslatedChapterAsZip({
        mangaTitle,
        chapterNumber,
        targetLang: settings.targetLang,
        pages,
        pageStates,
        signal: controller.signal,
        onProgress: (done, total) => setZipExportProgress({ done, total }),
      });
      toast.success('Çevirili bölüm ZIP olarak indirildi.');
    } catch (err) {
      if (!isAbortTranslationError(err)) {
        toast.error(err instanceof Error ? err.message : 'Çevirili indirme başarısız oldu.');
      }
    } finally {
      zipAbortRef.current = null;
      setZipExportProgress(null);
    }
  };

  const handleSaveOfflineLibrary = async () => {
    if (!onQueueOfflineChapter || isSavingOffline) return;
    setIsSavingOffline(true);
    try {
      await onQueueOfflineChapter();
    } finally {
      setIsSavingOffline(false);
    }
  };

  const handleClearChapter = async () => {
    setIsClearingCache(true);
    try {
      await translation.clearCurrentChapterCache();
      await refreshStats();
      toast.success('Bu bölümün çeviri önbelleği temizlendi.');
    } finally {
      setIsClearingCache(false);
    }
  };

  const handleClearAll = async () => {
    setIsClearingCache(true);
    try {
      await translation.clearAllCache();
      await refreshStats();
      toast.success('Tüm çeviri önbelleği temizlendi.');
    } finally {
      setIsClearingCache(false);
    }
  };

  return (
    <div className="space-y-3.5">
      {/* Hızlı İşlemler ve İndirme */}
      <div className="space-y-2 rounded-xl border border-border/60 bg-secondary/35 p-2.5">
        <div className="flex items-center justify-between text-xs">
          <span className="font-medium text-muted-foreground">Çevrilen sayfa</span>
          <span className="font-semibold tabular-nums text-primary">
            {summary.doneCount} / {summary.totalPages}
          </span>
        </div>

        {summary.isBusy ? (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="h-8 w-full gap-1.5 rounded-lg border border-primary/35 text-xs font-semibold"
            onClick={translation.cancelTranslation}
          >
            <Square className="h-3.5 w-3.5 fill-current text-primary" />
            <span>Çeviriyi Durdur</span>
          </Button>
        ) : (
          <Button
            type="button"
            variant="default"
            size="sm"
            disabled={!isOnline || summary.totalPages === 0}
            className="h-8 w-full gap-1.5 rounded-lg text-xs font-semibold"
            onClick={handleStartTranslateAll}
          >
            <Languages className="h-3.5 w-3.5" />
            <span>Tüm Bölümü Çevir</span>
          </Button>
        )}

        <div className={cn('grid gap-1.5', !isOfflineMode && onQueueOfflineChapter ? 'grid-cols-2' : 'grid-cols-1')}>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={summary.doneCount === 0 && !zipExportProgress}
            onClick={() => void handleExportTranslatedZip()}
            className="h-8 gap-1.5 rounded-lg border-border/70 bg-background/60 px-2.5 text-[11px] font-medium hover:border-primary/40"
            title="Çevrilen balonları görsellere işleyerek ZIP olarak cihaza indirir"
          >
            {zipExportProgress ? (
              <>
                <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" />
                <span className="truncate">
                  {zipExportProgress.done}/{zipExportProgress.total}
                </span>
              </>
            ) : (
              <>
                <FolderDown className="h-3.5 w-3.5 shrink-0 text-primary" />
                <span className="truncate">Çevirili İndir</span>
              </>
            )}
          </Button>

          {!isOfflineMode && onQueueOfflineChapter && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!isOnline || isSavingOffline}
              onClick={() => void handleSaveOfflineLibrary()}
              className="h-8 gap-1.5 rounded-lg border-border/70 bg-background/60 px-2.5 text-[11px] font-medium hover:border-primary/40"
              title="Bölümü ve çevirilerini uygulama içi İndirilenler kütüphanesine kaydeder"
            >
              {isSavingOffline ? (
                <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" />
              ) : (
                <Download className="h-3.5 w-3.5 shrink-0 text-primary" />
              )}
              <span className="truncate">Çevrimdışı Kaydet</span>
            </Button>
          )}
        </div>

        {zipExportProgress && (
          <progress
            className="tp-progress block h-1 w-full"
            aria-label="Çevirili ZIP hazırlama ilerlemesi"
            max={zipExportProgress.total}
            value={zipExportProgress.done}
          />
        )}
      </div>

      {/* Çeviri Motoru Seçimi */}
      <div className="space-y-1.5">
        <Label className="text-xs font-semibold text-muted-foreground">Çeviri Motoru</Label>
        <div className="grid grid-cols-2 gap-1 rounded-xl border border-border/60 bg-secondary/40 p-1">
          <button
            type="button"
            onClick={() => updateSettings({ provider: 'gemini' })}
            className={cn(
              'flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-semibold transition-all',
              (settings.provider || 'gemini') === 'gemini'
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'text-muted-foreground hover:bg-secondary/70 hover:text-foreground',
            )}
          >
            <span>Gemini Flash</span>
          </button>
          <button
            type="button"
            onClick={() => updateSettings({ provider: 'google' })}
            className={cn(
              'flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-semibold transition-all',
              settings.provider === 'google'
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'text-muted-foreground hover:bg-secondary/70 hover:text-foreground',
            )}
          >
            <span>Google Çeviri</span>
            <span className="rounded bg-emerald-500/20 px-1 py-0.5 text-[9px] font-bold text-emerald-400">Ücretsiz</span>
          </button>
        </div>
        {settings.provider === 'google' && (
          <p className="text-[11px] leading-tight text-muted-foreground">
            Balonlar taranır, metinler Google Çeviri ile ücretsiz ve hızlı aktarılır.
          </p>
        )}
      </div>

      {/* Mod Seçenekleri */}
      <div className="space-y-2.5">
        <div className="flex items-center justify-between">
          <Label htmlFor="auto-translate" className="text-sm">
            Otomatik çeviri
          </Label>
          <Switch
            id="auto-translate"
            checked={settings.autoTranslate}
            onCheckedChange={(checked) => {
              if (checked && draftKeyInput.trim()) {
                commitDraftKeys(true);
              }
              updateSettings({ autoTranslate: checked });
            }}
          />
        </div>

        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <Label htmlFor="parallel-translate" className="text-sm">
              Paralel çeviri
            </Label>
            <p className="text-[11px] leading-tight text-muted-foreground">
              Sayfaları sırayla değil eşzamanlı çevirir
            </p>
          </div>
          <Switch
            id="parallel-translate"
            checked={settings.parallelMode}
            onCheckedChange={(checked) => updateSettings({ parallelMode: checked })}
          />
        </div>

        <div className="flex items-center justify-between">
          <Label htmlFor="overlay-visible" className="text-sm">
            Çevirileri göster
          </Label>
          <Switch
            id="overlay-visible"
            checked={settings.overlayVisible}
            onCheckedChange={(checked) => updateSettings({ overlayVisible: checked })}
          />
        </div>
      </div>

      {/* Hedef Dil */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label className="text-xs font-semibold text-muted-foreground">Hedef Dil</Label>
          <span className="text-xs font-medium text-primary">
            {getLanguageName(settings.targetLang)}
          </span>
        </div>
        <Input
          placeholder="Dil ara..."
          value={languageQuery}
          onChange={(event) => setLanguageQuery(event.target.value)}
          className="h-8 rounded-xl border-border/60 bg-secondary/50 text-xs focus-visible:border-primary/50 focus-visible:ring-1 focus-visible:ring-primary/30 focus-visible:ring-offset-0"
        />
        <div className="reader-scroll-thin max-h-32 space-y-0.5 overflow-y-auto rounded-xl border border-border/60 bg-background/45 p-1">
          {filteredLanguages.map((lang) => {
            const isSelected = settings.targetLang === lang.code;
            return (
              <button
                key={lang.code}
                type="button"
                onClick={() => updateSettings({ targetLang: lang.code })}
                className={cn(
                  'flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors',
                  isSelected
                    ? 'bg-primary/15 font-semibold text-primary'
                    : 'text-foreground/90 hover:bg-secondary/75',
                )}
              >
                <span>{lang.name}</span>
                {isSelected && <Check className="h-3.5 w-3.5 text-primary" />}
              </button>
            );
          })}
          {filteredLanguages.length === 0 && (
            <p className="px-2.5 py-2 text-xs text-muted-foreground">Sonuç bulunamadı</p>
          )}
        </div>
      </div>

      {/* Çoklu Gemini API Anahtarı */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <Label htmlFor="gemini-api-key" className="text-xs font-semibold text-muted-foreground">
            Gemini API Anahtarları
          </Label>
          <div className="flex items-center gap-1.5">
            {effectiveKeys.length > 0 && (
              <>
                <span className="rounded-md bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-primary">
                  {effectiveKeys.length} aktif
                </span>
                <button
                  type="button"
                  onClick={() => setRevealKeys((prev) => !prev)}
                  className="inline-flex h-5 w-5 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                  title={revealKeys ? 'Anahtarları gizle' : 'Anahtarları göster'}
                >
                  {revealKeys ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                </button>
              </>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <Input
            id="gemini-api-key"
            type={revealKeys ? 'text' : 'password'}
            autoComplete="off"
            placeholder={
              effectiveKeys.length > 0
                ? 'Ek anahtar ekle (AIza...)'
                : 'AIza... (çoklu yapıştırılabilir)'
            }
            value={draftKeyInput}
            onChange={(event) => setDraftKeyInput(event.target.value)}
            onBlur={() => {
              if (draftKeyInput.trim()) {
                commitDraftKeys(true);
              }
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                handleAddKeyButton();
              }
            }}
            className="h-8 flex-1 rounded-xl border-border/60 bg-secondary/50 text-xs focus-visible:border-primary/50 focus-visible:ring-1 focus-visible:ring-primary/30 focus-visible:ring-offset-0"
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!draftKeyInput.trim()}
            onClick={handleAddKeyButton}
            className="h-8 shrink-0 gap-1 rounded-xl border-border/70 bg-background/60 px-2.5 text-xs hover:border-primary/40"
          >
            <Plus className="h-3.5 w-3.5 text-primary" />
            <span>Ekle</span>
          </Button>
        </div>

        {effectiveKeys.length > 0 && (
          <div className="reader-scroll-thin max-h-28 space-y-1 overflow-y-auto rounded-xl border border-border/60 bg-background/45 p-1.5">
            {effectiveKeys.map((keyItem, idx) => (
              <div
                key={keyItem}
                className="flex items-center justify-between gap-2 rounded-lg bg-secondary/45 px-2 py-1 text-[11px]"
              >
                <div className="flex min-w-0 items-center gap-1.5">
                  <span className="shrink-0 font-semibold tabular-nums text-primary">
                    #{idx + 1}
                  </span>
                  <span className="truncate font-mono text-foreground/90">
                    {revealKeys ? keyItem : maskApiKey(keyItem)}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => handleRemoveKey(keyItem)}
                  className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/15 hover:text-red-300"
                  title="Anahtarı kaldır"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
            {effectiveKeys.length > 1 && (
              <div className="flex justify-end pt-0.5">
                <button
                  type="button"
                  onClick={handleClearAllKeys}
                  className="text-[10px] font-medium text-muted-foreground transition-colors hover:text-red-300"
                >
                  Tüm anahtarları kaldır
                </button>
              </div>
            )}
          </div>
        )}

        <p className="text-[11px] leading-snug text-muted-foreground">
          Tarayıcıda saklanır. Çoklu anahtarda kota (429) dolunca sıradaki anahtara geçer · aistudio.google.com
        </p>
      </div>

      {/* Önbellek Yönetimi */}
      <div className="space-y-2 rounded-xl border border-border/60 bg-secondary/30 p-2.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground/90">
            <Database className="h-3.5 w-3.5 text-primary" />
            <span>Çeviri Önbelleği</span>
          </div>
          <span className="text-[11px] font-medium tabular-nums text-muted-foreground">
            {formatBytes(cacheStats.totalBytes)}
          </span>
        </div>

        <p className="text-[11px] text-muted-foreground">
          Toplam {cacheStats.totalChapters} bölüm · {cacheStats.totalPages} sayfa
          {cacheStats.currentChapterPages > 0 && ` (Bu bölüm: ${cacheStats.currentChapterPages} sayfa)`}
        </p>

        <div className="grid grid-cols-2 gap-1.5">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={isClearingCache || (cacheStats.currentChapterPages === 0 && summary.doneCount === 0)}
            onClick={() => void handleClearChapter()}
            className="h-7 gap-1 rounded-lg border-border/60 bg-background/50 px-2 text-[11px] hover:border-primary/40"
          >
            <Trash2 className="h-3 w-3 text-muted-foreground" />
            <span>Bölümü Temizle</span>
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={isClearingCache || cacheStats.totalPages === 0}
            onClick={() => void handleClearAll()}
            className="h-7 gap-1 rounded-lg border-border/60 bg-background/50 px-2 text-[11px] hover:border-destructive/50 hover:text-red-300"
          >
            <Trash2 className="h-3 w-3 text-muted-foreground" />
            <span>Tümünü Temizle</span>
          </Button>
        </div>
      </div>
    </div>
  );
};

export default TranslationPanel;
