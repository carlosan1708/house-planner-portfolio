"use client";

import { useEffect, type RefObject } from "react";

const activeModals: { modal: HTMLElement }[] = [];

export default function useModalFocus(open: boolean, modalRef: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const modal = modalRef.current;
    if (!open || !modal) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const entry = { modal };
    activeModals.push(entry);
    const isTopmost = () => activeModals.at(-1) === entry;
    const focusable = () => Array.from(modal.querySelectorAll<HTMLElement>(
      'a[href], button, input, select, textarea, summary, audio[controls], [tabindex]',
    )).filter((element) => element.tabIndex >= 0 && !element.matches(":disabled") && !element.closest("[inert]") && element.getClientRects().length > 0 && getComputedStyle(element).visibility !== "hidden");
    // Preserve the trigger before focusing a safe action or announcing the dialog.
    const initialFocus = focusable().find((element) => element.hasAttribute("data-modal-initial-focus"));
    (initialFocus || modal).focus({ preventScroll: true });
    const containFocus = (event: FocusEvent) => {
      if (!isTopmost()) return;
      if (event.target instanceof Node && !modal.contains(event.target)) modal.focus({ preventScroll: true });
    };
    const cycleFocus = (event: KeyboardEvent) => {
      if (!isTopmost() || event.key !== "Tab" || event.defaultPrevented) return;
      const controls = focusable();
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (!first) {
        event.preventDefault();
        modal.focus({ preventScroll: true });
      } else if (event.shiftKey && (document.activeElement === first || document.activeElement === modal)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === modal)) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("focusin", containFocus);
    document.addEventListener("keydown", cycleFocus);
    return () => {
      document.removeEventListener("focusin", containFocus);
      document.removeEventListener("keydown", cycleFocus);
      const wasTopmost = isTopmost();
      const index = activeModals.indexOf(entry);
      if (index >= 0) activeModals.splice(index, 1);
      if (!wasTopmost) return;
      const remainingModal = activeModals.at(-1)?.modal;
      if (previousFocus?.isConnected && (!remainingModal || remainingModal.contains(previousFocus))) previousFocus.focus({ preventScroll: true });
      else remainingModal?.focus({ preventScroll: true });
    };
  }, [open, modalRef]);
}
