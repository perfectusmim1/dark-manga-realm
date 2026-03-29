// Available genres for filtering/selection
export const allGenres = [
  'Aksiyon',
  'Macera',
  'Komedi',
  'Dram',
  'Fantastik',
  'Korku',
  'Gizem',
  'Romantik',
  'Bilim Kurgu',
  'Gündelik Yaşam',
  'Spor',
  'Doğaüstü',
  'Gerilim',
  'Tarihî',
  'Psikolojik',
  'Okul Hayatı',
  'Shounen',
  'Shoujo',
  'Seinen',
  'Josei',
  'Isekai',
  'Dövüş Sanatları',
  'Müzik',
  'Reenkarnasyon',
  'Modern Yaşam',
  'Webtoon',
  'Manhwa',
  'Manhua',
  'Büyü',
  'Canavar',
  'Oyun',
  'Sistem',
  'Yetişim',
  'Ecchi',
  'Harem',
  'Ters Harem',
  'Trajedi',
  'Ofis',
  'Olgun',
  'Suç',
  'Tıbbi',
  'Askerî',
  'Polisiye',
  'Dedektif',
  'Yemek',
  'Yetişkin',
  'Final',
  'Roman Uyarlaması',
  'Aile',
  'Akademi',
  'Aşk Üçgeni',
  'Anti Kahraman',
  'Asalet',
  'Beden Değişimi',
  'BL',
  'GL',
  'Çocuk Bakımı',
  'Distopya',
  'Hayatta Kalma',
  'İntikam',
  'Kıyamet Sonrası',
  'Krallık Kurma',
  'Kule',
  'Meka',
  'Mitoloji',
  'Murim',
  'Parodi',
  'Politika',
  'Post-Apokaliptik',
  'Ruhlar',
  'Sanal Gerçeklik',
  'Şifa',
  'Üniversite',
  'Uzay',
  'Vampir',
  'Zaman Döngüsü',
  'Zaman Yolculuğu',
  'Zindan',
  'Zombi',
];

const genreAliasMap: Record<string, string> = {
  action: 'Aksiyon',
  adventure: 'Macera',
  comedy: 'Komedi',
  drama: 'Dram',
  fantasy: 'Fantastik',
  horror: 'Korku',
  mystery: 'Gizem',
  romance: 'Romantik',
  romantic: 'Romantik',
  'sci-fi': 'Bilim Kurgu',
  'sci fi': 'Bilim Kurgu',
  'science fiction': 'Bilim Kurgu',
  'bilim-kurgu': 'Bilim Kurgu',
  'slice of life': 'Gündelik Yaşam',
  'supernatural': 'Doğaüstü',
  'doğa üstü': 'Doğaüstü',
  sports: 'Spor',
  thriller: 'Gerilim',
  historical: 'Tarihî',
  tarihi: 'Tarihî',
  psychological: 'Psikolojik',
  school: 'Okul Hayatı',
  'school life': 'Okul Hayatı',
  shounen: 'Shounen',
  shonen: 'Shounen',
  sounen: 'Shounen',
  'şounen': 'Shounen',
  shoujo: 'Shoujo',
  shojo: 'Shoujo',
  soujo: 'Shoujo',
  'şoujo': 'Shoujo',
  seinen: 'Seinen',
  josei: 'Josei',
  isekai: 'Isekai',
  'martial arts': 'Dövüş Sanatları',
  music: 'Müzik',
  reincarnation: 'Reenkarnasyon',
  'modern life': 'Modern Yaşam',
  'modern hayat': 'Modern Yaşam',
  magic: 'Büyü',
  monster: 'Canavar',
  monsters: 'Canavar',
  game: 'Oyun',
  gaming: 'Oyun',
  system: 'Sistem',
  cultivation: 'Yetişim',
  ecchi: 'Ecchi',
  harem: 'Harem',
  'reverse harem': 'Ters Harem',
  tragedy: 'Trajedi',
  office: 'Ofis',
  mature: 'Olgun',
  crime: 'Suç',
  medical: 'Tıbbi',
  military: 'Askerî',
  police: 'Polisiye',
  detective: 'Dedektif',
  food: 'Yemek',
  adult: 'Yetişkin',
  novel: 'Roman Uyarlaması',
  webtoon: 'Webtoon',
  manhwa: 'Manhwa',
  manhua: 'Manhua',
  family: 'Aile',
  academy: 'Akademi',
  'love triangle': 'Aşk Üçgeni',
  'anti hero': 'Anti Kahraman',
  nobility: 'Asalet',
  'body swap': 'Beden Değişimi',
  'boys love': 'BL',
  'girls love': 'GL',
  childcare: 'Çocuk Bakımı',
  dystopia: 'Distopya',
  survival: 'Hayatta Kalma',
  revenge: 'İntikam',
  'post-apocalyptic': 'Post-Apokaliptik',
  apocalyptic: 'Kıyamet Sonrası',
  kingdom: 'Krallık Kurma',
  tower: 'Kule',
  mecha: 'Meka',
  mythology: 'Mitoloji',
  parody: 'Parodi',
  politics: 'Politika',
  spirits: 'Ruhlar',
  'virtual reality': 'Sanal Gerçeklik',
  healing: 'Şifa',
  university: 'Üniversite',
  space: 'Uzay',
  vampire: 'Vampir',
  'time loop': 'Zaman Döngüsü',
  'time travel': 'Zaman Yolculuğu',
  dungeon: 'Zindan',
  zombie: 'Zombi',
  final: 'Final',
};

const toGenreKey = (value: string) =>
  value
    .trim()
    .toLocaleLowerCase('tr-TR')
    .replace(/\s+/g, ' ');

export const normalizeGenreName = (genre: string): string => {
  const trimmed = genre.trim();
  if (!trimmed) {
    return '';
  }

  const alias = genreAliasMap[toGenreKey(trimmed)];
  if (alias) {
    return alias;
  }

  const canonical = allGenres.find((item) => toGenreKey(item) === toGenreKey(trimmed));
  return canonical || trimmed;
};

export const normalizeGenres = (genres?: readonly string[] | null): string[] => {
  if (!genres || genres.length === 0) {
    return [];
  }

  return Array.from(
    new Set(
      genres
        .map((genre) => normalizeGenreName(genre))
        .filter((genre) => genre.length > 0)
    )
  );
};

// Initialize database on import (no mock data)
export const initializeMockData = (): void => {
  // Supabase-backed app; no mock bootstrap work is needed here.
};
