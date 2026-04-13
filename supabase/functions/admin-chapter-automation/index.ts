import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { json, requireRequester, type createServiceClient } from "../_shared/auth.ts";
import { corsHeaders } from "../_shared/cors.ts";
import {
  computeNextRunAt,
  fetchAutomationSeries,
  fetchChapterImagesForAutomation,
  normalizeCheckTimes,
  validateAutomationSource,
} from "../_shared/chapter-automation.ts";

type AutomationTestStatus = "success" | "error";
type ServiceClient = ReturnType<typeof createServiceClient>;

interface AutomationRunRow {
  id: string;
  automation_id: string;
  status: string;
  started_at: string;
  finished_at?: string | null;
  chapters_added?: number | null;
  source_chapter_count?: number | null;
  new_chapter_count?: number | null;
  error_message?: string | null;
  details?: Record<string, unknown> | null;
}

interface AutomationMangaRow {
  id: string;
  title: string;
  cover?: string | null;
  alternative_titles?: string[] | null;
  is_adult?: boolean | null;
}

interface AutomationRow {
  id: string;
  automation_type: string;
  manga_id: string;
  source: string;
  source_url: string;
  proxy_provider: string;
  check_times?: string[] | null;
  schedule_timezone: string;
  is_active: boolean;
  validation_snapshot?: unknown;
  next_run_at?: string | null;
  last_run_status: string;
  last_run_started_at?: string | null;
  last_run_finished_at?: string | null;
  last_run_error?: string | null;
  last_added_chapter_count?: number | null;
  last_test_status?: string | null;
  last_tested_at?: string | null;
  last_test_error?: string | null;
  last_test_details?: unknown;
  created_at: string;
  updated_at: string;
  created_by?: string | null;
  updated_by?: string | null;
}

const normalizeText = (value?: string | null) => value?.trim() || "";
const normalizePayloadText = (value: unknown) => normalizeText(value == null ? "" : `${value}`);

const TEST_CONCURRENCY_LIMIT = 3;

const normalizeValidationSnapshot = (value: unknown) => (
  value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {}
);

const mapRun = (
  row: AutomationRunRow,
  context?: { automation?: AutomationRow | null; manga?: AutomationMangaRow | null },
) => ({
  id: row.id,
  automationId: row.automation_id,
  mangaId: context?.automation?.manga_id || "",
  mangaTitle: context?.manga?.title || "Silinmiş Seri",
  mangaCover: context?.manga?.cover || null,
  source: (context?.automation?.source as ChapterAutomationSource | undefined) || undefined,
  status: row.status,
  startedAt: row.started_at,
  finishedAt: row.finished_at,
  chaptersAdded: Number(row.chapters_added || 0),
  sourceChapterCount: Number(row.source_chapter_count || 0),
  newChapterCount: Number(row.new_chapter_count || 0),
  errorMessage: row.error_message || null,
  details: row.details || {},
});

const mapAutomation = (
  row: AutomationRow,
  mangaMap: Map<string, AutomationMangaRow>,
  latestRunMap: Map<string, ReturnType<typeof mapRun>>,
) => {
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
    lastTestStatus: row.last_test_status || "idle",
    lastTestedAt: row.last_tested_at || null,
    lastTestError: row.last_test_error || null,
    lastTestDetails: normalizeValidationSnapshot(row.last_test_details),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by || null,
    updatedBy: row.updated_by || null,
    latestRun,
  };
};

const loadAutomationRows = async (
  serviceClient: ServiceClient,
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

  const automationList = (automationRows || []) as AutomationRow[];
  const mangaIds = Array.from(new Set(automationList.map((row) => row.manga_id).filter(Boolean)));
  const automationIds = automationList.map((row) => row.id);
  const automationMap = new Map<string, AutomationRow>(automationList.map((row) => [row.id, row]));

  const mangaMap = new Map<string, AutomationMangaRow>();
  if (mangaIds.length > 0) {
    const { data: mangaRows, error: mangaError } = await serviceClient
      .from("mangas")
      .select("id, title, cover, is_adult")
      .in("id", mangaIds);

    if (mangaError) {
      throw mangaError;
    }

    for (const manga of (mangaRows || []) as AutomationMangaRow[]) {
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

    recentRuns = ((runRows || []) as AutomationRunRow[]).map((runRow) => {
      const automation = automationMap.get(runRow.automation_id);
      const manga = automation ? mangaMap.get(automation.manga_id) : null;

      return mapRun(runRow, { automation, manga });
    });
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

const parseAutomationPayload = (payload: Record<string, unknown> | null | undefined) => ({
  mangaId: normalizePayloadText(payload?.mangaId),
  source: normalizePayloadText(payload?.source),
  sourceUrl: normalizePayloadText(payload?.sourceUrl),
  isActive: payload?.isActive !== false,
  checkTimes: normalizeCheckTimes(
    Array.isArray(payload?.checkTimes)
      ? payload.checkTimes.map((time) => normalizePayloadText(time))
      : [],
  ),
});

const normalizeAutomationIds = (value: unknown) => (
  Array.isArray(value)
    ? Array.from(new Set(value.map((item) => normalizeText(`${item ?? ""}`)).filter(Boolean)))
    : []
);

const normalizeComparableTitle = (value?: string | null) => (
  normalizeText(value)
    .toLocaleLowerCase("tr-TR")
    .replace(/ı/g, "i")
    .replace(/ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/ş/g, "s")
    .replace(/ö/g, "o")
    .replace(/ç/g, "c")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "")
);

const isAdultOnlyAutomationSource = (source: string) => source === "siyahmelek";

const titlesMatch = (sourceTitle: string, manga: AutomationMangaRow) => {
  const sourceKey = normalizeComparableTitle(sourceTitle);
  const localTitles = [
    manga?.title,
    ...(Array.isArray(manga?.alternative_titles) ? manga.alternative_titles : []),
  ];

  return localTitles.some((title) => {
    const localKey = normalizeComparableTitle(title);
    return Boolean(
      sourceKey
        && localKey
        && (
          sourceKey === localKey
          || (sourceKey.length >= 5 && localKey.includes(sourceKey))
          || (localKey.length >= 5 && sourceKey.includes(localKey))
        ),
    );
  });
};

const updateAutomationTestState = async (
  serviceClient: ServiceClient,
  automationId: string,
  values: {
    status: "running" | AutomationTestStatus;
    testedAt?: string | null;
    errorMessage?: string | null;
    details?: Record<string, unknown>;
    updatedBy?: string | null;
  },
) => {
  const updateValues: Record<string, unknown> = {
    last_test_status: values.status,
    last_test_error: values.errorMessage || null,
    last_test_details: values.details || {},
  };

  if (values.testedAt !== undefined) {
    updateValues.last_tested_at = values.testedAt;
  }

  if (values.updatedBy) {
    updateValues.updated_by = values.updatedBy;
  }

  const { error } = await serviceClient
    .from("chapter_automations")
    .update(updateValues)
    .eq("id", automationId);

  if (error) {
    throw error;
  }
};

const runAutomationConnectivityTest = async (
  serviceClient: ServiceClient,
  automation: AutomationRow,
  requesterId: string,
) => {
  const details: Record<string, unknown> = {
    source: automation.source,
    sourceUrl: automation.source_url,
  };

  await updateAutomationTestState(serviceClient, automation.id, {
    status: "running",
    testedAt: new Date().toISOString(),
    details,
    updatedBy: requesterId,
  });

  try {
    const [{ data: manga, error: mangaError }, { count: localChapterCount, error: chapterCountError }] = await Promise.all([
      serviceClient
        .from("mangas")
        .select("id, title, alternative_titles, is_adult")
        .eq("id", automation.manga_id)
        .maybeSingle(),
      serviceClient
        .from("chapters")
        .select("id", { count: "exact", head: true })
        .eq("manga_id", automation.manga_id),
    ]);

    if (mangaError) {
      throw mangaError;
    }

    if (chapterCountError) {
      throw chapterCountError;
    }

    const mangaRow = manga as AutomationMangaRow | null;

    if (!mangaRow) {
      throw new Error("Local manga kaydı bulunamadı");
    }

    if (isAdultOnlyAutomationSource(automation.source) && mangaRow.is_adult !== true) {
      throw new Error("SiyahMelek otomasyonu sadece 18+ olarak işaretlenmiş seriler için kullanılabilir");
    }

    details.localMangaTitle = mangaRow.title;
    details.localChapterCount = Number(localChapterCount || 0);

    const sourceResult = await fetchAutomationSeries(serviceClient, automation.source, automation.source_url);
    const sourceChapters = sourceResult.chapters.filter((chapter) => normalizeText(chapter.link));
    const numberedChapters = sourceChapters.filter((chapter) => Number.isFinite(chapter.number) && chapter.number > 0);
    const sampleCandidates = [...(numberedChapters.length > 0 ? numberedChapters : sourceChapters)]
      .slice(-5)
      .reverse();
    const titleMatched = titlesMatch(sourceResult.validation.sourceTitle, mangaRow);

    details.sourceTitle = sourceResult.validation.sourceTitle;
    details.normalizedUrl = sourceResult.validation.normalizedUrl;
    details.sourceChapterCount = sourceResult.chapters.length;
    details.latestChapterNumber = sourceResult.validation.latestChapterNumber ?? null;
    details.titleMatched = titleMatched;

    if (!titleMatched) {
      throw new Error("Kaynak seri başlığı seçili manga ile eşleşmiyor");
    }

    if (sourceResult.chapters.length === 0 || sampleCandidates.length === 0) {
      throw new Error("Kaynak bölüm listesi boş döndü");
    }

    const lockedSampleChapterNumbers: number[] = [];
    const failedSampleChapterNumbers: number[] = [];
    let sampledChapterName: string | null = null;
    let sampledChapterNumber: number | null = null;
    let sampledPageCount = 0;

    for (const sampledChapter of sampleCandidates) {
      const pageResult = await fetchChapterImagesForAutomation(serviceClient, automation.source, sampledChapter.link);

      if (pageResult.status === "locked") {
        lockedSampleChapterNumbers.push(sampledChapter.number);
        continue;
      }

      if (pageResult.status === "error") {
        failedSampleChapterNumbers.push(sampledChapter.number);
        continue;
      }

      sampledChapterName = sampledChapter.name;
      sampledChapterNumber = sampledChapter.number || null;
      sampledPageCount = pageResult.images.length;
      break;
    }

    details.lockedSampleChapterNumbers = lockedSampleChapterNumbers;
    details.failedSampleChapterNumbers = failedSampleChapterNumbers;

    if (sampledPageCount === 0 && failedSampleChapterNumbers.length === 0 && lockedSampleChapterNumbers.length > 0) {
      const testedAt = new Date().toISOString();
      const lockedSuccessDetails = {
        ...details,
        sampledPageCount: 0,
      };

      await updateAutomationTestState(serviceClient, automation.id, {
        status: "success",
        testedAt,
        details: lockedSuccessDetails,
        updatedBy: requesterId,
      });

      return {
        automationId: automation.id,
        status: "success" as const,
        testedAt,
        message: "Seri ve bölüm listesi doğrulandı. Son örnek bölümler VIP/kilitli olduğu için sayfa testi atlandı",
        details: lockedSuccessDetails,
      };
    }

    if (sampledPageCount === 0) {
      throw new Error("Örnek bölüm sayfaları alınamadı");
    }

    details.sampledChapterName = sampledChapterName;
    details.sampledChapterNumber = sampledChapterNumber;
    details.sampledPageCount = sampledPageCount;

    const testedAt = new Date().toISOString();
    await updateAutomationTestState(serviceClient, automation.id, {
      status: "success",
      testedAt,
      details,
      updatedBy: requesterId,
    });

    return {
      automationId: automation.id,
      status: "success" as const,
      testedAt,
      message: "Seri, bölüm listesi ve örnek bölüm sayfaları doğrulandı",
      details,
    };
  } catch (error) {
    const testedAt = new Date().toISOString();
    const message = error instanceof Error ? error.message : "Otomasyon testi başarısız";

    await updateAutomationTestState(serviceClient, automation.id, {
      status: "error",
      testedAt,
      errorMessage: message,
      details,
      updatedBy: requesterId,
    });

    return {
      automationId: automation.id,
      status: "error" as const,
      testedAt,
      message,
      errorMessage: message,
      details,
    };
  }
};

const runAutomationTests = async (
  serviceClient: ServiceClient,
  automations: AutomationRow[],
  requesterId: string,
) => {
  const results: Array<Awaited<ReturnType<typeof runAutomationConnectivityTest>>> = [];

  for (let index = 0; index < automations.length; index += TEST_CONCURRENCY_LIMIT) {
    const chunk = automations.slice(index, index + TEST_CONCURRENCY_LIMIT);
    const chunkResults = await Promise.all(
      chunk.map((automation) => runAutomationConnectivityTest(serviceClient, automation, requesterId)),
    );
    results.push(...chunkResults);
  }

  return results;
};

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

    if (action === "test") {
      const requestedAutomationIds = normalizeAutomationIds(body?.automationIds);
      let query = auth.serviceClient
        .from("chapter_automations")
        .select("*")
        .order("created_at", { ascending: false });

      if (requestedAutomationIds.length > 0) {
        query = query.in("id", requestedAutomationIds);
      }

      const { data: automationRows, error: automationError } = await query;

      if (automationError) {
        throw automationError;
      }

      const automations = (automationRows || []) as AutomationRow[];
      if (automations.length === 0) {
        return json({ success: false, message: "Test edilecek otomasyon bulunamadı" }, 404);
      }

      const testResults = await runAutomationTests(
        auth.serviceClient,
        automations,
        auth.requesterProfile.id,
      );
      const payload = await loadAutomationRows(auth.serviceClient, {
        automationIds: automations.map((automation) => automation.id),
        recentRunsLimit: 5,
      });

      return json({
        success: true,
        automations: payload.automations,
        testResults,
      });
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
        .select("id, is_adult")
        .eq("id", payload.mangaId)
        .maybeSingle();

      if (mangaError) {
        throw mangaError;
      }

      if (!manga) {
        return json({ success: false, message: "Local manga kaydı bulunamadı" }, 404);
      }

      if (isAdultOnlyAutomationSource(payload.source) && manga.is_adult !== true) {
        return json({ success: false, message: "SiyahMelek otomasyonu için seçili seri 18+ olarak işaretlenmelidir" }, 400);
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

    if (action === "clear-runs") {
      const { error } = await auth.serviceClient
        .from("chapter_automation_runs")
        .delete()
        .not("id", "is", null);

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
