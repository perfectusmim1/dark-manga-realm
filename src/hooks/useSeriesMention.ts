import { useCallback, useEffect, useState } from 'react';
import {
  detectActiveSeriesTrigger,
  formatSeriesMentionToken,
} from '@/lib/commentContent';
import { MangaMentionResult } from '@/lib/database';

interface UseSeriesMentionOptions {
  value: string;
  onChange: (nextValue: string) => void;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
}

/**
 * Coordinates `#query` detection, keyboard navigation, and insertion of `[#Title](#series:id)`
 * inside any controlled `<textarea>`.
 */
export const useSeriesMention = ({
  value,
  onChange,
  textareaRef,
}: UseSeriesMentionOptions) => {
  const [trigger, setTrigger] = useState<{ startIndex: number; endIndex: number; query: string } | null>(null);
  const [results, setResults] = useState<MangaMentionResult[]>([]);
  const [highlightedIndex, setHighlightedIndex] = useState(0);

  const syncTriggerFromTextarea = useCallback(
    (nextText: string, explicitCaret?: number | null) => {
      const caret = explicitCaret ?? textareaRef.current?.selectionStart ?? nextText.length;
      const detected = detectActiveSeriesTrigger(nextText, caret);
      setTrigger(detected);
      if (detected) {
        setHighlightedIndex(0);
      }
    },
    [textareaRef],
  );

  useEffect(() => {
    if (!trigger) return;
    if (!value || trigger.endIndex > value.length) {
      setTrigger(null);
    }
  }, [value, trigger]);

  const closePopover = useCallback(() => {
    setTrigger(null);
  }, []);

  const triggerManually = useCallback(() => {
    const el = textareaRef.current;
    const pos = el?.selectionStart ?? value.length;
    const before = value.slice(0, pos);
    const after = value.slice(pos);
    const needsLeadingSpace = before.length > 0 && !/\s$/.test(before);
    const inserted = `${needsLeadingSpace ? ' ' : ''}#`;
    const nextValue = `${before}${inserted}${after}`;
    const nextCaret = before.length + inserted.length;

    onChange(nextValue);
    syncTriggerFromTextarea(nextValue, nextCaret);

    window.requestAnimationFrame(() => {
      const target = textareaRef.current;
      if (!target) return;
      target.focus();
      target.setSelectionRange(nextCaret, nextCaret);
    });
  }, [onChange, syncTriggerFromTextarea, textareaRef, value]);

  const selectSeries = useCallback(
    (series: MangaMentionResult) => {
      const el = textareaRef.current;
      const activeTrigger =
        trigger ??
        detectActiveSeriesTrigger(value, el?.selectionStart ?? value.length);

      const token = `${formatSeriesMentionToken(series.id, series.title)} `;
      let nextValue: string;
      let nextCaret: number;

      if (activeTrigger) {
        nextValue =
          value.slice(0, activeTrigger.startIndex) +
          token +
          value.slice(activeTrigger.endIndex);
        nextCaret = activeTrigger.startIndex + token.length;
      } else {
        const pos = el?.selectionStart ?? value.length;
        const prefixSpace = pos > 0 && !/\s$/.test(value.slice(0, pos)) ? ' ' : '';
        nextValue = value.slice(0, pos) + prefixSpace + token + value.slice(pos);
        nextCaret = pos + prefixSpace.length + token.length;
      }

      onChange(nextValue);
      setTrigger(null);

      window.requestAnimationFrame(() => {
        const target = textareaRef.current;
        if (!target) return;
        target.focus();
        target.setSelectionRange(nextCaret, nextCaret);
      });
    },
    [onChange, textareaRef, trigger, value],
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>): boolean => {
      if (!trigger) {
        return false;
      }

      if (event.key === 'Escape') {
        event.preventDefault();
        setTrigger(null);
        return true;
      }

      if (results.length === 0) {
        return false;
      }

      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setHighlightedIndex((prev) => (prev + 1) % results.length);
        return true;
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setHighlightedIndex((prev) => (prev - 1 + results.length) % results.length);
        return true;
      }

      if (event.key === 'Enter' || event.key === 'Tab') {
        const chosen = results[highlightedIndex] ?? results[0];
        if (chosen) {
          event.preventDefault();
          selectSeries(chosen);
          return true;
        }
      }

      return false;
    },
    [highlightedIndex, results, selectSeries, trigger],
  );

  return {
    isPopoverOpen: Boolean(trigger),
    mentionQuery: trigger?.query ?? '',
    highlightedIndex,
    setHighlightedIndex,
    setResults,
    syncTriggerFromTextarea,
    triggerManually,
    selectSeries,
    closePopover,
    handleKeyDown,
  };
};
