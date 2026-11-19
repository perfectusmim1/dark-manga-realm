import { GoogleGenAI, Type, ThinkingLevel } from '@google/genai';
import { downloadPageBlob } from '@/lib/offline/downloadManager';
import { isStoredMediaUrl, unwrapManagedMediaUrl } from '@/lib/mediaStorage';
import { TranslationBlock } from './types';
import { getLanguageName } from './languages';
import {
  normalizeApiKeysList,
  normalizeDeepLApiKeysList,
  TranslationSettings,
} from './translationSettings';
import { ensureScanlationFontReady, inpaintAndRefineBlock } from './bubbleInpainter';
import { runFastWebtoonOcr } from './fastOcr';
import { isCreditOrPromoText, isPureSoundEffect, OcrBubble } from './ocrCore';

const GEMINI_FLASH_MODEL = 'gemini-flash-lite-latest';
const GEMINI_THINKING_LEVEL = ThinkingLevel.MINIMAL;

const FALLBACK_RETRY_DELAYS_MS = [1500, 3500];
const DEFAULT_KEY_COOLDOWN_MS = 12_000;
const INVALID_KEY_ISOLATION_MS = 5 * 60_000;
const PER_REQUEST_TIMEOUT_MS = 20_000;
const DEFAULT_TRANSLATE_PROXY_URL =
  'https://toonparrot-scraper-proxy.caganherdil.workers.dev/translate';

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
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
  if (message.includes('deepl_key_invalid') || (message.includes('deepl') && message.includes('anahtar'))) {
    return 'DeepL API anahtarı geçersiz veya eksik. Lütfen ayarlar panelinden kontrol edin.';
  }
  if (message.includes('deepl_quota_exceeded')) {
    return 'DeepL kota sınırı doldu. Ek API anahtarı ekleyebilir veya Google Çeviri motorunu seçebilirsiniz.';
  }
  if (isFatalAuthOrKeyError(error)) {
    return 'Gemini API anahtarı geçersiz veya yetkisiz. Lütfen ayarlar panelinden kontrol edin.';
  }
  if (isRateLimitError(error)) {
    return 'Gemini kota sınırı doldu (429). Ek API anahtarı ekleyebilir veya biraz bekleyebilirsiniz.';
  }
  if (message.includes('api_key_invalid') || message.includes('api anahtarı bulunamadı')) {
    return 'Seçili çeviri motoru için API anahtarı eksik. Lütfen Görsel Çeviri panelinden bir API anahtarı ekleyin veya Google Çeviri motorunu seçin.';
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

  const maxAttempts = Math.max(normalizedKeys.length * 3, 5);
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
        const backoffMs = Math.min(800 * Math.pow(1.6, attempt), 3500);
        await sleep(backoffMs, signal);
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
  /^(?:a+h+|a+k+h*|o+h+|u+h+|u+n+g+h+|u+g+h+|e+u+g+h+|a+a+h*|o+o+h*|n+g+h+|m+m+h*|h+m+m*|h+m+p+h*|h+a+a+|h+e+h+|h+a+n*g*h+|h+n+g*h+|t+s+k+|t+c+h+|p+f+f+t*|e+h+|h+a+h+|a+r+g+h+|a+g+h+|o+o+f+|u+a*f+|p+u+f+|o+f+|ö+f+|g+a+s+p+|w+o+w+|h+u+h+|y+a+h+|k+y+a+h*|g+k+h+|u+r+k+|a+c+k+|e+e+p+|s+h+h+|h+ı+h*|ı+h+|b+a+h+|o+u+c+h+)$/i;

const SFX_WRAP_REGEX = /^\*[^\s*\n][^\n*]{0,20}\*[!?.~*^_\-\s]*$/;
const PURE_PUNCT_REGEX = /^[\s¡¿.,!?:;…\-_~*^'"/\\()[\]{}<>◁▷◀▶★☆•]+$/;
const CREDITS_START_REGEX =
  /^(?:çizer|çizim|yazar|hikaye|öykü|senaryo|editör|editor|çeviri|çevirmen|dizgi|temizleme|artist|author|story|art|coloring|background\s*art|script\s*editing|typesetter|cleaner|redrawer|proofreader|scanlation|fansub|w?nmega\s*scans?|omegascans(?:org)?|asurascans|asura\s*scans|reaperscans|reaper\s*scans|flamescans|raw|webtoon|bölüm\s*\d+|chapter\s*\d+|cap[íi]tulo\s*\d+|ep(?:isode)?\.?\s*\d+|vol(?:ume)?\.?\s*\d+|lee\s+antes\s+en|leia\s+antes\s+em|read\s+(?:first\s+)?(?:at|on)|read\s*early\s*(?:on|at)?|manga\s*&\s*manhwa|(?:tl|pr|cl|rd|ts|qc|ktl|tlc)(?:\s*[:\-]\s*|\s+)[a-z0-9_]{2,14}$)(?![\p{L}\p{N}_])/iu;
const CREDITS_INLINE_REGEX =
  /(?:^|[\/|•<\[])\s*(?:(?:hikaye|öykü|senaryo|yazar|çizer|çizim|sanat|editör|editor|çeviri|çevirmen|dizgi|temizleme|story|art|artist|author|coloring|traducción|traduccion|edición|edicion|limpieza|typeset)(?![\p{L}\p{N}_])(?:\s*[:\-]|[\]|/>])|(?:background\s*art|script\s*editing|written\s+by|art\s+by|story\s+by|original\s+work|scanlation|fansub|lee\s+antes\s+en|read\s+(?:first\s+)?(?:at|on))(?![\p{L}\p{N}_])\s*[:\-]?)/iu;
const WATERMARK_DOMAIN_REGEX =
  /(?:https?:\/\/|discord\.gg\/|\b[a-z0-9-]+\.(?:com|net|org|club|me|online|io|gg|xyz|to|site)\b|omegascansorg)/i;

const isPlaceholderMaskText = (t: string): boolean => {
  const alpha = t.replace(/[^\p{L}]/gu, '');
  if (alpha.length < 3) return false;
  const xCount = (alpha.match(/[xX]/g) || []).length;
  const xLikeCount = (alpha.match(/[xXiIl]/g) || []).length;
  return xCount >= 3 && xCount / alpha.length >= 0.72 && xLikeCount === alpha.length;
};

// Ses efektlerini (SFX), inlemeleri ve çizer/yazar/editör jeneriklerini filtreler
export const shouldSkipBlock = (
  text: string,
  targetLang = 'tr',
  box?: [number, number, number, number],
  lines?: OcrBubble['lines'],
): boolean => {
  const t = text.trim();
  if (t.length <= 1) return true;
  if (t.toUpperCase() === '[SFX]' || t === '[SFX]') return true;
  if (isPlaceholderMaskText(t)) return true;
  if (/^(?:NON|MANGA\s*STREAM(?:\.COM)?|MANGADASS(?:\.COM)?|TOOMICS(?:\.COM)?|STUPIDEMIC|JPIDEMIC|STUE|DO\s+NOT\s+MIRROR|MIRROR|SUCK|SLURP|LICK|ITUT|SLRP|goae|EHITS\s+ANNIVERS|VEDDING\s+KUNS|ONDERERSAR|CAN'T\s+TDOAT|HERE\.R\s+STHING|SUAL|0C|1C|OC|IC|II|OO|OHAIZ|H\s*OHH|ition[!.,]*|to|of|in|on|at|by|an|as|the|and|or)$/i.test(t)) {
    return true;
  }
  if (/^\s*(?:story|art)\s*[:;.|/\\]\s*[\p{L}\p{N}_.-]+/iu.test(t)) return true;
  if (/\bmanga\s*&\s*manhwa\b|\bin\s+english\s+free\s+at\b|\bcoloring\s*:\s*\S+.*\bbackground\s*art\s*:/i.test(t)) {
    return true;
  }
  if (/^Mooo+W!?$/i.test(t) || /^\([A-Z]{6,}$/.test(t)) return true;
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
  if (isPureSoundEffect(stripped, box, lines)) return true;

  const wordTokens = stripped
    .split(/[\s¡¿.,!?:;…\-_~*^'"/\\()[\]{}<>]+/)
    .filter(Boolean);
  if (
    wordTokens.length >= 1 &&
    wordTokens.length <= 4 &&
    !/\?\s*$/.test(stripped) &&
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

const getDeepLTranslateProxyEndpoint = (): string => {
  const env = typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env : undefined;
  const directDeepL = String(env?.VITE_DEEPL_PROXY_URL || '')
    .trim()
    .replace(/\/+$/, '');
  if (directDeepL) {
    return directDeepL.endsWith('/translate') ? directDeepL : `${directDeepL}/translate`;
  }
  const scraperUrls = String(env?.VITE_SCRAPER_PROXY_URL || '')
    .split(',')
    .map((u) => u.trim().replace(/\/+$/, ''))
    .filter(Boolean);
  const caganherdilProxy = scraperUrls.find((u) => u.includes('caganherdil.workers.dev'));
  if (caganherdilProxy) return `${caganherdilProxy}/translate`;
  return DEFAULT_TRANSLATE_PROXY_URL;
};

const STRICT_TURKISH_CHAR_REGEX = /[çğıİşÇĞŞ]/;
const STRICT_TURKISH_CHAR_GLOBAL = /[çğıİşÇĞŞ]/g;
const STRICT_TURKISH_WORD_REGEX =
  /\b(?:için|fakat|ancak|değil|kadar|sonra|önce|nasıl|neden|niye|nerede|benim|senin|onun|bizim|sizin|evet|hayır|tamam|lütfen|teşekkür|merhaba|olacak|olduğu|olarak|böyle|şöyle|keşke|acaba|belki|çünkü|rağmen|doğru|yanlış|güzel|büyük|küçük|şimdi|burada|oraya|bunu|şunu|öyle|peki|ama|yani|zaten|aslında|gerçekten|biraz|hemen|bir\s+şey|ne\s+oldu|sadece|kimse|hiçbir|herkes|olmaz|bekle|gidelim)\b/i;
const TURKISH_ASCII_WORD_REGEX =
  /\b(?:icin|degil|nasil|neden|nerede|burada|oraya|simdi|sonra|once|boyle|soyle|gercekten|cunku|ragmen|dogru|yanlis|guzel|buyuk|kucuk|herkes|kimse|hicbir|bir\s+sey|ne\s+zaman|ne\s+kadar|evet|hayir|tamam|lutfen|merhaba|tesekkur|yoksa|fakat|ancak|zaten|aslinda|belki|acaba|keske|oyle|peki|gibi|kadar|sadece|ayrica|olmaz|yeter|durun|gidelim|bekle|baksana|efendim|lanet)\b/i;
const ENGLISH_STOPWORD_REGEX =
  /\b(?:the|and|you|your|are|was|were|have|has|had|with|this|that|what|when|where|why|how|from|they|them|their|there|here|would|could|should|will|can't|don't|doesn't|didn't|isn't|aren't|wasn't|won't|i'm|you're|he's|she's|it's|we're|they're|i've|you've|we've|they've|i'll|i'd|that's|what's|there's|here's|let's|about|because|before|after|again|never|always|really|something|nothing|everything|someone|anyone|wait|stop|please|sorry|thanks|thank|hello|okay|maybe|already|actually|between|through)\b/i;
const SPANISH_STOPWORD_REGEX =
  /\b(?:que|los|las|del|por|para|con|una|unos|unas|pero|como|más|este|esta|todo|estoy|eres|tiene|hacer|cuando|donde|ahora|aquí|quién|qué|solo|muy|porque|entonces|bueno|gracias|hola)\b/i;
const PORTUGUESE_STOPWORD_REGEX =
  /\b(?:não|nao|você|voce|para|com|uma|mais|como|mas|por|seu|sua|isso|está|esta|estou|então|entao|quando|muito|também|tambem|aqui|agora|quem|tudo|obrigado|obrigada)\b/i;
const PORTUGUESE_EXCLUSIVE_REGEX = /[ãõ]|\b(?:não|você|vocês|estão|então|também|obrigado|obrigada|tudo\s+bem|meu\s+deus)\b/i;
const FRENCH_STOPWORD_REGEX =
  /\b(?:les|des|est|que|pour|dans|une|pas|plus|avec|sur|vous|nous|mais|tout|c'est|j'ai|qu'il|être|avoir|je\s+suis|tu\s+es|quoi|comment|pourquoi|merci|bonjour|salut)\b/i;
const GERMAN_STOPWORD_REGEX =
  /\b(?:ich|nicht|die|der|das|und|ein|eine|ist|mit|auf|für|sie|wir|mir|mich|dich|aber|wenn|noch|was|wie|warum|hier|jetzt|danke|hallo|bitte|schon)\b/i;
const ITALIAN_STOPWORD_REGEX =
  /\b(?:che|non|per|con|una|sono|del|della|questo|questa|più|come|anche|tutto|fare|quando|dove|perché|cosa|adesso|grazie|ciao|allora|davvero)\b/i;
const POLISH_STOPWORD_REGEX =
  /\b(?:nie|tak|jest|jak|co|to|się|dla|ale|już|tylko|może|bardzo|dobrze|proszę|dziękuję|gdzie|kiedy|dlaczego|który)\b/i;
const INDONESIAN_STOPWORD_REGEX =
  /\b(?:tidak|bukan|yang|ini|itu|untuk|dengan|dari|saya|aku|kamu|kau|dia|kita|kami|mereka|sudah|belum|bisa|harus|akan|jangan|tolong|terima\s+kasih|kenapa|bagaimana|dimana|sekarang|sangat|sekali)\b/i;
const FOREIGN_STOPWORD_REGEX =
  /\b(?:the|and|you|your|are|was|were|have|has|had|with|this|that|what|when|where|why|how|from|they|them|their|there|here|would|could|should|will|can't|don't|didn't|isn't|aren't|wasn't|I'm|you're|he's|she's|it's|we're|they're|los|las|unos|unas|del|por|para|con|sin|pero|como|cuando|donde|quien|mas|muy|este|esta|estos|estas|ese|esa|esos|esas|todo|toda|todos|todas|hacer|hace|hizo|haber|han|habia|soy|eres|somos|estoy|estan|estaba|tengo|tienes|tiene|tienen|tenia|voy|vas|puedo|puede|pueden|quiero|quiere|quieren|debi|debia|despues|antes|ahora|aqui|solo|maldita|maldito|mierda|carajo)\b/i;

const normalizeLangKey = (rawLang?: string): string => {
  const c = (rawLang || 'tr').toLowerCase().trim();
  if (c === 'pt' || c === 'pt_br' || c === 'pt-br') return 'pt-br';
  if (c === 'es-la' || c === 'es-419') return 'es';
  if (c === 'jp') return 'ja';
  if (c === 'kr') return 'ko';
  if (c === 'cn' || c.startsWith('zh-')) return 'zh';
  return c;
};

export const isLikelyAlreadyTranslated = (text: string, targetLang: string): boolean => {
  const t = text.trim();
  if (!t) return true;
  const lang = normalizeLangKey(targetLang);
  const words = t.split(/\s+/).filter(Boolean);

  if (lang === 'tr') {
    const trChars = t.match(STRICT_TURKISH_CHAR_GLOBAL)?.length ?? 0;
    const hasForeignScript = /[\u0400-\u04FF\u0600-\u06FF\u0E00-\u0E7F\u3040-\u30FF\u4E00-\u9FFF\uAC00-\uD7AF]/.test(t);
    if (hasForeignScript) return false;
    if (FOREIGN_STOPWORD_REGEX.test(t) && trChars < 2) return false;
    if (trChars >= 2) return true;
    if (STRICT_TURKISH_CHAR_REGEX.test(t) && (STRICT_TURKISH_WORD_REGEX.test(t) || TURKISH_ASCII_WORD_REGEX.test(t))) return true;
    if (words.length >= 2 && (STRICT_TURKISH_WORD_REGEX.test(t) || TURKISH_ASCII_WORD_REGEX.test(t))) return true;
    return false;
  }

  if (lang === 'en') {
    if (/[\u0400-\u04FF\u0600-\u06FF\u0E00-\u0E7F\u3040-\u30FF\u4E00-\u9FFF\uAC00-\uD7AF]/.test(t)) return false;
    if (/[çğıİşçöüäößãõñ¿¡]/i.test(t)) return false;
    if (STRICT_TURKISH_WORD_REGEX.test(t) || PORTUGUESE_EXCLUSIVE_REGEX.test(t)) return false;
    return words.length >= 2 && ENGLISH_STOPWORD_REGEX.test(t);
  }

  if (lang === 'es') {
    if (STRICT_TURKISH_CHAR_REGEX.test(t) || PORTUGUESE_EXCLUSIVE_REGEX.test(t)) return false;
    return /[¿¡ñ]/i.test(t) || (words.length >= 2 && (/[áéíóú]/i.test(t) || SPANISH_STOPWORD_REGEX.test(t)));
  }

  if (lang === 'pt-br') {
    if (STRICT_TURKISH_CHAR_REGEX.test(t) || /[¿¡]/i.test(t)) return false;
    return /[ãõ]/i.test(t) || ((/[çáéíóúâêô]/i.test(t) || PORTUGUESE_STOPWORD_REGEX.test(t)) && words.length >= 2 && PORTUGUESE_STOPWORD_REGEX.test(t));
  }

  if (lang === 'fr') {
    if (STRICT_TURKISH_CHAR_REGEX.test(t) || /[¿¡ñãõß]/i.test(t)) return false;
    return (/[àâæçéèêëîïôœùûü]/i.test(t) && words.length >= 2) || (words.length >= 2 && FRENCH_STOPWORD_REGEX.test(t));
  }

  if (lang === 'de') {
    if (STRICT_TURKISH_CHAR_REGEX.test(t)) return false;
    return (/[äöüß]/i.test(t) && words.length >= 2) || (words.length >= 2 && GERMAN_STOPWORD_REGEX.test(t));
  }

  if (lang === 'it') {
    if (STRICT_TURKISH_CHAR_REGEX.test(t) || /[¿¡ñãõßç]/i.test(t)) return false;
    return words.length >= 2 && ITALIAN_STOPWORD_REGEX.test(t);
  }

  if (lang === 'pl') {
    if (STRICT_TURKISH_CHAR_REGEX.test(t)) return false;
    return (/[ąćęłńóśźż]/i.test(t) && words.length >= 2) || (words.length >= 2 && POLISH_STOPWORD_REGEX.test(t));
  }

  if (lang === 'vi') {
    return /[ăâđêôơưàáảãạằắẳẵặầấẩẫậèéẻẽẹềếểễệìíỉĩịòóỏõọồốổỗộờớởỡợùúủũụừứửữựỳýỷỹỵ]/iu.test(t);
  }

  if (lang === 'id') {
    if (STRICT_TURKISH_CHAR_REGEX.test(t) || FOREIGN_STOPWORD_REGEX.test(t)) return false;
    return words.length >= 2 && INDONESIAN_STOPWORD_REGEX.test(t);
  }

  if (lang === 'th') return /[\u0E00-\u0E7F]{2,}/.test(t);
  if (lang === 'ru') return /[\u0400-\u04FF]{3,}/.test(t);
  if (lang === 'ar') return /[\u0600-\u06FF]{3,}/.test(t);
  if (lang === 'ko') return /[\uAC00-\uD7AF]{2,}/.test(t);
  if (lang === 'ja') return /[\u3040-\u309F\u30A0-\u30FF]{2,}/.test(t);
  if (lang === 'zh') {
    return /[\u4E00-\u9FFF]{2,}/.test(t) && !/[\u3040-\u309F\u30A0-\u30FF]/.test(t);
  }

  return false;
};

export const isPageAlreadyInTargetLanguage = (
  texts: readonly string[],
  targetLang: string,
): boolean => {
  const lang = normalizeLangKey(targetLang);
  const dialogueTexts = texts
    .map((t) => (t || '').trim())
    .filter((t) => {
      if (t.length < 4) return false;
      if (lang === 'ja' || lang === 'ko' || lang === 'zh' || lang === 'th' || lang === 'ar') {
        return /[\p{L}]/u.test(t);
      }
      const words = t.split(/\s+/).filter((w) => /[\p{L}]/u.test(w));
      return words.length >= 2;
    });

  if (dialogueTexts.length === 0) return false;
  if (dialogueTexts.length === 1) {
    const first = dialogueTexts[0];
    if (lang === 'ja' || lang === 'ko' || lang === 'zh' || lang === 'th' || lang === 'ar') {
      return first.length >= 4 && isLikelyAlreadyTranslated(first, lang);
    }
    const words = first.split(/\s+/).filter(Boolean);
    const hasUniqueMarker =
      (lang === 'tr' && (first.match(STRICT_TURKISH_CHAR_GLOBAL)?.length ?? 0) >= 2) ||
      (lang === 'es' && /[¿¡ñ]/i.test(first)) ||
      (lang === 'pt-br' && /[ãõ]/i.test(first)) ||
      (lang === 'pl' && /[ąćęłńóśźż]/i.test(first)) ||
      (lang === 'vi' && /[ăâđêôơư]/i.test(first)) ||
      (lang === 'ru' && /[\u0400-\u04FF]{3,}/.test(first));
    return (words.length >= 4 || (words.length >= 2 && hasUniqueMarker)) && isLikelyAlreadyTranslated(first, lang);
  }

  const matched = dialogueTexts.filter((t) => isLikelyAlreadyTranslated(t, lang)).length;
  return matched / dialogueTexts.length >= 0.65;
};

const INTACT_ENGLISH_WORDS = new Set([
  'together', 'understand', 'undertake', 'overcome', 'everyone', 'someone', 'anyone', 'nobody',
  'something', 'anything', 'everything', 'nothing', 'without', 'within', 'inside', 'outside',
  'another', 'whatever', 'whenever', 'wherever', 'however', 'therefore', 'meanwhile', 'otherwise',
  'instead', 'already', 'almost', 'although', 'always', 'anyway', 'became', 'become', 'before',
  'behind', 'below', 'beneath', 'beside', 'besides', 'between', 'beyond', 'forever', 'forgive',
  'forget', 'forgot', 'forward', 'herself', 'himself', 'itself', 'myself', 'yourself', 'themselves',
  'ourselves', 'sometimes', 'anywhere', 'everywhere', 'somewhere', 'nowhere', 'overnight', 'overhead',
  'cannot', 'today', 'tonight', 'tomorrow', 'yesterday', 'awakening', 'background', 'gentleman',
  'nevertheless', 'nonetheless', 'afterward', 'afterwards', 'suddenly', 'originally', 'completely',
  'unfortunately', 'congratulations', 'imagination', 'information', 'exclamation', 'explanation',
  'disappear', 'disappointed', 'interesting', 'important', 'impossible', 'difference', 'different', 'amplification',
]);

const SEGMENT_VOCAB = new Set([
  'a', 'i', 'an', 'the', 'this', 'that', 'these', 'those', 'my', 'your', 'his', 'her', 'its', 'our', 'their',
  'is', 'am', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did',
  'can', 'could', 'will', 'would', 'shall', 'should', 'may', 'might', 'must',
  'in', 'on', 'at', 'to', 'for', 'of', 'with', 'from', 'by', 'as', 'into', 'onto', 'upon', 'over', 'under',
  'through', 'about', 'after', 'before', 'around', 'against', 'between', 'even', 'just', 'only', 'also',
  'still', 'yet', 'ever', 'never', 'always', 'very', 'too', 'so', 'more', 'most', 'less', 'much', 'many',
  'such', 'some', 'any', 'no', 'not', 'yes', 'all', 'both', 'each', 'every', 'other', 'same', 'own', 'than',
  'and', 'or', 'but', 'if', 'then', 'when', 'where', 'why', 'how', 'what', 'who', 'whom', 'whose', 'which',
  'while', 'though', 'since', 'until', 'again', 'further', 'once', 'neither', 'nor',
  'he', 'she', 'it', 'we', 'they', 'you', 'me', 'him', 'us', 'them', 'one', 'two', 'three', 'first', 'last',
  'small', 'big', 'large', 'great', 'good', 'bad', 'high', 'low', 'long', 'short', 'new', 'old', 'real', 'true',
  'original', 'martial', 'unique', 'special', 'hidden', 'normal', 'strange', 'weird', 'ancient', 'supreme',
  'body', 'soul', 'mind', 'heart', 'hand', 'eyes', 'head', 'blood', 'bone', 'sword', 'constitution',
  'magic', 'mana', 'power', 'force', 'energy', 'aura', 'qi', 'spirit', 'skill', 'skills', 'level', 'rank',
  'point', 'points', 'stat', 'stats', 'status', 'system', 'world', 'human', 'people', 'person', 'man', 'woman',
  'boy', 'girl', 'master', 'lord', 'king', 'queen', 'prince', 'princess', 'knight', 'wizard', 'mage', 'hero',
  'demon', 'monster', 'beast', 'dragon', 'skeleton', 'ghost', 'god', 'angel', 'devil', 'dark', 'light',
  'stimulus', 'effect', 'cause', 'reason', 'way', 'time', 'day', 'night', 'life', 'death', 'kill', 'die', 'dead',
  'draw', 'amplify', 'amplification', 'absorb', 'trigger', 'activate', 'boost', 'grow', 'growth', 'increase',
  'ability', 'abilities', 'talent', 'talents', 'limit', 'limits', 'beyond', 'reach', 'raise', 'protect', 'heal',
  'make', 'made', 'take', 'took', 'give', 'gave', 'get', 'got', 'go', 'went', 'come', 'came', 'see', 'saw',
  'look', 'looked', 'find', 'found', 'know', 'knew', 'think', 'thought', 'feel', 'felt', 'want', 'wanted',
  'need', 'needed', 'use', 'used', 'try', 'tried', 'keep', 'kept', 'hold', 'held', 'turn', 'turned',
  'leave', 'left', 'put', 'set', 'say', 'said', 'tell', 'told', 'ask', 'asked', 'work', 'call', 'called',
  'live', 'lived', 'move', 'moved', 'play', 'wait', 'stop', 'help', 'fight', 'fought', 'win', 'won', 'lose', 'lost',
  'able', 'back', 'down', 'up', 'out', 'off', 'away', 'here', 'there', 'now', 'well', 'right', 'left',
  'strong', 'weak', 'hard', 'easy', 'fast', 'slow', 'full', 'empty', 'free', 'sure', 'fine', 'okay',
  'disguise', 'chance', 'mistake', 'secret', 'truth', 'lie', 'plan', 'order', 'quest', 'reward', 'danger',
  'enemy', 'friend', 'family', 'brother', 'sister', 'father', 'mother', 'son', 'daughter', 'child', 'kids',
  'place', 'room', 'door', 'house', 'city', 'land', 'empire', 'clan', 'sect', 'school', 'academy',
  'enough', 'almost', 'really', 'actually', 'simply', 'merely', 'already', 'quite', 'rather', 'pretty',
  'unlike', 'others', 'proper', 'principle', 'story', 'heavenly', 'stimulus', 'built', 'basic', 'physique', 'constitution',
  'cherry', 'juicy', 'like', 'lips', 'universe', 'whole', 'womanly', 'slim', 'happy', 'wedding', 'dark', 'hero',
  'genius', 'pitiful', 'soul', 'tell', 'happened', 'three', 'forever', 'morning', 'bloodbath', 'commence',
  'lesson', 'part', 'timer', 'hired', 'week', 'trash', 'wants', 'pocket', 'change', 'devils', 'newly',
  'era', 'begin', 'beginning', 'shake', 'jump', 'month', 'grand', 'balls', 'debt', 'interest', 'yen', 'dollar', 'dollars',
  'announcement', 'disaster', 'safety', 'countermeasures', 'headquarters', 'mail', 'web', 'please', 'report', 'front',
  'community', 'centre', 'center', 'response', 'location', 'thousand', 'snowfall', 'heavy', 'emergency', 'issued',
  'starting', 'tomorrow', 'excluding', 'female', 'employees', 'below', 'sign', 'site', 'log', 'hypnotic', 'state',
  'hypnotized', 'subjects', 'applied', 'pendant', 'activate', 'seconds', 'minutes', 'suggestion', 'party', 'varying',
  'depending', 'subject', 'setup', 'unreasonable', 'early', 'chapters', 'series', 'overtime',
]);

const INTACT_SHORT_WORDS = new Set([
  'tellme', 'whathas', // always split, never intact
]);

const segmentGluedEnglishToken = (token: string): string => {
  if (!/^[A-Za-z]{6,48}$/.test(token)) return token;
  const lower = token.toLowerCase();
  if (token.length < 10 && !INTACT_SHORT_WORDS.has(lower) && !/(?:of|in|is|at|by|to|on)/.test(lower)) {
    return token;
  }
  if (INTACT_ENGLISH_WORDS.has(lower)) return token;
  if (SEGMENT_VOCAB.has(lower)) return token;
  if (/(?:tion|sion|ment|ness|able|ible|ship|hood|ally|edly|fulness)$/i.test(lower) && lower.length <= 14) {
    return token;
  }

  const n = lower.length;
  const dp: Array<{ score: number; prev: number } | null> = new Array(n + 1).fill(null);
  dp[0] = { score: 0, prev: -1 };
  for (let i = 0; i < n; i += 1) {
    if (!dp[i]) continue;
    for (let j = i + 1; j <= Math.min(n, i + 16); j += 1) {
      const sub = lower.slice(i, j);
      if (!SEGMENT_VOCAB.has(sub)) continue;
      if (sub.length === 1 && sub !== 'a' && sub !== 'i') continue;
      const pieceScore = sub.length * sub.length - (sub.length <= 2 ? 2.5 : 0);
      const nextScore = dp[i]!.score + pieceScore;
      if (!dp[j] || nextScore > dp[j]!.score) {
        dp[j] = { score: nextScore, prev: i };
      }
    }
  }
  if (!dp[n]) return token;
  const parts: string[] = [];
  let cur = n;
  while (cur > 0 && dp[cur]) {
    const p = dp[cur]!.prev;
    parts.push(lower.slice(p, cur));
    cur = p;
  }
  parts.reverse();
  if (parts.length < 2) return token;
  const hasRealContentWord = parts.some((p) => p.length >= 4);
  if (!hasRealContentWord) return token;
  if (token.length < 10 && parts.some((p) => !SEGMENT_VOCAB.has(p))) return token;
  return parts.join(' ');
};

const SAFE_Z_WORD_REGEX =
  /^(?:jazz|buzz|fuzz|fizz|quiz|whiz|frizz|blitz|ritz|waltz|quartz|topaz|klutz|chintz|pizzazz|ersatz|spritz|fez|wiz|biz|ad[sz]|plz|cuz|ghz|mhz|khz|hz)$/i;

const normalizeEnglishForGoogleTranslate = (raw: string, targetLang = 'tr'): string => {
  let s = raw
    .trim()
    .replace(/\s+/g, ' ')
    // Tek kalan yetim çift tırnak Google cümle ayırıcısını bozar ("THAT'S" QUITE..." -> "BU TAM BİR TARTIŞMA")
    .replace(/(?<=\p{L})["“”](?=(?:s|t|m|d|re|ve|ll)\b)/giu, "'")
    // Kelime içi OCR '!' -> 'i' ("L!KE" -> "LIKE")
    .replace(/(?<=[A-Za-z])!(?=[A-Za-z])/g, 'i')
    // OCR 'I"ll.' / 'i'll.' hatalarını temizle ("I'll. FINALLY" -> "I'll finally")
    .replace(/(?:^|(?<=\s))[Il1]["“”'`]?ll\.(?=\s+\p{L})/gu, "I'll")
    // Kısaltmalardan sonra gelen yanlış noktayı kaldır ("Don't. WORRY" -> "Don't WORRY")
    .replace(
      /\b(i'll|i'm|i've|i'd|you're|we're|they're|he's|she's|it's|that's|what's|let's|don't|didn't|doesn't|isn't|aren't|wasn't|weren't|haven't|hasn't|hadn't|won't|can't|couldn't|wouldn't|shouldn't)\.(?=\s+\p{L})/giu,
      '$1',
    )
    // OCR '?' -> 'z' düzeltmesi ("HOWz", "DiffiCultz", "HUHz")
    .replace(
      /\b([A-Za-z]{2,})[zZ]\b(?=(?:\s|$|[.!?"'”’]))/g,
      (full, stem: string, offset: number, src: string) => {
        if (SAFE_Z_WORD_REGEX.test(full)) return full;
        if (
          /^(?:huh|eh|uh|ah|what|why|how|who|when|where|really|right|wait|difficult|serious(?:ly)?|sure|true|wrong|done|mine|yours|it|that|this|you|he|she|we|they|now|here|there|then|so|more|else|again|already|yet)$/i.test(
            stem,
          )
        ) {
          return `${stem}?`;
        }
        // Sonu ünsüz + z ile biten ("DiffiCultz", "HOWz", "WAITz") İngilizce olmayan OCR artıklarını '?' yap
        const nextChar = src.slice(offset + full.length).trimStart()[0];
        if (/[bcdfghjklmnpqrstvwxy]$/i.test(stem) && (!nextChar || /[A-Z0-9"“'¿¡(]/.test(nextChar))) {
          return `${stem}?`;
        }
        return full;
      },
    )
    .replace(/\bevem\b/gi, 'even')
    .replace(/\bdiscui[sz]e\b/gi, 'disguise')
    .replace(/\bEVENASMALLSTIMULUSS?CAN\b/gi, 'even a small stimulus can')
    .replace(/\bSTIMULUSSCAN\b/gi, 'stimulus can')
    .replace(/\bFORAMPLIFICATION\b/gi, 'for amplification')
    .replace(/\bSIMPLEPRINCIPLE\b/gi, 'simple principle')
    .replace(/\bIT'SACONSTITUTION\b/gi, "it's a physique")
    .replace(/\bAsh\s+Gray\b/gi, 'Ashgray')
    .replace(/\bbe\s+crossing\s+swords\s+with\b/gi, 'duel with')
    .replace(/\bcrossing\s+swords\s+with\b/gi, 'dueling')
    .replace(/(?<=\b(?:knew|know|found\s+out|realized)\s+it)\.(?=\s+was\b)/gi, '')
    .replace(/\bat\.\s*all\b/gi, 'at all')
    .replace(/\bxiulian\b/gi, 'cultivation')
    .replace(/\blil\b/gi, 'little')
    .replace(/\bsen[-\s]ge\b/gi, 'Brother Sen')
    .replace(/\boh\s+damn\b\s*[:;,]?/gi, 'oh crap,')
    .replace(/\bASF\b/gi, 'as hell')
    .replace(/\bWTF\b/gi, 'what the hell')
    .replace(/\bOMG\b/gi, 'oh my god')
    // Round 2 OCR glyph & fused-word repairs (JLICY -> JUICY, LINIVERSE -> UNIVERSE, 04 -> OH)
    .replace(/\bJLICY/gi, 'JUICY')
    .replace(/\bLINIVERSE/gi, 'UNIVERSE')
    .replace(/\b04(?=\s+[A-Za-z]{2,})/g, 'OH')
    .replace(/\b(pitiful|poor|lost|gentle)\s+[so]?oul\b/gi, '$1 soul')
    .replace(/(?<=,\s*)BLT(?=$|[,.!?]|\s)/gi, 'but')
    .replace(/\bYOUILL\b/gi, "you'll")
    .replace(/\bYOL['’`]?(RE|LL|VE|D)\b/gi, (_m, suf: string) => `you'${suf.toLowerCase()}`)
    .replace(/\b(?:YOLI|YOLU|YOL)\b/gi, (m: string) => (m[0] === m[0].toUpperCase() && m.slice(1) !== m.slice(1).toUpperCase() ? 'You' : 'you'))
    .replace(/\bYOUCAN'T\b/gi, "you can't")
    .replace(/\bDOIT\b/gi, 'do it')
    .replace(/\bISAID\b/gi, 'I said')
    .replace(/\bFEELGOOD\b/gi, 'feel good')
    .replace(/\bBECAUSEOF([A-Za-z]+)\b/gi, 'because of $1')
    .replace(/\bCOLLD\b/gi, 'could')
    .replace(/\bMLICH\b/gi, 'much')
    .replace(/\bQLITE\b/gi, 'quite')
    .replace(/\bBEOOINO\b/gi, 'begging')
    .replace(/\bPLEASEM\b/gi, "Please, I'm")
    .replace(/\bLIGH(?=[!.?,\s]|$)/gi, 'Ugh')
    .replace(/\bC(?:UIM|ULM|LM)(MING|S)?\b/gi, (_m, suf = '') => `cum${suf.toLowerCase()}`)
    .replace(/\b(?:FLCK|FUICK|FCK)(ING|ER|ERS|ED|S)?\b/gi, (_m, suf = '') => `fuck${suf.toLowerCase()}`)
    .replace(/\bF-FLICK\b/gi, 'F-fuck')
    .replace(/\b(what|who|how|why|where)\s+the\s+flick\b/gi, '$1 the fuck')
    .replace(/\b(?:agh|ugh)[!.\s]+flick\b/gi, (m: string) => m.replace(/flick/i, 'fuck'))
    .replace(/\bstart\s+flicking\s+(him|her|me|you|them)\b/gi, 'start fucking $1')
    .replace(/\b(?:itfumm|itumm|humm+)\b/gi, 'Hmm')
    .replace(/\borever\b/gi, 'forever')
    .replace(/\bwans\b/gi, 'wants')
    .replace(/\beanly\b/gi, 'early')
    .replace(/\byou['’]re\.\s+here\b/gi, "you're here")
    .replace(/\bhere[.,]\s*we\s+go\b/gi, 'Here we go')
    .replace(/\bnothing[.,]\s*ut\s*s\b/gi, 'Nothing but stuff')
    .replace(/\bPARONET\b/g, 'Baronet')
    .replace(/\bSeol\s*reim\b/gi, 'Seol Reim')
    .replace(/\b(\d+)([Oo]+)\b/g, (_m, d: string, o: string) => `${d}${'0'.repeat(o.length)}`)
    .replace(/\b(\d+)[Oo](\d+)\b/g, '$10$2')
    .replace(/\bLEST(?:IE)?\b(?=\s*$)/g, 'Is this a lesson?')
    .replace(/i['’`]?woul[il]?ve\s+hind\s+iht\s+ere\s+me[.,\s]*a?\s*part[\s-]*timer[~*]*/gi, 'If it were me, I would have hired a part-timer.')
    // Deyim, sesteş kelime ve Türkçe konuşma dili uyarlamaları
    .replace(/\b(\d[\d,.]*)\s+grand\b/gi, '$1 thousand dollars')
    .replace(/^\s*grand\.?\s*$/gi, 'Thousand dollars.')
    .replace(/\byou know the drill\b/gi, 'you know what to do')
    .replace(/\bredeeming quality\b/gi, 'positive trait')
    .replace(/\bsweet[\s-]+talks?\b/gi, 'charms')
    .replace(/\bno resolve\b/gi, 'no determination')
    .replace(/\bgive me a clip-on[.,]?\s*will you\??/gi, 'Can you give me a clip-on earring?')
    .replace(/\bclip-on(?!\s+earring)\b/gi, 'clip-on earring')
    .replace(/,\s*will you\?/gi, '?')
    .replace(/^well([.!?…]*)$/i, 'Alright$1')
    .replace(/^well,\s+/i, 'Alright, ')
    .replace(/^during the day\b/gi, 'In the daytime')
    .replace(/\bhow about you take it easy\b/gi, 'why do you not take it easy')
    .replace(/\bis that so[.,]\s*do you think so\??/gi, 'Really? Do you think so?')
    .replace(/\bgood\.\s*impression\b/gi, 'good impression')
    .replace(/\bnewly\s+serialized\b/gi, 'newly launched')
    .replace(/\bserialized\b/gi, 'being serialized')
    .replace(/\bchapter\s+(\d+)\s*[:\-]\s*/gi, 'Episode $1: ')
    .replace(/\ball\s+in\s+order\s+to\s+just\s+get\s+by\b/gi, 'just enough to get by')
    .replace(/\bto\s+just\s+get\s+by\b/gi, 'just to get by')
    .replace(/\bfirepunch\b/gi, 'Fire Punch')
    .replace(/\bappears\s+in\s+jump\b/gi, 'debuts in Shonen Jump magazine')
    .replace(/happy\s*wedding\s*lif[l1]/gi, 'Happy Wedding Life')
    .replace(/\bandif\b/gi, 'and if')
    .replace(/\bthat's([a-z]{2,})/gi, "that's $1")
    .replace(/\bwherethehell\b/gi, (m) => (m[0] === 'W' ? 'Where the hell' : 'where the hell'))
    .replace(/\bwhatthehell\b/gi, (m) => (m[0] === 'W' ? 'What the hell' : 'what the hell'))
    .replace(/\bwhothehell\b/gi, 'who the hell')
    .replace(/\bhowthehell\b/gi, 'how the hell')
    .replace(/\bwherethe\b/gi, 'where the')
    .replace(/\bwhatthe\b/gi, 'what the')
    .replace(/\b(?:productionteam)\b/gi, 'Production Team')
    .replace(/\bLOGISTICS\s+TEAM\s+PARK\s+OO\b/gi, 'Logistics Team, Park OO')
    .replace(/\bPRODUCTION\s+TEAM\s+HONG\s+OO\b/gi, 'Production Team, Hong OO')
    .replace(/\b(DAY|MONTH|YEAR)(XX+)\b/gi, '$1 $2')
    .replace(/\bleedaeh[do]\b/gi, 'Lee Daeho')
    .replace(/\bparkoo\b/gi, 'Park OO')
    .replace(/\bhongoo\b/gi, 'Hong OO')
    .replace(/\bcongratu[\s-]+(?:(?:l)?i)?tion\b([!?.]*)/gi, 'congratulation$1')
    .replace(/\bBECAUISEOFYOUR\b/gi, 'BECAUSE OF YOUR')
    .replace(/\bYOUCANT\b/gi, "YOU CAN'T")
    .replace(/\bYOUILL\b/gi, "YOU'LL")
    .replace(/\bGETTO\b/gi, 'GET TO')
    .replace(/\b(YOL|YOLI|YOUI)'(RE|LL|VE|D)\b/g, "YOU'$2")
    .replace(/\b(?:YOLI|YOUI)\b/g, 'YOU')
    .replace(/\bYOL\b/g, (m, _off, str) =>
      /\b[A-Z]{2,}\b/.test(str.replace(/\bYOL\b/g, '')) ? 'YOU' : m,
    )
    .replace(/\bCUIM(MING)?\b/gi, 'CUM$1')
    .replace(/\b(TO|CAN|GET\s+TO)\s+CLIM\b/gi, '$1 CUM')
    .replace(/\bMUICH\b/gi, 'MUCH')
    .replace(/\bYOUING\b/gi, 'YOUNG')
    .replace(/\b(DIDN|DON|WON|CAN|ISN|AREN|WASN|WEREN|HAVEN|HASN|HADN|WOULDN|COULDN|SHOULDN)['’`]?I\b/gi, "$1'T")
    .replace(/\bPLEASEM\b/gi, "PLEASE I'M")
    .replace(/\b(?:BEOOINO|BEGGINO)\b/gi, 'BEGGING')
    .replace(/\b(F-?)(?:FUICK|FLCK)(ING|ER|ED|S)?\b/gi, '$1FUCK$2')
    .replace(/\b(WHAT|WHO|HOW|WHERE|WHY)\s+THE\s+FLICK\b/gi, '$1 THE FUCK')
    .replace(/^\s*flick([!.]*)\s*$/i, 'Fuck$1')
    .replace(/([!?])([A-Za-z])/g, '$1 $2')
    .replace(/^\s*(\d{1,2})\.(?=[A-Za-z])/gm, '$1. ')
    .replace(/\bemergenc\.?(?=\s|$)/gi, 'emergency')
    .replace(/\btomorrov\b/gi, 'tomorrow')
    .replace(/\bHeadquarte\b(?!rs)/gi, 'Headquarters')
    .replace(/\ban\s+eme\b(?=\s|$)/gi, 'an emergency')
    .replace(/\bA\.?M\.?\s+tor\b(?=\s|$)/gi, 'A.M tomorrow')
    .replace(/\bYeondae-ri\s+Com+n?\b(?=\s|$|\])/gi, 'Yeondae-ri Community Centre')
    .replace(/^(?:IT|u)\s+announcement\s+from\s+the\s+Dis\.?/i, '[This is an announcement from the Disaster')
    .replace(/\blog\s+in\s+to\s*\+\s*$/i, 'log in to the emergency site]')
    .replace(/\bto\s+t\s*$/i, 'to the emergency site]')
    .replace(/\]\.(?=\s|$)/g, ']')
    .replace(/\bServy\b/gi, 'Service')
    .replace(/\bCantet\b/gi, 'Center')
    .replace(/\bHan-?myun\b/gi, 'Hana-myun')
    .replace(/\bveally\b/gi, 'really')
    .replace(/\bHypn[o0]t[il1]?c\s+Stat[eo0]?\b(?:\s*0\s*\/\s*1)?/gi, 'Hypnotic State')
    .replace(/\bactivate\s+the\s+pendant\b/gi, 'activate the necklace pendant')
    .replace(/(\p{L})([.]{2,}|…)(?=\p{L})/gu, '$1$2 ')
    .replace(/\bPiease\b/gi, 'Please')
    .replace(/\bBesponse\s*Location\b/gi, 'Response Location')
    .replace(
      /(\[?\s*)\bWeb\s*Mai(?:l{1,2})?\b(\]?)/gi,
      (_, pre, post) => `${pre}Web Mail${pre.includes('[') || post ? ']' : ''}`,
    )
    .replace(/\bCentrel\b/gi, 'Centre]')
    .replace(/\bsadari\s+game\b/gi, 'Ladder Game')
    .replace(/\bj[lu]icy\s*,?\s*cherry[\s-]*like\s*lips\b/gi, 'juicy, cherry-like lips')
    .replace(/\bcherry\s+like\s+lips\b/gi, 'cherry-like lips')
    .replace(/\bwomanly,?\s*yet\s+slim\s+body,?\s*(?:but|blt)\b/gi, 'feminine and slender body, though')
    .replace(/\blol\b(?=[.!?\s]*$)/gi, 'haha')
    .replace(/\bbusiness is booming\b/gi, 'business is thriving')
    .replace(/\bsometimes\.\s*she\b/gi, 'Sometimes, she')
    .replace(/^\.{1,3}\s*(?=[A-Za-z])/, '')
    .replace(/\btotop\s+that\s+off\b/gi, 'to top it off')
    .replace(/\bkillin'\s+one\s+devil's\b/gi, 'killing one devil')
    .replace(/(?<=[a-z]{2})([A-Z][a-z]{2,})/g, ' $1');

  // Dengesiz tek tırnak/çift tırnak işaretini temizle
  if ((s.match(/"/g) || []).length === 1) {
    s = s.replace(/"/g, '');
  }
  s = s.replace(/\bthat's\s+quite\s+the\s+disguise\b/gi, 'What a disguise');

  // Bitişik kalmış İngilizce kelimeleri ayır ("EVENASMALLSTIMULUSCAN", "CHERRYLIKELIPS", "OFADARK")
  s = s
    .replace(/\b[A-Za-z]{6,48}\b/g, (tok) => segmentGluedEnglishToken(tok))
    .replace(/\bconstitution\s+built\s+for\b/gi, 'physique built for');

  // Baskın BÜYÜK HARF OCR metnini (veya OCR kaynaklı bozuk karışık harfleri: "WoRK HeAltHy", "PoPulAR AMong tHe MeN", "AheM, YeS.")
  // Google Çeviri'nin özel isim ("US" -> "ABD", "WoRK" -> "WORK", "A" -> "A hamlesi") sanmaması için cümle düzenine indir
  s = s.replace(
    /\b(?:(the|in|of|from)\s+US|US(?=\s+(?:gov\w*|president|military|army|dollar\w*|citizens?|law\w*|border|forces?|embassy)\b))\b/g,
    (m) => m.replace(/\bUS\b/, 'U.S.'),
  );
  const upperCount = (s.match(/[A-Z]/g) || []).length;
  const lowerCount = (s.match(/[a-z]/g) || []).length;
  const hasInteriorMixedCase = /[a-z][A-Z]/.test(s);
  const allCapsShoutTokens = s.match(/\b[A-Z]{2,}(?:'[A-Z]{1,2})?\b/g) || [];
  const KEEP_ACRONYMS = new Set([
    'OK', 'TV', 'PC', 'UI', 'HP', 'MP', 'XP', 'LV', 'LVL', 'ID', 'VIP', 'RPG', 'NPC',
    'DM', 'SMS', 'URL', 'CEO', 'FBI', 'CIA', 'DJ', 'AI', 'AM', 'PM', 'UK',
    'TR', 'EN', 'OO', 'XX', 'XXX', 'II', 'III', 'IV', 'VI', 'VII', 'VIII', 'IX',
  ]);
  const hasAllCapsShoutWord = allCapsShoutTokens.some((tok) => !KEEP_ACRONYMS.has(tok.replace(/'[A-Z]+$/, '')));
  if (
    hasAllCapsShoutWord ||
    (hasInteriorMixedCase && lowerCount <= upperCount * 1.6) ||
    (upperCount >= 2 &&
      (lowerCount <= Math.max(1, upperCount * 0.18) ||
        ((hasInteriorMixedCase || upperCount >= 6) && lowerCount <= upperCount * 0.55)))
  ) {
    const isMajorityAllCapsBlock = hasAllCapsShoutWord || lowerCount <= upperCount * 0.45;
    s = s.replace(/\b(?=[A-Za-z']*?(?:[A-Z]{2}|[a-z][A-Z]))[A-Za-z']+\b/g, (tok) =>
      KEEP_ACRONYMS.has(tok.replace(/'[A-Z]+$/, '')) ? tok : tok.toLocaleLowerCase('en-US'),
    );
    if (isMajorityAllCapsBlock) {
      s = s.replace(/\bA\b/g, 'a');
    }
    s = s.replace(/(^|[.!?…]\s+|[-–—]\s*|\[)([a-z])/g, (_, pre: string, ch: string) => `${pre}${ch.toUpperCase()}`);
    s = s.replace(/\bi\b/g, 'I').replace(/\bi(?='(?:m|ll|ve|d)\b)/g, 'I');
  }

  // Özel isim ve Korece/Japonca hitapları Google Çeviri'nin yanlış çevirmesini önlemek için büyük harfle koru
  s = s.replace(
    /\b(haram|jung|hyemin|denji|pochita|koharu|seol|reim|noona|oppa|hyung|unnie|sunbae|penelope|daeho|maeng)\b/gi,
    (w) => w[0].toUpperCase() + w.slice(1).toLowerCase(),
  );

  // Kısa emir/ünlem kalıplarında sözlük mastarı ("BAKMAK.", "KUYU", "İTMEK", "Durmak") yerine gerçek konuşma karşılığını seç
  if (targetLang === 'tr') {
    s = s
      .replace(/^([.…]*)my\.\s+(?=\p{L})/iu, '$1Oh my, ')
      .replace(/\bhey[.,]\s*look\s*([.,!…]*)$/i, 'Hey, look here$1')
      .replace(/^look\s*([.,!…]*)$/i, 'Look here$1')
      .replace(/^well([.!?…]*)$/i, 'Well then$1')
      .replace(/^push([.!]*)$/i, 'Push it$1')
      .replace(/^stop([.!…]*)$/i, 'Stop it$1')
      .replace(/^confined\?$/i, 'Imprisoned?')
      .replace(/^tip$/i, 'Hint')
      .replace(/\bcan't\s+get\s+involved\b/gi, "can't get mixed up in this")
      .replace(/\bdon't\s+want\s+to\s+(?:ever\s+)?get\s+involved\b/gi, "don't want to ever get mixed up in this")
      .replace(/\bhere\s+you\s+go([!.]*)/gi, 'here it is for you$1')
      .replace(/^\s*i['’`]?m\s+sorry\s*\?\s*$/i, 'Pardon me?')
      .replace(/^\s*i['’`]?m\s+sorry([.…]+)\s*\?\s*$/i, 'Pardon me$1?')
      .replace(/\bno one will miss (?:one|a) pair\b/gi, 'no one will notice a missing pair')
      .replace(/(?<='\p{L})["“”]/gu, '')
      .replace(
        /\bill(?=\s+(?:be|do|go|have|get|make|take|see|tell|give|come|show|try|let|find|use|kill|help|cut|handle|wait|say|stop|start|stay|leave|ask|keep|hold|put|bring|send)\b)/gi,
        "I'll",
      );
  }

  return s.replace(/\s+/g, ' ').trim();
};

const postProcessTranslatedBubbleText = (
  origSrc: string,
  rawCand: string,
  targetLang: string,
): string => {
  let cand = rawCand
    .replace(/\bAshgray\b/gi, 'Ash Gray')
    .replace(/[iİ]lk[iİ]'?y[iİ]/giu, 'ilkeyi');
  if (targetLang === 'tr') {
    if (/\bnoona\b/i.test(origSrc) && !/\bnoon\b/i.test(origSrc)) {
      cand = cand.replace(/\böğlen(?:e|i|den)?\b/giu, 'Noona');
    }
    if (/\bharam\b/i.test(origSrc)) {
      cand = cand.replace(/\bMescid-i\s+Haram/giu, 'Haram');
      if (/\bjung\b/i.test(origSrc)) {
        cand = cand.replace(/\byasadışı\b/giu, 'HARAM');
      }
    }
    if (/\bdenji\b/i.test(origSrc)) {
      cand = cand.replace(/\bworthy\b/giu, 'Denji');
    }
    if (/^\s*pochita[.!?…]*\s*$/i.test(origSrc)) {
      cand = origSrc.replace(/pochita/i, 'Pochita');
    }
    if (/^\s*push\s*[.!]?\s*$/i.test(origSrc)) {
      cand = 'İT';
    }
    if (/^\s*h+m+([?!.…]*)\s*$/i.test(origSrc)) {
      const tail = origSrc.match(/^\s*h+m+([?!.…]*)\s*$/i)?.[1] || '';
      cand = `Hmm${tail}`;
    } else if (/^\s*u+m+([?!.…]*)\s*$/i.test(origSrc)) {
      const tail = origSrc.match(/^\s*u+m+([?!.…]*)\s*$/i)?.[1] || '';
      cand = `Şey${tail}`;
    } else if (/^\s*do\s+you([.…]+)\s*$/i.test(origSrc)) {
      const tail = origSrc.match(/^\s*do\s+you([.…]+)\s*$/i)?.[1] || '...';
      cand = `Acaba${tail}`;
    } else if (/^\s*yes[!.]*\s+here\s+you\s+go([!.]*)\s*$/i.test(origSrc)) {
      const tail = origSrc.match(/^\s*yes[!.]*\s+here\s+you\s+go([!.]*)\s*$/i)?.[1] || '!';
      cand = `Evet! Buyurun${tail}`;
    } else if (/^\s*download\s*$/i.test(origSrc)) {
      cand = 'İndir';
    } else if (/^\s*h+u+p+[-–—.!~\s…]*$/i.test(origSrc)) {
      cand = 'Hııh-';
    } else if (/^\s*ahem[,.\s…]+then([.!?\s…]*)$/i.test(origSrc)) {
      const tail = origSrc.match(/^\s*ahem[,.\s…]+then([.!?\s…]*)$/i)?.[1] || '...';
      cand = `Öhö, o zaman${tail}`;
    } else if (/^\s*ahem[,.\s…]+yes([.!?\s…]*)$/i.test(origSrc)) {
      const tail = origSrc.match(/^\s*ahem[,.\s…]+yes([.!?\s…]*)$/i)?.[1] || '.';
      cand = `Öhö, evet${tail}`;
    } else if (/^\s*wait([.!?\s…]*)$/i.test(origSrc) && /^\s*beklemek\b/i.test(cand)) {
      const tail = origSrc.match(/^\s*wait([.!?\s…]*)$/i)?.[1] || '...';
      cand = `Bekle${tail}`;
    }
    if (/^\s*u+m+[,.…!\s]+/i.test(origSrc) && /^\s*um\b/i.test(cand)) {
      cand = cand.replace(/^\s*um\b/i, 'Şey');
    }
    if (/^\s*h+n+h+[,.…!\s]+/i.test(origSrc) && /^\s*h+n+h+\b/i.test(cand)) {
      cand = cand.replace(/^\s*h+n+h+\b/i, 'Hııh');
    }
    if (/\bahem\b/i.test(origSrc)) {
      cand = cand.replace(/\bahem\b/gi, 'Öhö');
    }
    if (/\bmaeng\b/i.test(origSrc) && !/\bmaeng\b/i.test(cand)) {
      cand = cand.replace(/\b(şef|Şef|ŞEF)([.!?\s…]*)$/u, (_, chief, tail) =>
        chief === 'ŞEF' ? `ŞEF MAENG${tail}` : `Şef Maeng${tail}`,
      );
    }
    cand = cand
      .replace(/\bkolye\s+kolyesi(ni|ne|nde|nden)?\b/giu, (_, suf: string | undefined) => {
        const sfxMap: Record<string, string> = { ni: 'yi', ne: 'ye', nde: 'de', nden: 'den' };
        const mapped = suf ? sfxMap[suf.toLowerCase()] ?? '' : '';
        return `kolye${mapped}`;
      })
      .replace(/\boturum\s+aç[ıiİI]n\s+ve\s+oturum\s+aç[ıiİI]n\b/giu, 'kayıt olup giriş yapın')
      .replace(/(^|[^\p{L}])(önceki\s+günden\s+itibaren\s+fazla\s+mesai)(?=$|[^\p{L}])/giu, (_, lead: string, match: string) => {
        if (match === match.toLocaleUpperCase('tr-TR')) return `${lead}ÖNCEKİ GÜNÜN FAZLA MESAİSİ`;
        if (/^[A-ZÇĞİÖŞÜ]/.test(match)) return `${lead}Önceki günün fazla mesaisi`;
        return `${lead}önceki günün fazla mesaisi`;
      });
    if (/\b(?:a\s+)?thousand\s+won\b/i.test(origSrc)) {
      cand = cand.replace(/\b(bin|yüz)\s+kazand[ıiİI](?![\p{L}\p{N}_])/giu, '$1 won');
    }
    const sStopMatch = origSrc.match(/^\s*s-+\s*stop([.!?\s…]*)$/i);
    if (sStopMatch) {
      const tailPunct = (sStopMatch[1] || '').replace(/\s+/g, '');
      cand = `D-dur${tailPunct}`;
    } else if (/^\s*stop([.!?\s…]*)$/i.test(origSrc) && /^\s*durmak\b/i.test(cand)) {
      cand = cand.replace(/^\s*durmak\b/i, 'Dur');
    }
    if (/\bkendini\b/i.test(cand) && /\boldu[ğg]unuz\b/i.test(cand)) {
      cand = cand
        .replace(/\bolduğunuz\b/gu, 'olduğun')
        .replace(/\bOLDUĞUNUZ\b/gu, 'OLDUĞUN')
        .replace(/\bsize\b/giu, (m) => (m === m.toUpperCase() ? 'SANA' : 'sana'));
    }
    if (/[)\]]\s*$/.test(cand) && !cand.includes('(') && !cand.includes('[')) {
      cand = cand.replace(/[)\]]+\s*$/, '').trim();
    }
    cand = cand.replace(
      /\b(lojistik|üretim)\s+(?:ekip|ekibi|takımı)\s+park[ıi]\b/giu,
      (_, dept: string) =>
        `${dept.charAt(0).toLocaleUpperCase('tr-TR')}${dept.slice(1).toLocaleLowerCase('tr-TR')} Ekibi, Park`,
    );
  }
  return cand;
};

const cleanupTurkishAcabaDuplicates = (out: string[], targetLang: string): string[] => {
  if (targetLang === 'tr') {
    for (let k = 1; k < out.length; k += 1) {
      if (/^\s*acaba[.…\s]*$/i.test(out[k - 1] || '') && /^\s*acaba\s+/i.test(out[k] || '')) {
        const rest = (out[k] || '').replace(/^\s*acaba\s+/i, '');
        if (rest) {
          out[k] = rest.charAt(0).toLocaleUpperCase('tr-TR') + rest.slice(1);
        }
      }
    }
  }
  return out;
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
      payloadTexts.push(normalizeEnglishForGoogleTranslate(t, targetLang));
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
          const origSrc = trimmedList[origIdx] || '';
          const rawCand = typeof json.translations![i] === 'string' ? json.translations![i].trim() : '';
          const cand = postProcessTranslatedBubbleText(origSrc, rawCand, targetLang);
          if (cand) out[origIdx] = cand;
        });
        return cleanupTurkishAcabaDuplicates(out, targetLang);
      }
    }
  } catch {
    // Proxy ulaşılamazsa orijinal listeyi koru
  }

  return trimmedList;
};

const deeplKeyPoolSlots = new Map<string, { invalidUntil: number; cooldownUntil: number }>();

/**
 * DeepL API proxy'si ile toplu metin çevirisi (çoklu anahtar havuzu + kota/hata durumunda Google Çeviri fallback'i).
 */
export const translateBatchWithDeepL = async (
  texts: readonly string[],
  targetLang: string,
  deeplKeys: readonly string[],
  signal?: AbortSignal,
): Promise<string[]> => {
  if (texts.length === 0) return [];
  const normalizedKeys = normalizeDeepLApiKeysList(deeplKeys);
  if (normalizedKeys.length === 0) {
    throw new Error('DEEPL_KEY_INVALID: DeepL API anahtarı bulunamadı.');
  }

  const trimmedList = texts.map((t) => (t || '').trim());
  const nonEmptyIndices: number[] = [];
  const payloadTexts: string[] = [];

  trimmedList.forEach((t, idx) => {
    if (t.length > 1) {
      nonEmptyIndices.push(idx);
      payloadTexts.push(normalizeEnglishForGoogleTranslate(t, targetLang));
    }
  });

  if (payloadTexts.length === 0) return trimmedList;

  const endpoint = getDeepLTranslateProxyEndpoint();
  const maxAttempts = Math.max(normalizedKeys.length * 2, 3);

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (signal?.aborted) {
      throw new DOMException('İptal edildi', 'AbortError');
    }
    const now = Date.now();
    const validKeys = normalizedKeys.filter((k) => {
      const slot = deeplKeyPoolSlots.get(k);
      return !slot || slot.invalidUntil <= now;
    });
    if (validKeys.length === 0) {
      throw new Error('DEEPL_KEY_INVALID: DeepL API anahtarı geçersiz.');
    }
    const readyKeys = validKeys.filter((k) => {
      const slot = deeplKeyPoolSlots.get(k);
      return !slot || slot.cooldownUntil <= now;
    });
    if (readyKeys.length === 0) {
      break;
    }

    const activeKey = readyKeys[attempt % readyKeys.length];
    let slot = deeplKeyPoolSlots.get(activeKey);
    if (!slot) {
      slot = { invalidUntil: 0, cooldownUntil: 0 };
      deeplKeyPoolSlots.set(activeKey, slot);
    }

    try {
      const reqSignal = signal
        ? AbortSignal.any([signal, AbortSignal.timeout(12000)])
        : AbortSignal.timeout(12000);
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `DeepL-Auth-Key ${activeKey}`,
        },
        body: JSON.stringify({
          provider: 'deepl',
          tl: targetLang,
          texts: payloadTexts,
        }),
        signal: reqSignal,
      });

      const json = (await res.json().catch(() => null)) as {
        error?: string;
        translations?: unknown;
      } | null;

      if (
        res.status === 401 ||
        res.status === 403 ||
        json?.error === 'DEEPL_KEY_INVALID' ||
        json?.error === 'DEEPL_API_KEY_REQUIRED'
      ) {
        slot.invalidUntil = Date.now() + INVALID_KEY_ISOLATION_MS;
        continue;
      }
      if (res.status === 429 || json?.error === 'DEEPL_QUOTA_EXCEEDED') {
        slot.cooldownUntil = Date.now() + DEFAULT_KEY_COOLDOWN_MS;
        continue;
      }

      if (
        res.ok &&
        Array.isArray(json?.translations) &&
        json.translations.length === payloadTexts.length
      ) {
        const out = [...trimmedList];
        nonEmptyIndices.forEach((origIdx, i) => {
          const origSrc = trimmedList[origIdx] || '';
          const rawCand =
            typeof json.translations![i] === 'string' ? json.translations![i].trim() : '';
          const cand = postProcessTranslatedBubbleText(origSrc, rawCand, targetLang);
          if (cand) out[origIdx] = cand;
        });
        return cleanupTurkishAcabaDuplicates(out, targetLang);
      }

      slot.cooldownUntil = Date.now() + 4000;
    } catch (err) {
      if (isAbortTranslationError(err) || signal?.aborted) {
        throw new DOMException('İptal edildi', 'AbortError');
      }
      slot.cooldownUntil = Date.now() + 4000;
    }
  }

  const remainingValid = normalizedKeys.some((k) => {
    const slot = deeplKeyPoolSlots.get(k);
    return !slot || slot.invalidUntil <= Date.now();
  });
  if (!remainingValid) {
    throw new Error('DEEPL_KEY_INVALID: DeepL API anahtarı geçersiz.');
  }

  console.warn('[DeepL Fallback to Google Translate]');
  return await translateBatchWithGoogleFree(texts, targetLang, signal);
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
    '1. Keep actual personal character names (e.g. Jiang Cheng, Kim Jeonghyuk, Sung Jinwoo) and Asian honorifics (Oppa, Hyung, Sunbae, San, Kun, Chan, Sama, Sensei) in their original romanized spelling. However, ALWAYS translate descriptive nicknames, usernames, monster/species names, item/weapon names, skill names, titles, and RPG abbreviations like LVL (e.g. "OWNER: JUST A DUMB CUTIE (LVL: 1)" -> translate the whole phrase including "JUST A DUMB CUTIE" and "LVL: 1"; "LEVEL: LVL 1" -> translate both).',
    '2. Keep translations concise so they fit neatly inside speech bubbles and status rows.',
    '3. SOUND EFFECTS (SFX) FILTERING: If an entry is purely an onomatopoeia / sound effect (SFX) representing a sound, reaction, or noise without dialogue/story narration (e.g., "Crack!", "STARTLE!", "Gasp", "Thump", "Whoosh", "Clang", "Swoosh", "Patter", "Rumble", "Flinch", "Twitch", "BAM", "Zzzt", "Doki doki", etc.), return exactly "[SFX]" or the unchanged original text. DO NOT translate meaningless sound effects. BUT DO TRANSLATE meaningful statements, exclamations, questions, dialogue, narration, and system text (e.g., "NO!", "ALONE?", "FIRST MURDER.", "HELP ME!", RPG status stats like "HEALTH: 100", etc.).',
    `4. Return a JSON object with a "translations" array of exactly ${payloadTexts.length} strings matching input order.`,
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
  deeplApiKeys?: readonly string[];
  provider?: TranslationSettings['provider'];
  imageSrc: string;
  targetLang: string;
  signal?: AbortSignal;
}

export interface ExtractedPageOcr {
  fullCanvas: HTMLCanvasElement;
  fullCtx: CanvasRenderingContext2D;
  fullWidth: number;
  fullHeight: number;
  rawBubbles: OcrBubble[];
  ocrMs: number;
  tStart: number;
}

const releaseCanvasBuffer = (canvas: HTMLCanvasElement | null | undefined) => {
  if (!canvas) return;
  canvas.width = 0;
  canvas.height = 0;
};

export const releaseExtractedPageOcr = (ocrData: ExtractedPageOcr | null | undefined) => {
  if (!ocrData) return;
  releaseCanvasBuffer(ocrData.fullCanvas);
};

const SEAM_EDGE_THRESHOLD_NORM = 60;
const SEAM_STRIP_HEIGHT_PX = 300;
const MAX_SEAM_CACHE_ENTRIES = 24;

interface SeamBubbleInfo {
  yminPx: number;
  xminPx: number;
  ymaxPx: number;
  xmaxPx: number;
  text: string;
}

interface SeamOcrStripResult {
  topW: number;
  topH: number;
  botW: number;
  botH: number;
  stripW: number;
  seamY: number;
  bubbles: SeamBubbleInfo[];
}

const seamOcrCache = new Map<string, Promise<SeamOcrStripResult | null>>();

const loadCanvasFromImageSrc = async (
  src: string,
  signal?: AbortSignal,
): Promise<HTMLCanvasElement> => {
  const blob = await fetchTranslatableImageBlob(src, signal);
  if (signal?.aborted) {
    throw new DOMException('İptal edildi', 'AbortError');
  }
  const img = await loadImageElementFromBlob(blob);
  const width = img.naturalWidth || img.width;
  const height = img.naturalHeight || img.height;
  if (width <= 0 || height <= 0) {
    throw new Error('Komşu sayfa boyutları geçersiz');
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Komşu canvas bağlamı oluşturulamadı');
  ctx.drawImage(img, 0, 0);
  return canvas;
};

/**
 * Ardışık iki webtoon sayfasının birleşim şeridini (üst sayfanın son 300px + alt sayfanın ilk 300px)
 * tek görsel olarak OCR'dan geçirir ve dikişi (`seamY`) aşan konuşma balonlarını döndürür.
 * Her komşu çifti oturum içi sınırlı önbellekte tutulur; iptal veya hata durumunda önbellekten düşülür.
 */
const getOrComputeSeamOcr = (
  topSrc: string,
  bottomSrc: string,
  preloadedTop?: HTMLCanvasElement,
  preloadedBottom?: HTMLCanvasElement,
  signal?: AbortSignal,
): Promise<SeamOcrStripResult | null> => {
  const key = `${topSrc}::${bottomSrc}`;
  const existing = seamOcrCache.get(key);
  if (existing) return existing;

  if (seamOcrCache.size >= MAX_SEAM_CACHE_ENTRIES) {
    const oldestKey = seamOcrCache.keys().next().value;
    if (oldestKey !== undefined) seamOcrCache.delete(oldestKey);
  }

  const job = (async (): Promise<SeamOcrStripResult | null> => {
    let loadedTopCanvas: HTMLCanvasElement | null = null;
    let loadedBottomCanvas: HTMLCanvasElement | null = null;
    let stripCanvas: HTMLCanvasElement | null = null;

    try {
      const [topCanvas, botCanvas] = await Promise.all([
        preloadedTop
          ? Promise.resolve(preloadedTop)
          : loadCanvasFromImageSrc(topSrc, signal).then((canvas) => {
              loadedTopCanvas = canvas;
              return canvas;
            }),
        preloadedBottom
          ? Promise.resolve(preloadedBottom)
          : loadCanvasFromImageSrc(bottomSrc, signal).then((canvas) => {
              loadedBottomCanvas = canvas;
              return canvas;
            }),
      ]);
      if (signal?.aborted) {
        throw new DOMException('İptal edildi', 'AbortError');
      }

      const topW = topCanvas.width;
      const topH = topCanvas.height;
      const botW = botCanvas.width;
      const botH = botCanvas.height;
      const topSliceH = Math.min(SEAM_STRIP_HEIGHT_PX, topH);
      const botSliceH = Math.min(SEAM_STRIP_HEIGHT_PX, botH);
      if (topSliceH < 24 || botSliceH < 24) return null;

      const stripW = Math.max(topW, botW);
      const stripH = topSliceH + botSliceH;
      stripCanvas = document.createElement('canvas');
      stripCanvas.width = stripW;
      stripCanvas.height = stripH;
      const stripCtx = stripCanvas.getContext('2d');
      if (!stripCtx) return null;

      stripCtx.drawImage(
        topCanvas,
        0,
        topH - topSliceH,
        topW,
        topSliceH,
        0,
        0,
        stripW,
        topSliceH,
      );
      stripCtx.drawImage(
        botCanvas,
        0,
        0,
        botW,
        botSliceH,
        0,
        topSliceH,
        stripW,
        botSliceH,
      );

      const ocr = await runFastWebtoonOcr(stripCanvas, signal);
      const seamY = topSliceH;
      const crossing = ocr.bubbles
        .map((b) => ({
          yminPx: (b.box[0] / 1000) * stripH,
          xminPx: (b.box[1] / 1000) * stripW,
          ymaxPx: (b.box[2] / 1000) * stripH,
          xmaxPx: (b.box[3] / 1000) * stripW,
          text: b.text,
        }))
        .filter((sb) => sb.yminPx < seamY - 2 && sb.ymaxPx > seamY + 2 && sb.text.trim().length > 0);

      return {
        topW,
        topH,
        botW,
        botH,
        stripW,
        seamY,
        bubbles: crossing,
      };
    } finally {
      releaseCanvasBuffer(stripCanvas);
      releaseCanvasBuffer(loadedTopCanvas);
      releaseCanvasBuffer(loadedBottomCanvas);
    }
  })().catch((err) => {
    seamOcrCache.delete(key);
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw err;
    }
    console.warn('[Seam OCR Error]', err);
    return null;
  });

  seamOcrCache.set(key, job);
  return job;
};

const mergeSamePageSeamFragments = (
  bubbles: OcrBubble[],
  indices: number[],
  seamText: string,
  seamEraseOnly: boolean,
): OcrBubble => {
  let ymin = 1000;
  let xmin = 1000;
  let ymax = 0;
  let xmax = 0;
  const mergedLines: NonNullable<OcrBubble['lines']> = [];
  let maxEmphasis: number | undefined;
  for (const idx of indices) {
    const b = bubbles[idx];
    if (b.box[0] < ymin) ymin = b.box[0];
    if (b.box[1] < xmin) xmin = b.box[1];
    if (b.box[2] > ymax) ymax = b.box[2];
    if (b.box[3] > xmax) xmax = b.box[3];
    if (b.lines) mergedLines.push(...b.lines);
    if (b.emphasisLastLineScale) {
      maxEmphasis = Math.max(maxEmphasis ?? 1, b.emphasisLastLineScale);
    }
  }
  return {
    box: [ymin, xmin, ymax, xmax],
    text: seamEraseOnly ? '' : seamText,
    lines: mergedLines.length > 0 ? mergedLines : undefined,
    emphasisLastLineScale: maxEmphasis,
    seamEraseOnly,
  };
};

/**
 * 1. AŞAMA: Görseli yükler, hazırlar ve yerel WASM OCR (PaddleOCR ONNX Web Worker) ile metin balonlarını çıkarır.
 * CPU/Worker ağırlıklıdır; tamamlandığı an sıradaki sayfanın OCR'ına hemen geçilebilir!
 */
export const extractPageOcr = async ({
  imageSrc,
  prevImageSrc,
  nextImageSrc,
  targetLang,
  signal,
}: {
  imageSrc: string;
  prevImageSrc?: string;
  nextImageSrc?: string;
  targetLang: string;
  signal?: AbortSignal;
}): Promise<ExtractedPageOcr> => {
  const tStart = performance.now();
  let ocrMs = 0;

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
    releaseCanvasBuffer(fullCanvas);
    throw new Error('Canvas bağlamı oluşturulamadı');
  }

  try {
    fullCtx.drawImage(img, 0, 0);

    // Yerel OCR ile metin satırlarını bul ve balonlara grupla
    const tOcrStart = performance.now();
    const ocr = await runFastWebtoonOcr(fullCanvas, signal);
    if (signal?.aborted) {
      throw new DOMException('İptal edildi', 'AbortError');
    }

    let workingBubbles = ocr.isPromoPage ? [] : [...ocr.bubbles];

    if (!ocr.isPromoPage && workingBubbles.length > 0) {
      const hasTopEdgeBubble =
        Boolean(prevImageSrc) && workingBubbles.some((b) => b.box[0] <= SEAM_EDGE_THRESHOLD_NORM);
      const hasBottomEdgeBubble =
        Boolean(nextImageSrc) && workingBubbles.some((b) => b.box[2] >= 1000 - SEAM_EDGE_THRESHOLD_NORM);

      const [topSeam, bottomSeam] = await Promise.all([
        hasTopEdgeBubble && prevImageSrc
          ? getOrComputeSeamOcr(prevImageSrc, imageSrc, undefined, fullCanvas, signal)
          : Promise.resolve(null),
        hasBottomEdgeBubble && nextImageSrc
          ? getOrComputeSeamOcr(imageSrc, nextImageSrc, fullCanvas, undefined, signal)
          : Promise.resolve(null),
      ]);
      if (signal?.aborted) {
        throw new DOMException('İptal edildi', 'AbortError');
      }

      const applySeamResolution = (
        seam: SeamOcrStripResult | null,
        edgeSide: 'top' | 'bottom',
      ) => {
        if (!seam || seam.bubbles.length === 0) return;
        const matchesBySeamIdx = new Map<number, number[]>();
        for (let i = 0; i < workingBubbles.length; i += 1) {
          const b = workingBubbles[i];
          if (edgeSide === 'top' && b.box[0] > SEAM_EDGE_THRESHOLD_NORM) continue;
          if (edgeSide === 'bottom' && b.box[2] < 1000 - SEAM_EDGE_THRESHOLD_NORM) continue;

          const scaleX = seam.stripW / fullWidth;
          const bx0 = (b.box[1] / 1000) * fullWidth * scaleX;
          const bx1 = (b.box[3] / 1000) * fullWidth * scaleX;
          const bwPx = Math.max(1, bx1 - bx0);
          const by0Orig = (b.box[0] / 1000) * fullHeight;
          const by1Orig = (b.box[2] / 1000) * fullHeight;
          const by0Strip =
            edgeSide === 'top'
              ? seam.seamY + by0Orig
              : seam.seamY - (fullHeight - by0Orig);
          const by1Strip =
            edgeSide === 'top'
              ? seam.seamY + by1Orig
              : seam.seamY - (fullHeight - by1Orig);

          let bestSeamIdx = -1;
          let bestOverlap = 0;
          for (let sIdx = 0; sIdx < seam.bubbles.length; sIdx += 1) {
            const sb = seam.bubbles[sIdx];
            const sbW = Math.max(1, sb.xmaxPx - sb.xminPx);
            const overlapX = Math.min(bx1, sb.xmaxPx) - Math.max(bx0, sb.xminPx);
            const minW = Math.min(bwPx, sbW);
            const bCenterX = (bx0 + bx1) * 0.5;
            const horizontallyAligned =
              overlapX > minW * 0.35 ||
              (bCenterX >= sb.xminPx - 18 && bCenterX <= sb.xmaxPx + 18 && bwPx <= sbW * 1.4);
            if (!horizontallyAligned) continue;

            const verticallyValid =
              edgeSide === 'top'
                ? by0Strip <= sb.ymaxPx + 12 && by1Strip >= seam.seamY - 6
                : by1Strip >= sb.yminPx - 12 && by0Strip <= seam.seamY + 6;
            if (!verticallyValid) continue;

            if (overlapX >= bestOverlap) {
              bestOverlap = overlapX;
              bestSeamIdx = sIdx;
            }
          }

          if (bestSeamIdx >= 0) {
            const list = matchesBySeamIdx.get(bestSeamIdx) ?? [];
            list.push(i);
            matchesBySeamIdx.set(bestSeamIdx, list);
          }
        }

        if (matchesBySeamIdx.size === 0) return;

        const consumed = new Set<number>();
        const additions: OcrBubble[] = [];
        for (const [sIdx, matchedIndices] of matchesBySeamIdx.entries()) {
          const sb = seam.bubbles[sIdx];
          const hAbove = Math.max(0, seam.seamY - sb.yminPx);
          const hBelow = Math.max(0, sb.ymaxPx - seam.seamY);
          const thisPageOwnsText = edgeSide === 'bottom' ? hAbove >= hBelow : hBelow > hAbove;
          matchedIndices.forEach((idx) => consumed.add(idx));
          additions.push(
            mergeSamePageSeamFragments(
              workingBubbles,
              matchedIndices,
              sb.text,
              !thisPageOwnsText,
            ),
          );
        }

        workingBubbles = workingBubbles
          .filter((_, idx) => !consumed.has(idx))
          .concat(additions)
          .sort((a, b) => a.box[0] - b.box[0] || a.box[1] - b.box[1]);
      };

      applySeamResolution(topSeam, 'top');
      applySeamResolution(bottomSeam, 'bottom');
    }

    ocrMs = Math.round(performance.now() - tOcrStart);

    // Jenerik / ekip listesi / reklam / duyuru sayfaları ve zaten hedef dilde olan sayfalar hiç çevrilmez
    const filteredBubbles = ocr.isPromoPage
      ? []
      : workingBubbles.filter(
          (bubble) => bubble.seamEraseOnly || !shouldSkipBlock(bubble.text, targetLang, bubble.box, bubble.lines),
        );

    const rawBubbles = isPageAlreadyInTargetLanguage(
      filteredBubbles.filter((b) => !b.seamEraseOnly).map((b) => b.text),
      targetLang,
    )
      ? []
      : filteredBubbles;

    return {
      fullCanvas,
      fullCtx,
      fullWidth,
      fullHeight,
      rawBubbles,
      ocrMs,
      tStart,
    };
  } catch (err) {
    releaseCanvasBuffer(fullCanvas);
    throw err;
  }
};

/**
 * 2. AŞAMA: Çıkarılan balon metinlerini API (Gemini Flash-Lite veya Google Çeviri) ile paralel çevirir
 * ve ardından canvas üzerinde pürüzsüz inpaint ederek çevrilmiş blokları üretir.
 * Ağ I/O ağırlıklıdır; OCR worker'ı bloke etmez.
 */
export const translateAndInpaintPage = async ({
  ocrData,
  apiKey,
  apiKeys,
  deeplApiKeys,
  provider = 'gemini',
  targetLang,
  signal,
}: {
  ocrData: ExtractedPageOcr;
  apiKey?: string;
  apiKeys?: readonly string[];
  deeplApiKeys?: readonly string[];
  provider?: TranslationSettings['provider'];
  targetLang: string;
  signal?: AbortSignal;
}): Promise<TranslatePageResult> => {
  try {
    const { fullCtx, fullWidth, fullHeight, rawBubbles, ocrMs, tStart } = ocrData;
    let transMs = 0;

    if (rawBubbles.length === 0) {
      return {
        blocks: [],
        timings: { ocrMs, transMs: 0, totalMs: Math.round(performance.now() - tStart) },
      };
    }

    const translatableIndices: number[] = [];
    rawBubbles.forEach((b, idx) => {
      if (!b.seamEraseOnly && b.text.trim().length > 0) {
        translatableIndices.push(idx);
      }
    });

    if (
      isPageAlreadyInTargetLanguage(
        translatableIndices.map((idx) => rawBubbles[idx].text),
        targetLang,
      )
    ) {
      return {
        blocks: [],
        timings: { ocrMs, transMs: 0, totalMs: Math.round(performance.now() - tStart) },
      };
    }

    const effectiveKeys = normalizeApiKeysList(apiKeys, apiKey);
    const effectiveDeepLKeys = normalizeDeepLApiKeysList(deeplApiKeys);
    if (translatableIndices.length > 0 && provider === 'gemini' && effectiveKeys.length === 0) {
      throw new Error('API_KEY_INVALID: Gemini API anahtarı bulunamadı.');
    }
    if (translatableIndices.length > 0 && provider === 'deepl' && effectiveDeepLKeys.length === 0) {
      throw new Error('DEEPL_KEY_INVALID: DeepL API anahtarı bulunamadı.');
    }

    // Çeviri Motoru (Google Çeviri, DeepL veya Gemini Flash-Lite Text)
    const translatedByIndex = new Map<number, string>();
    if (translatableIndices.length > 0) {
      const tTransStart = performance.now();
      const originalTexts = translatableIndices.map((idx) => rawBubbles[idx].text);
      const translatedTexts =
        provider === 'google'
          ? await translateBatchWithGoogleFree(originalTexts, targetLang, signal)
          : provider === 'deepl'
            ? await translateBatchWithDeepL(
                originalTexts,
                targetLang,
                effectiveDeepLKeys,
                signal,
              )
            : await translateBatchWithGeminiText(
                originalTexts,
                targetLang,
                effectiveKeys,
                signal,
              );
      transMs = Math.round(performance.now() - tTransStart);
      translatableIndices.forEach((origIdx, arrPos) => {
        translatedByIndex.set(origIdx, translatedTexts[arrPos] ?? rawBubbles[origIdx].text);
      });
    }

    // Balonları inpaint et ve hedeflenen dilde yeniden diz
    const normalizeForCompare = (s: string) =>
      s.toLocaleLowerCase('en-US').replace(/[^\p{L}\p{N}]+/gu, '');

    const unchangedCount = translatableIndices.filter(
      (idx) =>
        normalizeForCompare(translatedByIndex.get(idx) || '') ===
        normalizeForCompare(rawBubbles[idx].text),
    ).length;
    const hasTranslatableSentence = translatableIndices.some(
      (idx) =>
        FOREIGN_STOPWORD_REGEX.test(rawBubbles[idx].text) ||
        rawBubbles[idx].text.trim().split(/\s+/).length >= 3,
    );
    if (
      targetLang !== 'en' &&
      translatableIndices.length >= 2 &&
      unchangedCount === translatableIndices.length &&
      hasTranslatableSentence
    ) {
      throw new Error('Çeviri servisi yanıt vermedi (timeout)');
    }

    const allBubbleBoxes = rawBubbles.map((b) => b.box);
    const blocks: TranslationBlock[] = [];

    for (let idx = 0; idx < rawBubbles.length; idx += 1) {
      if (signal?.aborted) {
        throw new DOMException('İptal edildi', 'AbortError');
      }
      if (idx > 0 && idx % 3 === 0) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      const bubble = rawBubbles[idx];
      const siblingBoxes = allBubbleBoxes.filter((_, sIdx) => sIdx !== idx);
      if (bubble.seamEraseOnly) {
        const refined = inpaintAndRefineBlock(
          fullCtx,
          fullWidth,
          fullHeight,
          {
            box: bubble.box,
            text: '',
            originalText: bubble.text,
            lines: bubble.lines,
          },
          targetLang,
          { siblingBoxes },
        );
        if (refined) blocks.push(refined);
        continue;
      }

      let translated = (translatedByIndex.get(idx) || bubble.text)
        .replace(/<[^>]{1,32}>/g, ' ')
        .replace(/[<>]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (targetLang === 'tr') {
        translated = translated
          .replace(/\bAH KAHRAMAN\b/gi, 'AH LANET')
          .replace(/\bxiulian\b/gi, 'gelişim');
        if (
          /\bconstitution\b/i.test(bubble.text) &&
          /\b(?:body|martial|unique|special|amplif|talent|spirit|qi|innate|divine|devil)\b/i.test(bubble.text)
        ) {
          translated = translated.replace(/\banayasa(?:ya|sı|sını|sında|yı|mız|nın)?\b/gi, (m) =>
            m === m.toUpperCase() ? 'BÜNYE' : 'Bünye',
          );
        }
      }
      if (
        translated === '[SFX]' ||
        translated.toUpperCase() === '[SFX]' ||
        shouldSkipBlock(translated, targetLang)
      ) {
        continue;
      }
      if (normalizeForCompare(translated) === normalizeForCompare(bubble.text)) continue;
      const refined = inpaintAndRefineBlock(
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
        { siblingBoxes },
      );
      if (refined) blocks.push(refined);
    }

    return {
      blocks,
      timings: {
        ocrMs,
        transMs,
        totalMs: Math.round(performance.now() - tStart),
      },
    };
  } finally {
    releaseExtractedPageOcr(ocrData);
  }
};

/**
 * Sayfayı yerel WASM OCR ile tarar ve seçilen motorla (Google veya Gemini Flash-Lite) çevirir.
 * Sıfır LLM Vision maliyeti vardır; görseller hiçbir uzak API'ye gönderilmez.
 */
export const translatePageImage = async (
  options: TranslatePageOptions,
): Promise<TranslatePageResult> => {
  const effectiveKeys = normalizeApiKeysList(options.apiKeys, options.apiKey);
  const effectiveDeepLKeys = normalizeDeepLApiKeysList(options.deeplApiKeys);
  if (options.provider === 'gemini' && effectiveKeys.length === 0) {
    throw new Error('API_KEY_INVALID: Gemini API anahtarı bulunamadı.');
  }
  if (options.provider === 'deepl' && effectiveDeepLKeys.length === 0) {
    throw new Error('DEEPL_KEY_INVALID: DeepL API anahtarı bulunamadı.');
  }

  const ocrData = await extractPageOcr({
    imageSrc: options.imageSrc,
    targetLang: options.targetLang,
    signal: options.signal,
  });

  return translateAndInpaintPage({
    ocrData,
    apiKey: options.apiKey,
    apiKeys: options.apiKeys,
    deeplApiKeys: options.deeplApiKeys,
    provider: options.provider,
    targetLang: options.targetLang,
    signal: options.signal,
  });
};
