const normalizeText = (value?: string | null) => value?.replace(/\s+/g, ' ').trim() || '';
const normalizeKey = (value?: string | null) =>
  normalizeText(value)
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase('tr-TR');

const toTitleCaseFallback = (value: string) =>
  value
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .map((word) => word.charAt(0).toLocaleUpperCase('tr-TR') + word.slice(1).toLocaleLowerCase('tr-TR'))
    .join(' ');

export const getMangaRelationTypeLabel = (relationType?: string | null) => {
  const normalized = normalizeKey(relationType);

  switch (normalized) {
    case 'read first':
    case 'first':
    case 'read before':
      return 'Önce Okunmalı';
    case 'related':
    case 'other':
      return 'Bağlantılı Seri';
    case 'sequel':
      return 'Devam Serisi';
    case 'prequel':
      return 'Ön Hikaye';
    case 'spinoff':
    case 'spin off':
      return 'Yan Seri';
    case 'side story':
      return 'Yan Hikaye';
    case 'adaptation':
      return 'Uyarlama';
    case 'adapted from':
      return 'Uyarlama Kaynağı';
    case 'alternative':
    case 'alternate':
    case 'alternative version':
    case 'alternate story':
      return 'Alternatif Hikaye';
    case 'alternative setting':
      return 'Alternatif Evren';
    case 'shared universe':
    case 'same franchise':
      return 'Ortak Evren';
    case 'parent story':
    case 'main story':
    case 'parent':
      return 'Ana Hikaye';
    case 'character':
      return 'Ortak Karakter';
    case 'colored':
      return 'Renkli Versiyon';
    case 'serialization':
      return 'Serileştirme';
    case 'doujinshi':
      return 'Doujinshi';
    case 'one shot':
    case 'oneshot':
      return 'Tek Bölüm';
    case 'summary':
      return 'Özet';
    case 'full story':
      return 'Tam Hikaye';
    default:
      return toTitleCaseFallback(normalizeText(relationType)) || 'Bağlantılı Seri';
  }
};
