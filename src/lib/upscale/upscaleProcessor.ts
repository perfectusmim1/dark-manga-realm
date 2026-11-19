import { OnnxUpscaleEngine } from './onnxEngine';
import type { ModelDownloadProgress, UpscaleJobInput } from './types';
import { WebGLAnime4KEngine } from './webglEngine';
import { WebGPUAnime4KEngine } from './webgpuEngine';

export interface ProcessorHooks {
  onProgress?: (progress: ModelDownloadProgress) => void;
  isCancelled?: () => boolean;
}

export class UpscaleProcessor {
  private webgpuEngine: WebGPUAnime4KEngine | null = null;
  private webglEngine: WebGLAnime4KEngine | null = null;
  private onnxEngine: OnnxUpscaleEngine | null = null;
  private webgpuDisabledForAnime4K = false;

  async process(job: UpscaleJobInput, hooks: ProcessorHooks = {}): Promise<ImageBitmap> {
    try {
      if (job.engine === 'fast' || job.engine === 'quality') {
        const canTryWebGPU =
          job.preferWebGPU !== false &&
          !this.webgpuDisabledForAnime4K &&
          typeof navigator !== 'undefined' &&
          'gpu' in navigator &&
          Boolean(navigator.gpu);

        if (canTryWebGPU) {
          try {
            if (!this.webgpuEngine) {
              this.webgpuEngine = new WebGPUAnime4KEngine();
            }
            return await this.webgpuEngine.upscale({
              bitmap: job.bitmap,
              mode: job.engine,
              outWidth: job.outWidth,
              outHeight: job.outHeight,
              cropTop: job.cropTop,
              cropBottom: job.cropBottom,
            });
          } catch (err) {
            console.warn('[Upscale] WebGPU Anime4K başarısız, WebGL2 yedeğine geçiliyor.', err);
            this.webgpuDisabledForAnime4K = true;
            this.webgpuEngine?.dispose();
            this.webgpuEngine = null;
          }
        }

        if (!this.webglEngine) {
          this.webglEngine = new WebGLAnime4KEngine();
        }
        return await this.webglEngine.upscale({
          bitmap: job.bitmap,
          mode: job.engine,
          outWidth: job.outWidth,
          outHeight: job.outHeight,
          cropTop: job.cropTop,
          cropBottom: job.cropBottom,
        });
      }

      if (!this.onnxEngine) {
        this.onnxEngine = new OnnxUpscaleEngine();
      }
      return await this.onnxEngine.upscale({
        bitmap: job.bitmap,
        model: job.engine,
        outWidth: job.outWidth,
        outHeight: job.outHeight,
        cropTop: job.cropTop,
        cropBottom: job.cropBottom,
        onProgress: hooks.onProgress,
        isCancelled: hooks.isCancelled,
      });
    } finally {
      try {
        job.bitmap.close();
      } catch {
        // already closed or detached
      }
    }
  }

  async dispose(): Promise<void> {
    this.webgpuEngine?.dispose();
    this.webgpuEngine = null;
    this.webglEngine?.dispose();
    this.webglEngine = null;
    await this.onnxEngine?.dispose();
    this.onnxEngine = null;
  }
}
