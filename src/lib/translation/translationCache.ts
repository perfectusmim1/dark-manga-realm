import { supabase } from '@/lib/supabase';
import { TRANSLATION_BLOCK_VERSION } from './bubbleInpainter';
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

const isValidCachedBlockList = (rawBlocks: unknown): rawBlocks is TranslationBlock[] => {
  if (!Array.isArray(rawBlocks)) return false;
  if (rawBlocks.length === 0) return true;
  return rawBlocks.every((entry) => {
    if (!entry || typeof entry !== 'object') return false;
    const b = entry as Partial<TranslationBlock>;
    return (
      b.v === TRANSLATION_BLOCK_VERSION &&
      Array.isArray(b.box) &&
      b.box.length === 4 &&
      Array.isArray(b.patchBox) &&
      b.patchBox.length === 4 &&
      typeof b.patchDataUrl === 'string' &&
      b.patchDataUrl.startsWith('data:image/')
    );
  });
};

// Bölümün seçili dildeki tüm sayfa çevirilerini tek sorguda getirir.
// Eski v1 (gri oval) önbellek kayıtlarını otomatik eler ki v2 piksel-inpaint motoruyla yenilensin.
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
    if (typeof row.page_index === 'number' && isValidCachedBlockList(row.blocks)) {
      result.set(row.page_index, row.blocks);
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
