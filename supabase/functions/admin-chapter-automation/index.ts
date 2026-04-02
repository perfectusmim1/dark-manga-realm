import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { json, requireRequester } from "../_shared/auth.ts";
import { corsHeaders } from "../_shared/cors.ts";
import {
  computeNextRunAt,
  normalizeCheckTimes,
  validateAutomationSource,
} from "../_shared/chapter-automation.ts";

const normalizeText = (value?: string | null) => value?.trim() || "";

const normalizeValidationSnapshot = (value: unknown) => (
  value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {}
);

const mapRun = (row: any) => ({
  id: row.id,
  automationId: row.automation_id,
  status: row.status,
  startedAt: row.started_at,
  finishedAt: row.finished_at,
  chaptersAdded: Number(row.chapters_added || 0),
  sourceChapterCount: Number(row.source_chapter_count || 0),
  newChapterCount: Number(row.new_chapter_count || 0),
  errorMessage: row.error_message || null,
  details: row.details || {},
});

const mapAutomation = (row: any, mangaMap: Map<string, any>, latestRunMap: Map<string, ReturnType<typeof mapRun>>) => {
  const manga = mangaMap.get(row.manga_id);
  const latestRun = latestRunMap.get(row.id) || null;

  return {
    id: row.id,
    automationType: row.automation_type,
    mangaId: row.manga_id,
    mangaTitle: manga?.title || "Silinmiş Seri",
    mangaCover: manga?.cover || null,
    source: row.source,
    sourceUrl: row.source_url,
    proxyProvider: row.proxy_provider,
    checkTimes: Array.isArray(row.check_times) ? row.check_times : [],
    scheduleTimezone: row.schedule_timezone,
    isActive: Boolean(row.is_active),
    validation: normalizeValidationSnapshot(row.validation_snapshot),
    nextRunAt: row.next_run_at,
    lastRunStatus: row.last_run_status,
    lastRunStartedAt: row.last_run_started_at,
    lastRunFinishedAt: row.last_run_finished_at,
    lastRunError: row.last_run_error,
    lastAddedChapterCount: Number(row.last_added_chapter_count || 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by || null,
    updatedBy: row.updated_by || null,
    latestRun,
  };
};

const loadAutomationRows = async (
  serviceClient: any,
  options?: { automationIds?: string[]; recentRunsLimit?: number },
) => {
  let query = serviceClient
    .from("chapter_automations")
    .select("*")
    .order("created_at", { ascending: false });

  if (options?.automationIds && options.automationIds.length > 0) {
    query = query.in("id", options.automationIds);
  }

  const { data: automationRows, error: automationError } = await query;
  if (automationError) {
    throw automationError;
  }

  const automationList = automationRows || [];
  const mangaIds = Array.from(new Set(automationList.map((row) => row.manga_id).filter(Boolean)));
  const automationIds = automationList.map((row) => row.id);

  const mangaMap = new Map<string, any>();
  if (mangaIds.length > 0) {
    const { data: mangaRows, error: mangaError } = await serviceClient
      .from("mangas")
      .select("id, title, cover")
      .in("id", mangaIds);

    if (mangaError) {
      throw mangaError;
    }

    for (const manga of mangaRows || []) {
      mangaMap.set(manga.id, manga);
    }
  }

  const latestRunMap = new Map<string, ReturnType<typeof mapRun>>();
  let recentRuns: ReturnType<typeof mapRun>[] = [];

  if (automationIds.length > 0) {
    const { data: runRows, error: runError } = await serviceClient
      .from("chapter_automation_runs")
      .select("*")
      .in("automation_id", automationIds)
      .order("started_at", { ascending: false })
      .limit(Math.max(options?.recentRunsLimit ?? 25, 25));

    if (runError) {
      throw runError;
    }

    recentRuns = (runRows || []).map(mapRun);
    for (const run of recentRuns) {
      if (!latestRunMap.has(run.automationId)) {
        latestRunMap.set(run.automationId, run);
      }
    }
  }

  return {
    automations: automationList.map((row) => mapAutomation(row, mangaMap, latestRunMap)),
    recentRuns,
  };
};

const parseAutomationPayload = (payload: any) => ({
  mangaId: normalizeText(payload?.mangaId),
  source: normalizeText(payload?.source),
  sourceUrl: normalizeText(payload?.sourceUrl),
  isActive: payload?.isActive !== false,
  checkTimes: normalizeCheckTimes(Array.isArray(payload?.checkTimes) ? payload.checkTimes : []),
});

const isUniqueViolation = (error: unknown) => (
  typeof error === "object"
    && error !== null
    && "code" in error
    && `${(error as { code?: string }).code || ""}` === "23505"
);

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ success: false, message: "Unsupported method" }, 405);
  }

  try {
    const auth = await requireRequester(req, ["admin"]);
    if (!auth.ok) {
      return auth.response;
    }

    const body = await req.json().catch(() => null);
    const action = normalizeText(body?.action);

    if (action === "list") {
      const payload = await loadAutomationRows(auth.serviceClient, { recentRunsLimit: 25 });
      return json({ success: true, automations: payload.automations, recentRuns: payload.recentRuns });
    }

    if (action === "validate") {
      const validation = await validateAutomationSource(
        auth.serviceClient,
        normalizeText(body?.source),
        normalizeText(body?.sourceUrl),
      );

      return json({ success: true, validation });
    }

    if (action === "create" || action === "update") {
      let payload;
      try {
        payload = parseAutomationPayload(body?.payload);
      } catch (error) {
        return json({
          success: false,
          message: error instanceof Error ? error.message : "Geçersiz otomasyon ayarları",
        }, 400);
      }
      if (!payload.mangaId) {
        return json({ success: false, message: "Manga seçimi zorunludur" }, 400);
      }

      const { data: manga, error: mangaError } = await auth.serviceClient
        .from("mangas")
        .select("id")
        .eq("id", payload.mangaId)
        .maybeSingle();

      if (mangaError) {
        throw mangaError;
      }

      if (!manga) {
        return json({ success: false, message: "Local manga kaydı bulunamadı" }, 404);
      }

      const validation = await validateAutomationSource(auth.serviceClient, payload.source, payload.sourceUrl);
      const values = {
        manga_id: payload.mangaId,
        source: payload.source,
        source_url: validation.normalizedUrl,
        proxy_provider: "cloudflare",
        check_times: payload.checkTimes,
        schedule_timezone: "Europe/Istanbul",
        is_active: payload.isActive,
        validation_snapshot: validation,
        next_run_at: payload.isActive ? computeNextRunAt(payload.checkTimes) : null,
        locked_at: null,
        locked_by: null,
        updated_by: auth.requesterProfile.id,
      };

      try {
        if (action === "create") {
          const { error } = await auth.serviceClient
            .from("chapter_automations")
            .insert({
              ...values,
              created_by: auth.requesterProfile.id,
            });

          if (error) {
            throw error;
          }
        } else {
          const automationId = normalizeText(body?.automationId);
          if (!automationId) {
            return json({ success: false, message: "automationId zorunludur" }, 400);
          }

          const { error } = await auth.serviceClient
            .from("chapter_automations")
            .update(values)
            .eq("id", automationId);

          if (error) {
            throw error;
          }
        }
      } catch (error) {
        if (isUniqueViolation(error)) {
          return json({ success: false, message: "Bu manga ve kaynak linki için zaten aktif bir otomasyon var" }, 409);
        }
        throw error;
      }

      const automationId = action === "create"
        ? null
        : normalizeText(body?.automationId);

      const payloadResult = await loadAutomationRows(auth.serviceClient, {
        automationIds: automationId ? [automationId] : undefined,
        recentRunsLimit: 5,
      });

      const createdAutomation = action === "create"
        ? payloadResult.automations.find((item) => item.mangaId === payload.mangaId && item.sourceUrl === validation.normalizedUrl)
        : payloadResult.automations[0];

      return json({ success: true, automation: createdAutomation || null });
    }

    if (action === "delete") {
      const automationId = normalizeText(body?.automationId);
      if (!automationId) {
        return json({ success: false, message: "automationId zorunludur" }, 400);
      }

      const { error } = await auth.serviceClient
        .from("chapter_automations")
        .delete()
        .eq("id", automationId);

      if (error) {
        throw error;
      }

      return json({ success: true });
    }

    if (action === "set-active") {
      const automationId = normalizeText(body?.automationId);
      if (!automationId) {
        return json({ success: false, message: "automationId zorunludur" }, 400);
      }

      const { data: automation, error: automationError } = await auth.serviceClient
        .from("chapter_automations")
        .select("*")
        .eq("id", automationId)
        .maybeSingle();

      if (automationError) {
        throw automationError;
      }

      if (!automation) {
        return json({ success: false, message: "Otomasyon bulunamadı" }, 404);
      }

      const nextActive = body?.isActive === true;
      try {
        const { error } = await auth.serviceClient
          .from("chapter_automations")
          .update({
            is_active: nextActive,
            next_run_at: nextActive ? computeNextRunAt(automation.check_times || []) : null,
            locked_at: null,
            locked_by: null,
            updated_by: auth.requesterProfile.id,
          })
          .eq("id", automationId);

        if (error) {
          throw error;
        }
      } catch (error) {
        if (isUniqueViolation(error)) {
          return json({ success: false, message: "Bu manga ve kaynak linki için zaten aktif bir otomasyon var" }, 409);
        }
        throw error;
      }

      const payload = await loadAutomationRows(auth.serviceClient, {
        automationIds: [automationId],
        recentRunsLimit: 5,
      });

      return json({ success: true, automation: payload.automations[0] || null });
    }

    return json({ success: false, message: "Desteklenmeyen işlem" }, 400);
  } catch (error) {
    console.error("Unexpected error in admin-chapter-automation:", error);
    return json({
      success: false,
      message: error instanceof Error ? error.message : "Beklenmeyen bir hata oluştu",
    }, 500);
  }
});
