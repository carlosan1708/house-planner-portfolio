"use client";
/* eslint-disable @next/next/no-img-element */

import { useCallback, useEffect, useRef, useState } from "react";
import type { MobileCaptureTarget } from "@/lib/mobile-capture";
import { uploadFormData, type UploadProgressState } from "@/lib/upload-progress";
import UploadProgress from "./UploadProgress";
import useModalFocus from "./useModalFocus";

type Language = "es" | "en";
type ProjectChoice = { id: string; name: string; kind: "personal" | "shared"; role: "admin" | "editor" | "viewer"; active: boolean };
type TargetOption = { id: string; label: string; detail: string };
type CropState = { naturalWidth: number; naturalHeight: number; viewportWidth: number; viewportHeight: number; zoom: number; x: number; y: number };
type QueueEntry = {
  id: string;
  email: string;
  projectId: string;
  targetType: MobileCaptureTarget;
  targetId: string;
  note: string;
  photo: Blob;
  voice: Blob | null;
  createdAt: string;
  attempts: number;
  lastError: string;
};

const DB_NAME = "house-planner-field-capture-v1";
const STORE = "captures";
const tr = (language: Language, en: string, es: string) => language === "es" ? es : en;

function openQueue() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function queueTransaction<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore, resolve: (value: T) => void, reject: (reason?: unknown) => void) => void) {
  const database = await openQueue();
  try {
    return await new Promise<T>((resolve, reject) => action(database.transaction(STORE, mode).objectStore(STORE), resolve, reject));
  } finally {
    database.close();
  }
}

const putQueued = (entry: QueueEntry) => queueTransaction<void>("readwrite", (store, resolve, reject) => {
  const request = store.put(entry); request.onsuccess = () => resolve(); request.onerror = () => reject(request.error);
});
const deleteQueued = (id: string) => queueTransaction<void>("readwrite", (store, resolve, reject) => {
  const request = store.delete(id); request.onsuccess = () => resolve(); request.onerror = () => reject(request.error);
});
const allQueued = () => queueTransaction<QueueEntry[]>("readonly", (store, resolve, reject) => {
  const request = store.getAll(); request.onsuccess = () => resolve(request.result as QueueEntry[]); request.onerror = () => reject(request.error);
});

function captureId() {
  return typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `capture-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function clampOffsets(crop: CropState, viewportWidth: number, viewportHeight: number, x: number, y: number, zoom = crop.zoom) {
  const scale = Math.max(viewportWidth / crop.naturalWidth, viewportHeight / crop.naturalHeight) * zoom;
  const width = crop.naturalWidth * scale;
  const height = crop.naturalHeight * scale;
  return {
    scale,
    x: Math.min(0, Math.max(viewportWidth - width, x)),
    y: Math.min(0, Math.max(viewportHeight - height, y)),
  };
}

async function croppedPhoto(image: HTMLImageElement, viewport: HTMLDivElement, crop: CropState) {
  const width = viewport.clientWidth;
  const height = viewport.clientHeight;
  const positioned = clampOffsets(crop, width, height, crop.x, crop.y);
  const sourceX = Math.max(0, -positioned.x / positioned.scale);
  const sourceY = Math.max(0, -positioned.y / positioned.scale);
  const sourceWidth = Math.min(crop.naturalWidth - sourceX, width / positioned.scale);
  const sourceHeight = Math.min(crop.naturalHeight - sourceY, height / positioned.scale);
  const outputWidth = Math.min(1600, Math.max(1, Math.round(sourceWidth)));
  const outputHeight = Math.max(1, Math.round(outputWidth * sourceHeight / sourceWidth));
  const canvas = document.createElement("canvas");
  canvas.width = outputWidth;
  canvas.height = outputHeight;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("canvas_unavailable");
  context.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, outputWidth, outputHeight);
  return new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("crop_failed")), "image/jpeg", 0.88));
}

async function sendCapture(entry: QueueEntry, onProgress: (progress: UploadProgressState) => void) {
  const form = new FormData();
  form.append("captureId", entry.id);
  form.append("projectId", entry.projectId);
  form.append("targetType", entry.targetType);
  form.append("targetId", entry.targetId);
  form.append("note", entry.note);
  form.append("photo", new File([entry.photo], `captura-${entry.id}.jpg`, { type: "image/jpeg" }));
  if (entry.voice) form.append("voice", new File([entry.voice], `voz-${entry.id}.${entry.voice.type.includes("mp4") ? "m4a" : entry.voice.type.includes("mpeg") ? "mp3" : "webm"}`, { type: entry.voice.type || "audio/webm" }));
  const response = await uploadFormData("/api/mobile-captures", form, { onProgress });
  const data = await response.json().catch(() => ({})) as { error?: string };
  if (!response.ok) throw Object.assign(new Error(data.error || "capture_failed"), { status: response.status });
}

export default function MobileCapture({
  language,
  userEmail,
  activeProjectId,
  activeProjectName,
  projects,
  destinations,
  onProjectChange,
  onCompleted,
}: {
  language: Language;
  userEmail: string;
  activeProjectId: string;
  activeProjectName: string;
  projects: ProjectChoice[];
  destinations: Record<MobileCaptureTarget, boolean>;
  onProjectChange: (projectId: string) => Promise<void> | void;
  onCompleted: (target: MobileCaptureTarget) => Promise<void> | void;
}) {
  const [open, setOpen] = useState(false);
  const sheet = useRef<HTMLElement>(null);
  useModalFocus(open, sheet);
  const [targetType, setTargetType] = useState<MobileCaptureTarget>(destinations.expense ? "expense" : destinations.site_issue ? "site_issue" : "decision");
  const [targetId, setTargetId] = useState("");
  const [targets, setTargets] = useState<Record<MobileCaptureTarget, TargetOption[]>>({ expense: [], site_issue: [], decision: [] });
  const [loadingTargets, setLoadingTargets] = useState(false);
  const [photoUrl, setPhotoUrl] = useState("");
  const [cropShape, setCropShape] = useState<"portrait" | "landscape" | "square">("portrait");
  const [crop, setCrop] = useState<CropState | null>(null);
  const [voice, setVoice] = useState<Blob | null>(null);
  const [voiceUrl, setVoiceUrl] = useState("");
  const [recording, setRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<UploadProgressState | null>(null);
  const [queueSending, setQueueSending] = useState(false);
  const queueRunning = useRef(false);
  const [isOnline, setIsOnline] = useState(true);
  const [message, setMessage] = useState("");
  const [queued, setQueued] = useState<QueueEntry[]>([]);
  const photoInput = useRef<HTMLInputElement>(null);
  const voiceInput = useRef<HTMLInputElement>(null);
  const cropViewport = useRef<HTMLDivElement>(null);
  const cropImage = useRef<HTMLImageElement>(null);
  const pointer = useRef<{ id: number; clientX: number; clientY: number; x: number; y: number } | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const recordingStream = useRef<MediaStream | null>(null);
  const recordingChunks = useRef<Blob[]>([]);
  const recordingTimeout = useRef<number | null>(null);

  const refreshQueue = useCallback(async () => {
    try { setQueued((await allQueued()).filter((entry) => entry.email === userEmail)); }
    catch { setQueued([]); }
  }, [userEmail]);

  const clearMedia = useCallback(() => {
    if (photoUrl) URL.revokeObjectURL(photoUrl);
    if (voiceUrl) URL.revokeObjectURL(voiceUrl);
    setPhotoUrl(""); setCrop(null); setVoice(null); setVoiceUrl(""); setNote(""); setTargetId(""); setMessage("");
  }, [photoUrl, voiceUrl]);

  const stopRecording = useCallback(() => {
    if (recordingTimeout.current) window.clearTimeout(recordingTimeout.current);
    recordingTimeout.current = null;
    if (recorder.current?.state === "recording") recorder.current.stop();
    recordingStream.current?.getTracks().forEach((track) => track.stop());
    recordingStream.current = null;
    setRecording(false);
  }, []);

  useEffect(() => {
    const syncConnection = () => setIsOnline(navigator.onLine);
    const initialConnection = window.setTimeout(syncConnection, 0);
    window.addEventListener("online", syncConnection);
    window.addEventListener("offline", syncConnection);
    return () => {
      window.clearTimeout(initialConnection);
      window.removeEventListener("online", syncConnection);
      window.removeEventListener("offline", syncConnection);
    };
  }, []);

  useEffect(() => {
    const initial = window.setTimeout(() => void refreshQueue(), 0);
    return () => {
      window.clearTimeout(initial);
      recordingStream.current?.getTracks().forEach((track) => track.stop());
      if (recordingTimeout.current) window.clearTimeout(recordingTimeout.current);
    };
  }, [refreshQueue]);

  useEffect(() => {
    if (!recording) return;
    const timer = window.setInterval(() => setRecordingSeconds((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [recording]);

  const processQueue = useCallback(async () => {
    if (!navigator.onLine || busy || queueRunning.current) return;
    queueRunning.current = true;
    setQueueSending(true);
    try {
      const entries = (await allQueued()).filter((entry) => entry.email === userEmail && entry.projectId === activeProjectId);
      for (const entry of entries) {
        try {
          await sendCapture(entry, setUploadProgress);
          await deleteQueued(entry.id);
          await onCompleted(entry.targetType);
        } catch (reason) {
          const status = Number((reason as { status?: number })?.status || 0);
          await putQueued({ ...entry, attempts: entry.attempts + 1, lastError: reason instanceof Error ? reason.message.slice(0, 180) : "retry_failed" });
          if (!status || status >= 500) break;
        }
      }
      await refreshQueue();
    } finally {
      queueRunning.current = false;
      setQueueSending(false);
      setUploadProgress(null);
    }
  }, [activeProjectId, busy, onCompleted, refreshQueue, userEmail]);

  useEffect(() => {
    const online = () => void processQueue();
    window.addEventListener("online", online);
    if (navigator.onLine) window.setTimeout(online, 500);
    return () => window.removeEventListener("online", online);
  }, [processQueue]);

  const loadTargets = useCallback(async () => {
    setLoadingTargets(true);
    setMessage("");
    try {
      const next: Record<MobileCaptureTarget, TargetOption[]> = { expense: [], site_issue: [], decision: [] };
      const requests: Promise<void>[] = [];
      if (destinations.expense) requests.push(fetch("/api/expenses", { cache: "no-store" }).then(async (response) => {
        const data = await response.json(); if (!response.ok) throw new Error(data.error);
        next.expense = (data.budgetLines || []).map((item: { id: string; item: string; paid: number }) => ({ id: item.id, label: item.item, detail: new Intl.NumberFormat(language === "es" ? "es-CR" : "en-US", { style: "currency", currency: data.currency === "USD" ? "USD" : "CRC", maximumFractionDigits: 2 }).format(item.paid) }));
      }));
      if (destinations.site_issue) requests.push(fetch("/api/site-issues", { cache: "no-store" }).then(async (response) => {
        const data = await response.json(); if (!response.ok) throw new Error(data.error);
        next.site_issue = (data.issues || []).map((item: { id: string; title: string; status: string }) => ({ id: item.id, label: item.title, detail: item.status.replaceAll("_", " ") }));
      }));
      if (destinations.decision) requests.push(fetch("/api/decisions", { cache: "no-store" }).then(async (response) => {
        const data = await response.json(); if (!response.ok) throw new Error(data.error);
        next.decision = (data.decisions || []).map((item: { id: string; title: string; status: string }) => ({ id: item.id, label: item.title, detail: item.status }));
      }));
      await Promise.all(requests);
      setTargets(next);
      const available = next[targetType];
      setTargetId((current) => available.some((item) => item.id === current) ? current : available[0]?.id || "");
    } catch {
      setMessage(tr(language, "Destinations could not be loaded.", "No se pudieron cargar los destinos."));
    } finally { setLoadingTargets(false); }
  }, [destinations, language, targetType]);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => void loadTargets(), 0);
    return () => window.clearTimeout(timer);
  }, [activeProjectId, loadTargets, open]);

  useEffect(() => {
    const viewport = cropViewport.current;
    if (!open || !photoUrl || !viewport) return;
    const observer = new ResizeObserver(() => {
      const width = viewport.clientWidth;
      const height = viewport.clientHeight;
      if (!width || !height) return;
      pointer.current = null;
      setCrop((previous) => {
        if (!previous || (previous.viewportWidth === width && previous.viewportHeight === height)) return previous;
        const old = clampOffsets(previous, previous.viewportWidth, previous.viewportHeight, previous.x, previous.y);
        const centerX = (previous.viewportWidth / 2 - old.x) / old.scale;
        const centerY = (previous.viewportHeight / 2 - old.y) / old.scale;
        const next = { ...previous, viewportWidth: width, viewportHeight: height };
        const scale = Math.max(width / previous.naturalWidth, height / previous.naturalHeight) * previous.zoom;
        const positioned = clampOffsets(next, width, height, width / 2 - centerX * scale, height / 2 - centerY * scale);
        return { ...next, x: positioned.x, y: positioned.y };
      });
    });
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [open, photoUrl]);

  const selectPhoto = (file?: File) => {
    if (!file || !file.type.startsWith("image/")) return;
    if (photoUrl) URL.revokeObjectURL(photoUrl);
    setPhotoUrl(URL.createObjectURL(file));
    setCrop(null);
    setMessage("");
  };

  const initializeCrop = () => {
    const image = cropImage.current; const viewport = cropViewport.current;
    if (!image || !viewport) return;
    const naturalWidth = image.naturalWidth; const naturalHeight = image.naturalHeight;
    const initial: CropState = { naturalWidth, naturalHeight, viewportWidth: viewport.clientWidth, viewportHeight: viewport.clientHeight, zoom: 1, x: 0, y: 0 };
    const positioned = clampOffsets(initial, viewport.clientWidth, viewport.clientHeight, (viewport.clientWidth - naturalWidth * Math.max(viewport.clientWidth / naturalWidth, viewport.clientHeight / naturalHeight)) / 2, (viewport.clientHeight - naturalHeight * Math.max(viewport.clientWidth / naturalWidth, viewport.clientHeight / naturalHeight)) / 2);
    setCrop({ ...initial, x: positioned.x, y: positioned.y });
  };

  const changeZoom = (zoom: number) => {
    const viewport = cropViewport.current;
    if (!crop || !viewport) return;
    const old = clampOffsets(crop, viewport.clientWidth, viewport.clientHeight, crop.x, crop.y);
    const imageCenterX = (viewport.clientWidth / 2 - crop.x) / old.scale;
    const imageCenterY = (viewport.clientHeight / 2 - crop.y) / old.scale;
    const next = { ...crop, zoom };
    const nextScale = Math.max(viewport.clientWidth / crop.naturalWidth, viewport.clientHeight / crop.naturalHeight) * zoom;
    const positioned = clampOffsets(next, viewport.clientWidth, viewport.clientHeight, viewport.clientWidth / 2 - imageCenterX * nextScale, viewport.clientHeight / 2 - imageCenterY * nextScale, zoom);
    setCrop({ ...next, x: positioned.x, y: positioned.y });
  };

  const startRecording = async () => {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      voiceInput.current?.click();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recordingStream.current = stream;
      const preferred = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm"].find((type) => MediaRecorder.isTypeSupported(type));
      const next = new MediaRecorder(stream, preferred ? { mimeType: preferred } : undefined);
      recordingChunks.current = [];
      next.ondataavailable = (event) => { if (event.data.size) recordingChunks.current.push(event.data); };
      next.onstop = () => {
        const blob = new Blob(recordingChunks.current, { type: next.mimeType || "audio/webm" });
        if (voiceUrl) URL.revokeObjectURL(voiceUrl);
        setVoice(blob); setVoiceUrl(URL.createObjectURL(blob));
      };
      recorder.current = next;
      setRecordingSeconds(0); setRecording(true); setMessage("");
      next.start(500);
      recordingTimeout.current = window.setTimeout(stopRecording, 120_000);
    } catch {
      setMessage(tr(language, "Microphone access was not granted. You can attach an audio file instead.", "No se otorgó acceso al micrófono. Podés adjuntar un audio."));
    }
  };

  const selectVoice = (file?: File) => {
    if (!file || !file.type.startsWith("audio/")) return;
    if (voiceUrl) URL.revokeObjectURL(voiceUrl);
    setVoice(file); setVoiceUrl(URL.createObjectURL(file)); setMessage("");
  };

  const resetAndClose = () => {
    stopRecording(); clearMedia(); setOpen(false);
  };

  const submit = async () => {
    if (!crop || !cropImage.current || !cropViewport.current || !targetId || busy || queueRunning.current) return;
    setBusy(true); setMessage(""); setUploadProgress(null);
    try {
      const photo = await croppedPhoto(cropImage.current, cropViewport.current, crop);
      const entry: QueueEntry = { id: captureId(), email: userEmail, projectId: activeProjectId, targetType, targetId, note: note.trim().slice(0, 500), photo, voice, createdAt: new Date().toISOString(), attempts: 0, lastError: "" };
      if (!navigator.onLine) {
        await putQueued(entry); await refreshQueue();
        clearMedia(); setOpen(false);
        setMessage(tr(language, "Saved on this phone. It will retry when the app is open and the connection returns.", "Guardado en este teléfono. Se reintentará cuando la app esté abierta y vuelva la conexión."));
        return;
      }
      try {
        await sendCapture(entry, setUploadProgress);
      } catch (reason) {
        const status = Number((reason as { status?: number })?.status || 0);
        if (!status || status >= 500) {
          await putQueued({ ...entry, attempts: 1, lastError: reason instanceof Error ? reason.message.slice(0, 180) : "network" });
          await refreshQueue(); clearMedia(); setOpen(false);
          setMessage(tr(language, "Connection failed; the capture is queued safely on this phone.", "Falló la conexión; la captura quedó en cola de forma segura en este teléfono."));
          return;
        }
        throw reason;
      }
      await onCompleted(targetType);
      clearMedia(); setOpen(false);
      setMessage(tr(language, "Capture linked successfully.", "Captura vinculada correctamente."));
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : tr(language, "The capture could not be saved.", "No se pudo guardar la captura."));
    } finally { setBusy(false); setUploadProgress(null); }
  };

  const selectedTargets = targets[targetType];
  const activeQueued = queued.filter((entry) => entry.projectId === activeProjectId);
  const cropPosition = crop ? clampOffsets(crop, crop.viewportWidth, crop.viewportHeight, crop.x, crop.y) : null;

  return <>
    <button className="mobile-capture-fab" onClick={() => setOpen(true)} aria-label={tr(language, "New field capture", "Nueva captura de obra")}>
      <span>＋</span><b>{tr(language, "Capture", "Capturar")}</b>{queued.length > 0 && <em>{queued.length}</em>}
    </button>
    {message && !open && <div className="mobile-capture-status" role="status">{message}<button aria-label={tr(language, "Dismiss capture message", "Cerrar mensaje de captura")} onClick={() => setMessage("")}>×</button></div>}
    {!open && uploadProgress && <div className="mobile-capture-status"><UploadProgress progress={uploadProgress} language={language} /></div>}
    {open && <div className="mobile-capture-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) resetAndClose(); }}>
      <section ref={sheet} tabIndex={-1} className="mobile-capture-sheet" role="dialog" aria-modal="true" aria-labelledby="mobile-capture-title" onKeyDown={(event) => { if (event.key === "Escape" && !busy) { event.preventDefault(); event.stopPropagation(); resetAndClose(); } }}>
        <header><div><span className="overline">{tr(language, "FIELD CAPTURE", "CAPTURA DE OBRA")}</span><h2 id="mobile-capture-title">{tr(language, "Add from your phone", "Agregar desde el teléfono")}</h2></div><button onClick={resetAndClose} disabled={busy} aria-label={tr(language, "Close", "Cerrar")}>×</button></header>
        <div className="mobile-capture-scroll">
          <label className="mobile-capture-field"><span>1 · {tr(language, "Project", "Proyecto")}</span><select value={activeProjectId} disabled={busy || Boolean(photoUrl) || recording} onChange={(event) => void onProjectChange(event.target.value)}>{projects.filter((project) => project.kind === "shared" && project.role !== "viewer").map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select><small>{photoUrl ? tr(language, "Finish or discard this photo before changing projects.", "Terminá o descartá esta foto antes de cambiar de proyecto.") : activeProjectName}</small></label>
          <fieldset className="mobile-capture-field"><legend>2 · {tr(language, "Link to", "Vincular a")}</legend><div className="capture-target-tabs">{(["expense", "site_issue", "decision"] as const).filter((target) => destinations[target]).map((target) => <button type="button" className={targetType === target ? "selected" : ""} key={target} onClick={() => { setTargetType(target); setTargetId(targets[target][0]?.id || ""); }}>{target === "expense" ? `▤ ${tr(language, "Expense", "Gasto")}` : target === "site_issue" ? `! ${tr(language, "Progress", "Avance")}` : `◇ ${tr(language, "Decision", "Decisión")}`}</button>)}</div><select aria-label={tr(language, "Capture destination", "Destino de la captura")} value={targetId} disabled={loadingTargets || selectedTargets.length === 0} onChange={(event) => setTargetId(event.target.value)}><option value="">{loadingTargets ? tr(language, "Loading…", "Cargando…") : tr(language, "Select destination", "Seleccioná el destino")}</option>{selectedTargets.map((target) => <option key={target.id} value={target.id}>{target.label} · {target.detail}</option>)}</select>{!loadingTargets && selectedTargets.length === 0 && <small>{targetType === "expense" ? tr(language, "Add a paid price in Excel first.", "Primero agregá un precio pagado en Excel.") : tr(language, "Create the destination first.", "Primero creá el destino.")}</small>}</fieldset>
          <div className="mobile-capture-field"><span>3 · {tr(language, "Photo and crop", "Foto y recorte")}</span><input ref={photoInput} hidden type="file" accept="image/*" capture="environment" onChange={(event) => { selectPhoto(event.target.files?.[0]); event.target.value = ""; }} />{!photoUrl ? <button className="capture-photo-button" onClick={() => photoInput.current?.click()}><span>▣</span><b>{tr(language, "Take photo or choose image", "Tomar foto o elegir imagen")}</b><small>{tr(language, "The camera opens on supported phones", "La cámara se abre en teléfonos compatibles")}</small></button> : <><div ref={cropViewport} className={`capture-crop-viewport ${cropShape}`} onPointerDown={(event) => { if (!crop || pointer.current) return; event.currentTarget.setPointerCapture(event.pointerId); pointer.current = { id: event.pointerId, clientX: event.clientX, clientY: event.clientY, x: crop.x, y: crop.y }; }} onPointerMove={(event) => { const start = pointer.current; const viewport = cropViewport.current; if (!start || start.id !== event.pointerId || !crop || !viewport) return; const positioned = clampOffsets(crop, viewport.clientWidth, viewport.clientHeight, start.x + event.clientX - start.clientX, start.y + event.clientY - start.clientY); setCrop({ ...crop, x: positioned.x, y: positioned.y }); }} onPointerUp={(event) => { if (pointer.current?.id === event.pointerId) pointer.current = null; }} onPointerCancel={(event) => { if (pointer.current?.id === event.pointerId) pointer.current = null; }} onLostPointerCapture={(event) => { if (pointer.current?.id === event.pointerId) pointer.current = null; }}><img ref={cropImage} src={photoUrl} alt={tr(language, "Photo to crop", "Foto para recortar")} onLoad={initializeCrop} draggable={false} style={crop && cropPosition ? { width: crop.naturalWidth * cropPosition.scale, height: crop.naturalHeight * cropPosition.scale, transform: `translate3d(${crop.x}px, ${crop.y}px, 0)` } : undefined} /><span className="capture-crop-frame" aria-hidden="true" /></div><div className="capture-crop-controls"><select aria-label={tr(language, "Crop shape", "Forma del recorte")} value={cropShape} onChange={(event) => { setCropShape(event.target.value as typeof cropShape); setCrop(null); window.setTimeout(initializeCrop, 0); }}><option value="portrait">{tr(language, "Receipt · portrait", "Factura · vertical")}</option><option value="landscape">{tr(language, "Photo · landscape", "Foto · horizontal")}</option><option value="square">{tr(language, "Square", "Cuadrado")}</option></select><label><span>{tr(language, "Zoom", "Zoom")}</span><input type="range" min="1" max="3" step="0.05" value={crop?.zoom || 1} onChange={(event) => changeZoom(Number(event.target.value))} /></label><button className="secondary-button" onClick={() => photoInput.current?.click()}>{tr(language, "Retake", "Repetir")}</button></div><small>{tr(language, "Drag the image and zoom until only the receipt remains inside the frame.", "Arrastrá la imagen y usá zoom hasta dejar solo la factura dentro del marco.")}</small></>}</div>
          <label className="mobile-capture-field"><span>4 · {tr(language, "Written note (optional)", "Nota escrita (opcional)")}</span><textarea maxLength={500} value={note} onChange={(event) => setNote(event.target.value)} placeholder={tr(language, "What happened, supplier, location…", "Qué ocurrió, proveedor, ubicación…")} /><small>{note.length}/500</small></label>
          <div className="mobile-capture-field"><span>5 · {tr(language, "Voice note (optional)", "Nota por voz (opcional)")}</span><input ref={voiceInput} hidden type="file" accept="audio/*" capture onChange={(event) => { selectVoice(event.target.files?.[0]); event.target.value = ""; }} />{recording ? <button className="capture-record-button recording" onClick={stopRecording}><i />{tr(language, `Stop · ${recordingSeconds}s`, `Detener · ${recordingSeconds}s`)}</button> : !voice ? <div className="capture-voice-actions"><button className="capture-record-button" onClick={() => void startRecording()}><i />{tr(language, "Record voice", "Grabar voz")}</button><button className="secondary-button" onClick={() => voiceInput.current?.click()}>{tr(language, "Attach audio", "Adjuntar audio")}</button></div> : <div className="capture-audio-preview"><audio controls src={voiceUrl} /><button aria-label={tr(language, "Remove voice note", "Eliminar nota de voz")} onClick={() => { if (voiceUrl) URL.revokeObjectURL(voiceUrl); setVoice(null); setVoiceUrl(""); }}>×</button></div>}<small>{tr(language, "Maximum 2 minutes. Recording stays on this device until sent.", "Máximo 2 minutos. La grabación permanece en este dispositivo hasta enviarse.")}</small></div>
          {message && <div className="form-error" role="alert">{message}</div>}
          <UploadProgress progress={uploadProgress} language={language} />
          {activeQueued.length > 0 && <details className="capture-queue"><summary>{activeQueued.length} {tr(language, "capture(s) waiting on this phone", "captura(s) en espera en este teléfono")}</summary>{activeQueued.map((entry) => <article key={entry.id}><span><b>{entry.targetType === "expense" ? tr(language, "Expense", "Gasto") : entry.targetType === "site_issue" ? tr(language, "Progress entry", "Registro de avance") : tr(language, "Decision", "Decisión")}</b><small>{entry.lastError || tr(language, "Waiting for connection", "Esperando conexión")}</small></span><button onClick={() => void deleteQueued(entry.id).then(refreshQueue)}>{tr(language, "Discard", "Descartar")}</button></article>)}<button className="secondary-button" disabled={!isOnline || busy || queueSending} onClick={() => void processQueue()}>{tr(language, "Retry now", "Reintentar ahora")}</button></details>}
        </div>
        <footer><button className="secondary-button" onClick={resetAndClose} disabled={busy}>{tr(language, "Cancel", "Cancelar")}</button><button className="primary-button" disabled={busy || queueSending || recording || !crop || !targetId} onClick={() => void submit()}>{busy ? tr(language, "Saving…", "Guardando…") : isOnline ? tr(language, "Save and link", "Guardar y vincular") : tr(language, "Save to queue", "Guardar en cola")}</button></footer>
      </section>
    </div>}
  </>;
}
