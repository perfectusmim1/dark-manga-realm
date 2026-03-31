import type { EntityMetadata } from '@/lib/types';

export type CharacterListingRole = 'main' | 'supporting' | 'minor';

const normalizeText = (value?: string | null) => value?.replace(/\s+/g, ' ').trim() || '';
const normalizeKey = (value?: string | null) => normalizeText(value).toLocaleLowerCase('tr-TR');

export const normalizeCharacterListingRole = (
  value?: string | null,
): CharacterListingRole | undefined => {
  const normalized = normalizeKey(value);

  if (!normalized) {
    return undefined;
  }

  if (normalized.includes('main') || normalized.includes('ana karakter') || normalized === 'ana') {
    return 'main';
  }

  if (
    normalized.includes('support')
    || normalized.includes('secondary')
    || normalized.includes('yan karakter')
    || normalized === 'yan'
  ) {
    return 'supporting';
  }

  if (
    normalized.includes('minor')
    || normalized.includes('other')
    || normalized.includes('diğer')
    || normalized.includes('background')
  ) {
    return 'minor';
  }

  return undefined;
};

export const getCharacterListingRoleLabel = (role?: CharacterListingRole | null) => {
  switch (role) {
    case 'main':
      return 'Ana Karakter';
    case 'supporting':
      return 'Yan Karakter';
    case 'minor':
      return 'Diğer Karakter';
    default:
      return '';
  }
};

export const getCharacterListingRoleSectionTitle = (role: CharacterListingRole) => {
  switch (role) {
    case 'main':
      return 'Ana Karakterler';
    case 'supporting':
      return 'Yan Karakterler';
    case 'minor':
      return 'Diğer Karakterler';
    default:
      return 'Karakterler';
  }
};

export const getCharacterListingRolePriority = (role?: CharacterListingRole | null) => {
  switch (role) {
    case 'main':
      return 0;
    case 'supporting':
      return 1;
    case 'minor':
      return 2;
    default:
      return 3;
  }
};

export const getCharacterListingRoleFromMetadata = (
  metadata?: EntityMetadata | null,
  fallbackRoleLabel?: string | null,
): CharacterListingRole | undefined => {
  const extraRole = typeof metadata?.extra?.characterRoleType === 'string'
    ? metadata.extra.characterRoleType
    : undefined;

  return normalizeCharacterListingRole(extraRole || metadata?.role || fallbackRoleLabel);
};
