import React from 'react';
import { cn } from '@/lib/utils';
import { normalizeLanguageCode } from '@/lib/seriesLanguage';

interface LanguageFlagProps {
  code?: string | null;
  label?: string;
  className?: string;
}

export const LanguageFlag: React.FC<LanguageFlagProps> = ({
  code,
  label,
  className,
}) => {
  const lang = normalizeLanguageCode(code);

  if (lang === 'raw') {
    return (
      <span className={cn('text-[9px] font-black uppercase tracking-wider leading-none', className)}>
        RAW
      </span>
    );
  }

  const baseClass = cn('inline-block h-3.5 w-5 shrink-0 rounded-[2px] overflow-hidden shadow-xs', className);
  const ariaLabel = label || lang.toUpperCase();

  switch (lang) {
    case 'tr':
      return (
        <svg viewBox="0 0 30 20" className={baseClass} role="img" aria-label={ariaLabel}>
          <rect width="30" height="20" fill="#E30A17" />
          <circle cx="10.8" cy="10" r="5" fill="#FFFFFF" />
          <circle cx="12.1" cy="10" r="4" fill="#E30A17" />
          <polygon
            fill="#FFFFFF"
            points="15.8,10 19.3,11.14 17.14,8.16 17.14,11.84 19.3,8.86"
          />
        </svg>
      );

    case 'en':
      return (
        <svg viewBox="0 0 30 20" className={baseClass} role="img" aria-label={ariaLabel}>
          <rect width="30" height="20" fill="#012169" />
          <path d="M0,0 L30,20 M30,0 L0,20" stroke="#FFFFFF" strokeWidth="4" />
          <path d="M0,0 L30,20 M30,0 L0,20" stroke="#C8102E" strokeWidth="2" />
          <path d="M15,0 V20 M0,10 H30" stroke="#FFFFFF" strokeWidth="6" />
          <path d="M15,0 V20 M0,10 H30" stroke="#C8102E" strokeWidth="3.4" />
        </svg>
      );

    case 'es':
      return (
        <svg viewBox="0 0 30 20" className={baseClass} role="img" aria-label={ariaLabel}>
          <rect width="30" height="20" fill="#AA151B" />
          <rect y="5" width="30" height="10" fill="#F1BF00" />
          <rect x="6.5" y="7.5" width="3" height="5" rx="0.8" fill="#AA151B" />
        </svg>
      );

    case 'pt-br':
      return (
        <svg viewBox="0 0 30 20" className={baseClass} role="img" aria-label={ariaLabel}>
          <rect width="30" height="20" fill="#009C3B" />
          <polygon points="15,2.5 27,10 15,17.5 3,10" fill="#FFDF00" />
          <circle cx="15" cy="10" r="4.2" fill="#002776" />
          <path d="M11.2,9.2 Q15,11 18.8,9.8" stroke="#FFFFFF" strokeWidth="0.9" fill="none" />
        </svg>
      );

    case 'ru':
      return (
        <svg viewBox="0 0 30 20" className={baseClass} role="img" aria-label={ariaLabel}>
          <rect width="30" height="6.67" fill="#FFFFFF" />
          <rect y="6.67" width="30" height="6.67" fill="#0039A6" />
          <rect y="13.34" width="30" height="6.66" fill="#D52B1E" />
        </svg>
      );

    case 'fr':
      return (
        <svg viewBox="0 0 30 20" className={baseClass} role="img" aria-label={ariaLabel}>
          <rect width="10" height="20" fill="#002395" />
          <rect x="10" width="10" height="20" fill="#FFFFFF" />
          <rect x="20" width="10" height="20" fill="#ED2939" />
        </svg>
      );

    case 'id':
      return (
        <svg viewBox="0 0 30 20" className={baseClass} role="img" aria-label={ariaLabel}>
          <rect width="30" height="10" fill="#CE1126" />
          <rect y="10" width="30" height="10" fill="#FFFFFF" />
        </svg>
      );

    case 'ar':
      return (
        <svg viewBox="0 0 30 20" className={baseClass} role="img" aria-label={ariaLabel}>
          <rect width="30" height="20" fill="#006C35" />
          <rect x="7" y="7" width="16" height="2.2" rx="1" fill="#FFFFFF" />
          <rect x="9" y="11.5" width="12" height="1.4" rx="0.7" fill="#FFFFFF" />
        </svg>
      );

    case 'de':
      return (
        <svg viewBox="0 0 30 20" className={baseClass} role="img" aria-label={ariaLabel}>
          <rect width="30" height="6.67" fill="#000000" />
          <rect y="6.67" width="30" height="6.67" fill="#DD0000" />
          <rect y="13.34" width="30" height="6.66" fill="#FFCE00" />
        </svg>
      );

    case 'it':
      return (
        <svg viewBox="0 0 30 20" className={baseClass} role="img" aria-label={ariaLabel}>
          <rect width="10" height="20" fill="#009246" />
          <rect x="10" width="10" height="20" fill="#FFFFFF" />
          <rect x="20" width="10" height="20" fill="#CE2B37" />
        </svg>
      );

    case 'pl':
      return (
        <svg viewBox="0 0 30 20" className={baseClass} role="img" aria-label={ariaLabel}>
          <rect width="30" height="10" fill="#FFFFFF" />
          <rect y="10" width="30" height="10" fill="#DC143C" />
        </svg>
      );

    case 'vi':
      return (
        <svg viewBox="0 0 30 20" className={baseClass} role="img" aria-label={ariaLabel}>
          <rect width="30" height="20" fill="#DA251D" />
          <polygon
            fill="#FFFF00"
            points="15,4.2 16.55,8.8 21.4,8.8 17.5,11.65 18.95,16.2 15,13.4 11.05,16.2 12.5,11.65 8.6,8.8 13.45,8.8"
          />
        </svg>
      );

    case 'th':
      return (
        <svg viewBox="0 0 30 20" className={baseClass} role="img" aria-label={ariaLabel}>
          <rect width="30" height="3.33" fill="#A51931" />
          <rect y="3.33" width="30" height="3.33" fill="#FFFFFF" />
          <rect y="6.66" width="30" height="6.68" fill="#2D2A4A" />
          <rect y="13.34" width="30" height="3.33" fill="#FFFFFF" />
          <rect y="16.67" width="30" height="3.33" fill="#A51931" />
        </svg>
      );

    case 'ja':
      return (
        <svg viewBox="0 0 30 20" className={baseClass} role="img" aria-label={ariaLabel}>
          <rect width="30" height="20" fill="#FFFFFF" />
          <circle cx="15" cy="10" r="5.5" fill="#BC002D" />
        </svg>
      );

    case 'ko':
      return (
        <svg viewBox="0 0 30 20" className={baseClass} role="img" aria-label={ariaLabel}>
          <rect width="30" height="20" fill="#FFFFFF" />
          <circle cx="15" cy="10" r="4.8" fill="#CD2E3A" />
          <path d="M10.2,10 A4.8,4.8 0 0,0 19.8,10 A2.4,2.4 0 0,0 15,10 A2.4,2.4 0 0,1 10.2,10 Z" fill="#0047A0" />
          <g stroke="#111111" strokeWidth="1.2">
            <line x1="6" y1="5" x2="8.5" y2="3.2" />
            <line x1="21.5" y1="3.2" x2="24" y2="5" />
            <line x1="6" y1="15" x2="8.5" y2="16.8" />
            <line x1="21.5" y1="16.8" x2="24" y2="15" />
          </g>
        </svg>
      );

    case 'zh':
      return (
        <svg viewBox="0 0 30 20" className={baseClass} role="img" aria-label={ariaLabel}>
          <rect width="30" height="20" fill="#DE2910" />
          <polygon
            fill="#FFDE00"
            points="6.5,2.5 7.4,5.2 10.2,5.2 7.9,6.8 8.8,9.5 6.5,7.8 4.2,9.5 5.1,6.8 2.8,5.2 5.6,5.2"
          />
          <circle cx="11.5" cy="3.2" r="0.7" fill="#FFDE00" />
          <circle cx="13" cy="5" r="0.7" fill="#FFDE00" />
          <circle cx="13" cy="7.5" r="0.7" fill="#FFDE00" />
          <circle cx="11.5" cy="9.2" r="0.7" fill="#FFDE00" />
        </svg>
      );

    default:
      return (
        <span className={cn('text-[10px] font-black uppercase leading-none', className)}>
          {lang.slice(0, 3).toUpperCase()}
        </span>
      );
  }
};
