import { getFontFamilyCss } from './styleExtractor';
import type { ScanlationFontKey, TranslationBlock } from './types';

let sharedMeasureCanvas: HTMLCanvasElement | null = null;

export const getSharedMeasureContext = (): CanvasRenderingContext2D | null => {
  if (typeof document === 'undefined') return null;
  if (!sharedMeasureCanvas) {
    sharedMeasureCanvas = document.createElement('canvas');
    sharedMeasureCanvas.width = 64;
    sharedMeasureCanvas.height = 64;
  }
  return sharedMeasureCanvas.getContext('2d');
};

export const measureStyledWordWidth = (
  ctx: CanvasRenderingContext2D | null,
  word: string,
  fontPx: number,
  fontFamilyKey: ScanlationFontKey = 'shantell',
  fontWeight = 700,
): number => {
  const familyCss = getFontFamilyCss(fontFamilyKey);
  if (ctx) {
    ctx.font = `${fontWeight} ${fontPx}px ${familyCss}`;
    const w = ctx.measureText(word).width;
    if (w > 0) {
      const spacingBonus = fontFamilyKey === 'anton' || fontFamilyKey === 'bangers' ? 1.04 : 1.01;
      return w * spacingBonus;
    }
  }
  const charFactor =
    fontFamilyKey === 'anton' || fontFamilyKey === 'bangers' ? 0.56 : 0.61;
  return word.length * fontPx * charFactor;
};

export interface SmartWrappedLine {
  text: string;
  scale: number;
  widthPx: number;
}

export interface SmartWrapResult {
  lines: SmartWrappedLine[];
  maxWordWidth: number;
  totalHeightPx: number;
}

/**
 * Konuşma balonunun şekline (oval/elips daralması) ve dengeli satır uzunluklarına göre
 * yetim kelime bırakmayan akıllı satır kırma motoru.
 * Eğer `emphasisLastLineScale` varsa, son vurgu kelimesini/cümleciğini ayrı alt satıra alıp büyütür.
 */
export const computeSmartWrappedLines = (
  ctx: CanvasRenderingContext2D | null,
  text: string,
  maxWidthPx: number,
  fontPx: number,
  options?: {
    fontFamily?: ScanlationFontKey;
    fontWeight?: number;
    lineWidthsPct?: number[];
    emphasisLastLineScale?: number;
    lineHeightRatio?: number;
  },
): SmartWrapResult => {
  const fontFamily = options?.fontFamily ?? 'shantell';
  const fontWeight = options?.fontWeight ?? 700;
  const emphasisScale = options?.emphasisLastLineScale;
  const lineHeightRatio = options?.lineHeightRatio ?? (fontFamily === 'anton' || fontFamily === 'bangers' ? 1.12 : 1.22);

  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return { lines: [], maxWordWidth: 0, totalHeightPx: 0 };
  }

  // Son satır vurguluysa ("NEDEN YUKARI ÇIKTIN / ALONE?" gibi) ve en az 3 kelime varsa
  // son 1-2 kelimelik vurguyu alt satır olarak ayır
  let bodyWords = words;
  let emphasisText = '';
  if (emphasisScale && emphasisScale >= 1.2 && words.length >= 3) {
    const lastWord = words[words.length - 1];
    const takeTwo = words.length >= 5 && lastWord.replace(/[^\p{L}]/gu, '').length <= 4;
    const splitIdx = takeTwo ? words.length - 2 : words.length - 1;
    bodyWords = words.slice(0, splitIdx);
    emphasisText = words.slice(splitIdx).join(' ');
  }

  const spaceW =
    measureStyledWordWidth(ctx, ' ', fontPx, fontFamily, fontWeight) || fontPx * 0.28;
  const wordWidths = bodyWords.map((w) =>
    measureStyledWordWidth(ctx, w, fontPx, fontFamily, fontWeight),
  );
  let maxWordWidth = wordWidths.reduce((m, v) => (v > m ? v : m), 0);

  // Önce açgözlü sarmalama ile kaç satır gerektiğini bul
  const greedyLines: string[] = [];
  let curLine = '';
  let curW = 0;
  for (let i = 0; i < bodyWords.length; i += 1) {
    const w = bodyWords[i];
    const ww = wordWidths[i];
    if (!curLine) {
      curLine = w;
      curW = ww;
    } else if (curW + spaceW + ww <= maxWidthPx) {
      curLine += ` ${w}`;
      curW += spaceW + ww;
    } else {
      greedyLines.push(curLine);
      curLine = w;
      curW = ww;
    }
  }
  if (curLine) greedyLines.push(curLine);

  const targetLineCount = greedyLines.length;
  let finalBodyLines: Array<{ text: string; widthPx: number }> = [];

  // 2..6 satır arasında dinamik programlama ile satır genişliklerini dengele (elmas/oval profil uyumlu)
  const n = bodyWords.length;
  if (targetLineCount >= 2 && targetLineCount <= 7 && n >= 2 && n <= 36) {
    const dp = new Float64Array((n + 1) * (targetLineCount + 1));
    const nextBreak = new Int32Array((n + 1) * (targetLineCount + 1));
    dp.fill(Infinity);
    dp[n * (targetLineCount + 1) + 0] = 0;

    // Oval balonlarda orta satırlar biraz daha geniş, ilk/son satırlar biraz daha dar hedeflenir
    const getLineTargetRatio = (lineIdx: number, totalLines: number): number => {
      if (options?.lineWidthsPct && options.lineWidthsPct.length === totalLines) {
        return options.lineWidthsPct[lineIdx];
      }
      if (totalLines <= 2) return 0.92;
      const normPos = (lineIdx + 0.5) / totalLines - 0.5; // -0.5 .. +0.5
      return Math.max(0.76, 1 - normPos * normPos * 0.65);
    };

    for (let remLines = 1; remLines <= targetLineCount; remLines += 1) {
      const lineIdx = targetLineCount - remLines;
      const lineRatio = getLineTargetRatio(lineIdx, targetLineCount + (emphasisText ? 1 : 0));
      const allowedMaxW = maxWidthPx * Math.min(1, lineRatio + 0.08);
      const idealW = maxWidthPx * lineRatio * 0.85;

      for (let i = 0; i < n; i += 1) {
        let lineW = 0;
        for (let j = i; j < n; j += 1) {
          lineW += (j === i ? 0 : spaceW) + wordWidths[j];
          if (lineW > allowedMaxW && j > i) break;

          const nextCost = dp[(j + 1) * (targetLineCount + 1) + (remLines - 1)];
          if (nextCost === Infinity) continue;

          const overflowPenalty = lineW > maxWidthPx ? (lineW - maxWidthPx) * 50 : 0;
          const diff = idealW - lineW;
          // Son satırda tek kısa kelime ("yetim kelime") kalmasını cezalandır
          const orphanPenalty =
            remLines === 1 && j === i && n >= 4 ? (maxWidthPx * 0.45) ** 2 : 0;
          const cost = diff * diff + overflowPenalty * overflowPenalty + orphanPenalty + nextCost;

          const stateIdx = i * (targetLineCount + 1) + remLines;
          if (cost < dp[stateIdx]) {
            dp[stateIdx] = cost;
            nextBreak[stateIdx] = j + 1;
          }
        }
      }
    }

    if (dp[targetLineCount] < Infinity) {
      let curr = 0;
      for (let rem = targetLineCount; rem >= 1 && curr < n; rem -= 1) {
        const nxt = nextBreak[curr * (targetLineCount + 1) + rem];
        if (nxt <= curr) break;
        const sliceWords = bodyWords.slice(curr, nxt);
        let lw = 0;
        for (let k = curr; k < nxt; k += 1) {
          lw += (k === curr ? 0 : spaceW) + wordWidths[k];
        }
        finalBodyLines.push({ text: sliceWords.join(' '), widthPx: lw });
        curr = nxt;
      }
    }
  }

  if (finalBodyLines.length === 0) {
    finalBodyLines = greedyLines.map((lineText) => ({
      text: lineText,
      widthPx: measureStyledWordWidth(ctx, lineText, fontPx, fontFamily, fontWeight),
    }));
  }

  const lines: SmartWrappedLine[] = finalBodyLines.map((l) => ({
    text: l.text,
    scale: 1,
    widthPx: l.widthPx,
  }));

  if (emphasisText && emphasisScale) {
    const empFontPx = fontPx * emphasisScale;
    const empW = measureStyledWordWidth(ctx, emphasisText, empFontPx, fontFamily, fontWeight);
    if (empW > maxWordWidth) maxWordWidth = empW;
    lines.push({
      text: emphasisText,
      scale: emphasisScale,
      widthPx: empW,
    });
  }

  let totalHeightPx = 0;
  for (const line of lines) {
    if (line.widthPx * line.scale > maxWidthPx && line.widthPx > 0) {
      line.scale = Number(Math.max(0.65, (maxWidthPx / line.widthPx) * line.scale).toFixed(3));
    }
    totalHeightPx += fontPx * line.scale * lineHeightRatio;
  }

  return { lines, maxWordWidth, totalHeightPx };
};

export const isWhiteOrLightColor = (color: string, isDarkBubble?: boolean): boolean => {
  if (isDarkBubble) return true;
  const c = color.trim().toLowerCase();
  if (c === '#fff' || c === '#ffffff' || c === '#fafafa' || c === 'white') return true;
  if (c.startsWith('#') && (c.length === 7 || c.length === 4)) {
    let r = 0;
    let g = 0;
    let b = 0;
    if (c.length === 7) {
      r = parseInt(c.slice(1, 3), 16);
      g = parseInt(c.slice(3, 5), 16);
      b = parseInt(c.slice(5, 7), 16);
    } else {
      r = parseInt(c[1] + c[1], 16);
      g = parseInt(c[2] + c[2], 16);
      b = parseInt(c[3] + c[3], 16);
    }
    return 0.299 * r + 0.587 * g + 0.114 * b > 175;
  }
  return false;
};

export const getLineHeightRatioForBlock = (block: TranslationBlock): number =>
  block.fontFamily === 'anton' || block.fontFamily === 'bangers' ? 1.12 : 1.22;
