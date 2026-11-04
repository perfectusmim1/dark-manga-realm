/**
 * PaddleOCR (PP-OCRv3/v4 ONNX) tabanlı yerel OCR çekirdeği.
 * DOM / tarayıcı API'si veya import içermez: aynı kod tarayıcıda (onnxruntime-web) ve
 * Node test düzeneğinde (onnxruntime-node) birebir çalışır.
 * Görseller hiçbir uzak API'ye gönderilmez; tüm çıkarım istemcide yapılır.
 */

export interface RgbaImage {
  data: Uint8ClampedArray | Uint8Array;
  width: number;
  height: number;
}

export interface OcrLine {
  text: string;
  /** 0-100 arası tanıma güveni */
  confidence: number;
  bbox: { x0: number; y0: number; x1: number; y1: number };
}

export interface OcrBubble {
  box: [number, number, number, number];
  text: string;
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
const DET_BOX_THRESH = 0.6;
const DET_UNCLIP_RATIO = 1.6;
const REC_H = 48;
const REC_MAX_W = 1600;
const MIN_LINE_CONFIDENCE = 80;

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

const checkAbort = (signal?: AbortSignal) => {
  if (signal?.aborted) throw new DOMException('İptal edildi', 'AbortError');
};

/**
 * Kaynak RGBA görüntüden bilineer örnekleme ile doğrudan normalize edilmiş BGR NCHW tensörü üretir
 * (PaddleOCR modelleri cv2 BGR sırasıyla eğitilmiştir).
 */
const sampleToTensor = (
  img: RgbaImage,
  sx0: number,
  sy0: number,
  sw: number,
  sh: number,
  tw: number,
  th: number,
  mean: number[],
  std: number[],
  out: Float32Array,
  outW: number,
): void => {
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
        // c: 0=R,1=G,2=B -> BGR düzlemleri (B=0, G=1, R=2)
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
  score: number;
}

/** DBNet olasılık haritasından eksen hizalı metin satırı kutuları çıkarır (8-komşuluk bileşenleri). */
const extractDetBoxes = (prob: Float32Array, w: number, h: number): DetBox[] => {
  const labels = new Int32Array(w * h);
  const queue = new Int32Array(w * h);
  const boxes: DetBox[] = [];
  let cur = 0;
  for (let start = 0; start < w * h; start += 1) {
    if (labels[start] !== 0 || prob[start] <= DET_BIN_THRESH) continue;
    cur += 1;
    labels[start] = cur;
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    let minX = w;
    let maxX = 0;
    let minY = h;
    let maxY = 0;
    let sum = 0;
    let count = 0;
    while (head < tail) {
      const p = queue[head++];
      const py = (p / w) | 0;
      const px = p - py * w;
      sum += prob[p];
      count += 1;
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
            labels[n] = cur;
            queue[tail++] = n;
          }
        }
      }
    }
    const bw = maxX - minX + 1;
    const bh = maxY - minY + 1;
    if (Math.min(bw, bh) < 3) continue;
    const score = sum / count;
    if (score < DET_BOX_THRESH) continue;
    // DB unclip: d = alan * oran / çevre
    const d = (bw * bh * DET_UNCLIP_RATIO) / (2 * (bw + bh));
    boxes.push({ x0: minX - d, y0: minY - d, x1: maxX + 1 + d, y1: maxY + 1 + d, score });
  }
  return boxes;
};

const ctcDecode = (
  data: Float32Array,
  steps: number,
  classes: number,
  dictionary: string[],
): { text: string; confidence: number } => {
  let text = '';
  let probSum = 0;
  let emitted = 0;
  let prev = -1;
  for (let t = 0; t < steps; t += 1) {
    const off = t * classes;
    let best = 0;
    let bestP = data[off];
    for (let k = 1; k < classes; k += 1) {
      const v = data[off + k];
      if (v > bestP) {
        bestP = v;
        best = k;
      }
    }
    if (best !== 0 && best !== prev) {
      text += dictionary[best - 1] ?? '';
      probSum += bestP;
      emitted += 1;
    }
    prev = best;
  }
  return { text, confidence: emitted > 0 ? (probSum / emitted) * 100 : 0 };
};

const recognizeBox = async (
  img: RgbaImage,
  box: { x0: number; y0: number; x1: number; y1: number },
  runners: OcrRunners,
): Promise<{ text: string; confidence: number }> => {
  const cw = box.x1 - box.x0;
  const ch = box.y1 - box.y0;
  const tw = clamp(Math.round((REC_H * cw) / ch), 16, REC_MAX_W);
  const outW = Math.ceil(tw / 8) * 8;
  const input = new Float32Array(3 * REC_H * outW);
  sampleToTensor(img, box.x0, box.y0, cw, ch, tw, REC_H, [0.5, 0.5, 0.5], [0.5, 0.5, 0.5], input, outW);
  const out = await runners.rec(input, [1, 3, REC_H, outW]);
  const steps = out.dims[1];
  const classes = out.dims[2];
  return ctcDecode(out.data, steps, classes, runners.dictionary);
};

const iou = (a: OcrLine['bbox'], b: OcrLine['bbox']) => {
  const ix = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
  const iy = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
  if (ix <= 0 || iy <= 0) return 0;
  const inter = ix * iy;
  const areaA = (a.x1 - a.x0) * (a.y1 - a.y0);
  const areaB = (b.x1 - b.x0) * (b.y1 - b.y0);
  return inter / Math.min(areaA, areaB);
};

/**
 * Tam sayfayı (uzun webtoon şeritleri dahil) örtüşmeli dikey dilimlerle tarar.
 * Dilim kenarında kesilen satırlar atılır; aynı satır komşu dilimde tam haliyle bulunur.
 */
export const runPaddleOcr = async (
  img: RgbaImage,
  runners: OcrRunners,
  signal?: AbortSignal,
): Promise<OcrLine[]> => {
  const { width, height } = img;
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
    sampleToTensor(img, 0, sy, width, srcH, detW, detH, DET_MEAN, DET_STD, input, detW);
    const out = await runners.det(input, [1, 3, detH, detW]);
    checkAbort(signal);
    const mapH = out.dims[2];
    const mapW = out.dims[3];
    const fx = width / mapW;
    const fy = srcH / mapH;

    for (const b of extractDetBoxes(out.data, mapW, mapH)) {
      // Dilim sınırına değen (yarım kesilmiş) satırları at; örtüşme bölgesindeki komşu dilim onu tam görür.
      if (!isLast && b.y1 >= mapH - 2) continue;
      if (!isFirst && b.y0 <= 1) continue;
      const box = {
        x0: clamp(b.x0 * fx, 0, width),
        x1: clamp(b.x1 * fx, 0, width),
        y0: clamp(b.y0 * fy + sy, 0, height),
        y1: clamp(b.y1 * fy + sy, 0, height),
      };
      const bw = box.x1 - box.x0;
      const bh = box.y1 - box.y0;
      if (bw < 6 || bh < 6) continue;
      // Dikey dizilmiş metin (SFX / Japonca) yatay tanıyıcıya uygun değil
      if (bh > bw * 2.5) continue;
      const rec = await recognizeBox(img, box, runners);
      const text = rec.text.trim();
      if (!text) continue;
      lines.push({
        text,
        confidence: Math.round(rec.confidence),
        bbox: {
          x0: Math.round(box.x0),
          y0: Math.round(box.y0),
          x1: Math.round(box.x1),
          y1: Math.round(box.y1),
        },
      });
    }
    if (isLast) break;
  }

  // Örtüşme bölgesinde iki kez görülen satırlardan güveni yüksek olanı tut
  const sorted = [...lines].sort((a, b) => b.confidence - a.confidence);
  const kept: OcrLine[] = [];
  for (const line of sorted) {
    if (!kept.some((k) => iou(k.bbox, line.bbox) > 0.6)) kept.push(line);
  }
  return kept.sort((a, b) => a.bbox.y0 - b.bbox.y0 || a.bbox.x0 - b.bbox.x0);
};

/** OCR gürültüsünü (çizimden okunan sembol yığınları, düşük güvenli parçalar) eler. */
export const isUsableOcrLine = (line: OcrLine, minConfidence = MIN_LINE_CONFIDENCE): boolean => {
  const text = line.text.trim();
  if (line.confidence < minConfidence) return false;
  const letters = text.match(/\p{L}/gu)?.length ?? 0;
  const digits = text.match(/\p{N}/gu)?.length ?? 0;
  const junk = text.match(/[^\p{L}\p{N}\s.,!?'"“”‘’…:;()\-–—~&%+*]/gu)?.length ?? 0;
  if (letters === 0) return false;
  if (letters < 2 && !/^(?:I|A|O)[!?.…,]*$/i.test(text)) return false;
  // Sembol oranı yüksek satırlar (ör. "| 7 A - _ =", "| 2 7 27") çizim gürültüsüdür
  if (junk / Math.max(1, letters + digits + junk) > 0.25) return false;
  // Tek harf dizileri ("A | J 7") gerçek cümle değildir
  const words = text.split(/\s+/).filter((w) => /\p{L}/u.test(w));
  if (words.length >= 3 && words.every((w) => w.replace(/[^\p{L}]/gu, '').length <= 1)) return false;
  return true;
};

/** Baştaki/sondaki balon kenarı artıklarını ("|", "'", "\\" vb.) temizler. */
export const cleanOcrText = (text: string): string => {
  const tokens = text.replace(/\s+/g, ' ').trim().split(' ');
  const isJunkToken = (tok: string) =>
    !/[\p{L}\p{N}]/u.test(tok) && !/^[.…!?]+$/.test(tok);
  while (tokens.length > 0 && isJunkToken(tokens[0])) tokens.shift();
  while (tokens.length > 0 && isJunkToken(tokens[tokens.length - 1])) tokens.pop();
  return tokens
    .join(' ')
    .replace(/^[|\\/_=~^`]+/u, '')
    .replace(/[|\\/_=~^`]+$/u, '')
    .trim();
};

/**
 * Satırları balonlara gruplar. İki satır yalnızca benzer yazı boyutunda, dikeyde yakın ve
 * yatayda örtüşüyorsa aynı balona girer; böylece çevirmen notları ve komşu balonlar birleşmez.
 */
export const groupOcrLinesIntoBubbles = (
  rawLines: OcrLine[],
  imgWidth: number,
  imgHeight: number,
): OcrBubble[] => {
  const lines = rawLines
    .map((l) => ({ ...l, text: cleanOcrText(l.text) }))
    .filter((l) => l.text.length > 0 && isUsableOcrLine(l))
    .sort((a, b) => a.bbox.y0 - b.bbox.y0);
  if (lines.length === 0) return [];

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
    for (let j = i + 1; j < lines.length; j += 1) {
      const b = lines[j].bbox;
      const hb = b.y1 - b.y0;
      const minH = Math.min(ha, hb);
      const maxH = Math.max(ha, hb);
      if (b.y0 - a.y1 > maxH * 1.2) {
        // y0'a göre sıralı; ama a'dan daha alta uzanan uzun bir satır olabilir, devam et
        if (b.y0 - a.y1 > maxH * 4) break;
        continue;
      }
      if (maxH / minH > 1.55) continue;
      const vGap = Math.max(a.y0, b.y0) - Math.min(a.y1, b.y1);
      if (vGap > minH * 1.1) continue;
      const overlap = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
      const narrow = Math.min(a.x1 - a.x0, b.x1 - b.x0);
      const centerDist = Math.abs((a.x0 + a.x1) / 2 - (b.x0 + b.x1) / 2);
      const aligned = overlap > narrow * 0.35 || (overlap > 0 && centerDist < maxH * 2);
      if (!aligned) continue;
      parent[find(j)] = find(i);
    }
  }

  const groups = new Map<number, typeof lines>();
  lines.forEach((line, i) => {
    const root = find(i);
    const list = groups.get(root);
    if (list) list.push(line);
    else groups.set(root, [line]);
  });

  const bubbles: Array<OcrBubble & { y: number }> = [];
  groups.forEach((group) => {
    group.sort((a, b) => a.bbox.y0 - b.bbox.y0 || a.bbox.x0 - b.bbox.x0);
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const l of group) {
      x0 = Math.min(x0, l.bbox.x0);
      y0 = Math.min(y0, l.bbox.y0);
      x1 = Math.max(x1, l.bbox.x1);
      y1 = Math.max(y1, l.bbox.y1);
    }
    const text = group
      .map((l) => l.text)
      .join(' ')
      .replace(/(\p{L})- (\p{L})/gu, '$1$2')
      .replace(/\s+/g, ' ')
      .trim();
    const box: [number, number, number, number] = [
      clamp(Math.round((y0 / imgHeight) * 1000), 0, 1000),
      clamp(Math.round((x0 / imgWidth) * 1000), 0, 1000),
      clamp(Math.round((y1 / imgHeight) * 1000), 0, 1000),
      clamp(Math.round((x1 / imgWidth) * 1000), 0, 1000),
    ];
    if (box[2] > box[0] && box[3] > box[1]) bubbles.push({ box, text, y: y0 });
  });

  return bubbles.sort((a, b) => a.y - b.y).map(({ box, text }) => ({ box, text }));
};

const CREDIT_LINE_REGEX =
  /\b(?:translator|translation|proofreader|proofreading|cleaner|cleaning|redrawer|redraw|typesetter|typesetting|quality\s*checker|editor|raw\s*provider|scanlation|recruiting|discord|patreon|paypal|ko-?fi|join\s+(?:our|us)|support\s+us|read\s+(?:it\s+)?(?:at|on|first)|chapter\s*\d+|çevirmen|çeviri|editör|dizgi|temizleme)\b/i;
const URL_LINE_REGEX =
  /(?:https?:\/\/|www\.|discord\.gg|\b[a-z0-9-]+\.(?:com|net|org|gg|io|me|to|xyz|club|online|site)\b)/i;
const STRONG_PROMO_REGEX =
  /(?:https?:\/\/|www\.|discord|patreon|paypal|ko-?fi|recruiting|join\s+(?:our|us)|\b[a-z0-9-]+\.(?:com|net|org|gg|io|me|to|xyz|club|online|site)\b)/i;

/** Satırın jenerik / reklam / filigran içeriği olup olmadığını döndürür. */
export const isCreditOrPromoText = (text: string): boolean =>
  CREDIT_LINE_REGEX.test(text) || URL_LINE_REGEX.test(text);

/**
 * Sayfa çoğunlukla jenerik, ekip listesi, reklam veya duyuru içeriyorsa true döner.
 * Bu sayfalar çeviriye ve inpaint'e hiç sokulmaz.
 */
export const isCreditsOrPromoPage = (bubbles: OcrBubble[]): boolean => {
  if (bubbles.length === 0) return false;
  const promo = bubbles.filter((b) => isCreditOrPromoText(b.text)).length;
  if (promo === 0) return false;
  // Tek bloklu duyuru/reklam görselleri (ör. "Join our Discord...")
  if (bubbles.length <= 2) return bubbles.some((b) => STRONG_PROMO_REGEX.test(b.text));
  return promo >= 2 && promo / bubbles.length >= 0.34;
};
