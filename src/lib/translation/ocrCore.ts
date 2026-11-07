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
}

export interface OcrBubble {
  /** [ymin, xmin, ymax, xmax] 0..1000 normalize */
  box: [number, number, number, number];
  text: string;
  /** Balonu oluşturan alt satırların normalize kutuları */
  lines?: OcrBubbleLineBox[];
  /** Son satır vurgulu/büyük yazılmışsa ("ALONE?" gibi) büyüklük çarpanı */
  emphasisLastLineScale?: number;
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
const DET_BOX_THRESH = 0.58;
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

    // DBNet küçültülmüş çekirdeğini orijinal metin sınırına genişlet (unclip)
    // Kalın konturlu/stilize SFX harflerinin sağ/sol uçlarının kesilmemesi için yatayda ek tolerans
    const d = (bw * bh * DET_UNCLIP_RATIO) / (2 * (bw + bh));
    const dx = Math.max(d * 1.18, bh * 0.28);
    const dy = Math.max(d * 0.95, bh * 0.18);
    boxes.push({
      x0: clamp(minX - dx, 0, w),
      y0: clamp(minY - dy, 0, h),
      x1: clamp(maxX + 1 + dx, 0, w),
      y1: clamp(maxY + 1 + dy, 0, h),
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

const recognizeBox = async (
  img: OcrImageBuffer,
  box: DetBox,
  runners: OcrRunners,
): Promise<{ text: string; confidence: number }> => {
  const cw = box.x1 - box.x0;
  const ch = box.y1 - box.y0;
  if (cw < 4 || ch < 4) return { text: '', confidence: 0 };
  const tw = clamp(Math.round((REC_H * cw) / ch), 16, REC_MAX_W);
  const outW = Math.ceil(tw / 8) * 8;
  const input = new Float32Array(3 * REC_H * outW);
  sampleToTensor(img, box.x0, box.y0, cw, ch, tw, REC_H, outW, [0.5, 0.5, 0.5], [0.5, 0.5, 0.5], input);
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
  return inter / Math.max(1, areaA + areaB - inter);
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
      const box = {
        x0: clamp(b.x0 * fx, 0, width),
        y0: clamp(b.y0 * fy + sy, 0, height),
        x1: clamp(b.x1 * fx, 0, width),
        y1: clamp(b.y1 * fy + sy, 0, height),
      };
      const bw = box.x1 - box.x0;
      const bh = box.y1 - box.y0;
      if (bw < 10 || bh < 8 || bh > bw * 5) continue;

      checkAbort(signal);
      const rec = await recognizeBox(img, box, runners);
      const text = rec.text.trim();
      // 48+ güvenli parçaları da tut; aynı satırdaki veya aynı balon içindeki yüksek güvenli satırların devamıysa kurtarılacak
      if (!text || rec.confidence < 48) continue;
      lines.push({
        text,
        confidence: rec.confidence,
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

  // Dilim örtüşmelerinden gelen çift kutuları IoU ile tekilleştir
  const sorted = [...lines].sort((a, b) => b.confidence - a.confidence);
  const kept: OcrLine[] = [];
  for (const line of sorted) {
    if (kept.some((k) => iou(k.bbox, line.bbox) > 0.45)) continue;
    kept.push(line);
  }
  return kept;
};

/**
 * Tek kelimelik kısa anlamlı İngilizce ünlem/emir/diyalog kelimeleri ("NO", "GO", "UP", "SO" vb.).
 * Bu kelimeler büyük/stilize yazıldığında bile düşük güvenle elenmemelidir.
 */
const SHORT_MEANINGFUL_WORD_REGEX =
  /^(?:no|yes|go|so|up|in|on|ok|hi|me|us|we|he|do|to|or|if|my|by|am|is|it|at|be|oh|ah|why|who|how|now|run|die|out|off|get|let|see|say|can|not|all|one|two|too|bad|new|old|big|end|lie|cry|try|fly|sky|son|mom|dad|bro|sis|sir|god|war|sin|red|hit|cut)[!?.…,:;'"~-]*$/i;

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
    /^[a-zA-Z0-9]+(?:[\s.,!?'"“”‘’…:;()\-–—~]+[a-zA-Z0-9]+)*[\s.,!?'"“”‘’…:;()\-–—~]*$/.test(
      stripped || text,
    );

  const effectiveMinConf =
    isShortMeaningful || isCleanText ? Math.min(minConfidence, 58) : minConfidence;

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

/** Baştaki/sondaki balon kenarı artıklarını ("|", "'", "\\" vb.) ve ASCII sözlük kaynaklı İspanyolca "¿" -> "C" okumalarını temizler. */
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
  'clatter', 'crash', 'crack', 'crackle', 'thud', 'thump', 'thwack', 'wham',
  'whack', 'slam', 'smack', 'smash', 'pow', 'poof', 'bonk', 'boing', 'bong',
  'ding', 'dong', 'kring', 'ting', 'plink', 'plop', 'splat', 'sploosh', 'squelch',
  'squish', 'thwip', 'twang', 'zing', 'zap', 'zzt', 'zzzt', 'bzz', 'bzzt', 'vroom',
  'screech', 'skrrt',
  // Rüzgar / Kesme / Hareket
  'swoosh', 'whoosh', 'swish', 'shing', 'shwing', 'schwing', 'fwip', 'fwoosh',
  'whir', 'whirr', 'rustle', 'patter', 'stomp',
  // Titreme / Çevre / Hayvan / Kalp atışı
  'rumble', 'grumble', 'rattle', 'creak', 'sizzle', 'fizz', 'glug', 'gulp',
  'slurp', 'munch', 'chomp', 'woof', 'meow', 'purr', 'grr', 'grrr',
  'badump', 'badum', 'lubdub', 'doki', 'dokidoki',
  // Nefes / Gülme / Ses efektleri
  'wheeze', 'sniffle', 'achoo', 'hic', 'zzz', 'bwahaha', 'muahaha', 'mwahaha',
  'kekeke', 'kukuku',
  // Korece / Japonca romanize saf ses efektleri
  'kwang', 'kwaang', 'kung', 'kuung', 'dugeun', 'dukgeun', 'jjeoreong', 'puk',
  'peok', 'ssuk', 'geuk', 'kkeuk', 'heok', 'heuk', 'deolkeok', 'chirik', 'sarak',
  'ttuk', 'jjak', 'gogo', 'gogogo', 'menacing',
]);

/** Tek başına anlamlı kelime olabilecek ama 2-3 kez arka arkaya tekrarlandığında ses efekti olan kelimeler ("TAP TAP TAP", "STEP STEP", "DRIP DRIP", "CLAP CLAP") */
const REPEATED_ONLY_SFX_STEMS = new Set([
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

/**
 * Satırları balonlara gruplar.
 * - Aynı yatay hizada bölünmüş kelimeleri ("FIRST MURD" + "ER.") düşük güvenli parça kurtarma ile birleştirir.
 * - Aynı konuşma balonunun içindeki vurgulu/büyük alt satırları ("WHY DID YOU COME UP" + "ALONE?")
 *   boyut oranı 2.85 katına kadar olsa bile aynı balona bağlar.
 */
export const groupOcrLinesIntoBubbles = (
  rawLines: OcrLine[],
  imgWidth: number,
  imgHeight: number,
): OcrBubble[] => {
  const cleanedAll = rawLines
    .map((l) => ({ ...l, text: cleanOcrText(l.text) }))
    .filter((l) => l.text.length > 0);

  // Yüksek güvenli satırları seç
  const strongLines = cleanedAll.filter((l) => isUsableOcrLine(l, MIN_LINE_CONFIDENCE));

  // 1) Aynı yatay satırda (baseline) yüksek güvenli bir satırın hemen sağında/solunda kalan parçaları ("ER." gibi)
  // 2) Veya aynı konuşma balonu sütununda yüksek güvenli bir satırın hemen üstünde/altında kalan temiz satırları ("Esta", "Ocultara el sol, que" gibi) kurtar
  const rescuedLines = cleanedAll.filter((cand) => {
    if (isUsableOcrLine(cand, MIN_LINE_CONFIDENCE)) return false;
    if (cand.confidence < 48) return false;
    const letters = cand.text.match(/\p{L}/gu)?.length ?? 0;
    const junk = cand.text.match(/[^\p{L}\p{N}\s.,!?'"“”‘’…:;()\-–—~&%+*]/gu)?.length ?? 0;
    if (letters < 1) return false;
    const cb = cand.bbox;
    const ch = cb.y1 - cb.y0;
    const cw = cb.x1 - cb.x0;
    const centerXc = (cb.x0 + cb.x1) * 0.5;

    return strongLines.some((s) => {
      const sb = s.bbox;
      const sh = sb.y1 - sb.y0;
      const sw = sb.x1 - sb.x0;
      const centerXs = (sb.x0 + sb.x1) * 0.5;
      const minH = Math.min(ch, sh);
      const maxH = Math.max(ch, sh);
      if (maxH / Math.max(1, minH) > 1.85) return false;

      // Yatay komşu ("FIRST MURD" + "ER.")
      const vOverlap = Math.min(cb.y1, sb.y1) - Math.max(cb.y0, sb.y0);
      const hGap = Math.max(cb.x0, sb.x0) - Math.min(cb.x1, sb.x1);
      if (vOverlap >= minH * 0.5 && hGap >= -minH * 0.4 && hGap <= maxH * 1.65) {
        return true;
      }

      // Dikey balon içi komşu ("Esta" + "BEBIDA SABE" vb.)
      if (letters >= 2 && junk === 0 && cand.confidence >= 50) {
        const vGap = Math.max(cb.y0, sb.y0) - Math.min(cb.y1, sb.y1);
        const hOverlap = Math.min(cb.x1, sb.x1) - Math.max(cb.x0, sb.x0);
        const narrow = Math.min(cw, sw);
        const centerDist = Math.abs(centerXc - centerXs);
        if (
          vGap >= -minH * 0.25 &&
          vGap <= maxH * 1.15 &&
          hOverlap > narrow * 0.45 &&
          centerDist < maxH * 1.65
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

    for (let j = i + 1; j < lines.length; j += 1) {
      const b = lines[j].bbox;
      const hb = b.y1 - b.y0;
      const wb = b.x1 - b.x0;
      const centerXb = (b.x0 + b.x1) * 0.5;
      const minH = Math.min(ha, hb);
      const maxH = Math.max(ha, hb);

      // 1. Durum: Aynı yatay satırda yan yana bölünmüş parçalar ("FIRST MURD" + "ER.")
      // Not: Aralarındaki boşluk makul bir kelime/harf boşluğu kadarsa birleştir; iki ayrı sütunsa ("REPARTIDOR" vs "31 ANOS") birleştirme!
      const vOverlap = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
      const hGap = Math.max(a.x0, b.x0) - Math.min(a.x1, b.x1);
      if (
        vOverlap >= minH * 0.52 &&
        hGap >= -minH * 0.35 &&
        hGap <= maxH * 0.62 &&
        maxH / Math.max(1, minH) <= 1.65
      ) {
        parent[find(j)] = find(i);
        continue;
      }

      if (b.y0 - a.y1 > maxH * 1.35) {
        if (b.y0 - a.y1 > maxH * 4) break;
        continue;
      }

      const vGap = Math.max(a.y0, b.y0) - Math.min(a.y1, b.y1);
      if (vGap > maxH * 1.15) continue;

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

      // Eğer satırlardan biri iki ayrı yan yana sütunun üstünü kapatan geniş bir başlıksa ("KIM JEONGHYUK"), sütunlarla birleştirme
      if (
        spansSeparateSideBySideColumns(i, j) ||
        spansSeparateSideBySideColumns(j, i)
      ) {
        continue;
      }

      const overlap = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
      const narrow = Math.min(wa, wb);
      const centerDist = Math.abs(centerXa - centerXb);

      // 2. Durum: Standart benzer boyutlu balon satırları
      const heightRatio = maxH / Math.max(1, minH);
      if (heightRatio <= 1.65) {
        const aligned =
          (overlap > narrow * 0.35 && centerDist < Math.max(maxH * 2.2, Math.max(wa, wb) * 0.32)) ||
          (overlap > 0 && centerDist < maxH * 1.8);
        if (aligned && vGap <= minH * 1.15) {
          parent[find(j)] = find(i);
          continue;
        }
      }

      // 3. Durum: Aynı balon içindeki vurgulu/büyük satır ("WHY DID YOU COME UP" + "ALONE?")
      // Yatay merkezleri hizalıysa ve dikey boşluk balon içi satır aralığı kadarsa 2.85x boyuta kadar birleştir
      if (heightRatio <= 2.85) {
        const stronglyAligned =
          (overlap > narrow * 0.48 && centerDist < maxH * 1.35) ||
          (overlap > narrow * 0.65 && centerDist < Math.max(wa, wb) * 0.42);
        if (stronglyAligned && vGap >= -minH * 0.25 && vGap <= minH * 1.45) {
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

  const bubbles: Array<OcrBubble & { y: number }> = [];
  groups.forEach((group) => {
    // Aynı satırdaki yan yana kutuları soldan sağa, farklı satırları yukarıdan aşağıya sırala
    group.sort((a, b) => {
      const ha = a.bbox.y1 - a.bbox.y0;
      const hb = b.bbox.y1 - b.bbox.y0;
      const vOv = Math.min(a.bbox.y1, b.bbox.y1) - Math.max(a.bbox.y0, b.bbox.y0);
      if (vOv >= Math.min(ha, hb) * 0.5) {
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
        const vOv = Math.min(prev.bbox.y1, item.bbox.y1) - Math.max(prev.bbox.y0, item.bbox.y0);
        const hGap = item.bbox.x0 - prev.bbox.x1;
        if (vOv >= Math.min(hp, hi) * 0.5 && hGap >= -Math.min(hp, hi) * 0.4) {
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
      .replace(/(\p{L})- (\p{L})/gu, '$1$2')
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
        clamp(Math.round((r.bbox.y0 / imgHeight) * 1000), 0, 1000),
        clamp(Math.round((r.bbox.x0 / imgWidth) * 1000), 0, 1000),
        clamp(Math.round((r.bbox.y1 / imgHeight) * 1000), 0, 1000),
        clamp(Math.round((r.bbox.x1 / imgWidth) * 1000), 0, 1000),
      ],
      text: r.text,
      confidence: Math.round(r.confidence),
    }));

    const box: [number, number, number, number] = [
      clamp(Math.round((y0 / imgHeight) * 1000), 0, 1000),
      clamp(Math.round((x0 / imgWidth) * 1000), 0, 1000),
      clamp(Math.round((y1 / imgHeight) * 1000), 0, 1000),
      clamp(Math.round((x1 / imgWidth) * 1000), 0, 1000),
    ];

    if (box[2] > box[0] && box[3] > box[1]) {
      bubbles.push({
        box,
        text,
        lines: lineBoxes,
        emphasisLastLineScale,
        y: y0,
      });
    }
  });

  return bubbles
    .sort((a, b) => a.y - b.y)
    .map(({ box, text, lines: lineBoxes, emphasisLastLineScale }) => ({
      box,
      text,
      lines: lineBoxes,
      ...(emphasisLastLineScale ? { emphasisLastLineScale } : {}),
    }));
};

const CREDIT_LINE_REGEX =
  /\b(?:translator|translation|proofreader|proofreading|cleaner|cleaning|redrawer|redraw|typesetter|typesetting|quality\s*checker|editor|raw\s*provider|scanlation|fansub|fansube|kurohana|recruiting|discord|patreon|paypal|ko-?fi|join\s+(?:our|us)|support\s+us|read\s+(?:it\s+)?(?:at|on|first)|chapter\s*\d+|çevirmen|çeviri|editör|dizgi|temizleme)\b/i;
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
