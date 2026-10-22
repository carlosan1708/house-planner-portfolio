"use client";

import { useEffect, useRef, useState } from "react";
import "./folder-vault.css";

type VaultUser = { uid: string; email: string; name: string };

export function FolderEncryptionPending({ count, language, onRefresh }: {
  count: number;
  language: "es" | "en";
  onRefresh: () => Promise<void>;
}) {
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  if (count <= 0) return null;
  const refresh = async () => {
    setRefreshing(true);
    setError("");
    try { await onRefresh(); }
    catch { setError(language === "es" ? "No se pudo actualizar la lista. Vuelve a intentarlo." : "The list could not be refreshed. Try again."); }
    finally { setRefreshing(false); }
  };
  return <section className="folder-vault folder-encryption-pending" aria-live="polite">
    <p>{language === "es"
      ? "Algunos archivos están terminando de encriptarse. Actualiza para reintentar; no estarán disponibles hasta que termine la limpieza."
      : "Some files are finishing encryption. Refresh to retry; they remain unavailable until cleanup finishes."}</p>
    <button className="secondary-button" disabled={refreshing} onClick={() => void refresh()}>{language === "es" ? (refreshing ? "Actualizando…" : "Actualizar") : (refreshing ? "Refreshing…" : "Refresh")}</button>
    {error && <p className="form-error" role="alert">{error}</p>}
  </section>;
}

type FolderVaultProps = {
  folderId: string;
  folderName: string;
  unlocked: boolean;
  isAdmin: boolean;
  language: "es" | "en";
  onChange: (locked: boolean) => Promise<void>;
};

export default function FolderVault(props: FolderVaultProps) {
  return <FolderVaultContent key={props.folderId} {...props} />;
}

function FolderVaultContent({
  folderId,
  folderName,
  unlocked,
  isAdmin,
  language,
  onChange,
}: FolderVaultProps) {
  const label = (en: string, es: string) => language === "es" ? es : en;
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [managing, setManaging] = useState(false);
  const [users, setUsers] = useState<VaultUser[]>([]);
  const [allowedUids, setAllowedUids] = useState<string[]>([]);
  const [accessFolderId, setAccessFolderId] = useState("");
  const [accessSaved, setAccessSaved] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [passwordReset, setPasswordReset] = useState(false);
  const [passwordResetAvailable, setPasswordResetAvailable] = useState<boolean | undefined>(undefined);
  const mounted = useRef(true);
  const resetRequest = useRef<AbortController | null>(null);
  const accessLoaded = accessFolderId === folderId;
  const resetValid = newPassword.length >= 12 && newPassword.length <= 128 && newPassword === confirmation;

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; resetRequest.current?.abort(); };
  }, []);

  const clearPasswords = () => {
    setPassword("");
    setNewPassword("");
    setConfirmation("");
  };

  useEffect(() => {
    if ((!managing && !resetting) || !isAdmin) return;
    const controller = new AbortController();
    let stopped = false;
    void fetch(`/api/folder-vault?folderId=${encodeURIComponent(folderId)}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("access");
        const data = await response.json() as { allowedUids: string[]; users: VaultUser[]; passwordResetAvailable?: boolean };
        if (stopped) return;
        setUsers(data.users);
        setAllowedUids(data.allowedUids);
        setAccessFolderId(folderId);
        setPasswordResetAvailable(data.passwordResetAvailable !== false);
      })
      .catch((reason) => {
        if (stopped || reason instanceof DOMException && reason.name === "AbortError") return;
        setError(resetting
          ? (language === "es" ? "No se pudo comprobar si el restablecimiento está disponible. Cierra y vuelve a abrir el formulario." : "Password reset availability could not be checked. Close and reopen the form.")
          : (language === "es" ? "No se pudieron cargar los accesos. Cierra y vuelve a abrir la lista." : "Access could not be loaded. Close and reopen the list."));
      });
    return () => { stopped = true; controller.abort(); };
  }, [folderId, isAdmin, language, managing, resetting]);

  const changeLock = async (lock: boolean) => {
    const submittedPassword = password;
    clearPasswords();
    setPasswordReset(false);
    setBusy(true);
    setError("");
    try {
      const response = lock
        ? await fetch(`/api/folder-vault?folderId=${encodeURIComponent(folderId)}`, { method: "DELETE" })
        : await fetch("/api/folder-vault", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ folderId, password: submittedPassword }) });
      if (!response.ok) {
        if (response.status === 429) throw new Error("rate-limit");
        if (!lock && [400, 401, 403].includes(response.status)) throw new Error("unlock");
        throw new Error("change");
      }
      if (!mounted.current) return;
      await onChange(lock);
    } catch (reason) {
      setError(reason instanceof Error && reason.message === "rate-limit"
        ? label("Too many attempts. Wait a few minutes before trying again.", "Demasiados intentos. Espera unos minutos antes de volver a probar.")
        : reason instanceof Error && reason.message === "unlock"
          ? label("Check the password and confirm that the administrator granted you access.", "Revisa la contraseña y confirma que el administrador te dio acceso.")
          : label("The folder could not be updated. Try again.", "No se pudo actualizar la carpeta. Vuelve a intentarlo."));
    } finally { setBusy(false); }
  };

  const saveAccess = async () => {
    clearPasswords();
    setPasswordReset(false);
    setBusy(true);
    setError("");
    setAccessSaved(false);
    try {
      const response = await fetch("/api/folder-vault", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ folderId, allowedUids }) });
      if (!response.ok) throw new Error("access");
      await onChange(true);
      setAccessSaved(true);
    } catch {
      setError(label("Access could not be saved. Try again.", "No se pudieron guardar los accesos. Vuelve a intentarlo."));
    } finally { setBusy(false); }
  };

  const resetPassword = async () => {
    if (!isAdmin || busy || !resetValid || passwordResetAvailable === false) return;
    const submittedPassword = newPassword;
    clearPasswords();
    setBusy(true);
    setError("");
    setPasswordReset(false);
    const controller = new AbortController();
    resetRequest.current = controller;
    try {
      const response = await fetch("/api/folder-vault", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folderId, action: "reset-password", newPassword: submittedPassword }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error("reset");
      const result = await response.json() as { ok?: boolean; passwordReset?: boolean };
      if (!result.ok || !result.passwordReset) throw new Error("reset");
      if (!mounted.current) return;
      await onChange(true);
      if (!mounted.current) return;
      setResetting(false);
      setPasswordReset(true);
    } catch {
      if (mounted.current) setError(label("The password could not be reset. Enter the new password again and retry.", "No se pudo restablecer la contraseña. Ingresa nuevamente la nueva contraseña e inténtalo otra vez."));
    } finally {
      if (mounted.current) setBusy(false);
      resetRequest.current = null;
    }
  };

  return (
    <section className={`folder-vault ${unlocked ? "unlocked" : "locked"}`} aria-label={label("Protected folder", "Carpeta protegida")}>
      <div className="folder-vault-heading">
        <span aria-hidden="true">{unlocked ? "🔓" : "🔒"}</span>
        <div>
          <h3>{folderName}</h3>
          <p>{unlocked
            ? label("Encrypted folder unlocked for up to 15 minutes. Lock it when you finish.", "Carpeta encriptada desbloqueada por un máximo de 15 minutos. Bloquéala al terminar.")
            : label("Encrypted files are hidden. Access requires the administrator’s permission and the folder password.", "Los archivos encriptados están ocultos. Para entrar necesitas el permiso del administrador y la contraseña de la carpeta.")}</p>
        </div>
        {unlocked && <button className="secondary-button" disabled={busy} onClick={() => void changeLock(true)}>{label("Lock folder", "Bloquear carpeta")}</button>}
      </div>
      {!unlocked && <form className="folder-vault-unlock" onSubmit={(event) => { event.preventDefault(); if (password.length >= 12 && !busy) void changeLock(false); }}>
        <label>
          <span>{label("Folder password", "Contraseña de la carpeta")}</span>
          <input type="password" autoComplete="current-password" required minLength={12} maxLength={128} value={password} disabled={busy} onChange={(event) => setPassword(event.target.value)} />
        </label>
        <button className="primary-button" disabled={busy || password.length < 12}>{busy ? label("Opening…", "Abriendo…") : label("Unlock folder", "Desbloquear carpeta")}</button>
      </form>}
      {error && <p className="form-error" role="alert">{error}</p>}
      {passwordReset && <p className="folder-vault-reset-success" role="status">{label("Password reset. Files and authorized access are preserved. Existing unlocks have been revoked; open the folder with the new password.", "Contraseña restablecida. Se conservan los archivos y los accesos autorizados. Se cerraron los desbloqueos anteriores; abre la carpeta con la nueva contraseña.")}</p>}
      {isAdmin && <div className="folder-vault-admin">
        <div className="folder-vault-admin-actions">
          <button className="secondary-button" disabled={busy} aria-expanded={managing} onClick={() => { clearPasswords(); setManaging(!managing); setResetting(false); setPasswordReset(false); setAccessSaved(false); setAccessFolderId(""); setError(""); }}>{label("Manage folder access", "Administrar acceso a la carpeta")}</button>
          <button className="secondary-button" disabled={busy} aria-expanded={resetting} onClick={() => { clearPasswords(); setResetting(!resetting); setManaging(false); setPasswordReset(false); setAccessSaved(false); setError(""); }}>{label("Reset password", "Restablecer contraseña")}</button>
        </div>
        {resetting && <form className="folder-vault-reset" onSubmit={(event) => { event.preventDefault(); void resetPassword(); }}>
          <p>{label("As administrator, you can set a new password without the previous one. Files and authorized access are preserved. Everyone will need to unlock the folder again.", "Como administrador puedes establecer una nueva contraseña sin conocer la anterior. Se conservan los archivos y los accesos autorizados. Todos tendrán que desbloquear la carpeta nuevamente.")}</p>
          <div className="folder-protection-passwords">
            <label><span>{label("New folder password", "Nueva contraseña de la carpeta")}</span><input type="password" autoComplete="new-password" required minLength={12} maxLength={128} value={newPassword} disabled={busy} onChange={(event) => setNewPassword(event.target.value)} /></label>
            <label><span>{label("Confirm new password", "Confirmar nueva contraseña")}</span><input type="password" autoComplete="new-password" required minLength={12} maxLength={128} value={confirmation} disabled={busy} onChange={(event) => setConfirmation(event.target.value)} /></label>
          </div>
          <small>{label("Use 12–128 characters.", "Usa de 12 a 128 caracteres.")}</small>
          {passwordResetAvailable === false && <p role="status">{label("Password reset is unavailable for this folder.", "El restablecimiento de contraseña no está disponible para esta carpeta.")}</p>}
          {confirmation && newPassword !== confirmation && <small role="status">{label("The passwords do not match.", "Las contraseñas no coinciden.")}</small>}
          <div className="folder-vault-admin-actions">
            <button className="primary-button" disabled={busy || !resetValid || passwordResetAvailable === false}>{busy ? label("Resetting…", "Restableciendo…") : label("Save new password", "Guardar nueva contraseña")}</button>
            <button className="secondary-button" type="button" disabled={busy} onClick={() => { clearPasswords(); setResetting(false); setError(""); }}>{label("Cancel", "Cancelar")}</button>
          </div>
        </form>}
        {managing && <div className="folder-vault-access">
          <p>{label("Only selected project members can open this folder with its password. They also need the usual Documents and folder permissions. Administrators already have permission.", "Solo los miembros seleccionados del proyecto podrán abrir esta carpeta con su contraseña. También necesitan los permisos normales de Documentos y de la carpeta. Los administradores ya tienen permiso.")}</p>
          {!accessLoaded ? <p role="status">{label("Loading access…", "Cargando accesos…")}</p> : <>
            {users.length === 0 && <p>{label("There are no approved members to add.", "No hay miembros aprobados para agregar.")}</p>}
            <fieldset disabled={busy}>
              <legend>{label("Members allowed to open this folder", "Miembros autorizados para abrir esta carpeta")}</legend>
              {users.map((member) => <label key={member.uid}>
                <input type="checkbox" checked={allowedUids.includes(member.uid)} onChange={(event) => { setAccessSaved(false); setAllowedUids((current) => event.target.checked ? [...current, member.uid] : current.filter((uid) => uid !== member.uid)); }} />
                <span><b>{member.name || member.email}</b><small>{member.email}</small></span>
              </label>)}
            </fieldset>
            <button className="primary-button" disabled={busy} onClick={() => void saveAccess()}>{label("Save access", "Guardar accesos")}</button>
          </>}
          {accessSaved && <p role="status">{label("Access saved. The folder is locked again.", "Accesos guardados. La carpeta se bloqueó nuevamente.")}</p>}
        </div>}
      </div>}
    </section>
  );
}
