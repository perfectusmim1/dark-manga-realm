/// <reference lib="webworker" />
import type { ModelDownloadProgress, UpscaleEngineKey } from './types';
import { UpscaleProcessor } from './upscaleProcessor';

export interface UpscaleWorkerProcessMessage {
  type: 'process';
  id: number;
  bitmap: ImageBitmap;
  engine: UpscaleEngineKey;
  outWidth: number;
  outHeight: number;
  cropTop: number;
  cropBottom: number;
  preferWebGPU: boolean;
}

export interface UpscaleWorkerCancelMessage {
  type: 'cancel';
  id: number;
}

export interface UpscaleWorkerDisposeMessage {
  type: 'dispose';
}

export type UpscaleWorkerIncoming =
  | UpscaleWorkerProcessMessage
  | UpscaleWorkerCancelMessage
  | UpscaleWorkerDisposeMessage;

export type UpscaleWorkerOutgoing =
  | {
      type: 'progress';
      progress: ModelDownloadProgress;
    }
  | {
      type: 'result';
      id: number;
      ok: boolean;
      bitmap?: ImageBitmap;
      blob?: Blob;
      aborted?: boolean;
      error?: string;
    };

const processor = new UpscaleProcessor();
const cancelledIds = new Set<number>();
let jobQueue: Promise<void> = Promise.resolve();
let workerEncodeCanvas: OffscreenCanvas | null = null;
let workerBlobMime: { type: string; quality: number } | null = null;

const encodeBitmapInWorker = async (bitmap: ImageBitmap): Promise<Blob | undefined> => {
  if (typeof OffscreenCanvas === 'undefined') return undefined;
  try {
    if (!workerBlobMime) {
      const probe = new OffscreenCanvas(1, 1);
      const pCtx = probe.getContext('2d');
      pCtx?.fillRect(0, 0, 1, 1);
      const testBlob = await probe.convertToBlob({ type: 'image/webp', quality: 0.86 });
      workerBlobMime =
        testBlob.type === 'image/webp'
          ? { type: 'image/webp', quality: 0.86 }
          : { type: 'image/jpeg', quality: 0.9 };
    }
    if (!workerEncodeCanvas) {
      workerEncodeCanvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    } else {
      workerEncodeCanvas.width = bitmap.width;
      workerEncodeCanvas.height = bitmap.height;
    }
    const ctx = workerEncodeCanvas.getContext('2d');
    if (!ctx) return undefined;
    ctx.clearRect(0, 0, bitmap.width, bitmap.height);
    ctx.drawImage(bitmap, 0, 0);
    const blob = await workerEncodeCanvas.convertToBlob(workerBlobMime);
    // Hemen 1x1'e küçülterek ~11 MB geçici canvas belleğini serbest bırak
    workerEncodeCanvas.width = 1;
    workerEncodeCanvas.height = 1;
    return blob;
  } catch {
    if (workerEncodeCanvas) {
      workerEncodeCanvas.width = 1;
      workerEncodeCanvas.height = 1;
    }
    return undefined;
  }
};

const post = (msg: UpscaleWorkerOutgoing, transfer?: Transferable[]) => {
  const scope = self as unknown as DedicatedWorkerGlobalScope;
  if (transfer && transfer.length > 0) {
    scope.postMessage(msg, transfer);
  } else {
    scope.postMessage(msg);
  }
};

self.onmessage = (event: MessageEvent<UpscaleWorkerIncoming>) => {
  const msg = event.data;

  if (msg.type === 'cancel') {
    cancelledIds.add(msg.id);
    return;
  }

  if (msg.type === 'dispose') {
    jobQueue = jobQueue.then(async () => {
      cancelledIds.clear();
      await processor.dispose();
    });
    return;
  }

  jobQueue = jobQueue.then(async () => {
    if (cancelledIds.delete(msg.id)) {
      try {
        msg.bitmap.close();
      } catch {
        // ignore
      }
      post({ type: 'result', id: msg.id, ok: false, aborted: true });
      return;
    }

    try {
      const resultBitmap = await processor.process(
        {
          id: msg.id,
          bitmap: msg.bitmap,
          engine: msg.engine,
          outWidth: msg.outWidth,
          outHeight: msg.outHeight,
          cropTop: msg.cropTop,
          cropBottom: msg.cropBottom,
          preferWebGPU: msg.preferWebGPU,
        },
        {
          onProgress: (progress) => post({ type: 'progress', progress }),
          isCancelled: () => cancelledIds.has(msg.id),
        },
      );

      if (cancelledIds.delete(msg.id)) {
        try {
          resultBitmap.close();
        } catch {
          // ignore
        }
        post({ type: 'result', id: msg.id, ok: false, aborted: true });
        return;
      }

      const blob = await encodeBitmapInWorker(resultBitmap);

      if (cancelledIds.delete(msg.id)) {
        try {
          resultBitmap.close();
        } catch {
          // ignore
        }
        post({ type: 'result', id: msg.id, ok: false, aborted: true });
        return;
      }

      post({ type: 'result', id: msg.id, ok: true, bitmap: resultBitmap, blob }, [resultBitmap]);
    } catch (err) {
      const wasCancelled = cancelledIds.delete(msg.id);
      const aborted = wasCancelled || (err instanceof DOMException && err.name === 'AbortError');
      post({
        type: 'result',
        id: msg.id,
        ok: false,
        aborted,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });
};
