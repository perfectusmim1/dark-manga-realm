import {
  addTagToEntity,
  createTag,
  findArtistByName,
  findAuthorByName,
  findCharacterByName,
  getAllTags,
  getMangaById,
  getMangaCharacters,
  getMangaSummaries,
  getTagsForEntity,
  linkMangaToArtist,
  linkMangaToAuthor,
  linkMangaToCharacter,
  replaceMangaRelatedSeries,
  saveArtist,
  saveAuthor,
  saveCharacter,
  saveManga,
  updateArtistMedia,
  updateAuthorMedia,
  updateCharacterMedia,
} from '@/lib/database';
import { OFFICIAL_TAG_CATALOG } from '@/lib/officialTagCatalog';
import { slugifyCatalogTagName, OFFICIAL_TAG_CATALOG } from '@/lib/officialTagCatalog';
import { fetchScraperArrayBuffer, fetchScraperContent } from '@/lib/scraperProxy';
import {
  buildMaterializedGalleryObjectKey,
  materializeRemoteImage,
  materializeRemoteImages,
} from '@/lib/mediaStorage';
import {
  Artist,
  Author,
  Character,
  EntityGalleryImage,
  EntityMetadata,
  ExternalSourceLink,
  ExternalSourceName,
  Manga,
  MangaRelation,
} from '@/lib/types';
import {
  getCharacterListingRoleLabel,
  normalizeCharacterListingRole,
  type CharacterListingRole,
} from '@/lib/characterRoles';
import { sanitizeCharacterDescription } from '@/lib/descriptionSanitizers';
import { sanitizeEntityImageUrl } from '@/lib/entityImages';

export type MetadataImportSource = 'anisearch' | 'myanimelist' | 'mangaupdates' | 'animeplanet';

export type ImportOptionKey =
  | 'manga_core'
  | 'alternative_titles'
  | 'tags'
  | 'related_series'
  | 'authors'
  | 'artists'
  | 'characters'
  | 'gallery';

export interface SourceSearchCandidate {
  id: string;
  source: MetadataImportSource;
  title: string;
  subtitle?: string;
  url: string;
  imageUrl?: string;
}

export interface ImportedPersonDraft {
  name: string;
  imageUrl?: string;
  description?: string;
  alternativeNames: string[];
  details: EntityMetadata;
  gallery: EntityGalleryImage[];
  sourceLinks: ExternalSourceLink[];
  sourceUrl?: string;
}

export interface ImportedCharacterDraft extends ImportedPersonDraft {
  roleLabel?: string;
  roleType?: CharacterListingRole;
}

export interface ImportedRelatedSeriesDraft {
  title: string;
  relationType: string;
  sourceUrl?: string;
  cover?: string;
}

export interface TagMatchResult {
  sourceTag: string;
  matchedTag?: { id: string; name: string };
  isMatched: boolean;
  isStandardGenre?: boolean;
  genreMatchName?: string;
}

export interface ImportedMangaPayload {
  source: MetadataImportSource;
  sourceId?: string;
  sourceUrl: string;
  sourceTitle: string;
  cover?: string;
  banner?: string;
  description?: string;
  alternativeTitles: string[];
  genres: string[];
  tags: string[];
  gallery: EntityGalleryImage[];
  details: EntityMetadata;
  relatedSeries: ImportedRelatedSeriesDraft[];
  authors: ImportedPersonDraft[];
  artists: ImportedPersonDraft[];
  characters: ImportedCharacterDraft[];
  warnings: string[];
  tagMatches?: TagMatchResult[];
}

export interface ImportSelectionOptions {
  enabledOptions: Partial<Record<ImportOptionKey, boolean>>;
  importAsPublic: boolean;
  translateToTurkish?: boolean;
}

type SupportMatrix = Record<ImportOptionKey, boolean>;

export const SOURCE_OPTION_SUPPORT: Record<MetadataImportSource, SupportMatrix> = {
  anisearch: {
    manga_core: true,
    alternative_titles: true,
    tags: true,
    related_series: true,
    authors: true,
    artists: true,
    characters: true,
    gallery: false,
  },
  myanimelist: {
    manga_core: true,
    alternative_titles: true,
    tags: true,
    related_series: true,
    authors: true,
    artists: true,
    characters: true,
    gallery: true,
  },
  mangaupdates: {
    manga_core: true,
    alternative_titles: true,
    tags: true,
    related_series: true,
    authors: true,
    artists: true,
    characters: false,
    gallery: false,
  },
  animeplanet: {
    manga_core: true,
    alternative_titles: true,
    tags: true,
    related_series: true,
    authors: true,
    artists: true,
    characters: true,
    gallery: false,
  },
};

export const SOURCE_RUNTIME_WARNINGS: Partial<Record<MetadataImportSource, string>> = {};

const MAL_HOST_PATTERN = /^https?:\/\/(?:www\.)?myanimelist\.net\//i;
const MANGA_UPDATES_HOST_PATTERN = /^https?:\/\/(?:www\.)?mangaupdates\.com\//i;
const ANISEARCH_HOST_PATTERN = /^https?:\/\/(?:www\.)?anisearch\.com\//i;
const ANIME_PLANET_HOST_PATTERN = /^https?:\/\/(?:www\.)?anime-planet\.com\//i;
const ANISEARCH_BASE_URL = 'https://www.anisearch.com';
const ANISEARCH_SITEMAP_INDEX_URL = `${ANISEARCH_BASE_URL}/sitemap.xml`;
const ANIME_PLANET_BASE_URL = 'https://www.anime-planet.com';

const MAL_REQUEST_DELAY_MS = 650;
const MAX_IMPORT_ENTITY_COUNT = 200;
const ANISEARCH_SEARCH_RESULT_LIMIT = 8;

const normalizeText = (value?: string | null) => value?.replace(/\s+/g, ' ').trim() || '';

const normalizeKey = (value?: string | null) => normalizeText(value).toLocaleLowerCase('tr-TR');

const uniqueStrings = (values: Array<string | null | undefined>) => {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const normalized = normalizeText(value);
    const key = normalizeKey(normalized);
    if (!key || seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(normalized);
  }

  return result;
};

const uniqueByUrl = <T extends { url?: string; sourceUrl?: string }>(items: T[]) => {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = normalizeText(item.sourceUrl || item.url);
    if (!key || seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
};

const mergeStringLists = (...lists: Array<Array<string | null | undefined> | undefined>) =>
  uniqueStrings(lists.flatMap((list) => list || []));

const mergeSourceLinks = (...lists: Array<ExternalSourceLink[] | undefined>) =>
  uniqueByUrl(
    lists
      .flatMap((list) => list || [])
      .filter((item) => normalizeText(item.url))
      .map((item) => ({
        ...item,
        url: normalizeText(item.url),
        label: normalizeText(item.label) || undefined,
        kind: normalizeText(item.kind) || undefined,
      })),
  );

const mergeGallery = (...lists: Array<EntityGalleryImage[] | undefined>) =>
  uniqueByUrl(
    lists
      .flatMap((list) => list || [])
      .filter((item) => normalizeText(item.url))
      .map((item) => ({
        ...item,
        url: normalizeText(item.url),
        thumbUrl: normalizeText(item.thumbUrl) || undefined,
        label: normalizeText(item.label) || undefined,
        sourceUrl: normalizeText(item.sourceUrl) || undefined,
      })),
  );

const mergeMetadata = (base?: EntityMetadata, incoming?: EntityMetadata): EntityMetadata => ({
  ...(base || {}),
  ...(incoming || {}),
  affiliation: mergeStringLists(base?.affiliation, incoming?.affiliation),
  relatives: mergeStringLists(base?.relatives, incoming?.relatives),
  officialTranslations: mergeStringLists(base?.officialTranslations, incoming?.officialTranslations),
  originalWebtoon: mergeStringLists(base?.originalWebtoon, incoming?.originalWebtoon),
  genres: mergeStringLists(base?.genres, incoming?.genres),
  tags: mergeStringLists(base?.tags, incoming?.tags),
  extra: {
    ...(base?.extra || {}),
    ...(incoming?.extra || {}),
  },
});

const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

const BLOCKED_GENRE_OR_TAG_KEYS = new Set([
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

const GENRE_ALIAS_MAP: Record<string, string[]> = {
  'Aksiyon': ['action'],
  'Macera': ['adventure'],
  'Komedi': ['comedy'],
  'Dram': ['drama'],
  'Fantastik': ['fantasy', 'fantezi'],
  'Korku': ['horror'],
  'Gizem': ['mystery'],
  'Psikolojik': ['psychological'],
  'Romantik': ['romance', 'romantic'],
  'Bilim Kurgu': ['sci-fi', 'science fiction', 'scifi'],
  'Gündelik Yaşam': ['slice of life', 'günlük hayat', 'günlük yaşam'],
  'Spor': ['sports', 'sport'],
  'Doğaüstü': ['supernatural'],
  'Gerilim': ['thriller', 'suspense'],
  'Ecchi': ['ecchi'],
  'Harem': ['harem'],
  'Ters Harem': ['reverse harem'],
  'Isekai': ['isekai'],
  'Meka': ['mecha', 'meka'],
  'Müzik': ['music'],
  'Okul Hayatı': ['school', 'school life', 'okul'],
  'Shounen': ['shounen', 'shonen', 'shōnen'],
  'Shoujo': ['shoujo', 'shojo', 'shōjo'],
  'Seinen': ['seinen'],
  'Josei': ['josei'],
  'Tarihî': ['historical', 'tarihi'],
  'Askerî': ['military', 'askeri'],
  'Polisiye': ['police', 'detective', 'dedektif'],
  'Uzay': ['space'],
  'Vampir': ['vampire'],
  'Dövüş Sanatları': ['martial arts'],
  'İblis': ['demons', 'demon'],
  'Oyun': ['game', 'video game'],
  'Büyü': ['magic', 'sihir'],
  'Süper Güç': ['super power', 'superpower', 'superpowers', 'powers'],
  'Samuray': ['samurai'],
  'Parodi': ['parody'],
  'Yetişkin': ['adult', 'smut', 'mature', '18+', 'sexual content'],
  'Trajedi': ['tragedy'],
  'Reenkarnasyon': ['reincarnation', 'reenkarne'],
  'İntikam': ['revenge'],
  'Hayatta Kalma': ['survival', 'survival game'],
  'Suç': ['crime'],
  'Webtoon': ['webtoon', 'long strip'],
  'Manhwa': ['manhwa'],
  'Manhua': ['manhua'],
  'Roman Uyarlaması': ['adaptation', 'adapted from a novel'],
  'Zaman Yolculuğu': ['time travel'],
  'Zaman Döngüsü': ['time loop'],
  'Sanal Gerçeklik': ['virtual reality', 'vr'],
  'Kıyamet Sonrası': ['post apocalyptic', 'post-apocalyptic'],
  'Sistem': ['system', 'game system'],
  'Zindan': ['dungeon'],
  'Kule': ['tower'],
  'Yetişim': ['cultivation', 'cultivator'],
  'Murim': ['murim'],
  'Canavar': ['monster', 'monsters'],
  'Mitoloji': ['mythology', 'mitoloji'],
  'Zombi': ['zombie', 'zombies'],
  'Modern Yaşam': ['modern life', 'modern setting'],
  'Akademi': ['academy'],
  'Aşk Üçgeni': ['love triangle'],
  'Anti Kahraman': ['anti-hero', 'antihero'],
  'Asalet': ['royalty', 'nobility', 'noble'],
  'Beden Değişimi': ['body swap', 'bodies swapped'],
  'Çocuk Bakımı': ['childcare'],
  'Distopya': ['dystopian', 'dystopia'],
  'Krallık Kurma': ['kingdom building'],
  'Şifa': ['healing'],
  'Üniversite': ['university'],
  'Ruhlar': ['spirits', 'ghost', 'ghosts'],
  'Politika': ['politics'],
  'Post-Apokaliptik': ['post-apocalyptic'],
  'Ofis': ['office'],
  'Olgun': ['mature'],
  'Tıbbi': ['medical'],
  'Yemek': ['cooking', 'food'],
  'Final': ['completed'],
  'Aile': ['family'],
  '4-koma': ['4-koma', '4 koma'],
  'Akhromatik': ['achromatic', 'monochrome', 'monochromatic'],
  'Akronolojik Sıralama': ['achronological order'],
  'Akrobasi': ['acrobatics'],
  'Oyunculuk': ['acting'],
  'Evlat Edinme': ['adoption'],
  'Reklam': ['advertisement'],
  'Öte Dünya': ['afterlife', 'after life'],
  'Yaş Farkı': ['age gap'],
  'Yaş Gerilemesi': ['age regression'],
  'Agender': ['agender'],
  'Tarım': ['agriculture'],
  'Airsoft': ['airsoft'],
  'Simya': ['alchemy'],
  'Uzaylılar': ['aliens'],
  'Alternatif Evren': ['alternate universe', 'alternate universe - parallel world'],
  'Amerikan Futbolu': ['american football'],
  'Amnezi': ['amnesia'],
  'Anakronizm': ['anachronism'],
  'Antik Çin': ['ancient china'],
  'Melekler': ['angels'],
  'Hayvanlar': ['animals'],
  'Antoloji': ['anthology'],
  'Antropomorfizm': ['anthropomorphism'],
  'Anti-Kahraman': ['anti-hero', 'antihero'],
  'Okçuluk': ['archery'],
  'Aromantik': ['aromantic'],
  'Düzenlenmiş Evlilik': ['arranged marriage'],
  'Yapay Zeka': ['artificial intelligence', 'ai'],
  'Aseksüel': ['asexual'],
  'Suikastçiler': ['assassins'],
  'Astronomi': ['astronomy'],
  'Atletizm': ['athletics'],
  'Geliştirilmiş Gerçeklik': ['augmented reality', 'ar'],
  'Otabiyografik': ['autobiographical'],
  'Havacılık': ['aviation'],
  'Badminton': ['badminton'],
  'Bale': ['ballet'],
  'Müzik Grubu': ['band'],
  'Bar': ['bar', 'pub'],
  'Beyzbol': ['baseball'],
  'Basketbol': ['basketball'],
  'Açlık Oyunları': ['battle royale'],
  'Biyografik': ['biographical'],
  'Biseksüel': ['bisexual'],
  'Şantaj': ['blackmail'],
  'Masa Oyunu': ['board game'],
  'Yatılı Okul': ['boarding school'],
  'Vücut Korkusu': ['body horror'],
  'Beden Algısı': ['body image'],
  'Beden Değiştirme': ['body swapping', 'body swap'],
  'Bowling': ['bowling'],
  'Boks': ['boxing'],
  'Boys Love': ['boys love', "boys' love"],
  'Beyin Yıkama': ['brainwashing'],
  'Zorbalık': ['bullying'],
  'Uşak': ['butler'],
  'Kaligrafi': ['calligraphy'],
  'Kamp': ['camping'],
  'Yamyamlık': ['cannibalism'],
  'Kart Savaşı': ['card battle'],
  'Arabalar': ['cars'],
  'Sentaur': ['centaur'],
  'CGI': ['cgi'],
  'Tezahürat': ['cheerleading'],
  'Chibi': ['chibi'],
  'Kimera': ['chimera'],
  'Chuunibyou': ['chuunibyou', 'middle school syndrome'],
  'Sirk': ['circus'],
  'Sınıf Mücadelesi': ['class struggle'],
  'Klasik Edebiyat': ['classic literature'],
  'Klasik Müzik': ['classical music'],
  'Klon': ['clone'],
  'Sahil': ['coastal'],
  'Birlikte Yaşama': ['cohabitation'],
  'Kolej': ['college'],
  'Büyüme Hikayesi': ['coming of age'],
  'Komplo': ['conspiracy'],
  'Kozmik Korku': ['cosmic horror'],
  'Cosplay': ['cosplay'],
  'Kovboylar': ['cowboys'],
  'Yaratık Eğitmenliği': ['creature taming'],
  'Suç': ['crime'],
  'Suç Örgütü': ['criminal organization'],
  'Karşı Cinsin Kıyafetlerini Giyme': ['crossdressing'],
  'Crossover': ['crossover'],
  'Tarikat': ['cult'],
  'Kültivasyon': ['cultivation'],
  'Lanetler': ['curses'],
  'Sevimli Erkekler Sevimli Şeyler Yapıyor': ['cute boys doing cute things'],
  'Sevimli Kızlar Sevimli Şeyler Yapıyor': ['cute girls doing cute things'],
  'Cyberpunk': ['cyberpunk'],
  'Siborg': ['cyborg'],
  'Bisiklet': ['cycling'],
  'Dans': ['dancing'],
  'Ölüm Oyunu': ['death game'],
  'Baş Kaldıranlar': ['delinquents'],
  'İblisler': ['demons'],
  'Denpa': ['denpa'],
  'Çöl': ['desert'],
  'Dedektif': ['detective'],
  'Dinozorlar': ['dinosaurs'],
  'Engellilik': ['disability'],
  'Dissosiyatif Kimlikler': ['dissociative identities'],
  'Ejderhalar': ['dragons'],
  'Çizim': ['drawing'],
  'Uyuşturucu': ['drugs'],
  'Dullahan': ['dullahan'],
  'Zindan': ['dungeon'],
  'Distopya': ['dystopian', 'dystopia'],
  'E-Spor': ['e-sports', 'esports'],
  'Çevre Korkusu': ['eco-horror'],
  'Ekonomi': ['economics'],
  'Eğitici': ['educational'],
  'Yaşlı Protagonist': ['elderly protagonist'],
  'Elf': ['elf'],
  'Ensemble Cast': ['ensemble cast'],
  'Çevrecilik': ['environmental'],
  'Bölüm Bölüm': ['episodic'],
  'Ero Guro': ['ero guro', 'eroguro'],
  'Casusluk': ['espionage', 'spy'],
  'Uzaklaştırılmış Aile': ['estranged family'],
  'Şeytan Çıkarma': ['exorcism'],
  'Peri': ['fairy'],
  'Peri Masalı': ['fairy tale'],
  'Sahte İlişki': ['fake relationship'],
  'Aile Hayatı': ['family life'],
  'Moda': ['fashion'],
  'Kadın Harem': ['female harem'],
  'Kadın Protagonist': ['female protagonist'],
  'Femboy': ['femboy'],
  'Eskrim': ['fencing'],
  'Film Yapımı': ['filmmaking'],
  'İtfaiyeciler': ['firefighters'],
  'Balıkçılık': ['fishing'],
  'Fitness': ['fitness', 'exercise', 'workout'],
  'Flaş': ['flash'],
  'Yemek': ['food', 'cooking', 'gourmet'],
  'Futbol': ['football', 'soccer'],
  'Yabancı': ['foreign'],
  'Seçilmiş Aile': ['found family'],
  'Kaçak': ['fugitive'],
  'Tam CGI': ['full cgi'],
  'Tam Renkli': ['full color'],
  'Kumar': ['gambling'],
  'Çeteler': ['gangs', 'gang'],
  'Gekiga': ['gekiga'],
  'Cinsiyet Değişimi': ['gender bending', 'gender swap', 'gender bender'],
  'Hayalet': ['ghost', 'ghosts', 'spirit', 'spirits'],
  'Go': ['go'],
  'Goblin': ['goblin'],
  'Tanrılar': ['gods'],
  'Golf': ['golf'],
  'Gore': ['gore'],
  'Mezuniyet Projesi': ['graduation project'],
  'Silahlar': ['guns'],
  'Gyaru': ['gyaru', 'gal'],
  'Handball': ['handball'],
  'Henshin': ['henshin', 'transformation'],
  'Heteroseksüel': ['heterosexual'],
  'Hikikomori': ['hikikomori'],
  'Hip-hop Müzik': ['hip-hop music', 'hip hop', 'hiphop', 'rap'],
  'Tarihi': ['historical'],
  'Evsiz': ['homeless'],
  'Bahçecilik': ['horticulture'],
  'İnsan Deneyleri': ['human experimentation'],
  'Buz Pateni': ['ice skating'],
  'İdol': ['idol'],
  'Yerli Kültürler': ['indigenous cultures'],
  'Han': ['inn'],
  'Türler Arası': ['interspecies'],
  'Isekai': ['isekai'],
  'Iyashikei': ['iyashikei', 'healing'],
  'Caz Müzik': ['jazz music'],
  'Josei': ['josei'],
  'Judo': ['judo'],
  'Kabuki': ['kabuki'],
  'Kaiju': ['kaiju'],
  'Karuta': ['karuta'],
  'Kemonomimi': ['kemonomimi'],
  'Çocuklar': ['kids'],
  'Krallık Yönetimi': ['kingdom management', 'kingdom building'],
  'Konbini': ['konbini', 'convenience store'],
  'Kuudere': ['kuudere'],
  'Lacrosse': ['lacrosse'],
  'Dil Bariyeri': ['language barrier'],
  'LGBTQ+ Temaları': ['lgbtq+ themes', 'lgbtq', 'lgbt'],
  'Uzun Şerit': ['long strip', 'webtoon'],
  'Kayıp Medeniyet': ['lost civilization'],
  'Aşk Üçgeni': ['love triangle'],
  'Mafia': ['mafia'],
  'Büyü': ['magic'],
  'Mahjong': ['mahjong', 'majong'],
  'Hizmetçiler': ['maids'],
  'Makyaj': ['makeup'],
  'Erkek Harem': ['male harem'],
  'Erkek Protagonist': ['male protagonist'],
  'Manzai': ['manzai'],
  'Evlilik': ['marriage'],
  'Dövüş Sanatları': ['martial arts'],
  'Eşleştirme': ['matchmaking'],
  'Matriyarkal': ['matriarchy'],
  'Tıp': ['medicine', 'medical'],
  'Ortaçağ': ['medieval'],
  'Hafıza Manipülasyonu': ['memory manipulation'],
  'Deniz Kızı': ['mermaid'],
  'Meta': ['meta'],
  'Metal Müzik': ['metal music', 'metal'],
  'Askeri': ['military'],
  'Karışık Cinsiyet Harem': ['mixed gender harem'],
  'Karışık Medya': ['mixed media'],
  'Modelleme': ['modeling'],
  'Canavar Erkek': ['monster boy'],
  'Canavar Kız': ['monster girl'],
  'Mopetler': ['mopeds'],
  'Motosikletler': ['motorcycles'],
  'Dağcılık': ['mountaineering'],
  'Müzikal Tiyatro': ['musical theater', 'musical theatre'],
  'Mitoloji': ['mythology'],
  'Doğal Afet': ['natural disaster'],
  'Nekromansi': ['necromancy'],
  'Nekomimi': ['nekomimi'],
  'Ninja': ['ninja'],
  'Diyalogsuz': ['no dialogue'],
  'Noir': ['noir'],
  'Kurgu Dışı': ['non-fiction'],
  'Çıplaklık': ['nudity', 'nude'],
  'Rahibe': ['nun'],
  'Ofis': ['office'],
  'Ofis Kadını': ['office lady', 'ol'],
  'Oiran': ['oiran'],
  'Ojou-sama': ['ojou-sama', 'ojou'],
  'Yetim': ['orphan'],
  'Otaku Kültürü': ['otaku culture'],
  'Dış Mekan Aktiviteleri': ['outdoor activities'],
  'Pandemi': ['pandemic'],
  'Ebeveynlik': ['parenthood'],
  'Parkour': ['parkour'],
  'Parodi': ['parody'],
  'Felsefe': ['philosophy'],
  'Fotoğrafçılık': ['photography'],
  'Korsanlar': ['pirates'],
  'Poker': ['poker'],
  'Polis': ['police'],
  'Politika': ['politics'],
  'Çokeşlilik': ['polyamorous', 'polyamory'],
  'Kıyamet Sonrası': ['post-apocalyptic', 'post-apocalypse'],
  'POV': ['pov'],
  'Hamilelik': ['pregnancy'],
  'Öncelikle Yetişkin Kadro': ['primarily adult cast'],
  'Öncelikle Hayvan Kadro': ['primarily animal cast'],
  'Öncelikle Çocuk Kadro': ['primarily child cast'],
  'Öncelikle Kadın Kadro': ['primarily female cast'],
  'Öncelikle Erkek Kadro': ['primarily male cast'],
  'Öncelikle Ergen Kadro': ['primarily teen cast'],
  'Hapishane': ['prison'],
  'Vekil Savaş': ['proxy battle'],
  'Psikoseksüel': ['psychosexual'],
  'Kuklacılık': ['puppetry'],
  'Rakugo': ['rakugo'],
  'Gerçek Robot': ['real robot'],
  'Rehabilitasyon': ['rehabilitation'],
  'Reenkarnasyon': ['reincarnation'],
  'Din': ['religion'],
  'Kurtarma': ['rescue'],
  'Restoran': ['restaurant'],
  'İntikam': ['revenge'],
  'Ters Isekai': ['reverse isekai'],
  'Robotlar': ['robots'],
  'Rock Müzik': ['rock music', 'rock'],
  'Rotoscoping': ['rotoscoping'],
  'Kraliyet İşleri': ['royal affairs'],
  'Ragbi': ['rugby'],
  'Kırsal': ['rural', 'countryside'],
  'Samuray': ['samurai'],
  'Hiciv': ['satire'],
  'Okul': ['school'],
  'Okul Kulübü': ['school club'],
  'Dalgıçlık': ['scuba diving'],
  'Seinen': ['seinen'],
  'Şekil Değiştirme': ['shapeshifting'],
  'Gemiler': ['ships'],
  'Shogi': ['shogi'],
  'Shoujo': ['shoujo'],
  'Shounen': ['shounen'],
  'Tapınak Bekçisi': ['shrine maiden'],
  'Tek Sayfa Bölüm': ['single-page chapter'],
  'Kaykay': ['skateboarding'],
  'İskelet': ['skeleton'],
  'Slapstick': ['slapstick'],
  'Kölelik': ['slavery'],
  'Kar Manzarası': ['snowscape'],
  'Yazılım Geliştirme': ['software development'],
  'Uzay': ['space'],
  'Uzay Operası': ['space opera'],
  'Mızrak Savaşı': ['spearplay'],
  'Steampunk': ['steampunk'],
  'Stop Motion': ['stop motion'],
  'Succubus': ['succubus'],
  'İntihar': ['suicide'],
  'Sumo': ['sumo'],
  'Süper Güç': ['super power', 'superpower', 'super powers'],
  'Süper Robot': ['super robot'],
  'Süper Kahraman': ['superhero', 'super heroes'],
  'Sörf': ['surfing'],
  'Gerçeküstü Komedi': ['surreal comedy'],
  'Hayatta Kalma': ['survival'],
  'Yüzme': ['swimming'],
  'Kılıç Savaşı': ['swordplay'],
  'Masa Tenisi': ['table tennis', 'ping pong', 'ping-pong'],
  'Tanklar': ['tanks'],
  'Ten Rengi': ['tanned skin', 'dark skin'],
  'Öğretmen': ['teacher'],
  'Gençlerin Aşkı': ["teens' love"],
  'Tenis': ['tennis'],
  'Terörizm': ['terrorism'],
  'Zaman Döngüsü': ['time loop'],
  'Zaman Manipülasyonu': ['time manipulation'],
  'Zaman Atlaması': ['time skip'],
  'Tokusatsu': ['tokusatsu'],
  'Tomboy': ['tomboy'],
  'İşkence': ['torture'],
  'Trajedi': ['tragedy'],
  'Trenler': ['trains'],
  'Transgender': ['transgender'],
  'Seyahat': ['travel'],
  'Triadlar': ['triads'],
  'Tsundere': ['tsundere'],
  'İkizler': ['twins'],
  'Karşılıksız Aşk': ['unrequited love'],
  'Kentsel': ['urban'],
  'Kentsel Fantezi': ['urban fantasy'],
  'Vampir': ['vampire'],
  'Dikey Video': ['vertical video'],
  'Veteriner Hekim': ['veterinarian'],
  'Video Oyunları': ['video games', 'gaming', 'game'],
  'Vikingler': ['vikings'],
  'Villainess': ['villainess'],
  'Sanal Dünya': ['virtual world', 'virtual reality', 'vr'],
  'Vocal Synth': ['vocal synth', 'vocaloid'],
  'Voleybol': ['volleyball'],
  'VTuber': ['vtuber'],
  'Savaş': ['war'],
  'Kurtadam': ['werewolf'],
  'Vahşi Doğa': ['wilderness'],
  'Cadı': ['witch'],
  'İş': ['work', 'office', 'workplace'],
  'Güreş': ['wrestling'],
  'Yazma': ['writing'],
  'Wuxia': ['wuxia'],
  'Yakuza': ['yakuza'],
  'Yandere': ['yandere'],
  'Youkai': ['youkai', 'yokai'],
  'Yuri': ['yuri'],
  'Zombi': ['zombie'],
};

const buildGenreAliasLookup = () => {
  const lookup = new Map<string, string>();
  for (const [turkishName, aliases] of Object.entries(GENRE_ALIAS_MAP)) {
    lookup.set(normalizeKey(turkishName), turkishName);
    for (const alias of aliases) {
      lookup.set(normalizeKey(alias), turkishName);
    }
  }
  return lookup;
};

const genreAliasLookup = buildGenreAliasLookup();

const normalizeAggressiveKey = (value?: string | null) =>
  normalizeKey(value).replace(/[\s-]/g, '');

const normalizeLooseKey = (value?: string | null) =>
  normalizeKey(value).replace(/[^a-z0-9]/g, '');

const isBlockedGenreOrTag = (value?: string | null) =>
  !!value && BLOCKED_GENRE_OR_TAG_KEYS.has(normalizeKey(value));

export const translateGenresWithAliases = (genres: string[]): string[] => {
  return uniqueStrings(
    genres
      .filter((genre) => !isBlockedGenreOrTag(genre))
      .map((genre) => {
        const sourceKey = normalizeKey(genre);
        const aggressiveSourceKey = normalizeAggressiveKey(genre);

        const aliasedTurkish = genreAliasLookup.get(sourceKey) || genreAliasLookup.get(aggressiveSourceKey);
        if (aliasedTurkish) {
          return aliasedTurkish;
        }

        return genre;
      })
      .filter(Boolean),
  );
};

export const matchGenresWithSiteTags = async (
  importedTags: string[],
): Promise<TagMatchResult[]> => {
  const siteTags = await getAllTags({ includePending: true });
  const siteTagLookup = new Map<string, { id: string; name: string }>();
  const aggressiveSiteTagLookup = new Map<string, { id: string; name: string }>();
  const looseSiteTagLookup = new Map<string, { id: string; name: string }>();

  for (const tag of siteTags) {
    const mappedTag = { id: tag.id, name: tag.name };
    siteTagLookup.set(normalizeKey(tag.name), mappedTag);
    aggressiveSiteTagLookup.set(normalizeAggressiveKey(tag.name), mappedTag);
    looseSiteTagLookup.set(normalizeLooseKey(tag.name), mappedTag);
  }

  // Official catalog: map English alias variations to canonical English tag name
  const officialEnglishLookup = new Map<string, string>();
  for (const entry of OFFICIAL_TAG_CATALOG) {
    const canonical = entry.name;
    officialEnglishLookup.set(normalizeKey(canonical), canonical);
    officialEnglishLookup.set(normalizeAggressiveKey(canonical), canonical);
    officialEnglishLookup.set(normalizeLooseKey(canonical), canonical);
  }

  const resolveTagMatch = (value: string) => {
    const sourceKey = normalizeKey(value);
    const aggressiveSourceKey = normalizeAggressiveKey(value);
    const looseSourceKey = normalizeLooseKey(value);

    return (
      siteTagLookup.get(sourceKey)
      || aggressiveSiteTagLookup.get(aggressiveSourceKey)
      || looseSiteTagLookup.get(looseSourceKey)
    );
  };

  const resolvePartialTagMatch = (value: string) => {
    const sourceKey = normalizeKey(value);
    const looseSourceKey = normalizeLooseKey(value);

    for (const [siteKey, siteTag] of siteTagLookup) {
      const looseSiteKey = normalizeLooseKey(siteKey);
      if (
        siteKey.includes(sourceKey)
        || sourceKey.includes(siteKey)
        || (looseSourceKey.length > 3 && looseSiteKey.includes(looseSourceKey))
        || (looseSiteKey.length > 3 && looseSourceKey.includes(looseSiteKey))
      ) {
        return siteTag;
      }
    }

    return undefined;
  };

  const tryMatchTag = async (sourceTag: string) => {
    const sourceKey = normalizeKey(sourceTag);
    const aggressiveSourceKey = normalizeAggressiveKey(sourceTag);

    // 1) Official English catalog match
    const officialCanonical =
      officialEnglishLookup.get(sourceKey)
      || officialEnglishLookup.get(aggressiveSourceKey);
    if (officialCanonical) {
      const dbMatch = resolveTagMatch(officialCanonical);
      if (dbMatch) {
        return { sourceTag, matchedTag: dbMatch, isMatched: true } satisfies TagMatchResult;
      }
    }

    // 2) English alias → Turkish name → DB (for tags stored in Turkish)
    const turkishGenreName = genreAliasLookup.get(sourceKey) || genreAliasLookup.get(aggressiveSourceKey);
    if (turkishGenreName) {
      const genreTagMatch = resolveTagMatch(turkishGenreName);
      return {
        sourceTag,
        matchedTag: genreTagMatch,
        isMatched: true,
        isStandardGenre: true,
        genreMatchName: turkishGenreName,
      } satisfies TagMatchResult;
    }

    // 3) Direct match against any DB tag
    const directMatch = resolveTagMatch(sourceTag);
    if (directMatch) {
      return { sourceTag, matchedTag: directMatch, isMatched: true } satisfies TagMatchResult;
    }

    // 4) Partial match against DB tags
    const partialMatch = resolvePartialTagMatch(sourceTag);
    if (partialMatch) {
      return { sourceTag, matchedTag: partialMatch, isMatched: true } satisfies TagMatchResult;
    }

    // 5) Translate to English and re-check (for non-English source tags)
    const translatedToEnglish = await translateText(sourceTag, 'en');
    const normalizedTranslation = normalizeText(translatedToEnglish);

    if (
      normalizedTranslation
      && normalizeLooseKey(normalizedTranslation) !== normalizeLooseKey(sourceTag)
    ) {
      // Check official English catalog with the translation
      const translatedCanonical =
        officialEnglishLookup.get(normalizeKey(normalizedTranslation))
        || officialEnglishLookup.get(normalizeAggressiveKey(normalizedTranslation));
      if (translatedCanonical) {
        const translatedDbMatch = resolveTagMatch(translatedCanonical);
        if (translatedDbMatch) {
          return { sourceTag, matchedTag: translatedDbMatch, isMatched: true } satisfies TagMatchResult;
        }
      }

      // Check Turkish genre aliases
      const translatedGenreName =
        genreAliasLookup.get(normalizeKey(normalizedTranslation))
        || genreAliasLookup.get(normalizeAggressiveKey(normalizedTranslation));

      if (translatedGenreName) {
        const genreTagMatch = resolveTagMatch(translatedGenreName);
        return {
          sourceTag,
          matchedTag: genreTagMatch,
          isMatched: true,
          isStandardGenre: true,
          genreMatchName: translatedGenreName,
        } satisfies TagMatchResult;
      }

      const translatedDirectMatch = resolveTagMatch(normalizedTranslation);
      if (translatedDirectMatch) {
        return {
          sourceTag,
          matchedTag: translatedDirectMatch,
          isMatched: true,
        } satisfies TagMatchResult;
      }

      const translatedPartialMatch = resolvePartialTagMatch(normalizedTranslation);
      if (translatedPartialMatch) {
        return {
          sourceTag,
          matchedTag: translatedPartialMatch,
          isMatched: true,
        } satisfies TagMatchResult;
      }
    }

    return { sourceTag, isMatched: false } satisfies TagMatchResult;
  };

  return Promise.all(
    importedTags
      .filter((sourceTag) => !isBlockedGenreOrTag(sourceTag))
      .map((sourceTag) => tryMatchTag(sourceTag)),
  );
};

const TRANSLATE_BATCH_SIZE = 5;
const TRANSLATE_DELAY_MS = 300;

export const translateText = async (text: string, targetLang = 'tr'): Promise<string> => {
  if (!text.trim()) return text;

  try {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${targetLang}&dt=t&q=${encodeURIComponent(text)}`;
    const response = await fetch(url);
    if (!response.ok) return text;

    const data = await response.json();
    if (!Array.isArray(data) || !Array.isArray(data[0])) return text;

    return data[0]
      .filter((segment: any) => Array.isArray(segment) && typeof segment[0] === 'string')
      .map((segment: any) => segment[0])
      .join('');
  } catch {
    return text;
  }
};

const translatePreviewDescriptions = async (preview: ImportedMangaPayload): Promise<ImportedMangaPayload> => {
  const textsToTranslate: Array<{ path: string; text: string }> = [];

  if (preview.description) {
    textsToTranslate.push({ path: 'description', text: preview.description });
  }

  for (let i = 0; i < preview.authors.length; i++) {
    if (preview.authors[i].description) {
      textsToTranslate.push({ path: `authors.${i}.description`, text: preview.authors[i].description! });
    }
  }

  for (let i = 0; i < preview.artists.length; i++) {
    if (preview.artists[i].description) {
      textsToTranslate.push({ path: `artists.${i}.description`, text: preview.artists[i].description! });
    }
  }

  for (let i = 0; i < preview.characters.length; i++) {
    if (preview.characters[i].description) {
      textsToTranslate.push({ path: `characters.${i}.description`, text: preview.characters[i].description! });
    }
  }

  if (textsToTranslate.length === 0) return preview;

  const translated = { ...preview };
  translated.authors = [...preview.authors];
  translated.artists = [...preview.artists];
  translated.characters = [...preview.characters];

  for (let batchStart = 0; batchStart < textsToTranslate.length; batchStart += TRANSLATE_BATCH_SIZE) {
    const batch = textsToTranslate.slice(batchStart, batchStart + TRANSLATE_BATCH_SIZE);

    const results = await Promise.all(
      batch.map((item) => translateText(item.text)),
    );

    for (let j = 0; j < batch.length; j++) {
      const { path } = batch[j];
      const translatedText = results[j];

      if (path === 'description') {
        translated.description = translatedText;
      } else {
        const parts = path.split('.');
        const collection = parts[0] as 'authors' | 'artists' | 'characters';
        const index = Number(parts[1]);
        (translated[collection] as any)[index] = {
          ...(translated[collection] as any)[index],
          description: translatedText,
        };
      }
    }

    if (batchStart + TRANSLATE_BATCH_SIZE < textsToTranslate.length) {
      await sleep(TRANSLATE_DELAY_MS);
    }
  }

  return translated;
};

const toIsoDate = (parts?: { year?: number | null; month?: number | null; day?: number | null } | null) => {
  if (!parts?.year || !parts?.month || !parts?.day) {
    return undefined;
  }

  const month = `${parts.month}`.padStart(2, '0');
  const day = `${parts.day}`.padStart(2, '0');
  return `${parts.year}-${month}-${day}`;
};

const toYear = (value?: string | null) => {
  const match = normalizeText(value).match(/\b(19|20)\d{2}\b/);
  return match ? Number(match[0]) : undefined;
};

const toLocalMangaStatus = (value?: string | null): Manga['status'] => {
  const normalized = normalizeKey(value);

  if (
    normalized.includes('complete') ||
    normalized.includes('finished') ||
    normalized.includes('tamam')
  ) {
    return 'completed';
  }

  if (normalized.includes('hiatus')) {
    return 'hiatus';
  }

  return 'ongoing';
};

const toLocalMangaType = (value?: string | null): Manga['type'] => {
  const normalized = normalizeKey(value);

  if (normalized.includes('manhwa')) {
    return 'manhwa';
  }

  if (normalized.includes('manhua')) {
    return 'manhua';
  }

  if (normalized.includes('webtoon')) {
    return 'webtoon';
  }

  return 'manga';
};

const normalizeRelationType = (value?: string | null) => {
  const normalized = normalizeKey(value);

  if (normalized.includes('sequel')) return 'sequel';
  if (normalized.includes('prequel')) return 'prequel';
  if (normalized.includes('spin')) return 'spinoff';
  if (normalized.includes('side')) return 'side_story';
  if (normalized.includes('adapted from')) return 'adapted_from';
  if (normalized.includes('adaptation')) return 'adaptation';
  if (normalized.includes('alternative')) return 'alternative_version';

  return 'related';
};

const createSourceLink = (
  source: MetadataImportSource,
  url: string,
  kind: string,
  label?: string,
): ExternalSourceLink => ({
  source,
  url,
  kind,
  label: normalizeText(label) || undefined,
});

const createImportedPersonDraft = (
  source: MetadataImportSource,
  name: string,
  sourceUrl: string | undefined,
  partial?: Partial<ImportedPersonDraft>,
): ImportedPersonDraft => ({
  name: normalizeText(name),
  imageUrl: sanitizeEntityImageUrl(partial?.imageUrl),
  description: normalizeText(partial?.description) || undefined,
  alternativeNames: uniqueStrings(partial?.alternativeNames || []),
  details: partial?.details || {},
  gallery: partial?.gallery || [],
  sourceLinks: mergeSourceLinks(
    partial?.sourceLinks,
    sourceUrl ? [createSourceLink(source, sourceUrl, 'person', name)] : [],
  ),
  sourceUrl,
});

const parseUrlId = (pattern: RegExp, input: string) => {
  const match = input.match(pattern);
  return match?.[1];
};

const parseMyAnimeListId = (input: string) => parseUrlId(/\/manga\/(\d+)/i, input);
const parseMyAnimeListCharacterId = (input: string) => parseUrlId(/\/character\/(\d+)/i, input);
const parseMyAnimeListPeopleId = (input: string) => parseUrlId(/\/people\/(\d+)/i, input);
const parseMangaUpdatesSeriesPath = (input: string) => input.match(/\/series\/([^/?#]+)/i)?.[1];
const parseAniSearchMangaId = (input: string) => normalizeText(input).match(/^\d+$/)?.[0] || parseUrlId(/\/manga\/(\d+)/i, input);
const parseAniSearchMangaSlug = (input: string) => input.match(/\/manga\/\d+,([^/?#]+)/i)?.[1];
const parseAniSearchCharacterId = (input: string) => parseUrlId(/\/character\/(\d+)/i, input);
const parseAniSearchPeopleId = (input: string) => parseUrlId(/\/person\/(\d+)/i, input);
const parseAnimePlanetMangaSlug = (input: string) => input.match(/\/manga\/([^/?#]+)/i)?.[1];
const parseAnimePlanetCharacterSlug = (input: string) => input.match(/\/characters\/([^/?#]+)/i)?.[1];
const parseAnimePlanetPeopleSlug = (input: string) => input.match(/\/people\/([^/?#]+)/i)?.[1];

const parseAboutLines = (about?: string | null) => {
  const lines = (about || '')
    .split(/\r?\n/)
    .map((line) => normalizeText(line))
    .filter(Boolean);
  const metadata: Record<string, string> = {};
  const description: string[] = [];

  for (const line of lines) {
    const match = line.match(/^([^:]+):\s*(.+)$/);
    if (match && match[1].length < 32) {
      metadata[normalizeKey(match[1])] = normalizeText(match[2]);
      continue;
    }

    description.push(line);
  }

  return { metadata, description: description.join('\n\n') };
};

const parseHtml = (html: string) => new DOMParser().parseFromString(html, 'text/html');
const parseXml = (xml: string) => new DOMParser().parseFromString(xml, 'application/xml');

const parseHtmlFragment = (html: string) => parseHtml(`<body>${html}</body>`);

const fetchAnimePlanetHtml = (url: string) => (
  fetchScraperContent(url, { provider: 'supabase' })
);

const fetchAniSearchHtml = (url: string) => (
  fetchScraperContent(url)
);

const getMetaContent = (doc: Document, attribute: 'property' | 'name', value: string) => (
  normalizeText(doc.querySelector(`meta[${attribute}="${value}"]`)?.getAttribute('content'))
);

const getAnimePlanetStructuredData = (doc: Document) => {
  const scripts = Array.from(doc.querySelectorAll('script[type="application/ld+json"]'));

  for (const script of scripts) {
    try {
      const parsed = JSON.parse(script.textContent || '{}');
      const candidateList = Array.isArray(parsed)
        ? parsed
        : parsed?.['@graph'] && Array.isArray(parsed['@graph'])
          ? parsed['@graph']
          : [parsed];
      const candidate = candidateList.find((item) => (
        item
        && typeof item === 'object'
        && (
          item['@type'] === 'BookSeries'
          || item['@type'] === 'Book'
          || item['@type'] === 'Series'
        )
      ));

      if (candidate) {
        return candidate as Record<string, any>;
      }
    } catch {
      continue;
    }
  }

  return null;
};

const splitAnimePlanetNames = (value?: string | null) => uniqueStrings(
  normalizeText(value)
    .replace(/^(alt titles?|aka):\s*/i, '')
    .split(/\s*,\s*/)
    .map((item) => normalizeText(item)),
);

const getAnimePlanetTitle = (doc: Document) => (
  normalizeText(doc.querySelector('h1[itemprop="name"], h1')?.textContent)
);

const getAnimePlanetAltTitles = (doc: Document) => (
  splitAnimePlanetNames(doc.querySelector('h2.aka')?.textContent)
);

const getAnimePlanetTags = (doc: Document) => uniqueStrings(
  Array.from(doc.querySelectorAll('.tags a[href]'))
    .map((anchor) => normalizeText(anchor.textContent)),
);

const getAnimePlanetGenreSubset = (tags: string[]) => {
  const aggressiveNormalize = (str: string) => normalizeKey(str).replace(/[\s-]/g, '');

  return uniqueStrings(
    tags.filter((tag) => (
      genreAliasLookup.has(normalizeKey(tag))
      || genreAliasLookup.has(aggressiveNormalize(tag))
    )),
  );
};

const getAnimePlanetDescription = (doc: Document) => (
  normalizeText(doc.querySelector('.synopsisManga, .synopsis')?.textContent) || undefined
);

const getAnimePlanetCover = (doc: Document) => sanitizeEntityImageUrl(
  doc.querySelector('img[itemprop="image"], .mainEntry img')?.getAttribute('src')
  || getMetaContent(doc, 'property', 'og:image'),
);

const getAnimePlanetChapterCount = (doc: Document) => {
  const match = normalizeText(doc.querySelector('.entryBar')?.textContent).match(/\bCh:\s*(\d+)/i);
  return match ? Number(match[1]) : undefined;
};

const getAnimePlanetPublisherLabel = (doc: Document) => (
  normalizeText(doc.querySelector('.entryBar a[href*="/manga/magazines/"]')?.textContent) || undefined
);

const parseAnimePlanetYearRange = (doc: Document) => {
  const raw = normalizeText(doc.querySelector('.entryBar .iconYear')?.textContent);
  const match = raw.match(/(\d{4})(?:\s*-\s*(\d{4}|\?))?/);

  if (!match) {
    return { startDate: undefined, endDate: undefined };
  }

  const startDate = `${match[1]}-01-01`;
  const endDate = match[2] && match[2] !== '?' ? `${match[2]}-12-31` : undefined;
  return { startDate, endDate };
};

const getAnimePlanetAverageScore = (doc: Document, structuredData?: Record<string, any> | null) => {
  const structuredValue = Number(structuredData?.aggregateRating?.ratingValue || 0);
  if (structuredValue > 0) {
    return Math.round((structuredValue <= 5 ? structuredValue * 20 : structuredValue));
  }

  const raw = normalizeText(doc.querySelector('.avgRating')?.getAttribute('title'));
  const match = raw.match(/([0-9]+(?:\.[0-9]+)?)\s*out of 5/i);
  return match ? Math.round(Number(match[1]) * 20) : undefined;
};

const getAnimePlanetVoteCount = (doc: Document, structuredData?: Record<string, any> | null) => {
  const structuredValue = Number(structuredData?.aggregateRating?.ratingCount || 0);
  if (structuredValue > 0) {
    return structuredValue;
  }

  const raw = normalizeText(doc.querySelector('.avgRating')?.getAttribute('title'));
  const match = raw.match(/from\s+([\d,]+)\s+votes/i);
  return match ? Number(match[1].replace(/,/g, '')) : undefined;
};

const getAnimePlanetTrackingCount = (doc: Document) => {
  const match = normalizeText(doc.body.textContent).match(/([\d,]+)\s+users are tracking this/i);
  return match ? Number(match[1].replace(/,/g, '')) : undefined;
};

const getAnimePlanetRank = (doc: Document) => {
  const match = normalizeText(doc.querySelector('.entryBar')?.textContent).match(/Rank\s+#([\d,]+)/i);
  return match ? Number(match[1].replace(/,/g, '')) : undefined;
};

const getAnimePlanetNotes = (doc: Document) => uniqueStrings(
  Array.from(doc.querySelectorAll('.notes p'))
    .map((item) => normalizeText(item.textContent)),
);

const getAnimePlanetSourceMaterial = (tags: string[]) => {
  for (const tag of tags) {
    const normalized = normalizeText(tag);
    const basedOnMatch = normalized.match(/^Based on (?:a|an)\s+(.+)$/i);
    if (basedOnMatch) {
      return normalizeText(basedOnMatch[1]);
    }
  }

  return undefined;
};

const mapWithConcurrency = async <TItem, TResult>(
  items: TItem[],
  limit: number,
  mapper: (item: TItem, index: number) => Promise<TResult>,
) => {
  const results = new Array<TResult>(items.length);
  let nextIndex = 0;

  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length || 1)) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index], index);
    }
  });

  await Promise.all(workers);
  return results;
};

const createEmptyPreview = (
  source: MetadataImportSource,
  sourceUrl: string,
  sourceTitle: string,
): ImportedMangaPayload => ({
  source,
  sourceUrl,
  sourceTitle,
  alternativeTitles: [],
  genres: [],
  tags: [],
  gallery: [],
  details: {},
  relatedSeries: [],
  authors: [],
  artists: [],
  characters: [],
  warnings: SOURCE_RUNTIME_WARNINGS[source] ? [SOURCE_RUNTIME_WARNINGS[source] as string] : [],
});

const getJson = async <T>(url: string, init?: RequestInit, retryCount = 3): Promise<T> => {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < retryCount; attempt += 1) {
    try {
      const response = await fetch(url, init);

      if (response.status === 429) {
        await sleep(MAL_REQUEST_DELAY_MS * (attempt + 1));
        continue;
      }

      if (!response.ok) {
        throw new Error(`REQUEST_FAILED_${response.status}`);
      }

      return await response.json();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error('REQUEST_FAILED');
      const status = Number(lastError.message.match(/^REQUEST_FAILED_(\d+)$/)?.[1] || 0);
      const shouldRetry = !status || status === 429 || status >= 500;

      if (!shouldRetry) {
        break;
      }

      await sleep(200 * (attempt + 1));
    }
  }

  throw lastError || new Error('REQUEST_FAILED');
};

const getJikan = async <T>(path: string) => {
  const data = await getJson<{ data: T }>(`https://api.jikan.moe/v4${path}`);
  await sleep(MAL_REQUEST_DELAY_MS);
  return data.data;
};

const parseMalAuthorRoles = (html: string) => {
  const doc = parseHtml(html);
  const authorsRow = Array.from(doc.querySelectorAll('.spaceit_pad')).find((element) =>
    normalizeText(element.querySelector('.dark_text')?.textContent) === 'Authors:',
  );

  const roleMap = new Map<string, 'author' | 'artist' | 'both'>();
  if (!authorsRow) {
    return roleMap;
  }

  const rowText = normalizeText(authorsRow.textContent);
  const anchorNames = Array.from(authorsRow.querySelectorAll('a')).map((anchor) => normalizeText(anchor.textContent));

  const extractRoleText = (name: string) => {
    const normalizedName = normalizeText(name);
    const startIndex = rowText.toLocaleLowerCase('tr-TR').indexOf(normalizedName.toLocaleLowerCase('tr-TR'));

    if (startIndex === -1) {
      return '';
    }

    let cursor = startIndex + normalizedName.length;
    while (cursor < rowText.length && /\s/u.test(rowText[cursor])) {
      cursor += 1;
    }

    if (rowText[cursor] !== '(') {
      return '';
    }

    const endIndex = rowText.indexOf(')', cursor + 1);
    if (endIndex === -1) {
      return '';
    }

    return rowText.slice(cursor + 1, endIndex);
  };

  for (const anchorName of anchorNames) {
    const roleText = normalizeKey(extractRoleText(anchorName));

    if (roleText.includes('story') && roleText.includes('art')) {
      roleMap.set(normalizeKey(anchorName), 'both');
      continue;
    }

    if (roleText.includes('story')) {
      roleMap.set(normalizeKey(anchorName), 'author');
      continue;
    }

    if (roleText.includes('art')) {
      roleMap.set(normalizeKey(anchorName), 'artist');
      continue;
    }

    roleMap.set(normalizeKey(anchorName), 'author');
  }

  return roleMap;
};

const toAbsoluteUrl = (value: string, baseUrl: string) => {
  try {
    return new URL(value, baseUrl).toString();
  } catch {
    return normalizeText(value);
  }
};

const getImageUrlFromElement = (image?: Element | null) => {
  if (!(image instanceof HTMLElement)) {
    return '';
  }

  const directUrl = normalizeText(
    image.getAttribute('data-src')
    || image.getAttribute('src')
    || image.getAttribute('data-original'),
  );

  if (directUrl) {
    return directUrl;
  }

  const srcSetCandidate = normalizeText(
    image.getAttribute('data-srcset')
    || image.getAttribute('srcset'),
  );

  if (!srcSetCandidate) {
    return '';
  }

  return normalizeText(srcSetCandidate.split(',')[0]?.trim().split(/\s+/)[0]);
};

const parseMalGallery = (html: string, galleryPageUrl: string): EntityGalleryImage[] => {
  const doc = parseHtml(html);
  const galleryAnchors = Array.from(
    doc.querySelectorAll<HTMLAnchorElement>('a.js-picture-gallery[href], td[align="center"] a[href]'),
  );

  return uniqueByUrl(
    galleryAnchors
      .map((anchor) => {
        const image = anchor.querySelector('img');
        const thumbUrl = normalizeText(
          image?.getAttribute('data-src')
          || image?.getAttribute('data-srcset')?.split(/\s+/)[0]
          || image?.getAttribute('src'),
        );
        const href = normalizeText(anchor.getAttribute('href'));
        const isDirectImage = /\.(?:avif|gif|jpe?g|png|webp)(?:\?|$)/i.test(href);
        const url = normalizeText(isDirectImage ? href : thumbUrl);

        if (!url) {
          return null;
        }

        return {
          url: toAbsoluteUrl(url, galleryPageUrl),
          thumbUrl: thumbUrl ? toAbsoluteUrl(thumbUrl, galleryPageUrl) : undefined,
          source: 'myanimelist' as const,
          sourceUrl: galleryPageUrl,
          label: 'Gallery',
        };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null),
  );
};

const buildMalGallery = async (sourceUrl: string): Promise<EntityGalleryImage[]> => {
  const galleryPageUrl = normalizeText(sourceUrl);
  if (!galleryPageUrl) {
    return [];
  }

  try {
    const html = await fetchScraperContent(galleryPageUrl);
    return parseMalGallery(html, galleryPageUrl);
  } catch {
    return [];
  }
};

const buildMalPersonDraft = async (
  personId: string,
  personUrl: string,
  role: 'author' | 'artist',
  includeGallery: boolean,
): Promise<ImportedPersonDraft> => {
  const person = await getJikan<any>(`/people/${personId}/full`);
  const { metadata, description } = parseAboutLines(person.about);

  const details: EntityMetadata = {
    nativeName: mergeStringLists([person.given_name, person.family_name]).join(' ').trim() || undefined,
    birthDate: normalizeText(person.birthday) ? person.birthday.slice(0, 10) : undefined,
    birthday: normalizeText(person.birthday) ? person.birthday.slice(5, 10).replace('-', ' ') : undefined,
    birthPlace: metadata.birthplace,
    website: normalizeText(person.website_url) || undefined,
    comments: metadata.profile,
    favorites: typeof person.favorites === 'number' ? person.favorites : undefined,
    role: role === 'artist' ? 'Çizer' : 'Yazar',
  };

  return createImportedPersonDraft('myanimelist', person.name, personUrl, {
    imageUrl: person.images?.jpg?.image_url || person.images?.webp?.image_url,
    description,
    alternativeNames: person.alternate_names || [],
    details,
    gallery: includeGallery ? await buildMalGallery(`${personUrl}/pics`) : [],
    sourceLinks: [createSourceLink('myanimelist', person.url || personUrl, 'person', person.name)],
  });
};

const getCachedMalPersonDraft = async (
  cache: Map<string, ImportedPersonDraft>,
  personId: string,
  personUrl: string,
  role: 'author' | 'artist',
  includeGallery: boolean,
) => {
  const cached = cache.get(personId);
  if (cached) {
    return cached;
  }

  const loaded = await buildMalPersonDraft(personId, personUrl, role, includeGallery);
  cache.set(personId, loaded);
  return loaded;
};

const buildMalCharacterDraft = async (
  characterId: string,
  characterUrl: string,
  roleLabel: string | undefined,
  includeGallery: boolean,
): Promise<ImportedCharacterDraft> => {
  const character = await getJikan<any>(`/characters/${characterId}/full`);
  const { metadata, description } = parseAboutLines(character.about);
  const roleType = normalizeCharacterListingRole(roleLabel);
  const localizedRoleLabel = getCharacterListingRoleLabel(roleType) || normalizeText(roleLabel) || undefined;

  return {
    ...createImportedPersonDraft('myanimelist', character.name, characterUrl, {
      imageUrl: sanitizeEntityImageUrl(character.images?.jpg?.image_url || character.images?.webp?.image_url),
      description: sanitizeCharacterDescription(description),
      alternativeNames: [character.name_kanji, ...(character.nicknames || [])],
      details: {
        nativeName: normalizeText(character.name_kanji) || undefined,
        age: metadata.age,
        birthday: metadata.birthday,
        occupation: metadata.occupation,
        className: metadata.class,
        rankTitle: metadata.rank,
        affiliation: mergeStringLists([metadata.guild, metadata.affiliation]),
        relatives: mergeStringLists([metadata['relative(s)']]),
        gender: metadata.gender,
        comments: metadata.background,
      },
      gallery: includeGallery ? await buildMalGallery(`${characterUrl}/pics`) : [],
      sourceLinks: [createSourceLink('myanimelist', character.url || characterUrl, 'character', character.name)],
    }),
    roleLabel: localizedRoleLabel,
    roleType,
  };
};

const searchMyAnimeListCandidates = async (input: string): Promise<SourceSearchCandidate[]> => {
  const malId = MAL_HOST_PATTERN.test(input) ? parseMyAnimeListId(input) : undefined;

  if (malId) {
    const manga = await getJikan<any>(`/manga/${malId}/full`);
    return [{
      id: `${manga.mal_id}`,
      source: 'myanimelist',
      title: normalizeText(manga.title_english || manga.title),
      subtitle: normalizeText(manga.title_japanese) || undefined,
      url: manga.url,
      imageUrl: manga.images?.jpg?.large_image_url || manga.images?.jpg?.image_url,
    }];
  }

  const results = await getJikan<any[]>(`/manga?q=${encodeURIComponent(input)}&limit=8`);
  return results.map((item) => ({
    id: `${item.mal_id}`,
    source: 'myanimelist',
    title: normalizeText(item.title_english || item.title),
    subtitle: normalizeText(item.title_japanese) || undefined,
    url: item.url,
    imageUrl: item.images?.jpg?.image_url || item.images?.webp?.image_url,
  }));
};

const loadMyAnimeListPreview = async (
  candidate: SourceSearchCandidate,
  enabledOptions: Partial<Record<ImportOptionKey, boolean>>,
): Promise<ImportedMangaPayload> => {
  const malId = parseMyAnimeListId(candidate.url) || candidate.id;
  const manga = await getJikan<any>(`/manga/${malId}/full`);
  const preview = createEmptyPreview('myanimelist', manga.url || candidate.url, normalizeText(manga.title_english || manga.title));
  const personCache = new Map<string, ImportedPersonDraft>();

  preview.cover = normalizeText(
    manga.images?.jpg?.large_image_url || manga.images?.jpg?.image_url || manga.images?.webp?.large_image_url,
  ) || undefined;
  preview.description = normalizeText([manga.synopsis, manga.background].filter(Boolean).join('\n\n')) || undefined;
  preview.alternativeTitles = uniqueStrings([
    manga.title,
    manga.title_english,
    manga.title_japanese,
    ...(manga.title_synonyms || []),
    ...(manga.titles || []).map((item: any) => item.title),
  ]);
  preview.genres = uniqueStrings([
    ...(manga.genres || []).map((item: any) => item.name),
    ...(manga.themes || []).map((item: any) => item.name),
    ...(manga.demographics || []).map((item: any) => item.name),
  ]);
  preview.tags = preview.genres.slice();
  preview.relatedSeries = (manga.relations || [])
    .flatMap((relation: any) =>
      (relation.entry || [])
        .filter((entry: any) => entry.type === 'manga')
        .map((entry: any) => ({
          title: normalizeText(entry.name),
          relationType: normalizeRelationType(relation.relation),
          sourceUrl: normalizeText(entry.url) || undefined,
        })),
    );
  preview.details = {
    englishName: normalizeText(manga.title_english) || undefined,
    nativeName: normalizeText(manga.title_japanese) || undefined,
    status: normalizeText(manga.status) || undefined,
    chapters: typeof manga.chapters === 'number' ? manga.chapters : undefined,
    volumes: typeof manga.volumes === 'number' ? manga.volumes : undefined,
    popularity: typeof manga.popularity === 'number' ? manga.popularity : undefined,
    favorites: typeof manga.favorites === 'number' ? manga.favorites : undefined,
    averageScore: typeof manga.score === 'number' ? Math.round(manga.score * 10) : undefined,
    startDate: normalizeText(manga.published?.from) ? manga.published.from.slice(0, 10) : undefined,
    endDate: normalizeText(manga.published?.to) ? manga.published.to.slice(0, 10) : undefined,
    originalPublisher: normalizeText(manga.serializations?.[0]?.name) || undefined,
    sourceMaterial: normalizeText(manga.type) || undefined,
    genres: preview.genres,
    extra: {
      malMembers: typeof manga.members === 'number' ? manga.members : undefined,
      malRank: typeof manga.rank === 'number' ? manga.rank : undefined,
      serializations: uniqueStrings((manga.serializations || []).map((item: any) => item.name)),
    },
  };

  if (enabledOptions.gallery) {
    preview.gallery = await buildMalGallery(`${manga.url || candidate.url}/pics`);
  }

  if (enabledOptions.authors || enabledOptions.artists) {
    const malHtml = await fetchScraperContent(manga.url || candidate.url);
    const roleMap = parseMalAuthorRoles(malHtml);

    for (const person of manga.authors || []) {
      const personId = parseMyAnimeListPeopleId(person.url) || `${person.mal_id}`;
      const resolvedRole = roleMap.get(normalizeKey(person.name)) || 'author';
      const draft = await getCachedMalPersonDraft(
        personCache,
        personId,
        person.url,
        resolvedRole === 'artist' ? 'artist' : 'author',
        !!enabledOptions.gallery,
      );

      if (resolvedRole === 'artist') {
        preview.artists.push(draft);
      } else if (resolvedRole === 'both') {
        preview.authors.push(draft);
        preview.artists.push({ ...draft, details: { ...draft.details, role: 'Çizer' } });
      } else {
        preview.authors.push(draft);
      }
    }
  }

  if (enabledOptions.characters) {
    const characterRows = await getJikan<any[]>(`/manga/${malId}/characters`);
    const limitedRows = characterRows.slice(0, MAX_IMPORT_ENTITY_COUNT);

    for (const entry of limitedRows) {
      const characterId = `${entry.character?.mal_id || ''}`;
      if (!characterId) {
        continue;
      }

      preview.characters.push(
        await buildMalCharacterDraft(
          characterId,
          entry.character.url,
          normalizeText(entry.role) || undefined,
          !!enabledOptions.gallery,
        ),
      );
    }
  }

  return preview;
};

const getInfoBoxText = (doc: Document, key: string) => {
  const element = doc.querySelector(`[data-cy="info-box-${key}"]`);
  return normalizeText(element?.textContent);
};

const getInfoBoxContentByLabel = (doc: Document, label: string) => {
  const normalizedLabel = normalizeKey(label);
  const headers = Array.from(doc.querySelectorAll('[data-cy$="-header"]'));

  for (const header of headers) {
    if (normalizeKey(header.textContent) !== normalizedLabel) {
      continue;
    }

    const content = header.nextElementSibling;
    if (content && content.getAttribute('data-cy')?.startsWith('info-box-')) {
      return content;
    }
  }

  return null;
};

const getInfoBoxTextByLabel = (doc: Document, label: string) => {
  const content = getInfoBoxContentByLabel(doc, label);
  return normalizeText(content?.textContent);
};

const getInfoBoxHrefByLabel = (doc: Document, label: string) => {
  const content = getInfoBoxContentByLabel(doc, label);
  const href = normalizeText(content?.querySelector('a[href]')?.getAttribute('href'));
  return href.startsWith('http') ? href : '';
};

const getInfoBoxLines = (doc: Document, key: string) => {
  const element = doc.querySelector(`[data-cy="info-box-${key}"]`);
  if (!element) {
    return [];
  }

  return Array.from(element.querySelectorAll('div'))
    .map((line) => normalizeText(line.textContent))
    .filter(Boolean);
};

const getInfoBoxLinks = (doc: Document, key: string) => {
  const element = doc.querySelector(`[data-cy="info-box-${key}"]`);
  if (!element) {
    return [] as Array<{ title: string; url: string; meta?: string }>;
  }

  return Array.from(element.querySelectorAll('a[href]'))
    .map((anchor) => ({
      title: normalizeText(anchor.textContent),
      url: normalizeText(anchor.getAttribute('href')),
      meta: normalizeText(anchor.parentElement?.textContent?.replace(anchor.textContent || '', '')) || undefined,
    }))
    .filter((item) => item.title && item.url.startsWith('http'));
};

const getMangaUpdatesTitle = (doc: Document) =>
  normalizeText(doc.querySelector('.releasestitle.tabletitle')?.textContent);

const getMangaUpdatesImage = (doc: Document) => {
  const image = doc.querySelector('[data-cy="info-box-image"] img');
  return normalizeText(image?.getAttribute('src') || image?.getAttribute('data-src'));
};

const getMangaUpdatesStructuredData = (doc: Document) => {
  const scripts = Array.from(doc.querySelectorAll('script[type="application/ld+json"]'));

  for (const script of scripts) {
    try {
      const parsed = JSON.parse(script.textContent || '{}');
      if (parsed && typeof parsed === 'object' && parsed.url) {
        return parsed as Record<string, any>;
      }
    } catch {
      continue;
    }
  }

  return null;
};

const parseMangaUpdatesDescriptionBlock = (value?: string | null) => {
  const raw = normalizeText(value);
  if (!raw) {
    return { description: undefined, originalWebtoon: [] as string[], officialTranslations: [] as string[] };
  }

  const originalMatch = raw.match(/Original Webtoon:\s*(.+?)(?=Official Translations:|$)/i);
  const translationsMatch = raw.match(/Official Translations:\s*(.+)$/i);
  const description = raw
    .replace(/Original Webtoon:\s*.+?(?=Official Translations:|$)/i, '')
    .replace(/Official Translations:\s*.+$/i, '')
    .trim();

  return {
    description: description || undefined,
    originalWebtoon: uniqueStrings((originalMatch?.[1] || '').split(/[,;]+/)),
    officialTranslations: uniqueStrings((translationsMatch?.[1] || '').split(/[,;]+/)),
  };
};

const buildMangaUpdatesPersonDraft = async (
  sourceUrl: string,
  role: 'author' | 'artist',
): Promise<ImportedPersonDraft> => {
  const html = await fetchScraperContent(sourceUrl);
  const doc = parseHtml(html);
  const title = getMangaUpdatesTitle(doc) || normalizeText(doc.title.replace(' - MangaUpdates', ''));
  const website = getInfoBoxHrefByLabel(doc, 'Official Website') || undefined;
  const twitter = getInfoBoxHrefByLabel(doc, 'Twitter') || undefined;

  return createImportedPersonDraft('mangaupdates', title, sourceUrl, {
    imageUrl: getMangaUpdatesImage(doc) || undefined,
    description: getInfoBoxTextByLabel(doc, 'Comments') || undefined,
    alternativeNames: getInfoBoxLines(doc, 'associated'),
    details: {
      nativeName: getInfoBoxTextByLabel(doc, 'Name (in native language)') || undefined,
      status: getInfoBoxTextByLabel(doc, 'Status') || undefined,
      birthDate: getInfoBoxTextByLabel(doc, 'Birth Date') || undefined,
      birthPlace: getInfoBoxTextByLabel(doc, 'Birth Place') || undefined,
      zodiac: getInfoBoxTextByLabel(doc, 'Zodiac') || undefined,
      bloodType: getInfoBoxTextByLabel(doc, 'Blood Type') || undefined,
      gender: getInfoBoxTextByLabel(doc, 'Gender') || undefined,
      website,
      twitter,
      genres: uniqueStrings(getInfoBoxLinks(doc, 'genres').map((item) => item.title)),
      role: role === 'artist' ? 'Çizer' : 'Yazar',
    },
    sourceLinks: mergeSourceLinks(
      [createSourceLink('mangaupdates', sourceUrl, 'person', title)],
      website
        ? [{ source: 'mangaupdates', url: website, kind: 'external', label: 'Official Website' }]
        : undefined,
      twitter
        ? [{ source: 'mangaupdates', url: twitter, kind: 'external', label: 'Twitter' }]
        : undefined,
    ),
  });
};

const searchMangaUpdatesCandidates = async (input: string): Promise<SourceSearchCandidate[]> => {
  if (MANGA_UPDATES_HOST_PATTERN.test(input) && input.includes('/series/')) {
    return [{
      id: parseMangaUpdatesSeriesPath(input) || input,
      source: 'mangaupdates',
      title: normalizeText(input.split('/').pop()?.replace(/-/g, ' ')) || 'MangaUpdates series',
      url: input,
    }];
  }

  const searchUrl = MANGA_UPDATES_HOST_PATTERN.test(input)
    ? input
    : `https://www.mangaupdates.com/site/search/result?search=${encodeURIComponent(input)}`;
  const html = await fetchScraperContent(searchUrl);
  const doc = parseHtml(html);
  const anchors = Array.from(doc.querySelectorAll('a[href*="/series/"]'));
  const seen = new Set<string>();
  const results: SourceSearchCandidate[] = [];

  for (const anchor of anchors) {
    const title = normalizeText(anchor.textContent);
    const url = normalizeText(anchor.getAttribute('href'));
    if (!title || !url || seen.has(url)) {
      continue;
    }

    seen.add(url);
    results.push({
      id: parseMangaUpdatesSeriesPath(url) || url,
      source: 'mangaupdates',
      title,
      url,
    });

    if (results.length >= 8) {
      break;
    }
  }

  return results;
};

const loadMangaUpdatesPreview = async (
  candidate: SourceSearchCandidate,
  enabledOptions: Partial<Record<ImportOptionKey, boolean>>,
): Promise<ImportedMangaPayload> => {
  const html = await fetchScraperContent(candidate.url);
  const doc = parseHtml(html);
  const structuredData = getMangaUpdatesStructuredData(doc);
  const parsedDescription = parseMangaUpdatesDescriptionBlock(
    structuredData?.description || getInfoBoxText(doc, 'description'),
  );
  const preview = createEmptyPreview('mangaupdates', candidate.url, getMangaUpdatesTitle(doc) || candidate.title);

  preview.cover = normalizeText(structuredData?.image) || getMangaUpdatesImage(doc) || undefined;
  preview.description = parsedDescription.description || undefined;
  preview.alternativeTitles = uniqueStrings([
    ...(structuredData?.alternateName || []),
    ...getInfoBoxLines(doc, 'associated'),
  ]);
  preview.genres = uniqueStrings([
    ...(structuredData?.genre || []),
    ...getInfoBoxLinks(doc, 'genres').map((item) => item.title),
  ]);
  preview.tags = preview.genres.slice();
  preview.relatedSeries = getInfoBoxLines(doc, 'related_series').map((line) => {
    const match = line.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
    return {
      title: normalizeText(match?.[1] || line),
      relationType: normalizeRelationType(match?.[2]),
    };
  });
  preview.details = {
    originalPublisher: uniqueStrings([
      ...getInfoBoxLinks(doc, 'original_publisher').map((item) => item.title),
      ...((structuredData?.publisher || []) as Array<{ name?: string }>).map((item) => item.name || ''),
    ]).join(', ') || undefined,
    officialTranslations: parsedDescription.officialTranslations,
    originalWebtoon: parsedDescription.originalWebtoon,
    genres: preview.genres,
    status: getInfoBoxText(doc, 'status') || undefined,
    startDate: undefined,
    endDate: undefined,
    sourceMaterial: getInfoBoxText(doc, 'type') || undefined,
    extra: {
      typeLabel: getInfoBoxText(doc, 'type') || undefined,
      year: toYear(getInfoBoxText(doc, 'year') || structuredData?.datePublished),
      statusInOrigin: getInfoBoxText(doc, 'status') || undefined,
    },
  };

  if (enabledOptions.authors) {
    for (const link of getInfoBoxLinks(doc, 'authors')) {
      preview.authors.push(await buildMangaUpdatesPersonDraft(link.url, 'author'));
    }
  }

  if (enabledOptions.artists) {
    for (const link of getInfoBoxLinks(doc, 'artists')) {
      preview.artists.push(await buildMangaUpdatesPersonDraft(link.url, 'artist'));
    }
  }

  preview.details.comments = getInfoBoxText(doc, 'status') || undefined;

  return preview;
};

const toAnimePlanetAbsoluteUrl = (value?: string | null) => (
  value ? toAbsoluteUrl(value, ANIME_PLANET_BASE_URL) : ''
);

const getAnimePlanetCanonicalMangaUrl = (input: string) => {
  const slug = parseAnimePlanetMangaSlug(input);
  return slug ? `${ANIME_PLANET_BASE_URL}/manga/${slug}` : normalizeText(input);
};

const getAnimePlanetTooltipAltTitles = (value?: string | null) => {
  const tooltipHtml = normalizeText(value);
  if (!tooltipHtml) {
    return undefined;
  }

  const doc = parseHtmlFragment(tooltipHtml);
  return normalizeText(doc.querySelector('.tooltip-alt')?.textContent).replace(/^(alt titles?|aka):\s*/i, '') || undefined;
};

const classifyAnimePlanetStaffRole = (value?: string | null): 'author' | 'artist' | undefined => {
  const normalized = normalizeKey(value);

  if (!normalized) {
    return undefined;
  }

  if (normalized.includes('artist')) {
    return 'artist';
  }

  if (
    normalized.includes('creator')
    || normalized.includes('author')
    || normalized.includes('writer')
    || normalized.includes('story')
  ) {
    return 'author';
  }

  return undefined;
};

const parseAnimePlanetStaffCards = (doc: Document) => {
  const seen = new Set<string>();

  return Array.from(doc.querySelectorAll<HTMLAnchorElement>('a.CharacterCard[data-character-type="people"][href]'))
    .map((anchor) => {
      const url = toAnimePlanetAbsoluteUrl(anchor.getAttribute('href'));
      const name = normalizeText(anchor.querySelector('.CharacterCard__title')?.textContent);
      const roleLabel = normalizeText(anchor.querySelector('.CharacterCard__body')?.textContent);
      const kind = classifyAnimePlanetStaffRole(roleLabel);

      if (!url || !name || seen.has(url)) {
        return null;
      }

      seen.add(url);
      return { name, url, roleLabel, kind };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);
};

const buildAnimePlanetPersonDraft = async (
  sourceUrl: string,
  role: 'author' | 'artist',
): Promise<ImportedPersonDraft> => {
  const html = await fetchAnimePlanetHtml(sourceUrl);
  const doc = parseHtml(html);
  const title = getAnimePlanetTitle(doc) || normalizeText(doc.title.replace(/\s*\|\s*Anime-Planet\s*$/i, ''));
  const descriptionHost = doc.querySelector('div[itemprop="description"]')?.parentElement;
  let description = '';

  if (descriptionHost) {
    const clone = descriptionHost.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('.EntryMetadata, .staffLinks, .myFeelings, .cta, table, h3, h4, h5, .commentSection, .tab').forEach((element) => element.remove());
    description = normalizeText(clone.textContent);
  }

  const externalLinks = Array.from(doc.querySelectorAll<HTMLAnchorElement>('.staffLinks a[href]'))
    .map((anchor) => ({
      url: normalizeText(anchor.getAttribute('href')),
      label: normalizeText(anchor.textContent) || undefined,
    }))
    .filter((item) => item.url.startsWith('http'));

  return createImportedPersonDraft('animeplanet', title, sourceUrl, {
    imageUrl: sanitizeEntityImageUrl(
      doc.querySelector('img[itemprop="image"], img.screenshots')?.getAttribute('src'),
    ),
    description: description || undefined,
    alternativeNames: getAnimePlanetAltTitles(doc),
    details: {
      website: externalLinks[0]?.url || undefined,
      role: role === 'artist' ? 'Çizer' : 'Yazar',
      extra: parseAnimePlanetPeopleSlug(sourceUrl)
        ? { animePlanetSlug: parseAnimePlanetPeopleSlug(sourceUrl) }
        : undefined,
    },
    sourceLinks: [
      createSourceLink('animeplanet', sourceUrl, 'person', title),
      ...externalLinks.map((item) => ({
        source: 'animeplanet' as const,
        url: item.url,
        kind: 'external',
        label: item.label,
      })),
    ],
  });
};

const buildAnimePlanetCharacterDraft = async (
  sourceUrl: string,
  roleLabel: string | undefined,
  fallbackName: string,
  fallbackImageUrl: string | undefined,
  fallbackTags: string[],
): Promise<ImportedCharacterDraft> => {
  const html = await fetchAnimePlanetHtml(sourceUrl);
  const doc = parseHtml(html);
  const roleType = normalizeCharacterListingRole(roleLabel);
  const localizedRoleLabel = getCharacterListingRoleLabel(roleType) || normalizeText(roleLabel) || undefined;
  const statValues = Array.from(doc.querySelectorAll('.entryBar > div'))
    .map((item) => normalizeText(item.textContent))
    .filter(Boolean);
  const detailMap = new Map<string, string>();

  for (const stat of statValues) {
    const pairMatch = stat.match(/^([^:]+):\s*(.+)$/);
    if (pairMatch) {
      detailMap.set(normalizeKey(pairMatch[1]), normalizeText(pairMatch[2]));
    }
  }

  const lovedRankMatch = statValues.find((item) => /rank\s*#\d+/i.test(item));
  const rankValue = lovedRankMatch?.match(/#([\d,]+)/)?.[1];
  const tags = uniqueStrings([...fallbackTags, ...getAnimePlanetTags(doc)]);
  const title = getAnimePlanetTitle(doc) || fallbackName;

  return {
    ...createImportedPersonDraft('animeplanet', title, sourceUrl, {
      imageUrl: sanitizeEntityImageUrl(
        doc.querySelector('img[itemprop="image"], img.screenshots')?.getAttribute('src')
        || fallbackImageUrl,
      ),
      description: undefined,
      alternativeNames: getAnimePlanetAltTitles(doc),
      details: {
        gender: detailMap.get('gender') || getMetaContent(doc, 'property', 'profile:gender') || undefined,
        tags,
        extra: {
          ...(detailMap.get('hair color') ? { hairColor: detailMap.get('hair color') } : {}),
          ...(detailMap.get('eye color') ? { eyeColor: detailMap.get('eye color') } : {}),
          ...(rankValue ? { animePlanetLovedRank: Number(rankValue.replace(/,/g, '')) } : {}),
          ...(parseAnimePlanetCharacterSlug(sourceUrl) ? { animePlanetSlug: parseAnimePlanetCharacterSlug(sourceUrl) } : {}),
        },
      },
      sourceLinks: [createSourceLink('animeplanet', sourceUrl, 'character', title)],
    }),
    roleLabel: localizedRoleLabel,
    roleType,
  };
};

const parseAnimePlanetCharacterSection = (doc: Document) => {
  const seen = new Set<string>();
  const results: Array<{
    name: string;
    url: string;
    imageUrl?: string;
    tags: string[];
    roleLabel?: string;
    roleType?: CharacterListingRole;
  }> = [];

  for (const heading of Array.from(doc.querySelectorAll('h3.sub'))) {
    const headingText = normalizeText(heading.textContent);
    const roleType = normalizeCharacterListingRole(headingText);
    const localizedRoleLabel = getCharacterListingRoleLabel(roleType) || headingText || undefined;
    let table = heading.nextElementSibling;

    while (table && table.tagName !== 'TABLE') {
      table = table.nextElementSibling;
    }

    if (!table) {
      continue;
    }

    for (const row of Array.from(table.querySelectorAll('tr'))) {
      const anchor = row.querySelector<HTMLAnchorElement>('td.tableCharInfo a.name[href], td.tableAvatar a[href]');
      const name = normalizeText(row.querySelector('td.tableCharInfo a.name')?.textContent || anchor?.textContent);
      const url = toAnimePlanetAbsoluteUrl(anchor?.getAttribute('href'));

      if (!name || !url || seen.has(url)) {
        continue;
      }

        seen.add(url);
        results.push({
          name,
          url,
          imageUrl: sanitizeEntityImageUrl(
            getImageUrlFromElement(row.querySelector('td.tableAvatar img')),
          ),
          tags: uniqueStrings(
            Array.from(row.querySelectorAll('.tags a[href]')).map((tag) => normalizeText(tag.textContent)),
          ),
          roleLabel: localizedRoleLabel,
        roleType,
      });
    }
  }

  return results;
};

const searchAnimePlanetCandidates = async (input: string): Promise<SourceSearchCandidate[]> => {
  const slug = ANIME_PLANET_HOST_PATTERN.test(input) ? parseAnimePlanetMangaSlug(input) : undefined;

  if (slug) {
    const url = `${ANIME_PLANET_BASE_URL}/manga/${slug}`;

    try {
      const html = await fetchAnimePlanetHtml(url);
      const doc = parseHtml(html);
      return [{
        id: slug,
        source: 'animeplanet',
        title: getAnimePlanetTitle(doc) || normalizeText(slug.replace(/-/g, ' ')) || 'Anime-Planet manga',
        subtitle: getAnimePlanetAltTitles(doc).slice(0, 2).join(', ') || undefined,
        url,
        imageUrl: getAnimePlanetCover(doc),
      }];
    } catch {
      return [{
        id: slug,
        source: 'animeplanet',
        title: normalizeText(slug.replace(/-/g, ' ')) || 'Anime-Planet manga',
        url,
      }];
    }
  }

  const searchUrl = `${ANIME_PLANET_BASE_URL}/manga/all?name=${encodeURIComponent(input)}`;
  const html = await fetchAnimePlanetHtml(searchUrl);
  const doc = parseHtml(html);
  const results: SourceSearchCandidate[] = [];
  const seen = new Set<string>();

  for (const anchor of Array.from(doc.querySelectorAll<HTMLAnchorElement>('a.tooltip[href^="/manga/"]'))) {
    const url = toAnimePlanetAbsoluteUrl(anchor.getAttribute('href'));
    const title = normalizeText(anchor.querySelector('.cardName')?.textContent || anchor.getAttribute('aria-label'));

    if (!url || !title || seen.has(url) || url.includes('/manga/all')) {
      continue;
    }

    seen.add(url);
    results.push({
      id: parseAnimePlanetMangaSlug(url) || url,
      source: 'animeplanet',
      title,
      subtitle: getAnimePlanetTooltipAltTitles(anchor.getAttribute('title')) || undefined,
      url,
      imageUrl: sanitizeEntityImageUrl(
        anchor.querySelector<HTMLImageElement>('img')?.getAttribute('data-src')
        || anchor.querySelector<HTMLImageElement>('img')?.getAttribute('src'),
      ),
    });

    if (results.length >= 8) {
      break;
    }
  }

  return results;
};

const loadAnimePlanetPreview = async (
  candidate: SourceSearchCandidate,
  enabledOptions: Partial<Record<ImportOptionKey, boolean>>,
): Promise<ImportedMangaPayload> => {
  const mangaUrl = getAnimePlanetCanonicalMangaUrl(candidate.url);
  const html = await fetchAnimePlanetHtml(mangaUrl);
  const doc = parseHtml(html);
  const structuredData = getAnimePlanetStructuredData(doc);
  const tags = getAnimePlanetTags(doc);
  const genres = getAnimePlanetGenreSubset(tags);
  const preview = createEmptyPreview('animeplanet', mangaUrl, getAnimePlanetTitle(doc) || candidate.title);
  const { startDate, endDate } = parseAnimePlanetYearRange(doc);
  const publisherLabel = getAnimePlanetPublisherLabel(doc);
  const notes = getAnimePlanetNotes(doc);

  preview.cover = getAnimePlanetCover(doc) || undefined;
  preview.description = getAnimePlanetDescription(doc);
  preview.alternativeTitles = uniqueStrings([
    preview.sourceTitle,
    ...(structuredData?.alternateName || []),
    ...getAnimePlanetAltTitles(doc),
  ]);
  preview.tags = tags;
  preview.genres = genres;
  preview.relatedSeries = Array.from(doc.querySelectorAll<HTMLAnchorElement>('a.RelatedEntry[href^="/manga/"]'))
    .map((anchor) => ({
      title: normalizeText(anchor.querySelector('.RelatedEntry__name')?.textContent),
      relationType: 'related',
      sourceUrl: toAnimePlanetAbsoluteUrl(anchor.getAttribute('href')) || undefined,
      cover: sanitizeEntityImageUrl(anchor.querySelector<HTMLImageElement>('.RelatedEntry__image')?.getAttribute('src')),
    }))
    .filter((item) => item.title);
  preview.details = {
    englishName: preview.sourceTitle,
    status: endDate ? 'Completed' : 'Ongoing',
    chapters: getAnimePlanetChapterCount(doc),
    popularity: getAnimePlanetTrackingCount(doc),
    averageScore: getAnimePlanetAverageScore(doc, structuredData),
    startDate: structuredData?.startDate || startDate,
    endDate: structuredData?.endDate || endDate,
    originalPublisher: publisherLabel || undefined,
    sourceMaterial: genres.find((genre) => /^(manga|manhwa|manhua|webtoon|webtoons)$/i.test(genre)) || undefined,
    genres,
    tags,
    comments: notes.join(' | ') || undefined,
    extra: {
      ...(getAnimePlanetRank(doc) ? { animePlanetRank: getAnimePlanetRank(doc) } : {}),
      ...(getAnimePlanetTrackingCount(doc) ? { animePlanetTrackingCount: getAnimePlanetTrackingCount(doc) } : {}),
      ...(getAnimePlanetVoteCount(doc, structuredData) ? { animePlanetVoteCount: getAnimePlanetVoteCount(doc, structuredData) } : {}),
      ...(getAnimePlanetSourceMaterial(tags) ? { adaptedFrom: getAnimePlanetSourceMaterial(tags) } : {}),
      ...(publisherLabel ? { publisherLabel } : {}),
      ...(parseAnimePlanetMangaSlug(mangaUrl) ? { animePlanetSlug: parseAnimePlanetMangaSlug(mangaUrl) } : {}),
    },
  };

  if (enabledOptions.authors || enabledOptions.artists) {
    const staffHtml = await fetchAnimePlanetHtml(`${mangaUrl}/staff`);
    const staffDoc = parseHtml(staffHtml);
    const staffCards = parseAnimePlanetStaffCards(staffDoc);
    const unsupportedRoles = uniqueStrings(
      staffCards
        .filter((item) => !item.kind)
        .map((item) => item.roleLabel),
    );

    if (unsupportedRoles.length > 0) {
      preview.warnings.push(
        `Anime-Planet staff sayfasındaki şu roller şu an içe aktarılmıyor: ${unsupportedRoles.join(', ')}.`,
      );
    }

    const personCache = new Map<string, ImportedPersonDraft>();
    const supportedCards = staffCards.filter((item) => item.kind && (
      (item.kind === 'author' && enabledOptions.authors)
      || (item.kind === 'artist' && enabledOptions.artists)
    ));

    const drafts = await mapWithConcurrency(supportedCards, 4, async (item) => {
      const cached = personCache.get(item.url);
      if (cached) {
        return { kind: item.kind!, draft: cached };
      }

      const draft = await buildAnimePlanetPersonDraft(item.url, item.kind!);
      personCache.set(item.url, draft);
      return { kind: item.kind!, draft };
    });

    for (const entry of drafts) {
      if (entry.kind === 'artist') {
        preview.artists.push(entry.draft);
      } else {
        preview.authors.push(entry.draft);
      }
    }
  }

  if (enabledOptions.characters) {
    const characterHtml = await fetchAnimePlanetHtml(`${mangaUrl}/characters`);
    const characterDoc = parseHtml(characterHtml);
    const characterRows = parseAnimePlanetCharacterSection(characterDoc).slice(0, MAX_IMPORT_ENTITY_COUNT);
    const drafts = await mapWithConcurrency(characterRows, 4, async (item) => (
      buildAnimePlanetCharacterDraft(
        item.url,
        item.roleLabel,
        item.name,
        item.imageUrl,
        item.tags,
      )
    ));

    preview.characters.push(...drafts);
  }

  return preview;
};

interface AniSearchSitemapEntry {
  id: string;
  slug: string;
  titleGuess: string;
  url: string;
  searchKey: string;
}

let aniSearchSitemapEntriesPromise: Promise<AniSearchSitemapEntry[]> | null = null;

const toSearchComparable = (value?: string | null) => normalizeKey(value)
  .normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9]+/g, ' ')
  .trim();

const tokenizeSearchComparable = (value?: string | null) => toSearchComparable(value)
  .split(/\s+/)
  .filter((token) => token.length > 1);

const toAniSearchAbsoluteUrl = (value?: string | null) => {
  const normalized = normalizeText(value);
  return normalized ? toAbsoluteUrl(normalized, ANISEARCH_BASE_URL) : '';
};

const getAniSearchCanonicalMangaUrl = (value: string) => {
  const normalized = normalizeText(value);

  if (!normalized) {
    return '';
  }

  if (/^\d+$/.test(normalized)) {
    return `${ANISEARCH_BASE_URL}/manga/${normalized}`;
  }

  return toAniSearchAbsoluteUrl(normalized).replace(/\/+$/, '');
};

const parseAniSearchStructuredData = (doc: Document) => {
  const scripts = Array.from(doc.querySelectorAll('script[type="application/ld+json"]'));

  for (const script of scripts) {
    try {
      const parsed = JSON.parse(script.textContent || '{}');
      const candidateList = Array.isArray(parsed)
        ? parsed
        : parsed?.['@graph'] && Array.isArray(parsed['@graph'])
          ? parsed['@graph']
          : [parsed];
      const candidate = candidateList.find((item) => (
        item
        && typeof item === 'object'
        && (
          item['@type'] === 'BookSeries'
          || item['@type'] === 'Book'
          || item['@type'] === 'Person'
        )
      ));

      if (candidate) {
        return candidate as Record<string, any>;
      }
    } catch {
      continue;
    }
  }

  return null;
};

const stripAniSearchSourceFooter = (value?: string | null) => (
  normalizeText(value)
    .replace(/\s*source:\s*www\.anisearch\.[^\s]+\/[^\s]+/i, '')
    .replace(/\s*quelle:\s*www\.anisearch\.[^\s]+\/[^\s]+/i, '')
    .trim()
);

const getAniSearchTitle = (doc: Document) => {
  const heading = doc.querySelector('#htitle');
  if (!(heading instanceof HTMLElement)) {
    return '';
  }

  const clone = heading.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('.release_year').forEach((element) => element.remove());
  return normalizeText(clone.textContent);
};

const getAniSearchSubheader = (doc: Document) => normalizeText(doc.querySelector('.subheader')?.textContent);

const getAniSearchCover = (doc: Document) => sanitizeEntityImageUrl(
  doc.querySelector<HTMLImageElement>('#details-cover')?.getAttribute('src')
  || getMetaContent(doc, 'property', 'og:image'),
);

const getAniSearchInfoValue = (doc: Document, className: string) => {
  const block = doc.querySelector(`#information .${className}`);
  if (!(block instanceof HTMLElement)) {
    return '';
  }

  const clone = block.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('.header, .flag, .cspoiler1, .cspoiler2, .show_cspoiler, .showallB, .addEpisode').forEach((element) => element.remove());
  return normalizeText(clone.textContent);
};

const getAniSearchInfoLinks = (doc: Document, className: string) => (
  Array.from(doc.querySelectorAll<HTMLAnchorElement>(`#information .${className} a[href]`))
    .map((anchor) => ({
      url: toAniSearchAbsoluteUrl(anchor.getAttribute('href')),
      label: normalizeText(anchor.textContent) || undefined,
    }))
    .filter((item) => item.url)
);

const extractAniSearchTitleVariants = (doc: Document) => {
  const values = new Set<string>();

  const appendValue = (value?: string | null) => {
    const normalized = normalizeText(value);
    if (normalized) {
      values.add(normalized);
    }
  };

  const appendDelimitedValues = (value?: string | null) => {
    for (const part of normalizeText(value).split(/\s*\/\s*|\s*,\s*/)) {
      appendValue(part);
    }
  };

  appendDelimitedValues(getAniSearchSubheader(doc));

  for (const titleBlock of Array.from(doc.querySelectorAll<HTMLElement>('#information .title[lang]'))) {
    appendValue(titleBlock.querySelector('strong')?.textContent);
    appendValue(titleBlock.querySelector('.grey')?.textContent);

    const clone = titleBlock.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('img, .flag, .cspoiler1, .cspoiler2').forEach((element) => element.remove());
    appendDelimitedValues(
      Array.from(clone.querySelectorAll('i, em'))
        .map((element) => normalizeText(element.textContent))
        .join(', '),
    );
  }

  return Array.from(values);
};

const parseAniSearchDate = (value?: string | null) => {
  const normalized = normalizeText(value);
  const match = normalized.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (!match) {
    return undefined;
  }

  return `${match[3]}-${match[2]}-${match[1]}`;
};

const parseAniSearchPublishedRange = (value?: string | null) => {
  const normalized = normalizeText(value).replace(/[–—‑]/g, '-');
  if (!normalized) {
    return { startDate: undefined, endDate: undefined };
  }

  const parts = normalized.split(/\s*-\s*/);
  return {
    startDate: parseAniSearchDate(parts[0]),
    endDate: parseAniSearchDate(parts[1]),
  };
};

const toOptionalPositiveInteger = (value?: string | null) => {
  const digits = normalizeText(value).replace(/[^\d]/g, '');
  if (!digits) {
    return undefined;
  }

  const parsed = Number(digits);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
};

const parseAniSearchVolumesAndChapters = (value?: string | null) => {
  const normalized = normalizeText(value);
  const match = normalized.match(/^([\d?]+)\s*\/\s*([\d?+]+)$/);

  if (!match) {
    return { volumes: undefined, chapters: undefined };
  }

  return {
    volumes: toOptionalPositiveInteger(match[1]),
    chapters: toOptionalPositiveInteger(match[2]),
  };
};

const getAniSearchSidebarStat = (doc: Document, label: string) => {
  const rows = Array.from(doc.querySelectorAll('#status tr'));
  const normalizedLabel = normalizeKey(label);

  for (const row of rows) {
    for (const cell of Array.from(row.querySelectorAll('td'))) {
      const textLabel = normalizeKey(cell.querySelector('.afake')?.textContent || cell.textContent);
      if (!textLabel.includes(normalizedLabel)) {
        continue;
      }

      return toOptionalPositiveInteger(cell.querySelector('b')?.textContent || cell.textContent);
    }
  }

  return undefined;
};

const classifyAniSearchStaffRole = (value?: string | null): 'author' | 'artist' => {
  const normalized = normalizeKey(value);

  if (
    normalized.includes('illustrator')
    || normalized.includes('artist')
    || normalized.includes('art')
  ) {
    return 'artist';
  }

  return 'author';
};

const parseAniSearchStaffEntries = (doc: Document) => {
  const block = doc.querySelector('#information .mangaka');
  if (!(block instanceof HTMLElement)) {
    return [] as Array<{ name: string; url: string; roleLabel: string; kind: 'author' | 'artist' }>;
  }

  const entries: Array<{ name: string; url: string; roleLabel: string; kind: 'author' | 'artist' }> = [];
  let pending: Array<{ name: string; url: string }> = [];

  const flushPending = (roleLabel?: string | null) => {
    const normalizedRoleLabel = normalizeText(roleLabel) || 'Author';

    for (const item of pending) {
      entries.push({
        ...item,
        roleLabel: normalizedRoleLabel,
        kind: classifyAniSearchStaffRole(normalizedRoleLabel),
      });
    }

    pending = [];
  };

  for (const node of Array.from(block.childNodes)) {
    if (node instanceof HTMLAnchorElement && /\/person\//i.test(node.getAttribute('href') || '')) {
      const name = normalizeText(node.textContent);
      const url = toAniSearchAbsoluteUrl(node.getAttribute('href'));

      if (name && url) {
        pending.push({ name, url });
      }

      continue;
    }

    if (node instanceof HTMLElement && node.matches('span.f10g')) {
      flushPending(node.textContent);
    }
  }

  flushPending();
  return entries;
};

const parseAniSearchCharacterSection = (doc: Document) => {
  const results: Array<{
    name: string;
    url: string;
    imageUrl?: string;
    roleLabel?: string;
    roleType?: CharacterListingRole;
  }> = [];
  const seen = new Set<string>();

  for (const section of Array.from(doc.querySelectorAll<HTMLElement>('section[id^="chara"]'))) {
    const headingText = normalizeText(section.querySelector('h2')?.textContent);
    const roleType = headingText.toLocaleLowerCase('tr-TR').includes('main')
      ? 'main'
      : headingText.toLocaleLowerCase('tr-TR').includes('secondary')
        ? 'supporting'
        : normalizeCharacterListingRole(headingText);
    const roleLabel = getCharacterListingRoleLabel(roleType) || headingText || undefined;

    for (const anchor of Array.from(section.querySelectorAll<HTMLAnchorElement>('a[href*="character/"]'))) {
      const url = toAniSearchAbsoluteUrl(anchor.getAttribute('href'));
      const name = normalizeText(anchor.querySelector('.title')?.textContent || anchor.getAttribute('title') || anchor.textContent);

      if (!url || !name || seen.has(url)) {
        continue;
      }

      seen.add(url);
      results.push({
        name,
        url,
        imageUrl: sanitizeEntityImageUrl(getImageUrlFromElement(anchor.querySelector('img'))),
        roleLabel,
        roleType,
      });
    }
  }

  return results;
};

const parseAniSearchRelatedSeries = (doc: Document, currentUrl: string) => uniqueByUrl(
  Array.from(doc.querySelectorAll<HTMLTableRowElement>('#relations_manga tbody tr'))
    .map((row) => {
      const anchor = row.querySelector<HTMLAnchorElement>('th a[href*="manga/"]');
      const title = normalizeText(anchor?.textContent);
      const sourceUrl = toAniSearchAbsoluteUrl(anchor?.getAttribute('href'));
      const relationText = normalizeText(row.querySelector('th span')?.textContent);
      const tooltipHtml = row.querySelector('th')?.getAttribute('data-tooltip');
      const tooltipDoc = tooltipHtml ? parseHtmlFragment(tooltipHtml) : null;
      const cover = sanitizeEntityImageUrl(
        tooltipDoc?.querySelector('img')?.getAttribute('src'),
      );

      if (!title || !sourceUrl || sourceUrl === currentUrl) {
        return null;
      }

      return {
        title,
        relationType: normalizeRelationType(relationText),
        sourceUrl,
        cover,
      };
    })
    .filter((item): item is ImportedRelatedSeriesDraft => item !== null),
);

const sanitizeAniSearchCharacterDescription = (value?: string | null) => {
  const normalized = stripAniSearchSourceFooter(value);

  if (
    !normalized
    || /^a short plot summary about the character/i.test(normalized)
    || /would help many anime and manga fans/i.test(normalized)
  ) {
    return undefined;
  }

  return sanitizeCharacterDescription(normalized) || undefined;
};

const buildAniSearchPersonDraft = async (
  sourceUrl: string,
  role: 'author' | 'artist',
): Promise<ImportedPersonDraft> => {
  const html = await fetchAniSearchHtml(sourceUrl);
  const doc = parseHtml(html);
  const nameBlock = doc.querySelector('#information .name-type-1');
  const title = getAniSearchTitle(doc) || normalizeText(nameBlock?.querySelector('strong')?.textContent);
  const aliases = uniqueStrings(
    normalizeText(nameBlock?.querySelector('i')?.textContent)
      .split(/\s*,\s*/)
      .filter(Boolean),
  );
  const originalScript = normalizeText(
    Array.from(nameBlock?.querySelectorAll('span') || [])
      .map((element) => normalizeText(element.textContent))
      .find((value) => value && !value.endsWith(':') && !value.toLocaleLowerCase('tr-TR').includes('screen name')),
  );

  return createImportedPersonDraft('anisearch', title || 'AniSearch person', sourceUrl, {
    imageUrl: sanitizeEntityImageUrl(
      doc.querySelector<HTMLImageElement>('#details-cover')?.getAttribute('src')
      || getMetaContent(doc, 'property', 'og:image'),
    ),
    description: stripAniSearchSourceFooter(doc.querySelector('#description .details-text[lang="en"], #description .details-text')?.textContent) || undefined,
    alternativeNames: mergeStringLists(aliases, originalScript ? [originalScript] : []),
    details: {
      nativeName: originalScript || undefined,
      gender: getAniSearchInfoValue(doc, 'gender') || undefined,
      occupation: getAniSearchInfoValue(doc, 'occupations') || undefined,
      role: role === 'artist' ? 'Çizer' : 'Yazar',
      extra: parseAniSearchPeopleId(sourceUrl)
        ? { aniSearchPersonId: parseAniSearchPeopleId(sourceUrl) }
        : undefined,
    },
    sourceLinks: [createSourceLink('anisearch', sourceUrl, 'person', title || 'AniSearch person')],
  });
};

const buildAniSearchCharacterDraft = async (
  sourceUrl: string,
  roleLabel: string | undefined,
  fallbackName: string,
  fallbackImageUrl?: string,
): Promise<ImportedCharacterDraft> => {
  const html = await fetchAniSearchHtml(sourceUrl);
  const doc = parseHtml(html);
  const title = getAniSearchTitle(doc) || fallbackName;
  const roleType = normalizeCharacterListingRole(roleLabel);
  const localizedRoleLabel = getCharacterListingRoleLabel(roleType) || normalizeText(roleLabel) || undefined;
  const occupation = uniqueStrings(
    Array.from(doc.querySelectorAll<HTMLElement>('#information .occupation'))
      .map((element) => {
        const clone = element.cloneNode(true) as HTMLElement;
        clone.querySelectorAll('.header').forEach((item) => item.remove());
        return normalizeText(clone.textContent);
      })
      .filter(Boolean),
  ).join(', ');
  const tags = uniqueStrings(
    Array.from(doc.querySelectorAll('#description .cloud a'))
      .map((anchor) => normalizeText(anchor.textContent)),
  );

  return {
    ...createImportedPersonDraft('anisearch', title, sourceUrl, {
      imageUrl: getAniSearchCover(doc) || fallbackImageUrl,
      description: sanitizeAniSearchCharacterDescription(
        doc.querySelector('#description .details-text[lang="en"], #description .details-text')?.textContent,
      ),
      alternativeNames: extractAniSearchTitleVariants(doc),
      details: {
        gender: getAniSearchInfoValue(doc, 'gender') || undefined,
        age: getAniSearchInfoValue(doc, 'age') || undefined,
        nationality: getAniSearchInfoValue(doc, 'nationality') || undefined,
        occupation: occupation || undefined,
        tags,
        extra: {
          ...(getAniSearchInfoValue(doc, 'hair-color') ? { hairColor: getAniSearchInfoValue(doc, 'hair-color') } : {}),
          ...(getAniSearchInfoValue(doc, 'eye-color') ? { eyeColor: getAniSearchInfoValue(doc, 'eye-color') } : {}),
          ...(getAniSearchInfoValue(doc, 'height') ? { height: getAniSearchInfoValue(doc, 'height') } : {}),
          ...(parseAniSearchCharacterId(sourceUrl) ? { aniSearchCharacterId: parseAniSearchCharacterId(sourceUrl) } : {}),
        },
      },
      sourceLinks: [createSourceLink('anisearch', sourceUrl, 'character', title)],
    }),
    roleLabel: localizedRoleLabel,
    roleType,
  };
};

const readAniSearchGzipText = async (buffer: ArrayBuffer) => {
  const GzipStream = globalThis.DecompressionStream;

  if (!GzipStream) {
    throw new Error('AniSearch sitemap gzip çözümü bu tarayıcıda desteklenmiyor.');
  }

  const response = new Response(
    new Blob([buffer]).stream().pipeThrough(new GzipStream('gzip')),
  );

  return await response.text();
};

const loadAniSearchSitemapEntries = async (): Promise<AniSearchSitemapEntry[]> => {
  const sitemapIndexXml = await fetchScraperContent(ANISEARCH_SITEMAP_INDEX_URL);
  const sitemapIndexDoc = parseXml(sitemapIndexXml);
  const sitemapUrls = Array.from(sitemapIndexDoc.querySelectorAll('sitemap > loc'))
    .map((element) => normalizeText(element.textContent))
    .filter((url) => /\/manga_\(\d+\)\.xml\.gz$/i.test(url));

  const entryGroups = await mapWithConcurrency(sitemapUrls, 2, async (sitemapUrl) => {
    const compressed = await fetchScraperArrayBuffer(sitemapUrl);
    const xml = await readAniSearchGzipText(compressed);
    const doc = parseXml(xml);

    return Array.from(doc.querySelectorAll('url > loc'))
      .map((element) => normalizeText(element.textContent))
      .map((url) => {
        const id = parseAniSearchMangaId(url);
        const slug = parseAniSearchMangaSlug(url);

        if (!id || !slug) {
          return null;
        }

        const titleGuess = uniqueStrings(slug.split('-')).join(' ');

        return {
          id,
          slug,
          titleGuess: normalizeText(titleGuess) || slug,
          url,
          searchKey: toSearchComparable(`${slug} ${titleGuess}`),
        } satisfies AniSearchSitemapEntry;
      })
      .filter((item): item is AniSearchSitemapEntry => item !== null);
  });

  return uniqueByUrl(entryGroups.flat());
};

const getAniSearchSitemapEntries = async () => {
  if (!aniSearchSitemapEntriesPromise) {
    aniSearchSitemapEntriesPromise = loadAniSearchSitemapEntries().catch((error) => {
      aniSearchSitemapEntriesPromise = null;
      throw error;
    });
  }

  return aniSearchSitemapEntriesPromise;
};

const scoreAniSearchEntry = (query: string, entry: AniSearchSitemapEntry) => {
  const comparableQuery = toSearchComparable(query);
  const queryTokens = tokenizeSearchComparable(query);

  if (!comparableQuery) {
    return 0;
  }

  let score = 0;
  if (entry.id === comparableQuery) score += 1000;
  if (entry.searchKey === comparableQuery) score += 250;
  if (entry.slug === comparableQuery.replace(/\s+/g, '-')) score += 180;
  if (entry.searchKey.startsWith(comparableQuery)) score += 120;
  if (entry.searchKey.includes(comparableQuery)) score += 80;

  for (const token of queryTokens) {
    if (entry.searchKey.includes(token)) {
      score += 24;
    }
  }

  return score;
};

const resolveAniSearchCandidate = async (inputUrl: string, fallbackId?: string): Promise<SourceSearchCandidate> => {
  const html = await fetchAniSearchHtml(inputUrl);
  const doc = parseHtml(html);
  const canonicalUrl = normalizeText(doc.querySelector('link[rel="canonical"]')?.getAttribute('href')) || inputUrl;
  const title = getAniSearchTitle(doc) || normalizeText(fallbackId) || 'AniSearch manga';
  const subtitle = uniqueStrings(getAniSearchSubheader(doc).split(/\s*\/\s*/)).slice(0, 2).join(', ');

  return {
    id: parseAniSearchMangaId(canonicalUrl) || fallbackId || inputUrl,
    source: 'anisearch',
    title,
    subtitle: subtitle || undefined,
    url: canonicalUrl,
    imageUrl: getAniSearchCover(doc),
  };
};

const searchAniSearchCandidates = async (input: string): Promise<SourceSearchCandidate[]> => {
  const directUrl = ANISEARCH_HOST_PATTERN.test(input) ? getAniSearchCanonicalMangaUrl(input) : '';
  const directId = parseAniSearchMangaId(input);

  if (directUrl || directId) {
    const resolvedUrl = directUrl || getAniSearchCanonicalMangaUrl(directId!);

    try {
      return [await resolveAniSearchCandidate(resolvedUrl, directId || undefined)];
    } catch {
      return [{
        id: directId || resolvedUrl,
        source: 'anisearch',
        title: directId ? `AniSearch manga #${directId}` : 'AniSearch manga',
        url: resolvedUrl,
      }];
    }
  }

  const entries = await getAniSearchSitemapEntries();
  const rankedEntries = entries
    .map((entry) => ({ entry, score: scoreAniSearchEntry(input, entry) }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, ANISEARCH_SEARCH_RESULT_LIMIT);

  const enriched = await mapWithConcurrency(rankedEntries, 4, async ({ entry }) => {
    try {
      return await resolveAniSearchCandidate(entry.url, entry.id);
    } catch {
      return {
        id: entry.id,
        source: 'anisearch' as const,
        title: entry.titleGuess,
        url: entry.url,
      };
    }
  });

  return uniqueByUrl(enriched);
};

const loadAniSearchPreview = async (
  candidate: SourceSearchCandidate,
  enabledOptions: Partial<Record<ImportOptionKey, boolean>>,
): Promise<ImportedMangaPayload> => {
  const mangaUrl = getAniSearchCanonicalMangaUrl(candidate.url || candidate.id);
  const html = await fetchAniSearchHtml(mangaUrl);
  const doc = parseHtml(html);
  const canonicalUrl = normalizeText(doc.querySelector('link[rel="canonical"]')?.getAttribute('href')) || mangaUrl;
  const structuredData = parseAniSearchStructuredData(doc);
  const preview = createEmptyPreview('anisearch', canonicalUrl, getAniSearchTitle(doc) || candidate.title);
  const publishedText = getAniSearchInfoValue(doc, 'released');
  const publishedRange = parseAniSearchPublishedRange(publishedText);
  const volumeChapterCounts = parseAniSearchVolumesAndChapters(getAniSearchInfoValue(doc, 'releases'));
  const tags = uniqueStrings(
    Array.isArray(structuredData?.genre)
      ? structuredData.genre
      : typeof structuredData?.genre === 'string'
        ? structuredData.genre.split(/\s*,\s*/)
        : [],
  );
  const websiteLinks = getAniSearchInfoLinks(doc, 'websites');
  const ratingValue = Number(structuredData?.aggregateRating?.ratingValue || 0);
  const ratingCount = toOptionalPositiveInteger(structuredData?.aggregateRating?.ratingCount);
  const favorites = getAniSearchSidebarStat(doc, 'favourites');
  const nativeName = extractAniSearchTitleVariants(doc).find((value) => /[^\u0000-\u007f]/.test(value));

  preview.cover = getAniSearchCover(doc) || undefined;
  preview.description = stripAniSearchSourceFooter(
    doc.querySelector('#description .details-text[lang="en"], #description .details-text')?.textContent,
  ) || normalizeText(structuredData?.description) || undefined;
  preview.alternativeTitles = uniqueStrings([
    preview.sourceTitle,
    structuredData?.name,
    ...extractAniSearchTitleVariants(doc),
  ]);
  preview.tags = tags;
  preview.genres = tags.slice();
  preview.details = {
    englishName: preview.sourceTitle,
    nativeName: nativeName || undefined,
    status: getAniSearchInfoValue(doc, 'status') || undefined,
    chapters: volumeChapterCounts.chapters,
    volumes: volumeChapterCounts.volumes,
    favorites,
    averageScore: Number.isFinite(ratingValue) && ratingValue > 0 ? Math.round(ratingValue * 20) : undefined,
    startDate: structuredData?.startDate || publishedRange.startDate,
    endDate: structuredData?.endDate || publishedRange.endDate,
    originalPublisher: uniqueStrings(getAniSearchInfoLinks(doc, 'company').map((item) => item.label)).join(', ') || undefined,
    sourceMaterial: getAniSearchInfoValue(doc, 'type') || undefined,
    genres: preview.genres,
    tags: preview.tags,
    comments: getAniSearchInfoValue(doc, 'adapted') || undefined,
    extra: {
      ...(ratingCount ? { aniSearchRatingCount: ratingCount } : {}),
      ...(parseAniSearchMangaId(canonicalUrl) ? { aniSearchId: parseAniSearchMangaId(canonicalUrl) } : {}),
      ...(parseAniSearchMangaSlug(canonicalUrl) ? { aniSearchSlug: parseAniSearchMangaSlug(canonicalUrl) } : {}),
    },
  };

  preview.relatedSeries = enabledOptions.related_series
    ? parseAniSearchRelatedSeries(
      parseHtml(await fetchAniSearchHtml(`${canonicalUrl}/relations`)),
      canonicalUrl,
    )
    : [];

  if (websiteLinks.length > 0) {
    preview.details.website = websiteLinks[0]?.url || undefined;
  }

  if (enabledOptions.authors || enabledOptions.artists) {
    const personCache = new Map<string, ImportedPersonDraft>();
    const staffEntries = parseAniSearchStaffEntries(doc)
      .filter((item) => (
        (item.kind === 'author' && enabledOptions.authors)
        || (item.kind === 'artist' && enabledOptions.artists)
      ))
      .slice(0, MAX_IMPORT_ENTITY_COUNT);

    const drafts = await mapWithConcurrency(staffEntries, 4, async (item) => {
      const cached = personCache.get(item.url);
      if (cached) {
        return { kind: item.kind, draft: cached };
      }

      const draft = await buildAniSearchPersonDraft(item.url, item.kind);
      personCache.set(item.url, draft);
      return { kind: item.kind, draft };
    });

    for (const entry of drafts) {
      if (entry.kind === 'artist') {
        preview.artists.push(entry.draft);
      } else {
        preview.authors.push(entry.draft);
      }
    }
  }

  if (enabledOptions.characters) {
    const characterHtml = await fetchAniSearchHtml(`${canonicalUrl}/characters`);
    const characterDoc = parseHtml(characterHtml);
    const characterRows = parseAniSearchCharacterSection(characterDoc).slice(0, MAX_IMPORT_ENTITY_COUNT);
    const drafts = await mapWithConcurrency(characterRows, 4, async (item) => (
      buildAniSearchCharacterDraft(
        item.url,
        item.roleLabel,
        item.name,
        item.imageUrl,
      )
    ));

    preview.characters.push(...drafts);
  }

  return preview;
};

const mergeImportedPerson = <TEntity extends Character | Author | Artist>(
  existing: TEntity | null,
  draft: ImportedPersonDraft,
  importAsPublic: boolean,
): Partial<TEntity> => ({
  ...(existing || {}),
  name: draft.name,
  imageUrl: draft.imageUrl || existing?.imageUrl,
  description: draft.description || existing?.description,
  isPublic: importAsPublic,
  alternativeNames: mergeStringLists(existing?.alternativeNames, draft.alternativeNames),
  details: mergeMetadata(existing?.details, draft.details),
  gallery: mergeGallery(existing?.gallery, draft.gallery),
  sourceLinks: mergeSourceLinks(existing?.sourceLinks, draft.sourceLinks),
}) as Partial<TEntity>;

const stripCharacterListingRoleMetadata = (details?: EntityMetadata): EntityMetadata | undefined => {
  if (!details) {
    return undefined;
  }

  const nextDetails: EntityMetadata = { ...details };
  const nextExtra = { ...(nextDetails.extra || {}) };

  delete nextExtra.characterRoleType;

  if (normalizeCharacterListingRole(nextDetails.role)) {
    delete nextDetails.role;
  }

  if (Object.keys(nextExtra).length > 0) {
    nextDetails.extra = nextExtra;
  } else {
    delete nextDetails.extra;
  }

  return nextDetails;
};

const materializeImportedImage = async ({
  id,
  sourceUrl,
  entityType,
  entityId,
  variant,
  sourceName,
}: {
  id: string;
  sourceUrl?: string | null;
  entityType: 'manga' | 'character' | 'author' | 'artist';
  entityId: string;
  variant: 'cover' | 'banner' | 'profile' | 'gallery';
  sourceName?: ExternalSourceName | string;
}) => {
  const normalizedSourceUrl = normalizeText(sourceUrl);
  if (!normalizedSourceUrl) {
    return undefined;
  }

  try {
    return await materializeRemoteImage({
      id,
      sourceUrl: normalizedSourceUrl,
      entityType,
      entityId,
      variant,
      sourceName,
    }) || normalizedSourceUrl;
  } catch (error) {
    console.warn('Media materialize failed:', error);
    return normalizedSourceUrl;
  }
};

const materializeImportedGallery = async ({
  images,
  entityType,
  entityId,
  sourceName,
}: {
  images?: EntityGalleryImage[];
  entityType: 'manga' | 'character' | 'author' | 'artist';
  entityId: string;
  sourceName?: ExternalSourceName | string;
}) => {
  const sourceImages = (images || []).filter((image) => normalizeText(image?.url));
  if (sourceImages.length === 0) {
    return [] as EntityGalleryImage[];
  }

  try {
    const results = await materializeRemoteImages(
      sourceImages.map((image, index) => ({
        id: `${entityType}:${entityId}:gallery:${index}`,
        sourceUrl: image.url,
        entityType,
        entityId,
        variant: 'gallery' as const,
        sourceName: image.source || sourceName,
        objectKey: buildMaterializedGalleryObjectKey(
          entityType,
          entityId,
          image.sourceUrl || image.url || `${index}`,
        ),
      })),
    );

    return sourceImages.map((image, index) => {
      const originalUrl = normalizeText(image.url);
      const materializedUrl = results.get(`${entityType}:${entityId}:gallery:${index}`) || originalUrl;

      return {
        ...image,
        url: materializedUrl,
        thumbUrl: materializedUrl,
        sourceUrl: normalizeText(image.sourceUrl) || originalUrl,
      };
    });
  } catch (error) {
    console.warn('Gallery materialize failed:', error);
    return sourceImages.map((image) => ({
      ...image,
      url: normalizeText(image.url),
      thumbUrl: normalizeText(image.thumbUrl) || normalizeText(image.url),
      sourceUrl: normalizeText(image.sourceUrl) || normalizeText(image.url),
    }));
  }
};

const resolveAuthor = async (draft: ImportedPersonDraft, importAsPublic: boolean) => {
  const existing = await findAuthorByName(draft.name);
  const payload = mergeImportedPerson(existing, draft, importAsPublic) as Partial<Author>;

  if (existing?.id) {
    const imageUrl = await materializeImportedImage({
      id: `author:${existing.id}`,
      sourceUrl: payload.imageUrl,
      entityType: 'author',
      entityId: existing.id,
      variant: 'profile',
      sourceName: draft.sourceLinks?.[0]?.source,
    });
    const gallery = await materializeImportedGallery({
      images: payload.gallery,
      entityType: 'author',
      entityId: existing.id,
      sourceName: draft.sourceLinks?.[0]?.source,
    });

    const id = await saveAuthor({
      ...payload,
      id: existing.id,
      imageUrl,
      gallery,
    });
    return existing.id || id;
  }

  const id = await saveAuthor(payload);
  const imageUrl = await materializeImportedImage({
    id: `author:${id}`,
    sourceUrl: payload.imageUrl,
    entityType: 'author',
    entityId: id,
    variant: 'profile',
    sourceName: draft.sourceLinks?.[0]?.source,
  });
  const gallery = await materializeImportedGallery({
    images: payload.gallery,
    entityType: 'author',
    entityId: id,
    sourceName: draft.sourceLinks?.[0]?.source,
  });

  if (imageUrl && imageUrl !== payload.imageUrl) {
    await updateAuthorMedia(id, { imageUrl, gallery });
  } else if (gallery.length > 0) {
    await updateAuthorMedia(id, { gallery });
  }

  return id;
};

const resolveArtist = async (draft: ImportedPersonDraft, importAsPublic: boolean) => {
  const existing = await findArtistByName(draft.name);
  const payload = mergeImportedPerson(existing, draft, importAsPublic) as Partial<Artist>;

  if (existing?.id) {
    const imageUrl = await materializeImportedImage({
      id: `artist:${existing.id}`,
      sourceUrl: payload.imageUrl,
      entityType: 'artist',
      entityId: existing.id,
      variant: 'profile',
      sourceName: draft.sourceLinks?.[0]?.source,
    });
    const gallery = await materializeImportedGallery({
      images: payload.gallery,
      entityType: 'artist',
      entityId: existing.id,
      sourceName: draft.sourceLinks?.[0]?.source,
    });

    const id = await saveArtist({
      ...payload,
      id: existing.id,
      imageUrl,
      gallery,
    });
    return existing.id || id;
  }

  const id = await saveArtist(payload);
  const imageUrl = await materializeImportedImage({
    id: `artist:${id}`,
    sourceUrl: payload.imageUrl,
    entityType: 'artist',
    entityId: id,
    variant: 'profile',
    sourceName: draft.sourceLinks?.[0]?.source,
  });
  const gallery = await materializeImportedGallery({
    images: payload.gallery,
    entityType: 'artist',
    entityId: id,
    sourceName: draft.sourceLinks?.[0]?.source,
  });

  if (imageUrl && imageUrl !== payload.imageUrl) {
    await updateArtistMedia(id, { imageUrl, gallery });
  } else if (gallery.length > 0) {
    await updateArtistMedia(id, { gallery });
  }

  return id;
};

const resolveCharacter = async (draft: ImportedCharacterDraft, importAsPublic: boolean) => {
  const existing = await findCharacterByName(draft.name);
  const payload = mergeImportedPerson(existing, {
    ...draft,
    details: stripCharacterListingRoleMetadata(draft.details) || {},
  }, importAsPublic) as Partial<Character>;

  if (existing?.id) {
    const imageUrl = await materializeImportedImage({
      id: `character:${existing.id}`,
      sourceUrl: payload.imageUrl,
      entityType: 'character',
      entityId: existing.id,
      variant: 'profile',
      sourceName: draft.sourceLinks?.[0]?.source,
    });
    const gallery = await materializeImportedGallery({
      images: payload.gallery,
      entityType: 'character',
      entityId: existing.id,
      sourceName: draft.sourceLinks?.[0]?.source,
    });

    const id = await saveCharacter({
      ...payload,
      id: existing.id,
      imageUrl,
      gallery,
      details: stripCharacterListingRoleMetadata(payload.details),
    });

    return existing.id || id;
  }

  const id = await saveCharacter({
    ...payload,
    details: stripCharacterListingRoleMetadata(payload.details),
  });
  const imageUrl = await materializeImportedImage({
    id: `character:${id}`,
    sourceUrl: payload.imageUrl,
    entityType: 'character',
    entityId: id,
    variant: 'profile',
    sourceName: draft.sourceLinks?.[0]?.source,
  });
  const gallery = await materializeImportedGallery({
    images: payload.gallery,
    entityType: 'character',
    entityId: id,
    sourceName: draft.sourceLinks?.[0]?.source,
  });

  if (imageUrl && imageUrl !== payload.imageUrl) {
    await updateCharacterMedia(id, { imageUrl, gallery });
  } else if (gallery.length > 0) {
    await updateCharacterMedia(id, { gallery });
  }

  return id;
};

const buildMangaSourceLink = (preview: ImportedMangaPayload) =>
  createSourceLink(preview.source, preview.sourceUrl, 'series', preview.sourceTitle);

const mergeMangaDetails = (
  manga: Manga,
  preview: ImportedMangaPayload,
  enabledOptions: Partial<Record<ImportOptionKey, boolean>>,
) => {
  const nextSourceLinks = mergeSourceLinks(manga.sourceLinks, [buildMangaSourceLink(preview)]);
  const nextAlternativeTitles = enabledOptions.alternative_titles
    ? mergeStringLists(manga.alternativeTitles, preview.alternativeTitles)
    : manga.alternativeTitles || [];
  const nextDetails = enabledOptions.manga_core
    ? mergeMetadata(manga.details, preview.details)
    : manga.details || {};

  if (enabledOptions.gallery && preview.gallery.length > 0) {
    nextDetails.extra = {
      ...(nextDetails.extra || {}),
      seriesGallery: uniqueStrings(preview.gallery.map((item) => item.url)),
    };
  }

  return {
    ...manga,
    cover: enabledOptions.manga_core ? preview.cover || manga.cover : manga.cover,
    banner: enabledOptions.manga_core ? preview.banner || manga.banner : manga.banner,
    description: enabledOptions.manga_core ? preview.description || manga.description : manga.description,
    genres: enabledOptions.manga_core ? mergeStringLists(manga.genres, preview.genres) : manga.genres,
    alternativeTitles: nextAlternativeTitles,
    details: nextDetails,
    sourceLinks: nextSourceLinks,
    releaseYear:
      enabledOptions.manga_core && !manga.releaseYear
        ? toYear(preview.details.startDate || '')
        : manga.releaseYear,
    status: enabledOptions.manga_core
      ? (preview.details.status ? toLocalMangaStatus(preview.details.status) : manga.status)
      : manga.status,
    type: enabledOptions.manga_core
      ? (
          preview.details.sourceMaterial || preview.details.countryOfOrigin
            ? toLocalMangaType(preview.details.sourceMaterial || preview.details.countryOfOrigin || '')
            : manga.type
        )
      : manga.type,
  } as Manga;
};

const matchRelatedManga = (mangas: Manga[], title: string) => {
  const targetKey = normalizeKey(title);
  if (!targetKey) {
    return undefined;
  }

  return mangas.find((manga) => {
    const keys = [manga.title, ...(manga.alternativeTitles || [])].map((value) => normalizeKey(value));
    return keys.includes(targetKey);
  });
};

export const createDefaultImportOptions = (
  source: MetadataImportSource,
): Partial<Record<ImportOptionKey, boolean>> => {
  const support = SOURCE_OPTION_SUPPORT[source];
  return Object.fromEntries(
    Object.entries(support).map(([key, isSupported]) => [key, isSupported]),
  ) as Partial<Record<ImportOptionKey, boolean>>;
};

export const filterImportedPreviewByOptions = (
  preview: ImportedMangaPayload,
  enabledOptions: Partial<Record<ImportOptionKey, boolean>>,
): ImportedMangaPayload => ({
  ...preview,
  cover: enabledOptions.manga_core ? preview.cover : undefined,
  banner: enabledOptions.manga_core ? preview.banner : undefined,
  description: enabledOptions.manga_core ? preview.description : undefined,
  alternativeTitles: enabledOptions.alternative_titles ? preview.alternativeTitles : [],
  genres: enabledOptions.manga_core ? preview.genres : [],
  tags: enabledOptions.tags ? preview.tags : [],
  gallery: enabledOptions.gallery ? preview.gallery : [],
  details: enabledOptions.manga_core ? preview.details : {},
  relatedSeries: enabledOptions.related_series ? preview.relatedSeries : [],
  authors: enabledOptions.authors ? preview.authors : [],
  artists: enabledOptions.artists ? preview.artists : [],
  characters: enabledOptions.characters
    ? preview.characters.map((character) => ({
      ...character,
      gallery: enabledOptions.gallery ? character.gallery : [],
    }))
    : [],
  tagMatches: enabledOptions.tags ? preview.tagMatches : undefined,
});

export const searchMetadataImportCandidates = async (
  source: MetadataImportSource,
  input: string,
): Promise<SourceSearchCandidate[]> => {
  const query = normalizeText(input);
  if (!query) {
    return [];
  }

  if (source === 'anisearch') {
    return searchAniSearchCandidates(query);
  }

  if (source === 'myanimelist') {
    return searchMyAnimeListCandidates(query);
  }

  if (source === 'mangaupdates') {
    return searchMangaUpdatesCandidates(query);
  }

  if (source === 'animeplanet') {
    return searchAnimePlanetCandidates(query);
  }

  return [];
};

export const loadMetadataImportPreview = async (
  candidate: SourceSearchCandidate,
  enabledOptions: Partial<Record<ImportOptionKey, boolean>>,
  options?: { translateToTurkish?: boolean },
): Promise<ImportedMangaPayload> => {
  let preview: ImportedMangaPayload;

  if (candidate.source === 'anisearch') {
    preview = await loadAniSearchPreview(candidate, enabledOptions);
  } else if (candidate.source === 'myanimelist') {
    preview = await loadMyAnimeListPreview(candidate, enabledOptions);
  } else if (candidate.source === 'mangaupdates') {
    preview = await loadMangaUpdatesPreview(candidate, enabledOptions);
  } else if (candidate.source === 'animeplanet') {
    preview = await loadAnimePlanetPreview(candidate, enabledOptions);
  } else {
    throw new Error('Desteklenmeyen metadata import kaynağı.');
  }

  preview = filterImportedPreviewByOptions(preview, enabledOptions);

  // Manga içindeki 'genres' dizisini Türkçe karşılıklarına dönüştür
  if (enabledOptions.manga_core) {
    if (preview.genres) {
      preview.genres = translateGenresWithAliases(preview.genres);
    }
  }

  if (enabledOptions.tags) {
    // Tag'ler için alias'ları uygulayalım, sonrasında veritabanı ile eşleştirelim
    const translatedTags = translateGenresWithAliases(preview.tags || []);
    preview.tags = translatedTags;
    preview.tagMatches = await matchGenresWithSiteTags(translatedTags);
  }

  if (options?.translateToTurkish) {
    preview = await translatePreviewDescriptions(preview);
  }

  return filterImportedPreviewByOptions(preview, enabledOptions);
};

export const importPreviewIntoManga = async (
  mangaId: string,
  preview: ImportedMangaPayload,
  selection: ImportSelectionOptions,
) => {
  const manga = await getMangaById(mangaId, { includePrivate: true, includePages: true });
  if (!manga) {
    throw new Error('MANGA_NOT_FOUND');
  }

  const [existingCharacters, existingTags] = await Promise.all([
    selection.enabledOptions.characters ? getMangaCharacters(mangaId, { includePrivate: true }) : Promise.resolve([]),
    selection.enabledOptions.tags ? getTagsForEntity('manga', mangaId) : Promise.resolve([]),
  ]);

  const existingAuthorKeys = new Set(
    [
      ...(manga.authorsDetails || []).map((author) => author.name),
      ...(manga.author?.split(',') || []),
    ].map((value) => normalizeKey(value)).filter(Boolean),
  );
  const existingArtistKeys = new Set(
    [
      ...(manga.artistsDetails || []).map((artist) => artist.name),
      ...(manga.artist?.split(',') || []),
    ].map((value) => normalizeKey(value)).filter(Boolean),
  );
  const existingCharacterKeys = new Set(existingCharacters.map((character) => normalizeKey(character.name)).filter(Boolean));
  const existingTagKeys = new Set(
    [
      ...(manga.genres || []),
      ...existingTags.map((tag) => tag.name),
    ].map((value) => normalizeKey(value)).filter(Boolean),
  );

  const nextManga = mergeMangaDetails(manga, preview, selection.enabledOptions);
  const materializedMangaMedia = selection.enabledOptions.manga_core
    ? await materializeRemoteImages([
      {
        id: `manga:${mangaId}:cover`,
        sourceUrl: nextManga.cover,
        entityType: 'manga',
        entityId: mangaId,
        variant: 'cover',
        sourceName: preview.source,
      },
      {
        id: `manga:${mangaId}:banner`,
        sourceUrl: nextManga.banner,
        entityType: 'manga',
        entityId: mangaId,
        variant: 'banner',
        sourceName: preview.source,
      },
    ]).catch((error) => {
      console.warn('Manga media materialize failed:', error);
      return new Map<string, string>();
    })
    : new Map<string, string>();
  const materializedSeriesGallery = selection.enabledOptions.gallery
    ? await materializeImportedGallery({
      images: preview.gallery,
      entityType: 'manga',
      entityId: mangaId,
      sourceName: preview.source,
    })
    : [];

  nextManga.cover = materializedMangaMedia.get(`manga:${mangaId}:cover`) || nextManga.cover;
  nextManga.banner = materializedMangaMedia.get(`manga:${mangaId}:banner`) || nextManga.banner;
  if (selection.enabledOptions.gallery && materializedSeriesGallery.length > 0) {
    nextManga.details = {
      ...(nextManga.details || {}),
      extra: {
        ...(nextManga.details?.extra || {}),
        seriesGallery: uniqueStrings(materializedSeriesGallery.map((item) => item.url)),
      },
    };
  }
  await saveManga(nextManga);

  if (selection.enabledOptions.tags && preview.tagMatches) {
    for (const match of preview.tagMatches) {
      if (match.isStandardGenre && !match.matchedTag) {
        // Bu bir standart Tür (Aksiyon, Macera vb.) ve 'tags' tablosunda kaydı yok.
        // Türler zaten manga.genres dizisine kaydediliyor, bu yüzden tag olarak eklemeye gerek yok.
        continue;
      }

      if (match.isMatched && match.matchedTag) {
        if (existingTagKeys.has(normalizeKey(match.matchedTag.name))) {
          continue;
        }

        await addTagToEntity('manga', mangaId, match.matchedTag.id);
        existingTagKeys.add(normalizeKey(match.matchedTag.name));
      } else {
        if (existingTagKeys.has(normalizeKey(match.sourceTag))) {
          continue;
        }

        const tag = await createTag(match.sourceTag, 'general');
        if (tag) {
          await addTagToEntity('manga', mangaId, tag.id);
          existingTagKeys.add(normalizeKey(tag.name));
        }
      }
    }
  } else if (selection.enabledOptions.tags) {
    for (const tagName of uniqueStrings(preview.tags)) {
      if (existingTagKeys.has(normalizeKey(tagName))) {
        continue;
      }

      const tag = await createTag(tagName, 'general');
      if (tag) {
        await addTagToEntity('manga', mangaId, tag.id);
        existingTagKeys.add(normalizeKey(tag.name));
      }
    }
  }

  if (selection.enabledOptions.authors) {
    for (const author of preview.authors) {
      const authorKey = normalizeKey(author.name);
      const authorId = await resolveAuthor(author, selection.importAsPublic);
      if (!existingAuthorKeys.has(authorKey)) {
        await linkMangaToAuthor(mangaId, authorId);
        existingAuthorKeys.add(authorKey);
      }
    }
  }

  if (selection.enabledOptions.artists) {
    for (const artist of preview.artists) {
      const artistKey = normalizeKey(artist.name);
      const artistId = await resolveArtist(artist, selection.importAsPublic);
      if (!existingArtistKeys.has(artistKey)) {
        await linkMangaToArtist(mangaId, artistId);
        existingArtistKeys.add(artistKey);
      }
    }
  }

  if (selection.enabledOptions.characters) {
    for (const character of preview.characters) {
      const characterKey = normalizeKey(character.name);
      const characterId = await resolveCharacter(character, selection.importAsPublic);
      await linkMangaToCharacter(mangaId, characterId, {
        listingRole: character.roleType,
      });
      if (!existingCharacterKeys.has(characterKey)) {
        existingCharacterKeys.add(characterKey);
      }
    }
  }

  if (selection.enabledOptions.related_series) {
    const localManga = await getMangaSummaries();
    const existingRelations = manga.relatedSeries || [];
    const relationMap = new Map<string, Partial<MangaRelation>>();

    for (const relation of existingRelations) {
      relationMap.set(relation.relatedMangaId, relation);
    }

    for (const importedRelation of preview.relatedSeries) {
      const matchedManga = matchRelatedManga(localManga, importedRelation.title);
      if (!matchedManga) {
        continue;
      }

      relationMap.set(matchedManga.id, {
        relatedMangaId: matchedManga.id,
        relationType: importedRelation.relationType,
        sourceName: preview.source,
        sourceUrl: importedRelation.sourceUrl,
      });
    }

    await replaceMangaRelatedSeries(mangaId, Array.from(relationMap.values()));
  }
};
