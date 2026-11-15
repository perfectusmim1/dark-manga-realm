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
  isDuplicateOrNestedSubBox,
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

// ---------- PaddleOCR Çoklu Web Worker Havuzu ----------

const MAX_OCR_WORKERS =
  typeof navigator !== 'undefined'
    ? (navigator.hardwareConcurrency || 4) >= 8
      ? 3
      : (navigator.hardwareConcurrency || 4) >= 4
        ? 2
        : 1
    : 1;

interface PendingJob {
  resolve: (result: { lines: OcrLine[]; buffer?: ArrayBuffer }) => void;
  reject: (err: unknown) => void;
}

interface WorkerSlot {
  worker: Worker;
  busy: number;
  pending: Map<number, PendingJob>;
}

const workerSlots: WorkerSlot[] = [];
let paddleBroken = false;
let jobSeq = 0;

const createWorkerSlot = (): WorkerSlot => {
  const worker = new Worker(new URL('./ocrWorker.ts', import.meta.url), { type: 'module' });
  const slot: WorkerSlot = {
    worker,
    busy: 0,
    pending: new Map(),
  };
  worker.onmessage = (event: MessageEvent<OcrWorkerResponse>) => {
    const msg = event.data;
    const job = slot.pending.get(msg.id);
    if (!job) return;
    slot.pending.delete(msg.id);
    slot.busy = Math.max(0, slot.busy - 1);
    if (msg.ok) job.resolve({ lines: msg.lines || [], buffer: msg.buffer });
    else if (msg.aborted) job.reject(new DOMException('İptal edildi', 'AbortError'));
    else job.reject(new Error(msg.error || 'OCR başarısız'));
  };
  worker.onerror = (event) => {
    const err = new Error(`OCR worker hatası: ${event.message || 'bilinmiyor'}`);
    slot.pending.forEach((job) => job.reject(err));
    slot.pending.clear();
    slot.busy = 0;
    const idx = workerSlots.indexOf(slot);
    if (idx !== -1) workerSlots.splice(idx, 1);
    worker.terminate();
  };
  workerSlots.push(slot);
  return slot;
};

const pickWorkerSlot = (): WorkerSlot => {
  const idleSlot = workerSlots.find((s) => s.busy === 0);
  if (idleSlot) return idleSlot;
  if (workerSlots.length < MAX_OCR_WORKERS) {
    return createWorkerSlot();
  }
  return workerSlots.reduce((best, cur) => (cur.busy < best.busy ? cur : best), workerSlots[0]);
};

const runPaddleInWorker = (
  imageData: ImageData,
  signal?: AbortSignal,
): Promise<{ lines: OcrLine[]; buffer?: ArrayBuffer }> =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('İptal edildi', 'AbortError'));
      return;
    }
    const slot = pickWorkerSlot();
    const { worker } = slot;
    const id = (jobSeq += 1);
    slot.busy += 1;
    const timer = setTimeout(() => {
      if (!slot.pending.has(id)) return;
      slot.pending.delete(id);
      slot.busy = Math.max(0, slot.busy - 1);
      worker.postMessage({ type: 'cancel', id });
      reject(new Error('OCR zaman aşımına uğradı'));
    }, OCR_JOB_TIMEOUT_MS);
    const onAbort = () => {
      if (!slot.pending.has(id)) return;
      slot.pending.delete(id);
      slot.busy = Math.max(0, slot.busy - 1);
      clearTimeout(timer);
      worker.postMessage({ type: 'cancel', id });
      reject(new DOMException('İptal edildi', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    slot.pending.set(id, {
      resolve: (res) => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        resolve(res);
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
  let returnedBuffer: ArrayBuffer | undefined;
  let engine: WebtoonOcrResult['engine'] = 'paddle';

  if (!paddleBroken && typeof Worker !== 'undefined') {
    try {
      if (MAX_OCR_WORKERS >= 2 && height >= 2400) {
        const numChunks = height >= 6000 && MAX_OCR_WORKERS >= 3 ? 3 : 2;
        const overlap = 320;
        const baseStep = Math.ceil(height / numChunks);
        const chunks = Array.from({ length: numChunks }, (_, idx) => {
          const y0 = idx === 0 ? 0 : Math.max(0, idx * baseStep - Math.floor(overlap * 0.5));
          const y1 =
            idx === numChunks - 1
              ? height
              : Math.min(height, (idx + 1) * baseStep + Math.ceil(overlap * 0.5));
          return { idx, y0, y1 };
        });
        const chunkResults = await Promise.all(
          chunks.map(async ({ idx, y0, y1 }) => {
            const imgData = ctx.getImageData(0, y0, width, y1 - y0);
            const res = await runPaddleInWorker(imgData, signal);
            return res.lines.map((l) => {
              const shifted: OcrLine = {
                ...l,
                bbox: {
                  x0: l.bbox.x0,
                  y0: l.bbox.y0 + y0,
                  x1: l.bbox.x1,
                  y1: l.bbox.y1 + y0,
                },
              };
              const nearSeam =
                (idx > 0 && shifted.bbox.y0 - y0 <= 6) ||
                (idx < numChunks - 1 && y1 - shifted.bbox.y1 <= 6);
              const area = Math.max(
                1,
                (shifted.bbox.x1 - shifted.bbox.x0) * (shifted.bbox.y1 - shifted.bbox.y0),
              );
              const score =
                (nearSeam ? 0 : 1_000_000) +
                (shifted.confidence >= 0.68 ? shifted.text.trim().length * 100 : 0) +
                shifted.confidence;
              return { shifted, score, chunkIdx: idx, nearSeam, area };
            });
          }),
        );
        const candidates = chunkResults.flat().sort((a, b) => b.score - a.score);
        const deduped: OcrLine[] = [];
        const dedupedMeta: Array<{ chunkIdx: number; area: number }> = [];
        for (const item of candidates) {
          const isCrossChunkDup = deduped.some((kept, kIdx) => {
            if (dedupedMeta[kIdx].chunkIdx === item.chunkIdx) return false;
            if (!isDuplicateOrNestedSubBox(kept.bbox, item.shifted.bbox)) return false;
            const maxArea = Math.max(dedupedMeta[kIdx].area, item.area);
            const minArea = Math.min(dedupedMeta[kIdx].area, item.area);
            return maxArea / minArea <= (item.nearSeam ? 3.5 : 2.5);
          });
          if (isCrossChunkDup) {
            continue;
          }
          deduped.push(item.shifted);
          dedupedMeta.push({ chunkIdx: item.chunkIdx, area: item.area });
        }
        lines = deduped;
      } else {
        const workerRes = await runPaddleInWorker(ctx.getImageData(0, 0, width, height), signal);
        lines = workerRes.lines;
        returnedBuffer = workerRes.buffer;
      }
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
  const ocrImg =
    lines.length >= 2
      ? returnedBuffer && returnedBuffer.byteLength === width * height * 4
        ? { data: new Uint8ClampedArray(returnedBuffer), width, height }
        : ctx.getImageData(0, 0, width, height)
      : undefined;
  const bubbles = groupOcrLinesIntoBubbles(lines, width, height, ocrImg);
  return {
    bubbles,
    isPromoPage: isCreditsOrPromoPage(bubbles, lines, width, height, ocrImg),
    engine,
  };
};
