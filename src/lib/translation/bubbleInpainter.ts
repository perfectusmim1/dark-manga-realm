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

export const TRANSLATION_BLOCK_VERSION = 7;
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
    fontLoadPromise = Promise.race([
      Promise.allSettled([
        document.fonts.load('700 24px "Shantell Sans"'),
        document.fonts.load('800 24px "Shantell Sans"'),
        document.fonts.load('400 28px "Anton"'),
        document.fonts.load('400 28px "Bangers"'),
        document.fonts.load('400 24px "Permanent Marker"'),
        document.fonts.load('700 24px "Cinzel"'),
      ]).then(() => undefined),
      new Promise<void>((resolve) => setTimeout(resolve, 500)),
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
  fontWeight = 700,
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
// Yalnızca OCR satır çekirdeklerini (lineCores, 3x ağırlık) ve çok dar (3px) iç sınırı örnekler.
// Böylece dar mavi/koyu sistem kutularının ("SYSTEM PROMPT", "YOU REQUIRE 90 MORE EVOLUTION POINTS...")
// dışındaki beyaz sayfa boşluğu ASLA kutunun arka plan rengini beyaza çeviremez!
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
  const binCounts = new Int32Array(32768);
  const sx0 = Math.max(0, cx0 - 3);
  const sx1 = Math.min(ww, cx1 + 3);
  const sy0 = Math.max(0, cy0 - 3);
  const sy1 = Math.min(wh, cy1 + 3);

  let coreDarkMidPixels = 0;
  let coreTotalPixels = 0;

  for (let y = sy0; y < sy1; y += 1) {
    let idx = (y * ww + sx0) * 3;
    for (let x = sx0; x < sx1; x += 1, idx += 3) {
      const r = winRgb[idx];
      const g = winRgb[idx + 1];
      const b = winRgb[idx + 2];
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;

      let inLineCore = false;
      for (let li = 0; li < lineCores.length; li += 1) {
        const lc = lineCores[li];
        if (x >= lc.x0 && x < lc.x1 && y >= lc.y0 && y < lc.y1) {
          inLineCore = true;
          break;
        }
      }

      if (inLineCore) {
        coreTotalPixels += 1;
        if (lum < 175) coreDarkMidPixels += 1;
      }

      const bin = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
      const weight = inLineCore ? 3 : 1;
      binCounts[bin] += weight;
    }
  }

  // Harf vuruşları (glyph strokes) hiçbir zaman satır çekirdeğinin %38'inden fazlasını kaplamaz.
  // Çekirdek piksellerinin >= %42'si koyu/orta tonluysa (lum < 175), arka plan kesinlikle koyu/renklidir (beyaz harf binlerini dışla!).
  // Çekirdek piksellerinin < %38'i koyuysa (> %62'si açık), arka plan kesinlikle açık renklidir (koyu mürekkep binlerini dışla!).
  const coreDarkMidRatio = coreTotalPixels > 0 ? coreDarkMidPixels / coreTotalPixels : 0;
  const forceDarkOrColoredBg = coreTotalPixels > 16 && coreDarkMidRatio >= 0.42;
  const forceLightBg = coreTotalPixels > 16 && coreDarkMidRatio < 0.38;

  let bestBin = -1;
  let bestCount = -1;
  for (let bin = 0; bin < 32768; bin += 1) {
    const cnt = binCounts[bin];
    if (cnt <= bestCount) continue;
    const br = (((bin >> 10) & 31) << 3) + 4;
    const bg = (((bin >> 5) & 31) << 3) + 4;
    const bb = ((bin & 31) << 3) + 4;
    const binLum = 0.299 * br + 0.587 * bg + 0.114 * bb;
    if (forceDarkOrColoredBg && binLum >= 185) continue;
    if (forceLightBg && binLum < 120) continue;
    bestCount = cnt;
    bestBin = bin;
  }

  if (bestBin < 0) {
    for (let bin = 0; bin < 32768; bin += 1) {
      if (binCounts[bin] > bestCount) {
        bestCount = binCounts[bin];
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
      const bin = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
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

  // Büyük/stilize harflerin ("NO", "FIRST MURDER.", "ALONE?") pencere sınırına çarpıp
  // balon çerçevesi sanılmasını önlemek ve yuvarlak/dikenli balonların üst-alt boşluğunu tam görmek için geniş arama penceresi
  const padWinX = Math.max(bh < 55 ? 64 : 48, bw * 0.48, bh * 0.95);
  const padWinY = Math.max(bh < 55 ? 56 : 48, bh * 1.15, bw * 0.42);

  let wx0 = Math.max(0, Math.floor(boxX0 - padWinX));
  let wx1 = Math.min(fullWidth, Math.ceil(boxX1 + padWinX));
  let wy0 = Math.max(0, Math.floor(boxY0 - padWinY));
  let wy1 = Math.min(fullHeight, Math.ceil(boxY1 + padWinY));

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
          }))
        : [{ x0: cx0, x1: cx1, y0: cy0, y1: cy1 }];

    // Baskın arka plan rengini bulmak için yalnızca çekirdek satırları ve 3px iç sınırı örnekle
    const [bgR, bgG, bgB] = findDominantBackgroundRgb(
      winRgb,
      ww,
      wh,
      cx0,
      cy0,
      cx1,
      cy1,
      lineCores,
    );
    const bgLumInit = 0.299 * bgR + 0.587 * bgG + 0.114 * bgB;

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
    const padCoreX = Math.max(32, Math.round(medLineH * 0.95));
    const padCoreY = Math.max(28, Math.round(medLineH * 0.85));

    const isInsideAnyCore = (x: number, y: number): boolean => {
      for (let i = 0; i < lineCores.length; i += 1) {
        const lc = lineCores[i];
        if (x >= lc.x0 && x <= lc.x1 && y >= lc.y0 && y <= lc.y1) return true;
      }
      return x >= cx0 && x <= cx1 && y >= cy0 && y <= cy1;
    };

    const isNearAnyLineCore = (x: number, y: number): boolean => {
      for (let i = 0; i < lineCores.length; i += 1) {
        const lc = lineCores[i];
        if (
          x >= lc.x0 - padCoreX &&
          x <= lc.x1 + padCoreX &&
          y >= lc.y0 - padCoreY &&
          y <= lc.y1 + padCoreY
        ) {
          return true;
        }
      }
      return (
        x >= cx0 - padCoreX &&
        x <= cx1 + padCoreX &&
        y >= cy0 - padCoreY &&
        y <= cy1 + padCoreY
      );
    };

    /**
     * Koyu Mürekkep / Koyu İç Dolgulu Harf Maskesi (`fgDark`):
     * - Yalnızca yerel çevresinden DAHA KOYU olan pikselleri (`pixLum < 185`) işaretler.
     * - Beyaz kontur pikselleri (`pixLum >= 185`) kesinlikle `0` kaldığı için, "KIM JEONGHYUK",
     *   "REPARTIDOR DE DALMIN", "31 AÑOS" gibi beyaz konturlu koyu harflerde 3px beyaz kontur
     *   doğal bir yalıtım hendek (moat) görevi görür; harf içlerinin siyah çerçeve veya koyu yelekle
     *   birleşmesini %100 engeller!
     */
    const buildDarkForegroundMask = (localThresh: number, globalThresh: number): Uint8Array => {
      const fg = new Uint8Array(numPixels);
      const isLightOrMid = bgLumInit >= 115;

      for (let y = 0; y < wh; y += 1) {
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

          const inCore = isInsideAnyCore(x, y);
          const effLocal = inCore ? Math.max(9, localThresh * 0.65) : localThresh;
          const meanLum = 0.299 * meanR + 0.587 * meanG + 0.114 * meanB;
          const tMeanLum = 0.299 * tMeanR + 0.587 * tMeanG + 0.114 * tMeanB;
          const bgMatchesLocal = isLightOrMid && Math.abs(meanLum - bgLumInit) < 32;

          const dLumMedDark = meanLum - pixLum;
          const dLumTightDark = tMeanLum - pixLum;
          const dMedDark = Math.max(meanR - pr, meanG - pg, meanB - pb);
          const dTightDark = Math.max(tMeanR - pr, tMeanG - pg, tMeanB - pb);

          // 1. Açık/gradyanlı zeminde standart veya güneş ışığında solmuş koyu/gri mürekkep
          //    (Sarı güneş hüzmelerinde yalnızca mavi kanal düştüğü için gerçek parlaklık düşüşü dLumMedDark şarttır!)
          // 2. Koyu zemin üzerinde bile olsa beyaz dış konturun oluşturduğu parlak dar hale (tMeanLum >= 135) içindeki koyu harf gövdesi (pixLum < 115)!
          if (
            (meanLum >= 160 && dLumMedDark > effLocal * 0.82 && dMedDark > effLocal) ||
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
    const buildLightForegroundMask = (localThresh: number, globalThresh: number): Uint8Array => {
      const fg = new Uint8Array(numPixels);

      for (let y = 0; y < wh; y += 1) {
        const y0s = Math.max(0, y - R);
        const y1s = Math.min(wh, y + R + 1);
        const r0Off = y0s * iw;
        const r1Off = y1s * iw;
        const spanY = y1s - y0s;

        for (let x = 0; x < ww; x += 1) {
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
          const effLocal = inCore ? Math.max(9, localThresh * 0.65) : localThresh;
          const dLocalLight = Math.max(pr - meanR, pg - meanG, pb - meanB);
          const dGlobalLight = Math.max(pr - bgR, pg - bgG, pb - bgB);

          if (
            dLocalLight > effLocal ||
            (dLocalLight > effLocal * 0.5 && dGlobalLight > globalThresh * 1.25)
          ) {
            fg[pIdx] = 1;
            continue;
          }

          // Siyah zemin üzerinde koyu kırmızı/bordo ("ER.") gibi yüksek kromalı harfler
          const chromaDiffLocal =
            Math.abs((pr - pg) - (meanR - meanG)) +
            Math.abs((pr - pb) - (meanR - meanB)) +
            Math.abs((pg - pb) - (meanG - meanB));
          if (chromaDiffLocal > effLocal * 1.55 && dLocalLight > 6) {
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
          let overlapsCore = false;

          const startNearCore = isNearAnyLineCore(x, y);

          while (qHead < qTail) {
            const curr = queue[qHead++];
            const cy = (curr / ww) | 0;
            const cx = curr - cy * ww;
            area += 1;

            if (cx < minx) minx = cx;
            if (cx > maxx) maxx = cx;
            if (cy < miny) miny = cy;
            if (cy > maxy) maxy = cy;
            if (cx <= 1 || cx >= ww - 2 || cy <= 1 || cy >= wh - 2) touchesBorder = true;
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
                  // Harf kuşağı (isNearAnyLineCore) içindeki piksellerin dışarıdaki arka plan çizgileri
                  // veya balon çerçevesiyle birleşip touchesBorder=true olmasını engelle!
                  if (!(bgLumInit < 45 && bh < 55) && startNearCore !== isNearAnyLineCore(nx, ny)) {
                    continue;
                  }
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
          if (lum > bgLumInit + 28 && Math.max(pr - bgR, pg - bgG, pb - bgB) > 30) {
            brighterCount += 1;
          }
          if (lum < bgLumInit - 26 && Math.max(bgR - pr, bgG - pg, bgB - pb) > 28) {
            darkerCount += 1;
          }
        }
      }
    }

    const preferLightFirst = bgLumInit < 55 || (bgLumInit < 165 && brighterCount > darkerCount * 1.8);
    const isSingleOrDarkSfx = preferLightFirst;

    const isValidGlyphComponent = (c: ComponentInfo): boolean => {
      if (c.area < 2) return false;
      const coreRatio = c.corePixels / Math.max(1, c.area);
      const coreBoxArea = Math.max(1, bw * bh);
      // Pencere kenarına değmiyorsa ve piksellerinin önemli kısmı OCR kutusu içindeyse boyutuna bakmaksızın HARFTİR!
      if (!c.touchesBorder && coreRatio >= 0.22 && c.area <= coreBoxArea * 1.45) {
        return true;
      }
      if (c.touchesBorder) return false;
      const maxAllowedCompH = isSingleOrDarkSfx
        ? Math.max(bh * 2.8, wh * 0.88)
        : Math.max(bh * 1.35, wh * 0.84);
      const maxAllowedCompW = isSingleOrDarkSfx
        ? Math.max(bw * 1.35, ww * 0.9)
        : Math.max(bw * 1.25, ww * 0.9);
      return c.w <= maxAllowedCompW && c.h <= maxAllowedCompH;
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

    const runMaskPass = (fgMask: Uint8Array) => {
      const res = extractComponents(fgMask);
      const v = res.comps.filter(isValidGlyphComponent);
      const acc = new Set<number>(v.filter((c) => c.overlapsCore).map((c) => c.id));
      return { ...res, valid: v, accepted: acc, spanW: getAcceptedSpanW(acc, v) };
    };

    // Arka plan koyuysa ("NO.", "FIRST MURDER.") parlak maskeden başla;
    // aksi halde ("KIM JEONGHYUK", "31 AÑOS" ve tüm konuşma balonları) koyu mürekkep maskesinden başla.
    let pass = runMaskPass(
      preferLightFirst ? buildLightForegroundMask(20, 32) : buildDarkForegroundMask(20, 32),
    );

    if (pass.accepted.size === 0 || pass.spanW < bw * 0.22) {
      const gentlePass = runMaskPass(
        preferLightFirst ? buildLightForegroundMask(11, 18) : buildDarkForegroundMask(11, 18),
      );
      if (gentlePass.spanW > pass.spanW) pass = gentlePass;
    }

    if (pass.accepted.size === 0 || pass.spanW < bw * 0.22) {
      if (!(preferLightFirst && darkerCount < brighterCount * 0.25)) {
        const altPass = runMaskPass(
          preferLightFirst ? buildDarkForegroundMask(16, 26) : buildLightForegroundMask(18, 28),
        );
        if (altPass.spanW > pass.spanW) pass = altPass;
      }
    }

    const { labels, comps, valid, accepted } = pass;

    // OCR kutusunun kenarında kesilmiş harfleri ("?", "!", "ER.", "ALONE?") komşu balonlara veya
    // balon dışı noktalı arka plan dokularına (screentone) sıçramadan kontrollü olarak büyüt
    const maxGrowX = isSingleOrDarkSfx
      ? Math.max(64, bh * 2.1, bw * 0.58)
      : Math.max(26, bh * 0.8, bw * 0.18);
    const maxGrowY = isSingleOrDarkSfx
      ? Math.max(46, bh * 1.45)
      : Math.max(18, bh * 0.42);
    const allowedMinX = Math.max(1, cx0 - maxGrowX);
    const allowedMaxX = Math.min(ww - 2, cx1 + maxGrowX);
    const allowedMinY = Math.max(1, cy0 - maxGrowY);
    const allowedMaxY = Math.min(wh - 2, cy1 + maxGrowY);

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
        isSingleOrDarkSfx ? Math.max(18, medH * 1.35) : Math.max(14, medH * 1.15),
      );
      const padY = Math.min(
        maxGrowY,
        isSingleOrDarkSfx ? Math.max(12, medH * 0.85) : Math.max(10, medH * 0.75),
      );

      let uMinX = Infinity;
      let uMaxX = -Infinity;
      let uMinY = Infinity;
      let uMaxY = -Infinity;
      for (const c of accComps) {
        if (c.minx < uMinX) uMinX = c.minx;
        if (c.maxx > uMaxX) uMaxX = c.maxx;
        if (c.miny < uMinY) uMinY = c.miny;
        if (c.maxy > uMaxY) uMaxY = c.maxy;
      }
      uMinX = Math.max(allowedMinX, uMinX - padX);
      uMaxX = Math.min(allowedMaxX, uMaxX + padX);
      uMinY = Math.max(allowedMinY, uMinY - padY);
      uMaxY = Math.min(allowedMaxY, uMaxY + padY);

      const maxCompH = isSingleOrDarkSfx
        ? Math.max(medH * 3.8, maxH * 3.2, bh * 2.8)
        : Math.max(medH * 3.0, maxH * 1.8);
      for (const c of valid) {
        if (accepted.has(c.id)) continue;
        if (c.minx < allowedMinX || c.maxx > allowedMaxX || c.miny < allowedMinY || c.maxy > allowedMaxY) {
          continue;
        }
        // Nokta gürültülerini (1-3px screentone beneklerini) dışarıdan toplama
        if (c.area < 6 && !c.overlapsCore) continue;
        if (c.h > maxCompH || c.w > Math.max(medH * 6.0, bw * 1.2)) {
          continue;
        }
        if (c.maxx >= uMinX && c.minx <= uMaxX && c.maxy >= uMinY && c.miny <= uMaxY) {
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

    for (const c of comps) {
      if (!c.touchesBorder) continue;
      // Eğer bileşen satır yüksekliğiyle uyumluysa (tüm pencereyi boydan boya geçen panel çizgisi değilse)
      // ve OCR çekirdeğine yakınsa, pencereyi o yönde genişlet!
      const vOverlapCore = Math.min(c.maxy, cy1 + 12) - Math.max(c.miny, cy0 - 12);
      if (c.h <= bh * 3.0 && c.w <= bw * 1.4 && vOverlapCore >= Math.min(c.h, bh) * 0.45) {
        if (c.minx <= 2 && curWx0 > 0 && cx0 - c.maxx <= bh * 1.6) {
          expandLeft = Math.max(expandLeft, Math.round(bh * 1.8 + 54));
        }
        if (c.maxx >= ww - 3 && curWx1 < fullWidth && c.minx - cx1 <= bh * 1.6) {
          expandRight = Math.max(expandRight, Math.round(bh * 1.8 + 54));
        }
      }
      const hOverlapCore = Math.min(c.maxx, cx1 + 12) - Math.max(c.minx, cx0 - 12);
      if (c.w <= bw * 1.4 && c.h <= bh * 1.5 && hOverlapCore >= Math.min(c.w, bw) * 0.45) {
        if (c.miny <= 2 && curWy0 > 0 && cy0 - c.maxy <= bh * 0.9) {
          expandTop = Math.max(expandTop, Math.round(bh * 1.1 + 36));
        }
        if (c.maxy >= wh - 3 && curWy1 < fullHeight && c.miny - cy1 <= bh * 0.9) {
          expandBottom = Math.max(expandBottom, Math.round(bh * 1.1 + 36));
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
      expandLeft,
      expandRight,
      expandTop,
      expandBottom,
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
  } = winResult;

  if (accepted.size === 0) {
    return null;
  }

  const bgLumInit = 0.299 * bgR + 0.587 * bgG + 0.114 * bgB;
  const displayText = formatScanlationText(block.text, targetLang);
  const origLineCount = block.lines?.length ?? 1;
  const isSingleLineStat =
    origLineCount === 1 &&
    /^[A-Za-zÇĞİÖŞÜçğıöşü0-9\s/()+-]{2,28}:\s*\S/.test(displayText);

  // Yapısal balon sınırlarını ve metin kutusunu dıştan kuşatan çerçeveleri koruma maskesine al
  const borderIds = new Set<number>(
    comps
      .filter((c) => {
        if (accepted.has(c.id)) return false;
        if (c.touchesBorder || c.w >= ww * 0.92 || c.h >= wh * 0.88) return true;
        const coreRatio = c.corePixels / Math.max(1, c.area);
        if (
          coreRatio < 0.08 &&
          c.minx < cx0 - 6 &&
          c.maxx > cx1 + 6 &&
          c.miny < cy0 - 6 &&
          c.maxy > cy1 + 6
        ) {
          return true;
        }
        return false;
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

  // Tek satırlık RPG istatistik satırlarında ("DEFENSE: 1", "ATTACK : 2 (BONE SWORD +3)")
  // sol veya sağdaki harfler bileşen büyümesinde eksik kalsa bile OCR satır kutusu (cx0..cx1, cy0..cy1)
  // içindeki tüm parlak harf piksellerini silme maskesine dahil et ve sol hizayı cx0'a sabitle!
  if (isSingleLineStat && bgLumInit < 175) {
    gMinX = Math.min(gMinX, cx0);
    gMaxX = Math.max(gMaxX, cx1);
    gMinY = Math.min(gMinY, cy0);
    gMaxY = Math.max(gMaxY, cy1);
    const sx0 = Math.max(1, gMinX - 3);
    const sx1 = Math.min(ww - 2, gMaxX + 3);
    const sy0 = Math.max(1, gMinY - 2);
    const sy1 = Math.min(wh - 2, gMaxY + 2);
    for (let y = sy0; y <= sy1; y += 1) {
      const rOff = y * ww;
      for (let x = sx0; x <= sx1; x += 1) {
        const idx = rOff + x;
        if (borderMask[idx] || rawGlyphMask[idx]) continue;
        const cIdx = idx * 3;
        const pr = winRgb[cIdx];
        const pg = winRgb[cIdx + 1];
        const pb = winRgb[cIdx + 2];
        const pLum = 0.299 * pr + 0.587 * pg + 0.114 * pb;
        if (pLum > bgLumInit + 22 && Math.max(pr - bgR, pg - bgG, pb - bgB) > 24) {
          rawGlyphMask[idx] = 1;
        }
      }
    }
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
  const bandHalfY = Math.max(14, Math.round(Math.max(gMaxY - gMinY, medGlyphH * 2.2) * 0.55));
  const bandY0 = clamp(midLocalYInit - bandHalfY, 0, wh - 1);
  const bandY1 = clamp(midLocalYInit + bandHalfY, 0, wh - 1);

  const isStructuralWallAt = (lx: number, ly: number): boolean => borderMask[ly * ww + lx] === 1;

  const wallPadX = Math.max(18, Math.round(medGlyphH * 0.75));
  const wallPadY = Math.max(12, Math.round(medGlyphH * 0.48));

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
    if (hit) {
      safeLocalRight = x - wallPadX;
      hitRightWall = true;
      break;
    }
  }

  const bandHalfX = Math.max(10, Math.round((gMaxX - gMinX) * 0.38));
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

  // Kapalı açık renkli konuşma balonunun (ör. dikenli yuvarlak balon "SO / WEAK?!") iç boşluğunda kalan
  // fakat OCR kutusunun biraz dışında/üstünde kaldığı için `accepted` kümesine girmemiş olan tüm iç harf parçalarını
  // ("SO" veya kesilmiş harf üstleri) otomatik olarak yakala ve silme maskesine dahil et!
  if (bgLumInit >= 195 && (hitLeftWall || hitRightWall)) {
    const cavLeft = Math.max(2, safeLocalLeft - wallPadX + 4);
    const cavRight = Math.min(ww - 3, safeLocalRight + wallPadX - 4);
    const cavTop = Math.max(2, hitTopWall ? safeLocalTop - wallPadY + 4 : Math.max(2, gMinY - Math.round(medGlyphH * 2.4)));
    const cavBottom = Math.min(wh - 3, hitBottomWall ? safeLocalBottom + wallPadY - 4 : Math.min(wh - 3, gMaxY + Math.round(medGlyphH * 1.6)));
    let cavityAdded = false;
    for (const c of comps) {
      if (accepted.has(c.id) || borderIds.has(c.id)) continue;
      if (c.area < 5 || c.touchesBorder) continue;
      if (
        c.minx >= cavLeft &&
        c.maxx <= cavRight &&
        c.miny >= cavTop &&
        c.maxy <= cavBottom &&
        c.h <= Math.max(medGlyphH * 2.8, bh * 1.6) &&
        c.w <= Math.max((cavRight - cavLeft) * 0.9, bw * 1.35)
      ) {
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

  // Beyaz Dış Kontur Yutma (White Halo Absorption):
  // Koyu renkli harflerin etrafında kalın beyaz dış kontur varsa ("weak spot!", "KIM JEONGHYUK"),
  // dilasyon sadece harf gövdesinden başlarsa 3-5px'lik beyaz kontur silinmeyip arka planda beyaz leke bırakır.
  // Bu yüzden harflere komşu olan parlak dış kontur piksellerini doğrudan maskeye dahil et!
  let preDilateMask = combinedMask;
  if (bgLumInit < 205) {
    for (let step = 0; step < 4; step += 1) {
      let haloAdded = 0;
      const nextMask = new Uint8Array(preDilateMask);
      for (let y = Math.max(1, gMinY - 6); y <= Math.min(wh - 2, gMaxY + 6); y += 1) {
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
            const pr = winRgb[cIdx];
            const pg = winRgb[cIdx + 1];
            const pb = winRgb[cIdx + 2];
            const pLum = 0.299 * pr + 0.587 * pg + 0.114 * pb;
            if (pLum >= 200 && pLum > bgLumInit + 28) {
              nextMask[idx] = 1;
              haloAdded += 1;
            }
          }
        }
      }
      preDilateMask = nextMask;
      if (haloAdded === 0) break;
    }
  }

  // Harf yüksekliğine ve kapalı kontur varlığına göre uyarlanır morfolojik genişletme (Adaptive Dilation)
  const dilateSteps = clamp(
    Math.round(medGlyphH * 0.11) + (enclosedCount > 20 ? 3 : 2),
    4,
    8,
  );
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
        const dBg = Math.max(Math.abs(pr - bgR), Math.abs(pg - bgG), Math.abs(pb - bgB));
        if (dBg <= 60) {
          ringRs.push(pr);
          ringGs.push(pg);
          ringBs.push(pb);
        }
      }
    }
  }

  const ringMedR = ringRs.length > 10 ? Math.round(medianOf(ringRs)) : bgR;
  const ringMedG = ringGs.length > 10 ? Math.round(medianOf(ringGs)) : bgG;
  const ringMedB = ringBs.length > 10 ? Math.round(medianOf(ringBs)) : bgB;
  const ringMedLum = 0.299 * ringMedR + 0.587 * ringMedG + 0.114 * ringMedB;

  let ringStd = 0;
  if (ringRs.length > 10) {
    let varSum = 0;
    for (let i = 0; i < ringRs.length; i += 1) {
      const dr = ringRs[i] - ringMedR;
      const dg = ringGs[i] - ringMedG;
      const db = ringBs[i] - ringMedB;
      varSum += (dr * dr + dg * dg + db * db) / 3;
    }
    ringStd = Math.sqrt(varSum / ringRs.length);
  }

  const wallHits =
    (hitLeftWall ? 1 : 0) +
    (hitRightWall ? 1 : 0) +
    (hitTopWall ? 1 : 0) +
    (hitBottomWall ? 1 : 0);
  const hasClosedBubbleWalls = wallHits >= 2 || ringStd < 8 || (bgLumInit >= 195 && ringStd < 14);

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
    origLineCount,
  });

  // 3 Kademeli Uyarlanır Inpainting:
  // Kademe 1 (düz renkli konuşma balonu): %100 lekesiz medyan dolgu
  // Kademe 2 (dokulu sahne / SFX / RPG kutusu): Sınır korumalı İzofot Telea Fast Marching + Harmonik Difüzyon
  const cleaned = new Float32Array(winRgb);
  const isFlatLightBubble =
    ringStd < 6.5 || (bgLumInit >= 200 && ringMedLum >= 210 && hasClosedBubbleWalls);

  if (isFlatLightBubble) {
    // Düz konuşma balonlarında harf kutusunun içinde unutulmuş hiçbir leke/mürekkep kalmaması için
    // [gMinX..gMaxX, gMinY..gMaxY] içindeki zemin dışı tüm pikselleri de temizle
    for (let y = Math.max(0, gMinY - 3); y <= Math.min(wh - 1, gMaxY + 3); y += 1) {
      const rOff = y * ww;
      for (let x = Math.max(0, gMinX - 3); x <= Math.min(ww - 1, gMaxX + 3); x += 1) {
        const idx = rOff + x;
        if (borderMask[idx] || eraseMask[idx]) continue;
        const cIdx = idx * 3;
        const d = Math.max(
          Math.abs(winRgb[cIdx] - ringMedR),
          Math.abs(winRgb[cIdx + 1] - ringMedG),
          Math.abs(winRgb[cIdx + 2] - ringMedB),
        );
        if (d > 14) {
          eraseMask[idx] = 1;
          eraseCount += 1;
          if (x < egMinX) egMinX = x;
          if (x > egMaxX) egMaxX = x;
          if (y < egMinY) egMinY = y;
          if (y > egMaxY) egMaxY = y;
        }
      }
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
    const residualThresh = Math.max(36, ringStd * 2.2);
    let residualFound = 0;
    const resMask = new Uint8Array(numPixels);
    for (let y = Math.max(3, gMinY - 2); y <= Math.min(wh - 4, gMaxY + 2); y += 1) {
      const rOff = y * ww;
      for (let x = Math.max(3, gMinX - 2); x <= Math.min(ww - 4, gMaxX + 2); x += 1) {
        const idx = rOff + x;
        if (eraseMask[idx] || borderMask[idx]) continue;
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
        if (dev > residualThresh) {
          resMask[idx] = 1;
          residualFound += 1;
        }
      }
    }

    if (residualFound > 4 && residualFound < numPixels * 0.25) {
      const dilatedRes = dilate3x3(dilate3x3(resMask, ww, wh), ww, wh);
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

  // Yalnızca silinen metin bölgesini saran sıkı dikdörtgeni (+2px dikiş payı) WebP yama olarak üret
  const localPx0 = Math.max(0, egMinX - 2);
  const localPy0 = Math.max(0, egMinY - 2);
  const localPx1 = Math.min(ww, egMaxX + 3);
  const localPy1 = Math.min(wh, egMaxY + 3);
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
  const layoutCenterX =
    hitLeftWall &&
    hitRightWall &&
    safeLocalRight > safeLocalLeft + 24 &&
    Math.abs(midLocalX - (safeLocalLeft + safeLocalRight) * 0.5) <=
      (safeLocalRight - safeLocalLeft) * 0.18
      ? Math.round((safeLocalLeft + safeLocalRight) * 0.5)
      : midLocalX;
  const layoutCenterY =
    hitTopWall && hitBottomWall && safeLocalBottom > safeLocalTop + 20
      ? Math.round((safeLocalTop + safeLocalBottom) * 0.5)
      : midLocalY;

  const maxHalfW = Math.max(
    glyphW * 0.5,
    Math.min(layoutCenterX - safeLocalLeft, safeLocalRight - layoutCenterX),
  );
  const maxHalfH = Math.max(
    glyphH * 0.55,
    Math.min(layoutCenterY - safeLocalTop, safeLocalBottom - layoutCenterY),
  );
  let safeW = Math.max(glyphW, maxHalfW * 2);
  if (!(hitLeftWall && hitRightWall)) {
    safeW = Math.min(safeW, Math.max(glyphW * 1.24, medGlyphH * 8));
  }
  const safeH = Math.max(glyphH * 1.1, maxHalfH * 2);

  // Hedef metin uzunluğuna, bölge türüne (SFX vs Diyalog) ve orijinal harf boyutuna göre akıllı dizgi
  const measureCtx = getSharedMeasureContext();

  let fontPx: number;
  let finalBoxW: number;
  let finalBoxH: number;
  let emphasisLastLineScale = block.emphasisLastLineScale;

  if (isSingleLineStat) {
    // Tek satırlık RPG istatistik satırı ("SAĞLIK: 100", "BÜYÜ: 0", "SALDIRI: 2 (KEMİK KILIÇ +3)", "AD: JIANG CHENG" vb.)
    // Kesinlikle 2 satıra sarılmaz! Tek satırda kalacak şekilde font boyutu hesaplanır ve orijinal sol sınıra (cx0) kilitlenir.
    const statLeftLocalX = Math.min(gMinX, cx0);
    const maxStatW = Math.max(
      bw * 1.08,
      Math.min(
        fullWidth - (wx0 + statLeftLocalX) - 8,
        (hitRightWall ? safeLocalRight + Math.round(wallPadX * 0.5) : ww - 4) - statLeftLocalX,
      ),
    );
    const minStatFontPx = Math.max(11, fullWidth * 0.015);
    fontPx = clamp(medGlyphH * 0.96, minStatFontPx, fullWidth * 0.031);
    finalBoxW = Math.max(bw, glyphW);
    finalBoxH = Math.max(bh, Math.ceil(fontPx * 1.14));
    for (let step = 0; step < 14; step += 1) {
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
      fontPx = Math.max(minStatFontPx, fontPx * 0.93);
    }
  } else if (style.kind === 'sfx') {
    // SFX / Stilize Büyük Yazılar ("NO" -> "HAYIR.", "FIRST MURDER." -> "İLK CİNAYET."):
    // Orijinal yazının kapladığı alanı ve yüksekliği dolduracak şekilde dinamik ölçekle!
    emphasisLastLineScale = undefined; // SFX zaten tek bir vurgu bloğudur
    const maxSfxFontPx = Math.min(fullWidth * 0.135, Math.max(glyphH * 1.18, medGlyphH * 1.25));
    const minSfxFontPx = Math.max(14, fullWidth * 0.022);
    fontPx = clamp(medGlyphH * 1.05, minSfxFontPx, maxSfxFontPx);

    // Tek satırlık orijinal SFX'te ("NO.", "FIRST MURDER.") çeviriyi de mümkün olduğunca 1-2 satırda geniş tut
    finalBoxW =
      origLineCount === 1
        ? Math.max(glyphW * 1.38, safeW, fontPx * displayText.length * 0.58)
        : Math.max(glyphW * 1.25, safeW);
    finalBoxW = Math.min(finalBoxW, fullWidth * 0.92);
    finalBoxH = Math.max(glyphH * 1.25, safeH);

    for (let step = 0; step < 14; step += 1) {
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
      fontPx = Math.max(minSfxFontPx, fontPx * 0.91);
    }
  } else {
    // Konuşma Balonu & Anlatım Kutusu:
    const effectiveGlyphH =
      style.hasTextStroke && (style.strokeWidthEm ?? 0) > 0.1
        ? Math.max(12, medGlyphH - 4)
        : medGlyphH;
    const maxDialogFontPx = emphasisLastLineScale ? fullWidth * 0.035 : fullWidth * 0.036;
    fontPx = clamp(effectiveGlyphH * 1.0, fullWidth * 0.019, maxDialogFontPx);
    const minFontPx = Math.max(11, fullWidth * 0.015);

    const charLen = displayText.length;
    const desiredCharsPerLine =
      charLen <= 10
        ? charLen + 2
        : clamp(Math.ceil(Math.sqrt(charLen * 1.7)) * 2, 11, 16);
    const singleCharW =
      measureStyledWordWidth(measureCtx, 'A', fontPx, style.fontFamily, style.fontWeight) ||
      fontPx * 0.61;
    const desiredW = desiredCharsPerLine * singleCharW + 18;
    const usableSafeW =
      hitLeftWall && hitRightWall
        ? Math.max(Math.min(glyphW, safeW * 0.85), safeW * 0.86)
        : safeW;

    finalBoxW = clamp(
      Math.max(glyphW * 0.92, desiredW),
      Math.min(glyphW * 0.85, usableSafeW),
      usableSafeW,
    );
    finalBoxH = Math.max(glyphH * 1.25, safeH);

    for (let step = 0; step < 14; step += 1) {
      const wrapped = computeSmartWrappedLines(
        measureCtx,
        displayText,
        finalBoxW * 0.9,
        fontPx,
        {
          fontFamily: style.fontFamily,
          fontWeight: style.fontWeight,
          emphasisLastLineScale,
        },
      );

      if (
        wrapped.totalHeightPx <= finalBoxH * 0.94 &&
        wrapped.maxWordWidth <= finalBoxW * 0.92
      ) {
        finalBoxH = Math.max(glyphH, wrapped.totalHeightPx + fontPx * 0.45);
        break;
      }

      if (finalBoxW < usableSafeW) {
        finalBoxW = usableSafeW;
        continue;
      }
      if (fontPx <= minFontPx) break;
      fontPx = Math.max(minFontPx, fontPx * 0.92);
    }
  }

  let refinedX0: number;
  let refinedX1: number;
  let refinedY0: number;
  let refinedY1: number;
  if (isSingleLineStat) {
    const statLeftLocalX = Math.min(gMinX, cx0);
    const statCenterLocalY = Math.round((cy0 + cy1) * 0.5);
    refinedX0 = clamp(wx0 + statLeftLocalX, 0, fullWidth - finalBoxW);
    refinedX1 = clamp(refinedX0 + finalBoxW, refinedX0 + 4, fullWidth);
    const absStatCenterY = wy0 + statCenterLocalY;
    refinedY0 = clamp(absStatCenterY - finalBoxH * 0.5, 0, fullHeight - 4);
    refinedY1 = clamp(absStatCenterY + finalBoxH * 0.5, refinedY0 + 4, fullHeight);
  } else {
    const absCenterX = wx0 + layoutCenterX;
    refinedX0 = clamp(absCenterX - finalBoxW * 0.5, 0, fullWidth - 4);
    refinedX1 = clamp(absCenterX + finalBoxW * 0.5, refinedX0 + 4, fullWidth);
    const absCenterY = wy0 + layoutCenterY;
    refinedY0 = clamp(absCenterY - finalBoxH * 0.5, 0, fullHeight - 4);
    refinedY1 = clamp(absCenterY + finalBoxH * 0.5, refinedY0 + 4, fullHeight);
  }

  const refinedBox: [number, number, number, number] = [
    toNorm(refinedY0, fullHeight),
    toNorm(refinedX0, fullWidth),
    toNorm(refinedY1, fullHeight),
    toNorm(refinedX1, fullWidth),
  ];

  const maxCqw = style.kind === 'sfx' ? 13.5 : 4.5;
  const fontSizeCqw = Number(clamp((fontPx / fullWidth) * 100, 1.5, maxCqw).toFixed(3));

  return {
    v: TRANSLATION_BLOCK_VERSION,
    box: refinedBox,
    patchBox,
    patchDataUrl,
    text: block.text,
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
    emphasisLastLineScale,
    fontSizeCqw,
  };
};

export { getFontFamilyCss };
