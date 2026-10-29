import { supabase } from '@/lib/supabase';
import { TranslationBlock } from './types';

// Bölümün seçili dildeki tüm sayfa çevirilerini tek sorguda getirir.
export const getCachedChapterTranslations = async (
  chapterId: string,
  lang: string,
): Promise<Map<number, TranslationBlock[]>> => {
  const { data, error } = await supabase
    .from('page_translations')
    .select('page_index, blocks')
    .eq('chapter_id', chapterId)
    .eq('lang', lang);

  if (error) throw error;

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

  if (error) throw error;
};
