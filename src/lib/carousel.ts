type CarouselDirection = 'left' | 'right';

const clampCarouselOffset = (value: number, maxScrollLeft: number) => (
  Math.min(Math.max(value, 0), Math.max(0, maxScrollLeft))
);

export const getAlignedCarouselTarget = ({
  currentScrollLeft,
  itemStride,
  direction,
  stepItems,
  maxScrollLeft,
}: {
  currentScrollLeft: number;
  itemStride: number;
  direction: CarouselDirection;
  stepItems: number;
  maxScrollLeft: number;
}) => {
  if (itemStride <= 0) {
    return 0;
  }

  const safeMaxScrollLeft = Math.max(0, maxScrollLeft);
  const normalizedScrollLeft = clampCarouselOffset(currentScrollLeft, safeMaxScrollLeft);
  const currentIndex = Math.round(normalizedScrollLeft / itemStride);
  const nextIndex = currentIndex + (direction === 'left' ? -Math.max(1, stepItems) : Math.max(1, stepItems));

  return clampCarouselOffset(nextIndex * itemStride, safeMaxScrollLeft);
};
