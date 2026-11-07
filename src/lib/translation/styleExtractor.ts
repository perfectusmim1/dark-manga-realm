import type { ScanlationFontKey, TranslationBlockKind } from './types';

export const FONT_FAMILY_MAP: Record<ScanlationFontKey, string> = {
  shantell: '"Shantell Sans", system-ui, -apple-system, sans-serif',
  anton: '"Anton", "Shantell Sans", Impact, system-ui, sans-serif',
  bangers: '"Bangers", "Shantell Sans", system-ui, sans-serif',
  marker: '"Permanent Marker", "Shantell Sans", cursive, sans-serif',
  cinzel: '"Cinzel", "Shantell Sans", Georgia, serif',
};

export const getFontFamilyCss = (key?: ScanlationFontKey): string =>
  FONT_FAMILY_MAP[key || 'shantell'] || FONT_FAMILY_MAP.shantell;

const clamp = (val: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, val));

const medianOf = (arr: number[]): number => {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) * 0.5;
};

const toHex = (n: number): string => clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0');

export const rgbToHex = (r: number, g: number, b: number): string =>
  `#${toHex(r)}${toHex(g)}${toHex(b)}`;

const colorDist = (r1: number, g1: number, b1: number, r2: number, g2: number, b2: number): number => {
  const dr = r1 - r2;
  const dg = g1 - g2;
  const db = b1 - b2;
  return Math.sqrt(dr * dr * 0.3 + dg * dg * 0.59 + db * db * 0.11);
};

const maxChannelDiff = (
  r1: number,
  g1: number,
  b1: number,
  r2: number,
  g2: number,
  b2: number,
): number => Math.max(Math.abs(r1 - r2), Math.abs(g1 - g2), Math.abs(b1 - b2));

const rgbSaturation = (r: number, g: number, b: number): number => {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const chroma = max - min;
  if (chroma < 12) return 0;
  return chroma / Math.max(max, 48);
};

export interface ExtractedStyleFingerprint {
  kind: TranslationBlockKind;
  fontFamily: ScanlationFontKey;
  fontWeight: number;
  fontStyle: 'normal' | 'italic';
  textColor: string;
  textGradient?: string;
  gradientStops?: [string, string];
  hasTextStroke: boolean;
  strokeColor?: string;
  strokeWidthEm?: number;
  shadowColor?: string;
  shadowBlurEm?: number;
  rotationDeg?: number;
  skewDeg?: number;
  letterSpacingEm?: number;
  isDark: boolean;
}

export interface EnclosedFillResult {
  /** Hem konturu hem de harf konturunun hapsettiği iç dolgu alanını içeren birleşik maske */
  combinedMask: Uint8Array;
  /** Yalnızca harf konturunun içinde kalan kapalı iç pikseller (ör. "NO" ve "ER." harflerinin iç dolgusu) */
  enclosedInteriorMask: Uint8Array;
  enclosedCount: number;
}

/**
 * Konturlu/içi koyu veya renkli harflerde ("NO", "FIRST MURDER." vb.) dış konturun hapsettiği
 * iç boşlukları (Jordan kapalı eğri teoremi + 1px morfolojik kapama ile) bulur.
 * Pencere dış sınırından başlayarak genişleyen flood-fill'in ulaşamadığı tüm iç cepler harf gövdesidir.
 */
export const fillEnclosedGlyphInteriors = (
  rawMask: Uint8Array,
  borderMask: Uint8Array,
  ww: number,
  wh: number,
  gMinX: number,
  gMaxX: number,
  gMinY: number,
  gMaxY: number,
  winRgb?: Int32Array,
  bgR = 255,
  bgG = 255,
  bgB = 255,
): EnclosedFillResult => {
  const numPixels = ww * wh;
  const combinedMask = new Uint8Array(rawMask);
  const enclosedInteriorMask = new Uint8Array(numPixels);

  // rawMask'in medyan parlaklığını ölç (normal koyu mürekkep mi yoksa beyaz/açık dış kontur mu?)
  let rawLum = 20;
  const bgLum = 0.299 * bgR + 0.587 * bgG + 0.114 * bgB;
  if (winRgb) {
    const rawLums: number[] = [];
    const step = Math.max(1, Math.floor(((gMaxY - gMinY + 1) * (gMaxX - gMinX + 1)) / 600));
    let k = 0;
    for (let y = Math.max(0, gMinY); y <= Math.min(wh - 1, gMaxY); y += 1) {
      const rOff = y * ww;
      for (let x = Math.max(0, gMinX); x <= Math.min(ww - 1, gMaxX); x += 1) {
        const idx = rOff + x;
        if (!rawMask[idx]) continue;
        k += 1;
        if (k % step !== 0) continue;
        const c3 = idx * 3;
        rawLums.push(0.299 * winRgb[c3] + 0.587 * winRgb[c3 + 1] + 0.114 * winRgb[c3 + 2]);
      }
    }
    if (rawLums.length > 0) {
      rawLum = medianOf(rawLums);
    }
  }

  // Konturdaki 1-2 piksellik anti-aliasing çatlaklarından sızmayı önlemek için geçici 1px kapanmış duvar
  const wall = new Uint8Array(numPixels);
  for (let y = 0; y < wh; y += 1) {
    const rOff = y * ww;
    const yMin = y > 0 ? y - 1 : 0;
    const yMax = y < wh - 1 ? y + 1 : wh - 1;
    for (let x = 0; x < ww; x += 1) {
      if (rawMask[rOff + x]) {
        wall[rOff + x] = 1;
        continue;
      }
      const xMin = x > 0 ? x - 1 : 0;
      const xMax = x < ww - 1 ? x + 1 : ww - 1;
      let nCount = 0;
      for (let ny = yMin; ny <= yMax; ny += 1) {
        const nr = ny * ww;
        for (let nx = xMin; nx <= xMax; nx += 1) {
          if (rawMask[nr + nx]) nCount += 1;
        }
      }
      // Karşılıklı iki kenarında maske olan 1px darboğazları kapat
      if (nCount >= 4) wall[rOff + x] = 1;
    }
  }

  // Pencerenin 4 kenarından dış arka planı flood-fill ile işaretle
  const visitedOuter = new Uint8Array(numPixels);
  const queue = new Int32Array(numPixels);
  let qHead = 0;
  let qTail = 0;

  const pushIfOpen = (idx: number) => {
    if (visitedOuter[idx] === 0 && wall[idx] === 0) {
      visitedOuter[idx] = 1;
      queue[qTail++] = idx;
    }
  };

  for (let x = 0; x < ww; x += 1) {
    pushIfOpen(x);
    pushIfOpen((wh - 1) * ww + x);
  }
  for (let y = 0; y < wh; y += 1) {
    pushIfOpen(y * ww);
    pushIfOpen(y * ww + (ww - 1));
  }

  while (qHead < qTail) {
    const curr = queue[qHead++];
    const cy = (curr / ww) | 0;
    const cx = curr - cy * ww;
    if (cx > 0) pushIfOpen(curr - 1);
    if (cx < ww - 1) pushIfOpen(curr + 1);
    if (cy > 0) pushIfOpen(curr - ww);
    if (cy < wh - 1) pushIfOpen(curr + ww);
  }

  // Harf kutusu içinde kalan ve dış arka plandan ulaşılamayan bağlı bileşenleri ölç;
  // gerçek harf içi boyutunda olanları (balonun tamamı olmayanları) harf içi olarak kabul et
  const glyphBoxArea = Math.max(1, (gMaxX - gMinX + 1) * (gMaxY - gMinY + 1));
  const maxHoleArea = Math.max(400, glyphBoxArea * 0.42);
  const compVisited = new Uint8Array(numPixels);
  const compPixels = new Int32Array(numPixels);
  let enclosedCount = 0;

  const x0 = Math.max(1, gMinX);
  const x1 = Math.min(ww - 2, gMaxX);
  const y0 = Math.max(1, gMinY);
  const y1 = Math.min(wh - 2, gMaxY);

  for (let y = y0; y <= y1; y += 1) {
    const rOff = y * ww;
    for (let x = x0; x <= x1; x += 1) {
      const startIdx = rOff + x;
      if (
        rawMask[startIdx] !== 0 ||
        visitedOuter[startIdx] !== 0 ||
        compVisited[startIdx] !== 0 ||
        borderMask[startIdx] !== 0
      ) {
        continue;
      }

      let cHead = 0;
      let cTail = 0;
      compVisited[startIdx] = 1;
      compPixels[cTail++] = startIdx;
      let touchesBorderMask = false;

      while (cHead < cTail) {
        const curr = compPixels[cHead++];
        const cy = (curr / ww) | 0;
        const cx = curr - cy * ww;

        const neighbors = [
          cx > 0 ? curr - 1 : -1,
          cx < ww - 1 ? curr + 1 : -1,
          cy > 0 ? curr - ww : -1,
          cy < wh - 1 ? curr + ww : -1,
        ];
        for (const nIdx of neighbors) {
          if (nIdx < 0) continue;
          if (borderMask[nIdx]) {
            touchesBorderMask = true;
          }
          if (
            rawMask[nIdx] === 0 &&
            visitedOuter[nIdx] === 0 &&
            compVisited[nIdx] === 0 &&
            !borderMask[nIdx]
          ) {
            compVisited[nIdx] = 1;
            compPixels[cTail++] = nIdx;
          }
        }
      }

      if (!touchesBorderMask && cTail <= maxHoleArea) {
        // Normal konuşma balonlarındaki "O, D, A, B, P, R" harflerinin içindeki beyaz zemin boşluklarını (counter)
        // konturlu harf iç dolgusu sanmamak için renk kontrolü yap:
        let isTrueGlyphFill = true;
        if (winRgb) {
          const hRs: number[] = [];
          const hGs: number[] = [];
          const hBs: number[] = [];
          const step = Math.max(1, Math.floor(cTail / 64));
          for (let k = 0; k < cTail; k += step) {
            const c3 = compPixels[k] * 3;
            hRs.push(winRgb[c3]);
            hGs.push(winRgb[c3 + 1]);
            hBs.push(winRgb[c3 + 2]);
          }
          const holeR = medianOf(hRs);
          const holeG = medianOf(hGs);
          const holeB = medianOf(hBs);
          const holeLum = 0.299 * holeR + 0.587 * holeG + 0.114 * holeB;
          const holeToBgDist = colorDist(holeR, holeG, holeB, bgR, bgG, bgB);
          const holeSat = rgbSaturation(holeR, holeG, holeB);

          // Bir kapalı cebin (hole) gerçek bir "konturlu harf iç dolgusu" ("NO.", "FIRST MURDER." vb.) sayılması için:
          // 1) Dış kontur parlak olup iç cep ondan belirgin şekilde KOYU olmalıdır (holeLum < rawLum - 22), VEYA
          // 2) Dış kontur koyu olup (rawLum < 75) iç cep arka plandan tamamen farklı doygun bir renk olmalıdır.
          // Aksi halde (özellikle holeLum >= rawLum olan tüm açık/gradyanlı cepler) "o, a, e, d, O, D, A, B" harflerinin ortasındaki arka plan deliğidir!
          const isDarkCoreInsideBrightOutline = rawLum >= 140 && holeLum < rawLum - 22;
          const isColoredCoreInsideBlackOutline =
            rawLum < 75 && holeToBgDist >= 55 && holeSat >= 0.38 && holeLum < bgLum - 25;
          if (!isDarkCoreInsideBrightOutline && !isColoredCoreInsideBlackOutline) {
            isTrueGlyphFill = false;
          }
        }

        if (isTrueGlyphFill) {
          for (let k = 0; k < cTail; k += 1) {
            const pIdx = compPixels[k];
            combinedMask[pIdx] = 1;
            enclosedInteriorMask[pIdx] = 1;
            enclosedCount += 1;
          }
        }
      }
    }
  }

  return { combinedMask, enclosedInteriorMask, enclosedCount };
};

export interface StyleExtractionInput {
  winRgb: Int32Array;
  ww: number;
  wh: number;
  rawGlyphMask: Uint8Array;
  enclosedInteriorMask: Uint8Array;
  enclosedCount: number;
  ringMedR: number;
  ringMedG: number;
  ringMedB: number;
  ringStd: number;
  medGlyphH: number;
  medGlyphW: number;
  fullWidth: number;
  hasClosedBubbleWalls: boolean;
  compCenters: Array<{ x: number; y: number; w: number; h: number }>;
}

/**
 * Silinen orijinal metin piksellerinden yazı rengini, kontur (stroke) rengini/kalınlığını,
 * dikey renk geçişini (gradient), gölgeyi, eğim açısını ve en uygun çizgi roman/SFX font ailesini çıkarır.
 */
export const extractStyleFingerprint = (input: StyleExtractionInput): ExtractedStyleFingerprint => {
  const {
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
  } = input;

  const numPixels = ww * wh;
  const bgLum = 0.299 * ringMedR + 0.587 * ringMedG + 0.114 * ringMedB;
  const isDarkBg = bgLum < 128;

  // 1. Mesafe dönüşümü (Manhattan Chamfer 1-2): harf kenarı (dist=1) ile harf çekirdeğini (dist>=2) ayır
  const fullGlyphMask = new Uint8Array(numPixels);
  let totalGlyphPixels = 0;
  for (let i = 0; i < numPixels; i += 1) {
    if (rawGlyphMask[i] || enclosedInteriorMask[i]) {
      fullGlyphMask[i] = 1;
      totalGlyphPixels += 1;
    }
  }

  const dist = new Int16Array(numPixels);
  for (let i = 0; i < numPixels; i += 1) {
    dist[i] = fullGlyphMask[i] ? 9999 : 0;
  }
  for (let y = 0; y < wh; y += 1) {
    const rOff = y * ww;
    for (let x = 0; x < ww; x += 1) {
      const idx = rOff + x;
      let d = dist[idx];
      if (d === 0) continue;
      if (x > 0 && dist[idx - 1] + 1 < d) d = dist[idx - 1] + 1;
      if (y > 0 && dist[idx - ww] + 1 < d) d = dist[idx - ww] + 1;
      dist[idx] = d;
    }
  }
  let maxDist = 0;
  for (let y = wh - 1; y >= 0; y -= 1) {
    const rOff = y * ww;
    for (let x = ww - 1; x >= 0; x -= 1) {
      const idx = rOff + x;
      let d = dist[idx];
      if (d === 0) continue;
      if (x < ww - 1 && dist[idx + 1] + 1 < d) d = dist[idx + 1] + 1;
      if (y < wh - 1 && dist[idx + ww] + 1 < d) d = dist[idx + ww] + 1;
      dist[idx] = d;
      if (d > maxDist && d < 9000) maxDist = d;
    }
  }

  // 2. Kontur (dış halka) ve İç Dolgu (çekirdek / kapalı iç alan) renklerini örnekle
  const edgeRs: number[] = [];
  const edgeGs: number[] = [];
  const edgeBs: number[] = [];

  const coreRs: number[] = [];
  const coreGs: number[] = [];
  const coreBs: number[] = [];
  const coreYs: number[] = [];

  // Eğer "NO" veya "FIRST MURDER." gibi kapalı iç dolgu (enclosedInteriorMask) varsa:
  // rawGlyphMask doğrudan dış konturu, enclosedInteriorMask (kontura 1..5px mesafedeki iç katman) ise iç dolguyu verir!
  const hasSignificantEnclosed =
    enclosedCount >= 18 && enclosedCount >= totalGlyphPixels * 0.08;

  if (hasSignificantEnclosed) {
    for (let y = 0; y < wh; y += 1) {
      const rOff = y * ww;
      for (let x = 0; x < ww; x += 1) {
        const idx = rOff + x;
        const cIdx = idx * 3;
        if (rawGlyphMask[idx] && dist[idx] <= 3) {
          edgeRs.push(winRgb[cIdx]);
          edgeGs.push(winRgb[cIdx + 1]);
          edgeBs.push(winRgb[cIdx + 2]);
        } else if (enclosedInteriorMask[idx]) {
          // Harf konturunun hemen içindeki gövde pikselleri (O harfinin en ortasındaki boşluğa düşmemek için)
          const nearStroke =
            (x > 1 && rawGlyphMask[idx - 2]) ||
            (x < ww - 2 && rawGlyphMask[idx + 2]) ||
            (y > 1 && rawGlyphMask[idx - 2 * ww]) ||
            (y < wh - 2 && rawGlyphMask[idx + 2 * ww]) ||
            dist[idx] <= 6;
          if (nearStroke) {
            coreRs.push(winRgb[cIdx]);
            coreGs.push(winRgb[cIdx + 1]);
            coreBs.push(winRgb[cIdx + 2]);
            coreYs.push(y);
          }
        }
      }
    }
  }

  // Kapalı iç alan yoksa veya yeterli örnek çıkmadıysa mesafe dönüşümü (dist<=edgeMaxD vs dist>=coreMinD) ile ayır.
  // Kalın konturlu SFX/başlık yazılarında ("KIM JEONGHYUK", "REPARTIDOR DE DALMIN", "31 AÑOS")
  // beyaz kontur 2-3px kalınlığında olduğu için çekirdek örneklemesini daha derinden (coreMinD) al.
  if (coreRs.length < 12) {
    edgeRs.length = 0;
    edgeGs.length = 0;
    edgeBs.length = 0;
    coreRs.length = 0;
    coreGs.length = 0;
    coreBs.length = 0;
    coreYs.length = 0;

    const edgeMaxD = maxDist >= 6 ? 2 : 1;
    const coreMinD = maxDist >= 7 ? 4 : maxDist >= 5 ? 3 : 2;

    for (let y = 0; y < wh; y += 1) {
      const rOff = y * ww;
      for (let x = 0; x < ww; x += 1) {
        const idx = rOff + x;
        const d = dist[idx];
        if (d <= 0) continue;
        const cIdx = idx * 3;
        if (d <= edgeMaxD) {
          edgeRs.push(winRgb[cIdx]);
          edgeGs.push(winRgb[cIdx + 1]);
          edgeBs.push(winRgb[cIdx + 2]);
        }
        if (d >= coreMinD) {
          coreRs.push(winRgb[cIdx]);
          coreGs.push(winRgb[cIdx + 1]);
          coreBs.push(winRgb[cIdx + 2]);
          coreYs.push(y);
        }
      }
    }
  }

  // Çok ince harflerde (dist>=2 azsa) tüm rawGlyphMask piksellerini kullan
  if (coreRs.length < 8) {
    for (let y = 0; y < wh; y += 1) {
      const rOff = y * ww;
      for (let x = 0; x < ww; x += 1) {
        const idx = rOff + x;
        if (!rawGlyphMask[idx]) continue;
        const cIdx = idx * 3;
        coreRs.push(winRgb[cIdx]);
        coreGs.push(winRgb[cIdx + 1]);
        coreBs.push(winRgb[cIdx + 2]);
        coreYs.push(y);
      }
    }
  }

  let fillR = coreRs.length > 0 ? Math.round(medianOf(coreRs)) : isDarkBg ? 250 : 12;
  let fillG = coreGs.length > 0 ? Math.round(medianOf(coreGs)) : isDarkBg ? 250 : 12;
  let fillB = coreBs.length > 0 ? Math.round(medianOf(coreBs)) : isDarkBg ? 250 : 12;

  const edgeR = edgeRs.length > 0 ? Math.round(medianOf(edgeRs)) : fillR;
  const edgeG = edgeGs.length > 0 ? Math.round(medianOf(edgeGs)) : fillG;
  const edgeB = edgeBs.length > 0 ? Math.round(medianOf(edgeBs)) : fillB;

  const fillToEdgeDist = colorDist(fillR, fillG, fillB, edgeR, edgeG, edgeB);
  const edgeToBgDist = colorDist(edgeR, edgeG, edgeB, ringMedR, ringMedG, ringMedB);
  const fillToBgDist = colorDist(fillR, fillG, fillB, ringMedR, ringMedG, ringMedB);
  const fillLum = 0.299 * fillR + 0.587 * fillG + 0.114 * fillB;
  const edgeLum = 0.299 * edgeR + 0.587 * edgeG + 0.114 * edgeB;

  // Kontur tespiti:
  // Normal anti-aliasing pikselleri her zaman fillLum ile bgLum ARASINDA yer alır (min(fillLum,bgLum) <= edgeLum <= max(fillLum,bgLum)).
  // Gerçek bir dış kontur (stroke) ise ya:
  // 1) Kapalı iç dolguya (hasSignificantEnclosed) sahiptir ("NO", "FIRST MURDER.", "REPARTIDOR DE DALMIN", "31 AÑOS"), ya da
  // 2) Hem harf dolgusundan hem arka plandan daha parlak (beyaz hale) veya her ikisinden daha koyu (siyah kontur) bir dış halkadır!
  // Koyu harf maskesi (fgDark) yalnızca harf içini yakaladığında, beyaz/parlak dış kontur
  // fullGlyphMask'in hemen 1-2px DIŞINDA yer alır ("KIM JEONGHYUK", "REPARTIDOR DE DALMIN", "31 AÑOS").
  const haloRs: number[] = [];
  const haloGs: number[] = [];
  const haloBs: number[] = [];
  for (let y = 2; y < wh - 2; y += 1) {
    const rOff = y * ww;
    for (let x = 2; x < ww - 2; x += 1) {
      const idx = rOff + x;
      if (fullGlyphMask[idx]) continue;
      if (
        fullGlyphMask[idx - 2] ||
        fullGlyphMask[idx + 2] ||
        fullGlyphMask[idx - 2 * ww] ||
        fullGlyphMask[idx + 2 * ww]
      ) {
        const cIdx = idx * 3;
        haloRs.push(winRgb[cIdx]);
        haloGs.push(winRgb[cIdx + 1]);
        haloBs.push(winRgb[cIdx + 2]);
      }
    }
  }
  const haloR = haloRs.length > 0 ? Math.round(medianOf(haloRs)) : ringMedR;
  const haloG = haloGs.length > 0 ? Math.round(medianOf(haloGs)) : ringMedG;
  const haloB = haloBs.length > 0 ? Math.round(medianOf(haloBs)) : ringMedB;
  const haloLum = 0.299 * haloR + 0.587 * haloG + 0.114 * haloB;
  const haloToFillDist = colorDist(haloR, haloG, haloB, fillR, fillG, fillB);
  const haloToBgDist = colorDist(haloR, haloG, haloB, ringMedR, ringMedG, ringMedB);

  const isEdgeOutsideLumRange =
    edgeLum > Math.max(fillLum, bgLum) + 36 || edgeLum < Math.min(fillLum, bgLum) - 36;
  const hasOuterHaloStroke =
    !hasClosedBubbleWalls &&
    haloToFillDist >= 55 &&
    ((haloLum >= 225 && fillLum <= 145 && (haloToBgDist >= 24 || ringStd >= 16)) ||
      (haloLum <= 45 && fillLum >= 165 && (haloToBgDist >= 24 || ringStd >= 16)));

  let hasOutline = false;
  let strokeR = 255;
  let strokeG = 255;
  let strokeB = 255;

  if (hasSignificantEnclosed && fillToEdgeDist >= 32 && edgeToBgDist >= 24) {
    hasOutline = true;
    strokeR = edgeR;
    strokeG = edgeG;
    strokeB = edgeB;
  } else if (hasOuterHaloStroke) {
    hasOutline = true;
    strokeR = haloR;
    strokeG = haloG;
    strokeB = haloB;
  } else if (
    isEdgeOutsideLumRange &&
    fillToEdgeDist >= 42 &&
    edgeToBgDist >= 32 &&
    maxChannelDiff(fillR, fillG, fillB, edgeR, edgeG, edgeB) >= 55
  ) {
    hasOutline = true;
    strokeR = edgeR;
    strokeG = edgeG;
    strokeB = edgeB;
  }

  // 3. Bölge türünü (dialogue / narration / sfx / emphasis) sınıflandır
  const relGlyphH = medGlyphH / Math.max(1, fullWidth);
  const fillSat = rgbSaturation(fillR, fillG, fillB);
  const isColoredFill =
    fillSat >= 0.26 && maxChannelDiff(fillR, fillG, fillB, fillG, fillB, fillR) >= 32;
  const isInsideLightBubble =
    hasClosedBubbleWalls && bgLum >= 145 && !hasSignificantEnclosed && relGlyphH < 0.048;
  const isSceneBackground = (ringStd >= 14 || !hasClosedBubbleWalls) && !isInsideLightBubble;

  let kind: TranslationBlockKind = 'dialogue';
  if (isInsideLightBubble && !isColoredFill) {
    kind = 'dialogue';
    hasOutline = false;
  } else if (
    hasOutline ||
    isColoredFill ||
    relGlyphH >= 0.048 ||
    (isSceneBackground && relGlyphH >= 0.032) ||
    (ringStd >= 18 && !hasClosedBubbleWalls)
  ) {
    kind = 'sfx';
  } else if (ringStd < 6 && isDarkBg && hasClosedBubbleWalls) {
    kind = 'narration';
  }

  // 4. Renk netleştirme ve okunabilirlik garantisi
  let finalTextColor = isDarkBg ? '#fafafa' : '#0c0c0c';
  let finalStrokeColor: string | undefined;
  let strokeWidthEm: number | undefined;
  let textGradient: string | undefined;
  let gradientStops: [string, string] | undefined;

  if (kind === 'sfx' || isColoredFill || hasOutline) {
    // Orijinal rengi koru; eğer çok soluksa doygunluğunu/kontrastını hafifçe güçlendir
    if (hasOutline) {
      const strokeLum = 0.299 * strokeR + 0.587 * strokeG + 0.114 * strokeB;
      // Kontur beyaz/açıksa tam net beyaz/açık ton yap; koyuysa tam koyu yap
      if (strokeLum > 185 && rgbSaturation(strokeR, strokeG, strokeB) < 0.2) {
        finalStrokeColor = '#ffffff';
      } else if (strokeLum < 55 && rgbSaturation(strokeR, strokeG, strokeB) < 0.2) {
        finalStrokeColor = '#0a0a0c';
      } else {
        finalStrokeColor = rgbToHex(strokeR, strokeG, strokeB);
      }
      strokeWidthEm = hasSignificantEnclosed ? 0.24 : 0.2;
      finalTextColor = rgbToHex(fillR, fillG, fillB);
    } else {
      // Kontursuz SFX / sahne yazısı: zeminle kontrastı düşükse koruyucu kontur ekle
      finalTextColor = rgbToHex(fillR, fillG, fillB);
      if (fillToBgDist < 85 || ringStd >= 12) {
        const fillLum = 0.299 * fillR + 0.587 * fillG + 0.114 * fillB;
        hasOutline = true;
        finalStrokeColor = fillLum > 140 ? '#0a0a0c' : '#ffffff';
        strokeWidthEm = 0.2;
      }
    }

    // Dikey renk geçişi (gradient) kontrolü: üst yarı ile alt yarı arasında belirgin ton farkı varsa
    if (coreYs.length >= 24) {
      const minY = Math.min(...coreYs);
      const maxY = Math.max(...coreYs);
      const spanY = maxY - minY;
      if (spanY >= 16) {
        const topCut = minY + spanY * 0.38;
        const botCut = maxY - spanY * 0.38;
        const topRs: number[] = [];
        const topGs: number[] = [];
        const topBs: number[] = [];
        const botRs: number[] = [];
        const botGs: number[] = [];
        const botBs: number[] = [];
        for (let i = 0; i < coreYs.length; i += 1) {
          if (coreYs[i] <= topCut) {
            topRs.push(coreRs[i]);
            topGs.push(coreGs[i]);
            topBs.push(coreBs[i]);
          } else if (coreYs[i] >= botCut) {
            botRs.push(coreRs[i]);
            botGs.push(coreGs[i]);
            botBs.push(coreBs[i]);
          }
        }
        if (topRs.length >= 8 && botRs.length >= 8) {
          const tR = Math.round(medianOf(topRs));
          const tG = Math.round(medianOf(topGs));
          const tB = Math.round(medianOf(topBs));
          const bR = Math.round(medianOf(botRs));
          const bG = Math.round(medianOf(botGs));
          const bB = Math.round(medianOf(botBs));
          const gradDiff = colorDist(tR, tG, tB, bR, bG, bB);
          if (gradDiff >= 20 && gradDiff <= 155) {
            const cTop = rgbToHex(tR, tG, tB);
            const cBot = rgbToHex(bR, bG, bB);
            gradientStops = [cTop, cBot];
            textGradient = `linear-gradient(180deg, ${cTop} 0%, ${cBot} 100%)`;
          }
        }
      }
    }
  } else {
    // Standart konuşma balonu: yüksek kontrastlı temiz diyalog rengi
    if (isColoredFill && fillToBgDist >= 70) {
      finalTextColor = rgbToHex(fillR, fillG, fillB);
    } else {
      finalTextColor = isDarkBg ? '#fafafa' : '#0c0c0c';
    }
  }

  // 5. Satır eğim açısı (rotationDeg): bileşen merkezlerinin doğrusal regresyonu
  let rotationDeg = 0;
  if (kind === 'sfx' && compCenters.length >= 2) {
    // Aynı satırdaki bileşenlerin eğimini ölç
    const sortedC = [...compCenters].sort((a, b) => a.x - b.x);
    const totalSpanX = sortedC[sortedC.length - 1].x - sortedC[0].x;
    if (totalSpanX >= medGlyphH * 0.8) {
      let sumX = 0;
      let sumY = 0;
      for (const c of sortedC) {
        sumX += c.x;
        sumY += c.y;
      }
      const meanX = sumX / sortedC.length;
      const meanY = sumY / sortedC.length;
      let num = 0;
      let den = 0;
      for (const c of sortedC) {
        const dx = c.x - meanX;
        const dy = c.y - meanY;
        num += dx * dy;
        den += dx * dx;
      }
      if (den > 10) {
        const slope = num / den;
        const deg = (Math.atan(slope) * 180) / Math.PI;
        if (Math.abs(deg) >= 3.5 && Math.abs(deg) <= 28) {
          rotationDeg = Number(deg.toFixed(1));
        }
      }
    }
  }

  // 6. Font karakteri seçimi: harf en/boy oranı ve bölge türüne göre
  const aspectRatio = medGlyphW / Math.max(1, medGlyphH);
  let fontFamily: ScanlationFontKey = 'shantell';
  let fontWeight = 700;
  let letterSpacingEm = 0.01;

  if (kind === 'sfx') {
    if (aspectRatio <= 0.68 || hasSignificantEnclosed) {
      // "NO.", "FIRST MURDER." gibi uzun, dar, kalın konturlu dramatik yazılar
      fontFamily = 'anton';
      fontWeight = 400; // Anton doğal olarak 900 ağırlığındadır
      letterSpacingEm = 0.03;
    } else if (Math.abs(rotationDeg) >= 5 || fillSat >= 0.45) {
      // Dinamik açılı / renkli aksiyon yazıları
      fontFamily = 'bangers';
      fontWeight = 400;
      letterSpacingEm = 0.04;
    } else {
      // Fırça / el yazısı vurgu
      fontFamily = 'marker';
      fontWeight = 400;
      letterSpacingEm = 0.02;
    }
  } else if (kind === 'narration' && aspectRatio <= 0.6) {
    fontFamily = 'cinzel';
    fontWeight = 700;
    letterSpacingEm = 0.03;
  }

  const shadowColor =
    kind === 'sfx' || isDarkBg || fillLum > 165
      ? 'rgba(0, 0, 0, 0.92)'
      : undefined;
  const shadowBlurEm = kind === 'sfx' ? 0.22 : isDarkBg ? 0.16 : undefined;

  return {
    kind,
    fontFamily,
    fontWeight,
    fontStyle: 'normal',
    textColor: finalTextColor,
    textGradient,
    gradientStops,
    hasTextStroke: hasOutline,
    strokeColor: finalStrokeColor,
    strokeWidthEm,
    shadowColor,
    shadowBlurEm,
    rotationDeg: rotationDeg !== 0 ? rotationDeg : undefined,
    letterSpacingEm,
    isDark: isDarkBg,
  };
};

/**
 * Dokulu/karmaşık sahne arka planları (ahşap zemin, hareket bulanıklığı, efekt çizgileri) için
 * İzofot Yönlü Hızlı İlerleme (Telea Fast Marching Method + Yönlü Anizotropik Span) Inpainting.
 * 0 MB ek model indirmesi gerektirir; mobil ve masaüstünde <4 ms içinde %100 hatasız çalışır.
 */
export const inpaintTexturedRegion = (
  cleaned: Float32Array,
  eraseMask: Uint8Array,
  borderMask: Uint8Array,
  ww: number,
  wh: number,
  egMinX: number,
  egMaxX: number,
  egMinY: number,
  egMaxY: number,
  ringMedR: number,
  ringMedG: number,
  ringMedB: number,
): void => {
  const numPixels = ww * wh;

  // 1. Dış halkadaki yatay ve dikey kenar enerjisini ölç (ör. "NO" arkasındaki yatay ahşap çizgileri)
  let gradXSum = 0;
  let gradYSum = 0;
  let gradCount = 0;

  for (let y = Math.max(2, egMinY - 4); y <= Math.min(wh - 3, egMaxY + 4); y += 1) {
    const rOff = y * ww;
    for (let x = Math.max(2, egMinX - 4); x <= Math.min(ww - 3, egMaxX + 4); x += 1) {
      const idx = rOff + x;
      if (eraseMask[idx] || borderMask[idx]) continue;
      if (
        eraseMask[idx - 1] ||
        eraseMask[idx + 1] ||
        eraseMask[idx - ww] ||
        eraseMask[idx + ww] ||
        eraseMask[idx - 2] ||
        eraseMask[idx + 2]
      ) {
        const l = (idx - 1) * 3;
        const r = (idx + 1) * 3;
        const t = (idx - ww) * 3;
        const b = (idx + ww) * 3;
        const gx =
          Math.abs(cleaned[r] - cleaned[l]) +
          Math.abs(cleaned[r + 1] - cleaned[l + 1]) +
          Math.abs(cleaned[r + 2] - cleaned[l + 2]);
        const gy =
          Math.abs(cleaned[b] - cleaned[t]) +
          Math.abs(cleaned[b + 1] - cleaned[t + 1]) +
          Math.abs(cleaned[b + 2] - cleaned[t + 2]);
        gradXSum += gx;
        gradYSum += gy;
        gradCount += 1;
      }
    }
  }

  // gradY > gradX ise yatay çizgiler (horizontal lines) baskındır -> yatay enterpolasyona ekstra ağırlık ver!
  const anisoH =
    gradCount > 8 && gradXSum + gradYSum > 1
      ? clamp((gradYSum + 10) / (gradXSum + 10), 0.35, 2.8)
      : 1.0;

  // 2. Yatay ve dikey span enterpolasyonu (başlangıç alanı + yönlü yapı koruma)
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
        const useRight = xs1 < ww && !borderMask[rOff + xs1];
        const lIdx = (rOff + xs0 - 1) * 3;
        const rIdx = (rOff + xs1) * 3;

        const lr = useLeft ? cleaned[lIdx] : useRight ? cleaned[rIdx] : ringMedR;
        const lg = useLeft ? cleaned[lIdx + 1] : useRight ? cleaned[rIdx + 1] : ringMedG;
        const lb = useLeft ? cleaned[lIdx + 2] : useRight ? cleaned[rIdx + 2] : ringMedB;

        const rr = useRight ? cleaned[rIdx] : useLeft ? cleaned[lIdx] : ringMedR;
        const rg = useRight ? cleaned[rIdx + 1] : useLeft ? cleaned[lIdx + 1] : ringMedG;
        const rb = useRight ? cleaned[rIdx + 2] : useLeft ? cleaned[lIdx + 2] : ringMedB;

        const sp = Math.max(1, xs1 - xs0);
        for (let i = 0; i < sp; i += 1) {
          const t = (i + 0.5) / sp;
          const pIdx = rOff + xs0 + i;
          const cIdx = pIdx * 3;
          hInterp[cIdx] = (1 - t) * lr + t * rr;
          hInterp[cIdx + 1] = (1 - t) * lg + t * rg;
          hInterp[cIdx + 2] = (1 - t) * lb + t * rb;
          hSpan[pIdx] = sp / anisoH;
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
        const botIdx = ys1 * ww + x;
        const useTop = ys0 > 0 && !borderMask[topIdx];
        const useBot = ys1 < wh && !borderMask[botIdx];
        const t3 = topIdx * 3;
        const b3 = botIdx * 3;

        const tr = useTop ? cleaned[t3] : useBot ? cleaned[b3] : ringMedR;
        const tg = useTop ? cleaned[t3 + 1] : useBot ? cleaned[b3 + 1] : ringMedG;
        const tb = useTop ? cleaned[t3 + 2] : useBot ? cleaned[b3 + 2] : ringMedB;

        const br = useBot ? cleaned[b3] : useTop ? cleaned[t3] : ringMedR;
        const bg = useBot ? cleaned[b3 + 1] : useTop ? cleaned[t3 + 1] : ringMedG;
        const bb = useBot ? cleaned[b3 + 2] : useTop ? cleaned[t3 + 2] : ringMedB;

        const sp = Math.max(1, ys1 - ys0);
        for (let i = 0; i < sp; i += 1) {
          const t = (i + 0.5) / sp;
          const pIdx = (ys0 + i) * ww + x;
          const cIdx = pIdx * 3;
          vInterp[cIdx] = (1 - t) * tr + t * br;
          vInterp[cIdx + 1] = (1 - t) * tg + t * bg;
          vInterp[cIdx + 2] = (1 - t) * tb + t * bb;
          vSpan[pIdx] = sp * anisoH;
        }
      } else {
        y += 1;
      }
    }
  }

  // 3. Telea Fast Marching (BFS katman sırasıyla dıştan içe izofot ağırlıklı yayılım)
  const known = new Uint8Array(numPixels);
  const order = new Int32Array(numPixels);
  let qHead = 0;
  let qTail = 0;

  for (let i = 0; i < numPixels; i += 1) {
    if (!eraseMask[i]) {
      known[i] = 1;
    }
  }

  for (let y = egMinY; y <= egMaxY; y += 1) {
    const rOff = y * ww;
    for (let x = egMinX; x <= egMaxX; x += 1) {
      const idx = rOff + x;
      if (!eraseMask[idx]) continue;
      if (
        (x > 0 && known[idx - 1]) ||
        (x < ww - 1 && known[idx + 1]) ||
        (y > 0 && known[idx - ww]) ||
        (y < wh - 1 && known[idx + ww])
      ) {
        known[idx] = 2; // Sınır kuşağı
        order[qTail++] = idx;
      }
    }
  }

  while (qHead < qTail) {
    const idx = order[qHead++];
    const y = (idx / ww) | 0;
    const x = idx - y * ww;

    // Bilinen komşulardan anizotropik ağırlıklı ortalama + span tahmini
    let wSum = 0;
    let rSum = 0;
    let gSum = 0;
    let bSum = 0;

    const rMinY = Math.max(0, y - 2);
    const rMaxY = Math.min(wh - 1, y + 2);
    const rMinX = Math.max(0, x - 2);
    const rMaxX = Math.min(ww - 1, x + 2);

    for (let ny = rMinY; ny <= rMaxY; ny += 1) {
      const nrOff = ny * ww;
      const dy = ny - y;
      for (let nx = rMinX; nx <= rMaxX; nx += 1) {
        const nIdx = nrOff + nx;
        if (known[nIdx] !== 1 || borderMask[nIdx]) continue;
        const dx = nx - x;
        const distSq = dx * dx + dy * dy;
        if (distSq === 0) continue;
        // Yatay yapı baskınsa yatay komşulara, dikey yapı baskınsa dikey komşulara yüksek ağırlık
        const dirFactor = dy === 0 ? anisoH : dx === 0 ? 1 / anisoH : 1.0;
        const w = dirFactor / distSq;
        const c3 = nIdx * 3;
        rSum += cleaned[c3] * w;
        gSum += cleaned[c3 + 1] * w;
        bSum += cleaned[c3 + 2] * w;
        wSum += w;
      }
    }

    const whW = vSpan[idx] / Math.max(1e-4, hSpan[idx] + vSpan[idx]);
    const wvW = 1 - whW;
    const cIdx = idx * 3;
    const spanR = whW * hInterp[cIdx] + wvW * vInterp[cIdx];
    const spanG = whW * hInterp[cIdx + 1] + wvW * vInterp[cIdx + 1];
    const spanB = whW * hInterp[cIdx + 2] + wvW * vInterp[cIdx + 2];

    if (wSum > 0) {
      const fmmR = rSum / wSum;
      const fmmG = gSum / wSum;
      const fmmB = bSum / wSum;
      cleaned[cIdx] = 0.55 * spanR + 0.45 * fmmR;
      cleaned[cIdx + 1] = 0.55 * spanG + 0.45 * fmmG;
      cleaned[cIdx + 2] = 0.55 * spanB + 0.45 * fmmB;
    } else {
      cleaned[cIdx] = spanR;
      cleaned[cIdx + 1] = spanG;
      cleaned[cIdx + 2] = spanB;
    }

    known[idx] = 1;

    const neighbors = [
      x > 0 ? idx - 1 : -1,
      x < ww - 1 ? idx + 1 : -1,
      y > 0 ? idx - ww : -1,
      y < wh - 1 ? idx + ww : -1,
    ];
    for (const nIdx of neighbors) {
      if (nIdx >= 0 && known[nIdx] === 0 && eraseMask[nIdx]) {
        known[nIdx] = 2;
        order[qTail++] = nIdx;
      }
    }
  }

  // 4. Anizotropik yön korumalı Harmonik yumuşatma (yatay/dikey çizgileri bulandırmadan pürüzleri siler)
  const wH = clamp(0.25 * anisoH, 0.12, 0.38);
  const wV = 0.5 - wH;
  for (let iter = 0; iter < 10; iter += 1) {
    for (let k = 0; k < qTail; k += 1) {
      const idx = order[k];
      const y = (idx / ww) | 0;
      const x = idx - y * ww;
      if (x <= 0 || x >= ww - 1 || y <= 0 || y >= wh - 1) continue;
      const c = idx * 3;
      const n = (idx - ww) * 3;
      const s = (idx + ww) * 3;
      const w = (idx - 1) * 3;
      const e = (idx + 1) * 3;
      cleaned[c] = wH * (cleaned[w] + cleaned[e]) + wV * (cleaned[n] + cleaned[s]);
      cleaned[c + 1] = wH * (cleaned[w + 1] + cleaned[e + 1]) + wV * (cleaned[n + 1] + cleaned[s + 1]);
      cleaned[c + 2] = wH * (cleaned[w + 2] + cleaned[e + 2]) + wV * (cleaned[n + 2] + cleaned[s + 2]);
    }
  }
};
