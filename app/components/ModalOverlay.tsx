"use client";

import { useRef, type ComponentPropsWithoutRef } from "react";
import useModalFocus from "./useModalFocus";

export default function ModalOverlay({ children, onEscape, onKeyDown, ...props }: ComponentPropsWithoutRef<"div"> & { onEscape?: () => void }) {
  const modal = useRef<HTMLDivElement>(null);
  useModalFocus(true, modal);
  return <div {...props} ref={modal} tabIndex={-1} onKeyDown={(event) => {
    onKeyDown?.(event);
    if (event.key === "Escape" && !event.defaultPrevented && onEscape) {
      event.preventDefault();
      event.stopPropagation();
      onEscape();
    }
  }}>{children}</div>;
}
