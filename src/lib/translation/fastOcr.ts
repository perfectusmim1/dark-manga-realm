/**
 * Webtoon & Manga istemci tarafı OCR modülü.
 * Birincil motor: PaddleOCR PP-OCRv3 (ONNX, onnxruntime-web WASM) – ayrı bir Web Worker içinde.
 * Yedek motor: Tesseract.js WASM (yalnızca birincil motor yüklenemezse).
 * 100% yerel / same-origin: görseller hiçbir uzak API'ye veya Vision LLM'e gönderilmez.
 */
import type { Worker as TesseractWorker } from 'tesseract.js';
import {
  groupOcrLinesIntoBubbles,
  isCreditsOrPromoPage,
  type OcrBubble,
  type OcrLine,
} from './ocrCore';
import type { OcrWorkerResponse } from './ocrWorker';

export type { OcrBubble, OcrLine } from './ocrCore';

export interface WebtoonOcrResult {
  bubbles: OcrBubble[];
  /** Sayfa jenerik / ekip listesi / reklam sayfası ise true (çevrilmez) */
  isPromoPage: boolean;
  engine: 'paddle' | 'tesseract';
}

const OCR_JOB_TIMEOUT_MS = 90_000;

// ---------- PaddleOCR Web Worker istemcisi ----------

let paddleWorker: Worker | null = null;
let paddleBroken = false;
let jobSeq = 0;
const pendingJobs = new Map<
  number,
  { resolve: (lines: OcrLine[]) => void; reject: (err: unknown) => void }
>();

const getPaddleWorker = (): Worker => {
  if (paddleWorker) return paddleWorker;
  const worker = new Worker(new URL('./ocrWorker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (event: MessageEvent<OcrWorkerResponse>) => {
    const msg = event.data;
    const job = pendingJobs.get(msg.id);
    if (!job) return;
    pendingJobs.delete(msg.id);
    if (msg.ok) job.resolve(msg.lines || []);
    else if (msg.aborted) job.reject(new DOMException('İptal edildi', 'AbortError'));
    else job.reject(new Error(msg.error || 'OCR başarısız'));
  };
  worker.onerror = (event) => {
    const err = new Error(`OCR worker hatası: ${event.message || 'bilinmiyor'}`);
    pendingJobs.forEach((job) => job.reject(err));
    pendingJobs.clear();
    worker.terminate();
    paddleWorker = null;
  };
  paddleWorker = worker;
  return worker;
};

const runPaddleInWorker = (imageData: ImageData, signal?: AbortSignal): Promise<OcrLine[]> =>
  new Promise<OcrLine[]>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('İptal edildi', 'AbortError'));
      return;
    }
    const worker = getPaddleWorker();
    const id = (jobSeq += 1);
    const timer = setTimeout(() => {
      if (!pendingJobs.has(id)) return;
      pendingJobs.delete(id);
      worker.postMessage({ type: 'cancel', id });
      reject(new Error('OCR zaman aşımına uğradı'));
    }, OCR_JOB_TIMEOUT_MS);
    const onAbort = () => {
      if (!pendingJobs.has(id)) return;
      pendingJobs.delete(id);
      clearTimeout(timer);
      worker.postMessage({ type: 'cancel', id });
      reject(new DOMException('İptal edildi', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    pendingJobs.set(id, {
      resolve: (lines) => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        resolve(lines);
      },
      reject: (err) => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        reject(err);
      },
    });
    const buffer = imageData.data.buffer;
    worker.postMessage(
      { type: 'ocr', id, width: imageData.width, height: imageData.height, buffer },
      [buffer],
    );
  });

// ---------- Tesseract yedek motoru ----------

let tesseractPromise: Promise<TesseractWorker> | null = null;

const getTesseractWorker = async (): Promise<TesseractWorker> => {
  if (!tesseractPromise) {
    tesseractPromise = (async () => {
      const { createWorker } = await import('tesseract.js');
      const origin = typeof window !== 'undefined' ? window.location.origin : '';
      return createWorker(['eng'], undefined, {
        workerPath: `${origin}/tesseract/worker.min.js`,
        corePath: `${origin}/tesseract`,
        langPath: `${origin}/tesseract/lang`,
        logger: () => {},
      });
    })().catch((err) => {
      tesseractPromise = null;
      throw err;
    });
  }
  return tesseractPromise;
};

const TESS_SLICE_H = 2000;
const TESS_SLICE_OVERLAP = 200;

const runTesseractOcr = async (
  canvas: HTMLCanvasElement,
  signal?: AbortSignal,
): Promise<OcrLine[]> => {
  const worker = await getTesseractWorker();
  const { width, height } = canvas;
  const slice = document.createElement('canvas');
  slice.width = width;
  const sliceCtx = slice.getContext('2d');
  if (!sliceCtx) return [];
  const lines: OcrLine[] = [];

  for (let y = 0; y < height; y += TESS_SLICE_H - TESS_SLICE_OVERLAP) {
    if (signal?.aborted) throw new DOMException('İptal edildi', 'AbortError');
    const h = Math.min(TESS_SLICE_H, height - y);
    const isLast = y + h >= height;
    slice.height = h;
    sliceCtx.drawImage(canvas, 0, y, width, h, 0, 0, width, h);
    const ret = await worker.recognize(slice, {}, { blocks: true });
    for (const block of ret.data.blocks || []) {
      for (const para of block.paragraphs || []) {
        for (const line of para.lines || []) {
          if (!line.text?.trim()) continue;
          if (!isLast && line.bbox.y1 >= h - 2) continue;
          if (y > 0 && line.bbox.y0 <= 1) continue;
          lines.push({
            text: line.text.trim(),
            confidence: line.confidence,
            bbox: { x0: line.bbox.x0, y0: line.bbox.y0 + y, x1: line.bbox.x1, y1: line.bbox.y1 + y },
          });
        }
      }
    }
    if (isLast) break;
  }
  return lines;
};

// ---------- Genel giriş noktası ----------

/**
 * Sayfa canvas'ında yerel OCR çalıştırır, gürültüyü eler ve satırları balonlara gruplar.
 * Uzun webtoon şeritleri örtüşmeli dilimlerle işlenir.
 */
export const runFastWebtoonOcr = async (
  canvas: HTMLCanvasElement,
  signal?: AbortSignal,
): Promise<WebtoonOcrResult> => {
  if (signal?.aborted) throw new DOMException('İptal edildi', 'AbortError');
  const { width, height } = canvas;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx || width <= 0 || height <= 0) {
    return { bubbles: [], isPromoPage: false, engine: 'paddle' };
  }

  let lines: OcrLine[] | null = null;
  let engine: WebtoonOcrResult['engine'] = 'paddle';

  if (!paddleBroken && typeof Worker !== 'undefined') {
    try {
      lines = await runPaddleInWorker(ctx.getImageData(0, 0, width, height), signal);
    } catch (err) {
      if (signal?.aborted || (err instanceof DOMException && err.name === 'AbortError')) {
        throw new DOMException('İptal edildi', 'AbortError');
      }
      console.warn('[OCR] PaddleOCR başarısız, Tesseract yedeğine geçiliyor.', err);
      paddleBroken = true;
    }
  }

  if (!lines) {
    engine = 'tesseract';
    lines = await runTesseractOcr(canvas, signal);
  }

  if (signal?.aborted) throw new DOMException('İptal edildi', 'AbortError');
  const ocrImg = lines.length >= 2 ? ctx.getImageData(0, 0, width, height) : undefined;
  const bubbles = groupOcrLinesIntoBubbles(lines, width, height, ocrImg);
  return { bubbles, isPromoPage: isCreditsOrPromoPage(bubbles), engine };
};
