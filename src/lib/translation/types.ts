// Bir konuşma balonunun çevirisi. box: [ymin, xmin, ymax, xmax], 0-1000 normalize.
export interface TranslationBlock {
  box: [number, number, number, number];
  text: string;
}

export type PageTranslationStatus = 'idle' | 'queued' | 'translating' | 'done' | 'error';

export interface PageTranslationState {
  status: PageTranslationStatus;
  blocks?: TranslationBlock[];
}
