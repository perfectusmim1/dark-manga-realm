import { supabase } from '@/lib/supabase';
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

// Bölümün seçili dildeki tüm sayfa çevirilerini tek sorguda getirir.
export const getCachedChapterTranslations = async (
  chapterId: string,
  lang: string,
): Promise<Map<number, TranslationBlock[]>> => {
  if (translationTableUnavailable) return new Map();

  const { data, error } = await supabase
    .from('page_translations')
    .select('page_index, blocks')
    .eq('chapter_id', chapterId)
    .eq('lang', lang);

  if (error) {
    if (isMissingTableError(error)) {
      translationTableUnavailable = true;
      return new Map();
    }
    throw error;
  }

  const result = new Map<number, TranslationBlock[]>();
  ((data ?? []) as Array<{ page_index: number; blocks: unknown }>).forEach((row) => {
    if (typeof row.page_index === 'number' && Array.isArray(row.blocks)) {
      result.set(row.page_index, row.blocks as unknown as TranslationBlock[]);
    }
  });
  return result;
};

// "Yeniden Çevir" dahil tüm yazmalar aynı tekil anahtara upsert eder.
export const upsertPageTranslation = async (
  chapterId: string,
  pageIndex: number,
  lang: string,
  blocks: TranslationBlock[],
): Promise<void> => {
  if (translationTableUnavailable) return;

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
    throw error;
  }
};
