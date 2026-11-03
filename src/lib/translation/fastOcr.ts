/**
 * Fast Webtoon & Manga Client-side OCR Module (Tesseract.js WASM)
 * Extracts speech bubble text and coordinates without calling expensive LLMs.
 */
import type { Worker } from 'tesseract.js';

let workerPromise: Promise<Worker> | null = null;

const getSharedOcrWorker = async (): Promise<Worker> => {
  if (!workerPromise) {
    workerPromise = (async () => {
      const { createWorker } = await import('tesseract.js');
      // Initialize with English and Korean (covers 99% of webtoons)
      const worker = await createWorker(['eng', 'kor'], undefined, {
        logger: () => {}, // silent
      });
      return worker;
    })().catch((err) => {
      workerPromise = null;
      throw err;
    });
  }
  return workerPromise;
};

interface RawOcrLine {
  text: string;
  confidence: number;
  bbox: { x0: number; y0: number; x1: number; y1: number };
}

/**
 * Groups raw OCR lines into coherent speech bubbles based on spatial proximity.
 */
const groupLinesIntoBubbles = (
  lines: RawOcrLine[],
  imgWidth: number,
  imgHeight: number,
): Array<{ box: [number, number, number, number]; text: string }> => {
  // Filter out pure noise, watermarks, single punctuation marks, and low-confidence junk
  const valid = lines
    .filter((l) => {
      const trimmed = l.text.trim();
      if (trimmed.length < 2) return false;
      if (l.confidence < 25) return false;
      // Skip pure punctuation or SFX symbols
      if (/^[^\p{L}\p{N}]+$/u.test(trimmed)) return false;
      return true;
    })
    .map((l) => ({
      bbox: l.bbox,
      text: l.text.trim().replace(/\s+/g, ' '),
    }));

  if (valid.length === 0) return [];

  // Sort top-to-bottom
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

        // Vertical proximity
        const vDist = candidate.bbox.y0 - current.y1;
        const isVertClose = vDist >= -12 && vDist <= maxGapY;

        // Horizontal proximity / overlap
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

    // Add 4% padding around bubble text for inpainting coverage
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

/**
 * Runs fast local OCR on a canvas or image element.
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

  const ret = await worker.recognize(canvas, {}, { blocks: true });
  if (signal?.aborted) {
    throw new DOMException('İptal edildi', 'AbortError');
  }

  const lines: RawOcrLine[] = [];
  const blocks = ret.data.blocks || [];

  for (const block of blocks) {
    for (const para of block.paragraphs || []) {
      for (const line of para.lines || []) {
        if (line.text && line.text.trim()) {
          lines.push({
            text: line.text,
            confidence: line.confidence,
            bbox: line.bbox,
          });
        }
      }
    }
  }

  return groupLinesIntoBubbles(lines, width, height);
};
