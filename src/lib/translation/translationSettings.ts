export interface TranslationSettings {
  apiKey: string;
  targetLang: string; // ISO 639-1 kodu, örn. 'en'
  autoTranslate: boolean;
  overlayVisible: boolean;
}

const STORAGE_KEY = 'toonparrot:translation-settings';

const DEFAULT_SETTINGS: TranslationSettings = {
  apiKey: '',
  targetLang: 'en',
  autoTranslate: false,
  overlayVisible: true,
};

export const loadTranslationSettings = (): TranslationSettings => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<TranslationSettings>;
    return {
      apiKey: typeof parsed.apiKey === 'string' ? parsed.apiKey : DEFAULT_SETTINGS.apiKey,
      targetLang: typeof parsed.targetLang === 'string' && parsed.targetLang ? parsed.targetLang : DEFAULT_SETTINGS.targetLang,
      autoTranslate: typeof parsed.autoTranslate === 'boolean' ? parsed.autoTranslate : DEFAULT_SETTINGS.autoTranslate,
      overlayVisible: typeof parsed.overlayVisible === 'boolean' ? parsed.overlayVisible : DEFAULT_SETTINGS.overlayVisible,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
};

export const saveTranslationSettings = (settings: TranslationSettings) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // localStorage kullanılamıyorsa ayarlar oturumla sınırlı kalır.
  }
};
