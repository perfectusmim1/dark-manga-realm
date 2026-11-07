/**
 * Comix.to Custom Binary/Stream Cipher & Request Signing Engine (TypeScript / Browser + Edge)
 * Supports Comix to40oy / to260x API v1 protocol.
 */

export const COMIX_KID = 'c38';

const MATERIAL = new Uint8Array([
  250,133,109,158,214,229,160,58,55,248,136,196,220,208,205,15,28,139,230,166,160,114,172,107,189,60,229,203,171,239,63,18,250,148,160,101,93,94,46,228,116,28,41,94,103,39,183,207,243,118,101,8,7,167,201,49,104,194,182,204,61,196,200,63,196,116,116,201,7,184,183,65,207,210,135,48,112,218,98,171,186,53,125,0,129,131,242,138,26,66,164,236,10,214,99,170,217,150,83,16,118,66,246,104,20,4,248,222,242,46,251,49,45,214,246,251,62,170,14,68,3,199,33,178,62,107,1,53,48,107,8,160,137,196,213,112,57,80,187,98,61,108,185,156,66,21,74,164,147,94,82,133,29,208,214,249,124,197,241,234,222,118,23,46,40,227,168,151,120,18,236,232,81,121,15,147,185,169,234,70,76,3,104,40,18,5,220,242,177,122,134,220,29,127,54,212,91,76,214,249,109,250,136,28,248,74,80,195,186,32,74,82,179,76,46,80,109,168,58,64,126,237,83,183,193,50,125,22,169,140,106,169,246,204,107,76,194,231,45,182,52,80,174,208,121,150,56,94,130,35,102,36,95,14,239,35,130,205,87,44,95,132,8,125,93,131,118,34,77,227,101,223,248,96,133,21,185,104,168,119,13,45,244,154,32,74,125,178,156,54,202,59,141,238,127,20,135,27,42,145,0,201,104,18,37,23,158,4,102,77,28,132,84,27,236,102,155,14,87,46,186,39,235,11,201,146,233,155,175,138,16,74,171,218,186,213,65,105,70,243,50,90,181,230,83,148,96,249,82,2,179,123,134,31,199,159,122,202,243,238,239,28,64,101,101,66,42,221,20,110,237,126,96,252,57,6,94,12,112,227,17,151,77,225,68,86,101,168,245,70,46,63,10,190,141,153,92,60,208,142,138,144,230,159,72,195,12,75,135,86,37,19,216,245,121,89,225,169,171,104,223,218,189,3,125,9,177,188,244,188,250,187,245,49,50,186,92,144,11,255,193,151,230,51,133,88,218,57,162,17,88,39,91,57,42,18,200,4,247,11,167,137,238,83,30,100,57,145,90,208,177,9,204,175,39,84,222,90,169,163,131,153,34,33,192,228,190,125,187,5,46,157,95,23,90,34,200,171,113,42,116,11,24,185,61,65,4,15,132,51,95,80,53,132,119,235,229,97,233,128,35,0,76,194,214,80,218,209,1,90,124,237,176,13,26,160,63,85,239,180,45,123,177,137,114,17,14,145,32,137,14,53,103,79,217,141,7,187,2,77,11,12,11,223,244,82,141,78,110,201,249,106,35,252,69,121,181,53,194,111,188,88,151,79,13,216,57,238,136,14,66,154,188,163,96,20,33,203,68,45,49,120,122,109,62,142,77,47,143,232,151,249,41,178,45,84,5,111,139,28,234,132,42,77,115,243,179,229,9,9,154,67,131,177,8,141,121,58,179,179,163,159,123,30,24,230,57,132,142,49,1,204,96,158,74,156,199,100,47,11,250,228,88,166,163,134,180,22,46,93,177,246,245,116,48,160,198,46,80,167,210,169,117,94,170,45,190,52,33,128,10,183,138,47,94,241,94,74,64,72,164,205,34,231,16,33,37,232,125,92,254,97,187,138,32,196,70,98,36,148,1,47,199,127,191,203,126,127,35,165,203,111,237,86,235,95,6,245,57,134,171,232,186,187,247,23,249,136,212,87,73,157,195,89,207,227,75,129,255,51,54,82,89,180,19,165,22,239,107,167,241,250,42,143,157,237,108,2,226,212,58,180,63,30,118,101,73,100,121,91,45,99,102,116,72,89,169,204,222,205,156,160,146,212,0,127,185,81,189,135,236,19,11,167,65,93,8,217,26,217,159,151,87,90,163,72,113,217,24,120,37,145,236,251,238,148,125,144,14,33,84,189,62,57,114,135,11,32,255,139,169,76,92,222,185,238,111,106,21,41,17,245,65,197,154,158,221,250,215,203,254,7,107,132,151,142,178,76,11,19,160,113,242,179,181,47,124,93,43,13,43,149,184,235,204,60,211,239,66,89,217,53,172,2,245,201,186,201,146,160,199,151,227,32,151,148,89,162,29,224,232,2,216,178,82,52,205,21,195,175,61,157,68,73,189,52,247,47,238,148,109,235,223,242,132,206,108,134,147,15,220,7,88,76,157,43,13,193,227,109,118,122,183,41,56,214,99,106,65,63,34,72,195,93,85,21,75,251,115,209,255,58,249,79,249,11,32,56,239,49,192,2,152,160,153,97,172,63,67,255,16,126,175,121,99,169,247,252,250,32,7,254,19,231,115,206,30,218,18,188,200,250,31,213,248,50,89,224,58,49,95,153,37,199,221,35,232,98,15,242,195,133,132,237,143,126,250,20,116,113,14,1,143,74,80,105,40,14,209,177,255,245,50,150,214,169,207,232,67,70,127,160,180,127,80,121,18,3,116,75,227,240,250,162,98,24,168,152
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
let BASE64_LOOKUP: Int16Array | null = null;

function getBase64Lookup(): Int16Array {
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

function rotr(x: number, n: number): number {
  return (x >>> n) | (x << (32 - n));
}

function sha256Block(state: Uint32Array, block: Uint8Array, offset: number): void {
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

function customSha256(iv: Uint32Array, data: Uint8Array, extraLen: number): Uint8Array {
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

function readUint32ArrayBE(bytes: Uint8Array, offset: number): Uint32Array {
  const out = new Uint32Array(8);
  for (let i = 0; i < 8; i++) {
    const j = offset + 4 * i;
    out[i] = (bytes[j] << 24) | (bytes[j + 1] << 16) | (bytes[j + 2] << 8) | bytes[j + 3];
  }
  return out;
}

function toBase64Url(bytes: Uint8Array): string {
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

function fromBase64Url(rawStr: string): Uint8Array {
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

export function signPath(canonicalPath: string): string {
  const data = new TextEncoder().encode(canonicalPath);
  const iv1 = readUint32ArrayBE(MATERIAL, 0);
  const iv2 = readUint32ArrayBE(MATERIAL, 32);
  const innerHash = customSha256(iv1, data, 64);
  const outerHash = customSha256(iv2, innerHash, 64);
  return `${COMIX_KID}.${toBase64Url(outerHash.subarray(0, 12))}`;
}

export function decryptPayload(encryptedB64: string): any {
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

export function encodeComixRequest(endpoint: string, params: Record<string, string | number | undefined> = {}): {
  url: string;
  headers: Record<string, string>;
  signature: string;
} {
  const [pathPart] = endpoint.replace(/^https?:\/\/[^/]+/, '').split('?');
  const cleanPath = (pathPart || '').replace(/^\/api\/v1/, '');

  const normalizedParams: Record<string, string> = {};
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && k !== '_') {
      if (cleanPath === '/manga' && k === 'q' && params.keyword === undefined) {
        normalizedParams.keyword = String(v);
      } else {
        normalizedParams[k] = String(v);
      }
    }
  }

  const isChapterEndpoint =
    /\/(?:manga\/[^/?]+|groups\/\d+)\/chapters$|^\/chapters\/\d+$/.test(cleanPath);

  if (isChapterEndpoint) {
    if (normalizedParams.v === undefined) normalizedParams.v = '0';
    if (normalizedParams.w === undefined) normalizedParams.w = '0';
  }

  const sortedKeys = Object.keys(normalizedParams).sort();
  const rawEntries = sortedKeys.map((k) => `${k}=${normalizedParams[k]}`);
  const canonical = rawEntries.length > 0 ? `${cleanPath}?${rawEntries.join('&')}` : cleanPath;
  const sig = signPath(canonical);

  const encodedParts = sortedKeys.map(
    (k) => `${encodeURIComponent(k).replace(/%5B/gi, '[').replace(/%5D/gi, ']')}=${encodeURIComponent(normalizedParams[k])}`
  );
  encodedParts.push(`_=${encodeURIComponent(sig)}`);

  return {
    url: `https://comix.to/api/v1${cleanPath}?${encodedParts.join('&')}`,
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

export function decodeComixResponse(textOrJson: string | any): any {
  const json = typeof textOrJson === 'string' ? JSON.parse(textOrJson) : textOrJson;
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

export function buildComixPageMirrorUrls(
  primaryUrl: string,
  altDomains: string[] = [],
  alt2Domain: string | null = 'kkplayer.wtf',
  altNode: string | null = null,
  pageIndex = 0
): string[] {
  if (!primaryUrl) return [];
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
  ].filter(Boolean) as string[];

  const nodes = altNode && altNode !== primaryNode ? [primaryNode, altNode] : [primaryNode];
  const candidates: string[] = [];
  for (const node of nodes) {
    for (const domain of domains) {
      const candidateUrl = `${protocol}${node}.${domain}${pathAndQuery}`;
      if (!candidates.includes(candidateUrl)) {
        candidates.push(candidateUrl);
      }
    }
  }
  return candidates.length > 0 ? candidates : [fullUrl];
}

export function unpackComixManga(raw: any) {
  if (!raw || typeof raw !== 'object') return raw;
  const mapTermList = (arr: any[]) =>
    (arr ?? []).map((item) => ({
      id: item.id ?? item.tr,
      title: item.title ?? item.N_ ?? item.name ?? '',
      slug: item.slug ?? '',
    }));

  const normalizeComixAssetUrl = (u: unknown): string => {
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
    followsTotal: 0,
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
    sources: (raw.sources ?? raw.sy ?? []).map((s: any) => ({ label: s.label ?? s.hR, url: s.url ?? s.ub })),
  };
}

export function unpackComixChapters(raw: any) {
  const list = Array.isArray(raw) ? raw : (raw?.items ?? raw?.lr ?? []);
  return list.map((ch: any) => ({
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

export function unpackComixChapterPages(raw: any) {
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

  const pageObjects = rawItems.map((p: any, idx: number) => {
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
    pages: pageObjects.map((p: any) => p.url).filter(Boolean),
    pageObjects,
  };
}
