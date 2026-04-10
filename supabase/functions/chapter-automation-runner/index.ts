import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createServiceClient, json } from "../_shared/auth.ts";
import { corsHeaders } from "../_shared/cors.ts";
import {
  computeNextRunAfter,
  fetchAutomationSeries,
  fetchChapterImagesForAutomation,
  sleep,
} from "../_shared/chapter-automation.ts";
import { materializeAutomationChapterPages } from "../_shared/media-storage.ts";

const RUNNER_TOKEN_SECRET_KEY = "chapter_automation_runner_token";
const RUNNER_NAME = "supabase-edge:chapter-automation-runner";
const CLAIM_LIMIT = 5;

interface RunnerAutomationRow {
  id: string;
  manga_id: string;
  source: string;
  source_url: string;
  check_times?: string[] | null;
  validation_snapshot?: Record<string, unknown> | null;
}

interface UserPreferenceRow {
  id: string;
  preferences?: {
    notifications?: {
      new_chapter?: boolean;
    };
  } | null;
}

const normalizeText = (value?: string | null) => value?.trim() || "";

const loadRunnerToken = async (serviceClient: ReturnType<typeof createServiceClient>) => {
  const { data, error } = await serviceClient
    .from("internal_worker_secrets")
    .select("value")
    .eq("key", RUNNER_TOKEN_SECRET_KEY)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return normalizeText(data?.value);
};

const dedupeSourceChaptersByNumber = (chapters: Array<{ number: number } & Record<string, unknown>>) => {
  const unique = new Map<number, typeof chapters[number]>();

  for (const chapter of chapters) {
    if (!Number.isFinite(chapter.number) || chapter.number <= 0 || unique.has(chapter.number)) {
      continue;
    }

    unique.set(chapter.number, chapter);
  }

  return Array.from(unique.values()).sort((left, right) => left.number - right.number);
};

const createFollowerNotifications = async (
  serviceClient: ReturnType<typeof createServiceClient>,
  mangaId: string,
  mangaTitle: string,
  insertedChapters: Array<{ id: string; number: number }>,
) => {
  if (insertedChapters.length === 0) {
    return 0;
  }

  const { data: followers, error: followError } = await serviceClient
    .from("follows")
    .select("user_id")
    .eq("manga_id", mangaId);

  if (followError || !followers || followers.length === 0) {
    if (followError) {
      console.error("Follower fetch error:", followError);
    }
    return 0;
  }

  const userIds = followers.map((follower) => follower.user_id).filter(Boolean);
  const { data: usersData, error: usersError } = await serviceClient
    .from("users")
    .select("id, preferences")
    .in("id", userIds);

  if (usersError) {
    console.error("Follower preference fetch error:", usersError);
    return 0;
  }

  const preferencesByUserId = new Map<string, UserPreferenceRow["preferences"]>();
  for (const user of (usersData || []) as UserPreferenceRow[]) {
    preferencesByUserId.set(user.id, user.preferences);
  }

  const notifications = followers
    .filter((follower) => preferencesByUserId.get(follower.user_id)?.notifications?.new_chapter !== false)
    .flatMap((follower) => insertedChapters.map((chapter) => ({
      user_id: follower.user_id,
      type: "new_chapter",
      title: "Yeni Bölüm",
      message: `${mangaTitle} - Bölüm ${chapter.number} yayınlandı.`,
      manga_id: mangaId,
      chapter_id: chapter.id,
      link: `/manga/${mangaId}/chapter/${chapter.id}`,
      read: false,
      created_at: new Date().toISOString(),
    })));

  if (notifications.length === 0) {
    return 0;
  }

  const { error } = await serviceClient.from("notifications").insert(notifications);
  if (error) {
    console.error("Follower notification insert error:", error);
    return 0;
  }

  return notifications.length;
};

const updateAutomationRunState = async (
  serviceClient: ReturnType<typeof createServiceClient>,
  automation: RunnerAutomationRow,
  runId: string,
  values: {
    status: "success" | "no_changes" | "error";
    finishedAt: string;
    chaptersAdded: number;
    sourceChapterCount: number;
    newChapterCount: number;
    errorMessage?: string | null;
    details?: Record<string, unknown>;
    validationSnapshot?: Record<string, unknown> | null;
  },
) => {
  const nextRunAt = computeNextRunAfter(automation.check_times || [], values.finishedAt);

  const { error: runError } = await serviceClient
    .from("chapter_automation_runs")
    .update({
      status: values.status,
      finished_at: values.finishedAt,
      chapters_added: values.chaptersAdded,
      source_chapter_count: values.sourceChapterCount,
      new_chapter_count: values.newChapterCount,
      error_message: values.errorMessage || null,
      details: values.details || {},
    })
    .eq("id", runId);

  if (runError) {
    throw runError;
  }

  const { error: automationError } = await serviceClient
    .from("chapter_automations")
    .update({
      next_run_at: nextRunAt,
      last_run_status: values.status,
      last_run_finished_at: values.finishedAt,
      last_run_error: values.errorMessage || null,
      last_added_chapter_count: values.chaptersAdded,
      locked_at: null,
      locked_by: null,
      validation_snapshot: values.validationSnapshot || automation.validation_snapshot,
    })
    .eq("id", automation.id);

  if (automationError) {
    throw automationError;
  }
};

const processAutomation = async (
  serviceClient: ReturnType<typeof createServiceClient>,
  automation: RunnerAutomationRow,
) => {
  const startedAt = new Date().toISOString();
  const { data: runRow, error: runInsertError } = await serviceClient
    .from("chapter_automation_runs")
    .insert({
      automation_id: automation.id,
      status: "running",
      started_at: startedAt,
      details: {},
    })
    .select("id")
    .single();

  if (runInsertError) {
    throw runInsertError;
  }

  try {
    const [{ data: manga, error: mangaError }, { data: chapterRows, error: chapterError }] = await Promise.all([
      serviceClient
        .from("mangas")
        .select("id, title, cover")
        .eq("id", automation.manga_id)
        .maybeSingle(),
      serviceClient
        .from("chapters")
        .select("id, number, title")
        .eq("manga_id", automation.manga_id)
        .order("number", { ascending: true }),
    ]);

    if (mangaError) {
      throw mangaError;
    }

    if (chapterError) {
      throw chapterError;
    }

    if (!manga) {
      throw new Error("Local manga kaydı bulunamadı");
    }

    const sourceResult = await fetchAutomationSeries(serviceClient, automation.source, automation.source_url);
    if (sourceResult.chapters.length === 0) {
      throw new Error("Kaynak bölüm listesi boş döndü");
    }

    const existingNumbers = new Set((chapterRows || []).map((chapter) => Number(chapter.number)));
    const missingChapters = dedupeSourceChaptersByNumber(sourceResult.chapters)
      .filter((chapter) => !existingNumbers.has(chapter.number));

    if (missingChapters.length === 0) {
      const finishedAt = new Date().toISOString();
      await updateAutomationRunState(serviceClient, automation, runRow.id, {
        status: "no_changes",
        finishedAt,
        chaptersAdded: 0,
        sourceChapterCount: sourceResult.chapters.length,
        newChapterCount: 0,
        details: {
          latestSourceChapterNumber: sourceResult.validation.latestChapterNumber,
        },
        validationSnapshot: sourceResult.validation as Record<string, unknown>,
      });

      return { status: "no_changes" as const, chaptersAdded: 0 };
    }

    const insertedChapterRows: Array<{ id: string; number: number }> = [];
    const chapterInsertPayload: Array<Record<string, unknown>> = [];
    const skippedLockedChapters: number[] = [];
    const failedChapters: number[] = [];

    for (let index = 0; index < missingChapters.length; index += 1) {
      const chapter = missingChapters[index];

      if (index > 0) {
        await sleep(800);
      }

      const pageResult = await fetchChapterImagesForAutomation(serviceClient, automation.source, chapter.link);
      if (pageResult.status === "locked") {
        skippedLockedChapters.push(chapter.number);
        continue;
      }

      if (pageResult.status === "error") {
        failedChapters.push(chapter.number);
        continue;
      }

      const chapterId = `chapter-${crypto.randomUUID()}`;
      chapterInsertPayload.push({
        id: chapterId,
        manga_id: automation.manga_id,
        number: chapter.number,
        title: chapter.name,
        pages: pageResult.images,
        views: 0,
        release_date: new Date().toISOString(),
      });
      insertedChapterRows.push({ id: chapterId, number: chapter.number });
    }

    if (chapterInsertPayload.length > 0) {
      const materializedChapterInsertPayload = await materializeAutomationChapterPages(
        serviceClient,
        automation.manga_id,
        chapterInsertPayload.map((chapter) => ({
          id: String(chapter.id),
          pages: Array.isArray(chapter.pages) ? chapter.pages as string[] : [],
        })),
      ).then((materializedChapters) => {
        const pagesByChapterId = new Map(
          materializedChapters.map((chapter) => [chapter.id, chapter.pages]),
        );

        return chapterInsertPayload.map((chapter) => ({
          ...chapter,
          pages: pagesByChapterId.get(String(chapter.id)) || chapter.pages,
        }));
      });

      const { error: chapterInsertError } = await serviceClient
        .from("chapters")
        .insert(materializedChapterInsertPayload);

      if (chapterInsertError) {
        throw chapterInsertError;
      }

      const { error: mangaUpdateError } = await serviceClient
        .from("mangas")
        .update({ last_updated: new Date().toISOString() })
        .eq("id", automation.manga_id);

      if (mangaUpdateError) {
        throw mangaUpdateError;
      }

      await createFollowerNotifications(serviceClient, manga.id, manga.title, insertedChapterRows);
    }

    const finishedAt = new Date().toISOString();
    const addedCount = insertedChapterRows.length;
    const status = addedCount > 0
      ? "success" as const
      : failedChapters.length === 0 && skippedLockedChapters.length > 0
        ? "no_changes" as const
        : "error" as const;
    const errorMessage = status === "error"
      ? "Yeni bölümler bulundu ancak erişilebilir sayfalar alınamadı"
      : null;

    await updateAutomationRunState(serviceClient, automation, runRow.id, {
      status,
      finishedAt,
      chaptersAdded: addedCount,
      sourceChapterCount: sourceResult.chapters.length,
      newChapterCount: missingChapters.length,
      errorMessage,
      details: {
        addedChapterNumbers: insertedChapterRows.map((chapter) => chapter.number),
        skippedLockedChapterNumbers: skippedLockedChapters,
        failedChapterNumbers: failedChapters,
      },
      validationSnapshot: sourceResult.validation as Record<string, unknown>,
    });

    return { status, chaptersAdded: addedCount };
  } catch (error) {
    const finishedAt = new Date().toISOString();
    await updateAutomationRunState(serviceClient, automation, runRow.id, {
      status: "error",
      finishedAt,
      chaptersAdded: 0,
      sourceChapterCount: 0,
      newChapterCount: 0,
      errorMessage: error instanceof Error ? error.message : "Beklenmeyen bir hata oluştu",
      details: {},
    });

    return { status: "error" as const, chaptersAdded: 0 };
  }
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ success: false, message: "Unsupported method" }, 405);
  }

  try {
    const serviceClient = createServiceClient();
    const expectedToken = await loadRunnerToken(serviceClient);
    const authHeader = req.headers.get("Authorization") || "";
    const bearerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";

    if (!expectedToken) {
      return json({ success: false, message: "Runner token tanımlı değil" }, 503);
    }

    if (!bearerToken || bearerToken !== expectedToken) {
      return json({ success: false, message: "Unauthorized" }, 401);
    }

    const nowIso = new Date().toISOString();
    const { data: claimedAutomations, error: claimError } = await serviceClient.rpc(
      "claim_due_chapter_automations",
      {
        p_now: nowIso,
        p_runner: RUNNER_NAME,
        p_limit: CLAIM_LIMIT,
      },
    );

    if (claimError) {
      throw claimError;
    }

    const claimedList = (claimedAutomations || []) as RunnerAutomationRow[];
    let successCount = 0;
    let noChangesCount = 0;
    let errorCount = 0;

    for (const automation of claimedList) {
      const result = await processAutomation(serviceClient, automation);
      if (result.status === "success") {
        successCount += 1;
      } else if (result.status === "no_changes") {
        noChangesCount += 1;
      } else {
        errorCount += 1;
      }
    }

    return json({
      success: true,
      processedCount: claimedList.length,
      successCount,
      noChangesCount,
      errorCount,
    });
  } catch (error) {
    console.error("Unexpected error in chapter-automation-runner:", error);
    return json({
      success: false,
      message: error instanceof Error ? error.message : "Beklenmeyen bir hata oluştu",
    }, 500);
  }
});
