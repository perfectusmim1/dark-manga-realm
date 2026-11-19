/// <reference types="@webgpu/types" />
import type { UpscaleSupport } from './types';

let cachedSupport: UpscaleSupport | null = null;
let supportPromise: Promise<UpscaleSupport> | null = null;

const withTimeout = <T>(promise: Promise<T>, ms: number): Promise<T | null> =>
  new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    promise
      .then((val) => {
        clearTimeout(timer);
        resolve(val);
      })
      .catch(() => {
        clearTimeout(timer);
        resolve(null);
      });
  });

const checkWebGL2Support = (): boolean => {
  try {
    const canvas =
      typeof OffscreenCanvas !== 'undefined'
        ? new OffscreenCanvas(2, 2)
        : typeof document !== 'undefined'
          ? document.createElement('canvas')
          : null;
    if (!canvas) return false;
    const gl = canvas.getContext('webgl2') as WebGL2RenderingContext | null;
    if (!gl) return false;
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return true;
  } catch {
    return false;
  }
};

const checkWebGPUSupport = async (): Promise<boolean> => {
  try {
    if (typeof navigator === 'undefined' || !('gpu' in navigator) || !navigator.gpu) {
      return false;
    }
    const adapter = await withTimeout(navigator.gpu.requestAdapter(), 2500);
    if (!adapter) return false;
    const device = await withTimeout(adapter.requestDevice(), 2500);
    if (!device) return false;
    try {
      device.destroy();
    } catch {
      // ignore destroy error
    }
    return true;
  } catch {
    return false;
  }
};

export const detectUpscaleSupport = async (): Promise<UpscaleSupport> => {
  if (cachedSupport) return cachedSupport;
  if (!supportPromise) {
    supportPromise = (async () => {
      const hasWorker = typeof Worker !== 'undefined';
      const hasOffscreen = typeof OffscreenCanvas !== 'undefined';
      const webgl2 = checkWebGL2Support();
      const webgpu = await checkWebGPUSupport();

      const result: UpscaleSupport = {
        webgpu,
        webgl2,
        offscreenCanvas: hasOffscreen,
        worker: hasWorker,
        checked: true,
      };
      cachedSupport = result;
      return result;
    })();
  }
  return supportPromise;
};

export const getCachedUpscaleSupport = (): UpscaleSupport =>
  cachedSupport ?? {
    webgpu: false,
    webgl2: false,
    offscreenCanvas: typeof OffscreenCanvas !== 'undefined',
    worker: typeof Worker !== 'undefined',
    checked: false,
  };
