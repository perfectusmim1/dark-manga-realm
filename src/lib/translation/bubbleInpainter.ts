import { isRpgStatLine, REPEATED_ONLY_SFX_STEMS } from './ocrCore';
import {
  extractStyleFingerprint,
  fillEnclosedGlyphInteriors,
  FONT_FAMILY_MAP,
  getFontFamilyCss,
  inpaintTexturedRegion,
} from './styleExtractor';
import {
  computeSmartWrappedLines,
  getSharedMeasureContext,
  measureStyledWordWidth,
} from './textLayout';
import { ScanlationFontKey, TranslationBlock } from './types';

export const TRANSLATION_BLOCK_VERSION = 15;
export const SCANLATION_FONT_FAMILY = FONT_FAMILY_MAP.shantell;

interface ComponentInfo {
  id: number;
  minx: number;
  maxx: number;
  miny: number;
  maxy: number;
  w: number;
  h: number;
  area: number;
  corePixels: number;
  touchesBorder: boolean;
  touchesSideOrWinEdge: boolean;
  touchesImageSeamEdge: boolean;
  overlapsCore: boolean;
}

const clamp = (val: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, val));

const toNorm = (px: number, total: number): number =>
  Number(clamp((px / total) * 1000, 0, 1000).toFixed(4));

const medianOf = (arr: number[]): number => {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) * 0.5;
};

// Webtoon/manga balon içi metinleri dil kurallarına uygun büyük harf dizgisine çevirir.
export const formatScanlationText = (text: string, targetLang = 'tr'): string => {
  const trimmed = text.trim();
  if (!trimmed) return '';
  if (targetLang === 'tr' || targetLang === 'az') {
    return trimmed.toLocaleUpperCase('tr-TR');
  }
  try {
    return trimmed.toLocaleUpperCase(targetLang);
  } catch {
    return trimmed.toUpperCase();
  }
};

let fontLoadPromise: Promise<void> | null = null;

export const ensureScanlationFontReady = async (): Promise<void> => {
  if (typeof document === 'undefined' || !document.fonts?.load) return;
  if (!fontLoadPromise) {
    const sample = 'MERAK ÇĞİÖŞÜçğıöşü';
    fontLoadPromise = Promise.race([
      Promise.allSettled([
        document.fonts.load('400 24px "Patrick Hand"', sample),
        document.fonts.load('600 24px "Patrick Hand"', sample),
        document.fonts.load('700 24px "Patrick Hand"', sample),
        document.fonts.load('400 24px "Pangolin"', sample),
        document.fonts.load('600 24px "Shantell Sans"', sample),
        document.fonts.load('400 28px "Anton"', sample),
        document.fonts.load('400 28px "Bangers"', sample),
        document.fonts.load('400 24px "Permanent Marker"', sample),
        document.fonts.load('700 24px "Cinzel"', sample),
      ]).then(() => undefined),
      new Promise<void>((resolve) => setTimeout(resolve, 1200)),
    ]).catch(() => undefined);
  }
  await fontLoadPromise;
};

export const simulateWrappedLines = (
  ctx: CanvasRenderingContext2D | null,
  text: string,
  maxWidthPx: number,
  fontPx: number,
  fontFamily: ScanlationFontKey = 'shantell',
  fontWeight = 600,
): { lines: string[]; maxWordWidth: number } => {
  const smart = computeSmartWrappedLines(ctx, text, maxWidthPx, fontPx, {
    fontFamily,
    fontWeight,
  });
  return {
    lines: smart.lines.map((l) => l.text),
    maxWordWidth: smart.maxWordWidth,
  };
};

// 5-bit RGB histogram modundan balonun/kutunun baskın arka plan rengini (medyan ile) bulur.
// Yalnızca düz/düşük gradyanlı arka plan piksellerini (4-bit bin) ağırlıklandırarak örnekle;
// böylece kalın siyah yazılarda veya konturlu yazılarda mürekkep binleri ASLA baskın zemin seçilmez!
const findDominantBackgroundRgb = (
  winRgb: Int32Array,
  ww: number,
  wh: number,
  cx0: number,
  cy0: number,
  cx1: number,
  cy1: number,
  lineCores: Array<{ x0: number; x1: number; y0: number; y1: number }>,
): [number, number, number] => {
  const flatBinCounts = new Int32Array(4096);
  const allBinCounts = new Int32Array(4096);
  const sx0 = Math.max(0, cx0 - 6);
  const sx1 = Math.min(ww, cx1 + 6);
  const sy0 = Math.max(0, cy0 - 6);
  const sy1 = Math.min(wh, cy1 + 6);

  let brightFlatCount = 0;
  let midToneInBoxCount = 0;
  let whiteInBoxCount = 0;
  let totalFlatCount = 0;
  let collarFlatTotal = 0;
  let collarFlatDarkCount = 0;
  let collarFlatVividCount = 0;
  const vividRedBannerBins = new Uint32Array(4096);
  let vividRedBannerCount = 0;
  let blackInBoxCount = 0;
  let insideBoxSampleCount = 0;
  const lineBandCollarBins = new Uint32Array(4096);
  let lineBandCollarTotal = 0;
  let outerFlatTotal = 0;
  let outerFlatDarkCount = 0;

  // Dış pencere halkası siyah/çok koyu ve düzse ("IT'S MY FAULT..." siyah üstü beyaz parıltılı yazı)
  // harf çevresindeki beyaz parıltının baskın zemin sanılmasını engelle
  const outerPad = 8;
  for (let y = 0; y < wh; y += 2) {
    const yNext = y + 1 < wh ? y + 1 : y;
    const inInnerY = y >= cy0 - outerPad && y < cy1 + outerPad;
    for (let x = 0; x < ww; x += 2) {
      if (inInnerY && x >= cx0 - outerPad && x < cx1 + outerPad) continue;
      const idx = (y * ww + x) * 3;
      const r = winRgb[idx];
      const g = winRgb[idx + 1];
      const b = winRgb[idx + 2];
      const xNext = x + 1 < ww ? x + 1 : x;
      const rxIdx = (y * ww + xNext) * 3;
      const byIdx = (yNext * ww + x) * 3;
      const gx =
        Math.abs(winRgb[rxIdx] - r) +
        Math.abs(winRgb[rxIdx + 1] - g) +
        Math.abs(winRgb[rxIdx + 2] - b);
      const gy =
        Math.abs(winRgb[byIdx] - r) +
        Math.abs(winRgb[byIdx + 1] - g) +
        Math.abs(winRgb[byIdx + 2] - b);
      if (gx + gy <= 54) {
        outerFlatTotal += 1;
        const lum = 0.299 * r + 0.587 * g + 0.114 * b;
        if (lum < 52) outerFlatDarkCount += 1;
      }
    }
  }
  const hasFlatDarkOuterSurround =
    outerFlatTotal >= 28 && outerFlatDarkCount / outerFlatTotal >= 0.55;

  for (let y = sy0; y < sy1; y += 1) {
    const yNext = y + 1 < wh ? y + 1 : y;
    let idx = (y * ww + sx0) * 3;
    for (let x = sx0; x < sx1; x += 1, idx += 3) {
      const r = winRgb[idx];
      const g = winRgb[idx + 1];
      const b = winRgb[idx + 2];
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;

      const xNext = x + 1 < ww ? x + 1 : x;
      const rxIdx = (y * ww + xNext) * 3;
      const byIdx = (yNext * ww + x) * 3;
      const gx = Math.abs(winRgb[rxIdx] - r) + Math.abs(winRgb[rxIdx + 1] - g) + Math.abs(winRgb[rxIdx + 2] - b);
      const gy = Math.abs(winRgb[byIdx] - r) + Math.abs(winRgb[byIdx + 1] - g) + Math.abs(winRgb[byIdx + 2] - b);
      const isFlat = gx + gy <= 66;

      let inLineCore = false;
      for (let li = 0; li < lineCores.length; li += 1) {
        const lc = lineCores[li];
        if (x >= lc.x0 && x < lc.x1 && y >= lc.y0 && y < lc.y1) {
          inLineCore = true;
          break;
        }
      }
      const insideBlockBox = x >= cx0 && x < cx1 && y >= cy0 && y < cy1;
      const weight = inLineCore ? 3 : insideBlockBox ? 2 : 1;
      if (insideBlockBox) {
        insideBoxSampleCount += 1;
        if (lum <= 58) blackInBoxCount += 1;
        if (lum >= 105 && lum < 228) midToneInBoxCount += 1;
        else if (lum >= 232) whiteInBoxCount += 1;
      }

      const bin = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
      if (r >= 155 && g <= 65 && b <= 70 && r - g >= 95 && y >= cy0 - 3 && y < cy1 + 3 && x >= cx0 - 6 && x < cx1 + 6) {
        vividRedBannerBins[bin] += !inLineCore ? 3 : 1;
        vividRedBannerCount += 1;
      }
      allBinCounts[bin] += weight;
      if (isFlat) {
        flatBinCounts[bin] += weight;
        totalFlatCount += weight;
        if (lum >= 195) brightFlatCount += weight;
        if (!inLineCore) {
          const maxChPix = Math.max(r, g, b);
          const minChPix = Math.min(r, g, b);
          collarFlatTotal += weight;
          if (lum < 65) collarFlatDarkCount += weight;
          if (maxChPix >= 120 && maxChPix - minChPix >= 65) collarFlatVividCount += weight;
          if (y >= cy0 - 2 && y < cy1 + 2) {
            lineBandCollarBins[bin] += weight;
            lineBandCollarTotal += weight;
          }
        }
      }
    }
  }

  // Konuşma balonlarının ve düz açık zeminlerin kalın siyah harflerde yanlışlıkla siyaha düşmesini önle;
  // ancak harf dışı yaka (!inLineCore) siyah veya canlı renkli şerit ise ("CHAINSAWMAN", "NEWLY", "CHAIN")
  // koyu zemini koruyup devasa beyaz harflerin zemin sanılmasını engelle!
  const brightFlatRatio = totalFlatCount > 0 ? brightFlatCount / totalFlatCount : 0;
  const collarDarkOrVividRatio =
    collarFlatTotal > 0 ? (collarFlatDarkCount + collarFlatVividCount) / collarFlatTotal : 0;
  const hasDarkOrVividBannerCollar = collarFlatTotal >= 16 && collarDarkOrVividRatio >= 0.36;
  const suppressDarkInk =
    !hasFlatDarkOuterSurround &&
    !hasDarkOrVividBannerCollar &&
    totalFlatCount > 24 &&
    brightFlatRatio >= 0.24;
  const suppressWhiteHalo =
    hasFlatDarkOuterSurround ||
    (hasDarkOrVividBannerCollar && brightFlatRatio >= 0.22) ||
    (midToneInBoxCount >= 120 && midToneInBoxCount > whiteInBoxCount * 1.35);
  const useFlatBins = totalFlatCount >= 24;
  const targetBins = useFlatBins ? flatBinCounts : allBinCounts;

  let bestBin = -1;
  let bestCount = -1;
  for (let bin = 0; bin < 4096; bin += 1) {
    const cnt = targetBins[bin];
    if (cnt <= bestCount) continue;
    const br = (((bin >> 8) & 15) << 4) + 8;
    const bg = (((bin >> 4) & 15) << 4) + 8;
    const bb = ((bin & 15) << 4) + 8;
    const binLum = 0.299 * br + 0.587 * bg + 0.114 * bb;
    if (suppressDarkInk && binLum < 105) continue;
    if (suppressWhiteHalo && binLum >= 228) continue;
    bestCount = cnt;
    bestBin = bin;
  }

  // Keskin siyah/beyaz bölünmüş panellerde (ör. metnin 8-12px üstü tamamen beyaz, kendisi siyah panelde)
  // tam satır bandı dış yakasındaki baskın düz zemin kutunun kendi zeminidir
  if (lineBandCollarTotal >= 20 && bestBin >= 0) {
    let bestCollarBin = -1;
    let bestCollarCount = -1;
    for (let bin = 0; bin < 4096; bin += 1) {
      const cnt = lineBandCollarBins[bin];
      if (cnt > bestCollarCount) {
        bestCollarCount = cnt;
        bestCollarBin = bin;
      }
    }
    if (bestCollarBin >= 0 && bestCollarCount / lineBandCollarTotal >= 0.62) {
      const cBr = (((bestCollarBin >> 8) & 15) << 4) + 8;
      const cBg = (((bestCollarBin >> 4) & 15) << 4) + 8;
      const cBb = ((bestCollarBin & 15) << 4) + 8;
      const cLum = 0.299 * cBr + 0.587 * cBg + 0.114 * cBb;
      const bBr = (((bestBin >> 8) & 15) << 4) + 8;
      const bBg = (((bestBin >> 4) & 15) << 4) + 8;
      const bBb = ((bestBin & 15) << 4) + 8;
      const bLum = 0.299 * bBr + 0.587 * bBg + 0.114 * bBb;
      const overwhelmingBandCollar = bestCollarCount / lineBandCollarTotal >= 0.78;
      const midToneDominated = midToneInBoxCount >= 120 && midToneInBoxCount > whiteInBoxCount * 1.35;
      if (
        Math.abs(cLum - bLum) >= 95 &&
        (!suppressWhiteHalo || cLum < 228 || (overwhelmingBandCollar && !midToneDominated))
      ) {
        bestBin = bestCollarBin;
      }
    }
  }

  // Siyah yoğun harfli parlak kırmızı şerit ("THE BEGINNING OF A NEW ERA!") içindeki ince kırmızı aralıklar
  // tekdüze düz sayılmasa bile şerit içi kırmızı bin'i baskın zemin olarak kurtar
  if (
    vividRedBannerCount >= Math.max(24, insideBoxSampleCount * 0.08) &&
    blackInBoxCount >= insideBoxSampleCount * 0.14
  ) {
    let bestRedBin = -1;
    let bestRedCnt = -1;
    for (let bin = 0; bin < 4096; bin += 1) {
      if (vividRedBannerBins[bin] > bestRedCnt) {
        bestRedCnt = vividRedBannerBins[bin];
        bestRedBin = bin;
      }
    }
    if (bestRedBin >= 0) bestBin = bestRedBin;
  }

  if (bestBin < 0) {
    for (let bin = 0; bin < 4096; bin += 1) {
      if (allBinCounts[bin] > bestCount) {
        bestCount = allBinCounts[bin];
        bestBin = bin;
      }
    }
  }

  if (bestCount <= 0 || bestBin < 0) return [255, 255, 255];

  const rs: number[] = [];
  const gs: number[] = [];
  const bs: number[] = [];
  for (let y = sy0; y < sy1; y += 1) {
    let idx = (y * ww + sx0) * 3;
    for (let x = sx0; x < sx1; x += 1, idx += 3) {
      const r = winRgb[idx];
      const g = winRgb[idx + 1];
      const b = winRgb[idx + 2];
      const bin = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
      if (bin === bestBin) {
        rs.push(r);
        gs.push(g);
        bs.push(b);
      }
    }
  }

  return [
    Math.round(medianOf(rs)),
    Math.round(medianOf(gs)),
    Math.round(medianOf(bs)),
  ];
};

const dilate3x3 = (src: Uint8Array, ww: number, wh: number): Uint8Array => {
  const dst = new Uint8Array(ww * wh);
  for (let y = 0; y < wh; y += 1) {
    const yMin = y > 0 ? y - 1 : 0;
    const yMax = y < wh - 1 ? y + 1 : wh - 1;
    for (let x = 0; x < ww; x += 1) {
      const xMin = x > 0 ? x - 1 : 0;
      const xMax = x < ww - 1 ? x + 1 : ww - 1;
      let hit = 0;
      for (let ny = yMin; ny <= yMax && !hit; ny += 1) {
        const rOff = ny * ww;
        for (let nx = xMin; nx <= xMax; nx += 1) {
          if (src[rOff + nx]) {
            hit = 1;
            break;
          }
        }
      }
      dst[y * ww + x] = hit;
    }
  }
  return dst;
};

export interface InpaintBlockOptions {
  siblingBoxes?: Array<[number, number, number, number]>;
}

/**
 * Orijinal konuşma balonundaki veya sahne üstü özel yazılardaki (SFX) harfleri piksel düzeyinde
 * tespit edip arka plan dokusunu/rengini koruyarak tamamen siler (Inpaint),
 * orijinal yazının stil parmak izini (renk, kontur, gradyan, font, açı) çıkarır ve
 * çeviri metni için en uygun dizgi yerleşimini hesaplar.
 */
export const inpaintAndRefineBlock = (
  fullCtx: CanvasRenderingContext2D,
  fullWidth: number,
  fullHeight: number,
  block: TranslationBlock,
  targetLang = 'tr',
  options?: InpaintBlockOptions,
): TranslationBlock | null => {
  // Alt satır kutuları varsa hepsini kapsayan birleşik kutuyu garanti altına al
  let [ymin, xmin, ymax, xmax] = block.box;
  if (block.lines && block.lines.length > 0) {
    for (const l of block.lines) {
      if (l.box[0] < ymin) ymin = l.box[0];
      if (l.box[1] < xmin) xmin = l.box[1];
      if (l.box[2] > ymax) ymax = l.box[2];
      if (l.box[3] > xmax) xmax = l.box[3];
    }
  }

  const boxX0 = clamp(Math.floor((xmin / 1000) * fullWidth), 0, fullWidth - 1);
  const boxX1 = clamp(Math.ceil((xmax / 1000) * fullWidth), boxX0 + 1, fullWidth);
  const boxY0 = clamp(Math.floor((ymin / 1000) * fullHeight), 0, fullHeight - 1);
  const boxY1 = clamp(Math.ceil((ymax / 1000) * fullHeight), boxY0 + 1, fullHeight);

  const bw = boxX1 - boxX0;
  const bh = boxY1 - boxY0;
  const displayText = formatScanlationText(block.text, targetLang);
  const origLineCount = block.lines?.length ?? 1;
  const isSingleLineStat = origLineCount === 1 && isRpgStatLine(displayText);

  const absSiblings = (options?.siblingBoxes ?? [])
    .map(([sy0, sx0, sy1, sx1]) => ({
      x0: Math.floor((sx0 / 1000) * fullWidth),
      y0: Math.floor((sy0 / 1000) * fullHeight),
      x1: Math.ceil((sx1 / 1000) * fullWidth),
      y1: Math.ceil((sy1 / 1000) * fullHeight),
    }))
    .filter((s) => {
      // Kendi kutumuzun içine yuvalanmış parça tekrarlarını komşu balon sayıp silmeyi engelleme
      const ox = Math.min(boxX1, s.x1) - Math.max(boxX0, s.x0);
      const oy = Math.min(boxY1, s.y1) - Math.max(boxY0, s.y0);
      if (ox <= 0 || oy <= 0) return true;
      const sibArea = Math.max(1, (s.x1 - s.x0) * (s.y1 - s.y0));
      return (ox * oy) / sibArea < 0.5;
    });
  const overlapsAnySiblingAbs = (ax0: number, ay0: number, ax1: number, ay1: number): boolean => {
    if (absSiblings.length === 0) return false;
    const cx = (ax0 + ax1) * 0.5;
    const cy = (ay0 + ay1) * 0.5;
    for (let i = 0; i < absSiblings.length; i += 1) {
      const s = absSiblings[i];
      if (cx >= s.x0 - 2 && cx <= s.x1 + 2 && cy >= s.y0 - 2 && cy <= s.y1 + 2) return true;
      const ox = Math.min(ax1, s.x1) - Math.max(ax0, s.x0);
      const oy = Math.min(ay1, s.y1) - Math.max(ay0, s.y0);
      if (ox > 0 && oy > 0) {
        const compArea = Math.max(1, (ax1 - ax0) * (ay1 - ay0));
        if ((ox * oy) / compArea >= 0.32) return true;
      }
    }
    return false;
  };

  // Büyük/stilize harflerin ("NO", "FIRST MURDER.", "ALONE?") pencere sınırına çarpıp
  // balon çerçevesi sanılmasını önlemek ve yuvarlak/dikenli balonların üst-alt boşluğunu tam görmek için geniş arama penceresi
  const nearTopSeam = boxY0 <= 90;
  const nearBottomSeam = fullHeight - boxY1 <= 90;
  const maxLineSpanEstimate =
    block.lines && block.lines.length > 0
      ? Math.max(...block.lines.map((l) => Math.max(12, Math.ceil(((l.box[2] - l.box[0]) / 1000) * fullHeight))))
      : bh;
  const padWinX = Math.max(
    nearTopSeam || nearBottomSeam ? 130 : bh < 55 ? 64 : 48,
    bw >= 350 && maxLineSpanEstimate <= 110 ? Math.min(bw * 0.48, Math.max(140, bh * 1.4)) : bw * 0.48,
    bh * 0.95,
  );
  const padWinY = Math.max(
    bh < 55 ? 56 : 48,
    bh * 1.15,
    bw >= 320 && maxLineSpanEstimate <= 110 ? Math.min(bw * 0.42, bh * 1.25 + 24) : bw * 0.42,
  );

  let wx0 = Math.max(0, Math.floor(boxX0 - padWinX));
  let wx1 = Math.min(fullWidth, Math.ceil(boxX1 + padWinX));
  let wy0 = nearTopSeam ? 0 : Math.max(0, Math.floor(boxY0 - padWinY));
  let wy1 = nearBottomSeam ? fullHeight : Math.min(fullHeight, Math.ceil(boxY1 + padWinY));

  // Pencere analizini yapan iç yardımcı (pencere kenarına değen harf olursa pencereyi büyütüp tekrar çalıştırabilmek için)
  const analyzeWindow = (curWx0: number, curWy0: number, curWx1: number, curWy1: number) => {
    const ww = curWx1 - curWx0;
    const wh = curWy1 - curWy0;
    if (ww <= 4 || wh <= 4) return null;

    let imgData: ImageData;
    try {
      imgData = fullCtx.getImageData(curWx0, curWy0, ww, wh);
    } catch {
      return null;
    }

    const rgba = imgData.data;
    const numPixels = ww * wh;
    const winRgb = new Int32Array(numPixels * 3);
    for (let i = 0, p4 = 0, p3 = 0; i < numPixels; i += 1, p4 += 4, p3 += 3) {
      winRgb[p3] = rgba[p4];
      winRgb[p3 + 1] = rgba[p4 + 1];
      winRgb[p3 + 2] = rgba[p4 + 2];
    }

    const cx0 = clamp(boxX0 - curWx0, 0, ww - 1);
    const cx1 = clamp(boxX1 - curWx0, cx0 + 1, ww);
    const cy0 = clamp(boxY0 - curWy0, 0, wh - 1);
    const cy1 = clamp(boxY1 - curWy0, cy0 + 1, wh);

    // Alt satırların yerel çekirdek kutuları
    const lineCores =
      block.lines && block.lines.length > 0
        ? block.lines.map((l) => ({
            x0: clamp(Math.floor((l.box[1] / 1000) * fullWidth) - curWx0, 0, ww - 1),
            x1: clamp(Math.ceil((l.box[3] / 1000) * fullWidth) - curWx0, 1, ww),
            y0: clamp(Math.floor((l.box[0] / 1000) * fullHeight) - curWy0, 0, wh - 1),
            y1: clamp(Math.ceil((l.box[2] / 1000) * fullHeight) - curWy0, 1, wh),
            angleDeg: l.angleDeg,
          }))
        : [{ x0: cx0, x1: cx1, y0: cy0, y1: cy1, angleDeg: undefined }];

    // Baskın arka plan rengini bulmak için yalnızca çekirdek satırları ve 3px iç sınırı örnekle
    let [bgR, bgG, bgB] = findDominantBackgroundRgb(
      winRgb,
      ww,
      wh,
      cx0,
      cy0,
      cx1,
      cy1,
      lineCores,
    );
    let bgLumInit = 0.299 * bgR + 0.587 * bgG + 0.114 * bgB;

    // 2D Integral Image ile yerel arka plan ortalaması (kalın harflerin kendi içini ortalama sanmaması için R dinamik)
    const iw = ww + 1;
    const ih = wh + 1;
    const iiR = new Float64Array(iw * ih);
    const iiG = new Float64Array(iw * ih);
    const iiB = new Float64Array(iw * ih);

    for (let y = 1; y <= wh; y += 1) {
      let rowSumR = 0;
      let rowSumG = 0;
      let rowSumB = 0;
      const prevRowOffset = (y - 1) * iw;
      const currRowOffset = y * iw;
      let srcIdx = (y - 1) * ww * 3;
      for (let x = 1; x <= ww; x += 1, srcIdx += 3) {
        rowSumR += winRgb[srcIdx];
        rowSumG += winRgb[srcIdx + 1];
        rowSumB += winRgb[srcIdx + 2];
        iiR[currRowOffset + x] = iiR[prevRowOffset + x] + rowSumR;
        iiG[currRowOffset + x] = iiG[prevRowOffset + x] + rowSumG;
        iiB[currRowOffset + x] = iiB[prevRowOffset + x] + rowSumB;
      }
    }

    const medLineH =
      lineCores.length > 0
        ? medianOf(lineCores.map((lc) => Math.max(8, lc.y1 - lc.y0)))
        : Math.max(16, bh);
    const R = clamp(Math.round(Math.min(bw, bh) * 0.42), 24, 54);
    const RTight = clamp(Math.round(medLineH * 0.18), 8, 16);

    const isInsideAnyCore = (x: number, y: number): boolean => {
      if (lineCores.length > 0) {
        for (let i = 0; i < lineCores.length; i += 1) {
          const lc = lineCores[i];
          if (x >= lc.x0 && x <= lc.x1 && y >= lc.y0 && y <= lc.y1) return true;
        }
        return false;
      }
      return x >= cx0 && x <= cx1 && y >= cy0 && y <= cy1;
    };
    const isNearAnyCore = (x: number, y: number, pad: number): boolean => {
      if (lineCores.length > 0) {
        for (let i = 0; i < lineCores.length; i += 1) {
          const lc = lineCores[i];
          if (x >= lc.x0 - pad && x <= lc.x1 + pad && y >= lc.y0 - pad && y <= lc.y1 + pad) {
            return true;
          }
        }
        return false;
      }
      return x >= cx0 - pad && x <= cx1 + pad && y >= cy0 - pad && y <= cy1 + pad;
    };

    /**
     * Koyu Mürekkep / Koyu İç Dolgulu Harf Maskesi (`fgDark`):
     * - Yalnızca yerel çevresinden DAHA KOYU olan pikselleri (`pixLum < 185`) işaretler.
     * - Beyaz kontur pikselleri (`pixLum >= 185`) kesinlikle `0` kaldığı için, "KIM JEONGHYUK",
     *   "REPARTIDOR DE DALMIN", "31 AÑOS" gibi beyaz konturlu koyu harflerde 3px beyaz kontur
     *   doğal bir yalıtım hendek (moat) görevi görür; harf içlerinin siyah çerçeve veya koyu yelekle
     *   birleşmesini %100 engeller!
     */
    // Koyu-mürekkep bloklarında gerçek katı siyah yazı (`lum <= 42`), beyaz iç dolgu (`lum >= 232`)
    // ve kimin dış kabuk ("siyah dış kontur" vs "beyaz dış hale") olduğunu topolojik olarak ölç
    let coreSamples = 0;
    let jetBlackCoreCount = 0;
    let whiteCoreCount = 0;
    let blackTouchesMid = 0;
    let whiteTouchesMid = 0;
    const probeMidScene = (px: number, py: number): boolean => {
      const cx = clamp(px, 0, ww - 1);
      const cy = clamp(py, 0, wh - 1);
      const ci = (cy * ww + cx) * 3;
      const l = 0.299 * winRgb[ci] + 0.587 * winRgb[ci + 1] + 0.114 * winRgb[ci + 2];
      return l >= 55 && l <= 205;
    };
    for (let i = 0; i < lineCores.length; i += 1) {
      const lc = lineCores[i];
      for (let y = lc.y0; y < lc.y1; y += 2) {
        const rowOff = y * ww;
        for (let x = lc.x0; x < lc.x1; x += 2) {
          const cIdx = (rowOff + x) * 3;
          coreSamples += 1;
          const lum = 0.299 * winRgb[cIdx] + 0.587 * winRgb[cIdx + 1] + 0.114 * winRgb[cIdx + 2];
          if (lum <= 42) {
            jetBlackCoreCount += 1;
            if (
              probeMidScene(x - 3, y) ||
              probeMidScene(x + 3, y) ||
              probeMidScene(x, y - 3) ||
              probeMidScene(x, y + 3)
            ) {
              blackTouchesMid += 1;
            }
          }
          if (lum >= 232) {
            whiteCoreCount += 1;
            if (
              probeMidScene(x - 3, y) ||
              probeMidScene(x + 3, y) ||
              probeMidScene(x, y - 3) ||
              probeMidScene(x, y + 3)
            ) {
              whiteTouchesMid += 1;
            }
          }
        }
      }
    }
    const hasJetBlackCoreInk =
      bgLumInit >= 145 &&
      bgLumInit < 226 &&
      whiteCoreCount >= 18 &&
      whiteCoreCount / Math.max(1, coreSamples) <= 0.72 &&
      jetBlackCoreCount >= 14 &&
      jetBlackCoreCount / Math.max(1, coreSamples) >= 0.015;

    const buildDarkForegroundMask = (localThresh: number, globalThresh: number): Uint8Array => {
      const fg = new Uint8Array(numPixels);
      const bgMaxCh = Math.max(bgR, bgG, bgB);
      const bgChroma = bgMaxCh - Math.min(bgR, bgG, bgB);
      const isVividColoredBanner = bgMaxCh >= 135 && bgChroma >= 65;
      const isThinSingleVividBanner =
        isVividColoredBanner && cy1 - cy0 <= 68 && lineCores.length === 1;
      const isLightOrMid = bgLumInit >= 115 || (isVividColoredBanner && bgLumInit >= 52);

      for (let y = 0; y < wh; y += 1) {
        // İnce tek satırlı canlı renk şeritlerinin ("THE BEGINNING OF A NEW ERA..." gibi)
        // hemen altından/üstünden şeride değen siyah çizgi illüstrasyonlarının maskeye kaynak olmasını engelle
        if (isThinSingleVividBanner && (y < cy0 - 3 || y > cy1 + 3)) continue;
        const y0s = Math.max(0, y - R);
        const y1s = Math.min(wh, y + R + 1);
        const r0Off = y0s * iw;
        const r1Off = y1s * iw;
        const spanY = y1s - y0s;

        const ty0s = Math.max(0, y - RTight);
        const ty1s = Math.min(wh, y + RTight + 1);
        const tr0Off = ty0s * iw;
        const tr1Off = ty1s * iw;
        const tSpanY = ty1s - ty0s;

        for (let x = 0; x < ww; x += 1) {
          const pIdx = y * ww + x;
          const cIdx = pIdx * 3;
          const pr = winRgb[cIdx];
          const pg = winRgb[cIdx + 1];
          const pb = winRgb[cIdx + 2];
          const pixLum = 0.299 * pr + 0.587 * pg + 0.114 * pb;

          // Beyaz kontur ve tam beyaz balon zemini pikselleri asla koyu harf maskesine giremez (Yalıtım Kalkanı)
          if (pixLum >= 225) continue;

          const inCore = isInsideAnyCore(x, y);
          const nearCore3 = isNearAnyCore(x, y, 3);
          const maxCh = Math.max(pr, pg, pb);
          const minCh = Math.min(pr, pg, pb);
          // Katı siyah harfli açık zeminlerde çıta/mobilya çizgilerini dışlarken nötr konuşma balonu oval çerçevesini (lookism) koparmadan koru
          if (hasJetBlackCoreInk && pixLum > (nearCore3 ? 58 : 120)) {
            continue;
          }

          // Zemin rengine çok yakın pikselleri kesinlikle dışla (mavi RPG kutusu veya kahverengi parşömendeki renkli zemin pikselleri koyu harf sanılmasın)
          const dBg = Math.max(Math.abs(pr - bgR), Math.abs(pg - bgG), Math.abs(pb - bgB));
          if (dBg < 26 && Math.abs(pixLum - bgLumInit) < 20) continue;

          const x0s = Math.max(0, x - R);
          const x1s = Math.min(ww, x + R + 1);
          const invArea = 1 / (spanY * (x1s - x0s));

          const meanR =
            (iiR[r1Off + x1s] - iiR[r0Off + x1s] - iiR[r1Off + x0s] + iiR[r0Off + x0s]) * invArea;
          const meanG =
            (iiG[r1Off + x1s] - iiG[r0Off + x1s] - iiG[r1Off + x0s] + iiG[r0Off + x0s]) * invArea;
          const meanB =
            (iiB[r1Off + x1s] - iiB[r0Off + x1s] - iiB[r1Off + x0s] + iiB[r0Off + x0s]) * invArea;

          const tx0s = Math.max(0, x - RTight);
          const tx1s = Math.min(ww, x + RTight + 1);
          const tInvArea = 1 / (tSpanY * (tx1s - tx0s));

          const tMeanR =
            (iiR[tr1Off + tx1s] - iiR[tr0Off + tx1s] - iiR[tr1Off + tx0s] + iiR[tr0Off + tx0s]) *
            tInvArea;
          const tMeanG =
            (iiG[tr1Off + tx1s] - iiG[tr0Off + tx1s] - iiG[tr1Off + tx0s] + iiG[tr0Off + tx0s]) *
            tInvArea;
          const tMeanB =
            (iiB[tr1Off + tx1s] - iiB[tr0Off + tx1s] - iiB[tr1Off + tx0s] + iiB[tr0Off + tx0s]) *
            tInvArea;

          const effLocal = inCore ? Math.max(9, localThresh * 0.65) : localThresh;
          const meanLum = 0.299 * meanR + 0.587 * meanG + 0.114 * meanB;
          const tMeanLum = 0.299 * tMeanR + 0.587 * tMeanG + 0.114 * tMeanB;
          const bgMatchesLocal = isLightOrMid && Math.abs(meanLum - bgLumInit) < 32;

          const dLumMedDark = meanLum - pixLum;
          const dLumTightDark = tMeanLum - pixLum;
          const dMedDark = Math.max(meanR - pr, meanG - pg, meanB - pb);
          const dTightDark = Math.max(tMeanR - pr, tMeanG - pg, tMeanB - pb);

          // 1. Açık/gradyanlı zeminde standart veya güneş ışığında solmuş koyu/gri mürekkep
          //    (Kalın siyah dikenli balon halkalarının hemen yanındaki kenar harfleri RTight yerel kontrastı ile korunur!)
          // 2. Koyu/orta tondaki zeminde beyaz iç dolguya yakın koyu dış kontur veya koyu harf
          const nearDarkRingWhite =
            bgLumInit >= 170 &&
            pixLum < Math.min(135, bgLumInit - 65) &&
            dLumTightDark > effLocal * 0.72 &&
            (inCore || tMeanLum >= 145);
          const midToneDarkInk =
            (bgLumInit >= 75 || (isVividColoredBanner && bgLumInit >= 52)) &&
            pixLum <= 110 &&
            (dLumMedDark > effLocal * 0.78 || (isVividColoredBanner && bgMaxCh - maxCh >= 55)) &&
            dMedDark > effLocal * 0.85 &&
            (meanLum >= 60 || tMeanLum >= 85 || isVividColoredBanner);
          const vividBannerDarkInk =
            isVividColoredBanner &&
            pixLum <= 122 &&
            (bgMaxCh - maxCh >= 52 || bgLumInit - pixLum >= 24);
          if (
            (meanLum >= 160 && dLumMedDark > effLocal * 0.82 && dMedDark > effLocal) ||
            nearDarkRingWhite ||
            midToneDarkInk ||
            vividBannerDarkInk ||
            (pixLum < 115 &&
              tMeanLum >= 135 &&
              tMeanLum > bgLumInit + 32 &&
              (pixLum < bgLumInit - 26 || dBg >= 38) &&
              dLumTightDark > effLocal * 0.75 &&
              dTightDark > effLocal * 0.9)
          ) {
            fg[pIdx] = 1;
          }
        }
      }
      return fg;
    };

    /**
     * Parlak / Açık Renkli Harf ve Kontur Maskesi (`fgLight`):
     * - Siyah/koyu sahnelerdeki ("NO.", "FIRST MURDER.") beyaz konturlu veya parlak renkli harfler için.
     */
    const buildLightForegroundMask = (
      localThresh: number,
      globalThresh: number,
      yellowHeadlineOnly = false,
    ): Uint8Array => {
      const fg = new Uint8Array(numPixels);
      const bgMaxChL = Math.max(bgR, bgG, bgB);
      const isVividBgL = bgMaxChL >= 120 && bgMaxChL - Math.min(bgR, bgG, bgB) >= 45;
      const clampToTiltedCore = lineCores.some((l) => Math.abs(l.angleDeg ?? 0) >= 5);

      for (let y = 0; y < wh; y += 1) {
        if (clampToTiltedCore && (y < cy0 - 14 || y > cy1 + 14)) continue;
        const y0s = Math.max(0, y - R);
        const y1s = Math.min(wh, y + R + 1);
        const r0Off = y0s * iw;
        const r1Off = y1s * iw;
        const spanY = y1s - y0s;

        for (let x = 0; x < ww; x += 1) {
          if (clampToTiltedCore && (x < cx0 - 14 || x > cx1 + 14)) continue;
          const x0s = Math.max(0, x - R);
          const x1s = Math.min(ww, x + R + 1);
          const invArea = 1 / (spanY * (x1s - x0s));

          const meanR =
            (iiR[r1Off + x1s] - iiR[r0Off + x1s] - iiR[r1Off + x0s] + iiR[r0Off + x0s]) * invArea;
          const meanG =
            (iiG[r1Off + x1s] - iiG[r0Off + x1s] - iiG[r1Off + x0s] + iiG[r0Off + x0s]) * invArea;
          const meanB =
            (iiB[r1Off + x1s] - iiB[r0Off + x1s] - iiB[r1Off + x0s] + iiB[r0Off + x0s]) * invArea;

          const pIdx = y * ww + x;
          const cIdx = pIdx * 3;
          const pr = winRgb[cIdx];
          const pg = winRgb[cIdx + 1];
          const pb = winRgb[cIdx + 2];

          const inCore = isInsideAnyCore(x, y);
          const nearCoreYellow = isNearAnyCore(x, y, 4);
          const effLocal = inCore ? Math.max(9, localThresh * 0.65) : localThresh;
          const pixLum = 0.299 * pr + 0.587 * pg + 0.114 * pb;
          const meanLum = 0.299 * meanR + 0.587 * meanG + 0.114 * meanB;
          const dLumLocal = pixLum - meanLum;
          const dLumGlobal = pixLum - bgLumInit;
          const dLocalLight = Math.max(pr - meanR, pg - meanG, pb - meanB);
          const dGlobalLight = Math.max(pr - bgR, pg - bgG, pb - bgB);

          // Orta/açık gri veya renkli sahnede parlak sarı/altın başlık yazısı ("THE GENIUS BEHIND FIREPUNCH...")
          if (
            nearCoreYellow &&
            pr >= 180 &&
            pg >= 145 &&
            pb <= 125 &&
            pr - pb >= 72 &&
            pg - pb >= 48 &&
            bgB < 195
          ) {
            fg[pIdx] = 1;
            continue;
          }

          // Parlak sarı sahne başlıklarında ten/toprak/ahşap dokularının sarı harflere kaynamasını engelle
          if (yellowHeadlineOnly && pixLum < 165) {
            continue;
          }

          if (isVividBgL) {
            // Renkli şeritlerde (kırmızı vb.) eş parlaklıktaki gri/kaya kenarlarının kanal farkıyla fg'ye girmesini engelle
            if (dLumLocal > effLocal && dLumGlobal > Math.max(18, globalThresh * 0.85)) {
              fg[pIdx] = 1;
            }
            continue;
          }

          if (
            (dLumLocal > effLocal * 0.65 || (bgLumInit < 45 && dLocalLight > effLocal)) &&
            (dLocalLight > effLocal || (dLocalLight > effLocal * 0.5 && dGlobalLight > globalThresh * 1.25))
          ) {
            fg[pIdx] = 1;
            continue;
          }

          // Siyah zemin üzerinde koyu kırmızı/bordo ("ER.") gibi yüksek kromalı harfler
          const chromaDiffLocal =
            Math.abs((pr - pg) - (meanR - meanG)) +
            Math.abs((pr - pb) - (meanR - meanB)) +
            Math.abs((pg - pb) - (meanG - meanB));
          if (chromaDiffLocal > effLocal * 1.55 && dLocalLight > 6 && dLumLocal > 8) {
            fg[pIdx] = 1;
          }
        }
      }
      return fg;
    };

    const extractComponents = (fg: Uint8Array) => {
      const labels = new Int32Array(numPixels);
      const comps: ComponentInfo[] = [];
      const queue = new Int32Array(numPixels);
      let curId = 0;

      for (let y = 0; y < wh; y += 1) {
        for (let x = 0; x < ww; x += 1) {
          const startIdx = y * ww + x;
          if (fg[startIdx] === 0 || labels[startIdx] !== 0) continue;

          curId += 1;
          labels[startIdx] = curId;
          let qHead = 0;
          let qTail = 0;
          queue[qTail++] = startIdx;

          let minx = x;
          let maxx = x;
          let miny = y;
          let maxy = y;
          let area = 0;
          let corePixels = 0;
          let touchesBorder = false;
          let touchesSideOrWinEdge = false;
          let touchesImageSeamEdge = false;
          let overlapsCore = false;

          while (qHead < qTail) {
            const curr = queue[qHead++];
            const cy = (curr / ww) | 0;
            const cx = curr - cy * ww;
            area += 1;

            if (cx < minx) minx = cx;
            if (cx > maxx) maxx = cx;
            if (cy < miny) miny = cy;
            if (cy > maxy) maxy = cy;
            const hitSideOrInner =
              cx <= 1 ||
              cx >= ww - 2 ||
              (cy <= 1 && curWy0 > 0) ||
              (cy >= wh - 2 && curWy1 < fullHeight);
            const hitSeamEdge =
              (curWy0 === 0 && cy <= 1) || (curWy1 === fullHeight && cy >= wh - 2);
            if (hitSideOrInner) {
              touchesSideOrWinEdge = true;
              touchesBorder = true;
            }
            if (hitSeamEdge) {
              touchesImageSeamEdge = true;
              touchesBorder = true;
            }
            if (isInsideAnyCore(cx, cy)) {
              overlapsCore = true;
              corePixels += 1;
            }

            const nyMin = cy > 0 ? cy - 1 : 0;
            const nyMax = cy < wh - 1 ? cy + 1 : wh - 1;
            const nxMin = cx > 0 ? cx - 1 : 0;
            const nxMax = cx < ww - 1 ? cx + 1 : ww - 1;

            for (let ny = nyMin; ny <= nyMax; ny += 1) {
              const rowOff = ny * ww;
              for (let nx = nxMin; nx <= nxMax; nx += 1) {
                const nIdx = rowOff + nx;
                if (fg[nIdx] === 1 && labels[nIdx] === 0) {
                  labels[nIdx] = curId;
                  queue[qTail++] = nIdx;
                }
              }
            }
          }

          comps.push({
            id: curId,
            minx,
            maxx,
            miny,
            maxy,
            w: maxx - minx + 1,
            h: maxy - miny + 1,
            area,
            corePixels,
            touchesBorder,
            touchesSideOrWinEdge,
            touchesImageSeamEdge,
            overlapsCore,
          });
        }
      }

      return { labels, comps };
    };

    /**
     * Bir bileşenin balon çerçevesi mi yoksa gerçek bir harf/kelime mi olduğunu ayırt eder:
     * - Eski sistemde `c.h >= wh * 0.72` veya `c.w >= ww * 0.85` olan büyük/bitişik konturlu kelimeler ("NO", "ALONE?", "ER.")
     *   yanlışlıkla balon çerçevesi sanılıp silinmiyordu!
     * - Gerçek bir harf/kelime bileşeni OCR çekirdek kutusunun (cx0..cx1, cy0..cy1) içinde yoğun piksellere sahiptir (`coreRatio >= 0.16`).
     * - Balon çerçevesi ise pencere sınırına değer (`touchesBorder`) veya çekirdeğin dışından dolanan boş bir halkadır (`coreRatio < 0.12`).
     */
    let brighterCount = 0;
    let darkerCount = 0;
    let yellowCoreCount = 0;
    let coreTotalCount = 0;
    for (let li = 0; li < lineCores.length; li += 1) {
      const lc = lineCores[li];
      for (let cy = lc.y0; cy <= lc.y1; cy += 1) {
        const rowOff = cy * ww;
        for (let cx = lc.x0; cx <= lc.x1; cx += 1) {
          const cIdx = (rowOff + cx) * 3;
          const pr = winRgb[cIdx];
          const pg = winRgb[cIdx + 1];
          const pb = winRgb[cIdx + 2];
          const lum = 0.299 * pr + 0.587 * pg + 0.114 * pb;
          coreTotalCount += 1;
          if (lum > bgLumInit + 28 && Math.max(pr - bgR, pg - bgG, pb - bgB) > 30) {
            brighterCount += 1;
          }
          if (lum < bgLumInit - 26 && Math.max(bgR - pr, bgG - pg, bgB - pb) > 28) {
            darkerCount += 1;
          }
          if (pr >= 190 && pg >= 155 && pb <= 115 && pr - pb >= 85 && pg - pb >= 60) {
            yellowCoreCount += 1;
          }
        }
      }
    }

    // Sahne/gradyan üzerinde kalın siyah konturlu beyaz yazı tespiti ("THE HEAVENLY MARTIAL BODY..." vb.):
    // Çekirdek içinde hem beyaz dolgu hem kalın siyah kontur varken yan/alt çevre sahne koyu/renkliyse parlak harf maskesini kullan!
    let flankSamples = 0;
    let flankWhite = 0;
    let flankLumSum = 0;
    const flankRs: number[] = [];
    const flankGs: number[] = [];
    const flankBs: number[] = [];
    const fxL0 = Math.max(0, cx0 - 24);
    const fxL1 = Math.max(0, cx0 - 6);
    const fxR0 = Math.min(ww - 1, cx1 + 6);
    const fxR1 = Math.min(ww - 1, cx1 + 24);
    for (let fy = Math.max(0, cy0); fy <= Math.min(wh - 1, cy1); fy += 3) {
      const fOff = fy * ww;
      for (let fx = fxL0; fx <= fxL1; fx += 3) {
        const cIdx = (fOff + fx) * 3;
        const r = winRgb[cIdx];
        const g = winRgb[cIdx + 1];
        const b = winRgb[cIdx + 2];
        const lum = 0.299 * r + 0.587 * g + 0.114 * b;
        flankSamples += 1;
        flankLumSum += lum;
        flankRs.push(r);
        flankGs.push(g);
        flankBs.push(b);
        if (lum >= 232) flankWhite += 1;
      }
      for (let fx = fxR0; fx <= fxR1; fx += 3) {
        const cIdx = (fOff + fx) * 3;
        const r = winRgb[cIdx];
        const g = winRgb[cIdx + 1];
        const b = winRgb[cIdx + 2];
        const lum = 0.299 * r + 0.587 * g + 0.114 * b;
        flankSamples += 1;
        flankLumSum += lum;
        flankRs.push(r);
        flankGs.push(g);
        flankBs.push(b);
        if (lum >= 232) flankWhite += 1;
      }
    }
    const coreWhiteRatio = whiteCoreCount / Math.max(1, coreSamples);
    const flankWhiteRatio = flankWhite / Math.max(1, flankSamples);
    const flankMeanLum = flankSamples > 0 ? flankLumSum / flankSamples : bgLumInit;
    const isWhiteFillDarkOutlineOnScene =
      flankSamples >= 12 &&
      whiteCoreCount >= 18 &&
      jetBlackCoreCount >= 18 &&
      blackTouchesMid >= 20 &&
      blackTouchesMid > whiteTouchesMid * 1.6 &&
      coreWhiteRatio < 0.45 &&
      flankWhiteRatio <= 0.25 &&
      flankMeanLum <= 205;

    if (isWhiteFillDarkOutlineOnScene && flankRs.length >= 12) {
      // Gradyanlı sahnede findDominantBackgroundRgb beyaz harf dolgusuna takıldıysa gerçek yan sahne rengini geri yükle
      bgR = Math.round(medianOf(flankRs));
      bgG = Math.round(medianOf(flankGs));
      bgB = Math.round(medianOf(flankBs));
      bgLumInit = 0.299 * bgR + 0.587 * bgG + 0.114 * bgB;
    }

    const flankNonYellowR: number[] = [];
    const flankNonYellowG: number[] = [];
    const flankNonYellowB: number[] = [];
    let flankYellowCount = 0;
    for (let fi = 0; fi < flankRs.length; fi += 1) {
      const fr = flankRs[fi];
      const fg = flankGs[fi];
      const fb = flankBs[fi];
      if (fr >= 185 && fg >= 145 && fb <= 120 && fr - fb >= 75) {
        flankYellowCount += 1;
      } else {
        flankNonYellowR.push(fr);
        flankNonYellowG.push(fg);
        flankNonYellowB.push(fb);
      }
    }
    const bgIsYellowSample = bgR >= 180 && bgG >= 140 && bgB <= 125 && bgR - bgB >= 75;
    const isYellowHeadlineOnScene =
      yellowCoreCount >= Math.max(24, coreTotalCount * 0.08) &&
      flankNonYellowR.length >= 10 &&
      flankYellowCount / Math.max(1, flankRs.length) < 0.35;
    if (bgIsYellowSample && isYellowHeadlineOnScene) {
      bgR = Math.round(medianOf(flankNonYellowR));
      bgG = Math.round(medianOf(flankNonYellowG));
      bgB = Math.round(medianOf(flankNonYellowB));
      bgLumInit = 0.299 * bgR + 0.587 * bgG + 0.114 * bgB;
    }

    const bgMaxChPol = Math.max(bgR, bgG, bgB);
    const isVividColoredBannerPol =
      bgMaxChPol >= 135 && bgMaxChPol - Math.min(bgR, bgG, bgB) >= 65;
    const isBrightYellowOnScene =
      (isYellowHeadlineOnScene ||
        (yellowCoreCount >= Math.max(24, coreTotalCount * 0.08) && bgR - bgB < 80)) &&
      bgLumInit <= 215 &&
      bgLumInit >= 48;
    const preferLightFirst =
      bgLumInit < 28 ||
      (!isVividColoredBannerPol && bgLumInit < 55) ||
      isWhiteFillDarkOutlineOnScene ||
      isBrightYellowOnScene ||
      (bgLumInit < 160 &&
        !(isVividColoredBannerPol && darkerCount >= brighterCount * 0.65) &&
        brighterCount > darkerCount * 2.2 &&
        darkerCount < brighterCount * 0.35);
    const isBlueOrMidPanel = bgB > bgR + 20 || bgLumInit >= 50;
    const isSingleOrDarkSfx =
      preferLightFirst &&
      !isBlueOrMidPanel &&
      !isSingleLineStat &&
      origLineCount === 1 &&
      displayText.length <= 16;

    const isSeamCutGlyphCandidate = (c: ComponentInfo): boolean =>
      c.touchesImageSeamEdge &&
      !c.touchesSideOrWinEdge &&
      c.w <= Math.max(medLineH * 3.8, 96) &&
      c.h <= Math.max(medLineH * 2.0, 48) &&
      c.area <= Math.max(medLineH * medLineH * 2.4, 950) &&
      c.w / Math.max(1, c.h) < 6.0;

    const isStructuralFrameOrDivider = (c: ComponentInfo): boolean => {
      if (c.touchesSideOrWinEdge) return true;
      const seamGlyph = isSeamCutGlyphCandidate(c);
      if (c.touchesBorder && !seamGlyph) return true;
      const coreRatio = c.corePixels / Math.max(1, c.area);
      const extendsOutsideCore =
        c.minx < cx0 - 3 || c.maxx > cx1 + 3 || c.miny < cy0 - 3 || c.maxy > cy1 + 3;
      // Bitişik kalın konturlu tam satır metinler ("EVEN A SMALL", "FOR AMPLIFICATION")
      // tek bağlı bileşen olsa bile asla yapısal çerçeveye atılmaz!
      const looksLikeConnectedTextRow =
        !c.touchesSideOrWinEdge &&
        c.h >= 6 &&
        c.h <= Math.max(medLineH * 2.15, 58) &&
        c.w <= Math.max(bw * 1.18, ww * 0.92) &&
        c.miny >= cy0 - Math.max(8, medLineH * 0.55) &&
        c.maxy <= cy1 + Math.max(8, medLineH * 0.55) &&
        coreRatio >= 0.14;
      // 1. Yatay ayırıcı çizgiler (RPG stat penceresindeki yatay beyaz/siyah ayraç çizgileri)
      if (
        c.w >= Math.max(medLineH * 2.4, Math.min(bw * 0.38, ww * 0.28)) &&
        c.h <= Math.max(12, Math.round(medLineH * 0.45)) &&
        c.w / Math.max(1, c.h) >= 5.5 &&
        coreRatio < 0.45
      ) {
        return true;
      }
      // 2. Dikey ayırıcı / çerçeve duvarı parçaları
      if (
        c.h >= Math.max(bh * 1.15, medLineH * 1.75) &&
        c.w <= Math.max(18, Math.round(medLineH * 0.65)) &&
        c.h / Math.max(1, c.w) >= 3.5 &&
        coreRatio < 0.3
      ) {
        return true;
      }
      // 3. Metin çekirdeğinin dışına taşan ve düşük çekirdek oranına sahip çerçeve/süsleme parçaları
      if (
        !seamGlyph &&
        !looksLikeConnectedTextRow &&
        extendsOutsideCore &&
        coreRatio < 0.28 &&
        (c.w > medLineH * 2.2 || c.h > medLineH * 1.6 || c.area > medLineH * medLineH * 1.4)
      ) {
        return true;
      }
      // 4. Metin çekirdeğini dıştan kuşatan veya pencere/balon boyutuna ulaşan çerçeveler (dikenli halka, RPG kutusu çerçevesi)
      if (
        (!looksLikeConnectedTextRow && coreRatio < 0.42 && c.w >= ww * 0.88) ||
        (c.h >= wh * 0.75 && coreRatio < 0.42) ||
        (!looksLikeConnectedTextRow &&
          (c.w > Math.max(bw * 0.82, medLineH * 3.6) || c.h > Math.max(bh * 1.22, medLineH * 1.85)) &&
          coreRatio < 0.28) ||
        (c.minx < cx0 - 4 &&
          c.maxx > cx1 + 4 &&
          c.miny < cy0 - 4 &&
          c.maxy > cy1 + 4 &&
          coreRatio < 0.35)
      ) {
        return true;
      }
      return false;
    };

    const isValidGlyphComponent = (c: ComponentInfo): boolean => {
      if (c.area < 2) return false;
      if (isStructuralFrameOrDivider(c)) return false;
      if (overlapsAnySiblingAbs(curWx0 + c.minx, curWy0 + c.miny, curWx0 + c.maxx + 1, curWy0 + c.maxy + 1)) {
        return false;
      }
      const coreRatio = c.corePixels / Math.max(1, c.area);
      const coreBoxArea = Math.max(1, bw * bh);
      if (isSingleOrDarkSfx) {
        if (
          coreRatio < 0.28 &&
          (c.maxy > cy1 + Math.max(14, medLineH * 0.45) ||
            c.miny < cy0 - Math.max(14, medLineH * 0.45) ||
            c.maxx > cx1 + Math.max(28, medLineH * 0.9) ||
            c.minx < cx0 - Math.max(28, medLineH * 0.9))
        ) {
          return false;
        }
        if (coreRatio >= 0.22 && c.area <= coreBoxArea * 1.45) {
          return true;
        }
        return c.w <= Math.max(bw * 1.35, ww * 0.9) && c.h <= Math.max(bh * 2.8, wh * 0.88);
      }
      const isContainedInParagraphBand =
        !c.touchesBorder &&
        c.miny >= cy0 - Math.max(8, medLineH * 0.65) &&
        c.maxy <= cy1 + Math.max(8, medLineH * 0.65) &&
        c.minx <= cx1 + Math.max(36, medLineH * 1.55) &&
        c.maxx >= cx0 - Math.max(36, medLineH * 1.55) &&
        c.h >= 4 &&
        c.h <= Math.max(medLineH * 2.4, 58) &&
        c.w <= Math.max(bw * 1.25, ww * 0.95, 450);
      const farOutsideBand =
        !c.overlapsCore &&
        !isContainedInParagraphBand &&
        (c.miny < cy0 - 6 || c.maxy > cy1 + 6);
      if (farOutsideBand && c.area > 18 && !preferLightFirst) {
        return false;
      }
      const isStrongCoreOrGlowingWord =
        !c.touchesBorder &&
        (coreRatio >= 0.32 ||
          (preferLightFirst && isContainedInParagraphBand) ||
          (coreRatio >= 0.14 && c.overlapsCore && c.h <= Math.max(medLineH * 2.15, 58)));
      const maxAllowedCompH = isStrongCoreOrGlowingWord
        ? Math.max(medLineH * 2.5, 58)
        : Math.max(medLineH * 1.65, 32);
      const maxAllowedCompW = isStrongCoreOrGlowingWord
        ? Math.max(bw * 1.25, ww * 0.95, 450)
        : coreRatio >= 0.45
          ? Math.max(medLineH * 5.2, 96)
          : Math.max(medLineH * 3.2, 64);
      if (c.h > maxAllowedCompH || c.w > maxAllowedCompW) return false;
      const maxH = Math.max(medLineH, 18);
      if (
        !isSingleOrDarkSfx &&
        c.overlapsCore &&
        coreRatio < 0.38 &&
        (c.minx < cx0 - Math.max(26, maxH * 1.1) ||
          c.maxx > cx1 + Math.max(26, maxH * 1.1) ||
          c.miny < cy0 - Math.max(16, maxH * 0.65) ||
          c.maxy > cy1 + Math.max(16, maxH * 0.65))
      ) {
        return false;
      }
      if (
        c.area > medLineH * medLineH * 0.75 &&
        coreRatio < 0.16 &&
        !(preferLightFirst && isContainedInParagraphBand)
      ) {
        return false;
      }
      return true;
    };

    const getAcceptedSpanW = (acc: Set<number>, vList: ComponentInfo[]): number => {
      let minX = Infinity;
      let maxX = -Infinity;
      for (const c of vList) {
        if (!acc.has(c.id)) continue;
        if (c.minx < minX) minX = c.minx;
        if (c.maxx > maxX) maxX = c.maxx;
      }
      return maxX >= minX ? maxX - minX + 1 : 0;
    };

    const isVividChromaticComp = (lbls: Int32Array, cand: ComponentInfo): boolean => {
      let samples = 0;
      let vivid = 0;
      const syStep = cand.h > 24 ? 2 : 1;
      const sxStep = cand.w > 24 ? 2 : 1;
      for (let py = cand.miny; py <= cand.maxy; py += syStep) {
        const rOff = py * ww;
        for (let px = cand.minx; px <= cand.maxx; px += sxStep) {
          const idx = rOff + px;
          if (lbls[idx] !== cand.id) continue;
          const c3 = idx * 3;
          const chr =
            Math.max(winRgb[c3], winRgb[c3 + 1], winRgb[c3 + 2]) -
            Math.min(winRgb[c3], winRgb[c3 + 1], winRgb[c3 + 2]);
          samples += 1;
          if (chr >= 70) vivid += 1;
        }
      }
      return samples >= 6 && vivid / samples >= 0.55;
    };

    const runMaskPass = (fgMask: Uint8Array) => {
      let res = extractComponents(fgMask);
      if (!preferLightFirst && jetBlackCoreCount >= 14 && whiteCoreCount >= 14) {
        const mergedBorderIds = new Set<number>();
        for (const c of res.comps) {
          if (c.touchesBorder && c.overlapsCore && c.area >= Math.max(1800, bw * bh * 0.25)) {
            mergedBorderIds.add(c.id);
          }
        }
        if (mergedBorderIds.size > 0) {
          const splitMask = new Uint8Array(fgMask);
          let stripped = 0;
          for (let i = 0; i < numPixels; i += 1) {
            if (!mergedBorderIds.has(res.labels[i])) continue;
            const c3 = i * 3;
            const pixLum = 0.299 * winRgb[c3] + 0.587 * winRgb[c3 + 1] + 0.114 * winRgb[c3 + 2];
            if (pixLum > 58) {
              splitMask[i] = 0;
              stripped += 1;
            }
          }
          if (stripped > 0) {
            res = extractComponents(splitMask);
          }
        }
      }
      const v = res.comps.filter(isValidGlyphComponent);
      const acc = new Set<number>(
        v
          .filter(
            (c) =>
              c.overlapsCore ||
              (preferLightFirst &&
                !c.touchesBorder &&
                c.minx >= cx0 - Math.max(medLineH * 1.25, 42) &&
                c.maxx <= cx1 + Math.max(medLineH * 1.25, 42) &&
                c.miny >= cy0 - 4 &&
                c.maxy <= cy1 + 4 &&
                c.h >= 10 &&
                c.h <= Math.max(medLineH * 2.2, 54) &&
                c.w <= Math.max(medLineH * 3.5, Math.min(bw * 1.08, ww * 0.9))),
          )
          .map((c) => c.id),
      );
      if (!preferLightFirst && bgLumInit >= 195 && acc.size >= 4) {
        let neutralCount = 0;
        let neutralArea = 0;
        const vividSeeds: ComponentInfo[] = [];
        for (const c of v) {
          if (!acc.has(c.id)) continue;
          if (isVividChromaticComp(res.labels, c)) {
            vividSeeds.push(c);
          } else {
            neutralCount += 1;
            neutralArea += c.area;
          }
        }
        if (neutralCount >= 4 && neutralArea >= 40 && vividSeeds.length > 0) {
          const edgePadX = Math.max(24, Math.round(bw * 0.25));
          for (const vc of vividSeeds) {
            if (
              vc.maxx > cx1 - edgePadX ||
              vc.minx < cx0 + edgePadX ||
              vc.h >= medLineH * 1.25
            ) {
              acc.delete(vc.id);
            }
          }
        }
      }
      return { ...res, valid: v, accepted: acc, spanW: getAcceptedSpanW(acc, v) };
    };

    const yellowHeadlineOnlyMask =
      isBrightYellowOnScene && whiteCoreCount < Math.max(24, yellowCoreCount * 0.35);

    // Arka plan koyuysa ("NO.", "FIRST MURDER.") parlak maskeden başla;
    // aksi halde ("KIM JEONGHYUK", "31 AÑOS" ve tüm konuşma balonları) koyu mürekkep maskesinden başla.
    let pass = runMaskPass(
      preferLightFirst
        ? buildLightForegroundMask(16, 26, yellowHeadlineOnlyMask)
        : buildDarkForegroundMask(20, 32),
    );

    if (pass.accepted.size === 0 || pass.spanW < bw * (isSingleLineStat ? 0.62 : 0.32)) {
      const gentlePass = runMaskPass(
        preferLightFirst
          ? buildLightForegroundMask(10, 16, yellowHeadlineOnlyMask)
          : buildDarkForegroundMask(11, 18),
      );
      if (gentlePass.spanW > pass.spanW) pass = gentlePass;
    }

    if (pass.accepted.size === 0 || pass.spanW < bw * 0.22) {
      if (!(preferLightFirst && darkerCount < brighterCount * 0.25)) {
        const altPass = runMaskPass(
          preferLightFirst
            ? buildDarkForegroundMask(16, 26)
            : buildLightForegroundMask(18, 28, yellowHeadlineOnlyMask),
        );
        if (altPass.spanW > pass.spanW) pass = altPass;
      }
    }

    const { labels, comps, valid, accepted } = pass;

    // OCR kutusunun kenarında kesilmiş harfleri ("?", "!", "ER.", "ALONE?") komşu balonlara,
    // RPG çerçeve duvarlarına veya yatay ayraç çizgilerine sıçramadan kontrollü olarak büyüt
    const isTiltedOpenLightScene =
      preferLightFirst && lineCores.some((l) => Math.abs(l.angleDeg ?? 0) >= 5);
    const maxGrowX = isTiltedOpenLightScene
      ? Math.min(28, Math.max(14, Math.round(medLineH * 0.25)))
      : isSingleOrDarkSfx
        ? Math.max(64, bh * 2.1, bw * 0.58)
        : Math.min(54, Math.max(18, Math.round(medLineH * 1.55)));
    const maxGrowY = isSingleOrDarkSfx
      ? Math.max(46, bh * 1.45)
      : Math.min(16, Math.max(8, Math.round(medLineH * 0.42)));
    const allowedMinX = Math.max(1, cx0 - maxGrowX);
    const allowedMaxX = Math.min(ww - 2, cx1 + maxGrowX);
    const allowedMinY = Math.max(1, cy0 - maxGrowY);
    const allowedMaxY = Math.min(wh - 2, cy1 + maxGrowY);

    const hasDarkBubbleWallBetween = (c: ComponentInfo, a: ComponentInfo): boolean => {
      if (preferLightFirst || bgLumInit < 140) return false;
      const gx0 = Math.min(c.maxx, a.maxx) + 1;
      const gx1 = Math.max(c.minx, a.minx) - 1;
      if (gx1 - gx0 < 2) return false;
      const midY = clamp(Math.round((Math.max(c.miny, a.miny) + Math.min(c.maxy, a.maxy)) * 0.5), 0, wh - 1);
      let darkRun = 0;
      for (let x = gx0; x <= gx1; x += 1) {
        const cIdx = (midY * ww + x) * 3;
        const lum = 0.299 * winRgb[cIdx] + 0.587 * winRgb[cIdx + 1] + 0.114 * winRgb[cIdx + 2];
        if (lum <= 95) {
          darkRun += 1;
          if (darkRun >= 2) return true;
        } else {
          darkRun = 0;
        }
      }
      return false;
    };

    const isHalftoneScreentoneDot = (cand: ComponentInfo): boolean => {
      if (cand.overlapsCore || cand.area > 360 || cand.w > 22 || cand.h > 22) return false;
      const isTinyDot = cand.area <= 18 && cand.w <= 6 && cand.h <= 6;
      const aspect = Math.max(cand.w, cand.h) / Math.max(1, Math.min(cand.w, cand.h));
      const fillRatio = cand.area / Math.max(1, cand.w * cand.h);
      if (!isTinyDot && (aspect > 1.8 || fillRatio < 0.48)) return false;
      const cx = (cand.minx + cand.maxx) * 0.5;
      const cy = (cand.miny + cand.maxy) * 0.5;
      const searchR = isTinyDot ? 22 : Math.max(28, Math.round(Math.max(cand.w, cand.h) * 3.8));
      let similarNeighbors = 0;
      let verticalOrDiagNeighbors = 0;
      for (const other of valid) {
        if (other.id === cand.id) continue;
        if (other.area > 360 || other.w > 22 || other.h > 22) continue;
        if (!isTinyDot) {
          if (Math.abs(other.w - cand.w) > 6 || Math.abs(other.h - cand.h) > 6) continue;
        } else if (other.area > 18 || other.w > 6 || other.h > 6) {
          continue;
        }
        const ox = (other.minx + other.maxx) * 0.5;
        const oy = (other.miny + other.maxy) * 0.5;
        if (Math.abs(ox - cx) <= searchR && Math.abs(oy - cy) <= searchR) {
          similarNeighbors += 1;
          if (Math.abs(oy - cy) >= Math.max(4, cand.h * 0.45)) {
            verticalOrDiagNeighbors += 1;
          }
          if (similarNeighbors >= 5 && (isTinyDot || verticalOrDiagNeighbors >= 2)) return true;
        }
      }
      return false;
    };

    // Çekirdek içindeki mürekkep nötr (siyah/gri) ise dışarıdan canlı renkli sütun/sanat (ör. kırmızı "NEW") yutmayı engelle
    let coreNeutralInk = false;
    if (!preferLightFirst && bgLumInit >= 195) {
      let cSamples = 0;
      let cNeutral = 0;
      for (let py = Math.max(0, cy0); py < Math.min(wh, cy1); py += 2) {
        const rOff = py * ww;
        for (let px = Math.max(0, cx0); px < Math.min(ww, cx1); px += 2) {
          const idx = rOff + px;
          if (!accepted.has(labels[idx])) continue;
          const c3 = idx * 3;
          const chr =
            Math.max(winRgb[c3], winRgb[c3 + 1], winRgb[c3 + 2]) -
            Math.min(winRgb[c3], winRgb[c3 + 1], winRgb[c3 + 2]);
          cSamples += 1;
          if (chr <= 35) cNeutral += 1;
        }
      }
      coreNeutralInk = cSamples >= 12 && cNeutral / cSamples >= 0.78;
    }

    const isVividExternalSidebarArt = (cand: ComponentInfo): boolean => {
      if (!coreNeutralInk) return false;
      return isVividChromaticComp(labels, cand);
    };

    let changed = true;
    let growIter = 0;
    const maxGrowIter = isSingleOrDarkSfx ? 4 : 3;
    while (changed && growIter < maxGrowIter) {
      changed = false;
      growIter += 1;
      const accComps = valid.filter((c) => accepted.has(c.id));
      if (accComps.length === 0) break;

      const heights = accComps.filter((c) => c.h >= 6).map((c) => c.h);
      const maxH = heights.length > 0 ? Math.max(...heights) : Math.max(20, bh * 0.5);
      const medH = heights.length > 0 ? medianOf(heights) : 20;
      const padX = Math.min(
        maxGrowX,
        isSingleOrDarkSfx ? Math.max(18, medH * 1.35) : Math.max(10, Math.round(medH * 0.68)),
      );
      const padY = Math.min(
        maxGrowY,
        isSingleOrDarkSfx ? Math.max(12, medH * 0.85) : Math.max(6, Math.round(medH * 0.35)),
      );

      const maxCompH = isSingleOrDarkSfx
        ? Math.max(medH * 3.8, maxH * 3.2, bh * 2.8)
        : Math.max(medH * 2.4, medLineH * 2.4, 56);
      const maxCompW = isSingleOrDarkSfx
        ? Math.max(medH * 6.0, bw * 1.2)
        : preferLightFirst
          ? Math.max(bw * 1.2, ww * 0.95, 450)
          : Math.max(medH * 3.2, medLineH * 3.2, 72);
      for (const c of valid) {
        if (accepted.has(c.id)) continue;
        if (c.minx < allowedMinX || c.maxx > allowedMaxX || c.miny < allowedMinY || c.maxy > allowedMaxY) {
          continue;
        }
        // Nokta gürültülerini ve manga halftone/screentone dokularını dışarıdan toplama
        if ((c.area < 6 && !c.overlapsCore) || isHalftoneScreentoneDot(c) || isVividExternalSidebarArt(c)) continue;
        if (c.h > maxCompH || c.w > maxCompW) {
          continue;
        }
        // Tüm dikdörtgen köşelerini değil, yalnızca mevcut harflere satır hizasında bitişik olan parçaları ekle
        // Eğik yazı ("T", "S", "I", "A") kenar taşmalarında aynı satır kuşağını araliksız tarar ama balon duvarını aşmaz!
        let nearExistingGlyph = false;
        const rowReachX = Math.min(52, Math.max(padX, Math.round(medLineH * 1.25)));
        for (let k = 0; k < accComps.length; k += 1) {
          const a = accComps[k];
          const gapX = Math.max(c.minx - a.maxx, a.minx - c.maxx, 0);
          const vOv = Math.min(c.maxy, a.maxy) - Math.max(c.miny, a.miny);
          const gapY = Math.max(c.miny - a.maxy, a.miny - c.maxy, 0);
          const hOv = Math.min(c.maxx, a.maxx) - Math.max(c.minx, a.minx);
          const sameHeightScale = Math.max(c.h, a.h) / Math.max(1, Math.min(c.h, a.h)) <= 1.6;
          const strongRowMatch =
            !isSingleOrDarkSfx &&
            gapX <= rowReachX &&
            vOv >= Math.min(c.h, a.h) * 0.42 &&
            sameHeightScale &&
            c.h <= medLineH * 1.65 &&
            !hasDarkBubbleWallBetween(c, a);
          const outsideCoreX = c.maxx < cx0 - 4 || c.minx > cx1 + 4;
          const exteriorSizeOk =
            c.overlapsCore ||
            isSingleOrDarkSfx ||
            (outsideCoreX
              ? !isVividExternalSidebarArt(c) && c.h <= medH * 1.42 && c.w <= medH * 1.55
              : c.h <= medH * 1.48 && c.w <= medH * 2.1);
          if (
            exteriorSizeOk &&
            (strongRowMatch ||
              (gapX <= padX && (vOv >= Math.min(c.h, a.h) * 0.2 || gapY <= padY * 0.65)) ||
              (gapY <= padY && hOv >= 0))
          ) {
            nearExistingGlyph = true;
            break;
          }
        }
        if (nearExistingGlyph) {
          accepted.add(c.id);
          changed = true;
        }
      }
    }

    // Pencere sınırına ("wx1" vb.) çarptığı için `touchesBorder=true` olan ama tam OCR satır kuşağında
    // yer alan harf parçası var mı kontrol et (ör. "FIRST MURDER." kelimesinin sağdaki "ER." kısmı!)
    let expandLeft = 0;
    let expandRight = 0;
    let expandTop = 0;
    let expandBottom = 0;

    const lineSpanLimit = Math.max(medLineH, 22);
    for (const c of comps) {
      if (!c.touchesBorder) continue;
      // Eğer bileşen satır yüksekliğiyle uyumluysa (tüm pencereyi boydan boya geçen panel çizgisi değilse)
      // ve OCR çekirdeğine yakınsa, pencereyi o yönde genişlet!
      const vOverlapCore = Math.min(c.maxy, cy1 + 8) - Math.max(c.miny, cy0 - 8);
      if (
        c.h <= lineSpanLimit * 2.4 &&
        c.w <= Math.min(bw * 1.15, lineSpanLimit * 5) &&
        vOverlapCore >= Math.min(c.h, lineSpanLimit) * 0.45
      ) {
        if (c.minx <= 2 && curWx0 > 0 && cx0 - c.maxx <= lineSpanLimit * 1.25) {
          expandLeft = Math.max(expandLeft, Math.round(lineSpanLimit * 1.4 + 24));
        }
        if (c.maxx >= ww - 3 && curWx1 < fullWidth && c.minx - cx1 <= lineSpanLimit * 1.25) {
          expandRight = Math.max(expandRight, Math.round(lineSpanLimit * 1.4 + 24));
        }
      }
      const hOverlapCore = Math.min(c.maxx, cx1 + 12) - Math.max(c.minx, cx0 - 12);
      if (
        c.w <= Math.min(bw * 1.2, lineSpanLimit * 6) &&
        c.h <= lineSpanLimit * 2.2 &&
        hOverlapCore >= Math.min(c.w, bw) * 0.45
      ) {
        if (c.miny <= 2 && curWy0 > 0 && cy0 - c.maxy <= lineSpanLimit * 1.1) {
          expandTop = Math.max(expandTop, Math.round(lineSpanLimit * 1.2 + 24));
        }
        if (c.maxy >= wh - 3 && curWy1 < fullHeight && c.miny - cy1 <= lineSpanLimit * 1.1) {
          expandBottom = Math.max(expandBottom, Math.round(lineSpanLimit * 1.2 + 24));
        }
      }
    }

    return {
      imgData,
      rgba,
      winRgb,
      ww,
      wh,
      numPixels,
      cx0,
      cy0,
      cx1,
      cy1,
      bgR,
      bgG,
      bgB,
      labels,
      comps,
      valid,
      accepted,
      isStructuralFrameOrDivider,
      medLineH,
      preferLightFirst,
      isBlueOrMidPanel,
      isSingleOrDarkSfx,
      whiteCoreCount,
      expandLeft,
      expandRight,
      expandTop,
      expandBottom,
      lineCores,
      isVividExternalSidebarArt,
    };
  };

  let winResult = analyzeWindow(wx0, wy0, wx1, wy1);
  if (!winResult) return null;

  // Eğer metin pencere sınırına dayandıysa ("ER." gibi), pencereyi genişletip tek seferde yeniden analiz et
  if (
    winResult.expandLeft > 0 ||
    winResult.expandRight > 0 ||
    winResult.expandTop > 0 ||
    winResult.expandBottom > 0
  ) {
    wx0 = Math.max(0, wx0 - winResult.expandLeft);
    wx1 = Math.min(fullWidth, wx1 + winResult.expandRight);
    wy0 = Math.max(0, wy0 - winResult.expandTop);
    wy1 = Math.min(fullHeight, wy1 + winResult.expandBottom);
    const expanded = analyzeWindow(wx0, wy0, wx1, wy1);
    if (expanded && expanded.accepted.size > 0) {
      winResult = expanded;
    }
  }

  const {
    imgData,
    rgba,
    winRgb,
    ww,
    wh,
    numPixels,
    cx0,
    cy0,
    cx1,
    cy1,
    bgR,
    bgG,
    bgB,
    labels,
    comps,
    valid,
    accepted,
    isStructuralFrameOrDivider,
    medLineH,
    preferLightFirst,
    isBlueOrMidPanel,
    isSingleOrDarkSfx,
    whiteCoreCount,
    lineCores,
    isVividExternalSidebarArt,
  } = winResult;

  if (accepted.size === 0) {
    return null;
  }

  const bgLumInit = 0.299 * bgR + 0.587 * bgG + 0.114 * bgB;

  // Yapısal balon sınırlarını, RPG çerçevelerini ve yatay/dikey ayraç çizgilerini koruma maskesine al.
  // preferLightFirst sahnelerinde büyük, katı sahne arka plan bloklarını çerçeve sanıp borderMask/ringMed içine sokma.
  const borderIds = new Set<number>(
    comps
      .filter((c) => {
        if (accepted.has(c.id) || !isStructuralFrameOrDivider(c)) return false;
        if (!preferLightFirst) return true;
        const fillRatio = c.area / Math.max(1, c.w * c.h);
        return c.w <= 16 || c.h <= 16 || fillRatio < 0.22;
      })
      .map((c) => c.id),
  );
  const borderMask = new Uint8Array(numPixels);
  const rawGlyphMask = new Uint8Array(numPixels);

  for (let i = 0; i < numPixels; i += 1) {
    const lbl = labels[i];
    if (lbl !== 0) {
      if (accepted.has(lbl)) rawGlyphMask[i] = 1;
      else if (borderIds.has(lbl)) borderMask[i] = 1;
    } else if (bgLumInit >= 195) {
      // Kalın siyah konuşma balonu/dikenli daire duvarlarının iç dolgusunu (~30-50px kalınlık),
      // integral penceresi ortalaması (<160) yüzünden `fg` dışında kalmış olsa bile koruma maskesine al.
      const ly = (i / ww) | 0;
      const lx = i - ly * ww;
      if (lx < cx0 - 2 || lx > cx1 + 2 || ly < cy0 - 2 || ly > cy1 + 2) {
        const cIdx = i * 3;
        const pr = winRgb[cIdx];
        const pg = winRgb[cIdx + 1];
        const pb = winRgb[cIdx + 2];
        const pixLum = 0.299 * pr + 0.587 * pg + 0.114 * pb;
        const dBg = Math.max(Math.abs(pr - bgR), Math.abs(pg - bgG), Math.abs(pb - bgB));
        if (pixLum < 105 && dBg >= 85) {
          borderMask[i] = 1;
        }
      }
    }
  }

  // Orijinal harf kümesinin sınırlarını ve medyan harf boyutunu hesapla
  let accComps = valid.filter((c) => accepted.has(c.id));
  let gMinX = ww;
  let gMaxX = 0;
  let gMinY = wh;
  let gMaxY = 0;
  for (const c of accComps) {
    if (c.minx < gMinX) gMinX = c.minx;
    if (c.maxx > gMaxX) gMaxX = c.maxx;
    if (c.miny < gMinY) gMinY = c.miny;
    if (c.maxy > gMaxY) gMaxY = c.maxy;
  }

  const glyphHeights = accComps.filter((c) => c.h >= 7).map((c) => c.h);
  const glyphWidths = accComps.filter((c) => c.h >= 7).map((c) => c.w);
  const rawMedGlyphH =
    glyphHeights.length > 0 ? medianOf(glyphHeights) : Math.max(16, fullWidth * 0.025);
  const medGlyphH = isSingleLineStat ? Math.max(rawMedGlyphH, bh * 0.82) : rawMedGlyphH;
  const medGlyphW =
    glyphWidths.length > 0 ? medianOf(glyphWidths) : Math.max(12, medGlyphH * 0.65);

  // Balonun gerçek iç boşluğunu (safeLeft..safeRight, safeTop..safeBottom) yalnızca gerçek yapısal duvarlardan (borderMask) ölç!
  // İçerideki kabul edilmemiş harfler ("SO" veya bölünmüş harf üstleri) ASLA balon duvarı sayılamaz!
  const midLocalYInit = Math.round((gMinY + gMaxY) * 0.5);
  const midLocalXInit = Math.round((gMinX + gMaxX) * 0.5);
  const bandHalfY = Math.max(10, Math.round(Math.max(gMaxY - gMinY, medGlyphH * 1.8) * 0.24));
  const bandY0 = clamp(midLocalYInit - bandHalfY, 0, wh - 1);
  const bandY1 = clamp(midLocalYInit + bandHalfY, 0, wh - 1);

  const isStructuralWallAt = (lx: number, ly: number): boolean => borderMask[ly * ww + lx] === 1;
  const isNeutralBrightBg =
    bgLumInit >= 215 && Math.max(bgR, bgG, bgB) - Math.min(bgR, bgG, bgB) <= 25;
  const chromaScanY0 = clamp(Math.min(cy0, gMinY), 0, wh - 1);
  const chromaScanY1 = clamp(Math.max(cy1, gMaxY), 0, wh - 1);
  const hasChromaticSidebarAt = (lx: number): boolean => {
    if (!isNeutralBrightBg) return false;
    let hits = 0;
    for (let y = chromaScanY0; y <= chromaScanY1; y += 2) {
      const idx = y * ww + lx;
      if (rawGlyphMask[idx]) continue;
      const c3 = idx * 3;
      const pr = winRgb[c3];
      const pg = winRgb[c3 + 1];
      const pb = winRgb[c3 + 2];
      const chr = Math.max(pr, pg, pb) - Math.min(pr, pg, pb);
      if (chr >= 75 && Math.abs(pr - bgR) + Math.abs(pg - bgG) + Math.abs(pb - bgB) >= 140) {
        hits += 1;
        if (hits >= 3) return true;
      }
    }
    return false;
  };

  const wallPadX = clamp(Math.round(medGlyphH * 0.16), 3, 6);
  const wallPadY = clamp(Math.round(medGlyphH * 0.2), 4, 8);

  let safeLocalLeft = 0;
  let hitLeftWall = false;
  for (let x = gMinX; x >= 0; x -= 1) {
    let hit = false;
    for (let y = bandY0; y <= bandY1; y += 2) {
      if (isStructuralWallAt(x, y)) {
        hit = true;
        break;
      }
    }
    if (!hit && x < gMinX - 4 && hasChromaticSidebarAt(x)) {
      hit = true;
    }
    if (hit) {
      safeLocalLeft = x + wallPadX;
      hitLeftWall = true;
      break;
    }
  }

  let safeLocalRight = ww;
  let hitRightWall = false;
  for (let x = gMaxX; x < ww; x += 1) {
    let hit = false;
    for (let y = bandY0; y <= bandY1; y += 2) {
      if (isStructuralWallAt(x, y)) {
        hit = true;
        break;
      }
    }
    if (!hit && x > gMaxX + 4 && hasChromaticSidebarAt(x)) {
      hit = true;
    }
    if (hit) {
      safeLocalRight = x - wallPadX;
      hitRightWall = true;
      break;
    }
  }

  const bandHalfX = Math.max(8, Math.round((gMaxX - gMinX) * 0.26));
  const bandX0 = clamp(midLocalXInit - bandHalfX, 0, ww - 1);
  const bandX1 = clamp(midLocalXInit + bandHalfX, 0, ww - 1);

  let safeLocalTop = 0;
  let hitTopWall = false;
  for (let y = gMinY; y >= 0; y -= 1) {
    let hit = false;
    for (let x = bandX0; x <= bandX1; x += 3) {
      if (isStructuralWallAt(x, y)) {
        hit = true;
        break;
      }
    }
    if (hit) {
      safeLocalTop = y + wallPadY;
      hitTopWall = true;
      break;
    }
  }

  let safeLocalBottom = wh;
  let hitBottomWall = false;
  for (let y = gMaxY; y < wh; y += 1) {
    let hit = false;
    for (let x = bandX0; x <= bandX1; x += 3) {
      if (isStructuralWallAt(x, y)) {
        hit = true;
        break;
      }
    }
    if (hit) {
      safeLocalBottom = y - wallPadY;
      hitBottomWall = true;
      break;
    }
  }

  // Kapalı oval balonlarda ("YOU WILL NEVER OBTAIN...") alt ve üst satırlar ekvatordan daha dardır;
  // %14-%28 ve %72-%86 bantlarında iç kiriş genişliğini ölçerek son/ilk satırın oval kenarına çarpmasını önle
  let ovalChordSafeW = ww;
  if (
    hitLeftWall &&
    hitRightWall &&
    hitTopWall &&
    hitBottomWall &&
    safeLocalBottom > safeLocalTop + medGlyphH * 2.2
  ) {
    const innerH = safeLocalBottom - safeLocalTop;
    const topBandY0 = clamp(Math.round(safeLocalTop + innerH * 0.14), 0, wh - 1);
    const topBandY1 = clamp(Math.round(safeLocalTop + innerH * 0.28), 0, wh - 1);
    const botBandY0 = clamp(Math.round(safeLocalTop + innerH * 0.72), 0, wh - 1);
    const botBandY1 = clamp(Math.round(safeLocalTop + innerH * 0.86), 0, wh - 1);
    const scanBandWidth = (by0: number, by1: number): number => {
      const midX = clamp(Math.round((safeLocalLeft + safeLocalRight) * 0.5), 0, ww - 1);
      let lWall = safeLocalLeft;
      for (let x = midX; x >= 0; x -= 1) {
        let hit = false;
        for (let y = by0; y <= by1; y += 2) {
          if (isStructuralWallAt(x, y)) {
            hit = true;
            break;
          }
        }
        if (hit) {
          lWall = x + wallPadX;
          break;
        }
      }
      let rWall = safeLocalRight;
      for (let x = midX; x < ww; x += 1) {
        let hit = false;
        for (let y = by0; y <= by1; y += 2) {
          if (isStructuralWallAt(x, y)) {
            hit = true;
            break;
          }
        }
        if (hit) {
          rWall = x - wallPadX;
          break;
        }
      }
      return Math.max(24, rWall - lWall);
    };
    const topChordW = scanBandWidth(topBandY0, topBandY1);
    const botChordW = scanBandWidth(botBandY0, botBandY1);
    ovalChordSafeW = Math.min(topChordW, botChordW);
  }

  // Çift tonlu keskin panel bölünmelerinde (örn. üst yarı saf beyaz + alt yarı saf siyah panel)
  // karşı kutuptaki düz bölgeyi yapısal duvar say ki ne silme yaması sınırı aşsın ne de çeviri diğer yarıya taşsın
  const horizonScanMax = clamp(Math.round(medGlyphH * 1.5), 22, 48);
  const hx0 = clamp(cx0, 0, ww - 1);
  const hx1 = clamp(cx1, hx0, ww - 1);
  const hSpan = hx1 - hx0 + 1;
  if (hSpan >= 24 && (bgLumInit >= 180 || bgLumInit <= 75)) {
    const isRowOppositeFlat = (ry: number): boolean => {
      if (ry < 0 || ry >= wh) return false;
      const rOff = ry * ww;
      let samples = 0;
      let match = 0;
      for (let x = hx0; x <= hx1; x += 2) {
        samples += 1;
        const cIdx = (rOff + x) * 3;
        const l = 0.299 * winRgb[cIdx] + 0.587 * winRgb[cIdx + 1] + 0.114 * winRgb[cIdx + 2];
        if (bgLumInit <= 75 ? l >= 195 : l <= 55) match += 1;
      }
      return samples >= 8 && match / samples >= 0.82;
    };
    const isSolidHorizonAt = (ry: number, dir: -1 | 1): boolean =>
      isRowOppositeFlat(ry) && isRowOppositeFlat(ry + dir * 2) && isRowOppositeFlat(ry + dir * 4);

    if (!hitTopWall) {
      for (let y = gMinY - 1; y >= Math.max(4, gMinY - horizonScanMax); y -= 1) {
        if (isSolidHorizonAt(y, -1)) {
          safeLocalTop = Math.max(safeLocalTop, y + Math.max(2, Math.round(medGlyphH * 0.14)));
          hitTopWall = true;
          for (let py = 0; py <= y; py += 1) {
            const pOff = py * ww;
            for (let px = 0; px < ww; px += 1) {
              const pIdx = pOff + px;
              if (rawGlyphMask[pIdx]) continue;
              const cIdx = pIdx * 3;
              const l = 0.299 * winRgb[cIdx] + 0.587 * winRgb[cIdx + 1] + 0.114 * winRgb[cIdx + 2];
              if (bgLumInit <= 75 ? l >= 145 : l <= 95) borderMask[pIdx] = 1;
            }
          }
          break;
        }
      }
    }
    if (!hitBottomWall) {
      for (let y = gMaxY + 1; y <= Math.min(wh - 5, gMaxY + horizonScanMax); y += 1) {
        if (isSolidHorizonAt(y, 1)) {
          safeLocalBottom = Math.min(safeLocalBottom, y - Math.max(2, Math.round(medGlyphH * 0.12)));
          hitBottomWall = true;
          for (let py = y; py < wh; py += 1) {
            const pOff = py * ww;
            for (let px = 0; px < ww; px += 1) {
              const pIdx = pOff + px;
              if (rawGlyphMask[pIdx]) continue;
              const cIdx = pIdx * 3;
              const l = 0.299 * winRgb[cIdx] + 0.587 * winRgb[cIdx + 1] + 0.114 * winRgb[cIdx + 2];
              if (bgLumInit <= 75 ? l >= 145 : l <= 95) borderMask[pIdx] = 1;
            }
          }
          break;
        }
      }
    }
  }

  // Komşu balon sınırlarını ve sayfa kenarlarını dikkate al (ikiz balon ve dikey blok taşmasını engelle)
  const gAbsY0 = wy0 + gMinY;
  const gAbsY1 = wy0 + gMaxY;
  const gAbsX0 = wx0 + gMinX;
  const gAbsX1 = wx0 + gMaxX;
  const gAbsMidX = (gAbsX0 + gAbsX1) * 0.5;
  const gAbsMidY = (gAbsY0 + gAbsY1) * 0.5;
  let sibMinBoundYAbs = 0;
  let sibMaxBoundYAbs = fullHeight;
  for (let i = 0; i < absSiblings.length; i += 1) {
    const sib = absSiblings[i];
    const vOv = Math.min(gAbsY1, sib.y1) - Math.max(gAbsY0, sib.y0);
    if (vOv >= Math.min(gMaxY - gMinY + 1, sib.y1 - sib.y0) * 0.25) {
      const sibMidX = (sib.x0 + sib.x1) * 0.5;
      if (sibMidX < gAbsMidX && sib.x1 <= wx0 + gMinX + 8) {
        safeLocalLeft = Math.max(safeLocalLeft, sib.x1 - wx0 + 8);
      } else if (sibMidX > gAbsMidX && sib.x0 >= wx0 + gMaxX - 8) {
        safeLocalRight = Math.min(safeLocalRight, sib.x0 - wx0 - 8);
      }
    }
    const hOv = Math.min(gAbsX1, sib.x1) - Math.max(gAbsX0, sib.x0);
    if (hOv >= Math.min(gMaxX - gMinX + 1, sib.x1 - sib.x0) * 0.25) {
      const sibMidY = (sib.y0 + sib.y1) * 0.5;
      if (sibMidY < gAbsMidY && sib.y1 <= gAbsY0 + 14) {
        const sepY = Math.max(sib.y1 + 1, Math.round((sib.y1 + gAbsY0) * 0.5) + 1);
        safeLocalTop = Math.max(safeLocalTop, sepY - wy0);
        sibMinBoundYAbs = Math.max(sibMinBoundYAbs, sepY);
        hitTopWall = true;
      } else if (sibMidY > gAbsMidY && sib.y0 >= gAbsY1 - 14) {
        const sepY = Math.min(sib.y0 - 1, Math.round((sib.y0 + gAbsY1) * 0.5) - 1);
        safeLocalBottom = Math.min(safeLocalBottom, sepY - wy0);
        sibMaxBoundYAbs = Math.min(sibMaxBoundYAbs, sepY);
        hitBottomWall = true;
      }
    }
  }
  safeLocalLeft = Math.max(safeLocalLeft, 4 - wx0);
  safeLocalRight = Math.min(safeLocalRight, fullWidth - 4 - wx0);

  // Kapalı açık renkli konuşma balonunun (ör. dikenli yuvarlak balon "SO / WEAK?!") iç boşluğunda kalan
  // fakat OCR kutusunun biraz dışında/üstünde kaldığı için `accepted` kümesine girmemiş olan tüm iç harf parçalarını
  // ("SO" veya kesilmiş harf üstleri) otomatik olarak yakala ve silme maskesine dahil et!
  const cavWallHits =
    (hitLeftWall ? 1 : 0) +
    (hitRightWall ? 1 : 0) +
    (hitTopWall ? 1 : 0) +
    (hitBottomWall ? 1 : 0);
  if (bgLumInit >= 195 && hitLeftWall && hitRightWall && cavWallHits >= 3) {
    const cavLeft = Math.max(2, safeLocalLeft, cx0 - Math.max(28, medLineH * 1.25));
    const cavRight = Math.min(ww - 3, safeLocalRight, cx1 + Math.max(28, medLineH * 1.25));
    const cavTop = Math.max(
      2,
      cy0 - Math.max(20, medLineH * 0.85),
      hitTopWall
        ? safeLocalTop - wallPadY + 2
        : wy0 === 0
          ? 0
          : gMinY - Math.round(medGlyphH * 2.2),
    );
    const cavBottom = Math.min(
      wh - 3,
      cy1 + Math.max(24, medLineH * 1.05),
      hitBottomWall
        ? Math.max(safeLocalBottom + wallPadY - 2, gMaxY + Math.round(medGlyphH * 1.4))
        : wy1 === fullHeight
          ? wh - 1
          : gMaxY + Math.round(medGlyphH * 1.4),
    );
    let cavityAdded = false;
    for (const c of comps) {
      if (accepted.has(c.id) || borderIds.has(c.id)) continue;
      if (c.area < 5 || c.touchesSideOrWinEdge || isStructuralFrameOrDivider(c) || isVividExternalSidebarArt(c)) continue;
      if (!c.overlapsCore && c.area <= 360 && c.w <= 22 && c.h <= 22) continue;
      if (overlapsAnySiblingAbs(wx0 + c.minx, wy0 + c.miny, wx0 + c.maxx + 1, wy0 + c.maxy + 1)) {
        continue;
      }
      if (c.miny < cavTop || c.maxy > cavBottom) continue;
      if (c.minx > gMaxX + medGlyphH * 1.6 || c.maxx < gMinX - medGlyphH * 1.6) continue;
      // Eğer aday gMaxY altında (ör. dikenli balon dibindeki "..." noktaları) ise merkez X hizasında duvarı aşmadığını doğrula
      if (c.maxy > safeLocalBottom + wallPadY - 2) {
        const cMidX = clamp(Math.round((c.minx + c.maxx) * 0.5), 0, ww - 1);
        let crossedWallVert = false;
        for (let y = Math.min(gMaxY, c.miny); y <= Math.min(wh - 1, c.maxy + 2); y += 1) {
          if (isStructuralWallAt(cMidX, y)) {
            crossedWallVert = true;
            break;
          }
        }
        if (crossedWallVert) continue;
      }
      if (
        c.h > Math.max(medGlyphH * 1.75, medLineH * 1.75) ||
        c.w > Math.max(medGlyphH * 3.8, medLineH * 3.8, 96)
      ) {
        continue;
      }
      // Yuvarlak/dikenli balonlarda kesilen üst/alt satır ekvatora daha yakın ve daha geniş olabildiğinden,
      // adayın kendi Y hizasında merkezden sağ/sol `borderMask` duvarlarını ölç.
      const cMidY = clamp(Math.round((c.miny + c.maxy) * 0.5), 0, wh - 1);
      const scanOriginX = clamp(midLocalXInit, 0, ww - 1);
      let rowLeftWall = 0;
      let rowHitLeft = false;
      for (let x = scanOriginX; x >= 0; x -= 1) {
        if (isStructuralWallAt(x, cMidY)) {
          rowLeftWall = x;
          rowHitLeft = true;
          break;
        }
      }
      let rowRightWall = ww - 1;
      let rowHitRight = false;
      for (let x = scanOriginX; x < ww; x += 1) {
        if (isStructuralWallAt(x, cMidY)) {
          rowRightWall = x;
          rowHitRight = true;
          break;
        }
      }
      const fitsRowWalls =
        rowHitLeft && rowHitRight && rowRightWall - rowLeftWall < ww - 6
          ? c.minx >= rowLeftWall + 2 && c.maxx <= rowRightWall - 2
          : c.minx >= cavLeft && c.maxx <= cavRight;
      if (fitsRowWalls) {
        accepted.add(c.id);
        cavityAdded = true;
        if (c.minx < gMinX) gMinX = c.minx;
        if (c.maxx > gMaxX) gMaxX = c.maxx;
        if (c.miny < gMinY) gMinY = c.miny;
        if (c.maxy > gMaxY) gMaxY = c.maxy;
      }
    }
    if (cavityAdded) {
      accComps = comps.filter((c) => accepted.has(c.id));
      for (let i = 0; i < numPixels; i += 1) {
        if (accepted.has(labels[i])) rawGlyphMask[i] = 1;
      }
    }
  }

  const midLocalY = Math.round((gMinY + gMaxY) * 0.5);
  const midLocalX = Math.round((gMinX + gMaxX) * 0.5);

  // "NO", "FIRST MURDER." gibi konturlu/içi kapalı harflerin iç dolgusunu (Jordan teoremi ile) doldur!
  const { combinedMask, enclosedInteriorMask, enclosedCount } = fillEnclosedGlyphInteriors(
    rawGlyphMask,
    borderMask,
    ww,
    wh,
    gMinX,
    gMaxX,
    gMinY,
    gMaxY,
    winRgb,
    bgR,
    bgG,
    bgB,
  );

  // Dış Kontur Yutma (White & Dark Halo Absorption):
  // 1) Koyu harflerin etrafındaki beyaz konturu ("NO ONE HOME", "weak spot!") sıkı 2-3 adımda yut;
  // 2) Beyaz dolgulu sahne/anlatım yazılarının etrafındaki siyah dış konturu ("[KOYU]", oyun-sonu) yut ki
  //    diken/siyah çubuk lekesi arkada kalmasın!
  const wallHitsEarly =
    (hitLeftWall ? 1 : 0) +
    (hitRightWall ? 1 : 0) +
    (hitTopWall ? 1 : 0) +
    (hitBottomWall ? 1 : 0);

  let preDilateMask = combinedMask;
  if (
    !preferLightFirst &&
    (bgLumInit < 236 || (wallHitsEarly < 3 && bgLumInit < 248 && whiteCoreCount >= 12))
  ) {
    const haloSteps = isSingleOrDarkSfx || bgLumInit < 190 ? 3 : 2;
    for (let step = 0; step < haloSteps; step += 1) {
      let haloAdded = 0;
      const nextMask = new Uint8Array(preDilateMask);
      for (let y = Math.max(1, gMinY - 5); y <= Math.min(wh - 2, gMaxY + 5); y += 1) {
        const rOff = y * ww;
        for (let x = Math.max(1, gMinX - 6); x <= Math.min(ww - 2, gMaxX + 6); x += 1) {
          const idx = rOff + x;
          if (preDilateMask[idx] || borderMask[idx]) continue;
          if (
            preDilateMask[idx - 1] ||
            preDilateMask[idx + 1] ||
            preDilateMask[idx - ww] ||
            preDilateMask[idx + ww]
          ) {
            const cIdx = idx * 3;
            const pr = winRgb[cIdx];
            const pg = winRgb[cIdx + 1];
            const pb = winRgb[cIdx + 2];
            const pLum = 0.299 * pr + 0.587 * pg + 0.114 * pb;
            const dGlowBg = Math.max(pr - bgR, pg - bgG, pb - bgB);
            if (
              (bgLumInit >= 205
                ? pLum >= 232 && pLum > bgLumInit + 16
                : pLum >= 216 && pLum > bgLumInit + 22) ||
              (bgLumInit < 140 && (pLum > bgLumInit + 22 || dGlowBg > 28))
            ) {
              nextMask[idx] = 1;
              haloAdded += 1;
            }
          }
        }
      }
      preDilateMask = nextMask;
      if (haloAdded === 0) break;
    }
  } else if (preferLightFirst) {
    // Dış halka arkaplan parlaklığını satır bazlı ve genel olarak ölç ("lineCores" siyah dış kontur yüzünden yanılmış olsa bile!)
    const outerBgLums: number[] = [];
    const outerBgRs: number[] = [];
    const outerBgBs: number[] = [];
    for (let y = Math.max(0, gMinY - 16); y <= Math.min(wh - 1, gMaxY + 16); y += 2) {
      const inVertBand = y < gMinY - 5 || y > gMaxY + 5;
      const rOff = y * ww;
      for (let x = Math.max(0, gMinX - 22); x <= Math.min(ww - 1, gMaxX + 22); x += 2) {
        if (!inVertBand && x >= gMinX - 5 && x <= gMaxX + 5) continue;
        const idx = rOff + x;
        if (preDilateMask[idx] || borderMask[idx]) continue;
        const cIdx = idx * 3;
        const or = winRgb[cIdx];
        const og = winRgb[cIdx + 1];
        const ob = winRgb[cIdx + 2];
        outerBgLums.push(0.299 * or + 0.587 * og + 0.114 * ob);
        outerBgRs.push(or);
        outerBgBs.push(ob);
      }
    }
    const outerBgLum = outerBgLums.length >= 10 ? medianOf(outerBgLums) : bgLumInit;
    const outerBgR = outerBgRs.length >= 10 ? medianOf(outerBgRs) : bgR;
    const outerBgB = outerBgBs.length >= 10 ? medianOf(outerBgBs) : bgB;
    const effOuterBg = Math.max(bgLumInit, outerBgLum);

    if (effOuterBg < 45 && wallHitsEarly < 3) {
      // Saf siyah/çok koyu zemin üzerindeki yumuşak beyaz parıltıyı (glow) tamamen yut ki
      // halka örneklemesi parıltıya takılıp siyah zemini beyaza boyamasın
      for (let step = 0; step < 6; step += 1) {
        let lightGlowAdded = 0;
        const nextMask = new Uint8Array(preDilateMask);
        for (let y = Math.max(1, gMinY - 8); y <= Math.min(wh - 2, gMaxY + 8); y += 1) {
          const rOff = y * ww;
          for (let x = Math.max(1, gMinX - 8); x <= Math.min(ww - 2, gMaxX + 8); x += 1) {
            const idx = rOff + x;
            if (preDilateMask[idx] || borderMask[idx]) continue;
            if (
              preDilateMask[idx - 1] ||
              preDilateMask[idx + 1] ||
              preDilateMask[idx - ww] ||
              preDilateMask[idx + ww]
            ) {
              const cIdx = idx * 3;
              const pLum =
                0.299 * winRgb[cIdx] + 0.587 * winRgb[cIdx + 1] + 0.114 * winRgb[cIdx + 2];
              if (pLum > Math.max(effOuterBg + 14, bgLumInit + 14, 18)) {
                nextMask[idx] = 1;
                lightGlowAdded += 1;
              }
            }
          }
        }
        preDilateMask = nextMask;
        if (lightGlowAdded === 0) break;
      }
    }

    if (effOuterBg >= 24) {
      const darkHaloMaxSteps = effOuterBg >= 100 ? 9 : 7;
      const isBlueBg = bgB > bgR + 14 || outerBgB > outerBgR + 10;
      const haloY0 = Math.max(1, gMinY - 10);
      const haloY1 = Math.min(wh - 2, gMaxY + 10);
      const rowMinXs = new Int32Array(wh);
      const rowMaxXs = new Int32Array(wh);
      for (let y = haloY0; y <= haloY1; y += 1) {
        const rOff = y * ww;
        let rMin = gMinX;
        let rMax = gMaxX;
        let foundRowGlyph = false;
        for (let x = Math.max(0, gMinX - 4); x <= Math.min(ww - 1, gMaxX + 4); x += 1) {
          if (preDilateMask[rOff + x]) {
            if (!foundRowGlyph) {
              rMin = x;
              foundRowGlyph = true;
            }
            rMax = x;
          }
        }
        rowMinXs[y] = rMin;
        rowMaxXs[y] = rMax;
      }
      for (let step = 0; step < darkHaloMaxSteps; step += 1) {
        let darkHaloAdded = 0;
        const nextMask = new Uint8Array(preDilateMask);
        for (let y = haloY0; y <= haloY1; y += 1) {
          const rowLums: number[] = [];
          const ry0 = Math.max(0, y - 2);
          const ry1 = Math.min(wh - 1, y + 2);
          const ancL = rowMinXs[y];
          const ancR = rowMaxXs[y];
          for (let ry = ry0; ry <= ry1; ry += 1) {
            const rrOff = ry * ww;
            for (let rx = Math.max(0, ancL - 22); rx <= Math.max(0, ancL - 5); rx += 2) {
              const rIdx = rrOff + rx;
              if (!preDilateMask[rIdx] && !borderMask[rIdx]) {
                const rc = rIdx * 3;
                rowLums.push(0.299 * winRgb[rc] + 0.587 * winRgb[rc + 1] + 0.114 * winRgb[rc + 2]);
              }
            }
            for (let rx = Math.min(ww - 1, ancR + 5); rx <= Math.min(ww - 1, ancR + 22); rx += 2) {
              const rIdx = rrOff + rx;
              if (!preDilateMask[rIdx] && !borderMask[rIdx]) {
                const rc = rIdx * 3;
                rowLums.push(0.299 * winRgb[rc] + 0.587 * winRgb[rc + 1] + 0.114 * winRgb[rc + 2]);
              }
            }
          }
          const rowBgLum = rowLums.length >= 6 ? Math.max(effOuterBg * 0.75, medianOf(rowLums)) : effOuterBg;
          const rOff = y * ww;
          for (let x = Math.max(1, gMinX - 14); x <= Math.min(ww - 2, gMaxX + 14); x += 1) {
            const idx = rOff + x;
            if (preDilateMask[idx] || borderMask[idx]) continue;
            if (
              preDilateMask[idx - 1] ||
              preDilateMask[idx + 1] ||
              preDilateMask[idx - ww] ||
              preDilateMask[idx + ww]
            ) {
              const cIdx = idx * 3;
              const pr = winRgb[cIdx];
              const pg = winRgb[cIdx + 1];
              const pb = winRgb[cIdx + 2];
              const pLum = 0.299 * pr + 0.587 * pg + 0.114 * pb;
              const maxC = Math.max(pr, pg, pb);
              const minC = Math.min(pr, pg, pb);
              const sat = (maxC - minC) / Math.max(42, maxC);
              if (
                (isBlueBg && pb - pr < 12 && pLum <= rowBgLum + 8 && sat < 0.34) ||
                (sat < 0.38 &&
                  ((pLum <= Math.min(Math.max(122, rowBgLum - 22), rowBgLum - 4) && rowBgLum >= 26) ||
                    (pLum <= 26 && sat < 0.28 && rowBgLum >= 22 && pLum <= rowBgLum - 3)))
              ) {
                nextMask[idx] = 1;
                darkHaloAdded += 1;
              }
            }
          }
        }
        preDilateMask = nextMask;
        if (darkHaloAdded === 0) break;
      }
    }
  }

  // Harf yüksekliğine, zemin açıklığına ve kapalı kontur varlığına göre uyarlanır morfolojik genişletme (Adaptive Dilation)
  const isOpenCleanDarkInk =
    !preferLightFirst && (wallHitsEarly < 3 || bgLumInit >= 140 || whiteCoreCount >= 12);
  const isOpenLightOutlineScene = preferLightFirst && wallHitsEarly < 3 && bgLumInit < 232;
  const dilateSteps = isOpenCleanDarkInk
    ? medGlyphH >= 36
      ? 2
      : 1
    : isOpenLightOutlineScene
      ? clamp(Math.round(medGlyphH * 0.09) + (enclosedCount > 20 ? 2 : 1), 3, 5)
      : clamp(Math.round(medGlyphH * 0.08) + (enclosedCount > 20 ? 2 : 1), 2, 4);
  let mask: Uint8Array = preDilateMask;
  for (let d = 0; d < dilateSteps; d += 1) {
    mask = dilate3x3(mask, ww, wh);
  }

  const eraseMask = new Uint8Array(numPixels);
  let egMinX = ww;
  let egMaxX = 0;
  let egMinY = wh;
  let egMaxY = 0;
  let eraseCount = 0;

  for (let y = 0; y < wh; y += 1) {
    const rOff = y * ww;
    for (let x = 0; x < ww; x += 1) {
      const idx = rOff + x;
      if (mask[idx] && !borderMask[idx]) {
        eraseMask[idx] = 1;
        eraseCount += 1;
        if (x < egMinX) egMinX = x;
        if (x > egMaxX) egMaxX = x;
        if (y < egMinY) egMinY = y;
        if (y > egMaxY) egMaxY = y;
      }
    }
  }

  if (eraseCount === 0) {
    return null;
  }

  // Silme maskesinin hemen dışındaki 2px temiz halkayı örnekleyerek doku standart sapmasını ölç.
  // Baskın arka plan renginden (bgR, bgG, bgB) aşırı sapan (>60) komşu çerçeve/mürekkep piksellerini halkaya alma!
  const ringRs: number[] = [];
  const ringGs: number[] = [];
  const ringBs: number[] = [];
  for (let y = Math.max(2, egMinY - 3); y <= Math.min(wh - 3, egMaxY + 3); y += 1) {
    const rOff = y * ww;
    for (let x = Math.max(2, egMinX - 3); x <= Math.min(ww - 3, egMaxX + 3); x += 1) {
      const idx = rOff + x;
      if (eraseMask[idx] || borderMask[idx]) continue;
      if (
        eraseMask[idx - 2] ||
        eraseMask[idx + 2] ||
        eraseMask[idx - 2 * ww] ||
        eraseMask[idx + 2 * ww]
      ) {
        const cIdx = idx * 3;
        const pr = winRgb[cIdx];
        const pg = winRgb[cIdx + 1];
        const pb = winRgb[cIdx + 2];
        const pLum = 0.299 * pr + 0.587 * pg + 0.114 * pb;
        const dBg = Math.max(Math.abs(pr - bgR), Math.abs(pg - bgG), Math.abs(pb - bgB));
        const bgChroma = Math.max(bgR, bgG, bgB) - Math.min(bgR, bgG, bgB);
        const pChromaRing = Math.max(pr, pg, pb) - Math.min(pr, pg, pb);
        const isLightBubbleWhiteGlow =
          !preferLightFirst &&
          bgLumInit >= 140 &&
          bgLumInit <= 242 &&
          bgChroma <= 16 &&
          pLum >= Math.max(220, bgLumInit + 14) &&
          pChromaRing <= 14;
        if (dBg <= 60 && !(bgLumInit < 45 && pLum > bgLumInit + 32) && !isLightBubbleWhiteGlow) {
          ringRs.push(pr);
          ringGs.push(pg);
          ringBs.push(pb);
        }
      }
    }
  }

  let ringMedR = ringRs.length > 10 ? Math.round(medianOf(ringRs)) : bgR;
  let ringMedG = ringGs.length > 10 ? Math.round(medianOf(ringGs)) : bgG;
  let ringMedB = ringBs.length > 10 ? Math.round(medianOf(ringBs)) : bgB;
  let ringMedLum = 0.299 * ringMedR + 0.587 * ringMedG + 0.114 * ringMedB;

  let ringStd = 0;
  let ringCloseCount = 0;
  if (ringRs.length > 10) {
    let varSum = 0;
    for (let i = 0; i < ringRs.length; i += 1) {
      const dr = ringRs[i] - ringMedR;
      const dg = ringGs[i] - ringMedG;
      const db = ringBs[i] - ringMedB;
      if (Math.max(Math.abs(dr), Math.abs(dg), Math.abs(db)) <= 12) {
        ringCloseCount += 1;
      }
      varSum += (dr * dr + dg * dg + db * db) / 3;
    }
    ringStd = Math.sqrt(varSum / ringRs.length);
  }
  let ringCloseRatio = ringRs.length > 10 ? ringCloseCount / ringRs.length : 1;

  // Kalın beyaz parlamalı ("#EFEAEF" veya pastel pembe balonda koyu harf + 5px saf beyaz halo) balonlarda
  // 2px iç halka saf beyazı (#FFFFFF) ölçebileceğinden 7..18px dışındaki gerçek temiz zemin halkasını doğrula.
  if (!preferLightFirst && (ringMedLum >= 228 || bgLumInit >= 228)) {
    const outRs: number[] = [];
    const outGs: number[] = [];
    const outBs: number[] = [];
    const ox0 = Math.max(0, egMinX - 18);
    const ox1 = Math.min(ww - 1, egMaxX + 18);
    const oy0 = Math.max(0, egMinY - 14);
    const oy1 = Math.min(wh - 1, egMaxY + 14);
    for (let y = oy0; y <= oy1; y += 2) {
      const inInnerY = y >= egMinY - 5 && y <= egMaxY + 5;
      const rOff = y * ww;
      for (let x = ox0; x <= ox1; x += 2) {
        if (inInnerY && x >= egMinX - 5 && x <= egMaxX + 5) continue;
        const idx = rOff + x;
        if (eraseMask[idx] || borderMask[idx]) continue;
        const cIdx = idx * 3;
        const pr = winRgb[cIdx];
        const pg = winRgb[cIdx + 1];
        const pb = winRgb[cIdx + 2];
        const pLum = 0.299 * pr + 0.587 * pg + 0.114 * pb;
        if (pLum >= 120) {
          outRs.push(pr);
          outGs.push(pg);
          outBs.push(pb);
        }
      }
    }
    if (outRs.length >= 18) {
      const oMedR = Math.round(medianOf(outRs));
      const oMedG = Math.round(medianOf(outGs));
      const oMedB = Math.round(medianOf(outBs));
      const oMedLum = 0.299 * oMedR + 0.587 * oMedG + 0.114 * oMedB;
      const oChroma = Math.max(oMedR, oMedG, oMedB) - Math.min(oMedR, oMedG, oMedB);
      const innerChroma = Math.max(ringMedR, ringMedG, ringMedB) - Math.min(ringMedR, ringMedG, ringMedB);
      let oVar = 0;
      let oClose = 0;
      for (let i = 0; i < outRs.length; i += 1) {
        const dr = outRs[i] - oMedR;
        const dg = outGs[i] - oMedG;
        const db = outBs[i] - oMedB;
        if (Math.max(Math.abs(dr), Math.abs(dg), Math.abs(db)) <= 12) oClose += 1;
        oVar += (dr * dr + dg * dg + db * db) / 3;
      }
      const oStd = Math.sqrt(oVar / outRs.length);
      if (
        oMedLum >= 135 &&
        ((oMedLum <= ringMedLum - 5 && oStd <= 16) ||
          (oChroma >= 12 && oChroma > innerChroma + 6 && oMedLum <= 245))
      ) {
        ringMedR = oMedR;
        ringMedG = oMedG;
        ringMedB = oMedB;
        ringMedLum = oMedLum;
        ringStd = oStd;
        ringCloseRatio = oClose / outRs.length;
        // Harf gövdesini saran parlak saf beyaz (#FFFFFF) haleyi temiz dış zemine kadar yut
        for (let step = 0; step < 7; step += 1) {
          let added = 0;
          const prevE = new Uint8Array(eraseMask);
          for (let y = Math.max(1, egMinY - 6); y <= Math.min(wh - 2, egMaxY + 6); y += 1) {
            const rOff = y * ww;
            for (let x = Math.max(1, egMinX - 6); x <= Math.min(ww - 2, egMaxX + 6); x += 1) {
              const idx = rOff + x;
              if (prevE[idx] || borderMask[idx]) continue;
              if (prevE[idx - 1] || prevE[idx + 1] || prevE[idx - ww] || prevE[idx + ww]) {
                const cIdx = idx * 3;
                const pr = winRgb[cIdx];
                const pg = winRgb[cIdx + 1];
                const pb = winRgb[cIdx + 2];
                const pLum = 0.299 * pr + 0.587 * pg + 0.114 * pb;
                const pChr = Math.max(pr, pg, pb) - Math.min(pr, pg, pb);
                if (
                  pLum >= Math.max(222, ringMedLum + 7) &&
                  (pChr <= Math.max(14, oChroma * 0.72) || pLum >= Math.min(248, ringMedLum + 10))
                ) {
                  eraseMask[idx] = 1;
                  eraseCount += 1;
                  added += 1;
                  if (x < egMinX) egMinX = x;
                  if (x > egMaxX) egMaxX = x;
                  if (y < egMinY) egMinY = y;
                  if (y > egMaxY) egMaxY = y;
                }
              }
            }
          }
          if (added === 0) break;
        }
      }
    }
  }

  // Metin içindeki gerçek sahne/doku oranını kontrol et: eğer silinmeyen arka plan piksellerinin
  // önemli kısmı (>%14) orta-koyu tonlarda veya halka renginden farklıysa, bu bölge kesinlikle düz beyaz balon değildir!
  let interiorNonErase = 0;
  let interiorSceneDiff = 0;
  const scY0 = Math.max(0, egMinY);
  const scY1 = Math.min(wh - 1, egMaxY);
  const scX0 = Math.max(0, egMinX);
  const scX1 = Math.min(ww - 1, egMaxX);
  for (let y = scY0; y <= scY1; y += 2) {
    const rOff = y * ww;
    for (let x = scX0; x <= scX1; x += 2) {
      const idx = rOff + x;
      if (eraseMask[idx] || borderMask[idx]) continue;
      interiorNonErase += 1;
      const cIdx = idx * 3;
      const pr = winRgb[cIdx];
      const pg = winRgb[cIdx + 1];
      const pb = winRgb[cIdx + 2];
      const pLumSc = 0.299 * pr + 0.587 * pg + 0.114 * pb;
      const pChrSc = Math.max(pr, pg, pb) - Math.min(pr, pg, pb);
      const isWhiteTextGlow =
        ringMedLum >= 165 && ringMedLum <= 242 && pLumSc >= ringMedLum + 14 && pLumSc >= 225 && pChrSc <= 14;
      const dRing = Math.max(Math.abs(pr - ringMedR), Math.abs(pg - ringMedG), Math.abs(pb - ringMedB));
      if (dRing > 36 && !isWhiteTextGlow) interiorSceneDiff += 1;
    }
  }
  const hasTexturedSceneInterior =
    (!preferLightFirst || (ringStd >= 14 && ringMedLum > 52)) &&
    interiorNonErase >= 16 &&
    interiorSceneDiff / interiorNonErase >= 0.14;
  if (hasTexturedSceneInterior && ringStd < 16) {
    ringStd = 16;
  }

  const wallHits =
    (hitLeftWall ? 1 : 0) +
    (hitRightWall ? 1 : 0) +
    (hitTopWall ? 1 : 0) +
    (hitBottomWall ? 1 : 0);
  const hasWallBlowout =
    preferLightFirst &&
    ringStd >= 11 &&
    safeLocalRight - safeLocalLeft > Math.max((gMaxX - gMinX + 1) * 2.1, bw * 2.2);
  const hasActualPhysicalWalls =
    !hasTexturedSceneInterior &&
    !hasWallBlowout &&
    (wallHits >= 3 || (hitLeftWall && hitRightWall && ringStd < 11));
  const hasClosedBubbleWalls =
    !hasTexturedSceneInterior &&
    (hasActualPhysicalWalls ||
      (bgLumInit >= 235 && ringMedLum >= 238 && ringStd < 4.5));

  // Stil Parmak İzini Çıkar (Renk, Kontur, Gradyan, Açı, Font Ailesi, Bölge Türü)
  const compCenters = accComps
    .filter((c) => c.h >= medGlyphH * 0.55)
    .map((c) => ({
      x: (c.minx + c.maxx) * 0.5,
      y: (c.miny + c.maxy) * 0.5,
      w: c.w,
      h: c.h,
    }));

  const style = extractStyleFingerprint({
    winRgb,
    ww,
    wh,
    rawGlyphMask,
    enclosedInteriorMask,
    enclosedCount,
    ringMedR,
    ringMedG,
    ringMedB,
    ringStd,
    medGlyphH,
    medGlyphW,
    fullWidth,
    hasClosedBubbleWalls,
    compCenters,
    lineBoxesLocal: lineCores,
    origLineCount,
  });

  // Balon duvarı olmayan arka planda tek harflik dikey kanji kalıntısı ("I!") veya
  // tek kelimelik yüzen efekt ("TAP") ise görseli hiç bozmadan atla
  const origOrTranslatedText = block.originalText || block.text;
  const trimmedOrig = origOrTranslatedText.trim();
  const cleanedAlphaOnly = origOrTranslatedText
    .replace(/[^a-zA-ZçğıöşüÇĞİÖŞÜ]/g, '')
    .toLowerCase();
  const isSingleUppercaseStandaloneSfx =
    origLineCount === 1 &&
    trimmedOrig === trimmedOrig.toUpperCase() &&
    !/[?!/\\]/.test(trimmedOrig) &&
    wallHits < 4;
  if (
    (!hasClosedBubbleWalls &&
      cleanedAlphaOnly.length <= 1 &&
      !/^\d+$/.test(trimmedOrig) &&
      bgLumInit < 235) ||
    (REPEATED_ONLY_SFX_STEMS.has(cleanedAlphaOnly) &&
      !isSingleLineStat &&
      !(hitLeftWall && hitRightWall && hitTopWall && hitBottomWall) &&
      (!hasActualPhysicalWalls || style.kind === 'sfx' || isSingleUppercaseStandaloneSfx) &&
      !/[?]/.test(origOrTranslatedText))
  ) {
    return null;
  }

  // 3 Kademeli Uyarlanır Inpainting:
  // Kademe 1 (düz renkli konuşma balonu): %100 lekesiz medyan dolgu
  // Kademe 2 (dokulu sahne / SFX / RPG kutusu): Sınır korumalı İzofot Telea Fast Marching + Harmonik Difüzyon
  const ringMedChroma =
    Math.max(ringMedR, ringMedG, ringMedB) - Math.min(ringMedR, ringMedG, ringMedB);
  const isNeutralJpegLightBox =
    !hasTexturedSceneInterior &&
    !preferLightFirst &&
    ringMedLum >= 236 &&
    ringMedChroma <= 12 &&
    ringCloseRatio >= 0.72;
  const isGradientLightBubble =
    !preferLightFirst &&
    !isNeutralJpegLightBox &&
    Math.max(bgLumInit, ringMedLum) >= 175 &&
    ((ringStd >= 3.2 && (ringMedChroma >= 8 || ringMedLum < 240 || (ringStd >= 4.2 && ringMedLum < 244))) ||
      (!hasTexturedSceneInterior && wallHits >= 2 && ringMedLum <= 242 && (style.hasTextStroke || ringStd < 6.5)) ||
      (ringMedChroma >= 8 && bgLumInit >= ringMedLum + 6));

  const hasWhiteStrokeHalo =
    !preferLightFirst &&
    !isNeutralJpegLightBox &&
    style.hasTextStroke &&
    style.strokeColor.toLowerCase() === '#ffffff' &&
    ringMedLum < 242;

  if (isGradientLightBubble || hasWhiteStrokeHalo) {
    // Açık mavi/pastel/gri balonlarda harf merkezindeki beyaz gradyan nedeniyle atlanan
    // saf beyaz (#FFFFFF) harf dış kontur halesini satır-bazlı dış zemin parlaklığıyla kıyaslayıp sil.
    const rowOuterLum = new Float32Array(wh);
    const rowOuterChroma = new Float32Array(wh);
    rowOuterLum.fill(ringMedLum);
    rowOuterChroma.fill(ringMedChroma);
    for (let y = Math.max(0, egMinY - 4); y <= Math.min(wh - 1, egMaxY + 4); y += 1) {
      const rOff = y * ww;
      const oLums: number[] = [];
      const oChrs: number[] = [];
      for (let x = Math.max(0, egMinX - 18); x < Math.min(ww, egMaxX + 18); x += 1) {
        if (x >= egMinX - 4 && x <= egMaxX + 4) continue;
        const idx = rOff + x;
        if (eraseMask[idx] || borderMask[idx]) continue;
        const cIdx = idx * 3;
        const pr = winRgb[cIdx];
        const pg = winRgb[cIdx + 1];
        const pb = winRgb[cIdx + 2];
        oLums.push(0.299 * pr + 0.587 * pg + 0.114 * pb);
        oChrs.push(Math.max(pr, pg, pb) - Math.min(pr, pg, pb));
      }
      if (oLums.length >= 6) {
        rowOuterLum[y] = medianOf(oLums);
        rowOuterChroma[y] = medianOf(oChrs);
      }
    }

    const minWhiteHaloLum =
      hasWhiteStrokeHalo && ringMedLum < 228
        ? Math.max(204, ringMedLum + 10)
        : ringMedLum < 228 && ringMedChroma <= 12
          ? Math.max(212, ringMedLum + 9)
          : 226;
    const maxHaloSteps = hasWhiteStrokeHalo ? 5 : 7;
    const haloBoundX0 = hasWhiteStrokeHalo ? Math.max(1, gMinX - 4) : Math.max(1, egMinX - 4);
    const haloBoundX1 = hasWhiteStrokeHalo ? Math.min(ww - 2, gMaxX + 4) : Math.min(ww - 2, egMaxX + 4);
    const haloBoundY0 = hasWhiteStrokeHalo ? Math.max(1, gMinY - 4) : Math.max(1, egMinY - 4);
    const haloBoundY1 = hasWhiteStrokeHalo ? Math.min(wh - 2, gMaxY + 4) : Math.min(wh - 2, egMaxY + 4);
    for (let step = 0; step < maxHaloSteps; step += 1) {
      let gHaloAdded = 0;
      const prevErase = new Uint8Array(eraseMask);
      for (let y = haloBoundY0; y <= haloBoundY1; y += 1) {
        const rOff = y * ww;
        const rLum = rowOuterLum[y];
        const rChr = rowOuterChroma[y];
        const refLum = Math.min(ringMedLum, rLum);
        const refChr = Math.max(ringMedChroma, rChr);
        for (let x = haloBoundX0; x <= haloBoundX1; x += 1) {
          const idx = rOff + x;
          if (prevErase[idx] || borderMask[idx]) continue;
          if (
            prevErase[idx - 1] ||
            prevErase[idx + 1] ||
            prevErase[idx - ww] ||
            prevErase[idx + ww]
          ) {
            const cIdx = idx * 3;
            const pr = winRgb[cIdx];
            const pg = winRgb[cIdx + 1];
            const pb = winRgb[cIdx + 2];
            const pLum = 0.299 * pr + 0.587 * pg + 0.114 * pb;
            const pChroma = Math.max(pr, pg, pb) - Math.min(pr, pg, pb);
            const isNeutralWhiteHalo =
              pLum >= Math.max(minWhiteHaloLum, refLum + 9) &&
              pChroma <= Math.max(18, refChr * 0.72) &&
              (refChr >= 10
                ? pChroma <= refChr * 0.72 || pLum >= Math.min(246, refLum + 9)
                : pLum >= refLum + 9);
            if (isNeutralWhiteHalo) {
              eraseMask[idx] = 1;
              eraseCount += 1;
              gHaloAdded += 1;
              if (x < egMinX) egMinX = x;
              if (x > egMaxX) egMaxX = x;
              if (y < egMinY) egMinY = y;
              if (y > egMaxY) egMaxY = y;
            }
          }
        }
      }
      if (gHaloAdded === 0) break;
    }
  }

  const cleaned = new Float32Array(winRgb);
  const isFlatLightBubble =
    !hasTexturedSceneInterior &&
    (isNeutralJpegLightBox ||
      (!isGradientLightBubble && ringStd < 4.5 && ringMedLum >= 232) ||
      (wallHits >= 3 && ringStd < 4.8 && ringMedLum >= 175 && ringMedChroma <= 12));
  const isFlatDarkBanner =
    !hasTexturedSceneInterior &&
    preferLightFirst &&
    ringMedLum <= 34 &&
    ringStd < 10 &&
    ringCloseRatio >= 0.72;

  if (isFlatLightBubble || isFlatDarkBanner) {
    // Düz konuşma balonlarında veya düz siyah şeritlerde ("CHAINSAWMAN") dış gökyüzü/doku sızmasını engelle;
    // yalnızca mevcut silme maskesinin komşuluğundaki anti-aliasing/parlama kalıntılarını temizle!
    const flatExpandSteps = isFlatDarkBanner ? 2 : ringMedLum <= 240 ? 4 : 1;
    const flatDiffThresh = isFlatDarkBanner ? 16 : ringMedLum <= 240 ? 9 : 14;
    const flatPad = isFlatDarkBanner ? 2 : ringMedLum <= 240 ? 4 : 2;
    for (let fStep = 0; fStep < flatExpandSteps; fStep += 1) {
      let flatAdded = 0;
      const baseErase = new Uint8Array(eraseMask);
      for (let y = Math.max(0, egMinY - flatPad); y <= Math.min(wh - 1, egMaxY + flatPad); y += 1) {
        const rOff = y * ww;
        for (let x = Math.max(0, egMinX - flatPad); x <= Math.min(ww - 1, egMaxX + flatPad); x += 1) {
          const idx = rOff + x;
          if (borderMask[idx] || eraseMask[idx]) continue;
          if (
            (x > 0 && baseErase[idx - 1]) ||
            (x < ww - 1 && baseErase[idx + 1]) ||
            (y > 0 && baseErase[idx - ww]) ||
            (y < wh - 1 && baseErase[idx + ww])
          ) {
            const cIdx = idx * 3;
            const d = Math.max(
              Math.abs(winRgb[cIdx] - ringMedR),
              Math.abs(winRgb[cIdx + 1] - ringMedG),
              Math.abs(winRgb[cIdx + 2] - ringMedB),
            );
            if (d > flatDiffThresh) {
              eraseMask[idx] = 1;
              eraseCount += 1;
              flatAdded += 1;
              if (x < egMinX) egMinX = x;
              if (x > egMaxX) egMaxX = x;
              if (y < egMinY) egMinY = y;
              if (y > egMaxY) egMaxY = y;
            }
          }
        }
      }
      if (flatAdded === 0) break;
    }

    for (let i = 0; i < numPixels; i += 1) {
      if (!eraseMask[i]) continue;
      const cIdx = i * 3;
      cleaned[cIdx] = ringMedR;
      cleaned[cIdx + 1] = ringMedG;
      cleaned[cIdx + 2] = ringMedB;
    }
  } else {
    inpaintTexturedRegion(
      cleaned,
      eraseMask,
      borderMask,
      ww,
      wh,
      egMinX,
      egMaxX,
      egMinY,
      egMaxY,
      ringMedR,
      ringMedG,
      ringMedB,
    );

    // Silme Sonrası Artık İz Kontrolü (Post-Inpaint Residual Verification):
    // Harf kutusunun hemen içinde hala yüksek kontrastlı kontur/gölge kalıntısı varsa 2. geçişle temizle.
    // Gradyan balonlarda yanlış tetiklenmemesi için her pikseli kendi 5px komşuluğuyla kıyasla.
    const residualThresh = Math.max(42, ringStd * 2.5);
    let residualFound = 0;
    const resMask = new Uint8Array(numPixels);
    for (let y = Math.max(3, gMinY - 2); y <= Math.min(wh - 4, gMaxY + 2); y += 1) {
      const rOff = y * ww;
      for (let x = Math.max(3, gMinX - 2); x <= Math.min(ww - 4, gMaxX + 2); x += 1) {
        const idx = rOff + x;
        if (eraseMask[idx] || borderMask[idx]) continue;
        // Yalnızca mevcut silme maskesinin 3px komşuluğundaki artıkları hedefle (arka plan dokusunu bozma!)
        const nearErase =
          eraseMask[idx - 1] ||
          eraseMask[idx + 1] ||
          eraseMask[idx - ww] ||
          eraseMask[idx + ww] ||
          eraseMask[idx - 2] ||
          eraseMask[idx + 2] ||
          eraseMask[idx - 2 * ww] ||
          eraseMask[idx + 2 * ww] ||
          eraseMask[idx - 3] ||
          eraseMask[idx + 3];
        if (!nearErase) continue;
        const cIdx = idx * 3;
        const lIdx = (idx - 3) * 3;
        const rIdx = (idx + 3) * 3;
        const tIdx = (idx - 3 * ww) * 3;
        const bIdx = (idx + 3 * ww) * 3;
        const locR = (cleaned[lIdx] + cleaned[rIdx] + cleaned[tIdx] + cleaned[bIdx]) * 0.25;
        const locG = (cleaned[lIdx + 1] + cleaned[rIdx + 1] + cleaned[tIdx + 1] + cleaned[bIdx + 1]) * 0.25;
        const locB = (cleaned[lIdx + 2] + cleaned[rIdx + 2] + cleaned[tIdx + 2] + cleaned[bIdx + 2]) * 0.25;
        const dev = Math.max(
          Math.abs(cleaned[cIdx] - locR),
          Math.abs(cleaned[cIdx + 1] - locG),
          Math.abs(cleaned[cIdx + 2] - locB),
        );
        const pLumCur = 0.299 * cleaned[cIdx] + 0.587 * cleaned[cIdx + 1] + 0.114 * cleaned[cIdx + 2];
        const hLocLum =
          0.299 * ((cleaned[lIdx] + cleaned[rIdx]) * 0.5) +
          0.587 * ((cleaned[lIdx + 1] + cleaned[rIdx + 1]) * 0.5) +
          0.114 * ((cleaned[lIdx + 2] + cleaned[rIdx + 2]) * 0.5);
        const hUniformDrop =
          preferLightFirst &&
          Math.max(
            Math.abs(cleaned[lIdx] - cleaned[rIdx]),
            Math.abs(cleaned[lIdx + 1] - cleaned[rIdx + 1]),
            Math.abs(cleaned[lIdx + 2] - cleaned[rIdx + 2]),
          ) <= 20 &&
          pLumCur < hLocLum - 18;
        const pChromaCur =
          Math.max(cleaned[cIdx], cleaned[cIdx + 1], cleaned[cIdx + 2]) -
          Math.min(cleaned[cIdx], cleaned[cIdx + 1], cleaned[cIdx + 2]);
        const ringMedChroma =
          Math.max(ringMedR, ringMedG, ringMedB) - Math.min(ringMedR, ringMedG, ringMedB);
        const isPureWhiteInkHalo =
          ringMedLum >= 150 &&
          ringMedLum <= 242 &&
          ringMedChroma <= 45 &&
          pLumCur >= Math.max(242, ringMedLum + 10) &&
          pChromaCur <= Math.min(12, Math.max(8, ringMedChroma * 0.55));
        const isPureWhiteFaintInkResidual =
          ringMedLum >= 245 && ringStd <= 4.5 && pLumCur <= 172;
        const isLightSceneResidual =
          !preferLightFirst && ringMedLum >= 120
            ? isPureWhiteFaintInkResidual ||
              (pLumCur <= Math.min(62, Math.round(ringMedLum * 0.42)) && pLumCur < hLocLum - 35) ||
              isPureWhiteInkHalo ||
              (ringMedLum <= 240 &&
                pLumCur >= Math.max(230, ringMedLum + 12) &&
                pLumCur > hLocLum + 12 &&
                pChromaCur <= 12)
            : dev > residualThresh || hUniformDrop;
        if (isLightSceneResidual) {
          resMask[idx] = 1;
          residualFound += 1;
        }
      }
    }

    if (residualFound > 4 && residualFound < numPixels * 0.25) {
      const dilatedRes =
        !preferLightFirst && ringMedLum >= 120
          ? dilate3x3(resMask, ww, wh)
          : dilate3x3(dilate3x3(resMask, ww, wh), ww, wh);
      for (let y = 0; y < wh; y += 1) {
        const rOff = y * ww;
        for (let x = 0; x < ww; x += 1) {
          const idx = rOff + x;
          if (dilatedRes[idx] && !borderMask[idx] && !eraseMask[idx]) {
            eraseMask[idx] = 1;
            if (x < egMinX) egMinX = x;
            if (x > egMaxX) egMaxX = x;
            if (y < egMinY) egMinY = y;
            if (y > egMaxY) egMaxY = y;
          }
        }
      }
      inpaintTexturedRegion(
        cleaned,
        eraseMask,
        borderMask,
        ww,
        wh,
        egMinX,
        egMaxX,
        egMinY,
        egMaxY,
        ringMedR,
        ringMedG,
        ringMedB,
      );
    }
    // Siyah konturlu beyaz sahne metinlerinin dışında kalan yumuşak gri gölge halesini
    // satır başı/sonu temiz arka plan simetrikse temizle
    if (
      preferLightFirst &&
      !hasClosedBubbleWalls &&
      style.hasTextStroke &&
      style.strokeColor === '#0a0a0c'
    ) {
      const swY0 = Math.max(0, egMinY - 4);
      const swY1 = Math.min(wh - 1, egMaxY + 5);
      for (let y = swY0; y <= swY1; y += 1) {
        const rOff = y * ww;
        let rFirstX = -1;
        let rLastX = -1;
        for (let x = egMinX; x <= egMaxX; x += 1) {
          if (eraseMask[rOff + x]) {
            if (rFirstX < 0) rFirstX = x;
            rLastX = x;
          }
        }
        const isEdgeShadowRow = rFirstX < 0;
        if (isEdgeShadowRow) {
          rFirstX = egMinX;
          rLastX = egMaxX;
        }
        const lRs: number[] = [];
        const lGs: number[] = [];
        const lBs: number[] = [];
        for (let lx = Math.max(0, rFirstX - 30); lx <= Math.max(0, rFirstX - 13); lx += 2) {
          const lIdx = rOff + lx;
          if (eraseMask[lIdx] || borderMask[lIdx]) continue;
          const lc = lIdx * 3;
          lRs.push(cleaned[lc]);
          lGs.push(cleaned[lc + 1]);
          lBs.push(cleaned[lc + 2]);
        }
        const rRs: number[] = [];
        const rGs: number[] = [];
        const rBs: number[] = [];
        for (let rx = Math.min(ww - 1, rLastX + 13); rx <= Math.min(ww - 1, rLastX + 30); rx += 2) {
          const rIdx = rOff + rx;
          if (eraseMask[rIdx] || borderMask[rIdx]) continue;
          const rc = rIdx * 3;
          rRs.push(cleaned[rc]);
          rGs.push(cleaned[rc + 1]);
          rBs.push(cleaned[rc + 2]);
        }
        if (lRs.length < 3 || rRs.length < 3) continue;
        const fLR = medianOf(lRs);
        const fLG = medianOf(lGs);
        const fLB = medianOf(lBs);
        const fRR = medianOf(rRs);
        const fRG = medianOf(rGs);
        const fRB = medianOf(rBs);
        const pairDiff = Math.max(Math.abs(fLR - fRR), Math.abs(fLG - fRG), Math.abs(fLB - fRB));
        const minRowLum = Math.min(
          0.299 * fLR + 0.587 * fLG + 0.114 * fLB,
          0.299 * fRR + 0.587 * fRG + 0.114 * fRB,
        );
        if (pairDiff > (minRowLum < 90 ? 34 : 22)) continue;
        if (minRowLum < 16) continue;
        if (isEdgeShadowRow && (minRowLum < 90 || pairDiff > 14)) continue;
        const sx0 = Math.max(0, rFirstX - 12);
        const sx1 = Math.min(ww - 1, rLastX + 12);
        const spanLen = Math.max(1, sx1 - sx0);
        const texAvail = rFirstX >= 32 && minRowLum >= 26 && pairDiff <= (minRowLum < 90 ? 22 : 14);
        const texPeriod = 18;
        const texShift = ((y * 7) ^ (y >> 2)) % texPeriod;
        const darkCut = minRowLum >= 90 ? minRowLum - 5 : minRowLum - 8;
        for (let x = sx0; x <= sx1; x += 1) {
          const idx = rOff + x;
          if (borderMask[idx]) continue;
          const c3 = idx * 3;
          const pLum = 0.299 * cleaned[c3] + 0.587 * cleaned[c3 + 1] + 0.114 * cleaned[c3 + 2];
          if ((!isEdgeShadowRow && eraseMask[idx]) || pLum < darkCut) {
            const t = (x - sx0) / spanLen;
            let baseR = (1 - t) * fLR + t * fRR;
            let baseG = (1 - t) * fLG + t * fRG;
            let baseB = (1 - t) * fLB + t * fRB;
            if (texAvail) {
              const phase = (x - sx0 + texShift) % (texPeriod * 2);
              const off = phase < texPeriod ? phase : texPeriod * 2 - 1 - phase;
              const sIdx = rOff + (rFirstX - 14 - off);
              if (!eraseMask[sIdx] && !borderMask[sIdx]) {
                const sc = sIdx * 3;
                const dR = cleaned[sc] - fLR;
                const dG = cleaned[sc + 1] - fLG;
                const dB = cleaned[sc + 2] - fLB;
                if (Math.abs(dR) <= 32 && Math.abs(dG) <= 32 && Math.abs(dB) <= 32) {
                  baseR += dR;
                  baseG += dG;
                  baseB += dB;
                }
              }
            }
            cleaned[c3] = clamp(baseR, 0, 255);
            cleaned[c3 + 1] = clamp(baseG, 0, 255);
            cleaned[c3 + 2] = clamp(baseB, 0, 255);
            if (!eraseMask[idx]) {
              eraseMask[idx] = 1;
              if (x < egMinX) egMinX = x;
              if (x > egMaxX) egMaxX = x;
              if (y < egMinY) egMinY = y;
              if (y > egMaxY) egMaxY = y;
            }
          }
        }
      }
    }
  }

  // Temizlenen pikselleri hem imgData'ya hem fullCtx'e geri yaz (komşu balonlar temiz zemini görsün)
  for (let i = 0; i < numPixels; i += 1) {
    if (!eraseMask[i]) continue;
    const cIdx = i * 3;
    const p4 = i * 4;
    rgba[p4] = clamp(Math.round(cleaned[cIdx]), 0, 255);
    rgba[p4 + 1] = clamp(Math.round(cleaned[cIdx + 1]), 0, 255);
    rgba[p4 + 2] = clamp(Math.round(cleaned[cIdx + 2]), 0, 255);
    rgba[p4 + 3] = 255;
  }
  fullCtx.putImageData(imgData, wx0, wy0);

  // Yalnızca silinen metin bölgesini saran sıkı dikdörtgeni (kontur/ışıldama payı dahil) WebP yama olarak üret
  const padX0 = preferLightFirst ? 3 : 2;
  const padX1 = preferLightFirst ? 4 : 3;
  const padY0 = preferLightFirst ? 3 : 2;
  const padY1 = preferLightFirst || isBlueOrMidPanel ? 5 : 3;
  const localPx0 = Math.max(0, egMinX - padX0);
  const localPy0 = Math.max(0, egMinY - padY0);
  const localPx1 = Math.min(ww, egMaxX + padX1);
  const localPy1 = Math.min(wh, egMaxY + padY1);
  const patchW = Math.max(1, localPx1 - localPx0);
  const patchH = Math.max(1, localPy1 - localPy0);

  const absPatchX0 = wx0 + localPx0;
  const absPatchY0 = wy0 + localPy0;
  const absPatchX1 = wx0 + localPx1;
  const absPatchY1 = wy0 + localPy1;

  const patchCanvas = document.createElement('canvas');
  patchCanvas.width = patchW;
  patchCanvas.height = patchH;
  const patchCtx = patchCanvas.getContext('2d');
  let patchDataUrl = '';
  if (patchCtx) {
    patchCtx.drawImage(
      fullCtx.canvas,
      absPatchX0,
      absPatchY0,
      patchW,
      patchH,
      0,
      0,
      patchW,
      patchH,
    );
    patchDataUrl = patchCanvas.toDataURL('image/webp', 0.92);
  }

  const patchBox: [number, number, number, number] = [
    toNorm(absPatchY0, fullHeight),
    toNorm(absPatchX0, fullWidth),
    toNorm(absPatchY1, fullHeight),
    toNorm(absPatchX1, fullWidth),
  ];

  // Simetrik merkezli güvenli genişlik ve yükseklik:
  // Eğer konuşma balonunun hem sol hem sağ duvarı tespit edildiyse, balonun gerçek yatay merkezini
  // ve tam iç genişliğini kullan (böylece yazı sağa/sola sıkışmaz, balonun tam ortasına yayılır).
  const glyphW = Math.max(24, gMaxX - gMinX + 1);
  const glyphH = Math.max(18, gMaxY - gMinY + 1);
  const coreCenterY = Math.round((cy0 + cy1) * 0.5);
  const baseMidY =
    Math.abs(midLocalY - coreCenterY) <= Math.max(18, medGlyphH * 0.85)
      ? midLocalY
      : coreCenterY;
  const wallCenterY = Math.round((safeLocalTop + safeLocalBottom) * 0.5);
  const layoutCenterX =
    hitLeftWall &&
    hitRightWall &&
    safeLocalRight > safeLocalLeft + 24 &&
    Math.abs(midLocalX - (safeLocalLeft + safeLocalRight) * 0.5) <=
      (safeLocalRight - safeLocalLeft) * (isFlatLightBubble ? 0.34 : 0.18)
      ? Math.round((safeLocalLeft + safeLocalRight) * 0.5)
      : midLocalX;
  const layoutCenterY =
    hitTopWall &&
    hitBottomWall &&
    safeLocalBottom > safeLocalTop + 20 &&
    Math.abs(wallCenterY - baseMidY) <= Math.max(14, medGlyphH * 0.6)
      ? wallCenterY
      : baseMidY;

  const spanLocalW = safeLocalRight > safeLocalLeft + 24 ? safeLocalRight - safeLocalLeft : glyphW;
  const maxHalfW = Math.max(
    glyphW * 0.5,
    hitLeftWall && hitRightWall && isFlatLightBubble
      ? spanLocalW * 0.5
      : Math.min(layoutCenterX - safeLocalLeft, safeLocalRight - layoutCenterX),
  );
  const maxHalfH = Math.max(
    glyphH * 0.55,
    Math.min(layoutCenterY - safeLocalTop, safeLocalBottom - layoutCenterY),
  );
  let safeW = Math.max(glyphW, maxHalfW * 2);
  if (!(hitLeftWall && hitRightWall)) {
    safeW = Math.min(safeW, Math.max(glyphW * 1.32, medGlyphH * 10));
  }
  const safeH = Math.max(glyphH * 1.1, maxHalfH * 2);

  // Orijinal harf kapak yüksekliğinden (Cap Height) gerçek Canvas EM font boyutuna dönüştür
  const capHeights = accComps
    .filter((c) => c.h >= Math.max(8, medGlyphH * 0.55))
    .map((c) => c.h)
    .sort((a, b) => a - b);
  let origCapH =
    capHeights.length > 0
      ? capHeights[Math.min(capHeights.length - 1, Math.floor(capHeights.length * 0.7))]
      : medGlyphH;
  const absRotRadOrig = (Math.abs(style.rotationDeg ?? 0) * Math.PI) / 180;
  if (
    !hasClosedBubbleWalls &&
    origLineCount === 1 &&
    bh >= 28 &&
    (style.hasTextStroke || style.kind === 'sfx' || bh >= 48)
  ) {
    // Dış parlama / gradient kontur / eğimli el yazısı nedeniyle harfleri parçalanmış veya dikey izdüşümü şişmiş
    // tek satırlı başlıklarda gerçek blok yüksekliğinden kapak boyutunu hesapla.
    const tiltScale =
      absRotRadOrig > 0.08
        ? clamp(0.22 / Math.max(0.75, Math.cos(absRotRadOrig)), 0.2, 0.28)
        : 0.72;
    if (origCapH < bh * 0.48) {
      origCapH = Math.max(origCapH, Math.round(bh * tiltScale));
    } else if (absRotRadOrig >= 0.14) {
      origCapH = Math.min(origCapH, Math.max(14, Math.round(bh * tiltScale * 1.45)));
    }
  }
  const fontCapRatio =
    style.fontFamily === 'anton' || style.fontFamily === 'bangers' || style.fontFamily === 'marker'
      ? 0.8
      : 0.69;
  const targetEmPx = origCapH / fontCapRatio;

  // Hedef metin uzunluğuna, bölge türüne (SFX vs Diyalog) ve orijinal harf boyutuna göre akıllı dizgi
  const measureCtx = getSharedMeasureContext();

  let fontPx: number;
  let finalBoxW: number;
  let finalBoxH: number;
  let finalLineWidthsPct: number[] | undefined;
  let emphasisLastLineScale = block.emphasisLastLineScale;
  const isWideSingleLineRibbon =
    style.kind !== 'sfx' &&
    !isSingleLineStat &&
    origLineCount === 1 &&
    !hasClosedBubbleWalls &&
    bw / Math.max(1, bh) >= 4.5 &&
    bh <= 64;
  const ribbonBgMax = Math.max(bgR, bgG, bgB);
  const isVividBannerNow = ribbonBgMax >= 135 && ribbonBgMax - Math.min(bgR, bgG, bgB) >= 65;
  let ribbonLeftLocalX = safeLocalLeft;
  let ribbonRightLocalX = safeLocalRight;

  if (isSingleLineStat) {
    // Tek satırlık RPG istatistik satırı ("SAĞLIK: 100", "BÜYÜ: 0", "SALDIRI: 2 (KEMİK KILIÇ +3)", "AD: JIANG CHENG" vb.)
    // Kesinlikle 2 satıra sarılmaz! Tek satırda kalacak şekilde font boyutu hesaplanır ve orijinal ilk harfin sol sınırına (gMinX) kilitlenir.
    const statLeftLocalX = gMinX;
    const maxStatW = Math.max(
      bw * 1.08,
      Math.min(
        fullWidth - (wx0 + statLeftLocalX) - 8,
        (hitRightWall ? safeLocalRight + Math.round(wallPadX * 0.5) : ww - 4) - statLeftLocalX,
      ),
    );
    const minStatFontPx = Math.max(11, fullWidth * 0.015);
    fontPx = clamp(targetEmPx, minStatFontPx, fullWidth * 0.048);
    finalBoxW = Math.max(bw, glyphW);
    finalBoxH = Math.max(bh, Math.ceil(fontPx * 1.14));
    for (let step = 0; step < 16; step += 1) {
      const lineW = measureStyledWordWidth(
        measureCtx,
        displayText,
        fontPx,
        style.fontFamily,
        style.fontWeight,
      );
      if (lineW <= maxStatW * 0.96 || fontPx <= minStatFontPx) {
        finalBoxW = Math.max(24, Math.min(maxStatW, Math.ceil(lineW + 10)));
        finalBoxH = Math.max(bh, Math.ceil(fontPx * 1.14));
        break;
      }
      fontPx = Math.max(minStatFontPx, fontPx * 0.95);
    }
  } else if (style.kind === 'sfx') {
    // SFX / Stilize Büyük Yazılar ("NO" -> "HAYIR.", "FIRST MURDER." -> "İLK CİNAYET."):
    // Orijinal yazının kapladığı alanı ve yüksekliği dolduracak şekilde dinamik ölçekle!
    emphasisLastLineScale = undefined; // SFX zaten tek bir vurgu bloğudur
    const maxSfxFontPx = Math.min(fullWidth * 0.135, Math.max(glyphH * 1.35, targetEmPx * 1.15));
    const minSfxFontPx = Math.max(14, fullWidth * 0.022);
    fontPx = clamp(targetEmPx, minSfxFontPx, maxSfxFontPx);

    // Tek satırlık orijinal SFX'te ("NO.", "FIRST MURDER.") çeviriyi de mümkün olduğunca 1-2 satırda geniş tut
    finalBoxW =
      origLineCount === 1
        ? !hasClosedBubbleWalls && absRotRadOrig >= 0.14
          ? Math.min(Math.max(glyphW * 1.55, bw * 1.55), Math.max(glyphW * 1.38, safeW, fontPx * displayText.length * 0.58))
          : Math.max(glyphW * 1.38, safeW, fontPx * displayText.length * 0.58)
        : Math.max(glyphW * 1.25, safeW);
    finalBoxW = Math.min(finalBoxW, fullWidth * 0.92);
    finalBoxH = Math.max(glyphH * 1.25, safeH);

    for (let step = 0; step < 16; step += 1) {
      const wrapped = computeSmartWrappedLines(
        measureCtx,
        displayText,
        finalBoxW * 0.95,
        fontPx,
        {
          fontFamily: style.fontFamily,
          fontWeight: style.fontWeight,
        },
      );
      if (
        wrapped.totalHeightPx <= finalBoxH * 0.98 &&
        wrapped.maxWordWidth <= finalBoxW * 0.96 &&
        (origLineCount > 1 || wrapped.lines.length <= 2)
      ) {
        finalBoxW = Math.max(glyphW, Math.min(finalBoxW, wrapped.maxWordWidth * 1.22 + 24));
        finalBoxH = Math.max(glyphH, wrapped.totalHeightPx + fontPx * 0.35);
        break;
      }
      if (fontPx <= minSfxFontPx) break;
      fontPx = Math.max(minSfxFontPx, fontPx * 0.94);
    }
  } else {
    // Konuşma Balonu & Anlatım Kutusu:
    const refFloorW = Math.min(fullWidth, 1100);
    const maxDialogFontPx = Math.min(
      fullWidth * 0.135,
      Math.max(fullWidth * (emphasisLastLineScale ? 0.068 : 0.072), targetEmPx * 1.02),
    );
    const softDialogFloorPx = Math.min(refFloorW * 0.019, Math.max(10.5, targetEmPx * 1.15));
    fontPx = clamp(targetEmPx, softDialogFloorPx, maxDialogFontPx);
    const minFontPx = Math.max(9.5, refFloorW * 0.011);

    const charLen = displayText.length;
    const absStyleRotDeg = Math.abs(style.rotationDeg ?? 0);
    const preserveSingleLineOpen =
      origLineCount === 1 &&
      ((!hitLeftWall &&
        !hitRightWall &&
        (absStyleRotDeg < 1 ? charLen <= 32 || hitTopWall || hitBottomWall : charLen <= 20)) ||
        (isWideSingleLineRibbon && absStyleRotDeg < 1));
    const desiredCharsPerLine = preserveSingleLineOpen
      ? charLen + 2
      : charLen <= 10
        ? charLen + 2
        : clamp(Math.ceil(Math.sqrt(charLen * 2.1)) * 2, 10, 26);
    const singleCharW =
      measureStyledWordWidth(measureCtx, 'A', fontPx, style.fontFamily, style.fontWeight) ||
      fontPx * 0.61;
    const singleLineNeedW = preserveSingleLineOpen
      ? (measureStyledWordWidth(
          measureCtx,
          displayText,
          fontPx,
          style.fontFamily,
          style.fontWeight,
        ) || charLen * singleCharW) + 18
      : 0;
    const desiredW = Math.max(desiredCharsPerLine * singleCharW + 18, singleLineNeedW);
    const rawLeftWall = hitLeftWall ? safeLocalLeft - wallPadX : safeLocalLeft;
    const rawRightWall = hitRightWall ? safeLocalRight + wallPadX : safeLocalRight;
    const rawWallSpan = Math.max(glyphW, rawRightWall - rawLeftWall);
    const targetWallClear = clamp(Math.round(medGlyphH * 0.12), 2, 4);
    const maxDrawableW = Math.max(glyphW, rawWallSpan - 2 * targetWallClear);
    const interiorSpan =
      safeLocalRight > safeLocalLeft + 24 ? safeLocalRight - safeLocalLeft : safeW;
    const isDarkTexturedScene = preferLightFirst && bgLumInit < 150 && ringStd >= 3.5;
    const isOpenMultilineScene =
      !isFlatLightBubble &&
      origLineCount >= 3 &&
      (!hasClosedBubbleWalls || isDarkTexturedScene);
    const minBoundXPre =
      hitLeftWall && hitRightWall
        ? Math.max(4, Math.min(wx0 + gMinX, wx0 + safeLocalLeft))
        : Math.max(4, Math.min(wx0 + gMinX, wx0 + safeLocalLeft));
    const maxBoundXPre =
      hitLeftWall && hitRightWall
        ? Math.min(fullWidth - 4, Math.max(wx0 + gMaxX, wx0 + safeLocalRight))
        : Math.min(fullWidth - 4, Math.max(wx0 + gMaxX, wx0 + safeLocalRight));
    const maxWrapSpanPre = maxBoundXPre - minBoundXPre >= 28 ? maxBoundXPre - minBoundXPre : ww - 4;
    const rawClosedHorizW = Math.min(ww - 4, maxWrapSpanPre, Math.max(safeW, maxDrawableW / 0.88));
    const closedHorizW =
      origLineCount >= 3 &&
      hitLeftWall &&
      hitRightWall &&
      hitTopWall &&
      hitBottomWall &&
      ovalChordSafeW < ww
        ? Math.min(
            rawClosedHorizW,
            Math.max(glyphW * 0.94, Math.max(ovalChordSafeW * 1.02, (safeLocalRight - safeLocalLeft) * 0.78)),
          )
        : rawClosedHorizW;
    const clampedInteriorW = Math.min(safeW, Math.max(28, interiorSpan));
    const ribbonMidY = clamp(Math.round((cy0 + cy1) * 0.5), 0, wh - 1);
    if (isWideSingleLineRibbon && isVividBannerNow) {
      let miss = 0;
      ribbonLeftLocalX = cx0;
      for (let x = Math.max(0, cx0); x >= Math.max(0, safeLocalLeft); x -= 1) {
        const cIdx = (ribbonMidY * ww + x) * 3;
        const pr = winRgb[cIdx];
        const pg = winRgb[cIdx + 1];
        const pb = winRgb[cIdx + 2];
        const pChr = Math.max(pr, pg, pb) - Math.min(pr, pg, pb);
        const dStrip =
          Math.abs(pr - bgR) + Math.abs(pg - bgG) + Math.abs(pb - bgB);
        if (dStrip > 140 && pChr < 55) {
          miss += 1;
          if (miss >= 3) break;
        } else {
          miss = 0;
          ribbonLeftLocalX = x;
        }
      }
      miss = 0;
      ribbonRightLocalX = cx1;
      for (let x = Math.min(ww - 1, cx1); x <= Math.min(ww - 1, safeLocalRight); x += 1) {
        const cIdx = (ribbonMidY * ww + x) * 3;
        const pr = winRgb[cIdx];
        const pg = winRgb[cIdx + 1];
        const pb = winRgb[cIdx + 2];
        const pChr = Math.max(pr, pg, pb) - Math.min(pr, pg, pb);
        const dStrip =
          Math.abs(pr - bgR) + Math.abs(pg - bgG) + Math.abs(pb - bgB);
        if (dStrip > 140 && pChr < 55) {
          miss += 1;
          if (miss >= 3) break;
        } else {
          miss = 0;
          ribbonRightLocalX = x;
        }
      }
    }
    const openSingleLineMaxW = preserveSingleLineOpen
      ? Math.min(
          Math.max(clampedInteriorW, maxWrapSpanPre - 8),
          Math.max(glyphW * 1.45, Math.ceil(singleLineNeedW / 0.88)),
        )
      : 0;
    const openHorizW = isOpenMultilineScene
      ? clampedInteriorW
      : Math.max(
          openSingleLineMaxW,
          Math.min(ww - 4, maxWrapSpanPre, clampedInteriorW / 0.88),
        );
    const ribbonSpanW =
      isWideSingleLineRibbon && isVividBannerNow && ribbonRightLocalX > ribbonLeftLocalX + 36
        ? Math.max(glyphW, (ribbonRightLocalX - ribbonLeftLocalX - 6) / 0.88)
        : Infinity;
    const rawUsableSafeW =
      hitLeftWall && hitRightWall && !isOpenMultilineScene && !isWideSingleLineRibbon
        ? closedHorizW
        : isWideSingleLineRibbon
          ? Math.min(openHorizW, hitRightWall ? maxDrawableW / 0.88 : openHorizW, ribbonSpanW)
          : openHorizW;
    const effMinFontPx = isWideSingleLineRibbon && isVividBannerNow ? Math.min(minFontPx, 7.5) : minFontPx;
    const usableSafeW = isOpenMultilineScene
      ? Math.min(rawUsableSafeW, Math.max(glyphW * 1.18, medGlyphH * 10.5))
      : rawUsableSafeW;
    const horizSlack = 0.89;

    finalBoxW = isOpenMultilineScene
      ? Math.max(Math.min(glyphW * 1.15, usableSafeW), Math.min(glyphW * 0.96, usableSafeW))
      : clamp(
          Math.max(glyphW * 0.94, desiredW),
          Math.min(glyphW * 0.85, usableSafeW),
          usableSafeW,
        );
    const topWallDist = hitTopWall
      ? Math.max(gMinY, layoutCenterY) - Math.min(gMinY, safeLocalTop)
      : Math.max(glyphH * 0.6, wy0 + layoutCenterY - Math.max(4, sibMinBoundYAbs));
    const botWallDist = hitBottomWall
      ? Math.max(gMaxY + 1, safeLocalBottom) - Math.min(gMaxY + 1, layoutCenterY)
      : Math.max(
          glyphH * 0.6,
          Math.min(fullHeight - 4, sibMaxBoundYAbs) - (wy0 + layoutCenterY),
        );
    const wallSpanV =
      (hitTopWall ? Math.min(gMinY, safeLocalTop) : Math.min(gMinY, layoutCenterY - safeH * 0.5)) <
      (hitBottomWall ? Math.max(gMaxY + 1, safeLocalBottom) : Math.max(gMaxY + 1, layoutCenterY + safeH * 0.5))
        ? (hitBottomWall ? Math.max(gMaxY + 1, safeLocalBottom) : Math.max(gMaxY + 1, layoutCenterY + safeH * 0.65)) -
          (hitTopWall ? Math.min(gMinY, safeLocalTop) : Math.min(gMinY, layoutCenterY - safeH * 0.65))
        : safeH;
    const wallVertCapH =
      hitTopWall && hitBottomWall
        ? Math.max(glyphH * 1.08, Math.min(topWallDist + botWallDist, wallSpanV) * 0.985)
        : Math.min(topWallDist * 2, botWallDist * 2);
    const maxAvailBoxH = hitTopWall && hitBottomWall ? Math.max(safeH, wallVertCapH) : Math.max(safeH, glyphH * 1.4);
    finalBoxH = Math.min(Math.max(glyphH * 1.15, safeH), wallVertCapH);

    const canMeasureContour =
      hasActualPhysicalWalls &&
      hitLeftWall &&
      hitRightWall &&
      !isOpenMultilineScene;
    const contourScanX = clamp(Math.round(layoutCenterX), 0, ww - 1);
    const contourPadX = clamp(Math.round(medGlyphH * 0.24), 5, 9);
    const lineHeightRatio =
      style.fontFamily === 'anton' || style.fontFamily === 'bangers' ? 1.09 : 1.09;

    const measureRowClearSpanPx = (
      yTopLocal: number,
      yBotLocal: number,
      isEdgeRow: boolean,
    ): number => {
      const yMid = Math.round((yTopLocal + yBotLocal) * 0.5);
      const sampleYs = [
        clamp(yTopLocal, 0, wh - 1),
        clamp(yMid, 0, wh - 1),
        clamp(yBotLocal, 0, wh - 1),
      ];
      const halfSpans: number[] = [];
      for (const sy of sampleYs) {
        let halfL = contourScanX - rawLeftWall - contourPadX;
        let hitL = false;
        for (let x = contourScanX; x >= 0; x -= 1) {
          if (isStructuralWallAt(x, sy)) {
            halfL = contourScanX - x - contourPadX;
            hitL = true;
            break;
          }
        }
        let halfR = rawRightWall - contourScanX - contourPadX;
        let hitR = false;
        for (let x = contourScanX; x < ww; x += 1) {
          if (isStructuralWallAt(x, sy)) {
            halfR = x - contourScanX - contourPadX;
            hitR = true;
            break;
          }
        }
        if (hitL && hitR) {
          halfSpans.push(Math.max(medGlyphH * 0.85, Math.min(halfL, halfR)));
        }
      }
      if (halfSpans.length === 0) {
        return finalBoxW * 0.88;
      }
      halfSpans.sort((a, b) => a - b);
      // Uç satırlarda (ilk/son) kubbe eğriliğine çarpmamak için en dar kesiti, orta satırlarda medyanı esas al
      const pickedHalf = isEdgeRow ? halfSpans[0] : halfSpans[halfSpans.length >> 1];
      return Math.max(medGlyphH * 1.75, 2 * pickedHalf);
    };

    const computeRowPctsForWrapped = (
      wrappedRes: ReturnType<typeof computeSmartWrappedLines>,
    ): { rowSpans: number[]; rowPcts: number[] } => {
      const rowSpans: number[] = [];
      const rowPcts: number[] = [];
      if (!canMeasureContour || wrappedRes.lines.length < 1) {
        return { rowSpans, rowPcts };
      }
      const boxWrapW = Math.max(1, finalBoxW * 0.88);
      let curY = layoutCenterY - wrappedRes.totalHeightPx * 0.5;
      for (let li = 0; li < wrappedRes.lines.length; li += 1) {
        const line = wrappedRes.lines[li];
        const lh = fontPx * (line.scale ?? 1) * lineHeightRatio;
        const y0 = Math.round(curY + lh * 0.20);
        const y1 = Math.round(curY + lh * 0.80);
        const isEdgeRow =
          wrappedRes.lines.length >= 2 && (li === 0 || li === wrappedRes.lines.length - 1);
        const spanPx = measureRowClearSpanPx(y0, y1, isEdgeRow);
        rowSpans.push(spanPx);
        rowPcts.push(Number(clamp(spanPx / boxWrapW, 0.52, 1.0).toFixed(3)));
        curY += lh;
      }
      return { rowSpans, rowPcts };
    };

    for (let step = 0; step < 26; step += 1) {
      const allowHyphenation = step >= 22;
      let wrapped = computeSmartWrappedLines(
        measureCtx,
        displayText,
        finalBoxW * 0.88,
        fontPx,
        {
          fontFamily: style.fontFamily,
          fontWeight: style.fontWeight,
          emphasisLastLineScale,
          allowHyphenation,
        },
      );

      let { rowSpans, rowPcts } = computeRowPctsForWrapped(wrapped);
      if (canMeasureContour && wrapped.lines.length >= 2 && rowPcts.some((p) => p < 0.96)) {
        const contoured = computeSmartWrappedLines(
          measureCtx,
          displayText,
          finalBoxW * 0.88,
          fontPx,
          {
            fontFamily: style.fontFamily,
            fontWeight: style.fontWeight,
            lineWidthsPct: rowPcts,
            emphasisLastLineScale,
            allowHyphenation,
          },
        );
        if (contoured.lines.length === rowPcts.length) {
          wrapped = contoured;
          ({ rowSpans, rowPcts } = computeRowPctsForWrapped(wrapped));
        }
      }

      let linesClearWalls = true;
      if (canMeasureContour && rowSpans.length === wrapped.lines.length) {
        for (let li = 0; li < wrapped.lines.length; li += 1) {
          const line = wrapped.lines[li];
          const drawnW = line.widthPx * (line.scale ?? 1);
          if (drawnW > rowSpans[li] * 0.94 && fontPx > minFontPx * 1.05) {
            linesClearWalls = false;
            break;
          }
        }
      }

      const uniformLineScales = wrapped.lines.every((l) => (l.scale ?? 1) >= 0.99) || step >= 24;
      const vertFillRatio = hitTopWall && hitBottomWall ? 0.98 : 1.0;
      const ribbonFitsSingleLine =
        !isWideSingleLineRibbon || wrapped.lines.length <= 1 || fontPx <= effMinFontPx * 1.05;
      if (
        wrapped.totalHeightPx <= finalBoxH * vertFillRatio &&
        wrapped.maxWordWidth <= finalBoxW * horizSlack &&
        linesClearWalls &&
        ribbonFitsSingleLine &&
        uniformLineScales
      ) {
        if (rowPcts.length === wrapped.lines.length && rowPcts.some((p) => p < 0.98)) {
          finalLineWidthsPct = rowPcts;
        }
        finalBoxH = Math.max(glyphH, wrapped.totalHeightPx + fontPx * 0.35);
        break;
      }

      if (finalBoxW < usableSafeW - 1) {
        finalBoxW = usableSafeW;
        continue;
      }
      if (
        finalBoxH < maxAvailBoxH - 1 &&
        wrapped.maxWordWidth <= finalBoxW * horizSlack
      ) {
        finalBoxH = maxAvailBoxH;
        continue;
      }
      if (fontPx <= effMinFontPx) break;
      fontPx = Math.max(effMinFontPx, fontPx * 0.95);
    }
  }

  let refinedX0: number;
  let refinedX1: number;
  let refinedY0: number;
  let refinedY1: number;
  if (isSingleLineStat) {
    const statLeftLocalX = gMinX;
    const statCenterLocalY = Math.round((gMinY + gMaxY) * 0.5);
    refinedX0 = clamp(wx0 + statLeftLocalX, 0, fullWidth - finalBoxW);
    refinedX1 = clamp(refinedX0 + finalBoxW, refinedX0 + 4, fullWidth);
    const absStatCenterY = wy0 + statCenterLocalY;
    refinedY0 = clamp(absStatCenterY - finalBoxH * 0.5, 0, fullHeight - 4);
    refinedY1 = clamp(absStatCenterY + finalBoxH * 0.5, refinedY0 + 4, fullHeight);
  } else {
    const absCenterX = wx0 + layoutCenterX;
    const rawMinBoundX = Math.max(4, Math.min(wx0 + gMinX, wx0 + safeLocalLeft));
    const rawMaxBoundX = Math.min(fullWidth - 4, Math.max(wx0 + gMaxX, wx0 + safeLocalRight));
    const minBoundX =
      isWideSingleLineRibbon && isVividBannerNow && ribbonRightLocalX > ribbonLeftLocalX + 36
        ? Math.max(4, wx0 + ribbonLeftLocalX + 2)
        : !hasClosedBubbleWalls && !isFlatLightBubble
          ? Math.max(
              rawMinBoundX,
              wx0 + Math.max(0, Math.min(gMinX - Math.round(glyphW * 0.18), gMinX - 8)),
            )
          : !hitLeftWall
            ? Math.max(rawMinBoundX, wx0 + Math.max(0, Math.min(gMinX, cx0) - Math.max(12, Math.round(medGlyphH * 0.48))))
            : rawMinBoundX;
    const maxBoundX =
      isWideSingleLineRibbon && isVividBannerNow && ribbonRightLocalX > ribbonLeftLocalX + 36
        ? Math.min(fullWidth - 4, wx0 + ribbonRightLocalX - 2)
        : !hasClosedBubbleWalls && !isFlatLightBubble
          ? Math.min(
              rawMaxBoundX,
              wx0 + Math.min(ww, Math.max(gMaxX + Math.round(glyphW * 0.18), gMaxX + 8)),
            )
          : !hitRightWall
            ? Math.min(rawMaxBoundX, wx0 + Math.min(ww - 4, Math.max(gMaxX, cx1) + Math.max(12, Math.round(medGlyphH * 0.48))))
            : rawMaxBoundX;
    if (finalBoxW > maxBoundX - minBoundX && maxBoundX - minBoundX >= 28) {
      finalBoxW = maxBoundX - minBoundX;
    }
    refinedX0 = clamp(
      absCenterX - finalBoxW * 0.5,
      minBoundX,
      Math.max(minBoundX, maxBoundX - finalBoxW),
    );
    refinedX1 = clamp(refinedX0 + finalBoxW, refinedX0 + 4, maxBoundX);
    const absCenterY = wy0 + layoutCenterY;
    const minBoundY = Math.max(
      sibMinBoundYAbs,
      hitTopWall ? Math.min(wy0 + gMinY, wy0 + safeLocalTop) : 0,
    );
    const maxBoundY = Math.min(
      sibMaxBoundYAbs,
      hitBottomWall ? Math.max(wy0 + gMaxY, wy0 + safeLocalBottom) : fullHeight,
    );
    if (finalBoxH > maxBoundY - minBoundY && maxBoundY - minBoundY >= glyphH) {
      finalBoxH = maxBoundY - minBoundY;
    }
    refinedY0 = clamp(
      absCenterY - finalBoxH * 0.5,
      minBoundY,
      Math.max(minBoundY, maxBoundY - finalBoxH),
    );
    refinedY1 = clamp(refinedY0 + finalBoxH, refinedY0 + 4, maxBoundY);
  }

  const refinedBox: [number, number, number, number] = [
    toNorm(refinedY0, fullHeight),
    toNorm(refinedX0, fullWidth),
    toNorm(refinedY1, fullHeight),
    toNorm(refinedX1, fullWidth),
  ];

  const maxCqw = 13.5;
  const fontSizeCqw = Number(clamp((fontPx / fullWidth) * 100, 1.5, maxCqw).toFixed(3));

  // Çok satırlı blok farklı parlaklık kuşaklarına yayılıyorsa (ör. üst yarı beyaz, alt yarı siyah panel)
  // her satırın altındaki gerçek arka plan parlaklığına göre otomatik kontrast rengi belirle
  let finalLineStyles: TranslationBlock['lineStyles'] | undefined;
  if (!isSingleLineStat) {
    const finalWrap = computeSmartWrappedLines(
      measureCtx,
      displayText,
      (refinedX1 - refinedX0) * 0.88,
      fontPx,
      {
        fontFamily: style.fontFamily,
        fontWeight: style.fontWeight,
        lineWidthsPct: finalLineWidthsPct,
        emphasisLastLineScale,
      },
    );
    if (finalWrap.lines.length >= 2) {
      const lRatio = style.fontFamily === 'anton' || style.fontFamily === 'bangers' ? 1.09 : 1.09;
      let curAbsY = refinedY0 + (refinedY1 - refinedY0 - finalWrap.totalHeightPx) * 0.5;
      const detectedLineLums: number[] = [];
      for (const fl of finalWrap.lines) {
        const lh = fontPx * (fl.scale ?? 1) * lRatio;
        const yS = clamp(Math.floor(curAbsY + lh * 0.15) - wy0, 0, wh - 1);
        const yE = clamp(Math.ceil(curAbsY + lh * 0.85) - wy0, yS, wh - 1);
        const xS = clamp(Math.floor(refinedX0) - wx0, 0, ww - 1);
        const xE = clamp(Math.ceil(refinedX1) - wx0, xS, ww - 1);
        const lineLums: number[] = [];
        const stepX = Math.max(2, Math.floor((xE - xS) / 18));
        for (let py = yS; py <= yE; py += 2) {
          const pOff = py * ww;
          for (let px = xS; px <= xE; px += stepX) {
            const c3 = (pOff + px) * 3;
            lineLums.push(0.299 * cleaned[c3] + 0.587 * cleaned[c3 + 1] + 0.114 * cleaned[c3 + 2]);
          }
        }
        detectedLineLums.push(lineLums.length >= 4 ? medianOf(lineLums) : ringMedLum);
        curAbsY += lh;
      }
      const hasLightRow = detectedLineLums.some((l) => l >= 170);
      const hasDarkRow = detectedLineLums.some((l) => l <= 95);
      if (hasLightRow && hasDarkRow) {
        finalLineStyles = detectedLineLums.map((l) => {
          const rowDark = l < 135;
          if (rowDark !== style.isDark) {
            return {
              textColor: rowDark ? '#ffffff' : '#0c0c0c',
              hasTextStroke: false,
            };
          }
          return {
            textColor: style.textColor,
            hasTextStroke: style.hasTextStroke,
            ...(style.strokeColor ? { strokeColor: style.strokeColor } : {}),
            ...(style.strokeWidthEm ? { strokeWidthEm: style.strokeWidthEm } : {}),
            ...(style.shadowColor ? { shadowColor: style.shadowColor } : {}),
            ...(style.shadowBlurEm ? { shadowBlurEm: style.shadowBlurEm } : {}),
          };
        });
      }
    }
  }

  return {
    v: TRANSLATION_BLOCK_VERSION,
    box: refinedBox,
    patchBox,
    patchDataUrl,
    text: block.text,
    originalText: block.originalText,
    kind: style.kind,
    fontFamily: style.fontFamily,
    fontWeight: style.fontWeight,
    fontStyle: style.fontStyle,
    bgColor: `rgb(${ringMedR}, ${ringMedG}, ${ringMedB})`,
    textColor: style.textColor,
    textGradient: style.textGradient,
    gradientStops: style.gradientStops,
    isDark: style.isDark,
    hasTextStroke: style.hasTextStroke,
    strokeColor: style.strokeColor,
    strokeWidthEm: style.strokeWidthEm,
    shadowColor: style.shadowColor,
    shadowBlurEm: style.shadowBlurEm,
    rotationDeg: style.rotationDeg,
    letterSpacingEm: style.letterSpacingEm,
    ...(finalLineWidthsPct ? { lineWidthsPct: finalLineWidthsPct } : {}),
    ...(finalLineStyles ? { lineStyles: finalLineStyles } : {}),
    emphasisLastLineScale,
    fontSizeCqw,
  };
};

export { getFontFamilyCss };
