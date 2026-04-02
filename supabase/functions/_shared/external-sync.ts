import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";

export type ExternalSyncProvider = "myanimelist" | "anilist";

export type ExternalSourceLink = {
  source?: string | null;
  url?: string | null;
  kind?: string | null;
  label?: string | null;
  externalId?: string | null;
  externalSlug?: string | null;
};

export type ExternalProviderAccountRow = {
  user_id: string;
  provider: ExternalSyncProvider;
  provider_user_id?: string | null;
  access_token: string;
  refresh_token?: string | null;
  token_expires_at?: string | null;
  scopes?: string[] | null;
  connected_at?: string | null;
  updated_at?: string | null;
  last_error?: string | null;
  last_error_at?: string | null;
};

export type ExternalRatingCacheEntry = {
  score?: number | null;
  url?: string;
  updatedAt?: string;
  members?: number | null;
  favorites?: number | null;
  popularity?: number | null;
  rank?: number | null;
};

const MAL_AUTH_BASE_URL = "https://myanimelist.net/v1/oauth2/authorize";
const MAL_TOKEN_URL = "https://myanimelist.net/v1/oauth2/token";
const MAL_API_BASE_URL = "https://api.myanimelist.net/v2";
const ANILIST_AUTH_BASE_URL = "https://anilist.co/api/v2/oauth/authorize";
const ANILIST_TOKEN_URL = "https://anilist.co/api/v2/oauth/token";
const ANILIST_GRAPHQL_URL = "https://graphql.anilist.co";
const ACCOUNT_EXPIRY_SKEW_MS = 60_000;
export const EXTERNAL_RATING_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

const MAL_ID_PATTERN = /\/manga\/(\d+)/i;
const ANILIST_ID_PATTERN = /\/manga\/(\d+)/i;

const normalizeText = (value?: string | null) => value?.trim().replace(/\s+/g, " ") || "";

export const normalizeProvider = (value?: string | null): ExternalSyncProvider | null => {
  const normalized = normalizeText(value).toLowerCase();
  if (normalized === "myanimelist" || normalized === "anilist") {
    return normalized;
  }

  return null;
};

export const getSiteUrl = () => {
  const configuredSiteUrl = normalizeText(
    Deno.env.get("PUBLIC_SITE_URL")
      || Deno.env.get("SITE_URL")
      || Deno.env.get("APP_SITE_URL"),
  );

  if (configuredSiteUrl) {
    return configuredSiteUrl.replace(/\/+$/, "");
  }

  return "http://localhost:5173";
};

const getFunctionsBaseUrl = () => {
  const supabaseUrl = normalizeText(Deno.env.get("SUPABASE_URL"));
  if (!supabaseUrl) {
    throw new Error("Missing SUPABASE_URL");
  }

  return `${supabaseUrl.replace(/\/+$/, "")}/functions/v1`;
};

export const getProviderRedirectUri = (provider: ExternalSyncProvider) => {
  const envKey = provider === "myanimelist" ? "MAL_REDIRECT_URL" : "ANILIST_REDIRECT_URL";
  const configured = normalizeText(Deno.env.get(envKey));
  if (configured) {
    return configured;
  }

  return `${getFunctionsBaseUrl()}/external-sync?provider=${provider}`;
};

export const buildSiteRedirectUrl = (
  redirectPath?: string | null,
  params?: Record<string, string | null | undefined>,
) => {
  const siteUrl = getSiteUrl();
  const nextPath = normalizeText(redirectPath).startsWith("/")
    ? normalizeText(redirectPath)
    : "/settings?tab=sync";
  const url = new URL(nextPath || "/settings?tab=sync", `${siteUrl}/`);

  Object.entries(params || {}).forEach(([key, value]) => {
    if (!normalizeText(value)) {
      return;
    }

    url.searchParams.set(key, normalizeText(value));
  });

  return url.toString();
};

const toBase64Url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");

export const createRandomToken = (size = 32) => {
  const bytes = crypto.getRandomValues(new Uint8Array(size));
  return toBase64Url(bytes);
};

export const createPkceVerifier = () => createRandomToken(48);

export const getProviderLink = (
  sourceLinks: unknown,
  provider: ExternalSyncProvider,
): ExternalSourceLink | null => {
  if (!Array.isArray(sourceLinks)) {
    return null;
  }

  for (const item of sourceLinks) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const link = item as ExternalSourceLink;
    if (normalizeProvider(link.source) === provider && normalizeText(link.url)) {
      return {
        ...link,
        source: provider,
        url: normalizeText(link.url),
        externalId: normalizeText(link.externalId) || undefined,
        externalSlug: normalizeText(link.externalSlug) || undefined,
      };
    }
  }

  return null;
};

export const getProviderMediaId = (link: ExternalSourceLink | null) => {
  const directId = normalizeText(link?.externalId);
  if (directId) {
    return directId;
  }

  const sourceUrl = normalizeText(link?.url);
  if (!sourceUrl) {
    return "";
  }

  if (normalizeProvider(link?.source) === "myanimelist") {
    return sourceUrl.match(MAL_ID_PATTERN)?.[1] || "";
  }

  if (normalizeProvider(link?.source) === "anilist") {
    return sourceUrl.match(ANILIST_ID_PATTERN)?.[1] || "";
  }

  return "";
};

export const isExternalRatingEntryStale = (entry?: ExternalRatingCacheEntry | null) => {
  if (!entry?.updatedAt) {
    return true;
  }

  const timestamp = Date.parse(entry.updatedAt);
  if (!Number.isFinite(timestamp)) {
    return true;
  }

  return (Date.now() - timestamp) >= EXTERNAL_RATING_CACHE_TTL_MS;
};

export const sha256Hex = async (value: string) => {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );

  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
};

const formEncode = (payload: Record<string, string>) => {
  const body = new URLSearchParams();
  Object.entries(payload).forEach(([key, value]) => body.set(key, value));
  return body.toString();
};

const parseJsonResponse = async <T>(response: Response) => {
  const text = await response.text();
  if (!text) {
    return null as T | null;
  }

  return JSON.parse(text) as T;
};

const fetchJson = async <T>(
  input: string,
  init?: RequestInit,
) => {
  const response = await fetch(input, init);
  const payload = await parseJsonResponse<T & { error?: string; message?: string; errors?: Array<{ message?: string }> }>(response).catch(() => null);

  if (!response.ok) {
    const message = payload && typeof payload === "object"
      ? payload.error
        || payload.message
        || payload.errors?.find((item) => normalizeText(item?.message))?.message
        || `Request failed with status ${response.status}`
      : `Request failed with status ${response.status}`;
    throw new Error(message);
  }

  return payload as T;
};

export const createProviderAuthorizeUrl = (
  provider: ExternalSyncProvider,
  state: string,
  redirectPath?: string | null,
  codeVerifier?: string | null,
) => {
  const redirectUri = getProviderRedirectUri(provider);
  const url = new URL(
    provider === "myanimelist" ? MAL_AUTH_BASE_URL : ANILIST_AUTH_BASE_URL,
  );

  if (provider === "myanimelist") {
    const clientId = normalizeText(Deno.env.get("MAL_CLIENT_ID"));
    if (!clientId) {
      throw new Error("MAL_CLIENT_ID tanımlı değil");
    }

    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("state", state);
    url.searchParams.set("code_challenge", normalizeText(codeVerifier));
    url.searchParams.set("code_challenge_method", "plain");
  } else {
    const clientId = normalizeText(Deno.env.get("ANILIST_CLIENT_ID"));
    if (!clientId) {
      throw new Error("ANILIST_CLIENT_ID tanımlı değil");
    }

    url.searchParams.set("client_id", clientId);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("state", state);
  }

  if (normalizeText(redirectPath)) {
    url.searchParams.set("tp_redirect", normalizeText(redirectPath));
  }

  return url.toString();
};

export const exchangeAuthorizationCode = async (
  provider: ExternalSyncProvider,
  code: string,
  codeVerifier?: string | null,
) => {
  const redirectUri = getProviderRedirectUri(provider);

  if (provider === "myanimelist") {
    const clientId = normalizeText(Deno.env.get("MAL_CLIENT_ID"));
    const clientSecret = normalizeText(Deno.env.get("MAL_CLIENT_SECRET"));
    if (!clientId) {
      throw new Error("MAL_CLIENT_ID tanımlı değil");
    }

    const response = await fetch(MAL_TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: formEncode({
        grant_type: "authorization_code",
        client_id: clientId,
        ...(clientSecret ? { client_secret: clientSecret } : {}),
        code: normalizeText(code),
        code_verifier: normalizeText(codeVerifier),
        redirect_uri: redirectUri,
      }),
    });

    const payload = await parseJsonResponse<{
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
      token_type?: string;
    }>(response).catch(() => null);

    if (!response.ok || !normalizeText(payload?.access_token)) {
      throw new Error("MyAnimeList erişim anahtarı alınamadı");
    }

    return payload;
  }

  const clientId = normalizeText(Deno.env.get("ANILIST_CLIENT_ID"));
  const clientSecret = normalizeText(Deno.env.get("ANILIST_CLIENT_SECRET"));
  if (!clientId || !clientSecret) {
    throw new Error("ANILIST_CLIENT_ID veya ANILIST_CLIENT_SECRET tanımlı değil");
  }

  const response = await fetch(ANILIST_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      grant_type: "authorization_code",
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      code: normalizeText(code),
    }),
  });

  const payload = await parseJsonResponse<{
    access_token: string;
    expires_in?: number;
    token_type?: string;
  }>(response).catch(() => null);

  if (!response.ok || !normalizeText(payload?.access_token)) {
    throw new Error("AniList erişim anahtarı alınamadı");
  }

  return payload;
};

const refreshMyAnimeListAccessToken = async (account: ExternalProviderAccountRow) => {
  const clientId = normalizeText(Deno.env.get("MAL_CLIENT_ID"));
  const clientSecret = normalizeText(Deno.env.get("MAL_CLIENT_SECRET"));
  if (!clientId || !normalizeText(account.refresh_token)) {
    throw new Error("MyAnimeList hesabını yeniden bağlayın");
  }

  const response = await fetch(MAL_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: formEncode({
      grant_type: "refresh_token",
      client_id: clientId,
      ...(clientSecret ? { client_secret: clientSecret } : {}),
      refresh_token: normalizeText(account.refresh_token),
    }),
  });

  const payload = await parseJsonResponse<{
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
  }>(response).catch(() => null);

  if (!response.ok || !normalizeText(payload?.access_token)) {
    throw new Error("MyAnimeList erişim anahtarı yenilenemedi");
  }

  return payload;
};

export const setProviderAccountError = async (
  serviceClient: SupabaseClient,
  userId: string,
  provider: ExternalSyncProvider,
  message: string,
) => {
  await serviceClient
    .from("external_provider_accounts")
    .update({
      last_error: normalizeText(message) || null,
      last_error_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId)
    .eq("provider", provider);
};

export const clearProviderAccountError = async (
  serviceClient: SupabaseClient,
  userId: string,
  provider: ExternalSyncProvider,
) => {
  await serviceClient
    .from("external_provider_accounts")
    .update({
      last_error: null,
      last_error_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId)
    .eq("provider", provider);
};

export const getProviderViewer = async (
  provider: ExternalSyncProvider,
  accessToken: string,
) => {
  if (provider === "myanimelist") {
    return await fetchJson<{
      id?: number;
      name?: string;
    }>(`${MAL_API_BASE_URL}/users/@me?fields=id,name`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });
  }

  return await fetchJson<{
    data?: {
      Viewer?: {
        id?: number;
        name?: string;
      };
    };
  }>(ANILIST_GRAPHQL_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      query: "query { Viewer { id name } }",
    }),
  });
};

export const ensureProviderAccessToken = async (
  serviceClient: SupabaseClient,
  account: ExternalProviderAccountRow,
) => {
  if (
    account.provider === "myanimelist"
    && account.token_expires_at
    && (Date.parse(account.token_expires_at) - Date.now()) <= ACCOUNT_EXPIRY_SKEW_MS
  ) {
    const refreshed = await refreshMyAnimeListAccessToken(account);
    const nextExpiresAt = refreshed.expires_in
      ? new Date(Date.now() + (refreshed.expires_in * 1000)).toISOString()
      : null;

    const { data, error } = await serviceClient
      .from("external_provider_accounts")
      .update({
        access_token: refreshed.access_token,
        refresh_token: normalizeText(refreshed.refresh_token) || account.refresh_token || null,
        token_expires_at: nextExpiresAt,
        updated_at: new Date().toISOString(),
        last_error: null,
        last_error_at: null,
      })
      .eq("user_id", account.user_id)
      .eq("provider", account.provider)
      .select("*")
      .maybeSingle();

    if (error || !data) {
      throw error || new Error("Provider hesabı güncellenemedi");
    }

    return data as ExternalProviderAccountRow;
  }

  if (
    account.provider === "anilist"
    && account.token_expires_at
    && (Date.parse(account.token_expires_at) - Date.now()) <= ACCOUNT_EXPIRY_SKEW_MS
  ) {
    throw new Error("AniList erişim süresi dolmuş. Hesabı yeniden bağlayın.");
  }

  return account;
};

export const fetchMyAnimeListRatings = async (malId: string) => {
  const clientId = normalizeText(Deno.env.get("MAL_CLIENT_ID"));
  if (!clientId) {
    throw new Error("MAL_CLIENT_ID tanımlı değil");
  }

  const payload = await fetchJson<{
    id?: number;
    title?: string;
    mean?: number | null;
    rank?: number | null;
    popularity?: number | null;
    num_list_users?: number | null;
  }>(`${MAL_API_BASE_URL}/manga/${encodeURIComponent(malId)}?fields=mean,rank,popularity,num_list_users`, {
    headers: {
      "X-MAL-CLIENT-ID": clientId,
      Accept: "application/json",
    },
  });

  return {
    score: typeof payload.mean === "number" ? payload.mean : null,
    url: `https://myanimelist.net/manga/${malId}`,
    updatedAt: new Date().toISOString(),
    members: typeof payload.num_list_users === "number" ? payload.num_list_users : null,
    popularity: typeof payload.popularity === "number" ? payload.popularity : null,
    rank: typeof payload.rank === "number" ? payload.rank : null,
  } satisfies ExternalRatingCacheEntry;
};

export const fetchAniListRatings = async (anilistId: string) => {
  const payload = await fetchJson<{
    data?: {
      Media?: {
        averageScore?: number | null;
        meanScore?: number | null;
        popularity?: number | null;
        favourites?: number | null;
        rankings?: Array<{
          rank?: number | null;
          type?: string | null;
          allTime?: boolean | null;
        }> | null;
        siteUrl?: string | null;
      };
    };
  }>(ANILIST_GRAPHQL_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      query: `
        query MediaExternalRating($id: Int) {
          Media(id: $id, type: MANGA) {
            averageScore
            meanScore
            popularity
            favourites
            siteUrl
            rankings {
              rank
              type
              allTime
            }
          }
        }
      `,
      variables: {
        id: Number(anilistId),
      },
    }),
  });

  const media = payload.data?.Media;
  const bestRank = media?.rankings
    ?.filter((entry) => typeof entry?.rank === "number")
    ?.sort((left, right) => Number(left?.rank || 999999) - Number(right?.rank || 999999))[0];
  const rawScore = typeof media?.meanScore === "number"
    ? media.meanScore
    : media?.averageScore;

  return {
    score: typeof rawScore === "number" ? Number((rawScore / 10).toFixed(2)) : null,
    url: normalizeText(media?.siteUrl) || `https://anilist.co/manga/${anilistId}`,
    updatedAt: new Date().toISOString(),
    favorites: typeof media?.favourites === "number" ? media.favourites : null,
    popularity: typeof media?.popularity === "number" ? media.popularity : null,
    rank: typeof bestRank?.rank === "number" ? bestRank.rank : null,
  } satisfies ExternalRatingCacheEntry;
};

export const saveMyAnimeListMangaListStatus = async (
  accessToken: string,
  mediaId: string,
  payload: Record<string, string>,
) => {
  const response = await fetch(`${MAL_API_BASE_URL}/manga/${encodeURIComponent(mediaId)}/my_list_status`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: formEncode(payload),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(text || "MyAnimeList liste senkronu başarısız oldu");
  }

  return response;
};

export const runAniListGraphQL = async <T>(
  accessToken: string,
  query: string,
  variables?: Record<string, unknown>,
) => {
  return await fetchJson<T & { errors?: Array<{ message?: string }> }>(ANILIST_GRAPHQL_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      query,
      variables: variables || {},
    }),
  });
};

export const toDateOnly = (value?: string | null) => {
  const normalized = normalizeText(value);
  if (!normalized) {
    return null;
  }

  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString().slice(0, 10);
};

export const toAniListFuzzyDate = (value?: string | null) => {
  const normalized = toDateOnly(value);
  if (!normalized) {
    return null;
  }

  const [year, month, day] = normalized.split("-").map((part) => Number(part));
  if (!year || !month || !day) {
    return null;
  }

  return { year, month, day };
};
