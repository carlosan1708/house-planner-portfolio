"use client";

import { useEffect, useRef, type MouseEvent, type TouchEvent } from "react";

type SwipeOptions = { enabled?: boolean; onPrevious: () => void; onNext: () => void; onInteraction?: () => void };
type Gesture = { id: number; x: number; y: number; axis: "pending" | "horizontal" | "vertical"; moved: boolean };

/** Recognizes deliberate single-finger photo swipes without owning scroll or pinch. */
export function usePhotoSwipe({ enabled = true, onPrevious, onNext, onInteraction }: SwipeOptions) {
  const gesture = useRef<Gesture | null>(null);
  const suppressClickUntil = useRef(0);

  const cancelGesture = () => {
    if (gesture.current?.moved) suppressClickUntil.current = Date.now() + 800;
    gesture.current = null;
  };

  useEffect(() => {
    // Rotation invalidates the coordinates of an in-progress gesture.
    const cancel = () => { gesture.current = null; };
    window.addEventListener("resize", cancel);
    return () => window.removeEventListener("resize", cancel);
  }, []);

  return {
    onTouchStart(event: TouchEvent<HTMLElement>) {
      onInteraction?.();
      if (event.touches.length !== 1) {
        cancelGesture();
        if (event.touches.length > 1) suppressClickUntil.current = Date.now() + 800;
        return;
      }
      const touch = event.touches[0];
      gesture.current = { id: touch.identifier, x: touch.clientX, y: touch.clientY, axis: "pending", moved: false };
      suppressClickUntil.current = 0;
    },
    onTouchMove(event: TouchEvent<HTMLElement>) {
      const start = gesture.current;
      if (!start) return;
      if (event.touches.length !== 1) { cancelGesture(); suppressClickUntil.current = Date.now() + 800; return; }
      const touch = event.touches[0];
      if (touch.identifier !== start.id) { cancelGesture(); return; }
      const dx = Math.abs(touch.clientX - start.x);
      const dy = Math.abs(touch.clientY - start.y);
      if (Math.max(dx, dy) < 12) return;
      start.moved = true;
      if (start.axis === "pending") {
        if (dy > dx) start.axis = "vertical";
        else if (dx > dy * 1.4) start.axis = "horizontal";
      }
    },
    onTouchEnd(event: TouchEvent<HTMLElement>) {
      const start = gesture.current;
      gesture.current = null;
      if (!start) return;
      const touch = Array.from(event.changedTouches).find((item) => item.identifier === start.id);
      if (!touch) return;
      const dx = touch.clientX - start.x;
      const dy = touch.clientY - start.y;
      const moved = start.moved || Math.max(Math.abs(dx), Math.abs(dy)) >= 12;
      if (moved) suppressClickUntil.current = Date.now() + 800;
      if (!enabled || event.touches.length || start.axis === "vertical" || Math.abs(dx) < 48 || Math.abs(dx) <= Math.abs(dy) * 1.4) return;
      if (dx < 0) onNext();
      else onPrevious();
    },
    onTouchCancel: cancelGesture,
    onClickCapture(event: MouseEvent<HTMLElement>) {
      // Keyboard activation must remain available even immediately after a swipe.
      if (event.detail === 0 || Date.now() >= suppressClickUntil.current) return;
      event.preventDefault();
      event.stopPropagation();
      suppressClickUntil.current = 0;
    },
  };
}

export default usePhotoSwipe;
