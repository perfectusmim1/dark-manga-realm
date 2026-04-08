const SIYAHMELEK_SKIP_PROMO_FIRST_PAGE_STORAGE_KEY = 'toonparrot:siyahmelek-skip-promo-first-page';

export const readSiyahMelekSkipPromoFirstPage = () => {
  if (typeof window === 'undefined') {
    return true;
  }

  const storedValue = window.localStorage.getItem(SIYAHMELEK_SKIP_PROMO_FIRST_PAGE_STORAGE_KEY);
  if (storedValue === 'false') {
    return false;
  }

  return true;
};

export const writeSiyahMelekSkipPromoFirstPage = (enabled: boolean) => {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(
    SIYAHMELEK_SKIP_PROMO_FIRST_PAGE_STORAGE_KEY,
    enabled ? 'true' : 'false',
  );
};
