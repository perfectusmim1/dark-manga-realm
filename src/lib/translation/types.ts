// Bir konuşma balonunun çevirisi. box ve patchBox: [ymin, xmin, ymax, xmax], 0-1000 normalize (ondalık hassasiyetli).
export interface TranslationBlock {
  v?: number;
  box: [number, number, number, number];
  patchBox?: [number, number, number, number];
  patchDataUrl?: string;
  text: string;
  bgColor?: string;
  textColor?: string;
  isDark?: boolean;
  hasTextStroke?: boolean;
  fontSizeCqw?: number;
}

export type PageTranslationStatus = 'idle' | 'queued' | 'translating' | 'done' | 'error';

export interface PageTranslationState {
  status: PageTranslationStatus;
  blocks?: TranslationBlock[];
}
