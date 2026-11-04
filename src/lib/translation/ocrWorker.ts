/// <reference lib="webworker" />
/**
 * Yerel OCR Web Worker'ı: PaddleOCR (PP-OCRv3) ONNX modellerini onnxruntime-web (WASM) ile
 * ana iş parçacığını bloklamadan çalıştırır. Görseller hiçbir uzak sunucuya gönderilmez.
 */
import * as ort from 'onnxruntime-web/wasm';
import { runPaddleOcr, type OcrLine, type OcrModelRunner, type OcrRunners } from './ocrCore';

interface OcrJobMessage {
  type: 'ocr';
  id: number;
  width: number;
  height: number;
  buffer: ArrayBuffer;
}

interface OcrCancelMessage {
  type: 'cancel';
  id: number;
}

interface OcrWarmupMessage {
  type: 'warmup';
  id: number;
}

type IncomingMessage = OcrJobMessage | OcrCancelMessage | OcrWarmupMessage;

export interface OcrWorkerResponse {
  id: number;
  ok: boolean;
  lines?: OcrLine[];
  error?: string;
  aborted?: boolean;
}

const MODEL_BASE = '/ocr';
const DET_MODEL = `${MODEL_BASE}/en_PP-OCRv3_det_infer.onnx`;
const REC_MODEL = `${MODEL_BASE}/en_PP-OCRv3_rec_infer.onnx`;
const DICT_PATH = `${MODEL_BASE}/en_dict.txt`;

let runnersPromise: Promise<OcrRunners> | null = null;
const cancelled = new Set<number>();
let queue: Promise<void> = Promise.resolve();

const createRunner = (session: ort.InferenceSession): OcrModelRunner => async (input, dims) => {
  const feeds = { [session.inputNames[0]]: new ort.Tensor('float32', input, dims) };
  const results = await session.run(feeds);
  const out = results[session.outputNames[0]];
  const data = out.data as Float32Array;
  out.dispose?.();
  return { data, dims: out.dims };
};

const loadRunners = (): Promise<OcrRunners> => {
  if (!runnersPromise) {
    runnersPromise = (async () => {
      const origin = self.location.origin;
      ort.env.wasm.wasmPaths = `${origin}/ort/`;
      ort.env.wasm.numThreads = self.crossOriginIsolated
        ? Math.max(1, Math.min(4, (self.navigator.hardwareConcurrency || 2) - 1))
        : 1;
      ort.env.logLevel = 'error';

      const sessionOptions: ort.InferenceSession.SessionOptions = {
        executionProviders: ['wasm'],
        graphOptimizationLevel: 'all',
      };
      const [det, rec, dictText] = await Promise.all([
        ort.InferenceSession.create(`${origin}${DET_MODEL}`, sessionOptions),
        ort.InferenceSession.create(`${origin}${REC_MODEL}`, sessionOptions),
        fetch(`${origin}${DICT_PATH}`).then((r) => {
          if (!r.ok) throw new Error(`OCR sözlüğü yüklenemedi (${r.status})`);
          return r.text();
        }),
      ]);
      const dictLines = dictText.replace(/\r/g, '').split('\n');
      if (dictLines[dictLines.length - 1] === '') dictLines.pop();
      return { det: createRunner(det), rec: createRunner(rec), dictionary: [...dictLines, ' '] };
    })().catch((err) => {
      runnersPromise = null;
      throw err;
    });
  }
  return runnersPromise;
};

const post = (msg: OcrWorkerResponse) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(msg);

self.onmessage = (event: MessageEvent<IncomingMessage>) => {
  const msg = event.data;
  if (msg.type === 'cancel') {
    cancelled.add(msg.id);
    return;
  }

  queue = queue.then(async () => {
    if (cancelled.delete(msg.id)) {
      post({ id: msg.id, ok: false, error: 'İptal edildi', aborted: true });
      return;
    }
    try {
      const runners = await loadRunners();
      if (msg.type === 'warmup') {
        post({ id: msg.id, ok: true, lines: [] });
        return;
      }
      const controller = new AbortController();
      const watcher = setInterval(() => {
        if (cancelled.has(msg.id)) controller.abort();
      }, 50);
      try {
        const lines = await runPaddleOcr(
          { data: new Uint8ClampedArray(msg.buffer), width: msg.width, height: msg.height },
          runners,
          controller.signal,
        );
        post({ id: msg.id, ok: true, lines });
      } finally {
        clearInterval(watcher);
        cancelled.delete(msg.id);
      }
    } catch (err) {
      const aborted = err instanceof DOMException && err.name === 'AbortError';
      post({
        id: msg.id,
        ok: false,
        aborted,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });
};
