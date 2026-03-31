const normalizeText = (value?: string | null) => value?.replace(/\s+/g, ' ').trim() || '';
const normalizeKey = (value?: string | null) => normalizeText(value).toLocaleLowerCase('tr-TR');

export const getMangaRelationTypeLabel = (relationType?: string | null) => {
  const normalized = normalizeKey(relationType).replace(/_/g, ' ');

  switch (normalized) {
    case 'related':
      return 'İlgili Seri';
    case 'sequel':
      return 'Devam Serisi';
    case 'prequel':
      return 'Öncesi';
    case 'spinoff':
    case 'spin off':
      return 'Yan Seri';
    case 'side story':
      return 'Yan Hikaye';
    case 'adaptation':
      return 'Uyarlama';
    case 'adapted from':
      return 'Uyarlama Kaynağı';
    case 'alternative version':
      return 'Alternatif Versiyon';
    case 'parent story':
      return 'Ana Hikaye';
    case 'summary':
      return 'Özet';
    case 'full story':
      return 'Tam Hikaye';
    default:
      return normalizeText(relationType).replace(/_/g, ' ') || 'İlgili Seri';
  }
};
