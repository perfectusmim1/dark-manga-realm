export interface TranslationSettings {
  apiKey: string;
  apiKeys: string[];
  targetLang: string; // ISO 639-1 kodu, örn. 'tr'
  autoTranslate: boolean;
  parallelMode: boolean;
  overlayVisible: boolean;
}

const STORAGE_KEY = 'toonparrot:translation-settings';

const DEFAULT_SETTINGS: TranslationSettings = {
  apiKey: '',
  apiKeys: [],
  targetLang: 'tr',
  autoTranslate: false,
  parallelMode: false,
  overlayVisible: true,
};

export const parseApiKeysInput = (raw: string): string[] => {
  if (!raw || typeof raw !== 'string') return [];
  const seen = new Set<string>();
  const result: string[] = [];

  for (const token of raw.split(/[\s,;]+/)) {
    const cleaned = token.replace(/^['"`]+|['"`]+$/g, '').trim();
    if (cleaned.length < 12 || seen.has(cleaned)) continue;
    seen.add(cleaned);
    result.push(cleaned);
  }

  return result;
};

export const normalizeApiKeysList = (
  keys?: readonly unknown[] | null,
  legacyKey?: string | null,
): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];

  const pushCandidate = (value: unknown) => {
    if (typeof value !== 'string') return;
    for (const parsed of parseApiKeysInput(value)) {
      if (!seen.has(parsed)) {
        seen.add(parsed);
        result.push(parsed);
      }
    }
  };

  if (Array.isArray(keys)) {
    keys.forEach(pushCandidate);
  }
  if (typeof legacyKey === 'string' && legacyKey.trim()) {
    pushCandidate(legacyKey);
  }

  return result;
};

export const getEffectiveApiKeys = (
  settings: Pick<TranslationSettings, 'apiKey'> & { apiKeys?: readonly string[] },
): string[] => normalizeApiKeysList(settings.apiKeys, settings.apiKey);

export const maskApiKey = (key: string): string => {
  const trimmed = key.trim();
  if (trimmed.length <= 10) return '••••••••';
  return `${trimmed.slice(0, 6)}••••••${trimmed.slice(-4)}`;
};

export const loadTranslationSettings = (): TranslationSettings => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<TranslationSettings>;
    const apiKeys = normalizeApiKeysList(parsed.apiKeys, parsed.apiKey);
    return {
      apiKey: apiKeys[0] || '',
      apiKeys,
      targetLang:
        typeof parsed.targetLang === 'string' && parsed.targetLang
          ? parsed.targetLang
          : DEFAULT_SETTINGS.targetLang,
      autoTranslate:
        typeof parsed.autoTranslate === 'boolean'
          ? parsed.autoTranslate
          : DEFAULT_SETTINGS.autoTranslate,
      parallelMode:
        typeof parsed.parallelMode === 'boolean'
          ? parsed.parallelMode
          : DEFAULT_SETTINGS.parallelMode,
      overlayVisible:
        typeof parsed.overlayVisible === 'boolean'
          ? parsed.overlayVisible
          : DEFAULT_SETTINGS.overlayVisible,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
};

export const saveTranslationSettings = (settings: TranslationSettings) => {
  try {
    const apiKeys = normalizeApiKeysList(settings.apiKeys, settings.apiKey);
    const normalized: TranslationSettings = {
      ...settings,
      apiKeys,
      apiKey: apiKeys[0] || '',
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
  } catch {
    // localStorage kullanılamıyorsa ayarlar oturumla sınırlı kalır.
  }
};
