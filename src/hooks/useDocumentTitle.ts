import { useEffect } from 'react';

/**
 * Tarayıcı sekme başlığını (document.title) dinamik olarak günceller.
 * @param title Sayfa özel başlığı (örn: "Solo Leveling", "Bölüm 26", "Keşfet")
 * @param preserveBase Sonuna " | ToonParrot" eklenip eklenmeyeceği (varsayılan: true)
 */
export const useDocumentTitle = (title?: string | null, preserveBase = true) => {
  useEffect(() => {
    const base = 'ToonParrot';
    if (!title || !title.trim()) {
      document.title = base;
      return;
    }

    const trimmed = title.trim();
    document.title = preserveBase ? `${trimmed} | ${base}` : trimmed;

    return () => {
      document.title = base;
    };
  }, [title, preserveBase]);
};

export default useDocumentTitle;
