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
      aborted?: boolean;
      error?: string;
    };

const processor = new UpscaleProcessor();
const cancelledIds = new Set<number>();
let jobQueue: Promise<void> = Promise.resolve();

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

      post({ type: 'result', id: msg.id, ok: true, bitmap: resultBitmap }, [resultBitmap]);
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
