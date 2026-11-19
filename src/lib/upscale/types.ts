export type UpscaleMode = 'off' | 'fast' | 'quality' | 'ai';

export type UpscaleAiModel = 'realesrgan' | 'waifu2x';

export type UpscaleEngineKey = 'fast' | 'quality' | 'realesrgan' | 'waifu2x';

export interface UpscaleSupport {
  webgpu: boolean;
  webgl2: boolean;
  offscreenCanvas: boolean;
  worker: boolean;
  checked: boolean;
}

export interface StripPlan {
  index: number;
  y0: number;
  y1: number;
  validY0: number;
  validY1: number;
  cropTop: number;
  cropBottom: number;
}

export interface TilePlan {
  tx0: number;
  ty0: number;
  tx1: number;
  ty1: number;
  pad: number;
}

export interface ModelDownloadProgress {
  model: UpscaleAiModel;
  loaded: number;
  total: number;
  percent: number;
  stage: 'downloading' | 'initializing' | 'ready' | 'error';
  error?: string;
}

export interface UpscaleRuntimeStatus {
  activeJobs: number;
  queuedJobs: number;
  activeEngine: UpscaleEngineKey | null;
  download: ModelDownloadProgress | null;
  lastError: string | null;
}

export interface UpscaleJobInput {
  id: number;
  bitmap: ImageBitmap;
  engine: UpscaleEngineKey;
  outWidth: number;
  outHeight: number;
  cropTop: number;
  cropBottom: number;
  preferWebGPU?: boolean;
}
