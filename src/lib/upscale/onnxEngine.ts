/// <reference types="@webgpu/types" />
import { AI_TILE_OVERLAP, AI_TILE_SIZE, planTiles } from './stripPlanner';
import type { ModelDownloadProgress, UpscaleAiModel } from './types';

type OrtWebGpuModule = typeof import('onnxruntime-web/webgpu');

interface OnnxModelSpec {
  id: UpscaleAiModel;
  url: string;
  tileSize: number;
  tileOverlap: number;
  modelInputShrink: number;
  inputName: string;
  outputName: string;
}

const MODEL_SPECS: Record<UpscaleAiModel, OnnxModelSpec> = {
  realesrgan: {
    id: 'realesrgan',
    url: '/models/realesr-animevideo-x2.onnx',
    tileSize: AI_TILE_SIZE,
    tileOverlap: AI_TILE_OVERLAP,
    modelInputShrink: 0,
    inputName: 'input',
    outputName: 'output',
  },
};

const modelBytesCache = new Map<UpscaleAiModel, Uint8Array>();

const fetchModelBytesWithProgress = async (
  spec: OnnxModelSpec,
  onProgress?: (progress: ModelDownloadProgress) => void,
): Promise<Uint8Array> => {
  const cached = modelBytesCache.get(spec.id);
  if (cached) {
    return cached;
  }

  const origin = typeof self !== 'undefined' && self.location ? self.location.origin : '';
  const url = spec.url.startsWith('http') ? spec.url : `${origin}${spec.url}`;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Model indirilemedi (${response.status})`);
  }

  const totalHeader = Number(response.headers.get('content-length') || 0);
  const total = Number.isFinite(totalHeader) && totalHeader > 0 ? totalHeader : 0;

  onProgress?.({
    model: spec.id,
    loaded: 0,
    total,
    percent: 0,
    stage: 'downloading',
  });

  if (!response.body) {
    const buf = new Uint8Array(await response.arrayBuffer());
    modelBytesCache.clear();
    modelBytesCache.set(spec.id, buf);
    return buf;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  let lastPercent = -1;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value && value.byteLength > 0) {
      chunks.push(value);
      loaded += value.byteLength;
      const percent = total > 0 ? Math.min(99, Math.round((loaded / total) * 100)) : 0;
      if (percent !== lastPercent) {
        lastPercent = percent;
        onProgress?.({
          model: spec.id,
          loaded,
          total,
          percent,
          stage: 'downloading',
        });
      }
    }
  }

  const merged = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }

  modelBytesCache.clear();
  modelBytesCache.set(spec.id, merged);
  return merged;
};

export interface OnnxRunOptions {
  bitmap: ImageBitmap;
  model: UpscaleAiModel;
  outWidth: number;
  outHeight: number;
  cropTop: number;
  cropBottom: number;
  onProgress?: (progress: ModelDownloadProgress) => void;
  isCancelled?: () => boolean;
}

export class OnnxUpscaleEngine {
  private ort: OrtWebGpuModule | null = null;
  private ortPromise: Promise<OrtWebGpuModule> | null = null;
  private activeModel: UpscaleAiModel | null = null;
  private activeSession: import('onnxruntime-web/webgpu').InferenceSession | null = null;
  private loadingPromise: Promise<import('onnxruntime-web/webgpu').InferenceSession> | null = null;
  private scratchCanvas: OffscreenCanvas | HTMLCanvasElement | null = null;
  private tileCanvas: OffscreenCanvas | HTMLCanvasElement | null = null;
  private outCanvas: OffscreenCanvas | HTMLCanvasElement | null = null;
  private reusedInputFloat: Float32Array | null = null;
  private reusedTileRgba: Uint8ClampedArray | null = null;

  private shrinkScratchCanvases(): void {
    for (const c of [this.scratchCanvas, this.tileCanvas, this.outCanvas]) {
      if (c) {
        c.width = 1;
        c.height = 1;
      }
    }
  }

  private async ensureOrt(): Promise<OrtWebGpuModule> {
    if (this.ort) return this.ort;
    if (!this.ortPromise) {
      this.ortPromise = import('onnxruntime-web/webgpu')
        .then((mod) => {
          const origin = typeof self !== 'undefined' && self.location ? self.location.origin : '';
          mod.env.wasm.wasmPaths = `${origin}/ort/`;
          mod.env.wasm.simd = true;
          mod.env.wasm.numThreads = 1;
          mod.env.logLevel = 'error';
          this.ort = mod;
          return mod;
        })
        .catch((err) => {
          this.ortPromise = null;
          throw err;
        });
    }
    return this.ortPromise;
  }

  private createCanvas(width: number, height: number): OffscreenCanvas | HTMLCanvasElement {
    if (typeof OffscreenCanvas !== 'undefined') {
      return new OffscreenCanvas(width, height);
    }
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }

  private getCanvas2d(
    canvas: OffscreenCanvas | HTMLCanvasElement,
    width: number,
    height: number,
    willReadFrequently = false,
  ): OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D {
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently }) as
      | OffscreenCanvasRenderingContext2D
      | CanvasRenderingContext2D
      | null;
    if (!ctx) throw new Error('2D canvas bağlamı oluşturulamadı');
    return ctx;
  }

  private async ensureSession(
    model: UpscaleAiModel,
    onProgress?: (progress: ModelDownloadProgress) => void,
  ): Promise<import('onnxruntime-web/webgpu').InferenceSession> {
    if (this.activeSession && this.activeModel === model) {
      return this.activeSession;
    }

    if (this.loadingPromise) {
      await this.loadingPromise.catch(() => {});
      if (this.activeSession && this.activeModel === model) {
        return this.activeSession;
      }
    }

    const spec = MODEL_SPECS[model];
    const promise = (async () => {
      if (this.activeSession) {
        try {
          await this.activeSession.release();
        } catch {
          // ignore release error
        }
        this.activeSession = null;
        this.activeModel = null;
      }

      const [ort, bytes] = await Promise.all([
        this.ensureOrt(),
        fetchModelBytesWithProgress(spec, onProgress),
      ]);

      onProgress?.({
        model,
        loaded: bytes.byteLength,
        total: bytes.byteLength,
        percent: 100,
        stage: 'initializing',
      });

      const session = await ort.InferenceSession.create(bytes, {
        executionProviders: ['webgpu'],
        graphOptimizationLevel: 'all',
      });

      this.activeModel = model;
      this.activeSession = session;

      onProgress?.({
        model,
        loaded: bytes.byteLength,
        total: bytes.byteLength,
        percent: 100,
        stage: 'ready',
      });

      return session;
    })()
      .catch((err) => {
        onProgress?.({
          model,
          loaded: 0,
          total: 0,
          percent: 0,
          stage: 'error',
          error: err instanceof Error ? err.message : String(err),
        });
        throw err;
      })
      .finally(() => {
        this.loadingPromise = null;
      });

    this.loadingPromise = promise;
    return promise;
  }

  async upscale(opts: OnnxRunOptions): Promise<ImageBitmap> {
    const { bitmap, model, outWidth, outHeight, cropTop, cropBottom, onProgress, isCancelled } = opts;
    const spec = MODEL_SPECS[model];
    const session = await this.ensureSession(model, onProgress);
    const ort = await this.ensureOrt();

    if (isCancelled?.()) {
      throw new DOMException('İptal edildi', 'AbortError');
    }

    const srcW = bitmap.width;
    const srcH = bitmap.height;

    if (!this.scratchCanvas) {
      this.scratchCanvas = this.createCanvas(srcW, srcH);
    }
    const srcCtx = this.getCanvas2d(this.scratchCanvas, srcW, srcH, true);
    srcCtx.clearRect(0, 0, srcW, srcH);
    srcCtx.drawImage(bitmap, 0, 0);
    const srcRgba = srcCtx.getImageData(0, 0, srcW, srcH).data;
    // Kaynak piksel dizisi alındıktan sonra scratchCanvas VRAM/RAM belleğini hemen küçült
    this.scratchCanvas.width = 1;
    this.scratchCanvas.height = 1;

    const fullOutW = srcW * 2;
    const fullOutH = srcH * 2;
    if (!this.tileCanvas) {
      this.tileCanvas = this.createCanvas(fullOutW, fullOutH);
    }
    const fullCtx = this.getCanvas2d(this.tileCanvas, fullOutW, fullOutH, false);
    fullCtx.clearRect(0, 0, fullOutW, fullOutH);

    const tiles = planTiles(srcW, srcH, spec.tileSize, spec.tileOverlap);
    const margin = (spec.tileOverlap - spec.modelInputShrink) * 2;

    // Sabit karo boyutu: WebGPU her karoda yeniden shader derlemesin ve ekstra VRAM tahsis etmesin
    const fixedInW = spec.tileSize + spec.tileOverlap * 2;
    const fixedInH = spec.tileSize + spec.tileOverlap * 2;
    const planeSize = fixedInW * fixedInH;
    const requiredFloatLen = 3 * planeSize;
    if (!this.reusedInputFloat || this.reusedInputFloat.length !== requiredFloatLen) {
      this.reusedInputFloat = new Float32Array(requiredFloatLen);
    }
    const inputFloat = this.reusedInputFloat;

    const maxCoreOutW = spec.tileSize * 2;
    const maxCoreOutH = spec.tileSize * 2;
    const requiredTileRgbaLen = maxCoreOutW * maxCoreOutH * 4;
    if (!this.reusedTileRgba || this.reusedTileRgba.length !== requiredTileRgbaLen) {
      this.reusedTileRgba = new Uint8ClampedArray(requiredTileRgbaLen);
    }
    const tileRgba = this.reusedTileRgba;

    for (let tIdx = 0; tIdx < tiles.length; tIdx += 1) {
      if (isCancelled?.()) {
        this.shrinkScratchCanvases();
        throw new DOMException('İptal edildi', 'AbortError');
      }

      // Karolar arasında GPU kuyruğuna kısa nefes ver (kaydırma ve UI akıcılığını korur)
      if (tIdx > 0) {
        await new Promise((resolve) => setTimeout(resolve, 6));
        if (isCancelled?.()) {
          this.shrinkScratchCanvases();
          throw new DOMException('İptal edildi', 'AbortError');
        }
      }

      const tile = tiles[tIdx];
      const coreW = tile.tx1 - tile.tx0;
      const coreH = tile.ty1 - tile.ty0;
      const inX0 = tile.tx0 - tile.pad;
      const inY0 = tile.ty0 - tile.pad;

      for (let py = 0; py < fixedInH; py += 1) {
        const sy = Math.min(srcH - 1, Math.max(0, inY0 + py));
        const srcRowOffset = sy * srcW;
        const dstRowOffset = py * fixedInW;
        for (let px = 0; px < fixedInW; px += 1) {
          const sx = Math.min(srcW - 1, Math.max(0, inX0 + px));
          const sIdx = (srcRowOffset + sx) * 4;
          const dIdx = dstRowOffset + px;
          inputFloat[dIdx] = srcRgba[sIdx] / 255;
          inputFloat[planeSize + dIdx] = srcRgba[sIdx + 1] / 255;
          inputFloat[planeSize * 2 + dIdx] = srcRgba[sIdx + 2] / 255;
        }
      }

      const inputTensor = new ort.Tensor('float32', inputFloat, [1, 3, fixedInH, fixedInW]);
      let outTensor: import('onnxruntime-web/webgpu').Tensor | null = null;
      try {
        const results = await session.run({ [spec.inputName]: inputTensor });
        outTensor = results[spec.outputName] ?? Object.values(results)[0] ?? null;
        if (!outTensor) {
          throw new Error('ONNX çıktı tensörü alınamadı');
        }

        const rawData = await outTensor.getData();
        const outFloat = rawData as Float32Array;
        const dims = outTensor.dims;
        const outTileH = Number(dims[2]);
        const outTileW = Number(dims[3]);
        const outPlane = outTileW * outTileH;

        const coreOutW = coreW * 2;
        const coreOutH = coreH * 2;
        const dstX0 = tile.tx0 * 2;
        const dstY0 = tile.ty0 * 2;

        for (let y = 0; y < coreOutH; y += 1) {
          const oy = margin + y;
          const outTileRow = oy * outTileW + margin;
          const tileRgbaRow = y * coreOutW * 4;
          for (let x = 0; x < coreOutW; x += 1) {
            const oIdx = outTileRow + x;
            const rgbaIdx = tileRgbaRow + x * 4;
            const r = outFloat[oIdx];
            const g = outFloat[outPlane + oIdx];
            const b = outFloat[outPlane * 2 + oIdx];
            tileRgba[rgbaIdx] = r <= 0 ? 0 : r >= 1 ? 255 : Math.round(r * 255);
            tileRgba[rgbaIdx + 1] = g <= 0 ? 0 : g >= 1 ? 255 : Math.round(g * 255);
            tileRgba[rgbaIdx + 2] = b <= 0 ? 0 : b >= 1 ? 255 : Math.round(b * 255);
            tileRgba[rgbaIdx + 3] = 255;
          }
        }

        const subView = tileRgba.subarray(0, coreOutW * coreOutH * 4);
        const tileImgData = new ImageData(subView, coreOutW, coreOutH);
        fullCtx.putImageData(tileImgData, dstX0, dstY0);
      } finally {
        inputTensor.dispose();
        outTensor?.dispose();
      }
    }

    if (isCancelled?.()) {
      this.shrinkScratchCanvases();
      throw new DOMException('İptal edildi', 'AbortError');
    }

    const cropY0 = Math.min(fullOutH - 1, Math.max(0, Math.round(cropTop * 2)));
    const cropH = Math.max(1, fullOutH - cropY0 - Math.max(0, Math.round(cropBottom * 2)));

    if (!this.outCanvas) {
      this.outCanvas = this.createCanvas(outWidth, outHeight);
    }
    const outCtx = this.getCanvas2d(this.outCanvas, outWidth, outHeight, false);
    outCtx.imageSmoothingEnabled = true;
    outCtx.imageSmoothingQuality = 'high';
    outCtx.clearRect(0, 0, outWidth, outHeight);
    outCtx.drawImage(this.tileCanvas, 0, cropY0, fullOutW, cropH, 0, 0, outWidth, outHeight);

    // tileCanvas ile işimiz bitti, hemen 1x1 yaparak ~12 MB belleği serbest bırak
    this.tileCanvas.width = 1;
    this.tileCanvas.height = 1;

    if (typeof OffscreenCanvas !== 'undefined' && this.outCanvas instanceof OffscreenCanvas) {
      const bmp = this.outCanvas.transferToImageBitmap();
      this.outCanvas.width = 1;
      this.outCanvas.height = 1;
      return bmp;
    }
    const bmp = await createImageBitmap(this.outCanvas as HTMLCanvasElement);
    this.outCanvas.width = 1;
    this.outCanvas.height = 1;
    return bmp;
  }

  async dispose(): Promise<void> {
    if (this.activeSession) {
      try {
        await this.activeSession.release();
      } catch {
        // ignore release error
      }
    }
    this.activeSession = null;
    this.activeModel = null;
    this.shrinkScratchCanvases();
    this.scratchCanvas = null;
    this.tileCanvas = null;
    this.outCanvas = null;
    this.reusedInputFloat = null;
    this.reusedTileRgba = null;
    modelBytesCache.clear();
  }
}
