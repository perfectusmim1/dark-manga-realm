import { createClient } from "jsr:@supabase/supabase-js@2";

type JwtClaims = {
  userId: string | null;
  sessionId: string | null;
};

type SessionLocation = {
  country: string | null;
  city: string | null;
  region: string | null;
};

type UpsertSessionMetadataOptions = {
  userId: string;
  sessionId: string | null;
  userAgent: string | null;
  request: Request;
  lastActiveAt?: string;
};

const GEO_LOOKUP_TIMEOUT_MS = 1800;
const LOCATION_PLACEHOLDER_VALUES = new Set([
  "",
  "-",
  "unknown",
  "null",
  "undefined",
  "n/a",
  "na",
]);

const normalizeLocationValue = (value: string | null | undefined) => {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }

  return LOCATION_PLACEHOLDER_VALUES.has(trimmed.toLowerCase()) ? null : trimmed;
};

const hasMeaningfulLocation = (location: SessionLocation | null | undefined) =>
  Boolean(location?.country || location?.region || location?.city);

const base64UrlDecode = (value: string) => {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padding = normalized.length % 4;
  const padded = padding === 0 ? normalized : normalized.padEnd(normalized.length + (4 - padding), "=");
  return atob(padded);
};

export const getJwtClaims = (accessToken: string): JwtClaims | null => {
  try {
    const [, payload] = accessToken.split(".");
    if (!payload) {
      return null;
    }

    const decoded = JSON.parse(base64UrlDecode(payload));
    return {
      userId: typeof decoded?.sub === "string" ? decoded.sub : null,
      sessionId: typeof decoded?.session_id === "string" ? decoded.session_id : null,
    };
  } catch {
    return null;
  }
};

export const sha256Hex = async (value: string) => {
  const encoded = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
};

export const parseUserAgent = (userAgent: string | null) => {
  const ua = userAgent || "";

  let browser = "Unknown";
  if (/Firefox\//i.test(ua)) {
    browser = "Firefox";
  } else if (/Edg\//i.test(ua)) {
    browser = "Edge";
  } else if (/OPR\//i.test(ua)) {
    browser = "Opera";
  } else if (/Chrome\//i.test(ua)) {
    browser = "Chrome";
  } else if (/Safari\//i.test(ua)) {
    browser = "Safari";
  }

  let os = "Unknown";
  if (/Windows/i.test(ua)) {
    os = "Windows";
  } else if (/Android/i.test(ua)) {
    os = "Android";
  } else if (/iPhone|iPad|iPod/i.test(ua)) {
    os = "iOS";
  } else if (/Mac OS X|Macintosh/i.test(ua)) {
    os = "macOS";
  } else if (/Linux/i.test(ua)) {
    os = "Linux";
  }

  let deviceType = "desktop";
  if (/iPad|Tablet/i.test(ua)) {
    deviceType = "tablet";
  } else if (/Mobi|Mobile|Android/i.test(ua)) {
    deviceType = "mobile";
  }

  return { browser, os, deviceType };
};

const getHeaderValue = (request: Request, names: string[]) => {
  for (const name of names) {
    const value = normalizeLocationValue(request.headers.get(name));
    if (value) {
      return value;
    }
  }

  return null;
};

export const getIpAddress = (request: Request) => {
  const forwardedFor = request.headers.get("x-forwarded-for") ?? "";
  const firstForwardedIp = forwardedFor.split(",")[0]?.trim();
  return firstForwardedIp
    || normalizeLocationValue(request.headers.get("x-real-ip"))
    || normalizeLocationValue(request.headers.get("cf-connecting-ip"))
    || "unknown";
};

const readLocationFromHeaders = (request: Request): SessionLocation => ({
  country: getHeaderValue(request, [
    "x-country-name",
    "x-country",
    "x-vercel-ip-country",
    "cf-ipcountry",
  ]),
  region: getHeaderValue(request, [
    "x-region-name",
    "x-region",
    "x-vercel-ip-country-region",
  ]),
  city: getHeaderValue(request, [
    "x-city",
    "x-vercel-ip-city",
  ]),
});

const isPublicIpAddress = (ipAddress: string) => {
  const normalized = ipAddress.trim().toLowerCase();
  if (!normalized || normalized === "unknown") {
    return false;
  }

  if (
    normalized === "127.0.0.1"
    || normalized === "::1"
    || normalized.startsWith("10.")
    || normalized.startsWith("192.168.")
    || normalized.startsWith("169.254.")
    || normalized.startsWith("172.16.")
    || normalized.startsWith("172.17.")
    || normalized.startsWith("172.18.")
    || normalized.startsWith("172.19.")
    || normalized.startsWith("172.2")
    || normalized.startsWith("172.30.")
    || normalized.startsWith("172.31.")
    || normalized.startsWith("fc")
    || normalized.startsWith("fd")
    || normalized.startsWith("fe80:")
  ) {
    return false;
  }

  return true;
};

const fetchLocationFromIp = async (ipAddress: string): Promise<SessionLocation | null> => {
  if (!isPublicIpAddress(ipAddress)) {
    return null;
  }

  const abortController = new AbortController();
  const timeoutHandle = setTimeout(() => abortController.abort(), GEO_LOOKUP_TIMEOUT_MS);

  try {
    const response = await fetch(`https://ipwho.is/${encodeURIComponent(ipAddress)}`, {
      headers: {
        Accept: "application/json",
      },
      signal: abortController.signal,
    });

    if (!response.ok) {
      return null;
    }

    const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
    if (!payload || payload.success === false) {
      return null;
    }

    return {
      country: normalizeLocationValue(
        typeof payload.country === "string" ? payload.country : null,
      ) || normalizeLocationValue(
        typeof payload.country_code === "string" ? payload.country_code : null,
      ),
      region: normalizeLocationValue(
        typeof payload.region === "string" ? payload.region : null,
      ),
      city: normalizeLocationValue(
        typeof payload.city === "string" ? payload.city : null,
      ),
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutHandle);
  }
};

const loadExistingSessionLocation = async (
  serviceClient: ReturnType<typeof createClient>,
  userId: string,
  sessionTokenHash: string,
) => {
  const { data, error } = await serviceClient
    .from("user_sessions")
    .select("country, city, region")
    .eq("user_id", userId)
    .eq("session_token_hash", sessionTokenHash)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return {
    country: normalizeLocationValue(data?.country),
    city: normalizeLocationValue(data?.city),
    region: normalizeLocationValue(data?.region),
  } satisfies SessionLocation;
};

export const upsertUserSessionMetadata = async (
  serviceClient: ReturnType<typeof createClient>,
  options: UpsertSessionMetadataOptions,
) => {
  if (!options.userId || !options.sessionId) {
    return;
  }

  const sessionTokenHash = await sha256Hex(options.sessionId);
  const parsedUserAgent = parseUserAgent(options.userAgent);
  const headerLocation = readLocationFromHeaders(options.request);

  let resolvedLocation = headerLocation;
  if (!hasMeaningfulLocation(resolvedLocation)) {
    const existingLocation = await loadExistingSessionLocation(serviceClient, options.userId, sessionTokenHash);
    if (hasMeaningfulLocation(existingLocation)) {
      resolvedLocation = existingLocation;
    } else {
      const ipLocation = await fetchLocationFromIp(getIpAddress(options.request));
      if (ipLocation) {
        resolvedLocation = ipLocation;
      }
    }
  }

  const { error } = await serviceClient
    .from("user_sessions")
    .upsert({
      user_id: options.userId,
      session_token_hash: sessionTokenHash,
      browser: parsedUserAgent.browser,
      os: parsedUserAgent.os,
      device_type: parsedUserAgent.deviceType,
      country: resolvedLocation.country,
      city: resolvedLocation.city,
      region: resolvedLocation.region,
      last_active_at: options.lastActiveAt || new Date().toISOString(),
    }, {
      onConflict: "user_id,session_token_hash",
      ignoreDuplicates: false,
    });

  if (error) {
    throw error;
  }
};
