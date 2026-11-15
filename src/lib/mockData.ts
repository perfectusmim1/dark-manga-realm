// Available genres for filtering/selection
import { getTagDisplayName } from './tagTranslations';

export const allGenres = [
  'Aksiyon',
  'Macera',
  'Komedi',
  'Dram',
  'Fantastik',
  'Korku',
  'Gizem',
  'Romantizm',
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
  romance: 'Romantizm',
  romantic: 'Romantizm',
  romantik: 'Romantizm',
  romantizm: 'Romantizm',
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
  'tarihî': 'Tarihî',
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
  hentai: 'Yetişkin',
  pornhwa: 'Yetişkin',
  'webtoon hentai': 'Yetişkin',
  'hentai webtoon': 'Yetişkin',
  'adult webtoon': 'Yetişkin',
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
  violence: 'Şiddet',
  overpowered: 'Aşırı Güçlü',
  'aşırı güçlü': 'Aşırı Güçlü',
  'asiri guclu': 'Aşırı Güçlü',
  'full color': 'Tam Renkli',
  'full-color': 'Tam Renkli',
  oneshot: 'Tek Bölüm',
  'one-shot': 'Tek Bölüm',
  'one shot': 'Tek Bölüm',
  'gender bender': 'Cinsiyet Değişimi',
  'gender-bender': 'Cinsiyet Değişimi',
  'gender bending': 'Cinsiyet Değişimi',
  'gender-bending': 'Cinsiyet Değişimi',
  'monster girl': 'Canavar Kız',
  'monster-girl': 'Canavar Kız',
  'monster boy': 'Canavar Erkek',
  'monster-boy': 'Canavar Erkek',
  'anti-hero': 'Anti-Kahraman',
  'e-sports': 'E-Spor',
  'long strip': 'Uzun Şerit',
  'long-strip': 'Uzun Şerit',
  pov: 'POV',
  cheat: 'Aldatma',
  cheating: 'Aldatma',
  incest: 'Akraba İlişkisi',
  rape: 'Rızasız İlişki',
  nudity: 'Çıplaklık',
  drugs: 'Uyuşturucu',
  suicide: 'İntihar',
  torture: 'İşkence',
  blackmail: 'Şantaj',
  slavery: 'Kölelik',
  amputation: 'Ampüte',
  pregnancy: 'Hamilelik',
  pregnant: 'Hamile',
  teacher: 'Öğretmen',
  maids: 'Hizmetçiler',
  demon: 'İblis',
  demons: 'İblis',
  iblis: 'İblis',
  iblisler: 'İblis',
  ghost: 'Hayalet',
  angels: 'Melekler',
  animals: 'Hayvanlar',
  aliens: 'Uzaylılar',
  gods: 'Tanrılar',
  fairy: 'Peri',
  mermaid: 'Deniz Kızı',
  werewolf: 'Kurtadam',
  witch: 'Cadı',
  work: 'İş Hayatı',
  travel: 'Seyahat',
  'family life': 'Aile Hayatı',
  'family-life': 'Aile Hayatı',
  marriage: 'Evlilik',
  'arranged marriage': 'Düzenlenmiş Evlilik',
  'fake relationship': 'Sahte İlişki',
  'unrequited love': 'Karşılıksız Aşk',
  'coming of age': 'Büyüme Hikâyesi',
  bullying: 'Zorbalık',
  amnesia: 'Hafıza Kaybı',
  'alternate universe': 'Alternatif Evren',
  'body swapping': 'Beden Değişimi',
  crossdressing: 'Karşı Cins Kıyafeti',
  femdom: 'Kadın Egemenliği',
  'group sex': 'Grup Seks',
  handjob: 'El İşi',
  masturbation: 'Mastürbasyon',
  defloration: 'Kızlık Bozma',
  exhibitionism: 'Teşhircilik',
  'large breasts': 'Büyük Göğüsler',
  'sex toys': 'Seks Oyuncakları',
  virginity: 'İlk Kez',
  tentacles: 'Tentakül',
  prostitution: 'Fahişelik',
  'public sex': 'Halka Açık Alan',
  lactation: 'Emzirme',
  sweat: 'Terleme',
  feet: 'Ayak',
  armpits: 'Koltuk Altı',
  bisexual: 'Biseksüel',
  heterosexual: 'Heteroseksüel',
  shapeshifting: 'Şekil Değiştirme',
  necromancy: 'Nekromansi',
  'time manipulation': 'Zaman Manipülasyonu',
  'memory manipulation': 'Hafıza Manipülasyonu',
  'age gap': 'Yaş Farkı',
  adopted: 'Evlat Edinme',
  adoption: 'Evlat Edinme',
  assassins: 'Suikastçılar',
  samurai: 'Samuray',
  pirates: 'Korsanlar',
  college: 'Üniversite',
  'boarding school': 'Yatılı Okul',
  'school club': 'Okul Kulübü',
  'office lady': 'Ofis Kadını',
  butler: 'Uşak',
  nun: 'Rahibe',
  mafia: 'Mafya',
  gangs: 'Çeteler',
  cyberpunk: 'Siberpunk',
  steampunk: 'Buharpunk',
  dystopian: 'Distopya',
  'super power': 'Süper Güç',
  superhero: 'Süper Kahraman',
  'video games': 'Video Oyunları',
  gambling: 'Kumar',
  'card battle': 'Kart Savaşı',
  'kingdom management': 'Krallık Yönetimi',
  'reverse isekai': 'Ters Isekai',
  'urban fantasy': 'Kentsel Fantazi',
  'dark fantasy': 'Karanlık Fantezi',
  'male protagonist': 'Erkek Başrol',
  'female protagonist': 'Kadın Başrol',
  'female harem': 'Kadın Harem',
  'male harem': 'Erkek Harem',
  uncensored: 'Sansürsüz',
  medicine: 'Tıbbi',
  'bilim kurgu': 'Bilim Kurgu',
  'dövüş sanatları': 'Dövüş Sanatları',
  'dovus sanatlari': 'Dövüş Sanatları',
  'yaş farkı': 'Yaş Farkı',
  'yas farki': 'Yaş Farkı',
  'tek eşli': 'Tek Eşli',
  'tek esli': 'Tek Eşli',
  güncel: 'Güncel',
  guncel: 'Güncel',
  intikam: 'İntikam',
  i̇ntikam: 'İntikam',
  makine: 'Makine',
  reankarnasyon: 'Reenkarnasyon',
  reenkarnasyon: 'Reenkarnasyon',
  'büyükler için': 'Büyükler İçin',
  'buyukler icin': 'Büyükler İçin',
  'doga ustu': 'Doğaüstü',
  i̇sekai: 'Isekai',
  askeri: 'Askerî',
  '4-koma': '4-Koma',
};

const toGenreKey = (value: string) =>
  value
    .trim()
    .replace(/\u0130|I\u0307/g, 'i')
    .replace(/I/g, 'ı')
    .toLowerCase()
    .replace(/\s+/g, ' ');

const canonicalGenreByKey = new Map<string, string>();
for (const canonical of allGenres) {
  canonicalGenreByKey.set(toGenreKey(canonical), canonical);
}
for (const [aliasKey, canonical] of Object.entries(genreAliasMap)) {
  canonicalGenreByKey.set(toGenreKey(aliasKey), canonical);
}

const GENRE_MEMO_LIMIT = 4096;
const normalizedGenreCache = new Map<string, string>();
const formattedGenreCache = new Map<string, string>();
const knownGenreCache = new Map<string, boolean>();

const setBoundedCache = <K, V>(cache: Map<K, V>, key: K, value: V) => {
  if (cache.size >= GENRE_MEMO_LIMIT) {
    cache.clear();
  }
  cache.set(key, value);
};

const BLOCKED_GENRE_KEYS = new Set([
  'bl',
  'gl',
  'boys love',
  "boys' love",
  'girls love',
  "girls' love",
  'yaoi',
  'yuri',
  'shounen ai',
  'shoujo ai',
  'soft yuri',
]);

const ADULT_MARKER_GENRE_PATTERNS = [
  /\b18\+\b/i,
  /b[üu]y[üu]kler i[cç]in/i,
  /\badult\b/i,
  /\berotik\b/i,
];

export const normalizeGenreName = (genre: string): string => {
  const trimmed = genre.trim();
  if (!trimmed) {
    return '';
  }

  const cached = normalizedGenreCache.get(trimmed);
  if (cached !== undefined) {
    return cached;
  }

  const key = toGenreKey(trimmed);
  let resolved = trimmed;
  if (BLOCKED_GENRE_KEYS.has(key)) {
    resolved = '';
  } else {
    resolved = canonicalGenreByKey.get(key) || trimmed;
  }

  setBoundedCache(normalizedGenreCache, trimmed, resolved);
  return resolved;
};

const decodeBasicGenreEntities = (value: string): string =>
  value
    .replace(/&#0*39;|&#x0*27;|&apos;/gi, "'")
    .replace(/&quot;|&#0*34;|&#x0*22;/gi, '"')
    .replace(/&amp;|&#0*38;|&#x0*26;/gi, '&');

export const formatGenreDisplayName = (genre?: string | null): string => {
  if (!genre) {
    return '';
  }

  const cached = formattedGenreCache.get(genre);
  if (cached !== undefined) {
    return cached;
  }

  const decoded = decodeBasicGenreEntities(genre).replace(/\s+/g, ' ').trim();
  let resolved = '';
  if (decoded) {
    const normalized = normalizeGenreName(decoded);
    if (normalized && normalized !== decoded) {
      resolved = normalized;
    } else {
      const translated = getTagDisplayName(decoded, decoded);
      resolved = genreAliasMap[toGenreKey(translated)] || translated;
    }
  }

  setBoundedCache(formattedGenreCache, genre, resolved);
  return resolved;
};

export const formatMangaStatusLabel = (status?: string | null): string => {
  const raw = status ? status.trim() : '';
  if (!raw) {
    return 'Belirsiz';
  }
  const key = toGenreKey(raw);
  switch (key) {
    case 'ongoing':
    case 'devam ediyor':
      return 'Devam Ediyor';
    case 'completed':
    case 'tamamlandı':
    case 'tamamlandi':
      return 'Tamamlandı';
    case 'hiatus':
    case 'on hold':
    case 'ara verdi':
      return 'Ara Verdi';
    case 'cancelled':
    case 'canceled':
    case 'iptal edildi':
      return 'İptal Edildi';
    default:
      return raw;
  }
};

export const isKnownGenre = (genre: string): boolean => {
  const trimmed = genre.trim();
  if (!trimmed) {
    return false;
  }

  const cached = knownGenreCache.get(trimmed);
  if (cached !== undefined) {
    return cached;
  }

  const known = canonicalGenreByKey.has(toGenreKey(trimmed));
  setBoundedCache(knownGenreCache, trimmed, known);
  return known;
};

export const isAdultMarkerGenre = (genre: string): boolean =>
  ADULT_MARKER_GENRE_PATTERNS.some((pattern) => pattern.test(genre.trim()));

export const filterRecognizedGenres = (genres?: readonly string[] | null): string[] => {
  if (!genres || genres.length === 0) {
    return [];
  }

  return normalizeGenres(
    genres.filter((genre) => {
      const trimmed = genre.trim();
      return trimmed.length > 0 && (isKnownGenre(trimmed) || isAdultMarkerGenre(trimmed));
    }),
  );
};

export const normalizeGenres = (genres?: readonly string[] | null): string[] => {
  if (!genres || genres.length === 0) {
    return [];
  }

  const seen = new Set<string>();
  const result: string[] = [];

  for (const genre of genres) {
    const normalized = normalizeGenreName(genre);
    if (!normalized) continue;
    const key = toGenreKey(normalized);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
  }

  return result;
};

// Initialize database on import (no mock data)
export const initializeMockData = (): void => {
  // Supabase-backed app; no mock bootstrap work is needed here.
};
