import React, { useMemo, useState } from 'react';
import { Check } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { TranslationSettings } from '@/lib/translation/translationSettings';
import { TRANSLATION_LANGUAGES, getLanguageName } from '@/lib/translation/languages';
import { cn } from '@/lib/utils';

interface TranslationPanelProps {
  settings: TranslationSettings;
  onChange: (patch: Partial<TranslationSettings>) => void;
}

const TranslationPanel: React.FC<TranslationPanelProps> = ({ settings, onChange }) => {
  const [languageQuery, setLanguageQuery] = useState('');

  const filteredLanguages = useMemo(() => {
    const query = languageQuery.trim().toLocaleLowerCase('tr-TR');
    if (!query) return TRANSLATION_LANGUAGES;
    return TRANSLATION_LANGUAGES.filter(
      (lang) =>
        lang.name.toLocaleLowerCase('tr-TR').includes(query)
        || lang.code.toLowerCase().includes(query),
    );
  }, [languageQuery]);

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="gemini-api-key" className="text-xs font-semibold uppercase text-muted-foreground">
          Gemini API Anahtarı
        </Label>
        <Input
          id="gemini-api-key"
          type="password"
          autoComplete="off"
          placeholder="AIza..."
          value={settings.apiKey}
          onChange={(event) => onChange({ apiKey: event.target.value.trim() })}
        />
        <p className="text-[11px] leading-snug text-muted-foreground">
          Anahtar yalnızca bu tarayıcıda saklanır. aistudio.google.com adresinden ücretsiz alabilirsiniz.
        </p>
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs font-semibold uppercase text-muted-foreground">
          Hedef Dil: {getLanguageName(settings.targetLang)}
        </Label>
        <Input
          placeholder="Dil ara..."
          value={languageQuery}
          onChange={(event) => setLanguageQuery(event.target.value)}
        />
        <div className="max-h-40 space-y-0.5 overflow-y-auto rounded-lg border border-border/60 p-1">
          {filteredLanguages.map((lang) => (
            <button
              key={lang.code}
              type="button"
              onClick={() => onChange({ targetLang: lang.code })}
              className={cn(
                'flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent',
                settings.targetLang === lang.code && 'bg-accent font-medium',
              )}
            >
              <span>{lang.name}</span>
              {settings.targetLang === lang.code && <Check className="h-4 w-4" />}
            </button>
          ))}
          {filteredLanguages.length === 0 && (
            <p className="px-2 py-1.5 text-sm text-muted-foreground">Sonuç bulunamadı</p>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between">
        <Label htmlFor="auto-translate" className="text-sm">Otomatik çeviri</Label>
        <Switch
          id="auto-translate"
          checked={settings.autoTranslate}
          onCheckedChange={(checked) => onChange({ autoTranslate: checked })}
        />
      </div>

      <div className="flex items-center justify-between">
        <Label htmlFor="overlay-visible" className="text-sm">Çevirileri göster</Label>
        <Switch
          id="overlay-visible"
          checked={settings.overlayVisible}
          onCheckedChange={(checked) => onChange({ overlayVisible: checked })}
        />
      </div>
    </div>
  );
};

export default TranslationPanel;
