import {
  ChapterAutomation,
  ChapterAutomationRunSummary,
  ChapterAutomationSource,
  ChapterAutomationTestResult,
  ChapterAutomationValidation,
} from '@/lib/types';
import { supabase } from '@/lib/supabase';
import { getMangaById } from '@/lib/database';
import { fetchScraperContent } from '@/lib/scraperProxy';
import {
  extractChapterImageResult,
  extractScrapedChapterLinks,
  extractScrapedMangaDetail,
  getScrapeSourceLabel,
  normalizeScrapeSeriesUrl,
  sanitizeAndDedupePageUrls,
  type ScrapeSource,
} from '@/lib/scraper/scrapeSources';

export interface ChapterAutomationUpsertInput {
  mangaId: string;
  source: ChapterAutomationSource;
  sourceUrl: string;
  checkTimes: string[];
  isActive: boolean;
}

const AUTOMATION_PAGE_SIZE = 1000;

const mapAutomationRowToModel = (
  row: any,
  latestRun: ChapterAutomationRunSummary | null = null,
): ChapterAutomation => {
  const manga = row.manga;
  return {
    id: row.id,
    automationType: 'chapter',
    mangaId: row.manga_id,
    mangaTitle: manga?.title || 'Bilinmeyen Seri',
    mangaCover: manga?.cover || null,
    source: row.source,
    sourceUrl: row.source_url,
    proxyProvider: row.proxy_provider || 'cloudflare',
    checkTimes: Array.isArray(row.check_times) ? row.check_times : [],
    scheduleTimezone: row.schedule_timezone || 'Europe/Istanbul',
    isActive: Boolean(row.is_active),
    validation: row.validation_snapshot || {
      source: row.source,
      sourceTitle: manga?.title || '',
      normalizedUrl: row.source_url,
      chapterCount: 0,
      checkedAt: row.created_at,
    },
    nextRunAt: row.next_run_at || null,
    lastRunStatus: row.last_run_status || 'idle',
    lastRunStartedAt: row.last_run_started_at || null,
    lastRunFinishedAt: row.last_run_finished_at || null,
    lastRunError: row.last_run_error || null,
    lastAddedChapterCount: Number(row.last_added_chapter_count || 0),
    lastTestStatus: row.last_test_status || 'idle',
    lastTestedAt: row.last_tested_at || null,
    lastTestError: row.last_test_error || null,
    lastTestDetails: row.last_test_details || {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by || null,
    updatedBy: row.updated_by || null,
    latestRun,
  };
};

const getCurrentActorUserId = async (): Promise<string | null> => {
  try {
    const { data } = await supabase.auth.getUser();
    return data.user?.id || null;
  } catch {
    return null;
  }
};

const patchMangaAutomationDetails = async (
  mangaId: string,
  patch: Record<string, unknown>,
): Promise<void> => {
  if (!mangaId) return;
  try {
    const { data: mangaRow } = await supabase
      .from('mangas')
      .select('details')
      .eq('id', mangaId)
      .maybeSingle();
    const existingDetails =
      mangaRow?.details && typeof mangaRow.details === 'object' ? mangaRow.details : {};
    await supabase
      .from('mangas')
      .update({
        details: {
          ...existingDetails,
          ...patch,
        },
      })
      .eq('id', mangaId);
  } catch {
    // Manga detayı güncellenemese bile ana otomasyon işlemi engellenmez
  }
};

export const listChapterAutomations = async (): Promise<{
  automations: ChapterAutomation[];
  recentRuns: ChapterAutomationRunSummary[];
}> => {
  const automationList: any[] = [];
  const seenIds = new Set<string>();
  let offset = 0;

  while (true) {
    const { data: autoRows, error: autoErr } = await supabase
      .from('chapter_automations')
      .select('*, manga:mangas(id, title, cover)')
      .order('created_at', { ascending: false })
      .order('id', { ascending: true })
      .range(offset, offset + AUTOMATION_PAGE_SIZE - 1);

    if (autoErr) {
      throw new Error(autoErr.message || 'CHAPTER_AUTOMATIONS_LIST_FAILED');
    }

    const batch = (autoRows || []) as any[];
    for (const row of batch) {
      if (row?.id && !seenIds.has(row.id)) {
        seenIds.add(row.id);
        automationList.push(row);
      }
    }

    if (batch.length < AUTOMATION_PAGE_SIZE) {
      break;
    }
    offset += AUTOMATION_PAGE_SIZE;
  }

  const autoMap = new Map<string, any>(automationList.map((r) => [r.id, r]));

  let recentRuns: ChapterAutomationRunSummary[] = [];
  const latestRunMap = new Map<string, ChapterAutomationRunSummary>();

  if (automationList.length > 0) {
    const { data: runRows } = await supabase
      .from('chapter_automation_runs')
      .select('*')
      .order('started_at', { ascending: false })
      .limit(50);

    recentRuns = ((runRows || []) as any[]).map((r) => {
      const auto = autoMap.get(r.automation_id);
      const manga = auto?.manga || null;
      return {
        id: r.id,
        automationId: r.automation_id,
        mangaId: auto?.manga_id || '',
        mangaTitle: manga?.title || 'Silinmiş Seri',
        mangaCover: manga?.cover || null,
        source: auto?.source,
        status: r.status,
        startedAt: r.started_at,
        finishedAt: r.finished_at || null,
        chaptersAdded: Number(r.chapters_added || 0),
        sourceChapterCount: Number(r.source_chapter_count || 0),
        newChapterCount: Number(r.new_chapter_count || 0),
        errorMessage: r.error_message || null,
        details: r.details || {},
      };
    });

    for (const run of recentRuns) {
      if (!latestRunMap.has(run.automationId)) {
        latestRunMap.set(run.automationId, run);
      }
    }
  }

  const automations: ChapterAutomation[] = automationList.map((row) =>
    mapAutomationRowToModel(row, latestRunMap.get(row.id) || null),
  );

  return { automations, recentRuns };
};

interface OkutoonSeriesSnapshot {
  title: string;
  normalizedUrl: string;
  cover: string | null;
  chapters: Array<{ number: number; link: string; slug: string; seriesSlug: string }>;
}

const fetchOkutoonSeriesFromApi = async (rawUrl: string): Promise<OkutoonSeriesSnapshot | null> => {
  const slug = String(rawUrl || '')
    .replace(/^https?:\/\/(?:www\.)?okutoon\.com\/?/i, '')
    .replace(/^seri\//i, '')
    .split(/[/?#]/)[0]
    ?.trim();
  if (!slug) return null;

  let seriesMeta: any = null;
  try {
    const rawMeta = await fetchScraperContent(`https://okutoon.com/api/v1/series/${encodeURIComponent(slug)}`, {
      source: 'okutoon',
    });
    seriesMeta = JSON.parse(rawMeta)?.data || null;
  } catch {
    // Chapters endpoint may still succeed even if metadata endpoint fails
  }

  const chapters: Array<{ number: number; link: string; slug: string; seriesSlug: string }> = [];
  const seenSlugs = new Set<string>();
  let offset = 0;

  for (let pageGuard = 0; pageGuard < 20; pageGuard++) {
    const chUrl = `https://okutoon.com/api/v1/series/${encodeURIComponent(slug)}/chapters?limit=100&offset=${offset}`;
    let chJson: any = null;
    try {
      const rawCh = await fetchScraperContent(chUrl, { source: 'okutoon' });
      chJson = JSON.parse(rawCh);
    } catch {
      break;
    }

    const items = Array.isArray(chJson?.data) ? chJson.data : [];
    if (items.length === 0) break;

    for (const ch of items) {
      const chSlug = String(ch?.slug || '').trim();
      if (!chSlug || seenSlugs.has(chSlug)) continue;
      seenSlugs.add(chSlug);
      const num = Number(ch?.display_number ?? ch?.number ?? 0);
      chapters.push({
        number: Number.isFinite(num) ? num : 0,
        link: ch?.url || `https://okutoon.com/${slug}/${chSlug}`,
        slug: chSlug,
        seriesSlug: slug,
      });
    }

    if (!chJson?.meta?.has_more) break;
    offset += items.length;
  }

  if (chapters.length === 0) return null;
  chapters.sort((a, b) => a.number - b.number);

  return {
    title: String(seriesMeta?.title || slug).trim(),
    normalizedUrl: `https://okutoon.com/${slug}`,
    cover: seriesMeta?.cover_url || seriesMeta?.headline_url || null,
    chapters,
  };
};

export const validateChapterAutomation = async (
  source: ChapterAutomationSource,
  sourceUrl: string,
): Promise<ChapterAutomationValidation> => {
  const normalizedUrl = normalizeScrapeSeriesUrl(source as ScrapeSource, sourceUrl);
  if (!normalizedUrl || !normalizedUrl.startsWith('http')) {
    throw new Error('Geçersiz seri bağlantısı');
  }

  if (source === 'okutoon') {
    const okuData = await fetchOkutoonSeriesFromApi(normalizedUrl);
    if (okuData && okuData.chapters.length > 0) {
      const chapterNumbers = okuData.chapters.map((c) => Number(c.number)).filter((n) => Number.isFinite(n));
      return {
        source,
        sourceTitle: okuData.title || 'Bilinmeyen Seri',
        normalizedUrl: okuData.normalizedUrl,
        cover: okuData.cover,
        chapterCount: okuData.chapters.length,
        latestChapterNumber: chapterNumbers.length > 0 ? Math.max(...chapterNumbers) : null,
        checkedAt: new Date().toISOString(),
      };
    }
  }

  const html = await fetchScraperContent(normalizedUrl, { source: source as ScrapeSource });
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const detail = extractScrapedMangaDetail(
    doc,
    source as ScrapeSource,
    { title: '', link: normalizedUrl, cover: '', genres: [] },
    html,
  );

  const chapters = detail._rawChapters.filter((ch) => ch.link);
  if (chapters.length === 0) {
    throw new Error(`Seri bağlantısından bölüm bulunamadı (${getScrapeSourceLabel(source as ScrapeSource)})`);
  }

  const chapterNumbers = chapters
    .map((c) => Number(c.number))
    .filter((n) => Number.isFinite(n));
  const latestChapterNumber = chapterNumbers.length > 0 ? Math.max(...chapterNumbers) : null;

  return {
    source,
    sourceTitle: detail.title || 'Bilinmeyen Seri',
    normalizedUrl,
    cover: detail.cover || null,
    chapterCount: chapters.length,
    latestChapterNumber,
    checkedAt: new Date().toISOString(),
  };
};

export const testChapterAutomations = async (automationIds?: string[]): Promise<{
  automations: ChapterAutomation[];
  testResults: ChapterAutomationTestResult[];
}> => {
  const listResult = await listChapterAutomations();
  const targetAutomations = automationIds && automationIds.length > 0
    ? listResult.automations.filter((a) => automationIds.includes(a.id))
    : listResult.automations;

  const testResults: ChapterAutomationTestResult[] = [];

  for (const auto of targetAutomations) {
    const testedAt = new Date().toISOString();
    try {
      // 1. Mark running
      await supabase
        .from('chapter_automations')
        .update({
          last_test_status: 'running',
          last_tested_at: testedAt,
          updated_at: testedAt,
        })
        .eq('id', auto.id);

      // 2. Load local manga
      const localManga = await getMangaById(auto.mangaId);
      if (!localManga) {
        throw new Error('Yerel manga veritabanında bulunamadı');
      }

      // 3. Fetch source chapters
      const normalizedUrl = normalizeScrapeSeriesUrl(auto.source as ScrapeSource, auto.sourceUrl);
      let sourceChapters: Array<{ number: number; link: string; slug?: string; seriesSlug?: string }> = [];

      if (auto.source === 'okutoon') {
        const okuData = await fetchOkutoonSeriesFromApi(normalizedUrl);
        if (okuData) {
          sourceChapters = okuData.chapters;
        }
      }

      if (sourceChapters.length === 0) {
        const html = await fetchScraperContent(normalizedUrl, { source: auto.source as ScrapeSource });
        const doc = new DOMParser().parseFromString(html, 'text/html');
        sourceChapters = extractScrapedChapterLinks(doc, auto.source as ScrapeSource);
      }

      if (sourceChapters.length === 0) {
        throw new Error('Kaynak sitede bölüm listesi bulunamadı');
      }

      // 4. Compare with local chapters
      const localChapterNums = new Set(localManga.chapters.map((c) => Number(c.number)));
      const missingChapters = sourceChapters.filter((c) => !localChapterNums.has(Number(c.number)));

      // 5. Test probe latest chapter image extraction
      let probeStatus = 'ok';
      if (sourceChapters.length > 0) {
        try {
          const sampleCh = sourceChapters[sourceChapters.length - 1] || sourceChapters[0];
          if (auto.source === 'okutoon' && sampleCh.seriesSlug && sampleCh.slug) {
            const rawChJson = await fetchScraperContent(
              `https://okutoon.com/api/v1/series/${encodeURIComponent(sampleCh.seriesSlug)}/chapters/${encodeURIComponent(sampleCh.slug)}`,
              { source: 'okutoon' },
            );
            const pages = JSON.parse(rawChJson)?.data?.pages || [];
            const validImgs = sanitizeAndDedupePageUrls(
              pages.map((p: any) => String(p?.image_url || '')).filter(Boolean),
              'okutoon',
            );
            if (validImgs.length === 0) {
              probeStatus = 'warning_no_images';
            }
          } else {
            const sampleHtml = await fetchScraperContent(sampleCh.link, { source: auto.source as ScrapeSource });
            const sampleDoc = new DOMParser().parseFromString(sampleHtml, 'text/html');
            const imgRes = extractChapterImageResult(sampleDoc, auto.source as ScrapeSource, undefined, sampleHtml);
            const validImgs = sanitizeAndDedupePageUrls(imgRes.images, auto.source as ScrapeSource);
            if (validImgs.length === 0) {
              probeStatus = 'warning_no_images';
            }
          }
        } catch {
          probeStatus = 'warning_probe_failed';
        }
      }

      const details = {
        sourceChapterCount: sourceChapters.length,
        localChapterCount: localManga.chapters.length,
        newChapterCount: missingChapters.length,
        probeStatus,
      };

      const msg = `Bağlantı başarılı: Kaynakta ${sourceChapters.length} bölüm, yerelde ${localManga.chapters.length} bölüm (${missingChapters.length} yeni bölüm).`;

      // 6. Update automation status to success
      await supabase
        .from('chapter_automations')
        .update({
          last_test_status: 'success',
          last_tested_at: testedAt,
          last_test_error: null,
          last_test_details: details,
          updated_at: testedAt,
        })
        .eq('id', auto.id);

      // 7. Record run in chapter_automation_runs
      await supabase
        .from('chapter_automation_runs')
        .insert({
          id: crypto.randomUUID(),
          automation_id: auto.id,
          status: missingChapters.length > 0 ? 'success' : 'no_changes',
          started_at: testedAt,
          finished_at: new Date().toISOString(),
          chapters_added: 0,
          source_chapter_count: sourceChapters.length,
          new_chapter_count: missingChapters.length,
          error_message: null,
          details,
        });

      testResults.push({
        automationId: auto.id,
        status: 'success',
        testedAt,
        message: msg,
        details,
      });
    } catch (err: any) {
      const errorMsg = err instanceof Error ? err.message : 'Test sırasında bilinmeyen hata oluştu';

      await supabase
        .from('chapter_automations')
        .update({
          last_test_status: 'error',
          last_tested_at: testedAt,
          last_test_error: errorMsg,
          last_test_details: { error: errorMsg },
          updated_at: testedAt,
        })
        .eq('id', auto.id);

      await supabase
        .from('chapter_automation_runs')
        .insert({
          id: crypto.randomUUID(),
          automation_id: auto.id,
          status: 'error',
          started_at: testedAt,
          finished_at: new Date().toISOString(),
          chapters_added: 0,
          source_chapter_count: 0,
          new_chapter_count: 0,
          error_message: errorMsg,
          details: { error: errorMsg },
        });

      testResults.push({
        automationId: auto.id,
        status: 'error',
        testedAt,
        errorMessage: errorMsg,
        details: { error: errorMsg },
      });
    }
  }

  const updatedList = await listChapterAutomations();
  return {
    automations: updatedList.automations,
    testResults,
  };
};

export const createChapterAutomation = async (
  payload: ChapterAutomationUpsertInput,
): Promise<ChapterAutomation> => {
  const { data: existingForManga } = await supabase
    .from('chapter_automations')
    .select('id')
    .eq('manga_id', payload.mangaId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existingForManga?.id) {
    return await updateChapterAutomation(existingForManga.id, payload);
  }

  const validation = await validateChapterAutomation(payload.source, payload.sourceUrl);
  const actorUserId = await getCurrentActorUserId();
  const now = new Date().toISOString();
  const id = crypto.randomUUID();

  const row = {
    id,
    automation_type: 'chapter',
    manga_id: payload.mangaId,
    source: payload.source,
    source_url: validation.normalizedUrl,
    proxy_provider: 'cloudflare',
    check_times: payload.checkTimes,
    schedule_timezone: 'Europe/Istanbul',
    is_active: payload.isActive,
    validation_snapshot: validation,
    last_run_status: 'idle',
    last_added_chapter_count: 0,
    last_test_status: 'idle',
    created_at: now,
    updated_at: now,
    ...(actorUserId ? { created_by: actorUserId, updated_by: actorUserId } : {}),
  };

  const { error } = await supabase.from('chapter_automations').insert(row);
  if (error) {
    throw new Error(error.message || 'CHAPTER_AUTOMATION_CREATE_FAILED');
  }

  await patchMangaAutomationDetails(payload.mangaId, {
    primarySource: payload.source,
    primarySourceUrl: validation.normalizedUrl,
    automationDisabled: false,
    automationPausedByAdmin: !payload.isActive,
  });

  const manga = await getMangaById(payload.mangaId);

  return {
    id,
    automationType: 'chapter',
    mangaId: payload.mangaId,
    mangaTitle: manga?.title || validation.sourceTitle,
    mangaCover: manga?.cover || validation.cover,
    source: payload.source,
    sourceUrl: validation.normalizedUrl,
    proxyProvider: 'cloudflare',
    checkTimes: payload.checkTimes,
    scheduleTimezone: 'Europe/Istanbul',
    isActive: payload.isActive,
    validation,
    lastRunStatus: 'idle',
    lastAddedChapterCount: 0,
    lastTestStatus: 'idle',
    createdAt: now,
    updatedAt: now,
    createdBy: actorUserId,
    updatedBy: actorUserId,
    latestRun: null,
  };
};

export const updateChapterAutomation = async (
  automationId: string,
  payload: ChapterAutomationUpsertInput,
): Promise<ChapterAutomation> => {
  const validation = await validateChapterAutomation(payload.source, payload.sourceUrl);
  const actorUserId = await getCurrentActorUserId();
  const now = new Date().toISOString();

  const updatePayload = {
    manga_id: payload.mangaId,
    source: payload.source,
    source_url: validation.normalizedUrl,
    check_times: payload.checkTimes,
    is_active: payload.isActive,
    validation_snapshot: validation,
    updated_at: now,
    ...(actorUserId ? { updated_by: actorUserId } : {}),
  };

  const { error } = await supabase
    .from('chapter_automations')
    .update(updatePayload)
    .eq('id', automationId);

  if (error) {
    throw new Error(error.message || 'CHAPTER_AUTOMATION_UPDATE_FAILED');
  }

  await patchMangaAutomationDetails(payload.mangaId, {
    primarySource: payload.source,
    primarySourceUrl: validation.normalizedUrl,
    automationDisabled: false,
    automationPausedByAdmin: !payload.isActive,
  });

  const manga = await getMangaById(payload.mangaId);
  const { data: row } = await supabase
    .from('chapter_automations')
    .select('*')
    .eq('id', automationId)
    .single();

  return {
    id: automationId,
    automationType: 'chapter',
    mangaId: payload.mangaId,
    mangaTitle: manga?.title || validation.sourceTitle,
    mangaCover: manga?.cover || validation.cover,
    source: payload.source,
    sourceUrl: validation.normalizedUrl,
    proxyProvider: 'cloudflare',
    checkTimes: payload.checkTimes,
    scheduleTimezone: 'Europe/Istanbul',
    isActive: payload.isActive,
    validation,
    nextRunAt: row?.next_run_at || null,
    lastRunStatus: row?.last_run_status || 'idle',
    lastRunStartedAt: row?.last_run_started_at || null,
    lastRunFinishedAt: row?.last_run_finished_at || null,
    lastRunError: row?.last_run_error || null,
    lastAddedChapterCount: Number(row?.last_added_chapter_count || 0),
    lastTestStatus: row?.last_test_status || 'idle',
    lastTestedAt: row?.last_tested_at || null,
    lastTestError: row?.last_test_error || null,
    lastTestDetails: row?.last_test_details || {},
    createdAt: row?.created_at || now,
    updatedAt: now,
    createdBy: row?.created_by || null,
    updatedBy: row?.updated_by || actorUserId || null,
    latestRun: null,
  };
};

export const deleteChapterAutomationsBulk = async (automationIds: string[]): Promise<void> => {
  const uniqueIds = Array.from(new Set(automationIds.map((id) => id.trim()).filter(Boolean)));
  if (uniqueIds.length === 0) return;

  const CHUNK_SIZE = 200;
  const affectedMangaIds = new Set<string>();

  for (let i = 0; i < uniqueIds.length; i += CHUNK_SIZE) {
    const chunk = uniqueIds.slice(i, i + CHUNK_SIZE);
    const { data: targetRows } = await supabase
      .from('chapter_automations')
      .select('manga_id')
      .in('id', chunk);

    for (const r of targetRows || []) {
      if (r?.manga_id) affectedMangaIds.add(r.manga_id);
    }

    const { error } = await supabase
      .from('chapter_automations')
      .delete()
      .in('id', chunk);

    if (error) {
      throw new Error(error.message || 'CHAPTER_AUTOMATION_DELETE_FAILED');
    }
  }

  const mangaIdList = Array.from(affectedMangaIds);
  for (let i = 0; i < mangaIdList.length; i += CHUNK_SIZE) {
    const mangaChunk = mangaIdList.slice(i, i + CHUNK_SIZE);
    const { data: remainingRows } = await supabase
      .from('chapter_automations')
      .select('manga_id')
      .in('manga_id', mangaChunk);
    const stillHasAutomation = new Set((remainingRows || []).map((r: any) => r?.manga_id));

    await Promise.all(
      mangaChunk
        .filter((mId) => !stillHasAutomation.has(mId))
        .map((mId) =>
          patchMangaAutomationDetails(mId, {
            automationDisabled: true,
            automationPausedByAdmin: false,
          }),
        ),
    );
  }
};

export const deleteChapterAutomation = async (automationId: string): Promise<void> => {
  await deleteChapterAutomationsBulk([automationId]);
};

export const clearChapterAutomationRuns = async (): Promise<void> => {
  const { error } = await supabase
    .from('chapter_automation_runs')
    .delete()
    .neq('id', '00000000-0000-0000-0000-000000000000');

  if (error) {
    throw new Error(error.message || 'CHAPTER_AUTOMATION_CLEAR_RUNS_FAILED');
  }
};

export const setChapterAutomationActive = async (
  automationId: string,
  isActive: boolean,
): Promise<ChapterAutomation> => {
  const actorUserId = await getCurrentActorUserId();
  const now = new Date().toISOString();
  const { data: updatedRow, error } = await supabase
    .from('chapter_automations')
    .update({
      is_active: isActive,
      updated_at: now,
      ...(actorUserId ? { updated_by: actorUserId } : {}),
    })
    .eq('id', automationId)
    .select('*, manga:mangas(id, title, cover)')
    .single();

  if (error || !updatedRow) {
    throw new Error(error?.message || 'CHAPTER_AUTOMATION_STATUS_FAILED');
  }

  if (updatedRow.manga_id) {
    await patchMangaAutomationDetails(updatedRow.manga_id, {
      automationDisabled: false,
      automationPausedByAdmin: !isActive,
    });
  }

  const { data: latestRunRow } = await supabase
    .from('chapter_automation_runs')
    .select('*')
    .eq('automation_id', automationId)
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const latestRun: ChapterAutomationRunSummary | null = latestRunRow
    ? {
        id: latestRunRow.id,
        automationId: latestRunRow.automation_id,
        mangaId: updatedRow.manga_id || '',
        mangaTitle: updatedRow.manga?.title || 'Bilinmeyen Seri',
        mangaCover: updatedRow.manga?.cover || null,
        source: updatedRow.source,
        status: latestRunRow.status,
        startedAt: latestRunRow.started_at,
        finishedAt: latestRunRow.finished_at || null,
        chaptersAdded: Number(latestRunRow.chapters_added || 0),
        sourceChapterCount: Number(latestRunRow.source_chapter_count || 0),
        newChapterCount: Number(latestRunRow.new_chapter_count || 0),
        errorMessage: latestRunRow.error_message || null,
        details: latestRunRow.details || {},
      }
    : null;

  return mapAutomationRowToModel(updatedRow, latestRun);
};
