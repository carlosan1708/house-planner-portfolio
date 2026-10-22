"use client";

import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import "./mobile-navigation.css";

const MOBILE_MEDIA = "(max-width: 680px), (max-width: 900px) and (max-height: 500px) and (pointer: coarse)";
const SHORTCUT_SECTIONS = ["overview", "budget", "documents", "aesthetics"];

type NavigationItem<Section extends string> = {
  id: Section;
  label: string;
  icon: string;
  badge?: number;
};

export default function MobileWorkspaceNavigation<Section extends string>({
  items,
  active,
  language,
  projectName,
  onNavigate,
  actions,
}: {
  items: NavigationItem<Section>[];
  active: Section;
  language: "es" | "en";
  projectName: string;
  onNavigate: (section: Section) => void;
  actions?: ReactNode;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const dialogId = useId();
  const titleId = useId();
  const spanish = language === "es";
  const shortcutItems = SHORTCUT_SECTIONS.flatMap((section) => items.filter((item) => item.id === section));
  for (const item of items) {
    if (shortcutItems.length >= 4) break;
    if (!shortcutItems.some((shortcut) => shortcut.id === item.id)) shortcutItems.push(item);
  }
  const activeInMenu = !shortcutItems.some((item) => item.id === active);
  const menuBadge = items.reduce((total, item) => total + (!shortcutItems.includes(item) ? item.badge || 0 : 0), 0);

  function closeMenu() {
    dialog.current?.close();
    setMenuOpen(false);
  }

  function openMenu() {
    if (!dialog.current || dialog.current.open) return;
    dialog.current.showModal();
    setMenuOpen(true);
  }

  useEffect(() => {
    if (!menuOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previousOverflow; };
  }, [menuOpen]);

  useEffect(() => {
    const query = window.matchMedia(MOBILE_MEDIA);
    const closeOnDesktop = () => {
      if (query.matches) return;
      dialog.current?.close();
      setMenuOpen(false);
    };
    query.addEventListener("change", closeOnDesktop);
    return () => {
      query.removeEventListener("change", closeOnDesktop);
    };
  }, []);

  function navigate(section: Section) {
    // Existing save/discard confirmations must be able to appear above the workspace.
    closeMenu();
    onNavigate(section);
  }

  return (
    <>
      <nav
        className="mobile-workspace-nav"
        aria-label={spanish ? "Secciones del proyecto" : "Project sections"}
        style={{ gridTemplateColumns: `repeat(${shortcutItems.length + 1}, minmax(0, 1fr))` }}
      >
        {shortcutItems.map((item) => (
          <button
            key={item.id}
            type="button"
            className={active === item.id ? "mobile-nav-button active" : "mobile-nav-button"}
            aria-current={active === item.id ? "page" : undefined}
            aria-label={item.id === "distribution" ? item.label : undefined}
            title={item.label}
            onClick={() => onNavigate(item.id)}
          >
            <span aria-hidden="true" className="mobile-nav-icon">{item.icon}</span>
            <span className="mobile-nav-label">{item.id === "distribution" ? "3D" : item.label}</span>
            {!!item.badge && <em className="mobile-nav-badge">{item.badge}</em>}
          </button>
        ))}
        <button
          type="button"
          className={activeInMenu || menuOpen ? "mobile-nav-button active" : "mobile-nav-button"}
          aria-haspopup="dialog"
          aria-expanded={menuOpen}
          aria-controls={dialogId}
          onClick={openMenu}
        >
          <svg aria-hidden="true" className="mobile-nav-icon" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M4 6h16M4 12h16M4 18h16" /></svg>
          <span className="mobile-nav-label">{spanish ? "Secciones" : "Sections"}</span>
          {menuBadge > 0 && <em className="mobile-nav-badge" aria-hidden="true">{menuBadge}</em>}
        </button>
      </nav>
      <dialog
        ref={dialog}
        id={dialogId}
        className="mobile-sections-dialog"
        aria-labelledby={titleId}
        onClose={() => setMenuOpen(false)}
        onClick={(event) => {
          if (event.target !== event.currentTarget) return;
          const bounds = event.currentTarget.getBoundingClientRect();
          if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) closeMenu();
        }}
      >
        <header>
          <div><small title={projectName}>{projectName}</small><h2 id={titleId}>{spanish ? "Secciones" : "Sections"}</h2></div>
          <button type="button" aria-label={spanish ? "Cerrar secciones" : "Close sections"} onClick={closeMenu}>×</button>
        </header>
        <div className="mobile-sections-scroll">
          <nav className="mobile-sections-grid" aria-label={spanish ? "Todas las secciones" : "All sections"}>
            {items.map((item) => (
              <button
                key={item.id}
                type="button"
                className={active === item.id ? "active" : undefined}
                aria-current={active === item.id ? "page" : undefined}
                onClick={() => navigate(item.id)}
              >
                <span aria-hidden="true">{item.icon}</span>
                <b>{item.label}</b>
                {!!item.badge && <em>{item.badge}</em>}
              </button>
            ))}
          </nav>
          {actions && <div className="mobile-sections-actions" onClickCapture={(event) => { if ((event.target as HTMLElement).closest("button")) closeMenu(); }}>{actions}</div>}
        </div>
      </dialog>
    </>
  );
}
