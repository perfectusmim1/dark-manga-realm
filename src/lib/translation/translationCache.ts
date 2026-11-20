import {
  getLocalChapterTranslations,
  putLocalPageTranslation,
} from './localTranslationCache';
import { TranslationBlock } from './types';

// Bölümün seçili dildeki çevirilerini yalnızca yerel tarayıcı IndexedDB önbelleğinden getirir.
// Supabase Free depolama/egress kotasını tüketmemek için uzak veritabanına okuma/yazma yapılmaz.
export const getCachedChapterTranslations = async (
  chapterId: string,
  lang: string,
  _options?: { networkEnabled?: boolean },
): Promise<Map<number, TranslationBlock[]>> => {
  return getLocalChapterTranslations(chapterId, lang);
};

// Her çevrilen sayfayı yalnızca yerel tarayıcı IndexedDB'sine (F5 ve çevrimdışı için kalıcı) yazar.
export const upsertPageTranslation = async (
  chapterId: string,
  pageIndex: number,
  lang: string,
  blocks: TranslationBlock[],
  _options?: { networkEnabled?: boolean },
): Promise<void> => {
  await putLocalPageTranslation(chapterId, pageIndex, lang, blocks);
};

// Çeviriler zaten yerel IndexedDB'de saklandığı için ek ağ eşitlemesi gerekmez.
export const syncChapterTranslationsForOffline = async (
  _chapterId: string,
  _lang?: string,
): Promise<void> => {
  // No-op: tüm çeviriler zaten yerel IndexedDB'de kalıcı olarak tutulur.
};
