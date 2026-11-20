/// <reference lib="webworker" />
/**
 * Yerel OCR Web Worker'ı: PaddleOCR (PP-OCRv3) ONNX modellerini onnxruntime-web (WASM) ile
 * ana iş parçacığını bloklamadan çalıştırır. Görseller hiçbir uzak sunucuya gönderilmez.
 */
import * as ort from 'onnxruntime-web/wasm';
import {
  runPaddleOcr,
  type OcrLine,
  type OcrModelRunner,
  type OcrRecognizerPack,
  type OcrRunners,
  type OcrScriptId,
} from './ocrCore';

interface OcrJobMessage {
  type: 'ocr';
  id: number;
  width: number;
  height: number;
  buffer: ArrayBuffer;
  preferredScript?: OcrScriptId;
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
  detectedScript?: OcrScriptId;
  buffer?: ArrayBuffer;
  error?: string;
  aborted?: boolean;
}

const MODEL_BASE = '/ocr';
const DET_MODEL = `${MODEL_BASE}/en_PP-OCRv3_det_infer.onnx`;
const OCR_CACHE_NAME = 'toonparrot-ocr-models-v5';

const SCRIPT_SOURCES: Record<
  OcrScriptId,
  {
    recUrl: (origin: string) => string;
    dictUrl: (origin: string) => string;
    remote?: boolean;
  }
> = {
  en: {
    recUrl: (origin) => `${origin}${MODEL_BASE}/en_PP-OCRv3_rec_infer.onnx`,
    dictUrl: (origin) => `${origin}${MODEL_BASE}/en_dict.txt`,
  },
  korean: {
    recUrl: () =>
      'https://huggingface.co/monkt/paddleocr-onnx/resolve/main/languages/korean/rec.onnx',
    dictUrl: () =>
      'https://huggingface.co/monkt/paddleocr-onnx/resolve/main/languages/korean/dict.txt',
    remote: true,
  },
  cjk: {
    recUrl: () =>
      'https://huggingface.co/bluecopa/rapidocr-onnx/resolve/main/ch_PP-OCRv5_rec_mobile_infer.onnx',
    dictUrl: () =>
      'https://huggingface.co/bluecopa/rapidocr-onnx/resolve/main/ppocrv5_dict.txt',
    remote: true,
  },
};

let detRunnerPromise: Promise<OcrModelRunner> | null = null;
const recPackCache = new Map<OcrScriptId, Promise<OcrRecognizerPack>>();
let activeScript: OcrScriptId = 'en';
let ortConfigured = false;
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

const getSessionOptions = (): ort.InferenceSession.SessionOptions => {
  if (!ortConfigured) {
    const origin = self.location.origin;
    ort.env.wasm.wasmPaths = `${origin}/ort/`;
    ort.env.wasm.simd = true;
    ort.env.wasm.numThreads = self.crossOriginIsolated
      ? Math.max(1, Math.min(4, (self.navigator.hardwareConcurrency || 2) - 1))
      : 1;
    ort.env.logLevel = 'error';
    ortConfigured = true;
  }
  return {
    executionProviders: ['wasm'],
    graphOptimizationLevel: 'all',
    enableMemPattern: false,
  };
};

const fetchCachedResponse = async (url: string): Promise<Response> => {
  if (typeof caches !== 'undefined') {
    try {
      const cache = await caches.open(OCR_CACHE_NAME);
      const hit = await cache.match(url);
      if (hit && hit.ok) return hit;
      const res = await fetch(url, { mode: 'cors' });
      if (!res.ok) throw new Error(`OCR kaynağı yüklenemedi (${res.status}): ${url}`);
      void cache.put(url, res.clone()).catch(() => {});
      return res;
    } catch {
      // Cache API kullanılamıyorsa doğrudan ağdan indir
    }
  }
  const res = await fetch(url, { mode: 'cors' });
  if (!res.ok) throw new Error(`OCR kaynağı yüklenemedi (${res.status}): ${url}`);
  return res;
};

const parseDictText = (dictText: string): string[] => {
  const dictLines = dictText.replace(/\r/g, '').split('\n');
  if (dictLines[dictLines.length - 1] === '') dictLines.pop();
  return [...dictLines, ' '];
};

const loadDetRunner = (): Promise<OcrModelRunner> => {
  if (!detRunnerPromise) {
    detRunnerPromise = (async () => {
      const origin = self.location.origin;
      const sessionOptions = getSessionOptions();
      const det = await ort.InferenceSession.create(`${origin}${DET_MODEL}`, sessionOptions);
      console.info(`[ToonParrot OCR] Det modeli yüklendi: ${DET_MODEL}`);
      return createRunner(det);
    })().catch((err) => {
      detRunnerPromise = null;
      throw err;
    });
  }
  return detRunnerPromise;
};

const loadRecognizerPack = (script: OcrScriptId): Promise<OcrRecognizerPack> => {
  const existing = recPackCache.get(script);
  if (existing) return existing;

  const job = (async () => {
    const origin = self.location.origin;
    const sessionOptions = getSessionOptions();
    const src = SCRIPT_SOURCES[script];
    const recUrl = src.recUrl(origin);
    const dictUrl = src.dictUrl(origin);

    const [recSession, dictText] = src.remote
      ? await Promise.all([
          fetchCachedResponse(recUrl)
            .then((r) => r.arrayBuffer())
            .then((buf) => ort.InferenceSession.create(new Uint8Array(buf), sessionOptions)),
          fetchCachedResponse(dictUrl).then((r) => r.text()),
        ])
      : await Promise.all([
          ort.InferenceSession.create(recUrl, sessionOptions),
          fetch(dictUrl).then((r) => {
            if (!r.ok) throw new Error(`OCR sözlüğü yüklenemedi (${r.status})`);
            return r.text();
          }),
        ]);

    console.info(`[ToonParrot OCR] Rec modeli yüklendi (${script}): ${recUrl}`);
    return {
      rec: createRunner(recSession),
      dictionary: parseDictText(dictText),
    };
  })().catch((err) => {
    recPackCache.delete(script);
    throw err;
  });

  recPackCache.set(script, job);
  return job;
};

const loadRunners = async (preferredScript?: OcrScriptId): Promise<OcrRunners> => {
  const startScript: OcrScriptId = preferredScript ?? activeScript;
  const [det, primaryPack] = await Promise.all([
    loadDetRunner(),
    loadRecognizerPack(startScript).catch(() => loadRecognizerPack('en')),
  ]);
  activeScript = startScript;
  return {
    det,
    rec: primaryPack.rec,
    dictionary: primaryPack.dictionary,
    activeScript: startScript,
    loadRecognizer: async (script: OcrScriptId) => {
      try {
        return await loadRecognizerPack(script);
      } catch (err) {
        console.warn(`[OCR] ${script} tanıma modeli yüklenemedi:`, err);
        return null;
      }
    },
    onScriptSelected: (script: OcrScriptId) => {
      activeScript = script;
    },
  };
};

const post = (msg: OcrWorkerResponse, transfer?: Transferable[]) => {
  const scope = self as unknown as DedicatedWorkerGlobalScope;
  if (transfer && transfer.length > 0) {
    scope.postMessage(msg, transfer);
  } else {
    scope.postMessage(msg);
  }
};

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
      const runners = await loadRunners(msg.type === 'ocr' ? msg.preferredScript : undefined);
      if (msg.type === 'warmup') {
        post({ id: msg.id, ok: true, lines: [], detectedScript: activeScript });
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
        post(
          { id: msg.id, ok: true, lines, detectedScript: activeScript, buffer: msg.buffer },
          [msg.buffer],
        );
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
