import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { createServiceClient, json } from "../_shared/auth.ts";
import {
  fetchAniListRatings,
  fetchMyAnimeListRatings,
  getProviderLink,
  getProviderMediaId,
  isExternalRatingEntryStale,
} from "../_shared/external-sync.ts";

const normalizeText = (value?: string | null) => value?.trim().replace(/\s+/g, " ") || "";

const parseJsonBody = async (req: Request) => {
  try {
    return await req.json();
  } catch {
    return {};
  }
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ success: false, message: "Unsupported method" }, 405);
  }

  const body = await parseJsonBody(req);
  const mangaId = normalizeText(body?.mangaId);

  if (!mangaId) {
    return json({ success: false, message: "mangaId zorunlu" }, 400);
  }

  const serviceClient = createServiceClient();
  const { data: mangaRow, error } = await serviceClient
    .from("mangas")
    .select("id, details, source_links")
    .eq("id", mangaId)
    .maybeSingle();

  if (error || !mangaRow?.id) {
    return json({ success: false, message: "Seri bulunamadı" }, 404);
  }

  const details = mangaRow.details && typeof mangaRow.details === "object" && !Array.isArray(mangaRow.details)
    ? { ...mangaRow.details }
    : {};
  const extra = details.extra && typeof details.extra === "object" && !Array.isArray(details.extra)
    ? { ...details.extra }
    : {};
  const currentRatings = extra.externalRatings && typeof extra.externalRatings === "object" && !Array.isArray(extra.externalRatings)
    ? { ...extra.externalRatings }
    : {};

  const malLink = getProviderLink(mangaRow.source_links, "myanimelist");
  const aniListLink = getProviderLink(mangaRow.source_links, "anilist");
  const nextRatings = { ...currentRatings } as Record<string, unknown>;

  try {
    const malId = getProviderMediaId(malLink);
    if (malId && isExternalRatingEntryStale(currentRatings?.myanimelist || null)) {
      nextRatings.myanimelist = await fetchMyAnimeListRatings(malId);
    }
  } catch (providerError) {
    console.error("MAL ratings refresh failed:", providerError);
  }

  try {
    const aniListId = getProviderMediaId(aniListLink);
    if (aniListId && isExternalRatingEntryStale(currentRatings?.anilist || null)) {
      nextRatings.anilist = await fetchAniListRatings(aniListId);
    }
  } catch (providerError) {
    console.error("AniList ratings refresh failed:", providerError);
  }

  extra.externalRatings = nextRatings;
  details.extra = extra;

  const { error: updateError } = await serviceClient
    .from("mangas")
    .update({
      details,
    })
    .eq("id", mangaId);

  if (updateError) {
    return json({ success: false, message: "Puan önbelleği güncellenemedi" }, 500);
  }

  return json({
    success: true,
    ratings: nextRatings,
    details,
  });
});
