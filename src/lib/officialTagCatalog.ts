import { TagCategory } from '@/lib/types';

export interface OfficialTagSeed {
  name: string;
  category: TagCategory;
}

export const slugifyCatalogTagName = (name?: string | null) => (
  `${name ?? ''}`
    .replace(/\u0130/g, 'I')
    .replace(/\u0131/g, 'i')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
);

const RAW_OFFICIAL_TAG_NAMES = `
4-koma
Achromatic
Achronological Order
Acrobatics
Acting
Adoption
Advertisement
Afterlife
Age Gap
Age Regression
Agender
Agriculture
Airsoft
Alchemy
Aliens
Alternate Universe
American Football
Amnesia
Anachronism
Ancient China
Angels
Animals
Anthology
Anthropomorphism
Anti-Hero
Archery
Aromantic
Arranged Marriage
Artificial Intelligence
Asexual
Assassins
Astronomy
Athletics
Augmented Reality
Autobiographical
Aviation
Badminton
Ballet
Band
Bar
Baseball
Basketball
Battle Royale
Biographical
Bisexual
Blackmail
Board Game
Boarding School
Body Horror
Body Image
Body Swapping
Bowling
Boxing
Boys' Love
Brainwashing
Bullying
Butler
Calligraphy
Camping
Cannibalism
Card Battle
Cars
Centaur
CGI
Cheerleading
Chibi
Chimera
Chuunibyou
Circus
Class Struggle
Classic Literature
Classical Music
Clone
Coastal
Cohabitation
College
Coming of Age
Conspiracy
Cosmic Horror
Cosplay
Cowboys
Creature Taming
Crime
Criminal Organization
Crossdressing
Crossover
Cult
Cultivation
Curses
Cute Boys Doing Cute Things
Cute Girls Doing Cute Things
Cyberpunk
Cyborg
Cycling
Dancing
Death Game
Delinquents
Demons
Denpa
Desert
Detective
Dinosaurs
Disability
Dissociative Identities
Dragons
Drawing
Drugs
Dullahan
Dungeon
Dystopian
E-Sports
Eco-Horror
Economics
Educational
Elderly Protagonist
Elf
Ensemble Cast
Environmental
Episodic
Ero Guro
Espionage
Estranged Family
Exorcism
Fairy
Fairy Tale
Fake Relationship
Family Life
Fashion
Female Harem
Female Protagonist
Femboy
Fencing
Filmmaking
Firefighters
Fishing
Fitness
Flash
Food
Football
Foreign
Found Family
Fugitive
Full CGI
Full Color
Gambling
Gangs
Gekiga
Gender Bending
Ghost
Go
Goblin
Gods
Golf
Gore
Graduation Project
Guns
Gyaru
Handball
Henshin
Heterosexual
Hikikomori
Hip-hop Music
Historical
Homeless
Horticulture
Human Experimentation
Ice Skating
Idol
Indigenous Cultures
Inn
Interspecies
Isekai
Iyashikei
Jazz Music
Josei
Judo
Kabuki
Kaiju
Karuta
Kemonomimi
Kids
Kingdom Management
Konbini
Kuudere
Lacrosse
Language Barrier
LGBTQ+ Themes
Long Strip
Lost Civilization
Love Triangle
Mafia
Magic
Mahjong
Maids
Makeup
Male Harem
Male Protagonist
Manzai
Marriage
Martial Arts
Matchmaking
Matriarchy
Medicine
Medieval
Memory Manipulation
Mermaid
Meta
Metal Music
Military
Mixed Gender Harem
Mixed Media
Modeling
Monster Boy
Monster Girl
Mopeds
Motorcycles
Mountaineering
Musical Theater
Mythology
Natural Disaster
Necromancy
Nekomimi
Ninja
No Dialogue
Noir
Non-fiction
Nudity
Nun
Office
Office Lady
Oiran
Ojou-sama
Orphan
Otaku Culture
Outdoor Activities
Pandemic
Parenthood
Parkour
Parody
Philosophy
Photography
Pirates
Poker
Police
Politics
Polyamorous
Post-Apocalyptic
POV
Pregnancy
Primarily Adult Cast
Primarily Animal Cast
Primarily Child Cast
Primarily Female Cast
Primarily Male Cast
Primarily Teen Cast
Prison
Proxy Battle
Psychosexual
Puppetry
Rakugo
Real Robot
Rehabilitation
Reincarnation
Religion
Rescue
Restaurant
Revenge
Reverse Isekai
Robots
Rock Music
Rotoscoping
Royal Affairs
Rugby
Rural
Samurai
Satire
School
School Club
Scuba Diving
Seinen
Shapeshifting
Ships
Shogi
Shoujo
Shounen
Shrine Maiden
Single-Page Chapter
Skateboarding
Skeleton
Slapstick
Slavery
Snowscape
Software Development
Space
Space Opera
Spearplay
Steampunk
Stop Motion
Succubus
Suicide
Sumo
Super Power
Super Robot
Superhero
Surfing
Surreal Comedy
Survival
Swimming
Swordplay
Table Tennis
Tanks
Tanned Skin
Teacher
Teens' Love
Tennis
Terrorism
Time Loop
Time Manipulation
Time Skip
Tokusatsu
Tomboy
Torture
Tragedy
Trains
Transgender
Travel
Triads
Tsundere
Twins
Unrequited Love
Urban
Urban Fantasy
Vampire
Vertical Video
Veterinarian
Video Games
Vikings
Villainess
Virtual World
Vocal Synth
Volleyball
VTuber
War
Werewolf
Wilderness
Witch
Work
Wrestling
Writing
Wuxia
Yakuza
Yandere
Youkai
Yuri
Zombie
`;

const DEMOGRAPHIC_TAGS = new Set([
  'Agender',
  'Aromantic',
  'Asexual',
  'Bisexual',
  "Boys' Love",
  'Female Protagonist',
  'Femboy',
  'Heterosexual',
  'Josei',
  'Kids',
  'LGBTQ+ Themes',
  'Male Protagonist',
  'Polyamorous',
  'Primarily Adult Cast',
  'Primarily Animal Cast',
  'Primarily Child Cast',
  'Primarily Female Cast',
  'Primarily Male Cast',
  'Primarily Teen Cast',
  'Seinen',
  'Shoujo',
  'Shounen',
  "Teens' Love",
  'Transgender',
  'Tomboy',
  'Yuri',
]);

const CONTENT_TAGS = new Set([
  'Blackmail',
  'Body Horror',
  'Bullying',
  'Cannibalism',
  'Drugs',
  'Ero Guro',
  'Gore',
  'Human Experimentation',
  'Nudity',
  'Pregnancy',
  'Psychosexual',
  'Slavery',
  'Suicide',
  'Terrorism',
  'Torture',
]);

const MOOD_TAGS = new Set([
  'Achromatic',
  'Cosmic Horror',
  'Cute Boys Doing Cute Things',
  'Cute Girls Doing Cute Things',
  'Denpa',
  'Eco-Horror',
  'Gekiga',
  'Iyashikei',
  'Noir',
  'Satire',
  'Slapstick',
  'Surreal Comedy',
  'Tragedy',
]);

const TROPE_TAGS = new Set([
  'Achronological Order',
  'Age Gap',
  'Age Regression',
  'Alternate Universe',
  'Amnesia',
  'Anti-Hero',
  'Arranged Marriage',
  'Battle Royale',
  'Body Swapping',
  'Chuunibyou',
  'Clone',
  'Cohabitation',
  'Coming of Age',
  'Crossdressing',
  'Crossover',
  'Death Game',
  'Dissociative Identities',
  'Elderly Protagonist',
  'Ensemble Cast',
  'Estranged Family',
  'Fake Relationship',
  'Female Harem',
  'Found Family',
  'Gender Bending',
  'Henshin',
  'Isekai',
  'Kingdom Management',
  'Kuudere',
  'Language Barrier',
  'Love Triangle',
  'Male Harem',
  'Marriage',
  'Matchmaking',
  'Memory Manipulation',
  'Meta',
  'Mixed Gender Harem',
  'Ojou-sama',
  'Parenthood',
  'Parody',
  'POV',
  'Proxy Battle',
  'Reincarnation',
  'Revenge',
  'Reverse Isekai',
  'Shapeshifting',
  'Time Loop',
  'Time Manipulation',
  'Time Skip',
  'Tsundere',
  'Twins',
  'Unrequited Love',
  'Villainess',
  'Yandere',
]);

const getOfficialTagCategory = (name: string): TagCategory => {
  if (DEMOGRAPHIC_TAGS.has(name)) {
    return 'demographic';
  }

  if (CONTENT_TAGS.has(name)) {
    return 'content';
  }

  if (MOOD_TAGS.has(name)) {
    return 'mood';
  }

  if (TROPE_TAGS.has(name)) {
    return 'trope';
  }

  return 'theme';
};

export const OFFICIAL_TAG_CATALOG: OfficialTagSeed[] = RAW_OFFICIAL_TAG_NAMES
  .split('\n')
  .map((line) => line.trim())
  .filter(Boolean)
  .map((name) => ({
    name,
    category: getOfficialTagCategory(name),
  }));

export const OFFICIAL_TAG_SLUGS = new Set(
  OFFICIAL_TAG_CATALOG.map((tag) => slugifyCatalogTagName(tag.name)),
);
