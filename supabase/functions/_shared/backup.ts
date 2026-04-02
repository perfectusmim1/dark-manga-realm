export const BACKUP_VERSION = 2;
export const BACKUP_CHUNK_SIZE = 500;

export const BACKUP_TABLES = [
  "mangas",
  "chapters",
  "characters",
  "authors",
  "artists",
  "manga_characters",
  "manga_authors",
  "manga_artists",
  "manga_relations",
  "tags",
  "manga_tags",
  "character_tags",
  "author_tags",
  "artist_tags",
  "chapter_automations",
  "announcements",
  "site_settings",
] as const;

export type BackupTableName = (typeof BACKUP_TABLES)[number];

export const UPSERT_ONLY_TABLES: BackupTableName[] = [
  "site_settings",
  "announcements",
  "tags",
  "authors",
  "artists",
  "characters",
  "mangas",
  "chapters",
  "chapter_automations",
];

export const REPLACE_ONLY_TABLES: BackupTableName[] = [
  "manga_characters",
  "manga_authors",
  "manga_artists",
  "manga_relations",
  "manga_tags",
  "character_tags",
  "author_tags",
  "artist_tags",
];

export const RESTORE_ORDER: BackupTableName[] = [
  ...UPSERT_ONLY_TABLES,
  ...REPLACE_ONLY_TABLES,
];

export const DELETE_ORDER: BackupTableName[] = [...REPLACE_ONLY_TABLES].reverse();
