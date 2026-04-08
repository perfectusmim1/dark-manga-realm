export const ADULT_MODE_CHANGED_EVENT = 'toonparrot:adult-mode-changed';

export interface AdultModeChangedDetail {
  enabled: boolean;
}

export const dispatchAdultModeChanged = (detail: AdultModeChangedDetail) => {
  if (typeof window === 'undefined') {
    return;
  }

  window.dispatchEvent(new CustomEvent<AdultModeChangedDetail>(ADULT_MODE_CHANGED_EVENT, { detail }));
};
