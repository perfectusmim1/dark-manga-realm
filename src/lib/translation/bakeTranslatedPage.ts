import { formatChapterNumberLabel } from '@/lib/chapterTitle';
import { ResolvedReaderPage } from '@/lib/types';
import {
  ensureScanlationFontReady,
  formatScanlationText,
  SCANLATION_FONT_FAMILY,
  simulateWrappedLines,
} from './bubbleInpainter';
import { fetchTranslatableImageBlob, loadImageElementFromBlob } from './geminiTranslator';
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

const mimeToExtension = (mimeType: string): string => {
  const normalized = mimeType.toLowerCase();
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

// Sayfa görselinin tam çözünürlüklü kopyası üzerine piksel-inpaint yamalarını ve Shantell Sans
// scanlation dizgisini doğrudan işleyerek indirilebilir görsel üretir.
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

  // 2. Katman: Shantell Sans çizgi roman dizgisi
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
    const fontPx = Math.max(11, (fontSizeCqw / 100) * width);
    ctx.font = `700 ${fontPx}px ${SCANLATION_FONT_FAMILY}`;

    const { lines } = simulateWrappedLines(ctx, displayText, boxW, fontPx);
    if (lines.length === 0) continue;

    const lineHeight = fontPx * 1.22;
    const totalTextH = lines.length * lineHeight;
    const centerX = boxX + boxW * 0.5;
    const startY = boxY + (boxH - totalTextH) * 0.5 + lineHeight * 0.5;
    const textColor = block.textColor || (block.isDark ? '#fafafa' : '#0c0c0c');

    for (let i = 0; i < lines.length; i += 1) {
      const lineY = startY + i * lineHeight;
      if (block.hasTextStroke) {
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = Math.max(2.5, fontPx * 0.22);
        ctx.strokeText(lines[i], centerX, lineY);
      }
      ctx.fillStyle = textColor;
      ctx.fillText(lines[i], centerX, lineY);
    }
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
