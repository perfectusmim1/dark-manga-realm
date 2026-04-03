import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { getJwtClaims, parseUserAgent, sha256Hex, upsertUserSessionMetadata } from "../_shared/session-tracking.ts";

type StoredSessionMetadata = {
  id: string;
  user_id: string;
  session_token_hash: string | null;
  browser: string | null;
  os: string | null;
  device_type: string | null;
  country: string | null;
  city: string | null;
  region: string | null;
  last_active_at: string;
  created_at: string;
};

type AuthSessionRecord = {
  session_id: string;
  user_agent: string | null;
  created_at: string;
  last_active_at: string;
};

type ParsedAuthSession = {
  sessionId: string;
  sessionHash: string | null;
  browser: string;
  os: string;
  deviceType: string;
  country: string | null;
  city: string | null;
  region: string | null;
  metadataId: string | null;
  createdAt: string;
  lastActiveAt: string;
  isCurrent: boolean;
};

type VisibleSessionGroup = {
  id: string;
  browser: string;
  os: string;
  deviceType: string;
  country: string | null;
  city: string | null;
  region: string | null;
  createdAt: string;
  lastActiveAt: string;
  isCurrent: boolean;
  authSessionIds: string[];
  metadataIds: string[];
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });

const normalizeGroupPart = (value: string | null | undefined) =>
  value?.trim().toLowerCase() || "";

const getBrowserSessionKey = (session: {
  browser?: string | null;
  os?: string | null;
  deviceType?: string | null;
  device_type?: string | null;
}) =>
  [
    normalizeGroupPart(session.browser),
    normalizeGroupPart(session.os),
    normalizeGroupPart(session.deviceType ?? session.device_type),
  ].join("|");

const getVisibleGroupKey = (session: {
  browser?: string | null;
  os?: string | null;
  deviceType?: string | null;
  device_type?: string | null;
  country?: string | null;
  region?: string | null;
  city?: string | null;
}) =>
  [
    getBrowserSessionKey(session),
    normalizeGroupPart(session.country),
    normalizeGroupPart(session.region),
    normalizeGroupPart(session.city),
  ].join("|");

const toTimestamp = (value: string) => {
  const timestamp = new Date(value).getTime();
  return Number.isNaN(timestamp) ? 0 : timestamp;
};

const compareByActivity = (
  a: { lastActiveAt: string; createdAt: string; isCurrent?: boolean },
  b: { lastActiveAt: string; createdAt: string; isCurrent?: boolean },
) => {
  if (a.isCurrent !== b.isCurrent) {
    return a.isCurrent ? -1 : 1;
  }

  const lastActiveDiff = toTimestamp(b.lastActiveAt) - toTimestamp(a.lastActiveAt);
  if (lastActiveDiff !== 0) {
    return lastActiveDiff;
  }

  return toTimestamp(b.createdAt) - toTimestamp(a.createdAt);
};

const loadStoredSessionMetadata = async (
  serviceClient: ReturnType<typeof createClient>,
  userId: string,
) => {
  const { data, error } = await serviceClient
    .from("user_sessions")
    .select("id, user_id, session_token_hash, browser, os, device_type, country, city, region, last_active_at, created_at")
    .eq("user_id", userId)
    .order("last_active_at", { ascending: false });

  if (error) {
    throw error;
  }

  return (data || []) as StoredSessionMetadata[];
};

const deleteStoredSessions = async (
  serviceClient: ReturnType<typeof createClient>,
  userId: string,
  ids: string[],
) => {
  if (ids.length === 0) {
    return;
  }

  const { error } = await serviceClient
    .from("user_sessions")
    .delete()
    .eq("user_id", userId)
    .in("id", ids);

  if (error) {
    throw error;
  }
};

const dedupeStoredSessionMetadata = async (
  serviceClient: ReturnType<typeof createClient>,
  userId: string,
) => {
  const storedSessions = await loadStoredSessionMetadata(serviceClient, userId);
  const groupedSessions = new Map<string, StoredSessionMetadata[]>();

  for (const session of storedSessions) {
    const groupKey = getVisibleGroupKey(session);
    const existingGroup = groupedSessions.get(groupKey);

    if (existingGroup) {
      existingGroup.push(session);
      continue;
    }

    groupedSessions.set(groupKey, [session]);
  }

  const duplicateIds: string[] = [];
  const dedupedSessions: StoredSessionMetadata[] = [];

  for (const sessions of groupedSessions.values()) {
    const sortedSessions = [...sessions].sort((a, b) =>
      compareByActivity(
        { lastActiveAt: a.last_active_at, createdAt: a.created_at },
        { lastActiveAt: b.last_active_at, createdAt: b.created_at },
      )
    );
    const [primary, ...duplicates] = sortedSessions;
    dedupedSessions.push(primary);
    duplicateIds.push(...duplicates.map((session) => session.id));
  }

  if (duplicateIds.length > 0) {
    await deleteStoredSessions(serviceClient, userId, duplicateIds);
  }

  return dedupedSessions;
};

const loadAuthSessions = async (
  serviceClient: ReturnType<typeof createClient>,
  userId: string,
) => {
  const { data, error } = await serviceClient.rpc("list_user_auth_sessions", {
    p_user_id: userId,
  });

  if (error) {
    throw error;
  }

  return (data || []) as AuthSessionRecord[];
};

const revokeAuthSessions = async (
  serviceClient: ReturnType<typeof createClient>,
  userId: string,
  sessionIds: string[],
) => {
  if (sessionIds.length === 0) {
    return 0;
  }

  const { data, error } = await serviceClient.rpc("revoke_user_auth_sessions", {
    p_user_id: userId,
    p_session_ids: sessionIds,
  });

  if (error) {
    throw error;
  }

  return Number(data || 0);
};

const isCurrentAuthSessionActive = async (
  serviceClient: ReturnType<typeof createClient>,
  userId: string,
  sessionId: string,
) => {
  const { data, error } = await serviceClient.rpc("is_user_auth_session_active", {
    p_user_id: userId,
    p_session_id: sessionId,
  });

  if (error) {
    throw error;
  }

  return Boolean(data);
};

const findBestMetadataMatch = (
  session: ParsedAuthSession,
  metadataSessions: StoredSessionMetadata[],
) => {
  if (session.sessionHash) {
    const exactMatches = metadataSessions.filter((metadataSession) =>
      metadataSession.session_token_hash === session.sessionHash
    );

    if (exactMatches.length > 0) {
      return [...exactMatches].sort((a, b) =>
        compareByActivity(
          { lastActiveAt: a.last_active_at, createdAt: a.created_at },
          { lastActiveAt: b.last_active_at, createdAt: b.created_at },
        )
      )[0];
    }
  }

  const sessionBrowserKey = getBrowserSessionKey(session);
  const candidates = metadataSessions.filter((metadataSession) =>
    getBrowserSessionKey(metadataSession) === sessionBrowserKey
  );

  if (candidates.length === 0) {
    return null;
  }

  const targetTimestamp = toTimestamp(session.lastActiveAt);

  return [...candidates].sort((a, b) => {
    const timeDiff =
      Math.abs(toTimestamp(a.last_active_at) - targetTimestamp)
      - Math.abs(toTimestamp(b.last_active_at) - targetTimestamp);
    if (timeDiff !== 0) {
      return timeDiff;
    }

    return compareByActivity(
      { lastActiveAt: a.last_active_at, createdAt: a.created_at },
      { lastActiveAt: b.last_active_at, createdAt: b.created_at },
    );
  })[0];
};

const buildSessionContext = async (
  serviceClient: ReturnType<typeof createClient>,
  userId: string,
  currentSessionId: string | null,
) => {
  const [metadataSessions, authSessions] = await Promise.all([
    dedupeStoredSessionMetadata(serviceClient, userId),
    loadAuthSessions(serviceClient, userId),
  ]);

  const parsedAuthSessions = await Promise.all(authSessions.map(async (session) => {
    const parsed = parseUserAgent(session.user_agent);
    const sessionHash = await sha256Hex(session.session_id);
    const parsedSession: ParsedAuthSession = {
      sessionId: session.session_id,
      sessionHash,
      browser: parsed.browser,
      os: parsed.os,
      deviceType: parsed.deviceType,
      country: null,
      city: null,
      region: null,
      metadataId: null,
      createdAt: session.created_at,
      lastActiveAt: session.last_active_at,
      isCurrent: session.session_id === currentSessionId,
    };

    const metadataMatch = findBestMetadataMatch(parsedSession, metadataSessions);
    if (metadataMatch) {
      parsedSession.country = metadataMatch.country;
      parsedSession.city = metadataMatch.city;
      parsedSession.region = metadataMatch.region;
      parsedSession.metadataId = metadataMatch.id;
    }

    return parsedSession;
  }));

  const groupedSessions = new Map<string, ParsedAuthSession[]>();

  for (const session of parsedAuthSessions) {
    const groupKey = getVisibleGroupKey(session);
    const existingGroup = groupedSessions.get(groupKey);

    if (existingGroup) {
      existingGroup.push(session);
      continue;
    }

    groupedSessions.set(groupKey, [session]);
  }

  const visibleSessions = Array.from(groupedSessions.values()).map((sessions) => {
    const sortedSessions = [...sessions].sort(compareByActivity);
    const [primary] = sortedSessions;
    const groupKey = getVisibleGroupKey(primary);
    const metadataIds = metadataSessions
      .filter((session) => getVisibleGroupKey(session) === groupKey)
      .map((session) => session.id);

    return {
      id: primary.sessionId,
      browser: primary.browser,
      os: primary.os,
      deviceType: primary.deviceType,
      country: primary.country,
      city: primary.city,
      region: primary.region,
      createdAt: primary.createdAt,
      lastActiveAt: primary.lastActiveAt,
      isCurrent: sortedSessions.some((session) => session.isCurrent),
      authSessionIds: sortedSessions.map((session) => session.sessionId),
      metadataIds: Array.from(new Set([
        ...sortedSessions
          .map((session) => session.metadataId)
          .filter((value): value is string => Boolean(value)),
        ...metadataIds,
      ])),
    } satisfies VisibleSessionGroup;
  }).sort(compareByActivity);

  return {
    authSessions: parsedAuthSessions,
    visibleSessions,
  };
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ success: false, message: "Unsupported method" }, 405);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !serviceRoleKey) {
      return json({ success: false, message: "Server configuration error" }, 500);
    }

    const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    const authHeader = req.headers.get("Authorization");
    const accessToken = authHeader?.replace(/^Bearer\s+/i, "");

    if (!accessToken) {
      return json({ success: false, message: "Unauthorized" }, 401);
    }

    const {
      data: { user },
      error: authError,
    } = await serviceClient.auth.getUser(accessToken);

    if (authError || !user) {
      return json({ success: false, message: "Unauthorized" }, 401);
    }

    const jwtClaims = getJwtClaims(accessToken);

    let payload: { action?: string; sessionId?: string } = {};
    try {
      payload = await req.json();
    } catch {
      payload = {};
    }

    const userId = user.id;
    const currentSessionId = jwtClaims?.sessionId ?? null;
    const action = payload.action || "list";

    if (currentSessionId) {
      await upsertUserSessionMetadata(serviceClient, {
        userId,
        sessionId: currentSessionId,
        userAgent: req.headers.get("user-agent"),
        request: req,
      }).catch((error) => {
        console.error("user-sessions session metadata upsert failed:", error);
      });
    }

    if (action === "validate-current") {
      if (!currentSessionId) {
        return json({ success: true, isActive: false });
      }

      const isActive = await isCurrentAuthSessionActive(serviceClient, userId, currentSessionId);
      return json({ success: true, isActive });
    }

    const sessionContext = await buildSessionContext(serviceClient, userId, currentSessionId);

    if (action === "list") {
      return json({
        success: true,
        sessions: sessionContext.visibleSessions.map((session) => ({
          id: session.id,
          browser: session.browser,
          os: session.os,
          deviceType: session.deviceType,
          country: session.country,
          city: session.city,
          region: session.region,
          lastActiveAt: session.lastActiveAt,
          createdAt: session.createdAt,
          isCurrent: session.isCurrent,
        })),
      });
    }

    if (action === "revoke") {
      const sessionId = payload.sessionId?.trim();
      if (!sessionId) {
        return json({ success: false, message: "sessionId is required" }, 400);
      }

      const targetSession = sessionContext.visibleSessions.find((session) =>
        session.id === sessionId || session.authSessionIds.includes(sessionId)
      );

      if (!targetSession) {
        return json({ success: false, message: "Session not found" }, 404);
      }

      if (targetSession.isCurrent) {
        return json({ success: false, message: "Cannot revoke current session" }, 400);
      }

      await Promise.all([
        revokeAuthSessions(serviceClient, userId, targetSession.authSessionIds),
        deleteStoredSessions(serviceClient, userId, targetSession.metadataIds),
      ]);

      return json({ success: true, message: "Session revoked" });
    }

    if (action === "revoke-all-others") {
      const otherSessionIds = sessionContext.authSessions
        .filter((session) => !session.isCurrent)
        .map((session) => session.sessionId);

      const otherMetadataIds = sessionContext.visibleSessions
        .filter((session) => !session.isCurrent)
        .flatMap((session) => session.metadataIds);

      await Promise.all([
        revokeAuthSessions(serviceClient, userId, otherSessionIds),
        deleteStoredSessions(serviceClient, userId, otherMetadataIds),
      ]);

      return json({ success: true, message: "All other sessions revoked" });
    }

    return json({ success: false, message: "Unknown action" }, 400);
  } catch (error) {
    console.error("Unexpected error:", error);
    return json({ success: false, message: "An unexpected error occurred" }, 500);
  }
});
