"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { aestheticFolderPath } from "@/lib/aesthetic-navigation";
import { aestheticClassificationLabel, type AestheticImageClassification } from "@/lib/aesthetics";
import type { ProjectNote } from "@/lib/project-notes";
import type { WorkspaceTab } from "@/lib/project";
import { OVERVIEW_IMAGE_LIMIT, OVERVIEW_NOTE_LIMIT } from "@/lib/overview";
import { usePhotoSwipe } from "./usePhotoSwipe";
import "./overview.css";

type Language = "en" | "es";
type Photo = { id: string; folderId: string; name: string; caption: string; classification?: AestheticImageClassification; mediaType: "image" | "pdf"; imageUrl: string; thumbnailUrl: string };
type Folder = { id: string; name: string; parentId?: string | null };
type Selection = { imageIds: string[]; noteIds: string[] };
type PropertyProfile = { revisionLabelEn: string; revisionLabelEs: string; measurements: Array<{ id: string; labelEn: string; labelEs: string; value: string; emphasis: boolean }> };
type Props = {
  mode: "real" | "demo";
  language: Language;
  projectId: string;
  projectName: string;
  canEdit: boolean;
  canOpenAesthetics: boolean;
  canOpenNotes: boolean;
  canOpenDocuments: boolean;
  canOpenDistribution?: boolean;
  documents: Array<{ id: string; name: string; contentType: string; size: number; folderId?: string | null }>;
  propertyProfile: PropertyProfile | null;
  onNavigate: (section: WorkspaceTab) => void;
};

const tr = (language: Language, en: string, es: string) => language === "es" ? es : en;
const emptySelection: Selection = { imageIds: [], noteIds: [] };
const demoPhotos: Photo[] = [{ id: "demo-house", folderId: "demo-exterior", name: "House Planner", caption: "House Planner · Demo", mediaType: "image", imageUrl: "/og.png", thumbnailUrl: "/og.png" }];

async function readPayload<T>(url: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(url, { cache: "no-store", signal });
  if (!response.ok) throw new Error("load");
  return response.json() as Promise<T>;
}

function fileGroup(document: Props["documents"][number]) {
  if (document.contentType === "application/pdf" || /\.pdf$/i.test(document.name)) return "pdf";
  if (document.contentType.startsWith("image/") || /\.(png|jpe?g|webp|avif|heic)$/i.test(document.name)) return "images";
  if (/spreadsheet|excel|csv/.test(document.contentType) || /\.(xlsx?|csv|ods)$/i.test(document.name)) return "sheets";
  return "other";
}

export default function OverviewHighlights({ mode, language, projectId, projectName, canEdit, canOpenAesthetics, canOpenNotes, canOpenDocuments, canOpenDistribution = false, documents, propertyProfile, onNavigate }: Props) {
  const demo = mode === "demo";
  const [selection, setSelection] = useState<Selection>(demo ? { imageIds: ["demo-house"], noteIds: [] } : emptySelection);
  const [photos, setPhotos] = useState<Photo[]>(demo ? demoPhotos : []);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [notes, setNotes] = useState<ProjectNote[]>([]);
  const [loading, setLoading] = useState(!demo);
  const [failed, setFailed] = useState<string[]>([]);
  const [reload, setReload] = useState(0);
  const [currentPhotoId, setCurrentPhotoId] = useState("");
  const [showImage, setShowImage] = useState(false);
  const [picker, setPicker] = useState<"photos" | "notes" | null>(null);
  const [draftIds, setDraftIds] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [sourceFolder, setSourceFolder] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const imageDialog = useRef<HTMLDialogElement>(null);
  const imageOpener = useRef<HTMLButtonElement | null>(null);
  const selectedPhotoList = useRef<HTMLElement>(null);

  useEffect(() => {
    if (demo) return;
    const controller = new AbortController();
    const jobs = [
      readPayload<Selection>("/api/overview", controller.signal),
      canOpenAesthetics ? readPayload<{ images: Photo[]; folders: Folder[] }>("/api/aesthetics", controller.signal) : Promise.resolve({ images: [], folders: [] }),
      canOpenNotes ? readPayload<{ notes: ProjectNote[] }>("/api/notes", controller.signal) : Promise.resolve({ notes: [] }),
    ] as const;
    void Promise.allSettled(jobs).then(([preferences, aesthetics, projectNotes]) => {
      if (controller.signal.aborted) return;
      const errors: string[] = [];
      if (preferences.status === "fulfilled" && Array.isArray(preferences.value.imageIds) && Array.isArray(preferences.value.noteIds)) setSelection(preferences.value);
      else { setSelection(emptySelection); errors.push("selection"); }
      if (aesthetics.status === "fulfilled" && Array.isArray(aesthetics.value.images) && Array.isArray(aesthetics.value.folders)) { setPhotos(aesthetics.value.images.filter((image) => image.mediaType === "image")); setFolders(aesthetics.value.folders); }
      else { setPhotos([]); errors.push("photos"); }
      if (projectNotes.status === "fulfilled" && Array.isArray(projectNotes.value.notes)) setNotes(projectNotes.value.notes);
      else { setNotes([]); errors.push("notes"); }
      setFailed(errors);
      setLoading(false);
    });
    return () => controller.abort();
  }, [demo, projectId, canOpenAesthetics, canOpenNotes, reload]);

  useEffect(() => {
    const element = dialog.current;
    if (!picker || !element) return;
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    element.showModal();
    return () => { element.close(); document.body.style.overflow = overflow; previous?.focus(); };
  }, [picker]);

  const selectedPhotos = canOpenAesthetics ? selection.imageIds.flatMap((id) => photos.find((photo) => photo.id === id) || []) : [];
  const selectedNotes = canOpenNotes ? selection.noteIds.flatMap((id) => notes.find((note) => note.id === id) || []) : [];
  const photoIndex = Math.max(0, selectedPhotos.findIndex((photo) => photo.id === currentPhotoId));
  const photo = selectedPhotos[photoIndex];
  const counts = { pdf: 0, images: 0, sheets: 0, other: 0 };
  if (canOpenDocuments) for (const document of documents) counts[fileGroup(document)] += 1;

  const openPicker = (kind: "photos" | "notes") => {
    setDraftIds(kind === "photos" ? selectedPhotos.map((item) => item.id) : selectedNotes.map((item) => item.id));
    setSearch(""); setSourceFolder(""); setSaveError(""); setPicker(kind);
  };
  const toggle = (id: string) => setDraftIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  const movePhoto = (step: number) => setCurrentPhotoId(selectedPhotos[(photoIndex + step + selectedPhotos.length) % selectedPhotos.length].id);
  const photoSwipe = usePhotoSwipe({ enabled: selectedPhotos.length > 1, onPrevious: () => movePhoto(-1), onNext: () => movePhoto(1) });
  const viewerSwipe = usePhotoSwipe({ enabled: selectedPhotos.length > 1, onPrevious: () => movePhoto(-1), onNext: () => movePhoto(1) });
  const imageOpen = showImage && Boolean(photo);
  useEffect(() => {
    const element = imageDialog.current;
    if (!imageOpen || !element) return;
    const opener = imageOpener.current;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    element.showModal();
    element.querySelector<HTMLButtonElement>(".overview-image-viewer-close")?.focus({ preventScroll: true });
    return () => {
      element.close();
      document.body.style.overflow = overflow;
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, [imageOpen]);
  const removeDraftPhoto = (id: string) => {
    setDraftIds((current) => current.filter((item) => item !== id));
    selectedPhotoList.current?.focus({ preventScroll: true });
  };
  const save = async () => {
    if (!picker) return;
    setSaving(true); setSaveError("");
    const field = picker === "photos" ? "imageIds" : "noteIds";
    try {
      if (demo) setSelection((current) => ({ ...current, [field]: draftIds }));
      else {
        const response = await fetch("/api/overview", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ [field]: draftIds }) });
        if (!response.ok) throw new Error("save");
        setSelection(await response.json() as Selection);
      }
      if (picker === "photos") setCurrentPhotoId(draftIds[0] || "");
      setPicker(null);
    } catch { setSaveError(tr(language, "Could not save the selection. Try again.", "No se pudo guardar la selección. Inténtalo de nuevo.")); }
    finally { setSaving(false); }
  };
  const chooserDisabled = loading || failed.includes("selection");
  const photoMatches = photos.filter((item) => (!sourceFolder || item.folderId === sourceFolder) && `${item.name} ${item.caption} ${aestheticFolderPath(folders, item.folderId)}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  const noteMatches = notes.filter((item) => `${item.title} ${item.content}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  const limit = picker === "photos" ? OVERVIEW_IMAGE_LIMIT : OVERVIEW_NOTE_LIMIT;

  return <div className="overview-highlights" aria-busy={loading}>
    {failed.length > 0 && <div className="overview-load-error" role="alert"><span>{tr(language, "Some overview content could not be loaded.", "No se pudo cargar parte del resumen.")}</span><button className="overview-small-button" onClick={() => { setLoading(true); setReload((value) => value + 1); }}>{tr(language, "Try again", "Reintentar")}</button></div>}
    <div className="overview-hero-grid">
      {canOpenAesthetics && <section className="card overview-photo-card" aria-roledescription={tr(language, "carousel", "carrusel")} aria-label={tr(language, "House photos", "Fotos de la casa")}>
        <header className="overview-card-head"><div><span className="overline">{projectName}</span><h3>{tr(language, "House photos", "Fotos de la casa")}</h3></div>{canEdit && <button className="overview-small-button" disabled={chooserDisabled || failed.includes("photos")} onClick={() => openPicker("photos")} aria-haspopup="dialog"><span aria-hidden="true">✎</span> {tr(language, "Edit photo selection", "Editar selección de fotos")}</button>}</header>
        {photo ? <>
          <div className="overview-photo-stage">
            <button type="button" className="overview-photo-open" aria-label={tr(language, `Enlarge image: ${photo.name}`, `Ampliar imagen: ${photo.name}`)} {...photoSwipe} onClick={(event) => { imageOpener.current = event.currentTarget; setShowImage(true); }}>
              <Image key={photo.id} src={photo.imageUrl} alt={photo.caption || photo.name} fill unoptimized sizes="(max-width: 900px) 100vw, 1000px" style={{ objectFit: "contain" }} />
              <span className="overview-photo-open-hint">{tr(language, "Enlarge image", "Ampliar imagen")}</span>
            </button>
            {selectedPhotos.length > 1 && <><button className="overview-photo-arrow previous" onClick={() => movePhoto(-1)} aria-label={tr(language, "Previous photo", "Foto anterior")}>‹</button><button className="overview-photo-arrow next" onClick={() => movePhoto(1)} aria-label={tr(language, "Next photo", "Foto siguiente")}>›</button></>}
          </div>
          <div className="overview-photo-caption"><div><span className={`overview-photo-classification ${photo.classification || "unclassified"}`}>{aestheticClassificationLabel(photo.classification, language)}</span><p>{photo.caption || photo.name}</p></div><span aria-live="polite">{photoIndex + 1} / {selectedPhotos.length}</span></div>
          {selectedPhotos.length > 1 && <p className="overview-photo-help">{tr(language, "Swipe or use the arrows to explore the photos. Tap an image to enlarge it.", "Desliza o usa las flechas para recorrer las fotos. Toca una imagen para ampliarla.")}</p>}
          {selectedPhotos.length > 1 && <div className="overview-photo-dots" aria-label={tr(language, "Choose a photo", "Elegir una foto")}>{selectedPhotos.map((item, index) => <button key={item.id} className={index === photoIndex ? "selected" : ""} aria-label={tr(language, `Photo ${index + 1}: ${item.name}`, `Foto ${index + 1}: ${item.name}`)} aria-current={index === photoIndex ? "true" : undefined} onClick={() => setCurrentPhotoId(item.id)} />)}</div>}
        </> : <div className="overview-photo-empty"><span aria-hidden="true">⌂</span><p>{loading ? tr(language, "Loading photos…", "Cargando fotos…") : canEdit ? tr(language, "Choose the house photos you want to see here.", "Elige las fotos de la casa que quieres ver aquí.") : tr(language, "No photos have been featured in this overview yet. You can explore the available images in Aesthetics.", "Aún no hay fotos destacadas en este resumen. Puedes explorar las imágenes disponibles en Estética.")}</p></div>}
      </section>}
    </div>
    {imageOpen && photo && <dialog ref={imageDialog} className="overview-image-viewer" aria-labelledby="overview-image-viewer-title" onCancel={() => setShowImage(false)} onKeyDown={(event) => {
      if (selectedPhotos.length < 2) return;
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); movePhoto(event.key === "ArrowLeft" ? -1 : 1); }
    }}>
      <header className="overview-image-viewer-toolbar"><h3 id="overview-image-viewer-title">{photo.name}</h3><button type="button" className="overview-image-viewer-close" aria-label={tr(language, "Close image", "Cerrar imagen")} onClick={() => setShowImage(false)}>×</button></header>
      <div className="overview-image-viewer-stage" {...viewerSwipe}>
        <Image key={photo.id} src={photo.imageUrl} alt={photo.caption || photo.name} fill unoptimized sizes="100vw" style={{ objectFit: "contain" }} />
        {selectedPhotos.length > 1 && <><button type="button" className="overview-image-viewer-arrow previous" aria-label={tr(language, "Previous photo", "Foto anterior")} onClick={() => movePhoto(-1)}>‹</button><button type="button" className="overview-image-viewer-arrow next" aria-label={tr(language, "Next photo", "Foto siguiente")} onClick={() => movePhoto(1)}>›</button></>}
      </div>
      <footer className="overview-image-viewer-caption"><div><span className={`overview-photo-classification ${photo.classification || "unclassified"}`}>{aestheticClassificationLabel(photo.classification, language)}</span><p>{photo.caption || photo.name}</p></div><span aria-live="polite">{photoIndex + 1} / {selectedPhotos.length}</span>{selectedPhotos.length > 1 && <p className="overview-image-viewer-help">{tr(language, "Swipe or use the arrows to change photos.", "Desliza o usa las flechas para cambiar de foto.")}</p>}</footer>
    </dialog>}
    {(canOpenAesthetics || canOpenDistribution || canOpenDocuments) && <nav className="overview-explore" aria-label={tr(language, "Explore the house", "Explorar la casa")}>
      {canOpenAesthetics && <button type="button" className="overview-explore-link" onClick={() => onNavigate("aesthetics")}>
        <span className="overview-explore-icon" aria-hidden="true">▧</span><span><strong>{tr(language, "View design and references", "Ver diseño y referencias")}</strong><small>{tr(language, "Explore spaces, finishes and inspiration.", "Explora ambientes, acabados e inspiración.")}</small></span><span className="overview-explore-arrow" aria-hidden="true">↗</span>
      </button>}
      {canOpenDistribution && <button type="button" className="overview-explore-link overview-explore-3d" onClick={() => onNavigate("distribution")}>
        <span className="overview-explore-icon" aria-hidden="true">⬡</span><span><strong>{tr(language, "Explore the house in 3D", "Explorar la casa en 3D")}</strong><small>{tr(language, "Discover the layout and explore each space.", "Conoce la distribución y explora cada espacio.")}</small></span><span className="overview-explore-arrow" aria-hidden="true">↗</span>
      </button>}
      {canOpenDocuments && <button type="button" className="overview-explore-link" onClick={() => onNavigate("documents")}>
        <span className="overview-explore-icon" aria-hidden="true">▤</span><span><strong>{tr(language, "View plans and documents", "Ver planos y documentos")}</strong><small>{tr(language, "Open the files shared with you.", "Consulta los archivos compartidos contigo.")}</small></span><span className="overview-explore-arrow" aria-hidden="true">↗</span>
      </button>}
    </nav>}
    <div className="overview-detail-grid">
      <section className="card overview-measurement-card">
        <header className="overview-card-head"><div><span className="overline">{tr(language, "AT A GLANCE", "DE UN VISTAZO")}</span><h3>{tr(language, "House measurements", "Medidas de la casa")}</h3></div></header>
        {propertyProfile?.measurements.length ? <><div className="overview-compact-table"><table><thead><tr><th scope="col">{tr(language, "Concept", "Concepto")}</th><th scope="col">{tr(language, "Approx. measurement", "Medida aprox.")}</th></tr></thead><tbody>{propertyProfile.measurements.map((item) => <tr key={item.id} className={item.emphasis ? "emphasis" : ""}><th scope="row">{language === "es" ? item.labelEs : item.labelEn}</th><td>{item.value}</td></tr>)}</tbody></table></div><p className="overview-muted">{language === "es" ? propertyProfile.revisionLabelEs : propertyProfile.revisionLabelEn}</p></> : <p className="overview-empty-copy">{tr(language, "No house measurements have been recorded for this project yet.", "Aún no hay medidas de la casa registradas para este proyecto.")}</p>}
      </section>
      {canOpenDocuments && <section className="card overview-document-card">
        <header className="overview-card-head"><div><span className="overline">{tr(language, "PROJECT FILES", "ARCHIVOS DEL PROYECTO")}</span><h3>{tr(language, "Documents", "Documentos")}</h3></div></header>
        <div className="overview-document-total"><strong>{documents.length}</strong><span>{tr(language, "documents available", "documentos disponibles")}</span></div>
        <dl className="overview-document-counts">{([["pdf", "PDF", "PDF"], ["images", "Images", "Imágenes"], ["sheets", "Spreadsheets", "Hojas de cálculo"], ["other", "Other files", "Otros archivos"]] as const).map(([key, en, es]) => <div key={key}><dt>{tr(language, en, es)}</dt><dd>{counts[key]}</dd></div>)}</dl>
        <p className="overview-muted">{tr(language, "Includes the files you currently have access to.", "Incluye los archivos a los que tienes acceso actualmente.")}</p>
      </section>}
      {canOpenNotes && <section className="card overview-notes-card">
        <header className="overview-card-head"><div><span className="overline">{tr(language, "AT A GLANCE", "A MANO")}</span><h3>{tr(language, "Featured notes", "Notas destacadas")}</h3></div>{canEdit && <button className="overview-small-button" disabled={chooserDisabled || failed.includes("notes")} onClick={() => openPicker("notes")} aria-haspopup="dialog">{tr(language, "Select notes", "Seleccionar notas")}</button>}</header>
        {selectedNotes.length ? <div className="overview-compact-table overview-notes-table"><table><thead><tr><th scope="col">{tr(language, "Note", "Nota")}</th><th scope="col">{tr(language, "Details", "Detalle")}</th></tr></thead><tbody>{selectedNotes.map((note) => <tr key={note.id}><th scope="row">{note.title}</th><td><p title={note.content}>{note.content}</p></td></tr>)}</tbody></table></div> : <p className="overview-empty-copy">{loading ? tr(language, "Loading notes…", "Cargando notas…") : tr(language, "Choose the notes you want to keep in your overview.", "Elige las notas que quieres tener a mano en el resumen.")}</p>}
        <button className="overview-small-button overview-notes-link" onClick={() => onNavigate("notes")}>{tr(language, "View all notes", "Ver todas las notas")} <span aria-hidden="true">↗</span></button>
      </section>}
    </div>
    {picker && <dialog ref={dialog} className="overview-picker" aria-labelledby="overview-picker-title" onCancel={(event) => { if (saving) event.preventDefault(); else setPicker(null); }}>
      <header><div><span className="overline">{tr(language, "CUSTOMIZE OVERVIEW", "PERSONALIZAR RESUMEN")}</span><h3 id="overview-picker-title">{picker === "photos" ? tr(language, "Edit photo selection", "Editar selección de fotos") : tr(language, "Select notes", "Seleccionar notas")}</h3></div><button className="overview-small-button" disabled={saving} aria-label={tr(language, "Close", "Cerrar")} onClick={() => setPicker(null)}>✕</button></header>
      <p className="overview-muted">{picker === "photos" ? tr(language, "Select photos from Aesthetics, or remove selected ones below. Changes are applied when you save.", "Selecciona fotos de Estética o quita las que ya elegiste abajo. Los cambios se aplican al guardar.") : tr(language, "Choose existing notes for the small overview table.", "Elige las notas existentes que aparecerán en la tabla pequeña del resumen.")} {draftIds.length} / {limit}</p>
      {picker === "photos" && <section ref={selectedPhotoList} tabIndex={-1} className="overview-selected-photos" aria-label={tr(language, "Selected photos", "Fotos seleccionadas")}>
        <header><span aria-live="polite">{tr(language, `${draftIds.length} selected ${draftIds.length === 1 ? "photo" : "photos"}`, `${draftIds.length} ${draftIds.length === 1 ? "foto seleccionada" : "fotos seleccionadas"}`)}</span><button type="button" className="overview-small-button" disabled={saving || !draftIds.length} onClick={() => setDraftIds([])}>{tr(language, "Remove all from overview", "Quitar todas del resumen")}</button></header>
        <div>{draftIds.map((id) => <button type="button" key={id} disabled={saving} aria-label={tr(language, `Remove from overview: ${photos.find((item) => item.id === id)?.name || id}`, `Quitar del resumen: ${photos.find((item) => item.id === id)?.name || id}`)} onClick={() => removeDraftPhoto(id)}><span>{photos.find((item) => item.id === id)?.name || id}</span><span aria-hidden="true">×</span></button>)}</div>
        {!draftIds.length && <p>{tr(language, "No photos selected. Saving will leave the overview without photos; the images will remain in Aesthetics.", "No hay fotos seleccionadas. Al guardar, el resumen quedará sin fotos; las imágenes seguirán en Estética.")}</p>}
      </section>}
      <div className="overview-picker-filters"><label><span>{picker === "photos" ? tr(language, "Search photos", "Buscar fotos") : tr(language, "Search notes", "Buscar notas")}</span><input autoFocus value={search} onChange={(event) => setSearch(event.target.value)} type="search" /></label>{picker === "photos" && folders.length > 0 && <label><span>{tr(language, "Folder", "Carpeta")}</span><select value={sourceFolder} onChange={(event) => setSourceFolder(event.target.value)}><option value="">{tr(language, "All folders", "Todas las carpetas")}</option>{folders.map((folder) => <option key={folder.id} value={folder.id}>{aestheticFolderPath(folders, folder.id)}</option>)}</select></label>}</div>
      <div className={picker === "photos" ? "overview-picker-photos" : "overview-picker-notes"}>
        {picker === "photos" ? photoMatches.map((item) => <label key={item.id} className={`overview-photo-option ${draftIds.includes(item.id) ? "selected" : ""}`}><div className="overview-option-image"><Image src={item.thumbnailUrl || item.imageUrl} alt="" fill unoptimized sizes="160px" style={{ objectFit: "contain" }} /></div><div><input type="checkbox" checked={draftIds.includes(item.id)} disabled={saving || (!draftIds.includes(item.id) && draftIds.length >= limit)} onChange={() => toggle(item.id)} /><span><b>{item.name}</b><small>{aestheticFolderPath(folders, item.folderId)}</small></span></div>{draftIds.includes(item.id) && <span className="overview-selection-order">{draftIds.indexOf(item.id) + 1}</span>}</label>) : noteMatches.map((note) => <label key={note.id} className="overview-note-option"><input type="checkbox" checked={draftIds.includes(note.id)} disabled={saving || (!draftIds.includes(note.id) && draftIds.length >= limit)} onChange={() => toggle(note.id)} /><span><b>{note.title}</b><small>{note.content.slice(0, 180)}{note.content.length > 180 ? "…" : ""}</small></span></label>)}
        {(picker === "photos" ? !photoMatches.length : !noteMatches.length) && <p className="overview-empty-copy">{search || sourceFolder ? tr(language, "No matches. Try another search.", "No hay coincidencias. Prueba otra búsqueda.") : picker === "photos" ? tr(language, "Add house photos in Aesthetics first.", "Agrega primero fotos de la casa en Estética.") : tr(language, "Create notes in the Notes section first.", "Crea primero notas en la sección Notas.")}</p>}
      </div>
      {saveError && <p className="overview-save-error" role="alert">{saveError}</p>}
      <footer><span>{tr(language, "Saved for this project", "Se guarda para este proyecto")}</span><button className="secondary-button" disabled={saving} onClick={() => setPicker(null)}>{tr(language, "Cancel", "Cancelar")}</button><button className="primary-button" disabled={saving} onClick={() => void save()}>{saving ? tr(language, "Saving…", "Guardando…") : tr(language, "Save selection", "Guardar selección")}</button></footer>
    </dialog>}
  </div>;
}
