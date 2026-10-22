"use client";

import Image from "next/image";
import { DEMO_EXTERIOR_IMAGE_SRC } from "@/lib/demo-assets";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { AESTHETIC_CAROUSEL_LIMIT, aestheticClassification, aestheticClassificationLabel, aestheticName, type AestheticImageClassification } from "@/lib/aesthetics";
import { aestheticCarouselItems, aestheticFolderPath, aestheticFolderTrail } from "@/lib/aesthetic-navigation";
import { createUploadBatch, uploadFormData, type UploadProgressState } from "@/lib/upload-progress";
import { trackDemoAction, trackUsageInteraction } from "@/lib/usage-client";
import CopyWorkspaceLink from "./CopyWorkspaceLink";
import FileShareButton from "./FileShareButton";
import UploadProgress from "./UploadProgress";
import AestheticImageNotesDialog from "./AestheticImageNotesDialog";
import usePhotoSwipe from "./usePhotoSwipe";
import "./aesthetics.css";
import "./aesthetics-navigation.css";

type Language = "en" | "es";
type Folder = { id: string; name: string; kind: "images" | "plans"; parentId?: string | null; sortOrder?: number; carouselImageIds: string[]; createdAt: string };
type AestheticImage = { id: string; folderId: string; name: string; caption: string; notes?: string; classification?: AestheticImageClassification; width: number; height: number; createdAt: string; mediaType: "image" | "pdf"; contentType: string; imageUrl: string; thumbnailUrl: string };
type Payload = { folders: Folder[]; images: AestheticImage[] };
type FolderDialog = { mode: "create" | "rename"; value: string; parentId?: string };
type DeleteTarget = { type: "folder"; folder: Folder } | { type: "image"; image: AestheticImage };

const t = (language: Language, en: string, es: string) => language === "es" ? es : en;
const PDF_ZOOM_MIN = 50;
const PDF_ZOOM_MAX = 200;
const PDF_ZOOM_STEP = 25;

const pdfUrlAtZoom = (url: string, zoom: number) => `${url.split("#", 1)[0]}#zoom=${zoom}`;

function archiveFilename(disposition: string | null) {
  const encoded = disposition?.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  if (encoded) {
    try { return decodeURIComponent(encoded).replace(/[\\/\x00-\x1f]/g, "_"); } catch { /* Use the ordinary filename if the encoding is malformed. */ }
  }
  return disposition?.match(/filename="([^"]+)"/i)?.[1]?.replace(/[\\/\x00-\x1f]/g, "_") || "imagenes.zip";
}

function ImageClassificationBadge({ image, language }: { image: AestheticImage; language: Language }) {
  return <small className="aesthetic-classification" data-classification={aestheticClassification(image.classification)}>{aestheticClassificationLabel(image.classification, language)}</small>;
}

function ImageNotesButton({ image, language, onClick, className = "" }: { image: AestheticImage; language: Language; onClick: () => void; className?: string }) {
  const hasNotes = Boolean(image.notes?.trim());
  return <button type="button" className={`aesthetic-notes-button ${className}`} data-has-notes={hasNotes} aria-haspopup="dialog" aria-label={t(language, `Notes for ${image.name}`, `Notas de ${image.name}`)} title={hasNotes ? t(language, "View notes", "Ver notas") : t(language, "Image notes", "Notas de la imagen")} onClick={(event) => { event.currentTarget.focus({ preventScroll: true }); onClick(); }}>
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 4h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-6 4V6a2 2 0 0 1 2-2Z" /><path d="M7 9h10M7 13h6" /></svg>
    <span>{t(language, "Notes", "Notas")}</span>{hasNotes && <i aria-hidden="true" />}
  </button>;
}

function FolderIcon({ plans = false }: { plans?: boolean }) {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {plans ? <><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" /><path d="M14 3v6h6M8 13h8M8 17h6" /></> : <path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />}
  </svg>;
}

function PdfPreview({ item, language, compact = false }: { item: AestheticImage; language: Language; compact?: boolean }) {
  const [zoom, setZoom] = useState(100);

  const updateZoom = (amount: number) => {
    setZoom((current) => Math.min(PDF_ZOOM_MAX, Math.max(PDF_ZOOM_MIN, current + amount)));
  };

  return <div className={`aesthetic-pdf-preview ${compact ? "compact" : ""}`}>
    <div className="aesthetic-pdf-controls" role="toolbar" aria-label={t(language, "PDF zoom controls", "Controles de zoom del PDF")}>
      <button type="button" disabled={zoom === PDF_ZOOM_MIN} onClick={() => updateZoom(-PDF_ZOOM_STEP)} aria-label={t(language, "Zoom out", "Alejar")}>−</button>
      <button type="button" className="aesthetic-pdf-zoom-value" onClick={() => setZoom(100)} aria-label={t(language, "Reset zoom to 100%", "Restablecer zoom a 100%")}>{zoom}%</button>
      <button type="button" disabled={zoom === PDF_ZOOM_MAX} onClick={() => updateZoom(PDF_ZOOM_STEP)} aria-label={t(language, "Zoom in", "Acercar")}>＋</button>
      <a href={item.imageUrl} target="_blank" rel="noreferrer" aria-label={t(language, `Open ${item.name} in another tab`, `Abrir ${item.name} en otra pestaña`)}>{compact ? "↗" : t(language, "Open in another tab", "Abrir en otra pestaña")}</a>
    </div>
    <iframe key={`${item.id}-${zoom}`} title={item.name} src={pdfUrlAtZoom(item.imageUrl, zoom)} />
  </div>;
}

const demoPayload: Payload = {
  folders: [
    { id: "demo-interior", name: "Interior", kind: "images", sortOrder: 0, carouselImageIds: ["demo-1", "demo-2", "demo-3"], createdAt: "2026-08-01T12:00:00Z" },
    { id: "demo-exterior", name: "Exterior", kind: "images", sortOrder: 1, carouselImageIds: ["demo-4"], createdAt: "2026-08-02T12:00:00Z" },
    { id: "demo-plans", name: "Planos", kind: "plans", sortOrder: 2, carouselImageIds: [], createdAt: "2026-08-03T12:00:00Z" },
  ],
  images: [
    { id: "demo-1", folderId: "demo-interior", name: "Sala principal.jpg", caption: "Luz natural y tonos cálidos", notes: "Mantener la entrada de luz natural.\nCombinar madera clara con textiles cálidos.", width: 1200, height: 800, createdAt: "2026-08-05T12:00:00Z", mediaType: "image", contentType: "image/svg+xml", imageUrl: "/demo/casa-mirador-living.svg", thumbnailUrl: "/demo/casa-mirador-living.svg" },
    { id: "demo-2", folderId: "demo-interior", name: "Cocina.jpg", caption: "Madera clara y piedra", width: 1200, height: 800, createdAt: "2026-08-04T12:00:00Z", mediaType: "image", contentType: "image/svg+xml", imageUrl: "/demo/casa-mirador-kitchen.svg", thumbnailUrl: "/demo/casa-mirador-kitchen.svg" },
    { id: "demo-3", folderId: "demo-interior", name: "Baño.jpg", caption: "Texturas naturales", width: 1200, height: 800, createdAt: "2026-08-03T12:00:00Z", mediaType: "image", contentType: "image/svg+xml", imageUrl: "/demo/casa-mirador-bath.svg", thumbnailUrl: "/demo/casa-mirador-bath.svg" },
    { id: "demo-4", folderId: "demo-exterior", name: "Terraza.jpg", caption: "Render del modelo 3D · pérgola de madera, terraza y apertura acristalada al jardín", notes: "Vista generada desde la misma geometría de Distribution 3D de Casa Mirador.\nLa planta de 12 × 10 m, la cubierta, las aberturas, la terraza y la pérgola están representadas en 3D.\nMateriales y paisajismo ilustrativos; proyecto ficticio.", width: 1800, height: 1200, mediaType: "image", contentType: "image/webp", createdAt: "2026-08-02T12:00:00Z", imageUrl: DEMO_EXTERIOR_IMAGE_SRC, thumbnailUrl: DEMO_EXTERIOR_IMAGE_SRC },
  ],
};


const demoImageText: Record<string, Record<string, readonly [string, string]>> = {
  "demo-1": { name: ["Main living room.jpg", "Sala principal.jpg"], caption: ["Natural light and warm tones", "Luz natural y tonos cálidos"], notes: ["Keep natural light coming in.\nCombine light wood with warm textiles.", "Mantener la entrada de luz natural.\nCombinar madera clara con textiles cálidos."] },
  "demo-2": { name: ["Kitchen.jpg", "Cocina.jpg"], caption: ["Light wood and stone", "Madera clara y piedra"] },
  "demo-3": { name: ["Bathroom.jpg", "Baño.jpg"], caption: ["Natural textures", "Texturas naturales"] },
  "demo-4": { name: ["Terrace.jpg", "Terraza.jpg"], caption: ["Render from the 3D model · timber pergola, terrace and garden glazing", "Render del modelo 3D · pérgola de madera, terraza y apertura acristalada al jardín"], notes: ["View generated from the same Casa Mirador Distribution 3D geometry.\nThe 12 × 10 m plan, roof, openings, terrace and pergola are represented in 3D.\nIllustrative materials and landscaping; fictional project.", "Vista generada desde la misma geometría de Distribution 3D de Casa Mirador.\nLa planta de 12 × 10 m, la cubierta, las aberturas, la terraza y la pérgola están representadas en 3D.\nMateriales y paisajismo ilustrativos; proyecto ficticio."] },
};
function projectDemoImage(image: AestheticImage, language: Language, customNotes: string[]): AestheticImage {
  const fields = demoImageText[image.id];
  if (!fields) return image;
  return Object.fromEntries(Object.entries(image).map(([field, value]) => {
    const text = fields[field];
    return [field, text && !(field === "notes" && customNotes.includes(image.id)) && (value === text[0] || value === text[1]) ? t(language, text[0], text[1]) : value];
  })) as AestheticImage;
}

export default function AestheticsWorkspace({ mode, language, canEdit, canShare = false, projectId, routeFolderId, onRouteFolderChange }: { mode: "demo" | "real"; language: Language; canEdit: boolean; canShare?: boolean; projectId?: string; routeFolderId?: string | null; onRouteFolderChange?: (folderId: string | null) => void }) {
  const [storedPayload, setPayload] = useState<Payload>(mode === "demo" ? demoPayload : { folders: [], images: [] });
  const [customNoteIds, setCustomNoteIds] = useState<string[]>([]);
  const payload = useMemo(() => mode === "demo" ? { ...storedPayload, images: storedPayload.images.map((image) => projectDemoImage(image, language, customNoteIds)) } : storedPayload, [mode, language, storedPayload, customNoteIds]);
  const folderLabel = (folder: Folder) => mode === "demo" && folder.id === "demo-plans" && folder.name === "Planos" ? t(language, "Plans", "Planos") : folder.name;
  const [initialLoading, setInitialLoading] = useState(mode === "real");
  const [selectedFolderId, setSelectedFolderId] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [autoPlay, setAutoPlay] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [archiveBusy, setArchiveBusy] = useState(false);
  const [archiveError, setArchiveError] = useState<{ folderId: string; message: string } | null>(null);
  const [uploadProgress, setUploadProgress] = useState<UploadProgressState | null>(null);
  const [uploadFailed, setUploadFailed] = useState(false);
  const [viewer, setViewer] = useState<AestheticImage | null>(null);
  const [viewerImageIds, setViewerImageIds] = useState<string[]>([]);
  const [notesImageId, setNotesImageId] = useState("");
  const [folderDialog, setFolderDialog] = useState<FolderDialog | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [dropActive, setDropActive] = useState(false);
  const [folderDropTarget, setFolderDropTarget] = useState("");
  const [draggedCarouselId, setDraggedCarouselId] = useState("");
  const [draggedGalleryId, setDraggedGalleryId] = useState("");
  const [choosingCarousel, setChoosingCarousel] = useState(false);
  const [sourceFolderId, setSourceFolderId] = useState("");
  const [gallerySourceId, setGallerySourceId] = useState("");
  const uploadInput = useRef<HTMLInputElement>(null);
  const viewerDialog = useRef<HTMLElement>(null);
  const viewerOpener = useRef<HTMLElement | null>(null);
  const draggedGalleryIdRef = useRef("");
  const nativeGalleryDrag = useRef(false);
  const archiveRequest = useRef<AbortController | null>(null);
  const archiveUrls = useRef(new Map<string, number>());

  useEffect(() => {
    const urls = archiveUrls.current;
    return () => {
      archiveRequest.current?.abort();
      for (const [url, timer] of urls) { window.clearTimeout(timer); URL.revokeObjectURL(url); }
      urls.clear();
    };
  }, []);

  const clearGalleryDrag = useCallback(() => {
    nativeGalleryDrag.current = false;
    draggedGalleryIdRef.current = "";
    setDraggedGalleryId("");
  }, []);

  const startGalleryDrag = useCallback((imageId: string) => {
    if (busy || !canEdit) return;
    draggedGalleryIdRef.current = imageId;
    setDraggedGalleryId(imageId);
  }, [busy, canEdit]);

  const refresh = useCallback(async () => {
    if (mode === "demo") return;
    const response = await fetch("/api/aesthetics", { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "aesthetics_unavailable");
    setPayload(data);
  }, [mode]);

  useEffect(() => { const timer = window.setTimeout(() => { void refresh().catch((reason) => setError(reason instanceof Error ? reason.message : "Aesthetics unavailable")).finally(() => setInitialLoading(false)); }, 0); return () => window.clearTimeout(timer); }, [refresh]);

  useEffect(() => {
    if (mode !== "real") return;
    const timer = window.setTimeout(() => { setActiveIndex(0); setViewer(null); setChoosingCarousel(false); setGallerySourceId(""); }, 0);
    return () => window.clearTimeout(timer);
  }, [mode, routeFolderId]);

  const explicitRouteFolder = mode === "real" ? routeFolderId : null;
  const currentFolderId = mode === "real" && onRouteFolderChange ? explicitRouteFolder || "" : selectedFolderId;
  const effectiveFolderId = explicitRouteFolder || (payload.folders.some((folder) => folder.id === currentFolderId) ? currentFolderId : payload.folders[0]?.id || "");
  const selectedFolder = payload.folders.find((folder) => folder.id === effectiveFolderId) || null;
  const routeFolderUnavailable = !initialLoading && Boolean(explicitRouteFolder && !selectedFolder);
  const selectFolder = (folderId: string | null) => {
    if (mode === "real" && onRouteFolderChange) onRouteFolderChange(folderId);
    else setSelectedFolderId(folderId || "");
    setActiveIndex(0);
    setAutoPlay(false);
    setViewer(null);
    setGallerySourceId("");
  };
  const viewerId = viewer?.id || "";
  const viewerOpen = Boolean(viewerId);

  useEffect(() => {
    if (!viewerOpen) return;
    const opener = viewerOpener.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.setProperty("overflow", "hidden");
    viewerDialog.current?.querySelector<HTMLElement>(".close")?.focus({ preventScroll: true });
    return () => {
      document.body.style.setProperty("overflow", previousOverflow);
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, [viewerOpen]);

  useEffect(() => {
    if (!viewerOpen || notesImageId) return;
    const containFocus = (event: FocusEvent) => {
      const dialog = viewerDialog.current;
      // Notes is a sibling modal; its mount makes the viewer inert before effects run.
      if (!dialog || dialog.closest("[inert]") || !(event.target instanceof Node) || dialog.contains(event.target)) return;
      dialog.querySelector<HTMLElement>(".close")?.focus({ preventScroll: true });
    };
    document.addEventListener("focusin", containFocus);
    return () => document.removeEventListener("focusin", containFocus);
  }, [viewerOpen, notesImageId]);

  const handleViewerKeys = (event: KeyboardEvent<HTMLElement>) => {
    if (notesImageId) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setViewer(null);
      return;
    }
    if ((event.key === "ArrowLeft" || event.key === "ArrowRight") && viewerImages.length > 1 && !(event.target instanceof HTMLElement && event.target.closest("select, input, textarea, [contenteditable=true]"))) {
      event.preventDefault();
      moveViewer(event.key === "ArrowLeft" ? -1 : 1);
      return;
    }
    if (event.key !== "Tab") return;
    const controls = Array.from(viewerDialog.current?.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], select:not([disabled]), iframe, [tabindex]:not([tabindex="-1"])') || []);
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (!first) { event.preventDefault(); return; }
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus({ preventScroll: true }); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus({ preventScroll: true }); }
  };
  const selectedFolderIsPlans = selectedFolder?.kind === "plans";
  const protectedFolder = selectedFolderIsPlans && !selectedFolder?.parentId;
  const folderPath = (id: string) => aestheticFolderPath(payload.folders.map((folder) => ({ ...folder, name: folderLabel(folder) })), id);
  const trail = aestheticFolderTrail(payload.folders, effectiveFolderId);
  const navigationFolders = useMemo(() => {
    const rows: { folder: Folder; depth: number }[] = [];
    const visited = new Set<string>();
    const append = (folder: Folder, depth: number) => {
      if (visited.has(folder.id)) return;
      visited.add(folder.id);
      rows.push({ folder, depth });
      payload.folders.filter((child) => child.parentId === folder.id).forEach((child) => append(child, depth + 1));
    };
    payload.folders.filter((folder) => !folder.parentId || !payload.folders.some((parent) => parent.id === folder.parentId)).forEach((folder) => append(folder, 0));
    payload.folders.forEach((folder) => append(folder, 0));
    return rows;
  }, [payload.folders]);
  const hasSubfolders = payload.folders.some((folder) => folder.parentId === effectiveFolderId);
  const pickerImages = payload.images.filter((image) => image.mediaType !== "pdf" && (!sourceFolderId || image.folderId === sourceFolderId));
  const folderImages = useMemo(() => payload.images.filter((image) => image.folderId === effectiveFolderId), [payload.images, effectiveFolderId]);
  const hasArchiveImages = payload.images.some((image) => image.mediaType !== "pdf" && aestheticFolderTrail(payload.folders, image.folderId).some((folder) => folder.id === effectiveFolderId));
  const compatibleGalleryFolders = payload.folders.filter((folder) => folder.kind === selectedFolder?.kind);
  const effectiveGallerySourceId = gallerySourceId === "*" || compatibleGalleryFolders.some((folder) => folder.id === gallerySourceId) ? gallerySourceId : effectiveFolderId;
  const galleryImages = payload.images.filter((image) => (image.mediaType === "pdf") === selectedFolderIsPlans && (effectiveGallerySourceId === "*" || image.folderId === effectiveGallerySourceId));
  const carouselImages = useMemo(() => selectedFolder ? aestheticCarouselItems(payload.images, selectedFolder.carouselImageIds, selectedFolder.kind) : [], [payload.images, selectedFolder]);
  const visibleIndex = Math.max(0, activeIndex) % Math.max(carouselImages.length, 1);
  const activeImage = carouselImages[visibleIndex] || null;
  const notesImage = payload.images.find((image) => image.id === notesImageId) || null;
  const viewerImage = payload.images.find((image) => image.id === viewer?.id) || viewer;
  const viewerImages = viewerImageIds.map((id) => payload.images.find((image) => image.id === id)).filter((image): image is AestheticImage => Boolean(image && image.mediaType !== "pdf"));
  const viewerIndex = viewerImages.findIndex((image) => image.id === viewerImage?.id);
  const moveCarousel = (offset: number) => {
    setAutoPlay(false);
    setActiveIndex((index) => (index + offset + carouselImages.length) % Math.max(carouselImages.length, 1));
  };
  const moveViewer = (offset: number) => {
    if (notesImageId || viewerIndex < 0 || viewerImages.length < 2) return;
    const image = viewerImages[(viewerIndex + offset + viewerImages.length) % viewerImages.length];
    setViewer(image);
    if (carouselImages.some((item) => item.id === image.id)) setActiveIndex(carouselImages.findIndex((item) => item.id === image.id));
  };
  const openViewer = (image: AestheticImage, opener: HTMLElement, source: "carousel" | "gallery" = "gallery") => {
    viewerOpener.current = opener;
    setAutoPlay(false);
    setViewerImageIds(image.mediaType === "pdf" ? [] : (source === "carousel" ? carouselImages : galleryImages).filter((item) => item.mediaType !== "pdf").map((item) => item.id));
    trackUsageInteraction("document.open");
    setViewer(image);
  };
  const carouselSwipe = usePhotoSwipe({ enabled: carouselImages.length > 1 && activeImage?.mediaType !== "pdf", onPrevious: () => moveCarousel(-1), onNext: () => moveCarousel(1), onInteraction: () => setAutoPlay(false) });
  const viewerSwipe = usePhotoSwipe({ enabled: viewerImages.length > 1 && !notesImageId, onPrevious: () => moveViewer(-1), onNext: () => moveViewer(1) });
  const downloadArchive = async () => {
    if (mode !== "real" || !selectedFolder || selectedFolderIsPlans || archiveRequest.current || !hasArchiveImages) return;
    const folderId = selectedFolder.id;
    const request = new AbortController();
    archiveRequest.current = request;
    setArchiveBusy(true); setArchiveError(null);
    try {
      const response = await fetch(`/api/aesthetics/archive?folderId=${encodeURIComponent(folderId)}`, { signal: request.signal });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error || t(language, "The images could not be downloaded. Try again.", "No se pudieron descargar las imágenes. Intentalo de nuevo."));
      }
      if (response.headers.get("content-type")?.split(";", 1)[0] !== "application/zip") throw new Error(t(language, "The download could not be prepared. Try again.", "No se pudo preparar la descarga. Intentalo de nuevo."));
      const blob = await response.blob();
      if (request.signal.aborted) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url; link.download = archiveFilename(response.headers.get("content-disposition"));
      document.body.appendChild(link);
      try { link.click(); } finally {
        link.remove();
        // Give the browser time to acquire the blob before releasing it.
        const timer = window.setTimeout(() => { URL.revokeObjectURL(url); archiveUrls.current.delete(url); }, 30_000);
        archiveUrls.current.set(url, timer);
      }
    } catch (reason) {
      if (!request.signal.aborted) setArchiveError({ folderId, message: reason instanceof Error ? reason.message : t(language, "Download unavailable", "Descarga no disponible") });
    } finally {
      if (archiveRequest.current === request) archiveRequest.current = null;
      if (!request.signal.aborted) setArchiveBusy(false);
    }
  };
  const draggedGalleryImage = payload.images.find((image) => image.id === draggedGalleryId) || null;
  const compatibleDragFolders = draggedGalleryImage
    ? payload.folders.filter((folder) => folder.id !== draggedGalleryImage.folderId && (draggedGalleryImage.mediaType === "pdf") === (folder.kind === "plans"))
    : [];

  useEffect(() => {
    if (!autoPlay || notesImageId || viewer || carouselImages.length < 2) return;
    const timer = window.setInterval(() => setActiveIndex((index) => (index + 1) % carouselImages.length), 6000);
    return () => window.clearInterval(timer);
  }, [autoPlay, carouselImages.length, notesImageId, viewer]);

  useEffect(() => {
    // Starting native HTML drag-and-drop cancels its pointer stream. Keep that
    // drag alive until drop/dragend, while clearing genuinely cancelled pointers.
    const cancelPointerDrag = () => { if (!nativeGalleryDrag.current) clearGalleryDrag(); };
    window.addEventListener("pointerup", clearGalleryDrag);
    window.addEventListener("pointercancel", cancelPointerDrag);
    return () => {
      window.removeEventListener("pointerup", clearGalleryDrag);
      window.removeEventListener("pointercancel", cancelPointerDrag);
    };
  }, [clearGalleryDrag]);

  const createFolder = async (rawName: string) => {
    const name = aestheticName(rawName, 80);
    if (!name) return;
    const parentId = folderDialog?.parentId || null;
    if (payload.folders.some((folder) => (folder.parentId || null) === parentId && folder.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
      setError(t(language, "A folder with that name already exists here", "Ya existe una carpeta con ese nombre aquí")); return;
    }
    if (mode === "demo") {
      const kind = payload.folders.find((folder) => folder.id === parentId)?.kind || "images";
      const folder: Folder = { id: `demo-${crypto.randomUUID()}`, name, parentId, kind, carouselImageIds: [], createdAt: new Date().toISOString() };
      setPayload((current) => ({ ...current, folders: [...current.folders, folder] })); trackDemoAction("record.create"); selectFolder(folder.id); setFolderDialog(null); return;
    }
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/aesthetics", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "create_folder", name, parentId }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error); await refresh(); selectFolder(data.folder.id); setFolderDialog(null);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Folder unavailable"); } finally { setBusy(false); }
  };

  const renameFolder = async (rawName: string) => {
    if (!selectedFolder || protectedFolder) return;
    const name = aestheticName(rawName, 80);
    if (!name) return;
    if (name === selectedFolder.name) { setFolderDialog(null); return; }
    if (await mutate({ action: "rename_folder", id: selectedFolder.id, name }, () => setPayload((current) => ({ ...current, folders: current.folders.map((folder) => folder.id === selectedFolder.id ? { ...folder, name } : folder) })))) setFolderDialog(null);
  };

  const deleteFolder = async () => {
    if (!selectedFolder || protectedFolder || folderImages.length || hasSubfolders) return;
    if (mode === "demo") { setPayload((current) => ({ ...current, folders: current.folders.filter((folder) => folder.id !== selectedFolder.id) })); trackDemoAction("record.delete"); selectFolder(null); setDeleteTarget(null); return; }
    setBusy(true); setError("");
    try { const response = await fetch(`/api/aesthetics?id=${encodeURIComponent(selectedFolder.id)}&type=folder`, { method: "DELETE" }); const data = await response.json(); if (!response.ok) throw new Error(data.error); await refresh(); selectFolder(null); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Folder unavailable"); } finally { setBusy(false); setDeleteTarget(null); }
  };

  const mutate = async (body: Record<string, unknown>, optimistic: () => void) => {
    if (mode === "demo") { optimistic(); trackDemoAction("record.update"); return true; }
    setBusy(true); setError("");
    try { const response = await fetch("/api/aesthetics", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); const data = await response.json(); if (!response.ok) throw new Error(data.error); await refresh(); return true; }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Change unavailable"); return false; } finally { setBusy(false); }
  };

  const saveImageNotes = async (id: string, notes: string) => {
    if (!canEdit) throw new Error(t(language, "Aesthetics editor access required", "Se requiere acceso de edición a Estética"));
    if (mode === "demo") {
      setCustomNoteIds((current) => [...new Set([...current, id])]);
      setPayload((current) => ({ ...current, images: current.images.map((image) => image.id === id ? { ...image, notes } : image) }));
      trackDemoAction("record.update");
      return;
    }
    const response = await fetch("/api/aesthetics", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "notes", id, notes }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || t(language, "Notes could not be saved", "No se pudieron guardar las notas"));
    setPayload((current) => ({ ...current, images: current.images.map((image) => image.id === id ? data.image : image) }));
  };

  const classifyImage = async (image: AestheticImage, classification: AestheticImageClassification) => {
    if (busy || !canEdit || image.mediaType === "pdf" || aestheticClassification(image.classification) === classification) return;
    await mutate({ action: "classification", id: image.id, classification }, () => setPayload((current) => ({ ...current, images: current.images.map((item) => item.id === image.id ? { ...item, classification } : item) })));
  };

  const toggleCarousel = async (imageId: string, targetFolder: Folder | null = selectedFolder) => {
    if (busy || !canEdit || !targetFolder) return;
    const image = payload.images.find((item) => item.id === imageId);
    if (!image || (image.mediaType === "pdf") !== (targetFolder.kind === "plans")) return;
    const selectedImageIds = aestheticCarouselItems(payload.images, targetFolder.carouselImageIds, targetFolder.kind).map((item) => item.id);
    const selected = selectedImageIds.includes(imageId);
    if (!selected && selectedImageIds.length >= AESTHETIC_CAROUSEL_LIMIT) {
      setError(t(language, "Choose up to 30 images per carousel", "Podés elegir hasta 30 imágenes por carrusel")); return;
    }
    const carouselImageIds = selected ? selectedImageIds.filter((id) => id !== imageId) : [...selectedImageIds, imageId];
    await mutate({ action: "carousel", id: targetFolder.id, imageIds: carouselImageIds }, () => setPayload((current) => ({ ...current, folders: current.folders.map((folder) => folder.id === targetFolder.id ? { ...folder, carouselImageIds } : folder) })));
  };

  const updateCarouselOrder = async (imageIds: string[]) => {
    if (busy || !canEdit || !selectedFolder) return;
    const validImageIds = aestheticCarouselItems(payload.images, imageIds, selectedFolder.kind).map((image) => image.id);
    if (validImageIds.length === selectedFolder.carouselImageIds.length && validImageIds.every((id, index) => selectedFolder.carouselImageIds[index] === id)) return;
    await mutate({ action: "carousel", id: selectedFolder.id, imageIds: validImageIds }, () => setPayload((current) => ({ ...current, folders: current.folders.map((folder) => folder.id === selectedFolder.id ? { ...folder, carouselImageIds: validImageIds } : folder) })));
  };

  const reorderCarousel = async (sourceId: string, targetId: string) => {
    if (!selectedFolder || !sourceId || sourceId === targetId) return;
    const imageIds = carouselImages.map((image) => image.id);
    const sourceIndex = imageIds.indexOf(sourceId);
    const targetIndex = imageIds.indexOf(targetId);
    if (sourceIndex < 0 || targetIndex < 0) return;
    imageIds.splice(targetIndex, 0, imageIds.splice(sourceIndex, 1)[0]);
    setActiveIndex(imageIds.indexOf(activeImage?.id || ""));
    await updateCarouselOrder(imageIds);
  };

  const moveCarouselImage = async (imageId: string, direction: -1 | 1) => {
    if (!selectedFolder) return;
    const imageIds = carouselImages.map((image) => image.id);
    const index = imageIds.indexOf(imageId);
    const targetIndex = index + direction;
    if (index < 0 || targetIndex < 0 || targetIndex >= imageIds.length) return;
    [imageIds[index], imageIds[targetIndex]] = [imageIds[targetIndex], imageIds[index]];
    setActiveIndex(targetIndex);
    await updateCarouselOrder(imageIds);
  };

  const moveImage = async (imageId: string, folderId: string) => {
    if (busy || !canEdit) { clearGalleryDrag(); return; }
    const image = payload.images.find((item) => item.id === imageId);
    const destination = payload.folders.find((folder) => folder.id === folderId);
    if (!image || image.folderId === folderId) { clearGalleryDrag(); return; }
    if (!destination || (image.mediaType === "pdf") !== (destination.kind === "plans")) {
      setError(image.mediaType === "pdf" ? t(language, "PDF plans must remain in Plans.", "Los planos PDF deben permanecer en Planos.") : t(language, "Plans accepts PDF files only.", "Planos solo acepta archivos PDF."));
      clearGalleryDrag();
      return;
    }
    await mutate({ action: "move_image", id: imageId, folderId }, () => setPayload((current) => ({
      images: current.images.map((item) => item.id === imageId ? { ...item, folderId } : item),
      folders: current.folders,
    })));
    clearGalleryDrag();
  };

  const uploadImages = async (files: File[], targetFolderId = effectiveFolderId) => {
    const targetFolder = payload.folders.find((folder) => folder.id === targetFolderId);
    if (busy || !canEdit || !targetFolder || !files.length) return;
    const acceptsFiles = targetFolder.kind === "plans"
      ? files.every((file) => file.type === "application/pdf")
      : files.every((file) => ["image/jpeg", "image/png", "image/webp", "image/avif"].includes(file.type));
    if (!acceptsFiles) {
      setError(targetFolder.kind === "plans"
        ? t(language, "Plans accepts PDF files only.", "Planos solo acepta archivos PDF.")
        : t(language, "This folder accepts JPEG, PNG, WebP, or AVIF images.", "Esta carpeta acepta imágenes JPEG, PNG, WebP o AVIF."));
      return;
    }
    setBusy(true); setError(""); setUploadFailed(false); setUploadProgress(null);
    let uploadError = false;
    const batch = createUploadBatch(files, setUploadProgress);
    try {
      if (mode === "demo") {
        const images: AestheticImage[] = files.map((file, index) => {
          const imageUrl = URL.createObjectURL(file);
          const mediaType = file.type === "application/pdf" ? "pdf" as const : "image" as const;
          return { id: `demo-upload-${Date.now()}-${index}`, folderId: targetFolder.id, name: file.name, caption: "", width: 0, height: 0, createdAt: new Date().toISOString(), mediaType, contentType: file.type, imageUrl, thumbnailUrl: mediaType === "image" ? imageUrl : "" };
        });
        setPayload((current) => ({ images: [...images, ...current.images], folders: current.folders }));
        images.forEach(() => trackDemoAction("file.upload"));
      } else {
        for (const [index, file] of files.entries()) {
          const form = new FormData(); form.append("folderId", targetFolder.id); form.append("file", file);
          const response = await uploadFormData("/api/aesthetics", form, { onProgress: batch.track(index) });
          const data = await response.json(); if (!response.ok) throw new Error(data.error || t(language, "Upload unavailable", "Carga no disponible"));
          batch.complete(index);
        }
        await refresh();
      }
    } catch (reason) {
      uploadError = true; setUploadFailed(true);
      setError(reason instanceof Error ? reason.message : t(language, "Upload unavailable", "Carga no disponible"));
      // Earlier files may already be saved when a later request fails.
      if (mode === "real") await refresh().catch(() => undefined);
    } finally {
      setBusy(false); if (!uploadError) setUploadProgress(null);
      if (uploadInput.current) uploadInput.current.value = "";
    }
  };

  const deleteImage = async (image: AestheticImage) => {
    if (mode === "demo") { setPayload((current) => ({ images: current.images.filter((item) => item.id !== image.id), folders: current.folders.map((folder) => ({ ...folder, carouselImageIds: folder.carouselImageIds.filter((id) => id !== image.id) })) })); trackDemoAction("record.delete"); setDeleteTarget(null); return; }
    setBusy(true); setError("");
    try { const response = await fetch(`/api/aesthetics?id=${encodeURIComponent(image.id)}&type=image`, { method: "DELETE" }); const data = await response.json(); if (!response.ok) throw new Error(data.error); await refresh(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Image unavailable"); } finally { setBusy(false); setDeleteTarget(null); }
  };

  return <div className="aesthetics-page">
    <input ref={uploadInput} hidden type="file" disabled={busy} accept={selectedFolderIsPlans ? "application/pdf" : "image/jpeg,image/png,image/webp,image/avif"} multiple onChange={(event) => void uploadImages(Array.from(event.target.files || []))} />
    <div className="page-intro aesthetics-intro"><div><span className="overline">{t(language, "DESIGN, REFERENCES & PLANS", "DISEÑO, REFERENCIAS Y PLANOS")}</span><h2>{t(language, "Aesthetics", "Estética")}</h2><p>{t(language, "Explore the planned design, inspiration references and project plans.", "Explorá el diseño previsto, las referencias de inspiración y los planos del proyecto.")}</p></div></div>
    {error && <div className="form-error" role="alert">{error === "aesthetics_unavailable" ? t(language, "Aesthetics unavailable", "Estética no disponible") : error}</div>}
    <UploadProgress progress={uploadProgress} language={language} error={uploadFailed} />
    <div className="aesthetic-workspace-layout">
    <aside className="aesthetic-folder-panel" aria-label={t(language, "Folder navigation", "Navegación de carpetas")}>
      <div className="aesthetic-folder-panel-heading"><div><b>{t(language, "Folders", "Carpetas")}</b><span>{payload.folders.length}</span></div>{canEdit && <button className="aesthetic-new-folder" disabled={busy} onClick={() => setFolderDialog({ mode: "create", value: "" })}>＋ {t(language, "New folder", "Nueva carpeta")}</button>}</div>
      <label className="aesthetic-mobile-folder-picker">{t(language, "Folder", "Carpeta")}
        <select value={selectedFolder ? effectiveFolderId : ""} disabled={initialLoading || payload.folders.length === 0} onChange={(event) => selectFolder(event.target.value)}>
          {!selectedFolder && <option value="">{t(language, "Choose a folder", "Elegí una carpeta")}</option>}
          {navigationFolders.map(({ folder }) => <option key={folder.id} value={folder.id}>{folderPath(folder.id)}</option>)}
        </select>
      </label>
    <div className="aesthetic-folder-strip" aria-label={t(language, "Aesthetic folders", "Carpetas de estética")}>{navigationFolders.map(({ folder, depth }) => {
      const itemCount = payload.images.filter((image) => image.folderId === folder.id).length;
      const itemLabel = folder.kind === "plans" ? "PDF" : t(language, itemCount === 1 ? "image" : "images", itemCount === 1 ? "imagen" : "imágenes");
      const acceptsExistingImage = Boolean(!busy && canEdit && draggedGalleryImage && draggedGalleryImage.folderId !== folder.id && (draggedGalleryImage.mediaType === "pdf") === (folder.kind === "plans"));
      const isDropTarget = !busy && canEdit && folderDropTarget === folder.id;
      return <button
        key={folder.id}
        title={folderPath(folder.id)}
        aria-label={`${folderPath(folder.id)} ${itemCount} ${itemLabel}`}
        aria-current={folder.id === effectiveFolderId ? "page" : undefined}
        style={{ "--folder-depth": Math.min(depth, 3) } as CSSProperties}
        className={`${folder.id === effectiveFolderId ? "selected" : ""} ${folder.parentId ? "nested" : ""} ${acceptsExistingImage ? "drop-ready" : ""} ${isDropTarget ? "drop-hover" : ""}`}
        data-drop-label={t(language, "Drop here", "Soltá aquí")}
        onClick={() => selectFolder(folder.id)}
        onPointerUp={() => { const imageId = draggedGalleryIdRef.current; if (imageId) void moveImage(imageId, folder.id); }}
        onDragEnter={(event) => { event.preventDefault(); if (busy || !canEdit) { event.dataTransfer.dropEffect = "none"; setFolderDropTarget(""); return; } setFolderDropTarget(folder.id); }}
        onDragOver={(event) => {
          event.preventDefault();
          if (busy || !canEdit) { event.dataTransfer.dropEffect = "none"; setFolderDropTarget(""); return; }
          const containsFiles = Array.from(event.dataTransfer.types).includes("Files");
          event.dataTransfer.dropEffect = containsFiles ? "copy" : "move";
          setFolderDropTarget(folder.id);
        }}
        onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFolderDropTarget((current) => current === folder.id ? "" : current); }}
        onDrop={(event) => {
          event.preventDefault();
          setFolderDropTarget("");
          if (busy || !canEdit) return;
          const files = Array.from(event.dataTransfer.files);
          if (files.length) {
            selectFolder(folder.id);
            void uploadImages(files, folder.id);
            return;
          }
          const imageId = draggedGalleryIdRef.current || event.dataTransfer.getData("application/x-house-planner-aesthetic-image") || event.dataTransfer.getData("text/plain");
          void moveImage(imageId, folder.id);
        }}
      ><span><FolderIcon plans={folder.kind === "plans"} /></span><b>{folder.parentId && <span className="sr-only">{folderPath(folder.parentId)} / </span>}{folderLabel(folder)}</b><small>{itemCount} {itemLabel}</small></button>;
    })}</div>
      {canEdit && payload.folders.length > 0 && <p className="aesthetic-folder-drop-hint">{t(language, "Drop images onto visual folders or PDFs onto Plans.", "Soltá imágenes en las carpetas visuales o archivos PDF en Planos.")}</p>}
    </aside>
    {!selectedFolder ? <div className="empty-state aesthetic-content" role={routeFolderUnavailable ? "status" : undefined}><h2>{routeFolderUnavailable ? t(language, "Folder unavailable", "Carpeta no disponible") : t(language, "Preparing Interior, Exterior, and Plans", "Preparando Interior, Exterior y Planos")}</h2><p>{routeFolderUnavailable ? t(language, "This folder was removed or is not accessible with your current permissions. Choose an available folder.", "Esta carpeta se eliminó o no está disponible con tus permisos actuales. Elegí una carpeta disponible.") : t(language, "Images and plan PDFs stay organized in their own folders.", "Las imágenes y los PDF de planos se mantienen organizados en sus propias carpetas.")}</p></div> : <div className="aesthetic-content">
      <div className="aesthetic-folder-toolbar">
        <div className="aesthetic-folder-heading"><nav className="aesthetic-breadcrumbs" aria-label={t(language, "Folder path", "Ruta de la carpeta")}>{trail.map((folder, index) => <span key={folder.id}>{index > 0 && <span aria-hidden="true"> / </span>}<button type="button" aria-current={folder.id === selectedFolder.id ? "page" : undefined} onClick={() => selectFolder(folder.id)}>{folderLabel(folder)}</button></span>)}</nav><h3>{folderLabel(selectedFolder)}</h3><small>{folderImages.length} {selectedFolderIsPlans ? "PDF" : t(language, folderImages.length === 1 ? "image" : "images", folderImages.length === 1 ? "imagen" : "imágenes")} · {carouselImages.length} {t(language, "in carousel", "en el carrusel")}</small></div>
        <div className="aesthetic-folder-actions">
          {mode === "real" && !selectedFolderIsPlans && <button type="button" disabled={archiveBusy || !hasArchiveImages} aria-describedby="aesthetic-archive-help" onClick={() => void downloadArchive()}>{archiveBusy ? t(language, "Preparing ZIP…", "Preparando ZIP…") : t(language, "Download images", "Descargar imágenes")}</button>}
          {canEdit && <button className="aesthetic-upload-button" disabled={busy} onClick={() => uploadInput.current?.click()}>＋ {selectedFolderIsPlans ? t(language, "Add PDFs", "Agregar PDF") : t(language, "Add images", "Agregar imágenes")}</button>}
          {mode === "real" && projectId && <CopyWorkspaceLink destination={{ projectId, section: "aesthetics", budgetScope: null, folderId: selectedFolder.id }} language={language} />}
          {canEdit && <button disabled={busy} onClick={() => setFolderDialog({ mode: "create", value: "", parentId: selectedFolder.id })}>＋ {t(language, "New subfolder", "Nueva subcarpeta")}</button>}
          {canEdit && !protectedFolder && <><button disabled={busy} onClick={() => setFolderDialog({ mode: "rename", value: selectedFolder.name })}>{t(language, "Rename", "Renombrar")}</button><button disabled={busy || folderImages.length > 0 || hasSubfolders} title={hasSubfolders ? t(language, "Delete the subfolders first", "Eliminá las subcarpetas primero") : folderImages.length > 0 ? t(language, "Move or delete the images first", "Mové o eliminá las imágenes primero") : undefined} onClick={() => setDeleteTarget({ type: "folder", folder: selectedFolder })}>{t(language, "Delete", "Eliminar")}</button></>}
        </div>
      </div>
      {mode === "real" && !selectedFolderIsPlans && <p id="aesthetic-archive-help" className="aesthetic-carousel-help">{t(language, "Download original images from this folder and its subfolders in one ZIP.", "Descargá las imágenes originales de esta carpeta y sus subcarpetas en un ZIP.")}</p>}
      {archiveError?.folderId === selectedFolder.id && <div className="form-error" role="alert">{archiveError.message}</div>}
      {(activeImage || folderImages.length === 0) && <section className={`aesthetic-carousel ${activeImage ? "" : "empty"}`} aria-label={t(language, `${folderLabel(selectedFolder)} carousel`, `Carrusel ${folderLabel(selectedFolder)}`)}>
        {activeImage && activeImage.mediaType !== "pdf" && <ImageNotesButton image={activeImage} language={language} className="aesthetic-carousel-notes" onClick={() => { setAutoPlay(false); setNotesImageId(activeImage.id); }} />}
        {activeImage ? <>
          {activeImage.mediaType === "pdf" ? <div className="aesthetic-stage aesthetic-pdf-stage"><PdfPreview key={activeImage.id} item={activeImage} language={language} compact /><div className="aesthetic-pdf-stage-bar"><b>{activeImage.name}</b><button onClick={(event) => openViewer(activeImage, event.currentTarget, "carousel")}>{t(language, "Open plan", "Abrir plano")}</button></div></div> : <button type="button" className="aesthetic-stage" {...carouselSwipe} aria-label={t(language, `Open ${activeImage.name}`, `Abrir ${activeImage.name}`)} onClick={(event) => openViewer(activeImage, event.currentTarget, "carousel")}><Image unoptimized draggable={false} fill sizes="(max-width: 800px) 100vw, 1100px" src={activeImage.imageUrl} alt={activeImage.caption || activeImage.name} priority /><span><b>{activeImage.name}</b>{activeImage.caption && <small>{activeImage.caption}</small>}<ImageClassificationBadge image={activeImage} language={language} /></span></button>}
          {carouselImages.length > 1 && <><button type="button" className="aesthetic-arrow previous" onClick={() => moveCarousel(-1)} aria-label={t(language, "Previous item", "Elemento anterior")}>‹</button><button type="button" className="aesthetic-arrow next" onClick={() => moveCarousel(1)} aria-label={t(language, "Next item", "Elemento siguiente")}>›</button><button type="button" className="aesthetic-play" aria-pressed={autoPlay} onClick={() => setAutoPlay((value) => !value)}>{autoPlay ? "Ⅱ" : "▶"}<span>{autoPlay ? t(language, "Pause", "Pausar") : t(language, "Play", "Reproducir")}</span></button></>}
          <div className="aesthetic-carousel-count" aria-live="polite" aria-atomic="true">{visibleIndex + 1} / {carouselImages.length}</div>
        </> : <div className="aesthetic-carousel-empty"><span>{selectedFolderIsPlans ? "▤" : "◈"}</span><b>{selectedFolderIsPlans ? t(language, "Choose the plans to show", "Elegí los planos que querés mostrar") : t(language, "Choose images for this carousel", "Elegí imágenes para este carrusel")}</b><p>{selectedFolderIsPlans ? t(language, "Upload PDFs and use Show in carousel on the ones you want here.", "Subí PDF y usá Mostrar en carrusel en los que querés ver aquí.") : t(language, "Use Choose carousel photos to select images from any folder.", "Usá Elegir fotos del carrusel para seleccionar imágenes de cualquier carpeta.")}</p></div>}
      </section>}
      {activeImage?.mediaType === "image" && <p className="aesthetic-carousel-help">{t(language, "Swipe or use the arrows to browse. Tap a photo to view it fully; rotate your phone for landscape.", "Deslizá o usá las flechas para explorar. Tocá una foto para verla completa; girá el teléfono para verla en horizontal.")}</p>}
      {carouselImages.length > 0 && <div className="aesthetic-thumbnails" aria-label={t(language, "Carousel order", "Orden del carrusel")}>{carouselImages.map((image, index) => <div key={image.id} className={`aesthetic-thumbnail-card ${index === visibleIndex ? "selected" : ""} ${draggedCarouselId === image.id ? "dragging" : ""}`} draggable={canEdit && !busy} onDragStart={(event) => { setDraggedCarouselId(image.id); event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", image.id); }} onDragEnd={() => setDraggedCarouselId("")} onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "move"; }} onDrop={(event) => { event.preventDefault(); void reorderCarousel(draggedCarouselId || event.dataTransfer.getData("text/plain"), image.id); setDraggedCarouselId(""); }}><button className="aesthetic-thumbnail-preview" onClick={() => { setAutoPlay(false); setActiveIndex(index); }} aria-label={t(language, `Show ${image.name}`, `Mostrar ${image.name}`)}>{image.mediaType === "pdf" ? <span className="aesthetic-pdf-thumb"><b>PDF</b><small>{image.name}</small></span> : <Image unoptimized draggable={false} fill sizes="112px" src={image.thumbnailUrl} alt="" />}</button>{canEdit && <div className="aesthetic-thumbnail-order"><span title={t(language, "Drag to reorder", "Arrastrá para ordenar")}>⋮⋮</span><button disabled={busy || index === 0} onClick={() => void moveCarouselImage(image.id, -1)} aria-label={t(language, `Move ${image.name} left`, `Mover ${image.name} a la izquierda`)}>←</button><button disabled={busy || index === carouselImages.length - 1} onClick={() => void moveCarouselImage(image.id, 1)} aria-label={t(language, `Move ${image.name} right`, `Mover ${image.name} a la derecha`)}>→</button></div>}</div>)}</div>}
      {canEdit && !selectedFolderIsPlans && <section className="aesthetic-picker" aria-label={t(language, "Carousel image selection", "Selección de fotos del carrusel")}>
        <div className="aesthetic-picker-heading"><div><b>{t(language, `Carousel · ${carouselImages.length} photos`, `Carrusel · ${carouselImages.length} fotos`)}</b><p>{t(language, "Combine up to 30 photos from any folder.", "Combiná hasta 30 fotos de cualquier carpeta.")}</p></div><button type="button" aria-expanded={choosingCarousel} aria-controls="aesthetic-carousel-picker" disabled={busy} onClick={() => setChoosingCarousel((value) => !value)}>{choosingCarousel ? t(language, "Done", "Listo") : t(language, "Choose carousel photos", "Elegir fotos del carrusel")}</button></div>
        {choosingCarousel && <div id="aesthetic-carousel-picker">
          <label className="aesthetic-picker-filter">{t(language, "Source folder", "Carpeta de origen")}<select value={sourceFolderId} disabled={busy} onChange={(event) => setSourceFolderId(event.target.value)}><option value="">{t(language, "All folders", "Todas las carpetas")}</option>{payload.folders.filter((folder) => folder.kind !== "plans").map((folder) => <option key={folder.id} value={folder.id}>{folderPath(folder.id)}</option>)}</select></label>
          <div className="aesthetic-picker-grid">{pickerImages.map((image) => {
            const chosen = carouselImages.some((item) => item.id === image.id);
            return <label key={image.id} className={chosen ? "chosen" : ""}><Image unoptimized width={180} height={135} src={image.thumbnailUrl} alt="" /><span><input type="checkbox" checked={chosen} disabled={busy || (!chosen && carouselImages.length >= AESTHETIC_CAROUSEL_LIMIT)} onChange={() => void toggleCarousel(image.id)} />{image.name}</span><small>{folderPath(image.folderId)}</small></label>;
          })}</div>
          {pickerImages.length === 0 && <p>{t(language, "No photos in this selection. Upload images to a folder first.", "No hay fotos en esta selección. Primero subí imágenes a una carpeta.")}</p>}
        </div>}
      </section>}
      <section className="aesthetic-gallery">
        <div className="section-heading"><div><span>{selectedFolderIsPlans ? t(language, "PDF FILES", "ARCHIVOS PDF") : t(language, "ALL IMAGES", "TODAS LAS IMÁGENES")}</span><h3>{selectedFolderIsPlans ? t(language, "Available plans", "Planos disponibles") : t(language, "Folder gallery", "Galería de la carpeta")}</h3>{canEdit && !selectedFolderIsPlans && payload.folders.some((folder) => folder.kind === "images" && folder.id !== selectedFolder.id) && <p className="aesthetic-gallery-drag-hint">{t(language, "Drag any part of a card to move it, or use Move to folder.", "Arrastrá cualquier parte de una tarjeta para moverla o usá Mover a carpeta.")}</p>}</div></div>
        <label className="aesthetic-gallery-source">{t(language, "Gallery source", "Origen de la galería")}<select value={effectiveGallerySourceId} onChange={(event) => setGallerySourceId(event.target.value)}><option value="*">{selectedFolderIsPlans ? t(language, "All plan folders", "Todas las carpetas de planos") : t(language, "All image folders", "Todas las carpetas de imágenes")}</option>{compatibleGalleryFolders.map((folder) => <option key={folder.id} value={folder.id}>{folderPath(folder.id)}</option>)}</select></label>
        {galleryImages.length === 0 ? <div className="expense-empty"><b>{selectedFolderIsPlans ? t(language, "No PDF plans in this selection", "No hay planos PDF en esta selección") : t(language, "No images in this selection", "No hay imágenes en esta selección")}</b></div> : <div className="aesthetic-grid">{galleryImages.map((image) => {
          const chosen = carouselImages.some((item) => item.id === image.id);
          const otherCarousels = payload.folders.filter((folder) => folder.id !== selectedFolder.id && aestheticCarouselItems(payload.images, folder.carouselImageIds, folder.kind).some((item) => item.id === image.id));
          const compatibleFolders = payload.folders.filter((folder) => folder.id !== image.folderId && (image.mediaType === "pdf") === (folder.kind === "plans"));
          return <article
            key={image.id}
            className={`${draggedGalleryId === image.id ? "dragging" : ""} ${canEdit && compatibleFolders.length > 0 ? "draggable" : ""}`}
            onPointerDown={(event) => {
              if (event.pointerType !== "mouse" || busy || compatibleFolders.length === 0 || event.button !== 0 || (event.target as HTMLElement).closest(".aesthetic-image-actions, .aesthetic-notes-button")) return;
              startGalleryDrag(image.id);
            }}
          >
            {canEdit && compatibleFolders.length > 0 && <span className="aesthetic-card-drag-handle" draggable={!busy} onPointerDown={(event) => { if (event.pointerType === "mouse") startGalleryDrag(image.id); }} onDragStart={(event) => { if (busy) { event.preventDefault(); return; } nativeGalleryDrag.current = true; startGalleryDrag(image.id); event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("application/x-house-planner-aesthetic-image", image.id); event.dataTransfer.setData("text/plain", image.id); }} onDragEnd={clearGalleryDrag} title={t(language, `Drag ${image.name} to another folder`, `Arrastrar ${image.name} a otra carpeta`)} aria-label={t(language, `Drag ${image.name} to another folder`, `Arrastrar ${image.name} a otra carpeta`)}>⋮⋮</span>}
            <button className={`aesthetic-grid-image ${image.mediaType === "pdf" ? "aesthetic-pdf-card" : ""}`} onClick={(event) => openViewer(image, event.currentTarget)}>{image.mediaType === "pdf" ? <><span>PDF</span><small>{t(language, "Open plan", "Abrir plano")}</small></> : <Image unoptimized draggable={false} fill sizes="(max-width: 600px) 50vw, 280px" src={image.thumbnailUrl} alt={image.name} />}</button>
            <div className="aesthetic-image-details"><b>{image.name}</b>{image.caption && <small>{image.caption}</small>}{image.mediaType !== "pdf" && <ImageClassificationBadge image={image} language={language} />}{effectiveGallerySourceId !== effectiveFolderId && <small className="aesthetic-source-path">{folderPath(image.folderId)}</small>}{image.mediaType !== "pdf" && <ImageNotesButton image={image} language={language} onClick={() => setNotesImageId(image.id)} />}</div>
            {canEdit && <div className="aesthetic-image-actions">
              <FileShareButton kind="aesthetic" id={image.id} name={image.name} projectId={projectId || ""} language={language} canShare={mode === "real" && canShare} disabled={busy} />
              <button className={chosen ? "chosen" : ""} disabled={busy || (!chosen && carouselImages.length >= AESTHETIC_CAROUSEL_LIMIT)} onClick={() => void toggleCarousel(image.id, selectedFolder)} aria-pressed={chosen}>{chosen ? "★" : "☆"} {chosen ? t(language, "Remove from carousel", "Quitar del carrusel") : t(language, "Show in carousel", "Mostrar en carrusel")} · {folderPath(selectedFolder.id)}</button>
              {otherCarousels.map((folder) => <button key={folder.id} className="chosen" disabled={busy} onClick={() => void toggleCarousel(image.id, folder)}>★ {t(language, "Remove from carousel", "Quitar del carrusel")} · {folderPath(folder.id)}</button>)}
              {compatibleFolders.length > 0 && <select aria-label={t(language, `Move ${image.name} to folder`, `Mover ${image.name} a carpeta`)} value="" disabled={busy} onChange={(event) => { if (event.target.value) void moveImage(image.id, event.target.value); }}><option value="">{t(language, "Move to…", "Mover a…")}</option>{compatibleFolders.map((folder) => <option key={folder.id} value={folder.id}>{folderPath(folder.id)}</option>)}</select>}
              <button disabled={busy} onClick={() => setDeleteTarget({ type: "image", image })} aria-label={t(language, `Delete ${image.name}`, `Eliminar ${image.name}`)}>×</button>
            </div>}
          </article>;
        })}</div>}
      </section>
      {canEdit && <div
        className={`aesthetic-dropzone ${!busy && dropActive ? "dragging" : ""}`}
        role="button"
        aria-disabled={busy}
        tabIndex={busy ? -1 : 0}
        onClick={() => { if (!busy) uploadInput.current?.click(); }}
        onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); if (!busy) uploadInput.current?.click(); } }}
        onDragEnter={(event) => { event.preventDefault(); if (busy) { event.dataTransfer.dropEffect = "none"; setDropActive(false); return; } setDropActive(true); }}
        onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = busy ? "none" : "copy"; setDropActive(!busy); }}
        onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropActive(false); }}
        onDrop={(event) => { event.preventDefault(); setDropActive(false); if (!busy) void uploadImages(Array.from(event.dataTransfer.files), selectedFolder.id); }}
        aria-label={selectedFolderIsPlans ? t(language, "Drop PDF plans here or choose files", "Soltá planos PDF aquí o elegí archivos") : t(language, "Drop images here or choose files", "Soltá imágenes aquí o elegí archivos")}
      ><span>⇧</span><div><b>{selectedFolderIsPlans ? t(language, "Drag PDF plans into this section", "Arrastrá planos PDF a esta sección") : t(language, "Drag images into this folder", "Arrastrá imágenes a esta carpeta")}</b><small>{busy ? t(language, "Please wait until the current change finishes.", "Esperá a que termine el cambio actual.") : selectedFolderIsPlans ? t(language, "or click to choose one or more PDF files · up to 25 MB each", "o hacé clic para elegir uno o varios PDF · hasta 25 MB cada uno") : t(language, "or click to choose JPEG, PNG, WebP or AVIF files · up to 15 MB", "o hacé clic para elegir JPEG, PNG, WebP o AVIF · hasta 15 MB")}</small></div></div>}
    </div>}
    </div>
    {canEdit && draggedGalleryImage && compatibleDragFolders.length > 0 && <aside className="aesthetic-drag-tray" aria-label={t(language, `Move ${draggedGalleryImage.name} to folder`, `Mover ${draggedGalleryImage.name} a carpeta`)} aria-live="polite">
      <div><b>{t(language, `Move “${draggedGalleryImage.name}”`, `Mover “${draggedGalleryImage.name}”`)}</b><small>{t(language, "Drop it onto a destination folder", "Soltala sobre la carpeta de destino")}</small></div>
      <div>{compatibleDragFolders.map((folder) => <button key={folder.id} onPointerUp={() => { const imageId = draggedGalleryIdRef.current; if (imageId) void moveImage(imageId, folder.id); }} onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "move"; }} onDrop={(event) => { event.preventDefault(); const imageId = draggedGalleryIdRef.current || event.dataTransfer.getData("application/x-house-planner-aesthetic-image") || event.dataTransfer.getData("text/plain"); void moveImage(imageId, folder.id); }}><span>◈</span>{folderPath(folder.id)}</button>)}</div>
    </aside>}
    {folderDialog && <div className="detail-backdrop aesthetic-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (!busy && event.target === event.currentTarget) setFolderDialog(null); }}><form className="aesthetic-dialog" role="dialog" aria-modal="true" aria-labelledby="aesthetic-folder-dialog-title" onSubmit={(event) => { event.preventDefault(); void (folderDialog.mode === "create" ? createFolder(folderDialog.value) : renameFolder(folderDialog.value)); }}><span className="overline">{folderDialog.mode === "create" ? t(language, "NEW VISUAL SPACE", "NUEVO ESPACIO VISUAL") : t(language, "FOLDER SETTINGS", "AJUSTES DE CARPETA")}</span><h3 id="aesthetic-folder-dialog-title">{folderDialog.mode === "create" ? t(language, "Create folder", "Crear carpeta") : t(language, "Rename folder", "Renombrar carpeta")}</h3><p>{t(language, "Use a clear name such as Kitchen, Facade, Garden or Materials.", "Usá un nombre claro como Cocina, Fachada, Jardín o Materiales.")}</p><label>{t(language, "Folder name", "Nombre de la carpeta")}<input autoFocus maxLength={80} value={folderDialog.value} onChange={(event) => setFolderDialog({ ...folderDialog, value: event.target.value })} placeholder={t(language, "For example: Main bathroom", "Por ejemplo: Baño principal")} /></label>{folderDialog.mode === "create" && <label>{t(language, "Inside folder", "Dentro de la carpeta")}<select value={folderDialog.parentId || ""} disabled={busy} onChange={(event) => setFolderDialog({ ...folderDialog, parentId: event.target.value })}><option value="">{t(language, "Top level", "Nivel principal")}</option>{payload.folders.map((folder) => <option key={folder.id} value={folder.id}>{folderPath(folder.id)}</option>)}</select></label>}<div className="aesthetic-dialog-actions"><button type="button" disabled={busy} onClick={() => setFolderDialog(null)}>{t(language, "Cancel", "Cancelar")}</button><button className="primary-button" disabled={busy || !folderDialog.value.trim()} type="submit">{busy ? t(language, "Saving…", "Guardando…") : t(language, "Save folder", "Guardar carpeta")}</button></div></form></div>}
    {deleteTarget && <div className="detail-backdrop aesthetic-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (!busy && event.target === event.currentTarget) setDeleteTarget(null); }}><section className="aesthetic-dialog danger" role="alertdialog" aria-modal="true" aria-labelledby="aesthetic-delete-dialog-title"><span className="aesthetic-dialog-icon">×</span><h3 id="aesthetic-delete-dialog-title">{deleteTarget.type === "folder" ? t(language, "Delete folder?", "¿Eliminar carpeta?") : deleteTarget.image.mediaType === "pdf" ? t(language, "Delete PDF?", "¿Eliminar PDF?") : t(language, "Delete image?", "¿Eliminar imagen?")}</h3><p>{deleteTarget.type === "folder" ? t(language, `“${deleteTarget.folder.name}” will be removed.`, `Se eliminará “${deleteTarget.folder.name}”.`) : t(language, `“${deleteTarget.image.name}” will be removed from this project.`, `Se eliminará “${deleteTarget.image.name}” de este proyecto.`)}</p><div className="aesthetic-dialog-actions"><button type="button" disabled={busy} onClick={() => setDeleteTarget(null)}>{t(language, "Keep", "Conservar")}</button><button className="danger-button" type="button" disabled={busy} onClick={() => void (deleteTarget.type === "folder" ? deleteFolder() : deleteImage(deleteTarget.image))}>{busy ? t(language, "Deleting…", "Eliminando…") : t(language, "Delete", "Eliminar")}</button></div></section></div>}
    {viewerImage && <div className="detail-backdrop aesthetic-viewer" role="presentation" inert={Boolean(notesImage)} onMouseDown={(event) => { if (event.target === event.currentTarget) setViewer(null); }}>
      <section ref={viewerDialog} className="aesthetic-viewer-dialog" data-media-type={viewerImage.mediaType} role="dialog" aria-modal="true" aria-label={viewerImage.name} onKeyDown={handleViewerKeys}>
        <div className="aesthetic-viewer-toolbar">
          <button type="button" className="close" aria-label={t(language, "Close image", "Cerrar imagen")} onClick={() => setViewer(null)}>×</button>
          {viewerImages.length > 1 && viewerIndex >= 0 && <><button type="button" className="aesthetic-viewer-arrow previous" aria-label={t(language, "Previous photo", "Foto anterior")} onClick={() => moveViewer(-1)}>‹</button><span className="aesthetic-viewer-count" aria-live="polite" aria-atomic="true">{viewerIndex + 1} / {viewerImages.length}</span><button type="button" className="aesthetic-viewer-arrow next" aria-label={t(language, "Next photo", "Foto siguiente")} onClick={() => moveViewer(1)}>›</button></>}
        </div>
        <div className="aesthetic-viewer-stage" data-media-type={viewerImage.mediaType} {...(viewerImage.mediaType !== "pdf" ? viewerSwipe : {})}>
          {viewerImage.mediaType === "pdf" ? <PdfPreview item={viewerImage} language={language} /> : <Image unoptimized draggable={false} width={viewerImage.width || 1800} height={viewerImage.height || 1200} src={viewerImage.imageUrl} alt={viewerImage.caption || viewerImage.name} />}
        </div>
        <div className="aesthetic-viewer-caption">
          <div className="aesthetic-viewer-details"><div><b>{viewerImage.name}</b>{viewerImage.caption && <p>{viewerImage.caption}</p>}{viewerImage.mediaType !== "pdf" && <ImageClassificationBadge image={viewerImage} language={language} />}</div>{viewerImage.mediaType !== "pdf" && <ImageNotesButton image={viewerImage} language={language} onClick={() => setNotesImageId(viewerImage.id)} />}</div>
          {canEdit && viewerImage.mediaType !== "pdf" && <label className="aesthetic-classification-control">{t(language, "Image classification", "Clasificación de la imagen")}<select aria-label={t(language, `Classify ${viewerImage.name}`, `Clasificar ${viewerImage.name}`)} value={aestheticClassification(viewerImage.classification)} disabled={busy} onChange={(event) => void classifyImage(viewerImage, event.target.value as AestheticImageClassification)}>{(["unclassified", "planned", "inspiration"] as const).map((classification) => <option key={classification} value={classification}>{aestheticClassificationLabel(classification, language)}</option>)}</select>{busy && <small role="status">{t(language, "Saving…", "Guardando…")}</small>}</label>}
          {error && <div className="form-error" role="alert">{error === "aesthetics_unavailable" ? t(language, "Aesthetics unavailable", "Estética no disponible") : error}</div>}
        </div>
      </section>
    </div>}
    {notesImage && <AestheticImageNotesDialog key={notesImage.id} image={notesImage} language={language} canEdit={canEdit} formatDemoNotes={mode === "demo" ? (notes) => projectDemoImage({ ...notesImage, notes }, language, customNoteIds).notes || "" : undefined} lockScroll={!viewerImage} onSave={(notes) => saveImageNotes(notesImage.id, notes)} onClose={() => setNotesImageId("")} />}
  </div>;
}
