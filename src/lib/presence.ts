// Aktif okuma oturumundaki seri kimliğini tutar (ekstra ağ isteği veya polling başlatmadan kalp atışına eklenir)
let activePresenceMangaId: string | null = null;

export const setActivePresenceMangaId = (mangaId: string | null) => {
  activePresenceMangaId = typeof mangaId === 'string' && mangaId.trim() ? mangaId.trim() : null;
};

export const getActivePresenceMangaId = (): string | null => activePresenceMangaId;
