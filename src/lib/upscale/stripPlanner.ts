import type { StripPlan, TilePlan } from './types';

export const STRIP_HEIGHT = 1024;
export const STRIP_OVERLAP = 16;
export const AI_TILE_SIZE = 384;
export const AI_TILE_OVERLAP = 12;
export const DEFAULT_MAX_TEX_SIZE = 4096;

/**
 * Uzun dikey webtoon sayfalarını donma ve GPU bellek sınırına takılmaması için
 * örtüşmeli dikey şeritlere böler.
 */
export const planStrips = (
  height: number,
  stripHeight: number = STRIP_HEIGHT,
  overlap: number = STRIP_OVERLAP,
): StripPlan[] => {
  const safeHeight = Math.max(0, Math.floor(height));
  if (safeHeight <= 0) return [];
  const step = Math.max(1, Math.floor(stripHeight));
  const pad = Math.max(0, Math.floor(overlap));

  const strips: StripPlan[] = [];
  let index = 0;
  for (let validY0 = 0; validY0 < safeHeight; validY0 += step) {
    const validY1 = Math.min(validY0 + step, safeHeight);
    const y0 = Math.max(0, validY0 - pad);
    const y1 = Math.min(safeHeight, validY1 + pad);
    strips.push({
      index,
      y0,
      y1,
      validY0,
      validY1,
      cropTop: validY0 - y0,
      cropBottom: y1 - validY1,
    });
    index += 1;
  }
  return strips;
};

/**
 * Bir şeridi ONNX WebGPU bellek sınırlarını (128 MB buffer) aşmayacak
 * örtüşmeli karelere böler.
 */
export const planTiles = (
  width: number,
  height: number,
  tileSize: number = AI_TILE_SIZE,
  overlap: number = AI_TILE_OVERLAP,
): TilePlan[] => {
  const safeW = Math.max(0, Math.floor(width));
  const safeH = Math.max(0, Math.floor(height));
  if (safeW <= 0 || safeH <= 0) return [];
  const step = Math.max(1, Math.floor(tileSize));
  const pad = Math.max(0, Math.floor(overlap));

  const tiles: TilePlan[] = [];
  for (let ty0 = 0; ty0 < safeH; ty0 += step) {
    const ty1 = Math.min(ty0 + step, safeH);
    for (let tx0 = 0; tx0 < safeW; tx0 += step) {
      const tx1 = Math.min(tx0 + step, safeW);
      tiles.push({ tx0, ty0, tx1, ty1, pad });
    }
  }
  return tiles;
};

/**
 * Akıllı atlama: Ekranda zaten kaynak görselden daha az fiziksel piksel varsa
 * ve "yüksek çözünürlüklü sayfaları da işle" kapalıysa sayfa atlanır.
 */
export const shouldSkipHighResPage = (
  naturalWidth: number,
  clientWidth: number,
  dpr: number,
  upscaleHighRes: boolean,
): boolean => {
  if (upscaleHighRes) return false;
  if (naturalWidth <= 0 || clientWidth <= 0) return false;
  const effectiveDpr = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
  const screenPx = Math.ceil(clientWidth * effectiveDpr);
  return naturalWidth >= screenPx;
};

export interface StripSizeResult {
  inputWidth: number;
  inputScale: number;
  outWidth: number;
  outHeight: number;
}

/**
 * Şerit giriş ve çıkış piksel boyutlarını hesaplar; GPU doku üst sınırını (maxTexSize) aşmaz.
 */
export const computeStripOutputSize = (
  srcW: number,
  validH: number,
  _screenPx: number,
  maxTexSize: number = DEFAULT_MAX_TEX_SIZE,
): StripSizeResult => {
  const safeSrcW = Math.max(1, Math.floor(srcW));
  const safeValidH = Math.max(1, Math.floor(validH));
  const safeMaxTex = Math.max(256, Math.floor(maxTexSize));
  const maxInputW = Math.max(1, Math.floor(safeMaxTex / 2));

  const inputWidth = Math.min(safeSrcW, maxInputW);
  const inputScale = inputWidth / safeSrcW;

  // Ara yeniden örnekleme (downscale) bulanıklığını önlemek için modelin doğal 2x çıktısını koru
  const outWidth = Math.max(1, Math.min(inputWidth * 2, safeMaxTex));
  const scaleFromOriginal = outWidth / safeSrcW;
  const outHeight = Math.max(1, Math.min(Math.round(safeValidH * scaleFromOriginal), safeMaxTex));

  return { inputWidth, inputScale, outWidth, outHeight };
};

const assertCond = (cond: boolean, message: string): void => {
  if (!cond) {
    throw new Error(`[stripPlanner self-check failed] ${message}`);
  }
};

/**
 * Şerit ve karo bölümleme algoritmalarının boşluk/taşma yapmadığını doğrulayan self-check.
 */
export const runStripPlannerSelfCheck = (): void => {
  for (const h of [1, 500, 1024, 1025, 2048, 15000]) {
    const strips = planStrips(h);
    assertCond(strips.length > 0, `expected strips for h=${h}`);
    assertCond(strips[0].validY0 === 0, `first strip validY0 !== 0 for h=${h}`);
    assertCond(strips[strips.length - 1].validY1 === h, `last strip validY1 !== ${h}`);
    for (let i = 0; i < strips.length; i += 1) {
      const s = strips[i];
      assertCond(s.index === i, `strip index mismatch at ${i}`);
      assertCond(s.y0 >= 0 && s.y1 <= h, `strip bounds out of range at ${i}`);
      assertCond(s.validY0 >= s.y0 && s.validY1 <= s.y1, `valid bounds outside strip at ${i}`);
      assertCond(s.validY1 > s.validY0, `empty valid strip at ${i}`);
      assertCond(s.cropTop === s.validY0 - s.y0, `cropTop mismatch at ${i}`);
      assertCond(s.cropBottom === s.y1 - s.validY1, `cropBottom mismatch at ${i}`);
      assertCond(s.y1 - s.y0 <= STRIP_HEIGHT + STRIP_OVERLAP * 2, `strip too tall at ${i}`);
      if (i > 0) {
        assertCond(s.validY0 === strips[i - 1].validY1, `gap or overlap in valid strips at ${i}`);
      }
    }
  }

  for (const [w, h] of [
    [17, 33],
    [256, 256],
    [800, 1056],
    [512, 1024],
  ] as const) {
    const tiles = planTiles(w, h);
    assertCond(tiles.length > 0, `expected tiles for ${w}x${h}`);
    let coveredArea = 0;
    for (const t of tiles) {
      assertCond(t.tx0 >= 0 && t.ty0 >= 0 && t.tx1 <= w && t.ty1 <= h, `tile bounds invalid for ${w}x${h}`);
      assertCond(t.tx1 > t.tx0 && t.ty1 > t.ty0, `empty tile for ${w}x${h}`);
      assertCond(t.tx1 - t.tx0 <= AI_TILE_SIZE && t.ty1 - t.ty0 <= AI_TILE_SIZE, `tile too large`);
      coveredArea += (t.tx1 - t.tx0) * (t.ty1 - t.ty0);
    }
    assertCond(coveredArea === w * h, `tile area ${coveredArea} !== ${w * h}`);
  }

  assertCond(shouldSkipHighResPage(1200, 390, 3, false) === true, '1200 >= 1170 should skip');
  assertCond(shouldSkipHighResPage(800, 390, 3, false) === false, '800 < 1170 should process');
  assertCond(shouldSkipHighResPage(1200, 390, 3, true) === false, 'upscaleHighRes override failed');

  const wide = computeStripOutputSize(5000, 1024, 1440, 4096);
  assertCond(wide.inputWidth <= 2048, 'wide input must cap at maxTexSize/2');
  assertCond(wide.outWidth <= 4096 && wide.outHeight <= 4096, 'output must stay within maxTexSize');
};
