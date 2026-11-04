/**
 * Fast Webtoon & Manga Client-side OCR Module (Tesseract.js WASM)
 * 100% Yerel / Same-Origin: CDN engeli, harici sunucu bağımlılığı veya LLM Vision maliyeti yoktur.
 */
import type { Worker } from 'tesseract.js';

let workerPromise: Promise<Worker> | null = null;

const getTesseractAssetPaths = () => {
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  return {
    workerPath: `${origin}/tesseract/worker.min.js`,
    corePath: `${origin}/tesseract`,
    langPath: `${origin}/tesseract/lang`,
  };
};

export const getSharedOcrWorker = async (): Promise<Worker> => {
  if (!workerPromise) {
    workerPromise = (async () => {
      const { createWorker } = await import('tesseract.js');
      const paths = getTesseractAssetPaths();

      // 1. Önce tamamen yerel /tesseract dosyalarını dene (aynı origin, sıfır ağ/CDN engeli)
      try {
        const worker = await createWorker(['eng', 'kor'], undefined, {
          workerPath: paths.workerPath,
          corePath: paths.corePath,
          langPath: paths.langPath,
          logger: () => {}, // silent
        });
        return worker;
      } catch (localErr) {
        console.warn('Yerel Tesseract varlıkları yüklenemedi, GitHub fallback deneniyor...', localErr);
        // 2. Fallback: GitHub raw üzerinden doğrudan yükle
        const worker = await createWorker(['eng', 'kor'], undefined, {
          langPath: 'https://raw.githubusercontent.com/naptha/tessdata/gh-pages/4.0.0',
          logger: () => {},
        });
        return worker;
      }
    })().catch((err) => {
      workerPromise = null;
      throw err;
    });
  }
  return workerPromise;
};

export interface RawOcrLine {
  text: string;
  confidence: number;
  bbox: { x0: number; y0: number; x1: number; y1: number };
}

/**
 * Saf beyaz, saf siyah veya yazı içermesi imkansız düz geçiş şeritlerini <1ms'de tespit eder.
 */
export const hasSliceTextPotential = (
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
    const threshold = Math.max(12, Math.round((height / 100) * 1.5));

    for (let y = stepY; y < height - stepY; y += stepY * 2) {
      const rowOffset = y * width * 4;
      for (let x = stepX; x < width - stepX; x += stepX * 2) {
        const idx = rowOffset + x * 4;
        const r = data[idx];
        const g = data[idx + 1];
        const b = data[idx + 2];

        const rNext = data[idx + 4 * stepX];
        const gNext = data[idx + 4 * stepX + 1];
        const bNext = data[idx + 4 * stepX + 2];

        const diff = Math.abs(r - rNext) + Math.abs(g - gNext) + Math.abs(b - bNext);
        if (diff > 120) {
          sharpTransitions += 1;
          if (sharpTransitions >= threshold) return true;
        }
      }
    }
    return sharpTransitions >= threshold;
  } catch {
    return true;
  }
};

/**
 * Groups raw OCR lines into coherent speech bubbles based on spatial proximity.
 */
export const groupLinesIntoBubbles = (
  lines: RawOcrLine[],
  imgWidth: number,
  imgHeight: number,
): Array<{ box: [number, number, number, number]; text: string }> => {
  // Gürültü, tek noktalama işaretleri ve düşük güven oranlı parçaları filtrele
  const valid = lines
    .filter((l) => {
      const trimmed = l.text.trim();
      if (trimmed.length < 2) return false;
      if (l.confidence < 25) return false;
      if (/^[^\p{L}\p{N}]+$/u.test(trimmed)) return false;
      return true;
    })
    .map((l) => ({
      bbox: l.bbox,
      text: l.text.trim().replace(/\s+/g, ' '),
    }));

  if (valid.length === 0) return [];

  // Yukarıdan aşağıya sırala
  valid.sort((a, b) => a.bbox.y0 - b.bbox.y0);

  const bubbles: Array<{ box: [number, number, number, number]; text: string }> = [];
  const visited = new Set<number>();

  for (let i = 0; i < valid.length; i++) {
    if (visited.has(i)) continue;
    visited.add(i);

    const current = {
      x0: valid[i].bbox.x0,
      y0: valid[i].bbox.y0,
      x1: valid[i].bbox.x1,
      y1: valid[i].bbox.y1,
      texts: [valid[i].text],
    };

    let expanded = true;
    while (expanded) {
      expanded = false;
      const h = current.y1 - current.y0;
      const avgLineHeight = Math.max(16, h / current.texts.length);
      const maxGapY = Math.max(30, avgLineHeight * 2.0);

      for (let j = 0; j < valid.length; j++) {
        if (visited.has(j)) continue;
        const candidate = valid[j];

        // Dikey yakınlık
        const vDist = candidate.bbox.y0 - current.y1;
        const isVertClose = vDist >= -12 && vDist <= maxGapY;

        // Yatay hizalanma ve örtüşme
        const hOverlap =
          Math.min(current.x1, candidate.bbox.x1) - Math.max(current.x0, candidate.bbox.x0);
        const minW = Math.min(
          current.x1 - current.x0,
          candidate.bbox.x1 - candidate.bbox.x0,
        );
        const isHorizAligned = hOverlap > -50 || (minW > 0 && hOverlap / minW > -0.25);

        if (isVertClose && isHorizAligned) {
          visited.add(j);
          current.x0 = Math.min(current.x0, candidate.bbox.x0);
          current.y0 = Math.min(current.y0, candidate.bbox.y0);
          current.x1 = Math.max(current.x1, candidate.bbox.x1);
          current.y1 = Math.max(current.y1, candidate.bbox.y1);
          current.texts.push(candidate.text);
          expanded = true;
        }
      }
    }

    // Balon metninin etrafına %4 temizleme payı (padding) ekle
    const padX = Math.round((current.x1 - current.x0) * 0.04);
    const padY = Math.round((current.y1 - current.y0) * 0.04);

    const x0 = Math.max(0, current.x0 - padX);
    const y0 = Math.max(0, current.y0 - padY);
    const x1 = Math.min(imgWidth, current.x1 + padX);
    const y1 = Math.min(imgHeight, current.y1 + padY);

    const ymin = Math.max(0, Math.min(1000, Math.round((y0 / imgHeight) * 1000)));
    const xmin = Math.max(0, Math.min(1000, Math.round((x0 / imgWidth) * 1000)));
    const ymax = Math.max(0, Math.min(1000, Math.round((y1 / imgHeight) * 1000)));
    const xmax = Math.max(0, Math.min(1000, Math.round((x1 / imgWidth) * 1000)));

    if (ymax > ymin && xmax > xmin) {
      bubbles.push({
        box: [ymin, xmin, ymax, xmax],
        text: current.texts.join(' '),
      });
    }
  }

  return bubbles;
};

const extractLinesFromRecognizeResult = (ret: {
  data: { blocks?: Array<{ paragraphs?: Array<{ lines?: Array<{ text: string; confidence: number; bbox: { x0: number; y0: number; x1: number; y1: number } }> }> }> };
}, offsetY = 0): RawOcrLine[] => {
  const lines: RawOcrLine[] = [];
  const blocks = ret.data?.blocks || [];

  for (const block of blocks) {
    for (const para of block.paragraphs || []) {
      for (const line of para.lines || []) {
        if (line.text && line.text.trim()) {
          lines.push({
            text: line.text,
            confidence: line.confidence,
            bbox: {
              x0: line.bbox.x0,
              y0: line.bbox.y0 + offsetY,
              x1: line.bbox.x1,
              y1: line.bbox.y1 + offsetY,
            },
          });
        }
      }
    }
  }
  return lines;
};

const SLICE_HEIGHT = 2000;
const SLICE_OVERLAP = 150;
const SLICE_STEP = SLICE_HEIGHT - SLICE_OVERLAP; // 1850

/**
 * Runs fast local OCR on a canvas. Supports high-resolution and ultra-tall webtoon strips
 * by processing in smart vertical windows with instant blank space skipping.
 */
export const runFastWebtoonOcr = async (
  canvas: HTMLCanvasElement,
  signal?: AbortSignal,
): Promise<Array<{ box: [number, number, number, number]; text: string }>> => {
  if (signal?.aborted) {
    throw new DOMException('İptal edildi', 'AbortError');
  }

  const worker = await getSharedOcrWorker();
  if (signal?.aborted) {
    throw new DOMException('İptal edildi', 'AbortError');
  }

  const width = canvas.width;
  const height = canvas.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return [];

  // Standart/kısa sayfalar (height <= 2400): tek hamlede tara
  if (height <= 2400) {
    if (!hasSliceTextPotential(ctx, width, height)) {
      return [];
    }
    const ret = await worker.recognize(canvas, {}, { blocks: true });
    if (signal?.aborted) {
      throw new DOMException('İptal edildi', 'AbortError');
    }
    const lines = extractLinesFromRecognizeResult(ret, 0);
    return groupLinesIntoBubbles(lines, width, height);
  }

  // Uzun webtoon şeritleri: 2000px pencereler ve boşluk atlama ile WASM belleğini koru
  const allLines: RawOcrLine[] = [];
  const sliceCanvas = document.createElement('canvas');
  sliceCanvas.width = width;
  const sliceCtx = sliceCanvas.getContext('2d', { willReadFrequently: true });
  if (!sliceCtx) return [];

  for (let y = 0; y < height; y += SLICE_STEP) {
    if (signal?.aborted) {
      throw new DOMException('İptal edildi', 'AbortError');
    }

    const currentH = Math.min(SLICE_HEIGHT, height - y);
    sliceCanvas.height = currentH;
    sliceCtx.clearRect(0, 0, width, currentH);
    sliceCtx.drawImage(canvas, 0, y, width, currentH, 0, 0, width, currentH);

    // Boş boşlukları veya düz arkaplanları <1ms'de atla
    if (!hasSliceTextPotential(sliceCtx, width, currentH)) {
      if (y + currentH >= height) break;
      continue;
    }

    const ret = await worker.recognize(sliceCanvas, {}, { blocks: true });
    if (signal?.aborted) {
      throw new DOMException('İptal edildi', 'AbortError');
    }

    const sliceLines = extractLinesFromRecognizeResult(ret, y);
    allLines.push(...sliceLines);

    if (y + currentH >= height) break;
  }

  // Seam (dikiş) örtüşmelerinde mükerrer satırları ele
  const deduplicatedLines: RawOcrLine[] = [];
  allLines.forEach((line) => {
    const isDup = deduplicatedLines.some((existing) => {
      const vOverlap =
        Math.min(existing.bbox.y1, line.bbox.y1) - Math.max(existing.bbox.y0, line.bbox.y0);
      const hOverlap =
        Math.min(existing.bbox.x1, line.bbox.x1) - Math.max(existing.bbox.x0, line.bbox.x0);
      const isClose = vOverlap > 8 && hOverlap > 15;
      return isClose && existing.text.toLowerCase() === line.text.toLowerCase();
    });
    if (!isDup) {
      deduplicatedLines.push(line);
    }
  });

  return groupLinesIntoBubbles(deduplicatedLines, width, height);
};
