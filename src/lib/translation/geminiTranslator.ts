import { GoogleGenAI, Type, ThinkingLevel } from '@google/genai';
import { downloadPageBlob } from '@/lib/offline/downloadManager';
import { isStoredMediaUrl, unwrapManagedMediaUrl } from '@/lib/mediaStorage';
import { TranslationBlock } from './types';
import { getLanguageName } from './languages';
import { normalizeApiKeysList } from './translationSettings';
import { ensureScanlationFontReady, inpaintAndRefineBlock } from './bubbleInpainter';
import { runFastWebtoonOcr } from './fastOcr';
import { isCreditOrPromoText, isPureSoundEffect } from './ocrCore';

const GEMINI_FLASH_MODEL = 'gemini-flash-lite-latest';
const GEMINI_THINKING_LEVEL = ThinkingLevel.MINIMAL;

const FALLBACK_RETRY_DELAYS_MS = [1500, 3500];
const DEFAULT_KEY_COOLDOWN_MS = 12_000;
const INVALID_KEY_ISOLATION_MS = 5 * 60_000;
const PER_REQUEST_TIMEOUT_MS = 20_000;
const DEFAULT_TRANSLATE_PROXY_URL =
  'https://toonparrot-scraper-proxy.caganhuseyinerdil.workers.dev/translate';

const GEMINI_TEXT_TRANSLATE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    translations: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: 'The translated texts in the exact same array order and count',
    },
  },
  required: ['translations'],
};

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('İptal edildi', 'AbortError'));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException('İptal edildi', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });

export const fetchTranslatableImageBlob = async (
  src: string,
  signal?: AbortSignal,
): Promise<Blob> => {
  if (signal?.aborted) {
    throw new DOMException('İptal edildi', 'AbortError');
  }

  if (src.startsWith('blob:') || src.startsWith('data:')) {
    const response = await fetch(src, { signal });
    if (!response.ok) throw new Error('Yerel görsel okunamadı');
    return response.blob();
  }

  const unwrapped = unwrapManagedMediaUrl(src) || src;
  const isSameOrigin = typeof window !== 'undefined' && unwrapped.startsWith(window.location.origin);
  if (isSameOrigin || isStoredMediaUrl(unwrapped)) {
    try {
      const direct = await fetch(unwrapped, { signal });
      if (direct.ok) return await direct.blob();
    } catch (err) {
      if (signal?.aborted) throw err;
    }
  }

  const controller = new AbortController();
  const forwardAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', forwardAbort, { once: true });
  }
  try {
    const result = await downloadPageBlob(src, controller.signal);
    return result.blob;
  } finally {
    signal?.removeEventListener('abort', forwardAbort);
  }
};

export const loadImageElementFromBlob = (blob: Blob): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(blob);
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Görsel çözümlenemedi'));
    };
    img.src = url;
  });

export const isTransientServerOrTimeoutError = (error: unknown): boolean => {
  if (error instanceof DOMException && error.name === 'TimeoutError') return true;
  if (error instanceof Error && error.name === 'TimeoutError') return true;
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return (
    message.includes('503') ||
    message.includes('502') ||
    message.includes('504') ||
    message.includes('500') ||
    message.includes('404') ||
    message.includes('not found') ||
    message.includes('unavailable') ||
    message.includes('overloaded') ||
    message.includes('deadline_exceeded') ||
    message.includes('timed out') ||
    message.includes('timeout') ||
    message.includes('internal error')
  );
};

export const isRateLimitError = (error: unknown) => {
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return (
    message.includes('429') ||
    message.includes('resource_exhausted') ||
    message.includes('quota') ||
    message.includes('too many requests')
  );
};

export const isAbortTranslationError = (error: unknown): boolean =>
  (error instanceof DOMException && error.name === 'AbortError') ||
  (error instanceof Error && error.name === 'AbortError');

export const isFatalAuthOrKeyError = (error: unknown): boolean => {
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return (
    message.includes('api_key_invalid') ||
    message.includes('api key not valid') ||
    message.includes('permission_denied') ||
    message.includes('unauthenticated') ||
    message.includes('invalid api key')
  );
};

export const classifyTranslationError = (error: unknown): string => {
  if (isFatalAuthOrKeyError(error)) {
    return 'Gemini API anahtarı geçersiz veya yetkisiz. Lütfen ayarlar panelinden kontrol edin.';
  }
  if (isRateLimitError(error)) {
    return 'Gemini kota sınırı doldu (429). Ek API anahtarı ekleyebilir veya biraz bekleyebilirsiniz.';
  }
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
  if (message.includes('api_key_invalid') || message.includes('api anahtarı bulunamadı')) {
    return 'Gemini API anahtarı eksik. Lütfen Görsel Çeviri panelinden bir API anahtarı ekleyin veya Google Çeviri motorunu seçin.';
  }
  if (
    message.includes('503') ||
    message.includes('502') ||
    message.includes('504') ||
    message.includes('timeout') ||
    message.includes('timed out') ||
    message.includes('overload') ||
    message.includes('deadline_exceeded')
  ) {
    return 'Çeviri zaman aşımına uğradı veya servis meşgul. Lütfen tekrar deneyin.';
  }
  if (message.includes('görsel') || message.includes('failed to fetch') || message.includes('network')) {
    return 'Sayfa görseli alınamadı. Bağlantınızı kontrol edin.';
  }
  return 'Çeviri tamamlanamadı. Tekrar deneyin.';
};

interface KeyPoolSlot {
  key: string;
  client: GoogleGenAI | null;
  inFlight: number;
  cooldownUntil: number;
  invalidUntil: number;
  nextDispatchAt: number;
  lastPickedSeq: number;
}

const keyPoolSlots = new Map<string, KeyPoolSlot>();
let pickSequence = 0;

const getOrCreateSlot = (key: string): KeyPoolSlot => {
  let slot = keyPoolSlots.get(key);
  if (!slot) {
    slot = {
      key,
      client: null,
      inFlight: 0,
      cooldownUntil: 0,
      invalidUntil: 0,
      nextDispatchAt: 0,
      lastPickedSeq: 0,
    };
    keyPoolSlots.set(key, slot);
  }
  return slot;
};

const parseRetryDelayMs = (error: unknown): number => {
  const message = error instanceof Error ? error.message : String(error);
  const secMatch = message.match(/retry\s+in\s+(\d+(?:\.\d+)?)\s*s/i);
  if (secMatch) {
    const parsedMs = Math.ceil(Number(secMatch[1]) * 1000);
    if (Number.isFinite(parsedMs) && parsedMs > 0) {
      return Math.min(Math.max(parsedMs, 6_000), 25_000);
    }
  }
  return DEFAULT_KEY_COOLDOWN_MS;
};

export const resetGeminiKeyPoolForTests = (): void => {
  keyPoolSlots.clear();
  pickSequence = 0;
};

export const executeWithGeminiKeyPool = async <T>(
  keys: readonly string[],
  task: (apiKey: string, getClient: () => GoogleGenAI, attemptIndex: number) => Promise<T>,
  signal?: AbortSignal,
): Promise<T> => {
  const normalizedKeys = normalizeApiKeysList(keys);
  if (normalizedKeys.length === 0) {
    throw new Error('API_KEY_INVALID: Geçerli bir Gemini API anahtarı bulunamadı.');
  }

  const maxAttempts = Math.max(normalizedKeys.length * 2, 3);
  let lastError: unknown = null;
  let allCoolingRetries = 0;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (signal?.aborted) {
      throw new DOMException('İptal edildi', 'AbortError');
    }

    const now = Date.now();
    const slots = normalizedKeys.map(getOrCreateSlot);
    const validSlots = slots.filter((slot) => slot.invalidUntil <= now);

    if (validSlots.length === 0) {
      throw lastError || new Error('API_KEY_INVALID: Tüm Gemini API anahtarları geçersiz.');
    }

    let readySlots = validSlots.filter((slot) => slot.cooldownUntil <= now);

    if (readySlots.length === 0) {
      if (allCoolingRetries >= FALLBACK_RETRY_DELAYS_MS.length) {
        throw lastError || new Error('429 RESOURCE_EXHAUSTED: Tüm anahtarlar kota beklemesinde.');
      }
      const earliestCooldown = Math.min(...validSlots.map((slot) => slot.cooldownUntil));
      const waitMs = Math.min(
        Math.max(earliestCooldown - now, FALLBACK_RETRY_DELAYS_MS[allCoolingRetries] || 1500),
        10_000,
      );
      allCoolingRetries += 1;
      await sleep(waitMs, signal);
      readySlots = validSlots.filter((slot) => slot.cooldownUntil <= Date.now());
      if (readySlots.length === 0) {
        readySlots = [
          validSlots.reduce((best, cur) => (cur.cooldownUntil < best.cooldownUntil ? cur : best)),
        ];
      }
    }

    // En az aktif isteği olan anahtarı seç
    readySlots.sort((a, b) => {
      if (a.inFlight !== b.inFlight) return a.inFlight - b.inFlight;
      if (a.nextDispatchAt !== b.nextDispatchAt) return a.nextDispatchAt - b.nextDispatchAt;
      return a.lastPickedSeq - b.lastPickedSeq;
    });

    const chosen = readySlots[0];
    pickSequence += 1;
    chosen.lastPickedSeq = pickSequence;
    chosen.inFlight += 1;

    const minIntervalMs = normalizedKeys.length === 1 ? 140 : 80;
    const dispatchNow = Date.now();
    const scheduledAt = Math.max(dispatchNow, chosen.nextDispatchAt);
    chosen.nextDispatchAt = scheduledAt + minIntervalMs;

    try {
      if (scheduledAt > dispatchNow) {
        await sleep(scheduledAt - dispatchNow, signal);
      }

      const getClient = () => {
        if (!chosen.client) {
          chosen.client = new GoogleGenAI({ apiKey: chosen.key });
        }
        return chosen.client;
      };

      return await task(chosen.key, getClient, attempt);
    } catch (error) {
      if (signal?.aborted) {
        throw new DOMException('İptal edildi', 'AbortError');
      }
      if (isAbortTranslationError(error) && !isTransientServerOrTimeoutError(error)) {
        throw new DOMException('İptal edildi', 'AbortError');
      }

      lastError = error;

      if (isFatalAuthOrKeyError(error)) {
        chosen.invalidUntil = Date.now() + INVALID_KEY_ISOLATION_MS;
        continue;
      }

      if (isRateLimitError(error)) {
        const cooldownMs = parseRetryDelayMs(error);
        const until = Date.now() + cooldownMs;
        chosen.cooldownUntil = Math.max(chosen.cooldownUntil, until);
        chosen.nextDispatchAt = Math.max(chosen.nextDispatchAt, until);
        continue;
      }

      if (isTransientServerOrTimeoutError(error)) {
        await sleep(250, signal);
        continue;
      }

      throw error;
    } finally {
      chosen.inFlight = Math.max(0, chosen.inFlight - 1);
    }
  }

  throw lastError || new Error('Çeviri isteği tamamlanamadı.');
};

const VOCAL_TOKEN_REGEX =
  /^(?:a+h+|o+h+|u+h+|u+g+h+|e+u+g+h+|a+a+h*|o+o+h*|n+g+h+|m+m+h*|h+m+m*|h+m+p+h*|h+a+a+|h+e+h+|t+s+k+|t+c+h+|p+f+f+t*|e+h+|h+a+h+|a+r+g+h+|a+g+h+|o+o+f+|u+a*f+|p+u+f+|o+f+|ö+f+|g+a+s+p+|s+i+g+h+|w+o+w+|h+u+h+|y+a+h+|k+y+a+h*|g+k+h+|u+r+k+|a+c+k+|e+e+p+|s+h+h+|h+ı+h*|ı+h+|b+a+h+|o+u+c+h+)$/i;

const SFX_WRAP_REGEX = /^[*({\[][^\n*)}\]]+[*)}\]][!?.~*^_\-\s]*$/;
const PURE_PUNCT_REGEX = /^[\s¡¿.,!?:;…\-_~*^'"/\\()[\]{}<>◁▷◀▶★☆•]+$/;
const CREDITS_START_REGEX =
  /^(?:çizer|çizim|yazar|hikaye|öykü|senaryo|editör|editor|çeviri|çevirmen|dizgi|temizleme|artist|author|story|art|typesetter|cleaner|redrawer|proofreader|scanlation|fansub|raw|webtoon|bölüm\s*\d+|chapter\s*\d+|cap[íi]tulo\s*\d+|ep(?:isode)?\.?\s*\d+|vol(?:ume)?\.?\s*\d+|lee\s+antes\s+en|leia\s+antes\s+em|read\s+(?:first\s+)?(?:at|on))\b/i;
const CREDITS_INLINE_REGEX =
  /(?:^|[\/|•<\[])\s*(?:hikaye|öykü|senaryo|yazar|çizer|çizim|sanat|editör|editor|çeviri|çevirmen|dizgi|temizleme|story|art|artist|author|written\s+by|art\s+by|story\s+by|original\s+work|traducción|traduccion|edición|edicion|limpieza|typeset|scanlation|fansub|lee\s+antes\s+en|read\s+(?:first\s+)?(?:at|on))\s*[:\-]/i;
const WATERMARK_DOMAIN_REGEX =
  /(?:https?:\/\/|discord\.gg\/|\b[a-z0-9-]+\.(?:com|net|org|club|me|online|io|gg|xyz|to|site)\b)/i;

// Ses efektlerini (SFX), inlemeleri ve çizer/yazar/editör jeneriklerini filtreler
export const shouldSkipBlock = (text: string, targetLang = 'tr'): boolean => {
  const t = text.trim();
  if (t.length <= 1) return true;
  if (PURE_PUNCT_REGEX.test(t)) return true;
  if (SFX_WRAP_REGEX.test(t)) return true;
  if (WATERMARK_DOMAIN_REGEX.test(t) || isCreditOrPromoText(t)) return true;

  // Hedef dil Korece/Japonca/Çince değilse çevrilmeden kalan Hangul/Kana/CJK blokları atla
  if (targetLang !== 'ko' && /[\uAC00-\uD7AF\u3131-\u318E]/.test(t)) return true;
  if (targetLang !== 'ja' && /[\u3040-\u30FF]/.test(t)) return true;
  if (targetLang !== 'zh' && targetLang !== 'ja' && /[\u4E00-\u9FFF]/.test(t)) return true;

  const stripped = t.replace(/^[<\[({◁▷◀▶★☆•\-~\s]+|[>\])}◁▷◀▶★☆•\-~\s]+$/g, '').trim();
  if (!stripped || stripped.length <= 1) return true;
  if (CREDITS_START_REGEX.test(stripped) || CREDITS_INLINE_REGEX.test(t)) return true;
  if (/^[◁▷◀▶].*[◁▷◀▶]$/.test(t)) return true;
  if (isPureSoundEffect(stripped)) return true;

  const wordTokens = stripped
    .split(/[\s¡¿.,!?:;…\-_~*^'"/\\()[\]{}<>]+/)
    .filter(Boolean);
  if (
    wordTokens.length >= 1 &&
    wordTokens.length <= 4 &&
    wordTokens.every((tok) => VOCAL_TOKEN_REGEX.test(tok))
  ) {
    return true;
  }

  return false;
};

const getTranslateProxyEndpoint = (): string => {
  const raw =
    typeof import.meta !== 'undefined' && import.meta.env
      ? String(import.meta.env.VITE_SCRAPER_PROXY_URL || '').trim()
      : '';
  const firstProxy = raw
    .split(',')
    .map((u) => u.trim().replace(/\/+$/, ''))
    .find(Boolean);
  return firstProxy ? `${firstProxy}/translate` : DEFAULT_TRANSLATE_PROXY_URL;
};

const STRICT_TURKISH_CHAR_REGEX = /[çğıİşÇĞŞ]/;
const STRICT_TURKISH_CHAR_GLOBAL = /[çğıİşÇĞŞ]/g;
const STRICT_TURKISH_WORD_REGEX =
  /\b(?:için|fakat|ancak|değil|kadar|sonra|önce|nasıl|neden|niye|nerede|benim|senin|onun|bizim|sizin|evet|hayır|tamam|lütfen|teşekkür|merhaba|olacak|olduğu|olarak|böyle|şöyle|ಚ|keşke|acaba|belki|çünkü|rağmen|doğru|yanlış|güzel|büyük|küçük)\b/i;
const FOREIGN_STOPWORD_REGEX =
  /\b(?:the|and|you|your|are|was|were|have|has|had|with|this|that|what|when|where|why|how|from|they|them|their|there|here|would|could|should|will|can't|don't|didn't|isn't|aren't|wasn't|I'm|you're|he's|she's|it's|we're|they're|el|la|los|las|un|una|unos|unas|del|al|por|para|con|sin|pero|como|cuando|donde|quien|que|mas|muy|este|esta|estos|estas|ese|esa|esos|esas|todo|toda|todos|todas|hacer|hace|hizo|haber|ha|han|habia|soy|eres|somos|son|estoy|estan|estaba|tengo|tienes|tiene|tienen|tenia|voy|vas|van|puedo|puede|pueden|quiero|quiere|quieren|debi|debia|despues|antes|ahora|aqui|solo|maldita|maldito|mierda|carajo|anos|ano)\b/i;

export const isLikelyAlreadyTranslated = (text: string, targetLang: string): boolean => {
  const t = text.trim();
  if (!t) return true;
  if (targetLang === 'tr') {
    if (FOREIGN_STOPWORD_REGEX.test(t)) return false;
    const trChars = t.match(STRICT_TURKISH_CHAR_GLOBAL)?.length ?? 0;
    if (trChars >= 2) return true;
    if (STRICT_TURKISH_CHAR_REGEX.test(t) && STRICT_TURKISH_WORD_REGEX.test(t)) return true;
  }
  return false;
};

/**
 * Google Çeviri API proxy'si ile toplu metin çevirisi (100% Ücretsiz, API Key istemez).
 */
export const translateBatchWithGoogleFree = async (
  texts: readonly string[],
  targetLang: string,
  signal?: AbortSignal,
): Promise<string[]> => {
  if (texts.length === 0) return [];
  const trimmedList = texts.map((t) => (t || '').trim());
  const nonEmptyIndices: number[] = [];
  const payloadTexts: string[] = [];

  trimmedList.forEach((t, idx) => {
    if (t.length > 1) {
      nonEmptyIndices.push(idx);
      payloadTexts.push(t);
    }
  });

  if (payloadTexts.length === 0) return trimmedList;

  const endpoint = getTranslateProxyEndpoint();
  try {
    const reqSignal = signal
      ? AbortSignal.any([signal, AbortSignal.timeout(8000)])
      : AbortSignal.timeout(8000);
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sl: 'auto',
        tl: targetLang,
        texts: payloadTexts,
      }),
      signal: reqSignal,
    });
    if (res.ok) {
      const json = (await res.json()) as { translations?: unknown };
      if (Array.isArray(json?.translations) && json.translations.length === payloadTexts.length) {
        const out = [...trimmedList];
        nonEmptyIndices.forEach((origIdx, i) => {
          const cand = typeof json.translations![i] === 'string' ? json.translations![i].trim() : '';
          if (cand) out[origIdx] = cand;
        });
        return out;
      }
    }
  } catch {
    // Proxy ulaşılamazsa orijinal listeyi koru
  }

  return trimmedList;
};

export const translateWithGoogleFree = async (
  text: string,
  targetLang: string,
  signal?: AbortSignal,
): Promise<string> => {
  const trimmed = text?.trim();
  if (!trimmed) return '';
  const [translated] = await translateBatchWithGoogleFree([trimmed], targetLang, signal);
  return translated || trimmed;
};

/**
 * Gemini Flash-Lite (`gemini-flash-lite-latest`) ile SAF METİN çevirisi.
 * Kesinlikle görsel/vision verisi içermez; sadece metin dizileri gider ve gelir.
 * Çok hızlıdır (~400-800ms) ve neredeyse sıfır token tüketir.
 */
export const translateBatchWithGeminiText = async (
  texts: readonly string[],
  targetLang: string,
  keys: readonly string[],
  signal?: AbortSignal,
): Promise<string[]> => {
  if (texts.length === 0) return [];
  const trimmedList = texts.map((t) => (t || '').trim());
  const pendingIndices: number[] = [];
  const payloadTexts: string[] = [];

  trimmedList.forEach((t, idx) => {
    if (t.length > 0 && !isLikelyAlreadyTranslated(t, targetLang)) {
      pendingIndices.push(idx);
      payloadTexts.push(t);
    }
  });

  if (payloadTexts.length === 0) return trimmedList;

  const targetLangName = getLanguageName(targetLang);
  const prompt = [
    'You are an expert manga/webtoon translator.',
    `Translate each of the following ${payloadTexts.length} dialogue/narration lines into natural, fluent, and idiomatic ${targetLangName} (ISO 639-1 code: "${targetLang}").`,
    'STRICT RULES:',
    '1. Keep personal character names, honorifics (e.g. Oppa, Hyung, Sunbae, San, Kun, Chan, Sama, Sensei), and proper nouns in their original romanized spelling. NEVER localize names.',
    '2. Keep translations concise so they fit neatly inside speech bubbles.',
    `3. Return a JSON object with a "translations" array of exactly ${payloadTexts.length} strings matching input order.`,
    'Lines to translate:',
    JSON.stringify(payloadTexts),
  ].join('\n');

  try {
    return await executeWithGeminiKeyPool(
      keys,
      async (_apiKey, getClient) => {
        const ai = getClient();
        const model = GEMINI_FLASH_MODEL; // 'gemini-flash-lite-latest'
        const timeoutSignal = AbortSignal.timeout(PER_REQUEST_TIMEOUT_MS);
        const combinedSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;

        const response = await ai.models.generateContent({
          model,
          config: {
            thinkingConfig: { thinkingLevel: GEMINI_THINKING_LEVEL },
            responseMimeType: 'application/json',
            responseSchema: GEMINI_TEXT_TRANSLATE_SCHEMA,
            abortSignal: combinedSignal,
          },
          contents: [
            {
              role: 'user',
              parts: [{ text: prompt }],
            },
          ],
        });

        const rawText = response.text || '';
        const cleaned = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
        const parsed = JSON.parse(cleaned) as { translations?: unknown };

        if (Array.isArray(parsed?.translations) && parsed.translations.length === payloadTexts.length) {
          const out = [...trimmedList];
          pendingIndices.forEach((origIdx, i) => {
            const cand = typeof parsed.translations![i] === 'string' ? parsed.translations![i].trim() : '';
            if (cand) out[origIdx] = cand;
          });
          return out;
        }

        throw new Error('Eksik veya uyumsuz çeviri dizisi döndü.');
      },
      signal,
    );
  } catch (err) {
    if (signal?.aborted) {
      throw new DOMException('İptal edildi', 'AbortError');
    }
    // Gemini geçici hata verirse Google Çeviri fallback'i ile kullanıcıyı asla yarı yolda bırakma
    console.warn('[Gemini Flash-Lite Text Fallback to Google Translate]', err);
    return await translateBatchWithGoogleFree(texts, targetLang, signal);
  }
};

export interface TranslationTimings {
  ocrMs: number;
  transMs: number;
  totalMs: number;
}

export interface TranslatePageResult {
  blocks: TranslationBlock[];
  timings: TranslationTimings;
}

export interface TranslatePageOptions {
  apiKey?: string;
  apiKeys?: readonly string[];
  provider?: 'gemini' | 'google';
  imageSrc: string;
  targetLang: string;
  signal?: AbortSignal;
}

/**
 * Sayfayı yerel WASM OCR ile tarar ve seçilen motorla (Google veya Gemini Flash-Lite) çevirir.
 * Sıfır LLM Vision maliyeti vardır; görseller hiçbir uzak API'ye gönderilmez.
 */
export const translatePageImage = async ({
  apiKey,
  apiKeys,
  provider = 'gemini',
  imageSrc,
  targetLang,
  signal,
}: TranslatePageOptions): Promise<TranslatePageResult> => {
  const tStart = performance.now();
  let ocrMs = 0;
  let transMs = 0;

  const effectiveKeys = normalizeApiKeysList(apiKeys, apiKey);
  // Yalnızca Gemini motoru seçiliyse API anahtarı zorunludur; Google Çeviri ücretsizdir!
  if (provider === 'gemini' && effectiveKeys.length === 0) {
    throw new Error('API_KEY_INVALID: Gemini API anahtarı bulunamadı.');
  }

  const [blob] = await Promise.all([
    fetchTranslatableImageBlob(imageSrc, signal),
    ensureScanlationFontReady(),
  ]);
  if (signal?.aborted) {
    throw new DOMException('İptal edildi', 'AbortError');
  }

  const img = await loadImageElementFromBlob(blob);
  const fullWidth = img.naturalWidth || img.width;
  const fullHeight = img.naturalHeight || img.height;

  if (fullWidth <= 0 || fullHeight <= 0) {
    throw new Error('Görsel boyutları geçersiz');
  }

  const fullCanvas = document.createElement('canvas');
  fullCanvas.width = fullWidth;
  fullCanvas.height = fullHeight;
  const fullCtx = fullCanvas.getContext('2d', { willReadFrequently: true });
  if (!fullCtx) {
    throw new Error('Canvas bağlamı oluşturulamadı');
  }
  fullCtx.drawImage(img, 0, 0);

  // 1. ADIM: Yerel OCR (PaddleOCR ONNX, Web Worker) ile metin satırlarını bul ve balonlara grupla
  const tOcrStart = performance.now();
  const ocr = await runFastWebtoonOcr(fullCanvas, signal);
  ocrMs = Math.round(performance.now() - tOcrStart);

  // Jenerik / ekip listesi / reklam / duyuru sayfaları hiç çevrilmez
  const rawBubbles = ocr.isPromoPage
    ? []
    : ocr.bubbles.filter((bubble) => !shouldSkipBlock(bubble.text, targetLang));

  if (rawBubbles.length === 0) {
    return {
      blocks: [],
      timings: { ocrMs, transMs: 0, totalMs: Math.round(performance.now() - tStart) },
    };
  }

  // 2. ADIM: Çeviri Motoru (Google Çeviri veya Gemini Flash-Lite Text)
  const tTransStart = performance.now();
  const originalTexts = rawBubbles.map((b) => b.text);
  let translatedTexts: string[] = [];

  if (provider === 'google') {
    translatedTexts = await translateBatchWithGoogleFree(originalTexts, targetLang, signal);
  } else {
    translatedTexts = await translateBatchWithGeminiText(
      originalTexts,
      targetLang,
      effectiveKeys,
      signal,
    );
  }
  transMs = Math.round(performance.now() - tTransStart);

  // 3. ADIM: Balonları inpaint et ve hedeflenen dilde yeniden diz
  const normalizeForCompare = (s: string) =>
    s.toLocaleLowerCase('en-US').replace(/[^\p{L}\p{N}]+/gu, '');

  // Çeviri servisi sessizce başarısız olursa (tüm metinler aynen döner) sayfayı "çevrildi" sayma
  const unchangedCount = rawBubbles.filter(
    (bubble, idx) => normalizeForCompare(translatedTexts[idx] || '') === normalizeForCompare(bubble.text),
  ).length;
  if (targetLang !== 'en' && rawBubbles.length >= 2 && unchangedCount === rawBubbles.length) {
    throw new Error('Çeviri servisi yanıt vermedi (timeout)');
  }

  const blocks = rawBubbles
    .map((bubble, idx) => {
      const translated = (translatedTexts[idx] || bubble.text).trim();
      if (shouldSkipBlock(translated, targetLang)) return null;
      // Çeviri orijinalle aynıysa (özel isim, saf ses efekti) orijinal çizimi bozma
      if (normalizeForCompare(translated) === normalizeForCompare(bubble.text)) return null;
      return inpaintAndRefineBlock(
        fullCtx,
        fullWidth,
        fullHeight,
        {
          box: bubble.box,
          text: translated,
          originalText: bubble.text,
          lines: bubble.lines,
          emphasisLastLineScale: bubble.emphasisLastLineScale,
        },
        targetLang,
      );
    })
    .filter((block): block is TranslationBlock => block !== null);

  return {
    blocks,
    timings: {
      ocrMs,
      transMs,
      totalMs: Math.round(performance.now() - tStart),
    },
  };
};
