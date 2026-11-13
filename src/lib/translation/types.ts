// Bir konuşma balonunun veya özel yazının (SFX/anlatım) çevirisi.
// box ve patchBox: [ymin, xmin, ymax, xmax], 0-1000 normalize (ondalık hassasiyetli).

export type TranslationBlockKind = 'dialogue' | 'narration' | 'sfx' | 'emphasis';

export type ScanlationFontKey = 'shantell' | 'anton' | 'bangers' | 'marker' | 'cinzel';

export interface OcrBubbleLineBox {
  box: [number, number, number, number];
  text: string;
  confidence?: number;
  angleDeg?: number;
}

export interface TranslationLineStyle {
  textColor?: string;
  hasTextStroke?: boolean;
  strokeColor?: string;
  strokeWidthEm?: number;
  shadowColor?: string;
  shadowBlurEm?: number;
}

export interface TranslationBlock {
  v?: number;
  box: [number, number, number, number];
  patchBox?: [number, number, number, number];
  patchDataUrl?: string;
  text: string;
  originalText?: string;
  lines?: OcrBubbleLineBox[];
  kind?: TranslationBlockKind;
  fontFamily?: ScanlationFontKey;
  fontWeight?: number;
  fontStyle?: 'normal' | 'italic';
  bgColor?: string;
  textColor?: string;
  textGradient?: string;
  gradientStops?: [string, string];
  strokeColor?: string;
  strokeWidthEm?: number;
  shadowColor?: string;
  shadowBlurEm?: number;
  isDark?: boolean;
  hasTextStroke?: boolean;
  fontSizeCqw?: number;
  rotationDeg?: number;
  skewDeg?: number;
  letterSpacingEm?: number;
  /** Oval/elips balonlarda her satır yüksekliğindeki yatay genişlik oranı (0.5 - 1.0) */
  lineWidthsPct?: number[];
  /** Zıt parlaklıklı bölünmüş zeminlerde her sarılı satır için özel renk/kontur geçersiz kılması */
  lineStyles?: TranslationLineStyle[];
  /** Son satır vurgulu/büyük yazılmışsa ("ALONE?" gibi) uygulanacak ölçek çarpanı */
  emphasisLastLineScale?: number;
}

export type PageTranslationStatus = 'idle' | 'queued' | 'translating' | 'done' | 'error';

export interface PageTranslationState {
  status: PageTranslationStatus;
  blocks?: TranslationBlock[];
}
