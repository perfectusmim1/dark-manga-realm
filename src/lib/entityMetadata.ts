import type { EntityMetadata } from '@/lib/types';

export interface EntityMetadataFormState {
  nativeName: string;
  englishName: string;
  romajiName: string;
  status: string;
  age: string;
  gender: string;
  birthday: string;
  birthDate: string;
  birthPlace: string;
  bloodType: string;
  zodiac: string;
  nationality: string;
  occupation: string;
  role: string;
  className: string;
  rankTitle: string;
  affiliation: string;
  relatives: string;
  website: string;
  twitter: string;
  officialTranslations: string;
  originalWebtoon: string;
  genres: string;
  tags: string;
  comments: string;
  extraJson: string;
}

const LIST_SEPARATOR_PATTERN = /[\n,;]+/;

export const parseDelimitedList = (value?: string | null) => (
  (value || '')
    .split(LIST_SEPARATOR_PATTERN)
    .map((item) => item.trim())
    .filter(Boolean)
);

export const joinDelimitedList = (value?: string[] | null) => (value || []).join('\n');

export const createEmptyEntityMetadataFormState = (): EntityMetadataFormState => ({
  nativeName: '',
  englishName: '',
  romajiName: '',
  status: '',
  age: '',
  gender: '',
  birthday: '',
  birthDate: '',
  birthPlace: '',
  bloodType: '',
  zodiac: '',
  nationality: '',
  occupation: '',
  role: '',
  className: '',
  rankTitle: '',
  affiliation: '',
  relatives: '',
  website: '',
  twitter: '',
  officialTranslations: '',
  originalWebtoon: '',
  genres: '',
  tags: '',
  comments: '',
  extraJson: '',
});

export const entityMetadataToFormState = (metadata?: EntityMetadata | null): EntityMetadataFormState => ({
  nativeName: metadata?.nativeName || '',
  englishName: metadata?.englishName || '',
  romajiName: metadata?.romajiName || '',
  status: metadata?.status || '',
  age: metadata?.age || '',
  gender: metadata?.gender || '',
  birthday: metadata?.birthday || '',
  birthDate: metadata?.birthDate || '',
  birthPlace: metadata?.birthPlace || '',
  bloodType: metadata?.bloodType || '',
  zodiac: metadata?.zodiac || '',
  nationality: metadata?.nationality || '',
  occupation: metadata?.occupation || '',
  role: metadata?.role || '',
  className: metadata?.className || '',
  rankTitle: metadata?.rankTitle || '',
  affiliation: joinDelimitedList(metadata?.affiliation),
  relatives: joinDelimitedList(metadata?.relatives),
  website: metadata?.website || '',
  twitter: metadata?.twitter || '',
  officialTranslations: joinDelimitedList(metadata?.officialTranslations),
  originalWebtoon: joinDelimitedList(metadata?.originalWebtoon),
  genres: joinDelimitedList(metadata?.genres),
  tags: joinDelimitedList(metadata?.tags),
  comments: metadata?.comments || '',
  extraJson: metadata?.extra ? JSON.stringify(metadata.extra, null, 2) : '',
});

export const formStateToEntityMetadata = (formState: EntityMetadataFormState): EntityMetadata => {
  let extra: EntityMetadata['extra'] | undefined;

  if (formState.extraJson.trim()) {
    try {
      const parsed = JSON.parse(formState.extraJson);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        extra = parsed as EntityMetadata['extra'];
      }
    } catch {
      extra = { raw: formState.extraJson.trim() };
    }
  }

  const metadata: EntityMetadata = {
    nativeName: formState.nativeName.trim() || undefined,
    englishName: formState.englishName.trim() || undefined,
    romajiName: formState.romajiName.trim() || undefined,
    status: formState.status.trim() || undefined,
    age: formState.age.trim() || undefined,
    gender: formState.gender.trim() || undefined,
    birthday: formState.birthday.trim() || undefined,
    birthDate: formState.birthDate.trim() || undefined,
    birthPlace: formState.birthPlace.trim() || undefined,
    bloodType: formState.bloodType.trim() || undefined,
    zodiac: formState.zodiac.trim() || undefined,
    nationality: formState.nationality.trim() || undefined,
    occupation: formState.occupation.trim() || undefined,
    role: formState.role.trim() || undefined,
    className: formState.className.trim() || undefined,
    rankTitle: formState.rankTitle.trim() || undefined,
    affiliation: parseDelimitedList(formState.affiliation),
    relatives: parseDelimitedList(formState.relatives),
    website: formState.website.trim() || undefined,
    twitter: formState.twitter.trim() || undefined,
    officialTranslations: parseDelimitedList(formState.officialTranslations),
    originalWebtoon: parseDelimitedList(formState.originalWebtoon),
    genres: parseDelimitedList(formState.genres),
    tags: parseDelimitedList(formState.tags),
    comments: formState.comments.trim() || undefined,
    extra,
  };

  return Object.fromEntries(
    Object.entries(metadata).filter(([, value]) => {
      if (Array.isArray(value)) {
        return value.length > 0;
      }

      return value !== undefined && value !== null && value !== '';
    }),
  ) as EntityMetadata;
};

export const buildEntityMetadataEntries = (metadata?: EntityMetadata | null) => {
  if (!metadata) {
    return [];
  }

  const entries: Array<{ label: string; value: string }> = [];

  const push = (label: string, value?: string | string[] | number | null) => {
    if (Array.isArray(value)) {
      if (value.length > 0) {
        entries.push({ label, value: value.join(', ') });
      }
      return;
    }

    if (value !== undefined && value !== null && String(value).trim()) {
      entries.push({ label, value: String(value).trim() });
    }
  };

  push('Native', metadata.nativeName);
  push('English', metadata.englishName);
  push('Romaji', metadata.romajiName);
  push('Durum', metadata.status);
  push('Yaş', metadata.age);
  push('Cinsiyet', metadata.gender);
  push('Doğum Günü', metadata.birthday || metadata.birthDate);
  push('Doğum Yeri', metadata.birthPlace);
  push('Kan Grubu', metadata.bloodType);
  push('Burç', metadata.zodiac);
  push('Uyruk', metadata.nationality);
  push('Meslek', metadata.occupation);
  push('Rol', metadata.role);
  push('Sınıf', metadata.className);
  push('Unvan', metadata.rankTitle);
  push('Bağlılık', metadata.affiliation);
  push('Yakınlar', metadata.relatives);
  push('Website', metadata.website);
  push('Twitter', metadata.twitter);
  push('Kaynak Materyal', metadata.sourceMaterial);
  push('Başlangıç', metadata.startDate);
  push('Bitiş', metadata.endDate);
  push('Bölüm', metadata.chapters);
  push('Cilt', metadata.volumes);
  push('Orijinal Yayıncı', metadata.originalPublisher);
  push('Menşei', metadata.countryOfOrigin);
  push('Resmi Çeviriler', metadata.officialTranslations);
  push('Orijinal Webtoon', metadata.originalWebtoon);
  push('Türler', metadata.genres);
  push('Etiketler', metadata.tags);
  push('Notlar', metadata.comments);

  if (metadata.extra) {
    Object.entries(metadata.extra).forEach(([key, value]) => {
      if (Array.isArray(value)) {
        push(key, value.map((item) => String(item)));
        return;
      }

      if (value !== null && value !== undefined && value !== false && value !== '') {
        push(key, String(value));
      }
    });
  }

  return entries;
};
