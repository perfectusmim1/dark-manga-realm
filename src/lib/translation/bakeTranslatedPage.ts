import { formatChapterNumberLabel } from '@/lib/chapterTitle';
import { ResolvedReaderPage } from '@/lib/types';
import {
  ensureScanlationFontReady,
  formatScanlationText,
  getFontFamilyCss,
} from './bubbleInpainter';
import { fetchTranslatableImageBlob, loadImageElementFromBlob } from './geminiTranslator';
import { isRpgStatLine } from './ocrCore';
import {
  computeSmartWrappedLines,
  getLineHeightRatioForBlock,
} from './textLayout';
import { PageTranslationState, TranslationBlock } from './types';

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

export const computeCrc32 = (bytes: Uint8Array): number => {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    crc = CRC32_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
};

// Sıkıştırılmış görseller (.jpg/.webp/.png) için sıfır bağımlılıklı, UTF-8 uyumlu standart PKZIP (STORE) paketleyici.
export const buildStoredZipBlob = (files: Array<{ name: string; data: Uint8Array }>): Blob => {
  const encoder = new TextEncoder();
  const localChunks: Uint8Array[] = [];
  const centralChunks: Uint8Array[] = [];
  let offset = 0;

  for (const file of files) {
    const nameBytes = encoder.encode(file.name);
    const crc = computeCrc32(file.data);
    const size = file.data.byteLength;

    const localHeader = new Uint8Array(30 + nameBytes.byteLength);
    const lv = new DataView(localHeader.buffer);
    lv.setUint32(0, 0x04034b50, true); // Local file header signature
    lv.setUint16(4, 20, true);         // Version needed (2.0)
    lv.setUint16(6, 0x0800, true);     // UTF-8 filename flag
    lv.setUint16(8, 0, true);          // Compression method: STORE (0)
    lv.setUint16(10, 0, true);         // Mod time
    lv.setUint16(12, 0x21, true);      // Mod date (1980-01-01)
    lv.setUint32(14, crc, true);
    lv.setUint32(18, size, true);
    lv.setUint32(22, size, true);
    lv.setUint16(26, nameBytes.byteLength, true);
    lv.setUint16(28, 0, true);
    localHeader.set(nameBytes, 30);

    const centralHeader = new Uint8Array(46 + nameBytes.byteLength);
    const cv = new DataView(centralHeader.buffer);
    cv.setUint32(0, 0x02014b50, true); // Central directory signature
    cv.setUint16(4, 20, true);         // Version made by
    cv.setUint16(6, 20, true);         // Version needed
    cv.setUint16(8, 0x0800, true);     // UTF-8 filename flag
    cv.setUint16(10, 0, true);         // STORE
    cv.setUint16(12, 0, true);
    cv.setUint16(14, 0x21, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, size, true);
    cv.setUint32(24, size, true);
    cv.setUint16(28, nameBytes.byteLength, true);
    cv.setUint16(30, 0, true);
    cv.setUint16(32, 0, true);
    cv.setUint16(34, 0, true);
    cv.setUint16(36, 0, true);
    cv.setUint32(38, 0, true);
    cv.setUint32(42, offset, true);
    centralHeader.set(nameBytes, 46);

    localChunks.push(localHeader, file.data);
    centralChunks.push(centralHeader);
    offset += localHeader.byteLength + size;
  }

  const centralSize = centralChunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const endRecord = new Uint8Array(22);
  const ev = new DataView(endRecord.buffer);
  ev.setUint32(0, 0x06054b50, true); // End of central directory signature
  ev.setUint16(4, 0, true);
  ev.setUint16(6, 0, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);
  ev.setUint16(20, 0, true);

  return new Blob([...localChunks, ...centralChunks, endRecord], {
    type: 'application/zip',
  });
};

const mimeToExtension = (mimeType?: string | null): string => {
  const normalized = (mimeType || '').toLowerCase();
  if (normalized.includes('png')) return 'png';
  if (normalized.includes('webp')) return 'webp';
  return 'jpg';
};

const loadDataUrlImage = (dataUrl: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Yama görseli yüklenemedi'));
    img.src = dataUrl;
  });

const canvasToJpegBlob = (canvas: HTMLCanvasElement, quality = 0.93): Promise<Blob> =>
  new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error('Çevirili görsel dışa aktarılamadı'));
      },
      'image/jpeg',
      quality,
    );
  });

// Sayfa görselinin tam çözünürlüklü kopyası üzerine piksel-inpaint yamalarını ve
// stil kopyalı scanlation/SFX dizgisini doğrudan işleyerek indirilebilir görsel üretir.
export const bakeTranslatedPageToBlob = async (
  imageSrc: string,
  blocks: TranslationBlock[] | undefined,
  targetLang = 'tr',
  signal?: AbortSignal,
): Promise<{ blob: Blob; ext: string }> => {
  const origBlob = await fetchTranslatableImageBlob(imageSrc, signal);
  if (!blocks || blocks.length === 0) {
    return { blob: origBlob, ext: mimeToExtension(origBlob.type) };
  }

  await ensureScanlationFontReady();
  if (signal?.aborted) {
    throw new DOMException('İptal edildi', 'AbortError');
  }

  const img = await loadImageElementFromBlob(origBlob);
  const width = img.naturalWidth || img.width;
  const height = img.naturalHeight || img.height;
  if (width <= 0 || height <= 0) {
    return { blob: origBlob, ext: mimeToExtension(origBlob.type) };
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return { blob: origBlob, ext: mimeToExtension(origBlob.type) };
  }

  ctx.drawImage(img, 0, 0, width, height);

  // 1. Katman: Orijinal metni silen inpaint yamaları
  const patchEntries = await Promise.all(
    blocks.map(async (block) => {
      if (!block.patchDataUrl || !block.patchBox) return null;
      try {
        const patchImg = await loadDataUrlImage(block.patchDataUrl);
        return { patchImg, patchBox: block.patchBox };
      } catch {
        return null;
      }
    }),
  );

  for (const entry of patchEntries) {
    if (!entry) continue;
    const [pYmin, pXmin, pYmax, pXmax] = entry.patchBox;
    const px = (pXmin / 1000) * width;
    const py = (pYmin / 1000) * height;
    const pw = ((pXmax - pXmin) / 1000) * width;
    const ph = ((pYmax - pYmin) / 1000) * height;
    if (pw > 0 && ph > 0) {
      ctx.drawImage(entry.patchImg, px, py, pw, ph);
    }
  }

  // 2. Katman: Stil kopyalı çizgi roman / SFX dizgisi
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.miterLimit = 2;

  for (const block of blocks) {
    const displayText = formatScanlationText(block.text, targetLang);
    if (!displayText) continue;

    const [ymin, xmin, ymax, xmax] = block.box;
    const boxX = (xmin / 1000) * width;
    const boxY = (ymin / 1000) * height;
    const boxW = ((xmax - xmin) / 1000) * width;
    const boxH = ((ymax - ymin) / 1000) * height;
    if (boxW <= 4 || boxH <= 4) continue;

    const fontSizeCqw = block.fontSizeCqw ?? 2.85;
    const baseFontPx = Math.max(11, (fontSizeCqw / 100) * width);
    const fontFamilyCss = getFontFamilyCss(block.fontFamily);
    const fontWeight = block.fontWeight ?? 700;
    const lineHeightRatio = getLineHeightRatioForBlock(block);

    const isSingleLineStat =
      !block.text.includes('\n') &&
      displayText.length <= 48 &&
      isRpgStatLine(displayText);

    const wrapped = isSingleLineStat
      ? {
          lines: [{ text: displayText, widthPx: boxW, scale: 1 }],
          maxWordWidth: boxW,
          totalHeightPx: baseFontPx * lineHeightRatio,
        }
      : computeSmartWrappedLines(ctx, displayText, boxW * 0.88, baseFontPx, {
          fontFamily: block.fontFamily,
          fontWeight,
          lineWidthsPct: block.lineWidthsPct,
          emphasisLastLineScale: block.emphasisLastLineScale,
          lineHeightRatio,
        });
    if (wrapped.lines.length === 0) continue;

    const centerX = boxX + boxW * 0.5;
    const centerY = boxY + boxH * 0.5;
    const drawX = isSingleLineStat ? boxX : centerX;
    const textColor = block.textColor || (block.isDark ? '#fafafa' : '#0c0c0c');
    const strokeColor = block.strokeColor || '#ffffff';
    const strokeWidthEm = block.strokeWidthEm ?? 0.12;

    ctx.save();
    ctx.textAlign = isSingleLineStat ? 'left' : 'center';
    if (block.rotationDeg) {
      ctx.translate(centerX, centerY);
      ctx.rotate((block.rotationDeg * Math.PI) / 180);
      ctx.translate(-centerX, -centerY);
    }

    let cursorY = boxY + (boxH - wrapped.totalHeightPx) * 0.5;

    for (let i = 0; i < wrapped.lines.length; i += 1) {
      const line = wrapped.lines[i];
      const lineFontPx = baseFontPx * line.scale;
      const lineH = lineFontPx * lineHeightRatio;
      const lineY = cursorY + lineH * 0.5;
      cursorY += lineH;

      ctx.font = `${block.fontStyle || 'normal'} ${fontWeight} ${lineFontPx}px ${fontFamilyCss}`;

      if (block.shadowColor) {
        ctx.save();
        ctx.shadowColor = block.shadowColor;
        ctx.shadowBlur = Math.max(3, lineFontPx * (block.shadowBlurEm ?? 0.16));
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 0;
      }

      if (block.hasTextStroke) {
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = Math.max(1.2, lineFontPx * strokeWidthEm);
        ctx.strokeText(line.text, drawX, lineY);
      }

      if (block.gradientStops && block.gradientStops.length === 2) {
        const grad = ctx.createLinearGradient(
          drawX,
          lineY - lineFontPx * 0.5,
          drawX,
          lineY + lineFontPx * 0.5,
        );
        grad.addColorStop(0, block.gradientStops[0]);
        grad.addColorStop(1, block.gradientStops[1]);
        ctx.fillStyle = grad;
      } else {
        ctx.fillStyle = textColor;
      }

      ctx.fillText(line.text, drawX, lineY);

      if (block.shadowColor) {
        ctx.restore();
      }
    }

    ctx.restore();
  }

  const bakedBlob = await canvasToJpegBlob(canvas);
  return { blob: bakedBlob, ext: 'jpg' };
};

const sanitizeFilenamePart = (value: string): string =>
  value
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]+/g, '')
    .replace(/\s+/g, '-')
    .slice(0, 72) || 'ToonParrot';

export interface DownloadTranslatedChapterZipOptions {
  mangaTitle: string;
  chapterNumber: number | string;
  targetLang: string;
  pages: ResolvedReaderPage[];
  pageStates: Record<number, PageTranslationState>;
  signal?: AbortSignal;
  onProgress?: (completedPages: number, totalPages: number) => void;
}

export const downloadTranslatedChapterAsZip = async ({
  mangaTitle,
  chapterNumber,
  targetLang,
  pages,
  pageStates,
  signal,
  onProgress,
}: DownloadTranslatedChapterZipOptions): Promise<void> => {
  if (pages.length === 0) {
    throw new Error('İndirilecek sayfa bulunamadı.');
  }

  const zipFiles: Array<{ name: string; data: Uint8Array }> = [];
  const padWidth = Math.max(3, String(pages.length).length);

  for (let i = 0; i < pages.length; i += 1) {
    if (signal?.aborted) {
      throw new DOMException('İptal edildi', 'AbortError');
    }

    const pageState = pageStates[i];
    const blocks = pageState?.status === 'done' ? pageState.blocks : undefined;
    const { blob, ext } = await bakeTranslatedPageToBlob(pages[i].src, blocks, targetLang, signal);
    const buffer = await blob.arrayBuffer();
    const pageName = `${String(i + 1).padStart(padWidth, '0')}.${ext}`;
    zipFiles.push({
      name: pageName,
      data: new Uint8Array(buffer),
    });
    onProgress?.(i + 1, pages.length);
  }

  const zipBlob = buildStoredZipBlob(zipFiles);
  const safeSeries = sanitizeFilenamePart(mangaTitle);
  const chNum = formatChapterNumberLabel(chapterNumber);
  const filename = `${safeSeries}-Bolum-${chNum}-${targetLang.toUpperCase()}.zip`;

  const url = URL.createObjectURL(zipBlob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
};

export interface ChapterForSeriesZip {
  chapterNumber: number | string;
  pages: ResolvedReaderPage[];
  pageStates: Record<number, PageTranslationState>;
}

export interface DownloadTranslatedSeriesZipOptions {
  mangaTitle: string;
  targetLang: string;
  chapters: ChapterForSeriesZip[];
  signal?: AbortSignal;
  onProgress?: (info: {
    chapterIndex: number;
    totalChapters: number;
    chapterNumber: number | string;
    pageIndex: number;
    totalPages: number;
  }) => void;
}

export const downloadTranslatedSeriesAsZip = async ({
  mangaTitle,
  targetLang,
  chapters,
  signal,
  onProgress,
}: DownloadTranslatedSeriesZipOptions): Promise<void> => {
  if (chapters.length === 0) {
    throw new Error('İndirilecek bölüm bulunamadı.');
  }

  const zipFiles: Array<{ name: string; data: Uint8Array }> = [];
  const totalChapters = chapters.length;

  for (let chIdx = 0; chIdx < totalChapters; chIdx += 1) {
    if (signal?.aborted) {
      throw new DOMException('İptal edildi', 'AbortError');
    }

    const { chapterNumber, pages, pageStates } = chapters[chIdx];
    const chNum = formatChapterNumberLabel(chapterNumber);
    const padWidth = Math.max(3, String(pages.length).length);

    for (let pIdx = 0; pIdx < pages.length; pIdx += 1) {
      if (signal?.aborted) {
        throw new DOMException('İptal edildi', 'AbortError');
      }

      const pageState = pageStates[pIdx];
      const blocks = pageState?.status === 'done' ? pageState.blocks : undefined;
      const { blob, ext } = await bakeTranslatedPageToBlob(pages[pIdx].src, blocks, targetLang, signal);
      const buffer = await blob.arrayBuffer();
      const pageName = `${String(pIdx + 1).padStart(padWidth, '0')}.${ext}`;
      const filePath = `Bolum-${chNum}/${pageName}`;

      zipFiles.push({
        name: filePath,
        data: new Uint8Array(buffer),
      });

      onProgress?.({
        chapterIndex: chIdx + 1,
        totalChapters,
        chapterNumber,
        pageIndex: pIdx + 1,
        totalPages: pages.length,
      });
    }
  }

  const zipBlob = buildStoredZipBlob(zipFiles);
  const safeSeries = sanitizeFilenamePart(mangaTitle);
  const filename = `${safeSeries}-Cevirili-Bolumler-${targetLang.toUpperCase()}.zip`;

  const url = URL.createObjectURL(zipBlob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
};
