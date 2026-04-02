import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders } from "./cors.ts";

export type AppRole = "user" | "moderator" | "admin";

export type RequesterProfile = {
  id: string;
  username: string;
  email: string;
  role: AppRole;
  is_banned: boolean;
  ban_reason: string | null;
  banned_at: string | null;
  active_ban_type: "timed" | "permanent" | "hard" | null;
  ban_expires_at: string | null;
  warning_count: number;
  unread_warning_count: number;
};

export const PRIMARY_ADMIN_EMAIL = "caganherdil@gmail.com";

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });

export const createServiceClient = () => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Missing Supabase environment variables");
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
};

export const createRequesterAuthClient = (req?: Request) => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const authKey = Deno.env.get("SB_PUBLISHABLE_KEY")
    || Deno.env.get("SUPABASE_ANON_KEY")
    || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !authKey) {
    throw new Error("Missing Supabase auth environment variables");
  }

  const authorizationHeader = req?.headers.get("Authorization") || "";

  return createClient(supabaseUrl, authKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    global: authorizationHeader
      ? {
        headers: {
          Authorization: authorizationHeader,
        },
      }
      : undefined,
  });
};

export const getAccessToken = (req: Request) => {
  const authHeader = req.headers.get("Authorization");
  return authHeader?.replace(/^Bearer\s+/i, "") || null;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const shouldRetryAuthResolution = (message?: string | null) => {
  const normalizedMessage = message?.toLowerCase() || "";
  if (normalizedMessage.includes("expired")) {
    return false;
  }

  return normalizedMessage.includes("future")
    || normalizedMessage.includes("not yet valid")
    || normalizedMessage.includes("jwt")
    || normalizedMessage.includes("token")
    || normalizedMessage.includes("iat")
    || normalizedMessage.includes("unauthorized")
    || normalizedMessage.includes("invalid claim");
};

const resolveRequesterUser = async (
  authClient: ReturnType<typeof createRequesterAuthClient>,
  accessToken: string,
) => {
  const retryDelays = [0, 900, 2100, 3600];

  for (const [attemptIndex, retryDelay] of retryDelays.entries()) {
    if (retryDelay > 0) {
      await sleep(retryDelay);
    }

    try {
      const {
        data: { user },
        error: authError,
      } = await authClient.auth.getUser(accessToken);

      if (!authError && user) {
        return {
          user,
          error: null,
        };
      }

      const canRetry = attemptIndex < retryDelays.length - 1 && (
        attemptIndex === 0
        || shouldRetryAuthResolution(authError?.message)
        || !authError
        || !user
      );

      if (canRetry) {
        console.warn("resolveRequesterUser auth retry:", {
          attempt: attemptIndex + 1,
          message: authError?.message || null,
        });
        continue;
      }

      return {
        user: null,
        error: authError,
      };
    } catch (error) {
      if (attemptIndex < retryDelays.length - 1) {
        console.warn("resolveRequesterUser auth retry after exception:", {
          attempt: attemptIndex + 1,
          error: error instanceof Error ? error.message : String(error),
        });
        continue;
      }

      return {
        user: null,
        error,
      };
    }
  }

  return {
    user: null,
    error: null,
  };
};

export const getRequesterProfile = async (
  serviceClient: ReturnType<typeof createServiceClient>,
  userId: string,
) => {
  const { data, error } = await serviceClient
    .from("users")
    .select(
      "id, username, email, role, is_banned, ban_reason, banned_at, active_ban_type, ban_expires_at, warning_count, unread_warning_count",
    )
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data as RequesterProfile | null;
};

const hasActiveRequesterBan = (profile: Pick<RequesterProfile, "is_banned" | "active_ban_type" | "ban_expires_at">) => {
  if (!profile.is_banned && !profile.active_ban_type) {
    return false;
  }

  if (!profile.ban_expires_at) {
    return true;
  }

  const expiresAt = Date.parse(profile.ban_expires_at);
  if (!Number.isFinite(expiresAt)) {
    return true;
  }

  return expiresAt > Date.now();
};

export const requireRequester = async (
  req: Request,
  allowedRoles?: AppRole[],
) => {
  const serviceClient = createServiceClient();
  const authClient = createRequesterAuthClient(req);
  const accessToken = getAccessToken(req);

  if (!accessToken) {
    return {
      ok: false as const,
      response: json({ success: false, message: "Unauthorized" }, 401),
    };
  }

  const { user, error: authError } = await resolveRequesterUser(authClient, accessToken);

  if (authError || !user) {
    return {
      ok: false as const,
      response: json({ success: false, message: "Unauthorized" }, 401),
    };
  }

  const requesterProfile = await getRequesterProfile(serviceClient, user.id);
  if (!requesterProfile) {
    return {
      ok: false as const,
      response: json({ success: false, message: "Profile not found" }, 404),
    };
  }

  if (allowedRoles && !allowedRoles.includes(requesterProfile.role)) {
    return {
      ok: false as const,
      response: json({ success: false, message: "Not authorized" }, 403),
    };
  }

  const requiresPrivilegedRole = Boolean(
    allowedRoles?.some((role) => role === "admin" || role === "moderator"),
  );

  if (requiresPrivilegedRole && hasActiveRequesterBan(requesterProfile)) {
    return {
      ok: false as const,
      response: json({ success: false, message: "Banned staff cannot access admin actions" }, 403),
    };
  }

  return {
    ok: true as const,
    serviceClient,
    accessToken,
    requesterUser: user,
    requesterProfile,
  };
};

export const isPrimaryAdmin = (profile: Pick<RequesterProfile, "role" | "email">) =>
  profile.role === "admin" && profile.email.toLowerCase() === PRIMARY_ADMIN_EMAIL;
