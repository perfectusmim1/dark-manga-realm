import { supabase } from '@/lib/supabase';
import { loadTranslationSettings } from './translationSettings';
import {
  getLocalChapterTranslations,
  isValidCachedBlockList,
  putLocalChapterTranslationsBatch,
  putLocalPageTranslation,
  shouldAcceptRemoteTranslation,
} from './localTranslationCache';
import { TranslationBlock } from './types';

let translationTableUnavailable = false;

const isMissingTableError = (error: { code?: string; message?: string; status?: number } | null) =>
  Boolean(
    error &&
      (error.code === 'PGRST205' ||
        error.code === '42P01' ||
        error.status === 404 ||
        /page_translations/i.test(error.message || '')),
  );

const isIgnorableWriteAuthError = (error: { code?: string; message?: string; status?: number } | null) =>
  Boolean(
    error &&
      (error.code === '42501' ||
        error.code === 'PGRST301' ||
        error.status === 401 ||
        error.status === 403 ||
        /row-level security|jwt|permission denied|not authenticated/i.test(error.message || '')),
  );

// Bölümün seçili dildeki çevirilerini yerel IndexedDB + Supabase üzerinden birleştirerek getirir.
// Eski v1 (gri oval) kayıtları ve kullanıcının elle temizlediği eski kayıtları otomatik eler.
export const getCachedChapterTranslations = async (
  chapterId: string,
  lang: string,
  options?: { networkEnabled?: boolean },
): Promise<Map<number, TranslationBlock[]>> => {
  const merged = await getLocalChapterTranslations(chapterId, lang);

  if (options?.networkEnabled === false || translationTableUnavailable) {
    return merged;
  }

  try {
    const { data, error } = await supabase
      .from('page_translations')
      .select('page_index, blocks, updated_at')
      .eq('chapter_id', chapterId)
      .eq('lang', lang);

    if (error) {
      if (isMissingTableError(error)) {
        translationTableUnavailable = true;
      }
      return merged;
    }

    const toHydrateLocally: Array<{ pageIndex: number; blocks: TranslationBlock[] }> = [];
    for (const row of (data ?? []) as Array<{ page_index: number; blocks: unknown; updated_at?: string | null }>) {
      if (
        typeof row.page_index === 'number' &&
        !merged.has(row.page_index) &&
        isValidCachedBlockList(row.blocks) &&
        shouldAcceptRemoteTranslation(chapterId, lang, row.updated_at)
      ) {
        merged.set(row.page_index, row.blocks);
        toHydrateLocally.push({ pageIndex: row.page_index, blocks: row.blocks });
      }
    }

    if (toHydrateLocally.length > 0) {
      await putLocalChapterTranslationsBatch(chapterId, lang, toHydrateLocally);
    }
  } catch {
    // Ağ hatasında yerel IndexedDB önbelleğiyle kesintisiz devam et
  }

  return merged;
};

// Her çevrilen sayfayı anında yerel IndexedDB'ye (F5 ve çevrimdışı için %100 kalıcı),
// oturum açıksa ayrıca Supabase ortak önbelleğine yazar.
export const upsertPageTranslation = async (
  chapterId: string,
  pageIndex: number,
  lang: string,
  blocks: TranslationBlock[],
  options?: { networkEnabled?: boolean },
): Promise<void> => {
  await putLocalPageTranslation(chapterId, pageIndex, lang, blocks);

  if (options?.networkEnabled === false || translationTableUnavailable) return;

  try {
    const { error } = await supabase
      .from('page_translations')
      .upsert(
        {
          chapter_id: chapterId,
          page_index: pageIndex,
          lang,
          blocks,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'chapter_id,page_index,lang' },
      );

    if (error) {
      if (isMissingTableError(error)) {
        translationTableUnavailable = true;
        return;
      }
      if (isIgnorableWriteAuthError(error)) {
        return;
      }
    }
  } catch {
    // Yerel IndexedDB yazımı zaten başarılı olduğu için çeviri kaybolmaz
  }
};

// Çevrimdışı bölüm indirilirken mevcut çevirileri yerel IndexedDB'ye eşitler.
export const syncChapterTranslationsForOffline = async (
  chapterId: string,
  lang?: string,
): Promise<void> => {
  const targetLang = lang || loadTranslationSettings().targetLang || 'tr';
  if (!chapterId || !targetLang) return;
  await getCachedChapterTranslations(chapterId, targetLang, { networkEnabled: true });
};
