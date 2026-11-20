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

export const TRANSLATION_BLOCK_VERSION = 23;
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
  let collarFlatMidDarkCount = 0;
  let collarFlatVividCount = 0;
  const vividRedBannerBins = new Uint32Array(4096);
  let vividRedBannerCount = 0;
  let blackInBoxCount = 0;
  let insideBoxSampleCount = 0;
  const lineBandCollarBins = new Uint32Array(4096);
  let lineBandCollarTotal = 0;
  let outerFlatTotal = 0;
  let outerFlatDarkCount = 0;
  let outerFlatMidDarkCount = 0;

  // Dış pencere halkası siyah/çok koyu/kahverengi ve düzse ("IT'S MY FAULT...", koyu oval balonlar)
  // harf çevresindeki beyaz parıltı/dış çizginin baskın zemin sanılmasını engelle
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
        if (lum < 138) outerFlatMidDarkCount += 1;
      }
    }
  }
  const hasFlatDarkOuterSurround =
    outerFlatTotal >= 28 && outerFlatDarkCount / outerFlatTotal >= 0.55;
  const hasMidDarkOuterSurround =
    outerFlatTotal >= 28 && outerFlatMidDarkCount / outerFlatTotal >= 0.62;

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
          if (lum < 138) collarFlatMidDarkCount += weight;
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
  // ancak harf dışı yaka (!inLineCore) siyah/koyu kahverengi veya canlı renkli şerit ise ("CHAINSAWMAN", koyu balon)
  // koyu zemini koruyup devasa beyaz dış halelerin zemin sanılmasını engelle!
  const insideBrightPanel =
    insideBoxSampleCount >= 40 &&
    (whiteInBoxCount + midToneInBoxCount) / insideBoxSampleCount >= 0.56 &&
    blackInBoxCount / insideBoxSampleCount <= 0.38;
  const effFlatDarkOuterSurround = hasFlatDarkOuterSurround && !insideBrightPanel;
  const effMidDarkOuterSurround = hasMidDarkOuterSurround && !insideBrightPanel;
  const brightFlatRatio = totalFlatCount > 0 ? brightFlatCount / totalFlatCount : 0;
  const collarDarkOrVividRatio =
    collarFlatTotal > 0 ? (collarFlatDarkCount + collarFlatVividCount) / collarFlatTotal : 0;
  const collarMidDarkRatio = collarFlatTotal > 0 ? collarFlatMidDarkCount / collarFlatTotal : 0;
  const hasDarkOrVividBannerCollar = collarFlatTotal >= 16 && collarDarkOrVividRatio >= 0.36;
  const effDarkOrVividBannerCollar = hasDarkOrVividBannerCollar && !insideBrightPanel;
  const suppressDarkInk =
    insideBrightPanel ||
    (!effFlatDarkOuterSurround &&
      !effDarkOrVividBannerCollar &&
      totalFlatCount > 24 &&
      brightFlatRatio >= 0.24);
  const suppressWhiteHalo =
    effFlatDarkOuterSurround ||
    (effMidDarkOuterSurround &&
      collarFlatTotal >= 16 &&
      collarMidDarkRatio >= 0.35 &&
      brightFlatRatio >= 0.14) ||
    (effDarkOrVividBannerCollar && brightFlatRatio >= 0.22) ||
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
        (!suppressWhiteHalo || cLum < 228 || (overwhelmingBandCollar && !midToneDominated)) &&
        (!insideBrightPanel || cLum >= 120)
      ) {
        bestBin = bestCollarBin;
      }
    }
  }

  // Siyah yoğun harfli parlak kırmızı şerit ("THE BEGINNING OF A NEW ERA!") içindeki ince kırmızı aralıklar
  // tekdüze düz sayılmasa bile şerit içi kırmızı bin'i baskın zemin olarak kurtar
  if (
    !insideBrightPanel &&
    brightFlatRatio < 0.22 &&
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
  _skipRotateWrapper?: boolean;
  _srcRotationDeg?: number;
  _pageFullWidth?: number;
  _onEraseMask?: (wx0: number, wy0: number, ww: number, wh: number, eraseMask: Uint8Array) => void;
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
  // Eğik telefon / not / UI ekran bloklarında (-38°..+38°) yerel olarak bloğu dikey hizaya
  // döndürüp inpaint + dizgi yap, sonra yalnızca dar dikdörtgen yamayı geri döndürerek yapıştır
  // (çerçeve/kasa dışı köşe bulanıklığını %100 önler).
  if (!options?._skipRotateWrapper && block.lines && block.lines.length >= 1) {
    const lineAngs = block.lines
      .map((l) => l.rotRect?.angleDeg ?? l.angleDeg)
      .filter((a): a is number => a !== undefined && Math.abs(a) >= 4.5 && Math.abs(a) <= 38.0);
    const hasRotRects = block.lines.some((l) => Boolean(l.rotRect));
    const totalLines = block.lines.length;
    const totalBoxW = block.lines.reduce(
      (s, l) => s + Math.max(1, l.box[3] - l.box[1]),
      0,
    );
    const tiltedBoxW = block.lines.reduce((s, l) => {
      const a = l.rotRect?.angleDeg ?? l.angleDeg;
      return a !== undefined && Math.abs(a) >= 4.5 && Math.abs(a) <= 38.0
        ? s + Math.max(1, l.box[3] - l.box[1])
        : s;
    }, 0);
    const majorityTilted =
      totalLines === 1
        ? lineAngs.length === 1
        : lineAngs.length === totalLines ||
          (hasRotRects &&
            lineAngs.length >= Math.ceil(totalLines * 0.6) &&
            tiltedBoxW >= totalBoxW * 0.62);
    const allLinesTilted =
      lineAngs.length > 0 &&
      majorityTilted &&
      lineAngs.every((a) => Math.sign(a) === Math.sign(lineAngs[0])) &&
      Math.max(...lineAngs) - Math.min(...lineAngs) <= 6.5;
    if (allLinesTilted) {
      const sortedAngs = [...lineAngs].sort((a, b) => a - b);
      const domDeg = Number(sortedAngs[sortedAngs.length >> 1].toFixed(1));
      const rotRad = (domDeg * Math.PI) / 180;
      const cosA = Math.cos(rotRad);
      const sinA = Math.sin(rotRad);
      const detCosSin = cosA * cosA - sinA * sinA;

      const lineRects = block.lines.map((l) => {
        if (l.rotRect) {
          return {
            cx: (l.rotRect.cx / 1000) * fullWidth,
            cy: (l.rotRect.cy / 1000) * fullHeight,
            w: Math.max(16, (l.rotRect.w / 1000) * fullWidth),
            h: Math.max(10, (l.rotRect.h / 1000) * fullHeight),
            text: l.text,
            confidence: l.confidence,
          };
        }
        const lx0 = (l.box[1] / 1000) * fullWidth;
        const ly0 = (l.box[0] / 1000) * fullHeight;
        const lx1 = (l.box[3] / 1000) * fullWidth;
        const ly1 = (l.box[2] / 1000) * fullHeight;
        const aw = Math.max(16, lx1 - lx0);
        const ah = Math.max(10, ly1 - ly0);
        let rw = aw;
        let rh = ah;
        if (Math.abs(detCosSin) > 0.2) {
          rw = Math.max(24, (aw * Math.abs(cosA) - ah * Math.abs(sinA)) / detCosSin);
          rh = Math.max(12, Math.min(ah, (ah * Math.abs(cosA) - aw * Math.abs(sinA)) / detCosSin));
        }
        return {
          cx: (lx0 + lx1) * 0.5,
          cy: (ly0 + ly1) * 0.5,
          w: rw,
          h: rh,
          text: l.text,
          confidence: l.confidence,
        };
      });

      const maxSpanW = Math.max(...lineRects.map((r) => r.w));
      if (maxSpanW >= 75) {
        const anchorCx = lineRects.reduce((s, r) => s + r.cx, 0) / lineRects.length;
        const anchorCy = lineRects.reduce((s, r) => s + r.cy, 0) / lineRects.length;
        let uMin = Infinity;
        let uMax = -Infinity;
        let vMin = Infinity;
        let vMax = -Infinity;
        const lineUVs = lineRects.map((r) => {
          const dx = r.cx - anchorCx;
          const dy = r.cy - anchorCy;
          const u = dx * cosA + dy * sinA;
          const v = -dx * sinA + dy * cosA;
          const u0 = u - r.w * 0.5;
          const u1 = u + r.w * 0.5;
          const v0 = v - r.h * 0.5;
          const v1 = v + r.h * 0.5;
          if (u0 < uMin) uMin = u0;
          if (u1 > uMax) uMax = u1;
          if (v0 < vMin) vMin = v0;
          if (v1 > vMax) vMax = v1;
          return { u0, v0, u1, v1, text: r.text, confidence: r.confidence };
        });

        const uCenter = (uMin + uMax) * 0.5;
        const vCenter = (vMin + vMax) * 0.5;
        const roiCx = anchorCx + uCenter * cosA - vCenter * sinA;
        const roiCy = anchorCy + uCenter * sinA + vCenter * cosA;
        const pad = Math.max(150, Math.round((uMax - uMin) * 0.34));
        const rotW = Math.min(1440, Math.max(192, Math.ceil(uMax - uMin + pad * 2)));
        const rotH = Math.min(1440, Math.max(160, Math.ceil(vMax - vMin + pad * 2)));
        const rotHalfW = rotW * 0.5;
        const rotHalfH = rotH * 0.5;

        const rotCanvas = document.createElement('canvas');
        rotCanvas.width = rotW;
        rotCanvas.height = rotH;
        const rotCtx = rotCanvas.getContext('2d', { willReadFrequently: true });
        if (rotCtx) {
          rotCtx.save();
          // Sayfa kenarına dayanan telefonlarda ("page_2" sağ kenar vb.) taşan dış üçgenleri
          // kenardaki 1px harf mürekkebini 400px sündürmeden yerel şerit medyan rengiyle doldur
          rotCtx.fillStyle = '#0c0c0c';
          rotCtx.fillRect(0, 0, rotW, rotH);
          rotCtx.translate(rotHalfW, rotHalfH);
          rotCtx.rotate(-rotRad);
          const marginY0 = clamp(Math.floor(roiCy - rotH), 0, fullHeight - 1);
          const marginY1 = clamp(Math.ceil(roiCy + rotH), marginY0 + 1, fullHeight);
          const marginH = marginY1 - marginY0;
          const stripSampleW = Math.min(24, fullWidth);
          const fillMedianEdgeStrips = (srcX: number, dstX: number) => {
            const ed = fullCtx.getImageData(srcX, marginY0, stripSampleW, marginH).data;
            const stepY = 4;
            for (let sy = 0; sy < marginH; sy += stepY) {
              const rowSpan = Math.min(stepY, marginH - sy);
              const pxList: Array<{ lum: number; r: number; g: number; b: number }> = [];
              for (let dy = 0; dy < rowSpan; dy += 2) {
                const offBase = (sy + dy) * stripSampleW * 4;
                for (let dx = 0; dx < stripSampleW; dx += 2) {
                  const p = offBase + dx * 4;
                  const pr = ed[p];
                  const pg = ed[p + 1];
                  const pb = ed[p + 2];
                  pxList.push({ lum: 0.299 * pr + 0.587 * pg + 0.114 * pb, r: pr, g: pg, b: pb });
                }
              }
              if (pxList.length === 0) continue;
              pxList.sort((a, b) => a.lum - b.lum);
              const pick = pxList[pxList.length >> 1];
              rotCtx.fillStyle = `rgb(${pick.r},${pick.g},${pick.b})`;
              rotCtx.fillRect(dstX, marginY0 + sy - roiCy, 400, rowSpan);
            }
          };
          fillMedianEdgeStrips(Math.max(0, fullWidth - stripSampleW), fullWidth - 1 - roiCx);
          fillMedianEdgeStrips(0, -roiCx - 400);
          rotCtx.drawImage(fullCtx.canvas, 0, 0, fullWidth, 1, -roiCx, -roiCy - 400, fullWidth, 400);
          rotCtx.drawImage(fullCtx.canvas, 0, fullHeight - 1, fullWidth, 1, -roiCx, fullHeight - 1 - roiCy, fullWidth, 400);
          rotCtx.drawImage(fullCtx.canvas, -roiCx, -roiCy);
          rotCtx.restore();

          const upLines = lineUVs.map((uv) => ({
            box: [
              toNorm(rotHalfH + (uv.v0 - vCenter), rotH),
              toNorm(rotHalfW + (uv.u0 - uCenter), rotW),
              toNorm(rotHalfH + (uv.v1 - vCenter), rotH),
              toNorm(rotHalfW + (uv.u1 - uCenter), rotW),
            ] as [number, number, number, number],
            text: uv.text,
            confidence: uv.confidence,
          }));
          const upBlockBox: [number, number, number, number] = [
            toNorm(rotHalfH + (vMin - vCenter), rotH),
            toNorm(rotHalfW + (uMin - uCenter), rotW),
            toNorm(rotHalfH + (vMax - vCenter), rotH),
            toNorm(rotHalfW + (uMax - uCenter), rotW),
          ];

          const mappedSiblings: Array<[number, number, number, number]> = [];
          for (const sb of options?.siblingBoxes ?? []) {
            const sCx = ((sb[1] + sb[3]) * 0.5 / 1000) * fullWidth - roiCx;
            const sCy = ((sb[0] + sb[2]) * 0.5 / 1000) * fullHeight - roiCy;
            const sW = ((sb[3] - sb[1]) / 1000) * fullWidth;
            const sH = ((sb[2] - sb[0]) / 1000) * fullHeight;
            const su = sCx * cosA + sCy * sinA + rotHalfW;
            const sv = -sCx * sinA + sCy * cosA + rotHalfH;
            let suSpan = (sW * Math.abs(cosA) + sH * Math.abs(sinA)) * 0.42;
            let svSpan = (sW * Math.abs(sinA) + sH * Math.abs(cosA)) * 0.42;
            if (Math.abs(detCosSin) > 0.22 && sW >= sH * 0.85) {
              const deW = (sW * Math.abs(cosA) - sH * Math.abs(sinA)) / detCosSin;
              const deH = (sH * Math.abs(cosA) - sW * Math.abs(sinA)) / detCosSin;
              if (deW >= 14 && deH >= 8 && deH <= sH * 0.92) {
                suSpan = deW * 0.46;
                svSpan = deH <= 54 ? Math.min(deH * 0.38, 14) : deH * 0.42;
              }
            }
            if (su + suSpan < 0 || su - suSpan > rotW || sv + svSpan < 0 || sv - svSpan > rotH) {
              continue;
            }
            mappedSiblings.push([
              toNorm(Math.max(0, sv - svSpan), rotH),
              toNorm(Math.max(0, su - suSpan), rotW),
              toNorm(Math.min(rotH, sv + svSpan), rotH),
              toNorm(Math.min(rotW, su + suSpan), rotW),
            ]);
          }

          let rotEraseInfo: { wx0: number; wy0: number; ww: number; wh: number; eraseMask: Uint8Array } | null = null;
          const upRes = inpaintAndRefineBlock(
            rotCtx,
            rotW,
            rotH,
            {
              ...block,
              box: upBlockBox,
              lines: upLines,
            },
            targetLang,
            {
              siblingBoxes: mappedSiblings,
              _skipRotateWrapper: true,
              _srcRotationDeg: domDeg,
              _pageFullWidth: options?._pageFullWidth ?? fullWidth,
              _onEraseMask: (wx0, wy0, ww, wh, eraseMask) => {
                rotEraseInfo = { wx0, wy0, ww, wh, eraseMask };
              },
            },
          );
          if (!upRes) return null;

          // Sadece dikey hizalı sıkı `upRes.patchBox` dikdörtgenini alfa-maskeli olarak geri döndür
          const pBox = upRes.patchBox ?? upRes.box;
          const upPx0 = clamp(Math.floor((pBox[1] / 1000) * rotW), 0, rotW - 1);
          const upPy0 = clamp(Math.floor((pBox[0] / 1000) * rotH), 0, rotH - 1);
          const upPx1 = clamp(Math.ceil((pBox[3] / 1000) * rotW), upPx0 + 1, rotW);
          const upPy1 = clamp(Math.ceil((pBox[2] / 1000) * rotH), upPy0 + 1, rotH);
          const upPatchW = upPx1 - upPx0;
          const upPatchH = upPy1 - upPy0;

          const cornersUp: Array<[number, number]> = [
            [upPx0 - rotHalfW, upPy0 - rotHalfH],
            [upPx1 - rotHalfW, upPy0 - rotHalfH],
            [upPx0 - rotHalfW, upPy1 - rotHalfH],
            [upPx1 - rotHalfW, upPy1 - rotHalfH],
          ];
          let pgMinX = fullWidth;
          let pgMaxX = 0;
          let pgMinY = fullHeight;
          let pgMaxY = 0;
          for (const [cu, cv] of cornersUp) {
            const px = roiCx + cu * cosA - cv * sinA;
            const py = roiCy + cu * sinA + cv * cosA;
            if (px < pgMinX) pgMinX = px;
            if (px > pgMaxX) pgMaxX = px;
            if (py < pgMinY) pgMinY = py;
            if (py > pgMaxY) pgMaxY = py;
          }
          const pagePatchX0 = clamp(Math.floor(pgMinX) - 1, 0, fullWidth - 1);
          const pagePatchY0 = clamp(Math.floor(pgMinY) - 1, 0, fullHeight - 1);
          const pagePatchX1 = clamp(Math.ceil(pgMaxX) + 1, pagePatchX0 + 1, fullWidth);
          const pagePatchY1 = clamp(Math.ceil(pgMaxY) + 1, pagePatchY0 + 1, fullHeight);

          const outPatchCanvas = document.createElement('canvas');
          outPatchCanvas.width = pagePatchX1 - pagePatchX0;
          outPatchCanvas.height = pagePatchY1 - pagePatchY0;
          const outPatchCtx = outPatchCanvas.getContext('2d');
          let pagePatchDataUrl = '';
          if (outPatchCtx) {
            let drawSrc: HTMLCanvasElement = rotCanvas;
            let drawSx = upPx0;
            let drawSy = upPy0;
            if (rotEraseInfo) {
              const ei = rotEraseInfo as {
                wx0: number;
                wy0: number;
                ww: number;
                wh: number;
                eraseMask: Uint8Array;
              };
              const maskedUp = document.createElement('canvas');
              maskedUp.width = upPatchW;
              maskedUp.height = upPatchH;
              const maskedCtx = maskedUp.getContext('2d');
              if (maskedCtx) {
                const upImg = rotCtx.getImageData(upPx0, upPy0, upPatchW, upPatchH);
                const d = upImg.data;
                for (let py = 0; py < upPatchH; py += 1) {
                  const ry = upPy0 + py - ei.wy0;
                  for (let px = 0; px < upPatchW; px += 1) {
                    const rx = upPx0 + px - ei.wx0;
                    const aIdx = (py * upPatchW + px) * 4 + 3;
                    if (rx < 0 || rx >= ei.ww || ry < 0 || ry >= ei.wh) {
                      d[aIdx] = 0;
                      continue;
                    }
                    const mIdx = ry * ei.ww + rx;
                    if (ei.eraseMask[mIdx]) {
                      d[aIdx] = 255;
                    } else if (
                      (rx > 0 && ei.eraseMask[mIdx - 1]) ||
                      (rx + 1 < ei.ww && ei.eraseMask[mIdx + 1]) ||
                      (ry > 0 && ei.eraseMask[mIdx - ei.ww]) ||
                      (ry + 1 < ei.wh && ei.eraseMask[mIdx + ei.ww])
                    ) {
                      d[aIdx] = 170;
                    } else {
                      d[aIdx] = 0;
                    }
                  }
                }
                maskedCtx.putImageData(upImg, 0, 0);
                drawSrc = maskedUp;
                drawSx = 0;
                drawSy = 0;
              }
            }
            const upPatchMidU = (upPx0 + upPx1) * 0.5 - rotHalfW;
            const upPatchMidV = (upPy0 + upPy1) * 0.5 - rotHalfH;
            const pagePatchCx = roiCx + upPatchMidU * cosA - upPatchMidV * sinA;
            const pagePatchCy = roiCy + upPatchMidU * sinA + upPatchMidV * cosA;
            outPatchCtx.save();
            outPatchCtx.translate(pagePatchCx - pagePatchX0, pagePatchCy - pagePatchY0);
            outPatchCtx.rotate(rotRad);
            outPatchCtx.drawImage(
              drawSrc,
              drawSx,
              drawSy,
              upPatchW,
              upPatchH,
              -upPatchW * 0.5,
              -upPatchH * 0.5,
              upPatchW,
              upPatchH,
            );
            outPatchCtx.restore();
            pagePatchDataUrl = outPatchCanvas.toDataURL('image/webp', 0.92);

            fullCtx.save();
            fullCtx.beginPath();
            fullCtx.rect(0, 0, fullWidth, fullHeight);
            fullCtx.clip();
            fullCtx.drawImage(outPatchCanvas, pagePatchX0, pagePatchY0);
            fullCtx.restore();
            if (drawSrc !== rotCanvas) {
              drawSrc.width = 0;
              drawSrc.height = 0;
            }
          }
          outPatchCanvas.width = 0;
          outPatchCanvas.height = 0;
          rotCanvas.width = 0;
          rotCanvas.height = 0;

          const upRefCx = ((upRes.box[1] + upRes.box[3]) * 0.5 / 1000) * rotW - rotHalfW;
          const upRefCy = ((upRes.box[0] + upRes.box[2]) * 0.5 / 1000) * rotH - rotHalfH;
          const upRefW = ((upRes.box[3] - upRes.box[1]) / 1000) * rotW;
          const upRefH = ((upRes.box[2] - upRes.box[0]) / 1000) * rotH;
          const pageRefCx = roiCx + upRefCx * cosA - upRefCy * sinA;
          const pageRefCy = roiCy + upRefCx * sinA + upRefCy * cosA;
          const outRefW = Math.min(upRefW, fullWidth * 0.96);
          const pageFontCqw = Number(
            clamp((((upRes.fontSizeCqw ?? 2.85) / 100) * rotW / fullWidth) * 100, 1.35, 13.5).toFixed(3),
          );

          return {
            ...upRes,
            box: [
              toNorm(clamp(pageRefCy - upRefH * 0.5, 0, fullHeight - 4), fullHeight),
              toNorm(clamp(pageRefCx - outRefW * 0.5, 0, fullWidth - 4), fullWidth),
              toNorm(clamp(pageRefCy + upRefH * 0.5, 4, fullHeight), fullHeight),
              toNorm(clamp(pageRefCx + outRefW * 0.5, 4, fullWidth), fullWidth),
            ],
            patchBox: [
              toNorm(pagePatchY0, fullHeight),
              toNorm(pagePatchX0, fullWidth),
              toNorm(pagePatchY1, fullHeight),
              toNorm(pagePatchX1, fullWidth),
            ],
            patchDataUrl: pagePatchDataUrl,
            fontSizeCqw: pageFontCqw,
            rotationDeg: domDeg,
            lines: block.lines,
          };
        }
      }
    }
  }
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
  const lineAbsCenterYs = (block.lines && block.lines.length > 0 ? block.lines : [{ box: block.box }]).map(
    (l) => (((l.box[0] + l.box[2]) * 0.5) / 1000) * fullHeight,
  );
  const overlapsAnySiblingAbs = (
    ax0: number,
    ay0: number,
    ax1: number,
    ay1: number,
    requireDeepOwnership = false,
  ): boolean => {
    if (absSiblings.length === 0) return false;
    const cx = (ax0 + ax1) * 0.5;
    const cy = (ay0 + ay1) * 0.5;
    const compArea = Math.max(1, (ax1 - ax0) * (ay1 - ay0));
    let minOurDy = Infinity;
    for (let li = 0; li < lineAbsCenterYs.length; li += 1) {
      const dy = Math.abs(cy - lineAbsCenterYs[li]);
      if (dy < minOurDy) minOurDy = dy;
    }
    for (let i = 0; i < absSiblings.length; i += 1) {
      const s = absSiblings[i];
      const ox = Math.min(ax1, s.x1) - Math.max(ax0, s.x0);
      const oy = Math.min(ay1, s.y1) - Math.max(ay0, s.y0);
      const overlapRatio = ox > 0 && oy > 0 ? (ox * oy) / compArea : 0;
      if (requireDeepOwnership) {
        const sibCy = (s.y0 + s.y1) * 0.5;
        const strictlyInsideSib = cx >= s.x0 + 1 && cx <= s.x1 - 1 && cy >= s.y0 + 1 && cy <= s.y1 - 1;
        if (strictlyInsideSib && overlapRatio >= 0.72 && Math.abs(cy - sibCy) + 2 < minOurDy) {
          return true;
        }
        continue;
      }
      if (cx >= s.x0 - 2 && cx <= s.x1 + 2 && cy >= s.y0 - 2 && cy <= s.y1 + 2) return true;
      if (overlapRatio >= 0.32) return true;
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
    nearTopSeam || nearBottomSeam ? 140 : 124,
    Math.round(fullWidth * 0.175),
    bw >= 350 && maxLineSpanEstimate <= 110 ? Math.min(bw * 0.48, Math.max(140, bh * 1.4)) : bw * 0.85,
    bh * 0.95,
  );
  const padWinY = Math.max(
    96,
    Math.round(fullWidth * 0.13),
    bh * 1.15,
    bw >= 320 && maxLineSpanEstimate <= 110 ? Math.min(bw * 0.42, bh * 1.25 + 24) : bw * 0.55,
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
    let satCoreCount = 0;
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
          const cr = winRgb[cIdx];
          const cg = winRgb[cIdx + 1];
          const cb = winRgb[cIdx + 2];
          const maxC = Math.max(cr, cg, cb);
          const minC = Math.min(cr, cg, cb);
          const coreDBg = Math.max(Math.abs(cr - bgR), Math.abs(cg - bgG), Math.abs(cb - bgB));
          if (maxC >= 135 && maxC - minC >= 68 && coreDBg >= 48) {
            satCoreCount += 1;
          }
          const lum = 0.299 * cr + 0.587 * cg + 0.114 * cb;
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
    const hasVividColorCoreInk =
      bgLumInit >= 145 &&
      satCoreCount >= Math.max(18, Math.round(jetBlackCoreCount * 0.45)) &&
      satCoreCount / Math.max(1, coreSamples) >= 0.015;
    const isTiltedUiLine =
      Math.abs(options?._srcRotationDeg ?? 0) >= 3 ||
      lineCores.some((l) => Math.abs(l.angleDeg ?? 0) >= 3);
    const hasJetBlackCoreInk =
      !hasVividColorCoreInk &&
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
          // Katı siyah harfli açık zeminlerde çıta/mobilya çizgilerini dışlarken nötr konuşma balonu oval çerçevesini (lookism) koparmadan koru;
          // ancak aynı metin çekirdeği içindeki renkli vurgu kelimelerini ("6:00 A.M tomorrow" kırmızı saati vb.) asla atlama
          const isVividInlineInk = nearCore3 && maxCh >= 130 && maxCh - minCh >= 52;
          if (hasJetBlackCoreInk && !isVividInlineInk && pixLum > (nearCore3 ? 58 : 120)) {
            continue;
          }

          // Zemin rengine çok yakın pikselleri kesinlikle dışla (mavi RPG kutusu veya kahverengi parşömendeki renkli zemin pikselleri koyu harf sanılmasın)
          const dBg = Math.max(Math.abs(pr - bgR), Math.abs(pg - bgG), Math.abs(pb - bgB));
          const minBgColorDiff = isTiltedUiLine && (inCore || nearCore3) ? 20 : 26;
          const minBgLumDiff = isTiltedUiLine && (inCore || nearCore3) ? 16 : 20;
          if (dBg < minBgColorDiff && Math.abs(pixLum - bgLumInit) < minBgLumDiff) continue;
          if (
            hasVividColorCoreInk &&
            whiteCoreCount >= 18 &&
            pixLum <= 95 &&
            maxCh - minCh < 32 &&
            !(bgLumInit >= 205 && (inCore || nearCore3))
          ) {
            continue;
          }

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
          const vividWordArtOnNeutralBg =
            hasVividColorCoreInk &&
            (inCore || nearCore3) &&
            maxCh >= 135 &&
            maxCh - minCh >= 52 &&
            dBg >= 42;
          const nearCore5 = isTiltedUiLine && isNearAnyCore(x, y, 5);
          const mutedGrayTiltedUiInk =
            bgLumInit >= 175 &&
            isTiltedUiLine &&
            (inCore || nearCore5) &&
            pixLum <= bgLumInit - 14 &&
            dBg >= 14 &&
            ((dLumMedDark >= 8 && dMedDark >= 8) ||
              (pixLum <= bgLumInit - 20 && dBg >= 20));

          if (
            (meanLum >= 160 && dLumMedDark > effLocal * 0.82 && dMedDark > effLocal) ||
            nearDarkRingWhite ||
            midToneDarkInk ||
            vividBannerDarkInk ||
            vividWordArtOnNeutralBg ||
            mutedGrayTiltedUiInk ||
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
      const bgChromaInit = bgMaxChL - Math.min(bgR, bgG, bgB);
      const isVividBgL = bgMaxChL >= 120 && bgChromaInit >= 45;
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

          const pChroma = Math.max(pr, pg, pb) - Math.min(pr, pg, pb);
          if (
            nearCoreYellow &&
            bgLumInit < 95 &&
            !isVividBgL &&
            pChroma - bgChromaInit >= 42 &&
            dLocalLight >= 18 &&
            dGlobalLight >= 30 &&
            pixLum >= bgLumInit - 8
          ) {
            fg[pIdx] = 1;
            continue;
          }

          // Beyaz dış konturlu renkli/koyu başlık harfleri ("A VERY HOT PLAN..." üzerinde kırmızı dolgu)
          const pMaxC = Math.max(pr, pg, pb);
          const pMinC = Math.min(pr, pg, pb);
          const pChr = pMaxC - pMinC;
          if (
            inCore &&
            !yellowHeadlineOnly &&
            bgLumInit < 145 &&
            whiteCoreCount >= 18 &&
            pMaxC >= 68 &&
            pChr >= 32 &&
            dGlobalLight >= 26
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
      // Beyaz dış kontur halkasının ("A VERY HOT PLAN", "IT'S IMPOSSIBLE, RIGHT?") içinde kalan koyu/kırmızı harf iç dolgularını tamamla
      if (!yellowHeadlineOnly && bgLumInit < 145 && whiteCoreCount >= 18) {
        const yS = Math.max(1, cy0 - 2);
        const yE = Math.min(wh - 2, cy1 + 2);
        const xS = Math.max(1, cx0 - 2);
        const xE = Math.min(ww - 2, cx1 + 2);
        const holeRayMax = clamp(Math.round(medLineH * 0.45), 16, 36);
        const holeFills: number[] = [];
        for (let y = yS; y <= yE; y += 1) {
          const rOff = y * ww;
          for (let x = xS; x <= xE; x += 1) {
            const pIdx = rOff + x;
            if (fg[pIdx] || !isInsideAnyCore(x, y)) continue;
            const hasWallDir = (dx: number, dy: number) => {
              for (let s = 1; s <= holeRayMax; s += 1) {
                const nx = x + dx * s;
                const ny = y + dy * s;
                if (nx < 0 || nx >= ww || ny < 0 || ny >= wh) return false;
                const nIdx = ny * ww + nx;
                if (fg[nIdx]) {
                  const n3 = nIdx * 3;
                  const nLum = 0.299 * winRgb[n3] + 0.587 * winRgb[n3 + 1] + 0.114 * winRgb[n3 + 2];
                  return nLum >= 185;
                }
              }
              return false;
            };
            if (hasWallDir(-1, 0) && hasWallDir(1, 0) && hasWallDir(0, -1) && hasWallDir(0, 1)) {
              holeFills.push(pIdx);
            }
          }
        }
        for (const pIdx of holeFills) fg[pIdx] = 1;
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
            const hitImageLeftOrRightSeam =
              (curWx0 === 0 && cx <= 1) || (curWx1 === fullWidth && cx >= ww - 2);
            const hitSideOrInner =
              (cx <= 1 && curWx0 > 0) ||
              (cx >= ww - 2 && curWx1 < fullWidth) ||
              (cy <= 1 && curWy0 > 0) ||
              (cy >= wh - 2 && curWy1 < fullHeight);
            const hitSeamEdge =
              (curWy0 === 0 && cy <= 1) ||
              (curWy1 === fullHeight && cy >= wh - 2) ||
              hitImageLeftOrRightSeam;
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
    } else if (bgR >= 130 && bgR - Math.max(bgG, bgB) >= 60 && flankRs.length >= 10) {
      // Koyu bordo/siyah zeminli parlak kırmızı ("DOGS BARK.") yazılarda çekirdek baskın kırmızı haleyi arka plan sanma
      const flankNonGlowR: number[] = [];
      const flankNonGlowG: number[] = [];
      const flankNonGlowB: number[] = [];
      for (let fi = 0; fi < flankRs.length; fi += 1) {
        const fr = flankRs[fi];
        const fg = flankGs[fi];
        const fb = flankBs[fi];
        if (fr >= 130 && fr - Math.max(fg, fb) >= 60) continue;
        flankNonGlowR.push(fr);
        flankNonGlowG.push(fg);
        flankNonGlowB.push(fb);
      }
      if (flankNonGlowR.length >= 10 && flankNonGlowR.length >= flankRs.length * 0.6) {
        const fMedR = Math.round(medianOf(flankNonGlowR));
        const fMedG = Math.round(medianOf(flankNonGlowG));
        const fMedB = Math.round(medianOf(flankNonGlowB));
        const fMedLum = 0.299 * fMedR + 0.587 * fMedG + 0.114 * fMedB;
        if (fMedLum <= bgLumInit - 20) {
          bgR = fMedR;
          bgG = fMedG;
          bgB = fMedB;
          bgLumInit = fMedLum;
        }
      }
    }

    const bgMaxChPol = Math.max(bgR, bgG, bgB);
    const bgChromaPol = bgMaxChPol - Math.min(bgR, bgG, bgB);
    const isVividColoredBannerPol =
      bgMaxChPol >= 135 && bgChromaPol >= 65;
    const isBrightYellowOnScene =
      (isYellowHeadlineOnScene ||
        (yellowCoreCount >= Math.max(24, coreTotalCount * 0.08) && bgR - bgB < 80)) &&
      bgLumInit <= 215 &&
      bgLumInit >= 48;
    const isWhiteInkOnMidColoredButton =
      bgLumInit <= 205 &&
      bgChromaPol >= 18 &&
      whiteCoreCount >= 18 &&
      brighterCount >= Math.max(20, darkerCount * 2.4);
    const preferLightFirst =
      bgLumInit < 28 ||
      (!isVividColoredBannerPol && bgLumInit < 55) ||
      isWhiteFillDarkOutlineOnScene ||
      isBrightYellowOnScene ||
      isWhiteInkOnMidColoredButton ||
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

    const isSeamCutGlyphCandidate = (c: ComponentInfo): boolean => {
      if (!c.touchesImageSeamEdge || c.touchesSideOrWinEdge) return false;
      const coreRatio = c.corePixels / Math.max(1, c.area);
      const wideEdgeHeadlineRow =
        c.overlapsCore &&
        coreRatio >= 0.16 &&
        c.h <= Math.max(medLineH * 2.35, 58) &&
        c.w <= Math.max(bw * 1.15, ww * 0.94) &&
        (bh <= 72 || c.h <= bh * 0.45);
      return (
        wideEdgeHeadlineRow ||
        (c.w <= Math.max(medLineH * 3.8, 96) &&
          c.h <= Math.max(medLineH * 2.0, 48) &&
          c.area <= Math.max(medLineH * medLineH * 2.4, 950) &&
          c.w / Math.max(1, c.h) < 6.0)
      );
    };

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
          coreRatio < 0.35 &&
          c.area / Math.max(1, c.w * c.h) < 0.34)
      ) {
        return true;
      }
      return false;
    };

    const isValidGlyphComponent = (c: ComponentInfo): boolean => {
      if (c.area < 2) return false;
      if (isStructuralFrameOrDivider(c)) return false;
      if (
        overlapsAnySiblingAbs(
          curWx0 + c.minx,
          curWy0 + c.miny,
          curWx0 + c.maxx + 1,
          curWy0 + c.maxy + 1,
          c.overlapsCore,
        )
      ) {
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
        (!c.touchesBorder || (!c.touchesSideOrWinEdge && isSeamCutGlyphCandidate(c))) &&
        (coreRatio >= 0.32 ||
          (preferLightFirst && isContainedInParagraphBand) ||
          (coreRatio >= 0.14 && c.overlapsCore && c.h <= Math.max(medLineH * 2.15, 58)));
      const maxAllowedCompH = isStrongCoreOrGlowingWord
        ? Math.max(medLineH * 3.1, 72)
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
      let activeMask = fgMask;
      if (!preferLightFirst && hasVividColorCoreInk && bgLumInit >= 180) {
        let vividFgCore = 0;
        let neutralFgCore = 0;
        for (let py = Math.max(0, cy0); py < Math.min(wh, cy1); py += 1) {
          const rOff = py * ww;
          for (let px = Math.max(0, cx0); px < Math.min(ww, cx1); px += 1) {
            const idx = rOff + px;
            if (activeMask[idx] === 0) continue;
            const c3 = idx * 3;
            const chr =
              Math.max(winRgb[c3], winRgb[c3 + 1], winRgb[c3 + 2]) -
              Math.min(winRgb[c3], winRgb[c3 + 1], winRgb[c3 + 2]);
            if (chr >= 45) vividFgCore += 1;
            else if (chr < 28) neutralFgCore += 1;
          }
        }
        if (vividFgCore >= 180 && vividFgCore >= neutralFgCore * 0.75) {
          const vividOnlyMask = new Uint8Array(activeMask);
          let warmCorePixels = 0;
          for (let py = Math.max(0, cy0); py < Math.min(wh, cy1); py += 1) {
            const rOff = py * ww;
            for (let px = Math.max(0, cx0); px < Math.min(ww, cx1); px += 1) {
              const idx = rOff + px;
              if (activeMask[idx] === 0) continue;
              const c3 = idx * 3;
              const r = winRgb[c3];
              const g = winRgb[c3 + 1];
              const b = winRgb[c3 + 2];
              if (r >= 185 && g >= 65 && r - b >= 70) warmCorePixels += 1;
            }
          }
          let strippedNeutral = 0;
          for (let i = 0; i < numPixels; i += 1) {
            if (vividOnlyMask[i] === 0) continue;
            const py = (i / ww) | 0;
            const px = i - py * ww;
            const c3 = i * 3;
            const r = winRgb[c3];
            const g = winRgb[c3 + 1];
            const b = winRgb[c3 + 2];
            const pLum = 0.299 * r + 0.587 * g + 0.114 * b;
            const chr = Math.max(r, g, b) - Math.min(r, g, b);
            // Açık/temiz konuşma balonlarında ("CONGRATULATIONS...", "BURNING PASSION...") soldan sağa veya üstten alta
            // koyu siyah/kahveden canlı renge geçen harf mürekkebini (pLum <= 148) asla maskeden silme!
            const keepGradientDarkCore =
              bgLumInit >= 205 && isInsideAnyCore(px, py) && pLum <= 148;
            if (chr < 26 && !keepGradientDarkCore) {
              vividOnlyMask[i] = 0;
              strippedNeutral += 1;
            }
          }
          // Turuncu->parlak sarı gradyanlı ("congratulation!" / "lation!") harflerin yüksek parlaklıklı sarı kısımlarını da ekle
          let addedBrightGradient = 0;
          if (warmCorePixels >= 120) {
            const gy0 = Math.max(2, cy0 - 6);
            const gy1 = Math.min(wh - 3, cy1 + 8);
            const gx0 = Math.max(2, cx0 - 6);
            const gx1 = Math.min(ww - 3, cx1 + 6);
            for (let py = gy0; py <= gy1; py += 1) {
              const rOff = py * ww;
              for (let px = gx0; px <= gx1; px += 1) {
                const idx = rOff + px;
                if (vividOnlyMask[idx]) continue;
                const c3 = idx * 3;
                const r = winRgb[c3];
                const g = winRgb[c3 + 1];
                const b = winRgb[c3 + 2];
                const chr = Math.max(r, g, b) - Math.min(r, g, b);
                if (r >= 205 && g >= 125 && r - b >= 75 && chr >= 65) {
                  vividOnlyMask[idx] = 1;
                  addedBrightGradient += 1;
                }
              }
            }
          }
          if (strippedNeutral > 0 || addedBrightGradient > 0) {
            activeMask = vividOnlyMask;
          }
        }
      }
      let res = extractComponents(activeMask);
      if (!preferLightFirst && jetBlackCoreCount >= 14 && whiteCoreCount >= 14) {
        const mergedBorderIds = new Set<number>();
        for (const c of res.comps) {
          if (c.touchesBorder && c.overlapsCore && c.area >= Math.max(1800, bw * bh * 0.25)) {
            mergedBorderIds.add(c.id);
          }
        }
        if (mergedBorderIds.size > 0) {
          const splitMask = new Uint8Array(activeMask);
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
            activeMask = splitMask;
            res = extractComponents(activeMask);
          }
        }
      }
      // İnce konuşma balonu sınır çizgisinin (1-6px kalınlıkta yatay/eğik duvar) metin çekirdeği kenarındaki
      // harf veya kelimeye ("que" gibi) yandan değerek onu `touchesBorder=true` (borderMask) içine
      // yutmasını önle: önce siyah mürekkepli bloklarda sınır bileşenine yapışan açık/renkli gölgeleri (pembe saç vb. lum >= 120)
      // temizle, ardından üst, alt ve iç-yan koridoru boş olan (Jordan kutusu) harf/kelime adacığını 2px boğumdan ayır.
      if (!preferLightFirst) {
        if (jetBlackCoreCount >= 14) {
          const borderTouchIds = new Set<number>();
          for (const c of res.comps) {
            if (c.touchesBorder && c.overlapsCore && c.corePixels >= 10 && !isValidGlyphComponent(c)) {
              borderTouchIds.add(c.id);
            }
          }
          if (borderTouchIds.size > 0) {
            const darkCleanMask = new Uint8Array(activeMask);
            let cleaned = 0;
            for (let i = 0; i < numPixels; i += 1) {
              if (!borderTouchIds.has(res.labels[i])) continue;
              const c3 = i * 3;
              const pixLum = 0.299 * winRgb[c3] + 0.587 * winRgb[c3 + 1] + 0.114 * winRgb[c3 + 2];
              if (pixLum >= 120) {
                darkCleanMask[i] = 0;
                cleaned += 1;
              }
            }
            if (cleaned > 0) {
              activeMask = darkCleanMask;
              res = extractComponents(activeMask);
            }
          }
        }
        let severedMask: Uint8Array | null = null;
        const maxPeninsulaW = Math.max(48, Math.round(medLineH * 2.25));
        const minClearHalfH = 9;
        const maxClearHalfH = Math.max(18, Math.round(medLineH * 0.72));
        for (const c of res.comps) {
          if (!c.touchesBorder || !c.overlapsCore || c.corePixels < 10) continue;
          if (isValidGlyphComponent(c)) continue;
          const isCompAt = (px: number, py: number): boolean =>
            px >= 0 && px < ww && py >= 0 && py < wh && res.labels[py * ww + px] === c.id;
          const getLocalSpan = (
            px: number,
            y0: number,
            y1: number,
          ): { cnt: number; minY: number; maxY: number; span: number } => {
            let cnt = 0;
            let minY = wh;
            let maxY = -1;
            const sy0 = Math.max(0, y0);
            const sy1 = Math.min(wh - 1, y1);
            for (let py = sy0; py <= sy1; py += 1) {
              if (res.labels[py * ww + px] === c.id) {
                cnt += 1;
                if (py < minY) minY = py;
                if (py > maxY) maxY = py;
              }
            }
            return { cnt, minY, maxY, span: cnt > 0 ? maxY - minY + 1 : 0 };
          };
          for (const lc of lineCores) {
            const lcMidY = (lc.y0 + lc.y1) >> 1;
            const neckScanY0 = Math.max(0, lc.y0 - 2);
            const neckScanY1 = Math.min(wh - 1, lc.y1 - 2);
            // 1) Soldan gelen ince sınır çizgisinin satır sol kenarında (lc.x0 civarı) harf/kelime adacığında bitmesi
            const leftMinX = Math.max(4, Math.min(cx0, lc.x0) - 18);
            const leftMaxX = Math.min(ww - 10, Math.max(cx0, lc.x0) + 10);
            for (let pinchX = leftMinX; pinchX <= leftMaxX; pinchX += 1) {
              const s0 = getLocalSpan(pinchX, neckScanY0, neckScanY1);
              if (s0.span < 1 || s0.span > 6) continue;
              const neckMidY = (s0.minY + s0.maxY) >> 1;
              if (Math.abs(neckMidY - lcMidY) > Math.max(18, (lc.y1 - lc.y0) * 0.65)) continue;
              const nBand0 = neckMidY - 8;
              const nBand1 = neckMidY + 8;
              const sm1 = getLocalSpan(pinchX - 1, nBand0, nBand1);
              const sm2 = getLocalSpan(pinchX - 2, nBand0, nBand1);
              if (
                sm1.span < 1 ||
                sm1.span > 6 ||
                sm2.span < 1 ||
                sm2.span > 6 ||
                Math.max(s0.maxY, sm1.maxY, sm2.maxY) - Math.min(s0.minY, sm1.minY, sm2.minY) + 1 > 7
              ) {
                continue;
              }
              const sp1 = getLocalSpan(pinchX + 1, neckMidY - 14, neckMidY + 14);
              const sp2 = getLocalSpan(pinchX + 2, neckMidY - 14, neckMidY + 14);
              const sp3 = getLocalSpan(pinchX + 3, neckMidY - 14, neckMidY + 14);
              if (Math.max(sp1.span, sp2.span, sp3.span) < s0.span + 4) continue;

              // Üst (locY0) ve alt (locY1) boş koridor satırlarını bul
              let foundCut = false;
              const maxBx = Math.min(ww - 2, pinchX + maxPeninsulaW);
              for (let topOff = minClearHalfH; topOff <= maxClearHalfH && !foundCut; topOff += 1) {
                const locY0 = neckMidY - topOff;
                if (locY0 < 1 || isCompAt(pinchX - 1, locY0) || isCompAt(pinchX, locY0)) continue;
                for (let botOff = minClearHalfH; botOff <= maxClearHalfH && !foundCut; botOff += 1) {
                  const locY1 = neckMidY + botOff;
                  if (locY1 >= wh - 1 || isCompAt(pinchX - 1, locY1) || isCompAt(pinchX, locY1)) continue;
                  let glyphEndX = -1;
                  let maxSpan = 0;
                  let tallCols = 0;
                  for (let bx = pinchX + 1; bx <= maxBx; bx += 1) {
                    if (isCompAt(bx, locY0) || isCompAt(bx, locY1)) break;
                    const sb = getLocalSpan(bx, locY0 + 1, locY1 - 1);
                    if (sb.cnt === 0) {
                      glyphEndX = bx - 1;
                      break;
                    }
                    if (sb.span > maxSpan) maxSpan = sb.span;
                    if (sb.span >= 9) tallCols += 1;
                  }
                  const glyphW = glyphEndX - pinchX;
                  if (
                    glyphEndX > pinchX &&
                    glyphW >= 6 &&
                    glyphW <= maxPeninsulaW &&
                    maxSpan >= 10 &&
                    tallCols >= 4
                  ) {
                    if (!severedMask) severedMask = new Uint8Array(activeMask);
                    for (let py = locY0; py <= locY1; py += 1) {
                      for (let cutX = pinchX - 2; cutX <= pinchX; cutX += 1) {
                        if (cutX >= 0 && res.labels[py * ww + cutX] === c.id) {
                          severedMask[py * ww + cutX] = 0;
                        }
                      }
                    }
                    foundCut = true;
                  }
                }
              }
              if (foundCut) break;
            }
            // 2) Sağdan gelen ince sınır çizgisinin satır sağ kenarında (lc.x1 civarı) harf/kelime adacığında bitmesi
            const rightMaxX = Math.min(ww - 5, Math.max(cx1, lc.x1) + 18);
            const rightMinX = Math.max(9, Math.min(cx1, lc.x1) - 10);
            for (let pinchX = rightMaxX; pinchX >= rightMinX; pinchX -= 1) {
              const s0 = getLocalSpan(pinchX, neckScanY0, neckScanY1);
              if (s0.span < 1 || s0.span > 6) continue;
              const neckMidY = (s0.minY + s0.maxY) >> 1;
              if (Math.abs(neckMidY - lcMidY) > Math.max(18, (lc.y1 - lc.y0) * 0.65)) continue;
              const nBand0 = neckMidY - 8;
              const nBand1 = neckMidY + 8;
              const sp1 = getLocalSpan(pinchX + 1, nBand0, nBand1);
              const sp2 = getLocalSpan(pinchX + 2, nBand0, nBand1);
              if (
                sp1.span < 1 ||
                sp1.span > 6 ||
                sp2.span < 1 ||
                sp2.span > 6 ||
                Math.max(s0.maxY, sp1.maxY, sp2.maxY) - Math.min(s0.minY, sp1.minY, sp2.minY) + 1 > 7
              ) {
                continue;
              }
              const sm1 = getLocalSpan(pinchX - 1, neckMidY - 14, neckMidY + 14);
              const sm2 = getLocalSpan(pinchX - 2, neckMidY - 14, neckMidY + 14);
              const sm3 = getLocalSpan(pinchX - 3, neckMidY - 14, neckMidY + 14);
              if (Math.max(sm1.span, sm2.span, sm3.span) < s0.span + 4) continue;

              let foundCut = false;
              const minBx = Math.max(1, pinchX - maxPeninsulaW);
              for (let topOff = minClearHalfH; topOff <= maxClearHalfH && !foundCut; topOff += 1) {
                const locY0 = neckMidY - topOff;
                if (locY0 < 1 || isCompAt(pinchX, locY0) || isCompAt(pinchX + 1, locY0)) continue;
                for (let botOff = minClearHalfH; botOff <= maxClearHalfH && !foundCut; botOff += 1) {
                  const locY1 = neckMidY + botOff;
                  if (locY1 >= wh - 1 || isCompAt(pinchX, locY1) || isCompAt(pinchX + 1, locY1)) continue;
                  let glyphStartX = -1;
                  let maxSpan = 0;
                  let tallCols = 0;
                  for (let bx = pinchX - 1; bx >= minBx; bx -= 1) {
                    if (isCompAt(bx, locY0) || isCompAt(bx, locY1)) break;
                    const sb = getLocalSpan(bx, locY0 + 1, locY1 - 1);
                    if (sb.cnt === 0) {
                      glyphStartX = bx + 1;
                      break;
                    }
                    if (sb.span > maxSpan) maxSpan = sb.span;
                    if (sb.span >= 9) tallCols += 1;
                  }
                  const glyphW = pinchX - glyphStartX;
                  if (
                    glyphStartX >= 0 &&
                    glyphW >= 6 &&
                    glyphW <= maxPeninsulaW &&
                    maxSpan >= 10 &&
                    tallCols >= 4
                  ) {
                    if (!severedMask) severedMask = new Uint8Array(activeMask);
                    for (let py = locY0; py <= locY1; py += 1) {
                      for (let cutX = pinchX; cutX <= pinchX + 2; cutX += 1) {
                        if (cutX < ww && res.labels[py * ww + cutX] === c.id) {
                          severedMask[py * ww + cutX] = 0;
                        }
                      }
                    }
                    foundCut = true;
                  }
                }
              }
              if (foundCut) break;
            }
          }
        }
        if (severedMask) {
          activeMask = severedMask;
          res = extractComponents(activeMask);
        }
      }
      // Açık/karmaşık sahnede beyaz konturlu koyu/renkli yazılar ("IT'S IMPOSSIBLE, RIGHT?")
      // yanındaki beyaz kıyafet/kanepe ile birleşip pencere sınırına değdiğinde metnin tamamını atmak yerine
      // köprüyü yalnızca çekirdek kutunun (+6/+5px) dışından buda ve harf bileşenlerini kurtar.
      const preValid = res.comps.filter(isValidGlyphComponent);
      const validCorePx = preValid.reduce((s, c) => s + (c.overlapsCore ? c.corePixels : 0), 0);
      const bridgedCoreIds = new Set<number>();
      let bridgedCorePx = 0;
      for (const c of res.comps) {
        if (!c.overlapsCore || c.corePixels < 32) continue;
        if (isValidGlyphComponent(c)) continue;
        bridgedCoreIds.add(c.id);
        bridgedCorePx += c.corePixels;
      }
      if (bridgedCoreIds.size > 0 && bridgedCorePx >= Math.max(36, validCorePx * 0.65)) {
        const clippedCoreMask = new Uint8Array(activeMask);
        const keepX0 = Math.max(curWx0 > 0 ? 2 : 0, cx0 - 6);
        const keepX1 = Math.min(curWx1 < fullWidth ? ww - 3 : ww - 1, cx1 + 6);
        const keepY0 = Math.max(curWy0 > 0 ? 2 : 0, cy0 - 5);
        const keepY1 = Math.min(curWy1 < fullHeight ? wh - 3 : wh - 1, cy1 + 5);
        let trimmed = 0;
        for (let py = 0; py < wh; py += 1) {
          const rOff = py * ww;
          for (let px = 0; px < ww; px += 1) {
            const idx = rOff + px;
            if (!bridgedCoreIds.has(res.labels[idx])) continue;
            if (px < keepX0 || px > keepX1 || py < keepY0 || py > keepY1) {
              clippedCoreMask[idx] = 0;
              trimmed += 1;
            }
          }
        }
        if (trimmed > 0) {
          res = extractComponents(clippedCoreMask);
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
        let vividArea = 0;
        const vividSeeds: ComponentInfo[] = [];
        for (const c of v) {
          if (!acc.has(c.id)) continue;
          if (isVividChromaticComp(res.labels, c)) {
            vividSeeds.push(c);
            vividArea += c.area;
          } else {
            neutralCount += 1;
            neutralArea += c.area;
          }
        }
        if (
          !hasVividColorCoreInk &&
          neutralCount >= 4 &&
          neutralArea >= Math.max(80, vividArea * 3.5) &&
          vividSeeds.length > 0
        ) {
          const edgePadX = Math.max(24, Math.round(bw * 0.25));
          for (const vc of vividSeeds) {
            if (
              !vc.overlapsCore &&
              (vc.maxx > cx1 - edgePadX ||
                vc.minx < cx0 + edgePadX ||
                vc.h >= medLineH * 1.25)
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

    let usedWhiteStrokePass = false;
    if (
      whiteCoreCount >= 18 &&
      (pass.accepted.size === 0 || pass.spanW < bw * 0.72)
    ) {
      const tightWhiteMask = new Uint8Array(numPixels);
      const kx0 = Math.max(curWx0 > 0 ? 2 : 0, cx0 - 10);
      const kx1 = Math.min(curWx1 < fullWidth ? ww - 3 : ww - 1, cx1 + 10);
      const ky0 = Math.max(curWy0 > 0 ? 2 : 0, cy0 - 8);
      const ky1 = Math.min(curWy1 < fullHeight ? wh - 3 : wh - 1, cy1 + 8);
      for (let py = ky0; py <= ky1; py += 1) {
        const rOff = py * ww;
        for (let px = kx0; px <= kx1; px += 1) {
          const idx = rOff + px;
          const c3 = idx * 3;
          const pr = winRgb[c3];
          const pg = winRgb[c3 + 1];
          const pb = winRgb[c3 + 2];
          const lum = 0.299 * pr + 0.587 * pg + 0.114 * pb;
          const chr = Math.max(pr, pg, pb) - Math.min(pr, pg, pb);
          const dBg = Math.max(Math.abs(pr - bgR), Math.abs(pg - bgG), Math.abs(pb - bgB));
          if (lum >= 222 && (chr <= 24 || dBg >= 40)) {
            tightWhiteMask[idx] = 1;
          }
        }
      }
      // Dış sınır BFS + çekirdek içi beyaz-duvar ışın taraması:
      // beyaz dış konturlu koyu/mor başlık harflerini ("IT'S IMPOSSIBLE, RIGHT?") açık beyaz zeminle karıştırmadan doldur
      const bfsVisited = new Uint8Array(numPixels);
      const bfsQueue = new Int32Array(numPixels);
      let bfsHead = 0;
      let bfsTail = 0;
      const seedExterior = (px: number, py: number) => {
        const idx = py * ww + px;
        if (!tightWhiteMask[idx] && !bfsVisited[idx]) {
          bfsVisited[idx] = 1;
          bfsQueue[bfsTail++] = idx;
        }
      };
      for (let px = kx0; px <= kx1; px += 1) {
        seedExterior(px, ky0);
        seedExterior(px, ky1);
      }
      for (let py = ky0; py <= ky1; py += 1) {
        seedExterior(kx0, py);
        seedExterior(kx1, py);
      }
      while (bfsHead < bfsTail) {
        const cur = bfsQueue[bfsHead++];
        const cy = (cur / ww) | 0;
        const cx = cur - cy * ww;
        if (cx > kx0) {
          const n = cur - 1;
          if (!tightWhiteMask[n] && !bfsVisited[n]) {
            bfsVisited[n] = 1;
            bfsQueue[bfsTail++] = n;
          }
        }
        if (cx < kx1) {
          const n = cur + 1;
          if (!tightWhiteMask[n] && !bfsVisited[n]) {
            bfsVisited[n] = 1;
            bfsQueue[bfsTail++] = n;
          }
        }
        if (cy > ky0) {
          const n = cur - ww;
          if (!tightWhiteMask[n] && !bfsVisited[n]) {
            bfsVisited[n] = 1;
            bfsQueue[bfsTail++] = n;
          }
        }
        if (cy < ky1) {
          const n = cur + ww;
          if (!tightWhiteMask[n] && !bfsVisited[n]) {
            bfsVisited[n] = 1;
            bfsQueue[bfsTail++] = n;
          }
        }
      }
      const rayMax = clamp(Math.round(medLineH * 0.48), 16, 36);
      const fillIndices: number[] = [];
      const inY0 = Math.max(ky0, cy0 - 2);
      const inY1 = Math.min(ky1, cy1 + 2);
      const inX0 = Math.max(kx0, cx0 - 2);
      const inX1 = Math.min(kx1, cx1 + 2);
      for (let py = inY0; py <= inY1; py += 1) {
        const rOff = py * ww;
        for (let px = inX0; px <= inX1; px += 1) {
          const idx = rOff + px;
          if (tightWhiteMask[idx]) continue;
          if (!bfsVisited[idx]) {
            fillIndices.push(idx);
            continue;
          }
          if (!isInsideAnyCore(px, py)) continue;
          const hitsWhiteWall = (dx: number, dy: number) => {
            for (let s = 1; s <= rayMax; s += 1) {
              const nx = px + dx * s;
              const ny = py + dy * s;
              if (nx < kx0 || nx > kx1 || ny < ky0 || ny > ky1) return false;
              if (tightWhiteMask[ny * ww + nx]) return true;
            }
            return false;
          };
          if (
            hitsWhiteWall(-1, 0) &&
            hitsWhiteWall(1, 0) &&
            hitsWhiteWall(0, -1) &&
            hitsWhiteWall(0, 1)
          ) {
            fillIndices.push(idx);
          }
        }
      }
      for (const fi of fillIndices) tightWhiteMask[fi] = 1;
      const whiteStrokePass = runMaskPass(tightWhiteMask);
      if (whiteStrokePass.spanW > pass.spanW * 1.15 && whiteStrokePass.accepted.size > 0) {
        pass = whiteStrokePass;
        usedWhiteStrokePass = true;
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

    // Çekirdek içindeki harf boyutlu mürekkep nötr (siyah/gri) ise dışarıdan veya satır başından
    // canlı renkli sütun/mühür/sanat (ör. kimlik kartı mührü, kırmızı "NEW") yutmayı engelle
    let coreNeutralInk = false;
    if (!preferLightFirst && bgLumInit >= 195) {
      const neutralLetterIds = new Set(
        valid
          .filter((c) => accepted.has(c.id) && c.h <= Math.max(24, medLineH * 1.45))
          .map((c) => c.id),
      );
      let cSamples = 0;
      let cNeutral = 0;
      for (let py = Math.max(0, cy0); py < Math.min(wh, cy1); py += 1) {
        const rOff = py * ww;
        for (let px = Math.max(0, cx0); px < Math.min(ww, cx1); px += 1) {
          const idx = rOff + px;
          const cid = labels[idx];
          if (neutralLetterIds.size > 0 ? !neutralLetterIds.has(cid) : !accepted.has(cid)) continue;
          const c3 = idx * 3;
          const chr =
            Math.max(winRgb[c3], winRgb[c3 + 1], winRgb[c3 + 2]) -
            Math.min(winRgb[c3], winRgb[c3 + 1], winRgb[c3 + 2]);
          cSamples += 1;
          if (chr <= 35) cNeutral += 1;
        }
      }
      coreNeutralInk = cSamples >= 6 && cNeutral / cSamples >= 0.78;
    }

    const interiorLetterHeights = valid
      .filter((c) => c.overlapsCore && c.h >= 6 && c.minx >= cx0 + 4 && c.maxx <= cx1 - 4)
      .map((c) => c.h);
    const realLetterH =
      interiorLetterHeights.length >= 3 ? medianOf(interiorLetterHeights) : medLineH;

    const isEdgeEmblemCandidate = (cand: ComponentInfo): boolean =>
      !isSingleOrDarkSfx &&
      bw >= 48 &&
      ((cand.w >= medLineH * 1.35 &&
        cand.h >= medLineH * 1.35 &&
        (cand.maxx <= cx0 + bw * 0.36 || cand.minx >= cx1 - bw * 0.36)) ||
        (cand.minx <= cx0 - 6 && cand.maxx <= cx0 + bw * 0.34) ||
        (cand.maxx >= cx1 + 6 && cand.minx >= cx1 - bw * 0.34));

    const deletedEmblemBoxes: ComponentInfo[] = [];
    const overlapsDeletedEmblem = (cand: ComponentInfo): boolean => {
      for (let ei = 0; ei < deletedEmblemBoxes.length; ei += 1) {
        const eb = deletedEmblemBoxes[ei];
        if (
          cand.minx >= eb.minx - 10 &&
          cand.maxx <= Math.min(cx0 + 1, eb.maxx + 12) &&
          cand.miny >= eb.miny - 8 &&
          cand.maxy <= eb.maxy + 8
        ) {
          return true;
        }
      }
      return false;
    };

    const isVividExternalSidebarArt = (cand: ComponentInfo): boolean => {
      if (overlapsDeletedEmblem(cand)) return true;
      const edgeEmblem = isEdgeEmblemCandidate(cand);
      if (
        !isSingleOrDarkSfx &&
        !cand.overlapsCore &&
        cand.w >= Math.min(medLineH * 1.4, realLetterH * 1.55) &&
        cand.h >= Math.min(medLineH * 1.4, realLetterH * 1.55) &&
        Math.abs(cand.w - cand.h) <= Math.max(8, cand.w * 0.35)
      ) {
        return true;
      }
      if ((cand.overlapsCore && !edgeEmblem) || !coreNeutralInk) return false;
      if (
        edgeEmblem &&
        cand.w >= Math.min(medLineH * 1.5, realLetterH * 1.65) &&
        cand.h >= Math.min(medLineH * 1.5, realLetterH * 1.65) &&
        Math.abs(cand.w - cand.h) <= Math.max(6, cand.w * 0.34)
      ) {
        return true;
      }
      if (isVividChromaticComp(labels, cand)) return true;
      let samples = 0;
      let colored = 0;
      const syStep = cand.h > 20 ? 2 : 1;
      const sxStep = cand.w > 20 ? 2 : 1;
      for (let py = cand.miny; py <= cand.maxy; py += syStep) {
        const rOff = py * ww;
        for (let px = cand.minx; px <= cand.maxx; px += sxStep) {
          const idx = rOff + px;
          if (labels[idx] !== cand.id) continue;
          const c3 = idx * 3;
          const chr =
            Math.max(winRgb[c3], winRgb[c3 + 1], winRgb[c3 + 2]) -
            Math.min(winRgb[c3], winRgb[c3 + 1], winRgb[c3 + 2]);
          samples += 1;
          if (chr >= 36) colored += 1;
        }
      }
      if (samples >= 8 && colored / samples >= 0.14) return true;
      const squareEmblem =
        cand.w >= medLineH * 1.05 &&
        cand.h >= medLineH * 1.05 &&
        Math.abs(cand.w - cand.h) <= Math.max(5, cand.w * 0.32) &&
        cand.area >= medLineH * medLineH * 0.55;
      if (squareEmblem && !isSingleOrDarkSfx && bw >= 48) return true;
      return false;
    };

    if (coreNeutralInk && accepted.size >= 2) {
      let emblemChanged = false;
      for (const c of valid) {
        if (!accepted.has(c.id)) continue;
        const onCoreEdge =
          !isSingleOrDarkSfx &&
          bw >= 48 &&
          (c.maxx <= cx0 + bw * 0.36 || c.minx >= cx1 - bw * 0.36);
        if ((isEdgeEmblemCandidate(c) || onCoreEdge) && isVividExternalSidebarArt(c) && accepted.size > 1) {
          deletedEmblemBoxes.push(c);
          accepted.delete(c.id);
          emblemChanged = true;
        }
      }
      if (emblemChanged && accepted.size >= 2) {
        let pass = 0;
        while (pass < 2 && accepted.size >= 2) {
          pass += 1;
          let added = false;
          for (const c of valid) {
            if (accepted.has(c.id) && overlapsDeletedEmblem(c) && accepted.size > 1) {
              deletedEmblemBoxes.push(c);
              accepted.delete(c.id);
              added = true;
            }
          }
          if (!added) break;
        }
      }
    }

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
      hasVividColorCoreInk,
      usedWhiteStrokePass,
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
    bgR: initBgR,
    bgG: initBgG,
    bgB: initBgB,
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
    hasVividColorCoreInk,
    usedWhiteStrokePass,
  } = winResult;

  if (accepted.size === 0) {
    return null;
  }

  let bgR = initBgR;
  let bgG = initBgG;
  let bgB = initBgB;
  let bgLumInit = 0.299 * bgR + 0.587 * bgG + 0.114 * bgB;

  // Yapısal balon sınırlarını, RPG çerçevelerini ve yatay/dikey ayraç çizgilerini koruma maskesine al.
  // preferLightFirst sahnelerinde büyük, katı sahne arka plan bloklarını çerçeve sanıp borderMask/ringMed içine sokma.
  const borderIds = new Set<number>(
    comps
      .filter((c) => {
        if (accepted.has(c.id) || !isStructuralFrameOrDivider(c)) return false;
        if (!preferLightFirst) return true;
        const nearTextCore =
          c.maxx >= cx0 - 8 && c.minx <= cx1 + 8 && c.maxy >= cy0 - 8 && c.miny <= cy1 + 8;
        if (nearTextCore && c.area <= 900 && Math.max(c.w, c.h) <= 72) {
          return false;
        }
        const fillRatio = c.area / Math.max(1, c.w * c.h);
        return c.w <= 16 || c.h <= 16 || fillRatio < 0.22;
      })
      .map((c) => c.id),
  );
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

  const borderMask = new Uint8Array(numPixels);
  const rawGlyphMask = new Uint8Array(numPixels);
  const coreOrGlyphX0 = Math.min(cx0, gMinX) - 2;
  const coreOrGlyphX1 = Math.max(cx1, gMaxX) + 2;
  const coreOrGlyphY0 = Math.min(cy0, gMinY) - 2;
  const coreOrGlyphY1 = Math.max(cy1, gMaxY) + 2;

  for (let i = 0; i < numPixels; i += 1) {
    const lbl = labels[i];
    if (lbl !== 0) {
      if (accepted.has(lbl)) rawGlyphMask[i] = 1;
      else if (borderIds.has(lbl)) borderMask[i] = 1;
    } else if (!preferLightFirst && bgLumInit >= 165) {
      // Kalın siyah, renkli (kırmızı/mor) veya koyu konturlu konuşma balonları ve telefon/UI çerçeveleri
      const ly = (i / ww) | 0;
      const lx = i - ly * ww;
      if (
        lx < coreOrGlyphX0 ||
        lx > coreOrGlyphX1 ||
        ly < coreOrGlyphY0 ||
        ly > coreOrGlyphY1
      ) {
        const cIdx = i * 3;
        const pr = winRgb[cIdx];
        const pg = winRgb[cIdx + 1];
        const pb = winRgb[cIdx + 2];
        const pixLum = 0.299 * pr + 0.587 * pg + 0.114 * pb;
        const dBg = Math.max(Math.abs(pr - bgR), Math.abs(pg - bgG), Math.abs(pb - bgB));
        const chroma = Math.max(pr, pg, pb) - Math.min(pr, pg, pb);
        if (
          (pixLum < 128 && dBg >= 68) ||
          (bgLumInit >= 210 && pixLum < 168 && dBg >= 46) ||
          (dBg >= 84 && chroma >= 64 && pixLum < Math.max(165, bgLumInit - 55))
        ) {
          borderMask[i] = 1;
        }
      }
    }
  }

  const minGlyphH =
    !lineCores.some((l) => Math.abs(l.angleDeg ?? 0) >= 3) && lineCores.length > 0
      ? Math.max(8, Math.round(medLineH * 0.42))
      : 7;
  const sigComps = accComps.filter((c) => c.h >= minGlyphH);
  const glyphComps = sigComps.length > 0 ? sigComps : accComps.filter((c) => c.h >= 7);
  const glyphHeights = glyphComps.map((c) => c.h);
  const glyphWidths = glyphComps.map((c) => c.w);
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
  const bgChromaInit = Math.max(bgR, bgG, bgB) - Math.min(bgR, bgG, bgB);
  const isContrastBoundaryPixel = (lx: number, ly: number): boolean => {
    if (lx >= cx0 - 2 && lx <= cx1 + 2 && ly >= cy0 - 2 && ly <= cy1 + 2) return false;
    const idx = ly * ww + lx;
    if (rawGlyphMask[idx]) return false;
    const c3 = idx * 3;
    const pr = winRgb[c3];
    const pg = winRgb[c3 + 1];
    const pb = winRgb[c3 + 2];
    const pixLum = 0.299 * pr + 0.587 * pg + 0.114 * pb;
    if (preferLightFirst) {
      const pChroma = Math.max(pr, pg, pb) - Math.min(pr, pg, pb);
      if (bgLumInit >= 42 && pixLum <= 22 && pChroma <= 18 && bgLumInit - pixLum >= 32) {
        return true;
      }
      if (pChroma >= 42 && pixLum < 185) {
        return false;
      }
      return Math.abs(pixLum - bgLumInit) >= 88 && (pixLum >= 185 || pChroma <= 36);
    }
    if (!preferLightFirst && bgLumInit >= 225) {
      const pChroma = Math.max(pr, pg, pb) - Math.min(pr, pg, pb);
      const dBg = Math.max(Math.abs(pr - bgR), Math.abs(pg - bgG), Math.abs(pb - bgB));
      if (dBg >= 36 && (pixLum <= bgLumInit - 28 || pChroma >= 32)) {
        return true;
      }
    }
    if (bgChromaInit >= 22 && bgLumInit >= 130) {
      const pChroma = Math.max(pr, pg, pb) - Math.min(pr, pg, pb);
      const dBg = Math.max(Math.abs(pr - bgR), Math.abs(pg - bgG), Math.abs(pb - bgB));
      return dBg >= 72 && Math.abs(pixLum - bgLumInit) >= 42 && (pixLum < 145 || pChroma >= 60);
    }
    return false;
  };
  const checkContrastWall = preferLightFirst || bgChromaInit >= 22 || bgLumInit >= 225;
  const hasWallBandX = (lx: number, by0: number, by1: number): boolean => {
    let total = 0;
    let contrastHits = 0;
    for (let y = by0; y <= by1; y += 2) {
      if (isStructuralWallAt(lx, y)) return true;
      if (checkContrastWall) {
        total += 1;
        if (isContrastBoundaryPixel(lx, y)) contrastHits += 1;
      }
    }
    return total >= 3 && contrastHits / total >= 0.55;
  };
  const hasWallBandY = (ly: number, bx0: number, bx1: number): boolean => {
    let total = 0;
    let contrastHits = 0;
    for (let x = bx0; x <= bx1; x += 3) {
      if (isStructuralWallAt(x, ly)) return true;
      if (checkContrastWall) {
        total += 1;
        if (isContrastBoundaryPixel(x, ly)) contrastHits += 1;
      }
    }
    return total >= 3 && contrastHits / total >= 0.55;
  };
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
    let hit = hasWallBandX(x, bandY0, bandY1);
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
    let hit = hasWallBandX(x, bandY0, bandY1);
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
    if (hasWallBandY(y, bandX0, bandX1)) {
      safeLocalTop = y + wallPadY;
      hitTopWall = true;
      break;
    }
  }

  let safeLocalBottom = wh;
  let hitBottomWall = false;
  for (let y = gMaxY; y < wh; y += 1) {
    if (hasWallBandY(y, bandX0, bandX1)) {
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
        if (hasWallBandX(x, by0, by1)) {
          lWall = x + wallPadX;
          break;
        }
      }
      let rWall = safeLocalRight;
      for (let x = midX; x < ww; x += 1) {
        if (hasWallBandX(x, by0, by1)) {
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
  let preHaloWhiteOverTinted = false;
  let preOuterChr = 0;
  if (!preferLightFirst && bgLumInit >= 195) {
    let whiteRimCount = 0;
    const ogRs: number[] = [];
    const ogGs: number[] = [];
    const ogBs: number[] = [];
    const ogLums: number[] = [];
    const gyA = Math.max(5, gMinY - 18);
    const gyB = Math.min(wh - 6, gMaxY + 18);
    const gxA = Math.max(5, gMinX - 24);
    const gxB = Math.min(ww - 6, gMaxX + 24);
    for (let y = gyA; y <= gyB; y += 2) {
      const rOff = y * ww;
      for (let x = gxA; x <= gxB; x += 2) {
        const idx = rOff + x;
        if (combinedMask[idx] || borderMask[idx]) continue;
        const cIdx = idx * 3;
        const pr = winRgb[cIdx];
        const pg = winRgb[cIdx + 1];
        const pb = winRgb[cIdx + 2];
        const pLum = 0.299 * pr + 0.587 * pg + 0.114 * pb;
        const pChr = Math.max(pr, pg, pb) - Math.min(pr, pg, pb);
        const nearGlyph2 =
          combinedMask[idx - 2] ||
          combinedMask[idx + 2] ||
          combinedMask[idx - 2 * ww] ||
          combinedMask[idx + 2 * ww];
        if (nearGlyph2) {
          if (pLum >= 235 && pChr <= 18) whiteRimCount += 1;
          continue;
        }
        const farFromGlyph5 =
          !combinedMask[idx - 5] &&
          !combinedMask[idx + 5] &&
          !combinedMask[idx - 5 * ww] &&
          !combinedMask[idx + 5 * ww] &&
          !combinedMask[idx - 3 - 3 * ww] &&
          !combinedMask[idx + 3 - 3 * ww] &&
          !combinedMask[idx - 3 + 3 * ww] &&
          !combinedMask[idx + 3 + 3 * ww];
        if (farFromGlyph5 && pLum >= 120) {
          ogRs.push(pr);
          ogGs.push(pg);
          ogBs.push(pb);
          ogLums.push(pLum);
        }
      }
    }
    if (ogLums.length >= 20 && whiteRimCount >= 10) {
      const oMedR = Math.round(medianOf(ogRs));
      const oMedG = Math.round(medianOf(ogGs));
      const oMedB = Math.round(medianOf(ogBs));
      const oMedLum = 0.299 * oMedR + 0.587 * oMedG + 0.114 * oMedB;
      const oChr = Math.max(oMedR, oMedG, oMedB) - Math.min(oMedR, oMedG, oMedB);
      const initChr = Math.max(bgR, bgG, bgB) - Math.min(bgR, bgG, bgB);
      if (
        oMedLum <= 249 &&
        (bgLumInit - oMedLum >= 3 ||
          oMedLum <= 244 ||
          (oChr >= 6 && oChr >= initChr + 3 && oMedLum <= 248))
      ) {
        bgR = oMedR;
        bgG = oMedG;
        bgB = oMedB;
        bgLumInit = oMedLum;
        preOuterChr = oChr;
        preHaloWhiteOverTinted = true;
      }
    }
  }

  if (
    !preferLightFirst &&
    (preHaloWhiteOverTinted ||
      bgLumInit < 236 ||
      (wallHitsEarly < 3 && bgLumInit < 248 && whiteCoreCount >= 12))
  ) {
    const haloSteps = preHaloWhiteOverTinted
      ? clamp(Math.round(medGlyphH * 0.24), 6, 18)
      : hasVividColorCoreInk && bgLumInit >= 185
        ? 1
        : bgLumInit < 175 && whiteCoreCount >= 12
          ? 5
          : isSingleOrDarkSfx || bgLumInit < 190
            ? 3
            : 2;
    const preHaloPad = clamp(Math.round(medGlyphH * 0.26), 6, 20);
    for (let step = 0; step < haloSteps; step += 1) {
      let haloAdded = 0;
      const nextMask = new Uint8Array(preDilateMask);
      for (let y = Math.max(1, gMinY - preHaloPad); y <= Math.min(wh - 2, gMaxY + preHaloPad); y += 1) {
        const rOff = y * ww;
        for (let x = Math.max(1, gMinX - preHaloPad); x <= Math.min(ww - 2, gMaxX + preHaloPad); x += 1) {
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
            const pChroma = Math.max(pr, pg, pb) - Math.min(pr, pg, pb);
            const dGlowBg = Math.max(pr - bgR, pg - bgG, pb - bgB);
            if (
              (preHaloWhiteOverTinted &&
                pLum >= Math.max(bgLumInit >= 195 ? 222 : 238, bgLumInit + (bgLumInit >= 195 ? 5 : 26)) &&
                (pChroma <= (bgLumInit >= 195 ? Math.max(18, preOuterChr * 0.78) : 12) ||
                  pLum >= Math.min(248, bgLumInit + (bgLumInit >= 195 ? 8 : 28)))) ||
              (bgLumInit >= 205
                ? pLum >= 232 && pLum > bgLumInit + 16
                : pLum >= 216 && pLum > bgLumInit + 22) ||
              (bgLumInit < 175 && pLum >= 198 && pLum > bgLumInit + 32 && pChroma <= 32) ||
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
    if (usedWhiteStrokePass) {
      // `whiteStrokePass` (tightWhiteMask) ile yakalanan beyaz dolgulu/bulutlu harflerin ("que" içindeki "q" gibi)
      // dış kenarda kalan 2-4px siyah/koyu harf konturlarını, ince yatay balon duvarına (dikey kalınlık <= 3px)
      // sıçramadan emerek silme maskesine dahil et.
      const dkX0 = Math.max(2, Math.min(cx0, gMinX) - 4);
      const dkX1 = Math.min(ww - 3, Math.max(cx1, gMaxX) + 4);
      const dkY0 = Math.max(2, Math.min(cy0, gMinY) - 4);
      const dkY1 = Math.min(wh - 3, Math.max(cy1, gMaxY) + 4);
      const darkOutlineLumLimit = Math.min(152, bgLumInit - 14);
      const hasVerticalDarkThickness = (px: number, py: number): boolean => {
        let run = 1;
        for (let dy = 1; dy <= 4 && py - dy >= 0; dy += 1) {
          const c3 = ((py - dy) * ww + px) * 3;
          const lum = 0.299 * winRgb[c3] + 0.587 * winRgb[c3 + 1] + 0.114 * winRgb[c3 + 2];
          if (lum <= darkOutlineLumLimit) run += 1;
          else break;
        }
        for (let dy = 1; dy <= 4 && py + dy < wh; dy += 1) {
          const c3 = ((py + dy) * ww + px) * 3;
          const lum = 0.299 * winRgb[c3] + 0.587 * winRgb[c3 + 1] + 0.114 * winRgb[c3 + 2];
          if (lum <= darkOutlineLumLimit) run += 1;
          else break;
        }
        return run >= 4;
      };
      for (let step = 0; step < 4; step += 1) {
        let darkAdded = 0;
        const nextMask = new Uint8Array(preDilateMask);
        for (let y = dkY0; y <= dkY1; y += 1) {
          const rOff = y * ww;
          for (let x = dkX0; x <= dkX1; x += 1) {
            const idx = rOff + x;
            if (preDilateMask[idx] || borderMask[idx]) continue;
            const touches8 =
              preDilateMask[idx - 1] ||
              preDilateMask[idx + 1] ||
              preDilateMask[idx - ww] ||
              preDilateMask[idx + ww] ||
              preDilateMask[idx - ww - 1] ||
              preDilateMask[idx - ww + 1] ||
              preDilateMask[idx + ww - 1] ||
              preDilateMask[idx + ww + 1];
            if (!touches8) continue;
            const c3 = idx * 3;
            const pLum = 0.299 * winRgb[c3] + 0.587 * winRgb[c3 + 1] + 0.114 * winRgb[c3 + 2];
            if (
              pLum <= darkOutlineLumLimit &&
              (preDilateMask[idx - ww] ||
                preDilateMask[idx + ww] ||
                hasVerticalDarkThickness(x, y))
            ) {
              nextMask[idx] = 1;
              darkAdded += 1;
            }
          }
        }
        preDilateMask = nextMask;
        if (darkAdded === 0) break;
      }
    }
  } else if (preferLightFirst) {
    // Dış halka arkaplan parlaklığını satır bazlı ve genel olarak ölç ("lineCores" siyah dış kontur yüzünden yanılmış olsa bile!)
    const outerBgLums: number[] = [];
    const outerBgRs: number[] = [];
    const outerBgGs: number[] = [];
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
        outerBgGs.push(og);
        outerBgBs.push(ob);
      }
    }
    const outerBgLum = outerBgLums.length >= 10 ? medianOf(outerBgLums) : bgLumInit;
    const outerBgR = outerBgRs.length >= 10 ? medianOf(outerBgRs) : bgR;
    const outerBgG = outerBgGs.length >= 10 ? medianOf(outerBgGs) : bgG;
    const outerBgB = outerBgBs.length >= 10 ? medianOf(outerBgBs) : bgB;
    const effOuterBg = Math.max(bgLumInit, outerBgLum);

    if (effOuterBg < 92) {
      // Koyu/kırmızı oval veya karanlık sahne üzerindeki parıltıyı (glow) tamamen yut ki
      // halka örneklemesi parıltıya takılmasın ve koyu zeminde kırmızı/beyaz leke kalmasın
      const outerBgChroma =
        Math.max(outerBgR, outerBgG, outerBgB) - Math.min(outerBgR, outerBgG, outerBgB);
      const glowMaxSteps = 8;
      const glowPad = 10;
      for (let step = 0; step < glowMaxSteps; step += 1) {
        let lightGlowAdded = 0;
        const nextMask = new Uint8Array(preDilateMask);
        for (let y = Math.max(1, gMinY - glowPad); y <= Math.min(wh - 2, gMaxY + glowPad); y += 1) {
          const rOff = y * ww;
          for (let x = Math.max(1, gMinX - glowPad); x <= Math.min(ww - 2, gMaxX + glowPad); x += 1) {
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
              const pMax = Math.max(pr, pg, pb);
              const pChroma = pMax - Math.min(pr, pg, pb);
              const pSat = pChroma >= 12 ? pChroma / Math.max(pMax, 48) : 0;
              const dGlow = Math.max(pr - outerBgR, pg - outerBgG, pb - outerBgB);
              const nearDarkBgFringe = pLum <= effOuterBg - 2 && pSat >= 0.48 && dGlow > 12;
              if (
                pLum > Math.max(effOuterBg + 14, bgLumInit + 14, 18) ||
                ((dGlow > 16 || (pChroma > outerBgChroma + 20 && dGlow > 16)) && pLum >= 16) ||
                nearDarkBgFringe
              ) {
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
                    (pLum <= 26 && sat < 0.28 && rowBgLum >= 22 && pLum <= rowBgLum - 3))) ||
                (pLum <= Math.min(38, rowBgLum - 10) &&
                  rowBgLum >= 28 &&
                  (sat < 0.48 || (pr > pb + 20 && pLum <= 36)))
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
  const isTiltedSmallPaperDarkInk =
    !preferLightFirst &&
    bgLumInit >= 180 &&
    (medGlyphH <= 26 || Math.abs(options?._srcRotationDeg ?? 0) >= 4.5);
  const dilateSteps =
    hasVividColorCoreInk && bgLumInit >= 185
      ? 2
      : isOpenCleanDarkInk
        ? medGlyphH >= 36 || isTiltedSmallPaperDarkInk
          ? 3
          : 2
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
          bgLumInit >= 45 &&
          bgLumInit <= 242 &&
          pLum >= Math.max(218, bgLumInit + (bgLumInit < 140 ? 28 : 14)) &&
          pChromaRing <= (bgLumInit < 140 ? 22 : 14) &&
          (bgLumInit < 140 || bgChroma <= 16);
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

  let hasWhiteHaloOverGradientOrTintedBg = preHaloWhiteOverTinted;
  // Kalın beyaz parlamalı ("#EFEAEF" veya pastel pembe balonda koyu harf + 5px saf beyaz halo) balonlarda
  // 2px iç halka saf beyazı (#FFFFFF) ölçebileceğinden 6..18px dışındaki/aralardaki gerçek temiz zemini doğrula.
  if (!preferLightFirst && !hasVividColorCoreInk && (ringMedLum >= 228 || bgLumInit >= 228 || preHaloWhiteOverTinted)) {
    const outRs: number[] = [];
    const outGs: number[] = [];
    const outBs: number[] = [];
    const gapRs: number[] = [];
    const gapGs: number[] = [];
    const gapBs: number[] = [];
    const ox0 = Math.max(5, egMinX - 18);
    const ox1 = Math.min(ww - 6, egMaxX + 18);
    const oy0 = Math.max(5, egMinY - 14);
    const oy1 = Math.min(wh - 6, egMaxY + 14);
    for (let y = oy0; y <= oy1; y += 2) {
      const inInnerY = y >= egMinY - 5 && y <= egMaxY + 5;
      const rOff = y * ww;
      for (let x = ox0; x <= ox1; x += 2) {
        const idx = rOff + x;
        if (eraseMask[idx] || borderMask[idx]) continue;
        const cIdx = idx * 3;
        const pr = winRgb[cIdx];
        const pg = winRgb[cIdx + 1];
        const pb = winRgb[cIdx + 2];
        const pLum = 0.299 * pr + 0.587 * pg + 0.114 * pb;
        if (pLum < 120) continue;
        if (!inInnerY || x < egMinX - 5 || x > egMaxX + 5) {
          outRs.push(pr);
          outGs.push(pg);
          outBs.push(pb);
        } else if (
          !rawGlyphMask[idx - 5] &&
          !rawGlyphMask[idx + 5] &&
          !rawGlyphMask[idx - 5 * ww] &&
          !rawGlyphMask[idx + 5 * ww]
        ) {
          gapRs.push(pr);
          gapGs.push(pg);
          gapBs.push(pb);
        }
      }
    }
    const useRs = outRs.length >= 18 ? outRs : gapRs.length >= 18 ? gapRs : outRs;
    const useGs = outRs.length >= 18 ? outGs : gapRs.length >= 18 ? gapGs : outGs;
    const useBs = outRs.length >= 18 ? outBs : gapRs.length >= 18 ? gapBs : outBs;
    if (useRs.length >= 18) {
      const oMedR = Math.round(medianOf(useRs));
      const oMedG = Math.round(medianOf(useGs));
      const oMedB = Math.round(medianOf(useBs));
      const oMedLum = 0.299 * oMedR + 0.587 * oMedG + 0.114 * oMedB;
      const oChroma = Math.max(oMedR, oMedG, oMedB) - Math.min(oMedR, oMedG, oMedB);
      const innerChroma = Math.max(ringMedR, ringMedG, ringMedB) - Math.min(ringMedR, ringMedG, ringMedB);
      let oVar = 0;
      let oClose = 0;
      for (let i = 0; i < useRs.length; i += 1) {
        const dr = useRs[i] - oMedR;
        const dg = useGs[i] - oMedG;
        const db = useBs[i] - oMedB;
        if (Math.max(Math.abs(dr), Math.abs(dg), Math.abs(db)) <= 12) oClose += 1;
        oVar += (dr * dr + dg * dg + db * db) / 3;
      }
      const oStd = Math.sqrt(oVar / useRs.length);
      if (
        oMedLum >= 135 &&
        oMedLum <= 248 &&
        ((oMedLum <= ringMedLum - 2.5 && (oStd <= 24 || oChroma >= 5)) ||
          (oChroma >= 6 && oChroma >= innerChroma + 2 && oMedLum <= 247) ||
          (oStd >= 5.5 && oMedLum <= 245) ||
          (preHaloWhiteOverTinted && oMedLum <= 248))
      ) {
        hasWhiteHaloOverGradientOrTintedBg = true;
        ringMedR = oMedR;
        ringMedG = oMedG;
        ringMedB = oMedB;
        ringMedLum = oMedLum;
        ringStd = oStd;
        ringCloseRatio = oClose / useRs.length;
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
                  pLum >= Math.max(ringMedLum >= 195 ? 222 : 238, ringMedLum + (ringMedLum >= 195 ? 4 : 26)) &&
                  (pChr <= (ringMedLum >= 195 ? Math.max(16, oChroma * 0.78) : 12) ||
                    pLum >= Math.min(248, ringMedLum + (ringMedLum >= 195 ? 7 : 28)))
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
  const isSingleStandaloneSfx =
    origLineCount === 1 &&
    !hasClosedBubbleWalls &&
    wallHits < 3 &&
    !/[?]/.test(trimmedOrig);
  const hasRealEnclosedSpeechBubble =
    hasActualPhysicalWalls &&
    wallHits >= 3 &&
    !style.hasTextStroke &&
    !hasTexturedSceneInterior &&
    ringStd <= 12;
  const isSingleUppercaseStandaloneSfx =
    origLineCount === 1 &&
    trimmedOrig === trimmedOrig.toUpperCase() &&
    !/[?\/\\]/.test(trimmedOrig) &&
    !hasRealEnclosedSpeechBubble;
  if (
    (!hasClosedBubbleWalls &&
      cleanedAlphaOnly.length <= 1 &&
      !/^\d+$/.test(trimmedOrig) &&
      bgLumInit < 235) ||
    (REPEATED_ONLY_SFX_STEMS.has(cleanedAlphaOnly) &&
      !isSingleLineStat &&
      !hasRealEnclosedSpeechBubble &&
      (!hasActualPhysicalWalls ||
        style.kind === 'sfx' ||
        style.hasTextStroke ||
        hasTexturedSceneInterior ||
        ringStd > 12 ||
        isSingleUppercaseStandaloneSfx ||
        isSingleStandaloneSfx) &&
      !/[?]/.test(origOrTranslatedText))
  ) {
    return null;
  }

  // 3 Kademeli Uyarlanır Inpainting:
  // Kademe 1 (düz renkli konuşma balonu): %100 lekesiz medyan dolgu
  // Kademe 2 (dokulu sahne / SFX / RPG kutusu): Sınır korumalı İzofot Telea Fast Marching + Harmonik Difüzyon
  const ringMedChroma =
    Math.max(ringMedR, ringMedG, ringMedB) - Math.min(ringMedR, ringMedG, ringMedB);
  const useInteriorGradBounds =
    hasActualPhysicalWalls &&
    safeLocalRight > safeLocalLeft + 16 &&
    safeLocalBottom > safeLocalTop + 16;
  const gradY0 = useInteriorGradBounds ? clamp(safeLocalTop + 2, 2, wh - 3) : 2;
  const gradY1 = useInteriorGradBounds ? clamp(safeLocalBottom - 2, gradY0, wh - 3) : wh - 3;
  const gradX0 = useInteriorGradBounds ? clamp(safeLocalLeft + 2, 2, ww - 3) : 2;
  const gradX1 = useInteriorGradBounds ? clamp(safeLocalRight - 2, gradX0, ww - 3) : ww - 3;

  // Pastel/pembe radyal gradyanlı balonlarda merkez saf beyaz (#FFF) olsa bile dış eteklerde
  // renk/parlaklık gradyanı varsa düz beyaz dolgu yerine doku enterpolasyonu uygula
  let hasOuterGradientTint = false;
  if (!preferLightFirst && !hasTexturedSceneInterior && ringMedLum >= 225) {
    const winLums: number[] = [];
    const winChrs: number[] = [];
    for (let y = gradY0; y <= gradY1; y += 3) {
      const rOff = y * ww;
      for (let x = gradX0; x <= gradX1; x += 3) {
        const idx = rOff + x;
        if (eraseMask[idx] || borderMask[idx]) continue;
        const c3 = idx * 3;
        const er = winRgb[c3];
        const eg = winRgb[c3 + 1];
        const eb = winRgb[c3 + 2];
        const eLum = 0.299 * er + 0.587 * eg + 0.114 * eb;
        if (eLum < 175) continue;
        winLums.push(eLum);
        winChrs.push(Math.max(er, eg, eb) - Math.min(er, eg, eb));
      }
    }
    if (winLums.length >= 24) {
      winLums.sort((a, b) => a - b);
      winChrs.sort((a, b) => a - b);
      const p15Lum = winLums[Math.floor(winLums.length * 0.15)];
      const p90Chr = winChrs[Math.floor(winChrs.length * 0.9)];
      const p95Chr = winChrs[Math.floor(winChrs.length * 0.95)];
      if ((p90Chr >= 10 && ringMedChroma <= 6) || (p95Chr >= 12 && ringMedLum - p15Lum >= 14)) {
        hasOuterGradientTint = true;
      }
    }
  }
  let bgGradDelta = 0;
  if (!preferLightFirst && !hasTexturedSceneInterior && bgLumInit >= 165) {
    const topL: number[] = [];
    const topR: number[] = [];
    const topG: number[] = [];
    const topB: number[] = [];
    const botL: number[] = [];
    const botR: number[] = [];
    const botG: number[] = [];
    const botB: number[] = [];
    const leftL: number[] = [];
    const leftR: number[] = [];
    const leftG: number[] = [];
    const leftB: number[] = [];
    const rightL: number[] = [];
    const rightR: number[] = [];
    const rightG: number[] = [];
    const rightB: number[] = [];
    const halfY = (gradY0 + gradY1) * 0.5;
    const halfX = (gradX0 + gradX1) * 0.5;
    for (let y = gradY0; y <= gradY1; y += 3) {
      const rOff = y * ww;
      for (let x = gradX0; x <= gradX1; x += 3) {
        const idx = rOff + x;
        if (eraseMask[idx] || borderMask[idx]) continue;
        const c3 = idx * 3;
        const er = winRgb[c3];
        const eg = winRgb[c3 + 1];
        const eb = winRgb[c3 + 2];
        const eLum = 0.299 * er + 0.587 * eg + 0.114 * eb;
        if (eLum < 165) continue;
        if (y < halfY) {
          topL.push(eLum);
          topR.push(er);
          topG.push(eg);
          topB.push(eb);
        } else {
          botL.push(eLum);
          botR.push(er);
          botG.push(eg);
          botB.push(eb);
        }
        if (x < halfX) {
          leftL.push(eLum);
          leftR.push(er);
          leftG.push(eg);
          leftB.push(eb);
        } else {
          rightL.push(eLum);
          rightR.push(er);
          rightG.push(eg);
          rightB.push(eb);
        }
      }
    }
    if (topL.length >= 8 && botL.length >= 8) {
      const vd = Math.max(
        Math.abs(medianOf(topL) - medianOf(botL)),
        Math.abs(medianOf(topR) - medianOf(botR)),
        Math.abs(medianOf(topG) - medianOf(botG)),
        Math.abs(medianOf(topB) - medianOf(botB)),
      );
      if (vd > bgGradDelta) bgGradDelta = vd;
    }
    if (leftL.length >= 8 && rightL.length >= 8) {
      const hd = Math.max(
        Math.abs(medianOf(leftL) - medianOf(rightL)),
        Math.abs(medianOf(leftR) - medianOf(rightR)),
        Math.abs(medianOf(leftG) - medianOf(rightG)),
        Math.abs(medianOf(leftB) - medianOf(rightB)),
      );
      if (hd > bgGradDelta) bgGradDelta = hd;
    }
  }
  const isOpenWhiteHaloScene =
    style.hasTextStroke &&
    style.strokeColor.toLowerCase() === '#ffffff' &&
    !hasActualPhysicalWalls &&
    (ringMedLum <= 249 || hasTexturedSceneInterior);
  const isNeutralJpegLightBox =
    hasActualPhysicalWalls &&
    wallHits >= 3 &&
    !hasTexturedSceneInterior &&
    !hasWhiteHaloOverGradientOrTintedBg &&
    !hasOuterGradientTint &&
    !isOpenWhiteHaloScene &&
    !preferLightFirst &&
    ringMedLum >= 236 &&
    ringStd < 2.6 &&
    ringMedChroma <= 6 &&
    bgGradDelta < 4.5 &&
    ringCloseRatio >= 0.72;
  const isGradientLightBubble =
    !preferLightFirst &&
    !isNeutralJpegLightBox &&
    Math.max(bgLumInit, ringMedLum) >= 175 &&
    (hasOuterGradientTint ||
      isOpenWhiteHaloScene ||
      (ringStd >= 3.2 && (ringMedChroma >= 8 || ringMedLum < 240 || (ringStd >= 4.2 && ringMedLum < 244))) ||
      (!hasTexturedSceneInterior && wallHits >= 2 && ringMedLum <= 242 && (style.hasTextStroke || ringStd < 6.5)) ||
      (ringMedChroma >= 8 && bgLumInit >= ringMedLum + 6));

  const hasWhiteStrokeHalo =
    !preferLightFirst &&
    !isNeutralJpegLightBox &&
    (hasWhiteHaloOverGradientOrTintedBg ||
      hasOuterGradientTint ||
      (style.hasTextStroke &&
        style.strokeColor.toLowerCase() === '#ffffff' &&
        (ringMedLum <= 249 || isOpenWhiteHaloScene || hasTexturedSceneInterior)) ||
      (hasVividColorCoreInk && !hasClosedBubbleWalls && ringMedLum <= 244));

  if (isGradientLightBubble || hasWhiteStrokeHalo) {
    // Açık mavi/pastel/gri balonlarda harf merkezindeki beyaz gradyan nedeniyle atlanan
    // saf beyaz (#FFFFFF) harf dış kontur halesini satır-bazlı dış zemin parlaklığıyla kıyaslayıp sil.
    const rowOuterLum = new Float32Array(wh);
    const rowOuterChroma = new Float32Array(wh);
    rowOuterLum.fill(ringMedLum);
    rowOuterChroma.fill(ringMedChroma);
    const isDenseTexturedHalo = isOpenWhiteHaloScene && hasTexturedSceneInterior;
    const scanBandX0 = Math.max(0, egMinX);
    const scanBandX1 = Math.min(ww - 1, egMaxX);
    for (let y = Math.max(0, egMinY - 4); y <= Math.min(wh - 1, egMaxY + 4); y += 1) {
      let rowGMinX = ww;
      let rowGMaxX = -1;
      const by0 = Math.max(0, y - 3);
      const by1 = Math.min(wh - 1, y + 3);
      for (let by = by0; by <= by1; by += 1) {
        const bOff = by * ww;
        for (let bx = scanBandX0; bx <= scanBandX1; bx += 1) {
          if (eraseMask[bOff + bx]) {
            if (bx < rowGMinX) rowGMinX = bx;
            if (bx > rowGMaxX) rowGMaxX = bx;
          }
        }
      }
      if (rowGMaxX < rowGMinX) {
        rowGMinX = egMinX;
        rowGMaxX = egMaxX;
      }

      const rOff = y * ww;
      const leftLums: number[] = [];
      const leftChrs: number[] = [];
      const minLeftX = Math.max(0, rowGMinX - 28);
      for (let x = rowGMinX - 4; x >= minLeftX; x -= 1) {
        const idx = rOff + x;
        if (borderMask[idx]) break;
        if (eraseMask[idx]) continue;
        const cIdx = idx * 3;
        const pr = winRgb[cIdx];
        const pg = winRgb[cIdx + 1];
        const pb = winRgb[cIdx + 2];
        leftLums.push(0.299 * pr + 0.587 * pg + 0.114 * pb);
        leftChrs.push(Math.max(pr, pg, pb) - Math.min(pr, pg, pb));
      }

      const rightLums: number[] = [];
      const rightChrs: number[] = [];
      const maxRightX = Math.min(ww - 1, rowGMaxX + 28);
      for (let x = rowGMaxX + 4; x <= maxRightX; x += 1) {
        const idx = rOff + x;
        if (borderMask[idx]) break;
        if (eraseMask[idx]) continue;
        const cIdx = idx * 3;
        const pr = winRgb[cIdx];
        const pg = winRgb[cIdx + 1];
        const pb = winRgb[cIdx + 2];
        rightLums.push(0.299 * pr + 0.587 * pg + 0.114 * pb);
        rightChrs.push(Math.max(pr, pg, pb) - Math.min(pr, pg, pb));
      }

      if (isDenseTexturedHalo) {
        const innerLums: number[] = [];
        const innerChrs: number[] = [];
        const inX0 = Math.max(0, rowGMinX);
        const inX1 = Math.min(ww - 1, rowGMaxX);
        for (let x = inX0; x <= inX1; x += 1) {
          const idx = rOff + x;
          if (eraseMask[idx] || borderMask[idx]) continue;
          const cIdx = idx * 3;
          const pr = winRgb[cIdx];
          const pg = winRgb[cIdx + 1];
          const pb = winRgb[cIdx + 2];
          const pLum = 0.299 * pr + 0.587 * pg + 0.114 * pb;
          if (pLum < 220) {
            innerLums.push(pLum);
            innerChrs.push(Math.max(pr, pg, pb) - Math.min(pr, pg, pb));
          }
        }
        let bestMedLum = Infinity;
        let bestChrs: number[] | null = null;
        for (const [cLums, cChrs] of [
          [leftLums, leftChrs],
          [rightLums, rightChrs],
          [innerLums, innerChrs],
        ]) {
          if (cLums.length >= 4) {
            const medL = medianOf(cLums);
            if (medL < bestMedLum) {
              bestMedLum = medL;
              bestChrs = cChrs;
            }
          }
        }
        if (bestChrs !== null) {
          rowOuterLum[y] = bestMedLum;
          rowOuterChroma[y] = medianOf(bestChrs);
        }
      } else {
        const oLums = leftLums.concat(rightLums);
        const oChrs = leftChrs.concat(rightChrs);
        if (oLums.length >= 6) {
          rowOuterLum[y] = medianOf(oLums);
          rowOuterChroma[y] = medianOf(oChrs);
        }
      }
    }

    const minWhiteHaloLum = isDenseTexturedHalo
      ? 224
      : hasOuterGradientTint
        ? Math.max(242, ringMedLum + 4)
        : hasWhiteHaloOverGradientOrTintedBg
          ? Math.max(ringMedLum >= 195 ? 222 : 238, ringMedLum + (ringMedLum >= 195 ? 5 : 24))
          : hasWhiteStrokeHalo && ringMedLum < 228
            ? Math.max(230, ringMedLum + 18)
            : ringMedLum < 228 && ringMedChroma <= 12
              ? Math.max(222, ringMedLum + 14)
              : 234;
    const propHaloSteps = isDenseTexturedHalo
      ? clamp(Math.round(medGlyphH * 0.45), 10, 22)
      : clamp(Math.round(medGlyphH * 0.24), 6, 18);
    const maxHaloSteps =
      hasWhiteHaloOverGradientOrTintedBg || hasWhiteStrokeHalo
        ? hasVividColorCoreInk && !hasWhiteStrokeHalo && ringMedLum >= 195
          ? 0
          : hasVividColorCoreInk
            ? Math.max(6, Math.min(12, propHaloSteps))
            : propHaloSteps
        : hasVividColorCoreInk
          ? ringMedLum >= 195
            ? 0
            : 3
          : 7;
    const haloBoundPad = isDenseTexturedHalo
      ? clamp(Math.round(medGlyphH * 0.48), 10, 24)
      : clamp(Math.round(medGlyphH * 0.26), 6, 20);
    const haloBoundX0 = hasWhiteStrokeHalo
      ? Math.max(1, gMinX - haloBoundPad)
      : Math.max(1, egMinX - haloBoundPad);
    const haloBoundX1 = hasWhiteStrokeHalo
      ? Math.min(ww - 2, gMaxX + haloBoundPad)
      : Math.min(ww - 2, egMaxX + haloBoundPad);
    const haloBoundY0 = hasWhiteStrokeHalo
      ? Math.max(1, gMinY - haloBoundPad)
      : Math.max(1, egMinY - haloBoundPad);
    const haloBoundY1 = hasWhiteStrokeHalo
      ? Math.min(wh - 2, gMaxY + haloBoundPad)
      : Math.min(wh - 2, egMaxY + haloBoundPad);
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
          const hasNeighbor =
            prevErase[idx - 1] ||
            prevErase[idx + 1] ||
            prevErase[idx - ww] ||
            prevErase[idx + ww] ||
            (isDenseTexturedHalo &&
              (prevErase[idx - ww - 1] ||
                prevErase[idx - ww + 1] ||
                prevErase[idx + ww - 1] ||
                prevErase[idx + ww + 1]));
          if (hasNeighbor) {
            const cIdx = idx * 3;
            const pr = winRgb[cIdx];
            const pg = winRgb[cIdx + 1];
            const pb = winRgb[cIdx + 2];
            const pLum = 0.299 * pr + 0.587 * pg + 0.114 * pb;
            const pChroma = Math.max(pr, pg, pb) - Math.min(pr, pg, pb);
            const haloStepDelta = isDenseTexturedHalo
              ? 10
              : hasOuterGradientTint
                ? 4
                : hasVividColorCoreInk && hasWhiteStrokeHalo
                  ? 6
                  : hasWhiteStrokeHalo && !hasWhiteHaloOverGradientOrTintedBg && ringMedLum < 228
                    ? 18
                    : 9;
            const maxStrokeChr = isDenseTexturedHalo
              ? Math.max(24, refChr * 0.72)
              : hasWhiteStrokeHalo && !hasWhiteHaloOverGradientOrTintedBg && !hasOuterGradientTint && ringMedLum < 228
                ? 14
                : Math.max(20, refChr * 0.72);
            const isNeutralWhiteHalo =
              pLum >= Math.max(minWhiteHaloLum, refLum + haloStepDelta) &&
              pChroma <= maxStrokeChr &&
              (refChr >= 10
                ? pChroma <= maxStrokeChr || pLum >= Math.min(246, refLum + haloStepDelta)
                : pLum >= refLum + haloStepDelta);
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

    if (isDenseTexturedHalo || (hasWhiteStrokeHalo && ringMedLum < 242)) {
      const fringeSteps = hasWhiteStrokeHalo && ringMedLum < 228 ? 4 : 2;
      for (let fStep = 0; fStep < fringeSteps; fStep += 1) {
        let fringeAdded = 0;
        const prevFringe = new Uint8Array(eraseMask);
        for (let y = haloBoundY0; y <= haloBoundY1; y += 1) {
          const rOff = y * ww;
          const refLum = Math.min(ringMedLum, rowOuterLum[y]);
          const refChr = Math.max(ringMedChroma, rowOuterChroma[y]);
          for (let x = haloBoundX0; x <= haloBoundX1; x += 1) {
            const idx = rOff + x;
            if (prevFringe[idx] || borderMask[idx]) continue;
            if (
              prevFringe[idx - 1] ||
              prevFringe[idx + 1] ||
              prevFringe[idx - ww] ||
              prevFringe[idx + ww]
            ) {
              const cIdx = idx * 3;
              const pr = winRgb[cIdx];
              const pg = winRgb[cIdx + 1];
              const pb = winRgb[cIdx + 2];
              const pLum = 0.299 * pr + 0.587 * pg + 0.114 * pb;
              const pChroma = Math.max(pr, pg, pb) - Math.min(pr, pg, pb);
              const isBlendedWhiteOnColor =
                hasWhiteStrokeHalo &&
                refLum < 232 &&
                pLum >= refLum + 5 &&
                (pChroma <= Math.max(18, refChr - 3) || pLum >= 222);
              if (
                isBlendedWhiteOnColor ||
                (pLum >= Math.max(175, refLum + 24) && pChroma <= Math.max(48, refChr * 0.88))
              ) {
                eraseMask[idx] = 1;
                eraseCount += 1;
                fringeAdded += 1;
                if (x < egMinX) egMinX = x;
                if (x > egMaxX) egMaxX = x;
                if (y < egMinY) egMinY = y;
                if (y > egMaxY) egMaxY = y;
              }
            }
          }
        }
        if (fringeAdded === 0) break;
      }
    }

    // Beyaz dış kontur/hale genişlemesi sırasında koyu harf çekirdeği ile beyaz hale arasında sıkışıp kalan
    // küçük anti-aliasing adacıklarını (ör. harf tepelerindeki 1-4px gri noktalar) kapat ki inpaint sırasında leke yaymasın.
    if (egMaxX > egMinX + 4 && egMaxY > egMinY + 4) {
      const pocketVisited = new Uint8Array(numPixels);
      const pocketQueue = new Int32Array(numPixels);
      const xA = Math.max(1, egMinX);
      const xB = Math.min(ww - 2, egMaxX);
      const yA = Math.max(1, egMinY);
      const yB = Math.min(wh - 2, egMaxY);
      for (let y = yA; y <= yB; y += 1) {
        const rOff = y * ww;
        for (let x = xA; x <= xB; x += 1) {
          const sIdx = rOff + x;
          if (eraseMask[sIdx] || borderMask[sIdx] || pocketVisited[sIdx]) continue;
          let qH = 0;
          let qT = 0;
          let touchesBoxEdgeOrBorder = false;
          pocketVisited[sIdx] = 1;
          pocketQueue[qT++] = sIdx;
          while (qH < qT) {
            const cur = pocketQueue[qH++];
            const cy = (cur / ww) | 0;
            const cx = cur - cy * ww;
            if (cx <= xA || cx >= xB || cy <= yA || cy >= yB) {
              touchesBoxEdgeOrBorder = true;
            }
            const nbs = [cur - 1, cur + 1, cur - ww, cur + ww];
            for (let ni = 0; ni < 4; ni += 1) {
              const nb = nbs[ni];
              if (nb < 0 || nb >= numPixels) continue;
              if (borderMask[nb]) {
                touchesBoxEdgeOrBorder = true;
                continue;
              }
              if (!eraseMask[nb] && !pocketVisited[nb]) {
                pocketVisited[nb] = 1;
                pocketQueue[qT++] = nb;
              }
            }
          }
          if (!touchesBoxEdgeOrBorder && qT <= 96) {
            for (let k = 0; k < qT; k += 1) {
              eraseMask[pocketQueue[k]] = 1;
              eraseCount += 1;
            }
          }
        }
      }
    }
  }

  // Siyah/koyu duman zemin üzerinde beyaz dış konturlu renkli başlıklardaki ("A VERY HOT PLAN...")
  // kırmızı hareket/gölge yankılarını dar şerit içinde temizle
  if (
    preferLightFirst &&
    bgLumInit < 45 &&
    ringMedChroma <= 18 &&
    style.hasTextStroke &&
    style.strokeColor.toLowerCase() === '#ffffff'
  ) {
    const echoY0 = Math.max(1, egMinY - 12);
    const echoY1 = Math.min(wh - 2, egMaxY + 12);
    const echoX0 = Math.max(1, egMinX - 8);
    const echoX1 = Math.min(ww - 2, egMaxX + 8);
    for (let step = 0; step < 5; step += 1) {
      let echoAdded = 0;
      const prevErase = new Uint8Array(eraseMask);
      for (let y = echoY0; y <= echoY1; y += 1) {
        const rOff = y * ww;
        for (let x = echoX0; x <= echoX1; x += 1) {
          const idx = rOff + x;
          if (prevErase[idx] || borderMask[idx]) continue;
          const nearPrev =
            prevErase[idx - 1] ||
            prevErase[idx + 1] ||
            prevErase[idx - ww] ||
            prevErase[idx + ww] ||
            (y >= 2 && prevErase[idx - ww * 2]) ||
            (y <= wh - 3 && prevErase[idx + ww * 2]);
          if (!nearPrev) continue;
          const cIdx = idx * 3;
          const pr = winRgb[cIdx];
          const pg = winRgb[cIdx + 1];
          const pb = winRgb[cIdx + 2];
          const pChroma = Math.max(pr, pg, pb) - Math.min(pr, pg, pb);
          const dBg = Math.max(Math.abs(pr - bgR), Math.abs(pg - bgG), Math.abs(pb - bgB));
          if (pChroma >= Math.max(20, ringMedChroma + 14) && dBg >= 22) {
            eraseMask[idx] = 1;
            eraseCount += 1;
            echoAdded += 1;
            if (x < egMinX) egMinX = x;
            if (x > egMaxX) egMaxX = x;
            if (y < egMinY) egMinY = y;
            if (y > egMaxY) egMaxY = y;
          }
        }
      }
      if (echoAdded === 0) break;
    }
  }

  // Eğik kağıt/telefon notlarında satır kenarından kesilmiş kelimeleri ("ommuni", "g in to th", "R", "S", "e")
  // ve çerçeveden dikey kesilmiş üst/alt yarım satır kalıntılarını ("is an a", "Mail]") yalnızca `eraseMask`'a ekle
  const isYellowPaperHint = ringMedR >= 195 && ringMedG >= 185 && ringMedB <= 190;
  if (
    options?._skipRotateWrapper &&
    !preferLightFirst &&
    bgLumInit >= 175 &&
    (!hasClosedBubbleWalls || isYellowPaperHint) &&
    !isSingleLineStat
  ) {
    const isDarkBezelColumn = (x: number, yA: number, yB: number): boolean => {
      let total = 0;
      let dark = 0;
      for (let y = Math.max(0, yA); y <= Math.min(wh - 1, yB); y += 2) {
        const c3 = (y * ww + x) * 3;
        const l = 0.299 * winRgb[c3] + 0.587 * winRgb[c3 + 1] + 0.114 * winRgb[c3 + 2];
        total += 1;
        if (l <= 68) dark += 1;
      }
      return total >= 4 && dark / total >= 0.68;
    };

    const extraNoteMask = new Uint8Array(numPixels);
    for (const lc of lineCores) {
      const bandTop = Math.max(1, lc.y0 - 2);
      const bandBot = Math.min(wh - 2, lc.y1 + 2);
      const colTop = Math.max(0, lc.y0 - Math.round(medLineH * 1.2));
      const colBot = Math.min(wh - 1, lc.y1 + Math.round(medLineH * 1.2));

      let bezelL = 0;
      let darkRun = 0;
      for (let x = lc.x0; x >= 0; x -= 1) {
        if (isDarkBezelColumn(x, colTop, colBot)) {
          darkRun += 1;
          if (darkRun >= 3) {
            bezelL = x + 3;
            break;
          }
        } else {
          darkRun = 0;
        }
      }
      let bezelR = ww - 1;
      darkRun = 0;
      for (let x = lc.x1; x < ww; x += 1) {
        if (isDarkBezelColumn(x, colTop, colBot)) {
          darkRun += 1;
          if (darkRun >= 3) {
            bezelR = x - 3;
            break;
          }
        } else {
          darkRun = 0;
        }
      }
      if (bezelR <= bezelL + 4) continue;

      for (let y = bandTop; y <= bandBot; y += 1) {
        const rOff = y * ww;
        for (let x = bezelL; x <= bezelR; x += 1) {
          const idx = rOff + x;
          if (eraseMask[idx] || borderMask[idx]) continue;
          if (x >= cx0 && x <= cx1 && y >= cy0 && y <= cy1) continue;
          if (overlapsAnySiblingAbs(wx0 + x, wy0 + y, wx0 + x + 1, wy0 + y + 1)) continue;
          const c3 = idx * 3;
          const pr = winRgb[c3];
          const pg = winRgb[c3 + 1];
          const pb = winRgb[c3 + 2];
          const pLum = 0.299 * pr + 0.587 * pg + 0.114 * pb;
          const dRing = Math.max(Math.abs(pr - ringMedR), Math.abs(pg - ringMedG), Math.abs(pb - ringMedB));
          if (pLum <= ringMedLum - 22 && dRing >= 22) {
            extraNoteMask[idx] = 1;
          }
        }
      }
    }

    // Üst/alt siyah panel çerçevesinden ("is an a", "Mail]") ve eğik satır yanlarından
    // yarım kesilmiş kalıntıları ("S", "e", "ommuni") sütun bazlı çerçeve tespitiyle temizle
    const colTopBezel = new Int32Array(ww).fill(-1);
    const colBotBezel = new Int32Array(ww).fill(-1);
    const isSolidDarkRowPatchAt = (x: number, y: number): boolean => {
      let darkCnt = 0;
      const xA = Math.max(0, x - 3);
      const xB = Math.min(ww - 1, x + 3);
      for (let xx = xA; xx <= xB; xx += 1) {
        const c3 = (y * ww + xx) * 3;
        const l = 0.299 * winRgb[c3] + 0.587 * winRgb[c3 + 1] + 0.114 * winRgb[c3 + 2];
        if (l <= 72) darkCnt += 1;
      }
      return darkCnt >= Math.min(5, xB - xA + 1);
    };
    for (let x = 0; x < ww; x += 1) {
      let darkRun = 0;
      for (let y = Math.max(0, cy0 - 2); y >= Math.max(0, cy0 - 92); y -= 1) {
        if (isSolidDarkRowPatchAt(x, y)) {
          darkRun += 1;
          if (darkRun >= 5) {
            colTopBezel[x] = y + 5;
            break;
          }
        } else {
          darkRun = 0;
        }
      }
      darkRun = 0;
      for (let y = Math.min(wh - 1, cy1 + 2); y <= Math.min(wh - 1, cy1 + 92); y += 1) {
        if (isSolidDarkRowPatchAt(x, y)) {
          darkRun += 1;
          if (darkRun >= 5) {
            colBotBezel[x] = y - 5;
            break;
          }
        } else {
          darkRun = 0;
        }
      }
    }

    const isYellowNoteBezel = ringMedR >= 195 && ringMedG >= 185 && ringMedB <= 190;
    const isSolidDarkColPatchAt = (x: number, y: number): boolean => {
      if (isYellowNoteBezel) {
        // Yapışkan not kağıdında bold harflerin dikey çizgileri (~6-7px) çerçeve değildir;
        // yalnızca >= 11px kesintisiz koyu blok gerçek siyah çerçeve / köşe kenarıdır.
        let run = 0;
        let maxRun = 0;
        const yA = Math.max(0, y - 9);
        const yB = Math.min(wh - 1, y + 9);
        for (let yy = yA; yy <= yB; yy += 1) {
          const c3 = (yy * ww + x) * 3;
          const l = 0.299 * winRgb[c3] + 0.587 * winRgb[c3 + 1] + 0.114 * winRgb[c3 + 2];
          if (l <= 58) {
            run += 1;
            if (run > maxRun) maxRun = run;
          } else {
            run = 0;
          }
        }
        return maxRun >= 11;
      }
      let darkCnt = 0;
      const yA = Math.max(0, y - 3);
      const yB = Math.min(wh - 1, y + 3);
      for (let yy = yA; yy <= yB; yy += 1) {
        const c3 = (yy * ww + x) * 3;
        const l = 0.299 * winRgb[c3] + 0.587 * winRgb[c3 + 1] + 0.114 * winRgb[c3 + 2];
        if (l <= 72) darkCnt += 1;
      }
      return darkCnt >= Math.min(5, yB - yA + 1);
    };
    const rowLeftBezel = new Int32Array(wh).fill(-1);
    const rowRightBezel = new Int32Array(wh).fill(-1);
    for (let y = 0; y < wh; y += 1) {
      let darkRun = 0;
      for (let x = Math.max(0, cx0 - 2); x >= 0; x -= 1) {
        if (isSolidDarkColPatchAt(x, y)) {
          darkRun += 1;
          if (darkRun >= 4) {
            rowLeftBezel[y] = x + 4;
            break;
          }
        } else {
          darkRun = 0;
        }
      }
      darkRun = 0;
      for (let x = Math.min(ww - 1, cx1 + 2); x < ww; x += 1) {
        if (isSolidDarkColPatchAt(x, y)) {
          darkRun += 1;
          if (darkRun >= 4) {
            rowRightBezel[y] = x - 4;
            break;
          }
        } else {
          darkRun = 0;
        }
      }
    }

    const sweepY0 = Math.max(1, cy0 - 80);
    const sweepY1 = Math.min(wh - 2, cy1 + 80);
    const isYellowNotePaper = ringMedR >= 195 && ringMedG >= 185 && ringMedB <= 190;
    const sweepX0 = isYellowNotePaper ? Math.max(1, cx0 - 180) : Math.max(1, gMinX - 40);
    const sweepX1 = isYellowNotePaper ? Math.min(ww - 2, cx1 + 180) : Math.min(ww - 2, gMaxX + 40);
    for (let x = sweepX0; x <= sweepX1; x += 1) {
      const topLimit =
        colTopBezel[x] >= 0
          ? Math.max(sweepY0, colTopBezel[x] + 1)
          : Math.max(1, cy0 - (isYellowNotePaper ? 56 : 24));
      const botLimit =
        colBotBezel[x] >= 0
          ? Math.min(sweepY1, colBotBezel[x] - 1)
          : Math.min(wh - 2, cy1 + (isYellowNotePaper ? 56 : 24));
      if (botLimit < topLimit) continue;
      for (let y = topLimit; y <= botLimit; y += 1) {
        if (rowLeftBezel[y] >= 0 && x <= rowLeftBezel[y]) continue;
        if (rowRightBezel[y] >= 0 && x >= rowRightBezel[y]) continue;
        const idx = y * ww + x;
        if (eraseMask[idx] || (!isYellowNotePaper && borderMask[idx])) continue;
        // Sticky-note kenar harflerini ("S" gibi cx1-32 konumundaki kesik harfler) kaçırmamak için sağ/sol kesim penceresini genişlet
        // ancak katı siyah not/panel çerçevelerini (>= 5px kalınlık x >= 10px yükseklik) asla yutma.
        if (isYellowNotePaper) {
          let solidBlkCols = 0;
          for (let dx = -2; dx <= 2; dx += 1) {
            const sx = x + dx;
            if (sx < 0 || sx >= ww) continue;
            let run = 0;
            for (let dy = -6; dy <= 6; dy += 1) {
              const sy = y + dy;
              if (sy < 0 || sy >= wh) continue;
              const s3 = (sy * ww + sx) * 3;
              const sl = 0.299 * winRgb[s3] + 0.587 * winRgb[s3 + 1] + 0.114 * winRgb[s3 + 2];
              if (sl <= 60) {
                run += 1;
                if (run >= 9) {
                  solidBlkCols += 1;
                  break;
                }
              } else {
                run = 0;
              }
            }
          }
          if (solidBlkCols >= 5) continue;
        }
        const nearRightCut = isYellowNotePaper && x >= Math.max(0, cx1 - 64) && x <= Math.min(ww - 1, cx1 + 28);
        if (x >= cx0 && x <= cx1 && y >= cy0 && y <= cy1 && !nearRightCut) continue;
        const slopeY = isYellowNotePaper
          ? (x - (cx0 + cx1) * 0.5) * Math.tan(((style.rotationDeg ?? 0) * Math.PI) / 180)
          : 0;
        const inSideTail = isYellowNotePaper
          ? y >= cy0 + slopeY - 26 && y <= cy1 + slopeY + 26
          : y >= cy0 - 10 && y <= cy1 + 10;
        const inOwnCoreBand =
          isYellowNotePaper &&
          (x > cx1 || x < cx0 || nearRightCut) &&
          y >= cy0 + slopeY - 16 &&
          y <= cy1 + slopeY + 18;
        const inTopCut = colTopBezel[x] >= 0 && y < cy0 && cy0 - colTopBezel[x] <= 110;
        const inBotCut = colBotBezel[x] >= 0 && y > cy1 && colBotBezel[x] - cy1 <= 110;
        if (!inSideTail && !inTopCut && !inBotCut) continue;
        if (!isYellowNotePaper && !inSideTail) continue;
        if (!inOwnCoreBand && overlapsAnySiblingAbs(wx0 + x, wy0 + y, wx0 + x + 1, wy0 + y + 1)) continue;
        const c3 = idx * 3;
        const pr = winRgb[c3];
        const pg = winRgb[c3 + 1];
        const pb = winRgb[c3 + 2];
        const pLum = 0.299 * pr + 0.587 * pg + 0.114 * pb;
        const dRing = Math.max(Math.abs(pr - ringMedR), Math.abs(pg - ringMedG), Math.abs(pb - ringMedB));
        if (pLum <= ringMedLum - 18 && dRing >= 18) {
          extraNoteMask[idx] = 1;
        }
      }
    }

    const dilExtra = dilate3x3(extraNoteMask, ww, wh);
    for (let y = 1; y < wh - 1; y += 1) {
      const rOff = y * ww;
      for (let x = 1; x < ww - 1; x += 1) {
        if (colTopBezel[x] >= 0 && y <= colTopBezel[x] && y < cy0) continue;
        if (colBotBezel[x] >= 0 && y >= colBotBezel[x] && y > cy1) continue;
        if (rowLeftBezel[y] >= 0 && x <= rowLeftBezel[y] && x < cx0) continue;
        if (rowRightBezel[y] >= 0 && x >= rowRightBezel[y] && x > cx1) continue;
        const idx = rOff + x;
        if (dilExtra[idx] && (isYellowNotePaper || !borderMask[idx]) && !eraseMask[idx]) {
          if (isYellowNotePaper) borderMask[idx] = 0;
          eraseMask[idx] = 1;
          eraseCount += 1;
          if (x < egMinX) egMinX = x;
          if (x > egMaxX) egMaxX = x;
          if (y < egMinY) egMinY = y;
          if (y > egMaxY) egMaxY = y;
        }
      }
    }
  }

  const cleaned = new Float32Array(winRgb);
  // Metnin etrafında 4-10px yumuşak pembe/gri parlama veya JPEG halesi ("CONTINUARA" -> "DEVAM EDECEK" gibi)
  // olduğunda 2px iç halka bu parlamayı örnekleyip `hasOuterGradientTint=true` sanabilir.
  // 10..26px dış hendekteki (moat) gerçek arka plan %82+ oranında tekdüze düz beyaz/nötr açık renkse,
  // parlama dahil tüm metin izini düz zemin rengiyle (%100 sıfır iz) temizle.
  let isMoatVerifiedFlatLightBg = false;
  if (!preferLightFirst && !hasTexturedSceneInterior && bgGradDelta < 4.5) {
    const mBoundX0 = hasActualPhysicalWalls ? Math.max(2, safeLocalLeft + 2) : 2;
    const mBoundX1 = hasActualPhysicalWalls ? Math.min(ww - 3, safeLocalRight - 2) : ww - 3;
    const mBoundY0 = hasActualPhysicalWalls ? Math.max(2, safeLocalTop + 2) : 2;
    const mBoundY1 = hasActualPhysicalWalls ? Math.min(wh - 3, safeLocalBottom - 2) : wh - 3;
    const inBoxX0 = Math.min(cx0, egMinX) - 10;
    const inBoxX1 = Math.max(cx1, egMaxX) + 10;
    const inBoxY0 = Math.min(cy0, egMinY) - 10;
    const inBoxY1 = Math.max(cy1, egMaxY) + 10;
    const outBoxX0 = Math.max(mBoundX0, inBoxX0 - 16);
    const outBoxX1 = Math.min(mBoundX1, inBoxX1 + 16);
    const outBoxY0 = Math.max(mBoundY0, inBoxY0 - 16);
    const outBoxY1 = Math.min(mBoundY1, inBoxY1 + 16);
    const moatRs: number[] = [];
    const moatGs: number[] = [];
    const moatBs: number[] = [];
    for (let y = outBoxY0; y <= outBoxY1; y += 2) {
      const rOff = y * ww;
      const inY = y >= inBoxY0 && y <= inBoxY1;
      for (let x = outBoxX0; x <= outBoxX1; x += 2) {
        if (inY && x >= inBoxX0 && x <= inBoxX1) continue;
        const idx = rOff + x;
        if (eraseMask[idx] || borderMask[idx]) continue;
        if (overlapsAnySiblingAbs(wx0 + x, wy0 + y, wx0 + x + 1, wy0 + y + 1)) continue;
        const c3 = idx * 3;
        moatRs.push(winRgb[c3]);
        moatGs.push(winRgb[c3 + 1]);
        moatBs.push(winRgb[c3 + 2]);
      }
    }
    if (moatRs.length >= 24) {
      const mMedR = Math.round(medianOf(moatRs));
      const mMedG = Math.round(medianOf(moatGs));
      const mMedB = Math.round(medianOf(moatBs));
      const mMedLum = 0.299 * mMedR + 0.587 * mMedG + 0.114 * mMedB;
      const mMedChr = Math.max(mMedR, mMedG, mMedB) - Math.min(mMedR, mMedG, mMedB);
      let mVar = 0;
      let mClose = 0;
      let mDarkOutliers = 0;
      for (let i = 0; i < moatRs.length; i += 1) {
        const dr = moatRs[i] - mMedR;
        const dg = moatGs[i] - mMedG;
        const db = moatBs[i] - mMedB;
        const md = Math.max(Math.abs(dr), Math.abs(dg), Math.abs(db));
        if (md <= 6) mClose += 1;
        if (md >= 32) mDarkOutliers += 1;
        mVar += (dr * dr + dg * dg + db * db) / 3;
      }
      const mStd = Math.sqrt(mVar / moatRs.length);
      const mCloseRatio = mClose / moatRs.length;
      if (
        mMedLum >= 165 &&
        mMedChr <= 6 &&
        mStd < 2.8 &&
        mCloseRatio >= 0.82 &&
        mDarkOutliers <= moatRs.length * 0.04
      ) {
        isMoatVerifiedFlatLightBg = true;
        ringMedR = mMedR;
        ringMedG = mMedG;
        ringMedB = mMedB;
        ringMedLum = mMedLum;
        ringStd = mStd;
        ringCloseRatio = mCloseRatio;
      }
    }
  }
  const isFlatNeutralGrayBubble =
    isMoatVerifiedFlatLightBg ||
    (hasActualPhysicalWalls &&
      wallHits >= 3 &&
      !hasTexturedSceneInterior &&
      !hasOuterGradientTint &&
      !isOpenWhiteHaloScene &&
      bgGradDelta < 4.5 &&
      ringStd < 3.5 &&
      ringMedLum >= 165 &&
      ringMedLum <= 228 &&
      ringMedChroma <= 8);
  const isFlatOpenLightBg =
    isMoatVerifiedFlatLightBg ||
    (!preferLightFirst &&
      !hasTexturedSceneInterior &&
      !hasWhiteHaloOverGradientOrTintedBg &&
      !hasOuterGradientTint &&
      !isOpenWhiteHaloScene &&
      bgGradDelta < 4.5 &&
      ringStd < 3.2 &&
      ringMedLum >= 235 &&
      ringMedChroma <= 8 &&
      ringCloseRatio >= 0.72);
  const isFlatLightBubble =
    isFlatNeutralGrayBubble ||
    isFlatOpenLightBg ||
    (hasActualPhysicalWalls &&
      wallHits >= 3 &&
      !hasTexturedSceneInterior &&
      !hasWhiteHaloOverGradientOrTintedBg &&
      !hasOuterGradientTint &&
      !isOpenWhiteHaloScene &&
      bgGradDelta < 4.5 &&
      ringStd < 2.6 &&
      (isNeutralJpegLightBox ||
        ringMedLum >= 232 ||
        (ringMedLum >= 175 && ringMedChroma <= 12)));
  const isFlatDarkBanner =
    !hasTexturedSceneInterior &&
    preferLightFirst &&
    ringMedLum <= 34 &&
    ringStd < 10 &&
    ringCloseRatio >= 0.72;
  const isSmoothDarkOval =
    !hasTexturedSceneInterior &&
    !isFlatDarkBanner &&
    preferLightFirst &&
    ringMedLum <= 72 &&
    ringStd < 9.5 &&
    ringCloseRatio >= 0.65;

  if (isFlatLightBubble || isFlatDarkBanner || isSmoothDarkOval) {
    if (isFlatLightBubble) {
      const useWideSweep = isFlatNeutralGrayBubble || isFlatOpenLightBg;
      const sweepPad = isMoatVerifiedFlatLightBg ? 12 : 8;
      const dotDiffThresh = isMoatVerifiedFlatLightBg ? 3 : useWideSweep ? 5 : ringStd < 4.5 ? 10 : 16;
      const sweepY0 = useWideSweep
        ? Math.max(hasActualPhysicalWalls ? safeLocalTop + 1 : 1, Math.min(cy0, egMinY) - sweepPad)
        : Math.max(0, cy0 - 2);
      const sweepY1 = useWideSweep
        ? Math.min(hasActualPhysicalWalls ? safeLocalBottom - 1 : wh - 2, Math.max(cy1, egMaxY) + sweepPad)
        : Math.min(wh - 1, cy1 + 4);
      const sweepX0 = useWideSweep
        ? Math.max(hasActualPhysicalWalls ? safeLocalLeft + 1 : 1, Math.min(cx0, egMinX) - sweepPad)
        : Math.max(0, cx0 - 4);
      const sweepX1 = useWideSweep
        ? Math.min(hasActualPhysicalWalls ? safeLocalRight - 1 : ww - 2, Math.max(cx1, egMaxX) + sweepPad)
        : Math.min(ww - 1, cx1 + 4);
      for (let y = sweepY0; y <= sweepY1; y += 1) {
        const rOff = y * ww;
        for (let x = sweepX0; x <= sweepX1; x += 1) {
          const idx = rOff + x;
          if (eraseMask[idx] || borderMask[idx]) continue;
          if (overlapsAnySiblingAbs(wx0 + x, wy0 + y, wx0 + x + 1, wy0 + y + 1)) continue;
          const cIdx = idx * 3;
          const d = Math.max(
            Math.abs(winRgb[cIdx] - ringMedR),
            Math.abs(winRgb[cIdx + 1] - ringMedG),
            Math.abs(winRgb[cIdx + 2] - ringMedB),
          );
          if (d >= dotDiffThresh) {
            eraseMask[idx] = 1;
            eraseCount += 1;
            if (x < egMinX) egMinX = x;
            if (x > egMaxX) egMaxX = x;
            if (y < egMinY) egMinY = y;
            if (y > egMaxY) egMaxY = y;
          }
        }
      }
    }
    // Düz konuşma balonlarında veya düz siyah şeritlerde ("CHAINSAWMAN") dış gökyüzü/doku sızmasını engelle;
    // yalnızca mevcut silme maskesinin komşuluğundaki anti-aliasing/parlama kalıntılarını temizle!
    const flatExpandSteps =
      isMoatVerifiedFlatLightBg
        ? 8
        : isSmoothDarkOval || isFlatNeutralGrayBubble || isFlatOpenLightBg
          ? 6
          : isFlatDarkBanner
            ? 2
            : ringMedLum <= 240
              ? 4
              : 1;
    const flatDiffThresh =
      isMoatVerifiedFlatLightBg
        ? 3
        : isFlatNeutralGrayBubble || isFlatOpenLightBg
          ? 5
          : isSmoothDarkOval
            ? 10
            : isFlatDarkBanner
              ? 16
              : ringMedLum <= 240
                ? 9
                : 14;
    const flatPad =
      isMoatVerifiedFlatLightBg
        ? 8
        : isSmoothDarkOval || isFlatNeutralGrayBubble || isFlatOpenLightBg
          ? 6
          : isFlatDarkBanner
            ? 2
            : ringMedLum <= 240
              ? 4
              : 2;
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

    if (isSmoothDarkOval) {
      const rowR = new Int16Array(wh).fill(ringMedR);
      const rowG = new Int16Array(wh).fill(ringMedG);
      const rowB = new Int16Array(wh).fill(ringMedB);
      for (let y = egMinY; y <= egMaxY; y += 1) {
        const rOff = y * ww;
        const rs: number[] = [];
        const gs: number[] = [];
        const bs: number[] = [];
        const l0 = Math.max(0, egMinX - 16);
        const l1 = Math.max(-1, egMinX - 2);
        const r0 = Math.min(ww, egMaxX + 2);
        const r1 = Math.min(ww - 1, egMaxX + 16);
        for (let x = l0; x <= l1; x += 1) {
          const idx = rOff + x;
          if (eraseMask[idx] || borderMask[idx]) continue;
          const cIdx = idx * 3;
          const pr = winRgb[cIdx];
          const pg = winRgb[cIdx + 1];
          const pb = winRgb[cIdx + 2];
          const pLum = 0.299 * pr + 0.587 * pg + 0.114 * pb;
          if (
            Math.max(Math.abs(pr - ringMedR), Math.abs(pg - ringMedG), Math.abs(pb - ringMedB)) <= 42 &&
            Math.abs(pLum - ringMedLum) <= 32
          ) {
            rs.push(pr);
            gs.push(pg);
            bs.push(pb);
          }
        }
        for (let x = r0; x <= r1; x += 1) {
          const idx = rOff + x;
          if (eraseMask[idx] || borderMask[idx]) continue;
          const cIdx = idx * 3;
          const pr = winRgb[cIdx];
          const pg = winRgb[cIdx + 1];
          const pb = winRgb[cIdx + 2];
          const pLum = 0.299 * pr + 0.587 * pg + 0.114 * pb;
          if (
            Math.max(Math.abs(pr - ringMedR), Math.abs(pg - ringMedG), Math.abs(pb - ringMedB)) <= 42 &&
            Math.abs(pLum - ringMedLum) <= 32
          ) {
            rs.push(pr);
            gs.push(pg);
            bs.push(pb);
          }
        }
        if (rs.length >= 4) {
          rowR[y] = Math.round(medianOf(rs));
          rowG[y] = Math.round(medianOf(gs));
          rowB[y] = Math.round(medianOf(bs));
        }
      }
      for (let y = egMinY; y <= egMaxY; y += 1) {
        const rOff = y * ww;
        const fr = rowR[y];
        const fg = rowG[y];
        const fb = rowB[y];
        for (let x = egMinX; x <= egMaxX; x += 1) {
          const idx = rOff + x;
          if (!eraseMask[idx]) continue;
          const cIdx = idx * 3;
          cleaned[cIdx] = fr;
          cleaned[cIdx + 1] = fg;
          cleaned[cIdx + 2] = fb;
        }
      }
    } else {
      for (let i = 0; i < numPixels; i += 1) {
        if (!eraseMask[i]) continue;
        const cIdx = i * 3;
        cleaned[cIdx] = ringMedR;
        cleaned[cIdx + 1] = ringMedG;
        cleaned[cIdx + 2] = ringMedB;
      }
    }
  } else {
    const savedYellowBezelEdge: number[] = [];
    if (ringMedR >= 195 && ringMedG >= 185 && ringMedB <= 190 && eraseCount > 0) {
      // Yapışkan notlarda siyah kenar üçgeni veya komşu metinle 1-2px temas eden koyu sınırların
      // Laplace inpaint içine gri leke yaymasını önle; çözüm sonrası siyah sınırı piksel-piksel geri koy.
      const bx0 = Math.max(0, egMinX - 3);
      const bx1 = Math.min(ww - 1, egMaxX + 3);
      const by0 = Math.max(0, egMinY - 3);
      const by1 = Math.min(wh - 1, egMaxY + 3);
      for (let y = by0; y <= by1; y += 1) {
        for (let x = bx0; x <= bx1; x += 1) {
          const uIdx = y * ww + x;
          if (eraseMask[uIdx]) continue;
          const c3 = uIdx * 3;
          const lum = 0.299 * cleaned[c3] + 0.587 * cleaned[c3 + 1] + 0.114 * cleaned[c3 + 2];
          if (lum > 110) continue;
          let touchesErase = false;
          for (let dy = -2; dy <= 2 && !touchesErase; dy += 1) {
            const ny = y + dy;
            if (ny < 0 || ny >= wh) continue;
            for (let dx = -2; dx <= 2; dx += 1) {
              const nx = x + dx;
              if (nx < 0 || nx >= ww) continue;
              if (eraseMask[ny * ww + nx]) {
                touchesErase = true;
                break;
              }
            }
          }
          if (touchesErase) {
            savedYellowBezelEdge.push(c3, cleaned[c3], cleaned[c3 + 1], cleaned[c3 + 2]);
            cleaned[c3] = ringMedR;
            cleaned[c3 + 1] = ringMedG;
            cleaned[c3 + 2] = ringMedB;
          }
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
    for (let si = 0; si < savedYellowBezelEdge.length; si += 4) {
      const c3 = savedYellowBezelEdge[si];
      cleaned[c3] = savedYellowBezelEdge[si + 1];
      cleaned[c3 + 1] = savedYellowBezelEdge[si + 2];
      cleaned[c3 + 2] = savedYellowBezelEdge[si + 3];
    }

    // Silme Sonrası Artık İz Kontrolü (Post-Inpaint Residual Verification):
    // Harf kutusunun hemen içinde hala yüksek kontrastlı kontur/gölge kalıntısı varsa 2. geçişle temizle.
    // Gradyan balonlarda yanlış tetiklenmemesi için her pikseli kendi 5px komşuluğuyla kıyasla.
    const residualThresh = ringStd < 10 ? Math.max(22, ringStd * 2.0) : Math.max(42, ringStd * 2.5);
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
          ringMedLum >= 60 &&
          ringMedLum <= 242 &&
          ringMedChroma <= 45 &&
          pLumCur >= Math.max(ringMedLum < 140 ? 205 : 242, ringMedLum + (ringMedLum < 140 ? 48 : 10)) &&
          pChromaCur <= Math.min(ringMedLum < 140 ? 18 : 12, Math.max(8, ringMedChroma * 0.55));
        const locLum = 0.299 * locR + 0.587 * locG + 0.114 * locB;
        const isPureWhiteFaintInkResidual =
          (ringMedLum >= 245 && ringStd <= 4.5 && pLumCur <= 215 && dev >= 12) ||
          (locLum >= 228 && hLocLum >= 228 && pLumCur <= locLum - 18);
        const isLightSceneResidual =
          !preferLightFirst && ringMedLum >= 60
            ? isPureWhiteFaintInkResidual ||
              (!hasVividColorCoreInk &&
                pLumCur <= Math.min(72, Math.round(ringMedLum * 0.45)) &&
                pLumCur < hLocLum - 28) ||
              isPureWhiteInkHalo ||
              (!hasVividColorCoreInk &&
                ringMedLum <= 240 &&
                pLumCur >= Math.max(ringMedLum < 140 ? 205 : 230, ringMedLum + 12) &&
                pLumCur > hLocLum + 12 &&
                pChromaCur <= 16)
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
  options?._onEraseMask?.(wx0, wy0, ww, wh, eraseMask);

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
  patchCanvas.width = 0;
  patchCanvas.height = 0;

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
      (safeLocalRight - safeLocalLeft) * (isFlatLightBubble || hasClosedBubbleWalls ? 0.34 : 0.18)
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
    hitLeftWall && hitRightWall && (isFlatLightBubble || hasClosedBubbleWalls)
      ? spanLocalW * 0.5
      : Math.min(layoutCenterX - safeLocalLeft, safeLocalRight - layoutCenterX),
  );
  const maxHalfH = Math.max(
    glyphH * 0.55,
    Math.min(layoutCenterY - safeLocalTop, safeLocalBottom - layoutCenterY),
  );
  let safeW = Math.max(glyphW, maxHalfW * 2);
  if (!(hitLeftWall && hitRightWall)) {
    const flatCleanCap =
      ringStd < 6.5 && bgLumInit >= 210
        ? Math.max(glyphW * 1.65, medGlyphH * 12.5)
        : Math.max(glyphW * 1.32, medGlyphH * 10);
    safeW = Math.min(safeW, flatCleanCap);
  }
  const safeH = Math.max(glyphH * 1.1, maxHalfH * 2);

  // Orijinal harf kapak yüksekliğinden (Cap Height) gerçek Canvas EM font boyutuna dönüştür
  const capHeights = accComps
    .filter((c) => c.h >= Math.max(8, medGlyphH * 0.55))
    .map((c) => c.h)
    .sort((a, b) => a - b);
  const capQ =
    origLineCount === 1 && style.kind === 'sfx' && capHeights.length >= 6 ? 0.85 : 0.7;
  let origCapH =
    capHeights.length > 0
      ? capHeights[Math.min(capHeights.length - 1, Math.floor(capHeights.length * capQ))]
      : medGlyphH;
  const absStyleRotDeg = Math.abs(style.rotationDeg ?? 0);
  const effTiltedDeg = Math.max(absStyleRotDeg, Math.abs(options?._srcRotationDeg ?? 0));
  if (origLineCount >= 3 && capHeights.length >= 12) {
    const lowQ = capHeights[Math.floor(capHeights.length * 0.35)];
    const highQ = capHeights[Math.floor(capHeights.length * 0.85)];
    if (highQ >= lowQ * 1.6) {
      origCapH = Math.min(origCapH, Math.max(lowQ * 1.18, bh / (origLineCount * 2.1)));
    }
  }
  if (effTiltedDeg >= 4.5 && origLineCount >= 2 && capHeights.length >= 6) {
    origCapH = Math.min(origCapH, Math.max(12, medGlyphH * 0.92), bh / (origLineCount * 2.05));
  }
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
    if (!hasClosedBubbleWalls && origLineCount === 1 && bh >= 32 && absRotRadOrig < 0.08 && origCapH < bh * 0.52) {
      origCapH = Math.max(origCapH, Math.round(bh * 0.68));
    }
    if (origCapH < bh * 0.48 && (capHeights.length < 4 || medGlyphH < 18)) {
      origCapH = Math.max(origCapH, Math.round(bh * tiltScale));
    } else if (absRotRadOrig >= 0.14) {
      origCapH = Math.min(origCapH, Math.max(14, Math.round(bh * tiltScale * 1.45)));
    }
  } else if (!hasClosedBubbleWalls && origLineCount === 1 && bh >= 32 && absRotRadOrig < 0.08 && origCapH < bh * 0.52) {
    origCapH = Math.max(origCapH, Math.round(bh * 0.68));
  }
  if (
    style.kind === 'sfx' &&
    style.hasTextStroke &&
    !hasClosedBubbleWalls &&
    origLineCount === 1 &&
    capHeights.length >= 4
  ) {
    origCapH = Math.round(origCapH * 1.12);
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
  let postContourMeasureFn:
    | ((
        w: ReturnType<typeof computeSmartWrappedLines>,
        curBoxW: number,
        curFontPx: number,
        curLineH: number,
      ) => { rowSpans: number[]; rowPcts: number[] })
    | null = null;
  let emphasisLastLineScale = block.emphasisLastLineScale;
  const ribbonBgMax = Math.max(bgR, bgG, bgB);
  const isVividBannerNow = ribbonBgMax >= 135 && ribbonBgMax - Math.min(bgR, bgG, bgB) >= 65;
  const isWideSingleLineRibbon =
    style.kind !== 'sfx' &&
    !isSingleLineStat &&
    origLineCount === 1 &&
    !hasClosedBubbleWalls &&
    (isVividBannerNow
      ? bw / Math.max(1, bh) >= 4.5 && bh <= 64
      : bw / Math.max(1, bh) >= 6.8 &&
        bh <= 40 &&
        ringStd < 6 &&
        displayText.length <= 32 &&
        !/^\s*\d{1,2}\s*[.)]/.test(displayText));
  let ribbonLeftLocalX = safeLocalLeft;
  let ribbonRightLocalX = safeLocalRight;
  const isSmallTiltedUiRow =
    !isSingleLineStat &&
    origLineCount === 1 &&
    effTiltedDeg >= 4.5 &&
    medGlyphH <= 58 &&
    bw / Math.max(1, bh) >= 2.2;
  const isDarkOvalCaption =
    isSmoothDarkOval &&
    origLineCount <= 2 &&
    displayText.length <= 32 &&
    !isSmallTiltedUiRow &&
    !isWideSingleLineRibbon &&
    !isSingleLineStat;
  let uiMinBoundX = Math.max(4, Math.min(wx0 + gMinX, wx0 + safeLocalLeft));
  let uiMaxBoundX = Math.min(fullWidth - 4, Math.max(wx0 + gMaxX, wx0 + safeLocalRight));
  if (isSmallTiltedUiRow) {
    const rotRad = ((style.rotationDeg ?? 0) * Math.PI) / 180;
    const slope = Math.tan(rotRad);
    const refCenterX = (cx0 + cx1) * 0.5;
    const refCenterY = (cy0 + cy1) * 0.5;
    let bezelRightAbsX = fullWidth - 4;
    let consecRight = 0;
    const scanRightEnd = Math.min(ww - 1, Math.max(gMaxX, safeLocalRight) + 28);
    for (let x = Math.max(0, gMaxX + 2); x <= scanRightEnd; x += 1) {
      const yMid = Math.round(refCenterY + (x - refCenterX) * slope);
      let darkHits = 0;
      for (let dy = -2; dy <= 2; dy += 1) {
        const sy = clamp(yMid + dy, 0, wh - 1);
        const cIdx = (sy * ww + x) * 3;
        const pLum = 0.299 * winRgb[cIdx] + 0.587 * winRgb[cIdx + 1] + 0.114 * winRgb[cIdx + 2];
        if (pLum <= 115 && pLum < bgLumInit - 55) darkHits += 1;
      }
      if (darkHits >= 3) {
        consecRight += 1;
        if (consecRight >= 2) {
          bezelRightAbsX = wx0 + x - 4;
          break;
        }
      } else {
        consecRight = 0;
      }
    }
    let bezelLeftAbsX = 4;
    let consecLeft = 0;
    const scanLeftEnd = Math.max(0, Math.min(gMinX, safeLocalLeft) - 28);
    for (let x = Math.min(ww - 1, gMinX - 2); x >= scanLeftEnd; x -= 1) {
      const yMid = Math.round(refCenterY + (x - refCenterX) * slope);
      let darkHits = 0;
      for (let dy = -2; dy <= 2; dy += 1) {
        const sy = clamp(yMid + dy, 0, wh - 1);
        const cIdx = (sy * ww + x) * 3;
        const pLum = 0.299 * winRgb[cIdx] + 0.587 * winRgb[cIdx + 1] + 0.114 * winRgb[cIdx + 2];
        if (pLum <= 115 && pLum < bgLumInit - 55) darkHits += 1;
      }
      if (darkHits >= 3) {
        consecLeft += 1;
        if (consecLeft >= 2) {
          bezelLeftAbsX = wx0 + x + 4;
          break;
        }
      } else {
        consecLeft = 0;
      }
    }
    const padUiX = Math.max(14, Math.round(medGlyphH * 0.65));
    uiMinBoundX = Math.max(4, bezelLeftAbsX, wx0 + Math.max(0, gMinX - padUiX));
    uiMaxBoundX = Math.min(
      fullWidth - 4,
      bezelRightAbsX,
      wx0 + Math.min(ww - 4, gMaxX + padUiX),
    );
  }

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
    const pageRefW = options?._pageFullWidth ?? fullWidth;
    const rawMaxSfxFontPx = Math.min(pageRefW * 0.135, Math.max(glyphH * 1.35, targetEmPx * 1.15));
    const hasClosedSfxBox =
      (hasActualPhysicalWalls || hasClosedBubbleWalls) &&
      !(style.hasTextStroke && style.strokeColor.toLowerCase() === '#ffffff' && !isFlatLightBubble);
    const maxSfxFontPx =
      hitTopWall && hitBottomWall && hasClosedSfxBox
        ? Math.min(
            rawMaxSfxFontPx,
            (safeLocalBottom - safeLocalTop) *
              (origLineCount === 1
                ? style.hasTextStroke
                  ? 0.78
                  : 0.85
                : style.hasTextStroke
                  ? 0.44
                  : 0.52),
            origLineCount === 1 ? targetEmPx * 1.02 : targetEmPx * 0.8,
          )
        : rawMaxSfxFontPx;
    const minSfxFontPx = Math.max(14, pageRefW * 0.022);
    fontPx = clamp(targetEmPx, minSfxFontPx, Math.max(minSfxFontPx, maxSfxFontPx));

    // Tek satırlık orijinal SFX'te ("NO.", "FIRST MURDER.") çeviriyi de mümkün olduğunca 1-2 satırda geniş tut
    const singleLineSfxW =
      origLineCount === 1
        ? (measureStyledWordWidth(
            measureCtx,
            displayText,
            fontPx,
            style.fontFamily,
            style.fontWeight,
          ) || fontPx * displayText.length * 0.62) /
            0.86 +
          16
        : 0;
    finalBoxW =
      origLineCount === 1
        ? !hasClosedBubbleWalls && absRotRadOrig >= 0.14
          ? Math.min(
              Math.max(glyphW * 1.55, bw * 1.55),
              Math.max(glyphW * 1.38, safeW, singleLineSfxW),
            )
          : Math.max(glyphW * 1.38, safeW, singleLineSfxW)
        : Math.max(glyphW * 1.25, safeW);
    finalBoxW = Math.min(finalBoxW, fullWidth * 0.94);
    if (
      origLineCount === 1 &&
      !hasClosedBubbleWalls &&
      bw <= pageRefW * 0.68 &&
      displayText.length >= 34
    ) {
      finalBoxW = Math.min(finalBoxW, Math.max(glyphW * 1.42, Math.round(pageRefW * 0.62)));
    }
    const maxSfxAvailH =
      origLineCount === 1 && !hasClosedSfxBox
        ? Math.max(glyphH * 1.75, safeH, fontPx * 1.25)
        : Math.max(glyphH * 1.25, safeH);
    finalBoxH = Math.max(glyphH * 1.25, safeH);

    const preferSingleLineSfx =
      origLineCount === 1 &&
      !hasClosedSfxBox &&
      absRotRadOrig < 0.14 &&
      displayText.length <= 28;
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
      const effSfxBoxH =
        origLineCount === 1 && !hasClosedSfxBox && wrapped.lines.length <= 1
          ? Math.max(finalBoxH, maxSfxAvailH, fontPx * 1.18)
          : finalBoxH;
      const sfxLineCountOk = preferSingleLineSfx
        ? wrapped.lines.length <= 1 || fontPx <= Math.max(minSfxFontPx * 1.05, targetEmPx * 0.78)
        : origLineCount > 1 || wrapped.lines.length <= 2;
      if (
        wrapped.totalHeightPx <= effSfxBoxH * 0.98 &&
        wrapped.maxWordWidth <= finalBoxW * 0.96 &&
        sfxLineCountOk
      ) {
        const widestLinePx = wrapped.lines.reduce(
          (m, l) => Math.max(m, l.widthPx * (l.scale ?? 1)),
          wrapped.maxWordWidth,
        );
        finalBoxW = Math.max(
          glyphW,
          Math.min(fullWidth * 0.95, Math.ceil(widestLinePx / 0.86 + 12)),
          Math.min(finalBoxW, widestLinePx * 1.18 + 20),
        );
        finalBoxH = Math.max(glyphH, wrapped.totalHeightPx + fontPx * 0.35);
        break;
      }
      if (fontPx <= minSfxFontPx) break;
      fontPx = Math.max(minSfxFontPx, fontPx * 0.94);
    }
  } else {
    // Konuşma Balonu & Anlatım Kutusu:
    const pageRefW = options?._pageFullWidth ?? fullWidth;
    const refFloorW = Math.min(pageRefW, 1100);
    const rawMaxDialogFontPx = isSmallTiltedUiRow
      ? Math.max(15, targetEmPx * 1.25)
      : Math.min(
          pageRefW * 0.135,
          Math.max(pageRefW * (emphasisLastLineScale ? 0.068 : 0.072), targetEmPx * 1.02),
        );
    const maxDialogFontPx =
      hitTopWall &&
      hitBottomWall &&
      (hasActualPhysicalWalls || hasClosedBubbleWalls) &&
      origLineCount === 1 &&
      !isSmallTiltedUiRow &&
      style.isDark &&
      displayText.length <= 14 &&
      targetEmPx >= pageRefW * 0.05
        ? Math.min(
            rawMaxDialogFontPx,
            (safeLocalBottom - safeLocalTop) * (style.hasTextStroke ? 0.36 : 0.48),
            targetEmPx * 0.72,
          )
        : rawMaxDialogFontPx;
    const softDialogFloorPx = isSmallTiltedUiRow
      ? Math.min(13.5, Math.max(10.5, targetEmPx * 1.12))
      : Math.min(refFloorW * 0.027, Math.max(12, targetEmPx * 1.4));
    fontPx = clamp(targetEmPx, softDialogFloorPx, Math.max(softDialogFloorPx, maxDialogFontPx));
    const minFontPx = Math.max(9.5, refFloorW * 0.011);

    const charLen = displayText.length;
    const preserveSingleLineOpen =
      origLineCount === 1 &&
      ((((!hitLeftWall && !hitRightWall) ||
        ((!hasClosedBubbleWalls || (!isFlatLightBubble && charLen <= 24)) &&
          safeLocalRight - safeLocalLeft >= glyphW * 1.15)) &&
        (absStyleRotDeg < 1
          ? charLen <= 32 || ((hitTopWall || hitBottomWall) && charLen <= 34)
          : charLen <= 20)) ||
        (isWideSingleLineRibbon && absStyleRotDeg < 1) ||
        (isSmallTiltedUiRow && charLen <= 68));
    const desiredCharsPerLine = preserveSingleLineOpen
      ? charLen + 2
      : charLen <= 10
        ? charLen + 2
        : clamp(Math.ceil(Math.sqrt(charLen * 2.1)) * 2, 10, 26);
    const singleCharW =
      measureStyledWordWidth(measureCtx, 'A', fontPx, style.fontFamily, style.fontWeight) ||
      fontPx * 0.61;
    const singleLineNeedW = preserveSingleLineOpen
      ? Math.ceil(
          ((measureStyledWordWidth(
            measureCtx,
            displayText,
            fontPx,
            style.fontFamily,
            style.fontWeight,
          ) || charLen * singleCharW) +
            14) /
            0.86,
        )
      : 0;
    const desiredW = Math.max(desiredCharsPerLine * singleCharW + 18, singleLineNeedW);
    const rawLeftWall = hitLeftWall ? safeLocalLeft - wallPadX : safeLocalLeft;
    const rawRightWall = hitRightWall ? safeLocalRight + wallPadX : safeLocalRight;
    const rawWallSpan = Math.max(glyphW, rawRightWall - rawLeftWall);
    const targetWallClear = clamp(Math.round(medGlyphH * 0.16), 3, 6);
    const maxDrawableW = Math.max(glyphW, rawWallSpan - 2 * targetWallClear);
    const interiorSpan =
      safeLocalRight > safeLocalLeft + 24 ? safeLocalRight - safeLocalLeft : safeW;
    const isDarkTexturedScene =
      preferLightFirst && bgLumInit < 150 && ringStd >= (wallHits >= 3 ? 13 : 4.5);
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
          Math.max(glyphW * 1.45, singleLineNeedW),
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
    const effMinFontPx =
      isWideSingleLineRibbon && isVividBannerNow
        ? Math.min(minFontPx, 7.5)
        : isSmallTiltedUiRow
          ? Math.min(minFontPx, 8.5)
          : minFontPx;
    let usableSafeW = isOpenMultilineScene
      ? Math.min(rawUsableSafeW, Math.max(glyphW * 1.18, medGlyphH * 10.5))
      : rawUsableSafeW;
    if (isSmallTiltedUiRow && uiMaxBoundX > uiMinBoundX + 24) {
      usableSafeW = Math.min(usableSafeW, uiMaxBoundX - uiMinBoundX);
      if (gMaxX - gMinX >= pageRefW * 0.72) {
        usableSafeW = Math.min(usableSafeW, gMaxX - gMinX + 8, pageRefW * 0.92);
      }
    } else if (isDarkOvalCaption) {
      usableSafeW = Math.max(
        usableSafeW,
        Math.min(ww - 4, Math.max(glyphW * 1.45, Math.round(medGlyphH * 10))),
      );
    } else if (
      !preserveSingleLineOpen &&
      !isWideSingleLineRibbon &&
      origLineCount === 1 &&
      bw <= pageRefW * 0.68 &&
      charLen >= 34
    ) {
      usableSafeW = Math.min(usableSafeW, Math.max(glyphW * 1.45, Math.round(pageRefW * 0.72)));
    }
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
    const nearPageTopGutter = boxY0 <= 28 && !hitTopWall && sibMinBoundYAbs <= 6;
    const nearPageBotGutter = fullHeight - boxY1 <= 28 && !hitBottomWall && sibMaxBoundYAbs >= fullHeight - 6;
    const rawWallVertCapH =
      hitTopWall && hitBottomWall && (hasActualPhysicalWalls || hasClosedBubbleWalls)
        ? Math.max(glyphH * 1.08, Math.min(topWallDist + botWallDist, wallSpanV) * 0.95)
        : nearPageTopGutter || nearPageBotGutter
          ? Math.max(glyphH * 1.8, Math.min(sibMaxBoundYAbs - Math.max(4, sibMinBoundYAbs), glyphH * 2.6))
          : Math.max(glyphH * 1.15, Math.min(topWallDist * 2, botWallDist * 2));
    const wallVertCapH = Math.min(
      Math.max(glyphH, sibMaxBoundYAbs - sibMinBoundYAbs),
      isDarkOvalCaption
        ? Math.max(rawWallVertCapH, glyphH * 2.2, medGlyphH * 3.0, 56)
        : preserveSingleLineOpen && !hasActualPhysicalWalls && !hasClosedBubbleWalls
          ? Math.max(rawWallVertCapH, glyphH * 1.68, fontPx * 1.18)
          : rawWallVertCapH,
    );
    const maxAvailBoxH = Math.min(
      Math.max(glyphH, sibMaxBoundYAbs - sibMinBoundYAbs),
      isDarkOvalCaption
        ? Math.max(safeH, wallVertCapH, fontPx * 3.1)
        : hitTopWall && hitBottomWall
          ? Math.max(safeH, wallVertCapH)
          : nearPageTopGutter || nearPageBotGutter
            ? wallVertCapH
            : Math.max(safeH, glyphH * 1.4),
    );
    finalBoxH = Math.min(Math.max(glyphH * 1.15, safeH), wallVertCapH);

    // Geniş iç boşluğa sahip kapalı konuşma balonlarında (küçük orijinal İngilizce punto nedeniyle)
    // çevrilen metnin mikroskobik kalmaması için iç alan kapasitesine oranlı okunaklı boyut seç.
    if (
      (isFlatLightBubble || isDarkOvalCaption) &&
      !(origLineCount === 1 && ringMedChroma >= 6 && ringStd >= 5.5) &&
      !preserveSingleLineOpen &&
      !isWideSingleLineRibbon &&
      !isSmallTiltedUiRow &&
      !isOpenMultilineScene &&
      effTiltedDeg < 4.5 &&
      usableSafeW >= (isDarkOvalCaption ? 110 : 115) &&
      (wallVertCapH >= 60 || isDarkOvalCaption)
    ) {
      const effAreaW = Math.min(usableSafeW, ww * 0.88);
      const effAreaH = Math.min(wallVertCapH, effAreaW * 1.35);
      const cavityArea = effAreaW * effAreaH;
      const areaEmPx = Math.sqrt((cavityArea * 0.25) / Math.max(5, charLen * 0.62));
      const isSpaciousClosedBubble =
        wallVertCapH >= 90 && usableSafeW >= 150 && charLen <= 38;
      const comfortMaxPx = isDarkOvalCaption
        ? Math.min(refFloorW * 0.038, Math.max(refFloorW * 0.026, targetEmPx * 1.55))
        : isSpaciousClosedBubble
          ? Math.min(refFloorW * 0.044, Math.max(refFloorW * 0.030, targetEmPx * 2.15))
          : Math.min(refFloorW * 0.0325, Math.max(refFloorW * 0.0265, targetEmPx * 1.75));
      const comfortTargetEmPx = clamp(
        isDarkOvalCaption ? Math.max(areaEmPx, targetEmPx * 1.45) : areaEmPx,
        isDarkOvalCaption ? refFloorW * 0.026 : refFloorW * 0.0245,
        comfortMaxPx,
      );
      if (comfortTargetEmPx > fontPx) {
        const boostedFontPx = Math.min(maxDialogFontPx, comfortTargetEmPx);
        const boostRatio = boostedFontPx / Math.max(1, fontPx);
        fontPx = boostedFontPx;
        finalBoxW = clamp(
          Math.max(finalBoxW, desiredW * boostRatio),
          Math.min(glyphW * 0.85, usableSafeW),
          usableSafeW,
        );
      }
    }

    const canMeasureContour =
      hasActualPhysicalWalls &&
      (hitLeftWall || hitRightWall) &&
      !isOpenMultilineScene;
    const contourScanX = clamp(Math.round(layoutCenterX), 0, ww - 1);
    const contourPadX = clamp(Math.round(medGlyphH * 0.28), 6, 11);
    const lineHeightRatio =
      style.fontFamily === 'anton' || style.fontFamily === 'bangers' ? 1.09 : 1.09;

    const measureRowClearSpanPx = (
      yTopLocal: number,
      yBotLocal: number,
      isEdgeRow: boolean,
      fallbackW: number,
    ): number => {
      const yMid = Math.round((yTopLocal + yBotLocal) * 0.5);
      const sampleYs = [
        clamp(yTopLocal, 0, wh - 1),
        clamp(yMid, 0, wh - 1),
        clamp(yBotLocal, 0, wh - 1),
      ];
      const halfSpans: number[] = [];
      for (const sy of sampleYs) {
        const sBy0 = clamp(sy - 3, 0, wh - 1);
        const sBy1 = clamp(sy + 3, 0, wh - 1);
        let halfL = contourScanX - rawLeftWall - contourPadX;
        let hitL = false;
        for (let x = contourScanX; x >= 0; x -= 1) {
          if (hasWallBandX(x, sBy0, sBy1)) {
            halfL = contourScanX - x - contourPadX;
            hitL = true;
            break;
          }
        }
        let halfR = rawRightWall - contourScanX - contourPadX;
        let hitR = false;
        for (let x = contourScanX; x < ww; x += 1) {
          if (hasWallBandX(x, sBy0, sBy1)) {
            halfR = x - contourScanX - contourPadX;
            hitR = true;
            break;
          }
        }
        if (hitL && hitR) {
          halfSpans.push(Math.max(medGlyphH * 0.85, Math.min(halfL, halfR)));
        } else if (hitLeftWall && hitL) {
          halfSpans.push(Math.max(medGlyphH * 0.85, halfL));
        } else if (hitRightWall && hitR) {
          halfSpans.push(Math.max(medGlyphH * 0.85, halfR));
        }
      }
      if (halfSpans.length === 0) {
        return fallbackW;
      }
      halfSpans.sort((a, b) => a - b);
      // Uç satırlarda (ilk/son) kubbe eğriliğine çarpmamak için en dar kesiti, orta satırlarda medyanı esas al
      const pickedHalf = isEdgeRow ? halfSpans[0] : halfSpans[halfSpans.length >> 1];
      return Math.max(medGlyphH * 1.75, 2 * pickedHalf);
    };

    const measureContourForWrap = (
      wrappedRes: ReturnType<typeof computeSmartWrappedLines>,
      curBoxWrapW: number,
      curFontPx: number,
      curLineH: number,
    ): { rowSpans: number[]; rowPcts: number[] } => {
      const rowSpans: number[] = [];
      const rowPcts: number[] = [];
      if (!canMeasureContour || wrappedRes.lines.length < 1) {
        return { rowSpans, rowPcts };
      }
      const safeWrapW = Math.max(1, curBoxWrapW);
      let curY = layoutCenterY - wrappedRes.totalHeightPx * 0.5;
      for (let li = 0; li < wrappedRes.lines.length; li += 1) {
        const line = wrappedRes.lines[li];
        const lh = curFontPx * (line.scale ?? 1) * curLineH;
        const y0 = Math.round(curY + lh * 0.10);
        const y1 = Math.round(curY + lh * 0.90);
        const isEdgeRow =
          wrappedRes.lines.length >= 2 && (li === 0 || li === wrappedRes.lines.length - 1);
        const spanPx = measureRowClearSpanPx(y0, y1, isEdgeRow, safeWrapW);
        rowSpans.push(spanPx);
        rowPcts.push(Number(clamp(spanPx / safeWrapW, 0.52, 1.0).toFixed(3)));
        curY += lh;
      }
      return { rowSpans, rowPcts };
    };
    if (canMeasureContour) {
      postContourMeasureFn = measureContourForWrap;
    }

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

      let { rowSpans, rowPcts } = measureContourForWrap(
        wrapped,
        finalBoxW * 0.88,
        fontPx,
        lineHeightRatio,
      );
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
        if (contoured.lines.length >= 2 && contoured.lines.length <= 8) {
          wrapped = contoured;
          ({ rowSpans, rowPcts } = measureContourForWrap(
            wrapped,
            finalBoxW * 0.88,
            fontPx,
            lineHeightRatio,
          ));
          if (rowPcts.some((p) => p < 0.96)) {
            const contoured2 = computeSmartWrappedLines(
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
            if (contoured2.lines.length >= 2 && contoured2.lines.length <= 8) {
              wrapped = contoured2;
              ({ rowSpans, rowPcts } = measureContourForWrap(
                wrapped,
                finalBoxW * 0.88,
                fontPx,
                lineHeightRatio,
              ));
            }
          }
        }
      }

      let linesClearWalls = true;
      if (canMeasureContour && rowSpans.length === wrapped.lines.length) {
        for (let li = 0; li < wrapped.lines.length; li += 1) {
          const line = wrapped.lines[li];
          const drawnW = (line.scale ?? 1) < 1 ? line.widthPx * (line.scale ?? 1) : line.widthPx;
          if (drawnW > rowSpans[li] * 0.91 && fontPx > effMinFontPx * 1.04) {
            linesClearWalls = false;
            break;
          }
        }
      }

      const uniformLineScales = wrapped.lines.every((l) => (l.scale ?? 1) >= 0.99) || step >= 24;
      const vertFillRatio = hitTopWall && hitBottomWall ? 0.98 : 1.0;
      const ribbonFitsSingleLine =
        !isWideSingleLineRibbon || wrapped.lines.length <= 1 || fontPx <= effMinFontPx * 1.05;
      const uiRowFitsSingleLine =
        !isSmallTiltedUiRow ||
        origLineCount > 1 ||
        wrapped.lines.length <= 1 ||
        fontPx <= effMinFontPx * 1.05;
      const openSingleLineFits =
        !preserveSingleLineOpen ||
        origLineCount > 1 ||
        ((isFlatLightBubble || isDarkOvalCaption) && hasClosedBubbleWalls) ||
        wrapped.lines.length <= 1 ||
        fontPx <= Math.max(effMinFontPx * 1.05, targetEmPx * 0.72);
      if (
        wrapped.totalHeightPx <= finalBoxH * vertFillRatio &&
        wrapped.maxWordWidth <= finalBoxW * horizSlack &&
        linesClearWalls &&
        ribbonFitsSingleLine &&
        uiRowFitsSingleLine &&
        openSingleLineFits &&
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
    const minBoundX = isSmallTiltedUiRow
      ? uiMinBoundX
      : isWideSingleLineRibbon && isVividBannerNow && ribbonRightLocalX > ribbonLeftLocalX + 36
        ? Math.max(4, wx0 + ribbonLeftLocalX + 2)
        : isDarkOvalCaption
          ? Math.max(4, wx0 + Math.max(0, Math.min(gMinX - Math.round(glyphW * 0.35), gMinX - 24)))
          : !hasClosedBubbleWalls && !isFlatLightBubble
            ? Math.max(
                rawMinBoundX,
                wx0 + Math.max(0, Math.min(gMinX - Math.round(glyphW * 0.18), gMinX - 8)),
              )
            : !hitLeftWall
              ? Math.max(rawMinBoundX, wx0 + Math.max(0, Math.min(gMinX, cx0) - Math.max(12, Math.round(medGlyphH * 0.48))))
              : rawMinBoundX;
    const maxBoundX = isSmallTiltedUiRow
      ? uiMaxBoundX
      : isWideSingleLineRibbon && isVividBannerNow && ribbonRightLocalX > ribbonLeftLocalX + 36
        ? Math.min(fullWidth - 4, wx0 + ribbonRightLocalX - 2)
        : isDarkOvalCaption
          ? Math.min(fullWidth - 4, wx0 + Math.min(ww, Math.max(gMaxX + Math.round(glyphW * 0.35), gMaxX + 24)))
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
    const minClampH = effTiltedDeg >= 4.5 ? Math.min(glyphH, 28) : glyphH;
    if (finalBoxH > maxBoundY - minBoundY && maxBoundY - minBoundY >= minClampH) {
      finalBoxH = maxBoundY - minBoundY;
    }
    const nearEdgeTopShift = boxY0 <= 28 && !hitTopWall && minBoundY <= 6;
    const targetTopY = nearEdgeTopShift
      ? Math.max(minBoundY + 4, boxY0)
      : absCenterY - finalBoxH * 0.5;
    refinedY0 = clamp(
      targetTopY,
      minBoundY,
      Math.max(minBoundY, maxBoundY - finalBoxH),
    );
    refinedY1 = clamp(refinedY0 + finalBoxH, refinedY0 + 4, maxBoundY);

    // Kutu sınırlamaları (minBoundX..maxBoundX, minBoundY..maxBoundY) sonrası satır taşması kalmasın
    const postBoxW = Math.max(24, refinedX1 - refinedX0);
    const postBoxH = Math.max(12, refinedY1 - refinedY0);
    const postLineHeightRatio =
      style.fontFamily === 'anton' || style.fontFamily === 'bangers' ? 1.09 : 1.09;
    for (let fitStep = 0; fitStep < 16; fitStep += 1) {
      const checkWrap = computeSmartWrappedLines(measureCtx, displayText, postBoxW * 0.88, fontPx, {
        fontFamily: style.fontFamily,
        fontWeight: style.fontWeight,
        lineWidthsPct: finalLineWidthsPct,
        emphasisLastLineScale,
        lineHeightRatio: postLineHeightRatio,
      });
      let postLinesClearWalls = true;
      if (postContourMeasureFn) {
        const { rowSpans: postRowSpans, rowPcts: postRowPcts } = postContourMeasureFn(
          checkWrap,
          postBoxW * 0.88,
          fontPx,
          postLineHeightRatio,
        );
        if (postRowSpans.length === checkWrap.lines.length) {
          for (let li = 0; li < checkWrap.lines.length; li += 1) {
            const line = checkWrap.lines[li];
            const drawnW = (line.scale ?? 1) < 1 ? line.widthPx * (line.scale ?? 1) : line.widthPx;
            if (drawnW > postRowSpans[li] * 0.92 && fontPx > 9.5) {
              postLinesClearWalls = false;
              break;
            }
          }
          if (postLinesClearWalls) {
            finalLineWidthsPct = postRowPcts.some((p) => p < 0.98) ? postRowPcts : undefined;
          }
        }
      }
      if (
        checkWrap.totalHeightPx <= postBoxH * 0.96 &&
        checkWrap.maxWordWidth <= postBoxW * 0.92 &&
        postLinesClearWalls &&
        (!isSmallTiltedUiRow ||
          origLineCount > 1 ||
          (checkWrap.lines.length <= 1 &&
            (checkWrap.lines[0]?.scale ?? 1) >= 0.90 &&
            (checkWrap.lines[0]?.widthPx ?? 0) <= postBoxW * 0.84))
      ) {
        break;
      }
      if (fontPx <= 9.5) break;
      fontPx = Math.max(9.5, fontPx * 0.94);
    }
  }

  const refinedBox: [number, number, number, number] = [
    toNorm(refinedY0, fullHeight),
    toNorm(refinedX0, fullWidth),
    toNorm(refinedY1, fullHeight),
    toNorm(refinedX1, fullWidth),
  ];

  const minCqw = options?._pageFullWidth
    ? clamp((1.0 * options._pageFullWidth) / fullWidth, 0.5, 1.25)
    : 1.25;
  const maxCqw = 13.5;
  const fontSizeCqw = Number(clamp((fontPx / fullWidth) * 100, minCqw, maxCqw).toFixed(3));

  // Çok satırlı blok farklı parlaklık kuşaklarına yayılıyorsa (ör. üst yarı beyaz, alt yarı siyah panel)
  // her satırın altındaki gerçek arka plan parlaklığına göre otomatik kontrast rengi belirle
  let finalLineStyles: TranslationBlock['lineStyles'] | undefined;
  if (!isSingleLineStat && !style.hasTextStroke) {
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
