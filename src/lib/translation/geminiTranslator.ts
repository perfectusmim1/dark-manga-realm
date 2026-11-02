import { GoogleGenAI, Type, ThinkingLevel } from '@google/genai';
import { defaultOfflineImageProxyUrl } from '@/lib/offline/proxyConfig';
import { isStoredMediaUrl } from '@/lib/mediaStorage';
import { TranslationBlock } from './types';
import { getLanguageName } from './languages';

const MODEL = 'gemini-flash-lite-latest';
const RETRY_DELAYS_MS = [3000, 8000];
const SLICE_HEIGHT = 1300;
const SLICE_OVERLAP = 200;
const SLICE_STEP = SLICE_HEIGHT - SLICE_OVERLAP; // 1100

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

const fetchImageBlobViaProxy = async (src: string): Promise<Blob> => {
  // Doğrudan güncel ve mangadass destekleyen ana proxy'yi kullan
  const response = await fetch(defaultOfflineImageProxyUrl, {
    method: 'POST',
    body: src,
  });
  if (!response.ok) {
    throw new Error(`Görsel proxy hatası (${response.status})`);
  }
  return response.blob();
};

const fetchImageBlob = async (src: string): Promise<Blob> => {
  // blob:/data: URL'leri doğrudan okunur.
  if (src.startsWith('blob:') || src.startsWith('data:')) {
    const response = await fetch(src);
    return response.blob();
  }

  // Aynı origin veya public R2 kaynakları doğrudan CORS ile indirilebilir.
  const isSameOrigin = typeof window !== 'undefined' && src.startsWith(window.location.origin);
  if (isSameOrigin || isStoredMediaUrl(src)) {
    try {
      const direct = await fetch(src);
      if (direct.ok) return await direct.blob();
    } catch {
      // Doğrudan istek başarısızsa proxy'ye geç
    }
  }

  // Harici üçüncü taraf siteler (mangadass, webtoonhatti vb.) için doğrudan proxy'den çek.
  // Bu sayede tarayıcı konsolunda kırmızı CORS hatası asla tetiklenmez.
  return fetchImageBlobViaProxy(src);
};

const loadImageElement = (blob: Blob): Promise<HTMLImageElement> =>
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
  const dataUrl = canvas.toDataURL('image/jpeg', 0.88);
  const base64 = dataUrl.split(',')[1];
  if (!base64) {
    throw new Error('Görsel base64 dönüşümü başarısız');
  }
  return { data: base64, mimeType: 'image/jpeg' };
};

const isRateLimitError = (error: unknown) => {
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return message.includes('429') || message.includes('resource_exhausted') || message.includes('quota');
};

const VOCAL_FILLER_REGEX = /^(a+h+|o+h+|u+h+|u+g+h+|a+a+h+|o+o+h+|n+g+h+|m+m+h*|h+m+m*|h+a+a*|h+e+h+|t+s+k+|p+f+f+|e+h+|h+a+h+|a+r+g+h+|o+o+f+|g+a+s+p|s+i+g+h|w+o+w|h+u+h+|y+a+h+|k+y+a+h*|g+k+h*|u+r+k)[!?.~*^_\-\s]*$/i;
const SFX_WRAP_REGEX = /^[*({\[][^\n*)}\]]+[*)}\]][!?.~*^_\-\s]*$/;
const PURE_PUNCT_REGEX = /^[\s.,!?:;\-_~*^'"/\\()[\]{}]+$/;
const CREDITS_REGEX = /^(çizer|yazar|editör|editor|çeviri|artist|author|typesetter|scanlation|fansub|raw|webtoon|bölüm\s*\d+|chapter\s*\d+|ep(isode)?\.?\s*\d+|vol(ume)?\.?\s*\d+)\b/i;
const HANGUL_ONLY_REGEX = /^[\uAC00-\uD7AF\s.,!?:;\-_~*^'"()]+$/;

// Ses efektlerini (SFX), inlemeleri (ah/oh/uh/ugh vb.), jenerik/çizer/yazar/editör bilgilerini ve anlamsız gürültüleri eler.
export const shouldSkipBlock = (text: string): boolean => {
  const t = text.trim();
  if (t.length <= 1) return true;
  if (PURE_PUNCT_REGEX.test(t)) return true;
  if (VOCAL_FILLER_REGEX.test(t)) return true;
  if (SFX_WRAP_REGEX.test(t)) return true;
  if (CREDITS_REGEX.test(t)) return true;
  if (HANGUL_ONLY_REGEX.test(t)) return true;
  if (/(https?:\/\/|\.com|\.net|\.org|\.club|\.me|\.online)\b/i.test(t)) return true;
  return false;
};

const parseBlocks = (raw: string): TranslationBlock[] => {
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
    if (shouldSkipBlock(cleanText)) {
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
    // Çok ufak kutuları veya tek noktalama işaretlerini atla
    if (ymax - ymin < 8 || xmax - xmin < 8) {
      return;
    }
    result.push({ box: [ymin, xmin, ymax, xmax], text: cleanText });
  });
  return result;
};

// Balonun içindeki gerçek arka plan rengini ve yazı kontrastını örnekler.
const sampleBlockColors = (
  ctx: CanvasRenderingContext2D,
  box: [number, number, number, number],
  width: number,
  height: number
): { bgColor: string; textColor: string; isDark: boolean } => {
  const [ymin, xmin, ymax, xmax] = box;
  const x0 = Math.max(0, Math.floor((xmin / 1000) * width));
  const x1 = Math.min(width, Math.ceil((xmax / 1000) * width));
  const y0 = Math.max(0, Math.floor((ymin / 1000) * height));
  const y1 = Math.min(height, Math.ceil((ymax / 1000) * height));
  const bw = x1 - x0;
  const bh = y1 - y0;

  if (bw <= 0 || bh <= 0) {
    return { bgColor: '#ffffff', textColor: '#0a0a0a', isDark: false };
  }

  try {
    const imgData = ctx.getImageData(x0, y0, bw, bh);
    const data = imgData.data;

    // Balonun metin olmayan kenar marjinlerini örnekle
    const marginX = Math.max(1, Math.floor(bw * 0.1));
    const marginY = Math.max(1, Math.floor(bh * 0.1));

    let rSum = 0;
    let gSum = 0;
    let bSum = 0;
    let count = 0;

    for (let py = 0; py < bh; py += 2) {
      for (let px = 0; px < bw; px += 2) {
        const isPerimeter = px < marginX || px >= bw - marginX || py < marginY || py >= bh - marginY;
        if (!isPerimeter) continue;

        const idx = (py * bw + px) * 4;
        const a = data[idx + 3];
        if (a < 128) continue;

        rSum += data[idx];
        gSum += data[idx + 1];
        bSum += data[idx + 2];
        count += 1;
      }
    }

    if (count === 0) {
      return { bgColor: '#ffffff', textColor: '#0a0a0a', isDark: false };
    }

    const rAvg = Math.round(rSum / count);
    const gAvg = Math.round(gSum / count);
    const bAvg = Math.round(bSum / count);

    // Algılanan parlaklık (luminance)
    const luminance = 0.299 * rAvg + 0.587 * gAvg + 0.114 * bAvg;
    const isDark = luminance < 128;

    return {
      bgColor: `rgb(${rAvg}, ${gAvg}, ${bAvg})`,
      textColor: isDark ? '#ffffff' : '#0a0a0a',
      isDark,
    };
  } catch {
    return { bgColor: '#ffffff', textColor: '#0a0a0a', isDark: false };
  }
};

// Seam deduplication (iki dilim arasındaki ortak balonları tekilleştir)
const computeIoU = (
  boxA: [number, number, number, number],
  boxB: [number, number, number, number]
): number => {
  const [yA0, xA0, yA1, xA1] = boxA;
  const [yB0, xB0, yB1, xB1] = boxB;

  const interY0 = Math.max(yA0, yB0);
  const interX0 = Math.max(xA0, xB0);
  const interY1 = Math.min(yA1, yB1);
  const interX1 = Math.min(xA1, xB1);

  if (interY1 <= interY0 || interX1 <= interX0) return 0;

  const interArea = (interY1 - interY0) * (interX1 - interX0);
  const areaA = (yA1 - yA0) * (xA1 - xA0);
  const areaB = (yB1 - yB0) * (xB1 - xB0);
  const unionArea = areaA + areaB - interArea;

  return unionArea > 0 ? interArea / unionArea : 0;
};

const buildPrompt = (targetLang: string) => [
  'You are an expert manga/webtoon translator and typesetter.',
  'Detect ONLY genuine dialogue speech bubbles and character story narration boxes in this image slice.',
  `Translate each dialogue and narration into natural, clean ${getLanguageName(targetLang)} (ISO 639-1 code: "${targetLang}").`,
  'For box_2d: return [ymin, xmin, ymax, xmax] normalized to 0-1000 covering strictly the text area inside the bubble.',
  'CRITICAL EXCLUSION & FILTERING RULES:',
  '1. DO NOT translate or output blocks for sound effects (SFX), onomatopoeia, screams, moans, gasps, groans, sighing, or vocal filler utterances (e.g. "ah", "oh", "uh", "ugh", "ughhh", "ahhh", "haaa", "ngh", "mm", "gasp", "sigh", "*thump*", "*step*", "부스슥", "쿵", "쾅"). SKIP THEM ENTIRELY.',
  '2. DO NOT translate or output metadata, credits, or titles: series titles, author names, artist names, editor/typesetter names, scanlation team credits, chapter numbers, website URLs, or watermarks. SKIP THEM ENTIRELY.',
  '3. STRICT PROPER NOUN / CHARACTER NAME RULE: Character names and personal names MUST remain in their exact original form (e.g. "Seo-jun", "Elena", "Jack", "Eunwoo", "Yeon-woo"). NEVER localize, alter, or translate personal names into Turkish literal dictionary words.',
  '4. Translate full dialogue sentences naturally and conversationally.',
  'Return ONLY valid JSON matching the schema.',
].join(' ');

const callGeminiVision = async (
  ai: GoogleGenAI,
  data: string,
  mimeType: string,
  targetLang: string
): Promise<TranslationBlock[]> => {
  const prompt = buildPrompt(targetLang);
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

interface TranslatePageOptions {
  apiKey: string;
  imageSrc: string;
  targetLang: string;
}

export const translatePageImage = async ({
  apiKey,
  imageSrc,
  targetLang,
}: TranslatePageOptions): Promise<TranslationBlock[]> => {
  const blob = await fetchImageBlob(imageSrc);
  const img = await loadImageElement(blob);
  const fullWidth = img.naturalWidth || img.width;
  const fullHeight = img.naturalHeight || img.height;

  if (fullWidth <= 0 || fullHeight <= 0) {
    throw new Error('Görsel boyutları geçersiz');
  }

  const ai = new GoogleGenAI({ apiKey });

  // Tam çözünürlüklü offscreen canvas
  const fullCanvas = document.createElement('canvas');
  fullCanvas.width = fullWidth;
  fullCanvas.height = fullHeight;
  const fullCtx = fullCanvas.getContext('2d', { willReadFrequently: true });
  if (!fullCtx) {
    throw new Error('Canvas bağlamı oluşturulamadı');
  }
  fullCtx.drawImage(img, 0, 0);

  // Standart / kısa görseller (height <= 1600): tek seferde gönder
  if (fullHeight <= 1600) {
    const { data, mimeType } = canvasToBase64(fullCanvas);
    const rawBlocks = await callGeminiVision(ai, data, mimeType, targetLang);
    return rawBlocks
      .filter((block) => !shouldSkipBlock(block.text))
      .map((block) => ({
        ...block,
        ...sampleBlockColors(fullCtx, block.box, fullWidth, fullHeight),
      }));
  }

  // Uzun webtoon şeritleri (height > 1600): aspect-ratio bozulmasını önlemek için
  // örtüşen dikey pencerelere bölerek 1:1 piksel hassasiyetiyle tara.
  const slices: Array<{ y: number; h: number }> = [];
  for (let y = 0; y < fullHeight; y += SLICE_STEP) {
    const h = Math.min(SLICE_HEIGHT, fullHeight - y);
    slices.push({ y, h });
    if (y + h >= fullHeight) break;
  }

  const sliceCanvas = document.createElement('canvas');
  sliceCanvas.width = fullWidth;
  const sliceCtx = sliceCanvas.getContext('2d', { willReadFrequently: true });
  if (!sliceCtx) {
    throw new Error('Dilim canvas bağlamı oluşturulamadı');
  }

  const allBlocks: TranslationBlock[] = [];

  // Dilimleri işle (hız ve rate limit dengesi için sıralı/paralel)
  for (const slice of slices) {
    sliceCanvas.height = slice.h;
    sliceCtx.clearRect(0, 0, fullWidth, slice.h);
    sliceCtx.drawImage(fullCanvas, 0, slice.y, fullWidth, slice.h, 0, 0, fullWidth, slice.h);

    const { data, mimeType } = canvasToBase64(sliceCanvas);
    let tileBlocks: TranslationBlock[] = [];
    try {
      tileBlocks = await callGeminiVision(ai, data, mimeType, targetLang);
    } catch {
      // Dilim hatası tüm sayfayı patlatmasın
      tileBlocks = [];
    }

    tileBlocks.forEach((block) => {
      const [tileYmin, tileXmin, tileYmax, tileXmax] = block.box;
      // Dilim içi 0-1000 koordinatlarını tüm sayfanın 0-1000 koordinatlarına çevir
      const pageYmin = Math.max(0, Math.min(1000, Math.round(((slice.y + (tileYmin / 1000) * slice.h) / fullHeight) * 1000)));
      const pageYmax = Math.max(0, Math.min(1000, Math.round(((slice.y + (tileYmax / 1000) * slice.h) / fullHeight) * 1000)));

      if (pageYmin >= pageYmax) return;

      const mappedBox: [number, number, number, number] = [pageYmin, tileXmin, pageYmax, tileXmax];

      // Örtüşen dikiş bölgesindeki mükerrer balonları ele
      const duplicateIndex = allBlocks.findIndex((existing) => computeIoU(existing.box, mappedBox) > 0.45);
      if (duplicateIndex >= 0) {
        // Daha uzun/eksiksiz çeviriyi koru
        if (block.text.length > allBlocks[duplicateIndex].text.length) {
          allBlocks[duplicateIndex] = {
            box: mappedBox,
            text: block.text,
          };
        }
      } else {
        allBlocks.push({
          box: mappedBox,
          text: block.text,
        });
      }
    });
  }

  // Her blok için tam çözünürlüklü arka plan ve metin rengini örnekle
  return allBlocks
    .sort((a, b) => a.box[0] - b.box[0])
    .map((block) => ({
      ...block,
      ...sampleBlockColors(fullCtx, block.box, fullWidth, fullHeight),
    }));
};
