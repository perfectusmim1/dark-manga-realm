import { GoogleGenAI, Type, ThinkingLevel } from '@google/genai';
import { downloadPageBlob } from '@/lib/offline/downloadManager';
import { isStoredMediaUrl, unwrapManagedMediaUrl } from '@/lib/mediaStorage';
import { TranslationBlock } from './types';
import { getLanguageName } from './languages';
import { normalizeApiKeysList } from './translationSettings';
import { ensureScanlationFontReady, inpaintAndRefineBlock } from './bubbleInpainter';
import { runFastWebtoonOcr } from './fastOcr';

const GEMINI_FLASH_MODEL = 'gemini-flash-latest';

const FALLBACK_RETRY_DELAYS_MS = [1800, 4500];
const DEFAULT_KEY_COOLDOWN_MS = 14_000;
const INVALID_KEY_ISOLATION_MS = 5 * 60_000;
const PER_REQUEST_TIMEOUT_MS = 9_500;
const SLICE_HEIGHT = 2200;
const SLICE_OVERLAP = 220;
const SLICE_STEP = SLICE_HEIGHT - SLICE_OVERLAP; // 1980
const VISION_MAX_WIDTH = 720;
const DEFAULT_TRANSLATE_PROXY_URL =
  'https://toonparrot-scraper-proxy.caganhuseyinerdil.workers.dev/translate';

const supportsThinkingConfig = (model: string): boolean =>
  model.includes('2.5');

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    blocks: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          box_2d: { type: Type.ARRAY, items: { type: Type.NUMBER } },
          text: { type: Type.STRING },
        },
        required: ['box_2d', 'text'],
      },
    },
  },
  required: ['blocks'],
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

const canvasToBase64 = (canvas: HTMLCanvasElement): { data: string; mimeType: string } => {
  let targetCanvas = canvas;
  if (canvas.width > VISION_MAX_WIDTH && canvas.height > 0) {
    const scale = VISION_MAX_WIDTH / canvas.width;
    const scaledWidth = VISION_MAX_WIDTH;
    const scaledHeight = Math.max(1, Math.round(canvas.height * scale));
    const resized = document.createElement('canvas');
    resized.width = scaledWidth;
    resized.height = scaledHeight;
    const rCtx = resized.getContext('2d');
    if (rCtx) {
      rCtx.drawImage(canvas, 0, 0, canvas.width, canvas.height, 0, 0, scaledWidth, scaledHeight);
      targetCanvas = resized;
    }
  }
  const dataUrl = targetCanvas.toDataURL('image/jpeg', 0.80);
  const base64 = dataUrl.split(',')[1];
  if (!base64) {
    throw new Error('Görsel base64 dönüşümü başarısız');
  }
  return { data: base64, mimeType: 'image/jpeg' };
};

// Saf beyaz, saf siyah veya yazı içermesi imkansız düz geçiş şeritlerini <1ms'de tespit edip boşuna API çağrısı yapmayı önler.
const hasSliceTextPotential = (
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
): boolean => {
  try {
    if (width <= 0 || height <= 0) return false;
    const data = ctx.getImageData(0, 0, width, height).data;
    const stepX = 4;
    const stepY = 6;
    let sharpTransitions = 0;

    for (let y = 0; y < height; y += stepY) {
      const rowOffset = y * width * 4;
      let prevLum = -1;
      for (let x = 0; x < width; x += stepX) {
        const idx = rowOffset + x * 4;
        const lum = (data[idx] * 77 + data[idx + 1] * 150 + data[idx + 2] * 29) >> 8;
        if (prevLum >= 0 && Math.abs(lum - prevLum) > 38) {
          sharpTransitions += 1;
          if (sharpTransitions >= 12) return true;
        }
        prevLum = lum;
      }
    }
    return false;
  } catch {
    return true;
  }
};

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
    return 'Gemini API anahtarı geçersiz veya yetkisiz.';
  }
  if (isRateLimitError(error)) {
    return 'Gemini kota sınırı doldu (429). Ek API anahtarı ekleyebilir veya biraz bekleyebilirsiniz.';
  }
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
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
      return Math.min(Math.max(parsedMs, 8_000), 35_000);
    }
  }
  return DEFAULT_KEY_COOLDOWN_MS;
};

export const resetGeminiKeyPoolForTests = (): void => {
  keyPoolSlots.clear();
  modelCooldownUntil.clear();
  pickSequence = 0;
};

export const executeWithGeminiKeyPool = async <T>(
  keys: readonly string[],
  parallelMode: boolean,
  task: (apiKey: string, getClient: () => GoogleGenAI, attemptIndex: number) => Promise<T>,
  signal?: AbortSignal,
): Promise<T> => {
  const normalizedKeys = normalizeApiKeysList(keys);
  if (normalizedKeys.length === 0) {
    throw new Error('API_KEY_INVALID: Geçerli bir Gemini API anahtarı bulunamadı.');
  }

  const maxAttempts = Math.max(normalizedKeys.length + VISION_MODELS.length, 4);
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
        Math.max(earliestCooldown - now, FALLBACK_RETRY_DELAYS_MS[allCoolingRetries] || 2000),
        15_000,
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

    // En az aktif isteği olan ve en uzun süredir seçilmeyen anahtarı seç (round-robin + least-loaded)
    readySlots.sort((a, b) => {
      if (a.inFlight !== b.inFlight) return a.inFlight - b.inFlight;
      if (a.nextDispatchAt !== b.nextDispatchAt) return a.nextDispatchAt - b.nextDispatchAt;
      return a.lastPickedSeq - b.lastPickedSeq;
    });

    const chosen = readySlots[0];
    pickSequence += 1;
    chosen.lastPickedSeq = pickSequence;
    chosen.inFlight += 1;

    // Dilimler arası yapay gecikmeyi minimumda tut (180ms–250ms)
    const minIntervalMs =
      normalizedKeys.length === 1 ? (parallelMode ? 180 : 250) : 120;
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
        // 503 / 502 / 504 / Timeout durumunda beklemeden bir sonraki modele/denemeye geç
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

// Ses efektlerini (SFX), inlemeleri (ah/oh/uh/ugh/uaf vb.), seri başlıklarını ve çizer/yazar/editör jeneriklerini eler.
export const shouldSkipBlock = (text: string, targetLang = 'tr'): boolean => {
  const t = text.trim();
  if (t.length <= 1) return true;
  if (PURE_PUNCT_REGEX.test(t)) return true;
  if (SFX_WRAP_REGEX.test(t)) return true;
  if (WATERMARK_DOMAIN_REGEX.test(t)) return true;

  // Hedef dil Korece/Japonca/Çince değilse çevrilmeden kalan Hangul/Kana/CJK blokları (logo, SFX, jenerik) atla
  if (targetLang !== 'ko' && /[\uAC00-\uD7AF\u3131-\u318E]/.test(t)) return true;
  if (targetLang !== 'ja' && /[\u3040-\u30FF]/.test(t)) return true;
  if (targetLang !== 'zh' && targetLang !== 'ja' && /[\u4E00-\u9FFF]/.test(t)) return true;

  // Dekoratif başlık parantezlerini temizleyip jenerik/bölüm kontrolü yap
  const stripped = t.replace(/^[<\[({◁▷◀▶★☆•\-~\s]+|[>\])}◁▷◀▶★☆•\-~\s]+$/g, '').trim();
  if (!stripped || stripped.length <= 1) return true;
  if (CREDITS_START_REGEX.test(stripped) || CREDITS_INLINE_REGEX.test(t)) return true;
  if (/^[◁▷◀▶].*[◁▷◀▶]$/.test(t)) return true;

  // Tekli veya tekrarlı saf inleme / nefes / ünlem seslerini ("Ah... haa!", "Ughhh", "¡Uaf!") atla
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

const parseBlocks = (raw: string, targetLang: string): TranslationBlock[] => {
  let parsed: { blocks?: unknown };
  try {
    parsed = JSON.parse(raw) as { blocks?: unknown };
  } catch {
    return [];
  }
  if (!parsed || !Array.isArray(parsed.blocks) || parsed.blocks.length === 0) {
    return [];
  }
  const result: TranslationBlock[] = [];
  parsed.blocks.forEach((entry) => {
    const { box_2d: rawBox, text } = (entry || {}) as { box_2d?: unknown; text?: unknown };
    if (!Array.isArray(rawBox) || rawBox.length !== 4 || typeof text !== 'string' || !text.trim()) {
      return;
    }
    const cleanText = text.trim();
    if (shouldSkipBlock(cleanText, targetLang)) {
      return;
    }
    const box = rawBox.map(Number);
    if (box.some((value) => !Number.isFinite(value) || value < 0 || value > 1000)) {
      return;
    }
    const [ymin, xmin, ymax, xmax] = box;
    if (ymin >= ymax || xmin >= xmax) {
      return;
    }
    if (ymax - ymin < 6 || xmax - xmin < 8) {
      return;
    }
    result.push({ box: [ymin, xmin, ymax, xmax], text: cleanText });
  });
  return result;
};

const computeOverlapMetrics = (
  boxA: [number, number, number, number],
  boxB: [number, number, number, number],
): { iou: number; containment: number } => {
  const [yA0, xA0, yA1, xA1] = boxA;
  const [yB0, xB0, yB1, xB1] = boxB;

  const interY0 = Math.max(yA0, yB0);
  const interX0 = Math.max(xA0, xB0);
  const interY1 = Math.min(yA1, yB1);
  const interX1 = Math.min(xA1, xB1);

  if (interY1 <= interY0 || interX1 <= interX0) {
    return { iou: 0, containment: 0 };
  }

  const interArea = (interY1 - interY0) * (interX1 - interX0);
  const areaA = (yA1 - yA0) * (xA1 - xA0);
  const areaB = (yB1 - yB0) * (xB1 - xB0);
  const unionArea = areaA + areaB - interArea;
  const minArea = Math.min(areaA, areaB);

  return {
    iou: unionArea > 0 ? interArea / unionArea : 0,
    containment: minArea > 0 ? interArea / minArea : 0,
  };
};

const buildPrompt = (targetLang: string) => [
  'You are an expert manga/webtoon translator and scanlation typesetter.',
  'Detect ONLY genuine character dialogue inside drawn speech/thought bubbles and story narration inside narration boxes.',
  `Translate each dialogue and narration into natural, fluent, idiomatic ${getLanguageName(targetLang)} (ISO 639-1 code: "${targetLang}").`,
  'For box_2d: return [ymin, xmin, ymax, xmax] normalized to 0-1000 tightly enclosing ALL letters of that single bubble\'s text (never merge two separate bubbles into one box).',
  'STRICT EXCLUSION RULES (DO NOT OUTPUT THESE AT ALL):',
  '1. SKIP ALL sound effects (SFX), background onomatopoeia, and drawn action text (e.g. "부스슥", "번뜩", "저벅", "쿵", "*step*", "*thump*").',
  '2. SKIP ALL moans, groans, sighs, gasps, screams, and pure vocal filler bubbles (e.g. "ah", "oh", "uh", "ugh", "ughhh", "aah", "haa", "ngh", "mm", "uaf", "uf", "puf", "eh", "huh", "tsk").',
  '3. SKIP ALL series title logos, decorative cover/episode banners, chapter numbers, author/artist/editor credits (e.g. "글 : ... / 그림 : ...", "Story / Art"), website URLs, and scanlation watermarks (e.g. "LEE ANTES EN..."). NEVER output floating title graphics.',
  '4. STRICT CHARACTER NAME & HONORIFIC RULE: Keep all personal names, character names, and Korean/Japanese honorifics (e.g. "Oppa", "Hyung", "Noona", "Unnie", "Sunbae", "Seo-jun", "Elena") in their exact original spelling. NEVER translate or localize names.',
  'Return ONLY valid JSON matching the schema.',
].join(' ');

const callGeminiVision = async (
  keys: readonly string[],
  parallelMode: boolean,
  data: string,
  mimeType: string,
  targetLang: string,
  signal?: AbortSignal,
): Promise<TranslationBlock[]> => {
  const prompt = buildPrompt(targetLang);

  return executeWithGeminiKeyPool(
    keys,
    parallelMode,
    async (_apiKey, getClient) => {
      const ai = getClient();
      const model = GEMINI_FLASH_MODEL;
      const timeoutSignal = AbortSignal.timeout(PER_REQUEST_TIMEOUT_MS);
      const combinedSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;

      try {
        const response = await ai.models.generateContent({
          model,
          config: {
            ...(supportsThinkingConfig(model)
              ? { thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL } }
              : {}),
            responseMimeType: 'application/json',
            responseSchema: RESPONSE_SCHEMA,
            abortSignal: combinedSignal,
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
        return parseBlocks(response.text ?? '', targetLang);
      } catch (err) {
        if (signal?.aborted) {
          throw new DOMException('İptal edildi', 'AbortError');
        }
        if (timeoutSignal.aborted || isTransientServerOrTimeoutError(err)) {
          throw new Error(`503 Vision model timeout or overload (${model})`);
        }
        throw err;
      }
    },
    signal,
  );
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

const TURKISH_CHAR_REGEX = /[çğıöşüÇĞİÖŞÜ]/;
const TURKISH_WORD_REGEX =
  /\b(?:bir|ve|bu|için|ama|fakat|ancak|ben|sen|biz|siz|onlar|değil|var|yok|gibi|kadar|sonra|önce|daha|çok|hiç|ne|nasıl|neden|niye|kim|nerede|benim|senin|onun|bizim|sizin|evet|hayır|tamam|lütfen|teşekkür|merhaba|oldu|olacak|mi|mı|mu|mü|de|da|ki)\b/i;
const ENGLISH_STOPWORD_REGEX =
  /\b(?:the|and|you|your|are|was|were|have|has|had|with|this|that|what|when|where|why|how|from|they|them|their|there|here|would|could|should|will|can't|don't|didn't|isn't|aren't|wasn't|I'm|you're|he's|she's|it's|we're|they're)\b/i;

const isLikelyAlreadyTranslated = (text: string, targetLang: string): boolean => {
  const t = text.trim();
  if (!t) return true;
  if (targetLang === 'tr') {
    if (ENGLISH_STOPWORD_REGEX.test(t)) return false;
    if (TURKISH_CHAR_REGEX.test(t) || TURKISH_WORD_REGEX.test(t)) return true;
  }
  return false;
};

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
      ? AbortSignal.any([signal, AbortSignal.timeout(6000)])
      : AbortSignal.timeout(6000);
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
    // Proxy erişilemezse mevcut (Gemini tarafından çevrilmiş) metinleri koru; konsola CORS hatası basma.
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
  parallelMode?: boolean;
  imageSrc: string;
  targetLang: string;
  signal?: AbortSignal;
}

export const translatePageImage = async ({
  apiKey,
  apiKeys,
  provider = 'gemini',
  parallelMode = false,
  imageSrc,
  targetLang,
  signal,
}: TranslatePageOptions): Promise<TranslatePageResult> => {
  const tStart = performance.now();
  let ocrMs = 0;
  let transMs = 0;

  const effectiveKeys = normalizeApiKeysList(apiKeys, apiKey);
  if (effectiveKeys.length === 0) {
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

  const applyGoogleTranslateBatchIfNeeded = async (items: Array<{ text: string }>) => {
    if (provider !== 'google' || items.length === 0) return;
    const pendingIndices: number[] = [];
    const pendingTexts: string[] = [];

    items.forEach((item, idx) => {
      if (!isLikelyAlreadyTranslated(item.text, targetLang)) {
        pendingIndices.push(idx);
        pendingTexts.push(item.text);
      }
    });

    if (pendingTexts.length === 0) return;

    const translated = await translateBatchWithGoogleFree(pendingTexts, targetLang, signal);
    translated.forEach((t, i) => {
      if (t) items[pendingIndices[i]].text = t;
    });
  };

  // Google Çeviri (Ücretsiz) Modu: Tamamen yerel, ultra hızlı Web Worker WASM OCR + Ücretsiz Google Çeviri
  // Gemini API çağrısı yapmaz, kota/ücret yemez, webtoon ve uzun şerit sayfalarla %100 uyumludur.
  if (provider === 'google') {
    const tOcrStart = performance.now();
    const rawBlocks: Array<{ box: [number, number, number, number]; text: string }> = [];

    if (fullHeight <= 2500) {
      if (hasSliceTextPotential(fullCtx, fullWidth, fullHeight)) {
        const detected = await runFastWebtoonOcr(fullCanvas, signal);
        rawBlocks.push(...detected);
      }
    } else {
      // Uzun webtoon şeritlerini 2000px dilimler halinde tara
      for (let y = 0; y < fullHeight; y += 2000) {
        if (signal?.aborted) throw new DOMException('İptal edildi', 'AbortError');
        const h = Math.min(2000, fullHeight - y);
        const sliceCanvas = document.createElement('canvas');
        sliceCanvas.width = fullWidth;
        sliceCanvas.height = h;
        const sliceCtx = sliceCanvas.getContext('2d', { willReadFrequently: true });
        if (sliceCtx) {
          sliceCtx.drawImage(fullCanvas, 0, y, fullWidth, h, 0, 0, fullWidth, h);
          if (hasSliceTextPotential(sliceCtx, fullWidth, h)) {
            const sliceBlocks = await runFastWebtoonOcr(sliceCanvas, signal);
            for (const b of sliceBlocks) {
              const ymin = Math.round(((y + (b.box[0] / 1000) * h) / fullHeight) * 1000);
              const ymax = Math.round(((y + (b.box[2] / 1000) * h) / fullHeight) * 1000);
              rawBlocks.push({
                box: [ymin, b.box[1], ymax, b.box[3]],
                text: b.text,
              });
            }
          }
        }
      }
    }
    ocrMs = Math.round(performance.now() - tOcrStart);

    const tTransStart = performance.now();
    await applyGoogleTranslateBatchIfNeeded(rawBlocks);
    transMs = Math.round(performance.now() - tTransStart);

    const blocks = rawBlocks
      .sort((a, b) => a.box[0] - b.box[0])
      .map((block) => inpaintAndRefineBlock(fullCtx, fullWidth, fullHeight, block, targetLang))
      .filter((block): block is TranslationBlock => block !== null);

    return {
      blocks,
      timings: {
        ocrMs,
        transMs,
        totalMs: Math.round(performance.now() - tStart),
      },
    };
  }

  // Kısa/standart sayfalar (height <= 2300): tek seferde işle
  if (fullHeight <= 2300) {
    if (!hasSliceTextPotential(fullCtx, fullWidth, fullHeight)) {
      return {
        blocks: [],
        timings: { ocrMs: 0, transMs: 0, totalMs: Math.round(performance.now() - tStart) },
      };
    }

    const { data, mimeType } = canvasToBase64(fullCanvas);
    const tOcrStart = performance.now();
    const rawBlocks = await callGeminiVision(
      effectiveKeys,
      parallelMode,
      data,
      mimeType,
      targetLang,
      signal,
    );
    ocrMs = Math.round(performance.now() - tOcrStart);

    const tTransStart = performance.now();
    await applyGoogleTranslateBatchIfNeeded(rawBlocks);
    transMs = Math.round(performance.now() - tTransStart);

    const blocks = rawBlocks
      .sort((a, b) => a.box[0] - b.box[0])
      .map((block) => inpaintAndRefineBlock(fullCtx, fullWidth, fullHeight, block, targetLang))
      .filter((block): block is TranslationBlock => block !== null);

    return {
      blocks,
      timings: {
        ocrMs,
        transMs,
        totalMs: Math.round(performance.now() - tStart),
      },
    };
  }

  // Uzun webtoon şeritleri: örtüşen dikey pencerelere bölerek 1:1 piksel doğruluğuyla tara
  const slices: Array<{ y: number; h: number }> = [];
  for (let y = 0; y < fullHeight; y += SLICE_STEP) {
    const h = Math.min(SLICE_HEIGHT, fullHeight - y);
    slices.push({ y, h });
    if (y + h >= fullHeight) break;
  }

  interface CandidateBlock {
    box: [number, number, number, number];
    text: string;
    nearSliceSeam: boolean;
  }

  const slicePayloads = slices.map((slice) => {
    const sliceCanvas = document.createElement('canvas');
    sliceCanvas.width = fullWidth;
    sliceCanvas.height = slice.h;
    const sliceCtx = sliceCanvas.getContext('2d', { willReadFrequently: true });
    if (!sliceCtx) {
      throw new Error('Dilim canvas bağlamı oluşturulamadı');
    }
    sliceCtx.drawImage(fullCanvas, 0, slice.y, fullWidth, slice.h, 0, 0, fullWidth, slice.h);
    const hasText = hasSliceTextPotential(sliceCtx, fullWidth, slice.h);
    if (!hasText) {
      return { ...slice, data: '', mimeType: 'image/jpeg', skip: true };
    }
    const { data, mimeType } = canvasToBase64(sliceCanvas);
    return { ...slice, data, mimeType, skip: false };
  });

  // Tek anahtarda bile 3–4 dilimi eşzamanlı göndererek 10.000px'lik şeritleri tek dalgada (~2.5-4sn) bitir.
  const sliceConcurrency = parallelMode
    ? Math.min(Math.max(4, effectiveKeys.length * 3), 6)
    : Math.min(Math.max(3, effectiveKeys.length * 2), 5);

  const sliceResults: Array<{ y: number; h: number; blocks: TranslationBlock[] }> = [];
  let succeededSlices = 0;
  let firstSliceError: unknown = null;

  const tOcrStart = performance.now();
  for (let i = 0; i < slicePayloads.length; i += sliceConcurrency) {
    if (signal?.aborted) {
      throw new DOMException('İptal edildi', 'AbortError');
    }
    const batch = slicePayloads.slice(i, i + sliceConcurrency);
    const batchOut = await Promise.all(
      batch.map(async (s) => {
        if (s.skip) {
          succeededSlices += 1;
          return { y: s.y, h: s.h, blocks: [] };
        }
        try {
          const blocks = await callGeminiVision(
            effectiveKeys,
            parallelMode,
            s.data,
            s.mimeType,
            targetLang,
            signal,
          );
          succeededSlices += 1;
          return { y: s.y, h: s.h, blocks };
        } catch (err) {
          if (isAbortTranslationError(err) || signal?.aborted || isFatalAuthOrKeyError(err)) {
            throw err;
          }
          if (!firstSliceError) firstSliceError = err;
          return { y: s.y, h: s.h, blocks: [] };
        }
      }),
    );
    sliceResults.push(...batchOut);
  }
  ocrMs = Math.round(performance.now() - tOcrStart);

  if (succeededSlices === 0 && firstSliceError) {
    throw firstSliceError;
  }

  const mergedCandidates: CandidateBlock[] = [];

  sliceResults.forEach((slice, sliceIdx) => {
    const hasTopSeam = sliceIdx > 0;
    const hasBottomSeam = sliceIdx < sliceResults.length - 1;

    slice.blocks.forEach((block) => {
      const [tileYmin, tileXmin, tileYmax, tileXmax] = block.box;
      const pageYmin = Number(
        Math.max(0, Math.min(1000, ((slice.y + (tileYmin / 1000) * slice.h) / fullHeight) * 1000)).toFixed(4),
      );
      const pageYmax = Number(
        Math.max(0, Math.min(1000, ((slice.y + (tileYmax / 1000) * slice.h) / fullHeight) * 1000)).toFixed(4),
      );
      if (pageYmin >= pageYmax) return;

      const mappedBox: [number, number, number, number] = [
        pageYmin,
        Number(tileXmin.toFixed(4)),
        pageYmax,
        Number(tileXmax.toFixed(4)),
      ];
      const nearSliceSeam = (hasTopSeam && tileYmin <= 18) || (hasBottomSeam && tileYmax >= 982);

      const dupIdx = mergedCandidates.findIndex((existing) => {
        const { iou, containment } = computeOverlapMetrics(existing.box, mappedBox);
        return iou > 0.4 || containment > 0.65;
      });

      if (dupIdx >= 0) {
        const prev = mergedCandidates[dupIdx];
        const preferNew =
          (prev.nearSliceSeam && !nearSliceSeam) ||
          (prev.nearSliceSeam === nearSliceSeam && block.text.length > prev.text.length);
        if (preferNew) {
          mergedCandidates[dupIdx] = { box: mappedBox, text: block.text, nearSliceSeam };
        }
      } else {
        mergedCandidates.push({ box: mappedBox, text: block.text, nearSliceSeam });
      }
    });
  });

  const tTransStart = performance.now();
  await applyGoogleTranslateBatchIfNeeded(mergedCandidates);
  transMs = Math.round(performance.now() - tTransStart);

  const blocks = mergedCandidates
    .sort((a, b) => a.box[0] - b.box[0])
    .map((cand) =>
      inpaintAndRefineBlock(fullCtx, fullWidth, fullHeight, { box: cand.box, text: cand.text }, targetLang),
    )
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
