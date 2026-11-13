/**
 * Saf yerel PaddleOCR (PP-OCRv3/v4) çıkarım çekirdeği ve balon gruplama mantığı.
 * Tarayıcı Web Worker'ı ve Node/vitest testleri tarafından ortak kullanılır; DOM bağımlılığı yoktur.
 */
import type { OcrBubbleLineBox } from './types';

export interface OcrImageBuffer {
  data: Uint8ClampedArray | Uint8Array;
  width: number;
  height: number;
}

export interface OcrLine {
  text: string;
  /** 0..100 arası güven skoru */
  confidence: number;
  bbox: { x0: number; y0: number; x1: number; y1: number };
  angleDeg?: number;
}

export interface OcrBubble {
  /** [ymin, xmin, ymax, xmax] 0..1000 normalize */
  box: [number, number, number, number];
  text: string;
  /** Balonu oluşturan alt satırların normalize kutuları */
  lines?: OcrBubbleLineBox[];
  /** Son satır vurgulu/büyük yazılmışsa ("ALONE?" gibi) büyüklük çarpanı */
  emphasisLastLineScale?: number;
  /** Sayfa ek yerinden taşan aynı balonun küçük parçası: yalnızca orijinal mürekkebi siler, metin basmaz */
  seamEraseOnly?: boolean;
}

export type OcrModelRunner = (
  input: Float32Array,
  dims: [number, number, number, number],
) => Promise<{ data: Float32Array; dims: readonly number[] }>;

export interface OcrRunners {
  det: OcrModelRunner;
  rec: OcrModelRunner;
  dictionary: string[];
}

const DET_MEAN = [0.485, 0.456, 0.406];
const DET_STD = [0.229, 0.224, 0.225];
const DET_MAX_WIDTH = 960;
const DET_SLICE_H = 1536;
const DET_SLICE_OVERLAP = 192;
const DET_BIN_THRESH = 0.3;
const DET_BOX_THRESH = 0.50;
const DET_UNCLIP_RATIO = 1.78;
const REC_H = 48;
const REC_MAX_W = 1600;
const MIN_LINE_CONFIDENCE = 78;

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

const checkAbort = (signal?: AbortSignal) => {
  if (signal?.aborted) throw new DOMException('İptal edildi', 'AbortError');
};

/**
 * Kaynak görüntünün [sx0, sy0, sw, sh] dikdörtgenini çift doğrusal örnekleme ile
 * [1, 3, th, outW] NCHW BGR float32 tensörüne yazar (sağ taraf sıfır dolgulu).
 */
const sampleToTensor = (
  img: OcrImageBuffer,
  sx0: number,
  sy0: number,
  sw: number,
  sh: number,
  tw: number,
  th: number,
  outW: number,
  mean: readonly number[],
  std: readonly number[],
  out: Float32Array,
) => {
  const { data, width, height } = img;
  const plane = outW * th;
  const scaleX = sw / tw;
  const scaleY = sh / th;
  for (let y = 0; y < th; y += 1) {
    const fy = clamp(sy0 + (y + 0.5) * scaleY - 0.5, 0, height - 1);
    const y0 = Math.floor(fy);
    const y1 = Math.min(height - 1, y0 + 1);
    const wy = fy - y0;
    for (let x = 0; x < tw; x += 1) {
      const fx = clamp(sx0 + (x + 0.5) * scaleX - 0.5, 0, width - 1);
      const x0 = Math.floor(fx);
      const x1 = Math.min(width - 1, x0 + 1);
      const wx = fx - x0;
      const i00 = (y0 * width + x0) * 4;
      const i01 = (y0 * width + x1) * 4;
      const i10 = (y1 * width + x0) * 4;
      const i11 = (y1 * width + x1) * 4;
      const o = y * outW + x;
      for (let c = 0; c < 3; c += 1) {
        const top = data[i00 + c] * (1 - wx) + data[i01 + c] * wx;
        const bot = data[i10 + c] * (1 - wx) + data[i11 + c] * wx;
        const v = (top * (1 - wy) + bot * wy) / 255;
        // PaddleOCR BGR kanal sırası bekler (R->2, G->1, B->0)
        const ch = 2 - c;
        out[ch * plane + o] = (v - mean[ch]) / std[ch];
      }
    }
  }
};

interface DetBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  angleDeg?: number;
  rotCenterX?: number;
  rotCenterY?: number;
  rotMajorSpan?: number;
  rotMinorSpan?: number;
}

/** DBNet olasılık haritasından bağlı bileşen analizi ile metin kutularını çıkarır. */
const extractDetBoxes = (prob: Float32Array, w: number, h: number): DetBox[] => {
  const labels = new Int32Array(w * h);
  const queue = new Int32Array(w * h);
  const boxes: DetBox[] = [];
  let label = 0;

  for (let i = 0; i < w * h; i += 1) {
    if (prob[i] <= DET_BIN_THRESH || labels[i] !== 0) continue;
    label += 1;
    let head = 0;
    let tail = 0;
    queue[tail++] = i;
    labels[i] = label;
    let minX = i % w;
    let maxX = minX;
    let minY = (i / w) | 0;
    let maxY = minY;
    let sum = 0;
    let count = 0;
    let sumX = 0;
    let sumY = 0;
    let sumXX = 0;
    let sumXY = 0;
    let sumYY = 0;

    while (head < tail) {
      const p = queue[head++];
      const py = (p / w) | 0;
      const px = p - py * w;
      sum += prob[p];
      count += 1;
      sumX += px;
      sumY += py;
      sumXX += px * px;
      sumXY += px * py;
      sumYY += py * py;
      if (px < minX) minX = px;
      if (px > maxX) maxX = px;
      if (py < minY) minY = py;
      if (py > maxY) maxY = py;

      for (let dy = -1; dy <= 1; dy += 1) {
        const ny = py + dy;
        if (ny < 0 || ny >= h) continue;
        for (let dx = -1; dx <= 1; dx += 1) {
          const nx = px + dx;
          if (nx < 0 || nx >= w) continue;
          const n = ny * w + nx;
          if (labels[n] === 0 && prob[n] > DET_BIN_THRESH) {
            labels[n] = label;
            queue[tail++] = n;
          }
        }
      }
    }

    const bw = maxX - minX + 1;
    const bh = maxY - minY + 1;
    if (count < 8 || bw < 3 || bh < 3) continue;
    const score = sum / count;
    if (score < DET_BOX_THRESH) continue;

    let angleDeg: number | undefined;
    let rotCenterX: number | undefined;
    let rotCenterY: number | undefined;
    let rotMajorSpan: number | undefined;
    let rotMinorSpan: number | undefined;
    if (count >= 24 && bw >= 18) {
      const meanX = sumX / count;
      const meanY = sumY / count;
      const varX = sumXX / count - meanX * meanX;
      const varY = sumYY / count - meanY * meanY;
      const covXY = sumXY / count - meanX * meanY;
      const diff = varX - varY;
      const trace = varX + varY;
      const disc = Math.sqrt(diff * diff + 4 * covXY * covXY);
      const lambda1 = (trace + disc) * 0.5;
      const lambda2 = Math.max(0.5, (trace - disc) * 0.5);
      if (lambda1 / lambda2 >= 4.2 && lambda1 > 16) {
        let deg = (0.5 * Math.atan2(2 * covXY, diff) * 180) / Math.PI;
        if (deg > 90) deg -= 180;
        if (deg < -90) deg += 180;
        const absDeg = Math.abs(deg);
        if (absDeg >= 5.0 && absDeg <= 35.0) {
          const majorLen = Math.sqrt(12 * lambda1);
          const minorLen = Math.max(4, Math.sqrt(12 * lambda2));
          if (Math.abs(Math.sin((deg * Math.PI) / 180)) * majorLen >= 5.5) {
            angleDeg = Number(deg.toFixed(1));
            rotCenterX = meanX + 0.5;
            rotCenterY = meanY + 0.5;
            rotMajorSpan = majorLen + Math.max(12, minorLen * 1.1);
            rotMinorSpan = minorLen + Math.max(6, minorLen * 0.85);
          }
        }
      }
    }

    // DBNet küçültülmüş çekirdeğini orijinal metin sınırına genişlet (unclip)
    // Kalın konturlu/stilize SFX, açılış parantezi '(' ve kenar harflerinin kesilmemesi için tolerans
    const d = (bw * bh * DET_UNCLIP_RATIO) / (2 * (bw + bh));
    const dx = Math.max(d * 1.44, bh * 0.44);
    const dy = Math.max(d * 1.02, bh * 0.20);
    boxes.push({
      x0: clamp(minX - dx, 0, w),
      y0: clamp(minY - dy, 0, h),
      x1: clamp(maxX + 1 + dx, 0, w),
      y1: clamp(maxY + 1 + dy, 0, h),
      ...(angleDeg !== undefined
        ? { angleDeg, rotCenterX, rotCenterY, rotMajorSpan, rotMinorSpan }
        : {}),
    });
  }
  return boxes;
};

/** CTC açgözlü (greedy) kod çözme: tekrarları ve blank (0) indeksini eler. */
const ctcDecode = (
  data: Float32Array,
  steps: number,
  classes: number,
  dict: readonly string[],
): { text: string; confidence: number } => {
  let text = '';
  let probSum = 0;
  let probCount = 0;
  let prevIdx = 0;

  for (let t = 0; t < steps; t += 1) {
    const off = t * classes;
    let maxIdx = 0;
    let maxVal = -Infinity;
    for (let k = 0; k < classes; k += 1) {
      const v = data[off + k];
      if (v > maxVal) {
        maxVal = v;
        maxIdx = k;
      }
    }
    if (maxIdx > 0 && maxIdx !== prevIdx) {
      const ch = dict[maxIdx - 1] ?? '';
      if (ch) {
        text += ch;
        probSum += maxVal;
        probCount += 1;
      }
    }
    prevIdx = maxIdx;
  }
  return { text, confidence: probCount > 0 ? (probSum / probCount) * 100 : 0 };
};

const sampleRotatedToTensor = (
  img: OcrImageBuffer,
  cx: number,
  cy: number,
  majorW: number,
  minorH: number,
  angleRad: number,
  tw: number,
  th: number,
  outW: number,
  mean: readonly number[],
  std: readonly number[],
  out: Float32Array,
) => {
  const { data, width, height } = img;
  const plane = outW * th;
  const cosA = Math.cos(angleRad);
  const sinA = Math.sin(angleRad);
  const stepX = majorW / tw;
  const stepY = minorH / th;
  for (let y = 0; y < th; y += 1) {
    const v = (y + 0.5) * stepY - minorH * 0.5;
    for (let x = 0; x < tw; x += 1) {
      const u = (x + 0.5) * stepX - majorW * 0.5;
      const fx = clamp(cx + u * cosA - v * sinA, 0, width - 1);
      const fy = clamp(cy + u * sinA + v * cosA, 0, height - 1);
      const x0 = Math.floor(fx);
      const x1 = Math.min(width - 1, x0 + 1);
      const y0 = Math.floor(fy);
      const y1 = Math.min(height - 1, y0 + 1);
      const wx = fx - x0;
      const wy = fy - y0;
      const i00 = (y0 * width + x0) * 4;
      const i01 = (y0 * width + x1) * 4;
      const i10 = (y1 * width + x0) * 4;
      const i11 = (y1 * width + x1) * 4;
      const o = y * outW + x;
      for (let c = 0; c < 3; c += 1) {
        const top = data[i00 + c] * (1 - wx) + data[i01 + c] * wx;
        const bot = data[i10 + c] * (1 - wx) + data[i11 + c] * wx;
        const val = (top * (1 - wy) + bot * wy) / 255;
        const ch = 2 - c;
        out[ch * plane + o] = (val - mean[ch]) / std[ch];
      }
    }
  }
};

const recognizeBox = async (
  img: OcrImageBuffer,
  box: DetBox,
  runners: OcrRunners,
): Promise<{ text: string; confidence: number }> => {
  const cwRaw = box.x1 - box.x0;
  const chRaw = box.y1 - box.y0;
  if (cwRaw < 4 || chRaw < 4) return { text: '', confidence: 0 };

  let sy0 = box.y0;
  let sy1 = box.y1;
  if (chRaw >= 18 && cwRaw >= 12 && box.angleDeg === undefined) {
    const xStart = clamp(Math.floor(box.x0), 0, img.width - 1);
    const xEnd = clamp(Math.ceil(box.x1) - 1, xStart, img.width - 1);
    const yStart = clamp(Math.floor(box.y0), 0, img.height - 1);
    const yEnd = clamp(Math.ceil(box.y1) - 1, yStart, img.height - 1);
    const bgLums: number[] = [];
    const stepBx = Math.max(1, Math.floor((xEnd - xStart) / 16));
    for (let x = xStart; x <= xEnd; x += stepBx) {
      for (const y of [yStart, yEnd]) {
        const idx = (y * img.width + x) * 4;
        bgLums.push(0.299 * img.data[idx] + 0.587 * img.data[idx + 1] + 0.114 * img.data[idx + 2]);
      }
    }
    if (bgLums.length > 0) {
      bgLums.sort((a, b) => a - b);
      const bgLum = bgLums[bgLums.length >> 1];
      let inkY0 = yEnd + 1;
      let inkY1 = yStart - 1;
      const stepX = Math.max(1, Math.floor((xEnd - xStart) / 48));
      for (let y = yStart; y <= yEnd; y += 1) {
        const rowOff = y * img.width * 4;
        let activeCols = 0;
        for (let x = xStart; x <= xEnd; x += stepX) {
          const idx = rowOff + x * 4;
          const lum =
            0.299 * img.data[idx] + 0.587 * img.data[idx + 1] + 0.114 * img.data[idx + 2];
          if (Math.abs(lum - bgLum) >= 34) {
            activeCols += 1;
            if (activeCols >= 2) break;
          }
        }
        if (activeCols >= 2) {
          if (y < inkY0) inkY0 = y;
          if (y > inkY1) inkY1 = y;
        }
      }
      const inkH = inkY1 - inkY0 + 1;
      if (inkH >= 7 && inkH < chRaw * 0.82) {
        const padY = clamp(Math.round(inkH * 0.14), 2, 7);
        sy0 = Math.max(box.y0, inkY0 - padY);
        sy1 = Math.min(box.y1, inkY1 + 1 + padY);
      }
    }
  }

  const cw = cwRaw;
  const ch = Math.max(4, sy1 - sy0);
  const tw = clamp(Math.round((REC_H * cw) / ch), 16, REC_MAX_W);
  const outW = Math.ceil(tw / 8) * 8;
  const input = new Float32Array(3 * REC_H * outW);
  sampleToTensor(img, box.x0, sy0, cw, ch, tw, REC_H, outW, [0.5, 0.5, 0.5], [0.5, 0.5, 0.5], input);
  const out = await runners.rec(input, [1, 3, REC_H, outW]);
  const axisRes = ctcDecode(out.data, out.dims[1], out.dims[2], runners.dictionary);

  if (
    box.angleDeg !== undefined &&
    box.rotCenterX !== undefined &&
    box.rotCenterY !== undefined &&
    box.rotMajorSpan &&
    box.rotMinorSpan
  ) {
    const rTw = clamp(Math.round((REC_H * box.rotMajorSpan) / box.rotMinorSpan), 16, REC_MAX_W);
    const rOutW = Math.ceil(rTw / 8) * 8;
    const rInput = new Float32Array(3 * REC_H * rOutW);
    sampleRotatedToTensor(
      img,
      box.rotCenterX,
      box.rotCenterY,
      box.rotMajorSpan,
      box.rotMinorSpan,
      (box.angleDeg * Math.PI) / 180,
      rTw,
      REC_H,
      rOutW,
      [0.5, 0.5, 0.5],
      [0.5, 0.5, 0.5],
      rInput,
    );
    const rOut = await runners.rec(rInput, [1, 3, REC_H, rOutW]);
    const rotRes = ctcDecode(rOut.data, rOut.dims[1], rOut.dims[2], runners.dictionary);
    const rotScore = rotRes.confidence + rotRes.text.trim().length * 1.5;
    const axisScore = axisRes.confidence + axisRes.text.trim().length * 1.5;
    if (rotRes.text.trim().length > 0 && rotScore >= axisScore - 2) {
      return rotRes;
    }
  }

  return axisRes;
};

const iou = (a: OcrLine['bbox'], b: OcrLine['bbox']) => {
  const ix = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
  const iy = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
  if (ix <= 0 || iy <= 0) return 0;
  const inter = ix * iy;
  const areaA = (a.x1 - a.x0) * (a.y1 - a.y0);
  const areaB = (b.x1 - b.x0) * (b.y1 - b.y0);
  return inter / Math.max(1, areaA + areaB - inter);
};

const isDuplicateOrNestedSubBox = (a: OcrLine['bbox'], b: OcrLine['bbox']): boolean => {
  if (iou(a, b) > 0.45) return true;
  const ix = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
  const iy = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
  if (ix <= 0 || iy <= 0) return false;
  const inter = ix * iy;
  const areaA = Math.max(1, (a.x1 - a.x0) * (a.y1 - a.y0));
  const areaB = Math.max(1, (b.x1 - b.x0) * (b.y1 - b.y0));
  return inter / Math.min(areaA, areaB) >= 0.78;
};

/**
 * Uzun webtoon/manga sayfasını örtüşmeli dilimler halinde PaddleOCR ile tarar.
 */
export const runPaddleOcr = async (
  img: OcrImageBuffer,
  runners: OcrRunners,
  signal?: AbortSignal,
): Promise<OcrLine[]> => {
  const { width, height } = img;
  if (width <= 0 || height <= 0) return [];
  const scale = width > DET_MAX_WIDTH ? DET_MAX_WIDTH / width : 1;
  const detW = Math.max(32, Math.round((width * scale) / 32) * 32);
  const sliceSrcH = Math.round(DET_SLICE_H / scale);
  const stepSrc = Math.round((DET_SLICE_H - DET_SLICE_OVERLAP) / scale);
  const lines: OcrLine[] = [];

  for (let sy = 0; sy < height; sy += stepSrc) {
    checkAbort(signal);
    const srcH = Math.min(sliceSrcH, height - sy);
    const isFirst = sy === 0;
    const isLast = sy + srcH >= height;
    const detH = Math.max(32, Math.round((srcH * scale) / 32) * 32);
    const input = new Float32Array(3 * detW * detH);
    sampleToTensor(img, 0, sy, width, srcH, detW, detH, detW, DET_MEAN, DET_STD, input);
    const out = await runners.det(input, [1, 3, detH, detW]);
    checkAbort(signal);
    const mapH = out.dims[2];
    const mapW = out.dims[3];
    const fx = width / mapW;
    const fy = srcH / mapH;

    for (const b of extractDetBoxes(out.data, mapW, mapH)) {
      // Dilim sınırında yarım kesilen kutuları komşu dilime bırak
      if (!isFirst && b.y0 <= 2) continue;
      if (!isLast && b.y1 >= mapH - 2) continue;
      const box: DetBox = {
        x0: clamp(b.x0 * fx, 0, width),
        y0: clamp(b.y0 * fy + sy, 0, height),
        x1: clamp(b.x1 * fx, 0, width),
        y1: clamp(b.y1 * fy + sy, 0, height),
        ...(b.angleDeg !== undefined
          ? {
              angleDeg: b.angleDeg,
              rotCenterX: b.rotCenterX! * fx,
              rotCenterY: b.rotCenterY! * fy + sy,
              rotMajorSpan: b.rotMajorSpan! * Math.hypot(fx * Math.cos((b.angleDeg * Math.PI) / 180), fy * Math.sin((b.angleDeg * Math.PI) / 180)),
              rotMinorSpan: b.rotMinorSpan! * Math.hypot(fx * Math.sin((b.angleDeg * Math.PI) / 180), fy * Math.cos((b.angleDeg * Math.PI) / 180)),
            }
          : {}),
      };
      const bw = box.x1 - box.x0;
      const bh = box.y1 - box.y0;
      if (bw < 10 || bh < 8 || bh > bw * 5) continue;

      checkAbort(signal);
      const rec = await recognizeBox(img, box, runners);
      const text = rec.text.trim();
      // 34+ güvenli parçaları da tut; aynı satırdaki veya aynı balon içindeki yüksek güvenli satırların devamıysa kurtarılacak
      if (!text || rec.confidence < 34) continue;
      lines.push({
        text,
        confidence: rec.confidence,
        bbox: {
          x0: Math.round(box.x0),
          y0: Math.round(box.y0),
          x1: Math.round(box.x1),
          y1: Math.round(box.y1),
        },
        ...(b.angleDeg !== undefined ? { angleDeg: b.angleDeg } : {}),
      });
    }
    if (isLast) break;
  }

  // Dilim örtüşmelerinden gelen çift ve iç içe geçmiş alt-kutu tekrarlarını IoU + kapsama ile tekilleştir
  const sorted = [...lines].sort((a, b) => b.confidence - a.confidence);
  const kept: OcrLine[] = [];
  for (const line of sorted) {
    if (kept.some((k) => isDuplicateOrNestedSubBox(k.bbox, line.bbox))) continue;
    kept.push(line);
  }
  return kept;
};

/**
 * Tek kelimelik kısa anlamlı İngilizce ünlem/emir/diyalog kelimeleri ("NO", "GO", "UP", "SO" vb.).
 * Bu kelimeler büyük/stilize yazıldığında bile düşük güvenle elenmemelidir.
 */
const SHORT_MEANINGFUL_WORD_REGEX =
  /^(?:no|yes|go|so|up|in|on|ok|hi|me|us|we|he|do|to|or|if|my|by|am|is|it|at|be|oh|ah|eh|uh|hm|yo|ha|ho|aw|ow|oi|why|who|how|now|run|die|out|off|get|let|see|say|can|not|all|one|two|too|bad|new|old|big|end|lie|cry|try|fly|sky|son|mom|dad|bro|sis|sir|god|war|sin|red|hit|cut|weak|what|wait|stop|help|kill|dead|damn|shit|hell|sure|fine|good|nice|cool|real|true|fast|slow|hard|easy|high|low|full|none|zero|more|less|most|last|next|back|down|away|here|look|take|give|make|come|gone|done)[!?.…,:;'"~-]*$/i;

/** OCR gürültüsünü (çizimden okunan sembol yığınları, düşük güvenli parçalar) eler. */
export const isUsableOcrLine = (line: OcrLine, minConfidence = MIN_LINE_CONFIDENCE): boolean => {
  const text = line.text.trim();
  const stripped = text.replace(/^[^a-zA-Z0-9]+|[^a-zA-Z0-9]+$/g, '');
  const isShortMeaningful = SHORT_MEANINGFUL_WORD_REGEX.test(stripped);
  const letters = text.match(/\p{L}/gu)?.length ?? 0;
  const digits = text.match(/\p{N}/gu)?.length ?? 0;
  const junk = text.match(/[^\p{L}\p{N}\s.,!?'"“”‘’…:;()\-–—~&%+*]/gu)?.length ?? 0;
  const isCleanText =
    junk === 0 &&
    letters >= 3 &&
    digits === 0 &&
    /[aeiouy\p{L}]/iu.test(stripped || text) &&
    !/^(.)\1{2,}$/i.test(stripped || text) &&
    /^[a-zA-Z0-9]+(?:[\s.,!?'"“”‘’…:;()\-–—~]+[a-zA-Z0-9]+)*[\s.,!?'"“”‘’…:;()\-–—~]*$/.test(
      stripped || text,
    );
  const hasLatinVowel = /[aeiouy]/i.test(stripped);

  const effectiveMinConf = isShortMeaningful
    ? Math.min(minConfidence, 40)
    : isCleanText && letters >= 3 && hasLatinVowel
      ? Math.min(minConfidence, 48)
      : isCleanText
        ? Math.min(minConfidence, 56)
        : minConfidence;

  if (line.confidence < effectiveMinConf) return false;
  if (letters === 0) return false;
  if (letters < 2 && !/^(?:I|A|O)[!?.…,]*$/i.test(text)) return false;
  // Sembol oranı yüksek satırlar (ör. "| 7 A - _ =", "| 2 7 27") çizim gürültüsüdür
  if (junk / Math.max(1, letters + digits + junk) > 0.25) return false;
  // Tek harf dizileri ("A | J 7") gerçek cümle değildir
  const words = text.split(/\s+/).filter((w) => /\p{L}/u.test(w));
  if (words.length >= 3 && words.every((w) => w.replace(/[^\p{L}]/gu, '').length <= 1)) return false;
  return true;
};

/** Baştaki/sondaki balon kenarı artıklarını ("|", "'", "\\" vb.) ve harf içi "0" -> "O" okumalarını temizler. */
export const cleanOcrText = (text: string): string => {
  const tokens = text.replace(/\s+/g, ' ').trim().split(' ');
  const isJunkToken = (tok: string) =>
    !/[\p{L}\p{N}]/u.test(tok) && !/^[.…!?]+$/.test(tok);
  while (tokens.length > 0 && isJunkToken(tokens[0])) tokens.shift();
  while (tokens.length > 0 && isJunkToken(tokens[tokens.length - 1])) tokens.pop();
  return tokens
    .join(' ')
    .replace(/^[|\\/_=~^`<>]+/u, '')
    .replace(/[|\\/_=~^`<>]+$/u, '')
    .replace(/<[^>]{1,28}>/g, ' ')
    .replace(/[<>]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/(?<=\p{L})["“”](?=(?:s|t|m|d|re|ve|ll|S|T|M|D|RE|VE|LL)\b)/gu, "'")
    .replace(/(\p{L})-[""''`]+(?=\s|$)/gu, '$1-')
    .replace(/(?<=[A-Za-z])0(?=[A-Za-z.!?,;:'"\s]|$)/g, 'O')
    .replace(/(?:^|(?<=[\s"'([¡¿]))0(?=[A-Za-z]{1,})/g, 'O')
    .replace(/^5[0O]([!?.…]*)$/i, 'SO$1')
    .replace(
      /\b[cC](?=(?:eh|ah|oh|que|quien|qlien|qle|como|cuando|cuanto|donde|por|para|podria|podrias|verdad|estaria|esta|eso|ese|ahora|acaso|sera|puede|puedo|tiene|hay)\b)/gi,
      '',
    )
    .replace(/\b[qQ][lL][eE]\b/g, 'QUE')
    .replace(/\b[qQ][lL][iI][eE][nN]\b/g, 'QUIEN')
    .replace(/\b[mM][lL][cC][hH]([aA][sS]?|[oO][sS]?)\b/g, 'Much$1')
    .trim();
};

/**
 * Saf ses efektlerini (onomatopoeia: BOOM, CRASH, SWOOSH, THUD, CLANG, SHING, TAP TAP vb.) tespit eder.
 * Kullanıcı kuralı: Saf ses efektleri çevrilmez (çizim olarak korunur),
 * ancak "NO", "ALONE?", "FIRST MURDER", "STOP", "WAIT", "HELP", "DIE" gibi anlamlı kelimeler KESİNLİKLE çevrilir.
 */
const PURE_SFX_STEMS = new Set([
  // Darbe / Patlama / Çarpma
  'boom', 'kaboom', 'bam', 'baam', 'bang', 'clang', 'clank', 'clash', 'clack',
  'clatter', 'crash', 'crack', 'crackle', 'cruck', 'crach', 'grack', 'craek', 'krack',
  'crunch', 'frun', 'crun', 'frunch', 'cruch', 'grunch', 'krunch', 'cronch',
  'thud', 'thump', 'thwack', 'wham', 'whack', 'slam', 'smack', 'smash',
  'pow', 'poof', 'bonk', 'boing', 'bong', 'ding', 'dong', 'kring', 'ting', 'plink',
  'plop', 'splat', 'sploosh', 'squelch', 'squish', 'thwip', 'twang', 'zing', 'zap',
  'zzt', 'zzzt', 'bzz', 'bzzt', 'vroom', 'screech', 'skrrt',
  // Rüzgar / Kesme / Hareket / İrkilme efektleri
  'swoosh', 'whoosh', 'swish', 'shing', 'shwing', 'schwing', 'fwip', 'fwoosh',
  'whir', 'whirr', 'rustle', 'patter', 'stomp', 'startle', 'startles', 'flinch',
  'flinches', 'shudder', 'shudders', 'tremble', 'trembles', 'twitch', 'twitches',
  'jolt', 'jolts',
  // Titreme / Çevre / Hayvan / Kalp atışı
  'rumble', 'grumble', 'rattle', 'creak', 'sizzle', 'fizz', 'glug', 'gulp',
  'slurp', 'munch', 'chomp', 'woof', 'meow', 'purr', 'grr', 'grrr', 'roar', 'growl', 'howl',
  'badump', 'badum', 'lubdub', 'doki', 'dokidoki',
  // Nefes / Gülme / Ses efektleri
  'wheeze', 'sniffle', 'achoo', 'hic', 'zzz', 'bwahaha', 'muahaha', 'mwahaha',
  'kekeke', 'kukuku',
  // Korece / Japonca romanize saf ses efektleri
  'kwang', 'kwaang', 'kung', 'kuung', 'dugeun', 'dukgeun', 'jjeoreong', 'puk',
  'peok', 'ssuk', 'geuk', 'kkeuk', 'heok', 'heuk', 'deolkeok', 'chirik', 'sarak',
  'ttuk', 'jjak', 'gogo', 'gogogo', 'menacing',
  // Türkçe yansıma / ses efekti karşılıkları (eğik SFX yanlış okunup çevrilirse yakalamak için)
  'çat', 'pat', 'küt', 'güm', 'şak', 'tak', 'tık', 'çatır', 'çatırt', 'çatırtı',
  'şırrak', 'şangır', 'gıcırt', 'gıcırtı', 'hışırt', 'hışırtı', 'vın', 'vınn',
  'vız', 'vızz', 'hart', 'kırt', 'fış', 'fışş', 'cız', 'cızz', 'şlap', 'irülür', 'irkilir',
]);

/** Tek başına anlamlı kelime olabilecek ama 2-3 kez arka arkaya tekrarlandığında ses efekti olan kelimeler ("TAP TAP TAP", "STEP STEP", "DRIP DRIP", "CLAP CLAP") */
export const REPEATED_ONLY_SFX_STEMS = new Set([
  'tap', 'step', 'drip', 'drop', 'clap', 'pat', 'knock', 'tick', 'tock', 'click',
  'pop', 'snap', 'ring', 'beep', 'honk', 'cough', 'pant', 'sob', 'gasp', 'gulp',
  'chew', 'chop', 'slash', 'slice', 'poke', 'prod', 'shake', 'tremble', 'shiver',
  'shudder', 'flinch', 'twitch', 'sparkle', 'glint', 'gleam', 'flash', 'glow',
]);

const collapseRepeatedChars = (word: string): string =>
  word.toLowerCase().replace(/([a-z])\1{2,}/g, '$1$1').replace(/([a-z])\1+/g, '$1');

export const isPureSoundEffect = (text: string): boolean => {
  const cleaned = text
    .trim()
    .replace(/^[¡¿.,!?:;…\-_~*^'"/\\()[\]{}<>◁▷◀▶★☆•\s]+|[¡¿.,!?:;…\-_~*^'"/\\()[\]{}<>◁▷◀▶★☆•\s]+$/g, '');
  if (!cleaned) return true;

  const rawTokens = cleaned
    .split(/[\s¡¿.,!?:;…\-_~*^'"/\\()[\]{}<>]+/)
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);

  if (rawTokens.length === 0 || rawTokens.length > 4) return false;

  const joinedAlpha = rawTokens.join('').replace(/[^a-z]/g, '');
  if (
    joinedAlpha &&
    (PURE_SFX_STEMS.has(joinedAlpha) || PURE_SFX_STEMS.has(collapseRepeatedChars(joinedAlpha)))
  ) {
    return true;
  }

  // Tüm tokenlar saf ses efekti köklerinden oluşuyorsa (ör. "BOOM!", "KWAANG!", "BA-DUMP", "CLANG CRASH")
  const allPureSfx = rawTokens.every((tok) => {
    const exact = tok.replace(/[^a-z]/g, '');
    if (!exact) return true;
    if (PURE_SFX_STEMS.has(exact)) return true;
    const collapsed = collapseRepeatedChars(exact);
    if (PURE_SFX_STEMS.has(collapsed)) return true;
    // "shhhhh", "zzzzzz", "grrrrr", "krrrr", "bzzzz" gibi ünsüz uzatmaları
    if (/^(?:sh+|z+|g+r+|k+r+|b+z+|f+s+h+|s+w+i+s+h+|w+h+o+s+h+|t+h+u+d+|b+o+m+|b+a+m+|p+o+w+)$/i.test(exact)) {
      return true;
    }
    return false;
  });
  if (allPureSfx) return true;

  // "TAP TAP", "STEP STEP STEP", "DRIP DRIP", "TICK TOCK", "DING DONG" gibi tekrarlı efektler
  if (rawTokens.length >= 2) {
    const stems = rawTokens.map((t) => t.replace(/[^a-z]/g, ''));
    const allRepeatedSfx = stems.every(
      (s) => REPEATED_ONLY_SFX_STEMS.has(s) || REPEATED_ONLY_SFX_STEMS.has(collapseRepeatedChars(s)),
    );
    if (allRepeatedSfx) {
      const uniqueStems = new Set(stems.map(collapseRepeatedChars));
      if (uniqueStems.size === 1) return true;
      if (uniqueStems.has('tick') && uniqueStems.has('tock') && uniqueStems.size === 2) return true;
    }
  }

  return false;
};

const KNOWN_RPG_STAT_KEY_REGEX =
  /^(?:name|isim|ad|level|lvl|lv|seviye|race|type|t[üu]r|class|s[ıi]n[ıi]f|rank|r[üu]tbe|title|unvan|hp|mp|sp|xp|exp|health|can|mana|b[üu]y[üu]|stamina|dayan[ıi]kl[ıi]l[ıi]k|atk|attack|sald[ıi]r[ıi]|def|defense|savunma|str|strength|g[üu][çc]|agi|agility|[çc]eviklik|dex|int|intelligence|zeka|vit|vitality|luk|luck|[şs]ans|speed|h[ıi]z|weapon|silah|armor|z[ıi]rh|skill|skills|yetenek|yetenekler|ability|abilities|owner|sahip|master|stat|stats|status|durum|power|g[üu][çc]\s*puan[ıi]|evolution(?:\s*points?)?|evrim(?:\s*puan[ıi])?|points?|tier|grade|element|attribute|effect|passive|active|reward|[öo]d[üu]l|quest|g[öo]rev|mission|condition|ko[şs]ul|age|ya[şs]|gender|cinsiyet|affiliation|clan|klan|sect|tarikat|realm|diyar|stage|a[şs]ama|cultivation|trait|traits|buff|debuff|equipment|ekipman|item|e[şs]ya|description|a[çc][ıi]klama|durability|host|system)$/i;

/**
 * RPG / Sistem durum penceresi anahtar-değer satırlarını ("HEALTH: 100", "NAME: JIANG CHENG")
 * normal konuşma diyaloglarından ("CHICKITO: OH DAMN,") güvenle ayırır.
 */
export const isRpgStatLine = (rawText: string): boolean => {
  const cleaned = rawText.trim().replace(/\s+/g, ' ');
  const m = cleaned.match(/^([A-Za-zÇĞİÖŞÜçğıöşü0-9\s/()+-]{2,26}):\s*(.+)$/);
  if (!m) return false;
  const key = m[1].trim();
  const val = m[2].trim();
  if (!val) return false;
  if (/[?]$|,$/.test(val)) return false;
  const firstWord = val.split(/\s+/)[0] ?? '';
  if (
    /^(?:oh|ah|uh|um|hey|well|wait|what|why|how|damn|shit|fuck)$/i.test(firstWord) ||
    (/^(?:no|yes)$/i.test(firstWord) && val.split(/\s+/).length >= 2)
  ) {
    return false;
  }
  if (KNOWN_RPG_STAT_KEY_REGEX.test(key)) return true;
  if (/^[+-]?\d/.test(val)) return true;
  const wordCount = val.split(/\s+/).length;
  return wordCount <= 3 && !/[!?]/.test(val) && /^[A-Z0-9+/().\s-]+$/.test(val);
};

const sampleLineCollarRgb = (
  img: OcrImageBuffer,
  bbox: OcrLine['bbox'],
): { lum: number; r: number; g: number; b: number } => {
  const { data, width, height } = img;
  const xStart = Math.max(0, Math.floor(bbox.x0));
  const xEnd = Math.min(width - 1, Math.ceil(bbox.x1));
  const stepX = Math.max(1, Math.floor((xEnd - xStart) / 14));
  const lums: number[] = [];
  const rs: number[] = [];
  const gs: number[] = [];
  const bs: number[] = [];
  const sampleYs = [
    Math.max(0, Math.floor(bbox.y0) - 3),
    Math.max(0, Math.floor(bbox.y0) - 1),
    Math.min(height - 1, Math.ceil(bbox.y1) + 1),
    Math.min(height - 1, Math.ceil(bbox.y1) + 3),
  ];
  for (const y of sampleYs) {
    const rowOff = y * width * 4;
    for (let x = xStart; x <= xEnd; x += stepX) {
      const idx = rowOff + x * 4;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];
      rs.push(r);
      gs.push(g);
      bs.push(b);
      lums.push(0.299 * r + 0.587 * g + 0.114 * b);
    }
  }
  if (lums.length === 0) return { lum: 255, r: 255, g: 255, b: 255 };
  const medPick = (arr: number[]) => {
    const s = [...arr].sort((a, b) => a - b);
    return s[Math.floor(s.length * 0.55)];
  };
  return { lum: medPick(lums), r: medPick(rs), g: medPick(gs), b: medPick(bs) };
};

const sampleLineCollarLum = (img: OcrImageBuffer, bbox: OcrLine['bbox']): number =>
  sampleLineCollarRgb(img, bbox).lum;

const hasHorizontalBubbleBarrier = (
  img: OcrImageBuffer,
  lineA: OcrLine,
  lineB: OcrLine,
): boolean => {
  const [left, right] = lineA.bbox.x0 <= lineB.bbox.x0 ? [lineA, lineB] : [lineB, lineA];
  const colL = sampleLineCollarRgb(img, left.bbox);
  const colR = sampleLineCollarRgb(img, right.bbox);
  const bgL = colL.lum;
  const bgR = colR.lum;
  const rgbJump = Math.hypot(colL.r - colR.r, colL.g - colR.g, colL.b - colR.b);
  if (Math.abs(bgL - bgR) >= 75 || rgbJump >= 95) return true;

  const { data, width, height } = img;
  const hGapPx = right.bbox.x0 - left.bbox.x1;
  if (hGapPx <= 1.5) return false;
  const gapX0 = Math.max(0, Math.floor(left.bbox.x1) + 1);
  const gapX1 = Math.min(width - 1, Math.ceil(right.bbox.x0) - 1);
  if (gapX1 < gapX0) return false;

  const ovY0 = Math.max(0, Math.floor(Math.max(left.bbox.y0, right.bbox.y0)));
  const ovY1 = Math.min(height - 1, Math.ceil(Math.min(left.bbox.y1, right.bbox.y1)));
  const spanY = ovY1 - ovY0 + 1;
  if (spanY < 4) return false;

  const bothLight = bgL >= 165 && bgR >= 165;
  const bothDark = bgL <= 105 && bgR <= 105;
  const padY = Math.max(4, Math.round(spanY * 0.55));
  const cuspTopY = Math.max(0, ovY0 - padY);
  const cuspBotY = Math.min(height - 1, ovY1 + padY);

  for (let x = gapX0; x <= gapX1; x += 1) {
    let darkCount = 0;
    let brightCount = 0;
    for (let y = ovY0; y <= ovY1; y += 1) {
      const idx = (y * width + x) * 4;
      const lum = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
      if (lum <= 145) darkCount += 1;
      if (lum >= 180) brightCount += 1;
    }
    if (bothLight && darkCount / spanY >= 0.4) return true;
    if (bothDark && brightCount / spanY >= 0.4) return true;

    // İkiz / fıstık (peanut) beyaz balonlar arasındaki üst-alt boğum/sınır daralması (cusp)
    if (bothLight && x >= gapX0 && x <= gapX1) {
      let topDark = false;
      let botDark = false;
      for (let y = cuspTopY; y <= ovY0 + 2; y += 1) {
        const idx = (y * width + x) * 4;
        if (0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2] <= 135) {
          topDark = true;
          break;
        }
      }
      if (topDark) {
        for (let y = ovY1 - 2; y <= cuspBotY; y += 1) {
          const idx = (y * width + x) * 4;
          if (0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2] <= 135) {
            botDark = true;
            break;
          }
        }
      }
      if (topDark && botDark) return true;
    }
  }

  // Konkav içbükey boğum kontrolü: iki teğet beyaz balonun birleşim noktasında ("LOOK," | "IF YOU CAN...")
  // boşluk sütununun üst/alt duvarı, sağ ve sol kelimelerin dış duvarından içeri doğru çöker.
  if (bothLight && hGapPx >= 4) {
    const scanMax = Math.min(110, Math.round(Math.max(left.bbox.y1 - left.bbox.y0, right.bbox.y1 - right.bbox.y0) * 2.4));
    const findWallAbove = (px: number, startY: number): number | null => {
      const cx = clamp(Math.round(px), 0, width - 1);
      for (let y = startY; y >= Math.max(0, startY - scanMax); y -= 1) {
        const idx = (y * width + cx) * 4;
        if (0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2] <= 120) return y;
      }
      return null;
    };
    const findWallBelow = (px: number, startY: number): number | null => {
      const cx = clamp(Math.round(px), 0, width - 1);
      for (let y = startY; y <= Math.min(height - 1, startY + scanMax); y += 1) {
        const idx = (y * width + cx) * 4;
        if (0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2] <= 120) return y;
      }
      return null;
    };
    const gapMidX = (gapX0 + gapX1) * 0.5;
    const leftMidX = (left.bbox.x0 + left.bbox.x1) * 0.5;
    const rightMidX = (right.bbox.x0 + right.bbox.x1) * 0.5;
    const wTopGap = findWallAbove(gapMidX, ovY0);
    const wTopL = findWallAbove(leftMidX, Math.floor(left.bbox.y0));
    const wTopR = findWallAbove(rightMidX, Math.floor(right.bbox.y0));
    if (wTopGap !== null && ((wTopL !== null && wTopGap > wTopL + 6) || (wTopR !== null && wTopGap > wTopR + 6))) {
      return true;
    }
    const wBotGap = findWallBelow(gapMidX, ovY1);
    const wBotL = findWallBelow(leftMidX, Math.ceil(left.bbox.y1));
    const wBotR = findWallBelow(rightMidX, Math.ceil(right.bbox.y1));
    if (wBotGap !== null && ((wBotL !== null && wBotGap < wBotL - 6) || (wBotR !== null && wBotGap < wBotR - 6))) {
      return true;
    }
  }
  return false;
};

const hasVerticalBubbleBarrier = (
  img: OcrImageBuffer,
  lineA: OcrLine,
  lineB: OcrLine,
): boolean => {
  const { data, width, height } = img;
  const [top, bot] = lineA.bbox.y0 <= lineB.bbox.y0 ? [lineA, lineB] : [lineB, lineA];
  const vGapPx = bot.bbox.y0 - top.bbox.y1;
  const colT = sampleLineCollarRgb(img, top.bbox);
  const colB = sampleLineCollarRgb(img, bot.bbox);
  const bgT = colT.lum;
  const bgB = colB.lum;
  const rgbJump = Math.hypot(colT.r - colB.r, colT.g - colB.g, colT.b - colB.b);
  // Kalın siyah konturlu orta ton sahne/anlatım yazılarında sıkı dikey yaka pikselinin biri siyah kontura denk gelebilir
  const fakeOutlineCollar =
    vGapPx <= 6 &&
    Math.min(bgT, bgB) <= 28 &&
    Math.max(bgT, bgB) >= 75 &&
    Math.max(bgT, bgB) < 220;
  // Kırmızı başlık kutusu ("SAW") ile siyah/gri kaya ("CHAPTER 1:") arası gibi parlaklığı yakın
  // veya üst-alt sınırları dışa taşan sıkı kutuları yan kanatlardan ve dikey boşluktan ayır!
  const sampleFlankChromaRgb = (bbox: OcrLine['bbox'], fallback: { r: number; g: number; b: number }) => {
    const midY = Math.round((bbox.y0 + bbox.y1) * 0.5);
    const y0s = Math.max(0, midY - 4);
    const y1s = Math.min(height - 1, midY + 4);
    const xs: number[] = [];
    for (let dx = 3; dx <= 8; dx += 2) {
      const lx = Math.floor(bbox.x0) - dx;
      const rx = Math.ceil(bbox.x1) + dx;
      if (lx >= 0) xs.push(lx);
      if (rx < width) xs.push(rx);
    }
    const rs: number[] = [];
    const gs: number[] = [];
    const bs: number[] = [];
    for (let y = y0s; y <= y1s; y += 2) {
      const rOff = y * width * 4;
      for (const x of xs) {
        const idx = rOff + x * 4;
        rs.push(data[idx]);
        gs.push(data[idx + 1]);
        bs.push(data[idx + 2]);
      }
    }
    if (rs.length === 0) return fallback;
    const med = (a: number[]) => [...a].sort((u, v) => u - v)[a.length >> 1];
    return { r: med(rs), g: med(gs), b: med(bs) };
  };
  const flankT = sampleFlankChromaRgb(top.bbox, colT);
  const flankB = sampleFlankChromaRgb(bot.bbox, colB);
  const flankJump = Math.hypot(flankT.r - flankB.r, flankT.g - flankB.g, flankT.b - flankB.b);
  const flankHueJump =
    Math.abs((flankT.r - flankT.g) - (flankB.r - flankB.g)) +
    Math.abs((flankT.r - flankT.b) - (flankB.r - flankB.b));
  const topBoxVivid = Math.max(flankT.r, flankT.g, flankT.b) - Math.min(flankT.r, flankT.g, flankT.b) >= 65;
  const botBoxVivid = Math.max(flankB.r, flankB.g, flankB.b) - Math.min(flankB.r, flankB.g, flankB.b) >= 65;
  const vividChromaBoxBoundary =
    (rgbJump >= 90 && (vGapPx >= 4 || Math.max(colT.r - colT.g, colB.r - colB.g) >= 55)) ||
    (vGapPx >= 6 && (flankJump >= 105 || flankHueJump >= 115 || (flankJump >= 85 && topBoxVivid !== botBoxVivid)));
  if ((Math.abs(bgT - bgB) >= 75 || vividChromaBoxBoundary) && !fakeOutlineCollar) return true;

  if (vGapPx <= 1.5) return false;
  const gapY0 = Math.max(0, Math.floor(top.bbox.y1) + 1);
  const gapY1 = Math.min(height - 1, Math.ceil(bot.bbox.y0) - 1);
  if (gapY1 < gapY0) return false;

  const ovX0 = Math.max(0, Math.floor(Math.max(top.bbox.x0, bot.bbox.x0)));
  const ovX1 = Math.min(width - 1, Math.ceil(Math.min(top.bbox.x1, bot.bbox.x1)));
  const spanX = ovX1 - ovX0 + 1;
  if (spanX < 4) return false;

  const bothLight = bgT >= 165 && bgB >= 165;
  const bothDark = bgT <= 105 && bgB <= 105;
  const colBlocked = new Uint8Array(spanX);
  for (let y = gapY0; y <= gapY1; y += 1) {
    let darkCount = 0;
    let brightCount = 0;
    const rowOff = y * width * 4;
    for (let x = ovX0; x <= ovX1; x += 1) {
      const idx = rowOff + x * 4;
      const lum = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
      if (lum <= 145) darkCount += 1;
      if (lum >= 180) brightCount += 1;
      if (bothLight && lum <= 115) colBlocked[x - ovX0] = 1;
      if (bothDark && lum >= 185) colBlocked[x - ovX0] = 1;
    }
    if (bothLight && darkCount / spanX >= 0.45) return true;
    if (vGapPx >= 4.5 && bothDark && brightCount / spanX >= 0.45) return true;
  }

  // Eğrisel/dikenli oval balon sınırları yatay bir satırda %45 doluluğa ulaşmasa da
  // sütunların çoğunluğunu dikeyde keser
  if (bothLight || bothDark) {
    let blockedCols = 0;
    for (let i = 0; i < spanX; i += 1) {
      if (colBlocked[i]) blockedCols += 1;
    }
    if (blockedCols / spanX >= 0.62) return true;
  }
  return false;
};

/**
 * Satırları balonlara gruplar.
 * - Aynı yatay hizada bölünmüş kelimeleri ("FIRST MURD" + "ER.") düşük güvenli parça kurtarma ile birleştirir.
 * - Aynı konuşma balonunun içindeki vurgulu/büyük alt satırları ("WHY DID YOU COME UP" + "ALONE?")
 *   boyut oranı 2.85 katına kadar olsa bile aynı balona bağlar.
 * - Piksel tabanlı balon sınırı / boğum kontrolüyle ikiz balonların yatay/dikey birleşmesini önler.
 */
export const groupOcrLinesIntoBubbles = (
  rawLines: OcrLine[],
  imgWidth: number,
  imgHeight: number,
  img?: OcrImageBuffer,
): OcrBubble[] => {
  const cleanedAll = rawLines
    .map((l) => ({ ...l, text: cleanOcrText(l.text) }))
    .filter((l) => l.text.length > 0);

  // Beyaz zemin üzerindeki çok soluk gri arka plan logolarını/filigranlarını (ör. açık gri Tencent logosu -> "A inane")
  // metin adayı olarak ele.
  const isFaintGrayWatermarkOnWhite = (line: OcrLine): boolean => {
    if (!img) return false;
    const bgCollar = sampleLineCollarLum(img, line.bbox);
    if (bgCollar < 238) return false;
    const x0 = clamp(Math.floor(line.bbox.x0), 0, img.width - 1);
    const x1 = clamp(Math.ceil(line.bbox.x1), 0, img.width - 1);
    const y0 = clamp(Math.floor(line.bbox.y0), 0, img.height - 1);
    const y1 = clamp(Math.ceil(line.bbox.y1), 0, img.height - 1);
    const w = x1 - x0;
    const h = y1 - y0;
    if (w < 6 || h < 6) return false;
    const stepX = Math.max(1, Math.floor(w / 24));
    const stepY = Math.max(1, Math.floor(h / 12));
    let minLum = 255;
    for (let y = y0; y <= y1; y += stepY) {
      const rowOff = y * img.width * 4;
      for (let x = x0; x <= x1; x += stepX) {
        const idx = rowOff + x * 4;
        const lum = 0.299 * img.data[idx] + 0.587 * img.data[idx + 1] + 0.114 * img.data[idx + 2];
        if (lum < minLum) minLum = lum;
      }
    }
    return minLum >= 175;
  };

  // Yüksek güvenli satırları seç
  const strongLines = cleanedAll.filter(
    (l) => isUsableOcrLine(l, MIN_LINE_CONFIDENCE) && !isFaintGrayWatermarkOnWhite(l),
  );

  // 1) Aynı yatay satırda (baseline) yüksek güvenli bir satırın hemen sağında/solunda kalan parçaları ("ER." gibi)
  // 2) Veya aynı konuşma balonu sütununda yüksek güvenli bir satırın hemen üstünde/altında kalan temiz satırları ("Esta", "I've found its" gibi) kurtar
  const rescuedLines = cleanedAll.filter((cand) => {
    if (isUsableOcrLine(cand, MIN_LINE_CONFIDENCE)) return false;
    if (cand.confidence < 34) return false;
    const letters = cand.text.match(/\p{L}/gu)?.length ?? 0;
    const digits = cand.text.match(/\p{N}/gu)?.length ?? 0;
    const junk = cand.text.match(/[^\p{L}\p{N}\s.,!?'"“”‘’…:;()\-–—~&%+*]/gu)?.length ?? 0;
    const isPureNumberNeighbor =
      letters === 0 &&
      digits >= 1 &&
      digits <= 5 &&
      junk === 0 &&
      /^\d{1,5}(?:[.,]\d{1,3})?$/.test(cand.text.trim()) &&
      cand.confidence >= 45;
    if (letters < 1 && !isPureNumberNeighbor) return false;
    const cb = cand.bbox;
    const ch = cb.y1 - cb.y0;
    const cw = cb.x1 - cb.x0;
    const centerXc = (cb.x0 + cb.x1) * 0.5;
    const centerYc = (cb.y0 + cb.y1) * 0.5;
    const isEdgeTruncated = cb.y0 <= 4 || cb.y1 >= imgHeight - 4;

    return strongLines.some((s) => {
      const sb = s.bbox;
      const sh = sb.y1 - sb.y0;
      const sw = sb.x1 - sb.x0;
      const centerXs = (sb.x0 + sb.x1) * 0.5;
      const centerYs = (sb.y0 + sb.y1) * 0.5;
      const minH = Math.min(ch, sh);
      const maxH = Math.max(ch, sh);
      if (!isEdgeTruncated && maxH / Math.max(1, minH) > 2.85) return false;

      // Yatay komşu ("FIRST MURD" + "ER.")
      const vOverlap = Math.min(cb.y1, sb.y1) - Math.max(cb.y0, sb.y0);
      const hGap = Math.max(cb.x0, sb.x0) - Math.min(cb.x1, sb.x1);
      if (
        maxH / Math.max(1, minH) <= 1.85 &&
        vOverlap >= minH * 0.5 &&
        hGap >= -minH * 0.4 &&
        hGap <= maxH * 0.55 &&
        (!img || !hasHorizontalBubbleBarrier(img, cand, s))
      ) {
        return true;
      }

      // Dikey balon içi komşu ("SO" + "WEAK?!", "Esta" + "BEBIDA SABE", "300" + "GRAND.", "3" + "of them!")
      const reqConf = isEdgeTruncated ? 34 : 36;
      const maxJunk = isEdgeTruncated ? 2 : 1;
      const minOverlapRatio = isEdgeTruncated ? 0.25 : 0.32;
      if ((letters >= 2 || isPureNumberNeighbor) && junk <= maxJunk && cand.confidence >= reqConf) {
        const vGap = Math.max(cb.y0, sb.y0) - Math.min(cb.y1, sb.y1);
        const hOverlap = Math.min(cb.x1, sb.x1) - Math.max(cb.x0, sb.x0);
        const narrow = Math.min(cw, sw);
        const centerDist = Math.abs(centerXc - centerXs);
        const centerYDist = Math.abs(centerYc - centerYs);
        if (
          vGap >= -minH * 0.62 &&
          centerYDist >= minH * 0.45 &&
          vGap <= maxH * 1.55 &&
          hOverlap > narrow * minOverlapRatio &&
          centerDist < maxH * 2.1
        ) {
          return true;
        }
      }
      return false;
    });
  });

  const lines = [...strongLines, ...rescuedLines].sort(
    (a, b) => a.bbox.y0 - b.bbox.y0 || a.bbox.x0 - b.bbox.x0,
  );
  if (lines.length === 0) return [];

  // İki yatay komşu satırın her birinin kendi dikey X-sütununda başka satırlarla üst üste/alt alta
  // bir balon oluşturup oluşturmadığını kontrol eder (yan yana duran ikiz balonları ayırmak için)
  const hasIndependentVerticalPartner = (targetIdx: number, otherIdx: number): boolean => {
    const tBox = lines[targetIdx].bbox;
    const oBox = lines[otherIdx].bbox;
    const th = tBox.y1 - tBox.y0;
    const tw = tBox.x1 - tBox.x0;
    for (let k = 0; k < lines.length; k += 1) {
      if (k === targetIdx || k === otherIdx) continue;
      const kBox = lines[k].bbox;
      const kh = kBox.y1 - kBox.y0;
      const vGap = Math.max(tBox.y0, kBox.y0) - Math.min(tBox.y1, kBox.y1);
      if (vGap < -Math.min(th, kh) * 0.4 || vGap > Math.max(th, kh) * 1.35) continue;
      const ovT = Math.min(tBox.x1, kBox.x1) - Math.max(tBox.x0, kBox.x0);
      const ovO = Math.min(oBox.x1, kBox.x1) - Math.max(oBox.x0, kBox.x0);
      if (ovT > Math.min(tw, kBox.x1 - kBox.x0) * 0.42 && ovO <= Math.min(oBox.x1 - oBox.x0, kBox.x1 - kBox.x0) * 0.18) {
        return true;
      }
    }
    return false;
  };

  // Bir satırın iki ayrı yan yana sütunun ("REPARTIDOR" ve "31 ANOS") üstünü/altını boydan boya
  // kaplayan geniş bir başlık ("KIM JEONGHYUK") olup olmadığını kontrol eder.
  const spansSeparateSideBySideColumns = (wideIdx: number, colIdx: number): boolean => {
    const wBox = lines[wideIdx].bbox;
    const cBox = lines[colIdx].bbox;
    const ch = cBox.y1 - cBox.y0;
    for (let k = 0; k < lines.length; k += 1) {
      if (k === wideIdx || k === colIdx) continue;
      const oBox = lines[k].bbox;
      const oh = oBox.y1 - oBox.y0;
      const vOv = Math.min(cBox.y1, oBox.y1) - Math.max(cBox.y0, oBox.y0);
      const hGap = Math.max(cBox.x0, oBox.x0) - Math.min(cBox.x1, oBox.x1);
      // colIdx ile aynı yatay hizada ama aralarında belirgin boşluk olan ikinci bir sütun varsa ("REPARTIDOR" vs "31 ANOS")
      if (vOv >= Math.min(ch, oh) * 0.4 && hGap > Math.max(ch, oh) * 0.55) {
        const ov1 = Math.min(wBox.x1, cBox.x1) - Math.max(wBox.x0, cBox.x0);
        const ov2 = Math.min(wBox.x1, oBox.x1) - Math.max(wBox.x0, oBox.x0);
        if (ov1 > 0 && ov2 > 0) return true;
      }
    }
    return false;
  };

  const parent = lines.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };

  for (let i = 0; i < lines.length; i += 1) {
    const a = lines[i].bbox;
    const ha = a.y1 - a.y0;
    const wa = a.x1 - a.x0;
    const centerXa = (a.x0 + a.x1) * 0.5;
    const centerYa = (a.y0 + a.y1) * 0.5;
    const isStatA = isRpgStatLine(lines[i].text);

    for (let j = i + 1; j < lines.length; j += 1) {
      const b = lines[j].bbox;
      const hb = b.y1 - b.y0;
      const wb = b.x1 - b.x0;
      const centerXb = (b.x0 + b.x1) * 0.5;
      const centerYb = (b.y0 + b.y1) * 0.5;
      const minH = Math.min(ha, hb);
      const maxH = Math.max(ha, hb);

      // 1. Durum: Aynı yatay satırda yan yana bölünmüş parçalar ("FIRST MURD" + "ER.")
      // Not: Aralarındaki boşluk makul bir kelime/harf boşluğu kadarsa birleştir; iki ayrı balon/sütunsa birleştirme!
      const vOverlap = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
      const hGap = Math.max(a.x0, b.x0) - Math.min(a.x1, b.x1);
      const leftHorizontalLine = a.x0 <= b.x0 ? lines[i] : lines[j];
      const leftHorizontalEndsPunct = /[.!?…]$/.test(leftHorizontalLine.text.trim());
      if (
        vOverlap >= minH * 0.52 &&
        hGap >= -minH * 0.35 &&
        hGap <= maxH * 0.45 &&
        maxH / Math.max(1, minH) <= 1.65 &&
        !(hasIndependentVerticalPartner(i, j) && hasIndependentVerticalPartner(j, i)) &&
        !(leftHorizontalEndsPunct && (hasIndependentVerticalPartner(i, j) || hasIndependentVerticalPartner(j, i))) &&
        (!img || !hasHorizontalBubbleBarrier(img, lines[i], lines[j]))
      ) {
        parent[find(j)] = find(i);
        continue;
      }

      if (b.y0 - a.y1 > maxH * 1.55) {
        if (b.y0 - a.y1 > maxH * 4) break;
        continue;
      }

      // RPG / Sistem tablosu satırlarını ("HEALTH: 100", "MAGIC: 0" vb.) dikeyde birleştirme!
      const isStatB = isRpgStatLine(lines[j].text);
      if (isStatA || isStatB) continue;

      // Kutu çerçevesinin üst sınırında duran başlıkları ("SYSTEM PROMPT", "QUEST INFO" vb.)
      // altındaki uzun/geniş gövde paragrafıyla ("YOU REQUIRE 90 MORE EVOLUTION POINTS BEFORE...") birleştirme;
      // ancak konuşma balonu üst satırlarını ("IF", "SO", "IT JUST" vb.) yanlışlıkla bölme!
      const textA = lines[i].text.trim();
      const textB = lines[j].text.trim();
      const wordsA = textA.split(/\s+/).length;
      const wordsB = textB.split(/\s+/).length;
      const isSystemBoxHeader = (txt: string) =>
        /^(?:SYSTEM(?:\s+PROMPT|\s+NOTICE|\s+MESSAGE|\s+ALERT|\s+WINDOW)?|QUEST(?:\s+INFO|\s+ALERT|\s+NOTICE|\s+UPDATED?)?|NOTICE|WARNING|ALERT|INFO|INFORMATION|NOTIFICATION|TIP|STATUS|PROFILE|STATS|SKILLS?|SKILLS?\s+LIST|INVENTORY|EVOLUTION|ANNOUNCEMENT|CONGRATULATIONS|HINT|OBJECTIVE)\b[:!]?$/i.test(
          txt,
        );
      if (
        ha >= hb * 1.16 &&
        wordsA <= 3 &&
        (wordsB >= 5 || wb >= wa * 1.42) &&
        isSystemBoxHeader(textA)
      ) {
        continue;
      }

      const vGap = Math.max(a.y0, b.y0) - Math.min(a.y1, b.y1);
      const centerYDist = Math.abs(centerYb - centerYa);
      if (vGap > maxH * 1.5 || vGap < -minH * 0.62 || centerYDist < minH * 0.45) continue;

      // İki satır arasında dikeyde başka bir ara satır varsa (ör. 1. satır 2. satırı atlayıp 3. satırla birleşmeye çalışıyorsa) engelle
      let hasIntermediateRow = false;
      for (let m = i + 1; m < j; m += 1) {
        const mb = lines[m].bbox;
        const mCenterY = (mb.y0 + mb.y1) * 0.5;
        if (mCenterY > a.y1 - minH * 0.2 && mCenterY < b.y0 + minH * 0.2) {
          const ovA = Math.min(a.x1, mb.x1) - Math.max(a.x0, mb.x0);
          const ovB = Math.min(b.x1, mb.x1) - Math.max(b.x0, mb.x0);
          if (ovA > 0 || ovB > 0) {
            hasIntermediateRow = true;
            break;
          }
        }
      }
      if (hasIntermediateRow) continue;

      const overlap = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
      const narrow = Math.min(wa, wb);
      const centerDist = Math.abs(centerXa - centerXb);

      // Eğer satırlardan biri iki ayrı yan yana sütunun üstünü kapatan geniş bir başlıksa ("KIM JEONGHYUK"), sütunlarla birleştirme
      const angleDiff = Math.abs((lines[i].angleDeg ?? 0) - (lines[j].angleDeg ?? 0));
      const sameHandwrittenNoteStack =
        angleDiff < 11 &&
        maxH <= 95 &&
        maxH / Math.max(1, minH) <= 1.75 &&
        overlap > narrow * 0.52 &&
        vGap <= minH * 0.65 &&
        (!img || Math.abs(sampleLineCollarLum(img, a) - sampleLineCollarLum(img, b)) < 35);
      if (
        (angleDiff >= 3.8 && !sameHandwrittenNoteStack) ||
        spansSeparateSideBySideColumns(i, j) ||
        spansSeparateSideBySideColumns(j, i) ||
        (img && vGap >= -2 && hasVerticalBubbleBarrier(img, lines[i], lines[j]))
      ) {
        continue;
      }

      // Balon içi ALL-CAPS ana diyalog ile balon kenarı dışında kalan küçük el yazısı yan notların
      // ("Nothing but stuff" / "a part timer~") birleşmesini önle
      const upperA = (textA.match(/[A-Z]/g) || []).length;
      const lowerA = (textA.match(/[a-z]/g) || []).length;
      const upperB = (textB.match(/[A-Z]/g) || []).length;
      const lowerB = (textB.match(/[a-z]/g) || []).length;
      const allCapsA = upperA >= 4 && lowerA === 0;
      const allCapsB = upperB >= 4 && lowerB === 0;
      const mixedHandwritingA = lowerA >= 4 && lowerA >= upperA;
      const mixedHandwritingB = lowerB >= 4 && lowerB >= upperB;
      if (
        ((allCapsA && mixedHandwritingB) || (allCapsB && mixedHandwritingA)) &&
        minH / Math.max(1, maxH) <= 0.82 &&
        (centerDist > maxH * 0.72 || vGap < -minH * 0.15)
      ) {
        continue;
      }

      // 2. Durum: Standart benzer boyutlu balon satırları
      const heightRatio = maxH / Math.max(1, minH);
      if (heightRatio <= 1.65) {
        const aligned =
          (overlap > narrow * 0.35 && centerDist < Math.max(maxH * 2.2, Math.max(wa, wb) * 0.32)) ||
          (overlap > 0 && centerDist < maxH * 1.8);
        if (aligned && vGap <= minH * 1.35) {
          parent[find(j)] = find(i);
          continue;
        }
      }

      // 3. Durum: Aynı balon içindeki vurgulu/büyük satır ("SO" + "WEAK?!", "WHY DID YOU COME UP" + "ALONE?")
      // Yatay merkezleri hizalıysa ve dikey boşluk balon içi satır aralığı kadarsa 2.85x boyuta kadar birleştir
      if (heightRatio <= 2.85) {
        const stronglyAligned =
          (overlap > narrow * 0.36 && centerDist < maxH * 1.55) ||
          (overlap > narrow * 0.6 && centerDist < Math.max(wa, wb) * 0.45);
        if (stronglyAligned && vGap >= -minH * 0.55 && vGap <= maxH * 1.45) {
          parent[find(j)] = find(i);
        }
      }
    }
  }

  const groups = new Map<number, typeof lines>();
  lines.forEach((line, i) => {
    const root = find(i);
    const list = groups.get(root);
    if (list) list.push(line);
    else groups.set(root, [line]);
  });

  const toNormCoord = (val: number, total: number): number =>
    Number(clamp((val / Math.max(1, total)) * 1000, 0, 1000).toFixed(4));

  const bubbles: Array<OcrBubble & { y: number }> = [];
  groups.forEach((group) => {
    // Aynı satırdaki yan yana kutuları soldan sağa, farklı satırları yukarıdan aşağıya sırala
    group.sort((a, b) => {
      const ha = a.bbox.y1 - a.bbox.y0;
      const hb = b.bbox.y1 - b.bbox.y0;
      const wa = a.bbox.x1 - a.bbox.x0;
      const wb = b.bbox.x1 - b.bbox.x0;
      const vOv = Math.min(a.bbox.y1, b.bbox.y1) - Math.max(a.bbox.y0, b.bbox.y0);
      const hOv = Math.min(a.bbox.x1, b.bbox.x1) - Math.max(a.bbox.x0, b.bbox.x0);
      if (vOv >= Math.min(ha, hb) * 0.5 && hOv <= Math.min(wa, wb) * 0.35) {
        return a.bbox.x0 - b.bbox.x0;
      }
      return a.bbox.y0 - b.bbox.y0 || a.bbox.x0 - b.bbox.x0;
    });

    // Yan yana olan parçaları tek satırda birleştir (ör. "FIRST MURD" + "ER." -> "FIRST MURDER.")
    const mergedRows: OcrLine[] = [];
    for (const item of group) {
      const prev = mergedRows[mergedRows.length - 1];
      if (prev) {
        const hp = prev.bbox.y1 - prev.bbox.y0;
        const hi = item.bbox.y1 - item.bbox.y0;
        const wp = prev.bbox.x1 - prev.bbox.x0;
        const wi = item.bbox.x1 - item.bbox.x0;
        const vOv = Math.min(prev.bbox.y1, item.bbox.y1) - Math.max(prev.bbox.y0, item.bbox.y0);
        const hOv = Math.min(prev.bbox.x1, item.bbox.x1) - Math.max(prev.bbox.x0, item.bbox.x0);
        const hGap = item.bbox.x0 - prev.bbox.x1;
        const centerYp = (prev.bbox.y0 + prev.bbox.y1) * 0.5;
        const centerYi = (item.bbox.y0 + item.bbox.y1) * 0.5;
        if (
          vOv >= Math.min(hp, hi) * 0.52 &&
          hOv <= Math.min(wp, wi) * 0.35 &&
          Math.abs(centerYp - centerYi) < Math.min(hp, hi) * 0.45 &&
          hGap >= -Math.min(hp, hi) * 0.4 &&
          hGap <= Math.min(hp, hi) * 0.65 &&
          (!img || !hasHorizontalBubbleBarrier(img, prev, item))
        ) {
          // Çok yakın yan yana parçaysa ("MURD" + "ER.") boşluksuz veya tek boşlukla birleştir
          const joiner = hGap < Math.min(hp, hi) * 0.28 && /^[a-zA-Z]/.test(item.text) && /[a-zA-Z]$/.test(prev.text)
            ? ''
            : ' ';
          prev.text = `${prev.text}${joiner}${item.text}`.trim();
          prev.confidence = Math.max(prev.confidence, item.confidence);
          prev.bbox = {
            x0: Math.min(prev.bbox.x0, item.bbox.x0),
            y0: Math.min(prev.bbox.y0, item.bbox.y0),
            x1: Math.max(prev.bbox.x1, item.bbox.x1),
            y1: Math.max(prev.bbox.y1, item.bbox.y1),
          };
          continue;
        }
      }
      mergedRows.push({
        text: item.text,
        confidence: item.confidence,
        bbox: { ...item.bbox },
        ...(item.angleDeg !== undefined ? { angleDeg: item.angleDeg } : {}),
      });
    }

    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const l of mergedRows) {
      x0 = Math.min(x0, l.bbox.x0);
      y0 = Math.min(y0, l.bbox.y0);
      x1 = Math.max(x1, l.bbox.x1);
      y1 = Math.max(y1, l.bbox.y1);
    }

    const text = mergedRows
      .map((l) => l.text)
      .join(' ')
      .replace(/(\p{L})-[""''`]?\s+(\p{L})/gu, '$1$2')
      .replace(/\s+/g, ' ')
      .trim();

    // Son satırın vurgulu (daha büyük) olup olmadığını hesapla ("ALONE?" gibi)
    let emphasisLastLineScale: number | undefined;
    if (mergedRows.length >= 2) {
      const lastRow = mergedRows[mergedRows.length - 1];
      const lastH = lastRow.bbox.y1 - lastRow.bbox.y0;
      const otherHeights = mergedRows.slice(0, -1).map((r) => r.bbox.y1 - r.bbox.y0);
      const avgOtherH = otherHeights.reduce((s, v) => s + v, 0) / otherHeights.length;
      if (avgOtherH > 0 && lastH / avgOtherH >= 1.32) {
        emphasisLastLineScale = Number(clamp(lastH / avgOtherH, 1.25, 1.65).toFixed(2));
      }
    }

    const lineBoxes: OcrBubbleLineBox[] = mergedRows.map((r) => ({
      box: [
        toNormCoord(r.bbox.y0, imgHeight),
        toNormCoord(r.bbox.x0, imgWidth),
        toNormCoord(r.bbox.y1, imgHeight),
        toNormCoord(r.bbox.x1, imgWidth),
      ],
      text: r.text,
      confidence: Math.round(r.confidence),
      ...(r.angleDeg !== undefined ? { angleDeg: r.angleDeg } : {}),
    }));

    const box: [number, number, number, number] = [
      toNormCoord(y0, imgHeight),
      toNormCoord(x0, imgWidth),
      toNormCoord(y1, imgHeight),
      toNormCoord(x1, imgWidth),
    ];

    const isTinyCoverCopyrightOrPresentedBy =
      box[2] - box[0] <= 24 &&
      (box[0] >= 890 || box[2] <= 55 || /^presented\s+by\b/i.test(text)) &&
      /^(?:presented\s+by|copyright|©|all\s+rights\s+reserved|monthly\s+young|weekly\s+shonen|kodansha|shueisha)/i.test(
        text,
      );

    if (box[2] > box[0] && box[3] > box[1] && !isTinyCoverCopyrightOrPresentedBy) {
      bubbles.push({
        box,
        text,
        lines: lineBoxes,
        emphasisLastLineScale,
        y: y0,
      });
    }
  });

  // Eğimli telefon ekranı / SMS sohbet arayüzü / sıkışık mikro UI metin kümelerini filtrele
  // (ör. elde tutulan -22° eğimli telefon ekranındaki üst üste yığılmış 7-22px SMS parçaları)
  const microUiSkipIndices = new Set<number>();
  const deTiltedLinePx = (l: OcrBubbleLineBox) => {
    const rawH = ((l.box[2] - l.box[0]) * imgHeight) / 1000;
    const rawW = ((l.box[3] - l.box[1]) * imgWidth) / 1000;
    const rad = (Math.abs(l.angleDeg ?? 0) * Math.PI) / 180;
    return rad >= 0.06 ? Math.max(8, rawH - rawW * Math.sin(rad) * 0.85) : rawH;
  };
  const isMicroClusterBlock = (b: (typeof bubbles)[number]) => {
    const lhList = (b.lines ?? []).map(deTiltedLinePx);
    const maxLinePx =
      lhList.length > 0 ? Math.max(...lhList) : ((b.box[2] - b.box[0]) * imgHeight) / 1000;
    return maxLinePx <= Math.max(25, imgHeight * 0.02);
  };
  const visitedMicro = new Uint8Array(bubbles.length);
  for (let i = 0; i < bubbles.length; i += 1) {
    if (visitedMicro[i] || !isMicroClusterBlock(bubbles[i])) continue;
    const queue = [i];
    const comp: number[] = [];
    visitedMicro[i] = 1;
    while (queue.length > 0) {
      const cur = queue.shift()!;
      comp.push(cur);
      const cb = bubbles[cur].box;
      for (let j = 0; j < bubbles.length; j += 1) {
        if (visitedMicro[j] || !isMicroClusterBlock(bubbles[j])) continue;
        const nb = bubbles[j].box;
        const hDist = Math.max(0, nb[1] - cb[3], cb[1] - nb[3]);
        const vDist = Math.max(0, nb[0] - cb[2], cb[0] - nb[2]);
        if (hDist <= 95 && vDist <= 95) {
          visitedMicro[j] = 1;
          queue.push(j);
        }
      }
    }
    if (comp.length < 4) continue;
    let cy0 = Infinity;
    let cx0 = Infinity;
    let cy1 = -Infinity;
    let cx1 = -Infinity;
    let tiltedCount = 0;
    let overlapPairCount = 0;
    const lineHeights: number[] = [];
    for (const idx of comp) {
      const b = bubbles[idx];
      cy0 = Math.min(cy0, b.box[0]);
      cx0 = Math.min(cx0, b.box[1]);
      cy1 = Math.max(cy1, b.box[2]);
      cx1 = Math.max(cx1, b.box[3]);
      if ((b.lines ?? []).some((l) => Math.abs(l.angleDeg ?? 0) >= 6.5)) {
        tiltedCount += 1;
      }
      for (const l of b.lines ?? []) {
        lineHeights.push(deTiltedLinePx(l));
      }
    }
    for (let a = 0; a < comp.length; a += 1) {
      for (let bIdx = a + 1; bIdx < comp.length; bIdx += 1) {
        const ba = bubbles[comp[a]].box;
        const bb = bubbles[comp[bIdx]].box;
        const iv = Math.min(ba[2], bb[2]) - Math.max(ba[0], bb[0]);
        const ih = Math.min(ba[3], bb[3]) - Math.max(ba[1], bb[1]);
        if (iv > 0 && ih > 0) overlapPairCount += 1;
      }
    }
    lineHeights.sort((a, b) => a - b);
    const medMicroH = lineHeights.length > 0 ? lineHeights[lineHeights.length >> 1] : 99;
    const spanW = cx1 - cx0;
    const spanH = cy1 - cy0;
    if (
      spanW <= 300 &&
      spanH <= 260 &&
      medMicroH <= Math.max(22, imgHeight * 0.018) &&
      (tiltedCount >= 2 || overlapPairCount >= 2)
    ) {
      for (const idx of comp) microUiSkipIndices.add(idx);
    }
  }

  return bubbles
    .filter((_, idx) => !microUiSkipIndices.has(idx))
    .sort((a, b) => a.y - b.y)
    .map(({ box, text, lines: lineBoxes, emphasisLastLineScale }) => ({
      box,
      text,
      lines: lineBoxes,
      ...(emphasisLastLineScale ? { emphasisLastLineScale } : {}),
    }));
};

const CREDIT_LINE_REGEX =
  /(?<![\p{L}\p{N}_])(?:translator|translation|proofreader|proofreading|cleaner|cleaning|redrawer|redraw|typesetter|typesetting|quality\s*checker|editor|raw\s*provider|scanlation|fansub|fansube|kurohana|asurascans|asura\s*scans|reaperscans|reaper\s*scans|flamescans|flame\s*scans|flame[\s-]*chan|reaper[\s-]*chan|asura[\s-]*chan|luminousscans|vortexscans|drakescans|manhuaplus|manhuaus|hivetoons|realmscans|leviathanscans|reset\s*scans|rizz\s*comic|rizz\s*fables|cosmic\s*scans|night\s*scans|void\s*scans|disaster\s*scans|surya\s*scans|templescan|thunderscans|philiascans|arven\s*comics|nex[o0c]*mic|[gc]radex[\s.\-]*(?:tan|tay)trums?|taytrums?|webtoon\s*xyz|kunmanga|manganato|mangakakalot|zinmanga|1stkissmanga|manhwaclub|manhwafreak|tappytoon|toomics|tapas|lezhin|recruiting|discord|patreon|paypal|ko-?fi|join\s+(?:our|us)|support\s+us|read\s+(?:it\s+)?(?:at|on|first)|do\s+not\s+mirror|do\s+not\s+reupload|manga\s*stream|chapter\s*\d+|çevirmen|çeviri|editör|dizgi|temizleme)(?![\p{L}\p{N}_])|\.com\s*mirror\b|^mirror$|^dsns$|(?:^|\s)(?:tl|pr|cl|rd|ts|qc|ktl|tlc)(?:\s*[:\-]\s*|\s+)[a-z0-9_]{2,14}$/iu;
const URL_LINE_REGEX =
  /(?:https?:\/\/|www\.|discord\.gg|\b[a-z0-9-]+\.(?:com|net|org|gg|io|me|to|xyz|club|online|site)\b)/i;
const STRONG_PROMO_REGEX =
  /(?:https?:\/\/|www\.|discord|patreon|paypal|ko-?fi|recruiting|join\s+(?:our|us)|asurascans|asura\s*scans|\b[a-z0-9-]+\.(?:com|net|org|gg|io|me|to|xyz|club|online|site)\b)/i;

/** Satırın jenerik / reklam / filigran içeriği olup olmadığını döndürür. */
export const isCreditOrPromoText = (text: string): boolean => {
  const trimmed = text.trim();
  if (CREDIT_LINE_REGEX.test(trimmed) || URL_LINE_REGEX.test(trimmed)) return true;
  // Ünlüsü olmayan uzun sessiz harf yığını filigranlar ("Dssns", "dsns" vb.)
  const alphaOnly = trimmed.replace(/[^a-zA-Z]/g, '');
  if (
    alphaOnly.length >= 4 &&
    alphaOnly.length <= 14 &&
    alphaOnly.length === trimmed.length &&
    !/[aeiouy]/i.test(alphaOnly) &&
    new Set(alphaOnly.toLowerCase()).size >= 3
  ) {
    return true;
  }
  return false;
};

const hasEnclosedComicSpeechBubble = (
  img: ImageData | undefined,
  bubbles: OcrBubble[],
): boolean => {
  if (!img || bubbles.length === 0) return false;
  const { width, height, data } = img;
  const lumAt = (x: number, y: number): { lum: number; sat: number } => {
    const cx = Math.max(0, Math.min(width - 1, Math.round(x)));
    const cy = Math.max(0, Math.min(height - 1, Math.round(y)));
    const p = (cy * width + cx) * 4;
    const r = data[p];
    const g = data[p + 1];
    const b = data[p + 2];
    const maxC = Math.max(r, g, b);
    const minC = Math.min(r, g, b);
    return {
      lum: 0.299 * r + 0.587 * g + 0.114 * b,
      sat: (maxC - minC) / Math.max(1, maxC),
    };
  };
  for (const b of bubbles) {
    const x0 = (b.box[1] / 1000) * width;
    const y0 = (b.box[0] / 1000) * height;
    const x1 = (b.box[3] / 1000) * width;
    const y1 = (b.box[2] / 1000) * height;
    const bw = x1 - x0;
    const bh = y1 - y0;
    if (bw < 28 || bh < 20) continue;
    const mx = (x0 + x1) * 0.5;
    const my = (y0 + y1) * 0.5;
    const maxRayX = Math.max(bw * 0.55, Math.min(bw * 1.15, 130));
    const maxRayY = Math.max(bh * 0.55, Math.min(bh * 1.15, 130));
    let enclosedDirs = 0;
    const dirs: Array<[number, number, number]> = [
      [-1, 0, maxRayX],
      [1, 0, maxRayX],
      [0, -1, maxRayY],
      [0, 1, maxRayY],
    ];
    for (const [dx, dy, maxDist] of dirs) {
      let lightSteps = 0;
      let hitWall = false;
      const startOffset = dx !== 0 ? bw * 0.5 + 2 : bh * 0.5 + 2;
      for (let d = startOffset; d <= startOffset + maxDist; d += 2) {
        const px = mx + dx * d;
        const py = my + dy * d;
        if (px < 1 || px >= width - 1 || py < 1 || py >= height - 1) break;
        const { lum, sat } = lumAt(px, py);
        if (lum >= 220 && sat < 0.15) {
          lightSteps += 1;
        } else if (lum <= 95 && sat < 0.35) {
          if (lightSteps >= 3) hitWall = true;
          break;
        }
      }
      if (hitWall) enclosedDirs += 1;
    }
    if (enclosedDirs >= 3) return true;
  }
  return false;
};

/**
 * Sayfa çoğunlukla jenerik, ekip listesi, reklam, duyuru veya bağımsız seri/cilt kapak görseli içeriyorsa true döner.
 * Bu sayfalar çeviriye ve inpaint'e hiç sokulmaz.
 */
export const isCreditsOrPromoPage = (
  bubbles: OcrBubble[],
  rawLines?: OcrLine[],
  imgWidth?: number,
  imgHeight?: number,
  ocrImg?: ImageData,
): boolean => {
  // Bağımsız Manga / Cilt Kapak İllüstrasyonu Kontrolü (örn. şömiz/cilt kapağı, konuşma balonu olmayan poster kapağı):
  // Kapak künyesi / telif / "presented by" / yazar imzası taşıyan ve kapalı konuşma balonu içermeyen kapaklar atlanır.
  if (rawLines && rawLines.length > 0 && imgWidth && imgHeight && !hasEnclosedComicSpeechBubble(ocrImg, bubbles)) {
    const rawTexts = rawLines.map((l) => l.text.trim());
    const hasPresentedByOrCopyright = rawTexts.some((t) =>
      /\bpresented\s+by\b|©|\bcopyright\b|\ball\s+rights\s+reserved\b/i.test(t),
    );
    const hasPublisherOrMag = rawTexts.some((t) =>
      /\b(?:kodansha|shueisha|shogakukan|hakusensha|kadokawa|monthly\s+young|weekly\s+shonen|young\s+magazine|isbn)\b/i.test(
        t,
      ),
    );
    const hasVolumeBadge = rawTexts.some((t) => /^(?:vol\.?\s*0?\d{1,3}|volume\s+0?\d{1,3}|0\d)$/i.test(t));
    const isLandscapeCoverSpread = imgWidth >= imgHeight * 1.15;
    const hasBottomEdgeBlurbOrSubtitle = bubbles.some(
      (b) => b.box[2] >= 960 && b.box[1] <= 860 && b.text.trim().length >= 12,
    );
    const hasBottomRightAuthorBadge = bubbles.some(
      (b) =>
        b.box[0] >= 840 &&
        b.box[1] >= 750 &&
        /^[A-Z0-9.\-]{2,12}$/.test(b.text.trim()),
    );
    const hasStylizedCoverLogoToken = bubbles.some((b) =>
      /^[A-Z]{1,3}-[A-Z]{2,}[a-z]{3,}$/.test(b.text.trim()),
    );
    if (
      (hasPresentedByOrCopyright && (isLandscapeCoverSpread || hasPublisherOrMag || hasVolumeBadge)) ||
      (hasPublisherOrMag && hasVolumeBadge && isLandscapeCoverSpread) ||
      (isLandscapeCoverSpread &&
        bubbles.length >= 4 &&
        hasBottomEdgeBlurbOrSubtitle &&
        (hasBottomRightAuthorBadge || hasStylizedCoverLogoToken))
    ) {
      return true;
    }
  }

  if (bubbles.length === 0) return false;
  const promo = bubbles.filter((b) => isCreditOrPromoText(b.text)).length;
  if (promo === 0) return false;

  // 1. Sayfadaki tüm bloklar jenerik/reklam/link ise (örn. sadece "Join our Discord: discord.gg/...")
  if (promo === bubbles.length) return true;

  // 2. 1-2 bloklu görselde metinlerin tamamı reklam/link ise
  if (bubbles.length <= 2 && bubbles.every((b) => isCreditOrPromoText(b.text))) {
    return true;
  }

  // 3. AsuraScans vb. gerçek jenerik / ekip künyesi sayfası:
  // Sayfa güçlü bir grup adı/linki (STRONG_PROMO_REGEX) içermeli VE en az 2 farklı çevirmen/editör/dizgi künye satırı (TL, PR, Editor, Cleaner vb.) bulunmalı
  const creditRolesCount = bubbles.filter((b) => CREDIT_LINE_REGEX.test(b.text)).length;
  if (
    creditRolesCount >= 2 &&
    bubbles.some((b) => STRONG_PROMO_REGEX.test(b.text)) &&
    creditRolesCount / bubbles.length >= 0.45
  ) {
    return true;
  }

  return false;
};
