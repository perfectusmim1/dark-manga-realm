import * as React from 'react';

const DRAG_START_THRESHOLD_PX = 6;

interface DragScrollState {
  pointerId: number | null;
  startClientX: number;
  startScrollLeft: number;
  moved: boolean;
}

const EMPTY_DRAG_STATE: DragScrollState = {
  pointerId: null,
  startClientX: 0,
  startScrollLeft: 0,
  moved: false,
};

export const useHorizontalDragScroll = <T extends HTMLElement>(enabled: boolean) => {
  const scrollRef = React.useRef<T | null>(null);
  const dragStateRef = React.useRef<DragScrollState>(EMPTY_DRAG_STATE);
  const suppressClickRef = React.useRef(false);
  const [isDragging, setIsDragging] = React.useState(false);

  const resetDragState = React.useCallback(() => {
    dragStateRef.current = EMPTY_DRAG_STATE;
    setIsDragging(false);
  }, []);

  const handlePointerDown = React.useCallback((event: React.PointerEvent<T>) => {
    if (!enabled || event.pointerType === 'touch' || event.button !== 0) {
      return;
    }

    const scroller = scrollRef.current;
    if (!scroller || scroller.scrollWidth <= scroller.clientWidth + 1) {
      return;
    }

    dragStateRef.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startScrollLeft: scroller.scrollLeft,
      moved: false,
    };
    suppressClickRef.current = false;
    event.currentTarget.setPointerCapture(event.pointerId);
  }, [enabled]);

  const handlePointerMove = React.useCallback((event: React.PointerEvent<T>) => {
    const scroller = scrollRef.current;
    const dragState = dragStateRef.current;
    if (!scroller || dragState.pointerId !== event.pointerId) {
      return;
    }

    const deltaX = event.clientX - dragState.startClientX;
    if (!dragState.moved && Math.abs(deltaX) < DRAG_START_THRESHOLD_PX) {
      return;
    }

    if (!dragState.moved) {
      dragState.moved = true;
      setIsDragging(true);
    }

    suppressClickRef.current = true;
    scroller.scrollLeft = dragState.startScrollLeft - deltaX;
    event.preventDefault();
  }, []);

  const handlePointerEnd = React.useCallback((event: React.PointerEvent<T>) => {
    const dragState = dragStateRef.current;
    if (dragState.pointerId !== event.pointerId) {
      return;
    }

    resetDragState();
  }, [resetDragState]);

  const handleClickCapture = React.useCallback((event: React.MouseEvent<T>) => {
    if (!suppressClickRef.current) {
      return;
    }

    suppressClickRef.current = false;
    event.preventDefault();
    event.stopPropagation();
  }, []);

  return {
    scrollRef,
    isDragging,
    dragHandlers: {
      onPointerDown: handlePointerDown,
      onPointerMove: handlePointerMove,
      onPointerUp: handlePointerEnd,
      onPointerCancel: handlePointerEnd,
      onLostPointerCapture: handlePointerEnd,
      onClickCapture: handleClickCapture,
    },
  };
};
