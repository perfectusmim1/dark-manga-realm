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

export const listChapterAutomations = async (): Promise<{
  automations: ChapterAutomation[];
  recentRuns: ChapterAutomationRunSummary[];
}> => {
  const { data: autoRows, error: autoErr } = await supabase
    .from('chapter_automations')
    .select('*')
    .order('created_at', { ascending: false });

  if (autoErr) {
    throw new Error(autoErr.message || 'CHAPTER_AUTOMATIONS_LIST_FAILED');
  }

  const automationList = (autoRows || []) as any[];
  const mangaIds = Array.from(new Set(automationList.map((r) => r.manga_id).filter(Boolean)));
  const mangaMap = new Map<string, { id: string; title: string; cover?: string | null }>();

  if (mangaIds.length > 0) {
    const { data: mangaRows } = await supabase
      .from('mangas')
      .select('id, title, cover')
      .in('id', mangaIds);

    for (const m of (mangaRows || []) as any[]) {
      mangaMap.set(m.id, m);
    }
  }

  const automationIds = automationList.map((r) => r.id);
  let recentRuns: ChapterAutomationRunSummary[] = [];
  const latestRunMap = new Map<string, ChapterAutomationRunSummary>();

  if (automationIds.length > 0) {
    const { data: runRows } = await supabase
      .from('chapter_automation_runs')
      .select('*')
      .in('automation_id', automationIds)
      .order('started_at', { ascending: false })
      .limit(50);

    const autoMap = new Map<string, any>(automationList.map((r) => [r.id, r]));

    recentRuns = ((runRows || []) as any[]).map((r) => {
      const auto = autoMap.get(r.automation_id);
      const manga = auto ? mangaMap.get(auto.manga_id) : null;
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

  const automations: ChapterAutomation[] = automationList.map((row) => {
    const manga = mangaMap.get(row.manga_id);
    const latestRun = latestRunMap.get(row.id) || null;
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
  });

  return { automations, recentRuns };
};

export const validateChapterAutomation = async (
  source: ChapterAutomationSource,
  sourceUrl: string,
): Promise<ChapterAutomationValidation> => {
  const normalizedUrl = normalizeScrapeSeriesUrl(source as ScrapeSource, sourceUrl);
  if (!normalizedUrl || !normalizedUrl.startsWith('http')) {
    throw new Error('Geçersiz seri bağlantısı');
  }

  const html = await fetchScraperContent(normalizedUrl, { source: source as ScrapeSource });
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const detail = extractScrapedMangaDetail(
    doc,
    source as ScrapeSource,
    { title: '', link: normalizedUrl, cover: '', genres: [] },
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
      const html = await fetchScraperContent(normalizedUrl, { source: auto.source as ScrapeSource });
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const sourceChapters = extractScrapedChapterLinks(doc, auto.source as ScrapeSource);

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
          const sampleCh = sourceChapters[0];
          const sampleHtml = await fetchScraperContent(sampleCh.link, { source: auto.source as ScrapeSource });
          const sampleDoc = new DOMParser().parseFromString(sampleHtml, 'text/html');
          const imgRes = extractChapterImageResult(sampleDoc, auto.source as ScrapeSource, undefined, sampleHtml);
          const validImgs = sanitizeAndDedupePageUrls(imgRes.images, auto.source as ScrapeSource);
          if (validImgs.length === 0) {
            probeStatus = 'warning_no_images';
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
  const validation = await validateChapterAutomation(payload.source, payload.sourceUrl);
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
  };

  const { error } = await supabase.from('chapter_automations').insert(row);
  if (error) {
    throw new Error(error.message || 'CHAPTER_AUTOMATION_CREATE_FAILED');
  }

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
    latestRun: null,
  };
};

export const updateChapterAutomation = async (
  automationId: string,
  payload: ChapterAutomationUpsertInput,
): Promise<ChapterAutomation> => {
  const validation = await validateChapterAutomation(payload.source, payload.sourceUrl);
  const now = new Date().toISOString();

  const updatePayload = {
    manga_id: payload.mangaId,
    source: payload.source,
    source_url: validation.normalizedUrl,
    check_times: payload.checkTimes,
    is_active: payload.isActive,
    validation_snapshot: validation,
    updated_at: now,
  };

  const { error } = await supabase
    .from('chapter_automations')
    .update(updatePayload)
    .eq('id', automationId);

  if (error) {
    throw new Error(error.message || 'CHAPTER_AUTOMATION_UPDATE_FAILED');
  }

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
    latestRun: null,
  };
};

export const deleteChapterAutomation = async (automationId: string): Promise<void> => {
  const { error } = await supabase
    .from('chapter_automations')
    .delete()
    .eq('id', automationId);

  if (error) {
    throw new Error(error.message || 'CHAPTER_AUTOMATION_DELETE_FAILED');
  }
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
  const now = new Date().toISOString();
  const { error } = await supabase
    .from('chapter_automations')
    .update({ is_active: isActive, updated_at: now })
    .eq('id', automationId);

  if (error) {
    throw new Error(error.message || 'CHAPTER_AUTOMATION_STATUS_FAILED');
  }

  const listRes = await listChapterAutomations();
  const updated = listRes.automations.find((a) => a.id === automationId);
  if (!updated) {
    throw new Error('Automation not found after status update');
  }
  return updated;
};
