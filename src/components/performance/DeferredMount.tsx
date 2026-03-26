import React from 'react';
import { useNearViewport } from '@/hooks/use-near-viewport';

interface DeferredMountProps {
  children: React.ReactNode;
  className?: string;
  placeholder?: React.ReactNode;
  placeholderMinHeight?: number | string;
  rootMargin?: string;
  once?: boolean;
  disabled?: boolean;
}

const toCssSize = (value?: number | string) => {
  if (typeof value === 'number') {
    return `${value}px`;
  }

  return value;
};

const DeferredMount: React.FC<DeferredMountProps> = ({
  children,
  className,
  placeholder,
  placeholderMinHeight = 1,
  rootMargin,
  once = true,
  disabled = false,
}) => {
  const { ref, isNearViewport } = useNearViewport<HTMLDivElement>({
    rootMargin,
    once,
    disabled,
  });

  return (
    <div ref={ref} className={className}>
      {isNearViewport ? children : placeholder ?? (
        <div
          aria-hidden
          style={{ minHeight: toCssSize(placeholderMinHeight) }}
        />
      )}
    </div>
  );
};

export default DeferredMount;
