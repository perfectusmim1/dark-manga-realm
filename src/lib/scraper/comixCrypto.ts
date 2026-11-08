/**
 * Comix.to Custom Binary/Stream Cipher & Request Signing Engine (TypeScript / Browser + Edge)
 * Supports Comix to40oy / to260x API v1 protocol.
 */

export const COMIX_KID = '27e';

const MATERIAL = new Uint8Array([
  142,113,0,206,155,30,228,191,122,38,137,110,146,126,150,164,12,144,221,45,62,169,108,55,186,6,192,21,103,239,1,81,146,155,5,173,222,14,125,220,152,103,56,111,73,56,219,96,233,97,161,229,231,215,250,242,61,220,234,192,0,109,184,85,23,254,66,219,230,45,70,212,254,156,24,214,43,162,77,2,63,116,211,146,234,165,63,206,202,149,227,241,152,243,225,19,130,80,213,195,42,218,91,27,208,190,169,245,159,4,214,35,231,31,25,194,8,157,223,10,127,118,5,52,74,29,96,201,165,119,202,31,248,76,210,92,25,240,9,223,97,254,210,232,70,168,145,236,70,198,96,229,60,114,158,218,90,215,223,159,146,155,95,161,21,35,179,25,159,55,99,234,181,184,138,148,238,97,209,118,131,126,0,145,39,168,70,64,214,40,202,130,5,77,220,194,159,144,156,48,82,62,149,97,215,192,133,116,91,87,152,194,16,31,133,32,44,163,1,95,151,92,203,96,65,136,12,66,188,175,248,127,140,144,153,148,34,238,240,44,40,3,81,19,164,14,211,180,162,249,227,117,241,188,0,212,15,178,110,246,193,253,107,40,25,211,79,250,237,137,212,72,15,216,135,130,213,227,211,209,81,12,157,129,35,4,233,203,214,99,241,252,95,174,89,126,250,53,241,13,232,36,248,29,225,202,180,96,30,86,192,60,57,200,210,214,202,237,235,82,89,9,94,112,119,167,46,0,221,159,32,188,243,24,38,236,204,3,185,120,148,123,108,108,252,107,34,135,185,179,103,46,77,23,161,94,126,48,11,18,130,159,23,35,241,209,242,54,0,246,95,133,173,173,34,98,236,172,2,108,30,255,147,133,228,0,128,164,230,5,66,81,248,248,194,17,185,89,99,41,18,188,11,49,24,243,72,218,155,156,148,184,151,150,133,179,107,0,134,250,191,41,170,184,44,153,12,81,217,62,162,208,39,246,86,169,36,116,222,232,114,101,161,216,67,21,184,74,38,55,136,38,102,133,89,120,98,142,230,247,189,127,253,183,187,58,229,99,191,207,245,48,9,215,22,78,101,74,26,240,152,86,248,121,150,134,146,80,116,42,222,174,205,161,215,65,88,190,137,20,41,126,211,230,225,136,26,77,49,0,196,106,241,128,30,175,136,225,8,252,145,78,42,220,64,228,25,56,82,202,35,54,150,154,196,145,137,103,121,147,161,7,74,83,21,196,48,167,93,230,14,248,139,90,246,161,173,83,32,175,127,111,83,195,49,254,122,115,196,203,141,58,34,99,186,229,168,55,106,167,110,59,42,235,231,57,11,156,99,45,225,66,209,5,77,163,161,76,13,148,141,47,138,245,62,42,43,225,62,237,187,16,187,203,82,145,100,45,158,151,9,94,213,79,240,40,231,155,101,209,103,31,187,1,130,152,189,31,172,76,215,30,249,22,45,141,88,96,81,135,18,143,117,44,26,243,64,191,32,123,117,65,162,160,132,96,209,20,210,241,56,183,26,241,78,198,42,47,79,57,28,166,182,59,186,32,36,73,137,19,97,15,165,212,123,50,126,179,72,177,103,27,176,203,27,111,198,56,247,2,37,52,209,203,165,77,183,202,41,248,202,189,177,230,150,117,253,92,228,207,156,72,243,212,26,171,43,32,71,214,53,145,89,242,81,127,177,9,63,250,118,34,183,248,226,81,29,108,5,49,252,245,192,69,82,116,230,249,39,172,188,24,222,137,48,216,171,46,114,8,99,42,80,117,9,189,248,162,62,131,230,162,97,19,179,136,168,78,110,48,161,74,225,1,110,105,211,178,6,71,56,215,249,252,135,115,175,12,158,184,62,4,173,88,253,135,255,74,33,69,41,36,74,47,15,232,10,211,194,172,180,215,95,48,124,78,7,45,241,135,224,23,30,130,20,9,36,192,228,206,221,145,221,230,66,109,187,33,9,152,204,176,58,133,46,136,221,245,193,27,95,211,84,6,56,178,157,8,97,141,177,109,193,197,108,84,24,175,162,113,52,138,137,218,114,68,248,171,0,4,70,45,119,227,158,235,244,143,118,206,121,159,15,240,56,175,51,92,26,228,87,48,68,158,59,194,249,182,180,102,250,57,79,150,127,38,118,87,194,166,84,18,65,100,75,199,83,230,157,181,52,241,191,117,118,252,252,219,145,10,230,0,36,132,41,22,18,85,60,178,160,243,224,250,190,107,186,74,3,75,251,108,154,130,146,18,45,80,108,92,233,114,193,138,145,79,183,138,251,153,161,13,179,141,137,149,12,81,139,230,214,115,51,119,156,121,33,171,239,212,164,84,200,227,42,142,208,76,196,59,159,96,218,31,0,75,162,156,42,234,241,249,106,33,172,203,189,169,10,201,193,223,71,234,12,176,211,67,231,241,131,139,164,23,131,238,173,170,69,84,126,185,162,178,122,28,157,206
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
