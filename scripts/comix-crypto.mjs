/**
 * Comix.to Custom Binary/Stream Cipher & Request Signing Engine (Node.js / ESM)
 * Supports Comix to40oy / to260x API v1 protocol with automatic bundle key refresh.
 */
import dns from 'node:dns';
try {
  dns.setDefaultResultOrder('verbatim');
} catch {}

let KID = 'mxq';

let MATERIAL = new Uint8Array([
  2,217,185,56,165,189,6,86,181,168,207,35,84,240,209,102,90,250,11,127,
  122,180,245,51,56,238,139,8,140,23,40,6,80,17,241,227,235,3,117,85,
  172,137,67,6,212,98,147,107,98,34,199,32,141,177,69,172,68,231,120,191,
  182,64,105,151,224,54,186,70,126,165,155,208,225,235,54,54,240,72,29,202,
  217,8,239,188,98,150,141,204,135,18,200,213,149,162,86,209,115,50,146,97,
  45,54,110,139,191,21,98,199,28,171,100,115,52,26,150,215,77,146,14,149,
  136,24,86,109,245,9,96,221,202,238,52,3,99,0,53,175,236,178,88,17,
  180,8,164,172,143,136,139,111,26,82,143,187,101,50,129,6,60,211,67,176,
  64,11,7,61,199,181,122,193,160,222,136,16,28,151,228,223,90,98,36,181,
  103,131,235,93,181,29,233,181,17,85,55,220,59,48,90,216,104,57,222,112,
  28,193,85,49,105,55,254,209,134,252,144,7,215,186,134,176,159,191,198,170,
  154,64,28,151,63,31,206,163,5,224,41,178,246,169,173,29,252,14,188,174,
  183,119,37,148,175,9,15,14,21,3,229,187,10,172,195,145,95,25,46,213,
  153,24,186,14,251,45,27,170,242,39,25,22,248,32,4,124,184,63,150,70,
  171,253,215,241,26,161,8,82,179,251,27,253,193,56,214,241,192,62,130,79,
  65,3,207,45,50,247,110,28,19,116,177,99,151,66,14,150,149,20,3,11,
  49,224,162,6,97,174,190,214,147,10,109,0,241,235,118,169,192,67,52,152,
  55,12,1,31,93,45,231,150,126,181,184,18,96,54,230,200,16,9,28,167,
  169,13,132,187,156,169,167,133,240,182,231,151,246,2,139,137,240,64,26,223,
  117,159,9,82,33,234,15,192,160,215,181,206,53,21,150,234,23,158,82,55,
  211,119,158,77,85,69,230,69,237,10,238,241,61,2,176,130,187,93,136,7,
  53,108,95,112,165,22,198,254,135,105,236,218,124,92,123,95,23,120,229,113,
  23,3,11,216,93,5,28,11,21,251,113,81,246,124,184,58,136,40,216,173,
  114,104,134,150,233,143,20,21,48,104,46,34,32,175,128,62,140,18,129,74,
  51,19,181,199,156,68,115,93,232,19,57,10,37,127,201,77,186,153,145,252,
  130,2,51,234,41,248,248,46,141,217,198,135,19,55,100,115,239,79,83,166,
  254,217,13,222,241,227,232,11,88,13,202,80,27,49,66,49,248,146,112,224,
  200,89,115,167,148,7,107,10,114,243,37,207,211,247,166,175,127,76,252,72,
  188,168,66,233,65,116,208,74,163,184,113,168,127,70,234,151,226,34,128,33,
  13,120,70,239,138,68,75,37,2,238,29,15,198,191,65,221,145,159,194,168,
  153,188,131,223,187,240,65,41,145,22,130,137,136,111,148,81,215,184,24,169,
  227,209,3,0,205,124,183,202,49,99,12,20,154,224,86,106,5,223,44,107,
  133,200,150,115,109,227,34,113,75,189,80,166,113,72,172,39,106,142,137,21,
  193,68,239,110,9,167,226,224,98,245,10,56,117,46,130,39,38,76,212,205,
  252,17,2,127,73,137,39,123,89,7,235,187,244,214,250,242,215,103,41,192,
  212,240,230,90,102,12,244,62,153,206,183,243,117,171,170,249,221,226,17,203,
  223,216,31,210,136,160,41,244,165,56,51,186,226,194,98,210,38,52,17,149,
  219,171,156,231,18,81,203,37,129,252,162,205,194,20,145,104,3,93,23,57,
  44,1,56,225,53,153,51,16,62,14,71,252,246,230,177,195,216,107,27,218,
  82,254,148,117,143,69,118,114,228,50,255,68,51,32,105,2,101,65,180,87,
  230,169,168,209,111,153,18,238,70,89,250,243,245,213,2,9,255,158,111,243,
  107,210,18,153,4,39,172,234,77,85,112,62,216,233,98,167,76,173,129,31,
  71,170,29,245,137,187,159,182,118,66,169,210,65,65,48,158,13,35,65,187,
  44,190,33,33,180,175,136,15,122,31,121,252,33,39,191,194,93,120,50,84,
  88,186,181,60,236,24,40,73,61,152,216,139,24,164,71,178,191,182,59,1,
  129,70,107,77,155,90,56,134,203,244,252,205,172,199,235,69,214,172,104,36,
  120,87,157,191,79,109,230,54,197,230,212,239,139,39,133,146,79,233,90,114,
  101,121,112,225,117,4,80,103,82,93,204,221,246,170,12,134,131,196,31,188,
  255,136,12,140,122,193,166,35,193,106,168,25,130,215,216,111,213,121,108,61,
  155,60,196,31,162,221,69,240,234,221,91,20,138,50,148,222,128,122,93,86,
  122,183,74,211,145,149,51,158,147,15,238,174,171,191,68,184,202,3,246,132,
  229,238,94,249,217,40,244,63,215,248,81,121,130,149,150,67,165,185,8,245,
  79,117,72,223,102,245,109,90,152,38,221,229,61,37,3,16,114,39,138,141,
  220,53,79,30,54,58,115,208,92,72,11,137,127,111,235,212,42,242,80,75,
  167,110,215,237,40,167,158,208
]);

const SHA256_K = new Uint32Array([
  1116352408,1899447441,3049323471,3921009573,961987163,1508970993,2453635748,2870763221,
  3624381080,310598401,607225278,1426881987,1925078388,2162078206,2614888103,3248222580,
  3835390401,4022224774,264347078,604807628,770255983,1249150122,1555081692,1996064986,
  2554220882,2821834349,2952996808,3210313671,3336571891,3584528711,113926993,338241895,
  666307205,773529912,1294757372,1396182291,1695183700,1986661051,2177026350,2456956037,
  2730485921,2820302411,3259730800,3345764771,3516065817,3600352804,4094571909,275423344,
  430227734,506948616,659060556,883997877,958139571,1322822218,1537002063,1747873779,
  1955562222,2024104815,2227730452,2361852424,2428436474,2756734187,3204031479,3329325298
]);

const BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
let BASE64_LOOKUP = null;

function getBase64Lookup() {
  if (BASE64_LOOKUP) return BASE64_LOOKUP;
  const table = new Int16Array(128);
  table.fill(-1);
  for (let i = 0; i < BASE64_CHARS.length; i++) {
    table[BASE64_CHARS.charCodeAt(i)] = i;
  }
  table[43] = 62; // '+'
  table[47] = 63; // '/'
  BASE64_LOOKUP = table;
  return table;
}

function rotr(x, n) {
  return (x >>> n) | (x << (32 - n));
}

function sha256Block(state, block, offset) {
  const W = new Uint32Array(64);
  for (let i = 0; i < 16; i++) {
    const j = offset + 4 * i;
    W[i] = (block[j] << 24) | (block[j + 1] << 16) | (block[j + 2] << 8) | block[j + 3];
  }
  for (let i = 16; i < 64; i++) {
    const s0 = rotr(W[i - 15], 7) ^ rotr(W[i - 15], 18) ^ (W[i - 15] >>> 3);
    const s1 = rotr(W[i - 2], 17) ^ rotr(W[i - 2], 19) ^ (W[i - 2] >>> 10);
    W[i] = (W[i - 16] + s0 + W[i - 7] + s1) | 0;
  }
  let a = state[0], b = state[1], c = state[2], d = state[3];
  let e = state[4], f = state[5], g = state[6], h = state[7];
  for (let i = 0; i < 64; i++) {
    const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
    const ch = (e & f) ^ (~e & g);
    const temp1 = (h + S1 + ch + SHA256_K[i] + W[i]) | 0;
    const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
    const maj = (a & b) ^ (a & c) ^ (b & c);
    const temp2 = (S0 + maj) | 0;
    h = g; g = f; f = e; e = (d + temp1) | 0;
    d = c; c = b; b = a; a = (temp1 + temp2) | 0;
  }
  state[0] = (state[0] + a) | 0;
  state[1] = (state[1] + b) | 0;
  state[2] = (state[2] + c) | 0;
  state[3] = (state[3] + d) | 0;
  state[4] = (state[4] + e) | 0;
  state[5] = (state[5] + f) | 0;
  state[6] = (state[6] + g) | 0;
  state[7] = (state[7] + h) | 0;
}

function customSha256(iv, data, extraLen) {
  const state = Uint32Array.from(iv);
  const totalLen = extraLen + data.length;
  let padLen = data.length + 1;
  while (padLen % 64 !== 56) padLen++;
  const padded = new Uint8Array(padLen + 8);
  padded.set(data);
  padded[data.length] = 128;
  const bitLen = 8 * totalLen;
  const highBits = Math.floor(bitLen / 4294967296);
  const lowBits = bitLen >>> 0;
  const endOffset = padded.length - 8;
  padded[endOffset] = (highBits >>> 24) & 255;
  padded[endOffset + 1] = (highBits >>> 16) & 255;
  padded[endOffset + 2] = (highBits >>> 8) & 255;
  padded[endOffset + 3] = highBits & 255;
  padded[endOffset + 4] = (lowBits >>> 24) & 255;
  padded[endOffset + 5] = (lowBits >>> 16) & 255;
  padded[endOffset + 6] = (lowBits >>> 8) & 255;
  padded[endOffset + 7] = lowBits & 255;
  for (let i = 0; i < padded.length; i += 64) {
    sha256Block(state, padded, i);
  }
  const out = new Uint8Array(32);
  for (let i = 0; i < 8; i++) {
    out[4 * i] = (state[i] >>> 24) & 255;
    out[4 * i + 1] = (state[i] >>> 16) & 255;
    out[4 * i + 2] = (state[i] >>> 8) & 255;
    out[4 * i + 3] = state[i] & 255;
  }
  return out;
}

function readUint32ArrayBE(bytes, offset) {
  const out = new Uint32Array(8);
  for (let i = 0; i < 8; i++) {
    const j = offset + 4 * i;
    out[i] = (bytes[j] << 24) | (bytes[j + 1] << 16) | (bytes[j + 2] << 8) | bytes[j + 3];
  }
  return out;
}

function toBase64Url(bytes) {
  let out = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out += BASE64_CHARS[(n >>> 18) & 63] + BASE64_CHARS[(n >>> 12) & 63] + BASE64_CHARS[(n >>> 6) & 63] + BASE64_CHARS[n & 63];
  }
  const rem = bytes.length - i;
  if (rem === 1) {
    const n = bytes[i] << 16;
    out += BASE64_CHARS[(n >>> 18) & 63] + BASE64_CHARS[(n >>> 12) & 63];
  } else if (rem === 2) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8);
    out += BASE64_CHARS[(n >>> 18) & 63] + BASE64_CHARS[(n >>> 12) & 63] + BASE64_CHARS[(n >>> 6) & 63];
  }
  return out;
}

function fromBase64Url(rawStr) {
  const str = String(rawStr || '').replace(/=+$/, '');
  const lookup = getBase64Lookup();
  const len = str.length;
  const rem = len & 3;
  if (rem === 1) throw new Error('Invalid base64url length');
  const outLen = 3 * (len >>> 2) + (rem === 2 ? 1 : rem === 3 ? 2 : 0);
  const out = new Uint8Array(outLen);
  let outIdx = 0;
  let inIdx = 0;
  for (const limit = len - rem; inIdx < limit; inIdx += 4) {
    const c0 = str.charCodeAt(inIdx), c1 = str.charCodeAt(inIdx + 1), c2 = str.charCodeAt(inIdx + 2), c3 = str.charCodeAt(inIdx + 3);
    const v0 = c0 < 128 ? lookup[c0] : -1, v1 = c1 < 128 ? lookup[c1] : -1, v2 = c2 < 128 ? lookup[c2] : -1, v3 = c3 < 128 ? lookup[c3] : -1;
    if ((v0 | v1 | v2 | v3) < 0) throw new Error('Invalid base64url character');
    const n = (v0 << 18) | (v1 << 12) | (v2 << 6) | v3;
    out[outIdx++] = (n >>> 16) & 255;
    out[outIdx++] = (n >>> 8) & 255;
    out[outIdx++] = n & 255;
  }
  if (rem === 2) {
    const c0 = str.charCodeAt(inIdx), c1 = str.charCodeAt(inIdx + 1);
    const v0 = c0 < 128 ? lookup[c0] : -1, v1 = c1 < 128 ? lookup[c1] : -1;
    if ((v0 | v1) < 0) throw new Error('Invalid base64url character');
    out[outIdx] = ((v0 << 18) | (v1 << 12)) >>> 16;
  } else if (rem === 3) {
    const c0 = str.charCodeAt(inIdx), c1 = str.charCodeAt(inIdx + 1), c2 = str.charCodeAt(inIdx + 2);
    const v0 = c0 < 128 ? lookup[c0] : -1, v1 = c1 < 128 ? lookup[c1] : -1, v2 = c2 < 128 ? lookup[c2] : -1;
    if ((v0 | v1 | v2) < 0) throw new Error('Invalid base64url character');
    const n = (v0 << 18) | (v1 << 12) | (v2 << 6);
    out[outIdx++] = (n >>> 16) & 255;
    out[outIdx] = (n >>> 8) & 255;
  }
  return out;
}

export function signPath(canonicalPath) {
  const data = new TextEncoder().encode(canonicalPath);
  const iv1 = readUint32ArrayBE(MATERIAL, 0);
  const iv2 = readUint32ArrayBE(MATERIAL, 32);
  const innerHash = customSha256(iv1, data, 64);
  const outerHash = customSha256(iv2, innerHash, 64);
  return `${KID}.${toBase64Url(outerHash.subarray(0, 12))}`;
}

export function decryptPayload(encryptedB64) {
  const rawBytes = fromBase64Url(encryptedB64);
  const totalLen = rawBytes.length + 2;
  if (totalLen < 4) throw new Error('Invalid encrypted response');
  const paddedLen = (totalLen + 3) & ~3;
  const buf = new Uint8Array(paddedLen);
  buf.set(rawBytes, 2);

  const shift = ((buf[2] << 8) | buf[3]) % 1024;
  const keySlice = MATERIAL.subarray(64, 1088);
  const rotatedKey = new Uint8Array(1024);
  rotatedKey.set(keySlice.subarray(shift));
  rotatedKey.set(keySlice.subarray(0, shift), 1024 - shift);

  const wordCount = totalLen >> 2;
  const u32Data = new Uint32Array(buf.buffer, buf.byteOffset, wordCount);
  const u32Key = new Uint32Array(rotatedKey.buffer, rotatedKey.byteOffset, 256);
  for (let i = 1; i < wordCount; i++) {
    u32Data[i] = u32Data[i] ^ u32Key[(i - 1) % 256];
  }
  for (let i = wordCount << 2; i < totalLen; i++) {
    buf[i] = buf[i] ^ rotatedKey[(i - 4) % 1024];
  }
  const jsonStr = new TextDecoder().decode(buf.subarray(4, totalLen));
  return JSON.parse(jsonStr);
}

let refreshPromise = null;

/**
 * Automatically fetches live https://comix.to bundle and extracts updated KID + 1088-byte MATERIAL
 * if Comix rotates keys on a new deployment.
 */
export async function refreshComixCryptoKeys() {
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    try {
      const homeRes = await fetch('https://comix.to/', {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      });
      if (!homeRes.ok) return false;
      const html = await homeRes.text();
      const mainMatch = html.match(/(\/assets\/[^\x22']+\/dist\/)main-[^\x22']+\.js/);
      if (!mainMatch) return false;
      const basePath = mainMatch[1];
      const mainJs = await (await fetch('https://comix.to' + mainMatch[0], {
        headers: { 'User-Agent': 'Mozilla/5.0' },
      })).text();
      const apicoreMatch = mainJs.match(/apicore-[^\x22']+\.js/);
      if (!apicoreMatch) return false;
      const apiJs = await (await fetch('https://comix.to' + basePath + apicoreMatch[0], {
        headers: { 'User-Agent': 'Mozilla/5.0' },
      })).text();

      const rotEnd = apiJs.indexOf('import{');
      const firstLineMatch = apiJs.match(/^(?:var|let|const)\s+([a-zA-Z0-9_$]+)\s*=\s*([a-zA-Z0-9_$]+);/);
      const fnLookupName = firstLineMatch ? firstLineMatch[2] : 't';
      const fnLookupIdx = apiJs.indexOf(`function ${fnLookupName}(`);
      const fnHelperIdx = apiJs.indexOf('function I(') >= 0 ? apiJs.indexOf('function I(') : apiJs.indexOf('function e(');
      const wjStart = apiJs.indexOf('wj={};');
      const bjEnd = apiJs.indexOf('var Bj=') >= 0 ? apiJs.indexOf('var Bj=') : apiJs.indexOf(';var Bj=');

      if (rotEnd < 0 || fnLookupIdx < 0 || wjStart < 0 || bjEnd < 0) return false;

      const findFnEnd = (startIdx) => {
        let depth = 0;
        let started = false;
        for (let i = startIdx; i < apiJs.length; i++) {
          if (apiJs[i] === '{') { depth++; started = true; }
          else if (apiJs[i] === '}') { depth--; if (started && depth === 0) return i + 1; }
        }
        return -1;
      };

      const fnLookupEnd = findFnEnd(fnLookupIdx);
      const fnHelperEnd = fnHelperIdx >= 0 ? findFnEnd(fnHelperIdx) : -1;
      if (fnLookupEnd < 0) return false;

      const materialPart = apiJs.slice(wjStart, bjEnd);
      const vm = await import('node:vm');
      const ctx = vm.createContext({ parseInt, String, Object, Array, Uint8Array, Uint32Array, Int8Array, Math, TextEncoder });
      
      if (fnHelperIdx >= 0 && fnHelperEnd > fnHelperIdx) {
        vm.runInContext(apiJs.slice(fnHelperIdx, fnHelperEnd), ctx);
      }
      vm.runInContext(apiJs.slice(fnLookupIdx, fnLookupEnd), ctx);
      vm.runInContext(apiJs.slice(0, rotEnd), ctx);

      const dynRes = vm.runInContext('(() => { var wj; ' + materialPart + ' const k = Object.keys(Ic); let kid = Ic.kid || (Ic[dy ? dy(1037) : "kid"]); let mat = (Ic.material ? Ic.material() : (Ic[dy ? dy(585) : "material"] ? Ic[dy(585)]() : null)); if (!kid) { for (const val of Object.values(Ic)) { if (typeof val === "string" && val.length <= 6) { kid = val; break; } } } if (!mat) { for (const val of Object.values(Ic)) { if (typeof val === "function") { const res = val(); if (res instanceof Uint8Array && res.length === 1088) { mat = res; break; } } } } return { kid, mat }; })()', ctx);

      if (dynRes && dynRes.kid && dynRes.mat && dynRes.mat.length === 1088) {
        const prevKid = KID;
        const prevMat = MATERIAL;
        KID = dynRes.kid;
        MATERIAL = dynRes.mat;
        const testReq = encodeRequest({ method: 'GET', url: '/manga', params: { limit: 1 } });
        const testRes = await fetch(testReq.url, { headers: testReq.headers }).catch(() => null);
        if (testRes && testRes.ok) {
          console.log(`[BİLGİ] Comix crypto anahtarı dinamik güncellendi ve doğrulandı: KID=${KID}`);
          return true;
        }
        KID = prevKid;
        MATERIAL = prevMat;
      }
      return false;
    } catch {
      return false;
    } finally {
      refreshPromise = null;
    }
  })();
  return refreshPromise;
}

/**
 * Formats query parameters exactly as Comix's `ll(path, params)` interceptor does:
 * - Unencoded `key=value` pairs sorted alphabetically for signature computation.
 * - URLSearchParams encoded query string for the HTTP request URL.
 */
function buildSignedQuery(cleanPath, paramsObj) {
  const rawEntries = [];
  const encodeEntries = [];

  const collect = (prefix, val) => {
    if (val === undefined || val === null) return;
    if (Array.isArray(val)) {
      val.forEach((item, idx) => collect(`${prefix}[${idx}]`, item));
      return;
    }
    if (typeof val === 'object') {
      for (const k of Object.keys(val).sort()) {
        collect(prefix === '' ? k : `${prefix}[${k}]`, val[k]);
      }
      return;
    }
    rawEntries.push(`${prefix}=${String(val)}`);
    encodeEntries.push([prefix, String(val)]);
  };

  const topKeys = Object.keys(paramsObj).filter((k) => k !== '_').sort();
  for (const k of topKeys) {
    collect(k, paramsObj[k]);
  }

  const canonical = rawEntries.length > 0 ? `${cleanPath}?${rawEntries.join('&')}` : cleanPath;
  const sig = signPath(canonical);

  const encodedParts = encodeEntries.map(
    ([k, v]) => `${encodeURIComponent(k).replace(/%5B/gi, '[').replace(/%5D/gi, ']')}=${encodeURIComponent(v)}`
  );
  encodedParts.push(`_=${encodeURIComponent(sig)}`);
  return { canonical, sig, queryString: encodedParts.join('&') };
}

export function encodeRequest({ method = 'GET', url, params = null, v = 0, w = 0 }) {
  const rawUrl = String(url || '');
  const [pathPart, existingQuery] = rawUrl.replace(/^https?:\/\/[^/]+/, '').split('?');
  const cleanPath = (pathPart || '').replace(/^\/api\/v1/, '');

  const mergedParams = {};
  if (existingQuery) {
    const sp = new URLSearchParams(existingQuery);
    for (const [k, val] of sp.entries()) {
      if (k !== '_') mergedParams[k] = val;
    }
  }
  if (params && typeof params === 'object') {
    for (const [k, val] of Object.entries(params)) {
      if (val !== undefined && val !== null && k !== '_') {
        mergedParams[k] = val;
      }
    }
  }

  const isChapterEndpoint =
    /\/(?:manga\/[^/?]+|groups\/\d+)\/chapters$|^\/chapters\/\d+$/.test(cleanPath);

  if (isChapterEndpoint) {
    if (mergedParams.v === undefined) mergedParams.v = String(v);
    if (mergedParams.w === undefined) mergedParams.w = String(w);
  }

  const { sig, queryString } = buildSignedQuery(cleanPath, mergedParams);
  return {
    url: `https://comix.to/api/v1${cleanPath}?${queryString}`,
    headers: {
      'Accept': 'application/json',
      'X-Requested-With': 'XMLHttpRequest',
      'X-Rt': '0',
      'x-48': '0',
      'x-req': '1',
    },
    signature: sig,
  };
}

export function decodeResponse(buffer) {
  const text = typeof buffer === 'string' ? buffer : new TextDecoder().decode(buffer);
  const json = JSON.parse(text);
  const decrypted = json && typeof json.e === 'string' ? decryptPayload(json.e) : json;
  const res = (decrypted && decrypted.status === 'ok' && 'result' in decrypted)
    ? decrypted.result
    : decrypted;
  if (res && typeof res === 'object' && !Array.isArray(res)) {
    const metaObj = res.meta ?? res.pagination ?? res.yU;
    if (metaObj && typeof metaObj === 'object') {
      const normalizedMeta = {
        ...metaObj,
        total: metaObj.total ?? metaObj.f ?? 0,
        perPage: metaObj.perPage ?? metaObj.per_page ?? metaObj.limit ?? 20,
        page: metaObj.page ?? metaObj.current_page ?? 1,
        lastPage: metaObj.lastPage ?? metaObj.last_page ?? 1,
        last_page: metaObj.last_page ?? metaObj.lastPage ?? 1,
        hasNext: Boolean(metaObj.hasNext ?? ((metaObj.page ?? 1) < (metaObj.lastPage ?? metaObj.last_page ?? 1))),
      };
      res.meta = normalizedMeta;
      res.pagination = normalizedMeta;
    }
  }
  return res;
}

/**
 * Generates ordered CDN mirror URLs for a Comix chapter page (`to40oy-Cv9NlRfE2.js` algorithm).
 */
export function buildComixPageMirrorUrls(primaryUrl, altDomains = [], alt2Domain = 'kkplayer.wtf', altNode = null, pageIndex = 0) {
  if (!primaryUrl || typeof primaryUrl !== 'string') return [];
  const fullUrl = primaryUrl.startsWith('http') ? primaryUrl : `https://comix.to${primaryUrl.startsWith('/') ? '' : '/'}${primaryUrl}`;
  const match = /^(https?:\/\/)([^/?#]+)(.*)$/.exec(fullUrl);
  if (!match) return [fullUrl];
  const [, protocol, host, pathAndQuery] = match;
  const hostParts = host.split('.');
  if (hostParts.length < 2) return [fullUrl];
  const primaryNode = hostParts[0];
  const primaryBaseDomain = hostParts.slice(1).join('.');

  const domains = [
    primaryBaseDomain,
    Array.isArray(altDomains) && altDomains.length > 0 ? altDomains[pageIndex % altDomains.length] : undefined,
    alt2Domain || 'kkplayer.wtf',
  ].filter(Boolean);

  const nodes = altNode && altNode !== primaryNode ? [primaryNode, altNode] : [primaryNode];
  const candidates = [];
  for (const node of nodes) {
    for (const domain of domains) {
      const candidateHost = `${node}.${domain}`;
      const candidateUrl = `${protocol}${candidateHost}${pathAndQuery}`;
      if (!candidates.includes(candidateUrl)) {
        candidates.push(candidateUrl);
      }
    }
  }
  return candidates.length > 0 ? candidates : [fullUrl];
}

export function unpackManga(raw) {
  if (!raw || typeof raw !== 'object') return raw;
  const mapTermList = (arr) =>
    (arr ?? []).map((item) => ({
      id: item.id ?? item.tr,
      title: item.title ?? item.N_ ?? item.name ?? '',
      slug: item.slug ?? '',
    }));

  const normalizeComixAssetUrl = (u) => {
    if (!u || typeof u !== 'string') return '';
    const trimmed = u.trim();
    if (!trimmed) return '';
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return trimmed;
    return `https://comix.to${trimmed.startsWith('/') ? '' : '/'}${trimmed}`;
  };

  const posterRaw = raw.poster ?? raw.yd;
  const poster = posterRaw
    ? {
        medium: normalizeComixAssetUrl(posterRaw.medium ?? posterRaw.tC ?? ''),
        large: normalizeComixAssetUrl(posterRaw.large ?? posterRaw.Rg ?? posterRaw.medium ?? posterRaw.tC ?? ''),
      }
    : null;

  const linksRaw = raw.links ?? raw.eZ;
  const links = linksRaw
    ? {
        al: linksRaw.al ?? linksRaw._l ?? null,
        mal: linksRaw.mal ?? linksRaw.D2 ?? null,
        mu: linksRaw.mu ?? linksRaw.w4 ?? null,
        md: linksRaw.md ?? linksRaw.eW ?? null,
        mb: linksRaw.mb ?? linksRaw.lB ?? null,
      }
    : null;

  const hasChapters = raw.hasChapters ?? raw.Wz ?? (Number(raw.latestChapter ?? raw.OI ?? 0) > 0);
  const latestChapter = Number(raw.latestChapter ?? raw.OI ?? 0);

  return {
    id: raw.id ?? raw.Mi,
    hid: raw.hid ?? raw.hash_id ?? raw.Gi,
    title: raw.title ?? raw.N_ ?? '',
    altTitles: raw.altTitles ?? raw.alt_titles ?? raw.VK ?? [],
    type: raw.type ?? raw.es ?? 'manhwa',
    status: raw.status ?? raw.Jg ?? 'releasing',
    originalLanguage: raw.originalLanguage ?? raw.original_language ?? raw.tP ?? '',
    poster,
    latestChapter,
    finalChapter: raw.finalChapter ?? raw.rY ?? 0,
    finalVolume: raw.finalVolume ?? raw.Vv ?? 0,
    hasChapters: Boolean(hasChapters),
    chaptersTotal: raw.chaptersTotal ?? raw.chapters_total ?? (hasChapters ? Math.max(1, Math.ceil(latestChapter || 1)) : 0),
    startDate: raw.startDate ?? raw.uO ?? '',
    endDate: raw.endDate ?? raw.y5 ?? '',
    year: raw.year ?? raw.V_ ?? null,
    synopsis: raw.synopsis ?? raw.Qw ?? '',
    synopsisHtml: raw.synopsisHtml ?? raw.fO ?? '',
    followsTotal: 0, // Never import external views/follows
    ratedAvg: raw.ratedAvg ?? raw.$d ?? 0,
    ratedScore: raw.ratedScore ?? raw.eU ?? 0,
    ratedCount: raw.ratedCount ?? raw.PW ?? 0,
    contentRating: raw.contentRating ?? raw.content_rating ?? raw.pk ?? 'safe',
    links,
    url: raw.url ?? raw.ub ?? '',
    genres: mapTermList(raw.genres ?? raw.qA),
    demographics: mapTermList(raw.demographics ?? raw.LV),
    formats: mapTermList(raw.formats ?? raw.Ii),
    tags: mapTermList(raw.tags ?? raw.P8),
    authors: mapTermList(raw.authors ?? raw.DG),
    artists: mapTermList(raw.artists ?? raw.Zu),
    publishers: mapTermList(raw.publishers ?? raw.nl),
    sources: (raw.sources ?? raw.sy ?? []).map((s) => ({ label: s.label ?? s.hR, url: s.url ?? s.ub })),
  };
}

export function unpackChapters(raw) {
  const list = Array.isArray(raw) ? raw : (raw?.items ?? raw?.lr ?? []);
  return list.map((ch) => ({
    id: ch.id ?? ch.Uw,
    mangaId: ch.mangaId ?? ch.manga_id ?? ch.Mi,
    number: Number(ch.number ?? ch.FL ?? 0),
    volume: ch.volume ?? ch.hG ?? null,
    name: ch.name ?? ch.jh ?? '',
    language: String(ch.language ?? ch.yN ?? 'en').toLowerCase(),
    isOfficial: Boolean(ch.isOfficial ?? ch.is_official ?? ch.Sq),
    votes: Number(ch.votes ?? ch.N4 ?? 0),
    createdAtFormatted: ch.createdAtFormatted ?? ch.Cc ?? '',
    groupId: ch.groupId ?? ch.group_id ?? ch.w6 ?? null,
    group: (ch.group ?? ch.LF)
      ? {
          id: (ch.group ?? ch.LF).id ?? (ch.group ?? ch.LF).w6,
          name: (ch.group ?? ch.LF).name ?? (ch.group ?? ch.LF).jh ?? '',
        }
      : null,
    url: ch.url ?? ch.ub ?? '',
  }));
}

export function unpackChapterPages(raw) {
  if (!raw || typeof raw !== 'object') return { pages: [], pageObjects: [] };
  const pagesContainer = raw.pages ?? raw.Ni ?? [];
  const isLegacyArray = Array.isArray(pagesContainer);
  const baseUrl = (!isLegacyArray && pagesContainer?.baseUrl) ? String(pagesContainer.baseUrl) : '';
  const altDomains = (!isLegacyArray && Array.isArray(pagesContainer?.alt)) ? pagesContainer.alt : [];
  const alt2Domain = (!isLegacyArray && pagesContainer?.alt2) ? String(pagesContainer.alt2) : 'kkplayer.wtf';
  const altNode = (!isLegacyArray && (pagesContainer?.alt_node || pagesContainer?.node))
    ? String(pagesContainer.alt_node || pagesContainer.node)
    : null;
  const rawItems = isLegacyArray ? pagesContainer : (pagesContainer?.items ?? []);

  const pageObjects = rawItems.map((p, idx) => {
    const rawUrl = String(p.url ?? p.ub ?? '');
    const primaryUrl = rawUrl.startsWith('http') ? rawUrl : `${baseUrl}${rawUrl}`;
    const itemAlt = Array.isArray(p.n6) && p.n6.length > 0 ? p.n6 : altDomains;
    const itemAlt2 = p.R2 ?? alt2Domain;
    const itemNode = p.wp ?? altNode;
    const mirrors = buildComixPageMirrorUrls(primaryUrl, itemAlt, itemAlt2, itemNode, idx);
    return {
      url: mirrors[0] || primaryUrl,
      mirrors,
      alt: itemAlt,
      alt2: itemAlt2,
      altNode: itemNode,
      width: p.width ?? p.fc ?? 0,
      height: p.height ?? p.pq ?? 0,
    };
  });

  return {
    id: raw.id ?? raw.Uw,
    mangaId: raw.mangaId ?? raw.Mi,
    number: Number(raw.number ?? raw.FL ?? 0),
    volume: raw.volume ?? raw.hG ?? null,
    name: raw.name ?? raw.jh ?? '',
    language: String(raw.language ?? raw.yN ?? 'en').toLowerCase(),
    pages: pageObjects.map((p) => p.url).filter(Boolean),
    pageObjects,
  };
}

export async function fetchComixApi(endpoint, params = {}) {
  // Normalize legacy `q` param to `keyword` for `/manga` search
  const normalizedParams = { ...params };
  if (endpoint === '/manga' && normalizedParams.q !== undefined && normalizedParams.keyword === undefined) {
    normalizedParams.keyword = normalizedParams.q;
    delete normalizedParams.q;
  }

  for (let attempt = 0; attempt < 2; attempt++) {
    const req = encodeRequest({ method: 'GET', url: endpoint, params: normalizedParams, v: 0, w: 0 });
    const res = await fetch(req.url, {
      headers: {
        ...req.headers,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      },
    });
    if (res.status === 403 && attempt === 0) {
      const refreshed = await refreshComixCryptoKeys();
      if (refreshed) continue;
    }
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${res.statusText} [${req.url}]`);
    }
    const buf = await res.arrayBuffer();
    return decodeResponse(buf);
  }
}

// ============================================================================
// SHARED COMIX ARCHIVE, DEDUPLICATION, METADATA & MULTI-LANGUAGE HELPERS
// ============================================================================

export function toComixChapterUuid(comixChId) {
  const cleanDigits = String(comixChId || '').replace(/[^0-9]/g, '');
  return `c01c0000-0000-4000-8000-${cleanDigits.padStart(12, '0').slice(-12)}`;
}

export function toComixSeriesUuid(hid) {
  const clean = String(hid || '').toLowerCase().replace(/[^a-z0-9]/g, '') || '0';
  const lenHex = Math.min(15, clean.length).toString(16);
  let num = 0n;
  for (const ch of clean.slice(0, 10)) {
    const v = parseInt(ch, 36);
    if (!Number.isNaN(v)) num = num * 36n + BigInt(v);
  }
  const hexPart = (num & 0xffffffffffffn).toString(16).padStart(12, '0');
  return `c01c0001-0000-4000-800${lenHex}-${hexPart}`;
}

export function toComixCharacterUuid(charId) {
  const cleanDigits = String(charId || '').replace(/[^0-9]/g, '');
  return `c01c0002-0000-4000-8000-${cleanDigits.padStart(12, '0').slice(-12)}`;
}

export function slugifyTitle(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/ı/g, 'i')
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ş/g, 's')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export function normalizeTitleKey(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/\b(manhwa|manga|manhua|webtoon|komik|comic|novel|official|remake)\b/gi, '')
    .replace(/ı/g, 'i')
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ş/g, 's')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

export function areSeriesTitlesMatching(a, b) {
  const keyA = normalizeTitleKey(a);
  const keyB = normalizeTitleKey(b);
  if (!keyA || !keyB) return false;
  if (keyA === keyB) return true;
  if (keyA.length >= 6 && keyB.length >= 6) {
    if (keyA === keyB + 's' || keyB === keyA + 's') return true;
    if (keyA.replace(/^the/, '') === keyB.replace(/^the/, '')) return true;
  }
  return false;
}

export function cleanChapterTitle(rawName, chapterNumber) {
  const numLabel = `Bölüm ${chapterNumber}`;
  if (!rawName || typeof rawName !== 'string') return numLabel;

  let cleaned = rawName
    .replace(/\[(?:[a-z]{2}(?:-[a-z]{2})?|official|raw|scan[^\]]*|group[^\]]*)\]/gi, '')
    .replace(/\((?:[a-z]{2}(?:-[a-z]{2})?|official|raw|scan[^)]*)\)/gi, '')
    .replace(/^(?:chapter|ch\.?|episode|ep\.?|bölüm|bolum)\s*\d+(?:[.,]\d+)?\s*[:\-–—~|]*\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleaned || /^\d+(?:[.,]\d+)?$/.test(cleaned)) {
    return numLabel;
  }
  if (cleaned.toLowerCase() === `chapter ${chapterNumber}` || cleaned.toLowerCase() === `bölüm ${chapterNumber}`) {
    return numLabel;
  }
  return `${numLabel} - ${cleaned.slice(0, 90)}`;
}

export function cleanEnglishSynopsis(raw) {
  if (!raw || typeof raw !== 'string') return '';
  return raw
    .replace(/<[^>]+>/g, ' ')
    .replace(/\[Written by MAL Rewrite\]/gi, '')
    .replace(/\(Source:[^)]+\)/gi, '')
    .replace(/\[Source:[^\]]+\]/gi, '')
    .replace(/---[\s\S]*$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export async function translateSynopsisToTurkish(text) {
  const cleaned = cleanEnglishSynopsis(text);
  if (!cleaned || cleaned.length < 5) return '';
  try {
    const clipped = cleaned.slice(0, 1800);
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=tr&dt=t&q=${encodeURIComponent(clipped)}`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return cleaned;
    const data = await res.json();
    if (Array.isArray(data?.[0])) {
      const translated = data[0].map((part) => part?.[0] || '').join('').trim();
      return translated || cleaned;
    }
    return cleaned;
  } catch {
    return cleaned;
  }
}

export const GENRE_MAP_TR = {
  action: 'Aksiyon',
  adventure: 'Macera',
  comedy: 'Komedi',
  drama: 'Dram',
  fantasy: 'Fantastik',
  magic: 'Büyü',
  romance: 'Romantik',
  'sci-fi': 'Bilim Kurgu',
  scifi: 'Bilim Kurgu',
  'science fiction': 'Bilim Kurgu',
  mystery: 'Gizem',
  psychological: 'Psikolojik',
  horror: 'Korku',
  thriller: 'Gerilim',
  supernatural: 'Doğaüstü',
  'slice of life': 'Hayattan Kesitler',
  sports: 'Spor',
  historical: 'Tarihi',
  'martial arts': 'Dövüş Sanatları',
  wuxia: 'Dövüş Sanatları',
  murim: 'Dövüş Sanatları',
  isekai: 'Isekai',
  reincarnation: 'Reenkarnasyon',
  regression: 'Reenkarnasyon',
  time_travel: 'Zaman Yolculuğu',
  'time travel': 'Zaman Yolculuğu',
  system: 'Sistem',
  dungeons: 'Zindan',
  dungeon: 'Zindan',
  'school life': 'Okul Hayatı',
  school: 'Okul Hayatı',
  seinen: 'Seinen',
  shounen: 'Shounen',
  shonen: 'Shounen',
  shoujo: 'Shoujo',
  shojo: 'Shoujo',
  josei: 'Josei',
  tragedy: 'Trajedi',
  crime: 'Suç',
  military: 'Askeri',
  mecha: 'Mecha',
  music: 'Müzik',
  cooking: 'Yemek',
  medical: 'Tıbbi',
  harem: 'Harem',
  ecchi: 'Ecchi',
  villainess: 'Kötü Kadın',
  monsters: 'Canavarlar',
  demons: 'İblisler',
  vampires: 'Vampirler',
  zombies: 'Zombiler',
  post_apocalyptic: 'Kıyamet Sonrası',
  'post-apocalyptic': 'Kıyamet Sonrası',
  survival: 'Hayatta Kalma',
  revenge: 'İntikam',
  gaming: 'Oyun',
  'video games': 'Oyun',
  virtual_reality: 'Sanal Gerçeklik',
};

const ADULT_GENRE_KEYWORDS = new Set([
  'adult',
  'hentai',
  'smut',
  'mature',
  'erotica',
  'pornographic',
  '18+',
  '+18',
  'nsfw',
]);

export function mapComixGenresAndFormat(unpacked) {
  const rawType = String(unpacked?.type || '').toLowerCase();
  const origLang = String(unpacked?.originalLanguage || '').toLowerCase();
  const rawFormatNames = [
    ...(unpacked?.formats || []),
    ...(unpacked?.genres || []),
    ...(unpacked?.tags || []),
  ].map((t) => String(t?.title || t?.name || t?.slug || '').toLowerCase());

  const allTitleText = [unpacked?.title, ...(unpacked?.altTitles || [])].join(' ');
  const hasHangul = /[\uAC00-\uD7AF\u1100-\u11FF]/.test(allTitleText);
  const hasKana = /[\u3040-\u309F\u30A0-\u30FF]/.test(allTitleText);

  let formatType = 'manhwa';
  if (rawType === 'manhwa' || rawType === 'webtoon' || origLang === 'ko' || origLang === 'kr' || hasHangul || rawFormatNames.some((n) => n.includes('webtoon') || n.includes('long strip'))) {
    formatType = 'manhwa';
  } else if (rawType === 'manga' || origLang === 'ja' || origLang === 'jp' || hasKana) {
    formatType = 'manga';
  } else if (rawType === 'manhua' || origLang === 'zh' || origLang === 'cn' || origLang === 'zh-hk' || origLang === 'zh-tw') {
    formatType = 'manhua';
  }

  const contentRating = String(unpacked?.contentRating || 'safe').toLowerCase();
  const allTermTitles = [
    ...(unpacked?.genres || []),
    ...(unpacked?.demographics || []),
    ...(unpacked?.tags || []),
  ].map((t) => String(t?.title || t?.name || t?.slug || '').trim());

  let isAdult =
    contentRating === 'erotica' ||
    contentRating === 'pornographic' ||
    contentRating === 'adult' ||
    contentRating === 'r18' ||
    allTermTitles.some((t) => ADULT_GENRE_KEYWORDS.has(t.toLowerCase()));

  const genreSet = new Set();
  for (const rawTerm of allTermTitles) {
    const lower = rawTerm.toLowerCase();
    if (ADULT_GENRE_KEYWORDS.has(lower)) {
      isAdult = true;
      continue;
    }
    const mapped = GENRE_MAP_TR[lower] || GENRE_MAP_TR[lower.replace(/-/g, ' ')];
    if (mapped) {
      genreSet.add(mapped);
    }
  }

  if (isAdult) {
    genreSet.add('+18');
  }
  if (genreSet.size === 0) {
    genreSet.add(formatType === 'manga' ? 'Manga' : formatType === 'manhua' ? 'Manhua' : 'Webtoon');
  }

  return {
    formatType,
    isAdult,
    genres: Array.from(genreSet).slice(0, 12),
  };
}

export function extractExternalIdsFromComixLinks(links, existingSourceLinks = []) {
  let anilistId = null;
  let malId = null;
  const extraLinks = [];

  if (links && typeof links === 'object') {
    const alRaw = String(links.al || '');
    const malRaw = String(links.mal || '');
    const muRaw = String(links.mu || '');
    const mdRaw = String(links.md || '');
    const alMatch = alRaw.match(/(?:anilist\.co\/manga\/|^)(\d+)/i);
    if (alMatch) anilistId = Number(alMatch[1]);
    const malMatch = malRaw.match(/(?:myanimelist\.net\/manga\/|^)(\d+)/i);
    if (malMatch) malId = Number(malMatch[1]);
    if (muRaw) {
      const muUrl = muRaw.startsWith('http') ? muRaw : `https://www.mangaupdates.com/series/${muRaw}`;
      extraLinks.push({ source: 'mangaupdates', url: muUrl, externalId: muRaw, label: 'MangaUpdates' });
    }
    if (mdRaw) {
      const mdUrl = mdRaw.startsWith('http') ? mdRaw : `https://mangadex.org/title/${mdRaw}`;
      extraLinks.push({ source: 'mangadex', url: mdUrl, externalId: mdRaw, label: 'MangaDex' });
    }
  }

  if (Array.isArray(existingSourceLinks)) {
    for (const link of existingSourceLinks) {
      const url = String(link?.url || '');
      if (!anilistId) {
        const m = url.match(/anilist\.co\/manga\/(\d+)/i);
        if (m) anilistId = Number(m[1]);
      }
      if (!malId) {
        const m = url.match(/myanimelist\.net\/manga\/(\d+)/i);
        if (m) malId = Number(m[1]);
      }
    }
  }

  return { anilistId, malId, extraLinks };
}

function cleanCharacterBio(rawBio) {
  if (!rawBio || typeof rawBio !== 'string') return '';
  return rawBio
    .replace(/~!([\s\S]*?)!~/g, '')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\(Source:[^)]+\)/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 700);
}

async function fetchJikanMalFallback(malId, searchTitles = []) {
  let resolvedMalId = malId ? Number(malId) : null;
  let malMedia = null;

  try {
    if (resolvedMalId) {
      const res = await fetch(`https://api.jikan.moe/v4/manga/${resolvedMalId}`, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(8000),
      });
      if (res.ok) {
        const j = await res.json();
        malMedia = j?.data || null;
      }
    } else if (searchTitles.length > 0) {
      const q = String(searchTitles[0] || '').trim();
      if (q.length >= 2) {
        const res = await fetch(`https://api.jikan.moe/v4/manga?q=${encodeURIComponent(q)}&limit=5`, {
          headers: { Accept: 'application/json' },
          signal: AbortSignal.timeout(8000),
        });
        if (res.ok) {
          const j = await res.json();
          const list = Array.isArray(j?.data) ? j.data : [];
          for (const candidate of list) {
            const cTitles = [
              candidate.title,
              candidate.title_english,
              candidate.title_japanese,
              ...(Array.isArray(candidate.titles) ? candidate.titles.map((t) => t?.title) : []),
            ].filter(Boolean);
            if (searchTitles.some((st) => cTitles.some((ct) => areSeriesTitlesMatching(st, ct)))) {
              malMedia = candidate;
              resolvedMalId = candidate.mal_id;
              break;
            }
          }
        }
      }
    }
  } catch {}

  if (!resolvedMalId) return null;

  const characters = [];
  try {
    const chRes = await fetch(`https://api.jikan.moe/v4/manga/${resolvedMalId}/characters`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
    });
    if (chRes.ok) {
      const chJson = await chRes.json();
      const chList = Array.isArray(chJson?.data) ? chJson.data.slice(0, 20) : [];
      for (const entry of chList) {
        const charNode = entry?.character;
        const name = String(charNode?.name || '').replace(/,\s*/, ' ').trim();
        if (!charNode?.mal_id || !name) continue;
        const imgUrl = String(
          charNode?.images?.webp?.image_url || charNode?.images?.jpg?.image_url || ''
        ).trim();
        const role = String(entry?.role || '').toLowerCase() === 'main' ? 'main' : 'supporting';
        characters.push({
          id: toComixCharacterUuid(`99${charNode.mal_id}`),
          name,
          alternative_names: [],
          alternativeNames: [],
          image_url: imgUrl,
          imageUrl: imgUrl,
          description: '',
          listing_role: role,
          listingRole: role,
          is_public: true,
          isPublic: true,
          likes_count: 0,
          likesCount: 0,
          source_links: [
            {
              source: 'myanimelist',
              url: charNode.url || `https://myanimelist.net/character/${charNode.mal_id}`,
              externalId: String(charNode.mal_id),
            },
          ],
          sourceLinks: [
            {
              source: 'myanimelist',
              url: charNode.url || `https://myanimelist.net/character/${charNode.mal_id}`,
              externalId: String(charNode.mal_id),
            },
          ],
        });
      }
    }
  } catch {}

  const altTitles = malMedia
    ? [
        malMedia.title,
        malMedia.title_english,
        malMedia.title_japanese,
        ...(Array.isArray(malMedia.titles) ? malMedia.titles.map((t) => t?.title) : []),
      ]
        .map((s) => String(s || '').trim())
        .filter(Boolean)
    : [];

  const genres = malMedia
    ? [
        ...(Array.isArray(malMedia.genres) ? malMedia.genres : []),
        ...(Array.isArray(malMedia.themes) ? malMedia.themes : []),
        ...(Array.isArray(malMedia.demographics) ? malMedia.demographics : []),
      ]
        .map((g) => String(g?.name || '').trim())
        .filter(Boolean)
    : [];

  return {
    malId: resolvedMalId,
    descriptionEn: cleanEnglishSynopsis(malMedia?.synopsis || ''),
    coverUrl: String(
      malMedia?.images?.webp?.large_image_url || malMedia?.images?.jpg?.large_image_url || ''
    ).trim(),
    releaseYear: malMedia?.published?.prop?.from?.year || null,
    altTitles,
    genres,
    characters,
  };
}

export async function fetchAniListMetadataAndCharacters({ anilistId = null, malId = null, searchTitles = [] }) {
  const queryById = `
    query ($id: Int, $idMal: Int, $search: String) {
      Media(id: $id, idMal: $idMal, search: $search, type: MANGA) {
        id
        idMal
        isAdult
        countryOfOrigin
        description(asHtml: false)
        bannerImage
        coverImage {
          extraLarge
          large
        }
        startDate {
          year
        }
        genres
        tags {
          name
          isAdult
        }
        title {
          romaji
          english
          native
        }
        synonyms
        staff(perPage: 10) {
          edges {
            role
            node {
              id
              name {
                full
              }
            }
          }
        }
        characters(sort: [ROLE, RELEVANCE, ID], perPage: 25) {
          edges {
            role
            node {
              id
              name {
                full
                native
                alternative
              }
              image {
                large
                medium
              }
              description
            }
          }
        }
      }
    }
  `;

  const attempts = [];
  if (anilistId) attempts.push({ id: Number(anilistId) });
  if (malId) attempts.push({ idMal: Number(malId) });
  for (const t of searchTitles.slice(0, 3)) {
    if (t && String(t).trim().length >= 2) {
      attempts.push({ search: String(t).trim() });
    }
  }

  for (const variables of attempts) {
    try {
      const res = await fetch('https://graphql.anilist.co', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ query: queryById, variables }),
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) continue;
      const json = await res.json();
      const media = json?.data?.Media;
      if (!media || !media.id) continue;

      const mediaTitles = [
        media.title?.romaji,
        media.title?.english,
        media.title?.native,
        ...(Array.isArray(media.synonyms) ? media.synonyms : []),
      ]
        .map((s) => String(s || '').trim())
        .filter(Boolean);

      // If matched via search, verify title similarity to avoid false-positive AniList matches
      if (variables.search && searchTitles.length > 0) {
        const matchesAny = searchTitles.some((st) =>
          mediaTitles.some((mt) => areSeriesTitlesMatching(st, mt))
        );
        if (!matchesAny) continue;
      }

      const edges = Array.isArray(media.characters?.edges) ? media.characters.edges : [];
      const characters = [];
      const seenCharNames = new Set();

      for (const edge of edges) {
        const node = edge?.node;
        const fullName = String(node?.name?.full || '').trim();
        if (!node?.id || !fullName) continue;
        const nameKey = fullName.toLowerCase();
        if (seenCharNames.has(nameKey)) continue;
        seenCharNames.add(nameKey);

        const role = edge.role === 'MAIN' ? 'main' : 'supporting';
        const imageUrl = String(node.image?.large || node.image?.medium || '').trim();
        const altNames = [
          node.name?.native,
          ...(Array.isArray(node.name?.alternative) ? node.name.alternative : []),
        ]
          .map((s) => String(s || '').trim())
          .filter(Boolean);

        characters.push({
          id: toComixCharacterUuid(node.id),
          name: fullName,
          alternative_names: altNames,
          alternativeNames: altNames,
          image_url: imageUrl,
          imageUrl,
          description: cleanCharacterBio(node.description || ''),
          listing_role: role,
          listingRole: role,
          is_public: true,
          isPublic: true,
          likes_count: 0,
          likesCount: 0,
          source_links: [
            {
              source: 'anilist',
              url: `https://anilist.co/character/${node.id}`,
              externalId: String(node.id),
            },
          ],
          sourceLinks: [
            {
              source: 'anilist',
              url: `https://anilist.co/character/${node.id}`,
              externalId: String(node.id),
            },
          ],
        });
      }

      const resolvedMalId = media.idMal || malId || null;
      // If AniList has 0 characters and we have a MAL ID, supplement characters from MyAnimeList (Jikan)
      if (characters.length === 0 && resolvedMalId) {
        const jikanFallback = await fetchJikanMalFallback(resolvedMalId);
        if (jikanFallback?.characters?.length) {
          characters.push(...jikanFallback.characters);
        }
      }

      const staffEdges = Array.isArray(media.staff?.edges) ? media.staff.edges : [];
      const authors = [];
      const artists = [];
      for (const se of staffEdges) {
        const name = String(se?.node?.name?.full || '').trim();
        const roleLower = String(se?.role || '').toLowerCase();
        if (!name) continue;
        if (roleLower.includes('story') || roleLower.includes('original') || roleLower.includes('author')) {
          if (!authors.includes(name)) authors.push(name);
        }
        if (roleLower.includes('art') || roleLower.includes('illustrat')) {
          if (!artists.includes(name)) artists.push(name);
        }
      }

      const sourceLinks = [
        {
          source: 'anilist',
          url: `https://anilist.co/manga/${media.id}`,
          externalId: String(media.id),
          label: 'AniList',
        },
      ];
      if (resolvedMalId) {
        sourceLinks.push({
          source: 'myanimelist',
          url: `https://myanimelist.net/manga/${resolvedMalId}`,
          externalId: String(resolvedMalId),
          label: 'MyAnimeList',
        });
      }

      const anilistGenres = [
        ...(Array.isArray(media.genres) ? media.genres : []),
        ...(Array.isArray(media.tags) ? media.tags.map((t) => t?.name) : []),
      ]
        .map((s) => String(s || '').trim())
        .filter(Boolean);

      return {
        anilistId: media.id,
        malId: resolvedMalId,
        isAdult: Boolean(media.isAdult || (Array.isArray(media.tags) && media.tags.some((t) => t?.isAdult))),
        countryOfOrigin: String(media.countryOfOrigin || '').toUpperCase(),
        descriptionEn: cleanEnglishSynopsis(media.description || ''),
        bannerUrl: String(media.bannerImage || '').trim(),
        coverUrl: String(media.coverImage?.extraLarge || media.coverImage?.large || '').trim(),
        releaseYear: media.startDate?.year || null,
        authors,
        artists,
        genres: anilistGenres,
        altTitles: mediaTitles,
        characters,
        sourceLinks,
      };
    } catch {
      // try next variable set
    }
  }

  // Fallback to Jikan (MyAnimeList) if AniList did not match
  const jikan = await fetchJikanMalFallback(malId, searchTitles);
  const resolvedMal = jikan?.malId || malId || null;

  return {
    anilistId: anilistId || null,
    malId: resolvedMal,
    isAdult: false,
    countryOfOrigin: '',
    descriptionEn: jikan?.descriptionEn || '',
    bannerUrl: '',
    coverUrl: jikan?.coverUrl || '',
    releaseYear: jikan?.releaseYear || null,
    authors: [],
    artists: [],
    genres: jikan?.genres || [],
    altTitles: jikan?.altTitles || [],
    characters: jikan?.characters || [],
    sourceLinks: [
      ...(anilistId
        ? [{ source: 'anilist', url: `https://anilist.co/manga/${anilistId}`, externalId: String(anilistId), label: 'AniList' }]
        : []),
      ...(resolvedMal
        ? [{ source: 'myanimelist', url: `https://myanimelist.net/manga/${resolvedMal}`, externalId: String(resolvedMal), label: 'MyAnimeList' }]
        : []),
    ],
  };
}

/**
 * Fetches all chapters for a Comix series (`hid`) across all available languages,
 * selects the highest-scoring scanlation group per `(number, language)` with backup failover,
 * verifies sample chapter pages work, and returns clean chapter objects with `views: 0`.
 */
export async function fetchBestComixChaptersByLanguage(hid, mangaId, slug, options = {}) {
  const maxStepsPerDir = Math.max(1, Math.ceil((options.maxPages ?? 14) / 2));
  const verifySamplePages = options.verifySamplePages !== false;
  const hydrateSamplePages = options.hydrateSamplePages !== false;
  const seenChaptersById = new Map();

  for (const dir of ['desc', 'asc']) {
    let raw;
    try {
      raw = await fetchComixApi(`/manga/${hid}/chapters`, {
        page: 1,
        limit: 100,
        order: { number: dir },
      });
    } catch {
      break;
    }

    let pageItems = unpackChapters(raw);
    if (!pageItems || pageItems.length === 0) break;
    for (const item of pageItems) {
      if (item && item.id) seenChaptersById.set(item.id, item);
    }

    const total = Number(raw?.meta?.total ?? raw?.pagination?.total ?? pageItems.length);
    if (total <= 100) break;
    if (dir === 'asc' && total <= 200) break;

    for (let step = 0; step < maxStepsPerDir; step++) {
      const currentTo = Number(raw?.meta?.to ?? raw?.pagination?.to ?? 0);
      if (!currentTo || currentTo >= Math.ceil(total / 2) + 60) break;

      const lastId = pageItems[pageItems.length - 1]?.id;
      if (!lastId) break;

      let bestLimit = 99 - (step % 40);
      let bestNextTo = 0;
      for (let L = 55; L <= 100; L++) {
        const nextTo = Math.ceil(currentTo / L) * L;
        if (nextTo > bestNextTo) {
          bestNextTo = nextTo;
          bestLimit = L;
        }
      }
      if (bestNextTo <= currentTo) break;

      try {
        raw = await fetchComixApi(`/manga/${hid}/chapters`, {
          limit: bestLimit,
          around: lastId,
          order: { number: dir },
        });
        pageItems = unpackChapters(raw);
        if (!pageItems || pageItems.length === 0) break;
        for (const item of pageItems) {
          if (item && item.id) seenChaptersById.set(item.id, item);
        }
      } catch {
        break;
      }
    }
  }

  const allUnpacked = Array.from(seenChaptersById.values());

  if (allUnpacked.length === 0) {
    return { valid: false, chapters: [], languages: [], samplePages: [] };
  }

  // Group candidates by `${number}:${language}` and rank by best group score
  const candidatesByKey = new Map();
  for (const ch of allUnpacked) {
    if (!ch || !ch.id || Number.isNaN(Number(ch.number))) continue;
    const lang = String(ch.language || 'en').toLowerCase().trim() || 'en';
    const num = Number(ch.number);
    const key = `${num}:${lang}`;

    const score =
      (ch.isOfficial ? 10000 : 0) +
      (ch.group?.name ? 500 : 0) +
      Number(ch.votes || 0) * 10 +
      Number(ch.id || 0) * 0.000001;

    const list = candidatesByKey.get(key) || [];
    list.push({ ...ch, number: num, language: lang, score });
    candidatesByKey.set(key, list);
  }

  for (const list of candidatesByKey.values()) {
    list.sort((a, b) => b.score - a.score);
  }

  const chosenEntries = [];
  for (const [key, list] of candidatesByKey.entries()) {
    chosenEntries.push({
      key,
      primary: list[0],
      backup: list[1] || null,
      pages: [],
    });
  }

  chosenEntries.sort((a, b) => {
    if (a.primary.number !== b.primary.number) return a.primary.number - b.primary.number;
    return a.primary.language.localeCompare(b.primary.language);
  });

  if (chosenEntries.length === 0) {
    return { valid: false, chapters: [], languages: [], samplePages: [] };
  }

  let samplePages = [];
  if (verifySamplePages) {
    // Pick first chapter (preferably English or Turkish, otherwise first entry)
    const sampleEntry =
      chosenEntries.find((e) => e.primary.language === 'en' && Number.isInteger(e.primary.number)) ||
      chosenEntries.find((e) => e.primary.language === 'en') ||
      chosenEntries.find((e) => e.primary.language === 'tr') ||
      chosenEntries[0];

    if (sampleEntry) {
      try {
        const rawCh = await fetchComixApi(`/chapters/${sampleEntry.primary.id}`);
        const unpackedPages = unpackChapterPages(rawCh);
        if (unpackedPages.pages && unpackedPages.pages.length >= 2) {
          samplePages = unpackedPages.pages;
          if (hydrateSamplePages) {
            sampleEntry.pages = unpackedPages.pages;
          }
        } else if (sampleEntry.backup) {
          const backupRaw = await fetchComixApi(`/chapters/${sampleEntry.backup.id}`);
          const backupPages = unpackChapterPages(backupRaw);
          if (backupPages.pages && backupPages.pages.length >= 2) {
            sampleEntry.primary = sampleEntry.backup;
            samplePages = backupPages.pages;
            if (hydrateSamplePages) {
              sampleEntry.pages = backupPages.pages;
            }
          }
        }
      } catch {
        if (sampleEntry.backup) {
          try {
            const backupRaw = await fetchComixApi(`/chapters/${sampleEntry.backup.id}`);
            const backupPages = unpackChapterPages(backupRaw);
            if (backupPages.pages && backupPages.pages.length >= 2) {
              sampleEntry.primary = sampleEntry.backup;
              samplePages = backupPages.pages;
              if (hydrateSamplePages) {
                sampleEntry.pages = backupPages.pages;
              }
            }
          } catch {}
        }
      }
    }

    if (samplePages.length === 0) {
      return { valid: false, chapters: [], languages: [], samplePages: [] };
    }
  }

  // Hydrate chapter pages in parallel batches so chapters in R2 have ready-to-read pages immediately
  if (hydrateSamplePages) {
    const maxHydrate = options.maxHydrateChapters ?? 80;
    const toHydrate = chosenEntries
      .filter((e) => !e.pages || e.pages.length === 0)
      .sort((a, b) => {
        const prioA = a.primary.language === 'tr' ? 0 : a.primary.language === 'en' ? 1 : 2;
        const prioB = b.primary.language === 'tr' ? 0 : b.primary.language === 'en' ? 1 : 2;
        if (prioA !== prioB) return prioA - prioB;
        return a.primary.number - b.primary.number;
      })
      .slice(0, maxHydrate);

    const batchSize = 20;
    for (let i = 0; i < toHydrate.length; i += batchSize) {
      const batch = toHydrate.slice(i, i + batchSize);
      await Promise.all(
        batch.map(async (entry) => {
          try {
            const rawCh = await fetchComixApi(`/chapters/${entry.primary.id}`);
            const unpacked = unpackChapterPages(rawCh);
            if (unpacked.pages && unpacked.pages.length >= 2) {
              entry.pages = unpacked.pages;
              return;
            }
            if (entry.backup) {
              const bRaw = await fetchComixApi(`/chapters/${entry.backup.id}`);
              const bUnpacked = unpackChapterPages(bRaw);
              if (bUnpacked.pages && bUnpacked.pages.length >= 2) {
                entry.primary = entry.backup;
                entry.pages = bUnpacked.pages;
                return;
              }
            }
            if (unpacked.pages && unpacked.pages.length > 0 && Number.isInteger(entry.primary.number)) {
              entry.pages = unpacked.pages;
            } else {
              entry.dead = true;
            }
          } catch {
            // Leave pages empty for on-demand resolution if transient error
          }
        })
      );
    }
  }

  const nowIso = new Date().toISOString();
  const languagesSet = new Set();
  const validEntries = chosenEntries.filter((e) => !e.dead);
  const finalChapters = validEntries.map((entry) => {
    const ch = entry.primary;
    languagesSet.add(ch.language);
    const chUuid = toComixChapterUuid(ch.id);
    const sourceUrl = `https://comix.to/title/${hid}-${slug}/${ch.id}-chapter-${ch.number}`;
    return {
      id: chUuid,
      manga_id: mangaId,
      mangaId,
      number: ch.number,
      chapterNumber: ch.number,
      title: cleanChapterTitle(ch.name, ch.number),
      language: ch.language,
      pages: entry.pages || [],
      pageCount: entry.pages?.length || undefined,
      views: 0,
      release_date: nowIso,
      releaseDate: nowIso,
      source_url: sourceUrl,
      sourceUrl,
      _sourceLink: sourceUrl,
    };
  });

  return {
    valid: finalChapters.length > 0,
    chapters: finalChapters,
    languages: Array.from(languagesSet),
    samplePages,
  };
}

