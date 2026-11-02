import { TranslationBlock } from './types';

export const TRANSLATION_BLOCK_VERSION = 2;
export const SCANLATION_FONT_FAMILY = '"Shantell Sans", system-ui, -apple-system, sans-serif';

interface ComponentInfo {
  id: number;
  minx: number;
  maxx: number;
  miny: number;
  maxy: number;
  w: number;
  h: number;
  area: number;
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

let measureCanvas: HTMLCanvasElement | null = null;
let fontLoadPromise: Promise<void> | null = null;

export const ensureScanlationFontReady = async (): Promise<void> => {
  if (typeof document === 'undefined' || !document.fonts?.load) return;
  if (!fontLoadPromise) {
    fontLoadPromise = Promise.race([
      document.fonts.load('700 24px "Shantell Sans"').then(() => undefined),
      new Promise<void>((resolve) => setTimeout(resolve, 450)),
    ]).catch(() => undefined);
  }
  await fontLoadPromise;
};

const getMeasureContext = (): CanvasRenderingContext2D | null => {
  if (typeof document === 'undefined') return null;
  if (!measureCanvas) {
    measureCanvas = document.createElement('canvas');
    measureCanvas.width = 64;
    measureCanvas.height = 64;
  }
  return measureCanvas.getContext('2d');
};

const measureWordWidth = (
  ctx: CanvasRenderingContext2D | null,
  word: string,
  fontPx: number,
): number => {
  if (ctx) {
    ctx.font = `700 ${fontPx}px ${SCANLATION_FONT_FAMILY}`;
    const w = ctx.measureText(word).width;
    if (w > 0) return w;
  }
  return word.length * fontPx * 0.61;
};

const simulateWrappedLines = (
  ctx: CanvasRenderingContext2D | null,
  text: string,
  maxWidthPx: number,
  fontPx: number,
): { lines: string[]; maxWordWidth: number } => {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return { lines: [], maxWordWidth: 0 };

  const spaceW = measureWordWidth(ctx, ' ', fontPx) || fontPx * 0.3;
  const lines: string[] = [];
  let currentLine = '';
  let currentWidth = 0;
  let maxWordWidth = 0;

  for (const word of words) {
    const wordW = measureWordWidth(ctx, word, fontPx);
    if (wordW > maxWordWidth) maxWordWidth = wordW;

    if (!currentLine) {
      currentLine = word;
      currentWidth = wordW;
    } else if (currentWidth + spaceW + wordW <= maxWidthPx) {
      currentLine += ` ${word}`;
      currentWidth += spaceW + wordW;
    } else {
      lines.push(currentLine);
      currentLine = word;
      currentWidth = wordW;
    }
  }
  if (currentLine) lines.push(currentLine);

  return { lines, maxWordWidth };
};

// 5-bit RGB histogram modundan balonun baskın arka plan rengini (medyan ile) bulur.
// Aritmetik ortalama ASLA kullanılmaz; siyah harfler beyaz arka planı grileştirmez.
const findDominantBackgroundRgb = (
  winRgb: Int32Array,
  ww: number,
  cx0: number,
  cy0: number,
  cx1: number,
  cy1: number,
): [number, number, number] => {
  const binCounts = new Int32Array(32768);
  let bestBin = 0;
  let bestCount = -1;

  for (let y = cy0; y < cy1; y += 1) {
    let idx = (y * ww + cx0) * 3;
    for (let x = cx0; x < cx1; x += 1, idx += 3) {
      const r = winRgb[idx];
      const g = winRgb[idx + 1];
      const b = winRgb[idx + 2];
      const bin = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
      const next = binCounts[bin] + 1;
      binCounts[bin] = next;
      if (next > bestCount) {
        bestCount = next;
        bestBin = bin;
      }
    }
  }

  if (bestCount <= 0) return [255, 255, 255];

  const rs: number[] = [];
  const gs: number[] = [];
  const bs: number[] = [];
  for (let y = cy0; y < cy1; y += 1) {
    let idx = (y * ww + cx0) * 3;
    for (let x = cx0; x < cx1; x += 1, idx += 3) {
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

// Orijinal konuşma balonundaki harfleri piksel düzeyinde tespit edip arka plan dokusunu/rengini
// koruyarak siler (Inpaint) ve çeviri metni için balonun gerçek güvenli iç dizgi kutusunu hesaplar.
export const inpaintAndRefineBlock = (
  fullCtx: CanvasRenderingContext2D,
  fullWidth: number,
  fullHeight: number,
  block: TranslationBlock,
  targetLang = 'tr',
): TranslationBlock | null => {
  const [ymin, xmin, ymax, xmax] = block.box;
  const boxX0 = clamp(Math.floor((xmin / 1000) * fullWidth), 0, fullWidth - 1);
  const boxX1 = clamp(Math.ceil((xmax / 1000) * fullWidth), boxX0 + 1, fullWidth);
  const boxY0 = clamp(Math.floor((ymin / 1000) * fullHeight), 0, fullHeight - 1);
  const boxY1 = clamp(Math.ceil((ymax / 1000) * fullHeight), boxY0 + 1, fullHeight);

  const bw = boxX1 - boxX0;
  const bh = boxY1 - boxY0;

  // Köşelerden taşabilecek harfleri (?, *, B, L vb.) yakalamak için arama penceresini genişlet
  const wx0 = Math.max(0, Math.floor(boxX0 - Math.max(28, bw * 0.28)));
  const wx1 = Math.min(fullWidth, Math.ceil(boxX1 + Math.max(28, bw * 0.28)));
  const wy0 = Math.max(0, Math.floor(boxY0 - Math.max(24, bh * 0.35)));
  const wy1 = Math.min(fullHeight, Math.ceil(boxY1 + Math.max(24, bh * 0.35)));

  const ww = wx1 - wx0;
  const wh = wy1 - wy0;

  if (ww <= 4 || wh <= 4) {
    return null;
  }

  let imgData: ImageData;
  try {
    imgData = fullCtx.getImageData(wx0, wy0, ww, wh);
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

  const cx0 = clamp(boxX0 - wx0, 0, ww - 1);
  const cx1 = clamp(boxX1 - wx0, cx0 + 1, ww);
  const cy0 = clamp(boxY0 - wy0, 0, wh - 1);
  const cy1 = clamp(boxY1 - wy0, cy0 + 1, wh);

  const [bgR, bgG, bgB] = findDominantBackgroundRgb(winRgb, ww, cx0, cy0, cx1, cy1);
  const bgLumInit = 0.299 * bgR + 0.587 * bgG + 0.114 * bgB;

  // 2D Integral Image (R=20) ile gradyan / yarı saydam balonlarda yerel arka plan ortalaması
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

  const buildForegroundMask = (localThresh: number, globalThresh: number): Uint8Array => {
    const fg = new Uint8Array(numPixels);
    const R = 20;
    const isLightOrMid = bgLumInit >= 115;
    const captureWhiteHalo = isLightOrMid && bgLumInit < 232;

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

        const meanR = (iiR[r1Off + x1s] - iiR[r0Off + x1s] - iiR[r1Off + x0s] + iiR[r0Off + x0s]) * invArea;
        const meanG = (iiG[r1Off + x1s] - iiG[r0Off + x1s] - iiG[r1Off + x0s] + iiG[r0Off + x0s]) * invArea;
        const meanB = (iiB[r1Off + x1s] - iiB[r0Off + x1s] - iiB[r1Off + x0s] + iiB[r0Off + x0s]) * invArea;

        const pIdx = y * ww + x;
        const cIdx = pIdx * 3;
        const pr = winRgb[cIdx];
        const pg = winRgb[cIdx + 1];
        const pb = winRgb[cIdx + 2];

        if (isLightOrMid) {
          const dLocal = Math.max(meanR - pr, meanG - pg, meanB - pb);
          const dGlobal = Math.max(bgR - pr, bgG - pg, bgB - pb);
          if (dLocal > localThresh || dGlobal > globalThresh) {
            fg[pIdx] = 1;
          } else if (captureWhiteHalo) {
            const minCh = Math.min(pr, pg, pb);
            const dBright = Math.max(pr - bgR, pg - bgG, pb - bgB);
            if (minCh > 236 && dBright > 22) {
              fg[pIdx] = 1;
            }
          }
        } else {
          const dLocal = Math.max(pr - meanR, pg - meanG, pb - meanB);
          const dGlobal = Math.max(pr - bgR, pg - bgG, pb - bgB);
          if (dLocal > localThresh || dGlobal > globalThresh) {
            fg[pIdx] = 1;
          }
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
        let touchesBorder = false;
        let overlapsCore = false;

        while (qHead < qTail) {
          const curr = queue[qHead++];
          const cy = Math.floor(curr / ww);
          const cx = curr - cy * ww;
          area += 1;

          if (cx < minx) minx = cx;
          if (cx > maxx) maxx = cx;
          if (cy < miny) miny = cy;
          if (cy > maxy) maxy = cy;
          if (cx <= 1 || cx >= ww - 2 || cy <= 1 || cy >= wh - 2) touchesBorder = true;
          if (cx >= cx0 && cx <= cx1 && cy >= cy0 && cy <= cy1) overlapsCore = true;

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
          touchesBorder,
          overlapsCore,
        });
      }
    }

    return { labels, comps };
  };

  let fg = buildForegroundMask(22, 34);
  let { labels, comps } = extractComponents(fg);

  const maxAllowedCompH = Math.min(Math.max(140, fullWidth * 0.18), wh * 0.76);
  let valid = comps.filter(
    (c) => !c.touchesBorder && c.w < ww * 0.85 && c.h < maxAllowedCompH,
  );
  let accepted = new Set<number>(valid.filter((c) => c.overlapsCore).map((c) => c.id));

  // Çok soluk metinler için ikinci hassas geçiş
  if (accepted.size === 0) {
    fg = buildForegroundMask(12, 20);
    ({ labels, comps } = extractComponents(fg));
    valid = comps.filter(
      (c) => !c.touchesBorder && c.w < ww * 0.85 && c.h < maxAllowedCompH,
    );
    accepted = new Set<number>(valid.filter((c) => c.overlapsCore).map((c) => c.id));
  }

  // Harf bileşeni bulunamadıysa karmaşık çizim/logo olup olmadığını kontrol et; öyleyse atla
  if (accepted.size === 0) {
    return null;
  }

  // Gemini kutusunun kenarında kesilmiş harfleri (?, *, B, L vb.) komşu balonlara atlamadan büyüt
  let changed = true;
  while (changed) {
    changed = false;
    const accComps = valid.filter((c) => accepted.has(c.id));
    if (accComps.length === 0) break;

    const heights = accComps.filter((c) => c.h >= 7).map((c) => c.h);
    const medH = heights.length > 0 ? medianOf(heights) : 20;
    const padX = Math.max(16, medH * 1.45);
    const padY = Math.max(10, medH * 0.85);

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
    uMinX -= padX;
    uMaxX += padX;
    uMinY -= padY;
    uMaxY += padY;

    for (const c of valid) {
      if (accepted.has(c.id)) continue;
      if (c.h > medH * 2.8 || c.w > medH * 4.5) continue;
      if (c.maxx >= uMinX && c.minx <= uMaxX && c.maxy >= uMinY && c.miny <= uMaxY) {
        accepted.add(c.id);
        changed = true;
      }
    }
  }

  // Yapısal balon sınırlarını ve komşu balon yazılarını koruma maskesine al
  const borderIds = new Set<number>(
    comps
      .filter((c) => c.touchesBorder || c.w >= ww * 0.85 || c.h >= wh * 0.72)
      .map((c) => c.id),
  );
  const borderMask = new Uint8Array(numPixels);
  let mask = new Uint8Array(numPixels);

  for (let i = 0; i < numPixels; i += 1) {
    const lbl = labels[i];
    if (lbl !== 0) {
      if (accepted.has(lbl)) mask[i] = 1;
      else if (borderIds.has(lbl)) borderMask[i] = 1;
    }
  }

  // JPEG/WebP anti-aliasing saçaklarını yutmak için 4px genişlet (dilate)
  const dilate3x3 = (src: Uint8Array): Uint8Array => {
    const dst = new Uint8Array(numPixels);
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

  for (let d = 0; d < 4; d += 1) {
    mask = dilate3x3(mask);
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

  // Silme maskesinin hemen dışındaki 2px temiz halkayı örnekleyerek doku standart sapmasını ölç
  const ringRs: number[] = [];
  const ringGs: number[] = [];
  const ringBs: number[] = [];
  for (let y = Math.max(2, egMinY - 2); y <= Math.min(wh - 3, egMaxY + 2); y += 1) {
    const rOff = y * ww;
    for (let x = Math.max(2, egMinX - 2); x <= Math.min(ww - 3, egMaxX + 2); x += 1) {
      const idx = rOff + x;
      if (eraseMask[idx] || borderMask[idx]) continue;
      if (
        eraseMask[idx - 2] ||
        eraseMask[idx + 2] ||
        eraseMask[idx - 2 * ww] ||
        eraseMask[idx + 2 * ww]
      ) {
        const cIdx = idx * 3;
        ringRs.push(winRgb[cIdx]);
        ringGs.push(winRgb[cIdx + 1]);
        ringBs.push(winRgb[cIdx + 2]);
      }
    }
  }

  const ringMedR = ringRs.length > 10 ? Math.round(medianOf(ringRs)) : bgR;
  const ringMedG = ringGs.length > 10 ? Math.round(medianOf(ringGs)) : bgG;
  const ringMedB = ringBs.length > 10 ? Math.round(medianOf(ringBs)) : bgB;

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

  const bgLum = 0.299 * ringMedR + 0.587 * ringMedG + 0.114 * ringMedB;

  // Yarı saydam balonlarda siyah yazının etrafında beyaz kontur (halo) olup olmadığını algıla
  let hasWhiteHalo = false;
  if (eraseCount > 20 && bgLum > 80 && bgLum < 235) {
    let brightPixels = 0;
    let darkPixels = 0;
    for (let i = 0; i < numPixels; i += 1) {
      if (!eraseMask[i]) continue;
      const cIdx = i * 3;
      const r = winRgb[cIdx];
      const g = winRgb[cIdx + 1];
      const b = winRgb[cIdx + 2];
      if (Math.min(r, g, b) > 238) brightPixels += 1;
      if (Math.max(r, g, b) < 60) darkPixels += 1;
    }
    if (brightPixels / eraseCount > 0.1 && darkPixels / eraseCount > 0.08) {
      hasWhiteHalo = true;
    }
  }

  const cleaned = new Float32Array(winRgb);

  if (ringStd < 4.5) {
    // Düz renkli balon (beyaz/siyah/krem): %100 pürüzsüz tek renk inpaint
    for (let i = 0; i < numPixels; i += 1) {
      if (!eraseMask[i]) continue;
      const cIdx = i * 3;
      cleaned[cIdx] = ringMedR;
      cleaned[cIdx + 1] = ringMedG;
      cleaned[cIdx + 2] = ringMedB;
    }
  } else {
    // Yarı saydam veya gradyanlı balon: 2B ters-açıklık enterpolasyonu + Harmonik Laplace difüzyonu
    const hInterp = new Float32Array(cleaned);
    const hSpan = new Float32Array(numPixels);
    hSpan.fill(9999);

    for (let y = egMinY; y <= egMaxY; y += 1) {
      const rOff = y * ww;
      let x = egMinX;
      while (x <= egMaxX) {
        if (eraseMask[rOff + x]) {
          const xs0 = x;
          while (x < ww && eraseMask[rOff + x]) x += 1;
          const xs1 = x;

          const useLeft = xs0 > 0 && !borderMask[rOff + xs0 - 1];
          const lIdx = (rOff + xs0 - 1) * 3;
          const lr = useLeft ? cleaned[lIdx] : ringMedR;
          const lg = useLeft ? cleaned[lIdx + 1] : ringMedG;
          const lb = useLeft ? cleaned[lIdx + 2] : ringMedB;

          const useRight = xs1 < ww && !borderMask[rOff + xs1];
          const rIdx = (rOff + xs1) * 3;
          const rr = useRight ? cleaned[rIdx] : ringMedR;
          const rg = useRight ? cleaned[rIdx + 1] : ringMedG;
          const rb = useRight ? cleaned[rIdx + 2] : ringMedB;

          const sp = Math.max(1, xs1 - xs0);
          for (let i = 0; i < sp; i += 1) {
            const t = (i + 0.5) / sp;
            const pIdx = rOff + xs0 + i;
            const cIdx = pIdx * 3;
            hInterp[cIdx] = (1 - t) * lr + t * rr;
            hInterp[cIdx + 1] = (1 - t) * lg + t * rg;
            hInterp[cIdx + 2] = (1 - t) * lb + t * rb;
            hSpan[pIdx] = sp;
          }
        } else {
          x += 1;
        }
      }
    }

    const vInterp = new Float32Array(cleaned);
    const vSpan = new Float32Array(numPixels);
    vSpan.fill(9999);

    for (let x = egMinX; x <= egMaxX; x += 1) {
      let y = egMinY;
      while (y <= egMaxY) {
        if (eraseMask[y * ww + x]) {
          const ys0 = y;
          while (y < wh && eraseMask[y * ww + x]) y += 1;
          const ys1 = y;

          const topIdx = (ys0 - 1) * ww + x;
          const useTop = ys0 > 0 && !borderMask[topIdx];
          const t3 = topIdx * 3;
          const tr = useTop ? cleaned[t3] : ringMedR;
          const tg = useTop ? cleaned[t3 + 1] : ringMedG;
          const tb = useTop ? cleaned[t3 + 2] : ringMedB;

          const botIdx = ys1 * ww + x;
          const useBot = ys1 < wh && !borderMask[botIdx];
          const b3 = botIdx * 3;
          const br = useBot ? cleaned[b3] : ringMedR;
          const bg = useBot ? cleaned[b3 + 1] : ringMedG;
          const bb = useBot ? cleaned[b3 + 2] : ringMedB;

          const sp = Math.max(1, ys1 - ys0);
          for (let i = 0; i < sp; i += 1) {
            const t = (i + 0.5) / sp;
            const pIdx = (ys0 + i) * ww + x;
            const cIdx = pIdx * 3;
            vInterp[cIdx] = (1 - t) * tr + t * br;
            vInterp[cIdx + 1] = (1 - t) * tg + t * bg;
            vInterp[cIdx + 2] = (1 - t) * tb + t * bb;
            vSpan[pIdx] = sp;
          }
        } else {
          y += 1;
        }
      }
    }

    const eraseIndices = new Int32Array(eraseCount);
    let ePtr = 0;
    for (let i = 0; i < numPixels; i += 1) {
      if (!eraseMask[i]) continue;
      eraseIndices[ePtr++] = i;
      const whW = vSpan[i] / (hSpan[i] + vSpan[i]);
      const wvW = 1 - whW;
      const cIdx = i * 3;
      cleaned[cIdx] = whW * hInterp[cIdx] + wvW * vInterp[cIdx];
      cleaned[cIdx + 1] = whW * hInterp[cIdx + 1] + wvW * vInterp[cIdx + 1];
      cleaned[cIdx + 2] = whW * hInterp[cIdx + 2] + wvW * vInterp[cIdx + 2];
    }

    // 12 iterasyon Harmonik Laplace yumuşatması
    for (let iter = 0; iter < 12; iter += 1) {
      for (let k = 0; k < ePtr; k += 1) {
        const idx = eraseIndices[k];
        const y = Math.floor(idx / ww);
        const x = idx - y * ww;
        if (x <= 0 || x >= ww - 1 || y <= 0 || y >= wh - 1) continue;
        const c = idx * 3;
        const n = (idx - ww) * 3;
        const s = (idx + ww) * 3;
        const w = (idx - 1) * 3;
        const e = (idx + 1) * 3;
        cleaned[c] = 0.25 * (cleaned[n] + cleaned[s] + cleaned[w] + cleaned[e]);
        cleaned[c + 1] = 0.25 * (cleaned[n + 1] + cleaned[s + 1] + cleaned[w + 1] + cleaned[e + 1]);
        cleaned[c + 2] = 0.25 * (cleaned[n + 2] + cleaned[s + 2] + cleaned[w + 2] + cleaned[e + 2]);
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
    patchDataUrl = patchCanvas.toDataURL('image/webp', 0.9);
  }

  const patchBox: [number, number, number, number] = [
    toNorm(absPatchY0, fullHeight),
    toNorm(absPatchX0, fullWidth),
    toNorm(absPatchY1, fullHeight),
    toNorm(absPatchX1, fullWidth),
  ];

  // Orijinal harf kümesinin merkezi ve medyan harf yüksekliği
  const accComps = valid.filter((c) => accepted.has(c.id));
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
  const medGlyphH = glyphHeights.length > 0 ? medianOf(glyphHeights) : Math.max(16, fullWidth * 0.025);

  // Balonun gerçek iç boşluğunu (safeLeft..safeRight, safeTop..safeBottom) engel/çizgiye kadar ölç
  const midLocalY = Math.round((gMinY + gMaxY) * 0.5);
  const midLocalX = Math.round((gMinX + gMaxX) * 0.5);
  const bandHalfY = Math.max(6, Math.round((gMaxY - gMinY) * 0.35));
  const bandY0 = clamp(midLocalY - bandHalfY, 0, wh - 1);
  const bandY1 = clamp(midLocalY + bandHalfY, 0, wh - 1);

  const isObstacleAt = (lx: number, ly: number): boolean => {
    const idx = ly * ww + lx;
    if (borderMask[idx]) return true;
    const lbl = labels[idx];
    return lbl !== 0 && !accepted.has(lbl);
  };

  let safeLocalLeft = 0;
  for (let x = gMinX; x >= 0; x -= 1) {
    let hit = false;
    for (let y = bandY0; y <= bandY1; y += 2) {
      if (isObstacleAt(x, y)) {
        hit = true;
        break;
      }
    }
    if (hit) {
      safeLocalLeft = x + 12;
      break;
    }
  }

  let safeLocalRight = ww;
  for (let x = gMaxX; x < ww; x += 1) {
    let hit = false;
    for (let y = bandY0; y <= bandY1; y += 2) {
      if (isObstacleAt(x, y)) {
        hit = true;
        break;
      }
    }
    if (hit) {
      safeLocalRight = x - 12;
      break;
    }
  }

  const bandHalfX = Math.max(8, Math.round((gMaxX - gMinX) * 0.35));
  const bandX0 = clamp(midLocalX - bandHalfX, 0, ww - 1);
  const bandX1 = clamp(midLocalX + bandHalfX, 0, ww - 1);

  let safeLocalTop = 0;
  for (let y = gMinY; y >= 0; y -= 1) {
    let hit = false;
    for (let x = bandX0; x <= bandX1; x += 3) {
      if (isObstacleAt(x, y)) {
        hit = true;
        break;
      }
    }
    if (hit) {
      safeLocalTop = y + 10;
      break;
    }
  }

  let safeLocalBottom = wh;
  for (let y = gMaxY; y < wh; y += 1) {
    let hit = false;
    for (let x = bandX0; x <= bandX1; x += 3) {
      if (isObstacleAt(x, y)) {
        hit = true;
        break;
      }
    }
    if (hit) {
      safeLocalBottom = y - 10;
      break;
    }
  }

  // Simetrik merkezli güvenli genişlik ve yükseklik
  const glyphW = Math.max(24, gMaxX - gMinX + 1);
  const glyphH = Math.max(18, gMaxY - gMinY + 1);
  const maxHalfW = Math.max(glyphW * 0.5, Math.min(midLocalX - safeLocalLeft, safeLocalRight - midLocalX));
  const maxHalfH = Math.max(glyphH * 0.55, Math.min(midLocalY - safeLocalTop, safeLocalBottom - midLocalY));
  const safeW = Math.max(glyphW, maxHalfW * 2);
  const safeH = Math.max(glyphH * 1.1, maxHalfH * 2);

  // Hedef metin uzunluğuna ve orijinal harf boyutuna göre ideal font ve kutu boyutu
  const displayText = formatScanlationText(block.text, targetLang);
  const measureCtx = getMeasureContext();
  const effectiveGlyphH = hasWhiteHalo ? Math.max(12, medGlyphH - 5) : medGlyphH;
  let fontPx = clamp(effectiveGlyphH * 1.06, fullWidth * 0.02, fullWidth * 0.033);
  const minFontPx = Math.max(11, fullWidth * 0.015);

  const charLen = displayText.length;
  const desiredCharsPerLine = charLen <= 12
    ? charLen + 2
    : clamp(Math.ceil(Math.sqrt(charLen * 2.6)) * 2, 13, 21);
  const desiredW = desiredCharsPerLine * fontPx * 0.61 + 20;

  let finalBoxW = clamp(Math.max(glyphW * 1.1, desiredW), Math.min(glyphW, safeW), safeW);
  let finalBoxH = Math.max(glyphH * 1.15, safeH);

  // Metin kutuya tam sığana kadar önce güvenli genişliği kullan, gerekirse fontu kademeli küçült
  for (let step = 0; step < 12; step += 1) {
    const { lines, maxWordWidth } = simulateWrappedLines(measureCtx, displayText, finalBoxW * 0.94, fontPx);
    const totalTextH = lines.length * fontPx * 1.22;

    if (totalTextH <= finalBoxH * 0.96 && maxWordWidth <= finalBoxW * 0.96) {
      finalBoxH = Math.max(glyphH, totalTextH + fontPx * 0.5);
      break;
    }

    if (finalBoxW < safeW) {
      finalBoxW = safeW;
      continue;
    }
    if (fontPx <= minFontPx) break;
    fontPx = Math.max(minFontPx, fontPx * 0.92);
  }

  const absCenterX = wx0 + midLocalX;
  const absCenterY = wy0 + midLocalY;
  const refinedX0 = clamp(absCenterX - finalBoxW * 0.5, 0, fullWidth - 4);
  const refinedX1 = clamp(absCenterX + finalBoxW * 0.5, refinedX0 + 4, fullWidth);
  const refinedY0 = clamp(absCenterY - finalBoxH * 0.5, 0, fullHeight - 4);
  const refinedY1 = clamp(absCenterY + finalBoxH * 0.5, refinedY0 + 4, fullHeight);

  const refinedBox: [number, number, number, number] = [
    toNorm(refinedY0, fullHeight),
    toNorm(refinedX0, fullWidth),
    toNorm(refinedY1, fullHeight),
    toNorm(refinedX1, fullWidth),
  ];

  const isDark = bgLum < 128;
  const fontSizeCqw = Number(clamp((fontPx / fullWidth) * 100, 1.5, 4.2).toFixed(3));

  return {
    v: TRANSLATION_BLOCK_VERSION,
    box: refinedBox,
    patchBox,
    patchDataUrl,
    text: block.text,
    bgColor: `rgb(${ringMedR}, ${ringMedG}, ${ringMedB})`,
    textColor: isDark ? '#fafafa' : '#0c0c0c',
    isDark,
    hasTextStroke: hasWhiteHalo,
    fontSizeCqw,
  };
};
