# Görsel Çeviri Özelliği — Implementasyon Planı

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Okuyucudaki sayfa görsellerini Gemini ile (OCR + çeviri tek çağrıda) hedef dile çevirip balonların üzerine overlay basmak; sonuçları Supabase'de ortak önbelleğe almak.

**Architecture:** Tarayıcıdan doğrudan Gemini `gemini-3.5-flash-lite` çağrısı (kullanıcının kendi API anahtarı, localStorage). Yanıt: 0-1000 normalize `box_2d` + çeviri metni (JSON şema zorunlu). Sonuçlar `page_translations` tablosuna upsert edilir; overlay %-tabanlı konumla `ProtectedImage` içine render edilir. Auto modda eşzamanlılık-2 sıralı kuyruk.

**Tech Stack:** React 18 + TS, `@google/genai` (yeni), Supabase JS, shadcn/ui (Popover/Switch/Input), Tailwind.

**Doğrulama notu:** Projede test framework'ü YOK (package.json'da vitest/jest yok). Her görevin doğrulaması: `npx tsc --noEmit -p tsconfig.app.json` + IDE diagnostics + Task 9'daki manuel test listesi. Yeni test altyapısı EKLEME (YAGNI).

**Spec:** `docs/superpowers/specs/2026-07-26-visual-translation-design.md`

**Kritik codebase gerçekleri (spec'ten farklı/netleşen):**
- `public.chapters.id` ve `public.users.id` **text** tipinde (uuid DEĞİL). Migration buna göre yazıldı.
- Supabase istemcisi: `import { supabase } from '@/lib/supabase'`.
- Reader.tsx'te: `chapterId` (useParams), `currentPage`, `resolvedPages: ResolvedReaderPage[]`, `canUseNetworkReaderFeatures: boolean` mevcut.
- Görseller `ProtectedImage` (canvas) ile çizilir; overlay tam hizalama için `ProtectedImage`'a `overlay` prop'u eklenir.

---

### Task 1: Bağımlılık + DB migration

**Files:**
- Create: `supabase/migrations/20260726090000_add_page_translations.sql`
- Modify: `package.json` (npm install ile)

- [ ] **Step 1: Paketi kur**

Run: `npm install @google/genai`
Expected: package.json dependencies'e `@google/genai` eklenir, hata yok.

- [ ] **Step 2: Migration dosyasını yaz**

`supabase/migrations/20260726090000_add_page_translations.sql`:

```sql
create table if not exists public.page_translations (
    chapter_id text not null references public.chapters (id) on delete cascade,
    page_index integer not null,
    lang text not null,
    blocks jsonb not null,
    created_by text default (auth.uid()::text),
    created_at timestamp with time zone not null default now(),
    updated_at timestamp with time zone not null default now(),
    constraint page_translations_pkey primary key (chapter_id, page_index, lang),
    constraint page_translations_page_index_check check (page_index >= 0),
    constraint page_translations_lang_check check (char_length(lang) between 2 and 12),
    constraint page_translations_blocks_check check (jsonb_typeof(blocks) = 'array')
);

create index if not exists idx_page_translations_chapter_lang
    on public.page_translations (chapter_id, lang);

alter table public.page_translations enable row level security;

drop policy if exists "Anyone can view page translations" on public.page_translations;
create policy "Anyone can view page translations"
    on public.page_translations
    for select
    to anon, authenticated
    using (true);

drop policy if exists "Authenticated users can insert page translations" on public.page_translations;
create policy "Authenticated users can insert page translations"
    on public.page_translations
    for insert
    to authenticated
    with check (auth.uid() is not null);

drop policy if exists "Authenticated users can update page translations" on public.page_translations;
create policy "Authenticated users can update page translations"
    on public.page_translations
    for update
    to authenticated
    using (auth.uid() is not null)
    with check (auth.uid() is not null);
```

- [ ] **Step 3: Migration'ı uygula**

Run: `supabase db push`
Expected: `20260726090000_add_page_translations.sql` uygulanır. (CLI bağlı hesapla; onay sorarsa kullanıcıya danış.)

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260726090000_add_page_translations.sql package.json package-lock.json
git commit -m "feat(translation): page_translations tablosu ve @google/genai bağımlılığı"
```

---

### Task 2: Çekirdek tipler, ayarlar, dil listesi

**Files:**
- Create: `src/lib/translation/types.ts`
- Create: `src/lib/translation/translationSettings.ts`
- Create: `src/lib/translation/languages.ts`

- [ ] **Step 1: `src/lib/translation/types.ts` yaz**

```ts
// Bir konuşma balonunun çevirisi. box: [ymin, xmin, ymax, xmax], 0-1000 normalize.
export interface TranslationBlock {
  box: [number, number, number, number];
  text: string;
}

export type PageTranslationStatus = 'idle' | 'queued' | 'translating' | 'done' | 'error';

export interface PageTranslationState {
  status: PageTranslationStatus;
  blocks?: TranslationBlock[];
}
```

- [ ] **Step 2: `src/lib/translation/translationSettings.ts` yaz**

```ts
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
```

- [ ] **Step 3: `src/lib/translation/languages.ts` yaz**

```ts
export interface TranslationLanguage {
  code: string; // ISO 639-1 (Gemini prompt'unda kullanılır)
  name: string; // Türkçe görünen ad
}

export const TRANSLATION_LANGUAGES: TranslationLanguage[] = [
  { code: 'en', name: 'İngilizce' },
  { code: 'es', name: 'İspanyolca' },
  { code: 'fr', name: 'Fransızca' },
  { code: 'de', name: 'Almanca' },
  { code: 'it', name: 'İtalyanca' },
  { code: 'pt', name: 'Portekizce' },
  { code: 'ru', name: 'Rusça' },
  { code: 'ja', name: 'Japonca' },
  { code: 'ko', name: 'Korece' },
  { code: 'zh', name: 'Çince (Basitleştirilmiş)' },
  { code: 'zh-TW', name: 'Çince (Geleneksel)' },
  { code: 'ar', name: 'Arapça' },
  { code: 'hi', name: 'Hintçe' },
  { code: 'id', name: 'Endonezce' },
  { code: 'tr', name: 'Türkçe' },
  { code: 'nl', name: 'Felemenkçe' },
  { code: 'pl', name: 'Lehçe' },
  { code: 'sv', name: 'İsveççe' },
  { code: 'no', name: 'Norveççe' },
  { code: 'da', name: 'Danca' },
  { code: 'fi', name: 'Fince' },
  { code: 'el', name: 'Yunanca' },
  { code: 'cs', name: 'Çekçe' },
  { code: 'sk', name: 'Slovakça' },
  { code: 'hu', name: 'Macarca' },
  { code: 'ro', name: 'Rumence' },
  { code: 'bg', name: 'Bulgarca' },
  { code: 'uk', name: 'Ukraynaca' },
  { code: 'sr', name: 'Sırpça' },
  { code: 'hr', name: 'Hırvatça' },
  { code: 'bs', name: 'Boşnakça' },
  { code: 'sl', name: 'Slovence' },
  { code: 'mk', name: 'Makedonca' },
  { code: 'sq', name: 'Arnavutça' },
  { code: 'az', name: 'Azerice' },
  { code: 'kk', name: 'Kazakça' },
  { code: 'uz', name: 'Özbekçe' },
  { code: 'ky', name: 'Kırgızca' },
  { code: 'tk', name: 'Türkmence' },
  { code: 'tt', name: 'Tatarca' },
  { code: 'fa', name: 'Farsça' },
  { code: 'ur', name: 'Urduca' },
  { code: 'he', name: 'İbranice' },
  { code: 'th', name: 'Tayca' },
  { code: 'vi', name: 'Vietnamca' },
  { code: 'ms', name: 'Malayca' },
  { code: 'tl', name: 'Filipince (Tagalog)' },
  { code: 'bn', name: 'Bengalce' },
  { code: 'ta', name: 'Tamilce' },
  { code: 'te', name: 'Teluguca' },
  { code: 'ml', name: 'Malayalamca' },
  { code: 'kn', name: 'Kannadaca' },
  { code: 'mr', name: 'Marathice' },
  { code: 'gu', name: 'Güceratça' },
  { code: 'pa', name: 'Pencapça' },
  { code: 'ne', name: 'Nepalce' },
  { code: 'si', name: 'Sinhalaca' },
  { code: 'my', name: 'Birmanca' },
  { code: 'km', name: 'Kmerce' },
  { code: 'lo', name: 'Laoca' },
  { code: 'mn', name: 'Moğolca' },
  { code: 'ka', name: 'Gürcüce' },
  { code: 'hy', name: 'Ermenice' },
  { code: 'am', name: 'Amharca' },
  { code: 'sw', name: 'Svahilice' },
  { code: 'ha', name: 'Hausaca' },
  { code: 'yo', name: 'Yorubaca' },
  { code: 'zu', name: 'Zuluca' },
  { code: 'af', name: 'Afrikaanca' },
  { code: 'et', name: 'Estonca' },
  { code: 'lv', name: 'Letonca' },
  { code: 'lt', name: 'Litvanca' },
  { code: 'be', name: 'Belarusça' },
  { code: 'ca', name: 'Katalanca' },
  { code: 'gl', name: 'Galiçyaca' },
  { code: 'eu', name: 'Baskça' },
  { code: 'is', name: 'İzlandaca' },
  { code: 'ga', name: 'İrlandaca' },
  { code: 'mt', name: 'Maltaca' },
  { code: 'lb', name: 'Lüksemburgca' },
];

export const getLanguageName = (code: string): string =>
  TRANSLATION_LANGUAGES.find((lang) => lang.code === code)?.name ?? code;
```

- [ ] **Step 4: Tip kontrolü**

Run: `npx tsc --noEmit -p tsconfig.app.json`
Expected: hata yok.

- [ ] **Step 5: Commit**

```bash
git add src/lib/translation/types.ts src/lib/translation/translationSettings.ts src/lib/translation/languages.ts
git commit -m "feat(translation): tipler, localStorage ayarları ve dil listesi"
```

---

### Task 3: Gemini çevirmen modülü

**Files:**
- Create: `src/lib/translation/geminiTranslator.ts`

- [ ] **Step 1: `src/lib/translation/geminiTranslator.ts` yaz**

NOT: `ThinkingLevel` export'u `@google/genai` sürümüne göre değişebilir. Önce `node_modules/@google/genai/dist` tip tanımlarında `ThinkingLevel` var mı kontrol et; yoksa `thinkingConfig: { thinkingBudget: 0 }` kullan (aynı etki: minimal düşünme).

```ts
import { GoogleGenAI, Type, ThinkingLevel } from '@google/genai';
import { TranslationBlock } from './types';
import { getLanguageName } from './languages';

const MODEL = 'gemini-3.5-flash-lite';
const RETRY_DELAYS_MS = [5000, 15000];

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    blocks: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          box_2d: { type: Type.ARRAY, items: { type: Type.INTEGER } },
          text: { type: Type.STRING },
        },
        required: ['box_2d', 'text'],
      },
    },
  },
  required: ['blocks'],
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const fetchImageAsBase64 = async (src: string): Promise<{ data: string; mimeType: string }> => {
  const response = await fetch(src);
  if (!response.ok) {
    throw new Error(`Görsel alınamadı (${response.status})`);
  }
  const blob = await response.blob();
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Görsel okunamadı'));
    reader.readAsDataURL(blob);
  });
  const base64 = dataUrl.split(',')[1];
  if (!base64) {
    throw new Error('Görsel base64 dönüşümü başarısız');
  }
  return { data: base64, mimeType: blob.type || 'image/webp' };
};

const isRateLimitError = (error: unknown) => {
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return message.includes('429') || message.includes('resource_exhausted') || message.includes('quota');
};

// Halüsinasyon koruması: şemaya uymayan, koordinatı taşan veya boş yanıtlar reddedilir.
const parseBlocks = (raw: string): TranslationBlock[] => {
  let parsed: { blocks?: unknown };
  try {
    parsed = JSON.parse(raw) as { blocks?: unknown };
  } catch {
    throw new Error('Çeviri yanıtı JSON olarak çözümlenemedi');
  }
  if (!parsed || !Array.isArray(parsed.blocks) || parsed.blocks.length === 0) {
    throw new Error('Çeviri yanıtında balon bulunamadı');
  }
  return parsed.blocks.map((entry) => {
    const { box_2d: rawBox, text } = entry as { box_2d?: unknown; text?: unknown };
    if (!Array.isArray(rawBox) || rawBox.length !== 4 || typeof text !== 'string' || !text.trim()) {
      throw new Error('Çeviri yanıtı beklenen şemaya uymuyor');
    }
    const box = rawBox.map(Number);
    if (box.some((value) => !Number.isFinite(value) || value < 0 || value > 1000)) {
      throw new Error('Çeviri koordinatları 0-1000 aralığının dışında');
    }
    const [ymin, xmin, ymax, xmax] = box;
    if (ymin >= ymax || xmin >= xmax) {
      throw new Error('Çeviri koordinatları geçersiz (min >= max)');
    }
    return { box: [ymin, xmin, ymax, xmax] as [number, number, number, number], text: text.trim() };
  });
};

interface TranslatePageOptions {
  apiKey: string;
  imageSrc: string;
  targetLang: string;
}

export const translatePageImage = async ({ apiKey, imageSrc, targetLang }: TranslatePageOptions): Promise<TranslationBlock[]> => {
  const { data, mimeType } = await fetchImageAsBase64(imageSrc);
  const ai = new GoogleGenAI({ apiKey });
  const prompt = [
    'You are a professional comic/webtoon translator.',
    'Detect every speech bubble, caption box and narration text in this comic page image.',
    `Translate each one into ${getLanguageName(targetLang)} (ISO 639-1 code: "${targetLang}").`,
    'Return ONLY JSON matching the schema: blocks = array of { box_2d: [ymin, xmin, ymax, xmax] normalized to 0-1000 covering the text area, text: the translated text }.',
    'Keep reading order (top to bottom). Keep translations natural and concise so they fit inside the bubbles.',
    'Do not include the original untranslated text. Skip watermarks and logos.',
  ].join(' ');

  let lastError: unknown;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      const response = await ai.models.generateContent({
        model: MODEL,
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
          responseMimeType: 'application/json',
          responseSchema: RESPONSE_SCHEMA,
        },
        contents: [
          {
            role: 'user',
            parts: [
              { inlineData: { data, mimeType } },
              { text: prompt },
            ],
          },
        ],
      });
      return parseBlocks(response.text ?? '');
    } catch (error) {
      lastError = error;
      if (isRateLimitError(error) && attempt < RETRY_DELAYS_MS.length) {
        await sleep(RETRY_DELAYS_MS[attempt]);
        continue;
      }
      throw error;
    }
  }
  throw lastError;
};
```

- [ ] **Step 2: Tip kontrolü**

Run: `npx tsc --noEmit -p tsconfig.app.json`
Expected: hata yok. `ThinkingLevel` bulunamazsa Step 1'deki nota göre `thinkingBudget: 0` kullan ve importu düzelt.

- [ ] **Step 3: Commit**

```bash
git add src/lib/translation/geminiTranslator.ts
git commit -m "feat(translation): Gemini görsel çeviri modülü (şema doğrulama + 429 backoff)"
```

---

### Task 4: Supabase önbellek modülü

**Files:**
- Create: `src/lib/translation/translationCache.ts`

- [ ] **Step 1: `src/lib/translation/translationCache.ts` yaz**

```ts
import { supabase } from '@/lib/supabase';
import { TranslationBlock } from './types';

// Bölümün seçili dildeki tüm sayfa çevirilerini tek sorguda getirir.
export const getCachedChapterTranslations = async (
  chapterId: string,
  lang: string,
): Promise<Map<number, TranslationBlock[]>> => {
  const { data, error } = await supabase
    .from('page_translations')
    .select('page_index, blocks')
    .eq('chapter_id', chapterId)
    .eq('lang', lang);

  if (error) throw error;

  const result = new Map<number, TranslationBlock[]>();
  (data ?? []).forEach((row) => {
    if (typeof row.page_index === 'number' && Array.isArray(row.blocks)) {
      result.set(row.page_index, row.blocks as unknown as TranslationBlock[]);
    }
  });
  return result;
};

// "Yeniden Çevir" dahil tüm yazmalar aynı tekil anahtara upsert eder.
export const upsertPageTranslation = async (
  chapterId: string,
  pageIndex: number,
  lang: string,
  blocks: TranslationBlock[],
): Promise<void> => {
  const { error } = await supabase
    .from('page_translations')
    .upsert(
      {
        chapter_id: chapterId,
        page_index: pageIndex,
        lang,
        blocks,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'chapter_id,page_index,lang' },
    );

  if (error) throw error;
};
```

- [ ] **Step 2: Tip kontrolü**

Run: `npx tsc --noEmit -p tsconfig.app.json`
Expected: hata yok. (`page_translations` `Database` tipinde tanımlı değilse supabase istemcisi untyped kabul eder; tip hatası çıkarsa sorgu sonucunu `as` ile daralt.)

- [ ] **Step 3: Commit**

```bash
git add src/lib/translation/translationCache.ts
git commit -m "feat(translation): Supabase çeviri önbelleği (toplu okuma + upsert)"
```

---

### Task 5: `useChapterTranslation` hook'u (kuyruk + durum)

**Files:**
- Create: `src/hooks/useChapterTranslation.ts`

- [ ] **Step 1: `src/hooks/useChapterTranslation.ts` yaz**

```ts
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { ResolvedReaderPage } from '@/lib/types';
import { PageTranslationState, TranslationBlock } from '@/lib/translation/types';
import {
  TranslationSettings,
  loadTranslationSettings,
  saveTranslationSettings,
} from '@/lib/translation/translationSettings';
import { translatePageImage } from '@/lib/translation/geminiTranslator';
import {
  getCachedChapterTranslations,
  upsertPageTranslation,
} from '@/lib/translation/translationCache';

const MAX_CONCURRENT_TRANSLATIONS = 2;

export interface ReaderTranslationApi {
  enabled: boolean;
  settings: TranslationSettings;
  updateSettings: (patch: Partial<TranslationSettings>) => void;
  pageStates: Record<number, PageTranslationState>;
  translatePage: (pageIndex: number, options?: { force?: boolean }) => void;
}

interface UseChapterTranslationOptions {
  chapterId: string;
  pages: ResolvedReaderPage[];
  currentPage: number;
  networkEnabled: boolean;
}

export const useChapterTranslation = ({
  chapterId,
  pages,
  currentPage,
  networkEnabled,
}: UseChapterTranslationOptions): ReaderTranslationApi => {
  const [settings, setSettings] = useState<TranslationSettings>(() => loadTranslationSettings());
  const [pageStates, setPageStates] = useState<Record<number, PageTranslationState>>({});
  const [cacheReady, setCacheReady] = useState(false);

  const queueRef = useRef<number[]>([]);
  const runningRef = useRef(0);
  const statesRef = useRef<Record<number, PageTranslationState>>({});
  const settingsRef = useRef(settings);
  const pagesRef = useRef(pages);
  const chapterRef = useRef(chapterId);

  settingsRef.current = settings;
  pagesRef.current = pages;

  const setPageState = useCallback((index: number, state: PageTranslationState) => {
    // statesRef senkron güncellenir ki kuyruk döngüsü render beklemeden doğru durumu görsün.
    statesRef.current = { ...statesRef.current, [index]: state };
    setPageStates(statesRef.current);
  }, []);

  const updateSettings = useCallback((patch: Partial<TranslationSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      saveTranslationSettings(next);
      return next;
    });
  }, []);

  // Bölüm veya hedef dil değişince durumları sıfırla, ortak önbelleği yükle.
  useEffect(() => {
    chapterRef.current = chapterId;
    queueRef.current = [];
    statesRef.current = {};
    setPageStates({});
    setCacheReady(false);
    if (!chapterId || !networkEnabled) {
      setCacheReady(true);
      return;
    }

    let cancelled = false;
    getCachedChapterTranslations(chapterId, settings.targetLang)
      .then((cached) => {
        if (cancelled || chapterRef.current !== chapterId) return;
        const next: Record<number, PageTranslationState> = {};
        cached.forEach((blocks, index) => {
          next[index] = { status: 'done', blocks };
        });
        statesRef.current = next;
        setPageStates(next);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setCacheReady(true);
      });

    return () => {
      cancelled = true;
    };
  }, [chapterId, settings.targetLang, networkEnabled]);

  const runQueue = useCallback(() => {
    while (runningRef.current < MAX_CONCURRENT_TRANSLATIONS && queueRef.current.length > 0) {
      const index = queueRef.current.shift() as number;
      const state = statesRef.current[index];
      if (state && (state.status === 'translating' || state.status === 'done')) continue;

      const src = pagesRef.current[index]?.src;
      if (!src) continue;

      const chapterAtStart = chapterRef.current;
      const langAtStart = settingsRef.current.targetLang;

      runningRef.current += 1;
      setPageState(index, { status: 'translating' });

      translatePageImage({ apiKey: settingsRef.current.apiKey, imageSrc: src, targetLang: langAtStart })
        .then(async (blocks: TranslationBlock[]) => {
          if (chapterRef.current !== chapterAtStart || settingsRef.current.targetLang !== langAtStart) return;
          setPageState(index, { status: 'done', blocks });
          try {
            await upsertPageTranslation(chapterAtStart, index, langAtStart, blocks);
          } catch {
            // Önbelleğe yazılamasa bile çeviri kullanıcıya gösterilir (örn. giriş yapılmamış).
          }
        })
        .catch(() => {
          if (chapterRef.current !== chapterAtStart || settingsRef.current.targetLang !== langAtStart) return;
          setPageState(index, { status: 'error' });
        })
        .finally(() => {
          runningRef.current -= 1;
          runQueue();
        });
    }
  }, [setPageState]);

  const translatePage = useCallback(
    (pageIndex: number, options?: { force?: boolean }) => {
      if (!networkEnabled) return;
      if (!settingsRef.current.apiKey) {
        toast.error('Önce çeviri ayarlarından Gemini API anahtarını girin.');
        return;
      }
      const state = statesRef.current[pageIndex];
      if (!options?.force && state && ['queued', 'translating', 'done'].includes(state.status)) return;

      setPageState(pageIndex, { status: 'queued' });
      queueRef.current = [pageIndex, ...queueRef.current.filter((i) => i !== pageIndex)];
      runQueue();
    },
    [networkEnabled, runQueue, setPageState],
  );

  // Auto-translate: önbellek yüklendikten sonra çevrilmemiş sayfaları
  // aktif sayfadan başlayarak sıralı kuyruğa ekler.
  useEffect(() => {
    if (!settings.autoTranslate || !settings.apiKey || !networkEnabled || !cacheReady || !chapterId || pages.length === 0) {
      return;
    }
    const startIndex = Math.max(0, currentPage - 1);
    const order: number[] = [];
    for (let i = startIndex; i < pages.length; i += 1) order.push(i);
    for (let i = 0; i < startIndex; i += 1) order.push(i);

    const queuedSet = new Set(queueRef.current);
    const additions = order.filter((index) => {
      const state = statesRef.current[index];
      const pending = !state || state.status === 'idle';
      return pending && !queuedSet.has(index);
    });
    if (additions.length === 0) return;

    additions.forEach((index) => setPageState(index, { status: 'queued' }));
    queueRef.current = [...queueRef.current, ...additions];
    runQueue();
  }, [settings.autoTranslate, settings.apiKey, settings.targetLang, networkEnabled, cacheReady, chapterId, pages.length, currentPage, runQueue, setPageState]);

  // Auto kapatılınca bekleyen kuyruğu boşalt (çalışan 2 istek doğal biter).
  useEffect(() => {
    if (settings.autoTranslate) return;
    const pending = queueRef.current;
    queueRef.current = [];
    pending.forEach((index) => {
      if (statesRef.current[index]?.status === 'queued') {
        setPageState(index, { status: 'idle' });
      }
    });
  }, [settings.autoTranslate, setPageState]);

  // Kullanıcı sayfa değiştirince aktif sayfa kuyruğun başına alınır.
  useEffect(() => {
    const index = currentPage - 1;
    if (queueRef.current.includes(index)) {
      queueRef.current = [index, ...queueRef.current.filter((i) => i !== index)];
    }
  }, [currentPage]);

  return {
    enabled: networkEnabled,
    settings,
    updateSettings,
    pageStates,
    translatePage,
  };
};
```

- [ ] **Step 2: Tip kontrolü**

Run: `npx tsc --noEmit -p tsconfig.app.json`
Expected: hata yok.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useChapterTranslation.ts
git commit -m "feat(translation): bölüm çeviri hook'u (sıralı kuyruk, auto mod, önbellek)"
```

---

### Task 6: Overlay + sayfa başına Çevir butonu + ProtectedImage entegrasyonu

**Files:**
- Create: `src/components/reader/TranslationOverlay.tsx`
- Modify: `src/components/security/ProtectedImage.tsx`

- [ ] **Step 1: `src/components/reader/TranslationOverlay.tsx` yaz**

```tsx
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
          }}
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
```

NOT: `containerType: 'size'` TS hatası verirse stil nesnesini `as React.CSSProperties` ile işaretle (csstype eski sürümlerinde alan adı `containerType` tanımlı olmayabilir).

- [ ] **Step 2: `ProtectedImage.tsx`'e `overlay` prop'u ekle**

`ProtectedImageProps`'a ekle:

```ts
    overlay?: React.ReactNode;
```

Bileşen imzasındaki destructuring'e `overlay,` ekle. Return bloğunda koruma katmanının HEMEN ALTINA (kapanış `</div>`den önce) ekle:

```tsx
            {/* Absolute protection overlay - hardest to bypass */}
            <div
                className="absolute inset-0 z-10 bg-transparent cursor-default protection-layer"
                onContextMenu={(e) => e.preventDefault()}
                style={{ pointerEvents: 'auto' }}
            />

            {overlay}
        </div>
```

Overlay z-20/z-30 katmanlarında olduğu için koruma katmanının (z-10) üstünde kalır; `TranslationOverlay` pointer-events-none olduğundan koruma davranışı bozulmaz.

- [ ] **Step 3: Tip kontrolü + Commit**

Run: `npx tsc --noEmit -p tsconfig.app.json`
Expected: hata yok.

```bash
git add src/components/reader/TranslationOverlay.tsx src/components/security/ProtectedImage.tsx
git commit -m "feat(translation): overlay bileşeni, sayfa çevir butonu ve ProtectedImage overlay desteği"
```

---

### Task 7: Çeviri paneli + ReaderControls butonu

**Files:**
- Create: `src/components/reader/TranslationPanel.tsx`
- Modify: `src/components/reader/ReaderControls.tsx`

- [ ] **Step 1: `src/components/reader/TranslationPanel.tsx` yaz**

```tsx
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
```

- [ ] **Step 2: `ReaderControls.tsx`'e çeviri butonu ekle**

1. lucide importlarına `Languages,` ekle (mevcut `Search,` satırının altına).
2. Import bloğuna ekle:

```ts
import TranslationPanel from '@/components/reader/TranslationPanel';
import { TranslationSettings } from '@/lib/translation/translationSettings';
```

3. `ReaderControlsProps`'a ekle (`onBeforeChapterChange` satırının altına):

```ts
  translationSettings: TranslationSettings;
  onTranslationSettingsChange: (patch: Partial<TranslationSettings>) => void;
```

4. Bileşen destructuring'ine `translationSettings,` ve `onTranslationSettingsChange,` ekle.
5. Settings Popover'ının HEMEN ÖNÜNE (satır ~347'deki `<Popover>` bloğundan önce) ekle:

```tsx
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8 sm:h-10 sm:w-10" aria-label="Çeviri ayarları">
                  <Languages className="h-4 w-4 sm:h-5 sm:w-5" />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-[min(20rem,calc(100vw-1rem))] rounded-2xl border-border/60 bg-popover/95 p-3 shadow-2xl backdrop-blur-xl sm:w-80 sm:p-4">
                <TranslationPanel settings={translationSettings} onChange={onTranslationSettingsChange} />
              </PopoverContent>
            </Popover>
```

- [ ] **Step 3: Tip kontrolü + Commit**

Run: `npx tsc --noEmit -p tsconfig.app.json`
Expected: SADECE `Reader.tsx`'te "translationSettings eksik" hatası (Task 8'de düzelir). Başka hata olmamalı.

```bash
git add src/components/reader/TranslationPanel.tsx src/components/reader/ReaderControls.tsx
git commit -m "feat(translation): çeviri ayar paneli ve okuyucu üst çubuğu butonu"
```

---

### Task 8: Reader + VerticalReader + HorizontalReader bağlantısı

**Files:**
- Modify: `src/pages/Reader.tsx`
- Modify: `src/components/reader/VerticalReader.tsx`
- Modify: `src/components/reader/HorizontalReader.tsx`

- [ ] **Step 1: `VerticalReader.tsx`'i güncelle**

1. Import ekle:

```ts
import { PageTranslateButton, TranslationOverlay } from '@/components/reader/TranslationOverlay';
import { ReaderTranslationApi } from '@/hooks/useChapterTranslation';
```

2. `VerticalReaderProps`'a ve `ReaderPageProps`'a ekle:

```ts
  translation?: ReaderTranslationApi;
```

3. `ReaderPage` bileşenini şu şekilde değiştir (sayfa başına yerel gizle/göster durumu eklenir; `useState` importu dosyada zaten var):

```tsx
const ReaderPage: React.FC<ReaderPageProps> = ({
  index,
  page,
  zoom,
  fitWidth,
  translation,
}) => {
  const [pageOverlayShown, setPageOverlayShown] = useState(true);
  const state = translation?.pageStates[index];
  const showOverlay = Boolean(
    translation
    && state?.status === 'done'
    && state.blocks
    && translation.settings.overlayVisible
    && pageOverlayShown,
  );

  const overlayNode = translation && translation.enabled ? (
    <>
      {showOverlay && state?.blocks && <TranslationOverlay blocks={state.blocks} />}
      <PageTranslateButton
        state={state}
        showIdleButton={!translation.settings.autoTranslate}
        overlayShown={translation.settings.overlayVisible && pageOverlayShown}
        onTranslate={() => translation.translatePage(index)}
        onRetranslate={() => translation.translatePage(index, { force: true })}
        onToggleOverlay={() => setPageOverlayShown((prev) => !prev)}
      />
    </>
  ) : (
    showOverlay && state?.blocks ? <TranslationOverlay blocks={state.blocks} /> : undefined
  );

  return (
    <div
      data-page-index={index}
      className="group relative mx-auto flex w-full justify-center"
      style={{ maxWidth: fitWidth ? `${896 * (zoom / 100)}px` : 'none' }}
    >
      <div
        data-reader-page-number={index + 1}
        className="mx-auto flex w-full justify-center"
      >
        <ProtectedImage
          src={page.src}
          alt={`Sayfa ${index + 1}`}
          zoom={zoom}
          overlay={overlayNode}
        />
      </div>
      <div className="absolute top-2 left-2 z-20 rounded bg-black/50 px-2 py-1 text-[10px] text-white opacity-0 transition-opacity group-hover:opacity-100 pointer-events-none">
        P{index + 1}
      </div>
    </div>
  );
};
```

(P{n} rozeti `right-2`den `left-2`ye taşındı — sağ üst köşe çeviri butonuna ayrıldı.)

4. `VerticalReader` gövdesinde `translation` prop'unu al ve `ReaderPage`'e ilet:

```tsx
        <ReaderPage
          key={index}
          index={index}
          page={page}
          zoom={effectiveZoom}
          fitWidth={settings.fitWidth}
          translation={translation}
        />
```

- [ ] **Step 2: `HorizontalReader.tsx`'i güncelle**

1. Aynı importları ekle (`PageTranslateButton`, `TranslationOverlay`, `ReaderTranslationApi`).
2. `HorizontalReaderProps`'a `translation?: ReaderTranslationApi;` ekle; destructuring'e `translation,` ekle.
3. Bileşen gövdesine (state'lerin yanına) ekle:

```tsx
  const [pageOverlayShown, setPageOverlayShown] = useState(true);
  const pageIndex = currentPage - 1;
  const translationState = translation?.pageStates[pageIndex];
  const showTranslationOverlay = Boolean(
    translation
    && translationState?.status === 'done'
    && translationState.blocks
    && translation.settings.overlayVisible
    && pageOverlayShown,
  );

  useEffect(() => {
    setPageOverlayShown(true);
  }, [currentPage]);

  const translationOverlayNode = translation && translation.enabled ? (
    <>
      {showTranslationOverlay && translationState?.blocks && (
        <TranslationOverlay blocks={translationState.blocks} />
      )}
      <PageTranslateButton
        state={translationState}
        showIdleButton={!translation.settings.autoTranslate}
        overlayShown={translation.settings.overlayVisible && pageOverlayShown}
        onTranslate={() => translation.translatePage(pageIndex)}
        onRetranslate={() => translation.translatePage(pageIndex, { force: true })}
        onToggleOverlay={() => setPageOverlayShown((prev) => !prev)}
      />
    </>
  ) : (
    showTranslationOverlay && translationState?.blocks
      ? <TranslationOverlay blocks={translationState.blocks} />
      : undefined
  );
```

4. `ProtectedImage`'a `overlay={translationOverlayNode}` prop'unu ekle.

- [ ] **Step 3: `Reader.tsx`'i güncelle**

1. Import ekle:

```ts
import { useChapterTranslation } from '@/hooks/useChapterTranslation';
```

2. `const [currentPage, setCurrentPage] = useState(1);` satırından sonra uygun bir yere (resolvedPages tanımlandıktan SONRA olmalı — `resolvedPages` değişkeninin tanımını bul ve altına koy):

```ts
  const translation = useChapterTranslation({
    chapterId: chapterId || '',
    pages: resolvedPages,
    currentPage,
    networkEnabled: canUseNetworkReaderFeatures,
  });
```

3. `<ReaderControls ...>` çağrısına prop ekle:

```tsx
        translationSettings={translation.settings}
        onTranslationSettingsChange={translation.updateSettings}
```

4. `<VerticalReader ...>` ve `<HorizontalReader ...>` çağrılarına prop ekle:

```tsx
              translation={translation}
```

- [ ] **Step 4: Tip kontrolü + lint**

Run: `npx tsc --noEmit -p tsconfig.app.json`
Expected: hata yok.
Run: `npm run lint -- --quiet`
Expected: yeni dosyalarda hata yok (mevcut uyarılar hariç).

- [ ] **Step 5: Commit**

```bash
git add src/pages/Reader.tsx src/components/reader/VerticalReader.tsx src/components/reader/HorizontalReader.tsx
git commit -m "feat(translation): okuyucu entegrasyonu (dikey/yatay okuyucu + Reader bağlantısı)"
```

---

### Task 9: Build + manuel doğrulama

- [ ] **Step 1: Production build**

Run: `npm run build`
Expected: build başarılı, hata yok.

- [ ] **Step 2: Dev sunucusu ile manuel test**

Run: `npm run dev` (arka planda) ve tarayıcıda bir bölüm aç. Kullanıcıyla birlikte doğrula (spec'teki test planı):

1. Sağ üstte Settings yanında Languages butonu görünüyor mu; panel açılıyor mu?
2. API key girmeden sayfa "Çevir" → toast uyarısı geliyor mu?
3. API key gir → tek sayfa çevir → overlay konumları makul mü? (**Faz 2 kararı burada**)
4. Sayfayı yenile → çeviri önbellekten anında gelmeli (Network sekmesinde Gemini çağrısı OLMAMALI).
5. "Yeniden çevir" → yeni sonuç üzerine yazılmalı.
6. Auto-translate aç → sayfalar aktif sayfadan itibaren sırayla çevrilmeli (aynı anda en fazla 2 istek).
7. Yanlış API key → sayfada "Tekrar dene" durumu; Supabase'e kayıt YAZILMAMALI.
8. Zoom değiştir → overlay görselle birlikte ölçeklenmeli.
9. Dil değiştir → aynı sayfa yeni dilde ayrı önbellek kaydı oluşturmalı (page_translations'ta 2 satır).
10. Yatay okuma modunda da 1-5 tekrarla.

- [ ] **Step 3: Süpabase kontrolü**

postgres MCP `query` aracıyla: `select chapter_id, page_index, lang, jsonb_array_length(blocks) from page_translations limit 5;`
Expected: çevrilen sayfalar için satırlar, blocks dizi uzunluğu > 0.

---

## Riskler / bilinen belirsizlikler

1. **CORS:** `fetch(imageSrc)` görsel sunucusunun (R2/proxy) CORS başlığına bağlı. `ProtectedImage` zaten görselleri canvas'a çizebildiği için sorun beklenmiyor; hata çıkarsa hook'ta `error` durumu görünür — o zaman görsel proxy'ye CORS başlığı eklenir (ayrı iş).
2. **`ThinkingLevel` importu:** SDK sürümüne göre `thinkingLevel` yerine `thinkingBudget: 0` gerekebilir (Task 3 notu).
3. **Overlay konum kalitesi:** Faz 1'in ana test noktası. Yetersizse Faz 2 (ayrı OCR) spec'i yazılır — plan kapsamı dışı.
4. **Font sığdırma:** `cqw` tabanlı clamp ilk sürüm; gerçek sayfalarda taşma olursa değer ayarı yeterli.
