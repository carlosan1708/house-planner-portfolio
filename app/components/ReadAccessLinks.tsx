"use client";

import { useEffect, useState, type ReactNode } from "react";
import { DEFAULT_MEMBER_PERMISSIONS, type FolderAccess, type MemberPermissions, type WorkspaceTab } from "@/lib/project";
import { buildWorkspacePath } from "@/lib/workspace-navigation";
import type { AccessLinkRecord } from "@/lib/access-links";
import CopyWorkspaceLink from "./CopyWorkspaceLink";
import "./read-access-links.css";

type Language = "en" | "es";
type Policy = { label: string; permissions: MemberPermissions; folderAccess: FolderAccess; defaultLanguage: Language };
const text = (language: Language, en: string, es: string) => language === "es" ? es : en;
const initialPolicy = (language: Language): Policy => ({ label: "", permissions: { ...DEFAULT_MEMBER_PERMISSIONS }, folderAccess: { mode: "all", folderIds: [], allowUnfiled: true }, defaultLanguage: language });

export default function ReadAccessLinks({ projectId, language, sections, renderFolderPicker, onAccessChanged }: {
  projectId: string;
  language: Language;
  sections: Array<{ id: WorkspaceTab; label: string }>;
  renderFolderPicker: (value: FolderAccess, change: (value: FolderAccess) => void, disabled: boolean) => ReactNode;
  onAccessChanged?: () => void | Promise<unknown>;
}) {
  const [links, setLinks] = useState<AccessLinkRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);
  const [authentication, setAuthentication] = useState<"account" | "public">("public");
  const [policy, setPolicy] = useState<Policy>({ label: "", permissions: { ...DEFAULT_MEMBER_PERMISSIONS }, folderAccess: { mode: "all", folderIds: [], allowUnfiled: true }, defaultLanguage: language });
  const [section, setSection] = useState<WorkspaceTab>("overview");
  const [categoryKey, setCategoryKey] = useState<"chapter" | "type" | "subcategory">("chapter");
  const [categoryName, setCategoryName] = useState("");
  const [createdUrl, setCreatedUrl] = useState("");
  const [createdLinkId, setCreatedLinkId] = useState("");
  const [accessUrls, setAccessUrls] = useState<Record<string, string>>({});
  const enabledSections = sections.filter(item => policy.permissions[item.id]);
  const startingSection = enabledSections.find(item => item.id === section)?.id || enabledSections[0]?.id || "overview";
  const activeLinks = links.filter(link => link.status === "active");
  const history = links.filter(link => link.status !== "active");

  function newLink() {
    setEditingId(null); setPolicy(initialPolicy(language)); setAuthentication("public"); setSection("overview"); setCategoryKey("chapter"); setCategoryName("");
    setComposerOpen(true); setError(""); setNotice("");
  }

  function editLink(link: AccessLinkRecord) {
    setEditingId(link.id); setAuthentication(link.authentication === "public" ? "public" : "account"); setPolicy({ label: link.label, permissions: { ...link.permissions }, folderAccess: { ...link.folderAccess, folderIds: [...link.folderAccess.folderIds] }, defaultLanguage: link.defaultLanguage === "en" ? "en" : "es" });
    setComposerOpen(true); setError(""); setNotice("");
  }

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/access-links", { cache: "no-store", signal: controller.signal }).then(async response => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || text(language, "Read links could not be loaded.", "No se pudieron cargar los enlaces de lectura."));
      setLinks(data.links || []);
    }).catch(reason => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : String(reason));
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
    // A language change only changes labels, rather than reloading project data.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  async function save() {
    if (busy || !enabledSections.length) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/access-links", {
        method: editingId ? "PATCH" : "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editingId ? { id: editingId, action: "update", ...policy } : { ...policy, authentication }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || text(language, "The link could not be saved.", "No se pudo guardar el enlace."));
      setLinks(current => [data.link, ...current.filter(link => link.id !== data.link.id)]);
      const shareUrl = data.accessUrl || accessUrls[data.link.id];
      if (shareUrl) {
        const url = new URL(shareUrl);
        if (!editingId) url.pathname = buildWorkspacePath({ projectId, section: startingSection,
          budgetScope: startingSection === "budget" && categoryName ? { key: categoryKey, label: categoryName } : null });
        url.searchParams.set("lang", data.link.defaultLanguage || policy.defaultLanguage);
        setCreatedUrl(url.href);
        setCreatedLinkId(data.link.id);
        setAccessUrls(current => ({ ...current, [data.link.id]: url.href }));
      }
      setNotice(editingId ? text(language, "Read permissions updated.", "Permisos de lectura actualizados.") : text(language, "Read link ready. Copy it before leaving this page.", "Enlace de lectura listo. Cópialo antes de salir de esta página."));
      if (editingId) { setAuthentication("public"); setPolicy(current => ({ ...current, defaultLanguage: language })); }
      setEditingId(null);
      setComposerOpen(false);
      await Promise.allSettled([Promise.resolve().then(() => onAccessChanged?.())]);
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  }

  async function revoke(id: string) {
    if (busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/access-links", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, action: "revoke" }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || text(language, "The link could not be revoked.", "No se pudo revocar el enlace."));
      setLinks(current => current.map(link => link.id === id ? data.link : link));
      if (editingId === id) { setEditingId(null); setComposerOpen(false); setAuthentication("public"); }
      if (createdLinkId === id) { setCreatedUrl(""); setCreatedLinkId(""); }
      setAccessUrls(current => { const remaining = { ...current }; delete remaining[id]; return remaining; });
      setNotice(text(language, "Link revoked. Access through this link is no longer available.", "Enlace revocado. Ya no se puede acceder por este enlace."));
      await Promise.allSettled([Promise.resolve().then(() => onAccessChanged?.())]);
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  }

  function linkRow(link: AccessLinkRecord) {
    return <article className="read-link-record" key={link.id}>
      <div className="read-link-identity"><b>{link.label || text(language, "Read link", "Enlace de lectura")}</b>
        <small>{link.authentication === "public" ? text(language, "Anyone with the link", "Cualquiera con el enlace") : text(language, "Users with an account", "Usuarios con cuenta")} · {text(language, "Default language", "Idioma predeterminado")}: {link.defaultLanguage === "en" ? "English" : "Español"}</small>
        <small>{sections.filter(item => link.permissions[item.id]).map(item => item.label).join(", ")}</small>
        <small>{link.expiresAt && `${text(language, "Expires", "Caduca")} ${new Date(link.expiresAt).toLocaleDateString(language === "es" ? "es-CR" : "en-US")}`}{link.authentication !== "public" && ` · ${link.redemptionCount || 0} ${text(language, "accounts joined", "cuentas incorporadas")}`}</small>
      </div>
      <span className={`status-chip ${link.status}`}>{link.status === "active" ? text(language, "Active", "Activo") : link.status === "expired" ? text(language, "Expired", "Caducado") : text(language, "Revoked", "Revocado")}</span>
      {link.status === "active" && <div className="read-link-actions"><button className="secondary-button" disabled={busy} onClick={() => editLink(link)}>{text(language, "Edit permissions", "Editar permisos")}</button><button className="secondary-button" disabled={busy} onClick={() => void revoke(link.id)}>{text(language, "Revoke link", "Revocar enlace")}</button></div>}
    </article>;
  }

  return <section className="read-access-links read-link-manager" aria-labelledby="read-access-links-title">
    <div className="section-head"><div><span className="overline">{text(language, "SHARE WITH A GROUP", "COMPARTIR CON UN GRUPO")}</span><h3 id="read-access-links-title">{text(language, "Read links", "Enlaces de lectura")}</h3></div><button className="primary-button" disabled={busy || loading} aria-expanded={composerOpen} aria-controls="read-link-composer" onClick={newLink}>{text(language, "New read link", "Nuevo enlace de lectura")}</button></div>
    <p className="invite-help">{text(language, "Public links open without signing in and give visitors read-only access to the selected sections and folders. Signed-in members keep their existing permissions. Account links require signing in. Link access lasts 14 days, or until you revoke it.", "Los enlaces públicos se abren sin iniciar sesión y dan a los visitantes acceso de solo lectura a las secciones y carpetas seleccionadas. Quienes ya tienen sesión mantienen sus permisos actuales. Los enlaces para cuentas requieren iniciar sesión. El acceso por el enlace dura 14 días o hasta que lo revoques.")}</p>
    {error && <p className="form-error" role="alert">{error}</p>}
    {notice && <p className="read-link-notice" role="status">{notice}</p>}
    {createdUrl && <div className="invite-link"><label>{text(language, "Read link ready", "Enlace de lectura listo")}<input readOnly aria-label={text(language, "Read access link", "Enlace de acceso de lectura")} value={createdUrl} onFocus={event => event.currentTarget.select()} /></label><CopyWorkspaceLink language={language} href={createdUrl} /></div>}
    {composerOpen && <div id="read-link-composer" className="read-link-composer">
    <h4>{editingId ? text(language, "Edit link permissions", "Editar permisos del enlace") : text(language, "Create a read link", "Crear un enlace de lectura")}</h4>
    <div className="invite-form">
      <label><span>{text(language, "Link name", "Nombre del enlace")}</span><input autoFocus value={policy.label} maxLength={100} placeholder={text(language, "Budget review", "Revisión del presupuesto")} disabled={busy} onChange={event => setPolicy(current => ({ ...current, label: event.target.value }))} /></label>
      <label><span>{text(language, "Who can access", "Quién puede acceder")}</span><select value={authentication} disabled={busy || Boolean(editingId)} onChange={event => setAuthentication(event.target.value as typeof authentication)}><option value="public">{text(language, "Anyone with the link", "Cualquiera con el enlace")}</option><option value="account">{text(language, "Users with an account", "Usuarios con cuenta")}</option></select>{editingId && <small>{text(language, "The access mode is set when the link is created.", "El tipo de acceso se define al crear el enlace.")}</small>}</label>
      <label><span>{text(language, "Default language", "Idioma predeterminado")}</span><select value={policy.defaultLanguage} disabled={busy} onChange={event => setPolicy(current => ({ ...current, defaultLanguage: event.target.value as Language }))}><option value="es">Español</option><option value="en">English</option></select></label>
      {!editingId && <label><span>{text(language, "Initial view", "Vista inicial")}</span><select value={startingSection} disabled={busy || !enabledSections.length} onChange={event => setSection(event.target.value as WorkspaceTab)}>{enabledSections.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>}
      {!editingId && startingSection === "budget" && <>
        <label><span>{text(language, "Category grouping", "Agrupación de la categoría")}</span><select value={categoryKey} disabled={busy} onChange={event => setCategoryKey(event.target.value as typeof categoryKey)}><option value="chapter">{text(language, "Chapter", "Capítulo")}</option><option value="type">{text(language, "Type", "Tipo")}</option><option value="subcategory">{text(language, "Subcategory", "Subcategoría")}</option></select></label>
        <label><span>{text(language, "Budget category (optional)", "Categoría del presupuesto (opcional)")}</span><input value={categoryName} disabled={busy} onChange={event => setCategoryName(event.target.value)} placeholder="Pisos" /><small>{text(language, "Use the exact category name; leave blank to open the budget dashboard.", "Usa el nombre exacto de la categoría; déjalo vacío para abrir el panel del presupuesto.")}</small></label>
      </>}
      <details className="read-link-customize" open={Boolean(editingId)}>
        <summary>{text(language, "Sections and folders", "Secciones y carpetas")} · {enabledSections.length} {text(language, "sections", "secciones")}</summary>
        <fieldset className="permission-picker invite-permissions" disabled={busy}><legend>{text(language, "Read sections", "Secciones de lectura")}</legend>{sections.map(item => <label key={item.id}><input type="checkbox" checked={policy.permissions[item.id]} onChange={event => setPolicy(current => ({ ...current, permissions: { ...current.permissions, [item.id]: event.target.checked } }))} /><span>{item.label}</span></label>)}</fieldset>
        {renderFolderPicker(policy.folderAccess, value => setPolicy(current => ({ ...current, folderAccess: value })), busy)}
      </details>
      <div className="read-link-actions"><button className="primary-button" disabled={busy || loading || !enabledSections.length} onClick={() => void save()}>{busy ? text(language, "Saving…", "Guardando…") : editingId ? text(language, "Save link permissions", "Guardar permisos del enlace") : text(language, "Create read link", "Crear enlace de lectura")}</button><button className="secondary-button" disabled={busy} onClick={() => { setEditingId(null); setComposerOpen(false); setError(""); }}>{text(language, "Cancel", "Cancelar")}</button></div>
    </div>
    {!enabledSections.length && <p className="invite-help">{text(language, "Enable at least one section.", "Habilita al menos una sección.")}</p>}
    </div>}
    {loading ? <p>{text(language, "Loading links…", "Cargando enlaces…")}</p> : <div className="read-link-directory"><h4>{text(language, "Active links", "Enlaces activos")} <span>{activeLinks.length}</span></h4>{activeLinks.length ? activeLinks.map(linkRow) : <p className="read-link-empty">{text(language, "There are no active read links.", "No hay enlaces de lectura activos.")}</p>}
      {history.length > 0 && <details className="read-link-history"><summary>{text(language, "Expired and revoked links", "Enlaces caducados y revocados")} · {history.length}</summary>{history.map(linkRow)}</details>}
    </div>}
  </section>;
}
