import { GoogleGenAI, Type, ThinkingLevel } from '@google/genai';
import { offlineProxyConfig } from '@/lib/offline/proxyConfig';
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

// R2 gibi CORS başlığı vermeyen kaynaklar için mevcut offline görsel
// proxy'si üzerinden indirir (downloadManager ile aynı kalıp).
const fetchImageBlobViaProxy = async (src: string): Promise<Blob> => {
  if (offlineProxyConfig.usesSupabaseAuth) {
    const response = await fetch(offlineProxyConfig.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: offlineProxyConfig.supabaseAnonKey,
        Authorization: `Bearer ${offlineProxyConfig.supabaseAnonKey}`,
      },
      body: JSON.stringify({ url: src }),
    });
    if (!response.ok) {
      throw new Error(`Görsel proxy hatası (${response.status})`);
    }
    return response.blob();
  }

  // Özel proxy'de text/plain POST — CORS preflight'ı atlanır.
  const response = await fetch(offlineProxyConfig.url, {
    method: 'POST',
    body: src,
  });
  if (!response.ok) {
    throw new Error(`Görsel proxy hatası (${response.status})`);
  }
  return response.blob();
};

const fetchImageBlob = async (src: string): Promise<Blob> => {
  // blob:/data: URL'leri (offline sayfalar) doğrudan okunur.
  if (src.startsWith('blob:') || src.startsWith('data:')) {
    const response = await fetch(src);
    return response.blob();
  }

  try {
    const direct = await fetch(src);
    if (!direct.ok) {
      throw new Error(`HTTP ${direct.status}`);
    }
    return await direct.blob();
  } catch {
    // CORS engeli vb. — proxy'den dene.
    return fetchImageBlobViaProxy(src);
  }
};

const fetchImageAsBase64 = async (src: string): Promise<{ data: string; mimeType: string }> => {
  const blob = await fetchImageBlob(src);
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
    'Translate the FULL meaning of each sentence — never omit, shorten or summarize any part of it. Keep the tone natural and conversational.',
    'Do NOT translate proper nouns — keep person names, city/place names and brand names exactly as they are.',
    'Return ONLY JSON matching the schema: blocks = array of { box_2d: [ymin, xmin, ymax, xmax] normalized to 0-1000 covering the text area, text: the translated text }.',
    'Keep reading order (top to bottom).',
    'Skip blocks with no translatable content: watermarks, logos, bare punctuation like "..." and standalone numbers.',
  ].join(' ');

  let lastError: unknown;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      const response = await ai.models.generateContent({
        model: MODEL,
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.MEDIUM },
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
